"""API REST de PHANTOM AI."""
from django.conf import settings
from django.contrib.auth import authenticate
from django.db import connection, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from . import connectivity, controller, insights
from .adapters import docker, k8s, pf
from .agents import coordinator, llm
from .models import AgentRun, Audit, AuditEvent, ConnectivityRun, Finding, Proposal, record
from .serializers import (AuditDetailSerializer, AuditEventSerializer, AuditListSerializer,
                          ConnectivityRunSerializer, FindingSerializer, ProposalSerializer)


def is_operator(user):
    return user.is_superuser or user.groups.filter(name="operador").exists()


class IsOperator(permissions.BasePermission):
    message = "Se requiere el rol 'operador' para cambiar la infraestructura."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and is_operator(request.user))


def _user_payload(u):
    return {"username": u.username, "operator": is_operator(u),
            "role": "operador" if is_operator(u) else "observador"}


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def login(request):
    u = authenticate(username=request.data.get("username"), password=request.data.get("password"))
    if not u:
        record("login", None, request.data.get("username", ""), success=False)
        return Response({"detail": "Credenciales invalidas"}, status=status.HTTP_401_UNAUTHORIZED)
    token, _ = Token.objects.get_or_create(user=u)
    record("login", u, u.username)
    return Response({"token": token.key, "user": _user_payload(u)})


@api_view(["GET"])
def me(request):
    return Response(_user_payload(request.user))


@api_view(["GET"])
def overview(request):
    """Estado en vivo de la infraestructura (sin ejecutar agentes)."""
    data = {"time": timezone.now().isoformat(), "kubernetes": None, "firewall": None, "errors": []}
    try:
        data["kubernetes"] = k8s.collect()
    except k8s.K8sError as exc:
        data["errors"].append(f"kubernetes: {exc}")
    try:
        data["firewall"] = pf.collect()
    except pf.PFError as exc:
        data["errors"].append(f"freebsd/pf: {exc}")
    in_k8s = settings.PHANTOM["AGENTS_MODE"] == "k8s"
    data["llm"] = {"model": settings.PHANTOM["OLLAMA_MODEL"], "where": "kubernetes" if in_k8s else "host",
                   "available": k8s.ollama_ready() if in_k8s else llm.available()}
    last = Audit.objects.filter(status=Audit.Status.DONE).first()
    data["last_audit"] = AuditListSerializer(last).data if last else None
    data["open_findings"] = {s: Finding.objects.filter(audit=last, severity=s).count()
                             for s in ("critical", "high", "medium", "low", "info")} if last else {}
    data["pending_proposals"] = Proposal.objects.filter(status=Proposal.Status.PENDING).count()
    return Response(data)


@api_view(["GET"])
def topology(request):
    """Grafo logico: componentes, flujos esperados y estado observado de cada flujo."""
    nodes = [
        {"id": "internet", "label": "Cliente externo", "kind": "external"},
        {"id": "firewall", "label": f"FreeBSD PF ({settings.PHANTOM['PF_HOST']})", "kind": "firewall"},
    ]
    k, errors = None, []
    try:
        k = k8s.collect()
    except k8s.K8sError as exc:
        errors.append(str(exc))
    pods = {}
    if k:
        for p in k["pods"]:
            app = p["labels"].get("app")
            if app:
                pods.setdefault(app, []).append(p)
        for app in ("frontend", "api", "db"):
            svc = next((s for s in k["services"] if s["selector"].get("app") == app), None)
            ps = pods.get(app, [])
            nodes.append({"id": app, "label": app, "kind": "workload",
                          "healthy": bool(ps) and all(x["phase"] == "Running" and x["ready"] for x in ps),
                          "service_type": svc["type"] if svc else None,
                          "ports": [x["port"] for x in svc["ports"]] if svc else [],
                          "node_ports": [x["nodePort"] for x in svc["ports"] if x.get("nodePort")] if svc else []})
    last_conn = ConnectivityRun.objects.first()
    observed = {r["id"]: r for r in (last_conn.results if last_conn else [])}
    edges = [{"id": t["id"], "source": t["src"], "target": t["dst"], "port": t["port"], "expect": t["expect"],
              "observed": observed.get(t["id"])} for t in connectivity.INTERNAL_TESTS]
    edges.append({"id": "inet-fw", "source": "internet", "target": "firewall", "port": 443, "expect": True,
                  "observed": observed.get("pf-443")})
    edges.append({"id": "inet-fw-8081", "source": "internet", "target": "firewall", "port": 8081, "expect": False,
                  "observed": observed.get("pf-8081")})
    policies = k["network_policies"] if k else []
    try:
        fwd = pf.collect()
        firewall = {"forwards": fwd["forwards"], "listening": fwd["listening"], "enabled": fwd["enabled"],
                    "blocked": sorted({p for r in fwd["anchor_rules"] if r["action"] == "block" for p in r["ports"]}),
                    "allowed": fwd["allowed_ports"]}
    except pf.PFError as exc:
        firewall = None
        errors.append(str(exc))
    return Response({"nodes": nodes, "edges": edges, "network_policies": policies, "errors": errors, "firewall": firewall,
                     "namespace": settings.PHANTOM["NAMESPACE"],
                     "connectivity_at": last_conn.created_at if last_conn else None})


