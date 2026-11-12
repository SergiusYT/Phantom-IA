# Agentes PHANTOM en Kubernetes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada agente de PHANTOM (recolector, analista, auditor, planificador) corre como Kubernetes Job bajo demanda en `phantom-agents`, con Ollama dentro del cluster en `phantom-ai`, y todo se ve en vivo en Orquestación, Topología y la Sala.

**Architecture:** El coordinador sigue en el backend (Docker Compose, `network_mode: host`): crea Jobs con `kubectl`, espera su estado y persiste resultados. Los pods ejecutan la misma base de código (`core.agents.roles`) con un `RemoteChat` que habla con una **API de agentes** servida por un segundo gunicorn ligado solo a la IP del gateway de la red docker de k3d (`172.18.0.1:8001`, urlconf solo-agentes). Ollama corre como Deployment con imagen construida localmente desde el binario del host y el modelo copiado al nodo (`hostPath`).

**Tech Stack:** Django 6.1 + DRF, PostgreSQL (compose), k3d/k3s v1.31 (NetworkPolicy nativa), kubectl, Ollama 0.13.5 (CPU), React 18 + Vite 5, FreeBSD 15 PF.

**Spec:** `docs/superpowers/specs/2026-11-12-agentes-en-kubernetes-design.md`

## Global Constraints

- Namespaces: agentes `phantom-agents`; IA `phantom-ai`; app auditada `phantom-demo` (sin cambios).
- Orden: `recolector` → (`analista` ‖ `auditor`) → `planificador`.
- Sin fallback silencioso: si un Job falla definitivamente, auditoría `FAILED` con mensaje en la Sala. Modo en-proceso solo con `PHANTOM_AGENTS_MODE=local` (pruebas).
- Jobs terminados visibles ≥ 10 min: `ttlSecondsAfterFinished: 600`. `backoffLimit: 1`.
- Agentes sin credenciales de escritura: llave PF de solo lectura `phantom_ro_ed25519`; RBAC solo lectura (+ `pods/exec` para recolector).
- La API de PHANTOM no se expone a la LAN: el bind para pods es `172.18.0.1:8001` y solo sirve `/api/agent/…`.
- No descargar el modelo (~4 GB) ni la imagen `ollama/ollama`. Imágenes base: `python:3.12-slim` (ya en caché local).
- Presupuesto: orquestación ≤ ~15 s extra sobre la auditoría actual (sin contar generación LLM). Ollama `OLLAMA_KEEP_ALIVE=-1` y precarga; `imagePullPolicy: Never`.
- Hallazgos y propuestas no cambian de contenido respecto a hoy (mismas reglas).
- UI en español, tema verde actual, logos simple-icons, poco texto técnico.
- Las 11 pruebas existentes de `backend/core/tests.py` siguen pasando.
- No recrear el cluster k3d `phantom`.

## Review Focus

