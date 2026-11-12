/**
 * gdBriefingReminderService.js
 *
 * Serviço e Agendador de Lembretes Ativos para Reuniões de Briefing
 * da Geração Digital & Vexo OS.
 *
 * Régua de Lembretes:
 * - Lembrete 1: Às 19h00 da véspera da reunião (mensagem no grupo do cliente e direto para o Caio).
 * - Lembrete 2: No dia da reunião, 1 hora antes do início (mensagem no grupo do cliente e direto para o Caio).
 *
 * Suporta execução periódica (cron/tick) e execução sob demanda via endpoint.
 */

import {
  formatarDataHoraAmigavel,
  calculateReminderTimes,
  createBriefingCalendarEvent,
  GD_CALENDAR_AGENCIA,
  GD_CALENDAR_CAIO,
} from "./gdCalendarService.js";
import { sendTextMessageViaEvolution } from "./evolution.js";
import { pgDatabasePool } from "./database.js";

export const GD_CAIO_WHATSAPP_PADRAO = "5534997719779";
export const DEFAULT_TICK_INTERVAL_MS = 30_000; // 30 segundos

let _schedulerInterval = null;
let _isProcessing = false;

/**
 * Processa a fila de lembretes de briefing pendentes no banco
 */
export async function processarLembretesBriefing({
  pool = pgDatabasePool,
  now = new Date(),
  evolutionSender = sendTextMessageViaEvolution,
  instanceName = null,
  clienteId = null,
} = {}) {
  const db = pool || pgDatabasePool;
  if (!db) {
    return { processados: 0, lembretesVespera: 0, lembretes1h: 0, error: "DATABASE_UNAVAILABLE" };
  }

  const effectiveInstance =
    instanceName ||
    process.env.GD_ONBOARDING_EVOLUTION_INSTANCE ||
    process.env.GD_EVOLUTION_INSTANCE ||
    "geracao-digital-comercial-hostery";
  const caioNumero = process.env.GD_CAIO_WHATSAPP || GD_CAIO_WHATSAPP_PADRAO;

  // Busca clientes com briefing agendado cujo fim ainda não passou
  const { rows: clientes } = await db.query(
    `SELECT c.id, c.nome, c.aprovador_nome, c.aprovador_telefone, c.google_calendar_email,
            c.grupo_cliente_jid, c.briefing_agendado_inicio, c.briefing_agendado_fim,
            c.briefing_meet_url, c.briefing_lembrete_vespera_agendado_para,
            c.briefing_lembrete_vespera_enviado_em, c.briefing_lembrete_1h_agendado_para,
            c.briefing_lembrete_1h_enviado_em
       FROM public.gd_clientes c
      WHERE c.estado_atual = 'BRIEFING_AGENDADO'
        AND c.briefing_agendado_inicio IS NOT NULL
        AND ($2::uuid IS NULL OR c.id = $2::uuid)
        AND (c.briefing_agendado_fim IS NULL OR c.briefing_agendado_fim > $1)
        AND (c.briefing_lembrete_vespera_enviado_em IS NULL OR c.briefing_lembrete_1h_enviado_em IS NULL)`,
    [new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), clienteId] // Até 2h após o fim para tolerância
  );

  let lembretesVespera = 0;
  let lembretes1h = 0;
  const nowTime = now.getTime();

  for (const c of clientes) {
    const dataFormatada = formatarDataHoraAmigavel(c.briefing_agendado_inicio);
    const horaFormatada = dataFormatada.split(" às ")[1] || "";
    const nomeDestinatario = c.aprovador_nome || c.nome;
    const tagCliente = c.aprovador_telefone ? `@${c.aprovador_telefone}` : nomeDestinatario;
    const meetUrl = c.briefing_meet_url || "Link disponível no convite da Google Agenda";

    // ── 1. Lembrete da Véspera (19h00) ───────────────────────────────────────
    if (
      c.briefing_lembrete_vespera_agendado_para &&
      !c.briefing_lembrete_vespera_enviado_em &&
      new Date(c.briefing_lembrete_vespera_agendado_para).getTime() <= nowTime
    ) {
      // Dispara no grupo do cliente (MÁQUINA DE VENDAS: {CLIENTE})
      if (c.grupo_cliente_jid) {
        const textoCliente =
          `🔔 *Lembrete de Briefing (Amanhã)*\n\n` +
          `Olá, ${tagCliente} (${nomeDestinatario})!\n\n` +
          `Lembramos que a nossa *Reunião de Briefing e Alinhamento Estratégico* acontece amanhã, *${dataFormatada}*.\n\n` +
          `🔗 *Link do Google Meet:* ${meetUrl}\n\n` +
          `Contamos com a sua presença para alinharmos toda a estratégia! Até breve! 🚀`;

        try {
          await evolutionSender({
            instanceName: effectiveInstance,
            number: c.grupo_cliente_jid,
            text: textoCliente,
          });
        } catch (err) {
          console.warn(`[gdBriefingReminder] Falha ao enviar lembrete véspera no grupo ${c.grupo_cliente_jid}:`, err.message);
        }
      }

      // Dispara direto para o Caio
      const textoCaio =
        `🔔 *Lembrete de Briefing GD (Amanhã)*\n\n` +
        `• *Cliente:* ${c.nome}\n` +
        `• *Data/Hora:* Amanhã, ${dataFormatada}\n` +
        `• *Meet:* ${meetUrl}\n` +
        `• *E-mail Cliente:* ${c.google_calendar_email || "N/A"}\n` +
        `• *Contato:* ${nomeDestinatario} (${c.aprovador_telefone || "N/A"})`;

      try {
        await evolutionSender({
          instanceName: effectiveInstance,
          number: caioNumero,
          text: textoCaio,
        });
      } catch (err) {
        console.warn(`[gdBriefingReminder] Falha ao enviar lembrete véspera para o Caio:`, err.message);
      }

      // Atualiza banco
      await db.query(
        `UPDATE public.gd_clientes
            SET briefing_lembrete_vespera_enviado_em = now()
          WHERE id = $1`,
        [c.id]
      );
      lembretesVespera++;
    }

    // ── 2. Lembrete de 1 hora antes ──────────────────────────────────────────
    if (
      c.briefing_lembrete_1h_agendado_para &&
      !c.briefing_lembrete_1h_enviado_em &&
      new Date(c.briefing_lembrete_1h_agendado_para).getTime() <= nowTime
    ) {
      // Dispara no grupo do cliente (MÁQUINA DE VENDAS: {CLIENTE})
      if (c.grupo_cliente_jid) {
        const textoCliente =
          `⏰ *Lembrete: Briefing em 1 hora!*\n\n` +
          `Olá, ${tagCliente} (${nomeDestinatario})!\n\n` +
          `A nossa *Reunião de Briefing e Alinhamento Estratégico* começa daqui a 1 hora, às *${horaFormatada}*.\n\n` +
          `🔗 *Link do Google Meet:* ${meetUrl}\n\n` +
          `Nos vemos em instantes! 🚀`;

        try {
          await evolutionSender({
            instanceName: effectiveInstance,
            number: c.grupo_cliente_jid,
            text: textoCliente,
          });
        } catch (err) {
          console.warn(`[gdBriefingReminder] Falha ao enviar lembrete 1h no grupo ${c.grupo_cliente_jid}:`, err.message);
        }
      }

      // Dispara direto para o Caio
      const textoCaio =
        `⏰ *Briefing em 1 hora!*\n\n` +
        `• *Cliente:* ${c.nome}\n` +
        `• *Início:* às ${horaFormatada}\n` +
        `• *Meet:* ${meetUrl}\n` +
        `• *Contato:* ${nomeDestinatario} (${c.aprovador_telefone || "N/A"})`;

      try {
        await evolutionSender({
          instanceName: effectiveInstance,
          number: caioNumero,
          text: textoCaio,
        });
      } catch (err) {
        console.warn(`[gdBriefingReminder] Falha ao enviar lembrete 1h para o Caio:`, err.message);
      }

      // Atualiza banco
      await db.query(
        `UPDATE public.gd_clientes
            SET briefing_lembrete_1h_enviado_em = now()
          WHERE id = $1`,
        [c.id]
      );
      lembretes1h++;
    }
  }

  return {
    processados: clientes.length,
    lembretesVespera,
    lembretes1h,
  };
}

