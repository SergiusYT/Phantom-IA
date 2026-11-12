"""Agente analista de red: estado operativo, dependencias y fallos de comunicacion."""


def _f(rule_id, title, severity, component, description, **evidence):
    return {"agent": "analyst", "rule_id": rule_id, "title": title, "severity": severity,
            "component": component, "description": description, "evidence": evidence}


def analyze(snapshot):
    findings = []
    k = snapshot.get("k8s")
    if k:
        ns = k["namespace"]
        for n in k["nodes"]:
            if not n["ready"]:
                findings.append(_f("NET-001", f"Nodo {n['name']} no está listo", "critical", f"k8s/node/{n['name']}",
                                   "El nodo no reporta estado Ready; los pods programados en el pueden fallar.", node=n))
        for d in k["deployments"]:
            if d["available"] < d["replicas"]:
                findings.append(_f("NET-002", f"Deployment {d['name']} sin réplicas disponibles", "high",
                                   f"k8s/{ns}/deploy/{d['name']}",
                                   f"Disponibles {d['available']} de {d['replicas']} réplicas.", deployment=d))
        for p in k["pods"]:
            if p["phase"] != "Running" or not p["ready"]:
                findings.append(_f("NET-003", f"Pod {p['name']} no operativo", "high", f"k8s/{ns}/pod/{p['name']}",
                                   f"Fase {p['phase']}, ready={p['ready']}.", pod=p))
            elif p["restarts"] >= 3:
                findings.append(_f("NET-004", f"Pod {p['name']} con reinicios frecuentes", "medium",
                                   f"k8s/{ns}/pod/{p['name']}", f"{p['restarts']} reinicios.", pod=p))
        for s in k["services"]:
            if s["selector"] and s["endpoints"] == 0:
                findings.append(_f("NET-005", f"Service {s['name']} sin endpoints", "high", f"k8s/{ns}/svc/{s['name']}",
                                   "Ningún pod listo coincide con el selector: el servicio no recibe tráfico.", service=s))
        if k["warning_events"]:
            findings.append(_f("NET-006", "Eventos de advertencia recientes", "low", f"k8s/{ns}",
                               f"{len(k['warning_events'])} eventos Warning en el namespace.",
                               events=k["warning_events"][-5:]))

    p = snapshot.get("pf")
    if p is not None and p.get("error"):
        findings.append(_f("NET-007", "Firewall perimetral inaccesible", "high", "pf/perimeter",
                           "No fue posible consultar PF por el canal de gestion.", error=p["error"]))

    conn = snapshot.get("connectivity", [])
    broken = [t for t in conn if t["expect"] and t["reachable"] is False]
    if broken:
        findings.append(_f("NET-008", "Flujos legitimos interrumpidos", "high", "red/flujos",
                           "Conexiones que deben funcionar no responden: " + ", ".join(t["name"] for t in broken),
                           tests=broken))
    return findings


def summarize(snapshot, findings):
    k = snapshot.get("k8s") or {}
    p = snapshot.get("pf") or {}
    parts = []
    if k:
        running = sum(1 for x in k["pods"] if x["phase"] == "Running" and x["ready"])
        parts.append(f"Kubernetes: {len(k['nodes'])} nodo(s), {running}/{len(k['pods'])} pods operativos, "
                     f"{len(k['services'])} services, {len(k['network_policies'])} NetworkPolicies en '{k['namespace']}'.")
    if p and not p.get("error"):
        parts.append(f"Firewall {p['host']}: PF {'activo' if p['enabled'] else 'INACTIVO'}, "
                     f"{len(p['rules'])} reglas, {len(p['anchor_rules'])} en el anchor de PHANTOM.")
    conn = snapshot.get("connectivity", [])
    if conn:
        ok = sum(1 for t in conn if t["ok"])
        parts.append(f"Conectividad: {ok}/{len(conn)} pruebas con el resultado esperado.")
    ops = [f for f in findings if f["agent"] == "analyst"]
    parts.append("Sin anomalías operativas." if not ops else f"{len(ops)} anomalía(s) operativa(s) detectada(s).")
    return " ".join(parts)
