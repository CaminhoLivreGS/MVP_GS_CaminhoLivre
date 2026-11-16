# MVP Caminho Livre — o que está pronto e o que falta (15/11/2026)

Prazo da GS: **19/11, 23h55**. Busque `TODO: integrar` no código para achar cada ponto pendente.

## 1. Funcionalidades (ordem de implementação) e status

| # | Funcionalidade (página do guia visual) | Status | Como foi verificado |
|---|---|---|---|
| 1 | Sistema de localização: GPS (filtro de precisão + suavização), caminhada simulada, motor de navegação (manobras 40 m/agora, alerta a 30 m, pergunta após passar, fora da rota → recálculo, chegada) | ✅ completo | `test/localizacao.test.js` (6 testes, GPS com ruído de 15 m) + E2E |
| 2 | Boas-vindas, perfil, preferências de voz/vibração/letra (1–3) | ✅ completo | E2E |
| 3 | Início: clima ao vivo, microfone, digitar, lugares salvos, origem por GPS (4) | ✅ (lugares salvos parcial) | E2E |
| 4 | Estou ouvindo (5) | ✅ depende do navegador | Web Speech API: Chrome/Android ok; sem suporte → digitação |
| 5 | Confirmar destino com IA/regras (6) | ✅ completo | E2E + `test_api.py` |
| 6 | Sua rota: desvios explicados, mapa, 0 escadas, abrir no app de mapa (7) | ✅ completo | E2E |
| 7 | Navegação, alerta, pergunta à comunidade, chegada + avaliação (8–12) | ✅ completo | E2E da caminhada inteira |
| 8 | Avisar problema: câmera com captura automática, visão (OpenCV) sugere, pessoa decide, rostos/placas borrados, envio (13–15) | ✅ completo | E2E com câmera falsa |
| 9 | Meus avisos, Novidade (consertado), Ajustes com temas Claro/Escuro/Contraste, Ajuda (IA), Privacidade (16–18) | ✅ completo | E2E |

## 2. Mocks e simplificações (e por quê)

| Ponto | Situação hoje | Por quê | Para finalizar |
|---|---|---|---|
| Partida fora do território | "Casa" de demonstração na Vila Yara + **caminhada simulada** | Banca não está em Osasco | Nada (é recurso de demo); dentro da área usa GPS real |
| Relatos de problemas | 32 relatos **simulados** (`relatos_seed.json`), identificados por `origem` | App sem usuários ainda | Ver `caminho-livre-dados/docs/dados_simulados.md` |
| Assistente de IA | Sem `OPENROUTER_API_KEY` responde **por regras** (fiel, sem LLM) | Cota gratuita (50/dia) e sem chave no ambiente | Colocar a chave no `api/.env` / App Settings |
| Chuva | Previsão real (Open-Meteo); `?chuva=simular` e `?chuva=nao` para demo reproduzível | Clima real muda a rota | — |
| Lugares salvos | Casa (demo) + UBS/estação mais próximas | Não há cadastro de lugares do usuário | `TODO` em `App.jsx` |
| "Ver no mapa" (Novidade) | Fecha a tela | Tempo | `TODO` em `App.jsx` |
| Acompanhante | Abre SMS pronto (nada sai sem a pessoa enviar) | LGPD + sem backend de notificação | `TODO` em `Rota.jsx` |
| Avaliação Bom/Ruim | Só métrica Prometheus + log | Sem tabela ainda | `TODO` em `api/app/main.py` |
| Offline (PWA) | Manifest sim; service worker não | Tempo | `TODO` em `src/main.jsx` |
| Fala → texto sem Web Speech | Cai para digitação | Firefox/iOS antigo | `TODO` em `voz.js` |
| Semáforo sonoro | Nunca aparece | **0 mapeados no OSM do território** (dado real) | Mapear no OSM / dado da prefeitura |

## 3. Integração com os outros repositórios (contratos)