1. Dos auditorías lanzadas casi a la vez → la segunda responde 409 "ya hay una auditoría en curso" (los nombres de Job chocarían). Test en Task 4.
2. Token de agente usado después de terminar la auditoría o contra otra auditoría → 403. Test en Task 3.
3. El pod no alcanza la API (bind o NetworkPolicy mal) → el Job falla o vence `activeDeadlineSeconds`; el coordinador no se cuelga (timeout propio) y la Sala dice qué agente no pudo trabajar. Test en Task 4.
4. Backend reiniciado a mitad de auditoría → `recover_audits` la marca `FAILED` **y** borra Jobs/Secrets con `phantom/audit=<id>`. Test en Task 4.
5. Reintento tras fallo (simulado o real) → mensajes del intento 1 marcados `failed_attempt`, resultado duplicado ignorado, hallazgos no duplicados. Test en Task 3.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `infra/freebsd/phantom-pf` (mod) | Modo `--ro`: rechaza operaciones de escritura |
| `infra/freebsd/setup.sh` (mod) | Instala 2ª llave con `command="… --ro"` |
| `Makefile` (mod) | `freebsd-setup` pasa la llave RO; targets `agents-images`, `agents-deploy` |
| `backend/core/agents/roles.py` (nuevo) | Lógica de cada rol, extraída de `coordinator._run`, contra una interfaz `chat` |
| `backend/core/agents/remote.py` (nuevo) | `RemoteChat` + `AgentClient` (HTTP a la API de agentes) |
| `backend/core/agents/runner.py` (nuevo) | Entrypoint del pod: `python -m core.agents.runner` |
| `backend/core/agent_api.py` (nuevo) | Vistas + autenticación por token de la API de agentes |
| `backend/phantom/agent_urls.py`, `backend/phantom/settings_agent.py` (nuevos) | urlconf y settings del gunicorn de agentes |
| `backend/core/models.py` (mod) + migración | `Audit.agent_token`, `Audit.fail_agent`; modelo `AgentRun` |
| `backend/core/agents/orchestrator.py` (nuevo) | Crear/esperar/limpiar Jobs y Secrets en `phantom-agents` |
| `backend/core/agents/coordinator.py` (mod) | Flujo por etapas con Jobs; modo `local` para pruebas |
| `backend/core/adapters/k8s.py` (mod) | `orchestration()` incluye `agents` y `ai`; `ollama_ready()` |
| `backend/core/tests_agents.py` (nuevo) | Pruebas de API de agentes, roles, coordinador/orquestador |
| `backend/entrypoint.sh` (nuevo), `backend/Dockerfile` (mod) | Dos gunicorn (127.0.0.1:8000 completo, 172.18.0.1:8001 agentes) |
| `infra/k8s/agents.yaml` (nuevo) | Namespaces, ServiceAccounts, RBAC, NetworkPolicies |
| `infra/k8s/ollama.yaml` (nuevo) | Deployment/Service/NetworkPolicy de Ollama |
| `infra/docker/ollama.Dockerfile` (nuevo) | Imagen `phantom-ollama:0.13.5` CPU desde binario del host |
| `bin/phantom-up` (mod) | Imágenes, import, manifiestos, modelo, precarga |
| `frontend/src/Orquestacion.jsx`, `Topology.jsx`, `App.jsx`, `Sala.jsx`, `GrafoAgentes.jsx` (mod) | Zona "Agentes IA", botón "Simular fallo", intentos fallidos |
| `.env.example`, `README.md` (mod) | Variables nuevas e interruptor de Ollama |

---

### Task 1: Llave de solo lectura para el firewall

**Files:**
- Modify: `infra/freebsd/phantom-pf:15-18`, `infra/freebsd/setup.sh:5-6,53-61`, `Makefile:31-37`
- Create (gitignored): `infra/keys/phantom_ro_ed25519{,.pub}`

**Interfaces:**
- Produces: llave `infra/keys/phantom_ro_ed25519` aceptada por la VM solo para `status rules anchor nat listening logs`; comentario de llave `phantom-agent-ro`.

- [ ] **Step 1:** En `phantom-pf`, antes de `CMD=…`: si `$1 = --ro`, `RO=1; shift`. Tras calcular `OP`: si `RO=1` y `OP` ∈ {`block-port`,`unblock-port`,`restore`,`reset-lab`} → `echo "ERROR: canal de solo lectura"; log rejected-ro; exit 2`.
- [ ] **Step 2:** `setup.sh` acepta `$2` = pubkey RO; quita líneas con `phantom-agent-ro` y añade `command="/usr/local/sbin/phantom-pf --ro",restrict $RO_PUBKEY`.
- [ ] **Step 3:** `Makefile freebsd-setup`: generar la llave si falta (`ssh-keygen -t ed25519 -N '' -C phantom-agent-ro -f infra/keys/phantom_ro_ed25519`) y pasar `'$$(cat infra/keys/phantom_ro_ed25519.pub)'` como 2º argumento.
- [ ] **Step 4:** Ejecutar `make freebsd-setup`. Esperado: log termina en `== PHANTOM FreeBSD listo`.
- [ ] **Step 5: Verificar**
  - `ssh -i infra/keys/phantom_ro_ed25519 -o IdentitiesOnly=yes root@172.16.97.132 status` → contiene `Status: Enabled`.
  - `… phantom_ro_ed25519 … block-port 9999` → `ERROR: canal de solo lectura`, exit 2.
  - `… phantom_ed25519 … anchor` (llave de escritura) sigue funcionando; `curl http://172.16.97.132/` → 200.
