
// import React, { useEffect, useMemo, useRef, useState } from "react";
// import "./App.css";
// import Login from "./login";

// // DEBUG: confirmar que este archivo se está cargando por el bundler
// console.log("[DEBUG] App.jsx fue importado");

// /* ============================
//    Utilidades de tu app (igual)
//    ============================ */
// function parsearResumen(texto) {
//   const secciones = {
//     sintomas: /s[ií]ntomas?\s*:\s*(.*)/i,
//     diagnostico: /diagn[oó]stico\s*:\s*(.*)/i,
//     medicamentos: /medicamentos?\s*:\s*(.*)/i,
//     indicaciones: /indicaciones?\s*:\s*(.*)/i,
//     alergias: /alergias?\s*:\s*(.*)/i,
//   };
//   const out = { sintomas: [], diagnostico: "", medicamentos: [], indicaciones: "", alergias: "" };
//   for (const [k, rx] of Object.entries(secciones)) {
//     const m = texto.match(rx);
//     if (m && m[1]) {
//       if (k === "medicamentos" || k === "sintomas") {
//         out[k] = m[1].split(/[;,•\-]/).map((s) => s.trim()).filter(Boolean);
//       } else out[k] = m[1].trim();
//     }
//   }
//   return out;
// }

// function formatearFecha(iso) {
//   try {
//     const d = new Date(iso);
//     return d.toLocaleString();
//   } catch {
//     return iso;
//   }
// }

// /* ============================
//    Hook Web Speech API (igual)
//    ============================ */
// function useWebSpeech(lang = "es-MX") {
//   const recRef = useRef(null);
//   const [soportado, setSoportado] = useState(false);
//   const [escuchando, setEscuchando] = useState(false);
//   const [pausado, setPausado] = useState(false);
//   const [interino, setInterino] = useState("");
//   const [texto, setTexto] = useState("");

//   useEffect(() => {
//     const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
//     if (!SR) return;
//     setSoportado(true);

//     const rec = new SR();
//     rec.lang = lang;
//     rec.continuous = true;
//     rec.interimResults = true;

//     rec.onstart = () => {
//       setEscuchando(true);
//       setPausado(false);
//     };

//     rec.onresult = (e) => {
//       let finalCapturado = "";
//       let parcial = "";
//       for (let i = e.resultIndex; i < e.results.length; i++) {
//         const r = e.results[i];
//         if (r.isFinal) finalCapturado += r[0].transcript + " ";
//         else parcial += r[0].transcript;
//       }
//       if (finalCapturado) setTexto((prev) => (prev + finalCapturado).trimStart());
//       setInterino(parcial);
//     };

//     rec.onerror = (e) => {
//       console.error("[WS error]", e.error || e);
//     };

//     rec.onend = () => {
//       setEscuchando(false);
//     };

//     recRef.current = rec;
//     return () => {
//       try { rec.stop(); } catch {}
//       recRef.current = null;
//     };
//   }, [lang]);

//   const iniciar = () => {
//     if (!soportado || escuchando) return;
//     setInterino("");
//     try { recRef.current?.start(); } catch (e) { console.error(e); }
//   };

//   const pausar = () => {
//     if (!escuchando) return;
//     setPausado(true);
//     recRef.current?.stop();
//   };

//   const reanudar = () => {
//     if (!soportado || escuchando) return;
//     setPausado(false);
//     iniciar();
//   };

//   const limpiar = () => {
//     setTexto("");
//     setInterino("");
//   };

//   return { soportado, escuchando, pausado, interino, texto, setTexto, iniciar, pausar, reanudar, limpiar };
// }

// /* ==============================
//      COMPONENTE PRINCIPAL APP
//    ============================== */
// export default function App() {
//   // DEBUG: monta componente y fuerza título
//   useEffect(() => {
//     console.log("[DEBUG] App.jsx montado");
//     document.title = "ResuMed (DEBUG)";
//   }, []);

//   /* ======== Auth (login con cookies) ======== */
//   const [user, setUser] = useState(null);
//   const [loadingUser, setLoadingUser] = useState(true);

