#!/bin/sh
# PHANTOM AI - Preparacion del firewall FreeBSD (ejecutar como root en la VM).
# Uso desde el host:  make freebsd-setup
set -e

PUBKEY="$1"   # llave publica del controlador PHANTOM (restringida)
EXT_IF=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
EXT_IF=${EXT_IF:-em0}

# 0. Modulos PF (pfctl los necesita incluso para validar).
kldload -n pf pflog

# 1. pf.conf con la interfaz real (respaldo del anterior).
[ -f /etc/pf.conf ] && cp /etc/pf.conf "/etc/pf.conf.bak.$(date +%s)"
sed "s/^ext_if = .*/ext_if = \"$EXT_IF\"/" /tmp/phantom/pf.conf > /etc/pf.conf
pfctl -nf /etc/pf.conf

# 2. Canal restringido.
mkdir -p /usr/local/sbin /usr/local/etc/rc.d
install -m 0755 /tmp/phantom/phantom-pf /usr/local/sbin/phantom-pf
mkdir -p /var/db/phantom && touch /var/db/phantom/anchor.rules

# 3. Servicio ficticio innecesario en 8081 (80/443 se reenvian a la aplicacion).
cat > /usr/local/etc/rc.d/phantom_lab <<'EOF'
#!/bin/sh
# PROVIDE: phantom_lab
# REQUIRE: NETWORKING
. /etc/rc.subr
name=phantom_lab
rcvar=phantom_lab_enable
start_cmd="phantom_lab_start"
stop_cmd="pkill -f phantom-lab-listener; pkill -f 'nc -l 8081'; true"
phantom_lab_start() {
    for p in 8081; do
        /usr/sbin/daemon -f -t phantom-lab-listener sh -c "while true; do echo 'PHANTOM lab service' | nc -l $p >/dev/null 2>&1; done"
    done
}
load_rc_config $name
run_rc_command "$1"
EOF
chmod 0755 /usr/local/etc/rc.d/phantom_lab
sysrc -q phantom_lab_enable=YES pf_enable=YES pflog_enable=YES gateway_enable=YES >/dev/null
sysctl -q net.inet.ip.forwarding=1 >/dev/null
service phantom_lab stop >/dev/null 2>&1 || true
service phantom_lab start

# 4. Activar PF.
service pflog start >/dev/null 2>&1 || true
pfctl -e 2>/dev/null || true
pfctl -f /etc/pf.conf
pfctl -a phantom -f /var/db/phantom/anchor.rules

# 5. Llave restringida del controlador.
if [ -n "$PUBKEY" ]; then
    mkdir -p /root/.ssh && chmod 700 /root/.ssh
    touch /root/.ssh/authorized_keys
    grep -v 'phantom-controller' /root/.ssh/authorized_keys > /root/.ssh/ak.tmp || true
    echo "command=\"/usr/local/sbin/phantom-pf\",restrict $PUBKEY" >> /root/.ssh/ak.tmp
    mv /root/.ssh/ak.tmp /root/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys
fi

echo "== PHANTOM FreeBSD listo: interfaz $EXT_IF =="
pfctl -si | head -3
sockstat -4 -l -P tcp | grep -E ':8081 '
pfctl -sn
