"""Marca como fallidas las auditorias que quedaron 'en curso' por un reinicio del backend."""
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import Audit, AuditMessage


class Command(BaseCommand):
    help = "Cierra auditorias interrumpidas por un reinicio"

    def handle(self, *args, **opts):
        n = 0
        for a in Audit.objects.filter(status=Audit.Status.RUNNING):
            seq = (a.messages.order_by("-seq").values_list("seq", flat=True).first() or 0) + 1
            AuditMessage.objects.filter(audit=a, streaming=True).update(streaming=False)
            AuditMessage.objects.create(audit=a, seq=seq, agent="coordinador", kind="error",
                                        text="La auditoría se interrumpió porque el servidor se reinició. Inicia una nueva.")
            a.status, a.finished_at = Audit.Status.FAILED, timezone.now()
            a.errors = [*(a.errors or []), "interrumpida por reinicio del servidor"]
            a.save()
            n += 1
        self.stdout.write(f"auditorias recuperadas: {n}")
