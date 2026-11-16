"""DAG do Airflow: pipeline de dados do Caminho Livre.

    extrair_osm ─┐
    extrair_pois ┼─► tratar_rede ─► modelar_grafo ─┐
    extrair_elev ┘   tratar_pois ─► modelar_lugares ┼─► gerar_relatos ─► verificar_qualidade ─► publicar_api
    extrair_clima ───────────────────────────────────────────────────────────────────────────────┘

Rede e lugares: semanal (o OSM muda devagar). Clima: a API consulta a
Open-Meteo ao vivo; a extração aqui só guarda o histórico na bronze.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta

from airflow import DAG
from airflow.operators.python import PythonOperator

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from pipeline import extrair, modelar, qualidade, run, tratar  # noqa: E402

PADRAO = {"owner": "caminho-livre", "retries": 2, "retry_delay": timedelta(minutes=5)}
DESTINO_API = os.getenv("CL_DESTINO_API", "/opt/airflow/publicado")

with DAG(
    dag_id="caminho_livre_pipeline",
    description="OSM + relevo + clima -> grafo de acessibilidade para a API do Caminho Livre",
    schedule="@weekly",
    start_date=datetime(2026, 11, 1),
    catchup=False,
    default_args=PADRAO,
    tags=["caminho-livre", "citizentech"],
) as dag:
    t = {f.__name__: PythonOperator(task_id=f.__name__, python_callable=f) for f in (
        extrair.extrair_osm, extrair.extrair_pois, extrair.extrair_elevacao, extrair.extrair_clima,
        tratar.tratar_rede, tratar.tratar_pois, modelar.modelar_grafo, modelar.modelar_lugares,
        modelar.gerar_relatos, qualidade.verificar_gold)}
    publicar = PythonOperator(task_id="publicar_api", python_callable=run.publicar, op_args=[DESTINO_API])

    [t["extrair_osm"], t["extrair_elevacao"]] >> t["tratar_rede"] >> t["modelar_grafo"]
    t["extrair_pois"] >> t["tratar_pois"] >> t["modelar_lugares"]
    [t["modelar_grafo"], t["modelar_lugares"]] >> t["gerar_relatos"] >> t["verificar_gold"]
    [t["verificar_gold"], t["extrair_clima"]] >> publicar
