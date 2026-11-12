"""Pruebas de los agentes orquestados por Kubernetes (roles, API de agentes, coordinador)."""
from unittest.mock import patch

from django.test import TestCase

from . import controller
from .agents import analyst, auditor
from .tests import INSECURE


class FakeChat:
    """Implementa la interfaz chat (say/stream/end_stream) acumulando mensajes en memoria."""

    def __init__(self):
        self.msgs = []

    def say(self, agent, text, kind="say", to="", **payload):
        self.msgs.append({"agent": agent, "text": text, "kind": kind, "to": to, "payload": payload})
        return len(self.msgs)

    def stream(self, agent, to="", **payload):
        m = {"agent": agent, "text": "", "kind": "say", "to": to, "payload": payload, "streaming": True}
        self.msgs.append(m)

        def update(text):
            m["text"] = text
        return m, update

    def end_stream(self, m):
        m["streaming"] = False


class RolesTests(TestCase):
    def test_roles_pipeline_matches_current_findings(self):
        from .agents import roles
        chat = FakeChat()
        a = roles.run_analista(chat, INSECURE)["findings"]
        s = roles.run_auditor(chat, INSECURE, [22, 80, 443])["findings"]
        expected = analyst.analyze(INSECURE) + auditor.audit(INSECURE, [22, 80, 443])
        self.assertEqual([f["rule_id"] for f in a + s], [f["rule_id"] for f in expected])
        with patch("core.agents.llm.explain_stream", lambda ctx, fb, on: (on("x"), "x")[1]):
            props = roles.run_planificador(chat, INSECURE, a + s)["proposals"]
        self.assertTrue(props)
        self.assertTrue({p["proposal"]["operation"] for p in props} <= set(controller.OPERATIONS))
        self.assertTrue(all("preview" not in p["proposal"] for p in props))
        self.assertTrue(all(p["proposal"]["llm_explanation"] == "x" for p in props))
        self.assertTrue(any(m["agent"] == "auditor" and m["kind"] == "finding" for m in chat.msgs))
