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

from .. import connectivity, controller
from ..adapters import k8s, pf
from ..models import Audit, AuditMessage, Finding, Proposal, record
from . import analyst, auditor, llm, planner

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

        # --- recoleccion ---
        chat.say("recolector", f"Consulto la API de Kubernetes en el namespace {settings.PHANTOM['NAMESPACE']}.")
        try:
            k = k8s.collect()
            snap["k8s"] = k
            ok = sum(1 for p in k["pods"] if p["phase"] == "Running" and p["ready"])
            chat.say("recolector", f"Listo. {_plural(len(k['nodes']), 'nodo', 'nodos')}, {ok} de {len(k['pods'])} pods "
                     f"operativos, {_plural(len(k['services']), 'servicio', 'servicios')} y "
                     f"{_plural(len(k['network_policies']), 'NetworkPolicy', 'NetworkPolicies')}.", kind="data",
                     facts=[{"k": "Nodos", "v": len(k["nodes"])}, {"k": "Pods", "v": f"{ok}/{len(k['pods'])}"},
                            {"k": "Servicios", "v": len(k["services"])}, {"k": "Políticas", "v": len(k["network_policies"])}])
        except k8s.K8sError as exc:
            errors.append(f"kubernetes: {exc}")
            chat.say("recolector", f"No pude consultar Kubernetes: {exc}", kind="error")

        chat.say("recolector", f"Ahora el firewall FreeBSD en {settings.PHANTOM['PF_HOST']}, por el canal restringido.")
        try:
            p = pf.collect()
            snap["pf"] = p
            chat.say("recolector", f"PF está {'activo' if p['enabled'] else 'INACTIVO'} con "
                     f"{_plural(len(p['rules']), 'regla', 'reglas')}. Hay servicios escuchando en los puertos "
                     f"{', '.join(map(str, p['listening']))}.", kind="data",
                     facts=[{"k": "PF", "v": "activo" if p["enabled"] else "inactivo"}, {"k": "Reglas", "v": len(p["rules"])},
                            {"k": "Anchor PHANTOM", "v": len(p["anchor_rules"])}, {"k": "Puertos", "v": ", ".join(map(str, p["listening"]))}])
        except pf.PFError as exc:
            errors.append(f"freebsd/pf: {exc}")
            snap["pf"] = {"error": str(exc), "host": settings.PHANTOM["PF_HOST"]}
            chat.say("recolector", f"El firewall no respondió: {exc}", kind="error")

        # --- pruebas de conectividad, una por una ---
        tests = []
        if snap["k8s"]:
            tests += [("k", t) for t in connectivity.INTERNAL_TESTS]
        if snap["pf"] and not snap["pf"].get("error"):
            tests += [("p", t) for t in connectivity.perimeter_tests()]
        if tests:
            chat.say("recolector", f"Pruebo {_plural(len(tests), 'flujo', 'flujos')} de red: los que deben pasar y los que deben estar bloqueados.")
            for tipo, t in tests:
                r = connectivity._internal(t) if tipo == "k" else connectivity._perimeter(t)
                snap["connectivity"].append(r)
                estado = "responde" if r["reachable"] else ("error" if r["reachable"] is None else "bloqueado")
                chat.say("recolector", f"{r['name']}: {estado}.", kind="test", test=r)

        # --- analista ---
        chat.say("coordinador", "Gracias. Analista, revisa si algo está fallando en la operación.", to="analista")
        a_found = analyst.analyze(snap)
        if a_found:
            for f in a_found:
                chat.say("analista", f["description"], kind="finding", finding=f)
        else:
            chat.say("analista", "Todo opera con normalidad: los pods están listos, los servicios tienen endpoints y "
                     "los flujos legítimos responden.")

        # --- auditor ---
        chat.say("coordinador", "Auditor, compara la configuración con las reglas de seguridad.", to="auditor")
        s_found = auditor.audit(snap, settings.PHANTOM["PF_ALLOWED_PORTS"])
        if s_found:
            chat.say("auditor", f"Encontré {_plural(len(s_found), 'riesgo', 'riesgos')}. Te los paso, planificador.", to="planificador")
            for f in s_found:
                chat.say("auditor", f["description"], kind="finding", to="planificador", finding=f)
        else:
            chat.say("auditor", "La configuración cumple todas las reglas definidas. No hay riesgos que reportar.")

        found = a_found + s_found
        objs = [Finding.objects.create(audit=audit, **f) for f in found]

        # --- planificador ---
        # las propuestas abiertas de auditorias anteriores ya no reflejan el estado actual
        viejas = Proposal.objects.filter(status__in=[Proposal.Status.PENDING, Proposal.Status.APPROVED]).exclude(audit=audit)
        n_viejas = viejas.update(status=Proposal.Status.SUPERSEDED)
        if n_viejas:
            chat.say("coordinador", f"Marco como reemplazadas {_plural(n_viejas, 'propuesta anterior', 'propuestas anteriores')}: esta auditoría las sustituye.")
        props = planner.plan(snap, found, explain=False)
        if props:
            chat.say("coordinador", "Planificador, propón correcciones usando solo operaciones permitidas.", to="planificador")
        for prop, idx in props:
            try:
                prop["preview"] = controller.preview(prop["operation"], prop["params"])
            except Exception as exc:  # noqa: BLE001
                prop["preview"] = f"No fue posible generar la vista previa: {exc}"
            rel = [found[i] for i in idx]
            m, update = chat.stream("planificador", to="operador", operation=prop["operation"], title=prop["title"])
            prop["llm_explanation"] = llm.explain_stream(planner.context_for(prop, rel),
                                                         prop["justification"] + " " + prop["expected_impact"], update)
            chat.end_stream(m)
            obj = Proposal.objects.create(audit=audit, **prop)
            obj.findings.set([objs[i] for i in idx])
            chat.say("planificador", prop["title"], kind="proposal", to="operador",
                     proposal={"id": obj.id, "operation": obj.operation, "title": obj.title,
                               "severity": min((f["severity"] for f in rel), key=lambda s: ["critical", "high", "medium", "low", "info"].index(s))})

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
