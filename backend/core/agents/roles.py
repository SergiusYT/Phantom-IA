"""Trabajo de cada agente, independiente de dónde se ejecute.

Cada función recibe un `chat` con la interfaz say/stream/end_stream:
- en el backend (modo local, pruebas) es el Chat que escribe AuditMessage en la base;
- en un pod de Kubernetes es RemoteChat, que publica por la API de agentes.
Devuelven datos serializables a JSON (los entrega el pod como resultado del Job).
"""
from django.conf import settings

from .. import connectivity
from ..adapters import k8s, pf
from . import analyst, auditor, llm, planner

SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"]


def _plural(n, uno, varios):
    return f"{n} {uno if n == 1 else varios}"


def run_recolector(chat):
    snap, errors = {"k8s": None, "pf": None, "connectivity": []}, []
    chat.say("recolector", f"Consulto la API de Kubernetes en el namespace {settings.PHANTOM['NAMESPACE']}.")
    try:
        k = k8s.collect()
        snap["k8s"] = k
        ok = sum(1 for p in k["pods"] if p["phase"] == "Running" and p["ready"])
        chat.say("recolector", f"Listo. {_plural(len(k['nodes']), 'nodo', 'nodos')}, {ok} de {len(k['pods'])} pods "
                 f"operativos, {_plural(len(k['services']), 'servicio', 'servicios')} y "
                 f"{_plural(len(k['network_policies']), 'NetworkPolicy', 'NetworkPolicies')}.", kind="data",
                 facts=[{"k": "Nodos", "v": len(k["nodes"])}, {"k": "Pods", "v": f"{ok}/{len(k['pods'])}"},
                        {"k": "Servicios", "v": len(k["services"])}, {"k": "Políticas", "v": len(k["network_policies"])}])
    except k8s.K8sError as exc:
        errors.append(f"kubernetes: {exc}")
        chat.say("recolector", f"No pude consultar Kubernetes: {exc}", kind="error")

    chat.say("recolector", f"Ahora el firewall FreeBSD en {settings.PHANTOM['PF_HOST']}, por el canal restringido.")
    try:
        p = pf.collect()
        snap["pf"] = p
        chat.say("recolector", f"PF está {'activo' if p['enabled'] else 'INACTIVO'} con "
                 f"{_plural(len(p['rules']), 'regla', 'reglas')}. Hay servicios escuchando en los puertos "
                 f"{', '.join(map(str, p['listening']))}.", kind="data",
                 facts=[{"k": "PF", "v": "activo" if p["enabled"] else "inactivo"}, {"k": "Reglas", "v": len(p["rules"])},
                        {"k": "Anchor PHANTOM", "v": len(p["anchor_rules"])}, {"k": "Puertos", "v": ", ".join(map(str, p["listening"]))}])
    except pf.PFError as exc:
        errors.append(f"freebsd/pf: {exc}")
        snap["pf"] = {"error": str(exc), "host": settings.PHANTOM["PF_HOST"]}
        chat.say("recolector", f"El firewall no respondió: {exc}", kind="error")

    tests = []
    if snap["k8s"]:
        tests += [("k", t) for t in connectivity.INTERNAL_TESTS]
    if snap["pf"] and not snap["pf"].get("error"):
        tests += [("p", t) for t in connectivity.perimeter_tests()]
    if tests:
        chat.say("recolector", f"Pruebo {_plural(len(tests), 'flujo', 'flujos')} de red: los que deben pasar y los que deben estar bloqueados.")
        for tipo, t in tests:
            r = connectivity._internal(t) if tipo == "k" else connectivity._perimeter(t)
            snap["connectivity"].append(r)
            estado = "responde" if r["reachable"] else ("error" if r["reachable"] is None else "bloqueado")
            chat.say("recolector", f"{r['name']}: {estado}.", kind="test", test=r)
    return {"snapshot": snap, "errors": errors}


def run_analista(chat, snapshot):
    found = analyst.analyze(snapshot)
    if found:
        for f in found:
            chat.say("analista", f["description"], kind="finding", finding=f)
    else:
        chat.say("analista", "Todo opera con normalidad: los pods están listos, los servicios tienen endpoints y "
                 "los flujos legítimos responden.")
    return {"findings": found}


def run_auditor(chat, snapshot, allowed_ports):
    found = auditor.audit(snapshot, allowed_ports)
    if found:
        chat.say("auditor", f"Encontré {_plural(len(found), 'riesgo', 'riesgos')}. Te los paso, planificador.", to="planificador")
        for f in found:
            chat.say("auditor", f["description"], kind="finding", to="planificador", finding=f)
    else:
        chat.say("auditor", "La configuración cumple todas las reglas definidas. No hay riesgos que reportar.")
    return {"findings": found}


def run_planificador(chat, snapshot, findings):
    """Propuestas con explicación del LLM en streaming. La vista previa la añade el backend."""
    out = []
    for prop, idx in planner.plan(snapshot, findings, explain=False):
        rel = [findings[i] for i in idx]
        m, update = chat.stream("planificador", to="operador", operation=prop["operation"], title=prop["title"])
        prop["llm_explanation"] = llm.explain_stream(planner.context_for(prop, rel),
                                                     prop["justification"] + " " + prop["expected_impact"], update)
        chat.end_stream(m)
        out.append({"proposal": prop, "finding_idx": idx,
                    "severity": min((f["severity"] for f in rel), key=SEVERITY_ORDER.index)})
    return {"proposals": out}
