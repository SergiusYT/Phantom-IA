"""API de agentes: lo único que los pods de Kubernetes pueden hablar con PHANTOM.

Se sirve en un gunicorn aparte (settings_agent / agent_urls) ligado a la red de k3d.
Cada auditoría tiene un token efímero; sólo vale mientras la auditoría está en curso y
sólo para esa auditoría. Los agentes no pueden aprobar, ejecutar ni leer otras auditorías.
"""
import hmac

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Max
from django.http import Http404
from django.utils import timezone
from rest_framework import permissions
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from .models import AgentRun, Audit, AuditMessage

HEADER = "HTTP_X_PHANTOM_AGENT"


class AgentToken(permissions.BasePermission):
    message = "Token de agente inválido o auditoría no activa."

    def has_permission(self, request, view):
        token = request.META.get(HEADER, "")
        audit = Audit.objects.filter(pk=view.kwargs.get("audit_id")).only("status", "agent_token").first()
        if not audit or audit.status != Audit.Status.RUNNING or not audit.agent_token or not token:
            return False
        return hmac.compare_digest(token, audit.agent_token)


def agent_view(methods):
    def deco(fn):
        return api_view(methods)(authentication_classes([])(permission_classes([AgentToken])(fn)))
    return deco


def _role(role):
    if role not in AgentRun.ROLES:
        raise Http404
    return role


def add_message(audit, agent, text="", kind="say", to="", payload=None, streaming=False):
    """Inserta un mensaje con el siguiente seq; seguro con agentes publicando en paralelo."""
    for _ in range(5):
        try:
            with transaction.atomic():
                Audit.objects.select_for_update().only("id").get(pk=audit.pk)
                seq = (AuditMessage.objects.filter(audit=audit).aggregate(m=Max("seq"))["m"] or 0) + 1
                return AuditMessage.objects.create(audit=audit, seq=seq, agent=agent, to=to, kind=kind, text=text,
                                                   payload=payload or {}, streaming=streaming)
        except IntegrityError:   # sqlite no bloquea filas: reintento ante colision de seq
            continue
    raise IntegrityError("no se pudo asignar seq al mensaje")


def _result(audit, role):
    run = AgentRun.objects.filter(audit=audit, role=role, status=AgentRun.Status.DONE).first()
    return run.result if run else None


def _input(audit, role):
    if role == "recolector":
        return {}
    rec = _result(audit, "recolector") or {}
    snap = rec.get("snapshot") or {}
    if role in ("analista", "auditor"):
        return {"snapshot": snap, "allowed_ports": settings.PHANTOM["PF_ALLOWED_PORTS"]}
    found = [*(_result(audit, "analista") or {}).get("findings", []), *(_result(audit, "auditor") or {}).get("findings", [])]
    return {"snapshot": snap, "findings": found}


@agent_view(["POST"])
def start(request, audit_id, role):
    role = _role(role)
    audit = Audit.objects.get(pk=audit_id)
    with transaction.atomic():
        run, _ = AgentRun.objects.select_for_update().get_or_create(audit=audit, role=role)
        run.attempts += 1
        run.status = AgentRun.Status.RUNNING
        run.started_at = run.started_at or timezone.now()
        run.save()
    if run.attempts > 1:
        for m in AuditMessage.objects.filter(audit=audit, agent=role):
            if m.payload.get("failed_attempt"):
                continue
            m.payload = {**m.payload, "failed_attempt": True}
            m.streaming = False
            m.save(update_fields=["payload", "streaming", "updated_at"])
        add_message(audit, "coordinador", f"Kubernetes reinició al {role} en un pod nuevo (intento {run.attempts}).",
                    kind="k8s", payload={"event": "retry", "role": role, "attempt": run.attempts})
    return Response({"attempt": run.attempts, "fail": role == audit.fail_agent and run.attempts == 1,
                     "input": _input(audit, role)})


def _attempt(audit, agent):
    run = AgentRun.objects.filter(audit=audit, role=agent).only("attempts").first()
    return run.attempts if run else 1


@agent_view(["POST"])
def messages(request, audit_id):
    audit = Audit.objects.get(pk=audit_id)
    d = request.data
    agent = str(d.get("agent", ""))[:20]
    if agent not in AgentRun.ROLES:
        return Response({"detail": "agente desconocido"}, status=400)
    payload = d.get("payload") if isinstance(d.get("payload"), dict) else {}
    m = add_message(audit, agent, text=str(d.get("text", "")), kind=str(d.get("kind", "say"))[:12],
                    to=str(d.get("to", ""))[:20], payload={**payload, "attempt": _attempt(audit, agent)},
                    streaming=bool(d.get("streaming", False)))
    return Response({"seq": m.seq}, status=201)


@agent_view(["PATCH"])
def message(request, audit_id, seq):
    m = AuditMessage.objects.filter(audit_id=audit_id, seq=seq).first()
    if not m or m.agent not in AgentRun.ROLES:
        raise Http404
    fields = []
    if "text" in request.data:
        m.text, fields = str(request.data["text"]), [*fields, "text"]
    if "streaming" in request.data:
        m.streaming, fields = bool(request.data["streaming"]), [*fields, "streaming"]
    if fields:
        m.save(update_fields=[*fields, "updated_at"])
    return Response(status=204)


@agent_view(["POST"])
def result(request, audit_id, role):
    role = _role(role)
    with transaction.atomic():
        run, _ = AgentRun.objects.select_for_update().get_or_create(audit_id=audit_id, role=role)
        if run.status != AgentRun.Status.DONE:     # idempotente: la primera entrega manda
            run.result = request.data
            run.status = AgentRun.Status.DONE
            run.finished_at = timezone.now()
            run.save()
    return Response({"ok": True})
