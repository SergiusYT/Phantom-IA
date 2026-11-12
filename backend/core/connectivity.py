"""Pruebas de conectividad autorizada y no autorizada (seccion 9 de la propuesta).

Cada prueba declara si el flujo DEBE estar permitido (expect=True) o bloqueado (expect=False).
"""
from django.conf import settings

from .adapters import k8s, pf

# Matriz de flujos esperada para la aplicacion de laboratorio.
INTERNAL_TESTS = [
    {"id": "fe-api", "name": "frontend -> api:8080", "src": "frontend", "dst": "api", "port": 8080, "expect": True},
    {"id": "api-db", "name": "api -> db:5432", "src": "api", "dst": "db", "port": 5432, "expect": True},
    {"id": "fe-db", "name": "frontend -> db:5432", "src": "frontend", "dst": "db", "port": 5432, "expect": False},
]


def perimeter_tests():
    tests = [{"id": f"pf-{p}", "name": f"Internet -> Web por el firewall :{p}", "port": p, "expect": True}
             for p in settings.PHANTOM["PF_ALLOWED_PORTS"] if p in (80, 443)]
    tests.append({"id": "pf-8081", "name": "Internet -> firewall :8081 (puerto de prueba)", "port": 8081, "expect": False})
    return tests


def _internal(t):
    try:
        p = k8s.exec_in(t["src"], ["nc", "-z", "-w", "2", t["dst"], str(t["port"])], timeout=12)
        reachable = p.returncode == 0
        detail = (p.stderr or p.stdout).strip()[:200]
    except k8s.K8sError as exc:
        return {**t, "layer": "kubernetes", "reachable": None, "ok": False, "detail": str(exc)}
    return {**t, "layer": "kubernetes", "reachable": reachable, "ok": reachable == t["expect"], "detail": detail}


def _perimeter(t):
    reachable = pf.tcp_probe(t["port"])
    return {**t, "layer": "perimetro", "reachable": reachable, "ok": reachable == t["expect"], "detail": ""}


def run_all(layers=("kubernetes", "perimetro")):
    results = []
    if "kubernetes" in layers:
        results += [_internal(t) for t in INTERNAL_TESTS]
    if "perimetro" in layers:
        results += [_perimeter(t) for t in perimeter_tests()]
    return results


def run_ids(ids):
    ids = set(ids)
    out = [_internal(t) for t in INTERNAL_TESTS if t["id"] in ids]
    out += [_perimeter(t) for t in perimeter_tests() if t["id"] in ids]
    return out
