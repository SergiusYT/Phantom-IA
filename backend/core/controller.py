"""Controlador seguro: unica pieza que modifica la infraestructura.

Flujo por operacion: validar -> vista previa -> (aprobacion humana) -> respaldo ->
aplicar -> verificar con pruebas -> registrar. Si la verificacion falla, se revierte.
Los agentes nunca llaman a este modulo directamente; lo hace la API tras la aprobacion.
"""
import copy
import re

import yaml
from django.conf import settings
from django.utils import timezone

from . import connectivity
from .adapters import k8s, pf
from .models import Execution, Proposal, record

CFG = settings.PHANTOM


class ValidationError(Exception):
    pass


def _ns(params):
    if params.get("namespace") != CFG["NAMESPACE"]:
        raise ValidationError(f"Namespace fuera de alcance: {params.get('namespace')}")
    return params["namespace"]


def _name(v):
    if not isinstance(v, str) or not re.fullmatch(r"[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?", v):
        raise ValidationError(f"Nombre de recurso invalido: {v!r}")
    return v


# ---------------- k8s_apply_segmentation ----------------

SEG_POLICIES = ["phantom-default-deny", "phantom-allow-frontend-ingress", "phantom-allow-frontend-to-api",
                "phantom-allow-api-to-db"]


def _seg_manifest(ns):
    meta = lambda n: {"name": n, "namespace": ns, "labels": {"phantom.io/managed": "true"}}
    docs = [
        {"apiVersion": "networking.k8s.io/v1", "kind": "NetworkPolicy", "metadata": meta(SEG_POLICIES[0]),
         "spec": {"podSelector": {}, "policyTypes": ["Ingress"]}},
        {"apiVersion": "networking.k8s.io/v1", "kind": "NetworkPolicy", "metadata": meta(SEG_POLICIES[1]),
         "spec": {"podSelector": {"matchLabels": {"app": "frontend"}}, "policyTypes": ["Ingress"],
                  "ingress": [{"ports": [{"protocol": "TCP", "port": 80}]}]}},
        {"apiVersion": "networking.k8s.io/v1", "kind": "NetworkPolicy", "metadata": meta(SEG_POLICIES[2]),
         "spec": {"podSelector": {"matchLabels": {"app": "api"}}, "policyTypes": ["Ingress"],
                  "ingress": [{"from": [{"podSelector": {"matchLabels": {"app": "frontend"}}}],
                               "ports": [{"protocol": "TCP", "port": 8080}]}]}},
        {"apiVersion": "networking.k8s.io/v1", "kind": "NetworkPolicy", "metadata": meta(SEG_POLICIES[3]),
         "spec": {"podSelector": {"matchLabels": {"app": "db"}}, "policyTypes": ["Ingress"],
                  "ingress": [{"from": [{"podSelector": {"matchLabels": {"app": "api"}}}],
                               "ports": [{"protocol": "TCP", "port": 5432}]}]}},
    ]
    return yaml.safe_dump_all(docs, sort_keys=False)


def seg_validate(p):
    ns = _ns(p)
    rm = p.get("remove_policies", [])
    if not isinstance(rm, list):
        raise ValidationError("remove_policies debe ser una lista")
    for n in rm:
        _name(n)
        if n.startswith("phantom-"):
            raise ValidationError("No se pueden eliminar politicas propias de PHANTOM")
    return ns


def seg_preview(p):
    ns = seg_validate(p)
    out = "# NetworkPolicies que se aplicarán\n" + _seg_manifest(ns)
    if p.get("remove_policies"):
        out += "\n# Políticas que se eliminarán\n" + "\n".join(f"#  - {n}" for n in p["remove_policies"])
    return out


def seg_dry_run(p):
    return k8s.dry_run(_seg_manifest(_ns(p)))


def seg_backup(p):
    return {"removed": {n: k8s.get_resource_yaml("networkpolicy", n) for n in p.get("remove_policies", [])},
            "preexisting": [n for n in SEG_POLICIES if n in k8s.list_names("networkpolicies")]}


def seg_apply(p):
    out = k8s.apply_manifest(_seg_manifest(_ns(p)))
    for n in p.get("remove_policies", []):
        out += k8s.delete_resource("NetworkPolicy", n)
    return out


def seg_rollback(p, backup):
    out = ""
    for n in SEG_POLICIES:
        if n not in backup.get("preexisting", []):
            out += k8s.delete_resource("NetworkPolicy", n)
    for n, text in backup.get("removed", {}).items():
        if text:
            k8s.restore_yaml(text)
            out += f"networkpolicy/{n} restaurada\n"
    return out


# ---------------- k8s_service_to_clusterip ----------------

def _svc_manifest(p):
    text = k8s.get_resource_yaml("service", _name(p["service"]))
    if not text:
        raise ValidationError(f"Service {p['service']} no existe")
    doc = yaml.safe_load(text)
    new = {"apiVersion": "v1", "kind": "Service",
           "metadata": {"name": doc["metadata"]["name"], "namespace": doc["metadata"]["namespace"],
                        "labels": doc["metadata"].get("labels", {})},
           "spec": copy.deepcopy(doc["spec"])}
    new["spec"]["type"] = "ClusterIP"
    for port in new["spec"].get("ports", []):
        port.pop("nodePort", None)
    for k in ("externalTrafficPolicy", "internalTrafficPolicy", "allocateLoadBalancerNodePorts"):
        new["spec"].pop(k, None)
    return yaml.safe_dump(new, sort_keys=False), text


def svc_validate(p):
    _ns(p)
    _name(p.get("service"))


