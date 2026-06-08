# Pendências — Vexo OS

> Tarefas abertas, bloqueios, esperando-confirmação. Só fato confirmado.

## ✅ RESOLVIDOS (2026-06-08)
- ~~Dois checkouts diferentes~~ → **Repo canônico = Repo B**. Arquivos de coordenação migrados. Repo A descartado.
- ~~PAT exposto na URL do origin~~ → **PAT revogado e removido** (Repo B limpo; Repo A irrelevante). Fechado.
- ~~Migration `connections` pendente de aplicação~~ → **Migration DESCARTADA** (entidade oficial = `lead_client_evolution_instances` do Luiz). Não aplicar.

## 🔴 BLOQUEIO ATUAL — antes de E1
- **Repo B tem arquivos duplicados com sufixo " 2"** (artefato de cópia de sessões anteriores). Limpar antes de iniciar código novo — risco de confundir imports. (Não é urgente de bloquear tudo, mas limpar antes de E1.)
- **T3/T4 escreveram em `codex/fix-campaign-reply-sequence`** (Repo B) arquivos que colidiram com o trabalho do Luiz em `main`. Precisa decidir: criar branch nova partindo da `main` atualizada, ou reconciliar manualmente. Consultar Luiz antes de mergear qualquer coisa nessa branch.

## Aberto AGORA (E1 — próximo)
- **Validar QR ponta-a-ponta** com evidência real (log, screenshot, resposta da Evolution). Arquivos: `server.js:1969–2005`, endpoint `provision`.
- **Validar multi-instância em disparo** com evidência real (coluna `evolution_instance_id` em uso em campanha real). Arquivo: `registerAllDomainRoutes.js:4599–4613`.
- **Confirmar webhook fan-in** — quantos webhooks a Evolution dispara? O backend ouve instâncias além de "Vexo Assistent"? (E4 pode virar bloqueador de E1 se fizer parte da validação.)

## Pendente para E6 — trabalho do T4 em LeadImports.tsx
Mudanças do T4 (branch `codex/fix-campaign-reply-sequence`, stash `t3-t4-trabalho-original`) que NÃO foram aplicadas na `feat/disparos-nav`. Devem ser integradas em E6:
- **Bug scroll corrigido:** `rows.slice(0, 8)` → `rows` (preview mostrava só 8 linhas das 509).
- **Status colorido tipado:** novo estado `dispatchStatusKind: "success"|"error"|"info"` — elimina parsing de string para decidir cor do badge de status.
- **Resumo de importação:** `importResult` state mostra total/importados/ignorados após upload, com badge verde.
- **Scroll no preview:** `max-h-[400px] overflow-auto` na tabela de preview.
- **Label de amostra:** "Amostra do processamento (N linhas)" em vez de "Resumo do processamento".
- Arquivos: `frontend/src/pages/LeadImports.tsx` (T4) vs versão da main do Luiz (que tocou imports + dispatch logic no mesmo arquivo em PR #120). Merge manual necessário, região de código diferente mas mesmo arquivo.

## Riscos de multi-tenant levantados pelo T1 (priorizar na Etapa 1)
- **ALTO — `followup_companies` vaza entre tenants:** tabela sem `client_id`; `GET /api/followup/companies` retorna todas as empresas. Corrigir ao adicionar suporte multi-chip.
- **MÉDIO — `lead_conversations` sem isolamento por tenant:** conversa compartilhada por telefone entre tenants; exige `tenant_id` + migração de dados.
- **ESTRUTURAL — RLS inefetivo em produção:** o `pg.Pool` faz bypass do RLS do PostgreSQL; a policy `USING(false)` só barra clientes externos, não o backend. Toda segurança de tenant depende de filtro por `tenant_id` no código — invariante obrigatória em toda query.

## Em espera (filas separadas)
- **Dashboard — Fase 1.** Correção de dados já diagnosticada (Fase 0, `CONTRACT-dashboard.md`, commit `dd806b1`). Em espera enquanto a fila de disparos roda.

## Aguardando regra de negócio do Conrado
- **Aquecimento de chip (Etapa 4 do roadmap).** Só implementar após a regra de negócio de aquecimento ser definida.

## Futuro — NÃO executar agora
- **Renomeação Supabase→Postgres no código.** Arriscado (já quebrou migrations). Só com evidência de que não quebra.
- **Migração Vercel→VPS/EasyPanel + repo privado.** Plano futuro: tirar o front da Vercel, centralizar tudo no VPS/EasyPanel e tornar o repositório privado. Registrar, não executar.

## A confirmar com o Conrado quando relevante
- **Status da Liv Pub.** O dashboard do Copiloto (P4) era bônus condicionado ao fechamento da Liv Pub até 06/06. Perguntar antes de priorizar P4 — muda a urgência.
