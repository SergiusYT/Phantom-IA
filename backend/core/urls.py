from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health),
    path("auth/login/", views.login),
    path("auth/me/", views.me),
    path("overview/", views.overview),
    path("topology/", views.topology),
    path("audits/", views.AuditList.as_view()),
    path("audits/run/", views.start_audit),
    path("audits/<int:pk>/", views.AuditDetail.as_view()),
    path("audits/<int:pk>/messages/", views.audit_messages),
    path("orchestration/", views.orchestration),
    path("orchestration/scale/", views.orch_scale),
    path("orchestration/delete-pod/", views.orch_delete_pod),
    path("findings/", views.FindingList.as_view()),
    path("proposals/", views.ProposalList.as_view()),
    path("proposals/<int:pk>/", views.ProposalDetail.as_view()),
    path("proposals/<int:pk>/approve/", views.approve),
    path("proposals/<int:pk>/reject/", views.reject),
    path("proposals/<int:pk>/execute/", views.execute),
    path("proposals/<int:pk>/rollback/", views.rollback),
    path("connectivity/", views.connectivity_runs),
    path("events/", views.EventList.as_view()),
    path("stats/", views.stats),
    path("db/", views.db_tables),
    path("db/esquema/", views.db_schema),
    path("db/<str:name>/", views.db_table),
]
