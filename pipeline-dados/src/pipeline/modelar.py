"""Modelagem (camada gold): artefatos prontos para a API do Caminho Livre.

  grafo.json        rede de pedestres em formato colunar compacto (índices
                    inteiros), só a maior componente conectada, com zona de
                    alagamento marcada por nó
  lugares.json      lugares pesquisáveis por voz (UBS, farmácia, estação...)
  relatos_seed.json relatos SIMULADOS para a demonstração (ver docs)
  qualidade.json    indicadores de qualidade e cobertura dos dados

O contrato do grafo.json está em docs/dicionario_de_dados.md e é lido por
caminho-livre/api/app/grafo.py. Mudou o formato? Suba "versao".
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone

import networkx as nx
import pandas as pd

from . import config
from .tratar import distancia_m

VERSAO_GRAFO = 1
SUP = {"boa": 0, "irregular": 1, "ruim": 2, "sem_dado": 3}
TRI = {"sim": 0, "nao": 1, "sem_dado": 2}
# bits de nos.flags
F_TRAVESSIA, F_SEMAFORO, F_SONORO, F_GUIA_REB, F_GUIA_ELEV, F_TATIL, F_ALAGA = 1, 2, 4, 8, 16, 32, 64

# Zona de alagamento (heurística documentada): nó a até 80 m de curso d'água,
# ou entre os 15% mais baixos do território e a até 250 m de curso d'água.
ALAGA_RAIO_M, ALAGA_RAIO_BAIXO_M, ALAGA_PERCENTIL = 80, 250, 0.15

# Pontos fixos do cenário de demonstração (persona Dona Maria, Vila Yara).
CASA_DEMO = (-23.5421954, -46.7775496)  # Rua Patrício Galafrio: ~800 m da UBS
DESTINO_DEMO = "Unidade Básica de Saúde Santa Maria Goretti"


class Grade:
    """Índice espacial simples (células de ~110 m) para vizinhança rápida."""

    def __init__(self, pontos, passo=0.001):
        self.passo, self.cel = passo, {}
        for i, (lat, lon) in enumerate(pontos):
            self.cel.setdefault((int(lat / passo), int(lon / passo)), []).append(i)
        self.pontos = pontos

    def perto(self, lat, lon, raio_m):
        r = int(raio_m / 111_000 / self.passo) + 1
        ci, cj = int(lat / self.passo), int(lon / self.passo)
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                for i in self.cel.get((ci + di, cj + dj), ()):
                    p = self.pontos[i]
                    if distancia_m(lat, lon, p[0], p[1]) <= raio_m:
                        yield i


def _maior_componente(nos: pd.DataFrame, arestas: pd.DataFrame):
    g = nx.Graph()
    g.add_edges_from(zip(arestas["u"], arestas["v"]))
    comp = max(nx.connected_components(g), key=len)
    nos = nos[nos["id"].isin(comp)].reset_index(drop=True)
    arestas = arestas[arestas["u"].isin(comp) & arestas["v"].isin(comp)].reset_index(drop=True)
    return nos, arestas


def _zonas_alagamento(nos: pd.DataFrame, aguas: pd.DataFrame) -> pd.Series:
    if aguas.empty:
        return pd.Series(False, index=nos.index)
    grade = Grade(list(zip(aguas["lat"], aguas["lon"])))
    limite_baixo = nos["altitude_m"].quantile(ALAGA_PERCENTIL)
    marc = []
    for lat, lon, alt in zip(nos["lat"], nos["lon"], nos["altitude_m"]):
        raio = ALAGA_RAIO_BAIXO_M if alt <= limite_baixo else ALAGA_RAIO_M
        marc.append(next(grade.perto(lat, lon, raio), None) is not None)
    return pd.Series(marc, index=nos.index)


def modelar_grafo() -> dict:
    nos = pd.read_parquet(config.SILVER / "nos.parquet")
    arestas = pd.read_parquet(config.SILVER / "arestas.parquet")
    aguas = pd.read_parquet(config.SILVER / "aguas.parquet")
    total_nos = len(nos)
    nos, arestas = _maior_componente(nos, arestas)
    nos["alagamento"] = _zonas_alagamento(nos, aguas)

    idx = {i: k for k, i in enumerate(nos["id"])}
    nomes = sorted(set(arestas["nome"]))
    nome_idx = {n: k for k, n in enumerate(nomes)}
    tipos = sorted(set(arestas["tipo_via"]))
    tipo_idx = {t: k for k, t in enumerate(tipos)}

    flags = (nos["travessia"].astype(int) * F_TRAVESSIA + nos["semaforo"].astype(int) * F_SEMAFORO
             + nos["sonoro"].astype(int) * F_SONORO + (nos["guia"] == "rebaixada").astype(int) * F_GUIA_REB
             + (nos["guia"] == "elevada").astype(int) * F_GUIA_ELEV + (nos["piso_tatil"] == True).astype(int) * F_TATIL  # noqa: E712
             + nos["alagamento"].astype(int) * F_ALAGA)

    grafo = {
        "versao": VERSAO_GRAFO,
        "meta": {"territorio": config.TERRITORIO,
                 "demo": {"casa": {"nome": "Casa", "lat": CASA_DEMO[0], "lon": CASA_DEMO[1]}, "destino": DESTINO_DEMO}, "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 "fontes": ["OpenStreetMap (ODbL) via Overpass", "Open-Meteo Elevation (Copernicus DEM GLO-90)"],
                 "codigos": {"sup": SUP, "calc": TRI, "ilum": TRI,
                             "flags": {"travessia": F_TRAVESSIA, "semaforo": F_SEMAFORO, "sonoro": F_SONORO,
                                       "guia_rebaixada": F_GUIA_REB, "guia_elevada": F_GUIA_ELEV,
                                       "piso_tatil": F_TATIL, "alagamento": F_ALAGA}}},
        "nomes": nomes,
        "tipos": tipos,
        "nos": {"osm": nos["id"].tolist(), "lat": nos["lat"].round(7).tolist(), "lon": nos["lon"].round(7).tolist(),
                "alt": nos["altitude_m"].round(1).tolist(), "flags": flags.astype(int).tolist()},
        "arestas": {"u": arestas["u"].map(idx).tolist(), "v": arestas["v"].map(idx).tolist(),
                    "comp": arestas["comprimento_m"].round(1).tolist(),
                    "nome": arestas["nome"].map(nome_idx).tolist(), "tipo": arestas["tipo_via"].map(tipo_idx).tolist(),
                    "sup": arestas["superficie"].map(SUP).tolist(), "calc": arestas["calcada"].map(TRI).tolist(),
                    "ilum": arestas["iluminacao"].map(TRI).tolist(), "esc": arestas["escada"].astype(int).tolist(),
                    "trav": arestas["travessia"].astype(int).tolist(), "inc": arestas["inclinacao_pct"].round(1).tolist()},
    }
    (config.GOLD / "grafo.json").write_text(json.dumps(grafo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    qualidade = {
        "nos_total_extraidos": total_nos, "nos_maior_componente": len(nos), "arestas": len(arestas),
        "extensao_km": round(arestas["comprimento_m"].sum() / 1000, 1),
        "cobertura_pct": {
            "superficie": round((arestas["superficie"] != "sem_dado").mean() * 100, 1),
            "calcada": round((arestas["calcada"] != "sem_dado").mean() * 100, 1),
            "iluminacao": round((arestas["iluminacao"] != "sem_dado").mean() * 100, 1),
            "inclinacao_tag_osm": round((arestas["inclinacao_fonte"] == "osm").mean() * 100, 1),
        },
        "travessias": int(nos["travessia"].sum()), "semaforos": int(nos["semaforo"].sum()),
        "semaforos_sonoros": int(nos["sonoro"].sum()), "escadas_trechos": int(arestas["escada"].sum()),
        "nos_zona_alagamento": int(nos["alagamento"].sum()),
        "inclinacao_media_pct": round(float(arestas["inclinacao_pct"].mean()), 2),
        "trechos_inclinacao_maior_8pct": int((arestas["inclinacao_pct"] > 8).sum()),
    }
    (config.GOLD / "qualidade.json").write_text(json.dumps(qualidade, ensure_ascii=False, indent=1), encoding="utf-8")
    return qualidade


def modelar_lugares() -> dict:
    pois = pd.read_parquet(config.SILVER / "pois.parquet")
    lugares = pois.to_dict(orient="records")
    (config.GOLD / "lugares.json").write_text(json.dumps({"lugares": lugares}, ensure_ascii=False), encoding="utf-8")
    return {"lugares": len(lugares)}


# ---------------------------------------------------------------------------
# Relatos simulados (justificativa em docs/dados_simulados.md)
# ---------------------------------------------------------------------------
CATEGORIAS_RELATO = [  # (categoria, peso): proporção inspirada nas queixas de zeladoria de calçada
    ("buraco", 0.30), ("calcada_irregular", 0.25), ("obstaculo", 0.20),
    ("sem_rampa", 0.10), ("alagamento", 0.08), ("luz_apagada", 0.07),
]
STATUS_RELATO = [("confirmado", 0.45), ("em_verificacao", 0.40), ("resolvido", 0.15)]


def _grafo_nx(nos, arestas, bloqueadas=frozenset()):
    g = nx.Graph()
    for u, v, c in zip(arestas["u"], arestas["v"], arestas["comprimento_m"]):
        if (u, v) not in bloqueadas and (v, u) not in bloqueadas:
            g.add_edge(u, v, w=c)
    return g


def _no_mais_proximo(nos, lat, lon):
    d = (nos["lat"] - lat) ** 2 + ((nos["lon"] - lon) * 0.917) ** 2
    return int(nos.loc[d.idxmin(), "id"])


def _ponto_meio(nos_idx, u, v):
    a, b = nos_idx.loc[u], nos_idx.loc[v]
    return round((a["lat"] + b["lat"]) / 2, 7), round((a["lon"] + b["lon"]) / 2, 7)


def gerar_relatos(n: int = 30, semente: int = 42) -> dict:
    rnd = random.Random(semente)
    nos = pd.read_parquet(config.SILVER / "nos.parquet")
    arestas = pd.read_parquet(config.SILVER / "arestas.parquet")
    nos, arestas = _maior_componente(nos, arestas)
    nos_idx = nos.set_index("id")
    pois = pd.read_parquet(config.SILVER / "pois.parquet")
    agora = datetime.now(timezone.utc)
    relatos = []

    def novo(lat, lon, cat, status, conf, rua, dias, demo=False, lado=None):
        relatos.append({
            "id": f"r{len(relatos) + 1:03d}", "categoria": cat, "status": status, "confirmacoes": conf,
            "lat": lat, "lon": lon, "rua": rua or "via sem nome", "lado_seguro": lado,
            "criado_em": (agora - timedelta(days=dias, hours=rnd.randint(0, 20))).isoformat(timespec="seconds"),
            "origem": "simulado_demo" if demo else "simulado", "autor": "seed",
        })

    # 1) Cenário da demonstração: buraco confirmado no caminho mais curto
    #    Casa -> UBS (força um desvio) e calçada irregular em verificação no
    #    caminho alternativo (dispara o alerta e a pergunta à comunidade).
    destino = pois[pois["nome"] == DESTINO_DEMO]
    if not destino.empty:
        g = _grafo_nx(nos, arestas)
        o = _no_mais_proximo(nos, *CASA_DEMO)
        d = _no_mais_proximo(nos, float(destino.iloc[0]["lat"]), float(destino.iloc[0]["lon"]))
        curto = nx.shortest_path(g, o, d, weight="w")
        nome_de = lambda a, b: arestas[((arestas.u == a) & (arestas.v == b)) | ((arestas.u == b) & (arestas.v == a))]["nome"].iloc[0]  # noqa: E731
        # trecho com nome mais perto do meio do caminho (a fala precisa citar a rua)
        meio = min((k for k in range(2, len(curto) - 3) if nome_de(curto[k], curto[k + 1])),
                   key=lambda k: abs(k - len(curto) // 2))
        u, v = curto[meio], curto[meio + 1]
        rua = nome_de(u, v)
        novo(*_ponto_meio(nos_idx, u, v), "buraco", "confirmado", 4, rua, 0, demo=True)
        bloq = frozenset(zip(curto[meio - 3:meio + 4], curto[meio - 2:meio + 5]))
        alt = nx.shortest_path(_grafo_nx(nos, arestas, bloq), o, d, weight="w")
        k = min((k for k in range(2, len(alt) - 3) if nome_de(alt[k], alt[k + 1]) and nome_de(alt[k], alt[k + 1]) != rua),
                key=lambda k: abs(k - int(len(alt) * 0.6)))
        u2, v2 = alt[k], alt[k + 1]
        rua2 = nome_de(u2, v2)
        novo(*_ponto_meio(nos_idx, u2, v2), "calcada_irregular", "em_verificacao", 4, rua2, 0, demo=True, lado="direita")

    # 2) Relatos de fundo espalhados em vias residenciais e terciárias.
    candidatas = arestas[arestas["tipo_via"].isin(["residential", "tertiary", "secondary", "footway", "living_street"])
                         & (arestas["nome"] != "")].reset_index(drop=True)
    cats, pcat = zip(*CATEGORIAS_RELATO)
    sts, pst = zip(*STATUS_RELATO)
    for _ in range(n):
        a = candidatas.iloc[rnd.randrange(len(candidatas))]
        status = rnd.choices(sts, pst)[0]
        conf = {"confirmado": rnd.randint(3, 9), "em_verificacao": rnd.randint(1, 2), "resolvido": rnd.randint(3, 6)}[status]
        novo(*_ponto_meio(nos_idx, a["u"], a["v"]), rnd.choices(cats, pcat)[0], status, conf, a["nome"],
             rnd.randint(0, 40), lado=rnd.choice(["direita", "esquerda", None]))

    (config.GOLD / "relatos_seed.json").write_text(json.dumps({
        "_aviso": "DADOS SIMULADOS para demonstração. Geração descrita em docs/dados_simulados.md.",
        "semente": semente, "relatos": relatos}, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"relatos": len(relatos)}
