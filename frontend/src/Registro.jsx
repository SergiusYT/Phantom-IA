import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Estado, Ico, Sev, useLoad } from "./ui.jsx";

const ACCION = { login: "Inicio de sesión", audit_start: "Auditoría iniciada", audit_finish: "Auditoría terminada", approve: "Propuesta aprobada",
  reject: "Propuesta rechazada", execute: "Cambio ejecutado", rollback: "Cambio revertido", connectivity_test: "Prueba de red",
  scale: "Copias ajustadas", delete_pod: "Caída simulada" };
const AGENTE = { coordinador: "Coordinador", recolector: "Recolector", analista: "Analista", auditor: "Auditor", planificador: "Planificador", analyst: "Analista", auditor_: "Auditor" };
const TIPO = { apply: "Aplicar", rollback: "Revertir", say: "Mensaje", data: "Datos", test: "Prueba", finding: "Hallazgo", proposal: "Propuesta", done: "Cierre", error: "Error" };
const FILTRO = { is_superuser: "Operador", action: "Acción", user__username: "Usuario", requested_by__username: "Solicitada por", success: "Resultado", status: "Estado",
  severity: "Severidad", agent: "Agente", rule_id: "Regla", operation: "Operación", kind: "Tipo", verified: "Verificada", passed: "Cumple", audit_id: "Auditoría" };
const ICO_TABLA = { usuarios: "usuario", eventos: "registro", auditorias: "radar", hallazgos: "lupa", propuestas: "propuesta", ejecuciones: "rayo", pruebas: "pulso", mensajes: "director" };

function etiquetaOpcion(campo, v) {
  if (v === true) return "Sí";
  if (v === false) return "No";
  if (campo === "action") return ACCION[v] || v;
  if (campo === "agent") return AGENTE[v] || v;
  if (campo === "kind") return TIPO[v] || v;
  return String(v);
}

