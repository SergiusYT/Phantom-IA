# PHANTOM AI

Plataforma multiagente para la orquestación inteligente y la seguridad de redes (proyecto de Redes II).

PHANTOM revisa un clúster Kubernetes y un firewall FreeBSD/PF con cuatro agentes de IA. **Kubernetes orquesta a los agentes**: cada uno corre en su propio pod, nace cuando pides una auditoría y desaparece al terminar.

Los cuatro son agentes de **IA híbrida**: reglas fijas detectan y deciden; el modelo local (Ollama `mistral`, dentro del clúster) razona y explica. Lo que diga la IA nunca cambia un hallazgo ni una corrección (hay una prueba que lo garantiza: si la IA responde algo absurdo, los resultados son idénticos).

| Agente | Reglas fijas (deciden) | IA (razona y explica) |
|---|---|---|
| Recolector | Lee el clúster (RBAC de solo lectura) y el firewall (llave SSH de solo lectura); prueba los flujos de red | Interpreta la red: por dónde entra el tráfico, qué está expuesto, qué responde |
| Analista | Detecta fallos operativos (pods caídos, reinicios, servicios sin endpoints) | Diagnostica la causa probable y a qué servicio afecta |
| Auditor | Detecta riesgos de seguridad (`SEC-K8S-*`, `SEC-PF-*`, `SEC-NET-*`) | Explica cómo se aprovecharía cada riesgo y en qué orden corregirlos |
| Planificador | Arma las correcciones con operaciones permitidas | Explica por qué cada cambio corrige el riesgo y cómo se verifica |

Un **controlador seguro** solo aplica operaciones de una lista permitida. Antes de aplicar exige aprobación humana y guarda un respaldo. Después verifica con pruebas de conectividad y revierte si alguna falla.

## Arquitectura

```
Usuario ─► React (Vite) ─► Django REST ─┬─► PostgreSQL
                                        ├─► Coordinador ──crea Jobs──► Kubernetes (k3d)
                                        │      ▲                        ├─ phantom-agents: recolector ─► (analista ‖ auditor) ─► planificador
                                        │      └─ API de agentes ◄──────┤     (un pod por agente; RBAC mínimo; NetworkPolicy default-deny)
                                        │         172.18.0.1:8001       └─ phantom-ai: Ollama (mistral, CPU) ◄── solo el planificador
                                        └─► Controlador seguro ─┬─► kubectl ─► namespace phantom-demo (app auditada)
                                                                └─► SSH forzado ─► FreeBSD /usr/local/sbin/phantom-pf ─► PF anchor "phantom"
```

### Dónde corre cada cosa

| Pieza | Dónde | Por qué |
|---|---|---|
| Agentes (4) | **Jobs de Kubernetes** en `phantom-agents`, uno por agente y por auditoría | Kubernetes los programa, los reintenta si caen (`backoffLimit: 1`), los mata si se pasan de tiempo y los borra a los 10 min |
| IA (Ollama + mistral) | **Deployment** en `phantom-ai`, siempre encendido | El modelo queda cargado en memoria; solo los agentes pueden hablarle |
| Coordinador, controlador, API, BD, panel | Docker Compose en el host | Vigilan y corrigen el clúster desde fuera: si el clúster falla, el que lo vigila sigue vivo |
| App auditada | `phantom-demo` en Kubernetes | Estado inseguro deliberado |

Aislamiento de los agentes (`infra/k8s/agents.yaml`):

| Agente | Permisos en Kubernetes | Puede hablar con |
|---|---|---|
| Recolector | leer pods, services, endpoints, events, networkpolicies, deployments y nodes; `exec` para pruebas | API de agentes, Ollama, API de Kubernetes, firewall (22, 80, 443, 8081) |
| Analista, auditor, planificador | ninguno (sin token) | API de agentes, Ollama |

Todos los agentes pueden hablar con Ollama; el recolector además con Kubernetes y el firewall.

