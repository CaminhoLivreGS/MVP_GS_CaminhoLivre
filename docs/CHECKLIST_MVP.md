# Checklist do MVP Caminho Livre (atualizado em 16/11/2026, 23h)

Prazo da GS: **19/11, 23h55**. Este checklist substitui a visão geral do [`PENDENCIAS.md`](PENDENCIAS.md), que continua valendo para os detalhes técnicos.

**Legenda**
- **REAL**: chama API ou dado real (OSM, Open-Meteo, OpenRouter, ORS) ou roda com usuário de verdade.
- **MOCK**: dado de exemplo assumido. Aparece no app com o selo "dados de exemplo" e é citado no pitch como próximo passo.
- **TESTE**: precisa de evidência (teste automatizado, print, vídeo ou teste com pessoa).
- `[x]` pronto · `[ ]` falta

Regra para a banca: **nada mockado pode parecer real.** Todo mock tem selo no app, a palavra "simulado" no relatório e uma linha "para virar real" abaixo.

---

## 1. Núcleo do app (pronto)

| | Item | Tipo | Evidência |
|---|---|---|---|
| [x] | Localização: GPS com filtro de precisão, motor de navegação, recálculo fora da rota | REAL | `test/localizacao.test.js` |
| [x] | Caminhada simulada (para a banca, que não está em Osasco) | MOCK | Selo de demo na tela |
| [x] | Perfil (bengala, cadeira, baixa visão, sem apoio), voz, vibração, tamanho da letra | REAL | E2E |
| [x] | Clima ao vivo (Open-Meteo); `?chuva=simular` / `?chuva=nao` para demo | REAL + MOCK opcional | E2E |
| [x] | Destino por voz/texto (Web Speech + Photon + base do piloto) | REAL | `test_api.py` |
| [x] | Rota por perfil: grafo próprio no piloto, OSM ao vivo fora dele, OSRM como reserva com aviso | REAL | `test_api.py` |
| [x] | Mapa Leaflet com tiles OSM | REAL | Falta provedor com SLA (ver 8) |
| [x] | Avisar problema: câmera, visão OpenCV sugere, pessoa decide, rostos/placas borrados | REAL | E2E com câmera falsa |
| [x] | Relatos da comunidade (32 relatos semeados) | MOCK | `relatos_seed.json`, campo `origem` |
| [x] | Assistente de IA (destino, rota, ajuda, chamado) com reserva por regras | REAL com chave / regras sem | `test_api.py` |
| [x] | Endpoints do robô de RPA (`/api/chamados/*`) com token | REAL | `test_api.py` |
| [x] | Testes: front 33/33, API **28/28** e E2E no Chrome (8 passos) em 16/11 | TESTE | `npm test`, `pytest` |
| [x] | Clima com calor, UV e qualidade do ar | REAL | Open-Meteo Forecast + Air Quality |
| [x] | Rota fora do piloto com o ORS (cadeira de rodas: sem escada, inclinação ≤ 6%) quando o OSM ao vivo falha | REAL | Chave no servidor |

## 2. Funcionalidade nova: melhor entrada e saída do local (implementada)

Plano técnico em [`PLANO_ACESSIBILIDADE_LOCAL.md`](PLANO_ACESSIBILIDADE_LOCAL.md). Prédio do piloto: **Shopping União de Osasco**, com 4 entradas de EXEMPLO nas bordas reais do prédio (contorno do OSM) em `api/dados/locais_detalhados.json`. Demonstração reproduzível à noite: `?hora=15:00`.

### 2.1 Dados das entradas
- [x] **REAL**: entradas via Overpass (raio 300 m; tags `entrance`, `wheelchair`, `door`, `step_count`, `ramp`, `width`, `opening_hours`), com cache de 24 h e disjuntor.
- [ ] **REAL (coleta manual)**: levantamento em campo (trocar `fonte: "exemplo"`) do prédio escolhido, com foto, degraus, rampa, tipo de porta, largura, horário e coordenada de cada entrada. Vai para `api/dados/entradas_<local>.json` com `fonte: "levantamento_equipe"`.
- [ ] **MOCK**: cadastro pelo estabelecimento (hoje, edição do JSON) (`POST /api/locais/{id}/entradas`). Endpoint real com token, mas os dados vêm de seed, porque não há shopping parceiro.
- [x] Ordem levantamento/exemplo → OSM, campo `fonte` e `confianca` em cada entrada.

