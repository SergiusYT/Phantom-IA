import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { Busy, Ico } from "./ui.jsx";
import { APP_NOMBRE, APP_TECH, Tech } from "./tech.jsx";

const PLATAFORMA = {
  "phantom-frontend": ["react", "Panel"], "phantom-backend": ["django", "Backend"],
  "phantom-db": ["postgres", "Base de datos"], "docker-proxy": ["docker", "Proxy Docker"],
};
const ESTADO = { Running: "Activo", Pending: "Esperando", ContainerCreating: "Iniciando", Terminating: "Cerrando" };
const EVENTO = {
  Scheduled: "asignado a un nodo", Pulled: "imagen lista", Created: "contenedor creado", Started: "en marcha",
  Killing: "detenido", SuccessfulCreate: "copia creada", SuccessfulDelete: "copia eliminada", ScalingReplicaSet: "copias ajustadas",
  BackOff: "reintentando", Unhealthy: "no responde",
};
const appDe = (obj) => (obj.split("/")[1] || "").split("-")[0];

function Seguimiento({ exp, pasos }) {
  const [, tick] = useState(0);
  useEffect(() => { if (exp.fin) return; const i = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(i); }, [exp.fin]);
  const seg = (((exp.fin || Date.now()) - exp.inicio) / 1000).toFixed(1);
  return (
    <div className={`seguimiento ${exp.fin ? "listo" : ""}`}>
      {pasos.map(([t, ok]) => <div key={t} className={ok ? "ok" : ""}>{ok ? <Ico n="check" /> : <span className="spin" />}{t}</div>)}
      <div className="crono">{exp.fin ? `Listo en ${seg} s` : `${seg} s`}</div>
    </div>
  );
}

function Pod({ p, nuevo }) {
  const t = APP_TECH[p.app];
  const cls = p.state === "Terminating" ? "muere" : p.state !== "Running" || !p.ready ? "espera" : "";
  return (
    <div className={`pod2 ${cls} ${nuevo ? "nuevo" : ""}`} title={p.name}>
      <Tech n={t} size={26} />
      <div>
        <b>{APP_NOMBRE[p.app] || p.app}</b>
        <span><i className={`led ${cls === "muere" ? "mal" : cls ? "esp" : "ok"}`} />{ESTADO[p.state] || p.state}</span>
      </div>
      {p.metrics && <small>{p.metrics.mem_mi} MB</small>}
    </div>
  );
}

