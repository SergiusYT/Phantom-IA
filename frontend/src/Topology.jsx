import React, { useState } from "react";
import { api } from "./api.js";
import { Busy, Ico, fecha, useLoad } from "./ui.jsx";
import { APP_NOMBRE, APP_TECH, TechG, techColor } from "./tech.jsx";

const VERDE = "#3CF5A2", ROJO = "#FF4D5E", GRIS = "#3B5A4B", AZUL = "#6CD4FF";

function estado(e) {
  const o = e?.observed;
  if (!o || o.reachable === null || o.reachable === undefined) return { tipo: "sin", color: GRIS, txt: "sin probar" };
  if (e.expect) return o.reachable ? { tipo: "ok", color: VERDE, txt: "funciona" } : { tipo: "caido", color: ROJO, txt: "caído" };
  return o.reachable ? { tipo: "brecha", color: ROJO, txt: "riesgo" } : { tipo: "bloq", color: GRIS, txt: "bloqueado" };
}

function Linea({ d, color, dash, paquete, etiqueta, lx, ly, anchor = "middle", grueso = 2 }) {
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth={grueso} strokeOpacity=".8" strokeDasharray={dash || ""} />
      {paquete && <circle r="4" fill={color} style={{ filter: `drop-shadow(0 0 5px ${color})` }}><animateMotion dur="2.2s" repeatCount="indefinite" path={d} /></circle>}
      {etiqueta && <text x={lx} y={ly} textAnchor={anchor} fontSize="13" fill={color === GRIS ? "#8FB3A2" : color} fontFamily="Instrument Sans">{etiqueta}</text>}
    </g>
  );
}

function Caja({ id, x, y, w = 150, h = 54, tech, titulo, sub, color = "#1D3729", sel, onSel, alerta, candado }) {
  const on = sel === id;
  return (
    <g transform={`translate(${x},${y})`} className="topo-caja" onClick={() => onSel(id)} role="button" tabIndex="0"
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSel(id)} aria-label={titulo}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="10" fill="#07110C" stroke={alerta ? ROJO : on ? VERDE : color} strokeWidth={on ? 2.2 : 1.4}
        style={on ? { filter: `drop-shadow(0 0 8px ${VERDE})` } : null} />
      <TechG n={tech} x={-w / 2 + 24} y={0} size={24} />
      <text x={-w / 2 + 44} y={sub ? -3 : 5} fill="#F2FFF8" fontSize="15" fontFamily="Chakra Petch" fontWeight="600">{titulo}</text>
      {sub && <text x={-w / 2 + 44} y={14} fill={alerta ? ROJO : "#8FB3A2"} fontSize="12.5" fontFamily="Instrument Sans">{sub}</text>}
      {candado && <g transform={`translate(${w / 2 - 14},${-h / 2 + 2})`}><circle r="10" fill="#07110C" stroke={VERDE} /><path d="M-4,0h8v5h-8zM-2.5,0v-2.5a2.5,2.5 0 0 1 5,0V0" fill="none" stroke={VERDE} strokeWidth="1.4" /></g>}
    </g>
  );
}

/* ---------------- vista 1: trafico de la aplicacion ---------------- */
const TEC = { frontend: "Nginx", api: "Python", db: "PostgreSQL" };
const PUERTO_APP = { frontend: 80, api: 8080, db: 5432 };

