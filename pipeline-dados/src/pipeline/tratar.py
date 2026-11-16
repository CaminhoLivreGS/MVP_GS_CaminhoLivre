"""Tratamento (camada silver): transforma o bruto do OSM em tabelas tipadas.

Saídas (parquet):
  nos.parquet       um nó por ponto da rede de pedestres, com altitude e
                    atributos de travessia (semáforo, sinal sonoro, guia, piso tátil)
  arestas.parquet   um trecho por par de nós consecutivos de uma via, com
                    superfície, calçada, iluminação, escada e inclinação
  pois.parquet      lugares de interesse com categoria normalizada
  aguas.parquet     pontos amostrados dos cursos d'água (para zonas de alagamento)

Regras de normalização documentadas em docs/dicionario_de_dados.md.
"""
from __future__ import annotations

import json
import math
import unicodedata

import pandas as pd

from . import config

R_TERRA = 6_371_000.0

SUPERFICIE = {
    "boa": {"asphalt", "concrete", "paving_stones", "concrete:plates", "concrete:lanes", "paved", "metal", "wood", "rubber"},
    "irregular": {"sett", "cobblestone", "unhewn_cobblestone", "grass_paver", "stone", "bricks"},
    "ruim": {"gravel", "unpaved", "dirt", "ground", "grass", "sand", "compacted", "fine_gravel", "mud", "earth", "pebblestone"},
}
SUAVIDADE_RUIM = {"bad", "very_bad", "horrible", "very_horrible", "impassable"}

POI_CATEGORIA = [
    # (função de teste nas tags, categoria)
    (lambda t: _norm(t.get("name", "")).startswith(("ubs", "unidade basica")) or "unidade basica" in _norm(t.get("name", "")), "ubs"),
    (lambda t: t.get("amenity") == "hospital" or t.get("healthcare") == "hospital", "hospital"),
    (lambda t: t.get("amenity") in ("clinic", "doctors") or t.get("healthcare") in ("clinic", "doctor", "centre"), "clinica"),
    (lambda t: t.get("amenity") == "pharmacy" or t.get("healthcare") == "pharmacy", "farmacia"),
    (lambda t: t.get("railway") == "station" or t.get("public_transport") == "station", "estacao"),
    (lambda t: t.get("highway") == "bus_stop", "ponto_onibus"),
    (lambda t: t.get("amenity") == "school", "escola"),
    (lambda t: t.get("shop") in ("supermarket", "bakery") or t.get("amenity") == "marketplace", "mercado"),
    (lambda t: t.get("amenity") == "place_of_worship", "igreja"),
    (lambda t: t.get("leisure") == "park", "parque"),
    (lambda t: t.get("amenity") in ("social_facility", "community_centre", "townhall", "library", "post_office", "bank"), "servico"),
]


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", (t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c)).strip()


