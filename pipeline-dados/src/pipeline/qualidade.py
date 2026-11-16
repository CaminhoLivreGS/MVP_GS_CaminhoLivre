"""Verificações de qualidade (falham o pipeline se o dado não serve ao produto)."""
from __future__ import annotations

import json

from . import config


class DadoInvalido(RuntimeError):
    pass


def verificar_gold() -> dict:
    g = json.loads((config.GOLD / "grafo.json").read_text(encoding="utf-8"))
    n, a = g["nos"], g["arestas"]
    erros = []
    if len(n["lat"]) < 1000:
        erros.append(f"grafo pequeno demais: {len(n['lat'])} nós")
    if not all(len(a[c]) == len(a["u"]) for c in a):
        erros.append("colunas de arestas com tamanhos diferentes")
    if not all(len(n[c]) == len(n["lat"]) for c in n):
        erros.append("colunas de nós com tamanhos diferentes")
    s, w, no, e = config.TERRITORIO["bbox"]
    fora = sum(1 for la, lo in zip(n["lat"], n["lon"]) if not (s - 0.01 <= la <= no + 0.01 and w - 0.01 <= lo <= e + 0.01))
    if fora:
        erros.append(f"{fora} nós fora do território")
    if any(c <= 0 for c in a["comp"]):
        erros.append("aresta com comprimento <= 0")
    if any(not (0 <= i <= 30) for i in a["inc"]):
        erros.append("inclinação fora de 0..30%")
    alts = n["alt"]
    if max(alts) - min(alts) > 400 or min(alts) < 0:
        erros.append(f"altitudes implausíveis: {min(alts)}..{max(alts)}")
    lug = json.loads((config.GOLD / "lugares.json").read_text(encoding="utf-8"))["lugares"]
    if not any(l["categoria"] == "ubs" for l in lug):
        erros.append("nenhuma UBS encontrada")
    if erros:
        raise DadoInvalido("; ".join(erros))
    return {"ok": True, "nos": len(n["lat"]), "arestas": len(a["u"]), "lugares": len(lug)}
