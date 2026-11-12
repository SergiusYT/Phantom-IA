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
# El panel manda: si la API de agentes cae (p. ej. falta la red de k3d) se avisa y se reintenta,
# pero el panel sigue en pie (las auditorias fallaran con un mensaje claro mientras tanto).
while kill -0 "$MAIN" 2>/dev/null; do
    if [ -n "$PHANTOM_AGENT_BIND" ] && ! kill -0 "$AGENT" 2>/dev/null; then
        echo "AVISO: la API de agentes ($PHANTOM_AGENT_BIND) no esta activa; reintento en 15 s" >&2
        sleep 15
        DJANGO_SETTINGS_MODULE=phantom.settings_agent gunicorn phantom.wsgi -b "$PHANTOM_AGENT_BIND" -w 2 -t 120 &
        AGENT=$!
    fi
    sleep 2
done
echo "el panel (gunicorn principal) termino; saliendo" >&2
[ -n "$AGENT" ] && kill "$AGENT" 2>/dev/null
exit 1