- [ ] **Step 6: Commit** `feat(freebsd): canal PF de solo lectura para agentes`

### Task 2: Roles de agente desacoplados del coordinador

**Files:**
- Create: `backend/core/agents/roles.py`
- Modify: `backend/core/agents/coordinator.py` (el cuerpo de `_run` pasa a llamar a `roles`)
- Test: `backend/core/tests_agents.py`

**Interfaces:**
- Consumes: `analyst.analyze/summarize`, `auditor.audit`, `planner.plan/context_for`, `llm.explain_stream`, `k8s.collect`, `pf.collect`, `connectivity`.
- Produces (todas reciben `chat` con `say(agent, text, kind="say", to="", **payload)`, `stream(agent, to="", **payload) -> (handle, update_fn)`, `end_stream(handle)`):
  - `run_recolector(chat) -> dict` → `{"snapshot": {...k8s, pf, connectivity}, "errors": [str]}`
  - `run_analista(chat, snapshot: dict) -> {"findings": [dict]}`
  - `run_auditor(chat, snapshot: dict, allowed_ports: list[int]) -> {"findings": [dict]}`
  - `run_planificador(chat, snapshot: dict, findings: list[dict]) -> {"proposals": [{"proposal": dict, "finding_idx": [int]}]}` — incluye `llm_explanation` (streaming vía `chat.stream`); **sin** `preview` (lo añade el backend).
  - Los textos de los mensajes se conservan idénticos a los actuales de `coordinator._run`; los mensajes del coordinador ("Gracias. Analista, …") quedan en el coordinador.

- [ ] **Step 1: Test** `test_roles_pipeline_matches_current_findings`: con un `FakeChat` que acumula mensajes y `INSECURE` de `tests.py`, `run_analista` + `run_auditor` producen los mismos `rule_id` que `analyst.analyze(INSECURE)+auditor.audit(INSECURE,[22,80,443])`; `run_planificador` (con `llm.explain_stream` parcheado a devolver `"x"`) devuelve propuestas cuyas `operation` ⊂ `controller.OPERATIONS` (claves) y ningún elemento tiene clave `preview`.
- [ ] **Step 2:** `cd backend && .venv/bin/python manage.py test core.tests_agents -v2` → FAIL (`ModuleNotFoundError: core.agents.roles`).
- [ ] **Step 3:** Implementar `roles.py` moviendo el código de `coordinator._run`; `coordinator._run` en modo local llama a los roles con su `Chat` actual y sigue persistiendo igual.
- [ ] **Step 4:** `manage.py test core -v2` → PASS (11 existentes + nuevo).
- [ ] **Step 5: Commit** `refactor(agents): extraer roles del coordinador`

### Task 3: API de agentes, token por auditoría y reintentos

**Files:**
- Modify: `backend/core/models.py` (+ `makemigrations`)
- Create: `backend/core/agent_api.py`, `backend/phantom/agent_urls.py`, `backend/phantom/settings_agent.py`, `backend/core/agents/remote.py`, `backend/core/agents/runner.py`
- Test: `backend/core/tests_agents.py`

