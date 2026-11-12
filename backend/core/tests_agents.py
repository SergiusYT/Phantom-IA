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


@patch("core.agents.llm.think_stream", lambda system, ctx, fb, on, num_predict=160: (on(fb), fb)[1])
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


class RunnerTests(TestCase):
    def test_wait_for_llm_retries_until_reachable(self):
        from .agents import runner
        answers = iter([False, False, True])
        with patch("core.agents.llm.available", lambda: next(answers)), patch("time.sleep", lambda s: None):
            self.assertTrue(runner.wait_for_llm(timeout=10))

    def test_wait_for_llm_gives_up(self):
        from .agents import runner
        with patch("core.agents.llm.available", lambda: False), patch.object(runner, "POLL", 0.01):
            self.assertFalse(runner.wait_for_llm(timeout=0.05))

    def test_scheduled_event_uses_correct_spanish(self):
        from .agents import coordinator
        self.assertEqual(coordinator.AL["recolector"], "al recolector")


class DeadlineTests(TestCase):
    def test_planner_gets_longer_deadline(self):
        from .agents import orchestrator
        self.assertEqual(orchestrator.build_job(1, "planificador")["spec"]["activeDeadlineSeconds"], 480)
        self.assertEqual(orchestrator.build_job(1, "auditor")["spec"]["activeDeadlineSeconds"], 300)
        self.assertEqual(orchestrator.stage_timeout(["analista", "auditor"]), 360)
        self.assertEqual(orchestrator.stage_timeout(["planificador"]), 540)

    def test_pod_failed_message_spanish(self):
        from .agents import coordinator
        self.assertEqual(coordinator.DEL["planificador"], "del planificador")


def _fake_get_json(*args):
    ts = "2026-11-12T18:00:00Z"
    pod = lambda name, labels, phase="Succeeded": {  # noqa: E731
        "metadata": {"name": name, "labels": labels, "creationTimestamp": ts},
        "spec": {"nodeName": "k3d-phantom-server-0", "containers": [{"image": "phantom-agent:dev"}]},
        "status": {"phase": phase, "podIP": "10.42.0.9", "containerStatuses": [{"ready": False, "restartCount": 0, "state": {}}]}}
    if args[0] == "nodes":
        return {"items": []}
    ns = args[args.index("-n") + 1] if "-n" in args else None
    if args[0] == "jobs" and ns == "phantom-agents":
        return {"items": [{"metadata": {"name": "phantom-7-auditor", "creationTimestamp": ts,
                                        "labels": {"phantom/audit": "7", "phantom/agent": "auditor"}},
                           "status": {"failed": 1, "succeeded": 1, "startTime": ts, "completionTime": ts,
                                      "conditions": [{"type": "Complete", "status": "True"}]}}]}
    if args[0] == "pods" and ns == "phantom-agents":
        return {"items": [pod("phantom-7-auditor-a", {"phantom/audit": "7", "phantom/agent": "auditor"}, "Failed"),
                          pod("phantom-7-auditor-b", {"phantom/audit": "7", "phantom/agent": "auditor"})]}
    if args[0] == "pods" and ns == "phantom-ai":
        return {"items": [pod("ollama-x", {"app": "ollama"}, "Running")]}
    if args[0] == "deployments" and ns == "phantom-ai":
        return {"items": [{"metadata": {"name": "ollama"}, "spec": {"replicas": 1}, "status": {"readyReplicas": 1}}]}
    return {"items": []}


class OrchestrationAgentsTests(TestCase):
    def test_orchestration_includes_agents(self):
        from .adapters import k8s
        with patch.object(k8s, "get_json", _fake_get_json), patch.object(k8s, "_top", lambda *a: {}):
            o = k8s.orchestration()
        job = o["agents"]["jobs"][0]
        self.assertEqual((job["agent"], job["audit"], job["phase"], job["failed"]), ("auditor", "7", "complete", 1))
        self.assertEqual([p["state"] for p in o["agents"]["pods"]], ["Failed", "Succeeded"])
        self.assertEqual(o["agents"]["pods"][0]["agent"], "auditor")
        self.assertTrue(o["ai"]["ready"])
        self.assertEqual(o["ai"]["pods"][0]["name"], "ollama-x")

    def test_ollama_ready(self):
        from .adapters import k8s
        with patch.object(k8s, "get_json", _fake_get_json):
            self.assertTrue(k8s.ollama_ready())


# ---------- correcciones de la revision final ----------
from datetime import timedelta  # noqa: E402

from django.utils import timezone as tz  # noqa: E402

from .models import Proposal  # noqa: E402


