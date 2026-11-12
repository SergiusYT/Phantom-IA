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
    import json
    import time
    if not CFG["LLM_ENABLED"]:
        on_text(fallback)
        return fallback
    text, last = "", 0.0
    try:
        with requests.post(f"{CFG['OLLAMA_URL']}/api/generate", json={
            "model": CFG["OLLAMA_MODEL"], "system": SYSTEM, "prompt": context, "stream": True,
            "options": {"temperature": 0.2, "num_predict": 220},
        }, timeout=90, stream=True) as r:
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
    text = text.strip() or fallback
    on_text(text)
    return text