### 2.2 Escolha da entrada (chegando)
- [x] Filtro por perfil: degraus sem rampa, porta giratória, largura < 80 cm (cadeira), fechada no horário.
- [x] Nota = custo da rota + qualidades (porta automática, piso tátil, cobertura).
- [x] **REAL com chave**: ORS Matrix (origem → todas as entradas numa chamada). **Sem chave**: o grafo próprio calcula as N rotas (o piloto já suporta).
- [x] Explicação por voz (regra fiel aos dados) citando a alternativa descartada ("a principal tem escada, vou pela lateral"), feita pelo assistente (REAL) e com texto por regra como reserva.
- [x] A rota passa a terminar na entrada escolhida, e não no centro do prédio.

### 2.3 Saída ("estou saindo")
- [x] Botão "estou saindo" na tela do local, com a pergunta "para onde?" (casa, ponto de ônibus, táxi).
- [x] **REAL**: a pessoa escreve onde está ("perto da praça de alimentação") e a IA associa a frase a um ponto interno cadastrado.
- [x] **MOCK**: pontos internos (praça, biblioteca, bloco B) e "melhor saída a partir de cada um", em JSON do prédio mapeado. Não existe API pública de mapa interno.
- [x] **REAL (peça do Maker Lab)**: QR code no ponto interno lido pela câmera (`BarcodeDetector` nativo, com `jsQR` como reserva).
- [x] `GET /api/locais/saida?local&ponto_interno&destino&perfil`.

### 2.4 Comunidade e acompanhante
- [x] **REAL**: novo tipo de relato "entrada" (foto + ícones: degrau? rampa? porta automática?), passando pela anonimização e confirmação que já existem.
- [x] **REAL**: compartilhamento nativo do celular na chegada (WhatsApp/SMS/e-mail, a pessoa envia) para o acompanhante (rota pronta, sem login).
- [ ] **MOCK**: acompanhamento ao vivo da localização e aviso de chegada. Fica como próximo passo; hoje abre um SMS pronto.

### 2.5 Tela e testes
- [x] Cartão da entrada: entradas com ícones, fonte, confiança e selo "dados de exemplo" quando for mock.
- [x] Testes da API: filtro por perfil, escolha da entrada, horário fechado e fallback Overpass fora do ar → mock.
- [x] E2E: "estou saindo do cinema do Shopping União" (Chrome sem interface).

## 3. Pendências do app atual (`TODO: integrar` no código)

| | Item | Tipo hoje | Decisão para a entrega |
|---|---|---|---|
| [x] | Avaliação Bom/Ruim persistida (`api/app/main.py:386`) | só métrica | **Fazer REAL** (tabela SQLite): o BI precisa desse número |
| [x] | Fila de moderação de relatos INCONCLUSIVOS (`relatos.py:198`) | entra como "em verificação" | **Fazer REAL simples** (lista + aprovar/rejeitar com token) |
| [ ] | Lugares salvos pelo usuário (`App.jsx:105`) | UBS/estação mais próximas | Fazer REAL no aparelho (localStorage) |
| [ ] | "Ver no mapa" da Novidade (`App.jsx:237`) | fecha a tela | Fazer (reaproveita `Mapa.jsx`) |
| [ ] | Categorias rampa/iluminação na visão (`Avisar.jsx:25`) | sem sugestão automática | **MOCK assumido**: a pessoa escolhe manualmente |
| [x] | Aviso ao acompanhante | Compartilhamento nativo (a pessoa envia) | REAL, sem envio automático (LGPD) |
| [ ] | PWA offline / service worker (`main.jsx:8`) | só manifest | Fazer se sobrar tempo (última rota em cache) |
| [ ] | Fala → texto sem Web Speech (`voz.js:102`) | cai para digitação | MOCK assumido: digitação como reserva |
| [x] | Tiles com chave (`Mapa.jsx`) | **REAL**: MapTiler (claro/escuro, retina), reserva automática no OSM | Chave em `.env.local` (`VITE_MAPTILER_KEY`) e no Render; restringir domínios no painel da MapTiler |
| [ ] | Semáforo sonoro | 0 no OSM do território | Dado real ausente: mapear 2–3 no OSM durante o teste de campo |

## 4. Chaves e APIs reais a ativar

- [x] `OPENROUTER_API_KEY` no `api/.env` (falta no Render) (sem ela, a IA responde por regras)
- [x] `ORS_API_KEY` no `api/.env`, ligado no código (falta no Render): rota wheelchair fora do piloto e matriz de entradas
- [ ] `ACCESSIBILITY_CLOUD_TOKEN` (opcional): avaliações do Wheelmap
- [ ] `CL_RPA_TOKEN` compartilhado com quem faz o robô UiPath
- [ ] Conferir o deploy do Render (ver `docs/SEGURANCA.md` §5) no ar com HTTPS (GPS, câmera e microfone exigem HTTPS no celular)

## 5. Testes de verdade (com pessoas e no território)

Isto é o que sustenta "valor evidenciado" no BI e no pitch.

