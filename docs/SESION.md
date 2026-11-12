# PHANTOM AI — Estado y continuidad (12-nov-2026)

Documento de traspaso para retomar el trabajo en otra sesión (humano o Claude).

## Qué es
Plataforma multiagente de orquestación y seguridad de red (proyecto Redes II):
React + Django REST, 4 agentes IA (recolector, analista, auditor, planificador) **orquestados por Kubernetes como Jobs** en `phantom-agents`, con Ollama `mistral` dentro del clúster (`phantom-ai`),
controlador seguro (lista permitida, aprobación humana, respaldo, verificación, rollback),
app demo en Kubernetes (k3d: frontend nginx / api python / db postgres) y FreeBSD con PF como firewall perimetral.

## Ruta del tráfico
Cliente → FreeBSD PF `172.16.97.132:80/443` → `rdr` + `nat` → host `172.16.97.1:30080` (NodePort k3d) → Service Web (nginx) → api :8080 → db :5432.

Estado inseguro **deliberado** para la demo:
- DB publicada como NodePort 30082 (se salta el firewall).
- NetworkPolicy `allow-all`.
- Puerto 8081 abierto en PF sin necesidad.

## Arrancar después de reiniciar
`make up` — revisa y repara todo en orden (VMware, VM, k3d, DNS, NetworkPolicy, agentes e IA, compose) y abre Firefox.
Usuarios `admin / phantom-admin` (operador), `observador / phantom-viewer`.

Volver al estado inseguro de demo: `make demo-reset pf-reset`.

## Particularidades del entorno
- Docker Desktop se cae con VMware encendido → usar Docker Engine nativo vía `bin/phx` (usa `sg docker`, `DOCKER_CONFIG=.docker`, `KUBECONFIG=.kube/config`).
- No tocar `~/.docker/config.json` global.
- VM FreeBSD: acceso solo por llave SSH (root con `~/.ssh/id_ed25519`). El controlador usa `infra/keys/phantom_ed25519`, forzado a `/usr/local/sbin/phantom-pf` (solo operaciones permitidas; puerto 22 protegido).
- `pfctl` necesita `kldload pf pflog` antes de validar reglas. Activar PF puede congelar la sesión SSH → `setup.sh` se corre con `nohup`.
- Secretos en `.env` y llaves en `infra/keys/` están en `.gitignore`. Los agentes usan `infra/keys/phantom_ro_ed25519` (forzada a `phantom-pf --ro`: solo consultas).
- Tras reiniciar el PC, `vmware.service` puede fallar ("Virtual ethernet - failed") si el kernel es nuevo: `make up` lo arregla; `sudo infra/host/vmware-autofix.sh` lo evita.
- k3s: el controlador de NetworkPolicy (kube-router) puede trabarse con carga alta ("heartbeat missed") y dejar pods sin reglas; CoreDNS perdió su imagen en un nodo. `make up` detecta y repara ambos.
- La API de agentes escucha en `172.18.0.1:8001` (gateway de la red docker `k3d-phantom`).

## Hecho
- Backend: modelos, adaptadores k8s/pf/docker, pruebas de conectividad, agentes + streaming, controlador con 3 operaciones, insights (puntaje, explorador de tablas, esquema ER). 11 pruebas OK (`make test`).
- Frontend: Portada, Acceso, Panel con gráficas, Orquestación en vivo, Topología (Exterior / Perímetro / Host / Kubernetes), Sala de agentes (grafo con globos + chat), Auditorías (línea de tiempo), Propuestas, Conectividad, Registro (diagrama ER + explorador).
- Docker Compose: db, docker-proxy (solo lectura), backend, frontend :8088.
- 4 escenarios de demo verificados de punta a punta, incluido rollback.

- Agentes en Kubernetes (rama `feat/agentes-k8s`): diseño `docs/superpowers/specs/2026-11-12-agentes-en-kubernetes-design.md`, plan `docs/superpowers/plans/2026-11-12-agentes-en-kubernetes.md`. Auditoría normal y con caída simulada verificadas de punta a punta.

## Pendiente / opcional
- Subir a un repositorio remoto privado.
- Limpiar propuestas de demo pendientes en la BD.
- Cambiar la contraseña root de la VM (`passwd`), porque se compartió en un chat.

## Memoria
- Engram: proyecto `phantom ai` (resumen de sesión + arquitectura).
- Grafo de conocimiento: `graphify-out/` (`graph.html`, `GRAPH_REPORT.md`).
- Conversación completa: `claude --resume` dentro de esta carpeta.
