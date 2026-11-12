# Agentes PHANTOM orquestados por Kubernetes — diseño

Fecha: 2026-11-12 · Estado: listo para aprobación (revisado)

## 1. Intención (el porqué)

PHANTOM AI es una plataforma multiagente que audita y corrige la red (Kubernetes + firewall FreeBSD PF).
Hoy los 4 agentes (recolector, analista, auditor, planificador) son funciones Python que
`backend/core/agents/coordinator.py` ejecuta en un hilo dentro del contenedor del backend, y Ollama corre
como servicio nativo del host. Kubernetes solo aloja la app auditada (`phantom-demo`).

Eso le quita la gracia al proyecto: el profesor debe ver **cómo Kubernetes orquesta a las IA** que cuidan
la red — cómo las programa, arranca, aísla, reintenta y coordina — y verlo en vivo en las vistas
**Orquestación** y **Topología** del panel, durante una auditoría.

Éxito = el operador pulsa "Auditar" y en pantalla se ve a Kubernetes crear un pod por agente, con su ciclo
de vida (Pending → Running → Completed/Failed), en el orden y paralelismo correctos; la Sala de agentes
muestra la conversación que esos pods producen; y la Topología muestra dónde viven los agentes y la IA y
con qué hablan.

## 2. Objetivos

1. Cada agente se ejecuta como un **Kubernetes Job** bajo demanda, en el namespace `phantom-agents`.
2. Orden: `recolector` → (`analista` ‖ `auditor` en paralelo) → `planificador`.
3. **Ollama corre dentro de Kubernetes** (Deployment + Service `ollama` en el namespace `phantom-ai`),
   con el modelo `mistral` ya presente en el host copiado al nodo (sin volver a descargarlo).
4. **Interruptor de respaldo** en `.env` para que los agentes usen la Ollama del host (GPU) en lugar de la
   del cluster, sin tocar código.
5. **Seguridad de los agentes** (encaja con Redes II):
   - RBAC mínimo: ServiceAccount por rol. El recolector solo **lee** `phantom-demo` (pods, services,
     endpoints, networkpolicies, deployments) y puede hacer `pods/exec` solo para las pruebas de
     conectividad internas. Analista, auditor y planificador no tienen permisos sobre la API de Kubernetes.
   - Ningún agente modifica nada: los cambios siguen pasando por el controlador seguro del backend, con
     aprobación humana, backup, verificación y rollback (sin cambios en ese flujo).
   - NetworkPolicy en `phantom-agents`: default-deny + permitir solo DNS, la API de PHANTOM, el Service
     `ollama`, la API de Kubernetes (solo recolector), el firewall `172.16.97.132:22` y los NodePorts para
     pruebas de perímetro (solo recolector).
   - NetworkPolicy en `phantom-ai`: Ollama solo acepta tráfico desde `phantom-agents`.
6. **Visibilidad en vivo**:
   - Orquestación: nueva sección/zona "Agentes IA" que muestra Jobs y pods de `phantom-agents` y el pod de
     Ollama, con fase, nodo, duración, reintentos; se resalta la etapa activa de la auditoría.
   - Topología: zona/grupo "Agentes IA" y "IA (Ollama)" dentro de Kubernetes, con flechas a la app auditada
     (lectura), al firewall (SSH restringido), a Ollama y a la API de PHANTOM.
   - Sala de agentes: igual que hoy (burbujas + chat), pero los mensajes los publica el pod de cada agente.
7. Reintentos visibles: `backoffLimit` > 0; si un pod falla y Kubernetes lo reintenta, se ve en Orquestación
   y la Sala lo menciona.
8. **Botón "Simular fallo"** (decisión del usuario): en una auditoría el operador puede marcar un agente
   para que su primer intento falle a propósito. Kubernetes lo reintenta y en Orquestación se ve el pod
   fallido y el nuevo; la Sala lo narra ("el auditor cayó, Kubernetes lo reinició"). El fallo se inyecta solo
   en el primer intento; el reintento termina bien. Solo operadores, no observadores.
9. `make up` (`bin/phantom-up`) deja todo listo: construye la imagen de agentes, la importa a k3d, aplica
   manifiestos de `phantom-agents`/`phantom-ai`, asegura el modelo en el nodo y espera a Ollama.

## 3. No-objetivos

