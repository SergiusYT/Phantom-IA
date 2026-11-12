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


from django.test import override_settings  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

from .models import AgentRun, Audit, AuditMessage  # noqa: E402

TOKEN = "t" * 64


@override_settings(ROOT_URLCONF="phantom.agent_urls")
class AgentApiTests(TestCase):
    def setUp(self):
        self.audit = Audit.objects.create(agent_token=TOKEN)
        self.c = APIClient()
        self.c.credentials(HTTP_X_PHANTOM_AGENT=TOKEN)

    def url(self, rest, audit=None):
        return f"/api/agent/{(audit or self.audit).id}/{rest}"

    def test_agent_token_rejected_when_audit_finished(self):
        self.audit.status = Audit.Status.DONE
        self.audit.save()
        self.assertEqual(self.c.post(self.url("start/recolector/")).status_code, 403)

    def test_agent_token_rejected_for_other_audit(self):
        other = Audit.objects.create(agent_token="o" * 64)
        self.assertEqual(self.c.post(self.url("start/recolector/", other)).status_code, 403)

    def test_agent_token_rejected_when_missing_or_wrong(self):
        self.assertEqual(APIClient().post(self.url("start/recolector/")).status_code, 403)
        bad = APIClient()
        bad.credentials(HTTP_X_PHANTOM_AGENT="x" * 64)
        self.assertEqual(bad.post(self.url("start/recolector/")).status_code, 403)

    def test_unknown_role_rejected(self):
        self.assertEqual(self.c.post(self.url("start/hacker/")).status_code, 404)

    def test_fail_only_on_first_attempt(self):
        self.audit.fail_agent = "auditor"
        self.audit.save()
        AgentRun.objects.create(audit=self.audit, role="recolector", status="done",
                                result={"snapshot": INSECURE, "errors": []})
        r1 = self.c.post(self.url("start/auditor/")).json()
        self.assertEqual((r1["attempt"], r1["fail"]), (1, True))
        self.assertEqual(r1["input"]["snapshot"], INSECURE)
        seq = self.c.post(self.url("messages/"), {"agent": "auditor", "text": "hola"}, format="json").json()["seq"]
        r2 = self.c.post(self.url("start/auditor/")).json()
        self.assertEqual((r2["attempt"], r2["fail"]), (2, False))
        m = AuditMessage.objects.get(audit=self.audit, seq=seq)
        self.assertTrue(m.payload["failed_attempt"])
        self.assertEqual(m.payload["attempt"], 1)
        self.assertTrue(AuditMessage.objects.filter(audit=self.audit, agent="coordinador", text__icontains="intento 2").exists())

    def test_messages_seq_and_streaming_patch(self):
        s1 = self.c.post(self.url("messages/"), {"agent": "planificador", "text": "", "streaming": True}, format="json").json()["seq"]
        s2 = self.c.post(self.url("messages/"), {"agent": "auditor", "text": "b"}, format="json").json()["seq"]
        self.assertEqual(s2, s1 + 1)
        self.assertEqual(self.c.patch(self.url(f"messages/{s1}/"), {"text": "abc", "streaming": False}, format="json").status_code, 204)
        m = AuditMessage.objects.get(audit=self.audit, seq=s1)
        self.assertEqual((m.text, m.streaming), ("abc", False))

    def test_result_delivery_is_idempotent(self):
        self.c.post(self.url("start/analista/"))
        self.assertEqual(self.c.post(self.url("result/analista/"), {"findings": [{"rule_id": "A"}]}, format="json").status_code, 200)
        self.assertEqual(self.c.post(self.url("result/analista/"), {"findings": [{"rule_id": "B"}]}, format="json").status_code, 200)
        run = AgentRun.objects.get(audit=self.audit, role="analista")
        self.assertEqual((run.status, run.result), ("done", {"findings": [{"rule_id": "A"}]}))

    def test_planner_input_merges_findings(self):
        AgentRun.objects.create(audit=self.audit, role="recolector", status="done", result={"snapshot": INSECURE, "errors": []})
        AgentRun.objects.create(audit=self.audit, role="analista", status="done", result={"findings": [{"rule_id": "A"}]})
        AgentRun.objects.create(audit=self.audit, role="auditor", status="done", result={"findings": [{"rule_id": "S"}]})
        inp = self.c.post(self.url("start/planificador/")).json()["input"]
        self.assertEqual([f["rule_id"] for f in inp["findings"]], ["A", "S"])

    def test_main_api_not_served_on_agent_urlconf(self):
        self.assertEqual(self.c.get("/api/audits/").status_code, 404)
        self.assertEqual(self.c.get("/api/health/").status_code, 404)


class RemoteChatTests(TestCase):
    def test_remote_chat_posts_and_streams(self):
        from .agents import remote
        calls = []

        class FakeClient:
            def post_message(self, **m):
                calls.append(("post", m))
                return len(calls)

            def patch_message(self, seq, **f):
                calls.append(("patch", seq, f))

        chat = remote.RemoteChat(FakeClient(), pause=0)
        chat.say("auditor", "hola", kind="finding", to="planificador", finding={"x": 1})
        h, update = chat.stream("planificador", to="operador", title="t")
        update("par")
        chat.end_stream(h)
        self.assertEqual(calls[0], ("post", {"agent": "auditor", "text": "hola", "kind": "finding", "to": "planificador",
                                             "payload": {"finding": {"x": 1}}, "streaming": False}))
        self.assertEqual(calls[2], ("patch", 2, {"text": "par"}))
        self.assertEqual(calls[3], ("patch", 2, {"streaming": False}))


class TokenNotExposedTests(TestCase):
    def test_audit_detail_and_schema_hide_agent_token(self):
        from django.contrib.auth.models import User

        from . import insights
        u = User.objects.create_superuser("adm", password="x")
        a = Audit.objects.create(agent_token=TOKEN)
        c = APIClient()
        c.force_authenticate(u)
        body = c.get(f"/api/audits/{a.id}/").json()
        self.assertNotIn("agent_token", body)
        self.assertNotIn(TOKEN, str(body))
        self.assertNotIn("agent_token", str(insights.schema()))
