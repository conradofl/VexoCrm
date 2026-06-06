# Next Roadmap - Vexo CRM

## Objetivo

Definir os proximos ciclos apos o fechamento da estabilizacao #44-#50, mantendo evolucao incremental e evitando voltar a empilhar grandes mudancas sem trilho de teste.

---

## Ciclo 1 - Fechamento antes de cliente

Prioridade maxima antes de liberar cliente real.

| Tema | Entrega esperada |
| --- | --- |
| Schema de campanhas | Criar migration de criacao completa de `campaigns` ou documentar origem real se ja existir fora da serie atual |
| Lead imports | Fechar tenant scope de `POST /api/lead-imports` |
| Conversas | Decidir e implementar estrategia de `lead_conversations.client_id` |
| Notificacoes | Consolidar backend `/api/notifications` vs Edge `notifications-api` |
| Teste manual | Executar checklist de admin, interno escopado e cliente |

---

## Ciclo 2 - Produto

Melhorias de produto depois de seguranca minima fechada.

| Area | Proximo passo |
| --- | --- |
| Dashboard | Revisar indicadores clicaveis e origem dos dados |
| Leads | Melhorar visualizacao de pipeline em tabela/linhas ou modo alternavel |
| Solicitacoes | Corrigir contraste/modais e validar vinculo com plano contratado |
| Produtos | Criar fluxo claro de plano contratado, upgrade e limites |
| Relatorios | Export CSV/TXT e graficos operacionais |
| Vexo Labs | Explicar objetivo, permissao, logs e fluxo de teste interno |

---

## Ciclo 3 - Automacoes

| Area | Proximo passo |
| --- | --- |
| n8n inbound WhatsApp | Normalizar payload oficial (`client_id`, `telefone`, `lead_id`) |
| Follow-ups | Definir regra anti-spam, opt-out e reagendamento automatico |
| Alertas Conrado | Padronizar quando acionar humano e onde registrar alerta |
| Auditoria Nexus | Rodar primeiro como relatorio interno antes de automacao ativa |
| Google Calendar | Validar contrato de meeting antes de disparar agenda real |

---

## Ciclo 4 - Integracoes

| Integracao | Proximo passo |
| --- | --- |
| Postgres | Consolidar migrations e RLS por responsabilidade do backend |
| Redis | Documentar chaves oficiais e TTL por tipo de memoria |
| WhatsApp/Evolution/Z-API | Definir provider canonico e payload unico |
| rotas Express | Decidir ownership: backend canonico ou Edge por fluxo |
| Webhooks externos | Padronizar bearer, CORS, retries e idempotencia |

---

## Ciclo 5 - Limpeza tecnica futura

Somente depois dos ciclos criticos.

| Tema | Proximo passo |
| --- | --- |
| `server.js` | Extrair middlewares e rotas por grupo, uma PR por grupo |
| Erros | Criar modulo unico de `sendError` e codigos |
| Tenant helpers | Separar helpers puros de helpers com `req/res` |
| Testes HTTP | Adicionar mocks de Firebase/Postgres e smoke tests de rota |
| Lint | Corrigir backlog e tornar lint obrigatorio no CI |
| ADRs | Criar decisoes formais para webhooks, tenant, notificacoes e conversas |

---

## Regra de sequenciamento

Nao iniciar feature comercial nova enquanto houver pendencia critica de tenant, schema ou auth aberta. Se uma melhoria de produto depender de dado fragil, primeiro criar PR de contrato/schema, depois a melhoria visual/funcional.
