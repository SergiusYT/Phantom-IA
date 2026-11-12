// node --test src/flujo.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { aristaActiva, estadoAgentes, etapaActual, queHace } from "./flujo.js";

const k8s = (event, role, extra = {}) => ({ agent: "coordinador", kind: "k8s", text: "", payload: { event, role, ...extra } });
const dice = (agent, text, extra = {}) => ({ agent, kind: "say", text, payload: {}, ...extra });

test("los agentes nacen, trabajan en un nodo y terminan al pasar a la siguiente etapa", () => {
  const msgs = [k8s("job", "recolector"), k8s("scheduled", "recolector", { node: "k3d-phantom-server-0" }),
    dice("recolector", "Consulto la API de Kubernetes"), k8s("job", "analista"), k8s("job", "auditor")];
  const e = estadoAgentes(msgs, true);
  assert.equal(e.recolector.fase, "termino");
  assert.equal(e.recolector.nodo, "k3d-phantom-server-0");
  assert.equal(e.analista.fase, "naciendo");
  assert.equal(e.planificador.fase, "dormido");
});

test("caída y reintento de Kubernetes", () => {
  const base = [k8s("job", "auditor"), k8s("scheduled", "auditor", { node: "n" }), k8s("pod_failed", "auditor")];
  assert.equal(estadoAgentes(base, true).auditor.fase, "cayo");
  assert.equal(estadoAgentes(base, true).auditor.caidas, 1);
  const r = estadoAgentes([...base, k8s("retry", "auditor", { attempt: 2 })], true).auditor;
  assert.equal(r.fase, "trabajando");
  assert.equal(r.intento, 2);
});

test("al terminar la auditoría todos los que trabajaron quedan terminados", () => {
  const e = estadoAgentes([k8s("job", "recolector"), { agent: "coordinador", kind: "done", text: "fin", payload: {} }], false);
  assert.equal(e.recolector.fase, "termino");
});

test("cada razonamiento con IA conecta al agente con Ollama, en vivo o repetido", () => {
  for (const agent of ["recolector", "analista", "auditor"]) {
    assert.deepEqual(aristaActiva({ agent, kind: "say", text: "x", streaming: false, payload: { ai: true, title: "t" } }), ["ollama", agent]);
  }
  assert.deepEqual(aristaActiva({ agent: "planificador", kind: "say", text: "x", streaming: false, payload: { operation: "pf_block_port", title: "t" } }), ["ollama", "planificador"]);
});

test("el recolector se conecta con lo que está leyendo", () => {
  assert.deepEqual(aristaActiva(dice("recolector", "Ahora el firewall FreeBSD en 172.16.97.132")), ["recolector", "firewall"]);
  assert.deepEqual(aristaActiva(dice("recolector", "Consulto la API de Kubernetes")), ["recolector", "app"]);
  assert.deepEqual(aristaActiva({ agent: "recolector", kind: "test", text: "", payload: { test: { layer: "perimetro" } } }), ["recolector", "firewall"]);
  assert.deepEqual(aristaActiva(k8s("job", "auditor")), ["coordinador", "auditor"]);
  assert.deepEqual(aristaActiva({ agent: "planificador", kind: "proposal", text: "", payload: {} }), ["planificador", "operador"]);
});

test("la frase 'Ahora' explica en lenguaje simple", () => {
  assert.match(queHace({ agent: "analista", kind: "say", text: "x", payload: { ai: true, title: "Diagnóstico" } }), /analista.*IA/i);
  assert.match(queHace(dice("recolector", "Ahora el firewall FreeBSD")), /firewall/i);
  assert.match(queHace(k8s("pod_failed", "auditor")), /cayó/i);
});

test("la etapa sale del estado de los agentes", () => {
  assert.equal(etapaActual(estadoAgentes([k8s("job", "recolector")], true), true), 0);
  assert.equal(etapaActual(estadoAgentes([k8s("job", "recolector"), k8s("job", "analista")], true), true), 1);
  assert.equal(etapaActual(estadoAgentes([k8s("job", "planificador")], true), true), 2);
  assert.equal(etapaActual({}, false), 3);
});

import { esperaPara } from "./flujo.js";

test("un razonamiento con IA se queda en pantalla el tiempo suficiente para ver la conexión", () => {
  const ia = { agent: "recolector", kind: "say", text: "x", payload: { ai: true, title: "t" } };
  assert.ok(esperaPara(ia, 30) >= 4000);
  assert.ok(esperaPara({ agent: "planificador", kind: "say", text: "x", payload: { operation: "op" } }, 30) >= 4000);
});

test("los mensajes normales se ponen al día rápido si hay atraso", () => {
  const normal = { agent: "recolector", kind: "test", text: "", payload: {} };
  assert.equal(esperaPara(undefined, 20), 300);
  assert.ok(esperaPara(normal, 20) <= 500);
  assert.ok(esperaPara(normal, 1) >= 1200);
});
