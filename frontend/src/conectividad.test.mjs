// node --test src/conectividad.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { aristaDePrueba, matrizK8s, puertasFirewall, resumen } from "./conectividad.js";

const RES = [
  { id: "fe-api", name: "frontend -> api:8080", layer: "kubernetes", expect: true, reachable: true, ok: true },
  { id: "api-db", name: "api -> db:5432", layer: "kubernetes", expect: true, reachable: true, ok: true },
  { id: "fe-db", name: "frontend -> db:5432", layer: "kubernetes", expect: false, reachable: true, ok: false },
  { id: "pf-80", name: "Internet -> Web :80", layer: "perimetro", port: 80, expect: true, reachable: true, ok: true },
  { id: "pf-443", name: "Internet -> Web :443", layer: "perimetro", port: 443, expect: true, reachable: true, ok: true },
  { id: "pf-8081", name: "Internet -> firewall :8081", layer: "perimetro", port: 8081, expect: false, reachable: true, ok: false },
];
const FW = { allowed: [22, 80, 443], listening: [22, 8081], blocked: [], enabled: true,
  forwards: [{ port: 80, to_host: "172.16.97.1", to_port: 30080 }, { port: 443, to_host: "172.16.97.1", to_port: 30080 }] };

test("cada puerto del firewall es una puerta con su papel y el resultado de su prueba", () => {
  const p = Object.fromEntries(puertasFirewall(FW, RES).map((x) => [x.port, x]));
  assert.deepEqual(Object.keys(p).map(Number), [22, 80, 443, 8081]);
  assert.equal(p[22].rol, "gestion");
  assert.equal(p[80].rol, "reenvio");
  assert.equal(p[80].destino, "172.16.97.1:30080");
  assert.equal(p[80].estado, "ok");
  assert.equal(p[8081].rol, "sobra");
  assert.equal(p[8081].estado, "mal");
  assert.equal(p[22].estado, "sin");
});

test("un puerto bloqueado por PHANTOM se muestra cerrado", () => {
  const fixed = RES.map((r) => (r.id === "pf-8081" ? { ...r, reachable: false, ok: true } : r));
  const p = Object.fromEntries(puertasFirewall({ ...FW, blocked: [8081] }, fixed).map((x) => [x.port, x]));
  assert.equal(p[8081].rol, "bloqueado");
  assert.equal(p[8081].estado, "ok");
});

test("la matriz de Kubernetes dice quién llega a quién y si debería", () => {
  const m = matrizK8s(RES);
  assert.equal(m.frontend.api.estado, "ok");
  assert.equal(m.frontend.db.estado, "mal");
  assert.equal(m.frontend.db.reachable, true);
  assert.equal(m.api.frontend.estado, "sin");
});

test("resumen y conexión del mapa para cada prueba", () => {
  const r = resumen(RES);
  assert.equal(r.total, 6);
  assert.equal(r.ok, 4);
  assert.deepEqual(r.mal.map((x) => x.id), ["fe-db", "pf-8081"]);
  assert.equal(aristaDePrueba("pf-80"), "inet-fw");
  assert.equal(aristaDePrueba("pf-443"), "inet-fw");
  assert.equal(aristaDePrueba("pf-8081"), "inet-fw-8081");
  assert.equal(aristaDePrueba("fe-db"), "fe-db");
});
