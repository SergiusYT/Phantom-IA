"""PHANTOM AI - configuracion del backend Django REST.

Toda credencial o ruta sensible se lee de variables de entorno (ver ../.env.example).
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent


def env(name, default=None):
    return os.environ.get(name, default)


SECRET_KEY = env("PHANTOM_SECRET_KEY", "dev-only-insecure-key-change-me")
DEBUG = env("PHANTOM_DEBUG", "1") == "1"
ALLOWED_HOSTS = env("PHANTOM_ALLOWED_HOSTS", "localhost,127.0.0.1,0.0.0.0,backend").split(",")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "core",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "phantom.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "phantom.wsgi.application"

# PostgreSQL si PHANTOM_DB_HOST esta definido (docker compose); SQLite en desarrollo local.
if env("PHANTOM_DB_HOST"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("PHANTOM_DB_NAME", "phantom"),
            "USER": env("PHANTOM_DB_USER", "phantom"),
            "PASSWORD": env("PHANTOM_DB_PASSWORD", ""),
            "HOST": env("PHANTOM_DB_HOST"),
            "PORT": env("PHANTOM_DB_PORT", "5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
]

LANGUAGE_CODE = "es"
TIME_ZONE = "America/Bogota"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
}

CORS_ALLOWED_ORIGINS = env("PHANTOM_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

# --- Infraestructura administrada ---
PHANTOM = {
    "KUBECTL": env("PHANTOM_KUBECTL", str(PROJECT_ROOT / "bin" / "kubectl")),
    "KUBECONFIG": env("KUBECONFIG", ""),
    "NAMESPACE": env("PHANTOM_NAMESPACE", "phantom-demo"),
    "PF_HOST": env("PHANTOM_PF_HOST", "172.16.97.132"),
    "PF_USER": env("PHANTOM_PF_USER", "root"),
    "PF_KEY": env("PHANTOM_PF_KEY", str(PROJECT_ROOT / "infra" / "keys" / "phantom_ed25519")),
    "PF_ALLOWED_PORTS": [int(p) for p in env("PHANTOM_PF_ALLOWED_PORTS", "22,80,443").split(",")],
    "OLLAMA_URL": env("PHANTOM_OLLAMA_URL", "http://127.0.0.1:11434"),
    "OLLAMA_MODEL": env("PHANTOM_OLLAMA_MODEL", "mistral"),
    "LLM_ENABLED": env("PHANTOM_LLM", "1") == "1",
    "DOCKER_URL": env("PHANTOM_DOCKER_URL", "http://127.0.0.1:2375"),
}