//   useEffect(() => {
//     fetch("/auth/me", { credentials: "include" })
//       .then((r) => r.json())
//       .then((d) => setUser(d.user || null))
//       .catch(() => setUser(null))
//       .finally(() => setLoadingUser(false));
//   }, []);

//   /* ======== Estado paciente (form) ======== */
//   const [paciente, setPaciente] = useState({
//     nombre: "",
//     correo: "",
//     edad: "",
//     fecha_nacimiento: "",
//     sexo: "",
//   });

//   /* ======== Web Speech (igual) ======== */
//   const {
//     soportado,
//     escuchando,
//     pausado,
//     interino,
//     texto,
//     setTexto,
//     iniciar,
//     pausar,
//     reanudar,
//     limpiar,
//   } = useWebSpeech("es-MX");
//   const resumen = useMemo(() => parsearResumen(texto), [texto]);

//   /* ==========================================================
//      WHISPER LOCAL (GRATIS) —————————— INICIO BLOQUE WHISPER —
//      ========================================================== */
//   const mediaRef = useRef(null);
//   const [grabando, setGrabando] = useState(false);

//   async function startGrabacionLocal() {
//     try {
//       if (!navigator.mediaDevices?.getUserMedia) {
//         alert("Tu navegador no soporta getUserMedia.");
//         return;
//       }
//       if (typeof MediaRecorder === "undefined") {
//         alert("MediaRecorder no está disponible en este navegador.");
//         return;
//       }
//       const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
//       const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
//       const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

//       mediaRef.current = { mr, chunks: [] };

//       mr.ondataavailable = (e) => {
//         if (e.data.size > 0) mediaRef.current.chunks.push(e.data);
//       };

//       mr.onstop = async () => {
//         try {
//           const blob = new Blob(mediaRef.current.chunks, { type: mime || "audio/webm" });
//           const fd = new FormData();
//           fd.append("audio", blob, "grab.webm");

//           const r = await fetch("/api/transcribir-local", {
//             method: "POST",
//             body: fd,
//             credentials: "include",
//           });
//           const data = await r.json();
//           if (!r.ok) {
//             alert(data?.error || "Error de transcripción local");
//             return;
//           }
//           setTexto((prev) => (prev ? prev + "\n" : "") + (data.text || ""));
//         } catch (err) {
//           console.error(err);
//           alert("Error procesando el audio.");
//         }
//       };

//       mr.start(250); // chunks cada 250ms
//       setGrabando(true);
//     } catch (e) {
//       console.error(e);
//       alert("No se pudo acceder al micrófono.");
//     }
//   }

//   function stopGrabacionLocal() {
//     const ref = mediaRef.current;
//     if (ref?.mr && ref.mr.state !== "inactive") {
//       ref.mr.stop();
//       ref.mr.stream.getTracks().forEach((t) => t.stop());
//     }
//     setGrabando(false);
//   }
//   /* ==========================================================
//      WHISPER LOCAL (GRATIS) ——————————— FIN BLOQUE WHISPER ——
//      ========================================================== */

//   /* ======== Historial ======== */
//   const [historial, setHistorial] = useState([]);
//   const [detalle, setDetalle] = useState(null);

//   const cargarHistorial = async () => {
//     try {
//       const r = await fetch("/api/consultas", { credentials: "include" });
//       const lista = await r.json();
//       setHistorial(Array.isArray(lista) ? lista : []);
//       setDetalle(null);
//     } catch (e) {
//       console.error("Error cargando historial:", e);
//       setHistorial([]);
//     }
//   };

//   const mostrarDetalleConsulta = async (id) => {
//     try {
//       const r = await fetch(`/api/consultas/${id}`, { credentials: "include" });
//       const data = await r.json();
//       if (data?.error) throw new Error(data.error);
//       setDetalle(data);
//     } catch (e) {
//       console.error("Error detalle consulta:", e);
//     }
//   };

//   useEffect(() => {
//     if (user) {
//       cargarHistorial();
//     } else {
//       setHistorial([]);
//     }
//   }, [user]);