/**
 * Inicia o agendador de lembretes ativos do Briefing
 */
export function startGdBriefingReminderScheduler({
  pool = pgDatabasePool,
  intervalMs = DEFAULT_TICK_INTERVAL_MS,
  evolutionSender = sendTextMessageViaEvolution,
} = {}) {
  if (_schedulerInterval) {
    return;
  }

  const tick = async () => {
    if (_isProcessing) return;
    _isProcessing = true;
    try {
      await processarLembretesBriefing({ pool, now: new Date(), evolutionSender });
    } catch (err) {
      console.warn("[gdBriefingReminderScheduler] Erro no tick de lembretes:", err.message);
    } finally {
      _isProcessing = false;
    }
  };

  _schedulerInterval = setInterval(tick, intervalMs);
  _schedulerInterval.unref?.();
  console.log("[gdBriefingReminderScheduler] Agendador de lembretes de Briefing iniciado (tick a cada", intervalMs, "ms).");
}

/**
 * Para o agendador de lembretes de Briefing
 */
export function stopGdBriefingReminderScheduler() {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
    console.log("[gdBriefingReminderScheduler] Agendador de lembretes de Briefing encerrado.");
  }
}

/**
 * Processa resposta autônoma do cliente enviada no WhatsApp
 * escolhendo a opção (1, 2 ou 3) de horário para a reunião de briefing.
 */
