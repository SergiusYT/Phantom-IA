import React, { useEffect, useRef, useState } from "react";
import MapaVivo from "./MapaVivo.jsx";
import { useVivo } from "./vivo.jsx";
import { ETAPAS, estadoAgentes, etapaActual, queHace } from "./flujo.js";
import { ICONOS, Ico, Sev } from "./ui.jsx";
import { Tech } from "./tech.jsx";

export const AGENTES = {
  coordinador: { nombre: "Coordinador", rol: "Reparte el trabajo y cierra la auditoría", color: "#6CD4FF", ico: "director" },
  recolector: { nombre: "Recolector", rol: "Lee Kubernetes y el firewall, prueba los flujos e interpreta la red con IA", color: "#3CF5A2", ico: "antena" },
  analista: { nombre: "Analista de red", rol: "Detecta fallos con reglas y los diagnostica con IA", color: "#C3A6FF", ico: "pulso" },
  auditor: { nombre: "Auditor de seguridad", rol: "Detecta riesgos con reglas y los evalúa y prioriza con IA", color: "#FF8A3D", ico: "lupa" },
  planificador: { nombre: "Planificador", rol: "Propone correcciones con reglas y las explica con IA", color: "#FFD25C", ico: "plano" },
  operador: { nombre: "Tú", rol: "Apruebas o rechazas cada cambio", color: "#F2FFF8", ico: "usuario" },
};
const COLOR_SEV = { critical: "#FF4D5E", high: "#FF8A3D", medium: "#FFD25C", low: "#6CD4FF", info: "#8FB3A2" };