class AuditList(generics.ListAPIView):
    queryset = Audit.objects.all()[:50]
    serializer_class = AuditListSerializer


class AuditDetail(generics.RetrieveAPIView):
    queryset = Audit.objects.all()
    serializer_class = AuditDetailSerializer


def _lock_audits():
    """Candado de transaccion para iniciar auditorias (PostgreSQL). SQLite ya serializa las escrituras."""
    if connection.vendor == "postgresql":
        with connection.cursor() as c:
            c.execute("SELECT pg_advisory_xact_lock(%s)", [7041])


@api_view(["POST"])
def start_audit(request):
    """Inicia la auditoria en segundo plano; el progreso se lee en /audits/<id>/messages/.

    `fail_agent` (solo operadores) simula la caida del primer intento de ese agente.
    """
    fail = request.data.get("fail_agent") or ""
    if fail and fail not in AgentRun.ROLES:
        return Response({"detail": "Agente desconocido"}, status=400)
    if fail and not is_operator(request.user):
        return Response({"detail": "Solo un operador puede simular fallos"}, status=403)
    coordinator.expire_stale()
    with transaction.atomic():
        _lock_audits()   # dos pedidos simultaneos (distintos workers) no pueden pasar ambos el chequeo
        if Audit.objects.filter(status=Audit.Status.RUNNING).exists():
            return Response({"detail": "Ya hay una auditoría en curso"}, status=409)
        audit = coordinator.start_audit(request.user, fail_agent=fail)
    return Response({"id": audit.id, "status": audit.status}, status=status.HTTP_202_ACCEPTED)


@api_view(["GET"])
def audit_messages(request, pk):
    audit = get_object_or_404(Audit, pk=pk)
    msgs = audit.messages.all()   # una auditoria produce ~30 mensajes: se envian completos
    data = [{"seq": m.seq, "agent": m.agent, "to": m.to, "kind": m.kind, "text": m.text, "payload": m.payload,
             "streaming": m.streaming, "time": m.created_at} for m in msgs]
    return Response({"status": audit.status, "messages": data, "now": timezone.now()})


@api_view(["GET"])
def orchestration(request):
    data = {"time": timezone.now(), "kubernetes": None, "docker": None, "errors": []}
    try:
        data["kubernetes"] = k8s.orchestration()
    except k8s.K8sError as exc:
        data["errors"].append(f"kubernetes: {exc}")
    try:
        data["docker"] = docker.containers()
    except docker.DockerError as exc:
        data["errors"].append(f"docker: {exc}")
    return Response(data)


@api_view(["POST"])
@permission_classes([IsOperator])
def orch_scale(request):
    dep = request.data.get("deployment")
    try:
        replicas = int(request.data.get("replicas"))
    except (TypeError, ValueError):
        return Response({"detail": "replicas debe ser un numero"}, status=400)
    if not 0 <= replicas <= 5:
        return Response({"detail": "Solo se permiten entre 0 y 5 replicas en el laboratorio"}, status=400)
    try:
        out = k8s.scale(dep, replicas)
    except k8s.K8sError as exc:
        record("scale", request.user, f"deployment:{dep}", success=False, error=str(exc))
        return Response({"detail": str(exc)}, status=400)
    record("scale", request.user, f"deployment:{dep}", replicas=replicas)
    return Response({"detail": out.strip()})


