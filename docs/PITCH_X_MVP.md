# Pitch × MVP: onde cada promessa está no app

Atualizado em 19/11/2026. **Mock** = funciona de ponta a ponta, mas com dado ou acesso de demonstração (detalhes em [`PENDENCIAS.md`](PENDENCIAS.md)).

| Trecho do pitch | Onde está | Como mostrar na demo | Situação |
|---|---|---|---|
| "Escolher entre dois modos: fala ou digitação" | Tela **Modo de uso** logo depois das boas-vindas (`src/app/telas/Onboarding.jsx` → `Modo`); trocar em Ajustes → Modo de uso | Primeiro acesso → "Quero falar" ou "Quero digitar" | ✅ |
| "No modo fala, basta apertar um botão e dizer o destino. Instruções, alertas e orientações narrados por voz" | Home com microfone gigante; voz ligada; navegação narrada (`Destino.jsx`, `Rota.jsx`) | Modo fala → microfone → "posto de saúde" | ✅ (Web Speech; sem suporte, cai para digitação) |
| "Botões grandes, comandos simples e ajustes de leitura" | Ajustes: tema Claro/Escuro/Contraste, letra P/M/G, voz devagar, vibração | Ajustes | ✅ |
| "No modo digitado, navega pelas telas e também pode usar comandos de voz" | Home com campo de texto em destaque e botão de microfone ao lado; narração desligada (o alto-falante liga quando quiser) | Modo digitar → Home | ✅ |
| "Cadeira de rodas, muletas, dificuldade visual, restrição a escadas, caminhos planos e iluminados" | Tela **Seu perfil**: 5 perfis (inclui **muletas**) + "No caminho, eu quero": nunca usar escadas, caminhos planos, ruas iluminadas. A API (`api/app/roteamento.py`) aplica tudo no A* | Perfil → muletas + nunca escadas → rota mostra os critérios "Sem escadas · Ruas iluminadas" | ✅ |
| "Registra a barreira por meio de uma fotografia… associa à localização… disponibiliza no mapa" | Avisar → **Tirar foto** (visão computacional + rostos/placas borrados) → relato com GPS → **Mapa** (nova aba da barra inferior) | Avisar → Tirar foto; depois aba Mapa | ✅ |
| "Alertar outros usuários durante o percurso e apresentar alternativa de trajeto" | Desvio automático na rota + alerta a 30 m + recálculo (`MotorNavegacao.js`) | Rota com desvio → Simular caminhada | ✅ |
| "Painel Administrativo: distribuição das ocorrências, análises e dashboards, acompanhar registros, regiões com mais problemas" | **`/adm`** (`src/adm/`, API `/api/adm/*`): indicadores, mapa por setor + pontos por status, ranking de regiões e ruas, série diária, categorias, tabela de registros com troca de status, fila de moderação | Abrir `/adm`, token `adm-demo` (local) | ✅ regiões = setores (mock) |
| "Filtrar por região e exportar os registros fotográficos organizados por área" | Filtros região/categoria/status/período; botão **Exportar fotos por região** → ZIP com uma pasta por região + `relatos.csv` | `/adm` → filtrar → Exportar | ✅ |
| "Enviando uma fotografia ou descrevendo a situação por meio de voz" | Avisar → **Descrever falando**: fala vira texto, IA (ou regras) sugere a categoria, a pessoa confirma; vai sem foto, com o texto | Avisar → Descrever falando → "tem um carro em cima da calçada" | ✅ |
| "Consultados e confirmados por outros usuários" | Mapa de barreiras: tocar no problema → foto, status, confirmações → **Ainda está aqui / Já foi resolvido** (3 "sim" confirmam; 2 "não" descartam). Também perguntado durante a rota | Mapa → tocar num item | ✅ |
| "Prefeituras assinam um painel com problemas confirmados e priorizados" | Painel ADM + chamado redigido pela IA para o robô de RPA (`/api/chamados/pendentes`) | `/adm` | ✅ (acesso por token: mock de login) |
| "Shoppings, hospitais e universidades… 'como chegar com acessibilidade' no próprio site" | Widget **`/embed/<lugar>`** (entradas verificadas + botão que abre a rota já calculada em `/?destino=<lugar>`); código do iframe pronto em `/adm` → Instituições | `/adm` → Instituições → Copiar código / Abrir o widget | ✅ dados de entradas de exemplo |
| "Indicadores: obstáculos identificados, ocorrências confirmadas, rotas adaptadas por perfil e tempo de resposta dos responsáveis" | `/api/indicadores` → `impacto` e seção **Impacto** do painel | `/adm` → final da Visão geral | ✅ histórico inicial simulado |
| ODS 3, 10 e 11 | Narrativa (sem tela própria) | — | — |
