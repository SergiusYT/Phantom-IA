#!/bin/sh
# Backend de PHANTOM: panel completo en 127.0.0.1:8000 y, si PHANTOM_AGENT_BIND esta definido,
# la API de agentes (solo /api/agent/...) en la IP del gateway de k3d para los pods.
set -e
python manage.py migrate --noinput
python manage.py seed_users
python manage.py recover_audits
python manage.py collectstatic --noinput -v0

gunicorn phantom.wsgi -b 127.0.0.1:8000 -w 3 -t 180 &
MAIN=$!
if [ -n "$PHANTOM_AGENT_BIND" ]; then
    DJANGO_SETTINGS_MODULE=phantom.settings_agent gunicorn phantom.wsgi -b "$PHANTOM_AGENT_BIND" -w 2 -t 120 &
    AGENT=$!
fi
# Si cualquiera de los dos muere, el contenedor termina y Docker lo informa.
while kill -0 "$MAIN" 2>/dev/null && { [ -z "$AGENT" ] || kill -0 "$AGENT" 2>/dev/null; }; do sleep 2; done
echo "un proceso gunicorn termino; saliendo" >&2
kill "$MAIN" ${AGENT:+"$AGENT"} 2>/dev/null || true
exit 1
