"""Pruebas unitarias de agentes y controlador sin infraestructura real."""
from unittest.mock import patch

from django.test import TestCase

from . import controller
from .agents import analyst, auditor, planner

INSECURE = {
    "k8s": {
        "namespace": "phantom-demo",
        "nodes": [{"name": "n1", "ready": True, "version": "v1", "addresses": []}],
        "pods": [{"name": f"{a}-x", "labels": {"app": a}, "phase": "Running", "ip": "10.0.0.1",
                  "ready": True, "restarts": 0} for a in ("frontend", "api", "db")],
        "deployments": [{"name": a, "replicas": 1, "available": 1} for a in ("frontend", "api", "db")],
        "services": [
            {"name": "frontend", "type": "NodePort", "selector": {"app": "frontend"},
             "ports": [{"port": 80, "nodePort": 30080}], "endpoints": 1},
            {"name": "db", "type": "NodePort", "selector": {"app": "db"},
             "ports": [{"port": 5432, "nodePort": 30082}], "endpoints": 1},
        ],
        "network_policies": [{"name": "allow-all", "pod_selector": {}, "policy_types": ["Ingress"],
                              "ingress": [{}], "egress": None}],
        "warning_events": [],
    },
    "pf": {
        "host": "fw", "enabled": True, "status_raw": "Status: Enabled",
        "rules": [
            {"raw": "block return log all", "action": "block", "direction": "any", "quick": False, "proto": None, "ports": []},
            {"raw": "pass in quick proto tcp to port = 22", "action": "pass", "direction": "in", "quick": True, "proto": "tcp", "ports": [22]},
            {"raw": "pass in quick proto tcp to port = 8081", "action": "pass", "direction": "in", "quick": True, "proto": "tcp", "ports": [8081]},
        ],
        "anchor_rules": [], "listening": [22, 8081], "allowed_ports": [22, 80, 443],
    },
    "connectivity": [
        {"id": "fe-db", "name": "frontend -> db:5432", "layer": "kubernetes", "port": 5432,
         "expect": False, "reachable": True, "ok": False},
    ],
}


@patch("core.agents.llm.explain", lambda ctx, fallback: fallback)
class AgentTests(TestCase):
    def test_auditor_detects_demo_risks(self):
        rules = {f["rule_id"] for f in auditor.audit(INSECURE, [22, 80, 443])}
        self.assertTrue({"SEC-K8S-002", "SEC-K8S-004", "SEC-PF-002", "SEC-NET-001"} <= rules)

    def test_analyst_healthy_cluster_has_no_operational_findings(self):
        self.assertEqual(analyst.analyze(INSECURE), [])

    def test_planner_only_uses_allowed_operations(self):
        found = analyst.analyze(INSECURE) + auditor.audit(INSECURE, [22, 80, 443])
        props = planner.plan(INSECURE, found)
        ops = {p["operation"] for p, _ in props}
        self.assertEqual(ops, {"k8s_apply_segmentation", "k8s_service_to_clusterip", "pf_block_port"})
        self.assertTrue(ops <= set(controller.OPERATIONS))
        seg = next(p for p, _ in props if p["operation"] == "k8s_apply_segmentation")
        self.assertEqual(seg["params"]["remove_policies"], ["allow-all"])


class ControllerValidationTests(TestCase):
    def test_rejects_unknown_operation(self):
        with self.assertRaises(controller.ValidationError):
            controller.preview("rm_rf", {})

    def test_rejects_protected_and_authorized_ports(self):
        for port in (22, 443, 0, "8081"):
            with self.assertRaises(controller.ValidationError):
                controller.pf_validate({"port": port})
        self.assertEqual(controller.pf_validate({"port": 8081}), 8081)

    def test_rejects_foreign_namespace(self):
        with self.assertRaises(controller.ValidationError):
            controller.seg_validate({"namespace": "kube-system"})

    def test_segmentation_preview_contains_expected_flows(self):
        text = controller.seg_preview({"namespace": "phantom-demo", "remove_policies": ["allow-all"]})
        for name in controller.SEG_POLICIES:
            self.assertIn(name, text)
        self.assertIn("allow-all", text)


class AnalystDegradedTests(TestCase):
    def test_reports_unavailable_deployment_and_service_without_endpoints(self):
        import copy
        snap = copy.deepcopy(INSECURE)
        snap["k8s"]["deployments"][1]["available"] = 0
        snap["k8s"]["services"][1]["endpoints"] = 0
        found = analyst.analyze(snap)
        rules = {f["rule_id"] for f in found}
        self.assertTrue({"NET-002", "NET-005"} <= rules)
        self.assertIn("0 de 1", next(f for f in found if f["rule_id"] == "NET-002")["description"])


class InsightsTests(TestCase):
    def setUp(self):
        from django.utils import timezone
        from .models import Audit, Finding
        a = Audit.objects.create(status="done", finished_at=timezone.now())
        Finding.objects.create(audit=a, agent="auditor", rule_id="SEC-K8S-004", title="BD expuesta", severity="critical", component="x", description="d")
        Finding.objects.create(audit=a, agent="auditor", rule_id="SEC-PF-002", title="Puerto", severity="high", component="x", description="d")

    def test_score_uses_severity_weights(self):
        from . import insights
        self.assertEqual(insights.audits_summary()[-1]["score"], 100 - 25 - 12)

    def test_db_explorer_filters_and_rejects_unknown_tables(self):
        from . import insights
        self.assertEqual(insights.table("hallazgos", {"severity": "critical"})["total"], 1)
        self.assertEqual(insights.table("hallazgos", {"q": "puerto"})["total"], 1)
        self.assertIsNone(insights.table("auth_user", {}))
        # la tabla de usuarios es consultable, pero nunca expone contrasenas ni tokens
        cols = [c["campo"] for c in insights.table("usuarios", {})["cols"]]
        self.assertNotIn("password", cols)
        esquema = insights.schema()
        self.assertFalse(any(c["nombre"] == "password" for t in esquema["tablas"] for c in t["cols"]))
        self.assertNotIn("authtoken_token", [t["db"] for t in esquema["tablas"]])


class PFParseTests(TestCase):
    def test_parse_nat_reads_port_forwards(self):
        from .adapters import pf
        txt = ("nat on em0 inet proto tcp from any to 172.16.97.1 port = 30080 -> (em0) round-robin\n"
               "rdr pass on em0 inet proto tcp from any to (em0) port = http -> 172.16.97.1 port 30080\n"
               "rdr pass on em0 inet proto tcp from any to (em0) port = 8443 -> 10.0.0.5 port 443\n")
        self.assertEqual(pf.parse_nat(txt), [{"port": 80, "to_host": "172.16.97.1", "to_port": 30080},
                                             {"port": 8443, "to_host": "10.0.0.5", "to_port": 443}])
