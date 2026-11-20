"""Entrada da API no Vercel (função Python serverless).

O Vercel chama este arquivo para toda requisição /api/* (ver vercel.json) e usa
a variável `app` (ASGI). No Vercel só /tmp aceita escrita, e ele é apagado
quando a função "esfria": o banco SQLite e as fotos ficam lá de forma temporária.
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("CL_DB_PATH", "/tmp/caminho_livre/caminho_livre.db")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.main import app  # noqa: E402,F401
