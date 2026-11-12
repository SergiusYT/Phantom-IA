/* Lógica de la auditoría en vivo, derivada solo de los mensajes: así el mapa y la conversación
   van siempre sincronizados, tanto en vivo como al repetir una auditoría terminada. */

export const ROLES = ["recolector", "analista", "auditor", "planificador"];
const ETAPA_DE = { recolector: 0, analista: 1, auditor: 1, planificador: 2 };
export const ETAPAS = ["Recolectar", "Analizar y auditar", "Proponer", "Listo"];
const NOMBRE = { recolector: "El recolector", analista: "El analista", auditor: "El auditor", planificador: "El planificador" };

const esIA = (m) => m.agent && (m.payload?.ai || (m.agent === "planificador" && m.kind === "say" && m.payload?.operation));

/* Estado del pod de cada agente: dormido · naciendo · trabajando · cayo · termino */
export function estadoAgentes(msgs, corriendo) {
  const e = Object.fromEntries(ROLES.map((r) => [r, { fase: "dormido", nodo: null, caidas: 0, intento: 1 }]));
  const terminarAntesDe = (etapa) => ROLES.forEach((r) => {
    if (ETAPA_DE[r] < etapa && e[r].fase !== "dormido" && e[r].fase !== "cayo") e[r].fase = "termino";
  });
  for (const m of msgs) {
    const p = m.payload || {};
    if (m.kind === "k8s" && e[p.role]) {
      const a = e[p.role];
      if (p.event === "job") { terminarAntesDe(ETAPA_DE[p.role]); a.fase = "naciendo"; }
      if (p.event === "scheduled") { a.nodo = p.node; if (a.fase !== "cayo") a.fase = "trabajando"; }
      if (p.event === "pod_failed") { a.fase = "cayo"; a.caidas += 1; }
      if (p.event === "retry") { a.fase = "trabajando"; a.intento = p.attempt || a.intento + 1; }
    } else if (e[m.agent] && m.kind !== "proposal") {
      if (m.kind === "error" && p.crash) { e[m.agent].fase = "cayo"; }
      else if (e[m.agent].fase === "naciendo" || e[m.agent].fase === "dormido") e[m.agent].fase = "trabajando";
    } else if (m.agent === "coordinador" && (m.kind === "done" || m.kind === "error")) {
      ROLES.forEach((r) => { if (e[r].fase !== "dormido") e[r].fase = m.kind === "done" ? "termino" : e[r].fase === "trabajando" ? "termino" : e[r].fase; });
    }
  }
  if (!corriendo) ROLES.forEach((r) => { if (["naciendo", "trabajando"].includes(e[r].fase)) e[r].fase = "termino"; });
  return e;
}

export function etapaActual(estado, corriendo) {
  if (!corriendo) return 3;
  if (estado.planificador && estado.planificador.fase !== "dormido") return 2;
  if ((estado.analista && estado.analista.fase !== "dormido") || (estado.auditor && estado.auditor.fase !== "dormido")) return 1;
  return 0;
}

/* Qué conexión se ilumina con un mensaje: [origen, destino] */
export function aristaActiva(m) {
  if (!m) return null;
  const p = m.payload || {};
  const t = m.text || "";
  if (m.kind === "k8s" && p.role) return ["coordinador", p.role];
  if (esIA(m)) return ["ollama", m.agent];
  if (m.agent === "recolector") {
    if (m.kind === "test") return ["recolector", p.test?.layer === "perimetro" ? "firewall" : "app"];
    if (/firewall|PF /i.test(t)) return ["recolector", "firewall"];
    if (/Kubernetes|nodos|pods/i.test(t)) return ["recolector", "app"];
    return ["recolector", "coordinador"];
  }
  if (m.kind === "proposal") return ["planificador", "operador"];
  if (m.kind === "done") return ["coordinador", "operador"];
  if (m.agent === "auditor" && m.to === "planificador") return ["auditor", "planificador"];
  if (m.to && m.to !== "operador") return [m.agent, m.to];
  return [m.agent, "coordinador"];
}

/* La frase "Ahora:" en lenguaje simple */
export function queHace(m) {
  if (!m) return "Esperando a que empiece la auditoría.";
  const p = m.payload || {};
  if (m.kind === "k8s" && NOMBRE[p.role]) {
    const rol = p.role;
    if (p.event === "job") return `Kubernetes está creando el pod del ${rol}.`;
    if (p.event === "scheduled") return `Kubernetes programó al ${rol} en el nodo ${String(p.node || "").replace("k3d-phantom-", "")}.`;
    if (p.event === "pod_failed") return `El pod del ${rol} se cayó; Kubernetes lo levantará otra vez.`;
    if (p.event === "retry") return `Kubernetes levantó un pod nuevo para el ${rol} (intento ${p.attempt}).`;
  }
  if (esIA(m)) return `${NOMBRE[m.agent]} está razonando con la IA: ${(p.title || "").toLowerCase()}.`;
  if (m.agent === "recolector") {
    if (m.kind === "test") return `El recolector prueba un flujo de red: ${p.test?.name}.`;
    if (/firewall|PF /i.test(m.text || "")) return "El recolector está leyendo el firewall FreeBSD (solo lectura).";
    if (/Kubernetes/i.test(m.text || "")) return "El recolector está leyendo el clúster de la app auditada.";
  }
  if (m.kind === "finding") return `${NOMBRE[m.agent] || "Un agente"} encontró: ${p.finding?.title}.`;
  if (m.kind === "proposal") return "El planificador te entrega una propuesta para que decidas.";
  if (m.kind === "done") return "Auditoría terminada. Revisa las propuestas.";
  if (m.kind === "error") return "Hubo un problema; mira la conversación.";
  return `${NOMBRE[m.agent] || "El coordinador"} habla${m.to && NOMBRE[m.to] ? ` con ${NOMBRE[m.to].toLowerCase()}` : ""}.`;
}

/* Cuánto se queda un mensaje en pantalla antes de mostrar el siguiente (reproducción).
   `actual` es el último mensaje visible; `atraso`, cuántos faltan por mostrar. */
export function esperaPara(actual, atraso) {
  if (!actual) return 300;
  if (esIA(actual)) return 4500;          // que se vea al agente conectado con la IA
  return atraso > 10 ? 450 : atraso > 4 ? 900 : 1600;
}
