"""Previsão de chuva ao vivo (Open-Meteo, sem chave) com cache de 30 min."""
from __future__ import annotations

import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from .config import FUSO

URL = "https://api.open-meteo.com/v1/forecast"
CHUVA_FORTE_MM_H = 5.0     # INMET: chuva forte a partir de ~5 mm/h
CHUVA_MM_H = 1.0
JANELA_H = 6
_cache: dict = {}
_lock = threading.Lock()


def _buscar(lat: float, lon: float) -> dict:
    r = requests.get(URL, timeout=8, params={
        "latitude": lat, "longitude": lon, "timezone": FUSO, "forecast_days": 2,
        "hourly": "precipitation,precipitation_probability", "current": "temperature_2m,precipitation"})
    r.raise_for_status()
    return r.json()


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
    base = {"disponivel": True, "simulado": False, "fonte": "Open-Meteo",
            "temperatura_c": (c["dados"].get("current") or {}).get("temperature_2m")}
    if pico and pico[1] >= CHUVA_FORTE_MM_H:
        return {**base, "chuva_forte_proximas_h": True, "nivel": "forte", "hora": f"{pico[0].hour}h", "mm_h": pico[1],
                "texto": f"Chuva forte às {pico[0].hour}h. Vou desviar de ruas que alagam."}
    if pico and pico[1] >= CHUVA_MM_H:
        return {**base, "chuva_forte_proximas_h": False, "nivel": "moderada", "hora": f"{pico[0].hour}h", "mm_h": pico[1],
                "texto": f"Pode chover às {pico[0].hour}h. Leve guarda-chuva."}
    return {**base, "chuva_forte_proximas_h": False, "nivel": "sem_chuva", "texto": None}
