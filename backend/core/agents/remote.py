"""Lado del pod: cliente HTTP de la API de agentes y Chat remoto."""
import time

import requests


class AgentClient:
    def __init__(self, api_url, audit_id, token, timeout=15):
        self.base = f"{api_url.rstrip('/')}/api/agent/{int(audit_id)}"
        self.s = requests.Session()
        self.s.headers["X-Phantom-Agent"] = token
        self.timeout = timeout

    def _req(self, method, path, **kw):
        r = self.s.request(method, f"{self.base}/{path}", timeout=self.timeout, **kw)
        r.raise_for_status()
        return r.json() if r.content else None

    def start(self, role):
        return self._req("POST", f"start/{role}/")

    def post_message(self, agent, text="", kind="say", to="", payload=None, streaming=False):
        return self._req("POST", "messages/", json={"agent": agent, "text": text, "kind": kind, "to": to,
                                                     "payload": payload or {}, "streaming": streaming})["seq"]

    def patch_message(self, seq, **fields):
        self._req("PATCH", f"messages/{seq}/", json=fields)

    def deliver(self, role, result):
        self._req("POST", f"result/{role}/", json=result)


class RemoteChat:
    """Misma interfaz que coordinator.Chat, pero publica por la API de agentes."""

    def __init__(self, client, pause=0.35):
        self.client = client
        self.pause = pause

    def say(self, agent, text, kind="say", to="", **payload):
        seq = self.client.post_message(agent=agent, text=text, kind=kind, to=to, payload=payload, streaming=False)
        time.sleep(self.pause)
        return seq

    def stream(self, agent, to="", **payload):
        seq = self.client.post_message(agent=agent, text="", kind="say", to=to, payload=payload, streaming=True)

        def update(text):
            self.client.patch_message(seq, text=text)
        return seq, update

    def end_stream(self, seq):
        self.client.patch_message(seq, streaming=False)
