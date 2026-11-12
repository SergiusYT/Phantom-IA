// node --test src/caidos.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { caidosDe } from "./caidos.js";

test("un error no fatal del agente no lo marca como caído", () => {
  const msgs = [{ agent: "planificador", kind: "error", text: "No alcanzo la IA del clúster; uso plantilla.", payload: {} }];
  assert.deepEqual([...caidosDe(msgs, true)], []);
});

test("la caída simulada y el pod caído lo marcan hasta el reintento", () => {
  const caida = [{ agent: "auditor", kind: "error", payload: { crash: true } }];
  assert.deepEqual([...caidosDe(caida, true)], ["auditor"]);
  const podCaido = [{ agent: "coordinador", kind: "k8s", payload: { event: "pod_failed", role: "analista" } }];
  assert.deepEqual([...caidosDe(podCaido, true)], ["analista"]);
  const reintento = [...caida, { agent: "coordinador", kind: "k8s", payload: { event: "retry", role: "auditor" } }];
  assert.deepEqual([...caidosDe(reintento, true)], []);
});

test("sin auditoría en curso no se marca nada", () => {
  assert.deepEqual([...caidosDe([{ agent: "auditor", kind: "error", payload: { crash: true } }], false)], []);
});