**Interfaces:**
- Modelo: `Audit.agent_token = CharField(max_length=64, blank=True)`, `Audit.fail_agent = CharField(max_length=20, blank=True)`; `AgentRun(audit FK related_name="runs", role CharField(20), attempts PositiveSmallIntegerField(default=0), status CharField ∈ {pending, running, done, failed}, result JSONField(null=True), job_name CharField(63, blank=True), started_at/finished_at)`, `unique_together=(audit, role)`.
- Auth: header `X-Phantom-Agent: <token>`; válido solo si `audit.status == RUNNING` y `audit.agent_token` coincide (comparación `hmac.compare_digest`); si no → 403.
- Endpoints (prefijo `/api/agent/<int:audit_id>/`, solo en `agent_urls`):
  - `POST start/<role>/` → incrementa `AgentRun.attempts`, `status=running`; si `attempts > 1` marca `payload.failed_attempt=True` en mensajes previos de ese rol en esta auditoría y publica (coordinador) "Kubernetes reinició al <rol> (intento N)". Responde `{"attempt": int, "fail": bool, "input": dict}`; `fail = (role == audit.fail_agent and attempt == 1)`. `input`: recolector `{}`; analista/auditor `{"snapshot", "allowed_ports"}`; planificador `{"snapshot", "findings"}` (de los `AgentRun.result` previos).
  - `POST messages/` body `{agent, text, kind, to, payload, streaming}` → `{"seq": int}`. Asignación de `seq` bajo `transaction.atomic()` + `Audit.objects.select_for_update()` (analista y auditor publican en paralelo). `payload.attempt` se añade siempre.
  - `PATCH messages/<seq>/` body `{text?, streaming?}` → 204.
  - `POST result/<role>/` body = dict del rol → 200 primera vez (`status=done`, `result` guardado); 200 sin cambios si ya `done` (idempotente).
- `settings_agent.py`: `from .settings import *` + `ROOT_URLCONF = "phantom.agent_urls"`.
- `remote.AgentClient(api_url: str, audit_id: int, token: str)` con `start(role) -> dict`, `post_message(...) -> int`, `patch_message(seq, **fields)`, `deliver(role, result: dict)`; `remote.RemoteChat(client)` implementa la interfaz `chat` de Task 2 (incluye `PAUSA` 0.35 s en `say`).
- `runner.py`: `python -m core.agents.runner --role R` con env `PHANTOM_AGENT_API`, `PHANTOM_AUDIT_ID`, `PHANTOM_AGENT_TOKEN`; llama `start`, si `fail` publica "Simulo una caída (prueba de orquestación)." y `sys.exit(3)`; si no, ejecuta el rol y `deliver`. Excepción no controlada → mensaje `kind="error"` y exit 1.

- [ ] **Step 1: Tests** (con `APIClient` sobre `phantom.agent_urls` vía `@override_settings(ROOT_URLCONF="phantom.agent_urls")`):
  - `test_agent_token_rejected_when_audit_finished`: auditoría `DONE` con token → `POST start/recolector/` = 403.
  - `test_agent_token_rejected_for_other_audit`: token de A contra B (RUNNING) = 403.
  - `test_fail_only_on_first_attempt`: `fail_agent="auditor"`; 1º `start/auditor/` → `fail=True, attempt=1`; 2º → `fail=False, attempt=2`; mensajes del auditor publicados entre ambos tienen `payload.failed_attempt == True`.
  - `test_result_delivery_is_idempotent`: dos `POST result/analista/` → `AgentRun.result` igual al primero, sin error.
  - `test_main_api_not_served_on_agent_urlconf`: `GET /api/audits/` con ese urlconf → 404.
- [ ] **Step 2:** `manage.py test core.tests_agents -v2` → FAIL.
- [ ] **Step 3:** Implementar modelo + migración, `agent_api.py`, urlconf/settings, `remote.py`, `runner.py`.
- [ ] **Step 4:** `manage.py test core -v2` → PASS.
- [ ] **Step 5: Commit** `feat(agents): API de agentes con token por auditoría y reintentos`

### Task 4: Orquestador de Jobs y coordinador por etapas

**Files:**
- Create: `backend/core/agents/orchestrator.py`
- Modify: `backend/core/agents/coordinator.py`, `backend/core/views.py:131-135` (`start_audit`), `backend/core/management/commands/recover_audits.py`, `backend/phantom/settings.py` (`PHANTOM` dict)
- Test: `backend/core/tests_agents.py`

