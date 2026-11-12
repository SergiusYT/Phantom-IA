from django.contrib import admin

from .models import Audit, AuditEvent, ConnectivityRun, Execution, Finding, Proposal

admin.site.register([Audit, Finding, Proposal, Execution, ConnectivityRun])


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "user", "action", "target", "success")
    readonly_fields = [f.name for f in AuditEvent._meta.fields]

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
