from rest_framework import serializers

from .models import Audit, AuditEvent, ConnectivityRun, Execution, Finding, Proposal


class FindingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Finding
        fields = "__all__"


class ExecutionSerializer(serializers.ModelSerializer):
    executed_by = serializers.StringRelatedField()

    class Meta:
        model = Execution
        fields = "__all__"


class ProposalSerializer(serializers.ModelSerializer):
    decided_by = serializers.StringRelatedField()
    executions = ExecutionSerializer(many=True, read_only=True)
    findings = FindingSerializer(many=True, read_only=True)

    class Meta:
        model = Proposal
        fields = "__all__"


class AuditListSerializer(serializers.ModelSerializer):
    requested_by = serializers.StringRelatedField()
    findings_count = serializers.IntegerField(source="findings.count", read_only=True)
    proposals_count = serializers.IntegerField(source="proposals.count", read_only=True)

    class Meta:
        model = Audit
        exclude = ["snapshot"]


class AuditDetailSerializer(serializers.ModelSerializer):
    requested_by = serializers.StringRelatedField()
    findings = FindingSerializer(many=True, read_only=True)
    proposals = ProposalSerializer(many=True, read_only=True)

    class Meta:
        model = Audit
        exclude = ["agent_token"]


class ConnectivityRunSerializer(serializers.ModelSerializer):
    requested_by = serializers.StringRelatedField()

    class Meta:
        model = ConnectivityRun
        fields = "__all__"


class AuditEventSerializer(serializers.ModelSerializer):
    user = serializers.StringRelatedField()

    class Meta:
        model = AuditEvent
        fields = "__all__"
