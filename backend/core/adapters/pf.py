"""Adaptador FreeBSD/PF por el canal de gestion restringido.

La llave del controlador esta forzada en el servidor a ejecutar /usr/local/sbin/phantom-pf,
asi que aunque se enviara otro comando, el firewall solo acepta las operaciones permitidas.
"""
import re
import socket
import subprocess

from django.conf import settings

CFG = settings.PHANTOM
ALLOWED_OPS = {"status", "rules", "anchor", "nat", "listening", "logs", "block-port", "unblock-port", "restore", "reset-lab"}


class PFError(Exception):
    pass


def call(op, arg=None, timeout=15):
    if op not in ALLOWED_OPS:
        raise PFError(f"Operacion PF no permitida: {op}")
    if arg is not None and not re.fullmatch(r"\d{1,5}", str(arg)):
        raise PFError(f"Argumento invalido: {arg}")
    cmd = [
        "ssh", "-i", CFG["PF_KEY"], "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
        "-o", "StrictHostKeyChecking=accept-new", "-o", "IdentitiesOnly=yes",
        f"{CFG['PF_USER']}@{CFG['PF_HOST']}", op if arg is None else f"{op} {arg}",
    ]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise PFError("El firewall no respondio a tiempo") from exc
    out = (p.stdout or "") + (p.stderr or "")
    if p.returncode != 0 or out.startswith("ERROR"):
        raise PFError(out.strip() or f"codigo {p.returncode}")
    return out


_PORT_RE = re.compile(r"port\s*(?:=\s*)?(\{[^}]*\}|\S+)")


def _ports(rule):
    m = _PORT_RE.search(rule)
    if not m:
        return []
    out = []
    for tok in re.split(r"[\s,]+", m.group(1).strip("{} ")):
        if tok.isdigit():
            out.append(int(tok))
        elif tok and tok not in ("=", "!="):
            try:                       # pfctl -sr muestra nombres de servicio (ssh, http, https)
                out.append(socket.getservbyname(tok, "tcp"))
            except OSError:
                pass
    return out


def parse_rules(text):
    rules = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(("No ALTQ", "ALTQ")):
            continue
        rules.append({
            "raw": line,
            "action": line.split()[0],
            "direction": "in" if " in " in f" {line} " else ("out" if " out " in f" {line} " else "any"),
            "quick": " quick " in f" {line} ",
            "proto": (re.search(r"proto (\S+)", line) or [None, None])[1],
            "ports": _ports(line),
        })
    return rules


def parse_nat(text):
    """Reenvios (rdr) del firewall: puerto publico -> destino interno."""
    out = []
    for line in text.splitlines():
        m = re.search(r"^rdr .*port = (\S+) -> (\S+) port (\d+)", line.strip())
        if m:
            p = m.group(1)
            port = int(p) if p.isdigit() else socket.getservbyname(p, "tcp")
            out.append({"port": port, "to_host": m.group(2), "to_port": int(m.group(3))})
    return out


def collect():
    status = call("status")
    rules = call("rules")
    anchor = call("anchor")
    listening = call("listening")
    enabled = "Status: Enabled" in status
    return {
        "host": CFG["PF_HOST"],
        "enabled": enabled,
        "status_raw": status.strip(),
        "rules": parse_rules(rules),
        "anchor_rules": parse_rules(anchor),
        "listening": sorted({int(m) for m in re.findall(r":(\d+)\s", listening)}),
        "forwards": parse_nat(call("nat")),
        "allowed_ports": CFG["PF_ALLOWED_PORTS"],
    }


def blocked_by_anchor(port, anchor_rules):
    return any(r["action"] == "block" and port in r["ports"] for r in anchor_rules)


def tcp_probe(port, host=None, timeout=2.0):
    """Prueba de perimetro desde el host de PHANTOM (fuera del firewall)."""
    host = host or CFG["PF_HOST"]
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False
