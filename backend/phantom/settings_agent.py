"""Settings del gunicorn que atiende a los pods de agentes (red de k3d)."""
from .settings import *  # noqa: F401,F403

ROOT_URLCONF = "phantom.agent_urls"
ALLOWED_HOSTS = ["*"]   # el bind es solo la IP del gateway de k3d; el acceso lo decide el token de agente
