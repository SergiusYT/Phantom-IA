# PHANTOM AI - tareas del proyecto. Todo pasa por bin/phx (Docker nativo + kubectl/k3d locales).
PHX      := ./bin/phx
PF_HOST  ?= 172.16.97.132
ADMIN_KEY ?= $(HOME)/.ssh/id_ed25519
PY       := backend/.venv/bin/python

.PHONY: help up tools cluster demo demo-reset freebsd-setup pf-reset backend frontend dev test compose-up compose-down status clean

help:
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-15s %s\n", $$1, $$2}'

tools: ## Descarga kubectl y k3d en bin/
	@mkdir -p bin
	@[ -x bin/kubectl ] || curl -fsSLo bin/kubectl "https://dl.k8s.io/release/v1.31.5/bin/linux/amd64/kubectl"
	@[ -x bin/k3d ] || curl -fsSLo bin/k3d https://github.com/k3d-io/k3d/releases/download/v5.8.3/k3d-linux-amd64
	@chmod +x bin/kubectl bin/k3d

cluster: tools ## Crea el cluster k3d 'phantom' (k3s aplica NetworkPolicy de serie)
	$(PHX) k3d cluster create phantom --servers 1 --agents 1 \
	  -p "30080-30082:30080-30082@server:0" --k3s-arg "--disable=traefik@server:0" --wait

demo: ## Despliega la aplicacion de laboratorio en estado inseguro
	$(PHX) kubectl apply -f infra/k8s/demo-app.yaml
	$(PHX) kubectl -n phantom-demo wait --for=condition=available deploy --all --timeout=240s

demo-reset: ## Devuelve Kubernetes al estado inicial inseguro (para repetir la demo)
	-$(PHX) kubectl -n phantom-demo delete netpol -l phantom.io/managed=true
	$(PHX) kubectl -n phantom-demo delete svc db --ignore-not-found
	$(PHX) kubectl apply -f infra/k8s/demo-app.yaml

freebsd-setup: ## Configura PF, servicios de prueba y el canal restringido en la VM
	@[ -f infra/keys/phantom_ro_ed25519 ] || ssh-keygen -q -t ed25519 -N '' -C phantom-agent-ro -f infra/keys/phantom_ro_ed25519
	ssh -i $(ADMIN_KEY) -o IdentitiesOnly=yes root@$(PF_HOST) 'mkdir -p /tmp/phantom'
	scp -i $(ADMIN_KEY) -o IdentitiesOnly=yes -q infra/freebsd/pf.conf infra/freebsd/phantom-pf infra/freebsd/setup.sh root@$(PF_HOST):/tmp/phantom/
	@# En segundo plano: al activar PF la sesion SSH en curso puede quedar sin estado.
	ssh -i $(ADMIN_KEY) -o IdentitiesOnly=yes root@$(PF_HOST) "nohup sh /tmp/phantom/setup.sh '$$(cat infra/keys/phantom_ed25519.pub)' '$$(cat infra/keys/phantom_ro_ed25519.pub)' > /tmp/phantom/setup.log 2>&1 &"
	@sleep 10
	ssh -i $(ADMIN_KEY) -o IdentitiesOnly=yes root@$(PF_HOST) cat /tmp/phantom/setup.log

pf-reset: ## Vacia el anchor de PHANTOM (puerto 8081 abierto otra vez)
	ssh -i infra/keys/phantom_ed25519 -o IdentitiesOnly=yes root@$(PF_HOST) reset-lab

backend: ## Backend Django en modo desarrollo (puerto 8000)
	$(PHX) bash -c 'cd backend && .venv/bin/python manage.py migrate -v0 && .venv/bin/python manage.py seed_users && exec .venv/bin/python manage.py runserver 127.0.0.1:8000'

frontend: ## Frontend React en modo desarrollo (puerto 5173)
	cd frontend && npm run dev

test: ## Pruebas unitarias del backend
	cd backend && .venv/bin/python manage.py test core

up: ## Levanta TODO en orden (VMware, VM, k3d, compose) y repara lo que falte
	@./bin/phantom-up --open

compose-up: ## Levanta la plataforma con Docker Compose (http://localhost:8088)
	@[ -f .env ] || { echo "Copia .env.example a .env primero"; exit 1; }
	$(PHX) docker compose up -d --build

compose-down: ## Detiene la plataforma de Docker Compose
	$(PHX) docker compose down

status: ## Estado rapido de cluster y firewall
	$(PHX) kubectl -n phantom-demo get pods,svc,netpol
	-ssh -i infra/keys/phantom_ed25519 -o IdentitiesOnly=yes -o ConnectTimeout=5 root@$(PF_HOST) anchor

clean: ## Elimina el cluster k3d
	$(PHX) k3d cluster delete phantom
