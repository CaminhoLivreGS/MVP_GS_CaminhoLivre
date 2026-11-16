# Plano: rotas e locais acessíveis (ex.: "Shopping União")

> **Revisão: só APIs gratuitas, sem cartão de crédito.** Google Places foi removido.
> Recursos do local passam a vir das tags do OSM (`wheelchair`, `toilets:wheelchair`, `parking_space=disabled`) + accessibility.cloud.
> Autocomplete: ORS Geocode, com Photon como alternativa (o Nominatim proíbe autocomplete na política de uso; fica só para busca ao confirmar).

| Serviço | Chave? | Cartão? | Limite gratuito (aprox.) | Uso |
|---|---|---|---|---|
| OpenRouteService (Directions wheelchair + Geocode) | Sim, cadastro grátis | Não | ~2.000 rotas e ~1.000 buscas por dia | Rota acessível, autocomplete |
| Photon (komoot) | Não | Não | Uso moderado | Autocomplete reserva (já usamos) |
| Nominatim | Não | Não | 1 req/s, sem autocomplete | Busca reserva ao confirmar |
| Overpass (OSM) | Não | Não | Uso moderado, instável | Entradas, rampas, piso tátil, escadas, banheiro, vaga |
| accessibility.cloud | Sim, token grátis | Não | — | Avaliações colaborativas (Wheelmap) |
| Tiles OpenStreetMap | Não | Não | Uso leve, com atribuição | Mapa |


Avaliação feita em 15/11/2026 sobre o MVP atual. Cada etapa fecha sozinha: dá para parar no fim de qualquer uma sem deixar nada quebrado.

## O que já existe e será aproveitado
| Pedido | Já temos | Falta |
|---|---|---|
| Chaves fora do navegador | API FastAPI (`api/`) já faz as chamadas externas | Variáveis `ORS_API_KEY`, `ACCESSIBILITY_CLOUD_TOKEN` |
| Busca de destino | Busca por voz e texto (Photon + base do piloto) | Autocomplete com debounce de 300 ms + `AbortController` |
| Perfil | Bengala, cadeira, baixa visão, sem apoio (salvo no aparelho e usado em toda rota) | Inclinação máxima aceita (slider) |
| Rota que evita escada e ladeira | Grafo próprio no piloto; OSM ao vivo fora dele; OSRM como plano B | ORS `wheelchair` com `avoid_features: ["steps"]` e `restrictions` como fonte principal fora do piloto |
| Overpass | Usado para vias e lugares (com cache e disjuntor) | Consulta enxuta de **entradas** (raio 300 m, `out center;`) |
| Mapa | Leaflet com rota, perigos e você | Lazy load só nas telas de mapa; escadas evitadas em vermelho; rampas e piso tátil |
| Detalhes do local | Nome, endereço e horário | Entradas, recursos (Google), avaliações (Wheelmap), mapa interno (mock), fonte + confiança |

## Riscos que mudam o plano
- **Overpass** caiu várias vezes hoje (timeouts). Cache de 24 h e mock de entradas são obrigatórios, não opcionais.
- **ORS** precisa de chave gratuita (cadastro em openrouteservice.org, 2.000 rotas/dia).
- **Google Places (New)** precisa de projeto no Google Cloud **com faturamento ativo** (há crédito mensal gratuito, mas exige cartão).
- **accessibility.cloud** precisa de token gratuito (cadastro em accessibility.cloud).
- **Mapa interno do shopping** não tem API pública: será sempre mock até haver parceria com o shopping.

## Interface única dos adapters (backend)
```
getRoute(origem, destino, perfil)        -> { geometria, escadas_evitadas, avisos, fonte, confianca }
getPlaceAccessibility(lugar)             -> { entrada, estacionamento, banheiro, assentos, fonte, confianca }
getEntrances(lugar)                      -> [ { lat, lon, rampa, piso_tatil, elevador, degraus, fonte, confianca } ]
getIndoorMap(lugar)                      -> { andares, corredores, elevadores, banheiros, fonte: "mock" }
```
Cada um tem versão REAL e MOCK. Falhou (sem chave, cota, erro, vazio) → tenta 1 alternativa → usa o MOCK, marca `// TODO: integrar [API]` e o front mostra o selo discreto "dados de exemplo".
Confiança: **alta** = Google Places ou OSM com tag explícita; **média** = Wheelmap/comunidade ou OSM parcial; **baixa** = inferido; **exemplo** = mock.

## Etapas

### Etapa 1 — hoje, sem nenhuma chave (maior valor por crédito)
1. Camada de adapters no backend com as 4 interfaces e o seletor REAL/MOCK.
2. `getEntrances` REAL via Overpass enxuto (300 m, tags `entrance`, `wheelchair`, `ramp`, `ramp:wheelchair`, `tactile_paving`, `highway=steps`, `incline`, `kerb`, `[out:json][timeout:15]`, `out center;`, cache 24 h) + MOCK do Shopping União.
3. `getIndoorMap` MOCK em JSON do Shopping União.
4. `getPlaceAccessibility` e `getRoute` só com MOCK por enquanto (prontos para receber as chaves).
5. Tela **Detalhes do local**: entradas com ícones, recursos, fonte de cada dado, indicador de confiança e selo "dados de exemplo".
6. Testes da API para os adapters e o fallback.

### Etapa 2 — com a chave do ORS
1. `getRoute` REAL: ORS `wheelchair`, `avoid_features: ["steps"]`, `restrictions` (`maximum_incline`, `maximum_sloped_kerb`, `surface_type`, `smoothness_type`) a partir do perfil.
2. Cache por par origem/destino arredondado (4 casas, ~11 m).
3. Ordem de rota: grafo próprio (piloto) → ORS → OSRM (sem acessibilidade, com aviso).
4. Perfil: slider de inclinação máxima.

### Etapa 3 — mapa e busca
1. Lazy load do Leaflet (só nas telas com mapa); rota primeiro, pontos de interesse depois.
2. Escadas evitadas em vermelho, rampas e piso tátil marcados no mapa.
3. Autocomplete com debounce de 300 ms e `AbortController`.

### Etapa 4 — recursos do local pelo OSM (sem chave)
1. `getPlaceAccessibility` REAL via Overpass: `wheelchair`, `toilets:wheelchair`, `parking_space=disabled`, cache 24 h.
2. Entradas com fallback OSM → accessibility.cloud → mock.

### Etapa 5 — com o token do accessibility.cloud
1. Avaliações colaborativas (`/place-infos`, filtro `at-least-partially-accessible-by-wheelchair`).
2. Tabela final de adapters (real/mock/parcial) e o que falta para cada mock virar dado real.

## O que você precisa providenciar (para as etapas 2, 4 e 5)
- Chave ORS → `api/.env`: `ORS_API_KEY=`
- Token accessibility.cloud → `ACCESSIBILITY_CLOUD_TOKEN=`
Nunca cole as chaves no chat: coloque direto no `api/.env` (já está no `.gitignore`).
