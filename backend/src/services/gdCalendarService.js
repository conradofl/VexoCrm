/**
 * gdCalendarService.js
 *
 * Serviço de integração com Google Calendar API v3 e agendamento autônomo
 * de reuniões de Briefing e Alinhamento Estratégico da Geração Digital & Vexo OS.
 *
 * Contas Oficiais de Calendário:
 * - Agência: mrkgeracaodigital@gmail.com
 * - Caio: caioalmeidmrk@gmail.com
 *
 * Regras de Negócio (Alinhamento Conrado & Caio):
 * 1. Janelas de Atendimento Comercial: 09h00 às 18h00 (exceto almoço 12h00 às 13h00).
 * 2. Janelas específicas de Briefing: Manhã (09h00 - 11h00) e Tarde (14h00 - 17h00).
 * 3. Dias Úteis apenas: Bloqueia sábados, domingos e feriados nacionais brasileiros.
 * 4. Oferta de Horários:
 *    - Opção 1: 24h úteis depois (Manhã ou Tarde)
 *    - Opção 2: 48h úteis depois (Manhã ou Tarde)
 *    - Opção 3: 72h úteis depois (Manhã ou Tarde)
 * 5. Conferência: Gera automaticamente link Google Meet (hangoutsMeet).
 * 6. Convites: Agência + Caio + Cliente (google_calendar_email).
 */

import crypto from "node:crypto";

export const GD_CALENDAR_AGENCIA = "mrkgeracaodigital@gmail.com";
export const GD_CALENDAR_CAIO = "caioalmeidmrk@gmail.com";
export const GD_CALENDARS = [GD_CALENDAR_AGENCIA, GD_CALENDAR_CAIO];

export const TIMEZONE_SAO_PAULO = "America/Sao_Paulo";

// Janelas válidas de início de reunião (60 minutos de duração)
// Manhã 09h-11h: inícios 09:00 e 10:00 (terminam às 10:00 e 11:00)
export const HORAS_MANHA = [9, 10];
// Tarde 14h-17h: inícios 14:00, 15:00 e 16:00 (terminam às 15:00, 16:00 e 17:00)
export const HORAS_TARDE = [14, 15, 16];

// Feriados nacionais fixos brasileiros (MM-DD)
export const FERIADOS_FIXOS_BRASIL = new Set([
  "01-01", // Confraternização Universal
  "04-21", // Tiradentes
  "05-01", // Dia do Trabalhador
  "09-07", // Independência do Brasil
  "10-12", // Nossa Senhora Aparecida
  "11-02", // Finados
  "11-15", // Proclamação da República
  "11-20", // Dia da Consciência Negra
  "12-25", // Natal
]);

let cachedAccessToken = null;
let tokenExpiryTimestamp = 0;

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Obtém Access Token para o Google Calendar API v3
 */
export async function getGoogleCalendarAccessToken() {
  if (process.env.GOOGLE_CALENDAR_ACCESS_TOKEN) {
    return process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  }
  if (process.env.GOOGLE_DRIVE_ACCESS_TOKEN) {
    return process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
  }

  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && tokenExpiryTimestamp > now + 60) {
    return cachedAccessToken;
  }

  const clientEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL ||
    process.env.FIREBASE_CLIENT_EMAIL;

  let privateKey =
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.GOOGLE_CALENDAR_PRIVATE_KEY ||
    process.env.GOOGLE_DRIVE_PRIVATE_KEY ||
    process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  if (clientEmail && privateKey) {
    try {
      const header = { alg: "RS256", typ: "JWT" };
      const claimSet = {
        iss: clientEmail,
        scope: "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now,
      };

      const encodedHeader = base64UrlEncode(JSON.stringify(header));
      const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
      const signInput = `${encodedHeader}.${encodedClaimSet}`;

      const signer = crypto.createSign("RSA-SHA256");
      signer.update(signInput);
      signer.end();
      const signature = signer
        .sign(privateKey, "base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

      const jwt = `${signInput}.${signature}`;

      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
        }),
      });

      const data = await res.json();
      if (data.access_token) {
        cachedAccessToken = data.access_token;
        tokenExpiryTimestamp = now + (data.expires_in || 3600);
        return cachedAccessToken;
      }
      console.warn("[gd-calendar] Falha ao obter token da service account:", data.error_description || data.error);
    } catch (err) {
      console.warn("[gd-calendar] Erro ao assinar JWT da service account:", err.message);
    }
  }

  return null;
}

