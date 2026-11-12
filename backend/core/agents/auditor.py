"""Agente auditor de seguridad: compara la configuración con criterios definidos.

Las reglas son deterministas para que la deteccion sea reproducible y verificable;
el LLM solo se usa para redactar explicaciones (ver llm.py).
"""

SENSITIVE_APPS = {"db"}            # componentes que nunca deben exponerse fuera del cluster
EXPECTED_FLOWS = {"api": {"frontend"}, "db": {"api"}}   # destino -> origenes permitidos


def _f(rule_id, title, severity, component, description, **evidence):
    return {"agent": "auditor", "rule_id": rule_id, "title": title, "severity": severity,
            "component": component, "description": description, "evidence": evidence}


def _is_allow_all(pol):
    return pol["pod_selector"] in ({}, {"matchLabels": {}}) and "Ingress" in pol["policy_types"] \
        and any(rule in ({}, None) or not rule.get("from") for rule in (pol["ingress"] or []))


def _is_default_deny(pol):
    return pol["pod_selector"] in ({}, {"matchLabels": {}}) and "Ingress" in pol["policy_types"] \
        and not pol["ingress"]


def audit_k8s(k):
    out = []
    ns = k["namespace"]
    pols = k["network_policies"]
    allow_all = [p for p in pols if _is_allow_all(p)]
    has_deny = any(_is_default_deny(p) for p in pols)

    if not pols:
        out.append(_f("SEC-K8S-001", "Namespace sin segmentación de red", "high", f"k8s/{ns}",
                      "No existe ninguna NetworkPolicy: cualquier pod puede comunicarse con cualquier otro, "
                      "incluido el acceso directo del frontend a la base de datos.", policies=[]))
    for p in allow_all:
        out.append(_f("SEC-K8S-002", f"NetworkPolicy '{p['name']}' permite todo el tráfico", "high",
                      f"k8s/{ns}/netpol/{p['name']}",
                      "La política selecciona todos los pods y admite ingreso desde cualquier origen; "
                      "anula la segmentación entre frontend, API y base de datos.", policy=p))
    if pols and not has_deny and not allow_all:
        out.append(_f("SEC-K8S-003", "Sin política de denegación por defecto", "medium", f"k8s/{ns}",
                      "Los pods no seleccionados por ninguna política aceptan todo el tráfico.",
                      policies=[p["name"] for p in pols]))

    for s in k["services"]:
        app = s["selector"].get("app")
        if app in SENSITIVE_APPS and s["type"] in ("NodePort", "LoadBalancer"):
            out.append(_f("SEC-K8S-004", f"Base de datos expuesta fuera del clúster ({s['type']})", "critical",
                          f"k8s/{ns}/svc/{s['name']}",
                          f"El Service '{s['name']}' publica el puerto de la base de datos en los nodos "
                          f"({', '.join(str(p.get('nodePort')) for p in s['ports'])}). Solo la API debe alcanzarla.",
                          service=s))
    return out


def audit_pf(p, allowed_ports):
    from ..adapters.pf import blocked_by_anchor
    out = []
    if not p["enabled"]:
        out.append(_f("SEC-PF-001", "PF deshabilitado en el firewall perimetral", "critical", "pf/perimeter",
                      "El firewall no filtra tráfico.", status=p["status_raw"][:300]))
        return out
    exposed = set()
    for r in p["rules"]:
        if r["action"] == "pass" and r["direction"] in ("in", "any"):
            for port in r["ports"]:
                if port not in allowed_ports and not blocked_by_anchor(port, p["anchor_rules"]):
                    exposed.add((port, r["raw"]))
    for port, raw in sorted(exposed):
        listening = port in p["listening"]
        out.append(_f("SEC-PF-002", f"Puerto {port}/tcp expuesto sin justificación", "high" if listening else "medium",
                      "pf/perimeter",
                      f"Una regla 'pass in' admite el puerto {port}, que no está en la lista de puertos autorizados "
                      f"{sorted(allowed_ports)}." + (" Hay un servicio escuchando en el." if listening else ""),
                      port=port, rule=raw, listening=listening, allowed_ports=allowed_ports))
    if not any(r["action"] == "block" and not r["ports"] for r in p["rules"]):
        out.append(_f("SEC-PF-003", "Sin regla de bloqueo por defecto", "high", "pf/perimeter",
                      "El ruleset no contiene un 'block' general; el tráfico no contemplado podria pasar.",
                      rules=[r["raw"] for r in p["rules"]]))
    return out


def audit(snapshot, allowed_ports):
    findings = []
    if snapshot.get("k8s"):
        findings += audit_k8s(snapshot["k8s"])
    if snapshot.get("pf") and not snapshot["pf"].get("error"):
        findings += audit_pf(snapshot["pf"], allowed_ports)
    for t in snapshot.get("connectivity", []):
        if not t["expect"] and t["reachable"]:
            findings.append(_f("SEC-NET-001", f"Flujo no autorizado alcanzable: {t['name']}", "high",
                               f"red/{t['layer']}", "La prueba demuestra que un flujo que debe estar bloqueado responde.",
                               test=t))
    return findings