Ningún agente puede cambiar nada. La API de agentes solo escucha en la red de k3d, solo sirve `/api/agent/…` y cada auditoría tiene un token efímero que deja de valer al terminar. La llave del firewall de los agentes (`phantom_ro_ed25519`) solo admite consultas; la de escritura la tiene únicamente el controlador.

**Interruptor de la IA.** Por defecto los agentes usan la Ollama del clúster (CPU, ~70 s por respuesta; una auditoría completa tarda ~7-8 min). Para usar la del host (GPU), cambia `PHANTOM_AGENT_OLLAMA_URL=http://172.18.0.1:11434` en `.env`, pon `OLLAMA_HOST=0.0.0.0` en el servicio systemd de Ollama del host y permite egress a `172.18.0.1/32:11434` en `allow-ollama` (`infra/k8s/agents.yaml`).

| Componente | Ubicación |
|---|---|
| Adaptadores Kubernetes / PF | `backend/core/adapters/` |
| Agentes: trabajo de cada rol, coordinador, orquestador de Jobs, entrypoint del pod | `backend/core/agents/` (`roles.py`, `coordinator.py`, `orchestrator.py`, `runner.py`) |
| API de agentes (solo para los pods) | `backend/core/agent_api.py`, `backend/phantom/agent_urls.py` |
| Agentes e IA en Kubernetes | `infra/k8s/agents.yaml`, `infra/k8s/ollama.yaml`, `infra/docker/ollama.Dockerfile` |
| Controlador seguro (lista permitida, respaldo, verificación, reversión) | `backend/core/controller.py` |
| Pruebas de conectividad | `backend/core/connectivity.py` |
| API REST | `backend/core/views.py`, `backend/core/urls.py` |
| Panel web | `frontend/src/` |
| App de laboratorio (estado inseguro deliberado) | `infra/k8s/demo-app.yaml` |
| Firewall: pf.conf, canal restringido, instalación | `infra/freebsd/` |

### Operaciones permitidas del controlador

| Operación | Efecto | Verificación |
|---|---|---|
| `k8s_apply_segmentation` | default-deny más frontend→api:8080 y api→db:5432. Elimina la política allow-all. | `fe-api` ✓, `api-db` ✓, `fe-db` bloqueado |
| `k8s_service_to_clusterip` | Retira el NodePort de la base de datos. | `api-db` ✓ |
| `pf_block_port` | `block return in log quick proto tcp to port N` en el anchor `phantom`. | puerto N bloqueado, 80/443 abiertos |

Los puertos 22 y los autorizados (`PHANTOM_PF_ALLOWED_PORTS`) no se pueden bloquear. El firewall solo acepta los comandos de `phantom-pf` aunque se le envíe otro: la llave del controlador tiene un `command=` forzado en `authorized_keys`.

## Ruta del tráfico

```
Internet ──► FreeBSD PF :80/:443 ──rdr+nat──► host Linux :30080 (entrada k3d) ──► Service Web ──► API ──► Datos
Red del lab ──────────────────────────────► host :30082 (solo si la BD queda como NodePort: se salta el firewall)
```

El firewall es la puerta de entrada de la aplicación (`infra/freebsd/pf.conf`). El 8081 es un servicio innecesario en el propio firewall, y es el riesgo perimetral de la demo.

## Secciones del panel