function VistaApp({ topo, orq, sel, onSel }) {
  const ed = (id) => topo.edges.find((e) => e.id === id);
  const pods = (app) => (orq?.kubernetes?.pods || []).filter((p) => p.app === app && p.state !== "Terminating");
  const svcNodo = Object.fromEntries(topo.nodes.filter((n) => n.kind === "workload").map((n) => [n.id, n]));
  const pols = topo.network_policies || [];
  const protegido = (app) => pols.some((p) => p.pod_selector?.matchLabels?.app === app) && !pols.some((p) => p.name === "allow-all");
  const fwn = topo.nodes.find((n) => n.kind === "firewall");
  const fw = topo.firewall || { forwards: [], blocked: [], listening: [] };
  const reenvia = (p) => fw.forwards.some((f) => f.port === p);
  const s443 = estado(ed("inet-fw")), s8081 = estado(ed("inet-fw-8081"));
  const fa = estado(ed("fe-api")), ad = estado(ed("api-db")), fd = estado(ed("fe-db"));
  const Y = { frontend: 170, api: 300, db: 430 };
  const dbAbierta = svcNodo.db?.node_ports?.length > 0;
  const entradaWeb = svcNodo.frontend?.node_ports?.[0] || 30080;
  const appOk = s443.tipo === "ok";
  // filas del firewall: puerto, que hace y color
  const filas = [
    [80, reenvia(80) ? "Web → app" : "Web", appOk ? VERDE : GRIS],
    [443, reenvia(443) ? "Web segura → app" : "Web segura", appOk ? VERDE : GRIS],
    [8081, fw.blocked.includes(8081) ? "Prueba: cerrado" : "Prueba: sobra", s8081.tipo === "brecha" ? ROJO : GRIS],
    [22, "Gestión (SSH)", "#8FB3A2"],
  ];
  const FX = 270, FY = 200;
  const zona = (x, w, t) => <g><rect x={x} y="28" width={w} height="512" rx="14" fill="rgba(255,255,255,.012)" stroke="#14271D" />
    <text x={x + 14} y="52" fill="#5C7A6C" fontSize="13" fontFamily="Instrument Sans">{t}</text></g>;

  return (
    <svg viewBox="0 0 1100 560" className="topo-svg" role="img" aria-label="Tráfico de la aplicación">
      <defs><pattern id="pt3" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="rgba(60,245,162,.1)" /></pattern></defs>
      {zona(12, 140, "Exterior")}
      {zona(162, 216, "Perímetro")}
      {zona(388, 150, "Host Linux")}
      <rect x="548" y="28" width="540" height="512" rx="14" fill="url(#pt3)" stroke="rgba(50,108,229,.5)" strokeDasharray="6 5" />
      <TechG n="kubernetes" x={570} y={48} size={20} /><text x="586" y="53" fill="#8FB3A2" fontSize="13" fontFamily="Instrument Sans">Kubernetes</text>
      <text x="680" y="92" textAnchor="middle" fill="#5C7A6C" fontSize="12.5" fontFamily="Instrument Sans">Servicio</text>
      <text x="960" y="92" textAnchor="middle" fill="#5C7A6C" fontSize="12.5" fontFamily="Instrument Sans">Copias en ejecución</text>

      {/* Internet -> firewall */}
      <Linea d={`M110,190 C140,190 150,${FY - 33} 185,${FY - 33}`} color={appOk ? VERDE : GRIS} paquete={appOk} />
      <Linea d={`M110,200 C140,200 150,${FY - 4} 185,${FY - 4}`} color={appOk ? VERDE : GRIS} paquete={appOk} />
      <Linea d={`M110,210 C140,210 150,${FY + 25} 185,${FY + 25}`} color={s8081.color} dash="6 5" paquete={s8081.tipo === "brecha"} />
      {/* firewall -> entrada del cluster (reenvio) */}
      {reenvia(80) && <Linea d={`M355,${FY - 18} C385,${FY - 18} 390,200 405,200`} color={appOk ? VERDE : GRIS} paquete={appOk} etiqueta="reenvío" lx={382} ly={FY - 30} />}
      <Linea d="M525,200 C580,200 560,170 595,170" color={appOk ? VERDE : AZUL} paquete={appOk} />
      {/* camino que se salta el firewall */}
      {dbAbierta
        ? <><Linea d="M110,440 L405,440" color={ROJO} dash="6 5" paquete etiqueta="se salta el firewall" lx={258} ly={428} />
            <Linea d="M525,440 C565,440 565,430 595,430" color={ROJO} dash="6 5" paquete /></>
        : <Linea d="M110,440 L300,440" color={GRIS} dash="4 6" etiqueta="sin acceso directo" lx={205} ly={428} />}

      {/* servicio -> copias */}
      {["frontend", "api", "db"].map((a) => pods(a).map((p, i, arr) => {
        const y2 = Y[a] - (arr.length - 1) * 20 + i * 40;
        return <Linea key={p.name} d={`M765,${Y[a]} C830,${Y[a]} 840,${y2} 885,${y2}`} color="#2A4A3A" grueso={1.4} paquete={p.ready} />;
      }))}
      {/* flujos entre apps */}
      <Linea d="M1035,170 C1080,170 1080,230 1050,245 C1010,262 820,250 765,292" color={fa.color} paquete={fa.tipo === "ok"} etiqueta={`Web → API: ${fa.txt}`} lx={905} ly={246} />
      <Linea d="M1035,300 C1080,300 1080,360 1050,375 C1010,392 820,380 765,422" color={ad.color} paquete={ad.tipo === "ok"} etiqueta={`API → Datos: ${ad.txt}`} lx={905} ly={376} />
      <Linea d="M600,186 C568,240 568,370 600,416" color={fd.color} dash="6 5" paquete={fd.tipo === "brecha"} />
      <text transform="translate(570,302) rotate(-90)" textAnchor="middle" fontSize="12.5" fill={fd.color === GRIS ? "#8FB3A2" : fd.color} fontFamily="Instrument Sans">{`Web → Datos: ${fd.txt}`}</text>

      {/* exterior */}
      <g className="topo-caja" onClick={() => onSel("internet")}>
        <circle cx="76" cy="200" r="32" fill="#07110C" stroke={sel === "internet" ? VERDE : "#5C7A6C"} strokeWidth={sel === "internet" ? 2.2 : 1.4} />
        <svg x="62" y="186" width="28" height="28" viewBox="0 0 24 24" style={{ color: "#8FB3A2" }} className="ico"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg>
        <text x="76" y="252" textAnchor="middle" fill="#D8F3E5" fontSize="14" fontFamily="Chakra Petch">Internet</text>
      </g>
      <g className="topo-caja" onClick={() => onSel("labnet")}>
        <circle cx="76" cy="440" r="32" fill="#07110C" stroke={sel === "labnet" ? VERDE : "#5C7A6C"} strokeWidth={sel === "labnet" ? 2.2 : 1.4} />
        <svg x="62" y="426" width="28" height="28" viewBox="0 0 24 24" style={{ color: "#8FB3A2" }} className="ico"><rect x="3" y="5" width="18" height="11" rx="1.5" /><path d="M8 20h8M12 16v4" /></svg>
        <text x="76" y="492" textAnchor="middle" fill="#D8F3E5" fontSize="14" fontFamily="Chakra Petch">Red del lab</text>
      </g>

      {/* firewall con sus puertos */}
      <g className="topo-caja" onClick={() => onSel("firewall")}>
        <rect x={FX - 85} y={FY - 100} width="170" height="182" rx="12" fill="#0C0905" stroke={sel === "firewall" ? VERDE : "#FFB547"} strokeWidth={sel === "firewall" ? 2.2 : 1.4} />
        <TechG n="freebsd" x={FX - 62} y={FY - 74} size={24} />
        <text x={FX - 42} y={FY - 76} fill="#F2FFF8" fontSize="15" fontFamily="Chakra Petch" fontWeight="600">Firewall</text>
        <text x={FX - 42} y={FY - 61} fill="#8FB3A2" fontSize="11" fontFamily="JetBrains Mono">{fwn?.label.match(/\((.*)\)/)?.[1]}</text>
        {filas.map(([p, txt, c], i) => (
          <g key={p} transform={`translate(${FX - 75},${FY - 33 + i * 29})`}>
            <rect width="150" height="24" y="-12" rx="5" fill="#130F08" stroke={c} strokeOpacity=".55" />
            <text x="8" y="4" fill="#F2FFF8" fontSize="12" fontFamily="JetBrains Mono" fontWeight="500">{p}</text>
            <text x="46" y="4" fill={c === GRIS ? "#8FB3A2" : c} fontSize="11.5" fontFamily="Instrument Sans">{txt}</text>
          </g>))}
      </g>

      {/* host */}
      <Caja id="lb" x={465} y={200} w={132} tech="docker" titulo="Entrada" sub={`k3d :${entradaWeb}`} sel={sel} onSel={onSel} />
      <Caja id="np" x={465} y={440} w={132} tech="docker" titulo="Puerto" sub={dbAbierta ? `${svcNodo.db.node_ports.join(",")} abierto` : "cerrado"} alerta={dbAbierta} sel={sel} onSel={onSel} />

      {/* servicios y copias */}
      {["frontend", "api", "db"].map((a) => (
        <Caja key={a} id={`svc-${a}`} x={680} y={Y[a]} w={170} tech={APP_TECH[a]} titulo={a === "db" ? "Datos" : APP_NOMBRE[a]}
          sub={`${TEC[a]} :${PUERTO_APP[a]}`} alerta={a === "db" && dbAbierta} candado={protegido(a)} sel={sel} onSel={onSel} />))}
      {["frontend", "api", "db"].map((a) => pods(a).map((p, i, arr) => (
        <g key={p.name} transform={`translate(960,${Y[a] - (arr.length - 1) * 20 + i * 40})`} className="topo-caja" onClick={() => onSel(`pod-${p.name}`)}>
          <rect x="-75" y="-15" width="150" height="30" rx="8" fill="#0E1B15" stroke={sel === `pod-${p.name}` ? VERDE : techColor(APP_TECH[a])} strokeOpacity=".7" />
          <TechG n={APP_TECH[a]} x={-58} y={0} size={14} />
          <circle cx="-42" cy="0" r="3.5" fill={p.ready ? VERDE : "#FFB547"} />
          <text x="-32" y="4" fill="#D8F3E5" fontSize="12" fontFamily="JetBrains Mono">{p.name.split("-").slice(-1)[0]}</text>
          <text x="68" y="4" textAnchor="end" fill="#5C7A6C" fontSize="11" fontFamily="JetBrains Mono">{p.node?.replace("k3d-phantom-", "")}</text>
        </g>)))}
    </svg>
  );
}

