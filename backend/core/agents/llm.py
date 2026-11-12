"""Cliente LLM local (Ollama). Solo redacta explicaciones; nunca decide operaciones.

Si Ollama no esta disponible, se devuelve una explicacion de plantilla para que el
flujo nunca dependa del modelo.
"""
import requests
from django.conf import settings

CFG = settings.PHANTOM

SYSTEM = ("Eres un ingeniero de redes y seguridad. Explica en espanol, en maximo 5 frases claras, "
          "por que el cambio propuesto corrige el riesgo, que impacto tiene y como se verifica. "
          "No inventes comandos ni datos que no esten en el contexto.")


def explain(context, fallback):
    if not CFG["LLM_ENABLED"]:
        return fallback
    try:
        r = requests.post(f"{CFG['OLLAMA_URL']}/api/generate", json={
            "model": CFG["OLLAMA_MODEL"], "system": SYSTEM, "prompt": context, "stream": False,
            "options": {"temperature": 0.2, "num_predict": 220},
        }, timeout=60)
        r.raise_for_status()
        text = r.json().get("response", "").strip()
        return text or fallback
    except (requests.RequestException, ValueError):
        return fallback


def available():
    try:
        r = requests.get(f"{CFG['OLLAMA_URL']}/api/tags", timeout=3)
        return any(m["name"].startswith(CFG["OLLAMA_MODEL"]) for m in r.json().get("models", []))
    except (requests.RequestException, ValueError, KeyError):
        return False


def explain_stream(context, fallback, on_text):
    """Igual que explain(), pero entrega el texto parcial a on_text mientras el modelo escribe."""
    return think_stream(SYSTEM, context, fallback, on_text, num_predict=220)


# Cada agente razona con el modelo, pero nunca decide: hallazgos y cambios salen de reglas fijas.
REGLA = " Usa solo los datos del contexto; no inventes hosts, puertos ni comandos. Responde en español, máximo 4 frases."
SYSTEM_RECOLECTOR = ("Eres el agente recolector de una plataforma de seguridad de redes. Interpreta el estado de la red "
                     "descrito: cómo entra el tráfico por el firewall, qué está expuesto y qué flujos responden." + REGLA)
SYSTEM_ANALISTA = ("Eres el agente analista de red. Diagnostica el estado operativo: qué falla, su causa probable y a qué "
                   "servicio afecta. Si todo está bien, dilo." + REGLA)
SYSTEM_AUDITOR = ("Eres el agente auditor de seguridad de redes. Para los riesgos detectados explica cómo se podría "
                  "aprovechar cada uno y en qué orden conviene corregirlos." + REGLA)


def think_stream(system, context, fallback, on_text, num_predict=160):
    """Razonamiento del agente en streaming. Si el modelo no responde, se usa el texto de respaldo."""
    import json
    import time
    if not CFG["LLM_ENABLED"]:
        on_text(fallback)
        return fallback
    text, last = "", 0.0
    try:
        with requests.post(f"{CFG['OLLAMA_URL']}/api/generate", json={
            "model": CFG["OLLAMA_MODEL"], "system": system, "prompt": context, "stream": True,
            "options": {"temperature": 0.2, "num_predict": num_predict},
        }, timeout=(5, 240), stream=True) as r:   # en CPU las peticiones esperan turno: lectura generosa
            r.raise_for_status()
            for line in r.iter_lines():
                if not line:
                    continue
                chunk = json.loads(line)
                text += chunk.get("response", "")
                if time.monotonic() - last > 0.2:
                    on_text(text)
                    last = time.monotonic()
                if chunk.get("done"):
                    break
    except (requests.RequestException, ValueError):
        text = text or fallback
    text = _frase_completa(text.strip()) or fallback
    on_text(text)
    return text


def _frase_completa(text):
    """El limite de tokens corta a mitad de frase: se conserva hasta la ultima frase terminada."""
    import re
    text = re.sub(r"\s*\n\s*\d+[.)]?\s*$", "", text)   # un "2." suelto al final de una lista cortada
    if not text or text[-1] in ".!?:":
        return text
    corte = max(text.rfind(c) for c in ".!?")
    return text[:corte + 1] if corte > 0 else text