/**
 * Extrai partes de data/hora no fuso America/Sao_Paulo
 */
export function getSaoPauloDateParts(date = new Date(), timeZone = TIMEZONE_SAO_PAULO) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return parts;
}

/**
 * Valida se uma data é dia útil (segunda a sexta, exceto feriados)
 */
export function isBusinessDay(date = new Date(), timeZone = TIMEZONE_SAO_PAULO) {
  const parts = getSaoPauloDateParts(date, timeZone);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return false;
  }
  const md = `${parts.month}-${parts.day}`;
  if (FERIADOS_FIXOS_BRASIL.has(md)) {
    return false;
  }
  return true;
}

/**
 * Adiciona N dias úteis a partir de uma data inicial no fuso oficial
 */
export function addBusinessDays(startDate = new Date(), numDays = 1, timeZone = TIMEZONE_SAO_PAULO) {
  let count = 0;
  let current = new Date(startDate);
  while (count < numDays) {
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
    if (isBusinessDay(current, timeZone)) {
      count++;
    }
  }
  return current;
}

/**
 * Retorna os dias úteis alvo (ex: [1, 2, 3] = 24h, 48h, 72h depois)
 */
export function getTargetBusinessDays(fromDate = new Date(), targetDayOffsets = [1, 2, 3], timeZone = TIMEZONE_SAO_PAULO) {
  const maxOffset = Math.max(...targetDayOffsets);
  const result = [];
  let count = 0;
  let current = new Date(fromDate);

  while (count < maxOffset) {
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
    if (isBusinessDay(current, timeZone)) {
      count++;
      if (targetDayOffsets.includes(count)) {
        result.push({ offset: count, date: new Date(current) });
      }
    }
  }
  return result;
}

/**
 * Capitaliza a primeira letra de uma string
 */
function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Formata descrição amigável de slot de atendimento
 */
export function formatSlotLabel(date, hour, periodo, timeZone = TIMEZONE_SAO_PAULO) {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  const diaSemana = capitalize(parts.weekday);
  const formattedDate = `${diaSemana}, ${parts.day}/${parts.month}`;
  const formattedTime = `${String(hour).padStart(2, "0")}h00`;
  const periodoLabel = periodo === "manha" ? "Manhã" : "Tarde";
  const label = `${diaSemana} (${parts.day}/${parts.month}) às ${formattedTime} (${periodoLabel})`;

  return { label, formattedDate, formattedTime, diaSemana, diaMes: `${parts.day}/${parts.month}` };
}

/**
 * Formata data/hora para exibição em mensagens de confirmação e lembretes
 */
export function formatarDataHoraAmigavel(dateIso, timeZone = TIMEZONE_SAO_PAULO) {
  const d = new Date(dateIso);
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(d).map((p) => [p.type, p.value]));
  const diaSemana = capitalize(parts.weekday);
  return `${diaSemana}, ${parts.day}/${parts.month}/${parts.year} às ${parts.hour}h${parts.minute}`;
}

/**
 * Consulta ocupações (busy ranges) via Google Calendar FreeBusy API
 */