//   /* ======== Guardar ======== */
//   const guardar = async () => {
//     try {
//       if (!paciente.correo) {
//         alert("Falta el correo del paciente");
//         return;
//       }
//       const r1 = await fetch("/api/pacientes/upsert", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         credentials: "include",
//         body: JSON.stringify({
//           nombre: paciente.nombre || "",
//           correo: paciente.correo || "",
//           edad: paciente.edad ? Number(paciente.edad) : null,
//           fecha_nacimiento: paciente.fecha_nacimiento || null,
//           sexo: paciente.sexo || null,
//         }),
//       });
//       const p1 = await r1.json();
//       if (!r1.ok || p1?.error) throw new Error(p1?.error || "Error upsert paciente");
//       const id_paciente = p1.id_paciente;

//       const r2 = await fetch("/api/consultas", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         credentials: "include",
//         body: JSON.stringify({
//           id_paciente,
//           transcripcion: texto || "",
//           resumen: resumen || {},
//         }),
//       });
//       const p2 = await r2.json();
//       if (!r2.ok || p2?.error) throw new Error(p2?.error || "Error guardar consulta");

//       alert(`Consulta guardada (id ${p2.id_consulta || "?"})`);
//       cargarHistorial();
//     } catch (err) {
//       console.error(err);
//       alert("Error al guardar la consulta");
//     }
//   };

//   /* ======== UI helpers ======== */
//   const onChangePac = (e) => {
//     const { name, value } = e.target;
//     setPaciente((p) => ({ ...p, [name]: value }));
//   };

//   const nuevaGrabacion = () => {
//     if (escuchando) pausar();
//     setTexto("");
//   };

//   /* ======== Gate de login ======== */
//   if (loadingUser) {
//     return (
//       <div style={{ padding: 20 }}>
//         <strong>[DEBUG]</strong> Cargando usuario...
//       </div>
//     );
//   }

//   if (!user) {
//     return (
//       <>
//         {/* Overlay de debug: estás en login */}
//         <div style={{
//           position: 'fixed', top: 0, left: 0, right: 0,
//           background: '#111', color: '#0f0', padding: '6px 10px',
//           fontFamily: 'monospace', fontSize: 12, zIndex: 99999
//         }}>
         
//         </div>
//         <Login onLogin={setUser} />
//       </>
//     );
//   }

//   /* ======== Render principal ======== */
//   return (
//     <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: 16, fontFamily: "system-ui, sans-serif" }}>
//       {/* Overlay de debug cuando SÍ hay user */}
//       <div style={{
//         position: 'fixed', top: 0, left: 0, right: 0,
//         background: '#111', color: '#0ff', padding: '6px 10px',
//         fontFamily: 'monospace', fontSize: 12, zIndex: 99999
//       }}>
        
//       </div>

//       {/* Panel izquierdo */}
//       <section className="left" style={{ display: "grid", gap: 12 }}>
       
//         <div className="header">
//           <header style={{ fontSize: 24, fontWeight: 700 }}>Consultas Médicas</header>
//           <button
//             onClick={async () => {
//               await fetch("/auth/logout", { method: "POST", credentials: "include" });
//               setUser(null);
//             }}
//           >
//             Cerrar sesión
//           </button>

//         </div>

        

//         {/* Formulario de paciente */}
//         <form className="form" onSubmit={(e) => e.preventDefault()} style={{ display: "grid", gap: 8 }}>
//           <input type="text" name="nombre" placeholder="Nombre del paciente" required value={paciente.nombre} onChange={onChangePac} />

//           <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
//             <input type="number" name="edad" min="0" placeholder="Edad" value={paciente.edad} onChange={onChangePac} />
//             <select name="sexo" value={paciente.sexo} onChange={onChangePac}>
//               <option value="">Sexo</option>
//               <option value="M">M</option>
//               <option value="F">F</option>
//               <option value="Otro">Otro</option>
//             </select>
//           </div>

//           <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
//             <input type="email" name="correo" placeholder="correo@mail" value={paciente.correo} onChange={onChangePac} />
//             <input type="date" name="fecha_nacimiento" value={paciente.fecha_nacimiento} onChange={onChangePac} />
//           </div>
//         </form>

