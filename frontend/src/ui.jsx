import React, { useCallback, useEffect, useState } from "react";

/* ---------- iconos (trazo) ---------- */
const P = {
  escudo: <><path d="M12 3 4 6v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6z" /><circle cx="12" cy="11.5" r="2.5" /></>,
  panel: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  red: <><circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="5" r="2.5" /><circle cx="19" cy="19" r="2.5" /><path d="M7.3 11 16.7 6M7.3 13l9.4 5" /></>,
  radar: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 12 19 6" /></>,
  propuesta: <><path d="M9 4h6l1 2h3v15H5V6h3z" /><path d="m9 13 2 2 4-4" /></>,
  pulso: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  registro: <><path d="M4 5h16M4 12h16M4 19h10" /></>,
  salir: <><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></>,
  rayo: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  cubo: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>,
  muro: <><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9h18M3 15h18M9 4v5M15 9v6M9 15v5" /></>,
  cerebro: <><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V6a2 2 0 0 0-3-2zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1" /></>,
  check: <path d="m5 12 5 5 9-10" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>,
  revertir: <><path d="M4 9h11a5 5 0 0 1 0 10H9" /><path d="m8 5-4 4 4 4" /></>,
  contenedor: <><rect x="3" y="6" width="18" height="12" rx="1.5" /><path d="M7 6v12M11 6v12M15 6v12M19 6v12" /></>,
  servidor: <><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" /><path d="M7 7.5h.01M7 16.5h.01" /></>,
  antena: <><path d="M12 13v8M8 21h8" /><circle cx="12" cy="10" r="2" /><path d="M7.8 5.8a6 6 0 0 0 0 8.4M16.2 5.8a6 6 0 0 1 0 8.4M5 3a10 10 0 0 0 0 14M19 3a10 10 0 0 1 0 14" /></>,
  lupa: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  plano: <><path d="M4 5h11l5 5v9H4z" /><path d="M15 5v5h5M8 13h8M8 16h5" /></>,
  director: <><circle cx="12" cy="7" r="3" /><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" /><path d="m12 13 1.5 2.5L12 20l-1.5-4.5z" /></>,
  usuario: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" /></>,
  papelera: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>,
  capas: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
};
export const ICONOS = P;

export function Ico({ n, className = "ico" }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{P[n]}</svg>;
}

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3 5 7v8c0 7 4.6 12 11 14 6.4-2 11-7 11-14V7z" fill="rgba(60,245,162,.08)" stroke="#3CF5A2" strokeWidth="1.8" />
      <path d="M10 14h4l2-3 2 7 2-4h2" fill="none" stroke="#3CF5A2" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- datos ---------- */
export function useLoad(fn, deps = []) {
  const [st, set] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    set((s) => ({ ...s, loading: true }));
    return fn().then((data) => set({ data, error: null, loading: false }),
      (e) => set({ data: null, error: e.message, loading: false }));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { ...st, reload: load };
}

