"""Relevo da rota: dados reais de altitude do grafo gold (Copernicus DEM via Open-Meteo)."""
from __future__ import annotations

from app import config
from app.grafo import Grafo
from app.roteamento import Contexto, calcular, limite_inclinacao

G = Grafo(config.DADOS_DIR / "grafo.json")
CASA = {"lat": -23.5421954, "lon": -46.7775496, "nome": "Casa"}
SHOPPING = {"lat": -23.5389781, "lon": -46.7653358, "nome": "Shopping União"}


def test_rota_traz_perfil_de_elevacao_coerente():
    e = calcular(G, CASA, SHOPPING, Contexto(perfis=("sem_apoio",)))["elevacao"]
    assert e["disponivel"] and "Copernicus" in e["fonte"]
    dists = [p[0] for p in e["perfil"]]
    assert dists[0] == 0 and dists == sorted(dists) and len(e["perfil"]) <= 121
    assert e["altitude_min_m"] <= min(p[1] for p in e["perfil"]) + 1
    assert e["sobe_m"] > 0 and e["desce_m"] > 0
    assert 0 < e["max_inclinacao_pct"] < 30
    assert e["falas"]


def test_limite_depende_do_perfil_e_da_preferencia():
    assert limite_inclinacao(Contexto(perfis=("sem_apoio",))) == 10
    assert limite_inclinacao(Contexto(perfis=("cadeira",))) == 8
    assert limite_inclinacao(Contexto(perfis=("sem_apoio",), preferencias=("plano",))) == 5


def test_trecho_acima_do_limite_vira_aviso_em_linguagem_simples():
    e = calcular(G, CASA, SHOPPING, Contexto(perfis=("sem_apoio",), preferencias=("plano",)))["elevacao"]
    assert e["fortes"], "com limite de 5% a rota até o shopping tem trechos fortes"
    f = e["fortes"][0]
    assert f["inclinacao_pct"] > 5 and f["comp_m"] >= 20 and f["sentido"] in ("subida", "descida")
    assert any("%" in x and "metros" in x for x in e["falas"])
    assert e["falas"][-1].startswith("O recomendado para quem pediu caminho plano é até 5%")
