"""Dados do OpenStreetMap sob demanda, para qualquer lugar (não só o piloto).

- construir_grafo(bbox): baixa a rede de pedestres da região (Overpass) e o
  relevo (Open-Meteo, 1 chamada de 100 pontos) e monta um Grafo com as MESMAS
  regras de normalização do pipeline caminho-livre-dados (tratar.py/modelar.py).
  O território do piloto continua usando o grafo gold, que tem também zonas
  de alagamento e relatos curados.
- rota_osrm(): plano B quando o Overpass falha: rota a pé do OSRM público,
  SEM dados de acessibilidade (o app avisa isso à pessoa).
- buscar_lugares / perto_de / onde_estou: Photon (busca e endereço) e
  Overpass (categorias perto de você: UBS, farmácia, estação...).

Tudo com cache em memória (e em disco para o OSM), timeouts curtos e
User-Agent identificado, respeitando as políticas de uso dos serviços.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import threading
import time
from collections import OrderedDict

import requests

from . import config
from .grafo import Grafo, distancia_m

log = logging.getLogger("caminho_livre.osm")
UA = {"User-Agent": "caminho-livre-mvp/1.0 (projeto academico FIAP; contato via repositorio)"}
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
_overpass_falhou_em = 0.0  # disjuntor: se o Overpass caiu, vai direto ao plano B por 3 min
PHOTON = "https://photon.komoot.io"
OSRM_PE = "https://routing.openstreetmap.de/routed-foot/route/v1/foot"
ELEVACAO = "https://api.open-meteo.com/v1/elevation"
CACHE_DIR = config.DB_PATH.parent / "cache_osm"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

VIAS = ("footway|pedestrian|path|steps|living_street|residential|service|tertiary|tertiary_link|secondary|"
        "secondary_link|primary|primary_link|unclassified|track|corridor|cycleway")

# --- normalização (espelho de caminho-livre-dados/src/pipeline/tratar.py) ---
SUPERFICIE = {
    "boa": {"asphalt", "concrete", "paving_stones", "concrete:plates", "concrete:lanes", "paved", "metal", "wood", "rubber"},
    "irregular": {"sett", "cobblestone", "unhewn_cobblestone", "grass_paver", "stone", "bricks"},
    "ruim": {"gravel", "unpaved", "dirt", "ground", "grass", "sand", "compacted", "fine_gravel", "mud", "earth", "pebblestone"},
}
SUAVIDADE_RUIM = {"bad", "very_bad", "horrible", "very_horrible", "impassable"}
SUP_COD = {"boa": 0, "irregular": 1, "ruim": 2, "sem_dado": 3}
TRI_COD = {"sim": 0, "nao": 1, "sem_dado": 2}


def _superficie(t):
    s = t.get("surface") or t.get("sidewalk:surface") or t.get("footway:surface")
    if t.get("smoothness") in SUAVIDADE_RUIM:
        return "ruim" if s in SUPERFICIE["ruim"] else "irregular"
    return next((c for c, v in SUPERFICIE.items() if s in v), "sem_dado")


def _calcada(t):
    if t.get("highway") in ("footway", "pedestrian", "path", "steps", "living_street", "corridor"):
        return "sim"
    sw = t.get("sidewalk") or t.get("sidewalk:both")
    return "sim" if sw in ("both", "left", "right", "yes", "separate") else "nao" if sw in ("no", "none") else "sem_dado"


def _iluminacao(t):
    lit = t.get("lit")
    return "sim" if lit in ("yes", "24/7", "automatic") else "nao" if lit == "no" else "sem_dado"


def _inclinacao_tag(t):
    try:
        return abs(float((t.get("incline") or "").replace("%", "").strip()))
    except ValueError:
        return None


class IndisponivelOSM(RuntimeError):
    pass


def _overpass(consulta: str, timeout=9) -> dict:
    global _overpass_falhou_em
    chave = hashlib.sha1(consulta.encode(), usedforsecurity=False).hexdigest()  # só nome de arquivo de cache
    arq = CACHE_DIR / f"{chave}.json"
    if arq.exists() and time.time() - arq.stat().st_mtime < 24 * 3600:
        return json.loads(arq.read_text(encoding="utf-8"))
    if time.time() - _overpass_falhou_em < 180:
        raise IndisponivelOSM("Overpass indisponível há pouco (disjuntor aberto)")
    erros = []
    for url in OVERPASS:
        try:
            r = requests.post(url, data={"data": consulta}, timeout=timeout, headers=UA)
            if r.status_code == 200:
                dados = r.json()
                arq.write_text(json.dumps(dados), encoding="utf-8")
                return dados
            erros.append(f"{url} HTTP {r.status_code}")
        except requests.RequestException as e:
            erros.append(f"{url} {e.__class__.__name__}")
    _overpass_falhou_em = time.time()
    raise IndisponivelOSM("; ".join(erros))


def altitudes_da_rota(coords, acumulado, manobras=(), max_pontos=100):
    """Altitude ao longo de uma rota (sem grafo: plano B OSRM/ORS), em 1 chamada à Open-Meteo.

    Amostra até max_pontos pontos espaçados igualmente pela distância. Devolve (alts, segs)
    no formato de roteamento.montar_elevacao, ou None se o relevo estiver indisponível.
    """
    if len(coords) < 2 or not acumulado or acumulado[-1] <= 0:
        return None
    total = acumulado[-1]
    n = min(max_pontos, max(2, int(total // 10) + 1))  # ~1 ponto a cada 10 m, até 100
    pts, j = [], 0
    for i in range(n):
        alvo = total * i / (n - 1)
        while j < len(acumulado) - 2 and acumulado[j + 1] < alvo:
            j += 1
        a0, a1 = acumulado[j], acumulado[j + 1]
        t = 0.0 if a1 <= a0 else (alvo - a0) / (a1 - a0)
        (la0, lo0), (la1, lo1) = coords[j], coords[j + 1]
        pts.append((alvo, la0 + (la1 - la0) * t, lo0 + (lo1 - lo0) * t))
    try:
        r = requests.get(ELEVACAO, timeout=10, headers=UA, params={
            "latitude": ",".join(f"{p[1]:.5f}" for p in pts), "longitude": ",".join(f"{p[2]:.5f}" for p in pts)})
        r.raise_for_status()
        alts = [float(z) for z in r.json()["elevation"]]
    except (requests.RequestException, KeyError, ValueError, TypeError):
        return None
    if len(alts) != len(pts):
        return None
    # O modelo de terreno tem células de 90 m: a altitude muda em "degraus". Amostrando a cada
    # ~20 m, cada degrau viraria uma rampa falsa de 20-30%. Média móvel numa janela de ~90 m.
    passo = total / (len(pts) - 1)
    meia = max(1, round(45 / passo))
    alts = [sum(alts[max(0, i - meia):i + meia + 1]) / len(alts[max(0, i - meia):i + meia + 1]) for i in range(len(alts))]
    # Nome da rua de cada trecho: o da última manobra antes dele (OSRM/ORS trazem a rua de cada passo).
    ruas = sorted((m.get("acumulado_m", 0), m.get("rua") or "") for m in manobras if m.get("tipo") != "chegada")
    def rua_em(d):
        nome = ""
        for a, r in ruas:
            if a > d + 1:
                break
            nome = r
        return nome
    segs = []
    for (d0, *_), (d1, *_), z0, z1 in zip(pts, pts[1:], alts, alts[1:]):
        comp = max(d1 - d0, 0.1)
        segs.append({"comp": comp, "inc": min(30.0, abs(z1 - z0) / comp * 100), "nome": rua_em(d0)})
    return alts, segs


def _altitudes(bbox, k=10):
    """Grade k x k (100 pontos = 1 chamada) de altitude; None se indisponível."""
    s, w, n, e = bbox
    pts = [(s + (n - s) * i / (k - 1), w + (e - w) * j / (k - 1)) for i in range(k) for j in range(k)]
    try:
        r = requests.get(ELEVACAO, timeout=10, headers=UA, params={
            "latitude": ",".join(f"{p[0]:.5f}" for p in pts), "longitude": ",".join(f"{p[1]:.5f}" for p in pts)})
        r.raise_for_status()
        z = r.json()["elevation"]
    except (requests.RequestException, KeyError, ValueError):
        return None

    def alt(lat, lon):
        fi = min(max((lat - s) / (n - s) * (k - 1), 0), k - 1.000001)
        fj = min(max((lon - w) / (e - w) * (k - 1), 0), k - 1.000001)
        i, j = int(fi), int(fj)
        di, dj = fi - i, fj - j
        Z = lambda a, b: z[a * k + b]  # noqa: E731
        return ((Z(i, j) * (1 - dj) + Z(i, j + 1) * dj) * (1 - di) + (Z(i + 1, j) * (1 - dj) + Z(i + 1, j + 1) * dj) * di)
    return alt


def _montar(elementos, bbox) -> dict:
    nos_osm = {e["id"]: e for e in elementos if e["type"] == "node"}
    vias = [e for e in elementos if e["type"] == "way"]
    alt = _altitudes(bbox)
    arestas, usados = [], {}
    for via in vias:
        t = via.get("tags", {})
        ids = [i for i in via["nodes"] if i in nos_osm]
        tipo = t.get("highway")
        trav = tipo == "footway" and t.get("footway") == "crossing"
        nome = t.get("name") or ("faixa de pedestres" if trav else "")
        sup, calc, ilum, inc_tag = _superficie(t), _calcada(t), _iluminacao(t), _inclinacao_tag(t)
        for a, b in zip(ids, ids[1:]):
            na, nb = nos_osm[a], nos_osm[b]
            comp = distancia_m(na["lat"], na["lon"], nb["lat"], nb["lon"])
            if comp < 0.3:
                continue
            arestas.append((a, b, comp, nome, tipo, sup, calc, ilum, tipo == "steps", trav, inc_tag))
            usados[a] = usados[b] = True
    # maior componente conectada (union-find)
    pai = {i: i for i in usados}

    def raiz(x):
        while pai[x] != x:
            pai[x] = pai[pai[x]]
            x = pai[x]
        return x
    for a, b, *_ in arestas:
        ra, rb = raiz(a), raiz(b)
        if ra != rb:
            pai[ra] = rb
    tam: dict[int, int] = {}
    for i in usados:
        tam[raiz(i)] = tam.get(raiz(i), 0) + 1
    if not tam:
        raise IndisponivelOSM("nenhuma via de pedestre na região")
    maior = max(tam, key=tam.get)
    ids = [i for i in usados if raiz(i) == maior]
    idx = {i: k for k, i in enumerate(ids)}
    lat = [nos_osm[i]["lat"] for i in ids]
    lon = [nos_osm[i]["lon"] for i in ids]
    alts = [round(alt(la, lo), 1) if alt else 0.0 for la, lo in zip(lat, lon)]
    flags = []
    for i in ids:
        t = nos_osm[i].get("tags", {})
        f = 0
        if t.get("highway") in ("crossing", "traffic_signals") or "crossing" in t:
            f |= 1
        if t.get("highway") == "traffic_signals" or t.get("crossing") == "traffic_signals" or t.get("crossing:signals") == "yes":
            f |= 2
        if t.get("traffic_signals:sound") == "yes":
            f |= 4
        if t.get("kerb") in ("lowered", "flush"):
            f |= 8
        if t.get("kerb") == "raised":
            f |= 16
        if t.get("tactile_paving") == "yes":
            f |= 32
        flags.append(f)
    nomes, tipos = sorted({a[3] for a in arestas}), sorted({a[4] for a in arestas})
    ni, ti = {n: k for k, n in enumerate(nomes)}, {t: k for k, t in enumerate(tipos)}
    col = {c: [] for c in ("u", "v", "comp", "nome", "tipo", "sup", "calc", "ilum", "esc", "trav", "inc")}
    for a, b, comp, nome, tipo, sup, calc, ilum, esc, trav, inc_tag in arestas:
        if a not in idx or b not in idx:
            continue
        inc = inc_tag if inc_tag is not None else (
            min(30.0, abs(alts[idx[b]] - alts[idx[a]]) / max(comp, 1.0) * 100) if alt else 0.0)
        for c, v in zip(col, (idx[a], idx[b], round(comp, 1), ni[nome], ti[tipo], SUP_COD[sup], TRI_COD[calc],
                              TRI_COD[ilum], int(esc), int(trav), round(inc, 1))):
            col[c].append(v)
    return {"versao": 1, "meta": {"territorio": {"nome": "OSM ao vivo", "bbox": list(bbox),
                                                  "centro": [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]},
                                   "gerado_em": time.strftime("%Y-%m-%dT%H:%M:%S"), "relevo": bool(alt),
                                   "fontes": ["OpenStreetMap (ODbL) via Overpass", "Open-Meteo Elevation"]},
            "nomes": nomes, "tipos": tipos,
            "nos": {"osm": ids, "lat": lat, "lon": lon, "alt": alts, "flags": flags}, "arestas": col}


_grafos: OrderedDict = OrderedDict()
_lock = threading.Lock()
PASSO = 0.005  # arredonda a caixa para reaproveitar o cache entre pedidos vizinhos


def caixa_para(pontos, margem=0.006):
    s = math.floor((min(p[0] for p in pontos) - margem) / PASSO) * PASSO
    w = math.floor((min(p[1] for p in pontos) - margem) / PASSO) * PASSO
    n = math.ceil((max(p[0] for p in pontos) + margem) / PASSO) * PASSO
    e = math.ceil((max(p[1] for p in pontos) + margem) / PASSO) * PASSO
    return (round(s, 4), round(w, 4), round(n, 4), round(e, 4))


def construir_grafo(bbox) -> Grafo:
    with _lock:
        if bbox in _grafos:
            _grafos.move_to_end(bbox)
            return _grafos[bbox]
    s, w, n, e = bbox
    caixa = f"{s},{w},{n},{e}"
    consulta = f"""[out:json][timeout:35];
