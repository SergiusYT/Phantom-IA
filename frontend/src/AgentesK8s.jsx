import React from "react";
import { AGENTES } from "./Sala.jsx";
import { Ico } from "./ui.jsx";
import { Tech } from "./tech.jsx";

/* Agentes IA orquestados por Kubernetes: un Job (pod) por agente y por auditoria. */
export const ROLES = ["recolector", "analista", "auditor", "planificador"];
const FASE = {
  pending: ["Kubernetes lo está creando", "esp"], running: ["Trabajando", "ok"],
  complete: ["Terminó su parte", "fin"], failed: ["Falló", "mal"],
};

export function ultimaAuditoria(agents) {
  const ids = (agents?.jobs || []).map((j) => Number(j.audit)).filter(Boolean);
  return ids.length ? Math.max(...ids) : null;
}

const corto = (n) => n?.replace("k3d-phantom-", "");

function Tarjeta({ rol, job, pods }) {
  const ag = AGENTES[rol];
  const caidos = pods.filter((p) => p.state === "Failed");
  const actual = [...pods].reverse().find((p) => p.state !== "Failed");
  const [txt, tono] = job ? FASE[job.phase] || [job.phase, "esp"] : ["Dormido: nace al auditar", "zz"];
  return (
    <div className={`agente-k ${tono}`} style={{ "--a": ag.color }}>
      <span className="agente-ico"><Ico n={ag.ico} /></span>
      <div>
        <b>{ag.nombre}</b>
        <span><i className={`led ${tono === "zz" || tono === "fin" ? "" : tono}`} />{txt}</span>
      </div>
      {(actual || caidos.length > 0) && (
        <div className="agente-pods">
          {caidos.map((p) => <span key={p.name} className="mini caido" title={p.name}>pod caído</span>)}
          {actual && <span className="mini" title={actual.name}>{`pod en ${corto(actual.node) || "…"}`}</span>}
        </div>)}
    </div>
  );
}

export default function AgentesK8s({ agents, ai }) {
  const audit = ultimaAuditoria(agents);
  const jobs = (agents?.jobs || []).filter((j) => Number(j.audit) === audit);
  const pods = (agents?.pods || []).filter((p) => Number(p.audit) === audit);
  const ollama = ai?.pods?.[0];
  const activos = jobs.filter((j) => j.phase === "running" || j.phase === "pending").length;
  return (
    <div className="agentes-k8s">
      <div className="capa-t sub">
        <Ico n="cerebro" /><b>Agentes IA</b>
        <span>{activos ? `${activos} trabajando ahora` : audit ? `última auditoría: ${audit}` : "esperan a que pidas una auditoría"} · namespace phantom-agents</span>
      </div>
      <div className="agentes-fila">
        {ROLES.map((r) => (
          <Tarjeta key={r} rol={r} job={jobs.find((j) => j.agent === r)} pods={pods.filter((p) => p.agent === r)} />))}
        <div className={`agente-k ia ${ai?.ready ? "ok" : "mal"}`}>
          <span className="agente-ico"><Tech n="ollama" size={22} /></span>
          <div>
            <b>IA local (Mistral)</b>
            <span><i className={`led ${ai?.ready ? "ok" : "mal"}`} />{ai?.ready ? "Siempre encendida" : "No disponible"}</span>
          </div>
          {ollama && <div className="agente-pods"><span className="mini">{`pod en ${corto(ollama.node)}`}</span></div>}
        </div>
      </div>
    </div>
  );
}
