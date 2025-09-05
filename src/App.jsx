import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
// ===== Parseo igual al original =====
function parsearResumen(texto) {
  const secciones = {
    sintomas: /s[ií]ntomas?\s*:\s*(.*)/i,
    diagnostico: /diagn[oó]stico\s*:\s*(.*)/i,
    medicamentos: /medicamentos?\s*:\s*(.*)/i,
    indicaciones: /indicaciones?\s*:\s*(.*)/i,
    alergias: /alergias?\s*:\s*(.*)/i,
  };
  const out = { sintomas: [], diagnostico: "", medicamentos: [], indicaciones: "", alergias: "" };
  for (const [k, rx] of Object.entries(secciones)) {
    const m = texto.match(rx);
    if (m && m[1]) {
      if (k === "medicamentos" || k === "sintomas") {
        out[k] = m[1].split(/[;,•\-]/).map((s) => s.trim()).filter(Boolean);
      } else out[k] = m[1].trim();
    }
  }
  return out;
}

function formatearFecha(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

// ===== Hook Web Speech API =====
function useWebSpeech(lang = "es-MX") {
  const recRef = useRef(null);
  const [soportado, setSoportado] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [interino, setInterino] = useState("");
  const [texto, setTexto] = useState("");

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    setSoportado(true);

    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => {
      setEscuchando(true);
      setPausado(false);
    };

    rec.onresult = (e) => {
      let finalCapturado = "";
      let parcial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalCapturado += r[0].transcript + " ";
        else parcial += r[0].transcript;
      }
      if (finalCapturado) setTexto((prev) => (prev + finalCapturado).trimStart());
      setInterino(parcial);
    };

    rec.onerror = (e) => {
      console.error("[WS error]", e.error || e);
    };

    rec.onend = () => {
      setEscuchando(false);
      // Si pausado=true fue stop manual; si no, finalizó.
    };

    recRef.current = rec;
    return () => {
      try { rec.stop(); } catch {}
      recRef.current = null;
    };
  }, [lang]);

  const iniciar = () => {
    if (!soportado || escuchando) return;
    setInterino("");
    try { recRef.current?.start(); } catch (e) { console.error(e); }
  };

  const pausar = () => {
    if (!escuchando) return;
    setPausado(true);
    recRef.current?.stop();
  };

  const reanudar = () => {
    if (!soportado || escuchando) return;
    setPausado(false);
    iniciar();
  };

  const limpiar = () => {
    setTexto("");
    setInterino("");
  };

  return { soportado, escuchando, pausado, interino, texto, setTexto, iniciar, pausar, reanudar, limpiar };
}

