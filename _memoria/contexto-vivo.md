# Contexto-vivo — Vexo OS

> Estado atual do projeto. Sempre atualizado. Fonte de estado, mas o repo vence em caso de divergência.

_Última atualização: 2026-06-08 pós-auditoria PR #120 (orquestrador)._

## Fila atual
**Máquina de Disparos — foco: validar fundação do Luiz + construir o que falta (anti-ban).**
A fila do dashboard (Fase 1) está **em espera**, em fila separada.

## Repositório canônico
- **Repo B**: `~/Documents/vexo-sales-module` (branch `codex/fix-campaign-reply-sequence`)
- Repo A (`Desktop/.../VexoCrm`) **DESCARTADO** — não usar.
- `origin/main` HEAD: `d4bc3b3` (Luiz, Merge PR #120, 07/jun/2026).

## Infraestrutura
- Banco: **PostgreSQL** (Easypanel — `db-vexo`, database `vexo-data`). Não há serviço Supabase ativo.
  - ⚠️ Código ainda nomeado "Supabase" — rótulo herdado. Não renomear (já quebrou migrations).
- Backend: Node/TypeScript, serviço `bk-vexo` (Easypanel, porta 3001).
- Frontend: React + TypeScript, deploy Vercel.
- Filas: BullMQ + Redis (worker deployado).
- WhatsApp: Evolution API (instância "Vexo Assistent" + multi-instância via `lead_client_evolution_instances`).
- IA: Groq (llama-3.1-8b-instant).

## O que o Luiz já fez (PR #120, PR #119, d17462d — 06-07/jun)
| Feature | Arquivos | Testado? |
|---|---|---|
| Multi-instância por tenant (`lead_client_evolution_instances`) | `server.js:1565`, endpoints REST | ❌ sem teste |
| `evolution_instance_id` em campanhas/disparos | `registerAllDomainRoutes.js:4599` | ❌ sem teste |
| QR via Evolution REST | `server.js:1969–2005` | ❌ sem teste — caminho duplo c/ legado |
| Pause/resume de campanha | `campaign-outbound.js:479–630` | ✅ existe teste básico |
| Onboarding com tabelas dinâmicas | `lead-client-tables.js` (novo) | ❌ |
| UI de empresas/instâncias | `Tenants.tsx` (+457 linhas) | ❌ |

## O que AINDA FALTA (nosso trabalho)
- **E1** (PRÓXIMO): Validar QR + multi-instância ponta-a-ponta com evidência real.
- **E2**: Resolver caminho duplo de QR (REST novo vs legado `whatsapp.js`).
- **E3**: Anti-ban real — cota por número + lotes + delay + tratamento de ban. **MAIOR BURACO.**
- **E4**: Webhook fan-in — confirmar que ouve TODAS as instâncias com roteamento por tenant.
- **E5**: Nav Vendas × Disparos.
- **E6**: Bug scroll import + status variação (verificar se `LeadImports.tsx` reescrito pelo Luiz já resolveu).