//         <h1 className="hero-title" style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>
//           Optimiza tu tiempo, enfócate en tus pacientes.
//         </h1>
//         <p className="hero-sub" style={{ marginTop: -6, color: "#555" }}>
//           Usa tu voz para generar resúmenes clínicos rápidamente.
//         </p>

//         {/* Botones (incluye WHISPER local) */}
//         <div className="btns" style={{ display: "flex", gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
//           {/* ——— WHISPER local ——— */}
//           {!grabando ? (
//             <button id="btnWhisperStart" onClick={startGrabacionLocal} title="Grabar (Whisper local)">
//               Grabar (Whisper local)
//             </button>
//           ) : (
//             <button id="btnWhisperStop" onClick={stopGrabacionLocal} title="Detener y transcribir">
//               Detener y transcribir
//             </button>
//           )}

//           {/* ——— Web Speech (tus botones originales) ——— */}
//           {!escuchando && (
//             <button id="btnStart" onClick={iniciar} disabled={!soportado} title="Iniciar">
//               <span className="material-symbols-outlined">play_arrow</span>
//             </button>
//           )}
//           {escuchando && (
//             <button id="btnPause" onClick={pausar} title="Pausar">
//               <span className="material-symbols-outlined">pause</span>
//             </button>
//           )}
//           {!escuchando && pausado && (
//             <button id="btnResume" onClick={reanudar} title="Reanudar">
//               <span className="material-symbols-outlined">resume</span>
//             </button>
//           )}
//           <button id="btnSave" onClick={guardar} title="Guardar">
//             <span className="material-symbols-outlined">download</span>
//           </button>
//           <button id="btnNew" onClick={nuevaGrabacion} title="Nueva grabación">
//             <span className="material-symbols-outlined">new_window</span>
//           </button>
//         </div>

//         {/* Estado rápido de Whisper */}
//         <div style={{ fontSize: 12, color: "#0f5ec7" }}>
//           Whisper: {grabando ? "Grabando…" : "Listo"}
//         </div>

//         {/* Estado Web Speech */}
//         <div id="status" className="status" style={{ color: "#666" }}>
//           {!soportado
//             ? "Tu navegador no soporta reconocimiento de voz. Usa Chrome de escritorio."
//             : escuchando
//             ? "Escuchando..."
//             : pausado
//             ? "Pausado"
//             : "Listo para nueva grabación"}
//         </div>
//         <p className="muted" style={{ color: "#888" }}>
//           Consejo: funciona mejor en Chrome de escritorio. Permite el acceso al micrófono.
//         </p>

//         {/* Transcripción y Resumen */}
//         <section style={{ display: "grid", gap: 10 }}>
//           <div className="item-texto" style={{ marginTop: 8 }}>
//             <strong>Transcripción:</strong>
//           </div>
//           <div
//             className="transcripcion"
//             style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, minHeight: 120, whiteSpace: "pre-wrap" }}
//           >
//             {texto}
//             {interino && <span style={{ opacity: 0.5 }}> {interino}</span>}
//           </div>
//         </section>
//       </section>

//       {/* Panel derecho: Historial */}
//       <section className="right" style={{ display: "grid", gap: 8 }}>
//         <h2>Historial de Resúmenes</h2>

//         {!detalle && (
//           <div id="historial" style={{ display: "grid", gap: 8 }}>
//             {historial.length === 0 && <div className="muted">No hay consultas aún.</div>}
//             {historial.map((it) => (
//               <button
//                 key={it.id_consulta}
//                 className="historial-item"
//                 style={{
//                   textAlign: "left",
//                   cursor: "pointer",
//                   width: "100%",
//                   border: "1px solid #eee",
//                   borderRadius: 8,
//                   padding: 10,
//                   background: "#fff",
//                 }}
//                 onClick={() => mostrarDetalleConsulta(it.id_consulta)}
//               >
//                 <div className="item-fecha" style={{ color: "#666", fontSize: 12 }}>
//                   {formatearFecha(it.fecha)}
//                 </div>
//                 <div className="item-texto">
//                   <strong>{it.paciente_nombre || "(Sin nombre)"}</strong>
//                 </div>
//               </button>
//             ))}
//           </div>
//         )}

