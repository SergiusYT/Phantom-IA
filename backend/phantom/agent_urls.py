"""Rutas del gunicorn de agentes: sólo la API de agentes, nada del panel."""
from django.urls import path

from core import agent_api

urlpatterns = [
    path("api/agent/<int:audit_id>/start/<str:role>/", agent_api.start),
    path("api/agent/<int:audit_id>/messages/", agent_api.messages),
    path("api/agent/<int:audit_id>/messages/<int:seq>/", agent_api.message),
    path("api/agent/<int:audit_id>/result/<str:role>/", agent_api.result),
]