- GPU dentro de k3d (requiere rearmar el cluster con runtime NVIDIA; demasiado riesgo).
- Mover el backend, la base de datos o el frontend de PHANTOM a Kubernetes. Siguen en Docker Compose.
- Mover el coordinador a un pod. El coordinador sigue en el backend (decisión del diseñador, ver §5).
- Autoescalado de agentes (KEDA, HPA). Los Jobs se crean por auditoría.
- Cambiar las reglas del analista/auditor/planificador ni el contenido de los hallazgos/propuestas.

## 4. Anti-objetivos (fracaso aunque "funcione")

- **Fallback silencioso** a ejecutar los agentes en el proceso del backend cuando Kubernetes falla. Si los
  Jobs no pueden correr, la auditoría falla con un mensaje claro en la Sala. (El modo en-proceso solo existe
  para las pruebas unitarias, activado explícitamente.)
- Pods que la UI no muestra, o que aparecen y desaparecen tan rápido que no se ven. Los Jobs terminados se
  conservan al menos ~10 min (`ttlSecondsAfterFinished`) y la UI los sigue mostrando.
- Dar a los agentes credenciales de escritura sobre el cluster o el firewall, o el kubeconfig de admin.
- Exponer la API de PHANTOM a la red del laboratorio o a Internet para que los pods la alcancen.
- Volver a descargar el modelo (~4 GB) por la red del usuario (a menudo un hotspot de celular).
- Que la demo de auditoría se vuelva notablemente más lenta por culpa de la orquestación (arranque de pods).
  Los mensajes deben seguir fluyendo; la explicación del LLM puede tardar más en CPU (aceptado).

## 5. Decisiones tomadas

Del usuario:
- Agentes orquestados por Kubernetes, activados bajo demanda, visibles en Orquestación y Topología.
- Ollama dentro de Kubernetes, con interruptor en `.env` para volver a la Ollama del host.

Del diseñador (Claude), aceptadas por el usuario al aprobar el enfoque:
- Un Job por agente y por auditoría, namespace `phantom-agents`; Ollama en `phantom-ai`.
- Coordinador en el backend: recibe "Auditar", crea los Jobs (con el kubeconfig que el backend ya monta),
  espera sus resultados y persiste hallazgos/propuestas. Kubernetes programa, aísla, reintenta.
- Analista y auditor en paralelo.
- El modelo se copia desde el host al nodo k3d y se monta como `hostPath` (sin descarga).
- **Llave de solo lectura para el firewall**: la llave actual `phantom_ed25519` permite operaciones de
  escritura (`block-port`, `unblock-port`, `restore`, `reset-lab`), así que no se monta en ningún pod. Se crea
  una segunda llave `phantom_ro_ed25519` cuyo forced command en la VM solo admite operaciones de lectura
  (`status rules anchor nat listening logs`). Se provisiona en la VM actualizando `infra/freebsd/phantom-pf`,
  `authorized_keys` y `infra/freebsd/setup.sh` (vía la llave admin `~/.ssh/id_ed25519`). El backend conserva
  la llave de escritura para el controlador.
- **Imagen de Ollama construida localmente** a partir del binario de Ollama del host (0.13.5, solo CPU), no
  la imagen oficial `ollama/ollama` (varios GB por CUDA; no está en caché; red del usuario limitada). Misma
  versión que generó los blobs del modelo.
- **Fallos parciales**: el recolector con datos parciales (falla solo k8s o solo PF) es un Job exitoso con
  errores registrados, como hoy. Si cualquier agente agota su `backoffLimit`, la auditoría termina
  `FAILED` con mensaje claro en la Sala; no se guardan resultados parciales de otros agentes de esa etapa.
  Un reintento rehace el trabajo del agente desde cero; los mensajes del intento fallido quedan en la Sala
  marcados como "intento fallido". La API de agentes ignora entregas de resultado duplicadas (idempotente
  por auditoría + rol).
- **Presupuesto de tiempo**: la orquestación no debe sumar más de ~15 s a la auditoría actual, sin contar la
  generación del LLM. Para lograrlo: Ollama queda con el modelo cargado permanentemente (`keep_alive` -1 y
  precarga al arrancar), la imagen `phantom-agent` ya importada en k3d (`imagePullPolicy: Never`).
- **RBAC del recolector** se amplía con lectura de `events` en `phantom-demo` y un ClusterRole de solo
  lectura sobre `nodes` (los usa `k8s.collect()`/`analyst.py`; los hallazgos no deben cambiar).

