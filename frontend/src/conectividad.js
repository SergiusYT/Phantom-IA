/* Lógica de la vista de Conectividad y del botón "Probar flujos" de Topología. */

const estadoDe = (r) => (!r || r.reachable === null || r.reachable === undefined ? "sin" : r.ok ? "ok" : "mal");

/* Cada puerto del firewall como una puerta: qué papel tiene y qué dijo su prueba. */
export function puertasFirewall(fw, results = []) {
  if (!fw) return [];
  const pruebas = Object.fromEntries(results.filter((r) => r.layer === "perimetro").map((r) => [r.port ?? Number(String(r.id).split("-")[1]), r]));
  const fwd = Object.fromEntries((fw.forwards || []).map((f) => [f.port, f]));
  const puertos = [...new Set([...(fw.allowed || []), ...(fw.listening || []), ...Object.keys(fwd).map(Number), ...Object.keys(pruebas).map(Number), ...(fw.blocked || [])])]
    .sort((a, b) => a - b);
  return puertos.map((port) => {
    const r = pruebas[port];
    let rol = "cerrado";
    if (port === 22) rol = "gestion";
    else if ((fw.blocked || []).includes(port)) rol = "bloqueado";
    else if (fwd[port]) rol = "reenvio";
    else if ((fw.listening || []).includes(port) && !(fw.allowed || []).includes(port)) rol = "sobra";
    else if ((fw.allowed || []).includes(port)) rol = "permitido";
    return { port, rol, destino: fwd[port] ? `${fwd[port].to_host}:${fwd[port].to_port}` : null, estado: estadoDe(r), prueba: r || null };
  });
}

export const APPS = ["frontend", "api", "db"];
const ID = { "frontend-api": "fe-api", "api-db": "api-db", "frontend-db": "fe-db" };

/* Matriz origen -> destino dentro de Kubernetes. */
export function matrizK8s(results = []) {
  const por = Object.fromEntries(results.map((r) => [r.id, r]));
  const m = {};
  APPS.forEach((a) => {
    m[a] = {};
    APPS.forEach((b) => {
      const r = por[ID[`${a}-${b}`]];
      m[a][b] = a === b ? { mismo: true } : { estado: estadoDe(r), reachable: r?.reachable ?? null, expect: r?.expect ?? null };
    });
  });
  return m;
}

export function resumen(results = []) {
  return { total: results.length, ok: results.filter((r) => r.ok).length, mal: results.filter((r) => !r.ok) };
}

/* Qué conexión del mapa de Topología representa cada prueba. */
export function aristaDePrueba(id) {
  if (id === "pf-80" || id === "pf-443") return "inet-fw";
  if (id === "pf-8081") return "inet-fw-8081";
  return id;
}