**Interfaces:**
- Settings nuevos en `PHANTOM`: `AGENTS_MODE` (env `PHANTOM_AGENTS_MODE`, default `"k8s"`), `AGENTS_NAMESPACE` (`phantom-agents`), `AGENT_IMAGE` (`phantom-agent:dev`), `AGENT_API_URL` (`http://172.18.0.1:8001`), `AGENT_OLLAMA_URL` (`http://ollama.phantom-ai:11434`), `JOB_TIMEOUT` (int s, default 240).
- `orchestrator.create_secret(audit_id, token)`; `orchestrator.create_job(audit_id: int, role: str) -> str` (nombre `phantom-<audit_id>-<role>`; labels `phantom/audit`, `phantom/agent`; `backoffLimit: 1`, `ttlSecondsAfterFinished: 600`, `activeDeadlineSeconds: 180`, `restartPolicy: Never`, `imagePullPolicy: Never`; SA `phantom-recolector` para recolector, `phantom-agente` para el resto; recolector monta Secret `phantom-pf-ro` en `/run/phantom/pf_key` (mode 0400) y `PHANTOM_PF_KEY` apunta ahí; env `PHANTOM_OLLAMA_URL=AGENT_OLLAMA_URL`, `PHANTOM_AGENT_API`, `PHANTOM_AUDIT_ID`, `PHANTOM_AGENT_TOKEN` desde Secret `phantom-audit-<id>`).
- `orchestrator.job_state(name) -> {"phase": "pending"|"running"|"complete"|"failed", "node": str|None, "failed_pods": int}`.
- `orchestrator.wait(names: list[str], on_event: Callable[[str, dict], None], timeout: int) -> dict[str, str]` — sondea cada 1 s; llama `on_event(name, state)` cuando cambia fase/nodo/fallos (el coordinador narra: "Kubernetes programó al auditor en k3d-phantom-agent-0", "El pod del auditor cayó; Kubernetes lo reintenta").
- `orchestrator.cleanup(audit_id)` borra el Secret de la auditoría (los Jobs los limpia el TTL); `orchestrator.purge(audit_id)` borra también Jobs (para `recover_audits`).
- Coordinador k8s: genera `agent_token` (`secrets.token_hex(32)`), etapa 1 recolector, etapa 2 analista+auditor juntos, etapa 3 planificador; tras cada etapa lee `AgentRun.result`; añade `preview` con `controller.preview` y persiste `Finding`/`Proposal` como hoy; al terminar borra `agent_token`. Cualquier Job `failed` o timeout → `FAILED` + mensaje "El <rol> no pudo completar su trabajo en Kubernetes: <motivo>".
- `start_audit`: body opcional `fail_agent` ∈ roles (solo operadores; observador con `fail_agent` → 403); si existe auditoría `RUNNING` → 409 `{"detail": "Ya hay una auditoría en curso"}`.

- [ ] **Step 1: Tests** (kubectl parcheado con un fake que registra manifiestos y devuelve estados programados):
  - `test_job_manifest_security`: manifiesto del analista sin volumen de llave, SA `phantom-agente`, `automountServiceAccountToken: false`; recolector con SA `phantom-recolector` y Secret `phantom-pf-ro`; ambos `backoffLimit==1`, `ttlSecondsAfterFinished==600`, `imagePullPolicy=="Never"`.
  - `test_stages_order_and_parallelism`: con `AGENTS_MODE="k8s"` y fake, `create_job` se llama en orden `recolector`, luego `analista` y `auditor` antes de esperar a cualquiera de los dos, luego `planificador`.
  - `test_failed_job_fails_audit_with_message`: fake devuelve `failed` para `auditor` → `audit.status == FAILED` y último mensaje contiene "auditor".
  - `test_wait_times_out`: fake siempre `running`, `JOB_TIMEOUT=2` → auditoría `FAILED` en < 5 s.
  - `test_second_audit_conflict`: con una auditoría RUNNING, `POST /api/audits/run/` → 409.
  - `test_recover_audits_purges_jobs`: `recover_audits` con auditoría RUNNING llama `orchestrator.purge(id)`.
