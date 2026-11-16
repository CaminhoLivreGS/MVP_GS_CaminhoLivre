# caminho-livre-dados

Pipeline de dados do **Caminho Livre** (GS 2026.2 · Big Data Architecture & Data Integration).
Transforma dados públicos (OpenStreetMap, relevo e clima da Open-Meteo) num **grafo de acessibilidade para pedestres**
da Vila Yara e do Centro de Osasco (SP), consumido pela API do MVP (`caminho-livre/api`).

## Arquitetura (medalhão)

```
 Overpass API (OSM) ──► bronze/osm_vias.json, osm_pois.json ─┐
 Open-Meteo Elevation ─► bronze/elevacao_grade.json ─────────┼─► silver/nos, arestas, pois, aguas (.parquet)
 Open-Meteo Forecast ──► bronze/clima.json                   │        │
                                                             │        ▼
                                                             └─► gold/grafo.json, lugares.json,
                                                                      relatos_seed.json, qualidade.json
                                                                        │  verificar_gold (barra dado ruim)
                                                                        ▼
                                                    publicar_api ─► caminho-livre/api/dados/
```

| Etapa | Arquivo | O que faz |
|---|---|---|
| Ingestão (bronze) | `src/pipeline/extrair.py` | Baixa a resposta bruta com metadados de coleta (fonte, data, território) |
| Tratamento (silver) | `src/pipeline/tratar.py` | Recorta no território, normaliza piso/calçada/iluminação, calcula altitude e inclinação |
| Modelagem (gold) | `src/pipeline/modelar.py` | Maior componente conectada, zonas de alagamento, formato colunar compacto, relatos simulados |
| Qualidade | `src/pipeline/qualidade.py` | Falha o pipeline se o grafo vier pequeno, fora do território ou com valores implausíveis |
| Orquestração | `dags/caminho_livre_dag.py` | DAG do Airflow (semanal) com as mesmas funções |

## Como rodar

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd src
python -m pipeline.run --publicar ../../api/dados   # tudo (~5 min: a Open-Meteo limita 600 coordenadas/min)
python -m pipeline.run --sem-extrair --publicar ../../api/dados   # reaproveita a bronze
```

Com Airflow: copie `dags/` e `src/` para o Airflow e defina `CL_DESTINO_API` (pasta de publicação).

## Execução de 15/11/2026 (números reais)

```json
{
 "nos_total_extraidos": 13723,
 "nos_maior_componente": 13092,
 "arestas": 14763,
 "extensao_km": 374.9,
 "cobertura_pct": {
  "superficie": 60.8,
  "calcada": 14.5,
  "iluminacao": 24.1,
  "inclinacao_tag_osm": 0.0
 },
 "travessias": 818,
 "semaforos": 177,
 "semaforos_sonoros": 0,
 "escadas_trechos": 42,
 "nos_zona_alagamento": 2696,
 "inclinacao_media_pct": 2.65,
 "trechos_inclinacao_maior_8pct": 328
}
```

Leitura honesta: o OSM do território tem boa cobertura de piso (61%), mas pouca de calçada (15%) e iluminação (24%),
e **nenhum semáforo sonoro mapeado**. Por isso a API avisa "não tenho informação confirmada" nesses trechos, e por isso os relatos da comunidade são essenciais.

Documentação: [dicionário de dados](docs/dicionario_de_dados.md) · [dados simulados](docs/dados_simulados.md).