def distancia_m(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_TERRA * math.asin(math.sqrt(a))


def _ler(nome: str) -> dict:
    return json.loads((config.BRONZE / nome).read_text(encoding="utf-8"))


class Relevo:
    """Interpolação bilinear da grade de altitude (Copernicus DEM via Open-Meteo)."""

    def __init__(self, bruto: dict):
        d = bruto["dados"]
        self.k = d["grade"]
        self.s, self.w, self.n, self.e = d["bbox"]
        z = d["altitudes_m"]
        k = self.k
        # O Copernicus GLO-90 é um modelo de SUPERFÍCIE: inclui prédios e
        # árvores. Uma média 3x3 (~300 m) tira esse ruído e deixa o relevo
        # do terreno, que é o que importa para a inclinação da calçada.
        suave = []
        for i in range(k):
            for j in range(k):
                viz = [z[a * k + b] for a in range(max(0, i - 1), min(k, i + 2)) for b in range(max(0, j - 1), min(k, j + 2))]
                suave.append(sum(viz) / len(viz))
        self.z = suave

    def altitude(self, lat: float, lon: float) -> float:
        k = self.k
        fi = min(max((lat - self.s) / (self.n - self.s) * (k - 1), 0), k - 1.000001)
        fj = min(max((lon - self.w) / (self.e - self.w) * (k - 1), 0), k - 1.000001)
        i, j = int(fi), int(fj)
        di, dj = fi - i, fj - j
        z = lambda a, b: self.z[a * k + b]  # noqa: E731
        return ((z(i, j) * (1 - dj) + z(i, j + 1) * dj) * (1 - di)
                + (z(i + 1, j) * (1 - dj) + z(i + 1, j + 1) * dj) * di)


def _superficie(tags: dict) -> str:
    s = tags.get("surface") or tags.get("sidewalk:surface") or tags.get("footway:surface")
    if tags.get("smoothness") in SUAVIDADE_RUIM:
        return "ruim" if s in SUPERFICIE["ruim"] else "irregular"
    for classe, valores in SUPERFICIE.items():
        if s in valores:
            return classe
    return "sem_dado"


def _calcada(tags: dict) -> str:
    hw = tags.get("highway")
    if hw in ("footway", "pedestrian", "path", "steps", "living_street", "corridor"):
        return "sim"
    sw = tags.get("sidewalk") or tags.get("sidewalk:both")
    if sw in ("both", "left", "right", "yes", "separate"):
        return "sim"
    if sw in ("no", "none"):
        return "nao"
    return "sem_dado"


def _iluminacao(tags: dict) -> str:
    lit = tags.get("lit")
    return "sim" if lit in ("yes", "24/7", "automatic") else "nao" if lit == "no" else "sem_dado"


def _inclinacao_tag(tags: dict):
    inc = (tags.get("incline") or "").replace("%", "").strip()
    try:
        return abs(float(inc))
    except ValueError:
        return None


def tratar_rede() -> dict:
    bruto = _ler("osm_vias.json")["dados"]["elements"]
    relevo = Relevo(_ler("elevacao_grade.json"))
    nos_osm = {e["id"]: e for e in bruto if e["type"] == "node"}
    vias = [e for e in bruto if e["type"] == "way"]

    # Overpass devolve a via inteira mesmo se ela sai da caixa: recorta.
    s_, w_, n_, e_ = config.TERRITORIO["bbox"]
    m = 0.003
    nos_osm = {i: n for i, n in nos_osm.items() if s_ - m <= n["lat"] <= n_ + m and w_ - m <= n["lon"] <= e_ + m}

    usados: set[int] = set()
    arestas = []
    for via in vias:
        t = via.get("tags", {})
        ids = [i for i in via["nodes"] if i in nos_osm]
        nome = t.get("name") or t.get("official_name") or ""
        tipo = t.get("highway")
        travessia = tipo == "footway" and t.get("footway") == "crossing"
        if not nome and travessia:
            nome = "faixa de pedestres"
        sup, calc, ilum = _superficie(t), _calcada(t), _iluminacao(t)
        inc_tag = _inclinacao_tag(t)
        for a, b in zip(ids, ids[1:]):
            na, nb = nos_osm[a], nos_osm[b]
            comp = distancia_m(na["lat"], na["lon"], nb["lat"], nb["lon"])
            if comp < 0.3:
                continue
            arestas.append({
                "u": a, "v": b, "via_id": via["id"], "nome": nome, "tipo_via": tipo,
                "comprimento_m": round(comp, 2), "superficie": sup, "calcada": calc,
                "iluminacao": ilum, "escada": tipo == "steps", "travessia": travessia,
                "inclinacao_tag_pct": inc_tag,
            })
            usados.update((a, b))

    nos = []
    for i in usados:
        n = nos_osm[i]
        t = n.get("tags", {})
        cruz = t.get("highway") in ("crossing", "traffic_signals") or "crossing" in t
        semaforo = t.get("highway") == "traffic_signals" or t.get("crossing") in ("traffic_signals",) \
            or t.get("crossing:signals") == "yes"
        nos.append({
            "id": i, "lat": n["lat"], "lon": n["lon"],
            "altitude_m": round(relevo.altitude(n["lat"], n["lon"]), 2),
            "travessia": bool(cruz), "semaforo": bool(semaforo),
            "sonoro": t.get("traffic_signals:sound") == "yes",
            "guia": {"lowered": "rebaixada", "flush": "rebaixada", "raised": "elevada"}.get(t.get("kerb")),
            "piso_tatil": {"yes": True, "no": False}.get(t.get("tactile_paving")),
        })
    df_nos = pd.DataFrame(nos)
    df_arestas = pd.DataFrame(arestas)

    # Inclinação: tag do OSM quando existe; senão, derivada do relevo
    # (diferença de altitude interpolada / comprimento), limitada a 30%.
    alt = df_nos.set_index("id")["altitude_m"]
    dz = (df_arestas["v"].map(alt) - df_arestas["u"].map(alt)).abs()
    calc = (dz / df_arestas["comprimento_m"].clip(lower=1.0) * 100).clip(upper=30).round(1)
    df_arestas["inclinacao_pct"] = df_arestas["inclinacao_tag_pct"].fillna(calc)
    df_arestas["inclinacao_fonte"] = df_arestas["inclinacao_tag_pct"].notna().map({True: "osm", False: "relevo"})
    df_arestas = df_arestas.drop(columns=["inclinacao_tag_pct"])

    df_nos.to_parquet(config.SILVER / "nos.parquet", index=False)
    df_arestas.to_parquet(config.SILVER / "arestas.parquet", index=False)
    return {"nos": len(df_nos), "arestas": len(df_arestas)}


def tratar_pois() -> dict:
    elementos = _ler("osm_pois.json")["dados"]["elements"]
    pois, aguas = [], []
    for e in elementos:
        t = e.get("tags", {})
        if "waterway" in t:
            geom = e.get("geometry") or []
            for g in geom[::2]:  # amostra 1 a cada 2 vértices
                aguas.append({"via_id": e["id"], "tipo": t["waterway"], "nome": t.get("name", ""),
                              "lat": g["lat"], "lon": g["lon"]})
            continue
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if lat is None:
            continue
        cat = next((c for teste, c in POI_CATEGORIA if teste(t)), None)
        nome = t.get("name") or ""
        if cat is None or (not nome and cat not in ("ponto_onibus",)):
            continue
        if cat == "ponto_onibus" and not nome:
            nome = "Ponto de ônibus"
        endereco = " ".join(x for x in (t.get("addr:street"), t.get("addr:housenumber")) if x)
        pois.append({"id": f"{e['type'][0]}{e['id']}", "nome": nome, "nome_busca": _norm(nome),
                     "categoria": cat, "lat": lat, "lon": lon, "endereco": endereco,
                     "horario": t.get("opening_hours", ""),
                     "acesso_cadeira": t.get("wheelchair", "")})
    df = pd.DataFrame(pois).drop_duplicates(subset=["nome_busca", "categoria"])
    df.to_parquet(config.SILVER / "pois.parquet", index=False)
    pd.DataFrame(aguas, columns=["via_id", "tipo", "nome", "lat", "lon"]).to_parquet(
        config.SILVER / "aguas.parquet", index=False)
    return {"pois": len(df), "pontos_agua": len(aguas), "por_categoria": df["categoria"].value_counts().to_dict()}