@api_view(["POST"])
@permission_classes([IsOperator])
def orch_delete_pod(request):
    pod = request.data.get("pod")
    try:
        out = k8s.delete_pod(pod)
    except k8s.K8sError as exc:
        record("delete_pod", request.user, f"pod:{pod}", success=False, error=str(exc))
        return Response({"detail": str(exc)}, status=400)
    record("delete_pod", request.user, f"pod:{pod}")
    return Response({"detail": out.strip()})


class FindingList(generics.ListAPIView):
    serializer_class = FindingSerializer

    def get_queryset(self):
        qs = Finding.objects.all()
        if a := self.request.query_params.get("audit"):
            qs = qs.filter(audit_id=a)
        else:
            last = Audit.objects.filter(status=Audit.Status.DONE).first()
            qs = qs.filter(audit=last)
        return qs


class ProposalList(generics.ListAPIView):
    serializer_class = ProposalSerializer

    def get_queryset(self):
        qs = Proposal.objects.all()
        if s := self.request.query_params.get("status"):
            qs = qs.filter(status=s)
        return qs[:100]


class ProposalDetail(generics.RetrieveAPIView):
    queryset = Proposal.objects.all()
    serializer_class = ProposalSerializer


def _decide(request, pk, approve):
    p = get_object_or_404(Proposal, pk=pk)
    if p.status != Proposal.Status.PENDING:
        return Response({"detail": f"La propuesta esta en estado '{p.status}'"}, status=400)
    p.status = Proposal.Status.APPROVED if approve else Proposal.Status.REJECTED
    p.decided_by, p.decided_at = request.user, timezone.now()
    p.save()
    record("approve" if approve else "reject", request.user, f"proposal:{p.id}",
           operation=p.operation, params=p.params, reason=request.data.get("reason", ""))
    return Response(ProposalSerializer(p).data)


@api_view(["POST"])
@permission_classes([IsOperator])
def approve(request, pk):
    return _decide(request, pk, True)


@api_view(["POST"])
@permission_classes([IsOperator])
def reject(request, pk):
    return _decide(request, pk, False)


@api_view(["POST"])
@permission_classes([IsOperator])
def execute(request, pk):
    p = get_object_or_404(Proposal, pk=pk)
    try:
        controller.execute(p, request.user)
    except controller.ValidationError as exc:
        return Response({"detail": str(exc)}, status=400)
    p.refresh_from_db()
    return Response(ProposalSerializer(p).data)


@api_view(["POST"])
@permission_classes([IsOperator])
def rollback(request, pk):
    p = get_object_or_404(Proposal, pk=pk)
    try:
        controller.rollback(p, request.user)
    except controller.ValidationError as exc:
        return Response({"detail": str(exc)}, status=400)
    p.refresh_from_db()
    return Response(ProposalSerializer(p).data)


@api_view(["GET", "POST"])
def connectivity_runs(request):
    if request.method == "POST":
        results = connectivity.run_all()
        run = ConnectivityRun.objects.create(requested_by=request.user, results=results,
                                             passed=all(r["ok"] for r in results))
        record("connectivity_test", request.user, "", success=run.passed,
               passed=sum(r["ok"] for r in results), total=len(results))
        return Response(ConnectivityRunSerializer(run).data, status=201)
    return Response(ConnectivityRunSerializer(ConnectivityRun.objects.all()[:20], many=True).data)


class EventList(generics.ListAPIView):
    queryset = AuditEvent.objects.all()[:200]
    serializer_class = AuditEventSerializer


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def health(request):
    return Response({"status": "ok", "time": timezone.now().isoformat()})


@api_view(["GET"])
def stats(request):
    return Response(insights.stats())


@api_view(["GET"])
def db_schema(request):
    return Response(insights.schema())


@api_view(["GET"])
def db_tables(request):
    return Response(insights.tables())


@api_view(["GET"])
def db_table(request, name):
    data = insights.table(name, request.query_params)
    if data is None:
        return Response({"detail": "Tabla no disponible"}, status=404)
    return Response(data)