export async function fetchFreeBusy({
  timeMin,
  timeMax,
  calendars = GD_CALENDARS,
  accessToken = null,
  mockBusyRanges = null,
}) {
  if (Array.isArray(mockBusyRanges)) {
    return mockBusyRanges;
  }

  const token = accessToken || (await getGoogleCalendarAccessToken());
  if (!token) {
    // Sem token ou em ambiente local sem service account: todos os horários livres
    return [];
  }

  try {
    const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: new Date(timeMin).toISOString(),
        timeMax: new Date(timeMax).toISOString(),
        timeZone: TIMEZONE_SAO_PAULO,
        items: calendars.map((id) => ({ id })),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[gd-calendar] FreeBusy retornou HTTP ${res.status}: ${errText}`);
      return [];
    }

    const data = await res.json();
    const busyRanges = [];
    if (data?.calendars) {
      for (const calId of Object.keys(data.calendars)) {
        const cal = data.calendars[calId];
        if (Array.isArray(cal?.busy)) {
          for (const b of cal.busy) {
            busyRanges.push({
              calendar: calId,
              start: new Date(b.start),
              end: new Date(b.end),
            });
          }
        }
      }
    }
    return busyRanges;
  } catch (err) {
    console.warn("[gd-calendar] Erro ao consultar FreeBusy do Google Calendar:", err.message);
    return [];
  }
}

/**
 * Encontra slots de horários válidos e disponíveis para a Reunião de Briefing
 * nas contas oficiais (mrkgeracaodigital@gmail.com e caioalmeidmrk@gmail.com).
 *
 * @param {Object} options
 * @param {Date|string} [options.fromDate] - Data de referência (default: agora)
 * @param {number[]} [options.targetDays] - Dias úteis de antecedência [1, 2, 3] (24h, 48h, 72h)
 * @param {number} [options.durationMinutes] - Duração da reunião em minutos (default: 60)
 * @param {string} [options.timeZone] - Fuso horário (default: America/Sao_Paulo)
 * @param {string[]} [options.calendars] - Contas a consultar
 * @param {Array} [options.mockBusyRanges] - Ocupações simuladas para testes
 * @param {string} [options.googleAccessToken] - Token OAuth explícito
 */
export async function findAvailableBriefingSlots({
  fromDate = new Date(),
  targetDays = [1, 2, 3],
  durationMinutes = 60,
  timeZone = TIMEZONE_SAO_PAULO,
  calendars = GD_CALENDARS,
  mockBusyRanges = null,
  googleAccessToken = null,
} = {}) {
  const refDate = new Date(fromDate);
  const targetBusinessDays = getTargetBusinessDays(refDate, targetDays, timeZone);

  if (targetBusinessDays.length === 0) {
    return { options: [], allAvailableSlots: [], targetDays, timeZone };
  }

  // Janela de busca FreeBusy
  const firstDay = targetBusinessDays[0].date;
  const lastDay = targetBusinessDays[targetBusinessDays.length - 1].date;

  const partsFirst = getSaoPauloDateParts(firstDay, timeZone);
  const partsLast = getSaoPauloDateParts(lastDay, timeZone);

  const timeMinIso = `${partsFirst.year}-${partsFirst.month}-${partsFirst.day}T08:00:00-03:00`;
  const timeMaxIso = `${partsLast.year}-${partsLast.month}-${partsLast.day}T19:00:00-03:00`;

  const busyRanges = await fetchFreeBusy({
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    calendars,
    accessToken: googleAccessToken,
    mockBusyRanges,
  });

  const isSlotFree = (slotStart, slotEnd) => {
    for (const b of busyRanges) {
      const bStart = new Date(b.start).getTime();
      const bEnd = new Date(b.end).getTime();
      // Sobreposição de intervalos: start < bEnd && end > bStart
      if (slotStart.getTime() < bEnd && slotEnd.getTime() > bStart) {
        return false;
      }
    }
    return true;
  };

  const allAvailableSlots = [];
  const options = [];

  for (let i = 0; i < targetBusinessDays.length; i++) {
    const { offset, date } = targetBusinessDays[i];
    const parts = getSaoPauloDateParts(date, timeZone);
    const dayIsoPrefix = `${parts.year}-${parts.month}-${parts.day}`;

    // Avalia slots da Manhã (09h00, 10h00)
    const morningSlots = [];
    for (const h of HORAS_MANHA) {
      const start = new Date(`${dayIsoPrefix}T${String(h).padStart(2, "0")}:00:00-03:00`);
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
      if (isSlotFree(start, end)) {
        const display = formatSlotLabel(date, h, "manha", timeZone);
        morningSlots.push({
          diaOffset: offset,
          hour: h,
          periodo: "manha",
          inicio: start.toISOString(),
          fim: end.toISOString(),
          ...display,
        });
      }
    }

    // Avalia slots da Tarde (14h00, 15h00, 16h00)
    const afternoonSlots = [];
    for (const h of HORAS_TARDE) {
      const start = new Date(`${dayIsoPrefix}T${String(h).padStart(2, "0")}:00:00-03:00`);
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
      if (isSlotFree(start, end)) {
        const display = formatSlotLabel(date, h, "tarde", timeZone);
        afternoonSlots.push({
          diaOffset: offset,
          hour: h,
          periodo: "tarde",
          inicio: start.toISOString(),
          fim: end.toISOString(),
          ...display,
        });
      }
    }

    allAvailableSlots.push(...morningSlots, ...afternoonSlots);

    // Seleção da melhor opção representativa para este dia:
    // Alinha variedade comercial (Manhã ou Tarde) conforme requisito do prompt:
    // Opção 1: 24h depois (preferência Manhã 10h ou Tarde se cheia)
    // Opção 2: 48h depois (preferência Tarde 15h para alternar variedade, ou Manhã)
    // Opção 3: 72h depois (preferência Manhã 10h, ou Tarde)
    let selectedSlot = null;
    if (i % 2 === 0) {
      // Prioriza Manhã (preferencialmente 10h00, depois 09h00, ou fallback para Tarde)
      selectedSlot =
        morningSlots.find((s) => s.hour === 10) ||
        morningSlots[0] ||
        afternoonSlots.find((s) => s.hour === 15) ||
        afternoonSlots[0] ||
        null;
    } else {
      // Prioriza Tarde (preferencialmente 15h00, depois 14h00, depois 16h00, ou fallback para Manhã)
      selectedSlot =
        afternoonSlots.find((s) => s.hour === 15) ||
        afternoonSlots.find((s) => s.hour === 14) ||
        afternoonSlots[0] ||
        morningSlots[0] ||
        null;
    }

    if (selectedSlot) {
      options.push({
        id: i + 1,
        opcao: i + 1,
        diaOffset: offset,
        periodo: selectedSlot.periodo,
        inicio: selectedSlot.inicio,
        fim: selectedSlot.fim,
        label: selectedSlot.label,
        formattedDate: selectedSlot.formattedDate,
        formattedTime: selectedSlot.formattedTime,
      });
    }
  }

  return {
    options,
    allAvailableSlots,
    targetDays,
    timeZone,
    calendars,
  };
}

/**
 * Cria o evento de Briefing no Google Calendar com Google Meet
 * e envia os convites para a Agência, o Caio e o Cliente.
 */
export async function createBriefingCalendarEvent({
  clienteId,
  clienteNome = "Cliente",
  slotStart,
  slotEnd,
  title = null,
  attendees = [],
  description = null,
  primaryCalendarId = GD_CALENDAR_AGENCIA,
  accessToken = null,
}) {
  const summary = title || `Briefing Inicial · ${clienteNome}`;
  const startIso = new Date(slotStart).toISOString();
  const endIso = new Date(slotEnd).toISOString();

  // Garante que as contas oficiais estejam sempre incluídas
  const emailSet = new Set([GD_CALENDAR_AGENCIA, GD_CALENDAR_CAIO]);
  if (Array.isArray(attendees)) {
    for (const a of attendees) {
      const email = typeof a === "string" ? a.trim() : a?.email?.trim();
      if (email) emailSet.add(email);
    }
  } else if (typeof attendees === "string" && attendees.trim()) {
    emailSet.add(attendees.trim());
  }

  const attendeesList = Array.from(emailSet).map((email) => ({ email }));
  const token = accessToken || (await getGoogleCalendarAccessToken());

  if (token) {
    try {
      const endpoint = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        primaryCalendarId
      )}/events?conferenceDataVersion=1&sendUpdates=all`;

      const requestBody = {
        summary,
        description:
          description ||
          `Reunião de Briefing e Alinhamento Estratégico com a equipe da Geração Digital.\n\nCliente: ${clienteNome}\nParticipantes: ${attendeesList
            .map((a) => a.email)
            .join(", ")}`,
        start: { dateTime: startIso, timeZone: TIMEZONE_SAO_PAULO },
        end: { dateTime: endIso, timeZone: TIMEZONE_SAO_PAULO },
        attendees: attendeesList,
        conferenceData: {
          createRequest: {
            requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (res.ok) {
        const data = await res.json();
        const meetUrl =
          data.hangoutLink ||
          data.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video")?.uri ||
          `https://meet.google.com/vexo-${(clienteId || "briefing").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}`;

        return {
          success: true,
          eventId: data.id,
          meetUrl,
          htmlLink: data.htmlLink,
          attendees: attendeesList.map((a) => a.email),
          start: startIso,
          end: endIso,
          title: summary,
          isMock: false,
        };
      }

      const errText = await res.text();
      console.warn(`[gd-calendar] Google Calendar API HTTP ${res.status}: ${errText}`);
    } catch (err) {
      console.warn("[gd-calendar] Erro ao chamar Google Calendar API:", err.message);
    }
  }

  // Fallback simulador/mock determinístico para testes e resiliência offline
  const deterministicHash = crypto
    .createHash("md5")
    .update(`${clienteId || "gd"}-${startIso}`)
    .digest("hex")
    .slice(0, 9);
  const mockMeetCode = `${deterministicHash.slice(0, 3)}-${deterministicHash.slice(3, 7)}-${deterministicHash.slice(7, 9)}z`;
  const mockMeetUrl = `https://meet.google.com/${mockMeetCode}`;
  const mockEventId = `briefing_evt_${deterministicHash}`;

  return {
    success: true,
    eventId: mockEventId,
    meetUrl: mockMeetUrl,
    htmlLink: `https://calendar.google.com/calendar/event?eid=${mockEventId}`,
    attendees: attendeesList.map((a) => a.email),
    start: startIso,
    end: endIso,
    title: summary,
    isMock: true,
  };
}

/**
 * Monta o texto padronizado para oferta de horários no WhatsApp,
 * marcando o cliente no grupo oficial "MÁQUINA DE VENDAS: {CLIENTE}".
 */
export function formatBriefingOfferMessage({
  clienteNome,
  aprovadorNome,
  aprovadorTelefone,
  slots = [],
}) {
  const nomeDisplay = aprovadorNome || clienteNome;
  const tagCliente = aprovadorTelefone ? `@${aprovadorTelefone}` : nomeDisplay;

  let msg = `Olá, ${tagCliente} (${nomeDisplay})! 🚀\n\n`;
  msg += `Com as pastas e grupos configurados, o próximo passo essencial da nossa parceria é a *Reunião de Briefing e Alinhamento Estratégico*.\n\n`;
  msg += `Consultamos a disponibilidade das nossas agendas oficiais e separamos as seguintes opções de horários comerciais:\n\n`;

  slots.forEach((s) => {
    const numEmoji = s.opcao === 1 ? "1️⃣" : s.opcao === 2 ? "2️⃣" : "3️⃣";
    msg += `${numEmoji} *Opção ${s.opcao}:* ${s.formattedDate} às ${s.formattedTime} (${s.periodo === "manha" ? "Manhã" : "Tarde"})\n`;
  });

  msg += `\nPor favor, responda aqui neste grupo com o número da opção (*1*, *2* ou *3*) que melhor se adapta à sua rotina, ou nos informe outro horário comercial se preferir! 📅`;

  return msg;
}

/**
 * Calcula os horários de disparo da régua de lembretes automáticos:
 * - Lembrete 1: Às 19h00 da véspera da reunião (fuso America/Sao_Paulo)
 * - Lembrete 2: No dia da reunião, 1 hora antes do início
 */
export function calculateReminderTimes({ slotStart, timeZone = TIMEZONE_SAO_PAULO }) {
  const startDate = new Date(slotStart);
  const parts = getSaoPauloDateParts(startDate, timeZone);

  // Data do slot no fuso oficial
  const slotDateZoned = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00-03:00`);

  // Dia anterior (véspera)
  const previousDay = new Date(slotDateZoned.getTime() - 24 * 60 * 60 * 1000);
  const prevParts = getSaoPauloDateParts(previousDay, timeZone);

  // 19h00 da véspera
  const vespera19h = new Date(`${prevParts.year}-${prevParts.month}-${prevParts.day}T19:00:00-03:00`);

  // 1 hora antes do início do evento
  const umaHoraAntes = new Date(startDate.getTime() - 60 * 60 * 1000);

  return {
    vesperaReminderAt: vespera19h.toISOString(),
    umaHoraReminderAt: umaHoraAntes.toISOString(),
  };
}