export async function processarRespostaBriefingNoWhatsApp({
  pool = pgDatabasePool,
  groupJid,
  text,
  instanceName = null,
  evolutionSender = sendTextMessageViaEvolution,
  calendarEventCreator = createBriefingCalendarEvent,
} = {}) {
  if (!pool || !groupJid || !text) return { handled: false };

  const match = text.trim().match(/^(?:op[cç][aã]o\s*)?([1-3])\b/i) || text.trim().match(/^(1️⃣|2️⃣|3️⃣)/);
  if (!match) return { handled: false };

  let opcaoNum = null;
  if (match[1] === "1️⃣") opcaoNum = 1;
  else if (match[1] === "2️⃣") opcaoNum = 2;
  else if (match[1] === "3️⃣") opcaoNum = 3;
  else opcaoNum = parseInt(match[1], 10);

  if (![1, 2, 3].includes(opcaoNum)) return { handled: false };

  const { rows } = await pool.query(
    `SELECT c.id, c.nome, c.aprovador_nome, c.aprovador_telefone, c.google_calendar_email,
            c.grupo_cliente_jid, c.briefing_slots_oferecidos, c.briefing_agendado_inicio,
            c.estado_atual
       FROM public.gd_clientes c
      WHERE c.grupo_cliente_jid = $1
        AND c.briefing_slots_oferecidos IS NOT NULL
        AND c.briefing_agendado_inicio IS NULL
      LIMIT 1`,
    [groupJid]
  );

  if (rows.length === 0) return { handled: false };

  const cliente = rows[0];
  const slots = Array.isArray(cliente.briefing_slots_oferecidos)
    ? cliente.briefing_slots_oferecidos
    : [];
  const slotEscolhido = slots.find((s) => Number(s.opcao) === opcaoNum || Number(s.id) === opcaoNum);
  if (!slotEscolhido) return { handled: false };

  const slotStart = slotEscolhido.inicio;
  const slotEnd = slotEscolhido.fim;
  const clientCalendarEmail = cliente.google_calendar_email || null;
  const effectiveInstance =
    instanceName ||
    process.env.GD_ONBOARDING_EVOLUTION_INSTANCE ||
    process.env.GD_EVOLUTION_INSTANCE ||
    "geracao-digital-comercial-hostery";

  // Cria evento no Google Calendar com Google Meet
  const eventResult = await calendarEventCreator({
    clienteId: cliente.id,
    clienteNome: cliente.nome,
    slotStart,
    slotEnd,
    title: `Briefing Inicial · ${cliente.nome}`,
    attendees: [
      GD_CALENDAR_AGENCIA,
      GD_CALENDAR_CAIO,
      clientCalendarEmail,
    ].filter(Boolean),
    description: `Reunião de Briefing e Alinhamento Estratégico com a equipe da Geração Digital.\n\nCliente: ${cliente.nome}\nResponsável: ${cliente.aprovador_nome || cliente.nome}`,
  });

  const reminderTimes = calculateReminderTimes({ slotStart });

  await pool.query(
    `UPDATE public.gd_clientes
        SET briefing_agendado_inicio = $1,
            briefing_agendado_fim = $2,
            briefing_meet_url = $3,
            briefing_calendar_event_id = $4,
            briefing_lembrete_vespera_agendado_para = $5,
            briefing_lembrete_1h_agendado_para = $6,
            briefing_lembrete_vespera_enviado_em = NULL,
            briefing_lembrete_1h_enviado_em = NULL
      WHERE id = $7`,
    [
      slotStart,
      slotEnd,
      eventResult.meetUrl,
      eventResult.eventId,
      reminderTimes.vesperaReminderAt,
      reminderTimes.umaHoraReminderAt,
      cliente.id,
    ]
  );

  // Registra evento de transição de estado se a função gd_registrar_evento existir
  try {
    await pool.query(
      `SELECT public.gd_registrar_evento($1, 'BRIEFING_AGENDADO', now(), false, 'fluxo', 'goclaw', 'bot_briefing', $2, $3::jsonb)`,
      [
        cliente.id,
        `Briefing confirmado pelo cliente no WhatsApp para ${slotStart}.`,
        JSON.stringify({
          briefing: {
            inicio: slotStart,
            fim: slotEnd,
            meet_url: eventResult.meetUrl,
            calendar_event_id: eventResult.eventId,
            attendees: eventResult.attendees,
            lembrete_vespera_agendado_para: reminderTimes.vesperaReminderAt,
            lembrete_1h_agendado_para: reminderTimes.umaHoraReminderAt,
          },
        }),
      ]
    );
  } catch (err) {
    console.warn("[processarRespostaBriefingNoWhatsApp] Aviso ao registrar evento:", err.message);
  }

  const dataFormatada = formatarDataHoraAmigavel(slotStart);
  const tagCliente = cliente.aprovador_telefone ? `@${cliente.aprovador_telefone}` : (cliente.aprovador_nome || cliente.nome);

  // 1. Notifica no grupo do cliente
  const textoCliente =
    `🎉 *Reunião de Briefing Confirmada!*\n\n` +
    `Olá, ${tagCliente} (${cliente.aprovador_nome || cliente.nome})! A nossa Reunião de Briefing e Alinhamento Estratégico foi agendada com sucesso.\n\n` +
    `📅 *Data/Horário:* ${dataFormatada}\n` +
    `🔗 *Link da Sala (Google Meet):* ${eventResult.meetUrl}\n\n` +
    (clientCalendarEmail
      ? `✉️ O convite com link do Google Meet foi enviado para *${clientCalendarEmail}*.\n\n`
      : "") +
    `Nos vemos em breve! Qualquer dúvida estamos por aqui. 🚀`;

  await evolutionSender({
    instanceName: effectiveInstance,
    number: groupJid,
    text: textoCliente,
  });

  // 2. Notifica Caio no WhatsApp
  const caioNumero = process.env.GD_CAIO_WHATSAPP || GD_CAIO_WHATSAPP_PADRAO;
  const textoCaio =
    `📅 *Briefing Agendado via WhatsApp!*\n\n` +
    `• *Cliente:* ${cliente.nome}\n` +
    `• *Data/Hora:* ${dataFormatada}\n` +
    `• *Google Meet:* ${eventResult.meetUrl}\n` +
    `• *Convidados:* mrkgeracaodigital@gmail.com, caioalmeidmrk@gmail.com, ${clientCalendarEmail || "cliente"}\n` +
    `• *Responsável:* ${cliente.aprovador_nome || cliente.nome} (${cliente.aprovador_telefone || "N/A"})`;

  await evolutionSender({
    instanceName: effectiveInstance,
    number: caioNumero,
    text: textoCaio,
  });

  return {
    handled: true,
    clienteId: cliente.id,
    opcao: opcaoNum,
    slot: slotEscolhido,
    eventResult,
    reminderTimes,
  };
}
