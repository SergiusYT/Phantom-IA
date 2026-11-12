# PHANTOM AI

Plataforma multiagente para la orquestación inteligente y la seguridad de redes (proyecto de Redes II).

PHANTOM recolecta el estado de un clúster Kubernetes y de un firewall FreeBSD/PF. Tres agentes lo analizan:

- **Analista:** revisa el estado operativo.
- **Auditor:** detecta riesgos con reglas deterministas.
- **Planificador:** propone correcciones y las explica con un LLM local.

Un **controlador seguro** solo aplica operaciones de una lista permitida. Antes de aplicar exige aprobación humana y guarda un respaldo. Después verifica con pruebas de conectividad y revierte si alguna falla.

## Arquitectura

```
Usuario ─► React (Vite) ─► Django REST ─┬─► PostgreSQL / SQLite
                                        ├─► Coordinador ─► Analista · Auditor · Planificador ─► Ollama (mistral)
                                        └─► Controlador seguro ─┬─► kubectl ─► k3d (k3s) · namespace phantom-demo
                                                                └─► SSH forzado ─► FreeBSD /usr/local/sbin/phantom-pf ─► PF anchor "phantom"
```

| Componente | Ubicación |
|---|---|
| Adaptadores Kubernetes / PF | `backend/core/adapters/` |
| Agentes y coordinador | `backend/core/agents/` |
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
- **Sala de agentes:** la auditoría corre en segundo plano y cada paso real se publica como un mensaje entre coordinador, recolector, analista, auditor y planificador. La explicación del modelo local se escribe en streaming.
- **Registro:** diagrama entidad-relación generado del esquema real (tablas, columnas, llaves y relaciones). Al tocar una tabla se consultan sus registros con búsqueda y filtros. Es de solo lectura y no expone contraseñas ni tokens.
- Panel general, Topología (vistas Aplicación y Gestión PHANTOM), Conectividad, Auditorías y Propuestas.

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

Para producción de laboratorio con PostgreSQL: `cp .env.example .env`, ajusta los valores y corre `make compose-up`. El panel queda en http://localhost:8088.

## Guion de la demostración (sección 9 de la propuesta)

1. **Panel:** db expuesta como NodePort, política `allow-all` y PF con el puerto 8081 abierto.
2. **Conectividad, Ejecutar pruebas:** `fe-db` es alcanzable (✗) y `8081` es alcanzable (✗).
3. **Iniciar auditoría:** hallazgos `SEC-K8S-002`, `SEC-K8S-004`, `SEC-PF-002` y `SEC-NET-001`, con 3 propuestas.
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
