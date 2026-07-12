# Plano de Implementação — Módulo de Contratos GD (Fase 1)

Data: 2026-07-11 · Branch: `feat/gd-contratos` (a partir de `refactor/gd-padroes`)
Spec de origem: solicitação ao setor de contratos GD respondida pelo Caio + template docx anexo.

## Regras inegociáveis

1. **Zero IA em cláusula.** O sistema faz mail-merge (`{{variavel}}` → valor). Nunca redige texto jurídico.
2. **Humano no loop.** Sistema preenche → operador revisa o preview → só então baixa/envia. Sem envio automático.
3. **Tenant-scoped.** `tenant_id` derivado no backend via `resolveTenantForRequest` (domains/geracaoDigital/tenantResolver.js), nunca do body.
4. **Migrations idempotentes**, campos novos opcionais, `Number(x || 0)` em todo numeric do Postgres, `fetchApi` sempre (nunca fetch cru).

## Variáveis do template (extraídas do docx real)

| Variável | Origem |
|---|---|
| `{{razao_social}}` `{{cnpj}}` `{{telefone}}` `{{email}}` `{{responsavel}}` `{{endereco}}` | mini-form (todos obrigatórios — resposta C do jurídico) |
| `{{objeto}}` | texto base da Cláusula Segunda + itens da proposta; editável no form (varia por briefing) |
| `{{parcelas}}` | array `[{data, valor, meio}]` do form; meios: PIX / cartão / VP e combinações |
| `{{vigencia}}` | padrão pendente (3 meses × 180 dias — ver questões abertas) |
| `{{data_extenso}}` | data de geração ("Uberlândia, DD de MÊS de AAAA") |

Dados fixos no template: contratada (Caio/CNPJ 66.722...), foro Uberlândia-MG, obrigações das partes, renovação automática por igual período, aviso prévio 60 dias.

## Etapa 1 — Migration (~0,5h)

`backend/supabase/migrations/<ts>_create_gd_contracts.sql`:

- `gd_contract_templates` (id, tenant_id FK tenants, nome, conteudo TEXT com `{{vars}}`, ativo, created_at)
- `gd_contracts` (id, tenant_id, proposal_id FK gd_proposals, dados JSONB, pdf_url, status `rascunho|enviado|assinado`, created_at)
- Seed do template mestre (texto do docx convertido) com `INSERT ... WHERE NOT EXISTS` (nunca DELETE em seed).

## Etapa 2 — Backend (~2h)

`backend/src/domains/geracaoDigital/contractRoutes.js`, registrado em `domains/geracaoDigital/routes.js`:

- `GET /api/gd/contract-templates` · `PUT /api/gd/contract-templates/:id` — leitura/edição do template mestre.
- `POST /api/gd/contracts` — body: `proposal_id` + campos do mini-form. Puxa da proposta (mesma tenant): prospect_name, itens, valores, condição escolhida. Merge puro de variáveis. Grava `dados` JSONB.
- `GET /api/gd/contracts?client_id=` · `GET /:id` · `PUT /:id` (dados/status) · `DELETE /:id` (só rascunho).
- `GET /api/gd/contracts/:id/pdf` — PDF via **pdfkit** (dependência nova no backend; leve, sem headless browser). Layout: título, cláusulas, tabela de parcelas, bloco de assinaturas.
- Todas as queries `WHERE tenant_id = $n`.

## Etapa 3 — Frontend (~3h)

Nasce dividido (regra container <400 linhas):

- `pages/GeracaoDigitalContracts.tsx` — container: estado, fetches, composição.
- `pages/GeracaoDigitalContracts/ContractsList.tsx` — lista com badge de status.
- `pages/GeracaoDigitalContracts/GenerateContractDialog.tsx` — mini-form (razão social, CNPJ, responsável, telefone, e-mail, endereço, parcelas dinâmicas, objeto editável). `useLocalStorage` chaveado por `proposalId` pra não perder preenchimento.
- `pages/GeracaoDigitalContracts/ContractPreview.tsx` — texto merged renderizado para revisão + botão "Baixar PDF".
- Botão "Gerar Contrato" no `ProposalHeaderBar` quando `status === "aceita"` (navega pra aba Contratos com a proposta pré-selecionada).
- Registro de rota: `lib/access.ts` (`INTERNAL_PAGE_ORDER`, `pageToTabKey`, `isPathAllowedForClient`) + `lib/appSidebar/constants.ts` (`GERACAO_DIGITAL_ITEMS`) + `components/GeracaoDigitalTabs.tsx` — sub-aba **Contratos** dentro de Geração Digital.
- Tema claro; gradiente roxo→magenta só em botões/badges.

## Etapa 4 — Validação (~1h)

- `npx tsc --noEmit -p tsconfig.app.json` (não passar do baseline 48)
- `npx vitest run` front (38/38) e backend (117/117)
- `npm run build`
- Teste real: gerar contrato da Vantage e comparar com `Vantage Serviços Ltda.pdf` (gabarito).
- Mostrar diff; PR pro Luiz; não mergear direto.

## Fora do escopo da Fase 1

- **Fase 2** — assinatura eletrônica: aguarda confirmação da Duda. Atenção: "assinatura do Google" não tem API com trilha de auditoria jurídica; alternativa real = Autentique/ClickSign/D4Sign (custo por doc).
- **Fase 3** — upload de documentos: só se o jurídico exigir (LGPD).
- Não tocar em VexoPitch nem briefing/handoff.

## Questões abertas (não bloqueiam o código, bloqueiam o texto final)

1. **Vigência**: respostas dizem 3 meses; template diz 180 dias. Qual vale? → Caio.
2. **Cláusula Quarta** hardcoded "100% permutado (VP)": precisa virar `{{forma_pagamento}}` para cobrir PIX+VP / cartão+VP / cartão+PIX. Exige OK do jurídico pra parametrizar.
3. **Reajuste de 10%** citado nas respostas, ausente do template — jurídico adiciona cláusula?
4. **Decisão do Conrado**: contrato assinado trava o CTA de pagamento da proposta ou correm em paralelo?

Enquanto 1–3 não chegam, o seed usa o texto atual do docx literal; a edição do template mestre pela UI cobre o ajuste depois sem deploy.

## Critérios de aceite (Fase 1)

- [ ] Proposta aceita gera contrato preenchido correto (mail-merge, sem IA).
- [ ] Operador revisa preview antes de baixar; nada é enviado automaticamente.
- [ ] PDF limpo via pdfkit (sem sidebar/print do navegador).
- [ ] Multi-tenant em todas as queries; campos novos opcionais; migrations idempotentes.
- [ ] tsc/vitest/build sem regressão; teste real com contrato Vantage.