function Cronometro({ desde, hasta, vivo }) {
  const [, tick] = useState(0);
  useEffect(() => { if (!vivo) return; const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, [vivo]);
  if (!desde) return null;
  const s = Math.max(0, Math.round(((vivo ? Date.now() : new Date(hasta).getTime()) - new Date(desde).getTime()) / 1000));
  return <span className="crono-sala">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>;
}

function Avatar({ a }) {
  const g = AGENTES[a] || AGENTES.coordinador;
  return <span className="av" style={{ "--a": g.color }}><Ico n={g.ico} /></span>;
}

function Contenido({ m, ir }) {
  const p = m.payload || {};
  if (m.kind === "k8s") return (
    <div className={`burbuja k8s ${p.event === "pod_failed" ? "mal" : ""}`}><Tech n="kubernetes" size={16} /><span>{m.text}</span></div>);
  if (m.kind === "data") return (
    <div className="burbuja">{m.text}
      {p.facts && <div className="hechos">{p.facts.map((f) => <div className="hecho" key={f.k}><b>{f.v}</b>{f.k}</div>)}</div>}
    </div>);
  if (m.kind === "test") {
    const t = p.test;
    const res = t.reachable === null ? "error" : t.reachable ? "responde" : "bloqueado";
    return (
      <span className={`prueba-l ${t.ok ? "" : "mal"}`}>
        <Ico n={t.ok ? "check" : "x"} className={`ico ${t.ok ? "ok-t" : "mal-t"}`} />
        <span className="num">{t.name}</span><b className={t.ok ? "ok-t" : "mal-t"}>{res}</b>
        <span className="pol">{t.expect ? "debe pasar" : "debe estar bloqueado"}</span>
      </span>);
  }
  if (m.kind === "finding") {
    const f = p.finding;
    return (
      <div className="burbuja tarjeta-h" style={{ "--c": COLOR_SEV[f.severity] }}>
        <div className="t"><Sev s={f.severity} />{f.title}</div>
        <span className="tenue">{m.text}</span>
      </div>);
  }
  if (m.kind === "proposal") {
    const pr = p.proposal;
    return (
      <div className="burbuja tarjeta-p">
        <div><span className="tenue">Propuesta lista para tu decisión</span><b>{pr.title}</b><span className="chip">{pr.operation}</span></div>
        <button className="btn primary" onClick={() => ir("propuesta", pr.id)}><Ico n="propuesta" />Revisar y decidir</button>
      </div>);
  }
  if (m.kind === "done") return (
    <div className="burbuja fin">{m.text}
      <div className="fila">
        {p.proposals > 0 && <button className="btn primary" onClick={() => ir("propuestas")}>Ver las {p.proposals} propuestas</button>}
        <button className="btn" onClick={() => ir("auditoria", m.audit)}>Ver el informe completo</button>
      </div>
    </div>);
  return (
    <div className={`burbuja ${p.ai ? "ia" : ""}`} style={{ "--a": AGENTES[m.agent]?.color }}>
      {p.ai && <div className="ia-tag"><Tech n="ollama" size={14} />IA · {p.title}</div>}
      {!p.ai && m.streaming && p.title && <div className="tenue" style={{ marginBottom: 6 }}>Explicando: {p.title}</div>}
      {m.text}{m.streaming && <span className="cursor" />}
    </div>);
}

export default function Sala({ id, ir }) {
  const vivo = useVivo();
  useEffect(() => { vivo.seguir(id); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const propia = vivo.id === id;
  const st = propia ? vivo.st : { status: "running", messages: [] };
  const err = propia ? vivo.err : "";
  const todos = propia ? vivo.todos : [];
  const msgs = propia ? vivo.msgs : [];
  const reproduciendo = propia && vivo.reproduciendo;

  // el chat solo baja solo si ya estabas abajo: si subes a leer, no te arrastra
  const fondo = useRef(null);
  const pegado = useRef(true);
  const alDesplazar = () => {
    const c = fondo.current;
    if (c) pegado.current = c.scrollHeight - c.scrollTop - c.clientHeight < 90;
  };
  const total = msgs.reduce((a, m) => a + m.text.length, 0);
  useEffect(() => {
    const c = fondo.current;
    if (c && pegado.current) c.scrollTop = c.scrollHeight;
  }, [msgs.length, total]);

  const corriendo = st.status === "running" || reproduciendo;
  const ultimo = msgs[msgs.length - 1];
  const habla = corriendo ? (ultimo?.streaming ? ultimo.agent : ultimo?.to && AGENTES[ultimo.to] && ultimo.to !== "operador" ? ultimo.to : ultimo?.agent) : null;
  const estado = estadoAgentes(msgs, corriendo);
  const etapa = etapaActual(estado, corriendo);

  return (
    <>
      <div className="cabeza">
        <div><h1>Sala de agentes</h1><p>Auditoría {id}: los agentes trabajan en pods de Kubernetes y razonan con la IA.</p>
          <ol className="etapas">{ETAPAS.map((e, i) => (
            <li key={e} className={i < etapa || (i === 3 && !corriendo) ? "hecha" : i === etapa ? "ahora" : ""}>
              <span>{i < etapa || (i === 3 && !corriendo) ? <Ico n="check" /> : i + 1}</span>{e}</li>))}
            <li className="tiempo"><Cronometro desde={todos[0]?.time} hasta={todos[todos.length - 1]?.time} vivo={st.status === "running"} /></li>
          </ol></div>
        {corriendo ? <span className="vivo-tag"><span className="led ok" />{st.status === "running" ? "En curso" : "Reproduciendo"}</span>
          : <div className="fila"><button className="btn" onClick={() => { pegado.current = true; vivo.repetir(); }}><Ico n="revertir" />Repetir conversación</button><button className="btn ghost" onClick={() => ir("auditoria", id)}>Ver informe</button></div>}
      </div>
      {err && <div className="alerta">{err}</div>}
      <div className="sala-vivo">
      <div className="panel grafo-panel">
        <MapaVivo msgs={msgs} corriendo={corriendo} agentes={AGENTES} iconos={ICONOS} estado={estado} />
        <div className={`ahora ${corriendo ? "vivo" : ""}`} style={{ "--a": AGENTES[ultimo?.agent]?.color }}>
          {corriendo && ultimo && <Avatar a={ultimo.agent} />}
          <div>
            <b>{corriendo ? "Ahora" : "Resumen"}</b>
            <span>{corriendo ? queHace(ultimo) : st.status === "done" ? "Auditoría terminada. Usa “Repetir conversación” para ver el flujo otra vez." : st.status === "failed" ? "La auditoría falló; la conversación explica por qué." : "Cargando…"}</span>
            {corriendo && ultimo && ["say", "data", "error"].includes(ultimo.kind) && (ultimo.text || ultimo.streaming) && (
              <p className="dice">{ultimo.streaming && ultimo.text.length > 220 ? `…${ultimo.text.slice(-220)}` : ultimo.text.length > 220 ? `${ultimo.text.slice(0, 220)}…` : ultimo.text || "Pensando…"}
                {ultimo.streaming && <span className="cursor" />}</p>)}
          </div>
        </div>
      </div>
      <div className="panel sala-chat">
        <h3 className="sala-t">Conversación</h3>
        <div className="chat" aria-live="polite" ref={fondo} onScroll={alDesplazar}>
          {msgs.map((m) => {
            const g = AGENTES[m.agent] || AGENTES.coordinador;
            const para = m.to && AGENTES[m.to] ? AGENTES[m.to].nombre : "";
            return (
              <div key={m.seq} className={`msg ${m.kind === "error" ? "error" : ""} ${m.payload?.failed_attempt ? "fallido" : ""}`} style={{ "--a": g.color }}>
                <Avatar a={m.agent} />
                <div>
                  <div className="quien"><b>{g.nombre}</b>{para && <span>a {para === "Tú" ? "ti" : para}</span>}
                    {m.payload?.failed_attempt && <span className="tag-fallido">intento fallido</span>}
                    {m.payload?.attempt > 1 && !m.payload?.failed_attempt && <span className="tag-reintento">{`intento ${m.payload.attempt}`}</span>}
                    <span>{new Date(m.time).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div>
                  <Contenido m={m} ir={ir} />
                </div>
              </div>);
          })}
          {corriendo && !ultimo?.streaming && habla && (
            <div className="trabajando" style={{ "--a": AGENTES[habla]?.color }}>
              <span className="puntos"><i /><i /><i /></span>{AGENTES[habla]?.nombre} está trabajando
            </div>)}
        </div>
      </div>
      </div>
    </>
  );
}
