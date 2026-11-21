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
 * - Leads em `campaign_dispatch_runs` que ficaram em `status = 'claimed'` NÃO são mais transformados em 'skipped' aqui
 *   (21/11/2026). O boot só conta e devolve os lotes em `claimedParaConferir`; o server.js dispara, DEPOIS de subir,
 *   a conferência (campaign/claimedConference.js), que espera 10 s e decide cada um: saída gravada = 'sent'; sem
 *   saída e sem a marca de envio iniciado = volta a pendente; sem saída e com a marca = 'skipped' (dúvida).
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
    const claimedParaConferir = [];

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

      // Os 'claimed' ficam como estão: a conferência depois do listen decide cada um (claimedConference.js).
      const claimedEmConferencia = claimedCount;
      if (claimedCount > 0) claimedParaConferir.push(dispatchId);

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
          claimedEmConferencia,
        });
        items.push({
          dispatchId,
          dispatchName: disp.name,
          campaignId: disp.campaign_id,
          clientId: disp.client_id,
          statusAnterior: disp.status,
          leadsSent: sentCount,
          leadsFailed: failedCount,
          leadsUnconfirmed: claimedCount,
          claimedEmConferencia,
          errorMessage: null,
          novoStatus: "done",
        });
        continue;
      }

      // 6. Formular mensagem explicativa
      let errorMessage = "Pausado — servidor reiniciou durante o envio. Retome quando quiser.";
      if (claimedCount > 0) {
        errorMessage = `Pausado — servidor reiniciou durante o envio (${claimedCount} lead(s) com envio em conferência). Retome quando quiser.`;
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

      // statusAnterior: 'running' = o reinício cortou um envio; 'interrupted' = o lote já estava parado com pendentes e
      // só mudou de nome (19/11 23:20Z, Nous: o log não dizia qual dos dois, 20/11/2026).
      console.log("[boot-recovery] lote órfão pausado com segurança:", {
        dispatchId,
        dispatchName: disp.name,
        campaignId: disp.campaign_id,
        clientId: disp.client_id,
        statusAnterior: disp.status,
        leadsSent: sentCount,
        leadsFailed: failedCount,
        leadsUnconfirmed: claimedCount,
        claimedEmConferencia,
        novoStatus: "paused",
      });

      items.push({
        dispatchId,
        dispatchName: disp.name,
        campaignId: disp.campaign_id,
        clientId: disp.client_id,
        statusAnterior: disp.status,
        leadsSent: sentCount,
        leadsFailed: failedCount,
        leadsUnconfirmed: claimedCount,
        claimedEmConferencia,
        errorMessage,
        novoStatus: "paused",
      });
    }

    const fechados = items.filter((i) => i.novoStatus === "done").length;
    console.log(`[boot-recovery] ${items.length} lote(s) órfão(s) recuperado(s): ${fechados} completo(s) fechado(s) como 'done', ${items.length - fechados} pausado(s) para retomada manual.`);
    return { recovered: items.length, items, claimedParaConferir };
  } catch (err) {
    console.error("[boot-recovery] erro ao verificar/recuperar lotes órfãos:", err?.message || err);
    return { recovered: 0, error: err?.message || String(err) };
  }
}
