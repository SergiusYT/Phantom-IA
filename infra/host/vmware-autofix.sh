#!/usr/bin/env bash
# Instala (una sola vez, con sudo) un arreglo para que VMware arranque bien tras actualizar el kernel.
# Problema: al llegar un kernel nuevo, vmmon/vmnet no existen para el; vmware.service falla al arrancar
# ("Virtual ethernet - failed"), no se crea vmnet8 y la VM FreeBSD queda inalcanzable.
# Arreglo: drop-in que, antes de arrancar vmware.service, compila los modulos si faltan.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo: sudo $0"; exit 1; }

DIR=/etc/systemd/system/vmware.service.d
mkdir -p "$DIR"
cat > "$DIR/phantom-modules.conf" <<'EOF'
# PHANTOM AI: compila vmmon/vmnet para el kernel actual si faltan (pasa tras actualizar el kernel).
[Service]
TimeoutStartSec=600
ExecStartPre=-/bin/sh -c 'modinfo vmmon >/dev/null 2>&1 && modinfo vmnet >/dev/null 2>&1 || /usr/bin/vmware-modconfig --console --install-all'
EOF
systemctl daemon-reload
echo "Instalado: $DIR/phantom-modules.conf"
echo "Desinstalar: sudo rm -r $DIR && sudo systemctl daemon-reload"