function Celda({ tipo, v }) {
  if (v === null || v === undefined || v === "") return <span className="tenue">—</span>;
  switch (tipo) {
    case "fecha": return <span className="num">{new Date(v).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>;
    case "bool": return v ? <span className="si"><Ico n="check" />Sí</span> : <span className="no"><Ico n="x" />No</span>;
    case "sev": return <Sev s={v} />;
    case "estado": return <Estado s={v} />;
    case "accion": return ACCION[v] || v;
    case "agente": return AGENTE[v] || v;
    case "tipo": return TIPO[v] || v;
    case "num": case "mono": return <span className="num">{v}</span>;
    default: return String(v);
  }
}

function Explorador({ sel }) {
  const [filtros, setFiltros] = useState({});
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [datos, setDatos] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const qs = new URLSearchParams({ page, ...(q ? { q } : {}), ...Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== "")) });
    const t = setTimeout(() => api(`db/${sel}/?${qs}`).then((d) => { setDatos(d); setErr(""); }, (e) => setErr(e.message)), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [sel, filtros, q, page]);

  useEffect(() => { setFiltros({}); setQ(""); setPage(1); }, [sel]);
  const activos = Object.values(filtros).filter((v) => v !== "").length + (q ? 1 : 0);

  return (
    <div>
      <div className="panel tabla-vista">
        {err && <div className="alerta">{err}</div>}
        {datos && <>
          <div className="panel-cab"><h3 className="fila" style={{ gap: 8 }}><Ico n={ICO_TABLA[datos.id] || "capas"} />{datos.nombre}<span className="chip">{datos.total} registros</span></h3><span className="tenue">{datos.desc}</span></div>
          <div className="filtros">
            <label className="buscar"><Ico n="lupa" /><input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={`Buscar en ${datos.nombre.toLowerCase()}`} /></label>
            {datos.filtros.map((f) => (
              <label key={f.campo} className="filtro">
                <span>{FILTRO[f.campo] || f.campo}</span>
                <select value={filtros[f.campo] ?? ""} onChange={(e) => { setFiltros({ ...filtros, [f.campo]: e.target.value }); setPage(1); }}>
                  <option value="">Todos</option>
                  {f.opciones.map((o) => <option key={String(o)} value={String(o)}>{etiquetaOpcion(f.campo, o)}</option>)}
                </select>
              </label>))}
            {activos > 0 && <button className="btn ghost" onClick={() => { setFiltros({}); setQ(""); setPage(1); }}>Quitar filtros</button>}
          </div>
          <div className="tabla-scroll">
            <table className="tabla-db">
              <thead><tr>{datos.cols.map((c) => <th key={c.campo}>{c.titulo}</th>)}</tr></thead>
              <tbody>{datos.rows.map((r) => (
                <tr key={r._pk}>{datos.cols.map((c) => <td key={c.campo} className={c.tipo === "texto" ? "td-texto" : ""}><Celda tipo={c.tipo} v={r[c.campo]} /></td>)}</tr>))}
              </tbody>
            </table>
            {!datos.rows.length && <div className="vacio">Ningún registro coincide con los filtros.</div>}
          </div>
          <div className="paginas">
            <span className="tenue">{datos.total} {datos.total === 1 ? "registro" : "registros"}</span>
            <div className="fila">
              <button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
              <span className="num">{datos.page} / {datos.pages}</span>
              <button className="btn ghost" disabled={page >= datos.pages} onClick={() => setPage(page + 1)}>Siguiente</button>
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}

/* ---------- diagrama entidad-relacion ---------- */
const COLS_ER = [["usuarios", "pruebas", "eventos"], ["auditorias", "mensajes"], ["hallazgos", "propuestas_hallazgos"], ["propuestas", "ejecuciones"]];
const ER_W = 230, ER_HEAD = 40, ER_ROW = 22, ER_GAP_X = 70, ER_GAP_Y = 34;
const TIPO_COLOR = { id: "#FFD25C", referencia: "#6CD4FF", fecha: "#C3A6FF", "sí/no": "#3CF5A2", json: "#FF8A3D" };

function Esquema({ sel, onSel }) {
  const { data, error } = useLoad(() => api("db/esquema/"));
  if (error) return <div className="alerta">{error}</div>;
  if (!data) return <div className="vacio">Leyendo el esquema…</div>;
  const by = Object.fromEntries(data.tablas.map((t) => [t.id, t]));
  const pos = {};
  let alto = 0;
  COLS_ER.forEach((col, c) => {
    let y = 20;
    col.forEach((id) => {
      const t = by[id];
      if (!t) return;
      const h = ER_HEAD + t.cols.length * ER_ROW + 10;
      pos[id] = { x: 20 + c * (ER_W + ER_GAP_X), y, h };
      y += h + ER_GAP_Y;
    });
    alto = Math.max(alto, y);
  });
  const W = 20 + COLS_ER.length * (ER_W + ER_GAP_X) - ER_GAP_X + 20;
  const filaY = (id, col) => pos[id].y + ER_HEAD + by[id].cols.findIndex((c) => c.nombre === col) * ER_ROW + ER_ROW / 2 + 2;
  const activa = (r) => sel && (r.desde === sel || r.hacia === sel);

  return (
    <div className="er-wrap">
      <svg viewBox={`0 0 ${W} ${alto}`} className="er" role="img" aria-label="Diagrama entidad-relación de la base de datos">
        {data.relaciones.map((r, i) => {
          const a = pos[r.desde], b = pos[r.hacia];
          if (!a || !b) return null;
          const y1 = filaY(r.desde, r.columna), y2 = b.y + ER_HEAD / 2;
          let x1, x2, d;
          if (a.x === b.x) {               // misma columna: curva por la izquierda
            x1 = a.x; x2 = b.x;
            d = `M${x1},${y1} C${x1 - 50},${y1} ${x2 - 50},${y2} ${x2},${y2}`;
          } else if (b.x < a.x) {
            x1 = a.x; x2 = b.x + ER_W;
            d = `M${x1},${y1} C${x1 - 40},${y1} ${x2 + 40},${y2} ${x2},${y2}`;
          } else {
            x1 = a.x + ER_W; x2 = b.x;
            d = `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`;
          }
          const on = activa(r);
          const c = on ? "#3CF5A2" : "#2A4A3A";
          return (
            <g key={i} opacity={sel && !on ? .25 : 1}>
              <path d={d} fill="none" stroke={c} strokeWidth={on ? 2 : 1.4} />
              <circle cx={x1} cy={y1} r="3.5" fill={c} />
              <text x={x1 + (x2 < x1 || a.x === b.x ? -8 : 8)} y={y1 - 5} textAnchor={x2 < x1 || a.x === b.x ? "end" : "start"} fontSize="10.5" fill={on ? "#3CF5A2" : "#5C7A6C"} fontFamily="JetBrains Mono">N</text>
              <text x={x2 + (x2 < x1 || a.x === b.x ? 8 : -8)} y={y2 - 6} textAnchor={x2 < x1 || a.x === b.x ? "start" : "end"} fontSize="10.5" fill={on ? "#3CF5A2" : "#5C7A6C"} fontFamily="JetBrains Mono">1</text>
            </g>);
        })}
        {data.tablas.map((t) => {
          const p = pos[t.id];
          if (!p) return null;
          const on = sel === t.id;
          const rel = sel && data.relaciones.some((r) => (r.desde === sel && r.hacia === t.id) || (r.hacia === sel && r.desde === t.id));
          return (
            <g key={t.id} transform={`translate(${p.x},${p.y})`} className={`er-tabla ${t.consultable ? "" : "fija"}`}
              opacity={sel && !on && !rel ? .45 : 1} onClick={() => t.consultable && onSel(t.id)}
              role={t.consultable ? "button" : undefined} tabIndex={t.consultable ? 0 : undefined}
              onKeyDown={(e) => t.consultable && (e.key === "Enter" || e.key === " ") && onSel(t.id)}>
              <rect width={ER_W} height={p.h} rx="10" fill="#07110C" stroke={on ? "#3CF5A2" : rel ? "#2E6B4E" : "#1D3729"} strokeWidth={on ? 2 : 1.3}
                style={on ? { filter: "drop-shadow(0 0 10px rgba(60,245,162,.5))" } : null} />
              <path d={`M0,10 a10,10 0 0 1 10,-10 h${ER_W - 20} a10,10 0 0 1 10,10 v${ER_HEAD - 10} h-${ER_W} z`} fill={on ? "rgba(60,245,162,.16)" : "#0E1B15"} />
              <text x="12" y="17" fill="#F2FFF8" fontSize="14" fontFamily="Chakra Petch" fontWeight="600">{t.nombre}</text>
              <text x="12" y="32" fill="#5C7A6C" fontSize="10.5" fontFamily="JetBrains Mono">{t.db}</text>
              <text x={ER_W - 12} y="25" textAnchor="end" fill="#8FB3A2" fontSize="11.5" fontFamily="JetBrains Mono">{t.total}</text>
              {t.cols.map((c, i) => (
                <g key={c.nombre} transform={`translate(0,${ER_HEAD + i * ER_ROW})`}>
                  {i > 0 && <line x1="10" x2={ER_W - 10} y1="0" y2="0" stroke="#14271D" />}
                  <text x="12" y="15" fontSize="11" fill={c.pk ? "#FFD25C" : c.fk ? "#6CD4FF" : "#5C7A6C"}>{c.pk ? "🔑" : c.fk ? "↗" : "·"}</text>
                  <text x="30" y="15" fontSize="12" fill={c.pk || c.fk ? "#F2FFF8" : "#B9D7C8"} fontFamily="JetBrains Mono">{c.nombre}</text>
                  <text x={ER_W - 12} y="15" textAnchor="end" fontSize="10.5" fill={TIPO_COLOR[c.tipo] || "#5C7A6C"} fontFamily="Instrument Sans">{c.fk ? `→ ${by[c.fk]?.nombre || c.fk}` : c.tipo}{c.nulo ? "?" : ""}</text>
                </g>))}
            </g>);
        })}
      </svg>
      <div className="leyenda er-leyenda">
        <span><b style={{ color: "#FFD25C" }}>🔑</b> llave primaria</span>
        <span><b style={{ color: "#6CD4FF" }}>↗</b> referencia a otra tabla</span>
        <span><b className="num">N — 1</b> muchos registros apuntan a uno</span>
        <span><b className="num">?</b> puede estar vacío</span>
      </div>
    </div>
  );
}

function detalle(e) {
  const d = e.detail || {};
  if (e.action === "audit_finish") return `${d.findings} hallazgos, ${d.proposals} propuestas`;
  if (e.action === "connectivity_test") return `${d.passed} de ${d.total} flujos correctos`;
  if (e.action === "execute") return d.verified ? "Aplicado y verificado" : "No se pudo verificar";
  if (e.action === "scale") return d.error || `${d.replicas} copias`;
  if (e.action === "delete_pod") return d.error || "Kubernetes la recrea solo";
  return "";
}

function Actividad() {
  const { data, error } = useLoad(() => api("events/"));
  return (
    <div className="panel">
      {error && <div className="alerta">{error}</div>}
      {data?.length ? <div className="tiempo">{data.slice(0, 60).map((e) => (
        <div key={e.id} className={`evento ${e.success ? "" : "mal"}`}>
          <div className="q"><b>{ACCION[e.action] || e.action}</b><span className="tenue">{e.user || "sistema"}, {new Date(e.created_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</span>{!e.success && <span className="sev critical">falló</span>}</div>
          {detalle(e) && <div className="d">{detalle(e)}</div>}
        </div>))}</div> : <div className="vacio">Sin actividad.</div>}
    </div>
  );
}

export default function Registro() {
  const [tab, setTab] = useState("db");
  const [sel, setSel] = useState("eventos");
  return (
    <>
      <div className="cabeza"><div><h1>Registro</h1><p>La base de datos de PHANTOM. Toca una tabla para ver sus registros.</p></div>
        <div className="pestanas" role="tablist">
          <button role="tab" aria-selected={tab === "db"} className={tab === "db" ? "on" : ""} onClick={() => setTab("db")}><Ico n="capas" />Base de datos</button>
          <button role="tab" aria-selected={tab === "act"} className={tab === "act" ? "on" : ""} onClick={() => setTab("act")}><Ico n="registro" />Línea de tiempo</button>
        </div></div>
      {tab === "db" ? <div className="pila">
        <div className="panel"><div className="panel-cab"><h3 className="fila" style={{ gap: 8 }}><Ico n="capas" />Esquema</h3><span className="tenue">Tablas, columnas y cómo se relacionan</span></div><Esquema sel={sel} onSel={setSel} /></div>
        <Explorador sel={sel} />
      </div> : <Actividad />}
    </>
  );
}
