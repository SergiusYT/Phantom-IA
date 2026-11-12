import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Busy, ICONOS, Ico, fecha, useLoad } from "./ui.jsx";
import { ROLES, ultimaAuditoria } from "./AgentesK8s.jsx";
import { AGENTES } from "./Sala.jsx";
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
// Kubernetes orquesta a los agentes: un pod por agente y por auditoria (namespace phantom-agents).
const AY = { recolector: 100, analista: 190, auditor: 280, planificador: 370 };
const FASE_TXT = { pending: "naciendo", running: "trabajando", complete: "terminó", failed: "falló" };

function VistaGestion({ sel, onSel, orq }) {
  const agents = orq?.kubernetes?.agents;
  const ai = orq?.kubernetes?.ai;
  const audit = ultimaAuditoria(agents);
  const job = (r) => (agents?.jobs || []).find((j) => j.agent === r && Number(j.audit) === audit);
  const caidos = (r) => (agents?.pods || []).filter((p) => p.agent === r && Number(p.audit) === audit && p.state === "Failed").length;
  const vivo = (r) => ["running", "pending"].includes(job(r)?.phase);
  const color = (r) => (vivo(r) ? AGENTES[r].color : GRIS);
  const KX = 700;   // centro de la columna de agentes
  return (
    <svg viewBox="0 0 1100 560" className="topo-svg" role="img" aria-label="Cómo PHANTOM orquesta a sus agentes">
      <defs><pattern id="pt4" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="rgba(60,245,162,.1)" /></pattern></defs>
      {/* caja de Kubernetes */}
      <rect x="560" y="40" width="290" height="500" rx="14" fill="url(#pt4)" stroke="rgba(50,108,229,.5)" strokeDasharray="6 5" />
      <TechG n="kubernetes" x={582} y={60} size={20} /><text x="598" y="65" fill="#8FB3A2" fontSize="13" fontFamily="Instrument Sans">Kubernetes</text>
      <text x="598" y="82" fill="#5C7A6C" fontSize="11" fontFamily="JetBrains Mono">phantom-agents</text>
      <line x1="575" y1="425" x2="835" y2="425" stroke="#14271D" strokeDasharray="4 5" />
      <text x="840" y="444" textAnchor="end" fill="#5C7A6C" fontSize="11.5" fontFamily="JetBrains Mono">phantom-ai</text>

      {/* navegador y backend */}
      <Linea d="M136,200 L190,200" color={AZUL} paquete />
      <Linea d="M340,200 L360,200" color={AZUL} />
      {/* el coordinador pide a Kubernetes un pod por agente */}
      {ROLES.map((r) => <Linea key={r} d={`M530,200 C560,200 560,${AY[r]} ${KX - 105},${AY[r]}`} color={color(r)} paquete={vivo(r)} grueso={vivo(r) ? 2.4 : 1.4} />)}
      <text x="548" y="150" textAnchor="middle" fill="#8FB3A2" fontSize="12" fontFamily="Instrument Sans">crea un Job</text>
      {/* recolector: lectura del firewall y de la app auditada */}
      <Linea d={`M${KX + 105},${AY.recolector - 8} C880,${AY.recolector - 8} 880,95 905,95`} color={vivo("recolector") ? VERDE : GRIS} paquete={vivo("recolector")} etiqueta="SSH solo lectura" lx={890} ly={AY.recolector - 22} anchor="end" />
      <Linea d={`M${KX + 105},${AY.recolector + 8} C880,${AY.recolector + 8} 880,235 905,235`} color={vivo("recolector") ? VERDE : GRIS} paquete={vivo("recolector")} etiqueta="lee (RBAC)" lx={872} ly={170} anchor="middle" />
      {/* todos los agentes razonan con la IA (las decisiones salen de reglas fijas) */}
      {ROLES.map((r) => <Linea key={`ia-${r}`} d={`M${KX + 105},${AY[r] + 14} C828,${AY[r] + 14} 828,490 ${KX + 105},490`}
        color={vivo(r) ? AGENTES[r].color : "#2A4A3A"} paquete={vivo(r)} grueso={vivo(r) ? 2.2 : 1.2} />)}
      <text x="836" y="416" textAnchor="end" fill="#8FB3A2" fontSize="11.5" fontFamily="Instrument Sans">razonan con la IA</text>
      {/* controlador: unico que cambia algo, y solo con aprobacion */}
      <Linea d="M445,165 L445,20 L980,20 L980,62" color={VERDE} dash="2 5" etiqueta="controlador: solo cambios aprobados" lx={700} ly={14} />
      <Linea d="M980,128 L980,205" color={VERDE} dash="2 5" />
      {/* backend -> base de datos y proxy de docker */}
      <Linea d="M440,235 L440,382" color={AZUL} paquete etiqueta="guarda" lx={452} ly={312} anchor="start" />
      <Linea d="M400,235 C400,300 300,420 300,468" color={VERDE} etiqueta="solo lectura" lx={300} ly={360} anchor="middle" />

      <g className="topo-caja" onClick={() => onSel("usuario")}>
        <circle cx="100" cy="200" r="36" fill="#07110C" stroke={sel === "usuario" ? VERDE : "#5C7A6C"} strokeWidth="1.6" />
        <svg x="86" y="186" width="28" height="28" viewBox="0 0 24 24" className="ico" style={{ color: "#D8F3E5" }}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" /></svg>
        <text x="100" y="254" textAnchor="middle" fill="#8FB3A2" fontSize="13" fontFamily="Chakra Petch">Operador</text>
      </g>
      <Caja id="panel" x={265} y={200} w={150} tech="react" titulo="Panel" sub="lo que estás viendo" sel={sel} onSel={onSel} />
      <Caja id="backend" x={445} y={200} w={170} h={70} tech="django" titulo="Backend" sub="coordinador" color={VERDE} sel={sel} onSel={onSel} />
      <Caja id="g-postgres" x={440} y={410} w={190} tech="postgres" titulo="Base de datos" sub="auditorías y registro" sel={sel} onSel={onSel} />
      <Caja id="g-docker" x={300} y={495} w={190} tech="docker" titulo="Proxy de Docker" sub="ve, no cambia" candado sel={sel} onSel={onSel} />

      {/* agentes: un pod cada uno, solo mientras trabajan */}
      {ROLES.map((r) => {
        const ag = AGENTES[r], j = job(r), on = sel === `ag-${r}`, c = caidos(r);
        return (
          <g key={r} transform={`translate(${KX},${AY[r]})`} className="topo-caja" onClick={() => onSel(`ag-${r}`)} opacity={j ? 1 : .55}>
            <rect x="-105" y="-26" width="210" height="52" rx="10" fill="#07110C" stroke={on ? VERDE : vivo(r) ? ag.color : "#1D3729"} strokeWidth={vivo(r) || on ? 2.2 : 1.4}
              strokeDasharray={j ? "" : "5 4"} style={vivo(r) ? { filter: `drop-shadow(0 0 8px ${ag.color})` } : null} />
            <svg x="-92" y="-12" width="24" height="24" viewBox="0 0 24 24" className="ico" style={{ color: ag.color }}>{ICONOS[ag.ico]}</svg>
            <text x="-60" y="-3" fill="#F2FFF8" fontSize="14.5" fontFamily="Chakra Petch" fontWeight="600">{ag.nombre}</text>
            <text x="-60" y="14" fill={j?.phase === "failed" ? ROJO : "#8FB3A2"} fontSize="12" fontFamily="Instrument Sans">
              {j ? `pod ${FASE_TXT[j.phase] || j.phase}` : "dormido: nace al auditar"}</text>
            {c > 0 && <g transform="translate(88,-18)"><rect x="-26" y="-9" width="52" height="18" rx="9" fill="#1A0A0C" stroke={ROJO} />
              <text y="4" textAnchor="middle" fontSize="10.5" fill={ROJO} fontFamily="JetBrains Mono">{`cayó ×${c}`}</text></g>}
          </g>);
      })}
      <Caja id="g-ollama" x={KX} y={490} w={210} tech="ollama" titulo="IA local" sub={ai?.ready ? "Mistral, la usan los 4" : "no disponible"} alerta={ai && !ai.ready} sel={sel} onSel={onSel} />

      {/* sistemas que se auditan */}
      <Caja id="g-freebsd" x={980} y={95} w={170} h={66} tech="freebsd" titulo="Firewall" sub="FreeBSD PF" candado sel={sel} onSel={onSel} />
      <Caja id="g-app" x={980} y={235} w={170} h={60} tech="kubernetes" titulo="App auditada" sub="phantom-demo" sel={sel} onSel={onSel} />
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
    backend: ["Backend (Django)", "El coordinador: cuando pides una auditoría, le pide a Kubernetes un pod por agente, junta lo que encuentran y guarda las propuestas. Solo su controlador cambia la infraestructura, y únicamente con tu aprobación.", [["Puerto", "8000"], ["Agentes", "4, cada uno en su pod"]]],
    "g-app": ["App auditada", "La aplicación de laboratorio (Web, API y base de datos) que los agentes revisan. El recolector solo puede leerla.", [["Espacio", topo?.namespace]]],
    "g-postgres": ["Base de datos", "Guarda auditorías, hallazgos, propuestas y el registro de actividad.", [["Motor", "PostgreSQL 16"]]],
    "g-kubernetes": ["API de Kubernetes", "Por aquí PHANTOM consulta el estado del clúster y aplica cambios en el espacio de laboratorio.", [["Espacio", topo?.namespace]]],
    "g-freebsd": ["Firewall por SSH", "Dos llaves, cada una forzada al programa phantom-pf: la del recolector solo puede consultar; la del controlador puede bloquear o desbloquear puertos, y solo tras tu aprobación.", [["Recolector", "solo lectura"], ["Controlador", "cambios aprobados"]]],
    "g-ollama": ["IA local", "El modelo Mistral corre en un pod de Kubernetes y queda cargado en memoria. Los cuatro agentes razonan con él: el recolector interpreta la red, el analista diagnostica, el auditor prioriza riesgos y el planificador explica sus propuestas. Lo que dice la IA nunca cambia un hallazgo ni un cambio: eso lo deciden reglas fijas. Solo los agentes pueden hablarle.", [["Modelo", "mistral"], ["Namespace", "phantom-ai"], ["Pod", orq?.kubernetes?.ai?.pods?.[0]?.name]]],
    "g-docker": ["Proxy de Docker", "Deja ver qué contenedores corren, pero no permite crear ni detener ninguno.", [["Permite", "solo listar contenedores"]]],
  };
  ["frontend", "api", "db"].forEach((a) => {
    const n = svc(a);
    F[`svc-${a}`] = [`Servicio ${APP_NOMBRE[a]}`, { frontend: "La página web. Recibe a los visitantes y le pide datos a la API.", api: "La lógica de la aplicación. Es la única que debería hablar con la base de datos.", db: "Guarda la información. Nunca debería ser accesible desde fuera." }[a],
      [["Acceso", n?.service_type === "NodePort" ? "abierto fuera del clúster" : "solo interno"], ["Puerto", n?.ports.join(", ")], ["Copias", pods.filter((p) => p.app === a).length]]];
  });
  pods.forEach((p) => { F[`pod-${p.name}`] = [`Copia de ${APP_NOMBRE[p.app]}`, "Un contenedor en ejecución dentro de un nodo de Kubernetes.", [["Nombre", p.name], ["Nodo", p.node], ["IP", p.ip], ["Memoria", p.metrics ? `${p.metrics.mem_mi} MB` : "—"]]]; });
  const ag = orq?.kubernetes?.agents;
  const aud = ultimaAuditoria(ag);
  ROLES.forEach((r) => {
    const j = (ag?.jobs || []).find((x) => x.agent === r && Number(x.audit) === aud);
    const ps = (ag?.pods || []).filter((p) => p.agent === r && Number(p.audit) === aud);
    F[`ag-${r}`] = [`Agente: ${AGENTES[r].nombre}`, `${AGENTES[r].rol}. Las reglas deciden; la IA razona y explica. Kubernetes lo crea como un Job cuando pides una auditoría, lo reintenta si su pod cae y lo borra a los 10 minutos.`,
      [["Última auditoría", aud ?? "—"], ["Estado", j ? FASE_TXT[j.phase] || j.phase : "dormido"], ["Pods", ps.map((p) => `${p.name.split("-").pop()} (${p.state})`).join(", ") || "—"],
       ["Nodo", ps.at(-1)?.node], ["Reintentos", j?.failed ?? 0]]];
  });
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
  // la vista de gestion muestra a los agentes en vivo
  useEffect(() => { if (vista !== "gestion") return; const i = setInterval(() => orq.reload(), 2500); return () => clearInterval(i); }, [vista]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="cabeza">
        <div><h1>Topología</h1><p>{vista === "app" ? "Por dónde viaja el tráfico de la aplicación." : "Cómo Kubernetes orquesta a los agentes de PHANTOM."}{t?.connectivity_at && vista === "app" ? ` Última prueba: ${fecha(t.connectivity_at)}.` : ""}</p></div>
        <div className="fila">
          <div className="pestanas" role="tablist">
            <button role="tab" aria-selected={vista === "app"} className={vista === "app" ? "on" : ""} onClick={() => { setVista("app"); setSel(null); }}><Ico n="red" />Aplicación</button>
            <button role="tab" aria-selected={vista === "gestion"} className={vista === "gestion" ? "on" : ""} onClick={() => { setVista("gestion"); setSel(null); }}><Ico n="escudo" />Agentes y gestión</button>
          </div>
          {vista === "app" && <button className="btn primary" onClick={probar} disabled={busy}><Busy on={busy}>{!busy && <Ico n="pulso" />}Probar flujos</Busy></button>}
        </div>
      </div>
      {(topo.error || err) && <div className="alerta">{topo.error || err}</div>}
      {t && (
        <div className="topo-layout">
          <div className="panel mapa">
            {vista === "app" ? <VistaApp topo={t} orq={orq.data} sel={sel} onSel={setSel} /> : <VistaGestion sel={sel} onSel={setSel} orq={orq.data} />}
            <div className="leyenda">
              {vista === "app" ? <>
                <span><i style={{ borderColor: VERDE }} />Permitido y funciona</span>
                <span><i style={{ borderColor: GRIS, borderTopStyle: "dashed" }} />Bloqueado, como debe</span>
                <span><i style={{ borderColor: ROJO, borderTopStyle: "dashed" }} />Riesgo</span>
                <span><i style={{ borderColor: AZUL }} />Entrada al clúster</span>
              </> : <>
                <span><i style={{ borderColor: AZUL }} />Conexión normal</span>
                <span><i style={{ borderColor: VERDE }} />Acceso restringido (candado)</span>
                <span><i style={{ borderColor: "#FFD25C" }} />Agente trabajando ahora</span>
                <span><i style={{ borderColor: GRIS, borderTopStyle: "dashed" }} />Agente dormido</span>
              </>}
            </div>
          </div>
          <Ficha sel={sel} topo={t} orq={orq.data} />
        </div>)}
    </>
  );
}