//         {detalle && (
//           <div className="historial-item" style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
//             <div className="item-fecha" style={{ color: "#666", fontSize: 12 }}>
//               {formatearFecha(detalle.fecha)}
//             </div>
//             <div className="item-texto" style={{ marginBottom: 6 }}>
//               <strong>{detalle.paciente_nombre || "(Sin nombre)"} </strong>
//             </div>
//             <div
//               className="transcripcion"
//               style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, whiteSpace: "pre-wrap" }}
//             >
//               {detalle.transcripcion || ""}
//             </div>
//             <div style={{ marginTop: 10 }}>
//               <button id="btnVolverHist" className="btnVolver" onClick={cargarHistorial}>
//                 Volver al historial
//               </button>
//             </div>
//           </div>
//         )}
//       </section>
//     </div>
//   );
// }

import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import Login from "./login";

/* ============================
   Utilidades (sin cambios)
   ============================ */
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

/* ============================
   Hook Web Speech (sin cambios)
   ============================ */
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

/* ==============================
     COMPONENTE PRINCIPAL APP
   ============================== */
export default function App() {
  /* ======== Auth (login con cookies) ======== */
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);

  useEffect(() => {
    fetch("/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setUser(d.user || null))
      .catch(() => setUser(null))
      .finally(() => setLoadingUser(false));
  }, []);

  // Helpers de detección (para ver si es whisper o googleapi)
    const [isChromeUA, setIsChromeUA] = useState(false);
    const [whisperSoportado, setWhisperSoportado] = useState(false);

    useEffect(() => {
      // Detección simple de Chrome/Chromium/Edge con SpeechRecognition disponible
      const ua = navigator.userAgent || "";
      const isChromish = /Chrome\/|Chromium\/|Edg\//.test(ua);
      const hasSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      setIsChromeUA(isChromish && hasSpeech);

      // Soporte para Whisper (grabación local)
      const hasMedia = !!(navigator.mediaDevices?.getUserMedia);
      const hasMR = typeof MediaRecorder !== "undefined";
      setWhisperSoportado(hasMedia && hasMR);
    }, []);


  /* ======== Estado paciente (form) ======== */
  const [paciente, setPaciente] = useState({
    nombre: "",
    correo: "",
    edad: "",
    fecha_nacimiento: "",
    sexo: "",
  });

  /* ======== Web Speech ======== */
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
  } = useWebSpeech("es-MX");
  const resumen = useMemo(() => parsearResumen(texto), [texto]);

  /* ==========================================================
     WHISPER LOCAL (GRATIS)
     ========================================================== */
  const mediaRef = useRef(null);
  const [grabando, setGrabando] = useState(false);

  async function startGrabacionLocal() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert("Tu navegador no soporta getUserMedia.");
        return;
      }
      if (typeof MediaRecorder === "undefined") {
        alert("MediaRecorder no está disponible en este navegador.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

      mediaRef.current = { mr, chunks: [] };

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) mediaRef.current.chunks.push(e.data);
      };

      mr.onstop = async () => {
        try {
          const blob = new Blob(mediaRef.current.chunks, { type: mime || "audio/webm" });
          const fd = new FormData();
          fd.append("audio", blob, "grab.webm");

          const r = await fetch("/api/transcribir-local", {
            method: "POST",
            body: fd,
            credentials: "include",
          });
          const data = await r.json();
          if (!r.ok) {
            alert(data?.error || "Error de transcripción local");
            return;
          }
          setTexto((prev) => (prev ? prev + "\n" : "") + (data.text || ""));
        } catch (err) {
          console.error(err);
          alert("Error procesando el audio.");
        }
      };

      mr.start(250);
      setGrabando(true);
    } catch (e) {
      console.error(e);
      alert("No se pudo acceder al micrófono.");
    }
  }

  function stopGrabacionLocal() {
    const ref = mediaRef.current;
    if (ref?.mr && ref.mr.state !== "inactive") {
      ref.mr.stop();
      ref.mr.stream.getTracks().forEach((t) => t.stop());
    }
    setGrabando(false);
  }

  /* ======== Historial ======== */
  const [historial, setHistorial] = useState([]);
  const [detalle, setDetalle] = useState(null);

  const cargarHistorial = async () => {
    try {
      const r = await fetch("/api/consultas", { credentials: "include" });
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
      const r = await fetch(`/api/consultas/${id}`, { credentials: "include" });
      const data = await r.json();
      if (data?.error) throw new Error(data.error);
      setDetalle(data);
    } catch (e) {
      console.error("Error detalle consulta:", e);
    }
  };

  useEffect(() => {
    if (user) {
      cargarHistorial();
    } else {
      setHistorial([]);
    }
  }, [user]);

  /* ======== Guardar ======== */
  const guardar = async () => {
    try {
      if (!paciente.correo) {
        alert("Falta el correo del paciente");
        return;
      }
      const r1 = await fetch("/api/pacientes/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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

      const r2 = await fetch("/api/consultas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id_paciente,
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

  /* ======== UI helpers ======== */
  const onChangePac = (e) => {
    const { name, value } = e.target;
    setPaciente((p) => ({ ...p, [name]: value }));
  };

  const nuevaGrabacion = () => {
    if (escuchando) pausar();
    // No limpiamos aquí por si quieres conservar texto previo
  };

  /* ======== Gates ======== */
  if (loadingUser) {
    return (
      <div className="app app-loading">
        <div className="loading-text">Cargando usuario…</div>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  /* ======== Render principal (solo className) ======== */
  
  return (
    <>
      {/* Barra superior fija */}
      <header className="topbar">
        <div className="topbar__brand">ResuMed</div>
        <button
          className="btn btn-light"
          onClick={async () => {
            await fetch("/auth/logout", { method: "POST", credentials: "include" });
            setUser(null);
          }}
        >
           <span className="material-symbols-outlined">logout</span>
        </button>
      </header>

      {/* Contenedor centrado con 2 columnas */}
      <main className=" layout two-col">
        {/* Panel izquierdo */}
        <section className="left card">
          <div className="panel-header">
            <h1 className="title">Consultas Médicas</h1>
            <p className="muted">Si es un paciente nuevo esccirbir todos los datos si no escribir unicamente el correo</p>
          </div>

          {/* Formulario */}
          <form className="form" onSubmit={(e) => e.preventDefault()}>
            <input className="input" type="text" name="nombre" placeholder="Nombre del paciente" required value={paciente.nombre} onChange={onChangePac} />
            <div className="field-row">
              <input className="input" type="number" name="edad" min="0" placeholder="Edad" value={paciente.edad} onChange={onChangePac} />
              <select className="input" name="sexo" value={paciente.sexo} onChange={onChangePac}>
                <option value="">Sexo</option><option value="M">M</option><option value="F">F</option><option value="Otro">Otro</option>
              </select>
            </div>
            <div className="field-row">
              <input className="input" type="email" name="correo" placeholder="correo@mail" value={paciente.correo} onChange={onChangePac} />
              <input className="input" type="date" name="fecha_nacimiento" value={paciente.fecha_nacimiento} onChange={onChangePac} />
            </div>
          </form>

  
          {/* Controles divididos */}
          <div className="capture-sections">

            {/* Bloque 1: Chrome (Web Speech API) */}
            <div className="capture-block">
              <div className="capture-block__head">
                <h3>Chrome (Web Speech API)</h3>

                {/*funciona para ver si la api fue detectada o si es que la soporta <small className={`badge ${soportado ? "ok" : "warn"}`}>
                  {soportado ? (isChromeUA ? "Detectado" : "Disponible") : "No disponible"}
                </small> */}
              </div>

              <div className="btns">
                {!escuchando && (
                  <button
                    id="btnStart"
                    className="btn"
                    onClick={iniciar}
                    disabled={!soportado}
                    title="Iniciar Web Speech"
                  >
                    <span className="material-symbols-outlined">play_arrow</span>
                  </button>
                )}

                {escuchando && (
                  <button
                    id="btnPause"
                    className="btn"
                    onClick={pausar}
                    title="Pausar Web Speech"
                  >
                    <span className="material-symbols-outlined">pause</span>

                  </button>
                )}

                {!escuchando && pausado && (
                  <button
                    id="btnResume"
                    className="btn"
                    onClick={reanudar}
                    disabled={!soportado}
                    title="Reanudar Web Speech"
                  >
                    <span className="material-symbols-outlined">resume</span>
                  </button>
                )}
              </div>

              <div className="status">
                {!soportado
                  ? "Tu navegador no soporta Web Speech. Usa Chrome/Chromium."
                  : escuchando
                  ? "Escuchando…"
                  : pausado
                  ? "Pausado"
                  : "Listo para iniciar"}
              </div>
            </div>

            {/* Bloque 2: Otros navegadores (Whisper) */}
            <div className="capture-block">
              <div className="capture-block__head">
                <h3>Otros navegadores (Whisper)</h3>
                {/*  muestra si whisper esta habilitado <small className={`badge ${whisperSoportado ? "ok" : "warn"}`}>
                  {whisperSoportado ? "Listo" : "Sin soporte"}
                </small> */}
              </div>
              <div className="btns">
                {!grabando ? (
                  <button
                    id="btnWhisperStart"
                    className="btn"
                    onClick={startGrabacionLocal}
                    disabled={!whisperSoportado}
                    title="Grabar (Whisper local)"
                  >
                    <span className="material-symbols-outlined">play_arrow</span>
                  </button>
                ) : (
                  <button
                    id="btnWhisperStop"
                    className="btn btn-danger"
                    onClick={stopGrabacionLocal}
                    title="Detener y transcribir"
                  >
                    Detener y transcribir
                  </button>
                )}
              </div>

              <div className="status-whisper">
                Whisper: {grabando ? "Grabando…" : "Listo"}
              </div>
              {!whisperSoportado && (
                <p className="muted">Tu navegador no soporta MediaRecorder o getUserMedia.</p>
              )}
            </div>
          </div>

          {/* Acciones comunes */}
          <div className="btns mt-8">
            <button id="btnSave" className="btn btn-primary" onClick={guardar} title="Guardar">
              <span className="material-symbols-outlined">download</span>
            </button>
            <button id="btnNew" className="btn btn-secondary" onClick={() => setTexto("")} title="Nueva grabación">
              <span className="material-symbols-outlined">new_window</span>
            </button>
          </div>


          <section className="section">
            <div className="item-texto"><strong>Transcripción:</strong></div>
            <div className="transcripcion">
              {texto}{interino && <span className="transcripcion-interina"> {interino}</span>}
            </div>
          </section>
        </section>

        {/* Panel derecho */}
        <section className="right card">
          <h1 className="title">Historial de Resúmenes</h1>
          {!detalle ? (
            <div id="historial" className="historial">
              {historial.length === 0 && <div className="muted">No hay consultas aún.</div>}
              {historial.map((it) => (
                <button key={it.id_consulta} className="historial-item" onClick={() => mostrarDetalleConsulta(it.id_consulta)}>
                  <div className="item-fecha">{formatearFecha(it.fecha)}</div>
                  <div className="item-texto"><strong>{it.paciente_nombre || "(Sin nombre)"}</strong></div>
                </button>
              ))}
            </div>
          ) : (
            <div className="historial-item detalle">
              <div className="detalle-actions">
                <button id="btnVolverHist" className="btn" onClick={cargarHistorial}><span className="material-symbols-outlined">arrow_back</span></button>
              </div>
              <div className="item-fecha">{formatearFecha(detalle.fecha)}</div>
              <div className="item-texto"><strong>{detalle.paciente_nombre || "(Sin nombre)"}</strong></div>
              <div className="transcripcion">{detalle.transcripcion || ""}</div>
              
            </div>
          )}
        </section>
      </main>
    </>
  );
}