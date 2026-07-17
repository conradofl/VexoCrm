# Decisões — Vexo OS

> Append-only. Cada entrada: data + decisão + 1 frase de porquê. Só fato confirmado.

## 2026-07-17
- **Novo segmento de apresentação comercial: "Óticas" (`otica`).** Roteiro SPIN próprio em `frontend/src/lib/presentation/pitchContent.ts` (grupo `otica`, 7 slides), seed do segmento em `backend/supabase/migrations/20260717120000_add_oticas_segment.sql` (idempotente, roda depois da deactivate → nasce ativo) e registro em `DEFAULT_SEGMENTS`/`SEGMENT_MAPPING` do setup. Motivo: abrir o nicho de óticas seguindo a mesma arquitetura de entretenimento_local e saude_estetica.
- **Eixo de ROI do pitch de óticas = vazamento duplo.** Slide de implicação soma orçamentos sem follow-up + recompra dormida (troca de lente/grau ~18 meses) num só número/ano, sob benchmark conservador embutido (`estimateOpticalLoss`). Motivo: two-leak story converte melhor que número único e materializa as duas dores que mais vendem no nicho.
- **Convenção de copy de apresentação: sem travessão, frases curtas e diretas.** Travessão (—) na copy visual lê como amador; frase longa perde a atenção do cliente na apresentação. Aplicado aos slides de óticas; pendente estender aos segmentos legados. Ver [[aprendizados]].
- **Dashboard do módulo GD (`/crm/dashboard-gd`).** Nova página com 4 contadores: propostas, briefings, contratos e propostas sem assinatura (`gd_proposals.signed_at IS NULL`), via `GET /api/gd/dashboard-stats`. Motivo: dar visão geral do funil comercial GD num lugar só. Contadores de propostas/contratos/sem-assinatura são por tenant; **briefings é global** porque `geracao_digital_briefings` não tem `tenant_id` (tabela de captação). Adicionar `tenant_id` aos briefings ficou como evolução futura, não bloqueia o dashboard.
- **Redesign de pacotes: abordagem `ad_hoc` + `segmento` (escolhida sobre snapshot profundo).** Pacote da proposta é marcado `ad_hoc=true` (some da biblioteca de Modelos) em vez de trocar `pacotes_ofertados` de IDs por objetos embutidos. Descoberta que justifica: o snapshot do que é vendido JÁ existe em `gd_proposals.itens` (o backend copia os produtos do pacote pra lá); `package_id`/`pacotes_ofertados` são só referências, hidratadas por lookup de ID (linhas 864/1295/1343/1893 de geracaoDigitalRoutes.js) que não filtram ad_hoc. Então marcar ad_hoc resolve a bagunça sem reescrever render/cálculo (85KB) — menor risco, mesmo resultado prático. Coluna `segmento` real substitui a gambiarra de prefixar letra. FATIA 1 (migration + backend + tela Pacotes) implementada 2026-07-17; FATIA 2 (montador inline na proposta) pendente — ver [[pendencias]].

## 2026-06-16
- **Segundo cérebro compartilhado via RAG é regra global para Codex/Cursor/Claude.** O servidor em `segundo-cerebro/_rag` expõe `/api/query`, `/api/search` e `/api/chat`; Codex/Cursor usam o helper global `cerebro`, e Claude Code pode consultar os endpoints HTTP.
- **Evolution Admin não consulta instâncias remotas por padrão.** `GET /api/admin/evolution-config` retorna só inventário local; a chamada cara à Evolution (`/instance/fetchInstances`) fica atrás de `?remote=true`/botão "Buscar Evolution", com cache/dedupe no backend para evitar loop e sobrecarga.
- **Resposta inbound de grupo/broadcast é descartada cedo.** Mensagens com JID de grupo/broadcast não devem criar lead, mensagem ou acionar chatbot/follow-up; isso reduz spam e gravação indevida.
- **`lead_messages.lead_id` não tem FK para tabela dinâmica específica.** A migration `20260613200000_drop_lead_messages_lead_id_fkey.sql` remove a FK podre porque o lead canônico vem da tabela CRM do tenant; a coluna permanece para vínculo lógico.

## 2026-06-13
- **Memória operacional principal = `_memoria/`; `.cerebro/` fica como histórico/segundo vault.** O orquestrador lê `_memoria/` explicitamente e a `.cerebro/` estava defasada desde maio, então o estado vivo passa a ser consolidado primeiro em `_memoria/`.
- **Repositório ativo confirmado = `/home/luizfelipe/Documents/Programação/Vexo/VexoCrm` em `main` (`93653a7`).** Foi executado `git pull --ff-only origin main` e o remoto já estava atualizado; este snapshot substitui referências antigas de caminho canônico que divergiam.
- **`Conexoes.tsx` é a casa operacional dos chips WhatsApp.** A tela já reutiliza `EvolutionChipsPanel` por tenant, então a gestão de chips deixou de ser exclusiva de `Tenants.tsx`.
- **`Relatorios.tsx` virou relatório v1 real de envios por chip/dia.** O placeholder de relatórios foi substituído por gráfico baseado em `evolution_instance_daily_usage` via `/api/reports/evolution-usage`.
- **`Disparos.tsx` e `Aquecimento.tsx` continuam placeholders.** Devem ser tratados como próximas entregas, não como funcionalidades prontas.
- **Segmentação pertence ao tenant/empresa, não à campanha.** Cada empresa pode ter campos e filtros próprios por tipo de negócio; por isso a criação de campanha deve ficar simples e a escolha de perfil/schema fica em `Tenants.tsx`.
- **KPIs de segmentação são personalizados por empresa.** O tenant guarda `segmentation_config` em `lead_client_n8n_settings`, com KPIs/campos editáveis na criação da empresa e leitura desses KPIs na criação da campanha.

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
