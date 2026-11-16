"""Executa o pipeline de ponta a ponta sem Airflow (mesmas funções da DAG).

    python -m pipeline.run                 # tudo
    python -m pipeline.run --sem-extrair   # reaproveita a camada bronze
    python -m pipeline.run --publicar ../caminho-livre/api/dados
"""
from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

from . import config, extrair, modelar, qualidade, tratar

ETAPAS_EXTRACAO = [extrair.extrair_osm, extrair.extrair_pois, extrair.extrair_elevacao, extrair.extrair_clima]
ETAPAS = [tratar.tratar_rede, tratar.tratar_pois, modelar.modelar_grafo, modelar.modelar_lugares,
          modelar.gerar_relatos, qualidade.verificar_gold]
ARTEFATOS = ["grafo.json", "lugares.json", "relatos_seed.json", "qualidade.json"]


def publicar(destino: str) -> list[str]:
    """Copia os artefatos gold para a API (contrato de integração)."""
    d = Path(destino)
    d.mkdir(parents=True, exist_ok=True)
    for nome in ARTEFATOS:
        shutil.copy2(config.GOLD / nome, d / nome)
    return [str(d / n) for n in ARTEFATOS]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sem-extrair", action="store_true")
    ap.add_argument("--publicar", default=None)
    ap.add_argument("--so", default=None, help="roda só as etapas com esses nomes (vírgula)")
    args = ap.parse_args()
    etapas = ([] if args.sem_extrair else ETAPAS_EXTRACAO) + ETAPAS
    if args.so:
        nomes = set(args.so.split(","))
        etapas = [e for e in ETAPAS_EXTRACAO + ETAPAS if e.__name__ in nomes]
    for etapa in etapas:
        t = time.time()
        r = etapa()
        print(f"[{etapa.__module__.split('.')[-1]}.{etapa.__name__}] {time.time() - t:.1f}s ->",
              json.dumps(r, ensure_ascii=False) if not isinstance(r, str) else r, flush=True)
    if args.publicar:
        print("publicado:", publicar(args.publicar))


if __name__ == "__main__":
    main()