- **Orquestación en vivo:** se actualiza cada 2 s. Muestra el host Docker, los contenedores que hacen de nodos k3d y los pods dentro de cada nodo, con CPU y RAM de metrics-server y los eventos del clúster. Un operador puede escalar un deployment (de 0 a 5 réplicas) o eliminar un pod para mostrar cómo Kubernetes lo recrea. Ambas acciones quedan en el registro.
- **Orquestación en vivo, zona "Agentes IA":** una tarjeta por agente con el estado de su pod (dormido, naciendo, trabajando, terminó, cayó) y el nodo donde Kubernetes lo programó, más la IA. Los pods de los agentes aparecen dentro de cada nodo.
- **Sala de agentes:** cada mensaje sale del pod de su agente. El coordinador narra lo que hace Kubernetes (crea el Job, lo programa en un nodo, el pod cae y se reintenta). La explicación del modelo local se escribe en streaming.
- **Simular la caída de un agente** (solo operadores, bajo "Iniciar auditoría"): el primer pod del agente elegido falla a propósito y Kubernetes lo levanta otra vez; la Sala marca el intento fallido.
- **Registro:** diagrama entidad-relación generado del esquema real (tablas, columnas, llaves y relaciones). Al tocar una tabla se consultan sus registros con búsqueda y filtros. Es de solo lectura y no expone contraseñas ni tokens.
- Panel general, Topología (vistas Aplicación y Agentes y gestión, con el estado en vivo de cada pod de agente), Conectividad, Auditorías y Propuestas.

El backend lee Docker a través de `docker-socket-proxy`, que solo permite `GET /containers`. Nunca recibe el socket de Docker, porque eso equivale a tener root en el host.

## Puesta en marcha

Requisitos: Docker Engine (usuario en el grupo `docker`), una VM FreeBSD alcanzable por SSH, Python 3.12+, Node 18+ y Ollama con `mistral` (opcional).

```bash
make cluster          # k3d con 2 nodos
make demo             # app frontend/api/db en estado inseguro
make freebsd-setup    # PF + servicios de prueba (80, 443, 8081) + canal restringido
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
make backend          # http://127.0.0.1:8000  (otra terminal)
make frontend         # http://127.0.0.1:5173
```

Usuarios de demostración (se crean con `seed_users`):

| Usuario | Contraseña | Rol |
|---|---|---|
| `admin` | `phantom-admin` | operador: aprueba y ejecuta |
| `observador` | `phantom-viewer` | solo consulta |

Para producción de laboratorio con PostgreSQL: `cp .env.example .env`, ajusta los valores y corre **`make up`**. El panel queda en http://localhost:8088.

`make up` (`bin/phantom-up`) revisa y repara en orden: módulos y red de VMware, VM FreeBSD, clúster k3d, DNS del clúster, sincronización de NetworkPolicy, imágenes de agentes e IA (sin descargar nada: Ollama se construye desde el binario del host y el modelo se copia al nodo), manifiestos, Docker Compose y una prueba por el firewall. Solo pide sudo si VMware necesita arreglo. Para que VMware no falle tras actualizar el kernel: `sudo infra/host/vmware-autofix.sh` (una vez).

## Guion de la demostración (sección 9 de la propuesta)

1. **Panel:** db expuesta como NodePort, política `allow-all` y PF con el puerto 8081 abierto.
2. **Conectividad, Ejecutar pruebas:** `fe-db` es alcanzable (✗) y `8081` es alcanzable (✗).
3. **Iniciar auditoría** con **Orquestación en vivo** abierta: Kubernetes crea el pod del recolector, luego los del analista y el auditor a la vez, y al final el del planificador. Hallazgos `SEC-K8S-002`, `SEC-K8S-004`, `SEC-PF-002` y `SEC-NET-001`, con 3 propuestas.
   - Opcional: **Simular la caída del auditor** para ver a Kubernetes reintentar el pod.
4. En cada propuesta: revisar la vista previa y la explicación, **Aprobar** y luego **Ejecutar**. Se muestran las pruebas antes y después.
5. **Topología:** los flujos prohibidos aparecen bloqueados y los legítimos en verde.
6. **Registro:** quién aprobó y ejecutó qué, cuándo y con qué resultado.
7. Opcional: **Revertir** una propuesta para mostrar la reversión.

Para repetir la demo: `make demo-reset pf-reset`.

## Pruebas

```bash
make test
```

## Fuera de alcance (v1)

No incluye detección universal de ataques, IDS/IPS, SIEM, producción, multi-nube ni ejecución de comandos arbitrarios por la IA (ver la sección 5.2 de la propuesta).
