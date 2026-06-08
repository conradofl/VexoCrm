# Decisões — Vexo OS

> Append-only. Cada entrada: data + decisão + 1 frase de porquê. Só fato confirmado.

## 2026-06-08
- **Migração Supabase→PostgreSQL concluída.** A infra é PostgreSQL (Easypanel, `db-vexo`/`vexo-data`); não há serviço Supabase ativo. O código mantém o rótulo "Supabase" apontando para o PostgreSQL — renomear foi revertido por quebrar migrations, então fica como está.
- **Incidente de key vazada resolvido.** Keys revogadas; sem risco ativo. Deixa de ser pendência.
- **Fila priorizada = Máquina de Disparos (Etapa 1).** Dashboard (Fase 1) entra em espera numa fila separada, para retomar depois — foco único evita colisão entre as duas frentes.
- **CONTRACT do dashboard renomeado para `CONTRACT-dashboard.md`.** Para preservar a Fase 0 do dashboard sem confundir com o novo `CONTRACT.md` (disparos), que é o contrato ativo na raiz.
- **PAT do GitHub revogado e removido da URL do origin** (Repo B limpo). Sem risco ativo. — Fechado.
- **Repo canônico = Repo B (`~/Documents/vexo-sales-module`).** Repo A (`Desktop/.../VexoCrm`) descartado — não usar mais. Arquivos de coordenação (CONTRACT.md, ORQUESTRACAO.md, _memoria/) migrados para o Repo B. Evita divergência de estado entre dois checkouts.
- **Entidade oficial de conexão = `public.lead_client_evolution_instances`** (Luiz, PR #120, 07/jun). Chave de tenant = `client_id`. Nossa migration `connections` (T1, Repo A) está DESCARTADA — não aplicar, não mergear. O Luiz já implementou antes de recebermos o resultado do T1.
- **Wrapper T2 (cliente REST Evolution) DESCARTADO.** Os endpoints `/api/lead-clients/:tenantId/evolution-instances` do Luiz já cumprem o papel — recriar seria duplicação.
- **Novo roadmap ativo (E1→E6).** Foco real é: validar o que Luiz fez, resolver caminho duplo de QR, construir anti-ban (maior valor). Ver ORQUESTRACAO.md seção 3 e CONTRACT.md seção ORDEM DAS ETAPAS.
