# Dicionário de dados

## Silver (`data/silver/*.parquet`)

### nos.parquet
| Coluna | Tipo | Descrição | Origem |
|---|---|---|---|
| id | int64 | ID do nó no OSM | OSM |
| lat, lon | float64 | Coordenadas WGS84 | OSM |
| altitude_m | float64 | Altitude do terreno (grade 40x40 suavizada 3x3, interpolação bilinear) | Open-Meteo / Copernicus GLO-90 |
| travessia | bool | `highway=crossing/traffic_signals` ou tag `crossing` | OSM |
| semaforo | bool | Semáforo na travessia | OSM |
| sonoro | bool | `traffic_signals:sound=yes` | OSM |
| guia | str/null | `rebaixada` (kerb=lowered/flush) ou `elevada` (kerb=raised) | OSM |
| piso_tatil | bool/null | `tactile_paving` | OSM |

### arestas.parquet (um registro por par de nós consecutivos de uma via)
| Coluna | Tipo | Descrição |
|---|---|---|
| u, v | int64 | Nós (ids OSM) |
| via_id | int64 | ID da via OSM |
| nome | str | Nome da rua ("" se sem nome; "faixa de pedestres" em travessias) |
| tipo_via | str | Tag `highway` |
| comprimento_m | float | Haversine entre u e v |
| superficie | str | `boa` · `irregular` · `ruim` · `sem_dado` (regras em `tratar.SUPERFICIE`; `smoothness` ruim rebaixa) |
| calcada | str | `sim` · `nao` · `sem_dado` (footway/pedestrian = sim; tag `sidewalk`) |
| iluminacao | str | `sim` · `nao` · `sem_dado` (tag `lit`) |
| escada | bool | `highway=steps` |
| travessia | bool | `footway=crossing` |
| inclinacao_pct | float | Tag `incline` se existir; senão `|Δaltitude| / comprimento`, limitada a 30% |
| inclinacao_fonte | str | `osm` ou `relevo` |

### pois.parquet
| Coluna | Descrição |
|---|---|
| id | `n`/`w`/`r` + id OSM |
| nome, nome_busca | Nome e versão normalizada (minúsculas, sem acento) |
| categoria | ubs · hospital · clinica · farmacia · estacao · ponto_onibus · escola · mercado · igreja · parque · servico |
| lat, lon, endereco, horario, acesso_cadeira | OSM (`addr:*`, `opening_hours`, `wheelchair`) |

### aguas.parquet
Pontos amostrados dos cursos d'água (`waterway=river|stream|canal|drain`) para estimar zona de alagamento.

## Gold (contrato com a API — `caminho-livre/api/app/grafo.py`)

### grafo.json (versao 1, formato colunar)
- `meta`: território, data de geração, fontes, códigos, `demo` (Casa e destino da demonstração).
- `nomes[]`, `tipos[]`: tabelas de texto referenciadas por índice.
- `nos`: `osm[]`, `lat[]`, `lon[]`, `alt[]`, `flags[]` — bits: 1 travessia, 2 semáforo, 4 sonoro, 8 guia rebaixada, 16 guia elevada, 32 piso tátil, **64 zona de alagamento**.
- `arestas`: `u[]`, `v[]` (índices em `nos`), `comp[]`, `nome[]`, `tipo[]`, `sup[]` (0 boa, 1 irregular, 2 ruim, 3 sem dado),
  `calc[]`/`ilum[]` (0 sim, 1 não, 2 sem dado), `esc[]`, `trav[]`, `inc[]`.

**Zona de alagamento (heurística):** nó a até 80 m de curso d'água, ou entre os 15% mais baixos do território e a até 250 m.
Usada pela API só quando a previsão indica chuva forte (≥ 5 mm/h nas próximas 6 h).

### lugares.json
`{"lugares": [...]}` com as colunas de `pois.parquet`.

### relatos_seed.json
Relatos **simulados** (ver `dados_simulados.md`): `id, categoria, status, confirmacoes, lat, lon, rua, lado_seguro, criado_em, origem`.

### qualidade.json
Indicadores de cobertura e contagens da execução (ver README).

**Mudou o formato?** Suba `versao` em `modelar.py` e avise o time da API.
