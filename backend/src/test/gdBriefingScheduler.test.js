import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { GD_DONO, registerGdClientesRoutes } from "../domains/gdClientes/routes.js";
import {
  processarLembretesBriefing,
  processarRespostaBriefingNoWhatsApp,
  startGdBriefingReminderScheduler,
  stopGdBriefingReminderScheduler,
} from "../services/gdBriefingReminderService.js";
import { GD_CALENDAR_AGENCIA, GD_CALENDAR_CAIO } from "../services/gdCalendarService.js";

const MIGRATION = readFileSync(
  resolve("supabase/migrations/20261102120000_create_gd_estados_clientes.sql"),
  "utf8"
);
const MIGRATION_CAMPOS = readFileSync(
  resolve("supabase/migrations/20261103120000_gd_clientes_aprovador_drive_escopo.sql"),
  "utf8"
);
const MIGRATION_TRILHA = readFileSync(
  resolve("supabase/migrations/20261103180000_gd_estados_acao_rotulo_portal.sql"),
  "utf8"
);
const MIGRATION_DOCUMENTOS = readFileSync(
  resolve("supabase/migrations/20261105190000_gd_clientes_quatro_documentos.sql"),
  "utf8"
);
const MIGRATION_WHATSAPP = readFileSync(
  resolve("supabase/migrations/20261107100000_gd_clientes_whatsapp_groups.sql"),
  "utf8"
);
const MIGRATION_CALENDAR = readFileSync(
  resolve("supabase/migrations/20261108100000_gd_clientes_google_calendar_email.sql"),
  "utf8"
);
const MIGRATION_BRIEFING = readFileSync(
  resolve("supabase/migrations/20261108110000_gd_clientes_briefing_scheduling.sql"),
  "utf8"
);
const MIGRATION_FRENTE5 = readFileSync(
  resolve("supabase/migrations/20261108120000_gd_clientes_briefing_docs_approval.sql"),
  "utf8"
);
const MIGRATION_FRENTE6 = readFileSync(
  resolve("supabase/migrations/20261108160000_gd_clientes_vexto_briefing_and_chips.sql"),
  "utf8"
);
// A rota de clientes lê portal_slug e as colunas da régua de sucesso: sem esta migration todo endpoint dá 500.
const MIGRATION_CS_PORTAL = readFileSync(
  resolve("supabase/migrations/20261108180000_gd_clientes_customer_success_and_portal_slug.sql"),
  "utf8"
);

const PERFIS = {
  equipeGd: {
    uid: "uid-gd-conrado",
    role: "internal",
    isAdmin: false,
    clientId: GD_DONO,
    clientIds: [GD_DONO],
    permissions: ["geracao_digital.proposals"],
    internalPages: ["propostas-gd"],
  },
};

let db;
let server;
let base;

let mockEvolutionMessageSender;
let mockCalendarSlotFinder;
let mockCalendarEventCreator;

function poolDe(pg) {
  const query = async (sql, params) => pg.query(sql, params);
  const client = { query, release() {} };
  return { query, connect: async () => client };
}

