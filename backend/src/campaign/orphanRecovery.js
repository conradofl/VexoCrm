/**
 * Recuperação de Lotes Órfãos no Startup do Backend com Retomada Automática.
 *
 * Regra de Negócio:
 * - No boot, qualquer lote em `campaign_dispatches` com `status = 'running'` ou `status = 'interrupted'`
 *   é órfão (o processo Node que o executava morreu no deploy/restart).
 * - Lote cujas runs com desfecho (`sent`, `failed`, `invalid_number`, `skipped`) já alcançam o `target_count`
 *   terminou: fecha `status = 'done'`, com `finished_at` e sem mensagem de erro. O status é que estava errado — o
 *   agendador lia o lote sem `target_count` e fechava como 'interrupted' todo lote que enviava (18 de 19 em produção,
 *   27/10/2026).
 * - Os demais são marcados como `status = 'paused'` para retomada segura pelo usuário. Se a contagem de desfechos
 *   falhar, o lote vai para 'paused' (o lado seguro: pede um clique, não declara pronto o que não foi medido).
 * - Leads em `campaign_dispatch_runs` que ficaram em `status = 'claimed'` sem `sent_at` são marcados
 *   como `status = 'skipped'` com motivo 'Interrompido antes da confirmação de envio (envio não confirmado no restart do servidor)'.
 *   Risco conhecido: 'skipped' conta como desfecho. Um lead que ficou em 'claimed' sem confirmação não volta para a
 *   fila e ajuda o lote a alcançar o alvo e fechar 'done' sem ter recebido. Medido em 27/10/2026: 31 runs 'skipped' em
 *   5 lotes — volume baixo, registrado aqui em vez de virar trabalho.
 * - Ao retomar, o scheduler ou disparo manual deduplica rigorosamente via `buildDispatchLeads({ excludeDispatchId: dispatchId })`
 *   (quem já recebeu NÃO recebe de novo).
 * - Lotes em `status = 'done'`, `status = 'failed'` ou `status = 'draft'` permanecem 100% intocados.
 */

