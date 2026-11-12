"""Adaptador Kubernetes: lectura de estado y escritura acotada al namespace administrado.

Usa kubectl con la cuenta configurada en KUBECONFIG. Solo el controlador seguro
llama a las funciones de escritura (apply_manifest, delete_resource, patch_service).
"""
import json
import os
import subprocess

import yaml
from django.conf import settings

CFG = settings.PHANTOM
MANAGED_KINDS = {"NetworkPolicy", "Service"}


class K8sError(Exception):
    pass


def _env():
    e = os.environ.copy()
    if CFG["KUBECONFIG"]:
        e["KUBECONFIG"] = CFG["KUBECONFIG"]
    return e


def kubectl(*args, input_text=None, timeout=30, check=True):
    cmd = [CFG["KUBECTL"], *args]
    try:
        p = subprocess.run(cmd, input=input_text, capture_output=True, text=True, timeout=timeout, env=_env())
    except FileNotFoundError as exc:
        raise K8sError(f"kubectl no encontrado en {CFG['KUBECTL']}") from exc
    except subprocess.TimeoutExpired as exc:
        raise K8sError(f"kubectl excedio {timeout}s: {' '.join(args)}") from exc
    if check and p.returncode != 0:
        raise K8sError(p.stderr.strip() or p.stdout.strip())
    return p


def get_json(*args):
    return json.loads(kubectl("get", *args, "-o", "json").stdout)


def cluster_info():
    nodes = get_json("nodes")["items"]
    out = []
    for n in nodes:
        conds = {c["type"]: c["status"] for c in n["status"].get("conditions", [])}
        out.append({
            "name": n["metadata"]["name"],
            "ready": conds.get("Ready") == "True",
            "version": n["status"]["nodeInfo"]["kubeletVersion"],
            "addresses": [a["address"] for a in n["status"].get("addresses", []) if a["type"] == "InternalIP"],
        })
    return out


def collect(namespace=None):
    """Recolecta y normaliza el estado del namespace administrado."""
    ns = namespace or CFG["NAMESPACE"]
    pods = get_json("pods", "-n", ns)["items"]
    svcs = get_json("services", "-n", ns)["items"]
    eps = get_json("endpoints", "-n", ns)["items"]
    deps = get_json("deployments", "-n", ns)["items"]
    pols = get_json("networkpolicies", "-n", ns)["items"]
    events = get_json("events", "-n", ns)["items"]

    ep_ready = {}
    for e in eps:
        n = sum(len(s.get("addresses", [])) for s in e.get("subsets", []) or [])
        ep_ready[e["metadata"]["name"]] = n

    return {
        "namespace": ns,
        "nodes": cluster_info(),
        "pods": [{
            "name": p["metadata"]["name"],
            "labels": p["metadata"].get("labels", {}),
            "phase": p["status"].get("phase"),
            "ip": p["status"].get("podIP"),
            "ready": all(c.get("ready") for c in p["status"].get("containerStatuses", []) or [{}]),
            "restarts": sum(c.get("restartCount", 0) for c in p["status"].get("containerStatuses", []) or []),
        } for p in pods],
        "deployments": [{
            "name": d["metadata"]["name"],
            "replicas": d["spec"].get("replicas", 0),
            "available": d["status"].get("availableReplicas", 0) or 0,
        } for d in deps],
        "services": [{
            "name": s["metadata"]["name"],
            "type": s["spec"].get("type"),
            "selector": s["spec"].get("selector", {}),
            "ports": [{k: p.get(k) for k in ("name", "port", "targetPort", "nodePort", "protocol")} for p in s["spec"].get("ports", [])],
            "endpoints": ep_ready.get(s["metadata"]["name"], 0),
        } for s in svcs],
        "network_policies": [{
            "name": n["metadata"]["name"],
            "pod_selector": n["spec"].get("podSelector", {}),
            "policy_types": n["spec"].get("policyTypes", []),
            "ingress": n["spec"].get("ingress"),
            "egress": n["spec"].get("egress"),
        } for n in pols],
        "warning_events": [{
            "reason": e.get("reason"),
            "object": f"{e['involvedObject'].get('kind')}/{e['involvedObject'].get('name')}",
            "message": e.get("message"),
        } for e in events if e.get("type") == "Warning"][-20:],
    }


# ---------- Escritura (solo desde el controlador seguro) ----------

def _check_manifest(doc):
    kind = doc.get("kind")
    ns = doc.get("metadata", {}).get("namespace")
    if kind not in MANAGED_KINDS:
        raise K8sError(f"Tipo de recurso no administrable: {kind}")
    if ns != CFG["NAMESPACE"]:
        raise K8sError(f"Namespace fuera de alcance: {ns}")


def dry_run(manifest_yaml):
    for d in yaml.safe_load_all(manifest_yaml):
        if d:
            _check_manifest(d)
    return kubectl("apply", "--dry-run=server", "-f", "-", input_text=manifest_yaml).stdout


def apply_manifest(manifest_yaml):
    for d in yaml.safe_load_all(manifest_yaml):
        if d:
            _check_manifest(d)
    return kubectl("apply", "-f", "-", input_text=manifest_yaml).stdout


def get_resource_yaml(kind, name):
    p = kubectl("get", kind, name, "-n", CFG["NAMESPACE"], "-o", "yaml", check=False)
    return p.stdout if p.returncode == 0 else None


def delete_resource(kind, name):
    if kind not in MANAGED_KINDS:
        raise K8sError(f"Tipo de recurso no administrable: {kind}")
    return kubectl("delete", kind, name, "-n", CFG["NAMESPACE"], "--ignore-not-found").stdout


