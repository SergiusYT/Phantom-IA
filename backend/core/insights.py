"""Estadisticas para las graficas del panel y explorador de solo lectura de la base de datos."""
from django.contrib.auth.models import User
from django.db.models import Count, Q

from .models import AgentRun, Audit, AuditEvent, AuditMessage, ConnectivityRun, Execution, Finding, Proposal

PESO = {"critical": 25, "high": 12, "medium": 5, "low": 2, "info": 0}
SEVS = ["critical", "high", "medium", "low"]


def _score(counts):
    return max(0, 100 - sum(PESO[s] * n for s, n in counts.items()))


def audits_summary(limit=30):
    audits = list(Audit.objects.filter(status=Audit.Status.DONE).order_by("-created_at")[:limit])
    ids = [a.id for a in audits]
    sev = {}
    for r in Finding.objects.filter(audit_id__in=ids).values("audit_id", "severity").annotate(n=Count("id")):
        sev.setdefault(r["audit_id"], {})[r["severity"]] = r["n"]
    props = {}
    for r in Proposal.objects.filter(audit_id__in=ids).values("audit_id", "status").annotate(n=Count("id")):
        props.setdefault(r["audit_id"], {})[r["status"]] = r["n"]
    out = []
    for a in reversed(audits):
        c = {s: sev.get(a.id, {}).get(s, 0) for s in SEVS}
        out.append({
            "id": a.id, "time": a.created_at, "by": a.requested_by.username if a.requested_by else "sistema",
            "score": _score(c), "severity": c, "findings": sum(c.values()), "proposals": props.get(a.id, {}),
            "duration_s": int((a.finished_at - a.created_at).total_seconds()) if a.finished_at else None,
            "errors": len(a.errors or []),
        })
    return out


def stats():
    runs = list(ConnectivityRun.objects.order_by("-created_at")[:20])
    ex = Execution.objects.filter(kind="apply")
    return {
        "audits": audits_summary(),
        "connectivity": [{"time": r.created_at, "ok": sum(1 for t in r.results if t["ok"]), "total": len(r.results)}
                         for r in reversed(runs)],
        "proposals": dict(Proposal.objects.values_list("status").annotate(n=Count("id"))),
        "executions": {"total": ex.count(), "verified": ex.filter(verified=True).count(),
                       "rolled_back": Execution.objects.filter(kind="rollback", success=True).count()},
        "activity": list(AuditEvent.objects.values("action").annotate(n=Count("id")).order_by("-n")),
    }


# ---------- explorador de base de datos (lista blanca, solo lectura) ----------

def _u(o, f):
    v = getattr(o, f)
    return v.username if v else None


TABLAS = {
    "usuarios": {"model": User, "nombre": "Usuarios", "desc": "Quién puede entrar (sin contraseñas)",
                 "cols": [("id", "N.º", "num"), ("username", "Usuario", "mono"), ("is_superuser", "Operador", "bool"),
                          ("last_login", "Último acceso", "fecha"), ("date_joined", "Creado", "fecha")],
                 "filtros": ["is_superuser"], "buscar": ["username"]},
    "eventos": {"model": AuditEvent, "nombre": "Registro de actividad", "desc": "Cada acción hecha en la plataforma",
                "cols": [("created_at", "Fecha", "fecha"), ("user", "Usuario", "user"), ("action", "Acción", "accion"),
                         ("target", "Objetivo", "texto"), ("success", "Resultado", "bool")],
                "filtros": ["action", "user__username", "success"], "buscar": ["target", "action"]},
    "auditorias": {"model": Audit, "nombre": "Auditorías", "desc": "Revisiones hechas por los agentes",
                   "cols": [("id", "N.º", "num"), ("created_at", "Inicio", "fecha"), ("requested_by", "Solicitada por", "user"),
                            ("status", "Estado", "estado"), ("finished_at", "Fin", "fecha")],
                   "filtros": ["status", "requested_by__username"], "buscar": ["analyst_summary"]},
    "hallazgos": {"model": Finding, "nombre": "Hallazgos", "desc": "Riesgos y fallos detectados",
                  "cols": [("audit_id", "Auditoría", "num"), ("severity", "Severidad", "sev"), ("title", "Hallazgo", "texto"),
                           ("agent", "Agente", "agente"), ("rule_id", "Regla", "mono")],
                  "filtros": ["severity", "agent", "rule_id"], "buscar": ["title", "description", "component"]},
    "propuestas": {"model": Proposal, "nombre": "Propuestas", "desc": "Cambios sugeridos y su decisión",
                   "cols": [("id", "N.º", "num"), ("title", "Propuesta", "texto"), ("operation", "Operación", "mono"),
                            ("status", "Estado", "estado"), ("decided_by", "Decidida por", "user"), ("created_at", "Fecha", "fecha")],
                   "filtros": ["status", "operation"], "buscar": ["title", "justification"]},
    "ejecuciones": {"model": Execution, "nombre": "Ejecuciones", "desc": "Cambios aplicados o revertidos",
                    "cols": [("proposal_id", "Propuesta", "num"), ("kind", "Tipo", "tipo"), ("success", "Éxito", "bool"),
                             ("verified", "Verificada", "bool"), ("executed_by", "Por", "user"), ("started_at", "Fecha", "fecha")],
                    "filtros": ["kind", "success", "verified"], "buscar": ["output"]},
    "pruebas": {"model": ConnectivityRun, "nombre": "Pruebas de red", "desc": "Resultados de conectividad",
                "cols": [("id", "N.º", "num"), ("created_at", "Fecha", "fecha"), ("requested_by", "Por", "user"), ("passed", "Cumple", "bool")],
                "filtros": ["passed"], "buscar": []},
    "agentes": {"model": AgentRun, "nombre": "Agentes (pods)", "desc": "Cada agente que Kubernetes ejecutó en una auditoría",
                "cols": [("audit_id", "Auditoría", "num"), ("role", "Agente", "agente"), ("status", "Estado", "estado"),
                         ("attempts", "Intentos", "num"), ("job_name", "Job de Kubernetes", "mono"), ("started_at", "Inicio", "fecha")],
                "filtros": ["role", "status", "audit_id"], "buscar": ["job_name"]},
    "mensajes": {"model": AuditMessage, "nombre": "Mensajes de agentes", "desc": "La conversación de cada auditoría",
                 "cols": [("audit_id", "Auditoría", "num"), ("seq", "N.º", "num"), ("agent", "Agente", "agente"),
                          ("kind", "Tipo", "tipo"), ("text", "Mensaje", "texto")],
                 "filtros": ["agent", "kind", "audit_id"], "buscar": ["text"]},
}


