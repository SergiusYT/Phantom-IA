"""Coordinador multiagente.

La auditoria se ejecuta en segundo plano y cada paso real se publica como un mensaje de la
conversacion entre agentes (AuditMessage), que el panel muestra en vivo.

Modo "k8s" (por defecto): cada agente es un Job de Kubernetes en `phantom-agents`.
  recolector -> (analista || auditor) -> planificador
El coordinador crea los Jobs, narra lo que hace Kubernetes y persiste los resultados.
Modo "local": los agentes corren en este proceso (solo pruebas). Nunca se usa como respaldo.
"""
import secrets
import threading
import time

from django.conf import settings
from django.db import close_old_connections, connection
from django.utils import timezone

from .. import controller
from ..agent_api import add_message
from ..models import AgentRun, Audit, AuditMessage, Finding, Proposal, record
from . import analyst, orchestrator, planner, roles

PAUSA = 0.35   # ritmo de lectura entre mensajes; no altera los datos


class Chat:
    """Publica mensajes en la base. El seq sale de la base: los pods publican en paralelo."""

    def __init__(self, audit):
        self.audit = audit

    def say(self, agent, text, kind="say", to="", **payload):
        m = add_message(self.audit, agent, text=text, kind=kind, to=to, payload=payload)
        time.sleep(PAUSA)
        return m

    def stream(self, agent, to="", **payload):
        m = add_message(self.audit, agent, text="", to=to, payload=payload, streaming=True)

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


def _run_local(audit_id, user_id):
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


ETAPA = {"recolector": "el recolector", "analista": "el analista", "auditor": "el auditor", "planificador": "el planificador"}


class StageError(Exception):
    pass


def _stage(audit, chat, roles_):
    """Crea un Job por rol, narra lo que hace Kubernetes y devuelve {rol: resultado}."""
    names = {}
    for r in roles_:
        name = orchestrator.create_job(audit.id, r)
        AgentRun.objects.update_or_create(audit=audit, role=r, defaults={"job_name": name})
        names[name] = r
        chat.say("coordinador", f"Kubernetes, crea un pod para {ETAPA[r]} (Job {name}).", kind="k8s",
                 event="job", role=r, job=name)
    seen_node, seen_fail = {}, {}

    def on_event(name, st):
        r = names[name]
        if st.get("node") and seen_node.get(r) != st["node"] and st["phase"] in ("running", "complete"):
            seen_node[r] = st["node"]
            chat.say("coordinador", f"Kubernetes programó a {ETAPA[r]} en el nodo {st['node']}.", kind="k8s",
                     event="scheduled", role=r, node=st["node"])
        if st.get("failed_pods", 0) > seen_fail.get(r, 0):
            seen_fail[r] = st["failed_pods"]
            if st["phase"] != "failed":
                chat.say("coordinador", f"El pod de {ETAPA[r]} cayó. Kubernetes lo reintenta automáticamente.",
                         kind="k8s", event="pod_failed", role=r)

    final = orchestrator.wait(list(names), on_event, settings.PHANTOM["JOB_TIMEOUT"])
    out = {}
    for name, phase in final.items():
        r = names[name]
        run = AgentRun.objects.get(audit=audit, role=r)
        if phase != "complete" or run.status != AgentRun.Status.DONE or run.result is None:
            motivo = {"failed": "su pod falló incluso tras el reintento de Kubernetes",
                      "timeout": "no terminó a tiempo"}.get(phase, "terminó sin entregar resultados")
            AgentRun.objects.filter(pk=run.pk).update(status=AgentRun.Status.FAILED, finished_at=timezone.now())
            raise StageError(f"El {r} no pudo completar su trabajo en Kubernetes: {motivo}.")
        out[r] = run.result
    return out