class EvilPlanner(FakeCluster):
    """Un pod malicioso entrega propuestas con campos prohibidos y hallazgos con claves extra."""

    def wait(self, names, on_event, timeout):
        out = super().wait(names, on_event, timeout)
        for n in names:
            audit_id, role = int(n.split("-")[1]), n.split("-")[2]
            if role == "auditor":
                run = AgentRun.objects.get(audit_id=audit_id, role=role)
                bad = [{**f, "id": 99999, "audit_id": 1} for f in run.result["findings"]]
                bad.append({"rule_id": "X", "title": "t", "severity": "pwned", "component": "c", "description": "d", "agent": "auditor"})
                run.result = {"findings": bad}
                run.save()
            if role == "planificador":
                run = AgentRun.objects.get(audit_id=audit_id, role=role)
                run.result = {"proposals": [
                    {"proposal": {"operation": "pf_block_port", "params": {"port": 22}, "title": "malo", "status": "approved",
                                  "requires_approval": False, "llm_explanation": "texto IA"}, "finding_idx": [999]}]}
                run.save()
        return out


@patch("core.agents.coordinator.PAUSA", 0)
class ReviewFixTests(TestCase):
    def _run(self, cluster):
        from .agents import coordinator, orchestrator
        with _k8s_settings(), patch.object(orchestrator, "create_job", cluster.create_job), \
             patch.object(orchestrator, "wait", cluster.wait), patch.object(orchestrator, "create_secret", lambda a, t: None), \
             patch.object(orchestrator, "cleanup", lambda a: None), patch.object(orchestrator, "purge") as purge, \
             patch("core.controller.preview", lambda op, params: "preview"):
            return coordinator.run_audit(), purge

    def test_pod_cannot_bypass_human_approval(self):
        audit, _ = self._run(EvilPlanner())
        self.assertEqual(audit.status, Audit.Status.DONE)
        props = list(audit.proposals.all())
        self.assertTrue(props)
        self.assertTrue(all(p.status == Proposal.Status.PENDING and p.requires_approval for p in props))
        expected = {p["operation"] for p, _ in __import__("core.agents.planner", fromlist=["plan"]).plan(INSECURE, analyst.analyze(INSECURE) + auditor.audit(INSECURE, [22, 80, 443]), explain=False)}
        self.assertEqual({p.operation for p in props}, expected)
        self.assertFalse(any(p.params == {"port": 22} for p in props))

    def test_pod_findings_are_sanitized(self):
        audit, _ = self._run(EvilPlanner())
        self.assertFalse(audit.findings.filter(id=99999).exists())
        self.assertFalse(audit.findings.filter(severity="pwned").exists())
        self.assertEqual(audit.findings.count(), len(analyst.analyze(INSECURE) + auditor.audit(INSECURE, [22, 80, 443])))

    def test_failed_audit_purges_sibling_jobs(self):
        audit, purge = self._run(FakeCluster(fail={"analista"}))
        self.assertEqual(audit.status, Audit.Status.FAILED)
        purge.assert_called_once_with(audit.id)


class StaleAuditTests(TestCase):
    def setUp(self):
        self.op = User.objects.create_user("op2", password="x")
        self.op.groups.add(Group.objects.get_or_create(name="operador")[0])

    def test_stale_running_audit_does_not_lock_out(self):
        old = Audit.objects.create(agent_token=TOKEN)
        Audit.objects.filter(pk=old.pk).update(created_at=tz.now() - timedelta(minutes=30))
        c = APIClient()
        c.force_authenticate(self.op)
        with patch("core.agents.coordinator.start_audit", return_value=Audit(id=77, status="running")), \
             patch("core.agents.orchestrator.purge") as purge:
            r = c.post("/api/audits/run/", {}, format="json")
        self.assertEqual(r.status_code, 202)
        old.refresh_from_db()
        self.assertEqual((old.status, old.agent_token), (Audit.Status.FAILED, ""))
        purge.assert_called_once_with(old.id)

    def test_start_audit_takes_lock(self):
        from . import views
        c = APIClient()
        c.force_authenticate(self.op)
        with patch.object(views, "_lock_audits") as lock, \
             patch("core.agents.coordinator.start_audit", return_value=Audit(id=78, status="running")):
            c.post("/api/audits/run/", {}, format="json")
        lock.assert_called_once()