/* ---------------- vista 2: plano de gestion de PHANTOM ---------------- */
const GESTION = [
  ["postgres", "Base de datos", "guarda auditorías y registro", "PostgreSQL :5433", false],
  ["kubernetes", "API de Kubernetes", "lee el estado y aplica cambios", "kubectl (HTTPS)", false],
  ["freebsd", "Firewall FreeBSD", "solo operaciones permitidas", "SSH restringido", true],
  ["ollama", "IA local (Mistral)", "explica las propuestas", "HTTP :11434", false],
  ["docker", "Proxy de Docker", "ve contenedores, no los cambia", "solo lectura :2375", true],
];
function VistaGestion({ sel, onSel }) {
  return (
    <svg viewBox="0 0 1040 520" className="topo-svg" role="img" aria-label="Cómo PHANTOM gestiona la infraestructura">
      <Linea d="M136,260 L250,260" color={AZUL} paquete etiqueta="navegador" lx={193} ly={248} />
      <Linea d="M400,260 L470,260" color={AZUL} paquete etiqueta="API REST" lx={435} ly={248} />
      {GESTION.map(([t, , , proto, lock], i) => {
        const yy = 70 + i * 95;
        return <Linea key={t} d={`M660,260 C730,260 715,${yy} 795,${yy}`} color={lock ? VERDE : AZUL} paquete etiqueta={proto} lx={785} ly={yy - 12} anchor="end" />;
      })}
      <g className="topo-caja" onClick={() => onSel("usuario")}>
        <circle cx="100" cy="260" r="36" fill="#07110C" stroke={sel === "usuario" ? VERDE : "#5C7A6C"} strokeWidth="1.6" />
        <svg x="86" y="246" width="28" height="28" viewBox="0 0 24 24" className="ico" style={{ color: "#D8F3E5" }}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" /></svg>
        <text x="100" y="314" textAnchor="middle" fill="#8FB3A2" fontSize="13" fontFamily="Chakra Petch">Operador</text>
      </g>
      <Caja id="panel" x={325} y={260} w={150} tech="react" titulo="Panel" sub="lo que estás viendo" sel={sel} onSel={onSel} />
      <Caja id="backend" x={565} y={260} w={190} h={70} tech="django" titulo="Backend" sub="agentes y controlador" color={VERDE} sel={sel} onSel={onSel} />
      {GESTION.map(([t, titulo, sub, , lock], i) => (
        <Caja key={t} id={`g-${t}`} x={915} y={70 + i * 95} w={240} tech={t} titulo={titulo} sub={sub} candado={lock} sel={sel} onSel={onSel} />))}
    </svg>
  );
}

