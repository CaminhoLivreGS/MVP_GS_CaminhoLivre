"""OpenRouteService (HeiGIT): rota acessível e matriz de distâncias.

- rota(): perfil `wheelchair` para quem usa cadeira de rodas (evita escadas,
  limita inclinação e guia rebaixada); `foot-walking` sem escadas para quem
  usa bengala/andador; `foot-walking` comum para os demais. Saída no MESMO
  formato da rota do grafo próprio (o front não precisa saber a fonte).
- matriz(): distância/tempo de N origens para M destinos numa chamada só
  (usada para escolher a melhor entrada ou saída de um lugar).

A chave fica só no servidor (ORS_API_KEY). Sem chave, cota estourada ou
erro, levanta IndisponivelORS e quem chamou usa a alternativa.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from collections import OrderedDict

import requests

from . import config
from .grafo import distancia_m

log = logging.getLogger("caminho_livre.ors")
BASE = "https://api.openrouteservice.org/v2"
UA = {"User-Agent": "caminho-livre-mvp/1.0 (projeto academico FIAP)"}
_falhou_em = 0.0                # disjuntor: depois de uma falha, espera 2 min
_cache: OrderedDict = OrderedDict()
_lock = threading.Lock()

# Tipos de passo do ORS -> manobras do app
TIPO = {0: "vire_esquerda", 1: "vire_direita", 2: "vire_esquerda", 3: "vire_direita", 4: "vire_esquerda",
        5: "vire_direita", 6: "siga", 7: "siga", 8: "siga", 9: "volte", 10: "chegada", 11: "inicio",
        12: "siga", 13: "siga"}


class IndisponivelORS(RuntimeError):
    pass


def disponivel() -> bool:
    return bool(config.ORS_API_KEY) and time.time() - _falhou_em > 120


def perfil_ors(perfis) -> tuple[str, dict]:
    """Escolhe o perfil do ORS e as opções a partir do perfil da pessoa."""
    if "cadeira" in perfis:
        return "wheelchair", {"avoid_features": ["steps"], "profile_params": {"restrictions": {
            "maximum_incline": 6, "maximum_sloped_kerb": 0.06, "smoothness_type": "good"}}}
    if "bengala" in perfis or "muletas" in perfis:
        return "foot-walking", {"avoid_features": ["steps"]}
    return "foot-walking", {}


def _post(caminho: str, corpo: dict, timeout=12) -> dict:
    global _falhou_em
    if not disponivel():
        raise IndisponivelORS("ORS sem chave ou disjuntor aberto")
    chave = caminho + json.dumps(corpo, sort_keys=True)
    with _lock:
        if chave in _cache and time.time() - _cache[chave][0] < 3600:
            return _cache[chave][1]
    try:
        r = requests.post(f"{BASE}{caminho}", json=corpo, timeout=timeout,
                          headers={**UA, "Authorization": config.ORS_API_KEY})
    except requests.RequestException as e:
        _falhou_em = time.time()
        raise IndisponivelORS(e.__class__.__name__) from e
    if r.status_code != 200:
        # 404 = sem rota possível com essas restrições: não é falha do serviço
        if r.status_code not in (400, 404):
            _falhou_em = time.time()
        raise IndisponivelORS(f"HTTP {r.status_code}")
    dados = r.json()
    with _lock:
        _cache[chave] = (time.time(), dados)
        while len(_cache) > 200:
            _cache.popitem(last=False)
    return dados


def _r(x: float) -> float:
    return round(x, 5)  # ~1 m: aumenta o reaproveitamento do cache


def rota(origem: dict, destino: dict, perfis, velocidade=1.0) -> dict:
    perfil, opcoes = perfil_ors(perfis)
    corpo = {"coordinates": [[_r(origem["lon"]), _r(origem["lat"])], [_r(destino["lon"]), _r(destino["lat"])]],
             "language": "pt", "instructions": True, "units": "m"}
    if opcoes:
        corpo["options"] = opcoes
    f = _post(f"/directions/{perfil}/geojson", corpo)["features"][0]
    coords = [[la, lo] for lo, la, *_ in f["geometry"]["coordinates"]]
    acum = [0.0]
    for a, b in zip(coords, coords[1:]):
        acum.append(acum[-1] + distancia_m(a[0], a[1], b[0], b[1]))
    manobras = []
    for st in f["properties"]["segments"][0]["steps"]:
        tipo = TIPO.get(st["type"], "siga")
        i = st["way_points"][0]
        if tipo == "chegada":
            continue
        manobras.append({"tipo": tipo, "rua": st.get("name") if st.get("name") not in (None, "", "-") else "calçada",
                         "fala": st["instruction"].rstrip(".") + ".", "lat": coords[i][0], "lon": coords[i][1],
                         "acumulado_m": round(acum[i], 1), "distancia_m": round(st["distance"], 1),
                         "semaforo": False, "sonoro": False})
    total = acum[-1]
    manobras.append({"tipo": "chegada", "rua": destino.get("nome", "destino"),
                     "fala": f"Você chegou em {destino.get('nome', 'seu destino')}.",
                     "lat": coords[-1][0], "lon": coords[-1][1], "acumulado_m": round(total, 1), "distancia_m": 0.0,
                     "semaforo": False, "sonoro": False})
    return {"origem": origem, "destino": destino, "distancia_m": round(total),
            "duracao_min": max(1, round(total / velocidade / 60)), "escadas": 0, "trechos": [],
            "manobras": manobras, "alertas_no_caminho": [], "trechos_sem_dado": [], "cobertura_dados_pct": 0,
            "desvios": [], "rota_comum_distancia_m": round(total), "rota_comum": {"coords": coords},
            "geometria": {"coords": [[round(a, 7), round(b, 7)] for a, b in coords],
                          "acumulado_m": [round(x, 1) for x in acum]},
            "ors_perfil": perfil}


def matriz(origens: list[tuple[float, float]], destinos: list[tuple[float, float]], perfis) -> list[list[float | None]]:
    """Distância a pé (m) de cada origem para cada destino. None = sem caminho."""
    perfil, _ = perfil_ors(perfis)
    locs = [[_r(lo), _r(la)] for la, lo in origens + destinos]
    corpo = {"locations": locs, "sources": list(range(len(origens))),
             "destinations": list(range(len(origens), len(locs))), "metrics": ["distance"]}
    return _post(f"/matrix/{perfil}", corpo)["distances"]
