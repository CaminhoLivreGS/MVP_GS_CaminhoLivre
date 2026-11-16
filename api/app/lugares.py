"""Busca de lugares por texto falado ou digitado (lugares.json do pipeline)."""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from .grafo import distancia_m

SINONIMOS = {
    "ubs": ["ubs", "posto de saude", "postinho", "posto", "unidade basica", "saude", "medico", "clinica da familia"],
    "hospital": ["hospital", "pronto socorro", "upa", "pronto atendimento", "emergencia"],
    "farmacia": ["farmacia", "drogaria", "remedio"],
    "estacao": ["estacao", "trem", "metro", "cptm"],
    "ponto_onibus": ["ponto de onibus", "onibus", "ponto"],
    "escola": ["escola", "colegio", "creche"],
    "mercado": ["mercado", "supermercado", "padaria", "feira", "sacolao"],
    "igreja": ["igreja", "templo", "paroquia", "missa", "culto"],
    "parque": ["parque", "praca"],
    "clinica": ["clinica", "laboratorio", "consultorio", "dentista"],
    "servico": ["banco", "correio", "prefeitura", "biblioteca", "cras"],
}
TIPO_LLM_PARA_CATEGORIA = {"ubs": "ubs", "hospital": "hospital", "escola": "escola", "estacao": "estacao",
                           "ponto_onibus": "ponto_onibus", "farmacia": "farmacia", "mercado": "mercado",
                           "igreja": "igreja"}
PALAVRAS_VAZIAS = set("quero ir para pra pro na no da do de a o em ate pelo pela me leva levar pro caminho um uma pro mais perto proximo proxima".split())


def norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", (t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def tokens(t: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", norm(t)) if len(w) > 1 and w not in PALAVRAS_VAZIAS}


def categoria_do_texto(texto: str) -> str | None:
    t = " " + norm(texto) + " "
    melhor = None
    for cat, termos in SINONIMOS.items():
        for termo in termos:
            if f" {termo} " in t or (len(termo) > 4 and termo in t):
                if melhor is None or len(termo) > melhor[1]:
                    melhor = (cat, len(termo))
    return melhor[0] if melhor else None


class Lugares:
    def __init__(self, caminho: Path):
        self.itens = json.loads(Path(caminho).read_text(encoding="utf-8"))["lugares"]
        for l in self.itens:
            l["_tokens"] = tokens(l["nome"])

    def publico(self, l: dict, ref=None) -> dict:
        d = {k: v for k, v in l.items() if not k.startswith("_") and k != "nome_busca"}
        if ref:
            d["distancia_m"] = round(distancia_m(ref[0], ref[1], l["lat"], l["lon"]))
        return d

    def buscar(self, texto: str, ref=None, categoria: str | None = None, limite: int = 5) -> list[dict]:
        cat = categoria or categoria_do_texto(texto)
        q = tokens(texto)
        for termos in SINONIMOS.get(cat or "", []):
            q -= set(termos.split())
        res = []
        for l in self.itens:
            nome_score = len(q & l["_tokens"]) / max(1, len(q)) if q else 0.0
            cat_ok = cat is not None and l["categoria"] == cat
            if not cat_ok and nome_score < 0.5:
                continue
            score = nome_score * 2 + (1.0 if cat_ok else 0.0)
            if ref:
                score -= distancia_m(ref[0], ref[1], l["lat"], l["lon"]) / 4000.0
            res.append((score, l))
        res.sort(key=lambda x: -x[0])
        return [self.publico(l, ref) for _, l in res[:limite]]

    def por_id(self, lid: str) -> dict | None:
        return next((self.publico(l) for l in self.itens if l["id"] == lid), None)