- [ ] **Step 2:** `manage.py test core.tests_agents -v2` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `manage.py test core -v2` → PASS.
- [ ] **Step 5: Commit** `feat(agents): coordinador orquesta agentes como Jobs de Kubernetes`

### Task 5: Infraestructura Kubernetes, imágenes y arranque

**Files:**
- Create: `infra/k8s/agents.yaml`, `infra/k8s/ollama.yaml`, `infra/docker/ollama.Dockerfile`, `backend/entrypoint.sh`
- Modify: `backend/Dockerfile` (CMD → `entrypoint.sh`), `docker-compose.yml` (env `PHANTOM_AGENT_BIND=172.18.0.1:8001`), `bin/phantom-up`, `Makefile`, `.env.example`, `.gitignore` (`build/`)

**Interfaces:**
- `agents.yaml`: Namespaces `phantom-agents`, `phantom-ai`. SA `phantom-recolector`, `phantom-agente` (`automountServiceAccountToken: false`). Role `phantom-recolector-read` en `phantom-demo`: `get,list` sobre `pods, services, endpoints, events, networkpolicies(networking.k8s.io), deployments(apps)`; `create` sobre `pods/exec`. ClusterRole `phantom-nodes-read`: `get,list nodes`. NetworkPolicies en `phantom-agents`: `default-deny` (Ingress+Egress); `allow-dns` (UDP/TCP 53 a kube-system); `allow-phantom-api` (egress `172.18.0.1/32:8001`); `allow-ollama` (egress a namespace `phantom-ai` pods `app=ollama` :11434); `recolector-extra` (podSelector `phantom/agent=recolector`; egress API de k8s `172.18.0.3/32:6443` y `10.43.0.1/32:443`, `172.16.97.132/32` puertos 22,80,443,8081).
- `ollama.yaml`: Deployment `ollama` (1 réplica, `nodeSelector kubernetes.io/hostname: k3d-phantom-agent-0`, imagen `phantom-ollama:0.13.5`, `imagePullPolicy: Never`, env `OLLAMA_HOST=0.0.0.0:11434`, `OLLAMA_MODELS=/models`, `OLLAMA_KEEP_ALIVE=-1`, `hostPath /var/lib/phantom/ollama-models → /models` readOnly, readiness `GET /api/tags`, requests `cpu: 2, memory: 6Gi`, limits `memory: 8Gi`). Service `ollama:11434`. NetworkPolicy: ingress solo desde namespace `phantom-agents`.
- `ollama.Dockerfile`: `FROM python:3.12-slim`; `COPY build/ollama/bin/ollama /usr/local/bin/`; `COPY build/ollama/lib/ /usr/local/lib/ollama/` (solo `libggml-*.so*`, sin `cuda_*` ni `vulkan`); `ENTRYPOINT ["ollama","serve"]`.
- `entrypoint.sh`: migrate/seed/recover/collectstatic como hoy; `gunicorn phantom.wsgi -b 127.0.0.1:8000 …` y, si `PHANTOM_AGENT_BIND` está definido, segundo `gunicorn` con `DJANGO_SETTINGS_MODULE=phantom.settings_agent -b $PHANTOM_AGENT_BIND -w 2`; si uno muere, el contenedor termina.
- Secret `phantom-pf-ro` en `phantom-agents` desde `infra/keys/phantom_ro_ed25519` (lo crea `phantom-up`, idempotente con `kubectl create … --dry-run=client -o yaml | kubectl apply -f -`).
- `bin/phantom-up` nuevos pasos tras k3d y antes de compose: (a) si no existe imagen `phantom-ollama:0.13.5`: copiar `/usr/local/bin/ollama` y `/usr/local/lib/ollama/libggml-*` a `build/ollama/`, `docker build`; (b) `docker compose build phantom-backend` y `docker tag` de la imagen del backend como `phantom-agent:dev`; (c) `k3d image import phantom-agent:dev phantom-ollama:0.13.5 -c phantom` solo si el digest cambió (guardar en `build/.imported`); (d) si falta `/var/lib/phantom/ollama-models/manifests` en `k3d-phantom-agent-0`: `docker cp /usr/share/ollama/.ollama/models/. k3d-phantom-agent-0:/var/lib/phantom/ollama-models/`; (e) `kubectl apply -f infra/k8s/agents.yaml -f infra/k8s/ollama.yaml`, Secret; (f) esperar `rollout status deploy/ollama -n phantom-ai`; (g) precarga: `kubectl -n phantom-ai exec deploy/ollama -- ollama run mistral ""`. Cada paso imprime ✔/↻ como hoy.
- `.env.example`: `PHANTOM_AGENTS_MODE=k8s`, `PHANTOM_AGENT_API=http://172.18.0.1:8001`, `PHANTOM_AGENT_OLLAMA_URL=http://ollama.phantom-ai:11434` con comentario del interruptor (Ollama del host: `http://172.18.0.1:11434`, requiere `OLLAMA_HOST=0.0.0.0` en el servicio systemd del host y añadir egress `172.18.0.1/32:11434` — documentado, no por defecto).

