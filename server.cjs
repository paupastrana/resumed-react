const path = require('path');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
require('dotenv').config();

const app = express();
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Pool PG
// Opción A: con variables sueltas
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASS || 'flama',
  database: process.env.PG_DB || 'resumed',
  max: 10,
});

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

    const upsert = `
      INSERT INTO paciente (nombre, correo, edad, fecha_nacimiento, sexo)
      VALUES (
        pgp_sym_encrypt($1::text, '${ENCRYPT_KEY}'),
        pgp_sym_encrypt($2::text, '${ENCRYPT_KEY}'),
        $3,
        pgp_sym_encrypt($4::text, '${ENCRYPT_KEY}'),
        pgp_sym_encrypt($5::text, '${ENCRYPT_KEY}')
      )
      ON CONFLICT (correo)
      DO UPDATE SET
        nombre = COALESCE(EXCLUDED.nombre, paciente.nombre),
        edad = COALESCE(EXCLUDED.edad, paciente.edad),
        fecha_nacimiento = COALESCE(EXCLUDED.fecha_nacimiento, paciente.fecha_nacimiento),
        sexo = COALESCE(EXCLUDED.sexo, paciente.sexo)
      RETURNING id_paciente;
    `;
    const vals = [
      nombre || '',
      correo,
      Number.isFinite(+edad) ? +edad : null,
      fecha_nacimiento || '',
      sexo || ''
    ];

    const { rows } = await client.query(upsert, vals);
    await client.query('COMMIT');
    return res.json({ id_paciente: rows[0].id_paciente });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor PG en http://localhost:${PORT}`));