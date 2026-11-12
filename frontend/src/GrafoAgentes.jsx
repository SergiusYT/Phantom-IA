import React from "react";
import { caidosDe } from "./caidos.js";
import { TechG } from "./tech.jsx";

/* Red de agentes: nodos = agentes y sistemas reales; la arista activa muestra quien habla con quien. */
const N = {
  coordinador: { x: 450, y: 225, r: 40 },
  recolector: { x: 235, y: 110, r: 34 },
  analista: { x: 235, y: 345, r: 34 },
  auditor: { x: 665, y: 345, r: 34 },
  planificador: { x: 665, y: 110, r: 34 },
  operador: { x: 845, y: 230, r: 30 },
  kubernetes: { x: 62, y: 60, r: 26, tech: "kubernetes" },
  freebsd: { x: 62, y: 190, r: 26, tech: "freebsd" },
  ollama: { x: 845, y: 60, r: 26, tech: "ollama" },
};
const ARISTAS = [
  ["coordinador", "recolector"], ["coordinador", "analista"], ["coordinador", "auditor"], ["coordinador", "planificador"],
  ["recolector", "kubernetes"], ["recolector", "freebsd"], ["auditor", "planificador"], ["planificador", "ollama"],
  ["recolector", "ollama"], ["analista", "ollama"], ["auditor", "ollama"],
  ["planificador", "operador"], ["coordinador", "operador"],
];
const SISTEMA = { kubernetes: "Kubernetes", freebsd: "FreeBSD", ollama: "IA (mistral)" };

// Que arista representa un mensaje
function aristaDe(m) {
  if (!m) return null;
  if (m.kind === "k8s" && m.payload?.role) return ["coordinador", m.payload.role];
  const t = m.text || "";
  if (m.agent === "recolector") {
    if (m.kind === "test") return ["recolector", m.payload?.test?.layer === "perimetro" ? "freebsd" : "kubernetes"];
    if (/firewall|PF /i.test(t)) return ["recolector", "freebsd"];
    if (/Kubernetes|nodos|pods/i.test(t)) return ["recolector", "kubernetes"];
    return ["recolector", "coordinador"];
  }
  if (m.streaming && (m.payload?.ai || m.agent === "planificador") && N[m.agent]) return ["ollama", m.agent];
  if (m.agent === "planificador" && m.kind === "proposal") return ["planificador", "operador"];
  if (m.kind === "done") return ["coordinador", "operador"];
  if (m.to && N[m.to]) return [m.agent, m.to];
  return [m.agent, "coordinador"];
}

const curva = (a, b) => {
  const A = N[a], B = N[b];
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  const dx = B.x - A.x, dy = B.y - A.y;
  return `M${A.x},${A.y} Q${mx - dy * 0.12},${my + dx * 0.12} ${B.x},${B.y}`;
};

function Globo({ m, agentes }) {
  const nodo = N[m.agent];
  if (!nodo) return null;
  const arriba = nodo.y > 200;
  const w = 300, h = 110;
  const x = Math.min(900 - w - 6, Math.max(6, nodo.x - w / 2));
  const y = arriba ? nodo.y - nodo.r - h - 10 : nodo.y + nodo.r + 30;
  let txt = m.kind === "test" ? `${m.payload.test.name}: ${m.payload.test.reachable ? "responde" : "bloqueado"}`
    : m.kind === "finding" ? m.payload.finding.title
    : m.kind === "proposal" ? `Propongo: ${m.payload.proposal.title}` : m.text;
  if (txt.length > 130) txt = `${m.streaming ? "…" : ""}${m.streaming ? txt.slice(-128) : `${txt.slice(0, 128)}…`}`;
  return (
    <foreignObject x={x} y={y} width={w} height={h} style={{ overflow: "visible" }}>
      <div className={`globo ${arriba ? "arriba" : "abajo"}`} style={{ "--a": agentes[m.agent]?.color }} key={m.seq}>
        {txt}{m.streaming && <span className="cursor" />}
      </div>
    </foreignObject>
  );
}