## 6. Restricciones del entorno

- Cluster k3d `phantom` (1 server + 1 agent) ya existe y tiene la app `phantom-demo`. **No** recrearlo
  (rompería NodePorts 30080/30082 y la ruta PF → host → k3d). Por eso no se pueden añadir volúmenes de k3d
  al crear el cluster: el modelo se lleva al nodo con `docker cp` (o equivalente) a una ruta del contenedor
  del nodo, y Ollama lo monta con `hostPath` + `nodeSelector`/afinidad a ese nodo.
- Modelo en el host: Ollama corre como servicio systemd; sus modelos están en el directorio de datos del
  usuario `ollama` (típicamente `/usr/share/ollama/.ollama/models`). Puede requerir sudo para leerlo; el
  script debe pedirlo explícitamente o indicar el comando.
- Ollama del host escucha en `127.0.0.1:11434`. Para el modo respaldo, los pods no pueden alcanzar
  `127.0.0.1` del host: hace falta que Ollama del host escuche también en la IP de la red docker de k3d
  (override systemd `OLLAMA_HOST`, requiere sudo una vez) o un relé. Documentarlo; no es parte del camino
  por defecto.
- El backend corre con `network_mode: host` y gunicorn en `127.0.0.1:8000`. Los pods deben alcanzar la API
  de PHANTOM **sin** exponerla a la LAN: escuchar además solo en la IP del gateway de la red docker de k3d
  (alcanzable desde los pods como `host.k3d.internal`), o un mecanismo equivalente.
- Docker nativo vía `bin/phx` (no Docker Desktop). Imágenes se cargan con `k3d image import`.
- Las pruebas de perímetro hoy salen del host hacia `172.16.97.132`; desde un pod saldrán con NAT del host,
  equivalente a efectos de la prueba. Validar que el pod alcance `172.16.97.132:22/80/443/8081`.
- Pacing de mensajes (`PAUSA`) y streaming del LLM deben seguir funcionando igual en la Sala.
- Las 11 pruebas unitarias actuales del backend deben seguir pasando.

## 7. Interfaces clave (forma, no detalle)

- **Imagen `phantom-agent`**: misma base de código de agentes (`backend/core/agents`, `connectivity`,
  adaptadores de lectura), sin Django ORM ni acceso a la base. Entrada: rol + id de auditoría + URL de la API
  + token. Lee su entrada de la API, publica mensajes (incluido streaming del LLM) y entrega su salida a la API.
- **API de agentes** en el backend (nueva, autenticada con un token de agente acotado a la auditoría en
  curso; no puede aprobar, ejecutar ni leer otras auditorías): obtener entrada, publicar mensaje,
  actualizar mensaje en streaming, entregar resultado.
- **Coordinador**: crea Jobs con etiquetas `phantom/audit=<id>`, `phantom/agent=<rol>`; observa su estado;
  publica en la Sala los eventos de orquestación (p. ej. "Kubernetes programó al auditor en agent-0").
- **Secret** con la llave de solo lectura del firewall (`phantom_ro_ed25519`) montado solo en el recolector.
- **Simular fallo**: parámetro opcional al iniciar la auditoría (`fail_agent=<rol>`); el coordinador lo pasa
  al Job y el agente falla (exit ≠ 0) solo si es su primer intento.
- **`/api/orchestration/`** amplía su respuesta con `phantom-agents` y `phantom-ai`.

## 8. Queda a criterio del constructor

- Nombres exactos de recursos, estructura de manifiestos (`infra/k8s/agents.yaml`, `infra/k8s/ollama.yaml`).
- Cómo se pasa el token al Job (Secret efímero por auditoría vs. env) mientras cumpla los anti-objetivos.
- Mecanismo exacto para que los pods alcancen la API (bind adicional, proxy) mientras no se exponga a la LAN.
- Recursos (`requests/limits`) y `activeDeadlineSeconds` de cada Job; `backoffLimit` (sugerido 1–2).
- Diseño visual de la zona "Agentes IA" en Orquestación y Topología, siguiendo el estilo actual
  (tema verde, logos simple-icons, poco texto técnico, entendible por no expertos).
- Estrategia de pruebas (unitarias con modo en-proceso explícito + verificación de punta a punta con k3d).