- [ ] **Teste de campo 1**: rota na Vila Yara/Centro de Osasco com o GPS real, sem caminhada simulada. Gravar a tela e anotar o tempo previsto contra o real.
- [ ] **Teste de campo 2**: entrada/saída do prédio mapeado, comparando o tempo pela entrada indicada pelo app com o tempo pela entrada principal.
- [ ] **Teste com usuários** (mínimo 3–5 pessoas, idealmente 1 com mobilidade reduzida ou acompanhante): roteiro de tarefas, tempo, erros e nota de 1 a 5. Termo de consentimento simples (LGPD).
- [ ] Relatos reais: pelo menos 5 relatos feitos em campo, marcados `origem: "campo"`, para separar dos 32 simulados.
- [ ] Teste em celular de entrada (Android antigo, 3G simulado no DevTools): tempo de abertura e de análise da foto.
- [ ] Acessibilidade: leitor de tela (TalkBack/VoiceOver) nas telas principais e contraste no tema Contraste.
- [ ] Planilha de resultados (antes/depois) para o BI e o pitch.

## 6. Por disciplina / repositório

**Big Data (`caminho-livre-dados`)**
- [ ] Commitar o pipeline, a DAG e os docs (estão só no clone local) junto com o merge do Airflow/PostGIS de hoje
- [ ] Subir `docker compose up` (Airflow + PostGIS), rodar a DAG e tirar os prints. Trocar o usuário `admin/admin` do compose.
- [ ] Incluir a extração de entradas (Overpass) no pipeline, publicando em `api/dados/`
- [ ] `pipeline-dados/tests` está vazio: criar ao menos testes da qualidade e do modelar

**Visão computacional (`caminho-livre`)**
- [ ] Commitar a migração para React (está local) e apagar as cópias `* 2.jsx` / `* 2.js`
- [ ] Dataset brasileiro de teste (fotos de campo) com taxa de acerto por categoria

**IA generativa (`GS_Generative_AI_for_Engineering`)**
- [ ] Prompt de "explicar a escolha da entrada" e de "onde estou dentro do prédio", com a mesma avaliação dos prompts V2
- [ ] Prints do app usando a IA (Ajuda, destino por voz)

**RPA (UiPath)**
- [ ] Robô: ler pendentes → humano aprova → preencher SP156/Osasco → gravar protocolo (`MOCK` do portal se o real bloquear robô)
- [ ] BPMN As-Is/To-Be e vídeo

**Secure DevOps & Cloud**
- [x] Análise de segurança com correções e testes: [`SEGURANCA.md`](SEGURANCA.md)
- [x] Workflow que mantém o app acordado (`manter-acordado.yml`; precisa da variável `APP_URL`)
- [x] Pipeline DevSecOps, Terraform Azure, observabilidade (no repo `caminho-livre`)
- [x] Observabilidade e ajustes de imagem trazidos para o MVP (16/11)
- [ ] Testar `docker compose` do MVP numa máquina com Docker (não testado até agora)
- [ ] Scrape do `/metrics` da API no Prometheus + painel no Grafana

**BI & Startup**
- [ ] Lean Canvas e modelo de negócio (B2G prefeitura + B2B selo "entrada verificada" para shoppings e universidades)
- [ ] Indicadores com os números dos testes da seção 5
- [ ] Roteiro do pitch: preencher os colchetes com os resultados reais

**Maker Lab**
- [ ] Suporte tátil do QR code interno (altura certa, relevo) ou rampa portátil para entrada com um degrau

## 7. Entrega final
- [ ] Commit e push no `MVP_GS_CaminhoLivre` (atualizações de 16/11 ainda não commitadas)
- [ ] README do MVP com a tabela REAL × MOCK desta página
- [ ] Vídeo da demo: Home → destino por voz → rota com desvio → chegada pela melhor entrada → avisar problema → "estou saindo"
- [ ] Relatório/PDF com prints, resultados dos testes e limitações declaradas

## 8. O que fica MOCK na entrega (e como vira real)

| Mock | Por quê | Para virar real |
|---|---|---|
| Caminhada simulada | Banca fora do território | Já é real com o GPS dentro da área |
| 32 relatos semeados | App sem usuários | Uso real + relatos de campo (`origem: "campo"`) |
| Cadastro de entradas pelo estabelecimento | Sem parceiro | Piloto com 1 shopping/universidade (modelo B2B) |
| Mapa interno / pontos internos | Não há API pública | Parceria + QR codes instalados |
| Acompanhamento ao vivo | LGPD + sem backend de notificação | Push/WhatsApp com consentimento |
| Portal SP156 no RPA (se bloqueado) | Portal real não aceita teste | Convênio com a prefeitura |
| Sugestão automática de rampa/iluminação | Visão clássica não cobre bem | Modelo treinado com as fotos de campo |
