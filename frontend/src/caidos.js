/* Agentes cuyo pod cayó y que Kubernetes aún no ha levantado otra vez.
   Solo cuentan las caídas reales: el evento pod_failed del coordinador o un error con payload.crash.
   Un error normal (p. ej. "no alcanzo la IA, uso plantilla") no es una caída. */
export function caidosDe(msgs, corriendo) {
  const caidos = new Set();
  if (!corriendo) return caidos;
  for (const m of msgs) {
    const p = m.payload || {};
    if (m.kind === "error" && p.crash && m.agent !== "coordinador") caidos.add(m.agent);
    if (m.kind === "k8s" && p.event === "pod_failed") caidos.add(p.role);
    if (m.kind === "k8s" && p.event === "retry") caidos.delete(p.role);
  }
  return caidos;
}
