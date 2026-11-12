import React from "react";
import { api } from "./api.js";
import { Lineas } from "./charts.jsx";
import { Ico, useLoad } from "./ui.jsx";

const SEV = [["critical", ["crítico", "críticos"], "var(--critical)"], ["high", ["alto", "altos"], "var(--high)"], ["medium", ["medio", "medios"], "var(--medium)"], ["low", ["bajo", "bajos"], "var(--low)"]];
const PROP = { applied: [["aplicada", "aplicadas"], "ok"], pending: [["por decidir", "por decidir"], "esp"], approved: [["aprobada", "aprobadas"], "esp"],
  rolled_back: [["revertida", "revertidas"], ""], superseded: [["reemplazada", "reemplazadas"], ""], rejected: [["rechazada", "rechazadas"], "mal"], failed: [["fallida", "fallidas"], "mal"] };

function Anillo({ nota }) {
  const color = nota >= 80 ? "#3CF5A2" : nota >= 50 ? "#FFB547" : "#FF4D5E";
  const r = 26, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="anillo" role="img" aria-label={`Postura ${nota}`}>
      <circle cx="32" cy="32" r={r} fill="none" stroke="#14271D" strokeWidth="6" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6" strokeDasharray={`${c * nota / 100} ${c}`} transform="rotate(-90 32 32)" strokeLinecap="round" />
      <text x="32" y="37" textAnchor="middle" fill="#F2FFF8" fontFamily="Chakra Petch" fontWeight="700" fontSize="17">{nota}</text>
    </svg>
  );
}

export default function Auditorias({ ir, auditar }) {
  const { data, error } = useLoad(() => api("stats/"));
  const audits = data?.audits || [];
  const lista = [...audits].reverse();
  const f = (d, l) => new Date(d).toLocaleString("es-CO", l ? { dateStyle: "medium", timeStyle: "short" } : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <div className="cabeza"><div><h1>Auditorías</h1><p>Cada revisión de los agentes, de la más reciente a la más antigua.</p></div>
        <button className="btn primary" onClick={auditar}><Ico n="radar" />Iniciar auditoría</button></div>
      {error && <div className="alerta">{error}</div>}
      {audits.length > 1 && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-cab"><h3>Postura en cada auditoría</h3></div>
          <Lineas etiquetas={audits.map((a) => a.time)} formatoX={(d, l) => f(d, l)} min={0} max={100} alto={170}
            series={[{ id: "s", nombre: "Postura", color: "#3CF5A2", valores: audits.map((a) => a.score) }]} />
        </div>)}
      {!lista.length && data && <div className="panel vacio">Aún no hay auditorías.<div><button className="btn primary" onClick={auditar}>Iniciar la primera</button></div></div>}
      <div className="expedientes">
        {lista.map((a, i) => {
          const prev = lista[i + 1];
          const delta = prev ? a.score - prev.score : null;
          const props = Object.entries(a.proposals);
          return (
            <article className="expediente" key={a.id}>
              <div className="exp-hito"><span>{f(a.time)}</span></div>
              <div className="exp-tarjeta">
                <Anillo nota={a.score} />
                <div className="exp-cuerpo">
                  <div className="exp-tit">
                    <h2>Auditoría {a.id}</h2>
                    {delta != null && delta !== 0 && <span className={`delta ${delta > 0 ? "sube" : "baja"}`}>{delta > 0 ? "▲" : "▼"} {Math.abs(delta)}</span>}
                    <span className="tenue">por {a.by}{a.duration_s ? `, ${a.duration_s} s` : ""}</span>
                  </div>
                  {a.findings ? (
                    <div className="franja" aria-label="Hallazgos por severidad">
                      {SEV.filter(([s]) => a.severity[s]).map(([s, n, c]) => <span key={s} style={{ flex: a.severity[s], background: c }} title={`${n[1]}: ${a.severity[s]}`} />)}
                    </div>) : <div className="franja limpia"><span /></div>}
                  <div className="exp-datos">
                    {a.findings ? SEV.filter(([s]) => a.severity[s]).map(([s, n, c]) => <span key={s}><i style={{ background: c }} />{a.severity[s]} {n[a.severity[s] === 1 ? 0 : 1]}</span>)
                      : <span className="ok-t">Sin hallazgos</span>}
                    {props.length > 0 && <span className="sep">→</span>}
                    {props.map(([s, n]) => <span key={s} className={`prop-res ${PROP[s]?.[1] || ""}`}>{n} {PROP[s] ? PROP[s][0][n === 1 ? 0 : 1] : s}</span>)}
                  </div>
                </div>
                <div className="exp-acciones">
                  <button className="btn" onClick={() => ir("sala", a.id)}><Ico n="director" />Conversación</button>
                  <button className="btn ghost" onClick={() => ir("auditoria", a.id)}>Informe</button>
                </div>
              </div>
            </article>);
        })}
      </div>
    </>
  );
}
