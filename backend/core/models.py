"""Modelo de datos de PHANTOM AI: auditorias, hallazgos, propuestas, ejecuciones y trazabilidad."""
from django.conf import settings
from django.db import models


class Severity(models.TextChoices):
    CRITICAL = "critical", "Critica"
    HIGH = "high", "Alta"
    MEDIUM = "medium", "Media"
    LOW = "low", "Baja"
    INFO = "info", "Informativa"


class Audit(models.Model):
    class Status(models.TextChoices):
        RUNNING = "running", "En curso"
        DONE = "done", "Completada"
        FAILED = "failed", "Fallida"

    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RUNNING)
    snapshot = models.JSONField(default=dict, blank=True)       # datos normalizados recolectados
    analyst_summary = models.TextField(blank=True)
    errors = models.JSONField(default=list, blank=True)
    agent_token = models.CharField(max_length=64, blank=True)    # credencial efimera de los pods de agentes
    fail_agent = models.CharField(max_length=20, blank=True)     # "simular fallo": rol cuyo 1er intento cae

    class Meta:
        ordering = ["-created_at"]


class Finding(models.Model):
    class Agent(models.TextChoices):
        ANALYST = "analyst", "Analista de red"
        AUDITOR = "auditor", "Auditor de seguridad"

    audit = models.ForeignKey(Audit, related_name="findings", on_delete=models.CASCADE)
    agent = models.CharField(max_length=10, choices=Agent.choices)
    rule_id = models.CharField(max_length=20)
    title = models.CharField(max_length=200)
    severity = models.CharField(max_length=10, choices=Severity.choices)
    component = models.CharField(max_length=100)          # ej. k8s/phantom-demo/svc/db, pf/perimeter
    description = models.TextField()
    evidence = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["audit", "id"]


class Proposal(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pendiente de aprobacion"
        APPROVED = "approved", "Aprobada"
        REJECTED = "rejected", "Rechazada"
        APPLIED = "applied", "Aplicada"
        FAILED = "failed", "Fallida"
        ROLLED_BACK = "rolled_back", "Revertida"
        SUPERSEDED = "superseded", "Reemplazada"

    audit = models.ForeignKey(Audit, related_name="proposals", on_delete=models.CASCADE)
    findings = models.ManyToManyField(Finding, related_name="proposals")
    created_at = models.DateTimeField(auto_now_add=True)
    operation = models.CharField(max_length=40)       # debe existir en la lista permitida del controlador
    params = models.JSONField(default=dict)
    title = models.CharField(max_length=200)
    justification = models.TextField()
    expected_impact = models.TextField(blank=True)
    preview = models.TextField(blank=True)            # manifiesto/regla exacta que se aplicara
    verification = models.JSONField(default=list)     # pruebas a ejecutar despues del cambio
    requires_approval = models.BooleanField(default=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    decided_at = models.DateTimeField(null=True, blank=True)
    llm_explanation = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]


class Execution(models.Model):
    proposal = models.ForeignKey(Proposal, related_name="executions", on_delete=models.CASCADE)
    kind = models.CharField(max_length=10, default="apply")   # apply | rollback
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    executed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    success = models.BooleanField(default=False)
    backup = models.JSONField(default=dict, blank=True)       # estado previo para reversion
    output = models.TextField(blank=True)
    tests_before = models.JSONField(default=list, blank=True)
    tests_after = models.JSONField(default=list, blank=True)
    verified = models.BooleanField(default=False)

    class Meta:
        ordering = ["-started_at"]


class ConnectivityRun(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    results = models.JSONField(default=list)
    passed = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]


class AuditEvent(models.Model):
    """Registro inmutable de auditoria: quien hizo que, cuando y con que resultado."""
    created_at = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=40)
    target = models.CharField(max_length=200, blank=True)
    detail = models.JSONField(default=dict, blank=True)
    success = models.BooleanField(default=True)

    class Meta:
        ordering = ["-created_at"]


def record(action, user=None, target="", success=True, **detail):
    u = user if (user is not None and getattr(user, "is_authenticated", False)) else None
    return AuditEvent.objects.create(user=u, action=action, target=target, success=success, detail=detail)


class AuditMessage(models.Model):
    """Mensaje de la conversacion entre agentes durante una auditoria (se muestra en vivo)."""
    audit = models.ForeignKey(Audit, related_name="messages", on_delete=models.CASCADE)
    seq = models.PositiveIntegerField()
    agent = models.CharField(max_length=20)       # coordinador, recolector, analista, auditor, planificador
    to = models.CharField(max_length=20, blank=True)
    kind = models.CharField(max_length=12, default="say")   # say | data | finding | proposal | done | error
    text = models.TextField(blank=True)
    payload = models.JSONField(default=dict, blank=True)
    streaming = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["audit", "seq"]
        unique_together = [("audit", "seq")]


class AgentRun(models.Model):
    """Ejecucion de un agente (un Job de Kubernetes) dentro de una auditoria."""
    ROLES = ("recolector", "analista", "auditor", "planificador")

    class Status(models.TextChoices):
        PENDING = "pending", "Pendiente"
        RUNNING = "running", "Trabajando"
        DONE = "done", "Terminado"
        FAILED = "failed", "Fallido"

    audit = models.ForeignKey(Audit, related_name="runs", on_delete=models.CASCADE)
    role = models.CharField(max_length=20)
    attempts = models.PositiveSmallIntegerField(default=0)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    result = models.JSONField(null=True, blank=True)
    job_name = models.CharField(max_length=63, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [("audit", "role")]
        ordering = ["audit", "id"]