export async function recoverOrphanDispatches(pool) {
  if (!pool) return { recovered: 0, items: [] };

  try {
    // 1. Busca todos os lotes com status 'running' ou 'interrupted' no banco
    const { rows: orphanDispatches } = await pool.query(`
      SELECT id, name, campaign_id, client_id, limit_per_run, target_count, triggered_at, created_at, status, error_message
      FROM public.campaign_dispatches
      WHERE status IN ('running', 'interrupted')
      ORDER BY triggered_at ASC NULLS LAST
    `);

    if (!orphanDispatches || orphanDispatches.length === 0) {
      return { recovered: 0, items: [] };
    }

    const items = [];

    for (const disp of orphanDispatches) {
      const dispatchId = disp.id;

      // 2. Contar leads já enviados com sucesso ('sent')
      const sentRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM public.campaign_dispatch_runs WHERE dispatch_id = $1 AND status = 'sent'`,
        [dispatchId]
      ).catch(() => ({ rows: [{ cnt: 0 }] }));
      const sentCount = Number(sentRes.rows[0]?.cnt || 0);

      // 3. Contar e tratar leads em 'claimed' sem confirmação de envio
      const claimedRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM public.campaign_dispatch_runs WHERE dispatch_id = $1 AND status = 'claimed'`,
        [dispatchId]
      ).catch(() => ({ rows: [{ cnt: 0 }] }));
      const claimedCount = Number(claimedRes.rows[0]?.cnt || 0);

      if (claimedCount > 0) {
        // Marca leads em 'claimed' como 'skipped' para que constem no histórico como não confirmados
        // e NÃO sejam reenviados automaticamente.
        await pool.query(
          `UPDATE public.campaign_dispatch_runs
           SET status = 'skipped',
               error_message = 'Interrompido antes da confirmação de envio (envio não confirmado no restart do servidor)'
           WHERE dispatch_id = $1 AND status = 'claimed'`,
          [dispatchId]
        ).catch((err) => {
          console.warn("[boot-recovery] falha ao atualizar status de leads em 'claimed':", err?.message || err);
        });
      }

      // 4. Contar falhas
      const failedRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM public.campaign_dispatch_runs WHERE dispatch_id = $1 AND status = 'failed'`,
        [dispatchId]
      ).catch(() => ({ rows: [{ cnt: 0 }] }));
      const failedCount = Number(failedRes.rows[0]?.cnt || 0);

      // 5. O lote já terminou? Desfechos (inclusive os 'skipped' acima) contra o alvo gravado.
      const targetCount = Number(disp.target_count || 0);
      let outcomeCount = null;
      if (targetCount > 0) {
        try {
          const outcomeRes = await pool.query(
            `SELECT COUNT(*)::int AS cnt FROM public.campaign_dispatch_runs
             WHERE dispatch_id = $1 AND status IN ('sent', 'failed', 'invalid_number', 'skipped')`,
            [dispatchId]
          );
          outcomeCount = Number(outcomeRes.rows[0]?.cnt || 0);
        } catch (err) {
          console.warn("[boot-recovery] falha ao contar desfechos do lote; vai para 'paused':", err?.message || err);
        }
      }
      if (outcomeCount !== null && outcomeCount >= targetCount) {
        await pool.query(
          `UPDATE public.campaign_dispatches
           SET status = 'done',
               sent_count = $1,
               failed_count = $2,
               error_message = NULL,
               finished_at = COALESCE(finished_at, now()),
               updated_at = now()
           WHERE id = $3 AND status IN ('running', 'interrupted')`,
          [sentCount, failedCount, dispatchId]
        );
        console.log("[boot-recovery] lote completo fechado como 'done':", {
          dispatchId,
          dispatchName: disp.name,
          campaignId: disp.campaign_id,
          clientId: disp.client_id,
          statusAnterior: disp.status,
          desfechos: outcomeCount,
          targetCount,
        });
        items.push({
          dispatchId,
          dispatchName: disp.name,
          campaignId: disp.campaign_id,
          clientId: disp.client_id,
          leadsSent: sentCount,
          leadsFailed: failedCount,
          leadsUnconfirmed: claimedCount,
          errorMessage: null,
          novoStatus: "done",
        });
        continue;
      }

      // 6. Formular mensagem explicativa
      let errorMessage = "Pausado — servidor reiniciou durante o envio. Retome quando quiser.";
      if (claimedCount > 0) {
        errorMessage = `Pausado — servidor reiniciou durante o envio (${claimedCount} lead(s) com envio não confirmado). Retome quando quiser.`;
      }

      // 7. Atualizar o lote em campaign_dispatches para 'paused' para controle manual seguro pelo usuário
      await pool.query(
        `UPDATE public.campaign_dispatches
         SET status = 'paused',
             sent_count = $1,
             failed_count = $2,
             error_message = $3,
             finished_at = NULL,
             updated_at = now()
         WHERE id = $4 AND status IN ('running', 'interrupted')`,
        [sentCount, failedCount, errorMessage, dispatchId]
      );

      console.log("[boot-recovery] lote órfão pausado com segurança:", {
        dispatchId,
        dispatchName: disp.name,
        campaignId: disp.campaign_id,
        clientId: disp.client_id,
        leadsSent: sentCount,
        leadsFailed: failedCount,
        leadsUnconfirmed: claimedCount,
        novoStatus: "paused",
      });

      items.push({
        dispatchId,
        dispatchName: disp.name,
        campaignId: disp.campaign_id,
        clientId: disp.client_id,
        leadsSent: sentCount,
        leadsFailed: failedCount,
        leadsUnconfirmed: claimedCount,
        errorMessage,
        novoStatus: "paused",
      });
    }

    const fechados = items.filter((i) => i.novoStatus === "done").length;
    console.log(`[boot-recovery] ${items.length} lote(s) órfão(s) recuperado(s): ${fechados} completo(s) fechado(s) como 'done', ${items.length - fechados} pausado(s) para retomada manual.`);
    return { recovered: items.length, items };
  } catch (err) {
    console.error("[boot-recovery] erro ao verificar/recuperar lotes órfãos:", err?.message || err);
    return { recovered: 0, error: err?.message || String(err) };
  }
}
