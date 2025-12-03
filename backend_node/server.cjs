const path = require('path');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const fetch = require("node-fetch");
require('dotenv').config();
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');

// Configuración FFMPEG
ffmpeg.setFfmpegPath(ffmpegPath);

// URL de la API de Python (Lee la variable de Docker o usa localhost por defecto)
const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://127.0.0.1:8000";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

app.set('trust proxy', 1); 

// Configuración de Whisper
let asrPipeline = null;

const fs = require('fs');
const distPath = path.join(__dirname, 'dist');
const publicPath = path.join(__dirname, 'public');

// Servir estáticos
if (fs.existsSync(distPath)) {
  console.log('Sirviendo assets desde dist/ (producción)');
  app.use(express.static(distPath));
} else if (fs.existsSync(publicPath)) {
  console.log('Sirviendo assets desde public/ (desarrollo o fallback)');
  app.use(express.static(publicPath));
}

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Pool Postgres
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'flama',
  password: process.env.PG_PASS || 'F1ama28.1',
  database: process.env.PG_DB || 'resumed',
  max: 10,
});

// Tokens y Seguridad
const JWT_SECRET = process.env.JWT_SECRET || 'supersecreto';
const ACCESS_TTL  = 60 * 60 * 2; // 2 horas
const REFRESH_TTL = 60 * 60 * 2; 
const ENCRYPT_KEY = 'PPMBUAO'; // Clave de encriptación DB

function cookieOpts(maxAgeSec) {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd ? true : false,
    path: '/',
    maxAge: maxAgeSec * 1000
  };
}

function requireAuth(req,res,next){
  const t = req.cookies?.access_token;
  if(!t) return res.status(401).json({error:'No autenticado'});
  try { req.user = jwt.verify(t, JWT_SECRET); return next(); }
  catch { return res.status(401).json({error:'Token inválido'}); }
}

// Inicializar Whisper
async function getASR() {
  if (!globalThis.__ASR_PIPELINE__) {
    const { pipeline } = await import('@xenova/transformers');
    const modelId = process.env.WHISPER_MODEL_ID || 'Xenova/whisper-small';
    globalThis.__ASR_PIPELINE__ = await pipeline('automatic-speech-recognition', modelId);
    console.log('[ASR] Pipeline listo con', modelId);
  }
  return globalThis.__ASR_PIPELINE__;
}

// Utilidades de Audio
function convertirAWav16kMono(entradaPath, extraGainDb = 6) {
  return new Promise((resolve, reject) => {
    const outPath = entradaPath.replace(/\.[a-z0-9]+$/i, '') + '.wav';
    let stderr = '';
    const filtros = [
      'highpass=f=120',
      'afftdn=nf=-25',
      'dynaudnorm',
      `volume=${extraGainDb}dB`
    ];

    ffmpeg(entradaPath)
      .audioFilters(filtros)
      .audioFrequency(16000)
      .audioChannels(1)
      .format('wav')
      .on('stderr', d => { stderr += d; })
      .on('end', () => {
        resolve(outPath);
      })
      .on('error', err => {
        console.error('[ffmpeg][error]', err);
        reject(err);
      })
      .save(outPath);
  });
}

function wav16MonoToFloat32Array(buf) {
  const headerSize = 44;
  if (buf.length <= headerSize) return new Float32Array(0);
  const pcm = buf.subarray(headerSize);
  const samples = pcm.length / 2;
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const lo = pcm[i*2];
    const hi = pcm[i*2+1];
    const s = (hi << 8) | (lo & 0xff);
    const val = (s < 0x8000 ? s : s - 0x10000); 
    out[i] = val / 32768;
  }
  return out;
}

function rms(x) {
  if (!x || x.length === 0) return 0;
  let acc = 0;
  for (let i = 0; i < x.length; i++) acc += x[i]*x[i];
  return Math.sqrt(acc / x.length);
}

