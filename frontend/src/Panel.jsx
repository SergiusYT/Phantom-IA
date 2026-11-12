import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { Lineas, SERIE, Segmentos } from "./charts.jsx";
import { APP_NOMBRE, APP_TECH, Tech } from "./tech.jsx";
import { Ico, Sev, Terminal, useLoad } from "./ui.jsx";

const PESO = { critical: 25, high: 12, medium: 5, low: 2, info: 0 };
const COLOR_SEV = { critical: "var(--critical)", high: "var(--high)", medium: "var(--medium)", low: "var(--low)" };
const PUERTO = { 22: "SSH", 80: "Web", 443: "Web segura", 8081: "Prueba" };

function Postura({ hallazgos }) {
  const total = Object.entries(hallazgos || {}).reduce((a, [s, n]) => a + PESO[s] * n, 0);
  const nota = Math.max(0, 100 - total);
  const color = nota >= 80 ? "#3CF5A2" : nota >= 50 ? "#FFB547" : "#FF4D5E";
  const r = 70, c = 2 * Math.PI * r, arco = c * 0.75;
  const max = Math.max(1, ...Object.values(hallazgos || {}));
  return (
    <div className="postura">
      <svg viewBox="0 0 170 170" role="img" aria-label={`Postura de seguridad ${nota} de 100`}>
        <circle cx="85" cy="85" r={r} fill="none" stroke="#14271D" strokeWidth="10" strokeDasharray={`${arco} ${c}`} transform="rotate(135 85 85)" strokeLinecap="round" />
        <circle cx="85" cy="85" r={r} fill="none" stroke={color} strokeWidth="10" strokeDasharray={`${arco * nota / 100} ${c}`} transform="rotate(135 85 85)" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 8px ${color})`, transition: "stroke-dasharray .8s" }} />
        <text x="85" y="92" textAnchor="middle" className="nota">{nota}</text>
        <text x="85" y="116" textAnchor="middle" className="sub">de 100</text>
      </svg>
      <div>
        <h2>Postura de seguridad</h2>
        <p className="tenue" style={{ margin: "6px 0 16px" }}>{nota >= 80 ? "Tu red está bien protegida." : nota >= 50 ? "Hay riesgos que conviene corregir." : "Hay riesgos importantes por corregir."}</p>
        <div className="barras">
          {["critical", "high", "medium", "low"].map((s) => (
            <div className="barra" key={s}><span><Sev s={s} /></span>
              <span className="pista"><i style={{ width: `${(hallazgos?.[s] || 0) / max * 100}%`, background: COLOR_SEV[s] }} /></span>
              <b>{hallazgos?.[s] || 0}</b></div>))}
        </div>
      </div>
    </div>
  );
}

/* Memoria por aplicacion: se acumula en el navegador mientras el panel esta abierto */
function MemoriaVivo() {
  const [hist, setHist] = useState([]);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    const tick = () => api("orchestration/").then((r) => {
      if (!vivo.current || !r.kubernetes) return;
      const suma = { frontend: 0, api: 0, db: 0 };
      r.kubernetes.pods.forEach((p) => { if (p.metrics && suma[p.app] != null) suma[p.app] += p.metrics.mem_mi; });
      setHist((h) => [...h.slice(-35), { t: new Date(), ...suma }]);
    }, () => {});
    tick();
    const i = setInterval(tick, 5000);
    return () => { vivo.current = false; clearInterval(i); };
  }, []);
  const hora = (d) => d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <Lineas etiquetas={hist.map((h) => h.t)} formatoX={(d) => (d ? hora(d) : "")} unidad=" MB"
      series={["frontend", "api", "db"].map((a) => ({ id: a, nombre: APP_NOMBRE[a], color: SERIE[a], valores: hist.map((h) => h[a]) }))} />
  );
}

/* Mapa de flujos: quien puede hablar con quien, segun la ultima prueba */
const FLUJOS = [
  ["Internet", "internet", [["pf-80", "Web :80"], ["pf-443", "Web segura :443"], ["pf-8081", "Prueba :8081"]]],
  ["Web", "nginx", [["fe-api", "API"], ["fe-db", "Datos"]]],
  ["API", "python", [["api-db", "Datos"]]],
];
function MapaFlujos({ run }) {
  const r = Object.fromEntries((run?.results || []).map((t) => [t.id, t]));
  return (
    <div className="mapa-flujos">
      {FLUJOS.map(([origen, tech, dest]) => (
        <div className="mf-fila" key={origen}>
          <div className="mf-origen">{tech === "internet" ? <Ico n="red" /> : <Tech n={tech} size={20} />}{origen}</div>
          <div className="mf-dest">{dest.map(([id, nombre]) => {
            const t = r[id];
            const est = !t ? "sin" : t.expect ? (t.reachable ? "ok" : "caido") : (t.reachable ? "riesgo" : "bloq");
            const txt = { sin: "sin probar", ok: "permitido", caido: "caído", riesgo: "no debería", bloq: "bloqueado" }[est];
            return (
              <div key={id} className={`mf-celda ${est}`}>
                <Ico n={est === "ok" || est === "bloq" ? "check" : est === "sin" ? "info" : "x"} />
                <div><b>{nombre}</b><span>{txt}</span></div>
              </div>);
          })}</div>
        </div>))}
    </div>
  );
}

function ResumenFirewall({ fw }) {
  const abiertos = [...new Set(fw.rules.filter((r) => r.action === "pass" && r.direction === "in").flatMap((r) => r.ports))].sort((a, b) => a - b);
  const bloqueados = new Set(fw.anchor_rules.filter((r) => r.action === "block").flatMap((r) => r.ports));
  const porDefecto = fw.rules.some((r) => r.action === "block" && !r.ports.length);
  return (
    <>
      <div className="puertos">{abiertos.map((p) => {
        const blq = bloqueados.has(p);
        const sobra = !fw.allowed_ports.includes(p);
        return (
          <div key={p} className={`puerto ${blq ? "blq" : sobra ? "mal" : "ok"}`}>
            <b>{p}</b><span>{PUERTO[p] || "Otro"}</span>
            <small>{blq ? "Cerrado por PHANTOM" : sobra ? "Abierto sin necesidad" : "Abierto"}</small>
          </div>);
      })}</div>
      <p className="tenue" style={{ marginTop: 12 }}>{porDefecto ? "Todo lo demás está bloqueado." : "Atención: no hay bloqueo por defecto."}</p>
      <details className="tecnico"><summary>Ver reglas técnicas</summary>
        <Terminal modo="pf" titulo="pfctl -sr" texto={fw.rules.map((r) => r.raw).join("\n") + (fw.anchor_rules.length ? `\n\n# anchor "phantom"\n${fw.anchor_rules.map((r) => r.raw).join("\n")}` : "")} />
      </details>
    </>
  );
}

