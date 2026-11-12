import React from "react";
import { ROLES, aristaActiva } from "./flujo.js";
import { TechG } from "./tech.jsx";

/* Mapa vivo de la auditoría: Kubernetes con un pod por agente, la IA, lo que se audita y tú.
   La conexión encendida muestra qué está haciendo el agente que habla ahora mismo. */
const P = {
  coordinador: { x: 90, y: 300, r: 40 },
  recolector: { x: 310, y: 260, r: 36 },
  analista: { x: 500, y: 215, r: 36 },
  auditor: { x: 500, y: 375, r: 36 },
  planificador: { x: 690, y: 295, r: 36 },
  operador: { x: 920, y: 300, r: 32 },
  firewall: { x: 330, y: 62 },
  app: { x: 610, y: 62 },
  ollama: { x: 500, y: 528 },
};
const ARISTAS = {
  "coordinador-recolector": "M130,300 C200,300 230,262 274,260",
  "coordinador-analista": "M128,288 C220,205 380,195 464,212",
  "coordinador-auditor": "M128,312 C220,395 380,400 464,378",
  "coordinador-planificador": "M122,276 C190,132 690,140 690,259",
  "recolector-firewall": "M312,224 L330,90",
  "recolector-app": "M334,233 C400,150 560,140 600,90",
  "recolector-analista": "M346,252 L464,222",
  "recolector-auditor": "M342,277 C400,330 430,368 464,372",
  "analista-planificador": "M536,222 C600,230 640,258 658,280",
  "auditor-planificador": "M536,368 C600,360 640,332 660,314",
  "auditor-analista": "M500,339 L500,251",
  "planificador-operador": "M726,296 L888,299",
  "coordinador-operador": "M96,340 C130,612 880,612 916,332",
  "recolector-ollama": "M312,296 C318,440 380,524 405,526",
  "analista-ollama": "M470,236 C390,290 400,480 466,506",
  "auditor-ollama": "M500,411 L500,504",
  "planificador-ollama": "M688,331 C680,452 620,524 595,526",
};
const FASE = {
  dormido: "dormido", naciendo: "naciendo…", trabajando: "trabajando", cayo: "cayó", termino: "terminó",
};
const corto = (n) => (n || "").replace("k3d-phantom-", "");

function clave(a, b) {
  return ARISTAS[`${a}-${b}`] ? [`${a}-${b}`, false] : ARISTAS[`${b}-${a}`] ? [`${b}-${a}`, true] : [null, false];
}

function Agente({ id, ag, est, habla, cuenta, iconos }) {
  const n = P[id];
  const vivo = est.fase === "trabajando" || est.fase === "naciendo";
  const borde = est.fase === "cayo" ? "#FF4D5E" : est.fase === "dormido" ? "#2A4A3A" : ag.color;
  const sub = est.fase === "trabajando" && est.nodo ? `· ${corto(est.nodo)}` : est.fase === "cayo" ? `×${est.caidas}` : est.intento > 1 && est.fase !== "dormido" ? `intento ${est.intento}` : "";
  return (
    <g className={`mv-agente ${est.fase}`} opacity={est.fase === "dormido" ? 0.5 : 1}>
      {habla && <circle cx={n.x} cy={n.y} r={n.r + 5} fill="none" stroke={ag.color} strokeWidth="2" className="onda-svg" />}
      {est.fase === "naciendo" && <circle cx={n.x} cy={n.y} r={n.r + 9} fill="none" stroke="#FFB547" strokeWidth="1.5" strokeDasharray="4 5" className="giro-svg" />}
      <circle cx={n.x} cy={n.y} r={n.r} fill="#07110C" stroke={borde} strokeWidth={vivo || habla ? 2.6 : 1.5}
        strokeDasharray={est.fase === "dormido" ? "5 4" : ""} style={vivo ? { filter: `drop-shadow(0 0 10px ${ag.color})` } : null} />
      <svg x={n.x - 13} y={n.y - 13} width="26" height="26" viewBox="0 0 24 24" className="ico" style={{ color: ag.color }}>{iconos[ag.ico]}</svg>
      <text x={n.x} y={n.y + n.r + 19} textAnchor="middle" fill="#F2FFF8" fontSize="15.5" fontFamily="Chakra Petch" fontWeight="600">{ag.nombre}</text>
      <g transform={`translate(${n.x},${n.y + n.r + 34})`}>
        <rect x="-84" y="-10" width="168" height="19" rx="9.5" fill="#07110C" stroke={borde} strokeOpacity=".6" />
        <text textAnchor="middle" y="4" fontSize="11" fontFamily="JetBrains Mono" fill={est.fase === "cayo" ? "#FF4D5E" : "#8FB3A2"}>
          {`pod ${FASE[est.fase]}${sub ? ` ${sub}` : ""}`}</text>
      </g>
      {cuenta > 0 && <g transform={`translate(${n.x + n.r * 0.72},${n.y - n.r * 0.72})`}>
        <circle r="11" fill={ag.color} /><text y="4" textAnchor="middle" fontSize="11" fontFamily="JetBrains Mono" fill="#02140B" fontWeight="600">{cuenta}</text></g>}
    </g>
  );
}