def _run_k8s(audit_id, user_id):
    close_old_connections()
    audit = Audit.objects.get(pk=audit_id)
    user = audit.requested_by
    chat = Chat(audit)
    snap, errors = {"k8s": None, "pf": None, "connectivity": []}, []
    try:
        audit.agent_token = secrets.token_hex(32)
        audit.save(update_fields=["agent_token"])
        orchestrator.create_secret(audit.id, audit.agent_token)
        quien = user.username if user else "el sistema"
        chat.say("coordinador", f"Inicio la auditoría {audit.id}, solicitada por {quien}. Cada agente trabajará en su "
                 "propio pod, orquestado por Kubernetes. Recolector, tráeme el estado del clúster y del firewall.",
                 to="recolector")
        rec = _stage(audit, chat, ["recolector"])["recolector"]
        snap, errors = rec["snapshot"], rec.get("errors", [])

        chat.say("coordinador", "Gracias. Analista y auditor: trabajen en paralelo. Analista, revisa si algo está "
                 "fallando en la operación; auditor, compara la configuración con las reglas de seguridad.",
                 to="analista")
        par = _stage(audit, chat, ["analista", "auditor"])
        found = par["analista"]["findings"] + par["auditor"]["findings"]
        objs = _persist_findings(audit, found, chat)

        props = []
        if planner.plan(snap, found, explain=False):
            chat.say("coordinador", "Planificador, propón correcciones usando solo operaciones permitidas.", to="planificador")
            props = _stage(audit, chat, ["planificador"])["planificador"]["proposals"]
        _persist_proposals(audit, props, objs, chat)

        audit.snapshot, audit.errors = snap, errors
        audit.analyst_summary = analyst.summarize(snap, found)
        audit.status, audit.finished_at = Audit.Status.DONE, timezone.now()
        audit.save()
        n_p = len(props)
        chat.say("coordinador", f"Auditoría terminada: {_plural(len(found), 'hallazgo', 'hallazgos')} y "
                 f"{_plural(n_p, 'propuesta', 'propuestas')}." + (" Ningún cambio se aplica hasta que un operador lo apruebe."
                 if n_p else " No hay nada que corregir."), kind="done", findings=len(found), proposals=n_p)
    except Exception as exc:  # noqa: BLE001 - cualquier fallo se reporta en la conversacion
        audit.status, audit.finished_at = Audit.Status.FAILED, timezone.now()
        audit.snapshot = snap
        audit.errors = [*errors, str(exc) if isinstance(exc, StageError) else f"interno: {exc}"]
        audit.save()
        AuditMessage.objects.filter(audit=audit, streaming=True).update(streaming=False)
        chat.say("coordinador", str(exc) if isinstance(exc, StageError) else f"La auditoría falló: {exc}", kind="error")
    finally:
        Audit.objects.filter(pk=audit.pk).update(agent_token="")
        audit.agent_token = ""
        try:
            orchestrator.cleanup(audit.id)
        except Exception:  # noqa: BLE001 - la limpieza no debe tapar el resultado
            pass
    record("audit_finish", user, f"audit:{audit.id}", success=audit.status == Audit.Status.DONE,
           findings=audit.findings.count(), proposals=audit.proposals.count(), errors=audit.errors)
    connection.close()


def _run(audit_id, user_id):
    if settings.PHANTOM["AGENTS_MODE"] == "local":
        return _run_local(audit_id, user_id)
    return _run_k8s(audit_id, user_id)


def start_audit(user=None, fail_agent=""):
    audit = Audit.objects.create(requested_by=user if user and user.is_authenticated else None, fail_agent=fail_agent)
    record("audit_start", user, f"audit:{audit.id}", fail_agent=fail_agent)
    threading.Thread(target=_run, args=(audit.id, getattr(user, "id", None)), daemon=True).start()
    return audit


def run_audit(user=None):
    """Version sincrona (scripts y pruebas)."""
    audit = Audit.objects.create(requested_by=user if user and user.is_authenticated else None)
    record("audit_start", user, f"audit:{audit.id}")
    _run(audit.id, getattr(user, "id", None))
    audit.refresh_from_db()
    return audit
