"""Adaptador Docker de solo lectura.

No usa el socket de Docker directamente (eso equivale a root en el host): consulta un
docker-socket-proxy que solo permite GET /containers. Ver docker-compose.yml.
"""
from datetime import datetime, timezone

import requests
from django.conf import settings


class DockerError(Exception):
    pass


def _role(name, labels):
    if labels.get("app") == "k3d" or name.startswith("k3d-"):
        if name.endswith("serverlb"):
            return "k3d-lb"
        return "k3d-node"
    if labels.get("com.docker.compose.project"):
        return "plataforma"
    return "otro"


def containers():
    url = settings.PHANTOM["DOCKER_URL"]
    try:
        r = requests.get(f"{url}/containers/json", params={"all": 1}, timeout=4)
        r.raise_for_status()
    except requests.RequestException as exc:
        raise DockerError(f"Proxy de Docker no disponible en {url}") from exc
    now = datetime.now(timezone.utc).timestamp()
    out = []
    for c in r.json():
        name = c["Names"][0].lstrip("/")
        labels = c.get("Labels", {}) or {}
        out.append({
            "id": c["Id"][:12],
            "name": name,
            "image": c["Image"],
            "state": c["State"],
            "status": c["Status"],
            "role": _role(name, labels),
            "service": labels.get("com.docker.compose.service") or labels.get("k3d.role"),
            "uptime_s": int(now - c.get("Created", now)),
            "ports": sorted({p["PublicPort"] for p in c.get("Ports", []) if p.get("PublicPort")}),
        })
    order = {"plataforma": 0, "k3d-node": 1, "k3d-lb": 2, "otro": 3}
    return sorted(out, key=lambda c: (order[c["role"]], c["name"]))
