"""Coordinador multiagente.

La auditoria se ejecuta en segundo plano y cada paso real se publica como un mensaje de la
conversacion entre agentes (AuditMessage), que el panel muestra en vivo:
recoleccion -> pruebas -> analista -> auditor -> planificador (explicacion del LLM en streaming).
"""
import threading
import time

from django.conf import settings
from django.db import close_old_connections, connection
from django.utils import timezone

from .. import controller
from ..models import Audit, AuditMessage, Finding, Proposal, record
from . import analyst, planner, roles

PAUSA = 0.35   # ritmo de lectura entre mensajes; no altera los datos


class Chat:
    def __init__(self, audit):
        self.audit = audit
        self.seq = 0

    def say(self, agent, text, kind="say", to="", **payload):
        self.seq += 1
        m = AuditMessage.objects.create(audit=self.audit, seq=self.seq, agent=agent, to=to, kind=kind,
                                        text=text, payload=payload)
        time.sleep(PAUSA)
        return m

    def stream(self, agent, to="", **payload):
        self.seq += 1
        m = AuditMessage.objects.create(audit=self.audit, seq=self.seq, agent=agent, to=to, kind="say",
                                        text="", payload=payload, streaming=True)

        def update(text):
            m.text = text
            m.save(update_fields=["text", "updated_at"])
        return m, update

    def end_stream(self, m):
        m.streaming = False
        m.save(update_fields=["streaming", "updated_at"])


def _plural(n, uno, varios):
    return f"{n} {uno if n == 1 else varios}"


def _persist_findings(audit, found, chat):
    """Guarda hallazgos y reemplaza propuestas abiertas de auditorias anteriores."""
    objs = [Finding.objects.create(audit=audit, **f) for f in found]
    # las propuestas abiertas de auditorias anteriores ya no reflejan el estado actual
    viejas = Proposal.objects.filter(status__in=[Proposal.Status.PENDING, Proposal.Status.APPROVED]).exclude(audit=audit)
    n_viejas = viejas.update(status=Proposal.Status.SUPERSEDED)
    if n_viejas:
        chat.say("coordinador", f"Marco como reemplazadas {_plural(n_viejas, 'propuesta anterior', 'propuestas anteriores')}: esta auditoría las sustituye.")
    return objs


def _persist_proposals(audit, props, objs, chat):
    """Añade la vista previa del controlador y guarda cada propuesta del planificador."""
    for item in props:
        prop = dict(item["proposal"])
        try:
            prop["preview"] = controller.preview(prop["operation"], prop["params"])
        except Exception as exc:  # noqa: BLE001
            prop["preview"] = f"No fue posible generar la vista previa: {exc}"
        obj = Proposal.objects.create(audit=audit, **prop)
        obj.findings.set([objs[i] for i in item["finding_idx"]])
        chat.say("planificador", prop["title"], kind="proposal", to="operador",
                 proposal={"id": obj.id, "operation": obj.operation, "title": obj.title, "severity": item["severity"]})


def _run(audit_id, user_id):
    close_old_connections()
    audit = Audit.objects.get(pk=audit_id)
    user = audit.requested_by
    chat = Chat(audit)
    snap, errors = {"k8s": None, "pf": None, "connectivity": []}, []
    try:
        quien = user.username if user else "el sistema"
        chat.say("coordinador", f"Inicio la auditoría {audit.id}, solicitada por {quien}. Recolector, tráeme el estado "
                 "del clúster y del firewall.", to="recolector")
        r = roles.run_recolector(chat)
        snap, errors = r["snapshot"], r["errors"]

        chat.say("coordinador", "Gracias. Analista, revisa si algo está fallando en la operación.", to="analista")
        a_found = roles.run_analista(chat, snap)["findings"]
        chat.say("coordinador", "Auditor, compara la configuración con las reglas de seguridad.", to="auditor")
        s_found = roles.run_auditor(chat, snap, settings.PHANTOM["PF_ALLOWED_PORTS"])["findings"]
        found = a_found + s_found
        objs = _persist_findings(audit, found, chat)
        if planner.plan(snap, found, explain=False):
            chat.say("coordinador", "Planificador, propón correcciones usando solo operaciones permitidas.", to="planificador")
        props = roles.run_planificador(chat, snap, found)["proposals"]
        _persist_proposals(audit, props, objs, chat)

        audit.snapshot = snap
        audit.errors = errors
        audit.analyst_summary = analyst.summarize(snap, found)
        audit.status = Audit.Status.DONE
        audit.finished_at = timezone.now()
        audit.save()
        n_p = len(props)
        chat.say("coordinador", f"Auditoría terminada: {_plural(len(found), 'hallazgo', 'hallazgos')} y "
                 f"{_plural(n_p, 'propuesta', 'propuestas')}." + (" Ningún cambio se aplica hasta que un operador lo apruebe."
                 if n_p else " No hay nada que corregir."), kind="done", findings=len(found), proposals=n_p)
    except Exception as exc:  # noqa: BLE001 - cualquier fallo se reporta en la conversacion
        audit.status = Audit.Status.FAILED
        audit.errors = [*errors, f"interno: {exc}"]
        audit.finished_at = timezone.now()
        audit.save()
        chat.say("coordinador", f"La auditoría falló: {exc}", kind="error")
    record("audit_finish", user, f"audit:{audit.id}", success=audit.status == Audit.Status.DONE,
           findings=audit.findings.count(), proposals=audit.proposals.count(), errors=audit.errors)
    connection.close()


def start_audit(user=None):
    audit = Audit.objects.create(requested_by=user if user and user.is_authenticated else None)
    record("audit_start", user, f"audit:{audit.id}")
    threading.Thread(target=_run, args=(audit.id, getattr(user, "id", None)), daemon=True).start()
    return audit


def run_audit(user=None):
    """Version sincrona (scripts y pruebas)."""
    audit = Audit.objects.create(requested_by=user if user and user.is_authenticated else None)
    record("audit_start", user, f"audit:{audit.id}")
    _run(audit.id, getattr(user, "id", None))
    audit.refresh_from_db()
    return audit
