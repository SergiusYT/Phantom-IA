import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import GrafoAgentes from "./GrafoAgentes.jsx";
import { ICONOS, Ico, Sev } from "./ui.jsx";

export const AGENTES = {
  coordinador: { nombre: "Coordinador", rol: "Reparte el trabajo y cierra la auditoría", color: "#6CD4FF", ico: "director" },
  recolector: { nombre: "Recolector", rol: "Lee Kubernetes, el firewall y prueba los flujos", color: "#3CF5A2", ico: "antena" },
  analista: { nombre: "Analista de red", rol: "Busca fallos de operación", color: "#C3A6FF", ico: "pulso" },
  auditor: { nombre: "Auditor de seguridad", rol: "Compara contra las reglas", color: "#FF8A3D", ico: "lupa" },
  planificador: { nombre: "Planificador", rol: "Propone correcciones con el modelo local", color: "#FFD25C", ico: "plano" },
  operador: { nombre: "Tú", rol: "Apruebas o rechazas cada cambio", color: "#F2FFF8", ico: "usuario" },
};
const COLOR_SEV = { critical: "#FF4D5E", high: "#FF8A3D", medium: "#FFD25C", low: "#6CD4FF", info: "#8FB3A2" };
const FASES = ["recolector", "analista", "auditor", "planificador", "fin"];

function Avatar({ a }) {
  const g = AGENTES[a] || AGENTES.coordinador;
  return <span className="av" style={{ "--a": g.color }}><Ico n={g.ico} /></span>;
}

function Contenido({ m, ir }) {
  const p = m.payload || {};
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
    <div className="burbuja" style={{ "--a": AGENTES[m.agent]?.color }}>
      {m.streaming && p.title && <div className="tenue" style={{ marginBottom: 6 }}>Explicando: {p.title}</div>}
      {m.text}{m.streaming && <span className="cursor" />}
    </div>);
}

export default function Sala({ id, ir }) {
  const [st, setSt] = useState({ status: "running", messages: [] });
  const [err, setErr] = useState("");
  const fondo = useRef(null);
  const n = useRef(0);
  const [mostrados, setMostrados] = useState(null);   // cola de reproduccion: cuantos mensajes se ven

  useEffect(() => {
    let vivo = true, t;
    const tick = () => api(`audits/${id}/messages/`).then((r) => {
      if (!vivo) return;
      setSt(r); setErr("");
      // al abrir una auditoria ya terminada se muestra completa; si esta en curso se reproduce
      setMostrados((m) => (m === null ? (r.status === "running" ? 0 : r.messages.length) : m));
      const sigue = r.status === "running" || r.messages.some((m) => m.streaming);
      if (sigue) t = setTimeout(tick, 600);
    }, (e) => { if (vivo) { setErr(e.message); t = setTimeout(tick, 2000); } });
    tick();
    return () => { vivo = false; clearTimeout(t); };
  }, [id]);

  const todos = st.messages.map((m) => ({ ...m, audit: id }));
  const visibles = mostrados ?? 0;
  useEffect(() => {
    if (mostrados === null || mostrados >= todos.length) return;
    const actual = todos[mostrados - 1];
    if (actual?.streaming) return;                      // espera a que la IA termine de escribir
    const atraso = todos.length - mostrados;
    const espera = mostrados === 0 ? 300 : atraso > 10 ? 450 : atraso > 4 ? 900 : 1600;
    const t = setTimeout(() => setMostrados((m) => m + 1), espera);
    return () => clearTimeout(t);
  }, [mostrados, todos.length, todos[visibles - 1]?.streaming]); // eslint-disable-line react-hooks/exhaustive-deps
  const msgs = todos.slice(0, visibles);
  const reproduciendo = visibles < todos.length;
  const total = msgs.reduce((a, m) => a + m.text.length, 0);
  useEffect(() => {
    if (msgs.length !== n.current || msgs.some((m) => m.streaming)) {
      n.current = msgs.length;
      const c = fondo.current;
      if (c) c.scrollTop = c.scrollHeight;
    }
  }, [msgs.length, total]); // eslint-disable-line react-hooks/exhaustive-deps

  const corriendo = st.status === "running" || reproduciendo;
  const ultimo = msgs[msgs.length - 1];
  const habla = corriendo ? (ultimo?.streaming ? ultimo.agent : ultimo?.to && AGENTES[ultimo.to] && ultimo.to !== "operador" ? ultimo.to : ultimo?.agent) : null;
  const fase = !corriendo ? 4 : Math.max(0, FASES.indexOf(habla));

  return (
    <>
      <div className="cabeza">
        <div><h1>Sala de agentes</h1><p>Auditoría {id}, en vivo.</p>
          <div className="progreso-sala" aria-hidden="true">{FASES.map((f, i) => <i key={f} className={i <= fase ? "on" : ""} />)}</div></div>
        {corriendo ? <span className="vivo-tag"><span className="led ok" />{st.status === "running" ? "En curso" : "Reproduciendo"}</span>
          : <div className="fila"><button className="btn" onClick={() => setMostrados(0)}><Ico n="revertir" />Repetir conversación</button><button className="btn ghost" onClick={() => ir("auditoria", id)}>Ver informe</button></div>}
      </div>
      {err && <div className="alerta">{err}</div>}
      <div className="sala-vivo">
      <div className="panel grafo-panel"><GrafoAgentes msgs={msgs} corriendo={corriendo} agentes={AGENTES} iconos={ICONOS} /></div>
      <div className="panel sala-chat">
        <h3 className="sala-t">Conversación</h3>
        <div className="chat" aria-live="polite" ref={fondo}>
          {msgs.map((m) => {
            const g = AGENTES[m.agent] || AGENTES.coordinador;
            const para = m.to && AGENTES[m.to] ? AGENTES[m.to].nombre : "";
            return (
              <div key={m.seq} className={`msg ${m.kind === "error" ? "error" : ""}`} style={{ "--a": g.color }}>
                <Avatar a={m.agent} />
                <div>
                  <div className="quien"><b>{g.nombre}</b>{para && <span>a {para === "Tú" ? "ti" : para}</span>}
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