- [ ] **Step 1:** Escribir manifiestos, Dockerfile, entrypoint, pasos de `phantom-up`, Makefile (`agents-images`, `agents-deploy` reutilizando funciones del script).
- [ ] **Step 2:** `./bin/phantom-up` → todos los pasos ✔; `bin/phx kubectl -n phantom-ai get pods` → `ollama-…  1/1 Running`.
- [ ] **Step 3: Verificar aislamiento**
  - Pod temporal en `phantom-agents` con SA `phantom-agente` (imagen `phantom-agent:dev`, `imagePullPolicy: Never`): `curl -s http://172.18.0.1:8001/api/agent/0/start/recolector/` → 403 (alcanza la API); `curl -m3 http://172.18.0.1:8000/` → timeout (API principal no alcanzable); `curl -s http://ollama.phantom-ai:11434/api/tags` → contiene `mistral`; `kubectl get pods -n phantom-demo` dentro del pod → Forbidden/sin token.
  - Desde el host: `curl -m3 http://<IP wifi del host>:8001/` → conexión rechazada (bind solo en 172.18.0.1).
  - Pod en `phantom-demo` (`frontend`): `curl -m3 http://ollama.phantom-ai:11434/` → timeout.
- [ ] **Step 4:** `manage.py test core -v2` → PASS (sin regresiones).
- [ ] **Step 5: Commit** `feat(infra): agentes y Ollama desplegados en k3d con RBAC y NetworkPolicy`

### Task 6: Orquestación en vivo y Topología con agentes

**Files:**
- Modify: `backend/core/adapters/k8s.py` (`orchestration()`, nueva `ollama_ready()`), `backend/core/views.py` (`overview` LED IA, `topology` nodos de agentes), `frontend/src/Orquestacion.jsx`, `frontend/src/Topology.jsx`, `frontend/src/App.jsx` (LED "IA local" → "IA en Kubernetes")
- Test: `backend/core/tests_agents.py`

**Interfaces:**
- `k8s.orchestration()` añade `"agents": {"jobs": [{"name","audit","agent","phase","attempts","failed","started","finished","node"}], "pods": [mismo formato que pods actuales + "agent","audit"]}` y `"ai": {"pods": [...], "ready": bool}`.
- `k8s.ollama_ready() -> bool` (deployment `ollama` en `phantom-ai` con `readyReplicas >= 1`); `overview.llm.available` usa esto cuando `AGENTS_MODE == "k8s"`.
- `topology` añade nodos `{"id": "agent-<rol>", "kind": "agent"}` ×4 y `{"id": "ollama", "kind": "ai"}`, y aristas lógicas: recolector→frontend/api/db (lectura), recolector→firewall (SSH solo lectura), planificador→ollama (único que usa el LLM), todos→phantom-api.
- UI Orquestación: zona "Agentes IA" bajo el cluster: una tarjeta por rol con logo, estado del pod (Pendiente / Trabajando / Terminó / Cayó) y nodo; tarjeta "IA (Mistral)" con estado; si hay auditoría en curso se resalta la etapa activa; pods fallidos se muestran tachados en rojo junto al reintento.
- UI Topología: grupo "Agentes IA" e "IA" dentro de la caja Kubernetes, flechas punteadas de lectura hacia la app auditada y hacia el firewall (manteniendo el layout actual de 4 zonas).

