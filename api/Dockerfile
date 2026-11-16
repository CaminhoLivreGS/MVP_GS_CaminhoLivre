# syntax=docker/dockerfile:1.7
# Caminho Livre - API (FastAPI). Usuário não root, sem segredos na imagem.
# Segredos (OPENROUTER_API_KEY, CL_RPA_TOKEN, CL_SAL_DISPOSITIVO) entram por
# variável de ambiente no deploy (GitHub Secrets / App Settings do Azure).
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    CL_DB_PATH=/data/caminho_livre.db CL_FOTOS_DIR=/data/fotos

RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --no-create-home app \
    && mkdir -p /data && chown app:app /data

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Código e dados gold (publicados pelo pipeline caminho-livre-dados).
COPY app/ app/
COPY dados/ dados/
COPY contexto/ contexto/

USER 10001
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/api/saude', timeout=2)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090", "--proxy-headers", "--forwarded-allow-ips=*"]
