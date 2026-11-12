import React from "react";
import { Ico, Logo } from "./ui.jsx";
import { Tech, TechG } from "./tech.jsx";

/* Escena viva: trafico externo atraviesa el firewall PF; dentro del cluster solo circulan
   los flujos autorizados y el intento frontend -> db se detiene en la politica. */
function Escena() {
  const paquete = (path, dur, color = "#3CF5A2", delay = 0) => (
    <circle r="4" fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }}>
      <animateMotion dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" path={path} />
    </circle>
  );
  const nodo = (x, y, titulo, tech, color = "#3CF5A2") => (
    <g transform={`translate(${x},${y})`}>
      <rect x="-64" y="-28" width="128" height="56" rx="10" fill="#07110C" stroke={color} strokeOpacity=".8" />
      <TechG n={tech} x={-38} y={0} size={26} />
      <text x="-18" y="5" fill="#F2FFF8" fontFamily="Chakra Petch" fontWeight="600" fontSize="15">{titulo}</text>
    </g>
  );
  const pInet = "M70,230 L232,230";
  const pFwFe = "M300,230 L420,230";
  const pFeApi = "M548,212 C600,170 610,130 642,120";
  const pApiDb = "M706,150 L706,290";
  const pFeDb = "M548,248 C590,290 600,315 610,318";
  const pAtaque = "M70,262 L222,262";
  return (
    <svg viewBox="0 0 800 440" role="img" aria-label="Tráfico atravesando el firewall FreeBSD y las políticas de Kubernetes">
      <defs>
        <pattern id="pts" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="rgba(60,245,162,.12)" /></pattern>
      </defs>
      <rect x="380" y="40" width="400" height="370" rx="16" fill="url(#pts)" stroke="#1D3729" strokeDasharray="5 5" />
      <TechG n="kubernetes" x={408} y={62} size={22} /><text x="426" y="67" fill="#8FB3A2" fontFamily="Instrument Sans" fontSize="13">Kubernetes</text>
      {/* trazas */}
      {[pInet, pFwFe, pFeApi, pApiDb].map((d) => <path key={d} d={d} fill="none" stroke="#3CF5A2" strokeOpacity=".45" strokeWidth="1.6" />)}
      <path d={pFeDb} fill="none" stroke="#FF4D5E" strokeOpacity=".5" strokeWidth="1.6" strokeDasharray="5 5" />
      <path d={pAtaque} fill="none" stroke="#FF4D5E" strokeOpacity=".5" strokeWidth="1.6" strokeDasharray="5 5" />
      {/* paquetes */}
      {paquete(pInet, 2.2)}{paquete(pFwFe, 1.6, "#3CF5A2", .6)}{paquete(pFeApi, 1.8, "#3CF5A2", .2)}
      {paquete(pApiDb, 1.6, "#3CF5A2", 1)}{paquete(pAtaque, 2.4, "#FF4D5E", .4)}{paquete(pFeDb, 2.4, "#FF4D5E", 1.2)}
      {/* bloqueos */}
      <g transform="translate(228,262)"><circle r="11" fill="#1A0609" stroke="#FF4D5E" /><path d="M-4,-4 4,4M4,-4-4,4" stroke="#FF4D5E" strokeWidth="2" /></g>
      <g transform="translate(616,320)"><circle r="11" fill="#1A0609" stroke="#FF4D5E" /><path d="M-4,-4 4,4M4,-4-4,4" stroke="#FF4D5E" strokeWidth="2" /></g>
      <text x="80" y="290" fill="#FF8A95" fontFamily="Instrument Sans" fontSize="12">puerto 8081 bloqueado</text>
      <text x="80" y="214" fill="#8FB3A2" fontFamily="Instrument Sans" fontSize="12">HTTPS permitido</text>
      <text x="500" y="372" fill="#FF8A95" fontFamily="Instrument Sans" fontSize="12">Web → Datos: bloqueado</text>
      {/* nodos */}
      <g transform="translate(40,246)"><circle r="26" fill="#07110C" stroke="#5C7A6C" /><text y="4" textAnchor="middle" fill="#8FB3A2" fontFamily="Chakra Petch" fontSize="11">Internet</text></g>
      <g transform="translate(266,246)">
        <path d="M0,-46 L-34,-32 V2 C-34,26 -18,42 0,50 C18,42 34,26 34,2 V-32 Z" fill="#100A04" stroke="#FFB547" strokeWidth="1.6" />
        <TechG n="freebsd" x={0} y={0} size={34} />
      </g>
      {nodo(484, 230, "Web", "nginx")}
      {nodo(706, 120, "API", "python")}
      {nodo(706, 320, "Datos", "postgres")}
    </svg>
  );
}

const PLANOS = [
  ["kubernetes", "Kubernetes", "Ve tus aplicaciones y separa quién puede hablar con quién."],
  ["freebsd", "Firewall FreeBSD", "Encuentra puertos abiertos de más y los cierra."],
  ["ollama", "Agentes de IA", "Revisan, explican y proponen. Tú decides."],
];

const PASOS = [
  ["Recolecta", "Estado del clúster y del firewall"],
  ["Analiza", "Anomalías operativas y flujos caídos"],
  ["Audita", "Riesgos frente a reglas definidas"],
  ["Propone", "Cambio exacto, impacto y pruebas"],
  ["Aprueba", "Una persona decide"],
  ["Aplica y verifica", "Pruebas antes y después, con reversión"],
];

export default function Portada({ entrar }) {
  return (
    <div className="portada">
      <nav className="portada-nav">
        <div className="marca" style={{ padding: 0 }}><Logo />PHANTOM AI</div>
        <button className="btn" onClick={entrar}>Abrir la consola</button>
      </nav>
      <section className="hero">
        <div>
          <h1 className="wordmark">PHANTOM<span>AI</span></h1>
          <p className="bajada">
            Agentes de IA que vigilan tu red, <strong>encuentran riesgos y los corrigen cuando tú lo apruebas.</strong>
          </p>
          <div className="fila">
            <button className="btn primary lg" onClick={entrar}><Ico n="escudo" />Abrir la consola</button>
            <a className="btn ghost lg" href="#recorrido" style={{ textDecoration: "none" }}>Cómo funciona</a>
          </div>
        </div>
        <div className="escena">
          <Escena />
          <div className="marcador"><span className="led ok" />Tráfico de laboratorio simulado</div>
        </div>
      </section>
      <section className="planos">
        {PLANOS.map(([i, t, d]) => (
          <div className="panel" key={t}><Tech n={i} size={30} /><h2>{t}</h2><p>{d}</p></div>))}
      </section>
      <section className="recorrido" id="recorrido">
        <h2>De la consulta a la corrección verificada</h2>
        <ol>{PASOS.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ol>
      </section>
    </div>
  );
}
