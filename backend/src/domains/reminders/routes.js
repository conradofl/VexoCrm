// backend/src/domains/reminders/routes.js
// Domínio de Lembretes Pessoais e Agendamento com Estado (WhatsApp / CRM)
// Lembretes internos não disparam mensagens para clientes via Evolution/BullMQ.
// Multi-tenant estrito por client_id via resolveAuthorizedClientId.

import { toCanonicalPhone, SQL_CANONICAL_PHONE } from "../../services/canonicalPhone.js";
import { SQL_HOJE_REMINDERS_CONDITION, SQL_HOJE_SCHEDULES_CONDITION } from "../../services/remindersHelper.js";

export function registerRemindersRoutes(app, deps) {
  const {
    ensureDb,
    normalizeString,
    pgDatabasePool,
    requireAppViewAccess,
    requireFirebaseAuth,
    resolveAuthorizedClientId,
    sendError,
  } = deps;

  // Bootstrap idempotente da tabela lead_reminders no boot
  (async () => {
    try {
      await pgDatabasePool.query(`
        CREATE TABLE IF NOT EXISTS public.lead_reminders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id TEXT NOT NULL,
          lead_id UUID,
          phone TEXT NOT NULL,
          lead_name TEXT,
          title TEXT NOT NULL,
          notes TEXT,
          remind_at TIMESTAMPTZ NOT NULL,
          assigned_to_uid TEXT,
          assigned_to_name TEXT,
          created_by_uid TEXT,
          created_by_name TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          completed_at TIMESTAMPTZ,
          completed_by_uid TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_lead_reminders_client_phone
          ON public.lead_reminders (client_id, phone);
        CREATE INDEX IF NOT EXISTS idx_lead_reminders_client_status_remind
          ON public.lead_reminders (client_id, status, remind_at);
      `).catch(() => {});
    } catch {
      // Ignora erro de boot caso pool não esteja pronto
    }
  })();

  // ─── GET /api/reminders/inbox-summary — Sumário de agendamentos e lembretes para o Inbox ───
  app.get("/api/reminders/inbox-summary", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const userUid = req.authAccess?.uid || req.authUser?.uid || null;
    const userEmail = req.authAccess?.email || req.authUser?.email || null;
    const operatorIdentifiers = [userUid, userEmail].filter(Boolean);
    const opIdentifiers = operatorIdentifiers.length > 0 ? operatorIdentifiers : ["__NONE__"];

    try {
      // 1. Agendamentos ativos em followup_schedules (tabela legada, suja)
      // Aplica obrigatoriamente SQL_CANONICAL_PHONE no SELECT e JOIN de followup_companies
      const schedulesQuery = `
        SELECT
          fs.id,
          fs.lead_name,
          ${SQL_CANONICAL_PHONE("fs.phone")} AS canonical_phone,
          fs.phone AS raw_phone,
          fs.company_id,
          fco.tenant_id,
          COALESCE(fco.name, 'Empresa') AS company_name,
          fs.campaign_id,
          COALESCE(fc.name, 'Mensagem Avulsa') AS campaign_name,
          fs.status AS raw_status,
          MIN(fj.scheduled_for) AS next_scheduled_for,
          COUNT(DISTINCT fs.id) AS total_active_schedules,
          COUNT(fj.id) FILTER (WHERE fj.status = 'sent') AS jobs_sent,
          COUNT(fj.id) FILTER (WHERE fj.status = 'failed') AS jobs_failed,
          COUNT(fj.id) FILTER (WHERE fj.status = 'pending') AS jobs_pending,
          (
            SELECT fj2.custom_message
            FROM public.followup_jobs fj2
            WHERE fj2.schedule_id = fs.id AND fj2.status = 'pending'
            ORDER BY fj2.scheduled_for ASC
            LIMIT 1
          ) AS custom_message,
          fs.created_at,
          (
            (MIN(fj.scheduled_for) AT TIME ZONE 'America/Sao_Paulo') < date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day'
          ) AS is_due_today_or_overdue
        FROM public.followup_schedules fs
        JOIN public.followup_companies fco ON fco.id = fs.company_id
        LEFT JOIN public.followup_campaigns fc ON fc.id = fs.campaign_id
        JOIN public.followup_jobs fj ON fj.schedule_id = fs.id
        WHERE fco.tenant_id = $1
          AND fs.status = 'active'
          AND fj.status = 'pending'
          AND fj.scheduled_for > NOW()
        GROUP BY fs.id, fs.lead_name, fs.phone, fs.company_id, fco.tenant_id, fco.name, fs.campaign_id, fc.name, fs.created_at
        ORDER BY next_scheduled_for ASC
      `;

      // 2. Lembretes pessoais pendentes em lead_reminders (tabela nova, limpa)
      // Telefone gravado de forma canônica na escrita; leitura por igualdade
      const remindersQuery = `
        SELECT
          lr.id,
          lr.lead_id,
          lr.phone,
          lr.lead_name,
          lr.title,
          lr.notes,
          lr.remind_at,
          lr.assigned_to_uid,
          lr.assigned_to_name,
          lr.created_by_uid,
          lr.created_by_name,
          lr.status,
          lr.created_at,
          (
            (lr.remind_at AT TIME ZONE 'America/Sao_Paulo') < date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day'
          ) AS is_due_today_or_overdue,
          (
            lr.assigned_to_uid = ANY($2)
            OR (lr.assigned_to_uid IS NULL AND lr.created_by_uid = ANY($2))
          ) AS is_for_current_user
        FROM public.lead_reminders lr
        WHERE lr.client_id = $1
          AND lr.status = 'pending'
        ORDER BY lr.remind_at ASC
      `;

      const [{ rows: scheduleRows }, { rows: reminderRows }] = await Promise.all([
        pgDatabasePool.query(schedulesQuery, [clientId]),
        pgDatabasePool.query(remindersQuery, [clientId, opIdentifiers]),
      ]);

      const itemsByPhone = {};
      let scheduledTodayCount = 0;
      let remindersTodayCount = 0;

      // Agrupa agendamentos por canonical_phone
      for (const row of scheduleRows) {
        const phone = row.canonical_phone;
        if (!phone) continue;

        if (row.is_due_today_or_overdue) {
          scheduledTodayCount++;
        }

        if (!itemsByPhone[phone]) {
          itemsByPhone[phone] = {
            phone,
            activeSchedule: null,
            activeReminders: [],
            todayDue: null,
          };
        }

        // Se ainda não tiver activeSchedule atribuído para este telefone, atribui o mais próximo
        if (!itemsByPhone[phone].activeSchedule) {
          itemsByPhone[phone].activeSchedule = {
            id: row.id,
            leadName: row.lead_name,
            phone: row.canonical_phone,
            rawPhone: row.raw_phone,
            origin: "manual",
            companyId: row.company_id,
            companyName: row.company_name,
            tenantId: row.tenant_id,
            campaignId: row.campaign_id || "",
            campaignName: row.campaign_name || "Mensagem Avulsa",
            customMessage: row.custom_message || null,
            status: "active",
            rawStatus: row.raw_status,
            jobsSent: Number(row.jobs_sent) || 0,
            jobsFailed: Number(row.jobs_failed) || 0,
            jobsPending: Number(row.jobs_pending) || 1,
            totalSteps: 1,
            currentStep: 1,
            lastSentAt: null,
            nextScheduledFor: row.next_scheduled_for ? new Date(row.next_scheduled_for).toISOString() : null,
            lastErrorLog: null,
            meetingDatetime: null,
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
            totalActiveCount: Number(row.total_active_schedules) || 1,
          };
        } else {
          // Incrementa contagem de agendamentos adicionais
          itemsByPhone[phone].activeSchedule.totalActiveCount =
            (itemsByPhone[phone].activeSchedule.totalActiveCount || 1) + 1;
        }

        if (row.is_due_today_or_overdue) {
          if (!itemsByPhone[phone].todayDue) {
            itemsByPhone[phone].todayDue = {
              hasScheduledToday: true,
              scheduledAt: row.next_scheduled_for ? new Date(row.next_scheduled_for).toISOString() : null,
              hasReminderToday: false,
              reminderTitle: null,
              reminderAt: null,
            };
          } else {
            itemsByPhone[phone].todayDue.hasScheduledToday = true;
            if (!itemsByPhone[phone].todayDue.scheduledAt && row.next_scheduled_for) {
              itemsByPhone[phone].todayDue.scheduledAt = new Date(row.next_scheduled_for).toISOString();
            }
          }
        }
      }

      // Agrupa lembretes pessoais por phone canônico
      for (const row of reminderRows) {
        const phone = row.phone;
        if (!phone) continue;

        const isTodayDue = Boolean(row.is_due_today_or_overdue && row.is_for_current_user);
        if (isTodayDue) {
          remindersTodayCount++;
        }

        if (!itemsByPhone[phone]) {
          itemsByPhone[phone] = {
            phone,
            activeSchedule: null,
            activeReminders: [],
            todayDue: null,
          };
        }

        const reminderObj = {
          id: row.id,
          leadId: row.lead_id,
          phone: row.phone,
          leadName: row.lead_name,
          title: row.title,
          notes: row.notes,
          remindAt: row.remind_at ? new Date(row.remind_at).toISOString() : null,
          assignedToUid: row.assigned_to_uid,
          assignedToName: row.assigned_to_name,
          createdByUid: row.created_by_uid,
          createdByName: row.created_by_name,
          status: row.status,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
          isDueTodayOrOverdue: Boolean(row.is_due_today_or_overdue),
          isForCurrentUser: Boolean(row.is_for_current_user),
        };

        itemsByPhone[phone].activeReminders.push(reminderObj);

        if (isTodayDue) {
          if (!itemsByPhone[phone].todayDue) {
            itemsByPhone[phone].todayDue = {
              hasScheduledToday: false,
              scheduledAt: null,
              hasReminderToday: true,
              reminderTitle: row.title,
              reminderAt: row.remind_at ? new Date(row.remind_at).toISOString() : null,
            };
          } else {
            itemsByPhone[phone].todayDue.hasReminderToday = true;
            if (!itemsByPhone[phone].todayDue.reminderTitle) {
              itemsByPhone[phone].todayDue.reminderTitle = row.title;
              itemsByPhone[phone].todayDue.reminderAt = row.remind_at ? new Date(row.remind_at).toISOString() : null;
            }
          }
        }
      }

      const todayCount = scheduledTodayCount + remindersTodayCount;

      return res.json({
        success: true,
        todayCount,
        scheduledTodayCount,
        remindersTodayCount,
        itemsByPhone,
      });
    } catch (err) {
      console.error("[reminders/inbox-summary] Erro:", err);
      return sendError(res, 500, "INBOX_SUMMARY_FAILED", err instanceof Error ? err.message : "Erro ao carregar sumário");
    }
  });

  // ─── GET /api/reminders — Lista lembretes com filtros ───
  app.get("/api/reminders", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const rawPhone = normalizeString(req.query.phone);
    const canonicalPhone = rawPhone ? toCanonicalPhone(rawPhone) : null;
    const status = normalizeString(req.query.status) || "pending";

    try {
      const params = [clientId, status];
      let phoneFilter = "";
      if (canonicalPhone) {
        params.push(canonicalPhone);
        phoneFilter = `AND phone = $${params.length}`;
      }

      const { rows } = await pgDatabasePool.query(
        `SELECT
           id, client_id, lead_id, phone, lead_name, title, notes,
           remind_at, assigned_to_uid, assigned_to_name,
           created_by_uid, created_by_name, status,
           completed_at, completed_by_uid, created_at, updated_at
         FROM public.lead_reminders
         WHERE client_id = $1 AND status = $2 ${phoneFilter}
         ORDER BY remind_at ASC`,
        params
      );

      return res.json({ success: true, items: rows });
    } catch (err) {
      return sendError(res, 500, "FETCH_REMINDERS_FAILED", err instanceof Error ? err.message : "Erro ao listar lembretes");
    }
  });

  // ─── POST /api/reminders — Cria novo lembrete pessoal (interno) ───
  app.post("/api/reminders", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const requestedClientId = normalizeString(body.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const rawPhone = normalizeString(body.phone);
    const canonicalPhone = toCanonicalPhone(rawPhone);
    if (!canonicalPhone) {
      return sendError(res, 400, "INVALID_PHONE", "Telefone do contato é obrigatório.");
    }

    const title = normalizeString(body.title);
    if (!title) {
      return sendError(res, 400, "MISSING_TITLE", "O título do lembrete não pode ficar em branco.");
    }

    const rawRemindAt = normalizeString(body.remindAt);
    if (!rawRemindAt) {
      return sendError(res, 400, "MISSING_REMIND_AT", "Defina a data e hora do lembrete.");
    }
    const remindAtDate = new Date(rawRemindAt);
    if (isNaN(remindAtDate.getTime())) {
      return sendError(res, 400, "INVALID_REMIND_AT", "Data e hora do lembrete inválidas.");
    }

    const leadId = normalizeString(body.leadId) || null;
    const leadName = normalizeString(body.leadName) || null;
    const notes = normalizeString(body.notes) || null;

    // Regra de atribuição: se assigned_to_uid for nulo/vazio, pertence ao criador
    const createdByUid = req.authAccess?.uid || req.authUser?.uid || "system";
    const createdByName = req.authAccess?.name || req.authUser?.displayName || null;
    let assignedToUid = normalizeString(body.assignedToUid) || null;
    let assignedToName = normalizeString(body.assignedToName) || null;

    if (!assignedToUid) {
      assignedToUid = createdByUid;
      assignedToName = createdByName;
    }

    try {
      const { rows } = await pgDatabasePool.query(
        `INSERT INTO public.lead_reminders (
           client_id, lead_id, phone, lead_name, title, notes,
           remind_at, assigned_to_uid, assigned_to_name,
           created_by_uid, created_by_name, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
         RETURNING *`,
        [
          clientId,
          leadId,
          canonicalPhone,
          leadName,
          title,
          notes,
          remindAtDate.toISOString(),
          assignedToUid,
          assignedToName,
          createdByUid,
          createdByName,
        ]
      );

      return res.status(201).json({ success: true, reminder: rows[0] });
    } catch (err) {
      return sendError(res, 500, "CREATE_REMINDER_FAILED", err instanceof Error ? err.message : "Erro ao criar lembrete");
    }
  });

  // ─── PATCH /api/reminders/:id/complete — Conclui lembrete pessoal em 1 clique ───
  app.patch("/api/reminders/:id/complete", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;

    const reminderId = normalizeString(req.params.id);
    if (!reminderId) return sendError(res, 400, "INVALID_PARAM", "Missing reminder ID");

    const requestedClientId = normalizeString(req.body?.clientId || req.query?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const userUid = req.authAccess?.uid || req.authUser?.uid || null;

    try {
      const { rows } = await pgDatabasePool.query(
        `UPDATE public.lead_reminders
         SET status = 'completed',
             completed_at = NOW(),
             completed_by_uid = $3,
             updated_at = NOW()
         WHERE id = $1 AND client_id = $2
         RETURNING *`,
        [reminderId, clientId, userUid]
      );

      if (!rows.length) {
        return sendError(res, 404, "NOT_FOUND", "Lembrete não encontrado ou não autorizado.");
      }

      return res.json({ success: true, reminder: rows[0] });
    } catch (err) {
      return sendError(res, 500, "COMPLETE_REMINDER_FAILED", err instanceof Error ? err.message : "Erro ao concluir lembrete");
    }
  });

  // ─── PATCH /api/reminders/:id — Edita título, anotações ou data do lembrete ───
  app.patch("/api/reminders/:id", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;

    const reminderId = normalizeString(req.params.id);
    if (!reminderId) return sendError(res, 400, "INVALID_PARAM", "Missing reminder ID");

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const requestedClientId = normalizeString(body.clientId || req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const updates = [];
    const params = [reminderId, clientId];

    if (body.title !== undefined) {
      const title = normalizeString(body.title);
      if (!title) return sendError(res, 400, "INVALID_TITLE", "Título não pode ser vazio.");
      params.push(title);
      updates.push(`title = $${params.length}`);
    }

    if (body.notes !== undefined) {
      params.push(normalizeString(body.notes) || null);
      updates.push(`notes = $${params.length}`);
    }

    if (body.remindAt !== undefined) {
      const d = new Date(body.remindAt);
      if (isNaN(d.getTime())) return sendError(res, 400, "INVALID_DATE", "Data inválida.");
      params.push(d.toISOString());
      updates.push(`remind_at = $${params.length}`);
    }

    if (body.assignedToUid !== undefined) {
      const assignedToUid = normalizeString(body.assignedToUid) || null;
      const assignedToName = normalizeString(body.assignedToName) || null;
      params.push(assignedToUid);
      updates.push(`assigned_to_uid = $${params.length}`);
      params.push(assignedToName);
      updates.push(`assigned_to_name = $${params.length}`);
    }

    if (!updates.length) {
      return sendError(res, 400, "NO_UPDATES", "Nenhum campo para atualizar.");
    }

    updates.push("updated_at = NOW()");

    try {
      const { rows } = await pgDatabasePool.query(
        `UPDATE public.lead_reminders
         SET ${updates.join(", ")}
         WHERE id = $1 AND client_id = $2
         RETURNING *`,
        params
      );

      if (!rows.length) {
        return sendError(res, 404, "NOT_FOUND", "Lembrete não encontrado ou não autorizado.");
      }

      return res.json({ success: true, reminder: rows[0] });
    } catch (err) {
      return sendError(res, 500, "UPDATE_REMINDER_FAILED", err instanceof Error ? err.message : "Erro ao atualizar lembrete");
    }
  });

  // ─── DELETE /api/reminders/:id — Exclusão física do lembrete ───
  app.delete("/api/reminders/:id", requireFirebaseAuth, requireAppViewAccess("whatsapp"), async (req, res) => {
    if (!ensureDb(res)) return;

    const reminderId = normalizeString(req.params.id);
    if (!reminderId) return sendError(res, 400, "INVALID_PARAM", "Missing reminder ID");

    const requestedClientId = normalizeString(req.query.clientId || req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    try {
      const { rowCount } = await pgDatabasePool.query(
        `DELETE FROM public.lead_reminders WHERE id = $1 AND client_id = $2`,
        [reminderId, clientId]
      );

      if (!rowCount || rowCount === 0) {
        return sendError(res, 404, "NOT_FOUND", "Lembrete não encontrado ou não autorizado.");
      }

      return res.json({ success: true, deletedId: reminderId });
    } catch (err) {
      return sendError(res, 500, "DELETE_REMINDER_FAILED", err instanceof Error ? err.message : "Erro ao excluir lembrete");
    }
  });
}
