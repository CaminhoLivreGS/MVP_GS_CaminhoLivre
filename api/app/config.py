"""Configuração por variáveis de ambiente (nada sensível no código)."""
from __future__ import annotations

import os
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]
DADOS_DIR = Path(os.getenv("CL_DADOS_DIR", API_DIR / "dados"))
CONTEXTO = Path(os.getenv("CL_CONTEXTO", API_DIR / "contexto" / "base_conhecimento.md"))
DB_PATH = Path(os.getenv("CL_DB_PATH", API_DIR / "var" / "caminho_livre.db"))
FOTOS_DIR = Path(os.getenv("CL_FOTOS_DIR", DB_PATH.parent / "fotos"))
SEMEAR_RELATOS = os.getenv("CL_SEMEAR_RELATOS", "1") == "1"

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
LLM_MODELOS = [m.strip() for m in os.getenv(
    "LLM_MODELOS", "nvidia/nemotron-3-ultra-550b-a55b:free,inclusionai/ling-3.2-flash:free").split(",") if m.strip()]
LLM_TIMEOUT_S = float(os.getenv("LLM_TIMEOUT_S", "12"))
LLM_MOCK = os.getenv("LLM_MOCK", "0") == "1"

# Token compartilhado com o robô de RPA (UiPath) para os endpoints de chamados.
RPA_TOKEN = os.getenv("CL_RPA_TOKEN", "")
FUSO = "America/Sao_Paulo"

# Front compilado (npm run build). Se existir, a própria API serve o app
# (deploy em um único serviço, ex.: Render). Em desenvolvimento, o Vite serve.
FRONT_DIR = Path(os.getenv("CL_FRONT_DIR", API_DIR.parent / "dist"))
