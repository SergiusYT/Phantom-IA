import React, { useCallback, useEffect, useState } from "react";
import { api, auth } from "./api.js";
import Acceso from "./Acceso.jsx";
import Portada from "./Portada.jsx";
import Auditorias from "./Auditorias.jsx";
import Orquestacion from "./Orquestacion.jsx";
import Panel from "./Panel.jsx";
import Registro from "./Registro.jsx";
import Sala, { AGENTES } from "./Sala.jsx";
import BurbujaAuditoria from "./BurbujaAuditoria.jsx";
import { VivoProvider, useVivo } from "./vivo.jsx";
import { ROLES } from "./AgentesK8s.jsx";
import Topology from "./Topology.jsx";
import Conectividad from "./Conectividad.jsx";
import { APP_NOMBRE, APP_TECH, Tech } from "./tech.jsx";
import {
  AntesDespues, Busy, Estado, Ico, Logo, Pruebas, SEV_ORDEN, Sev, Terminal, Toast, fecha, hora, useLoad,
} from "./ui.jsx";

function Auditoria({ id, ir }) {
  const { data, error } = useLoad(() => api(`audits/${id}/`), [id]);
  if (error) return <div className="alerta">{error}</div>;
  if (!data) return <div className="vacio">Cargando auditoría…</div>;
  const hs = [...data.findings].sort((a, b) => SEV_ORDEN[a.severity] - SEV_ORDEN[b.severity]);
  return (
    <>
      <div className="cabeza">
        <div><h1>Auditoría {data.id}</h1><p>{fecha(data.created_at)}, solicitada por {data.requested_by || "el sistema"}.</p></div>
        <div className="fila"><button className="btn primary" onClick={() => ir("sala", data.id)}><Ico n="director" />Ver conversación de agentes</button><button className="btn" onClick={() => ir("auditorias")}>Todas las auditorías</button></div>
      </div>
      {data.errors?.map((e) => <div className="alerta" key={e}>{e}</div>)}
      <div className="pila">
        <div className="panel"><div className="ia"><span className="quien"><Ico n="pulso" />Agente analista</span>{data.analyst_summary}</div></div>
        <div className="rejilla r-21">
          <div className="panel pila">
            <div className="panel-cab"><h3>Hallazgos</h3><span className="chip">{hs.length}</span></div>
            {hs.map((f) => (
              <div key={f.id} className={`hallazgo ${f.severity}`}>
                <div className="t"><Sev s={f.severity} />{f.title}</div>
                <div className="m">{f.rule_id}, {f.agent === "auditor" ? "auditor" : "analista"}, {f.component}</div>
                <p>{f.description}</p>
              </div>))}
            {!hs.length && <div className="vacio">Sin hallazgos. La infraestructura cumple las reglas definidas.</div>}
          </div>
          <div className="pila">
            <div className="panel"><h3>Propuestas del planificador</h3>
              {data.proposals.length ? <table><tbody>{data.proposals.map((p) => (
                <tr key={p.id} className="clic" onClick={() => ir("propuesta", p.id)}>
                  <td>{p.title}<div className="tenue num">{p.operation}</div></td><td style={{ textAlign: "right" }}><Estado s={p.status} /></td></tr>))}
              </tbody></table> : <div className="vacio">No hay nada que corregir.</div>}
            </div>
            <div className="panel"><h3>Conectividad medida</h3><Pruebas results={data.snapshot?.connectivity} /></div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- propuestas ---------- */
// solo presentación: cómo se ve cada operación permitida
const OP_VISTA = {
  k8s_apply_segmentation: { tech: "kubernetes", nombre: "Segmentación" },
  k8s_service_to_clusterip: { tech: "kubernetes", nombre: "BD a ClusterIP" },
  pf_block_port: { tech: "freebsd", nombre: "Bloqueo PF" },
};
const opNombre = (p) => (p.operation === "pf_block_port" && p.params?.port
  ? `Bloqueo PF :${p.params.port}` : OP_VISTA[p.operation]?.nombre || p.operation);

function TarjetaPropuesta({ p, ir, i = 0, compacta }) {
  return (
    <button className={`pr-tarjeta ${p.status} ${compacta ? "compacta" : ""}`} style={{ animationDelay: `${i * 60}ms` }}
      onClick={() => ir("propuesta", p.id)}>
      <span className="pr-icono"><Tech n={OP_VISTA[p.operation]?.tech || "kubernetes"} size={compacta ? 18 : 24} /></span>
      <span className="pr-cuerpo">
        <span className="pr-meta"><span className="chip">{opNombre(p)}</span><Estado s={p.status} /></span>
        <b className="pr-titulo">{p.title}</b>
        {!compacta && p.expected_impact && <span className="pr-impacto">{p.expected_impact}</span>}
        <span className="pr-pie">Auditoría #{p.audit} · {fecha(p.created_at)}</span>
      </span>
      <span className="pr-ir">{compacta ? "›" : <>Revisar <span>→</span></>}</span>
    </button>
  );
}

function Propuestas({ ir }) {
  const { data, error } = useLoad(() => api("proposals/"));
  const lista = data || [];
  const de = (estados) => lista.filter((p) => estados.includes(p.status));
  const pendientes = de(["pending", "approved"]);
  const decididas = de(["applied", "rolled_back", "failed", "rejected"]);
  const viejas = de(["superseded"]);
  const grupos = Object.entries(viejas.reduce((m, p) => ((m[p.audit] ||= []).push(p), m), {}))
    .sort((a, b) => b[0] - a[0]);
  const kpis = [
    ["Pendientes", pendientes.length, "pending"], ["Aplicadas", de(["applied"]).length, "applied"],
    ["Revertidas", de(["rolled_back"]).length, "rolled_back"], ["Reemplazadas", viejas.length, "superseded"],
  ];
  return (
    <>
      <div className="cabeza"><div><h1>Propuestas</h1><p>Nada se aplica sin tu aprobación.</p></div></div>
      {error && <div className="alerta">{error}</div>}
      {!data && !error && <div className="vacio">Cargando propuestas…</div>}
      {data && !lista.length && <div className="panel vacio">Sin propuestas. Inicia una auditoría para generarlas.</div>}
      {lista.length > 0 && (<>
        <div className="pr-kpis">
          {kpis.map(([t, v, s], i) => (
            <div key={t} className={`pr-kpi ${s}`} style={{ animationDelay: `${i * 50}ms` }}>
              <span className="pr-kpi-v">{v}</span><span className="pr-kpi-t">{t}</span>
            </div>))}
        </div>

        <section className="pr-seccion">
          <h3 className="pr-h"><span className="pr-punto pending" />Requieren tu decisión<span className="pr-n">{pendientes.length}</span></h3>
          {pendientes.length
            ? <div className="pr-grid">{pendientes.map((p, i) => <TarjetaPropuesta key={p.id} p={p} ir={ir} i={i} />)}</div>
            : <div className="pr-aldia"><Ico n="check" />Todo al día: no hay cambios esperando aprobación.</div>}
        </section>

        {decididas.length > 0 && (
          <section className="pr-seccion">
            <h3 className="pr-h"><span className="pr-punto applied" />Decididas<span className="pr-n">{decididas.length}</span></h3>
            <div className="pr-grid compacta">{decididas.map((p, i) => <TarjetaPropuesta key={p.id} p={p} ir={ir} i={i} compacta />)}</div>
          </section>)}

        {grupos.length > 0 && (
          <section className="pr-seccion">
            <h3 className="pr-h"><span className="pr-punto superseded" />Historial<span className="pr-n">{viejas.length}</span>
              <span className="pr-h-nota">Propuestas reemplazadas por una auditoría más reciente</span></h3>
            <div className="pr-historial">
              {grupos.map(([audit, ps]) => (
                <details key={audit} className="pr-grupo">
                  <summary>
                    <span className="pr-grupo-t">Auditoría #{audit}</span>
                    <span className="pr-grupo-ops">{ps.map((p) => <Tech key={p.id} n={OP_VISTA[p.operation]?.tech || "kubernetes"} size={14} />)}</span>
                    <span className="pr-grupo-n">{ps.length} reemplazada{ps.length > 1 ? "s" : ""}</span>
                    <span className="pr-grupo-f">{fecha(ps[0].created_at)}</span>
                    <span className="pr-flecha">›</span>
                  </summary>
                  <div className="pr-grupo-lista">
                    {ps.map((p) => (
                      <button key={p.id} className="pr-fila" onClick={() => ir("propuesta", p.id)}>
                        <span className="num tenue">#{p.id}</span><span className="chip">{opNombre(p)}</span>
                        <span className="pr-fila-t">{p.title}</span><span className="pr-ir">›</span>
                      </button>))}
                  </div>
                </details>))}
            </div>
          </section>)}
      </>)}
    </>
  );
}

function pasosDe(p) {
  const s = p.status;
  const last = p.executions.find((e) => e.kind === "apply");
  const verif = last?.verified;
  const hecho = (k) => ({
    0: true,
    1: ["approved", "applied", "failed", "rolled_back"].includes(s),
    2: ["applied", "rolled_back"].includes(s) || (s === "failed" && !!last),
    3: !!verif,
  })[k];
  return [
    ["Propuesta", hecho(0) ? "hecho" : ""],
    [s === "rejected" ? "Rechazada" : "Aprobación", s === "rejected" ? "fallo" : hecho(1) ? "hecho" : s === "pending" ? "actual" : ""],
    ["Aplicación", s === "failed" ? "fallo" : hecho(2) ? "hecho" : s === "approved" ? "actual" : ""],
    [s === "rolled_back" ? "Revertida" : "Verificación", hecho(3) ? "hecho" : s === "failed" ? "fallo" : ""],
  ];
}

function Propuesta({ id, user, ir, aviso }) {
  const { data, error, reload } = useLoad(() => api(`proposals/${id}/`), [id]);
  const [busy, setBusy] = useState("");
  const accion = async (a) => {
    if (a === "execute" && !confirm("Se aplicará este cambio en la infraestructura real del laboratorio. ¿Continuar?")) return;
    if (a === "rollback" && !confirm("Se restaurará el estado anterior. ¿Continuar?")) return;
    setBusy(a);
    try {
      const r = await api(`proposals/${id}/${a}/`, { method: "POST" });
      const txt = { approve: "Propuesta aprobada", reject: "Propuesta rechazada", rollback: "Cambio revertido",
        execute: r.status === "applied" ? "Cambio aplicado y verificado" : "La verificación falló: el cambio se revirtió" }[a];
      aviso(txt, r.status === "failed");
      await reload();
    } catch (e) { aviso(e.message, true); }
    setBusy("");
  };
  if (error) return <div className="alerta">{error}</div>;
  if (!data) return <div className="vacio">Cargando propuesta…</div>;
  const op = user.operator;
  const last = data.executions[0];
  const apply = data.executions.find((e) => e.kind === "apply");
  return (
    <>
      <div className="cabeza">
        <div><h1 style={{ fontSize: "clamp(1.6rem, 2.6vw, 2.1rem)", maxWidth: "28ch" }}>{data.title}</h1><p><span className="chip">{data.operation}</span> generada por la auditoría {data.audit}, {fecha(data.created_at)}.</p></div>
        <div className="fila"><Estado s={data.status} /><button className="btn" onClick={() => ir("auditoria", data.audit)}>Ver auditoría</button></div>
      </div>
      {!op && <div className="nota-info"><Ico n="info" />Tienes rol de observador: puedes revisar la propuesta, pero no aprobarla ni ejecutarla.</div>}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="pasos">{pasosDe(data).map(([t, c]) => <div key={t} className={`paso ${c}`}>{t}</div>)}</div>
      </div>
      <div className="rejilla r-2">
        <div className="pila">
          <div className="panel pila">
            <h3>Por qué</h3>
            <p style={{ lineHeight: 1.65 }}>{data.justification}</p>
            <p className="tenue"><b style={{ color: "var(--tinta-2)", fontWeight: 500 }}>Impacto esperado:</b> {data.expected_impact}</p>
            {data.llm_explanation && <div className="ia"><span className="quien"><Tech n="ollama" size={15} />Explicación de la IA</span>{data.llm_explanation}</div>}
          </div>
          <div className="panel pila"><h3>Qué corrige</h3>
            {data.findings.map((f) => <div key={f.id} className={`hallazgo ${f.severity}`}><div className="t"><Sev s={f.severity} />{f.title}</div></div>)}
          </div>
          <div className="panel">
            <h3>Decisión</h3>
            <div className="fila" style={{ marginTop: 12 }}>
              {data.status === "pending" && <>
                <button className="btn primary" disabled={!op || !!busy} onClick={() => accion("approve")}><Busy on={busy === "approve"}>{busy !== "approve" && <Ico n="check" />}Aprobar</Busy></button>
                <button className="btn danger" disabled={!op || !!busy} onClick={() => accion("reject")}><Busy on={busy === "reject"}>Rechazar</Busy></button></>}
              {data.status === "approved" &&
                <button className="btn primary lg" disabled={!op || !!busy} onClick={() => accion("execute")}><Busy on={busy === "execute"}>{busy === "execute" ? "Aplicando y verificando…" : <><Ico n="rayo" />Ejecutar cambio</>}</Busy></button>}
              {data.status === "applied" &&
                <button className="btn danger" disabled={!op || !!busy} onClick={() => accion("rollback")}><Busy on={busy === "rollback"}>{busy !== "rollback" && <Ico n="revertir" />}Revertir cambio</Busy></button>}
              {["rejected", "failed", "rolled_back", "superseded"].includes(data.status) && <span className="tenue">Esta propuesta está cerrada. Inicia otra auditoría para generar una nueva.</span>}
            </div>
            {data.decided_by && <p className="tenue" style={{ marginTop: 12 }}>Decidida por {data.decided_by}, {fecha(data.decided_at)}.</p>}
          </div>
        </div>
        <div className="pila">
          <div className="panel"><h3>{["applied", "rolled_back", "failed"].includes(data.status) ? "Cambio aplicado" : "Cambio que se aplicará"}</h3>
            <div style={{ marginTop: 12 }}><Terminal modo={data.operation.startsWith("pf") ? "pf" : "yaml"} titulo={data.operation.startsWith("pf") ? "anchor phantom" : "kubectl apply"} texto={data.preview} /></div></div>
          {apply && <div className="panel"><h3>Antes y después</h3><div style={{ marginTop: 12 }}><AntesDespues antes={apply.tests_before} despues={apply.tests_after} /></div></div>}
          {last && <div className="panel"><div className="panel-cab"><h3>Detalle técnico</h3><span className="tenue">{last.executed_by}, {hora(last.finished_at)}</span></div>
            <Terminal modo="log" titulo={last.kind === "rollback" ? "reversión" : "ejecución"} texto={last.output} /></div>}
        </div>
      </div>
    </>
  );
}

/* ---------- conectividad ---------- */
/* ---------- consola ---------- */
const NAV = [
  ["Supervisión", [["panel", "Panel general", "panel"], ["orquestacion", "Orquestación en vivo", "capas"], ["topologia", "Topología", "red"], ["conectividad", "Conectividad", "pulso"]]],
  ["Seguridad", [["sala", "Sala de agentes", "director"], ["auditorias", "Auditorías", "radar"], ["propuestas", "Propuestas", "propuesta"], ["registro", "Registro", "registro"]]],
];

function Telemetria({ vivo }) {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  const d = vivo.data;
  const k = d?.kubernetes, fw = d?.firewall;
  const led = (ok) => (d ? (ok ? "ok" : "mal") : "esp");
  return (
    <div className="telemetria" aria-label="Estado de los planos supervisados">
      <span className="plano"><Tech n="kubernetes" size={16} /><b>Kubernetes</b><span className={`led ${led(k && k.nodes.every((n) => n.ready))}`} /></span>
      <span className="plano"><Tech n="freebsd" size={16} /><b>Firewall</b><span className={`led ${led(fw?.enabled)}`} /></span>
      <span className="plano"><Tech n="ollama" size={16} /><b>IA local</b><span className={`led ${led(d?.llm?.available)}`} /></span>
      <span className="plano"><Tech n="docker" size={16} /><b>Docker</b><span className={`led ${d ? "ok" : "esp"}`} /></span>
      <span className="reloj">{t.toLocaleTimeString("es-CO")}</span>
    </div>
  );
}

function Consola({ user, salir }) {
  const [vista, setVista] = useState(() => {
    const [, v, id] = location.hash.split("/");
    return [v || "panel", id ? Number(id) : null];
  });
  const [corriendo, setCorriendo] = useState(false);
  const [toast, setToast] = useState({ msg: "", mal: false });
  const vivoAud = useVivo();
  const vivo = useLoad(() => api("overview/"), [vista[0] === "panel" ? vista : "x"]);
  const [pend, setPend] = useState(0);

  const ir = useCallback((v, id = null) => {
    setVista([v, id]); history.replaceState(null, "", `#/${v}${id ? `/${id}` : ""}`); window.scrollTo(0, 0);
  }, []);
  const aviso = useCallback((msg, mal = false) => setToast({ msg, mal }), []);
  useEffect(() => { api("proposals/?status=pending").then((d) => setPend(d.length), () => {}); }, [vista]);

  const auditar = async (falla = "") => {
    setCorriendo(true);
    try {
      const a = await api("audits/run/", { method: "POST", body: typeof falla === "string" && falla ? { fail_agent: falla } : {} });
      vivoAud.seguir(a.id, { desdeCero: true });
      ir("sala", a.id);
    } catch (e) { aviso(e.message, true); }
    setCorriendo(false);
  };
  const abrirSala = async () => {
    if (vivoAud.id && vivoAud.corriendo) { ir("sala", vivoAud.id); return; }   // vuelve a la que está en vivo
    try {
      const l = await api("audits/");
      if (l.length) ir("sala", l[0].id); else aviso("Aún no hay auditorías: inicia una para ver a los agentes.");
    } catch (e) { aviso(e.message, true); }
  };

  const [v, id] = vista;
  const activa = { auditoria: "auditorias", propuesta: "propuestas" }[v] || v;
  const navegar = (k) => (k === "sala" ? abrirSala() : ir(k));
  return (
    <div className="consola">
      <aside className="riel">
        <button className="marca" onClick={() => ir("panel")}><Logo /><span>PHANTOM<small>Orquestación y seguridad de redes</small></span></button>
        {NAV.map(([g, items]) => (
          <React.Fragment key={g}>
            <div className="nav-grupo">{g}</div>
            {items.map(([k, label, ico]) => (
              <button key={k} className={`nav ${activa === k ? "on mira" : ""}`} onClick={() => navegar(k)} aria-current={activa === k ? "page" : undefined}>
                <Ico n={ico} />{label}{k === "propuestas" && pend > 0 && <span className="cuenta">{pend}</span>}
              </button>))}
          </React.Fragment>))}
        <button className="btn primary accion" onClick={() => auditar()} disabled={corriendo}><Ico n="radar" />Iniciar auditoría</button>
        {user.operator && (
          <details className="simular">
            <summary>Simular la caída de un agente</summary>
            <p>Su primer pod falla a propósito y Kubernetes lo levanta otra vez.</p>
            <div>{ROLES.map((r) => <button key={r} className="btn ghost" disabled={corriendo} onClick={() => auditar(r)}
              style={{ "--a": AGENTES[r].color }}><Ico n={AGENTES[r].ico} />{AGENTES[r].nombre}</button>)}</div>
          </details>)}
        <div className="usuario"><b>{user.username}</b><span>{user.operator ? "Operador: aprueba y ejecuta" : "Observador: solo consulta"}</span>
          <button className="btn ghost" onClick={salir}><Ico n="salir" />Cerrar sesión</button></div>
      </aside>
      <div className="zona">
        <Telemetria vivo={vivo} />
        <main>
          {v === "panel" && <Panel ir={ir} auditar={auditar} vivo={vivo} />}
          {v === "orquestacion" && <Orquestacion user={user} aviso={aviso} />}
          {v === "sala" && id && <Sala key={id} id={id} ir={ir} />}
          {v === "topologia" && <Topology />}
          {v === "conectividad" && <Conectividad aviso={aviso} />}
          {v === "auditorias" && <Auditorias ir={ir} auditar={auditar} />}
          {v === "auditoria" && <Auditoria id={id} ir={ir} />}
          {v === "propuestas" && <Propuestas ir={ir} />}
          {v === "propuesta" && <Propuesta id={id} user={user} ir={ir} aviso={aviso} />}
          {v === "registro" && <Registro />}
        </main>
      </div>
      <BurbujaAuditoria enSala={v === "sala"} ir={ir} />
      <Toast msg={toast.msg} mal={toast.mal} onDone={() => setToast({ msg: "", mal: false })} />
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [listo, setListo] = useState(false);
  const [pantalla, setPantalla] = useState(location.hash.startsWith("#/") ? "consola" : "portada");

  useEffect(() => {
    const fuera = () => setUser(null);
    window.addEventListener("phantom:logout", fuera);
    if (auth.token) api("auth/me/").then(setUser, () => {}).finally(() => setListo(true));
    else setListo(true);
    return () => window.removeEventListener("phantom:logout", fuera);
  }, []);

  if (!listo) return null;
  if (pantalla === "portada") return <Portada entrar={() => { setPantalla("consola"); history.replaceState(null, "", "#/panel"); }} />;
  if (!user) return <Acceso onLogin={setUser} volver={() => { setPantalla("portada"); history.replaceState(null, "", location.pathname); }} />;
  return <VivoProvider><Consola user={user} salir={() => { auth.set(null); setUser(null); }} /></VivoProvider>;
}
