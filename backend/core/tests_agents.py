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


from django.contrib.auth.models import Group, User  # noqa: E402


def _k8s_settings(**extra):
    from django.conf import settings as s
    return override_settings(PHANTOM={**s.PHANTOM, "AGENTS_MODE": "k8s", **extra})


class OrchestratorManifestTests(TestCase):
    def test_job_manifest_security(self):
        from .agents import orchestrator
        an = orchestrator.build_job(7, "analista")
        rec = orchestrator.build_job(7, "recolector")
        for job in (an, rec):
            spec, pod = job["spec"], job["spec"]["template"]["spec"]
            self.assertEqual(job["metadata"]["namespace"], "phantom-agents")
            self.assertEqual(spec["backoffLimit"], 1)
            self.assertEqual(spec["ttlSecondsAfterFinished"], 600)
            self.assertEqual(pod["restartPolicy"], "Never")
            self.assertEqual(pod["containers"][0]["imagePullPolicy"], "Never")
            self.assertEqual(job["metadata"]["labels"]["phantom/audit"], "7")
        self.assertEqual(an["metadata"]["name"], "phantom-7-analista")
        apod, rpod = an["spec"]["template"]["spec"], rec["spec"]["template"]["spec"]
        self.assertEqual(apod["serviceAccountName"], "phantom-agente")
        self.assertFalse(apod["automountServiceAccountToken"])
        self.assertNotIn("volumes", apod)
        self.assertEqual(rpod["serviceAccountName"], "phantom-recolector")
        self.assertEqual(rpod["volumes"][0]["secret"]["secretName"], "phantom-pf-ro")
        env = {e["name"]: e for e in apod["containers"][0]["env"]}
        self.assertEqual(env["PHANTOM_AGENT_TOKEN"]["valueFrom"]["secretKeyRef"]["name"], "phantom-audit-7")
        self.assertNotIn("PHANTOM_PF_KEY", env)
        self.assertIn("PHANTOM_PF_KEY", {e["name"] for e in rpod["containers"][0]["env"]})

    def test_wait_times_out(self):
        import time

        from .agents import orchestrator
        with patch.object(orchestrator, "job_state", lambda n: {"phase": "running", "node": "n", "failed_pods": 0}), \
             patch.object(orchestrator, "POLL", 0.05):
            t = time.monotonic()
            out = orchestrator.wait(["phantom-1-auditor"], lambda n, s: None, timeout=0.3)
        self.assertEqual(out, {"phantom-1-auditor": "timeout"})
        self.assertLess(time.monotonic() - t, 2)

    def test_wait_reports_events_and_final_phase(self):
        from .agents import orchestrator
        seq = iter([{"phase": "pending", "node": None, "failed_pods": 0},
                    {"phase": "running", "node": "k3d-phantom-agent-0", "failed_pods": 0},
                    {"phase": "running", "node": "k3d-phantom-agent-0", "failed_pods": 1},
                    {"phase": "complete", "node": "k3d-phantom-agent-0", "failed_pods": 1}])
        events = []
        with patch.object(orchestrator, "job_state", lambda n: next(seq)), patch.object(orchestrator, "POLL", 0):
            out = orchestrator.wait(["j"], lambda n, s: events.append(dict(s)), timeout=5)
        self.assertEqual(out, {"j": "complete"})
        self.assertEqual([e["phase"] for e in events], ["pending", "running", "running", "complete"])


class FakeCluster:
    """Simula Kubernetes: cada Job 'termina' entregando el resultado del rol como lo haría el pod."""

    def __init__(self, fail=()):
        self.created, self.waited, self.fail = [], [], set(fail)

    def create_job(self, audit_id, role):
        self.created.append(role)
        return f"phantom-{audit_id}-{role}"

    def wait(self, names, on_event, timeout):
        self.waited.append([n.split("-")[-1] for n in names])
        out = {}
        for n in names:
            audit_id, role = int(n.split("-")[1]), n.split("-")[2]
            on_event(n, {"phase": "running", "node": "k3d-phantom-agent-0", "failed_pods": 0})
            if role in self.fail:
                out[n] = "failed"
                continue
            res = {"recolector": {"snapshot": INSECURE, "errors": []},
                   "analista": {"findings": analyst.analyze(INSECURE)},
                   "auditor": {"findings": auditor.audit(INSECURE, [22, 80, 443])},
                   "planificador": {"proposals": []}}[role]
            AgentRun.objects.update_or_create(audit_id=audit_id, role=role, defaults={"status": "done", "result": res})
            out[n] = "complete"
        return out


