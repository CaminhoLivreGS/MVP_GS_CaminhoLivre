# Dados simulados: o que é simulado e por quê

Tudo que vem de OSM, relevo e clima é **dado real**. Só os **relatos de problemas** são simulados, porque o app ainda não tem usuários reais.

## Como são gerados (`modelar.gerar_relatos`, semente fixa 42, reprodutível)

1. **Cenário da demonstração (2 relatos, `origem=simulado_demo`)**
   - Calcula o caminho mais curto entre a Casa da demonstração (Rua Patrício Galafrio) e a UBS Santa Maria Goretti.
   - Coloca um **buraco confirmado por 4 pessoas** no trecho com nome mais perto do meio desse caminho → força um desvio explicável.
   - Bloqueia esse trecho, recalcula e coloca uma **calçada irregular em verificação** no caminho alternativo → dispara o alerta e a pergunta à comunidade durante a navegação.
2. **Relatos de fundo (30, `origem=simulado`)** em vias residenciais, terciárias, secundárias e calçadas com nome:
   - categoria: buraco 30%, calçada irregular 25%, obstáculo 20%, sem rampa 10%, alagamento 8%, luz apagada 7%
     (proporção inspirada nas queixas de zeladoria de calçada; **premissa da equipe, a validar** com dados do SP156/Osasco);
   - status: confirmado 45%, em verificação 40%, resolvido 15%; confirmações compatíveis com o status;
   - data: até 40 dias atrás.

## Limitações
- As proporções não foram medidas: são premissas.
- Os relatos simulados ficam identificados (`origem`) e podem ser removidos do banco da API (`CL_SEMEAR_RELATOS=0`).
- TODO: integrar dados reais de zeladoria (SP156 / Ouvidoria de Osasco) quando disponíveis.