### caminho-livre-dados (Big Data)
- Contrato: 4 arquivos gold em `api/dados/` (formato em `caminho-livre-dados/docs/dicionario_de_dados.md`).
- **Fazer:** commitar o pipeline (está só no clone local), subir Airflow (docker compose oficial) e tirar o print da DAG rodando; rodar `python -m pipeline.run --publicar ../caminho-livre/api/dados` sempre que mudar algo; se mudar o formato, subir `versao`.

### GS_Generative_AI_for_Engineering (IA generativa)
- As funções do notebook foram portadas para `api/app/assistente.py` (mesmos prompts V2): destino (P2), rota (P3, com verificação de fidelidade), ajuda (P4 + RAG), chamado (E4, revisão humana forçada).
- **Fazer:** se mudar prompt no notebook, replicar em `assistente.py`; incluir prints do app usando a IA (tela Ajuda, destino por voz) no relatório.

### Visão computacional (este repo, `src/vision/`)
- Integração só pela API pública `AnalisadorVisao` (núcleo intocado). A tela roda as 3 categorias e sugere uma.
- **Fazer:** categorias de rampa/iluminação (hoje sem sugestão automática); fila de moderação para `INCONCLUSIVO` (`TODO` em `relatos.py`); dataset brasileiro de teste.

### RPA (UiPath)
- Endpoints prontos com token (`CL_RPA_TOKEN`): `GET /api/chamados/pendentes` (já traz o texto do chamado redigido pela IA, `requer_revisao_humana=true`), `POST /api/chamados/{id}/protocolo` (vira "Encaminhado"), `POST /api/chamados/{id}/resolvido` (gera a "Novidade" para quem avisou).
- **Fazer:** o robô no UiPath Studio (ler pendentes → humano aprova → preencher SP156/Osasco → gravar protocolo), BPMN As-Is/To-Be, vídeo.

### Secure DevOps & Cloud
- Pronto: `api/Dockerfile` (non-root), serviço `api` no `docker-compose.yml`, proxy `/api` no nginx, `microphone=(self)` na Permissions-Policy (antes bloqueava a voz), testes da API no job `test` do CI, Semgrep com `p/python`, métricas em `/metrics` (latência, tráfego, erros, saturação + rotas, relatos, LLM).
- **Fazer:** Terraform (2º Web App para a API, volume persistente `/data`, App Settings com segredos), ajustar `proxy_pass` do nginx para o host da API no Azure, job de build/Trivy da imagem da API, scrape do `/metrics` no Prometheus, dashboard + alerta. **Docker não foi testado localmente** (não havia Docker nesta máquina).

### BI & Startup
- Indicadores já expostos: rotas por perfil e com desvio, avaliações bom/ruim, relatos por categoria, chamadas de LLM; relatos por status em `/api/saude`.
- **Fazer:** Lean Canvas, modelo de negócio, pitch com demo (roteiro: Home → "postinho" → rota com desvio → simular caminhada → alerta → pergunta → chegada → avisar problema).

### Maker Lab
- Sem dependência de software.

## 4. Como rodar a demo
Ver README (seção "MVP integrado"). URL de demo reproduzível: `http://127.0.0.1:8000/?chuva=nao`.

## 5. Atualização 15/11, 23h45: localização real e mapa real
- **Localização:** usa o GPS real em qualquer lugar e mostra "Você está em <rua, bairro, cidade>" (Photon/OSM). A partida de demonstração (Vila Yara) só entra se o GPS for negado.
- **Busca:** dentro do piloto, base curada do pipeline. Fora dele, Photon (categoria perto de você e nome/endereço).
- **Rotas fora do piloto:** grafo montado na hora a partir do OSM (Overpass), com as mesmas regras de acessibilidade. Se o Overpass estiver fora do ar (aconteceu hoje: timeouts), o app usa a rota a pé do OSRM e **avisa que não há dados de calçada e escada**. Limite: 8 km a pé.
- **Mapa:** Leaflet com tiles do OpenStreetMap. `TODO: integrar` um provedor de tiles com SLA (MapTiler/Stadia) antes de abrir ao público; a CARTO passou a exigir chave.
- **Pendente:** relevo, alagamento e relatos curados existem só no território do piloto; expandir o pipeline para outros bairros.