export default function App() {
  // === Estado paciente (form) ===
  const [paciente, setPaciente] = useState({
    nombre: "",
    correo: "",
    edad: "",
    fecha_nacimiento: "",
    sexo: "",
  });
  const idMedico = Number(localStorage.getItem("id_medico") || "1");

  // === Web Speech ===
  const {
    soportado,
    escuchando,
    pausado,
    interino,
    texto,
    setTexto,
    iniciar,
    pausar,
    reanudar,
    limpiar,
  } = useWebSpeech("es-MX");

  const resumen = useMemo(() => parsearResumen(texto), [texto]);

  // === Historial ===
  const [historial, setHistorial] = useState([]);
  const [detalle, setDetalle] = useState(null); // {id_consulta, fecha, paciente_nombre, transcripcion, resumen}

  const cargarHistorial = async () => {
    try {
      const r = await fetch("/api/consultas");
      const lista = await r.json();
      setHistorial(Array.isArray(lista) ? lista : []);
      setDetalle(null);
    } catch (e) {
      console.error("Error cargando historial:", e);
      setHistorial([]);
    }
  };

  const mostrarDetalleConsulta = async (id) => {
    try {
      const r = await fetch(`/api/consultas/${id}`);
      const data = await r.json();
      if (data?.error) throw new Error(data.error);
      setDetalle(data);
    } catch (e) {
      console.error("Error detalle consulta:", e);
    }
  };

  useEffect(() => { cargarHistorial(); }, []);

  // === Guardar ===
  const guardar = async () => {
    try {
      if (!paciente.correo) {
        alert("Falta el correo del paciente");
        return;
      }
      // Upsert paciente
      const r1 = await fetch("/api/pacientes/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: paciente.nombre || "",
          correo: paciente.correo || "",
          edad: paciente.edad ? Number(paciente.edad) : null,
          fecha_nacimiento: paciente.fecha_nacimiento || null,
          sexo: paciente.sexo || null,
        }),
      });
      const p1 = await r1.json();
      if (!r1.ok || p1?.error) throw new Error(p1?.error || "Error upsert paciente");
      const id_paciente = p1.id_paciente;

      // Insert consulta
      const r2 = await fetch("/api/consultas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_paciente,
          id_medico: idMedico,
          transcripcion: texto || "",
          resumen: resumen || {},
        }),
      });
      const p2 = await r2.json();
      if (!r2.ok || p2?.error) throw new Error(p2?.error || "Error guardar consulta");

      alert(`Consulta guardada (id ${p2.id_consulta || "?"})`);
      cargarHistorial();
    } catch (err) {
      console.error(err);
      alert("Error al guardar la consulta");
    }
  };

  // === UI helpers ===
  const onChangePac = (e) => {
    const { name, value } = e.target;
    setPaciente((p) => ({ ...p, [name]: value }));
  };

  const nuevaGrabacion = () => {
    if (escuchando) pausar();
    setTexto("");
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: 16, fontFamily: "system-ui, sans-serif" }}>
      {/* Panel izquierdo */}
      <section className="left" style={{ display: "grid", gap: 12 }}>
        <header style={{ fontSize: 24, fontWeight: 700 }}>Consultas Médicas</header>

        {/* Formulario de paciente */}
        <form className="form" onSubmit={(e) => e.preventDefault()} style={{ display: "grid", gap: 8 }}>
          <input type="text" name="nombre" placeholder="Nombre del paciente" required value={paciente.nombre} onChange={onChangePac} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input type="number" name="edad" min="0" placeholder="Edad" value={paciente.edad} onChange={onChangePac} />
            <select name="sexo" value={paciente.sexo} onChange={onChangePac}>
              <option value="">Sexo</option>
              <option value="M">M</option>
              <option value="F">F</option>
              <option value="Otro">Otro</option>
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input type="email" name="correo" placeholder="correo@mail" value={paciente.correo} onChange={onChangePac} />
            <input type="date" name="fecha_nacimiento" value={paciente.fecha_nacimiento} onChange={onChangePac} />
          </div>
        </form>

        <h1 className="hero-title" style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>
          Optimiza tu tiempo, enfócate en tus pacientes.
        </h1>
        <p className="hero-sub" style={{ marginTop: -6, color: "#555" }}>
          Usa tu voz para generar resúmenes clínicos rápidamente.
        </p>

        {/* Botones */}
        <div className="btns" style={{ display: "flex", gap: 8 }}>
          {!escuchando && (
            <button id="btnStart" onClick={iniciar} disabled={!soportado} title="Iniciar">
              <span className="material-symbols-outlined">play_arrow</span>
            </button>
          )}
          {escuchando && (
            <button id="btnPause" onClick={pausar} title="Pausar">
              <span className="material-symbols-outlined">pause</span>
            </button>
          )}
          {!escuchando && pausado && (
            <button id="btnResume" onClick={reanudar} title="Reanudar">
              <span className="material-symbols-outlined">resume</span>
            </button>
          )}
          <button id="btnSave" onClick={guardar} title="Guardar">
            <span className="material-symbols-outlined">download</span>
          </button>
          <button id="btnNew" onClick={nuevaGrabacion} title="Nueva grabación">
            <span className="material-symbols-outlined">new_window</span>
          </button>
        </div>

        {/* Estado */}
        <div id="status" className="status" style={{ color: "#666" }}>
          {!soportado
            ? "Tu navegador no soporta reconocimiento de voz. Usa Chrome de escritorio."
            : escuchando
            ? "Escuchando..."
            : pausado
            ? "Pausado"
            : "Listo para nueva grabación"}
        </div>
        <p className="muted" style={{ color: "#888" }}>
          Consejo: funciona mejor en Chrome de escritorio. Permite el acceso al micrófono.
        </p>

        {/* Transcripción y Resumen */}
        <section style={{ display: "grid", gap: 10 }}>
          

          <div className="item-texto" style={{ marginTop: 8 }}><strong>Transcripción:</strong></div>
          <div
            className="transcripcion"
            style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, minHeight: 120, whiteSpace: "pre-wrap" }}
          >
            {texto}
            {interino && <span style={{ opacity: 0.5 }}> {interino}</span>}
          </div>
        </section>
      </section>

      {/* Panel derecho: Historial */}
      <section className="right" style={{ display: "grid", gap: 8 }}>
        <h2>Historial de Resúmenes</h2>

        {!detalle && (
          <div id="historial" style={{ display: "grid", gap: 8 }}>
            {historial.length === 0 && <div className="muted">No hay consultas aún.</div>}
            {historial.map((it) => (
              <button
                key={it.id_consulta}
                className="historial-item"
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  width: "100%",
                  border: "1px solid #eee",
                  borderRadius: 8,
                  padding: 10,
                  background: "#fff",
                }}
                onClick={() => mostrarDetalleConsulta(it.id_consulta)}
              >
                <div className="item-fecha" style={{ color: "#666", fontSize: 12 }}>
                  {formatearFecha(it.fecha)}
                </div>
                <div className="item-texto">
                  <strong>{it.paciente_nombre || "(Sin nombre)"}</strong>
                </div>
              </button>
            ))}
          </div>
        )}

        {detalle && (
          <div className="historial-item" style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
            <div className="item-fecha" style={{ color: "#666", fontSize: 12 }}>
              {formatearFecha(detalle.fecha)}
            </div>
            <div className="item-texto" style={{ marginBottom: 6 }}>
              <strong>{detalle.paciente_nombre || "(Sin nombre)"} </strong>
            </div>
            <div
              className="transcripcion"
              style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, whiteSpace: "pre-wrap" }}
            >
              {detalle.transcripcion || ""}
            </div>
            <div style={{ marginTop: 10 }}>
              <button id="btnVolverHist" className="btnVolver" onClick={cargarHistorial}>
                Volver al historial
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