/* ---------------- ficha de detalle ---------------- */
function Ficha({ sel, topo, orq }) {
  const pods = orq?.kubernetes?.pods || [];
  const ed = (id) => topo?.edges.find((e) => e.id === id);
  const fw = topo?.nodes.find((n) => n.kind === "firewall");
  const svc = (a) => topo?.nodes.find((n) => n.id === a);
  const F = {
    internet: ["Internet", "Cualquier persona o equipo fuera de tu red. Puede intentar entrar por los puertos abiertos.", []],
    firewall: ["Firewall FreeBSD (PF)", "La puerta de entrada. Recibe a los visitantes en los puertos 80 y 443 y los reenvía a la aplicación; bloquea todo lo que no está permitido. PHANTOM solo puede agregar o quitar bloqueos en su propia sección de reglas.",
      [["Dirección", fw?.label.match(/\((.*)\)/)?.[1]], ["Reenvíos", (topo?.firewall?.forwards || []).map((f) => `${f.port} → ${f.to_host}:${f.to_port}`).join(", ") || "ninguno"],
       ["Web por el firewall", estado(ed("inet-fw")).txt], ["Puerto de prueba (8081)", estado(ed("inet-fw-8081")).txt]]],
    lb: ["Entrada del clúster", "Un contenedor de k3d en el host Linux. Recibe lo que reenvía el firewall y lo pasa al servicio Web.", [["Puerto", "30080"]]],
    labnet: ["Red del laboratorio", "Los equipos conectados a la misma red que el host (vmnet8). No pasan por el firewall, por eso nada sensible debería quedar abierto hacia ellos.", []],
    np: ["Puerto directo del host", "Si un servicio se publica como NodePort, el host lo abre a la red del laboratorio sin pasar por el firewall.",
      [["Base de datos", svc("db")?.node_ports?.length ? `abierta en ${svc("db").node_ports.join(", ")}` : "cerrada"]]],
    usuario: ["Operador", "La persona que usa PHANTOM. Aprueba o rechaza cada cambio.", []],
    panel: ["Panel (React)", "La interfaz web. No toca la infraestructura: todo se lo pide al backend.", [["Puerto", "8088"]]],
    backend: ["Backend (Django)", "El centro de control: reúne datos, ejecuta los agentes y aplica solo los cambios aprobados.", [["Puerto", "8000"], ["Agentes", "5"]]],
    "g-postgres": ["Base de datos", "Guarda auditorías, hallazgos, propuestas y el registro de actividad.", [["Motor", "PostgreSQL 16"]]],
    "g-kubernetes": ["API de Kubernetes", "Por aquí PHANTOM consulta el estado del clúster y aplica cambios en el espacio de laboratorio.", [["Espacio", topo?.namespace]]],
    "g-freebsd": ["Firewall por SSH", "PHANTOM entra con una llave que solo puede ejecutar el programa phantom-pf. Cualquier otra orden se rechaza.", [["Puede", "consultar, bloquear y desbloquear puertos"]]],
    "g-ollama": ["IA local", "El modelo Mistral corre en tu equipo. Redacta las explicaciones; las reglas de seguridad no dependen de él.", [["Modelo", "mistral"]]],
    "g-docker": ["Proxy de Docker", "Deja ver qué contenedores corren, pero no permite crear ni detener ninguno.", [["Permite", "solo listar contenedores"]]],
  };
  ["frontend", "api", "db"].forEach((a) => {
    const n = svc(a);
    F[`svc-${a}`] = [`Servicio ${APP_NOMBRE[a]}`, { frontend: "La página web. Recibe a los visitantes y le pide datos a la API.", api: "La lógica de la aplicación. Es la única que debería hablar con la base de datos.", db: "Guarda la información. Nunca debería ser accesible desde fuera." }[a],
      [["Acceso", n?.service_type === "NodePort" ? "abierto fuera del clúster" : "solo interno"], ["Puerto", n?.ports.join(", ")], ["Copias", pods.filter((p) => p.app === a).length]]];
  });
  pods.forEach((p) => { F[`pod-${p.name}`] = [`Copia de ${APP_NOMBRE[p.app]}`, "Un contenedor en ejecución dentro de un nodo de Kubernetes.", [["Nombre", p.name], ["Nodo", p.node], ["IP", p.ip], ["Memoria", p.metrics ? `${p.metrics.mem_mi} MB` : "—"]]]; });
  const f = F[sel];
  if (!f) return <div className="ficha vacia"><Ico n="info" />Toca cualquier pieza del mapa para ver qué es y cómo está.</div>;
  return (
    <div className="ficha">
      <h2>{f[0]}</h2>
      <p>{f[1]}</p>
      {f[2].length > 0 && <dl>{f[2].map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v ?? "—"}</dd></React.Fragment>)}</dl>}
    </div>
  );
}