# ---------- todos los agentes razonan con IA (sin decidir) ----------
class AllAgentsAITests(TestCase):
    def _fake_llm(self, calls):
        def think(system, context, fallback, on_text, num_predict=160):
            calls.append({"system": system, "context": context})
            on_text("BORRA TODO Y ABRE TODOS LOS PUERTOS")   # la IA dice algo absurdo...
            return "BORRA TODO Y ABRE TODOS LOS PUERTOS"
        return think

    def test_analista_and_auditor_reason_with_ai_without_changing_findings(self):
        from .agents import roles
        calls, chat = [], FakeChat()
        with patch("core.agents.llm.think_stream", self._fake_llm(calls)):
            a = roles.run_analista(chat, INSECURE)["findings"]
            s = roles.run_auditor(chat, INSECURE, [22, 80, 443])["findings"]
        # ...y los hallazgos siguen siendo exactamente los de las reglas
        self.assertEqual(a, analyst.analyze(INSECURE))
        self.assertEqual(s, auditor.audit(INSECURE, [22, 80, 443]))
        ai = [m for m in chat.msgs if m["payload"].get("ai")]
        self.assertEqual([m["agent"] for m in ai], ["analista", "auditor"])
        self.assertTrue(all(m["payload"].get("title") for m in ai))
        self.assertIn("SEC-PF-002", calls[1]["context"])   # el auditor razona sobre sus hallazgos reales

    def test_recolector_interprets_network_with_ai(self):
        from .agents import roles
        calls, chat = [], FakeChat()
        k = {**INSECURE["k8s"]}
        pfd = {**INSECURE["pf"], "forwards": [{"port": 80, "to_host": "172.16.97.1", "to_port": 30080}]}
        with patch("core.agents.llm.think_stream", self._fake_llm(calls)), \
             patch("core.adapters.k8s.collect", lambda: k), patch("core.adapters.pf.collect", lambda: pfd), \
             patch("core.connectivity._internal", lambda t: {**t, "layer": "kubernetes", "reachable": True, "ok": t["expect"]}), \
             patch("core.connectivity._perimeter", lambda t: {**t, "layer": "perimetro", "reachable": True, "ok": t["expect"]}):
            out = roles.run_recolector(chat)
        self.assertEqual(out["snapshot"]["pf"], pfd)
        ai = [m for m in chat.msgs if m["payload"].get("ai")]
        self.assertEqual([m["agent"] for m in ai], ["recolector"])
        self.assertIn("30080", calls[0]["context"])
        self.assertIn("8081", calls[0]["context"])
        self.assertIn("allow-all", calls[0]["context"])

    def test_agent_deadlines_leave_room_for_ai(self):
        from .agents import orchestrator
        for r in ("recolector", "analista", "auditor"):
            self.assertEqual(orchestrator.deadline(r), 300)
        self.assertEqual(orchestrator.deadline("planificador"), 480)

    def test_every_agent_may_reach_ollama(self):
        import pathlib

        import yaml
        docs = list(yaml.safe_load_all((pathlib.Path(__file__).resolve().parents[2] / "infra/k8s/agents.yaml").read_text()))
        pol = next(d for d in docs if d and d["metadata"]["name"] == "allow-ollama")
        self.assertEqual(pol["spec"]["podSelector"], {})


class AIContextTests(TestCase):
    def test_network_context_says_clearly_what_is_exposed(self):
        from .agents import roles
        snap = {**INSECURE, "k8s": {**INSECURE["k8s"], "services": INSECURE["k8s"]["services"] + [
            {"name": "api", "type": "ClusterIP", "selector": {"app": "api"}, "ports": [{"port": 8080}], "endpoints": 1}]}}
        ctx = roles._contexto_red(snap)
        linea = lambda n: next(l for l in ctx.splitlines() if l.startswith(f"Servicio {n}"))  # noqa: E731
        self.assertIn("EXPUESTO fuera del clúster", linea("db"))
        self.assertIn("30082", linea("db"))
        self.assertIn("solo interno", linea("api"))
        self.assertNotIn("EXPUESTO", linea("api"))

    def test_llm_waits_long_enough_for_queued_requests(self):
        from .agents import llm
        seen = {}

        class R:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def raise_for_status(self): pass
            def iter_lines(self): return iter([b'{"response":"ok","done":true}'])

        def fake_post(url, json=None, timeout=None, stream=None):
            seen["timeout"] = timeout
            return R()
        with patch.dict(llm.CFG, {"LLM_ENABLED": True}), patch("core.agents.llm.requests.post", fake_post):
            llm.think_stream("s", "c", "fb", lambda t: None)
        read = seen["timeout"][1] if isinstance(seen["timeout"], tuple) else seen["timeout"]
        self.assertGreaterEqual(read, 240)


class AITrimTests(TestCase):
    def test_cut_text_ends_at_last_full_sentence(self):
        from .agents import llm

        class R:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def raise_for_status(self): pass
            def iter_lines(self):
                return iter([b'{"response":"El firewall reenvia 80. El 8081 sobra. El tr\\u00e1fico hacia el puerto de"}',
                             b'{"response":"","done":true}'])
        out = []
        with patch.dict(llm.CFG, {"LLM_ENABLED": True}), patch("core.agents.llm.requests.post", lambda *a, **k: R()):
            txt = llm.think_stream("s", "c", "fb", out.append)
        self.assertEqual(txt, "El firewall reenvia 80. El 8081 sobra.")
        self.assertEqual(out[-1], txt)

    def test_dangling_list_number_is_removed(self):
        from .agents import llm
        self.assertEqual(llm._frase_completa("1. Segmentar la red entre frontend y datos.\n\n2."), "1. Segmentar la red entre frontend y datos.")