async function chamar(metodo, caminho, { perfil = "equipeGd", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (perfil) {
    headers["x-teste-perfil"] = perfil;
  }

  const res = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  process.env.GD_CAIO_WHATSAPP = "5534997719779";
  process.env.GD_ONBOARDING_EVOLUTION_INSTANCE = "vexo-adm";

  db = await createPgliteDb(`
    SET TimeZone = 'UTC';
    CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text NOT NULL);
    INSERT INTO public.leads_clients VALUES ('geracao-digital', 'Geração Digital');
  `);

  await db.exec(MIGRATION);
  await db.exec(MIGRATION_CAMPOS);
  await db.exec(MIGRATION_TRILHA);
  await db.exec(MIGRATION_DOCUMENTOS);
  await db.exec(MIGRATION_WHATSAPP);
  await db.exec(MIGRATION_CALENDAR);
  await db.exec(MIGRATION_BRIEFING);
  await db.exec(MIGRATION_FRENTE5);
  await db.exec(MIGRATION_FRENTE6);
  await db.exec(MIGRATION_CS_PORTAL);

  mockEvolutionMessageSender = vi.fn().mockResolvedValue({ success: true });
  mockCalendarSlotFinder = vi.fn().mockResolvedValue({
    options: [
      {
        id: 1,
        opcao: 1,
        diaOffset: 1,
        periodo: "manha",
        inicio: "2026-11-10T13:00:00.000Z", // 10h00 BRT
        fim: "2026-11-10T14:00:00.000Z",
        label: "Terça-feira (10/11) às 10h00 (Manhã)",
        formattedDate: "Terça-feira, 10/11",
        formattedTime: "10h00",
      },
      {
        id: 2,
        opcao: 2,
        diaOffset: 2,
        periodo: "tarde",
        inicio: "2026-11-11T18:00:00.000Z", // 15h00 BRT
        fim: "2026-11-11T19:00:00.000Z",
        label: "Quarta-feira (11/11) às 15h00 (Tarde)",
        formattedDate: "Quarta-feira, 11/11",
        formattedTime: "15h00",
      },
      {
        id: 3,
        opcao: 3,
        diaOffset: 3,
        periodo: "manha",
        inicio: "2026-11-12T13:00:00.000Z", // 10h00 BRT
        fim: "2026-11-12T14:00:00.000Z",
        label: "Quinta-feira (12/11) às 10h00 (Manhã)",
        formattedDate: "Quinta-feira, 12/11",
        formattedTime: "10h00",
      },
    ],
  });

  mockCalendarEventCreator = vi.fn().mockImplementation(async ({ slotStart, slotEnd, title, attendees }) => ({
    success: true,
    eventId: "mock_evt_google_123",
    meetUrl: "https://meet.google.com/vexo-briefing-meet",
    htmlLink: "https://calendar.google.com/event/mock_evt_google_123",
    attendees,
    start: slotStart,
    end: slotEnd,
    title,
  }));

  const app = express();
  app.use(express.json());
  registerGdClientesRoutes(app, {
    getPool: () => poolDe(db),
    requireFirebaseAuth: (req, _res, next) => {
      req.authAccess = PERFIS[req.headers["x-teste-perfil"]];
      next();
    },
    evolutionGroupCreator: vi.fn().mockResolvedValue({ success: true, groupJid: "120363000999@g.us" }),
    evolutionInviteGetter: vi.fn().mockResolvedValue({ success: true, inviteUrl: "https://chat.whatsapp.com/invite" }),
    brandingAvatarGenerator: vi.fn().mockResolvedValue({ success: true, evolutionUpdated: true, driveFile: { fileLink: "https://drive..." } }),
    driveFolderSetup: vi.fn().mockResolvedValue({ driveLink: "https://drive..." }),
    evolutionMessageSender: (...args) => mockEvolutionMessageSender(...args),
    calendarSlotFinder: (...args) => mockCalendarSlotFinder(...args),
    calendarEventCreator: (...args) => mockCalendarEventCreator(...args),
  });

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  delete process.env.GD_CAIO_WHATSAPP;
  delete process.env.GD_ONBOARDING_EVOLUTION_INSTANCE;
});

beforeEach(async () => {
  vi.clearAllMocks();
});

let counter = 0;

async function criarClienteExemplo({
  nome = null,
  estado = "GRUPOS_CRIADOS",
  aprovadorNome = "Dr. Roberto",
  aprovadorTelefone = "5534991112233",
  googleCalendarEmail = "agenda@odontoprime.com.br",
  grupoClienteJid = "120363000999@g.us",
  slotsOferecidos = null,
} = {}) {
  counter++;
  const nomeFinal = nome || `Clínica Odonto Prime ${counter}`;
  const res = await db.query(
    `INSERT INTO public.gd_clientes (
       dono_client_id, nome, origem, aprovador_nome, aprovador_telefone,
       google_calendar_email, grupo_cliente_jid, briefing_slots_oferecidos
     )
     VALUES ($1, $2, 'fluxo', $3, $4, $5, $6, $7::jsonb)
     RETURNING id`,
    [
      GD_DONO,
      nomeFinal,
      aprovadorNome,
      aprovadorTelefone,
      googleCalendarEmail,
      grupoClienteJid,
      slotsOferecidos ? JSON.stringify(slotsOferecidos) : null,
    ]
  );
  const clienteId = res.rows[0].id;

  await db.query(
    `SELECT public.gd_registrar_evento($1, $2, now(), false, 'fluxo', 'humano', 'setup', 'Carga teste briefing')`,
    [clienteId, estado]
  );

  return clienteId;
}

