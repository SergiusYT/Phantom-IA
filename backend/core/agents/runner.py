"""Entrypoint del pod de un agente:  python -m core.agents.runner --role auditor

Variables: PHANTOM_AGENT_API, PHANTOM_AUDIT_ID, PHANTOM_AGENT_TOKEN (las pone el Job).
Exit 0 = trabajo entregado; exit != 0 = Kubernetes reintenta el pod (backoffLimit).
"""
import argparse
import os
import sys

import django

POLL = 1.0


def wait_for_llm(timeout=20):
    """La NetworkPolicy que deja al pod hablar con Ollama tarda unos segundos en aplicarse."""
    import time

    from . import llm
    deadline = time.monotonic() + timeout
    while True:
        if llm.available():
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(POLL)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--role", required=True, choices=["recolector", "analista", "auditor", "planificador"])
    role = ap.parse_args(argv).role
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "phantom.settings")
    django.setup()   # solo para settings.PHANTOM; el pod no usa base de datos

    from . import roles
    from .remote import AgentClient, RemoteChat

    client = AgentClient(os.environ["PHANTOM_AGENT_API"], os.environ["PHANTOM_AUDIT_ID"], os.environ["PHANTOM_AGENT_TOKEN"])
    chat = RemoteChat(client)
    job = client.start(role)
    if job["fail"]:
        chat.say(role, "Simulo una caída (prueba de orquestación). Kubernetes debería levantarme otra vez.", kind="error")
        return 3
    inp = job["input"]
    try:
        if role == "recolector":
            out = roles.run_recolector(chat)
        elif role == "analista":
            out = roles.run_analista(chat, inp["snapshot"])
        elif role == "auditor":
            out = roles.run_auditor(chat, inp["snapshot"], inp["allowed_ports"])
        else:
            if not wait_for_llm():
                chat.say(role, "No alcanzo la IA del clúster; uso explicaciones de plantilla.", kind="error")
            out = roles.run_planificador(chat, inp["snapshot"], inp["findings"])
    except Exception as exc:  # noqa: BLE001 - se informa en la Sala y Kubernetes reintenta
        try:
            chat.say(role, f"Fallé con un error inesperado: {exc}", kind="error")
        except Exception:  # noqa: BLE001 - la API tampoco responde; el exit code basta
            pass
        return 1
    client.deliver(role, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
