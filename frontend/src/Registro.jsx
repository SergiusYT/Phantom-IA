import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Estado, ICONOS, Ico, Sev, useLoad } from "./ui.jsx";

const ACCION = { login: "Inicio de sesión", audit_start: "Auditoría iniciada", audit_finish: "Auditoría terminada", approve: "Propuesta aprobada",
  reject: "Propuesta rechazada", execute: "Cambio ejecutado", rollback: "Cambio revertido", connectivity_test: "Prueba de red",
  scale: "Copias ajustadas", delete_pod: "Caída simulada" };
const AGENTE = { coordinador: "Coordinador", recolector: "Recolector", analista: "Analista", auditor: "Auditor", planificador: "Planificador", analyst: "Analista", auditor_: "Auditor" };
const TIPO = { apply: "Aplicar", rollback: "Revertir", say: "Mensaje", data: "Datos", test: "Prueba", finding: "Hallazgo", proposal: "Propuesta", done: "Cierre", error: "Error" };
const FILTRO = { is_superuser: "Operador", action: "Acción", user__username: "Usuario", requested_by__username: "Solicitada por", success: "Resultado", status: "Estado",
  severity: "Severidad", agent: "Agente", rule_id: "Regla", operation: "Operación", kind: "Tipo", verified: "Verificada", passed: "Cumple", audit_id: "Auditoría", role: "Agente" };
const ICO_TABLA = { usuarios: "usuario", eventos: "registro", auditorias: "radar", hallazgos: "lupa", propuestas: "propuesta", ejecuciones: "rayo", pruebas: "pulso", mensajes: "director", agentes: "cubo", propuestas_hallazgos: "capas" };

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
// Auditorías al centro: cada relación del dominio une columnas vecinas y se dibuja por los pasillos.
// Las personas (usuarios, actividad, pruebas) van en una franja aparte; sus líneas solo se ven al seleccionar.
const COLS_ER = [["mensajes", "agentes"], ["auditorias"], ["hallazgos", "propuestas"], ["propuestas_hallazgos", "ejecuciones"]];
const FRANJA = ["usuarios", "eventos", "pruebas"];
const ER_W = 250, ER_HEAD = 42, ER_ROW = 22, ER_GAP_X = 104, ER_GAP_Y = 30, ER_M = 24;
const TIPO_COLOR = { id: "#FFD25C", referencia: "#6CD4FF", fecha: "#C3A6FF", "sí/no": "#3CF5A2", json: "#FF8A3D" };
const altoTabla = (t) => ER_HEAD + t.cols.length * ER_ROW + 10;
const colX = (c) => ER_M + c * (ER_W + ER_GAP_X);

function disponer(by) {
  const pos = {};
  const col = (c, id, y) => { if (by[id]) pos[id] = { x: colX(c), y, h: altoTabla(by[id]), c }; };
  let y0 = ER_M;
  COLS_ER[0].forEach((id) => { col(0, id, y0); if (pos[id]) y0 += pos[id].h + ER_GAP_Y; });
  let y2 = ER_M;
  COLS_ER[2].forEach((id) => { col(2, id, y2); if (pos[id]) y2 += pos[id].h + ER_GAP_Y; });
  const alto = Math.max(y0, y2);
  if (by.auditorias) col(1, "auditorias", Math.max(ER_M, (alto - altoTabla(by.auditorias)) / 2));
  // la tabla puente queda entre hallazgos y propuestas; ejecuciones, a la altura de propuestas
  const h = pos.hallazgos, pr = pos.propuestas;
  if (h && by.propuestas_hallazgos) col(3, "propuestas_hallazgos", h.y + h.h - altoTabla(by.propuestas_hallazgos) / 2 - 10);
  if (pr && by.ejecuciones) col(3, "ejecuciones", Math.max(pr.y + 70, (pos.propuestas_hallazgos?.y || 0) + (pos.propuestas_hallazgos?.h || 0) + ER_GAP_Y));
  const finDominio = Math.max(...Object.values(pos).map((p) => p.y + p.h));
  const yFranja = finDominio + 74;
  FRANJA.forEach((id, k) => col(k, id, yFranja));
  const fin = Math.max(...Object.values(pos).map((p) => p.y + p.h)) + ER_M;
  return { pos, yFranja, alto: fin };
}

