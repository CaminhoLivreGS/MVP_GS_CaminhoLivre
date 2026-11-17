"""Previsão de chuva, calor, UV e qualidade do ar ao vivo (Open-Meteo, sem chave), cache de 30 min."""
from __future__ import annotations

import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from .config import FUSO

URL = "https://api.open-meteo.com/v1/forecast"
URL_AR = "https://air-quality-api.open-meteo.com/v1/air-quality"
CALOR_SENSACAO_C = 32.0    # sensação térmica de alerta para idosos (INMET/OMS: estresse térmico)
UV_MUITO_ALTO = 8          # OMS: 8-10 muito alto
AQI_RUIM = 101             # US AQI: 101+ ruim para grupos sensíveis
CHUVA_FORTE_MM_H = 5.0     # INMET: chuva forte a partir de ~5 mm/h
CHUVA_MM_H = 1.0
JANELA_H = 6
_cache: dict = {}
_lock = threading.Lock()


def _buscar(lat: float, lon: float) -> dict:
    r = requests.get(URL, timeout=8, params={
        "latitude": lat, "longitude": lon, "timezone": FUSO, "forecast_days": 2,
        "hourly": "precipitation,precipitation_probability", "current": "temperature_2m,precipitation,apparent_temperature,uv_index"})
    r.raise_for_status()
    dados = r.json()
    try:  # qualidade do ar é complemento: se falhar, segue sem
        a = requests.get(URL_AR, timeout=6, params={"latitude": lat, "longitude": lon, "current": "us_aqi,pm2_5"})
        a.raise_for_status()
        dados["ar"] = a.json().get("current") or {}
    except requests.RequestException:
        dados["ar"] = {}
    return dados


def alertas_saude(dados: dict) -> list[dict]:
    """Calor, sol forte e ar ruim: avisos para quem anda devagar ou é do grupo de risco."""
    cur, ar, out = dados.get("current") or {}, dados.get("ar") or {}, []
    sens, uv, aqi = cur.get("apparent_temperature"), cur.get("uv_index"), ar.get("us_aqi")
    if sens is not None and sens >= CALOR_SENSACAO_C:
        out.append({"tipo": "calor", "valor": sens,
                    "texto": f"Calor forte agora, sensação de {round(sens)} graus. Leve água e prefira a sombra."})
    if uv is not None and uv >= UV_MUITO_ALTO:
        out.append({"tipo": "uv", "valor": uv, "texto": f"Sol muito forte, índice UV {round(uv)}. Use chapéu e protetor."})
    if aqi is not None and aqi >= AQI_RUIM:
        out.append({"tipo": "ar", "valor": aqi, "texto": "O ar está ruim agora. Se tiver asma, evite caminhar muito."})
    return out


def resumo(lat: float, lon: float, simular_chuva: bool = False) -> dict:
    agora = datetime.now(ZoneInfo(FUSO))
    if simular_chuva:
        hora = (agora.hour + 1) % 24
        return {"disponivel": True, "simulado": True, "chuva_forte_proximas_h": True, "nivel": "forte",
                "hora": f"{hora}h", "mm_h": 12.0,
                "texto": f"Chuva forte às {hora}h. Vou desviar de ruas que alagam.", "fonte": "simulação de demonstração"}
    chave = (round(lat, 2), round(lon, 2))
    with _lock:
        c = _cache.get(chave)
        if not c or time.time() - c["t"] > 1800:
            try:
                c = {"t": time.time(), "dados": _buscar(lat, lon)}
                _cache[chave] = c
            except requests.RequestException:
                return {"disponivel": False, "chuva_forte_proximas_h": False, "texto": None}
    h = c["dados"]["hourly"]
    proximas = []
    for t, mm, p in zip(h["time"], h["precipitation"], h["precipitation_probability"]):
        dt = datetime.fromisoformat(t).replace(tzinfo=ZoneInfo(FUSO))
        if agora.replace(minute=0, second=0, microsecond=0) <= dt <= agora.replace(minute=0) + __import__("datetime").timedelta(hours=JANELA_H):
            proximas.append((dt, mm or 0.0, p or 0))
    pico = max(proximas, key=lambda x: x[1], default=None)
    cur = c["dados"].get("current") or {}
    alertas = alertas_saude(c["dados"])
    base = {"disponivel": True, "simulado": False, "fonte": "Open-Meteo",
            "temperatura_c": cur.get("temperature_2m"), "sensacao_c": cur.get("apparent_temperature"),
            "uv": cur.get("uv_index"), "qualidade_ar_aqi": (c["dados"].get("ar") or {}).get("us_aqi"),
            "alertas": alertas}
    if pico and pico[1] >= CHUVA_FORTE_MM_H:
        return {**base, "chuva_forte_proximas_h": True, "nivel": "forte", "hora": f"{pico[0].hour}h", "mm_h": pico[1],
                "texto": f"Chuva forte às {pico[0].hour}h. Vou desviar de ruas que alagam."}
    if pico and pico[1] >= CHUVA_MM_H:
        return {**base, "chuva_forte_proximas_h": False, "nivel": "moderada", "hora": f"{pico[0].hour}h", "mm_h": pico[1],
                "texto": f"Pode chover às {pico[0].hour}h. Leve guarda-chuva."}
    return {**base, "chuva_forte_proximas_h": False, "nivel": "sem_chuva",
            "texto": alertas[0]["texto"] if alertas else None, "alerta_tipo": alertas[0]["tipo"] if alertas else None}