(
  way["highway"~"^({VIAS})$"]["access"!~"private|no"]["foot"!~"no"]({caixa});
  way["highway"~"^(trunk|trunk_link)$"]["sidewalk"~"both|left|right|yes"]({caixa});
)->.vias;
.vias out body;
node(w.vias);
out body;"""
    ini = time.time()
    g = Grafo(dados=_montar(_overpass(consulta, timeout=12)["elements"], bbox))
    log.info(json.dumps({"evento": "grafo_ao_vivo", "bbox": bbox, "nos": len(g.lat), "s": round(time.time() - ini, 1)}))
    with _lock:
        _grafos[bbox] = g
        while len(_grafos) > 6:
            _grafos.popitem(last=False)
    return g


# --- plano B: OSRM a pé (sem acessibilidade) ---------------------------------
MODIF = {"right": "direita", "slight right": "direita", "sharp right": "direita",
         "left": "esquerda", "slight left": "esquerda", "sharp left": "esquerda"}


def rota_osrm(origem, destino, velocidade=1.0) -> dict:
    url = f"{OSRM_PE}/{origem['lon']},{origem['lat']};{destino['lon']},{destino['lat']}"
    r = requests.get(url, timeout=12, headers=UA, params={"overview": "full", "geometries": "geojson", "steps": "true"})
    r.raise_for_status()
    rt = r.json()["routes"][0]
    coords = [[la, lo] for lo, la in rt["geometry"]["coordinates"]]
    acum = [0.0]
    for a, b in zip(coords, coords[1:]):
        acum.append(acum[-1] + distancia_m(a[0], a[1], b[0], b[1]))
    manobras, feito = [], 0.0
    for st in rt["legs"][0]["steps"]:
        m, rua = st["maneuver"], st.get("name") or ""
        lado = MODIF.get(m.get("modifier", ""))
        if m["type"] == "depart":
            tipo, fala = "inicio", f"Siga pela {rua}." if rua else "Siga em frente."
        elif m["type"] == "arrive":
            continue
        elif lado:
            tipo, fala = f"vire_{lado}", f"Vire à {lado}" + (f" na {rua}." if rua else ".")
        else:
            tipo, fala = "siga", f"Continue pela {rua}." if rua else "Continue em frente."
        manobras.append({"tipo": tipo, "rua": rua or "calçada", "fala": fala, "lat": m["location"][1], "lon": m["location"][0],
                         "acumulado_m": round(feito, 1), "distancia_m": round(st["distance"], 1), "semaforo": False, "sonoro": False})
        feito += st["distance"]
    manobras.append({"tipo": "chegada", "rua": destino.get("nome", "destino"), "fala": f"Você chegou em {destino.get('nome', 'seu destino')}.",
                     "lat": coords[-1][0], "lon": coords[-1][1], "acumulado_m": round(acum[-1], 1), "distancia_m": 0.0,
                     "semaforo": False, "sonoro": False})
    total = acum[-1]
    return {"origem": origem, "destino": destino, "distancia_m": round(total), "duracao_min": max(1, round(total / velocidade / 60)),
            "escadas": 0, "trechos": [], "manobras": manobras, "alertas_no_caminho": [], "trechos_sem_dado": [],
            "cobertura_dados_pct": 0, "desvios": [], "rota_comum_distancia_m": round(total), "rota_comum": {"coords": coords},
            "geometria": {"coords": [[round(a, 7), round(b, 7)] for a, b in coords], "acumulado_m": [round(x, 1) for x in acum]}}


# --- lugares -------------------------------------------------------------------
CATEGORIA_OVERPASS = {
    "ubs": 'nwr["name"~"UBS|Unidade B[aá]sica|Posto de Sa[uú]de|USF|Unidade de Sa[uú]de da Fam",i]',
    "hospital": 'nwr["amenity"="hospital"]', "farmacia": 'nwr["amenity"="pharmacy"]',
    "estacao": 'nwr["railway"="station"]', "ponto_onibus": 'node["highway"="bus_stop"]',
    "escola": 'nwr["amenity"="school"]', "mercado": 'nwr["shop"~"^(supermarket|bakery)$"]',
    "igreja": 'nwr["amenity"="place_of_worship"]', "parque": 'nwr["leisure"="park"]["name"]',
    "clinica": 'nwr["amenity"~"^(clinic|doctors)$"]', "servico": 'nwr["amenity"~"^(bank|post_office|townhall|library)$"]',
}
_cache_lugares: dict = {}


def _endereco(p: dict) -> str:
    rua = " ".join(x for x in (p.get("street"), p.get("housenumber")) if x)
    return ", ".join(x for x in (rua, p.get("district") or p.get("locality"), p.get("city")) if x)


# Busca por categoria no Photon (rápido), restrita a uma caixa em volta da pessoa.
CATEGORIA_PHOTON = {
    "ubs": [("UBS", None), ("posto de saúde", None)], "hospital": [("hospital", "amenity:hospital")],
    "farmacia": [("farmácia", "amenity:pharmacy")], "estacao": [("estação", "railway:station"), ("metrô", None)],
    "ponto_onibus": [("ponto de ônibus", "highway:bus_stop")], "escola": [("escola", "amenity:school")],
    "mercado": [("mercado", "shop:supermarket")], "igreja": [("igreja", "amenity:place_of_worship")],
    "parque": [("parque", "leisure:park")], "clinica": [("clínica", "amenity:clinic")], "servico": [("banco", "amenity:bank")],
}
NOME_UBS = ("ubs", "unidade basica", "posto de saude", "usf", "ama ", "unidade de saude")


def _photon_categoria(categoria, lat, lon, raio_graus=0.03):
    import unicodedata
    norm = lambda t: "".join(c for c in unicodedata.normalize("NFKD", (t or "").lower()) if not unicodedata.combining(c))  # noqa: E731
    vistos, itens = set(), []
    for q, tag in CATEGORIA_PHOTON.get(categoria, []):
        params = {"q": q, "lat": lat, "lon": lon, "limit": 12,
                  "bbox": f"{lon - raio_graus},{lat - raio_graus},{lon + raio_graus},{lat + raio_graus}"}
        if tag:
            params["osm_tag"] = tag
        r = requests.get(f"{PHOTON}/api/", params=params, timeout=8, headers=UA)
        r.raise_for_status()
        for f in r.json().get("features", []):
            p, (lo, la) = f["properties"], f["geometry"]["coordinates"]
            nome = p.get("name")
            if not nome or (p.get("osm_id"), nome) in vistos:
                continue
            if categoria == "ubs" and not any(k in norm(nome) + " " for k in NOME_UBS):
                continue
            if categoria == "estacao" and tag is None and p.get("osm_key") not in ("railway", "public_transport", "station"):
                continue
            vistos.add((p.get("osm_id"), nome))
            itens.append({"id": f"{p.get('osm_type', 'x')}{p.get('osm_id', '')}".lower(), "nome": nome, "categoria": categoria,
                          "lat": la, "lon": lo, "endereco": _endereco(p), "horario": "", "acesso_cadeira": ""})
    return itens


def perto_de(categoria: str, lat: float, lon: float, raio=2500, limite=5) -> list[dict]:
    if categoria not in CATEGORIA_OVERPASS:
        return []
    chave = (categoria, round(lat, 2), round(lon, 2))
    if chave not in _cache_lugares:
        try:
            itens = _photon_categoria(categoria, lat, lon)
            if itens:
                _cache_lugares[chave] = (time.time(), itens)
        except requests.RequestException:
            pass
    if chave in _cache_lugares and time.time() - _cache_lugares[chave][0] < 3600:
        itens = _cache_lugares[chave][1]
    else:
        q = f"[out:json][timeout:20];{CATEGORIA_OVERPASS[categoria]}(around:{raio},{lat:.5f},{lon:.5f});out center tags 40;"
        dados = _overpass(q, timeout=22)
        itens = []
        for e in dados["elements"]:
            t = e.get("tags", {})
            la = e.get("lat") or (e.get("center") or {}).get("lat")
            lo = e.get("lon") or (e.get("center") or {}).get("lon")
            if la is None:
                continue
            nome = t.get("name") or ("Ponto de ônibus" if categoria == "ponto_onibus" else None)
            if not nome:
                continue
            itens.append({"id": f"{e['type'][0]}{e['id']}", "nome": nome, "categoria": categoria, "lat": la, "lon": lo,
                          "endereco": " ".join(x for x in (t.get("addr:street"), t.get("addr:housenumber")) if x),
                          "horario": t.get("opening_hours", ""), "acesso_cadeira": t.get("wheelchair", "")})
        _cache_lugares[chave] = (time.time(), itens)
    for i in itens:
        i["distancia_m"] = round(distancia_m(lat, lon, i["lat"], i["lon"]))
    unicos = []
    for i in sorted(itens, key=lambda x: x["distancia_m"]):  # mesmo nome a < 300 m = mesmo lugar (ex.: 2 entradas do metrô)
        if not any(u["nome"].lower() == i["nome"].lower() and distancia_m(u["lat"], u["lon"], i["lat"], i["lon"]) < 300 for u in unicos):
            unicos.append(i)
    return unicos[:limite]


def buscar_texto(texto: str, lat: float | None, lon: float | None, limite=5) -> list[dict]:
    params = {"q": texto, "limit": 8, "lang": "default"}
    if lat is not None:
        params.update({"lat": lat, "lon": lon, "location_bias_scale": 0.4, "zoom": 14})
    r = requests.get(f"{PHOTON}/api/", params=params, timeout=8, headers=UA)
    r.raise_for_status()
    out = []
    for f in r.json().get("features", []):
        p, (lo, la) = f["properties"], f["geometry"]["coordinates"]
        nome = p.get("name") or _endereco(p)
        if not nome:
            continue
        d = round(distancia_m(lat, lon, la, lo)) if lat is not None else None
        if d is not None and d > 40000:
            continue
        out.append({"id": f"{p.get('osm_type', 'x')}{p.get('osm_id', '')}".lower(), "nome": nome, "categoria": p.get("osm_value", "lugar"),
                    "lat": la, "lon": lo, "endereco": _endereco(p), "horario": "", "acesso_cadeira": "", "distancia_m": d})
    if lat is not None:
        out.sort(key=lambda x: x["distancia_m"])
    return out[:limite]


def onde_estou(lat: float, lon: float) -> dict:
    r = requests.get(f"{PHOTON}/reverse", params={"lat": lat, "lon": lon, "limit": 1}, timeout=6, headers=UA)
    r.raise_for_status()
    f = (r.json().get("features") or [{}])[0]
    p = f.get("properties", {})
    rua = p.get("street") or (p.get("name") if p.get("osm_key") == "highway" else None)
    return {"rua": rua, "bairro": p.get("district") or p.get("locality"), "cidade": p.get("city"),
            "texto": ", ".join(x for x in (rua, p.get("district") or p.get("locality"), p.get("city")) if x)}