export default function GrafoAgentes({ msgs, corriendo, agentes, iconos }) {
  const ultimo = msgs[msgs.length - 1];
  const activa = corriendo ? aristaDe(ultimo) : null;
  const cuenta = msgs.reduce((a, m) => ({ ...a, [m.agent]: (a[m.agent] || 0) + 1 }), {});
  const habla = corriendo ? ultimo?.agent : null;
  const caidos = caidosDe(msgs.filter((m) => N[m.agent] || m.kind === "k8s"), corriendo);
  const esActiva = (a, b) => activa && ((activa[0] === a && activa[1] === b) || (activa[0] === b && activa[1] === a));

  return (
    <svg className="grafo" viewBox="0 0 900 440" role="img" aria-label="Red de agentes">
      <defs>
        <radialGradient id="halo"><stop offset="0" stopColor="#3CF5A2" stopOpacity=".18" /><stop offset="1" stopColor="#3CF5A2" stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx="450" cy="225" r="210" fill="url(#halo)" />
      {ARISTAS.map(([a, b]) => {
        const on = esActiva(a, b);
        const color = on ? (agentes[activa[0]]?.color || "#3CF5A2") : "#1D3729";
        return <path key={`${a}-${b}`} d={curva(a, b)} fill="none" stroke={color} strokeWidth={on ? 2.5 : 1.4} strokeOpacity={on ? 1 : .9} style={on ? { filter: `drop-shadow(0 0 6px ${color})` } : null} />;
      })}
      {activa && (
        <circle key={`p-${ultimo.seq}-${activa.join()}`} r="6" fill={agentes[activa[0]]?.color || "#3CF5A2"} style={{ filter: "drop-shadow(0 0 8px currentColor)" }}>
          <animateMotion dur="1.1s" repeatCount="indefinite"
            path={N[activa[0]] && N[activa[1]] && (ARISTAS.some(([a, b]) => a === activa[0] && b === activa[1]) ? curva(activa[0], activa[1]) : curva(activa[1], activa[0]))}
            keyPoints={ARISTAS.some(([a, b]) => a === activa[0] && b === activa[1]) ? "0;1" : "1;0"} keyTimes="0;1" calcMode="linear" />
        </circle>)}
      {Object.entries(N).map(([id, n]) => {
        const ag = agentes[id];
        const on = habla === id || (activa && activa.includes(id));
        if (n.tech) return (
          <g key={id} opacity={on ? 1 : .75}>
            <circle cx={n.x} cy={n.y} r={n.r} fill="#07110C" stroke={on ? "#3CF5A2" : "#1D3729"} strokeWidth="1.5" />
            <TechG n={n.tech} x={n.x} y={n.y} size={26} />
            <text x={n.x} y={n.y + n.r + 16} textAnchor="middle" fill="#8FB3A2" fontSize="14" fontFamily="Instrument Sans">{SISTEMA[id]}</text>
          </g>);
        return (
          <g key={id} className={caidos.has(id) ? "caido-svg" : ""}>
            {caidos.has(id) && <circle cx={n.x} cy={n.y} r={n.r + 6} fill="none" stroke="#FF4D5E" strokeWidth="2.5" />}
            {habla === id && <circle cx={n.x} cy={n.y} r={n.r + 4} fill="none" stroke={ag.color} strokeWidth="2" className="onda-svg" />}
            <circle cx={n.x} cy={n.y} r={n.r} fill="#07110C" stroke={ag.color} strokeWidth={on ? 2.5 : 1.5} strokeOpacity={on ? 1 : .6}
              style={on ? { filter: `drop-shadow(0 0 10px ${ag.color})` } : null} />
            <svg x={n.x - 13} y={n.y - 13} width="26" height="26" viewBox="0 0 24 24" className="ico" style={{ color: ag.color }}>{iconos[ag.ico]}</svg>
            <text x={n.x} y={n.y + n.r + 21} textAnchor="middle" fill="#F2FFF8" fontSize="17" fontFamily="Chakra Petch" fontWeight="600">{ag.nombre}</text>
            {cuenta[id] > 0 && <g transform={`translate(${n.x + n.r * .72},${n.y - n.r * .72})`}>
              <circle r="11" fill={ag.color} /><text y="4" textAnchor="middle" fontSize="11" fontFamily="JetBrains Mono" fill="#02140B" fontWeight="600">{cuenta[id]}</text></g>}
          </g>);
      })}
      {ultimo && <Globo m={ultimo} agentes={agentes} />}
    </svg>
  );
}