def list_names(kind):
    return [i["metadata"]["name"] for i in get_json(kind, "-n", CFG["NAMESPACE"])["items"]]


def restore_yaml(text):
    """Re-aplica un recurso respaldado, limpiando campos que asigna el servidor."""
    doc = yaml.safe_load(text)
    meta = doc.get("metadata", {})
    for k in ("resourceVersion", "uid", "creationTimestamp", "managedFields", "generation"):
        meta.pop(k, None)
    meta.get("annotations", {}).pop("kubectl.kubernetes.io/last-applied-configuration", None)
    doc.pop("status", None)
    if doc.get("kind") == "Service":
        spec = doc.get("spec", {})
        for k in ("clusterIP", "clusterIPs"):
            spec.pop(k, None)
    out = yaml.safe_dump(doc)
    kubectl("replace", "--force", "-f", "-", input_text=out)
    return out


def exec_in(app_label, command, timeout=15):
    """Ejecuta un comando de prueba dentro del primer pod con app=<label>."""
    pods = get_json("pods", "-n", CFG["NAMESPACE"], "-l", f"app={app_label}")["items"]
    running = [p for p in pods if p["status"].get("phase") == "Running"]
    if not running:
        raise K8sError(f"No hay pod en ejecucion con app={app_label}")
    pod = running[0]["metadata"]["name"]
    return kubectl("exec", "-n", CFG["NAMESPACE"], pod, "--", *command, timeout=timeout, check=False)


# ---------- Orquestacion en vivo ----------

def _top(kind, *extra):
    """Metricas de metrics-server (k3s lo trae). Devuelve {} si no estan disponibles."""
    p = kubectl("top", kind, *extra, "--no-headers", check=False, timeout=10)
    out = {}
    if p.returncode != 0:
        return out
    for line in p.stdout.splitlines():
        cols = line.split()
        if kind == "nodes" and len(cols) >= 5:
            out[cols[0]] = {"cpu_m": int(cols[1].rstrip("m") or 0), "cpu_pct": cols[2], "mem_mi": int(cols[3].rstrip("Mi") or 0), "mem_pct": cols[4]}
        elif kind == "pods" and len(cols) >= 3:
            out[cols[0]] = {"cpu_m": int(cols[1].rstrip("m") or 0), "mem_mi": int(cols[2].rstrip("Mi") or 0)}
    return out


def _pod_state(p):
    if p["metadata"].get("deletionTimestamp"):
        return "Terminating"
    for cs in p["status"].get("containerStatuses", []) or []:
        waiting = cs.get("state", {}).get("waiting")
        if waiting:
            return waiting.get("reason", "Waiting")
    return p["status"].get("phase", "Unknown")


def orchestration():
    ns = CFG["NAMESPACE"]
    nodes = get_json("nodes")["items"]
    pods = get_json("pods", "-n", ns)["items"]
    deps = get_json("deployments", "-n", ns)["items"]
    events = get_json("events", "-n", ns)["items"]
    nmet, pmet = _top("nodes"), _top("pods", "-n", ns)
    events.sort(key=lambda e: e.get("lastTimestamp") or e.get("eventTime") or e["metadata"]["creationTimestamp"])
    return {
        "namespace": ns,
        "nodes": [{
            "name": n["metadata"]["name"],
            "role": "control-plane" if "node-role.kubernetes.io/control-plane" in n["metadata"].get("labels", {}) else "worker",
            "ready": any(c["type"] == "Ready" and c["status"] == "True" for c in n["status"].get("conditions", [])),
            "version": n["status"]["nodeInfo"]["kubeletVersion"],
            "cpu": n["status"]["capacity"].get("cpu"),
            "memory": n["status"]["capacity"].get("memory"),
            "metrics": nmet.get(n["metadata"]["name"]),
        } for n in nodes],
        "pods": [{
            "name": p["metadata"]["name"],
            "app": p["metadata"].get("labels", {}).get("app"),
            "node": p["spec"].get("nodeName"),
            "state": _pod_state(p),
            "ready": bool(p["status"].get("containerStatuses")) and all(c.get("ready") for c in p["status"]["containerStatuses"]),
            "restarts": sum(c.get("restartCount", 0) for c in p["status"].get("containerStatuses", []) or []),
            "ip": p["status"].get("podIP"),
            "image": p["spec"]["containers"][0]["image"],
            "created": p["metadata"]["creationTimestamp"],
            "metrics": pmet.get(p["metadata"]["name"]),
        } for p in pods],
        "deployments": [{
            "name": d["metadata"]["name"],
            "replicas": d["spec"].get("replicas", 0),
            "ready": d["status"].get("readyReplicas", 0) or 0,
            "available": d["status"].get("availableReplicas", 0) or 0,
            "image": d["spec"]["template"]["spec"]["containers"][0]["image"],
        } for d in deps],
        "events": [{
            "time": e.get("lastTimestamp") or e.get("eventTime") or e["metadata"]["creationTimestamp"],
            "type": e.get("type"),
            "reason": e.get("reason"),
            "object": f"{e['involvedObject'].get('kind')}/{e['involvedObject'].get('name')}",
            "message": e.get("message"),
            "count": e.get("count", 1),
        } for e in events][-40:],
    }


def scale(deployment, replicas):
    if deployment not in list_names("deployments"):
        raise K8sError(f"Deployment fuera de alcance: {deployment}")
    return kubectl("scale", "deployment", deployment, "-n", CFG["NAMESPACE"], f"--replicas={int(replicas)}").stdout


def delete_pod(pod):
    if pod not in list_names("pods"):
        raise K8sError(f"Pod fuera de alcance: {pod}")
    return kubectl("delete", "pod", pod, "-n", CFG["NAMESPACE"], "--wait=false").stdout