function Sistema({ id, x, y, w, tech, titulo, sub, on, alerta }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-w / 2} y="-27" width={w} height="54" rx="10" fill="#07110C" stroke={alerta ? "#FF4D5E" : on ? "#3CF5A2" : "#1D3729"}
        strokeWidth={on ? 2.2 : 1.4} style={on ? { filter: "drop-shadow(0 0 8px #3CF5A2)" } : null} />
      <TechG n={tech} x={-w / 2 + 24} y={0} size={24} />
      <text x={-w / 2 + 44} y="-3" fill="#F2FFF8" fontSize="14.5" fontFamily="Chakra Petch" fontWeight="600">{titulo}</text>
      <text x={-w / 2 + 44} y="14" fill="#8FB3A2" fontSize="12" fontFamily="Instrument Sans">{sub}</text>
      {id === "ollama" && on && <text x={w / 2 - 10} y="-12" textAnchor="end" fill="#3CF5A2" fontSize="10.5" fontFamily="JetBrains Mono">pensando…</text>}
    </g>
  );
}

export default function MapaVivo({ msgs, corriendo, agentes, iconos, estado }) {
  const ultimo = msgs[msgs.length - 1];
  const activa = corriendo ? aristaActiva(ultimo) : null;
  const [k, invertida] = activa ? clave(activa[0], activa[1]) : [null, false];
  const enciende = (id) => !!activa && activa.includes(id);
  const color = activa ? (agentes[activa[0]]?.color || agentes[activa[1]]?.color || "#3CF5A2") : "#3CF5A2";
  const cuenta = msgs.reduce((a, m) => ({ ...a, [m.agent]: (a[m.agent] || 0) + 1 }), {});
  const habla = corriendo ? ultimo?.agent : null;

  return (
    <svg className="mapa-vivo" viewBox="38 26 932 590" role="img" aria-label="Mapa en vivo de la auditoría">
      <defs>
        <pattern id="mv-pt" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="rgba(60,245,162,.08)" /></pattern>
        <radialGradient id="mv-halo"><stop offset="0" stopColor="#3CF5A2" stopOpacity=".14" /><stop offset="1" stopColor="#3CF5A2" stopOpacity="0" /></radialGradient>
      </defs>
      {/* Kubernetes */}
      <rect x="190" y="125" width="620" height="455" rx="16" fill="url(#mv-pt)" stroke="rgba(50,108,229,.55)" strokeDasharray="6 5" />
      <circle cx="500" cy="300" r="230" fill="url(#mv-halo)" />
      <TechG n="kubernetes" x={212} y={146} size={20} />
      <text x="230" y="151" fill="#8FB3A2" fontSize="13" fontFamily="Instrument Sans">Kubernetes</text>
      <text x="230" y="168" fill="#5C7A6C" fontSize="11" fontFamily="JetBrains Mono">phantom-agents · un pod por agente</text>
      <line x1="205" y1="478" x2="795" y2="478" stroke="#14271D" strokeDasharray="4 5" />
      <text x="795" y="496" textAnchor="end" fill="#5C7A6C" fontSize="11" fontFamily="JetBrains Mono">phantom-ai</text>

      {/* conexiones */}
      {Object.entries(ARISTAS).map(([id, d]) => {
        const on = id === k;
        return <path key={id} d={d} fill="none" stroke={on ? color : "#16301F"} strokeWidth={on ? 2.8 : 1.2}
          strokeOpacity={on ? 1 : 0.9} strokeDasharray={id.endsWith("ollama") && !on ? "3 5" : ""}
          style={on ? { filter: `drop-shadow(0 0 6px ${color})` } : null} />;
      })}
      {k && (
        <circle key={`p-${ultimo.seq}-${k}`} r="6" fill={color} style={{ filter: `drop-shadow(0 0 8px ${color})` }}>
          <animateMotion dur="1.2s" repeatCount="indefinite" path={ARISTAS[k]} keyPoints={invertida ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear" />
        </circle>)}

      {/* fuera de Kubernetes */}
      <g opacity={enciende("coordinador") || !corriendo ? 1 : 0.85}>
        {habla === "coordinador" && <circle cx={P.coordinador.x} cy={P.coordinador.y} r="45" fill="none" stroke={agentes.coordinador.color} strokeWidth="2" className="onda-svg" />}
        <circle cx={P.coordinador.x} cy={P.coordinador.y} r="40" fill="#07110C" stroke={agentes.coordinador.color} strokeWidth={enciende("coordinador") ? 2.6 : 1.5} />
        <svg x={P.coordinador.x - 14} y={P.coordinador.y - 14} width="28" height="28" viewBox="0 0 24 24" className="ico" style={{ color: agentes.coordinador.color }}>{iconos.director}</svg>
        <text x={P.coordinador.x} y={P.coordinador.y + 61} textAnchor="middle" fill="#F2FFF8" fontSize="15.5" fontFamily="Chakra Petch" fontWeight="600">Coordinador</text>
        <text x={P.coordinador.x} y={P.coordinador.y + 77} textAnchor="middle" fill="#5C7A6C" fontSize="11" fontFamily="JetBrains Mono">backend</text>
      </g>
      <g>
        <circle cx={P.operador.x} cy={P.operador.y} r="32" fill="#07110C" stroke={enciende("operador") ? "#3CF5A2" : "#5C7A6C"} strokeWidth={enciende("operador") ? 2.4 : 1.4} />
        <svg x={P.operador.x - 13} y={P.operador.y - 13} width="26" height="26" viewBox="0 0 24 24" className="ico" style={{ color: "#F2FFF8" }}>{iconos.usuario}</svg>
        <text x={P.operador.x} y={P.operador.y + 52} textAnchor="middle" fill="#F2FFF8" fontSize="15.5" fontFamily="Chakra Petch" fontWeight="600">Tú</text>
        <text x={P.operador.x} y={P.operador.y + 68} textAnchor="middle" fill="#5C7A6C" fontSize="11" fontFamily="Instrument Sans">apruebas</text>
      </g>
      <Sistema id="firewall" x={P.firewall.x} y={P.firewall.y} w={190} tech="freebsd" titulo="Firewall" sub="FreeBSD PF · solo lectura" on={enciende("firewall")} />
      <Sistema id="app" x={P.app.x} y={P.app.y} w={200} tech="kubernetes" titulo="App auditada" sub="Web · API · Datos" on={enciende("app")} />
      <Sistema id="ollama" x={P.ollama.x} y={P.ollama.y} w={210} tech="ollama" titulo="IA local" sub="Mistral · la usan los 4" on={enciende("ollama")} />

      {ROLES.map((r) => <Agente key={r} id={r} ag={agentes[r]} est={estado[r]} habla={habla === r} cuenta={cuenta[r] || 0} iconos={iconos} />)}
    </svg>
  );
}
