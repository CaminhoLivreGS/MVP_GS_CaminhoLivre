# Análise de segurança do MVP (16/11/2026)

Objetivo: publicar o app **funcionando com as chaves de API reais** (OpenRouter, OpenRouteService e MapTiler) sem expor segredos nem permitir que alguém gaste a cota da equipe.

**Método:**
- revisão manual da API (`api/app/*.py`) e do front;
- Bandit (análise estática de Python);
- `pip-audit` e `npm audit` (vulnerabilidades conhecidas nas dependências);
- varredura de chaves em todo o histórico do git;
- testes automatizados para cada correção (`api/tests/test_api.py`).

O CI continua rodando Gitleaks, Semgrep e Trivy em todo push.

## 1. Onde fica cada chave

| Chave | Onde fica | O navegador vê? | Proteção |
|---|---|---|---|
| `OPENROUTER_API_KEY` | `api/.env` (local) e Environment do Render | **Não**: só a API chama a OpenRouter | Limite por IP em `/api/assistente/*` (20/min). **Configurar limite de crédito na chave**, no painel da OpenRouter |
| `ORS_API_KEY` | `api/.env` e Render | **Não** | Limite por IP em `/api/rotas` e `/api/locais/*`, cache de 1 h e disjuntor de 2 min |
| `CL_RPA_TOKEN`, `CL_ADMIN_TOKEN`, `CL_SAL_DISPOSITIVO` | `api/.env` e Render (gerados aleatoriamente) | **Não** | Comparação em tempo constante (`hmac.compare_digest`) |
| `VITE_MAPTILER_KEY` | `.env.local` e Render (entra no build do front) | **Sim, por natureza**: toda chave de mapa de navegador é pública | **Restringir os domínios permitidos no painel da MapTiler** (localhost e `*.onrender.com`) |

Resultado da varredura: **nenhuma chave em arquivo versionado nem no histórico do git**. Os arquivos `.env`, `.env.*` e `dist/` estão no `.gitignore`.

## 2. Achados e correções

| # | Severidade | Achado | Impacto | Correção | Teste |
|---|---|---|---|---|---|
| 1 | **Alta** | O limite por IP usava o **primeiro** valor do `X-Forwarded-For`, que é o cliente quem escreve | Bastava mudar esse cabeçalho a cada pedido para burlar o limite e **esgotar a cota da IA e do ORS** (custo e indisponibilidade) | Passa a valer só o **último** valor, que é o acrescentado pelo proxy de confiança (Render/nginx) | `test_limite_por_ip_nao_e_burlado_forjando_x_forwarded_for` |
| 2 | Média | `/metrics` ficava público no deploy de serviço único (Render, sem nginx na frente) | Expunha volume de uso, rotas internas e chamadas à IA | Pela internet responde 404. A rede interna (Prometheus do compose) continua lendo. Leitura externa só com `CL_METRICS_TOKEN` | `test_metrics_nao_fica_publico_atras_do_proxy` |
| 3 | Média | O token do robô era comparado com `!=` | Ataque de tempo (descobrir o token pela diferença no tempo de resposta) | `hmac.compare_digest` | `test_token_do_robo_errado_e_recusado` |
| 4 | Média | `/api/lugares`, `/api/onde-estou`, `/api/clima` e `/api/mapa` não tinham limite | Abuso pelo nosso servidor faria o Photon, o Overpass ou a Open-Meteo **bloquearem o app** | Limites por IP (30–60/min) | — |
| 5 | Baixa | A memória do limitador crescia sem limite (uma entrada por IP) | Esgotamento lento de memória | Limpeza periódica das entradas antigas | — |
| 6 | Baixa | Um relato com categoria inválida gravava a foto antes de ser recusado | Lixo em disco | Categoria e posição validadas antes de gravar | — |
| 7 | Baixa | Relatos que a visão marcava como INCONCLUSIVO entravam direto no fluxo | Spam e foto sem evidência confirmada | **Fila de moderação** (`/api/moderacao`, com token) | `test_moderacao_de_relato_inconclusivo_exige_token` |
| 8 | Info | Bandit: SHA-1 em `osm_ao_vivo.py` | Nenhum: é só o nome do arquivo de cache | Marcado `usedforsecurity=False` | — |

**Dependências:** `pip-audit` (API) e `npm audit --omit=dev` (front) **sem vulnerabilidades conhecidas** em 16/11/2026.

## 3. Controles que já existiam (verificados)
- **Navegador:** CSP restritiva (`connect-src 'self'`, imagens só da MapTiler e do OSM), `X-Frame-Options: DENY`, HSTS, Permissions-Policy (câmera, microfone e GPS só no próprio site), COOP/CORP.
- **Upload:** até 2,5 MB, tipo conferido pelos bytes iniciais (JPEG/PNG/WEBP), nome aleatório no servidor e **fotos nunca servidas publicamente**.
- **LGPD:**
  - rostos e placas são borrados **no aparelho** antes do envio, e a foto sai sem EXIF (canvas);
  - não há nome nem telefone;
  - o dispositivo vira um hash com sal.
- **IA:** entrada limitada a 400 caracteres e respostas com verificação de fidelidade. O teste de *prompt injection* no chamado já existia.
- **Containers:** usuário não-root e sistema de arquivos somente leitura no compose.

## 4. Riscos aceitos (e o próximo passo de cada um)

| Risco | Por que aceito no MVP | Próximo passo |
|---|---|---|
| `'unsafe-eval'` na CSP | Exigido pelo OpenCV.js (WebAssembly) | Isolar a visão num domínio próprio |
| A anonimização roda no cliente; o servidor confia nela | Privacidade por padrão: a foto original nunca sai do aparelho | Re-anonimizar no servidor antes de qualquer uso externo. Hoje as fotos não são publicadas |
| Banco SQLite apagado a cada deploy no Render gratuito | Sem cartão de crédito para disco persistente | Postgres gerenciado (Supabase/Neon) |
| `/api/docs` e `/api/indicadores` públicos | Contrato aberto e só contagens agregadas, sem dado pessoal | Pôr atrás de token se virar produto |
| OSRM público, Overpass e Photon sem garantia de serviço | Gratuitos. Já há cache, disjuntor e plano B | Servidor próprio ou plano pago |

## 5. Antes de abrir o link ao público
- [ ] Render → Environment: `OPENROUTER_API_KEY`, `ORS_API_KEY`, `VITE_MAPTILER_KEY` (os tokens `CL_*` são gerados pelo `render.yaml`)
- [ ] OpenRouter → Keys → definir **limite de crédito** na chave
- [ ] MapTiler → Account → Keys → **Allowed HTTP origins**: `localhost`, `127.0.0.1` e o domínio do Render
- [ ] GitHub → Settings → Variables → `APP_URL` (ativa o workflow que mantém o app acordado)
- [ ] Nunca colar chaves no chat, em issue ou em print. Se vazar, revogue no painel e gere outra