// --- FUNCIÓN PARA COMUNICARSE CON PYTHON ---
async function procesarConAPI(texto) {
  console.log(`[Node] Enviando a Python: ${PYTHON_API_URL}/procesar`);
  try {
    const r = await fetch(`${PYTHON_API_URL}/procesar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto })
    });
    if (!r.ok) throw new Error(`Status ${r.status}`);
    return await r.json();
  } catch (error) {
    console.error("Error conectando con Python:", error);
    return { entidades: [] }; // Retorno seguro si falla Python
  }
}

// Ruta Principal: Transcripción Local + Envío a Python
app.post('/api/transcribir-local', upload.single('audio'), async (req, res) => {
  try {
    console.log('[ASR] /api/transcribir-local hit. file?', !!req.file, 'size', req.file?.size);
    if (!req.file) return res.status(400).json({ error: 'No llegó archivo "audio".' });

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const webmPath = path.join(tmpDir, `rec_${Date.now()}.webm`);
    fs.writeFileSync(webmPath, req.file.buffer);

    let wavPath = await convertirAWav16kMono(webmPath, 8);
    const wavBuf = fs.readFileSync(wavPath);
    const audioFloat = wav16MonoToFloat32Array(wavBuf);
    const nivel = rms(audioFloat);

    if (audioFloat.length < 16000) {
      return res.json({ text: '', warning: 'Audio muy corto.' });
    }
    if (nivel < 0.01) {
      console.log('[ASR] RMS bajo, reintento con +12 dB…');
      wavPath = await convertirAWav16kMono(webmPath, 12);
    }

    const wavBuf2 = fs.readFileSync(wavPath);
    const audioFloat2 = wav16MonoToFloat32Array(wavBuf2);

    const asr = await getASR();
    const result = await asr(audioFloat2, {
      chunk_length_s: 30,
      stride_length_s: 5,
      language: 'es',
      task: 'transcribe',
      return_timestamps: false,
      temperature: 0,
      do_sample: false,
    });

    let texto = (result?.text || '').trim();
    console.log('[ASR] texto:', texto);

    // Reintento final si vacío
    if (!texto) {
      console.log('[ASR] vacío, último intento +15 dB…');
      const wavPath3 = await convertirAWav16kMono(webmPath, 15);
      const wavBuf3 = fs.readFileSync(wavPath3);
      const audioFloat3 = wav16MonoToFloat32Array(wavBuf3);
      const result2 = await asr(audioFloat3, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: 'es',
        task: 'transcribe',
        return_timestamps: false,
        temperature: 0,
        do_sample: false,
      });
      texto = (result2?.text || '').trim();
    }

    // Llamada a Python para entidades
    let entidades = { entidades: [] };
    if (texto) {
        entidades = await procesarConAPI(texto);
    }
    console.log("[NLP] entidades detectadas:", entidades);

    return res.json({
      transcripcion: texto,
      entidades: entidades.entidades || []
    });

  } catch (err) {
    console.error('[ASR][error]', err);
    return res.status(500).json({ error: 'Fallo al transcribir audio.' });
  }
});

// PACIENTE: Upsert (CORREGIDO CON ::bytea)
app.post('/api/pacientes/upsert', async (req, res) => {
  const { nombre, correo, edad, fecha_nacimiento, sexo } = req.body;
  if (!correo) return res.status(400).json({ error: 'correo es obligatorio' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Buscamos usando ::bytea en el WHERE
    const sel = `
      SELECT id_paciente
      FROM paciente
      WHERE pgp_sym_decrypt(correo::bytea, '${ENCRYPT_KEY}') = $1
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
        (Number.isFinite(+edad) ? String(+edad) : ''),
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

// CONSULTA: Insertar (CORREGIDO)
app.post('/api/consultas', requireAuth, async (req, res) => {
  const { id_paciente, transcripcion, resumen } = req.body;
  const id_medico = req.user.sub;
  
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

// LISTAR: Consultas (CORREGIDO CON ::bytea)
app.get('/api/consultas', requireAuth, async (_req, res) => {
  const id_medico = _req.user.sub;
  try {
    // Agregado ::bytea en fecha y nombre
    const q = `
      SELECT 
        c.id_consulta,
        pgp_sym_decrypt(c.fecha::bytea, '${ENCRYPT_KEY}') AS fecha,
        pgp_sym_decrypt(p.nombre::bytea, '${ENCRYPT_KEY}') AS paciente_nombre
      FROM consulta c
      JOIN paciente p ON p.id_paciente = c.id_paciente
      WHERE c.id_medico = $1
      ORDER BY id_consulta DESC;
    `;
    const { rows } = await pool.query(q, [id_medico]);
    return res.json(rows);
  } catch (err) {
    console.error('[ERROR] list consultas:', err);
    return res.status(500).json({ error: 'Error al listar consultas' });
  }
});

// DETALLE: Consulta (CORREGIDO CON ::bytea)
app.get('/api/consultas/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    // Agregado ::bytea en todos los campos a desencriptar
    const q = `
      SELECT 
        c.id_consulta,
        pgp_sym_decrypt(c.fecha::bytea, '${ENCRYPT_KEY}') AS fecha,
        pgp_sym_decrypt(c.transcripcion::bytea, '${ENCRYPT_KEY}') AS transcripcion,
        pgp_sym_decrypt(c.resumenjson::bytea, '${ENCRYPT_KEY}') AS resumenjson,
        pgp_sym_decrypt(p.nombre::bytea, '${ENCRYPT_KEY}') AS paciente_nombre,
        pgp_sym_decrypt(p.correo::bytea, '${ENCRYPT_KEY}') AS correo
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

app.post('/api/transcribir', upload.single('audio'), async (req, res) => {
  return res.status(501).json({ error: 'Usa la ruta /api/transcribir-local' });
});

// ======== LOGIN / REFRESH / LOGOUT ========
function issueAccessToken(id, email) {
  return jwt.sign({ sub: id, role: 'medico', email }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}
function issueRefreshToken(id) {
  return jwt.sign({ sub: id, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TTL });
}

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Datos inválidos' });

  try {
    // Login Corregido con ::bytea
    const q = await pool.query(
      `
      SELECT 
        id_medico AS id,
        pgp_sym_decrypt(nombre::bytea,     '${ENCRYPT_KEY}') AS nombre,
        pgp_sym_decrypt(correo::bytea,     '${ENCRYPT_KEY}') AS correo,
        pgp_sym_decrypt(contrasena::bytea, '${ENCRYPT_KEY}') AS contrasena
      FROM medico
      WHERE pgp_sym_decrypt(correo::bytea, '${ENCRYPT_KEY}') = $1
      LIMIT 1;
      `,
      [email]
    );
    const u = q.rows[0];
    if (!u) return res.status(401).json({ error: 'Credenciales inválidas' });

    const ok = password === u.contrasena;
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const at = issueAccessToken(u.id, u.correo);
    const rt = issueRefreshToken(u.id);

    res
      .clearCookie('access_token', cookieOpts(0))
      .clearCookie('refresh_token', cookieOpts(0))
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
    const at = issueAccessToken(d.sub, ''); 
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
    return res.json({ user: { id: d.sub, role: d.role, email: d.email || null } });
  } catch {
    return res.json({ user: null });
  }
});

app.get('/api/check-auth', requireAuth, (_req,res)=> res.json({ok:true}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor PG en http://localhost:${PORT}`));