export default function Orquestacion({ user, aviso }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [nuevos, setNuevos] = useState(new Set());
  const [ocupado, setOcupado] = useState("");
  const [exp, setExp] = useState(null);   // experimento en curso: {tipo, inicio, objetivo, podViejo, fin}
  const vistos = useRef(null);

  useEffect(() => {
    let vivo = true;
    const tick = () => api("orchestration/").then((r) => {
      if (!vivo) return;
      const nombres = new Set((r.kubernetes?.pods || []).map((p) => p.name));
      if (vistos.current) {
        const n = [...nombres].filter((x) => !vistos.current.has(x));
        if (n.length) { setNuevos(new Set(n)); setTimeout(() => setNuevos(new Set()), 2500); }
      }
      vistos.current = nombres;
      setD(r); setErr("");
    }, (e) => vivo && setErr(e.message));
    tick();
    const i = setInterval(tick, 2000);
    return () => { vivo = false; clearInterval(i); };
  }, []);

  const k = d?.kubernetes;
  const op = user.operator;
  const apiDep = k?.deployments.find((x) => x.name === "api");

  const escalar = async (n) => {
    setOcupado("escalar");
    try { await api("orchestration/scale/", { method: "POST", body: { deployment: "api", replicas: n } }); setExp({ tipo: "escalar", inicio: Date.now(), objetivo: n }); }
    catch (e) { aviso(e.message, true); }
    setOcupado("");
  };
  const caida = async () => {
    const p = k?.pods.find((x) => x.app === "frontend" && x.state === "Running");
    if (!p) return;
    setOcupado("caida");
    try { await api("orchestration/delete-pod/", { method: "POST", body: { pod: p.name } }); setExp({ tipo: "caida", inicio: Date.now(), podViejo: p.name }); }
    catch (e) { aviso(e.message, true); }
    setOcupado("");
  };

  // el experimento termina cuando el cluster alcanza el estado esperado
  useEffect(() => {
    if (!exp || exp.fin || !k) return;
    if (exp.tipo === "escalar") {
      const dep = k.deployments.find((x) => x.name === "api");
      const pods = k.pods.filter((p) => p.app === "api" && p.state !== "Terminating");
      if (dep && dep.ready === exp.objetivo && pods.length === exp.objetivo) setExp({ ...exp, fin: Date.now() });
    } else if (exp.tipo === "caida") {
      const nueva = k.pods.find((p) => p.app === "frontend" && p.name !== exp.podViejo && p.state === "Running" && p.ready);
      if (nueva) setExp({ ...exp, fin: Date.now(), podNuevo: nueva.name });
    }
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctrs = d?.docker || [];
  const plataforma = ctrs.filter((c) => c.role === "plataforma");
  const lb = ctrs.find((c) => c.role === "k3d-lb");
  const nodos = k ? [...k.nodes].sort((a, b) => (b.role === "control-plane") - (a.role === "control-plane")) : [];
  const svcs = k ? k.deployments.map((dep) => ({ ...dep, app: dep.name })) : [];

  return (
    <>
      <div className="cabeza">
        <div><h1>Orquestación en vivo</h1><p>Qué está corriendo ahora y dónde.</p></div>
        <span className="vivo-tag"><span className="led ok" />En vivo</span>
      </div>
      {err && <div className="alerta">{err}</div>}
      {d?.errors?.map((e) => <div className="alerta" key={e}>{e}</div>)}
      {!d && !err && <div className="vacio">Conectando…</div>}
      {k && (
        <div className="orq">
          <div className="capa-d">
            <div className="capa-t"><Tech n="docker" size={26} /><b>Docker</b><span>{ctrs.length} contenedores: {plataforma.length} de PHANTOM y {ctrs.length - plataforma.length} de Kubernetes</span></div>
            <div className="plat">
              <span className="plat-t">PHANTOM</span>
              {plataforma.map((c) => {
                const [t, nombre] = PLATAFORMA[c.service] || ["docker", c.service || c.name];
                return <span className="plat-c" key={c.id} title={c.image}><Tech n={t} size={18} />{nombre}<i className={`led ${c.state === "running" ? "ok" : "mal"}`} /></span>;
              })}
            </div>

            <div className="capa-k">
              <div className="capa-t"><Tech n="kubernetes" size={26} /><b>Kubernetes</b><span>funciona dentro de {ctrs.length - plataforma.length} contenedores Docker</span></div>
              {lb && <div className="lb"><Tech n="docker" size={16} /><b>Balanceador de entrada</b><span>contenedor {lb.name}</span><i className={`led ${lb.state === "running" ? "ok" : "mal"}`} /></div>}
              <div className="apps">
                {svcs.map((s) => (
                  <div className="app" key={s.app}>
                    <Tech n={APP_TECH[s.app]} size={22} />
                    <div><b>{APP_NOMBRE[s.app]}</b><span>{s.ready} de {s.replicas} {s.replicas === 1 ? "copia" : "copias"}</span></div>
                    <div className="replicas">{Array.from({ length: Math.max(s.replicas, s.ready) }).map((_, i) => <i key={i} className={i < s.ready ? "on" : ""} />)}</div>
                  </div>))}
              </div>
              <div className="nodos2">
                {nodos.map((n) => {
                  const pods = k.pods.filter((p) => p.node === n.name);
                  return (
                    <div className="nodo2" key={n.name}>
                      <div className="nodo2-t">
                        <Tech n="k3s" size={18} />
                        <b>{n.role === "control-plane" ? "Nodo de control" : "Nodo de trabajo"}</b>
                        <i className={`led ${n.ready ? "ok" : "mal"}`} />
                        {n.metrics && <span>{n.metrics.mem_mi} MB · {n.metrics.cpu_m}m CPU</span>}
                      </div>
                      <div className="ctr-de"><Tech n="docker" size={14} />contenedor {n.name}</div>
                      <div className="pods2">
                        {pods.map((p) => <Pod key={p.name} p={p} nuevo={nuevos.has(p.name)} />)}
                        {!pods.length && <span className="tenue">Sin aplicaciones</span>}
                      </div>
                    </div>);
                })}
              </div>
            </div>
          </div>

          <div className="pila">
            <div className="panel">
              <h3>Experimentos</h3>
              {!op && <p className="tenue" style={{ marginTop: 8 }}>Solo un operador puede ejecutarlos.</p>}
              <div className="pruebas-orq">
                <div className="experimento">
                  <span className="pregunta">¿Qué pasa si llega mucho tráfico?</span>
                  <button className="accion-orq" disabled={!op || !!ocupado || (exp && !exp.fin) || !apiDep} onClick={() => escalar(apiDep.replicas > 1 ? 1 : 3)}>
                    <Tech n="python" size={28} />
                    <div><b>{apiDep?.replicas > 1 ? "Volver a 1 copia de la API" : "Crear 3 copias de la API"}</b>
                      <span>{apiDep?.replicas > 1 ? "Kubernetes quita las sobrantes" : "Kubernetes las reparte entre los nodos"}</span></div>
                    {ocupado === "escalar" && <Busy on />}
                  </button>
                  {exp?.tipo === "escalar" && <Seguimiento exp={exp} pasos={[
                    ["Pedido enviado a Kubernetes", true],
                    [`Copias listas: ${apiDep?.ready ?? 0} de ${exp.objetivo}`, apiDep?.ready === exp.objetivo],
                  ]} />}
                </div>
                <div className="experimento">
                  <span className="pregunta">¿Qué pasa si una aplicación se cae?</span>
                  <button className="accion-orq" disabled={!op || !!ocupado || (exp && !exp.fin)} onClick={caida}>
                    <Tech n="nginx" size={28} />
                    <div><b>Apagar la Web</b><span>Kubernetes la vuelve a levantar sola</span></div>
                    {ocupado === "caida" && <Busy on />}
                  </button>
                  {exp?.tipo === "caida" && <Seguimiento exp={exp} pasos={[
                    ["La Web se apagó", true],
                    ["Kubernetes detecta la caída y crea otra", !!k.pods.find((p) => p.app === "frontend" && p.name !== exp.podViejo)],
                    ["La Web vuelve a estar activa", !!exp.fin],
                  ]} />}
                </div>
              </div>
            </div>
            <div className="panel">
              <div className="panel-cab"><h3>Actividad</h3></div>
              {k.events.length ? (
                <div className="eventos">{[...k.events].reverse().slice(0, 14).map((e, i) => {
                  const app = appDe(e.object);
                  return (
                    <div key={`${e.time}-${e.object}-${e.reason}-${i}`} className={`ev2 ${e.type}`}>
                      {APP_TECH[app] ? <Tech n={APP_TECH[app]} size={16} /> : <Tech n="kubernetes" size={16} />}
                      <span><b>{APP_NOMBRE[app] || app}</b> {EVENTO[e.reason] || e.reason.toLowerCase()}</span>
                      <time>{new Date(e.time).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</time>
                    </div>);
                })}</div>)
                : <div className="vacio">Sin actividad. Usa una de las pruebas.</div>}
            </div>
          </div>
        </div>)}
    </>
  );
}