const PROP = [
  ["applied", "Aplicadas", "#3CF5A2"], ["pending", "Por decidir", "#FFB547"], ["approved", "Aprobadas", "#6CD4FF"],
  ["rolled_back", "Revertidas", "#8FB3A2"], ["superseded", "Reemplazadas", "#3B5A4B"], ["rejected", "Rechazadas", "#FF4D5E"], ["failed", "Fallidas", "#B3243A"],
];

export default function Panel({ ir, auditar, vivo }) {
  const { data, error } = vivo;
  const st = useLoad(() => api("stats/"));
  const conn = useLoad(() => api("connectivity/"));
  const k = data?.kubernetes, fw = data?.firewall;
  const podsOk = k ? k.pods.filter((p) => p.phase === "Running" && p.ready).length : 0;
  const expuestos = k ? k.services.filter((s) => s.type === "NodePort" || s.type === "LoadBalancer").length : 0;
  const audits = st.data?.audits || [];
  const fecha = (d, largo) => (d ? new Date(d).toLocaleString("es-CO", largo ? { dateStyle: "medium", timeStyle: "short" } : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

  return (
    <>
      <div className="cabeza">
        <div><h1>Panel general</h1><p>Cómo está tu red ahora.</p></div>
        <button className="btn primary lg" onClick={auditar}><Ico n="radar" />Iniciar auditoría</button>
      </div>
      {error && <div className="alerta">{error}</div>}
      {data?.errors?.map((e) => <div className="alerta" key={e}><Ico n="x" />{e}</div>)}
      {!data && !error && <div className="vacio">Consultando la infraestructura…</div>}
      {data && (
        <div className="pila">
          <div className="rejilla r-21">
            <div className="panel">{data.last_audit ? <Postura hallazgos={data.open_findings} />
              : <div className="vacio">Inicia una auditoría para calcular la postura.<div><button className="btn primary" onClick={auditar}>Iniciar auditoría</button></div></div>}</div>
            <div className="rejilla r-2">
              <div className="panel dato"><h3 className="fila" style={{ gap: 8 }}><Tech n="kubernetes" size={18} />Aplicaciones activas</h3><div className="v">{podsOk}<span className="tenue" style={{ fontSize: 20 }}>/ {k?.pods.length ?? 0}</span></div><div className="s">{k ? `en ${k.nodes.length} nodos` : "Sin conexión"}</div></div>
              <div className="panel dato"><h3 className="fila" style={{ gap: 8 }}><Tech n="freebsd" size={18} />Firewall</h3><div className="v"><span className={`led ${fw?.enabled ? "ok" : "mal"}`} />{fw ? (fw.enabled ? "Activo" : "Inactivo") : "—"}</div><div className="s">{fw ? `${fw.rules.length} reglas` : "Sin conexión"}</div></div>
              <div className="panel dato"><h3>Expuestos a internet</h3><div className="v" style={{ color: expuestos > 1 ? "var(--high)" : undefined }}>{expuestos}</div><div className="s">servicios abiertos fuera del clúster</div></div>
              <div className="panel dato mira" style={{ cursor: data.pending_proposals ? "pointer" : "default" }} onClick={() => data.pending_proposals && ir("propuestas")}>
                <h3>Por aprobar</h3><div className="v" style={{ color: data.pending_proposals ? "var(--ambar)" : undefined }}>{data.pending_proposals}</div><div className="s">{data.pending_proposals ? "cambios propuestos" : "nada pendiente"}</div></div>
            </div>
          </div>

          <div className="rejilla r-2">
            <div className="panel">
              <div className="panel-cab"><h3>Evolución de la postura</h3><span className="tenue">{audits.length} auditorías</span></div>
              <Lineas etiquetas={audits.map((a) => a.time)} formatoX={(d, l) => fecha(d, l)} min={0} max={100}
                series={[{ id: "score", nombre: "Postura", color: "#3CF5A2", valores: audits.map((a) => a.score) }]} />
            </div>
            <div className="panel">
              <div className="panel-cab"><h3>Memoria por aplicación</h3><span className="vivo-tag"><span className="led ok" />en vivo</span></div>
              <MemoriaVivo />
            </div>
          </div>

          <div className="rejilla r-21">
            <div className="panel">
              <div className="panel-cab"><h3>Quién puede hablar con quién</h3>
                <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => ir("conectividad")}>Probar ahora</button></div>
              <MapaFlujos run={conn.data?.[0]} />
            </div>
            <div className="panel pila">
              <h3>Decisiones sobre propuestas</h3>
              <Segmentos partes={PROP.map(([id, nombre, color]) => ({ id, nombre, color, valor: st.data?.proposals?.[id] || 0 }))} />
              <div className="mini-datos">
                <div><b>{st.data?.executions.total ?? 0}</b><span>cambios ejecutados</span></div>
                <div><b className="ok-t">{st.data?.executions.verified ?? 0}</b><span>verificados</span></div>
                <div><b>{st.data?.executions.rolled_back ?? 0}</b><span>revertidos</span></div>
              </div>
            </div>
          </div>

          <div className="rejilla r-2">
            <div className="panel">
              <div className="panel-cab"><h3 className="fila" style={{ gap: 8 }}><Tech n="kubernetes" size={18} />Aplicaciones</h3>
                <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => ir("topologia")}>Ver mapa</button></div>
              <div className="lista-apps">{k?.services.map((s) => {
                const app = s.selector.app;
                const abierta = s.type === "NodePort" || s.type === "LoadBalancer";
                const riesgo = abierta && app === "db";
                return (
                  <div key={s.name} className="fila-app">
                    <Tech n={APP_TECH[app]} size={24} /><b>{APP_NOMBRE[app] || s.name}</b>
                    <span className={riesgo ? "mal-t" : "tenue"}>{abierta ? `Abierta fuera del clúster${riesgo ? " (riesgo)" : ""}` : "Solo interna"}</span>
                    <span className={`led ${s.endpoints ? "ok" : "mal"}`} title={s.endpoints ? "Funcionando" : "Sin respuesta"} />
                  </div>);
              })}</div>
              <div className="fila" style={{ marginTop: 16, gap: 8 }}>
                <span className="tenue">Reglas internas:</span>
                {k?.network_policies.length ? k.network_policies.map((n) => <span key={n.name} className={`chip ${n.name === "allow-all" ? "mal-t" : ""}`}>{n.name === "allow-all" ? "todo permitido" : n.name.replace("phantom-", "")}</span>)
                  : <span className="mal-t">ninguna, todo puede hablar con todo</span>}
              </div>
            </div>
            <div className="panel">
              <div className="panel-cab"><h3 className="fila" style={{ gap: 8 }}><Tech n="freebsd" size={18} />Firewall</h3><span className="chip">{fw?.host}</span></div>
              {fw ? <ResumenFirewall fw={fw} /> : <div className="vacio">El firewall no responde.</div>}
            </div>
          </div>
        </div>)}
    </>
  );
}