def svc_preview(p):
    svc_validate(p)
    return "# Service resultante\n" + _svc_manifest(p)[0]


def svc_dry_run(p):
    return k8s.dry_run(_svc_manifest(p)[0])


def svc_backup(p):
    return {"service_yaml": _svc_manifest(p)[1]}


def svc_apply(p):
    return k8s.apply_manifest(_svc_manifest(p)[0])


def svc_rollback(p, backup):
    k8s.restore_yaml(backup["service_yaml"])
    return f"service/{p['service']} restaurado"


# ---------------- pf_block_port ----------------

def pf_validate(p):
    port = p.get("port")
    if not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValidationError(f"Puerto invalido: {port}")
    if port == 22:
        raise ValidationError("El puerto de gestion 22 esta protegido")
    if port in CFG["PF_ALLOWED_PORTS"]:
        raise ValidationError(f"El puerto {port} esta autorizado; bloquearlo interrumpiria servicio legitimo")
    return port


def pf_preview(p):
    port = pf_validate(p)
    return (f"# anchor \"phantom\" (evaluado antes de las reglas de paso)\n"
            f"block return in log quick proto tcp to port {port}")


def pf_dry_run(p):
    pf_validate(p)
    return pf.call("anchor")


def pf_backup(p):
    return {"anchor_before": pf.call("anchor")}


def pf_apply(p):
    return pf.call("block-port", pf_validate(p))


def pf_rollback(p, backup):
    return pf.call("unblock-port", p["port"])


OPERATIONS = {
    "k8s_apply_segmentation": dict(validate=seg_validate, preview=seg_preview, dry_run=seg_dry_run,
                                   backup=seg_backup, apply=seg_apply, rollback=seg_rollback),
    "k8s_service_to_clusterip": dict(validate=svc_validate, preview=svc_preview, dry_run=svc_dry_run,
                                     backup=svc_backup, apply=svc_apply, rollback=svc_rollback),
    "pf_block_port": dict(validate=pf_validate, preview=pf_preview, dry_run=pf_dry_run,
                          backup=pf_backup, apply=pf_apply, rollback=pf_rollback),
}


def _op(name):
    if name not in OPERATIONS:
        raise ValidationError(f"Operacion fuera de la lista permitida: {name}")
    return OPERATIONS[name]


def preview(operation, params):
    return _op(operation)["preview"](params)


def _verify(ids):
    import time
    results = []
    for attempt in range(4):         # las NetworkPolicies tardan unos segundos en propagarse
        results = connectivity.run_ids(ids)
        if results and all(r["ok"] for r in results):
            break
        time.sleep(3)
    return results


def execute(proposal: Proposal, user):
    if proposal.status != Proposal.Status.APPROVED and proposal.requires_approval:
        raise ValidationError("La propuesta requiere aprobacion humana antes de ejecutarse")
    op = _op(proposal.operation)
    ex = Execution.objects.create(proposal=proposal, executed_by=user if user.is_authenticated else None)
    log = []
    try:
        op["validate"](proposal.params)
        log.append("== Validación: OK")
        log.append("== Dry-run:\n" + op["dry_run"](proposal.params).strip())
        ex.tests_before = connectivity.run_ids(proposal.verification)
        ex.backup = op["backup"](proposal.params)
        log.append("== Respaldo guardado")
        log.append("== Aplicacion:\n" + op["apply"](proposal.params).strip())
        ex.tests_after = _verify(proposal.verification)
        ex.verified = bool(ex.tests_after) and all(t["ok"] for t in ex.tests_after)
        if ex.verified:
            ex.success = True
            proposal.status = Proposal.Status.APPLIED
            log.append("== Verificación: todas las pruebas con el resultado esperado")
        else:
            log.append("== Verificación FALLIDA: se revierte el cambio")
            log.append(op["rollback"](proposal.params, ex.backup).strip())
            proposal.status = Proposal.Status.FAILED
    except (ValidationError, k8s.K8sError, pf.PFError) as exc:
        log.append(f"== ERROR: {exc}")
        if ex.backup:
            try:
                log.append("== Reversión: " + op["rollback"](proposal.params, ex.backup).strip())
            except Exception as rb:   # noqa: BLE001 - se registra cualquier fallo de reversion
                log.append(f"== Reversión fallida: {rb}")
        proposal.status = Proposal.Status.FAILED
    ex.output = "\n".join(log)
    ex.finished_at = timezone.now()
    ex.save()
    proposal.save(update_fields=["status"])
    record("execute", user, f"proposal:{proposal.id}", success=ex.success,
           operation=proposal.operation, params=proposal.params, verified=ex.verified, execution=ex.id)
    return ex


def rollback(proposal: Proposal, user):
    last = proposal.executions.filter(kind="apply", success=True).first()
    if not last:
        raise ValidationError("No hay una ejecucion exitosa que revertir")
    op = _op(proposal.operation)
    ex = Execution.objects.create(proposal=proposal, kind="rollback",
                                  executed_by=user if user.is_authenticated else None)
    try:
        ex.output = op["rollback"](proposal.params, last.backup)
        ex.success = True
        proposal.status = Proposal.Status.ROLLED_BACK
    except (ValidationError, k8s.K8sError, pf.PFError) as exc:
        ex.output = f"ERROR: {exc}"
    ex.tests_after = connectivity.run_ids(proposal.verification)
    ex.finished_at = timezone.now()
    ex.save()
    proposal.save(update_fields=["status"])
    record("rollback", user, f"proposal:{proposal.id}", success=ex.success, execution=ex.id)
    return ex