export default function Topology() {
  const topo = useLoad(() => api("topology/"));
  const orq = useLoad(() => api("orchestration/"));
  const [vista, setVista] = useState("app");
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const probar = async () => {
    setBusy(true); setErr("");
    try { await api("connectivity/", { method: "POST" }); await Promise.all([topo.reload(), orq.reload()]); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const t = topo.data;
  return (
    <>
      <div className="cabeza">
        <div><h1>Topología</h1><p>{vista === "app" ? "Por dónde viaja el tráfico de la aplicación." : "Cómo PHANTOM se conecta con cada sistema."}{t?.connectivity_at && vista === "app" ? ` Última prueba: ${fecha(t.connectivity_at)}.` : ""}</p></div>
        <div className="fila">
          <div className="pestanas" role="tablist">
            <button role="tab" aria-selected={vista === "app"} className={vista === "app" ? "on" : ""} onClick={() => { setVista("app"); setSel(null); }}><Ico n="red" />Aplicación</button>
            <button role="tab" aria-selected={vista === "gestion"} className={vista === "gestion" ? "on" : ""} onClick={() => { setVista("gestion"); setSel(null); }}><Ico n="escudo" />Gestión PHANTOM</button>
          </div>
          {vista === "app" && <button className="btn primary" onClick={probar} disabled={busy}><Busy on={busy}>{!busy && <Ico n="pulso" />}Probar flujos</Busy></button>}
        </div>
      </div>
      {(topo.error || err) && <div className="alerta">{topo.error || err}</div>}
      {t && (
        <div className="topo-layout">
          <div className="panel mapa">
            {vista === "app" ? <VistaApp topo={t} orq={orq.data} sel={sel} onSel={setSel} /> : <VistaGestion sel={sel} onSel={setSel} />}
            <div className="leyenda">
              {vista === "app" ? <>
                <span><i style={{ borderColor: VERDE }} />Permitido y funciona</span>
                <span><i style={{ borderColor: GRIS, borderTopStyle: "dashed" }} />Bloqueado, como debe</span>
                <span><i style={{ borderColor: ROJO, borderTopStyle: "dashed" }} />Riesgo</span>
                <span><i style={{ borderColor: AZUL }} />Entrada al clúster</span>
              </> : <>
                <span><i style={{ borderColor: AZUL }} />Conexión normal</span>
                <span><i style={{ borderColor: VERDE }} />Acceso restringido (candado)</span>
              </>}
            </div>
          </div>
          <Ficha sel={sel} topo={t} orq={orq.data} />
        </div>)}
    </>
  );
}
