# Graph Report - Phantom AI  (2026-11-12)

## Corpus Check
- Corpus is ~25,154 words - fits in a single context window. You may not need a graph.

## Summary
- 608 nodes · 1270 edges · 34 communities (24 shown, 10 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 69 edges (avg confidence: 0.93)
- Token cost: 46,492 input · 0 output

## Community Hubs (Navigation)
- Frontend React UI
- Agentes IA
- Adaptador PF FreeBSD
- Docker Compose
- Comandos de gestión
- Adaptador Kubernetes
- Dependencias backend
- Propuestas y aprobación
- Docker y LLM
- Dependencias frontend
- Insights y esquema BD
- Vistas y permisos
- Manifiestos K8s
- Modelos y serializers
- Registro de eventos
- Service frontend
- Auditorías
- Demo app
- Specs de despliegue
- Grafo de agentes
- Contenedores
- NetworkPolicy
- Hallazgos
- Config app Django
- Service api
- Setup FreeBSD
- Proxy Docker
- Registro ER

## God Nodes (most connected - your core abstractions)
1. `Ico()` - 29 edges
2. `api()` - 25 edges
3. `_run()` - 24 edges
4. `Audit` - 23 edges
5. `Proposal` - 21 edges
6. `Consola()` - 18 edges
7. `react` - 16 edges
8. `useLoad()` - 16 edges
9. `Finding` - 15 edges
10. `kubectl()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Django REST API` --references--> `Django`  [INFERRED]
  README.md → backend/requirements.txt
- `Django REST API` --references--> `django-cors-headers`  [INFERRED]
  README.md → backend/requirements.txt
- `Django REST API` --references--> `Django REST Framework`  [INFERRED]
  README.md → backend/requirements.txt
- `Django REST API` --references--> `gunicorn`  [INFERRED]
  README.md → backend/requirements.txt
- `Django REST API` --references--> `psycopg`  [INFERRED]
  README.md → backend/requirements.txt

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Pipeline multiagente** — readme_coordinador, readme_analista, readme_auditor, readme_planificador [EXTRACTED 1.00]
- **Operaciones permitidas** — readme_k8s_apply_segmentation, readme_k8s_service_to_clusterip, readme_pf_block_port [EXTRACTED 1.00]

## Communities (34 total, 10 thin omitted)

### Community 0 - "Frontend React UI"
Cohesion: 0.06
Nodes (97): Acceso(), ARRANQUE, api(), auth, App(), Auditoria(), Conectividad(), Consola() (+89 more)

### Community 1 - "Agentes IA"
Cohesion: 0.06
Nodes (26): blocked_by_anchor(), analyze(), _f(), summarize(), audit(), audit_k8s(), audit_pf(), _f() (+18 more)

### Community 2 - "Adaptador PF FreeBSD"
Cohesion: 0.09
Nodes (33): call(), collect(), parse_nat(), parse_rules(), PFError, _ports(), tcp_probe(), execute() (+25 more)

### Community 3 - "Docker Compose"
Cohesion: 0.05
Nodes (42): docker-proxy, phantom-db, condition, environment, image, ports, volumes, CONTAINERS (+34 more)

### Community 4 - "Comandos de gestión"
Cohesion: 0.06
Nodes (5): Command, Command, AuditMessage, Meta, main()

### Community 5 - "Adaptador Kubernetes"
Cohesion: 0.14
Nodes (22): apply_manifest(), _check_manifest(), cluster_info(), collect(), delete_pod(), delete_resource(), dry_run(), _env() (+14 more)

### Community 6 - "Dependencias backend"
Cohesion: 0.08
Nodes (25): Django, django-cors-headers, Django REST Framework, gunicorn, psycopg, PyYAML, requests, index.html root (main.jsx) (+17 more)

### Community 7 - "Propuestas y aprobación"
Cohesion: 0.16
Nodes (20): Proposal, Meta, Status, record(), ProposalSerializer, Meta, approve(), audit_messages() (+12 more)

### Community 8 - "Docker y LLM"
Cohesion: 0.12
Nodes (9): containers(), DockerError, _role(), available(), explain(), explain_stream(), Migration, Migration (+1 more)

### Community 9 - "Dependencias frontend"
Cohesion: 0.11
Nodes (19): dependencies, react@18.3.1, react-dom@18.3.1, simple-icons@^13.21.0, devDependencies, vite@5.4.11, @vitejs/plugin-react@4.3.4, name (+11 more)

### Community 10 - "Insights y esquema BD"
Cohesion: 0.14
Nodes (13): audits_summary(), schema(), _score(), stats(), table(), tables(), _u(), _valor() (+5 more)

### Community 11 - "Vistas y permisos"
Cohesion: 0.15
Nodes (8): AuditEventSerializer, Meta, EventList, is_operator(), IsOperator, me(), start_audit(), _user_payload()

### Community 12 - "Manifiestos K8s"
Cohesion: 0.16
Nodes (17): metadata, metadata, apiVersion, kind, metadata, Deployment frontend, Service db, app (+9 more)

### Community 13 - "Modelos y serializers"
Cohesion: 0.17
Nodes (10): ConnectivityRun, Meta, Execution, Meta, Severity, ConnectivityRunSerializer, Meta, ExecutionSerializer (+2 more)

### Community 14 - "Registro de eventos"
Cohesion: 0.17
Nodes (3): AuditEventAdmin, AuditEvent, Meta

### Community 15 - "Service frontend"
Cohesion: 0.18
Nodes (13): Service frontend, name, nodePort, port, targetPort, spec, spec, apiVersion (+5 more)

### Community 16 - "Auditorías"
Cohesion: 0.24
Nodes (10): Audit, Meta, Status, AuditDetailSerializer, Meta, AuditListSerializer, Meta, AuditDetail (+2 more)

### Community 17 - "Demo app"
Cohesion: 0.18
Nodes (10): apiVersion, kind, apiVersion, kind, Namespace phantom-demo, Deployment api, Deployment db, apiVersion (+2 more)

### Community 18 - "Specs de despliegue"
Cohesion: 0.33
Nodes (9): spec, spec, spec, app, app, matchLabels, replicas, selector (+1 more)

### Community 19 - "Grafo de agentes"
Cohesion: 0.36
Nodes (7): aristaDe(), ARISTAS, curva(), Globo(), GrafoAgentes(), N, SISTEMA

### Community 20 - "Contenedores"
Cohesion: 0.25
Nodes (8): command, env, image, name, ports, resources, containers, spec

### Community 21 - "NetworkPolicy"
Cohesion: 0.25
Nodes (8): NetworkPolicy allow-all, apiVersion, kind, metadata, spec, ingress, podSelector, policyTypes

### Community 22 - "Hallazgos"
Cohesion: 0.33
Nodes (6): Finding, Agent, Meta, FindingSerializer, Meta, FindingList

### Community 26 - "Service api"
Cohesion: 0.50
Nodes (4): Service api, apiVersion, kind, metadata

## Knowledge Gaps
- **19 isolated node(s):** `Agente Analista`, `Agente Auditor`, `Firewall FreeBSD PF`, `Ollama mistral (LLM local)`, `k8s_apply_segmentation` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 230 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `_run()` connect `Agentes IA` to `Adaptador PF FreeBSD`, `Adaptador Kubernetes`, `Propuestas y aprobación`, `Docker y LLM`, `Auditorías`, `Hallazgos`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `_run()` (e.g. with `.end_stream()` and `.say()`) actually correct?**
  _`_run()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Agente Analista`, `Agente Auditor`, `Firewall FreeBSD PF` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Frontend React UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05678893178893179 - nodes in this community are weakly interconnected._
- **Why does `Audit` connect `Auditorías` to `Agentes IA`, `Comandos de gestión`, `Propuestas y aprobación`, `Insights y esquema BD`, `Vistas y permisos`, `Modelos y serializers`, `Registro de eventos`, `Hallazgos`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 13 inferred relationships involving `Audit` (e.g. with `_run()` and `run_audit()`) actually correct?**
  _`Audit` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Should `Agentes IA` be split into smaller, more focused modules?**
  _Cohesion score 0.06019871420222092 - nodes in this community are weakly interconnected._