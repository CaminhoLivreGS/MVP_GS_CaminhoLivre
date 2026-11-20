"""Configuração por variáveis de ambiente (nada sensível no código)."""
from __future__ import annotations

import os
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]
DADOS_DIR = Path(os.getenv("CL_DADOS_DIR", API_DIR / "dados"))
CONTEXTO = Path(os.getenv("CL_CONTEXTO", API_DIR / "contexto" / "base_conhecimento.md"))
DB_PATH = Path(os.getenv("CL_DB_PATH", API_DIR / "var" / "caminho_livre.db"))
FOTOS_DIR = Path(os.getenv("CL_FOTOS_DIR", DB_PATH.parent / "fotos"))
FOTOS_DEMO_DIR = DADOS_DIR / "fotos_demo"
SEMEAR_RELATOS = os.getenv("CL_SEMEAR_RELATOS", "1") == "1"

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
LLM_MODELOS = [m.strip() for m in os.getenv(
    "LLM_MODELOS", "nvidia/nemotron-3-ultra-550b-a55b:free,inclusionai/ling-3.2-flash:free").split(",") if m.strip()]
LLM_TIMEOUT_S = float(os.getenv("LLM_TIMEOUT_S", "12"))
# Tempo total (todas as tentativas somadas) que cada tela aceita esperar pela IA.
# Estourou: responde por regras. Ficam bem abaixo dos timeouts do front (20-25 s).
LLM_PRAZO_DESTINO_S = float(os.getenv("LLM_PRAZO_DESTINO_S", "7"))
LLM_PRAZO_ROTA_S = float(os.getenv("LLM_PRAZO_ROTA_S", "9"))
LLM_PRAZO_AJUDA_S = float(os.getenv("LLM_PRAZO_AJUDA_S", "10"))
LLM_MOCK = os.getenv("LLM_MOCK", "0") == "1"

# Token compartilhado com o robô de RPA (UiPath) para os endpoints de chamados.
RPA_TOKEN = os.getenv("CL_RPA_TOKEN", "")
# Token de administração (moderação e indicadores). Sem ele, usa o do robô.
ADMIN_TOKEN = os.getenv("CL_ADMIN_TOKEN", "") or RPA_TOKEN
# MOCK de acesso ao Painel ADM: sem nenhum token configurado (ambiente local de demonstração),
# o painel aceita o token "adm-demo". No Render o CL_ADMIN_TOKEN é gerado e isto não vale.
# Produção: CL_ADMIN_DEMO=0 e login de verdade (SSO da prefeitura).
if not ADMIN_TOKEN and os.getenv("CL_ADMIN_DEMO", "1") == "1":
    ADMIN_TOKEN = "adm-demo"
ADMIN_TOKEN_DEMO = ADMIN_TOKEN == "adm-demo"
# Token para ler /metrics por fora da rede interna (ex.: Prometheus apontando para o Render).
METRICS_TOKEN = os.getenv("CL_METRICS_TOKEN", "")

# OpenRouteService (HeiGIT): rota para cadeira de rodas e matriz de distâncias.
# Chave só no servidor; sem ela, o app usa as alternativas (grafo próprio/OSRM/estimativa).
ORS_API_KEY = os.getenv("ORS_API_KEY", "")
FUSO = "America/Sao_Paulo"

# Front compilado (npm run build). Se existir, a própria API serve o app
# (deploy em um único serviço, ex.: Render). Em desenvolvimento, o Vite serve.
FRONT_DIR = Path(os.getenv("CL_FRONT_DIR", API_DIR.parent / "dist"))
