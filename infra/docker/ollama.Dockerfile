# Ollama (CPU) para el cluster, sin descargar la imagen oficial (varios GB por CUDA).
# Base: la imagen del backend ya construida (Debian slim con libstdc++); binario y librerias
# CPU copiados del host por bin/phantom-up a build/ollama/. Version 0.13.5 = la que creo el modelo.
ARG BASE=phantom-agent:dev
FROM ${BASE}
COPY build/ollama/bin/ollama /usr/local/bin/ollama
COPY build/ollama/lib/ /usr/local/lib/ollama/
ENV OLLAMA_HOST=0.0.0.0:11434 OLLAMA_MODELS=/models
EXPOSE 11434
ENTRYPOINT ["/usr/local/bin/ollama"]
CMD ["serve"]
