"""Ingestão (camada bronze): baixa as fontes públicas e grava a resposta bruta.

Fontes:
  - OpenStreetMap (Overpass API): vias de pedestre, travessias, guias,
    escadas, piso, iluminação, pontos de interesse e cursos d'água.
  - Open-Meteo Elevation (Copernicus DEM GLO-90): altitude numa grade regular.
  - Open-Meteo Forecast: chuva prevista por hora (próximas 24 h).

Cada arquivo bronze traz metadados de coleta (_coletado_em, _fonte) para
rastreabilidade. As funções são idempotentes: rodar de novo sobrescreve.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import requests

from . import config

VIAS_PEDESTRE = (
    "footway|pedestrian|path|steps|living_street|residential|service|tertiary|"
    "tertiary_link|secondary|secondary_link|primary|primary_link|unclassified|"
    "track|corridor|cycleway"
)


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _overpass(consulta: str) -> dict:
    erros = []
    for url in config.OVERPASS_URLS:
        for tentativa in range(3):
            try:
                r = requests.post(url, data={"data": consulta}, timeout=180,
                                  headers={"User-Agent": config.USER_AGENT})
                if r.status_code == 200:
                    return r.json()
                erros.append(f"{url}: HTTP {r.status_code}")
                if r.status_code in (429, 504):
                    time.sleep(10 * (tentativa + 1))
                    continue
                break
            except requests.RequestException as e:
                erros.append(f"{url}: {e.__class__.__name__}")
                time.sleep(5)
    raise RuntimeError("Overpass indisponível: " + " | ".join(erros))


def _gravar(nome: str, fonte: str, dados) -> str:
    caminho = config.BRONZE / nome
    caminho.write_text(json.dumps({"_fonte": fonte, "_coletado_em": _agora(),
                                   "_territorio": config.TERRITORIO, "dados": dados},
                                  ensure_ascii=False), encoding="utf-8")
    return str(caminho)


def extrair_osm() -> str:
    s, w, n, e = config.TERRITORIO["bbox"]
    bbox = f"{s},{w},{n},{e}"
    consulta = f"""
[out:json][timeout:170];
(
  way["highway"~"^({VIAS_PEDESTRE})$"]["access"!~"private|no"]["foot"!~"no"]({bbox});
  way["highway"~"^(trunk|trunk_link)$"]["sidewalk"~"both|left|right|yes"]({bbox});
)->.vias;
.vias out body;
node(w.vias)->.nos;
.nos out body;
"""
    return _gravar("osm_vias.json", "OpenStreetMap via Overpass API (ODbL)", _overpass(consulta))


def extrair_pois() -> str:
    s, w, n, e = config.TERRITORIO["bbox"]
    bbox = f"{s},{w},{n},{e}"
    consulta = f"""
[out:json][timeout:120];
(
  nwr["amenity"~"^(clinic|doctors|hospital|pharmacy|school|place_of_worship|marketplace|social_facility|community_centre|townhall|bank|post_office|library)$"]({bbox});
  nwr["healthcare"]({bbox});
  nwr["shop"~"^(supermarket|bakery)$"]({bbox});
  nwr["railway"="station"]({bbox});
  nwr["public_transport"="station"]({bbox});
  node["highway"="bus_stop"]({bbox});
  nwr["leisure"="park"]["name"]({bbox});
);
out center tags;
way["waterway"~"^(river|stream|canal|drain)$"]({bbox});
out geom tags;
"""
    return _gravar("osm_pois.json", "OpenStreetMap via Overpass API (ODbL)", _overpass(consulta))


def extrair_elevacao() -> str:
    s, w, n, e = config.TERRITORIO["bbox"]
    k = config.GRADE_ELEVACAO
    pontos = [(s + (n - s) * i / (k - 1), w + (e - w) * j / (k - 1)) for i in range(k) for j in range(k)]
    altitudes: list[float] = []
    for ini in range(0, len(pontos), 100):
        lote = pontos[ini:ini + 100]
        params = {"latitude": ",".join(f"{p[0]:.5f}" for p in lote),
                  "longitude": ",".join(f"{p[1]:.5f}" for p in lote)}
        for tentativa in range(4):
            r = requests.get(config.OPEN_METEO_ELEVACAO, params=params, timeout=60,
                             headers={"User-Agent": config.USER_AGENT})
            if r.status_code == 200:
                altitudes.extend(r.json()["elevation"])
                break
            time.sleep(65)  # 429: o limite gratuito é por minuto
        else:
            raise RuntimeError(f"Open-Meteo elevação: HTTP {r.status_code}")
        # A Open-Meteo conta cada coordenada como uma chamada (600/min no
        # plano gratuito): 100 coordenadas a cada 12 s ficam abaixo do limite.
        time.sleep(12)
    return _gravar("elevacao_grade.json", "Open-Meteo Elevation API (Copernicus DEM GLO-90)",
                   {"grade": k, "bbox": config.TERRITORIO["bbox"], "altitudes_m": altitudes})


def extrair_clima() -> str:
    lat, lon = config.TERRITORIO["centro"]
    r = requests.get(config.OPEN_METEO_PREVISAO, timeout=30, params={
        "latitude": lat, "longitude": lon, "timezone": "America/Sao_Paulo", "forecast_days": 2,
        "hourly": "precipitation,precipitation_probability,temperature_2m,weather_code",
    }, headers={"User-Agent": config.USER_AGENT})
    r.raise_for_status()
    return _gravar("clima.json", "Open-Meteo Forecast API", r.json())