@patch("core.agents.coordinator.PAUSA", 0)
class CoordinatorK8sTests(TestCase):
    def _run(self, cluster, **kw):
        from .agents import coordinator, orchestrator
        with _k8s_settings(**kw), patch.object(orchestrator, "create_job", cluster.create_job), \
             patch.object(orchestrator, "wait", cluster.wait), patch.object(orchestrator, "create_secret", lambda a, t: None), \
             patch.object(orchestrator, "cleanup", lambda a: None), \
             patch("core.controller.preview", lambda op, params: "preview"):
            return coordinator.run_audit()

    def test_stages_order_and_parallelism(self):
        c = FakeCluster()
        audit = self._run(c)
        self.assertEqual(c.created, ["recolector", "analista", "auditor", "planificador"])
        self.assertEqual(c.waited, [["recolector"], ["analista", "auditor"], ["planificador"]])
        self.assertEqual(audit.status, Audit.Status.DONE)
        self.assertEqual(audit.agent_token, "")
        rules = sorted(audit.findings.values_list("rule_id", flat=True))
        self.assertEqual(rules, sorted(f["rule_id"] for f in analyst.analyze(INSECURE) + auditor.audit(INSECURE, [22, 80, 443])))
        self.assertTrue(audit.messages.filter(kind="k8s", text__icontains="k3d-phantom-agent-0").exists())

    def test_failed_job_fails_audit_with_message(self):
        audit = self._run(FakeCluster(fail={"auditor"}))
        self.assertEqual(audit.status, Audit.Status.FAILED)
        last = audit.messages.order_by("-seq").first()
        self.assertIn("auditor", last.text)
        self.assertEqual(audit.agent_token, "")
        self.assertEqual(audit.proposals.count(), 0)


class StartAuditViewTests(TestCase):
    def setUp(self):
        self.op = User.objects.create_user("op", password="x")
        self.op.groups.add(Group.objects.get_or_create(name="operador")[0])
        self.obs = User.objects.create_user("obs", password="x")

    def _client(self, u):
        c = APIClient()
        c.force_authenticate(u)
        return c

    def test_second_audit_conflict(self):
        Audit.objects.create()
        with patch("core.agents.coordinator.start_audit") as st:
            r = self._client(self.op).post("/api/audits/run/", {}, format="json")
        self.assertEqual(r.status_code, 409)
        st.assert_not_called()

    def test_observer_cannot_simulate_failure(self):
        with patch("core.agents.coordinator.start_audit") as st:
            r = self._client(self.obs).post("/api/audits/run/", {"fail_agent": "auditor"}, format="json")
        self.assertEqual(r.status_code, 403)
        st.assert_not_called()

    def test_operator_simulates_failure(self):
        with patch("core.agents.coordinator.start_audit", return_value=Audit(id=5, status="running")) as st:
            r = self._client(self.op).post("/api/audits/run/", {"fail_agent": "auditor"}, format="json")
        self.assertEqual(r.status_code, 202)
        st.assert_called_once_with(self.op, fail_agent="auditor")

    def test_invalid_fail_agent(self):
        with patch("core.agents.coordinator.start_audit") as st:
            r = self._client(self.op).post("/api/audits/run/", {"fail_agent": "hacker"}, format="json")
        self.assertEqual(r.status_code, 400)
        st.assert_not_called()


class RecoverAuditsTests(TestCase):
    def test_recover_audits_purges_jobs(self):
        from django.core.management import call_command
        a = Audit.objects.create(agent_token=TOKEN)
        with patch("core.agents.orchestrator.purge") as purge:
            call_command("recover_audits", stdout=open("/dev/null", "w"))
        purge.assert_called_once_with(a.id)
        a.refresh_from_db()
        self.assertEqual((a.status, a.agent_token), (Audit.Status.FAILED, ""))
