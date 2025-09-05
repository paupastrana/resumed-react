const path = require('path');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
require('dotenv').config();
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');





const app = express();
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB


// CORS con credenciales (reemplaza SOLO esta línea si quieres mantener origen restringido)
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(cookieParser());

// app.use(cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Pool PG
// Opción A: con variables sueltas
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASS || 'pau',
  database: process.env.PG_DB || 'resumed2',
  max: 10,
});




const JWT_SECRET = process.env.JWT_SECRET || 'supersecreto';
const ACCESS_TTL = 60 * 15;           // 15 min
const REFRESH_TTL = 60 * 60 * 24 * 7; // 7 días


function issueAccessToken(id, email) {
  return jwt.sign({ sub: id, role: 'medico', email }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}
function issueRefreshToken(id) {
  return jwt.sign({ sub: id, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TTL });
}
const cookieOpts = (maxAgeSec) => ({ httpOnly:true, sameSite:'strict', path:'/', maxAge: maxAgeSec*1000 });

function requireAuth(req,res,next){
  const t = req.cookies?.access_token;
  if(!t) return res.status(401).json({error:'No autenticado'});
  try { req.user = jwt.verify(t, JWT_SECRET); return next(); }
  catch { return res.status(401).json({error:'Token inválido'}); }
}

// Opción B (alternativa): una sola URL
// const pool = new Pool({ connectionString: process.env.PG_URL });

app.get('/ping', (_req, res) => res.json({ ok: true }));


const ENCRYPT_KEY = 'PPMBUAO'; // tu clave de encriptación

// PACIENTE: upsert por correo con encriptación
app.post('/api/pacientes/upsert', async (req, res) => {
  const { nombre, correo, edad, fecha_nacimiento, sexo } = req.body;
  if (!correo) return res.status(400).json({ error: 'correo es obligatorio' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Buscar por correo desencriptando en WHERE
    const sel = `
      SELECT id_paciente
      FROM paciente
      WHERE pgp_sym_decrypt(correo, '${ENCRYPT_KEY}') = $1
      LIMIT 1;
    `;
    const found = await client.query(sel, [correo]);

    let id_paciente;

    if (found.rows.length) {
      id_paciente = found.rows[0].id_paciente;
      const upd = `
        UPDATE paciente
        SET
          nombre           = pgp_sym_encrypt($1::text, '${ENCRYPT_KEY}'),
          edad             = pgp_sym_encrypt($2::text, '${ENCRYPT_KEY}'),
          fecha_nacimiento = pgp_sym_encrypt($3::text, '${ENCRYPT_KEY}'),
          sexo             = pgp_sym_encrypt($4::text, '${ENCRYPT_KEY}')
        WHERE id_paciente = $5
        RETURNING id_paciente;
      `;
      const valsUpd = [
        nombre || '',
        (Number.isFinite(+edad) ? String(+edad) : ''), // guarda como texto cifrado
        fecha_nacimiento || '',
        sexo || '',
        id_paciente
      ];
      const r = await client.query(upd, valsUpd);
      id_paciente = r.rows[0].id_paciente;
    } else {
      const ins = `
        INSERT INTO paciente (nombre, correo, edad, fecha_nacimiento, sexo)
        VALUES (
          pgp_sym_encrypt($1::text, '${ENCRYPT_KEY}'),
          pgp_sym_encrypt($2::text, '${ENCRYPT_KEY}'),
          pgp_sym_encrypt($3::text, '${ENCRYPT_KEY}'),
          pgp_sym_encrypt($4::text, '${ENCRYPT_KEY}'),
          pgp_sym_encrypt($5::text, '${ENCRYPT_KEY}')
        )
        RETURNING id_paciente;
      `;
      const valsIns = [
        nombre || '',
        correo,
        (Number.isFinite(+edad) ? String(+edad) : ''),
        fecha_nacimiento || '',
        sexo || ''
      ];
      const r = await client.query(ins, valsIns);
      id_paciente = r.rows[0].id_paciente;
    }

    await client.query('COMMIT');
    return res.json({ id_paciente });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('upsert paciente error:', err);
    return res.status(500).json({ error: 'Error al upsert de paciente' });
  } finally {
    client.release();
  }
});

// CONSULTA: insertar con transcripción y resumen JSON (encriptado)
app.post('/api/consultas', async (req, res) => {
  const { id_paciente, id_medico, transcripcion, resumen } = req.body;
  if (!id_paciente || !id_medico) {
    return res.status(400).json({ error: 'id_paciente e id_medico son obligatorios' });
  }

  try {
    const insert = `
      INSERT INTO consulta (id_paciente, id_medico, transcripcion, resumenjson, fecha)
      VALUES ($1, $2,
        pgp_sym_encrypt($3::text, '${ENCRYPT_KEY}'),
        pgp_sym_encrypt($4::text, '${ENCRYPT_KEY}'),
        pgp_sym_encrypt(NOW()::text, '${ENCRYPT_KEY}')
      )
      RETURNING id_consulta;
    `;
    const vals = [
      +id_paciente,
      +id_medico,
      transcripcion || '',
      JSON.stringify(resumen || {})
    ];

    const { rows } = await pool.query(insert, vals);
    return res.json({ ok: true, id_consulta: rows[0].id_consulta });
  } catch (err) {
    console.error('[ERROR] insert consulta:', err);
    return res.status(500).json({ error: 'Error al guardar la consulta' });
  }
});

// LISTAR: todas las consultas con nombre de paciente desencriptado
app.get('/api/consultas', async (_req, res) => {
  try {
    const q = `
      SELECT 
        c.id_consulta,
        pgp_sym_decrypt(c.fecha, '${ENCRYPT_KEY}') AS fecha,
        pgp_sym_decrypt(p.nombre, '${ENCRYPT_KEY}') AS paciente_nombre
      FROM consulta c
      JOIN paciente p ON p.id_paciente = c.id_paciente
      ORDER BY fecha DESC;
    `;
    const { rows } = await pool.query(q);
    return res.json(rows);
  } catch (err) {
    console.error('[ERROR] list consultas:', err);
    return res.status(500).json({ error: 'Error al listar consultas' });
  }
});

// DETALLE: una consulta con campos desencriptados
app.get('/api/consultas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const q = `
      SELECT 
        c.id_consulta,
        pgp_sym_decrypt(c.fecha, '${ENCRYPT_KEY}') AS fecha,
        pgp_sym_decrypt(c.transcripcion, '${ENCRYPT_KEY}') AS transcripcion,
        pgp_sym_decrypt(c.resumenjson, '${ENCRYPT_KEY}') AS resumenjson,
        pgp_sym_decrypt(p.nombre, '${ENCRYPT_KEY}') AS paciente_nombre,
        pgp_sym_decrypt(p.correo, '${ENCRYPT_KEY}') AS correo
      FROM consulta c
      JOIN paciente p ON p.id_paciente = c.id_paciente
      WHERE c.id_consulta = $1
      LIMIT 1;
    `;
    const { rows } = await pool.query(q, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Consulta no encontrada' });

    const r = rows[0];
    let resumenObj = {};
    try { resumenObj = JSON.parse(r.resumenjson || '{}'); } catch {}
    return res.json({
      id_consulta: r.id_consulta,
      fecha: r.fecha,
      paciente_nombre: r.paciente_nombre,
      correo: r.correo,
      transcripcion: r.transcripcion || '',
      resumen: resumenObj
    });
  } catch (err) {
    console.error('[ERROR] detail consulta:', err);
    return res.status(500).json({ error: 'Error al obtener la consulta' });
  }
});


// (Opcional) stub de /api/transcribir si ya no usas OpenAI
app.post('/api/transcribir', upload.single('audio'), async (req, res) => {
  return res.status(501).json({ error: 'No implementado. Usa Web Speech en el frontend.' });
});




// LOGIN: email + password

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Datos inválidos' });

  try {
    const q = await pool.query(
      `
      SELECT 
        id_medico AS id,
        pgp_sym_decrypt(nombre,     '${ENCRYPT_KEY}') AS nombre,
        pgp_sym_decrypt(correo,     '${ENCRYPT_KEY}') AS correo,
        pgp_sym_decrypt(contrasena, '${ENCRYPT_KEY}') AS contrasena
      FROM medico
      WHERE pgp_sym_decrypt(correo, '${ENCRYPT_KEY}') = $1
      LIMIT 1;
      `,
      [email]
    );
    const u = q.rows[0];
    if (!u) return res.status(401).json({ error: 'Credenciales inválidas' });

    // OJO: compara plano vs plano (si más adelante quieres bcrypt, te digo cómo envolver el hash dentro del cifrado)
    const ok = password === u.contrasena;
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const at = issueAccessToken(u.id, u.correo);
    const rt = issueRefreshToken(u.id);

    res
      .cookie('access_token', at, cookieOpts(ACCESS_TTL))
      .cookie('refresh_token', rt, cookieOpts(REFRESH_TTL))
      .json({ user: { id: u.id, nombre: u.nombre, email: u.correo } });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ error: 'Error en login' });
  }
});

app.post('/auth/refresh', (req, res) => {
  const rt = req.cookies?.refresh_token;
  if (!rt) return res.status(401).json({ error: 'Sin refresh' });
  try {
    const d = jwt.verify(rt, JWT_SECRET);
    if (d.type !== 'refresh') throw new Error('tipo');
    const at = issueAccessToken(d.sub, ''); // email opcional
    res.cookie('access_token', at, cookieOpts(ACCESS_TTL)).json({ ok: true });
  } catch {
    res.status(401).json({ error: 'Refresh inválido' });
  }
});

app.post('/auth/logout', (req, res) => {
  res
    .clearCookie('access_token', cookieOpts(0))
    .clearCookie('refresh_token', cookieOpts(0))
    .json({ ok: true });
});

app.get('/auth/me', (req, res) => {
  const t = req.cookies?.access_token;
  if (!t) return res.json({ user: null });
  try {
    const d = jwt.verify(t, JWT_SECRET);
    res.json({ user: { id: d.sub, role: d.role, email: d.email || null } });
  } catch {
    res.json({ user: null });
  }
});


// Ruta de prueba protegida (no toca tus endpoints existentes)
app.get('/api/check-auth', requireAuth, (_req,res)=> res.json({ok:true}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor PG en http://localhost:${PORT}`));