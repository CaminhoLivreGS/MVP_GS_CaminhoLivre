"""Configuração do pipeline: território, caminhos das camadas e fontes."""
from __future__ import annotations

import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
DADOS = Path(os.getenv("CL_DADOS_DIR", RAIZ / "data"))
BRONZE = DADOS / "bronze"   # resposta bruta das fontes, sem alteração
SILVER = DADOS / "silver"   # tabelas tratadas e tipadas (parquet)
GOLD = DADOS / "gold"       # artefatos prontos para o produto (JSON)

# Território do MVP: Vila Yara e Centro de Osasco (SP).
# Caixa (sul, oeste, norte, leste) com ~4 km de lado: cobre a Vila Yara,
# o Centro (hospitais, UBS Santa Maria Goretti) e as estações da CPTM.
TERRITORIO = {
    "nome": "Vila Yara e Centro, Osasco (SP)",
    "bbox": (-23.562, -46.792, -23.524, -46.750),
    "centro": (-23.5440, -46.7700),
}

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
OPEN_METEO_ELEVACAO = "https://api.open-meteo.com/v1/elevation"
OPEN_METEO_PREVISAO = "https://api.open-meteo.com/v1/forecast"
USER_AGENT = "caminho-livre-dados/1.0 (pipeline academico FIAP GS)"

# Grade de amostragem do relevo (pontos por lado). 40x40 = 1600 pontos,
# 16 chamadas de 100 coordenadas: ~100 m entre pontos, compatível com a
# resolução do modelo Copernicus DEM (90 m) usado pela Open-Meteo.
GRADE_ELEVACAO = 40

for p in (BRONZE, SILVER, GOLD):
    p.mkdir(parents=True, exist_ok=True)
