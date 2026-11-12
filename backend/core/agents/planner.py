"""Agente planificador: convierte hallazgos en propuestas estructuradas.

Solo puede proponer operaciónes que existen en la lista permitida del controlador
(core/controller.py::OPERATIONS). Los parametros se construyen aqui, el controlador
los vuelve a validar antes de aplicar nada.
"""
from . import llm

SEGMENTATION_RULES = {"SEC-K8S-001", "SEC-K8S-002", "SEC-K8S-003"}


def _explain(prop, findings):
    ctx = (f"Hallazgos:\n" + "\n".join(f"- [{f['severity']}] {f['title']}: {f['description']}" for f in findings)
           + f"\n\nCambio propuesto ({prop['operation']}): {prop['title']}\n{prop['justification']}\n"
           f"Impacto esperado: {prop['expected_impact']}\n"
           f"Pruebas de verificacion: {', '.join(prop['verification'])}")
    return llm.explain(ctx, fallback=prop["justification"] + " " + prop["expected_impact"])


def plan(snapshot, findings, explain=True):
    """Devuelve [(proposal_dict, [indices de hallazgos asociados])]."""
    proposals = []
    k = snapshot.get("k8s") or {}

    seg_idx = [i for i, f in enumerate(findings) if f["rule_id"] in SEGMENTATION_RULES]
    seg_idx += [i for i, f in enumerate(findings)
                if f["rule_id"] == "SEC-NET-001" and f["evidence"]["test"]["layer"] == "kubernetes"]
    if seg_idx:
        allow_all = [f["evidence"]["policy"]["name"] for f in findings if f["rule_id"] == "SEC-K8S-002"]
        proposals.append(({
            "operation": "k8s_apply_segmentation",
            "params": {"namespace": k.get("namespace"), "remove_policies": allow_all},
            "title": "Aplicar segmentación mínima entre frontend, API y base de datos",
            "justification": ("Se crea una política de denegación por defecto y se permiten únicamente los flujos "
                              "necesarios: entrada HTTP al frontend, frontend hacia API (8080/TCP) y API hacia "
                              "base de datos (5432/TCP)."
                              + (f" Se elimina la política permisiva: {', '.join(allow_all)}." if allow_all else "")),
            "expected_impact": ("El frontend deja de alcanzar la base de datos directamente; los flujos legítimos "
                                "continuan funcionando."),
            "verification": ["fe-api", "api-db", "fe-db"],
            "requires_approval": True,
        }, seg_idx))

    for i, f in enumerate(findings):
        if f["rule_id"] == "SEC-K8S-004":
            svc = f["evidence"]["service"]["name"]
            proposals.append(({
                "operation": "k8s_service_to_clusterip",
                "params": {"namespace": k.get("namespace"), "service": svc},
                "title": f"Retirar la exposición externa del Service '{svc}'",
                "justification": (f"Se cambia el Service '{svc}' de {f['evidence']['service']['type']} a ClusterIP, "
                                  "de modo que la base de datos solo sea accesible dentro del clúster."),
                "expected_impact": "El puerto del nodo se cierra; la API sigue conectando por el nombre interno 'db'.",
                "verification": ["api-db"],
                "requires_approval": True,
            }, [i]))

    pf_ports = {}
    for i, f in enumerate(findings):
        if f["rule_id"] == "SEC-PF-002":
            pf_ports.setdefault(f["evidence"]["port"], []).append(i)
        elif f["rule_id"] == "SEC-NET-001" and f["evidence"]["test"]["layer"] == "perimetro":
            pf_ports.setdefault(f["evidence"]["test"]["port"], []).append(i)
    for port, idx in sorted(pf_ports.items()):
        proposals.append(({
            "operation": "pf_block_port",
            "params": {"port": port},
            "title": f"Bloquear el puerto {port}/tcp en el firewall perimetral",
            "justification": (f"Se agrega en el anchor 'phantom' de PF la regla "
                              f"'block return in log quick proto tcp to port {port}', evaluada antes de las reglas "
                              "de paso. El resto del ruleset no se modifica."),
            "expected_impact": f"El puerto {port} deja de ser accesible desde fuera; HTTP/HTTPS autorizados siguen abiertos.",
            "verification": [f"pf-{port}", "pf-80", "pf-443"],
            "requires_approval": True,
        }, idx))

    if explain:
        for prop, idx in proposals:
            prop["llm_explanation"] = _explain(prop, [findings[i] for i in idx])
    return proposals


def context_for(prop, findings):
    """Contexto que recibe el modelo para explicar una propuesta (usado en modo conversacion)."""
    return (f"Hallazgos:\n" + "\n".join(f"- [{f['severity']}] {f['title']}: {f['description']}" for f in findings)
            + f"\n\nCambio propuesto ({prop['operation']}): {prop['title']}\n{prop['justification']}\n"
            f"Impacto esperado: {prop['expected_impact']}\n"
            f"Pruebas de verificacion: {', '.join(prop['verification'])}")
