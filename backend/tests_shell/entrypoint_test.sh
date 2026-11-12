#!/bin/sh
# Prueba: si la API de agentes no puede ligarse (red de k3d ausente), el panel sigue en pie.
# Uso: sh tests_shell/entrypoint_test.sh   (desde backend/)
set -e
T=$(mktemp -d)
cat > "$T/python" <<'X'
#!/bin/sh
exit 0
X
cat > "$T/gunicorn" <<'X'
#!/bin/sh
case "$*" in *172.18.0.1*) echo "bind fallido" >&2; exit 1 ;; esac
exec sleep 8
X
chmod +x "$T/python" "$T/gunicorn"
set +e
PATH="$T:$PATH" PHANTOM_AGENT_BIND=172.18.0.1:8001 timeout 6 sh ./entrypoint.sh > "$T/out" 2>&1
code=$?
set -e
rm -rf "$T"
if [ "$code" = 124 ]; then echo "PASS: el panel sigue vivo sin la API de agentes"; exit 0; fi
echo "FAIL: entrypoint termino con codigo $code"; exit 1