export const fecha = (d) => (d ? new Date(d).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "—");
export const hora = (d) => (d ? new Date(d).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");

/* ---------- etiquetas ---------- */
const SEV = { critical: "Crítica", high: "Alta", medium: "Media", low: "Baja", info: "Info" };
export const SEV_ORDEN = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export function Sev({ s }) { return <span className={`sev ${s}`}>{SEV[s] || s}</span>; }

const EST = { pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada", applied: "Aplicada", failed: "Fallida", rolled_back: "Revertida", superseded: "Reemplazada", done: "Completada", running: "En curso" };
export function Estado({ s }) { return <span className={`estado ${s}`}>{EST[s] || s}</span>; }

export function Busy({ on, children }) { return <>{on && <span className="spin" />}{children}</>; }

/* ---------- terminal con resaltado ---------- */
function resaltarPF(linea) {
  if (/^\s*#/.test(linea)) return <span className="k-com">{linea}</span>;
  const partes = linea.split(/(\b(?:pass|block|return|quick|log|in|out|proto|port|from|to|any|all|keep|state|anchor|scrub)\b|\b\d+\b|=)/g);
  return partes.map((p, i) => {
    if (p === "pass") return <span key={i} className="k-acc">{p}</span>;
    if (p === "block" || p === "return") return <span key={i} className="k-blq">{p}</span>;
    if (/^\d+$/.test(p)) return <span key={i} className="k-num">{p}</span>;
    if (/^(quick|log|in|out|proto|port|from|to|any|all|keep|state|anchor|scrub)$/.test(p)) return <span key={i} className="k-key">{p}</span>;
    return p;
  });
}
function resaltarYAML(linea) {
  if (/^\s*#/.test(linea)) return <span className="k-com">{linea}</span>;
  if (/^---/.test(linea)) return <span className="k-com">{linea}</span>;
  const m = linea.match(/^(\s*-?\s*)([\w.-]+)(:)(.*)$/);
  if (!m) return linea;
  const val = m[4];
  return <>{m[1]}<span className="k-key">{m[2]}</span>{m[3]}{/^\s*\d+$/.test(val) ? <span className="k-num">{val}</span> : val}</>;
}
export function Terminal({ titulo, texto, modo = "yaml" }) {
  const lineas = (texto || "").split("\n");
  const f = modo === "pf" ? resaltarPF : modo === "log" ? (l) => l.startsWith("== ERROR") || l.includes("FALLIDA") ? <span className="k-blq">{l}</span> : l.startsWith("==") ? <span className="k-acc">{l}</span> : l : resaltarYAML;
  return (
    <div className="terminal">
      <div className="barra-t"><i /><i /><i /><span>{titulo}</span></div>
      <pre>{lineas.map((l, i) => <React.Fragment key={i}>{f(l)}{"\n"}</React.Fragment>)}</pre>
    </div>
  );
}

/* ---------- resultados de conectividad ---------- */
const obs = (t) => (t.reachable === null || t.reachable === undefined ? "error" : t.reachable ? "alcanzable" : "bloqueado");
export function Pruebas({ results }) {
  if (!results?.length) return <div className="vacio">Sin pruebas registradas.</div>;
  return (
    <table>
      <thead><tr><th>Flujo</th><th>Política</th><th>Observado</th><th /></tr></thead>
      <tbody>{results.map((t) => (
        <tr key={t.id}>
          <td className="num">{t.name}</td>
          <td className="tenue">{t.expect ? "permitido" : "prohibido"}</td>
          <td className={`num ${t.ok ? "ok-t" : "mal-t"}`}>{obs(t)}</td>
          <td><Ico n={t.ok ? "check" : "x"} className={`ico ${t.ok ? "ok-t" : "mal-t"}`} /></td>
        </tr>))}
      </tbody>
    </table>
  );
}

export function AntesDespues({ antes = [], despues = [] }) {
  const ids = [...new Set([...antes, ...despues].map((t) => t.id))];
  const by = (arr) => Object.fromEntries(arr.map((t) => [t.id, t]));
  const a = by(antes), d = by(despues);
  const celda = (t) => t
    ? <><Ico n={t.ok ? "check" : "x"} className={`ico ${t.ok ? "ok-t" : "mal-t"}`} /><span className={`flujo-res ${t.ok ? "ok-t" : "mal-t"}`}>{obs(t)}</span></>
    : <span className="tenue">—</span>;
  return (
    <div className="matriz">
      <div className="h">Flujo</div><div className="h">Antes</div><div className="h">Después</div>
      {ids.map((id) => {
        const t = d[id] || a[id];
        return <React.Fragment key={id}><div className="num">{t.name}<span className="tenue"> ({t.expect ? "permitido" : "prohibido"})</span></div><div>{celda(a[id])}</div><div>{celda(d[id])}</div></React.Fragment>;
      })}
    </div>
  );
}

/* ---------- pipeline multiagente (se muestra mientras corre la auditoria) ---------- */
const ETAPAS = [
  ["Recolección", "Consulta la API de Kubernetes y el canal restringido de FreeBSD", 2500],
  ["Pruebas de conectividad", "Mide los flujos internos y del perímetro", 6000],
  ["Agente analista", "Revisa pods, servicios, endpoints y flujos caídos", 1500],
  ["Agente auditor", "Compara la configuración con las reglas de seguridad", 1500],
  ["Agente planificador", "Redacta las correcciones con el modelo local", 99999],
];
export function Pipeline({ fin }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (fin) { setI(ETAPAS.length); return; }
    if (i >= ETAPAS.length - 1) return;
    const t = setTimeout(() => setI(i + 1), ETAPAS[i][2]);
    return () => clearTimeout(t);
  }, [i, fin]);
  return (
    <div className="velo" role="status" aria-live="polite">
      <div className="panel pipeline">
        <h2>Auditoría en curso</h2>
        <p>Los agentes analizan la infraestructura. Ningún cambio se aplica sin tu aprobación.</p>
        <div className="etapas">
          {ETAPAS.map(([t, d], k) => (
            <div key={t} className={`etapa ${k < i ? "lista" : k === i ? "activa" : ""}`}>
              <span className="n">{k < i ? <Ico n="check" /> : k + 1}</span>
              <div><b>{t}</b><small>{d}</small></div>
              {k === i && <span className="spin" style={{ color: "var(--fosforo)" }} />}
            </div>))}
        </div>
        <div className="escaneo"><i /></div>
      </div>
    </div>
  );
}

export function Toast({ msg, mal, onDone }) {
  useEffect(() => { if (msg) { const t = setTimeout(onDone, 3600); return () => clearTimeout(t); } }, [msg, onDone]);
  if (!msg) return null;
  return <div className={`toast ${mal ? "mal" : ""}`} role="status">{msg}</div>;
}