def tables():
    return [{"id": k, "nombre": t["nombre"], "desc": t["desc"], "total": t["model"].objects.count()} for k, t in TABLAS.items()]


def _valor(o, campo, tipo):
    if tipo == "user":
        return _u(o, campo)
    v = getattr(o, campo)
    if tipo == "texto" and isinstance(v, str) and len(v) > 160:
        return v[:160] + "…"
    return v


def table(nombre, params, page_size=25):
    t = TABLAS.get(nombre)
    if not t:
        return None
    qs = t["model"].objects.all()
    filtros_aplicados = {}
    for f in t["filtros"]:
        v = params.get(f)
        if v not in (None, ""):
            if v in ("true", "false"):
                v = v == "true"
            qs = qs.filter(**{f: v})
            filtros_aplicados[f] = v
    q = (params.get("q") or "").strip()
    if q and t["buscar"]:
        cond = Q()
        for f in t["buscar"]:
            cond |= Q(**{f"{f}__icontains": q})
        qs = qs.filter(cond)
    total = qs.count()
    page = max(1, int(params.get("page", 1) or 1))
    rows = qs.order_by("-pk")[(page - 1) * page_size: page * page_size]
    opciones = {}
    base = t["model"].objects.all()
    for f in t["filtros"]:
        vals = base.exclude(**{f"{f}__isnull": True}).values_list(f, flat=True).distinct().order_by(f)[:40]
        opciones[f] = list(vals)
    return {
        "id": nombre, "nombre": t["nombre"], "desc": t["desc"], "total": total, "page": page, "pages": max(1, -(-total // page_size)),
        "cols": [{"campo": c, "titulo": h, "tipo": ty} for c, h, ty in t["cols"]],
        "rows": [{"_pk": o.pk, **{c: _valor(o, c, ty) for c, _, ty in t["cols"]}} for o in rows],
        "filtros": [{"campo": f, "opciones": opciones[f], "valor": filtros_aplicados.get(f)} for f in t["filtros"]],
    }


# ---------- esquema (diagrama entidad-relacion) ----------
TIPO = {"BigAutoField": "id", "AutoField": "id", "CharField": "texto", "TextField": "texto largo", "DateTimeField": "fecha",
        "BooleanField": "sí/no", "JSONField": "json", "PositiveIntegerField": "número", "IntegerField": "número",
        "PositiveSmallIntegerField": "número",
        "ForeignKey": "referencia", "EmailField": "texto"}
OCULTAS = {"password", "agent_token", "first_name", "last_name", "email", "is_staff", "is_active"}   # no aportan al diagrama o son sensibles


def schema():
    modelo_a_tabla = {t["model"]: k for k, t in TABLAS.items()}
    tablas, relaciones = [], []
    for k, t in TABLAS.items():
        m = t["model"]
        cols = []
        for f in m._meta.concrete_fields:
            if f.name in OCULTAS:
                continue
            fk = modelo_a_tabla.get(f.related_model) if f.is_relation else None
            cols.append({"nombre": f.column, "tipo": TIPO.get(f.get_internal_type(), f.get_internal_type()), "pk": f.primary_key,
                         "fk": fk, "nulo": f.null})
            if fk:
                relaciones.append({"desde": k, "columna": f.column, "hacia": fk, "tipo": "N:1"})
        tablas.append({"id": k, "nombre": t["nombre"], "db": m._meta.db_table, "total": m.objects.count(), "cols": cols,
                       "consultable": True})
        for f in m._meta.many_to_many:
            destino = modelo_a_tabla.get(f.related_model)
            if destino:
                inter = f.remote_field.through
                tablas.append({"id": f"{k}_{destino}", "nombre": "Propuesta ↔ Hallazgo", "db": inter._meta.db_table,
                               "total": inter.objects.count(), "consultable": False,
                               "cols": [{"nombre": "id", "tipo": "id", "pk": True, "fk": None, "nulo": False},
                                        {"nombre": f"{m._meta.model_name}_id", "tipo": "referencia", "pk": False, "fk": k, "nulo": False},
                                        {"nombre": f"{f.related_model._meta.model_name}_id", "tipo": "referencia", "pk": False, "fk": destino, "nulo": False}]})
                relaciones.append({"desde": f"{k}_{destino}", "columna": f"{m._meta.model_name}_id", "hacia": k, "tipo": "N:1"})
                relaciones.append({"desde": f"{k}_{destino}", "columna": f"{f.related_model._meta.model_name}_id", "hacia": destino, "tipo": "N:1"})
    return {"tablas": tablas, "relaciones": relaciones}