describe("Agendador Autônomo de Briefing (Frente 4)", () => {
  describe("Oferta de Horários no WhatsApp", () => {
    it("onboarding dispara automaticamente a oferta de horários no grupo MÁQUINA DE VENDAS com as 3 opções", async () => {
      const clienteId = await criarClienteExemplo({
        estado: "ASSINADO",
        grupoClienteJid: null,
      });

      const r = await chamar("POST", `/api/gd/clientes/${clienteId}/onboarding/whatsapp-groups`, {
        body: {
          instance_name: "vexo-adm",
          equipe_telefones: ["5534991751267"],
        },
      });

      expect(r.status).toBe(201);
      expect(r.json.success).toBe(true);
      expect(r.json.briefing?.slots_oferecidos).toHaveLength(3);
      expect(r.json.briefing?.mensagem_enviada).toBe(true);

      // Verifica se a mensagem de oferta foi enviada no grupo
      expect(mockEvolutionMessageSender).toHaveBeenCalledWith(
        expect.objectContaining({
          number: expect.stringMatching(/@g\.us$/),
          text: expect.stringContaining("Reunião de Briefing e Alinhamento Estratégico"),
        })
      );

      // Verifica se os slots foram persistidos em gd_clientes
      const { rows } = await db.query(
        "SELECT briefing_slots_oferecidos FROM public.gd_clientes WHERE id = $1",
        [clienteId]
      );
      expect(rows[0].briefing_slots_oferecidos).toHaveLength(3);
    });

    it("POST /api/gd/clientes/:id/briefing/oferecer-horarios envia as 3 opções no WhatsApp marcando o cliente e salva no banco", async () => {
      const clienteId = await criarClienteExemplo();

      const r = await chamar("POST", `/api/gd/clientes/${clienteId}/briefing/oferecer-horarios`, {
        body: { instance_name: "vexo-adm" },
      });

      expect(r.status).toBe(200);
      expect(r.json.success).toBe(true);
      expect(r.json.slots).toHaveLength(3);
      expect(r.json.mensagem).toContain("@5534991112233");
      expect(r.json.mensagem).toContain("1️⃣ *Opção 1:* Terça-feira, 10/11 às 10h00 (Manhã)");
      expect(r.json.mensagem).toContain("2️⃣ *Opção 2:* Quarta-feira, 11/11 às 15h00 (Tarde)");
      expect(r.json.mensagem).toContain("3️⃣ *Opção 3:* Quinta-feira, 12/11 às 10h00 (Manhã)");

      // Verifica envio para a Evolution API
      expect(mockEvolutionMessageSender).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceName: "vexo-adm",
          number: "120363000999@g.us",
          text: expect.stringContaining("Reunião de Briefing e Alinhamento Estratégico"),
        })
      );

      // Verifica se gravou no banco
      const { rows } = await db.query(
        "SELECT briefing_slots_oferecidos FROM public.gd_clientes WHERE id = $1",
        [clienteId]
      );
      expect(rows[0].briefing_slots_oferecidos).toHaveLength(3);
      expect(rows[0].briefing_slots_oferecidos[0].opcao).toBe(1);
    });

    it("não falha a rota se o envio para a Evolution API falhar, salvando os slots e retornando whatsapp_disparado=false", async () => {
      mockEvolutionMessageSender.mockRejectedValueOnce(new Error("Evolution offline"));
      const clienteId = await criarClienteExemplo();

      const r = await chamar("POST", `/api/gd/clientes/${clienteId}/briefing/oferecer-horarios`, {
        body: { instance_name: "vexo-adm" },
      });

      expect(r.status).toBe(200);
      expect(r.json.success).toBe(true);
      expect(r.json.whatsapp_disparado).toBe(false);
      expect(r.json.whatsapp_erro).toBe("Evolution offline");

      // Confirma que os slots foram salvos mesmo com a falha de envio
      const { rows } = await db.query(
        "SELECT briefing_slots_oferecidos FROM public.gd_clientes WHERE id = $1",
        [clienteId]
      );
      expect(rows[0].briefing_slots_oferecidos).toHaveLength(3);
    });

    it("retorna 422 se o cliente não tiver grupo de atendimento configurado", async () => {
      const clienteId = await criarClienteExemplo({ grupoClienteJid: null });

      const r = await chamar("POST", `/api/gd/clientes/${clienteId}/briefing/oferecer-horarios`);
      expect(r.status).toBe(422);
      expect(r.json.error.code).toBe("GRUPO_CLIENTE_NAO_CONFIGURADO");
    });
  });

  describe("Confirmação e Agendamento do Briefing (POST /api/gd/clientes/:id/briefing/agendar)", () => {
    it("agenda briefing a partir da opção escolhida (opcao: 1), cria Google Meet, convida e-mails e notifica Caio e grupo", async () => {
      const slots = [
        {
          id: 1,
          opcao: 1,
          diaOffset: 1,
          periodo: "manha",
          inicio: "2026-11-10T13:00:00.000Z", // 10h00 BRT
          fim: "2026-11-10T14:00:00.000Z",
          label: "Terça-feira (10/11) às 10h00 (Manhã)",
        },
      ];
      const clienteId = await criarClienteExemplo({ slotsOferecidos: slots });

      const r = await chamar("POST", `/api/gd/clientes/${clienteId}/briefing/agendar`, {
        body: { opcao: 1 },
      });

      expect(r.status).toBe(200);
      expect(r.json.success).toBe(true);
      expect(r.json.cliente.estado_atual).toBe("BRIEFING_AGENDADO");
      expect(r.json.briefing.meet_url).toBe("https://meet.google.com/vexo-briefing-meet");
      expect(r.json.briefing.calendar_event_id).toBe("mock_evt_google_123");

      // Verifica criação do evento na Google Agenda
      expect(mockCalendarEventCreator).toHaveBeenCalledWith(
        expect.objectContaining({
          clienteId,
          slotStart: "2026-11-10T13:00:00.000Z",
          slotEnd: "2026-11-10T14:00:00.000Z",
          attendees: [
            GD_CALENDAR_AGENCIA,
            GD_CALENDAR_CAIO,
            "agenda@odontoprime.com.br",
          ],
        })
      );

      // Notificação 1: Confirmação no grupo do cliente
      expect(mockEvolutionMessageSender).toHaveBeenCalledWith(
        expect.objectContaining({
          number: "120363000999@g.us",
          text: expect.stringContaining("Reunião de Briefing Confirmada!"),
        })
      );

      // Notificação 2: Aviso direto para o WhatsApp do Caio
      expect(mockEvolutionMessageSender).toHaveBeenCalledWith(
        expect.objectContaining({
          number: "5534997719779",
          text: expect.stringContaining("Briefing Agendado!"),
        })
      );

      // Verifica salvamento no banco com horários dos lembretes calculados
      const { rows } = await db.query(
        `SELECT briefing_agendado_inicio, briefing_meet_url,
                briefing_lembrete_vespera_agendado_para, briefing_lembrete_1h_agendado_para
           FROM public.gd_clientes WHERE id = $1`,
        [clienteId]
      );
      expect(rows[0].briefing_agendado_inicio).toBeDefined();
      expect(rows[0].briefing_meet_url).toBe("https://meet.google.com/vexo-briefing-meet");
      // Véspera 19h00 BRT = 2026-11-09 22:00:00 UTC
      expect(new Date(rows[0].briefing_lembrete_vespera_agendado_para).toISOString()).toBe(
        "2026-11-09T22:00:00.000Z"
      );
      // 1 hora antes = 2026-11-10 12:00:00 UTC
      expect(new Date(rows[0].briefing_lembrete_1h_agendado_para).toISOString()).toBe(
        "2026-11-10T12:00:00.000Z"
      );
    });

    it("recusa agendamento se a opção informada não existir nos slots oferecidos", async () => {
      const clienteId = await criarClienteExemplo({ slotsOferecidos: [] });

      const r = await chamar("POST", `/api/gd/clientes/${clienteId}/briefing/agendar`, {
        body: { opcao: 5 },
      });

      expect(r.status).toBe(422);
      expect(r.json.error.code).toBe("OPCAO_SLOT_INVALIDA");
    });
  });

  describe("Resposta Autônoma do Cliente pelo WhatsApp", () => {
    it("processa resposta '1' no WhatsApp e agenda automaticamente o briefing", async () => {
      const slots = [
        {
          id: 1,
          opcao: 1,
          diaOffset: 1,
          periodo: "manha",
          inicio: "2026-11-10T13:00:00.000Z",
          fim: "2026-11-10T14:00:00.000Z",
          label: "Terça-feira (10/11) às 10h00 (Manhã)",
        },
      ];
      const clienteId = await criarClienteExemplo({
        grupoClienteJid: "120363000777@g.us",
        slotsOferecidos: slots,
      });

      const res = await processarRespostaBriefingNoWhatsApp({
        pool: poolDe(db),
        groupJid: "120363000777@g.us",
        text: "1",
        evolutionSender: mockEvolutionMessageSender,
        calendarEventCreator: mockCalendarEventCreator,
      });

      expect(res.handled).toBe(true);
      expect(res.clienteId).toBe(clienteId);
      expect(res.opcao).toBe(1);

      // Verifica confirmação disparada no grupo e para o Caio
      expect(mockEvolutionMessageSender).toHaveBeenCalledWith(
        expect.objectContaining({
          number: "120363000777@g.us",
          text: expect.stringContaining("Reunião de Briefing Confirmada!"),
        })
      );
      expect(mockEvolutionMessageSender).toHaveBeenCalledWith(
        expect.objectContaining({
          number: "5534997719779",
          text: expect.stringContaining("Briefing Agendado via WhatsApp!"),
        })
      );

      // Estado atualizado no banco
      const { rows } = await db.query(
        "SELECT estado_atual, briefing_meet_url FROM public.gd_clientes WHERE id = $1",
        [clienteId]
      );
      expect(rows[0].estado_atual).toBe("BRIEFING_AGENDADO");
      expect(rows[0].briefing_meet_url).toBe("https://meet.google.com/vexo-briefing-meet");
    });
  });

  describe("Régua de Lembretes Ativos (19h da Véspera e 1h Antes)", () => {
    it("dispara Lembrete 1 quando atinge 19h00 da véspera, notifica cliente e Caio e marca timestamp", async () => {
      const clienteId = await criarClienteExemplo({
        estado: "BRIEFING_AGENDADO",
        grupoClienteJid: "120363000888@g.us",
      });

      // Configura reunião para amanhã às 10h00
      const agora = new Date("2026-11-09T22:05:00.000Z"); // 19h05 BRT da véspera
      await db.query(
        `UPDATE public.gd_clientes
            SET briefing_agendado_inicio = '2026-11-10T13:00:00.000Z',
                briefing_agendado_fim = '2026-11-10T14:00:00.000Z',
                briefing_meet_url = 'https://meet.google.com/vexo-teste',
                briefing_lembrete_vespera_agendado_para = '2026-11-09T22:00:00.000Z',
                briefing_lembrete_1h_agendado_para = '2026-11-10T12:00:00.000Z'
          WHERE id = $1`,
        [clienteId]
      );

      const res = await processarLembretesBriefing({
        pool: poolDe(db),
        now: agora,
        evolutionSender: mockEvolutionMessageSender,
        clienteId,
      });

      expect(res.lembretesVespera).toBe(1);
      expect(res.lembretes1h).toBe(0);

      // Mensagem no grupo
      expect(mockEvolutionMessageSender).toHaveBeenCalledWith(
        expect.objectContaining({
          number: "120363000888@g.us",
          text: expect.stringContaining("Lembrete de Briefing (Amanhã)"),
        })
      );

      // Mensagem para o Caio
      expect(mockEvolutionMessageSender).toHaveBeenCalledWith(
        expect.objectContaining({
          number: "5534997719779",
          text: expect.stringContaining("Lembrete de Briefing GD (Amanhã)"),
        })
      );

      // Verifica se registrou envio no banco
      const { rows } = await db.query(
        "SELECT briefing_lembrete_vespera_enviado_em FROM public.gd_clientes WHERE id = $1",
        [clienteId]
      );
      expect(rows[0].briefing_lembrete_vespera_enviado_em).not.toBeNull();

      // Chamada subsequente não reenvia (idempotência)
      const res2 = await processarLembretesBriefing({
        pool: poolDe(db),
        now: agora,
        evolutionSender: mockEvolutionMessageSender,
        clienteId,
      });
      expect(res2.lembretesVespera).toBe(0);
    });

    it("dispara Lembrete 2 quando atinge 1h antes da reunião, notifica cliente e Caio e marca timestamp", async () => {
      const clienteId = await criarClienteExemplo({
        estado: "BRIEFING_AGENDADO",
        grupoClienteJid: "120363000888@g.us",
      });

      const agora = new Date("2026-11-10T12:05:00.000Z"); // 09h05 BRT (55 min antes da reunião das 10h)
      await db.query(
        `UPDATE public.gd_clientes
            SET briefing_agendado_inicio = '2026-11-10T13:00:00.000Z',
                briefing_agendado_fim = '2026-11-10T14:00:00.000Z',
                briefing_meet_url = 'https://meet.google.com/vexo-teste',
                briefing_lembrete_vespera_agendado_para = '2026-11-09T22:00:00.000Z',
                briefing_lembrete_vespera_enviado_em = '2026-11-09T22:01:00.000Z',
                briefing_lembrete_1h_agendado_para = '2026-11-10T12:00:00.000Z'
          WHERE id = $1`,
        [clienteId]
      );

      const res = await processarLembretesBriefing({
        pool: poolDe(db),
        now: agora,
        evolutionSender: mockEvolutionMessageSender,
        clienteId,
      });

      expect(res.lembretes1h).toBe(1);

      // Mensagem no grupo
      expect(mockEvolutionMessageSender).toHaveBeenCalledWith(
        expect.objectContaining({
          number: "120363000888@g.us",
          text: expect.stringContaining("Briefing em 1 hora"),
        })
      );

      // Mensagem para o Caio
      expect(mockEvolutionMessageSender).toHaveBeenCalledWith(
        expect.objectContaining({
          number: "5534997719779",
          text: expect.stringContaining("Briefing em 1 hora!"),
        })
      );

      // Verifica banco
      const { rows } = await db.query(
        "SELECT briefing_lembrete_1h_enviado_em FROM public.gd_clientes WHERE id = $1",
        [clienteId]
      );
      expect(rows[0].briefing_lembrete_1h_enviado_em).not.toBeNull();
    });

    it("POST /api/gd/briefing/processar-lembretes processa a fila sob demanda", async () => {
      const r = await chamar("POST", "/api/gd/briefing/processar-lembretes");
      expect(r.status).toBe(200);
      expect(r.json.success).toBe(true);
      expect(r.json.processados).toBeDefined();
    });

    it("inicia e para o agendador de lembretes limpamente", () => {
      expect(() => startGdBriefingReminderScheduler({ intervalMs: 60000 })).not.toThrow();
      expect(() => stopGdBriefingReminderScheduler()).not.toThrow();
    });

    it("rejeita instância legada vexo-adm-vexo-atende e prioriza geracao-digital-comercial-hostery", async () => {
      const prevEnv = process.env.GD_ONBOARDING_EVOLUTION_INSTANCE;
      process.env.GD_ONBOARDING_EVOLUTION_INSTANCE = "vexo-adm-vexo-atende";
      try {
        const clienteId = await criarClienteExemplo({
          estado: "BRIEFING_AGENDADO",
          grupoClienteJid: "120363000888@g.us",
        });

        const agora = new Date("2026-11-10T12:05:00.000Z");
        await db.query(
          `UPDATE public.gd_clientes
              SET briefing_agendado_inicio = '2026-11-10T13:00:00.000Z',
                  briefing_agendado_fim = '2026-11-10T14:00:00.000Z',
                  briefing_meet_url = 'https://meet.google.com/vexo-teste',
                  briefing_lembrete_vespera_agendado_para = '2026-11-09T22:00:00.000Z',
                  briefing_lembrete_vespera_enviado_em = '2026-11-09T22:01:00.000Z',
                  briefing_lembrete_1h_agendado_para = '2026-11-10T12:00:00.000Z'
            WHERE id = $1`,
          [clienteId]
        );

        const res = await processarLembretesBriefing({
          pool: poolDe(db),
          now: agora,
          evolutionSender: mockEvolutionMessageSender,
          instanceName: "vexo-adm-vexo-atende",
          clienteId,
        });

        expect(res.lembretes1h).toBe(1);

        // Garante que vexo-adm-vexo-atende nunca é enviado para a Evolution
        expect(mockEvolutionMessageSender).not.toHaveBeenCalledWith(
          expect.objectContaining({
            instanceName: "vexo-adm-vexo-atende",
          })
        );

        // Garante que a instância foi sanitizada para geracao-digital-comercial-hostery
        expect(mockEvolutionMessageSender).toHaveBeenCalledWith(
          expect.objectContaining({
            instanceName: "geracao-digital-comercial-hostery",
          })
        );
      } finally {
        process.env.GD_ONBOARDING_EVOLUTION_INSTANCE = prevEnv;
      }
    });
  });
});
