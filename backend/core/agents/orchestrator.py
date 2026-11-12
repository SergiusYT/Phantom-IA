"""Kubernetes orquesta a los agentes: un Job por agente y por auditoría en `phantom-agents`.

El coordinador (backend) crea los Jobs; Kubernetes los programa en un nodo, arranca el pod,
lo reintenta si cae (backoffLimit) y lo mata si se pasa de tiempo (activeDeadlineSeconds).
"""
import json
import time

from django.conf import settings

from ..adapters import k8s

POLL = 1.0


def _ns():
    return settings.PHANTOM["AGENTS_NAMESPACE"]


def job_name(audit_id, role):
    return f"phantom-{int(audit_id)}-{role}"


def _labels(audit_id, role=None):
    lab = {"app.kubernetes.io/part-of": "phantom", "phantom/audit": str(int(audit_id))}
    if role:
        lab["phantom/agent"] = role
    return lab


def build_job(audit_id, role):
    CFG = settings.PHANTOM
    recolector = role == "recolector"
    env = [
        {"name": "PHANTOM_AGENT_API", "value": CFG["AGENT_API_URL"]},
        {"name": "PHANTOM_AUDIT_ID", "value": str(int(audit_id))},
        {"name": "PHANTOM_AGENT_TOKEN", "valueFrom": {"secretKeyRef": {"name": f"phantom-audit-{int(audit_id)}", "key": "token"}}},
        {"name": "PHANTOM_OLLAMA_URL", "value": CFG["AGENT_OLLAMA_URL"]},
        {"name": "PHANTOM_OLLAMA_MODEL", "value": CFG["OLLAMA_MODEL"]},
        {"name": "PHANTOM_LLM", "value": "1" if CFG["LLM_ENABLED"] else "0"},
        {"name": "PHANTOM_NAMESPACE", "value": CFG["NAMESPACE"]},
        {"name": "PHANTOM_PF_HOST", "value": CFG["PF_HOST"]},
        {"name": "PHANTOM_PF_USER", "value": CFG["PF_USER"]},
        {"name": "PHANTOM_PF_ALLOWED_PORTS", "value": ",".join(map(str, CFG["PF_ALLOWED_PORTS"]))},
        {"name": "PHANTOM_KUBECTL", "value": "/usr/local/bin/kubectl"},
        {"name": "PHANTOM_DEBUG", "value": "0"},
        {"name": "HOME", "value": "/tmp"},
    ]
    container = {
        "name": role,
        "image": CFG["AGENT_IMAGE"],
        "imagePullPolicy": "Never",
        "command": ["python", "-m", "core.agents.runner", "--role", role],
        "env": env,
        "resources": {"requests": {"cpu": "100m", "memory": "128Mi"}, "limits": {"memory": "512Mi"}},
        "securityContext": {"allowPrivilegeEscalation": False},
    }
    pod = {
        "restartPolicy": "Never",
        "serviceAccountName": "phantom-recolector" if recolector else "phantom-agente",
        "automountServiceAccountToken": recolector,
        "containers": [container],
    }
    if recolector:
        env.append({"name": "PHANTOM_PF_KEY", "value": "/run/phantom/pf/key"})
        container["volumeMounts"] = [{"name": "pf-key", "mountPath": "/run/phantom/pf", "readOnly": True}]
        pod["volumes"] = [{"name": "pf-key", "secret": {"secretName": "phantom-pf-ro", "defaultMode": 0o400,
                                                         "items": [{"key": "key", "path": "key"}]}}]
    return {
        "apiVersion": "batch/v1", "kind": "Job",
        "metadata": {"name": job_name(audit_id, role), "namespace": _ns(), "labels": _labels(audit_id, role)},
        "spec": {
            "backoffLimit": 1,
            "ttlSecondsAfterFinished": 600,
            "activeDeadlineSeconds": 180,
            "template": {"metadata": {"labels": _labels(audit_id, role)}, "spec": pod},
        },
    }


def _apply(obj):
    k8s.kubectl("apply", "-f", "-", input_text=json.dumps(obj))


def create_secret(audit_id, token):
    _apply({"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
            "metadata": {"name": f"phantom-audit-{int(audit_id)}", "namespace": _ns(), "labels": _labels(audit_id)},
            "stringData": {"token": token}})


def create_job(audit_id, role):
    k8s.kubectl("delete", "job", job_name(audit_id, role), "-n", _ns(), "--ignore-not-found", "--wait=true", timeout=30)
    _apply(build_job(audit_id, role))
    return job_name(audit_id, role)


def job_state(name):
    job = json.loads(k8s.kubectl("get", "job", name, "-n", _ns(), "-o", "json").stdout)
    pods = json.loads(k8s.kubectl("get", "pods", "-n", _ns(), "-l", f"job-name={name}", "-o", "json").stdout)["items"]
    st = job.get("status", {})
    conds = {c["type"]: c["status"] for c in st.get("conditions", []) or []}
    pods.sort(key=lambda p: p["metadata"]["creationTimestamp"])
    node = next((p["spec"].get("nodeName") for p in reversed(pods) if p["spec"].get("nodeName")), None)
    failed = sum(1 for p in pods if p["status"].get("phase") == "Failed")
    if st.get("succeeded") or conds.get("Complete") == "True":
        phase = "complete"
    elif conds.get("Failed") == "True":
        phase = "failed"
    elif any(p["status"].get("phase") == "Running" for p in pods):
        phase = "running"
    else:
        phase = "pending"
    return {"phase": phase, "node": node, "failed_pods": max(failed, st.get("failed", 0) or 0)}


def wait(names, on_event, timeout):
    """Espera a que todos los Jobs terminen. Devuelve {nombre: complete|failed|timeout}."""
    last, out = {}, {}
    deadline = time.monotonic() + timeout
    while len(out) < len(names):
        for n in names:
            if n in out:
                continue
            try:
                s = job_state(n)
            except k8s.K8sError as exc:
                s = {"phase": "pending", "node": None, "failed_pods": 0, "error": str(exc)}
            key = (s["phase"], s["node"], s["failed_pods"])
            if last.get(n) != key:
                last[n] = key
                on_event(n, s)
            if s["phase"] in ("complete", "failed"):
                out[n] = s["phase"]
        if len(out) < len(names):
            if time.monotonic() >= deadline:
                out.update({n: "timeout" for n in names if n not in out})
                break
            time.sleep(POLL)
    return out


def cleanup(audit_id):
    """Borra la credencial de la auditoría. Los Jobs quedan visibles hasta su TTL (10 min)."""
    k8s.kubectl("delete", "secret", f"phantom-audit-{int(audit_id)}", "-n", _ns(), "--ignore-not-found", check=False)


def purge(audit_id):
    """Borra Jobs y Secret de una auditoría interrumpida."""
    sel = f"phantom/audit={int(audit_id)}"
    k8s.kubectl("delete", "jobs,secrets", "-n", _ns(), "-l", sel, "--ignore-not-found", check=False, timeout=60)