- [ ] **Step 1: Test** `test_orchestration_includes_agents`: con `kubectl` fake que devuelve un Job y un pod con labels `phantom/agent=auditor`, `phantom/audit=7`, `orchestration()["agents"]["jobs"][0]` tiene `agent=="auditor"`, `audit=="7"`.
- [ ] **Step 2:** FAIL → implementar backend → PASS (`manage.py test core -v2`).
- [ ] **Step 3:** Implementar UI. `cd frontend && npm run build` → sin errores.
- [ ] **Step 4:** Captura headless (patrón existente: scroll dentro del contenedor) de Orquestación y Topología con una auditoría en curso; revisar que se ven las 4 tarjetas de agentes y la IA.
- [ ] **Step 5: Commit** `feat(ui): agentes IA visibles en orquestación y topología`

### Task 7: Sala y botón "Simular fallo"

**Files:**
- Modify: `frontend/src/App.jsx` (lanzar auditoría), `frontend/src/Sala.jsx`, `frontend/src/GrafoAgentes.jsx`

**Interfaces:**
- Consumes: `POST /api/audits/run/` body `{"fail_agent": "<rol>"}` opcional (Task 4); mensajes con `payload.attempt` y `payload.failed_attempt` (Task 3).
- Botón "Auditar" con menú secundario "Simular fallo de…" (recolector/analista/auditor/planificador), visible solo si `user.operator`.
- Sala: mensajes con `failed_attempt` en gris tenue con etiqueta "intento fallido"; mensajes del coordinador sobre Kubernetes (programó/cayó/reinició) con icono de Kubernetes.
- Grafo de agentes: nodo del agente caído parpadea en rojo hasta que llega el reintento.

- [ ] **Step 1:** Implementar. `npm run build` → sin errores.
- [ ] **Step 2:** Verificar como observador (`observador / phantom-viewer`) que el menú no aparece; `POST audits/run/ {"fail_agent":"auditor"}` con token de observador → 403.
- [ ] **Step 3: Commit** `feat(ui): simular caída de un agente y mostrar reintentos`

### Task 8: Verificación de punta a punta y documentación

**Files:**
- Modify: `README.md`, `docs/SESION.md`

- [ ] **Step 1:** `make demo-reset pf-reset && ./bin/phantom-up`.
- [ ] **Step 2:** Auditoría normal desde la UI (admin). Esperado: en Orquestación aparecen `phantom-<id>-recolector`, luego `…-analista` y `…-auditor` a la vez, luego `…-planificador`; la auditoría termina `DONE` con los mismos hallazgos que antes (demo inseguro: allow-all, DB NodePort 30082, 8081 abierto) y propuestas con explicación del LLM. Medir duración total y compararla con la última auditoría local registrada (presupuesto ≤ +15 s sin LLM; anotar el resultado).
- [ ] **Step 3:** Auditoría con "Simular fallo → auditor". Esperado: pod del auditor `Failed`, nuevo pod creado por Kubernetes, Sala muestra "intento fallido" y el reinicio, auditoría `DONE`, hallazgos no duplicados.
- [ ] **Step 4:** Ejecutar una propuesta aprobada (segmentación) y su rollback: igual que antes (controlador sin cambios).
- [ ] **Step 5:** `make compose-down && make compose-up` a mitad de una auditoría → la auditoría queda `FAILED` y `kubectl -n phantom-agents get jobs -l phantom/audit=<id>` vacío.
- [ ] **Step 6:** README: arquitectura nueva (diagrama de dónde corre cada cosa), `make up`, interruptor de Ollama, llave RO. `docs/SESION.md` actualizado.
- [ ] **Step 7: Commit** `docs: agentes orquestados por Kubernetes`