function ortogonal(x1, y1, gx, y2, x2) {
  const r = Math.min(7, Math.abs(y2 - y1) / 2);
  if (r < 1) return `M${x1},${y1} H${x2}`;
  const sx = Math.sign(gx - x1), sy = Math.sign(y2 - y1), ex = Math.sign(x2 - gx);
  return `M${x1},${y1} H${gx - sx * r} Q${gx},${y1} ${gx},${y1 + sy * r} V${y2 - sy * r} Q${gx},${y2} ${gx + ex * r},${y2} H${x2}`;
}

function Esquema({ sel, onSel }) {
  const { data, error } = useLoad(() => api("db/esquema/"));
  if (error) return <div className="alerta">{error}</div>;
  if (!data) return <div className="vacio">Leyendo el esquema…</div>;
  const by = Object.fromEntries(data.tablas.map((t) => [t.id, t]));
  const { pos, yFranja, alto } = disponer(by);
  const W = colX(COLS_ER.length) - ER_GAP_X + ER_M;
  const filaY = (id, col) => pos[id].y + ER_HEAD + Math.max(0, by[id].cols.findIndex((c) => c.nombre === col)) * ER_ROW + ER_ROW / 2;
  const pkY = (id) => pos[id].y + ER_HEAD + Math.max(0, by[id].cols.findIndex((c) => c.pk)) * ER_ROW + ER_ROW / 2;
  const activa = (r) => sel && (r.desde === sel || r.hacia === sel);
  const relacionada = (id) => sel && data.relaciones.some((r) => (r.desde === sel && r.hacia === id) || (r.hacia === sel && r.desde === id));

  // carriles: varias líneas por el mismo pasillo no se encimen
  const rels = data.relaciones.filter((r) => pos[r.desde] && pos[r.hacia]);
  const vecinas = rels.filter((r) => Math.abs(pos[r.desde].c - pos[r.hacia].c) === 1 && !FRANJA.includes(r.desde) && !FRANJA.includes(r.hacia));
  const porPasillo = {};
  vecinas.forEach((r) => { const g = Math.min(pos[r.desde].c, pos[r.hacia].c); (porPasillo[g] = porPasillo[g] || []).push(r); });
  const carril = new Map();
  Object.entries(porPasillo).forEach(([g, lista]) => {
    lista.sort((a, b) => filaY(a.desde, a.columna) - filaY(b.desde, b.columna));
    lista.forEach((r, k) => carril.set(r, colX(Number(g)) + ER_W + ER_GAP_X / 2 + (k - (lista.length - 1) / 2) * 13));
  });

  const personas = rels.filter((r) => !carril.has(r));
  const linea = (r, i) => {
    const a = pos[r.desde], b = pos[r.hacia];
    const y1 = filaY(r.desde, r.columna), y2 = pkY(r.hacia);
    const on = activa(r);
    let d, x1, x2;
    if (carril.has(r)) {
      const der = a.c < b.c;
      x1 = der ? a.x + ER_W : a.x; x2 = der ? b.x : b.x + ER_W;
      d = ortogonal(x1, y1, carril.get(r), y2, x2);
    } else {
      if (!on) return null;                       // relaciones con personas: solo al seleccionar
      // por pasillos: sale por la izquierda, baja al corredor, corre hasta el pasillo de Usuarios y entra
      const k = personas.indexOf(r);
      const gUsu = colX(b.c) + ER_W + ER_GAP_X / 2 + (k - (personas.length - 1) / 2) * 10;
      x1 = a.x; x2 = b.x + ER_W;
      if (a.c === b.c + 1) d = ortogonal(x1, y1, gUsu, y2, x2);
      else {
        const gSal = colX(a.c - 1) + ER_W + ER_GAP_X / 2 + 14;
        const bus = yFranja - 56 + k * 5;
        d = `M${x1},${y1} H${gSal} V${bus} H${gUsu} V${y2} H${x2}`;
      }
    }
    const c = on ? "#3CF5A2" : "#2F5C46";
    return (
      <g key={i} opacity={sel && !on ? 0.35 : 1} className="er-rel">
        <path d={d} fill="none" stroke={c} strokeWidth={on ? 2.2 : 1.5} markerEnd={`url(#er-flecha${on ? "-on" : ""})`} strokeLinejoin="round" />
        <circle cx={x1} cy={y1} r="3.5" fill={c} />
      </g>);
  };

  return (
    <div className="er-wrap">
      <svg viewBox={`0 0 ${W} ${alto}`} className="er" role="img" aria-label="Diagrama entidad-relación de la base de datos">
        <defs>
          <marker id="er-flecha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2F5C46" /></marker>
          <marker id="er-flecha-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3CF5A2" /></marker>
        </defs>
        <text x={ER_M} y={14} fill="#5C7A6C" fontSize="12" fontFamily="Instrument Sans">Auditorías y su trabajo</text>
        <rect x={ER_M - 12} y={yFranja - 38} width={W - 2 * ER_M + 24} height={alto - yFranja + 26} rx="14" fill="rgba(255,255,255,.012)" stroke="#14271D" strokeDasharray="5 5" />
        <text x={W - ER_M} y={yFranja - 16} textAnchor="end" fill="#5C7A6C" fontSize="12" fontFamily="Instrument Sans">Personas y actividad · toca una tabla para ver a qué usuario apunta</text>
        {rels.map(linea)}
        {data.tablas.map((t) => {
          const p = pos[t.id];
          if (!p) return null;
          const on = sel === t.id;
          const rel = relacionada(t.id);
          return (
            <g key={t.id} transform={`translate(${p.x},${p.y})`} className={`er-tabla ${t.consultable ? "" : "fija"}`}
              opacity={sel && !on && !rel ? 0.72 : 1} onClick={() => t.consultable && onSel(t.id)}
              role={t.consultable ? "button" : undefined} tabIndex={t.consultable ? 0 : undefined} aria-label={t.nombre}
              onKeyDown={(e) => t.consultable && (e.key === "Enter" || e.key === " ") && onSel(t.id)}>
              <rect width={ER_W} height={p.h} rx="10" fill="#07110C" stroke={on ? "#3CF5A2" : rel ? "#2E6B4E" : "#1D3729"} strokeWidth={on ? 2 : 1.3}
                style={on ? { filter: "drop-shadow(0 0 10px rgba(60,245,162,.5))" } : null} />
              <path d={`M0,10 a10,10 0 0 1 10,-10 h${ER_W - 20} a10,10 0 0 1 10,10 v${ER_HEAD - 10} h-${ER_W} z`} fill={on ? "rgba(60,245,162,.16)" : "#0E1B15"} />
              <svg x="10" y="11" width="18" height="18" viewBox="0 0 24 24" className="ico" style={{ color: on ? "#3CF5A2" : "#8FB3A2" }}>{ICONOS[ICO_TABLA[t.id] || "capas"]}</svg>
              <text x="34" y="19" fill="#F2FFF8" fontSize="14" fontFamily="Chakra Petch" fontWeight="600">{t.nombre}</text>
              <text x="34" y="34" fill="#5C7A6C" fontSize="10.5" fontFamily="JetBrains Mono">{t.db}</text>
              <text x={ER_W - 12} y="26" textAnchor="end" fill="#8FB3A2" fontSize="11.5" fontFamily="JetBrains Mono">{t.total}</text>
              {t.cols.map((c, i) => (
                <g key={c.nombre} transform={`translate(0,${ER_HEAD + i * ER_ROW})`}>
                  {i > 0 && <line x1="10" x2={ER_W - 10} y1="0" y2="0" stroke="#14271D" />}
                  <text x="13" y="15" fontSize="11" fill={c.pk ? "#FFD25C" : c.fk ? "#6CD4FF" : "#3B5A4B"}>{c.pk ? "🔑" : c.fk ? "↗" : "·"}</text>
                  <text x="31" y="15" fontSize="12" fill={c.pk || c.fk ? "#F2FFF8" : "#B9D7C8"} fontFamily="JetBrains Mono">{c.nombre}</text>
                  <text x={ER_W - 12} y="15" textAnchor="end" fontSize="10.5" fill={c.fk ? "#6CD4FF" : TIPO_COLOR[c.tipo] || "#6B8A7B"} fontFamily="Instrument Sans">{c.fk ? `→ ${by[c.fk]?.nombre || c.fk}` : c.tipo}{c.nulo ? "?" : ""}</text>
                </g>))}
            </g>);
        })}
      </svg>
      <div className="leyenda er-leyenda">
        <span><b style={{ color: "#FFD25C" }}>🔑</b> llave primaria</span>
        <span><b style={{ color: "#6CD4FF" }}>↗ → Tabla</b> apunta a otra tabla</span>
        <span><b className="num">●──▶</b> muchos registros apuntan a uno</span>
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
  const [sel, setSel] = useState("auditorias");
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
