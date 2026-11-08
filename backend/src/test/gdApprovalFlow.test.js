import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { GD_DONO, registerGdClientesRoutes } from "../domains/gdClientes/routes.js";
import {
  interpretarComandoAprovacao,
  enviarDocumentosParaAprovacaoInterna,
  enviarDocumentosParaAprovacaoCliente,
  processarMensagemAprovacaoWhatsApp,
  GD_CAIO_TAG,
} from "../services/gdApprovalFlowService.js";

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

  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    const p = req.headers["x-teste-perfil"];
    if (p && PERFIS[p]) {
      req.authAccess = PERFIS[p];
    }
    next();
  });

  const requireFirebaseAuth = (req, _res, next) => {
    if (req.authAccess) return next();
    return _res.status(401).json({ error: "UNAUTHENTICATED" });
  };

  mockEvolutionMessageSender = vi.fn().mockResolvedValue({ success: true });

  registerGdClientesRoutes(app, {
    getPool: () => poolDe(db),
    requireFirebaseAuth,
    evolutionMessageSender: mockEvolutionMessageSender,
  });

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db?.close();
});

describe("Fluxo de Validação e Aprovação no WhatsApp (gdApprovalFlowService)", () => {
  describe("1. Interpretador de Comandos", () => {
    it("reconhece variações de aprovação", () => {
      expect(interpretarComandoAprovacao("Aprovado").tipo).toBe("APROVADO");
      expect(interpretarComandoAprovacao("aprovada").tipo).toBe("APROVADO");
      expect(interpretarComandoAprovacao("ok, aprovado").tipo).toBe("APROVADO");
      expect(interpretarComandoAprovacao("De acordo").tipo).toBe("APROVADO");
      expect(interpretarComandoAprovacao("Pode seguir").tipo).toBe("APROVADO");
      expect(interpretarComandoAprovacao("👍").tipo).toBe("APROVADO");
      expect(interpretarComandoAprovacao("1").tipo).toBe("APROVADO");
    });

    it("reconhece comandos de ressalva com e sem texto", () => {
      const comTexto = interpretarComandoAprovacao("Com ressalvas: ajustar tipografia dos carrosséis");
      expect(comTexto.tipo).toBe("COM_RESSALVAS");
      expect(comTexto.detalhes).toBe("ajustar tipografia dos carrosséis");

      const semTexto = interpretarComandoAprovacao("Com ressalvas");
      expect(semTexto.tipo).toBe("COM_RESSALVAS");
      expect(semTexto.detalhes).toBeDefined();
    });

    it("reconhece comandos de ressalva concluída", () => {
      expect(interpretarComandoAprovacao("Ressalva concluída").tipo).toBe("RESSALVA_CONCLUIDA");
      expect(interpretarComandoAprovacao("ressalvas concluidas").tipo).toBe("RESSALVA_CONCLUIDA");
      expect(interpretarComandoAprovacao("Ajustes concluídos").tipo).toBe("RESSALVA_CONCLUIDA");
      expect(interpretarComandoAprovacao("ajustes feitos").tipo).toBe("RESSALVA_CONCLUIDA");
    });

    it("ignora mensagens comuns", () => {
      expect(interpretarComandoAprovacao("Bom dia pessoal").tipo).toBe("DESCONHECIDO");
      expect(interpretarComandoAprovacao("").tipo).toBe("DESCONHECIDO");
      expect(interpretarComandoAprovacao(null).tipo).toBe("DESCONHECIDO");
    });
  });

  describe("2. Envio de Documentos para Aprovação Interna (Grupo PASTA: {CLIENTE})", () => {
    it("dispara mensagem no grupo interno marcando o Caio e atualiza status para PENDENTE", async () => {
      const { rows } = await db.query(
        `INSERT INTO public.gd_clientes (dono_client_id, nome, grupo_interno_jid, drive_url, origem, briefing_documentos)
         VALUES ('geracao-digital', 'Vanguard ' || gen_random_uuid(), '120363011111111111@g.us', 'https://drive.google.com/drive/folders/vanguard', 'fluxo', $1::jsonb)
         RETURNING id, nome, grupo_interno_jid`,
        [
          JSON.stringify({
            documentos: {
              briefing: { pdf: { fileLink: "https://drive.google.com/briefing.pdf" }, docx: { fileLink: "https://drive.google.com/briefing.docx" } },
              identidade: { pdf: { fileLink: "https://drive.google.com/identidade.pdf" }, docx: { fileLink: "https://drive.google.com/identidade.docx" } },
              roteiros: { pdf: { fileLink: "https://drive.google.com/roteiros.pdf" }, docx: { fileLink: "https://drive.google.com/roteiros.docx" } },
              planejamento: { pdf: { fileLink: "https://drive.google.com/plano.pdf" }, docx: { fileLink: "https://drive.google.com/plano.docx" } },
            },
          }),
        ]
      );
      const clienteId = rows[0].id;
      await db.query(
        `SELECT public.gd_registrar_evento($1, 'BRIEFING_REALIZADO', now(), false, 'fluxo', 'sistema', 'teste', 'inicial')`,
        [clienteId]
      );

      const mensagensEnviadas = [];
      const mockSender = vi.fn().mockImplementation(async ({ number, text }) => {
        mensagensEnviadas.push({ number, text });
        return { success: true };
      });

      const res = await enviarDocumentosParaAprovacaoInterna({
        clienteId,
        pool: poolDe(db),
        evolutionSender: mockSender,
      });

      expect(res.success).toBe(true);
      expect(mockSender).toHaveBeenCalledTimes(1);
      expect(mensagensEnviadas[0].number).toBe("120363011111111111@g.us");
      expect(mensagensEnviadas[0].text).toContain(GD_CAIO_TAG);
      expect(mensagensEnviadas[0].text).toContain("https://drive.google.com/briefing.pdf");
      expect(mensagensEnviadas[0].text).toContain("https://drive.google.com/roteiros.pdf");

      // Verifica status do banco
      const { rows: clienteAtualizado } = await db.query(
        `SELECT briefing_aprovacao_interna_status, estado_atual FROM public.gd_clientes WHERE id = $1`,
        [clienteId]
      );
      expect(clienteAtualizado[0].briefing_aprovacao_interna_status).toBe("PENDENTE");
      expect(clienteAtualizado[0].estado_atual).toBe("BRIEFING_APROVACAO_INTERNA");
    });
  });

  describe("3. Fluxo de Validação do Caio no Grupo Interno (Ressalvas e Aprovação)", () => {
    it("registra ressalvas do Caio e responde no grupo solicitando confirmação de ajuste", async () => {
      const jidInterno = `120363022222222222_${Date.now()}@g.us`;
      const { rows } = await db.query(
        `INSERT INTO public.gd_clientes (dono_client_id, nome, grupo_interno_jid, origem, briefing_aprovacao_interna_status)
         VALUES ('geracao-digital', 'Nexus Corp ' || gen_random_uuid(), $1, 'fluxo', 'PENDENTE')
         RETURNING id`,
        [jidInterno]
      );
      const clienteId = rows[0].id;
      await db.query(
        `SELECT public.gd_registrar_evento($1, 'BRIEFING_APROVACAO_INTERNA', now(), false, 'fluxo', 'sistema', 'teste', 'inicial')`,
        [clienteId]
      );

      const mensagens = [];
      const mockSender = vi.fn().mockImplementation(async (params) => {
        mensagens.push(params);
        return { success: true };
      });

      const resWebhook = await processarMensagemAprovacaoWhatsApp({
        pool: poolDe(db),
        groupJid: jidInterno,
        text: "Com ressalvas: Ajustar paleta de cores para substituir o tom de amarelo por dourado.",
        evolutionSender: mockSender,
      });

      expect(resWebhook.handled).toBe(true);
      expect(resWebhook.acao).toBe("COM_RESSALVAS_INTERNO");
      expect(resWebhook.detalhes).toContain("substituir o tom de amarelo");

      // Verifica no banco
      const { rows: atualizado } = await db.query(
        `SELECT briefing_aprovacao_interna_status, briefing_aprovacao_interna_ressalvas FROM public.gd_clientes WHERE id = $1`,
        [clienteId]
      );
      expect(atualizado[0].briefing_aprovacao_interna_status).toBe("COM_RESSALVAS");
      expect(atualizado[0].briefing_aprovacao_interna_ressalvas).toContain("dourado");
      expect(mensagens[0].text).toContain("Ressalvas Registradas com Sucesso");
    });

    it("quando Caio responde 'Ressalva concluída', valida internamente e dispara no grupo do cliente", async () => {
      const jidInterno = `120363033333333333_${Date.now()}@g.us`;
      const jidCliente = `120363044444444444_${Date.now()}@g.us`;

      const { rows } = await db.query(
        `INSERT INTO public.gd_clientes (
           dono_client_id, nome, aprovador_nome, grupo_interno_jid, grupo_cliente_jid,
           origem, briefing_aprovacao_interna_status, briefing_documentos
         ) VALUES (
           'geracao-digital', 'Delta Solar ' || gen_random_uuid(), 'Marcos Solar', $1, $2,
           'fluxo', 'COM_RESSALVAS', $3::jsonb
         ) RETURNING id`,
        [
          jidInterno,
          jidCliente,
          JSON.stringify({
            documentos: {
              briefing: { pdf: { fileLink: "https://drive.google.com/briefing_delta.pdf" } },
              planejamento: { pdf: { fileLink: "https://drive.google.com/plano_delta.pdf" } },
            },
          }),
        ]
      );
      const clienteId = rows[0].id;
      await db.query(
        `SELECT public.gd_registrar_evento($1, 'BRIEFING_APROVACAO_INTERNA', now(), false, 'fluxo', 'sistema', 'teste', 'inicial')`,
        [clienteId]
      );

      const mensagens = [];
      const mockSender = vi.fn().mockImplementation(async (params) => {
        mensagens.push(params);
        return { success: true };
      });

      const resWebhook = await processarMensagemAprovacaoWhatsApp({
        pool: poolDe(db),
        groupJid: jidInterno,
        text: "Ressalva concluída",
        evolutionSender: mockSender,
      });

      expect(resWebhook.handled).toBe(true);
      expect(resWebhook.acao).toBe("RESSALVA_CONCLUIDA_INTERNO");

      // Deve ter enviado: 1 aviso no grupo interno e 1 mensagem oficial no grupo do cliente
      expect(mensagens.length).toBeGreaterThanOrEqual(2);
      expect(mensagens.some((m) => m.number === jidInterno && m.text.includes("Ressalvas Concluídas"))).toBe(true);
      expect(mensagens.some((m) => m.number === jidCliente && m.text.includes("SEU BRIEFING CONSOLIDADO"))).toBe(true);

      // Estado atualizado para BRIEFING_APROVACAO_CLIENTE
      const { rows: clienteAtualizado } = await db.query(
        `SELECT briefing_aprovacao_interna_status, briefing_aprovacao_cliente_status, estado_atual FROM public.gd_clientes WHERE id = $1`,
        [clienteId]
      );
      expect(clienteAtualizado[0].briefing_aprovacao_interna_status).toBe("APROVADO");
      expect(clienteAtualizado[0].briefing_aprovacao_cliente_status).toBe("PENDENTE");
      expect(clienteAtualizado[0].estado_atual).toBe("BRIEFING_APROVACAO_CLIENTE");
    });
  });

  describe("4. Aceite do Cliente no Grupo MÁQUINA DE VENDAS e Transição para ESTRATEGIA_APROVADA", () => {
    it("quando o cliente responde 'Aprovado' no seu grupo, transiciona para ESTRATEGIA_APROVADA e avisa ambos os grupos", async () => {
      const jidInterno = `120363055555555555_${Date.now()}@g.us`;
      const jidCliente = `120363066666666666_${Date.now()}@g.us`;

      const { rows } = await db.query(
        `INSERT INTO public.gd_clientes (
           dono_client_id, nome, aprovador_nome, grupo_interno_jid, grupo_cliente_jid,
           origem, briefing_aprovacao_cliente_status
         ) VALUES (
           'geracao-digital', 'Omega Advocacia ' || gen_random_uuid(), 'Dr. Roberto', $1, $2,
           'fluxo', 'PENDENTE'
         ) RETURNING id`,
        [jidInterno, jidCliente]
      );
      const clienteId = rows[0].id;
      await db.query(
        `SELECT public.gd_registrar_evento($1, 'BRIEFING_APROVACAO_CLIENTE', now(), false, 'fluxo', 'sistema', 'teste', 'inicial')`,
        [clienteId]
      );

      const mensagens = [];
      const mockSender = vi.fn().mockImplementation(async (params) => {
        mensagens.push(params);
        return { success: true };
      });

      const resWebhook = await processarMensagemAprovacaoWhatsApp({
        pool: poolDe(db),
        groupJid: jidCliente,
        text: "Aprovado! Parabéns à equipe pelo excelente planejamento.",
        evolutionSender: mockSender,
      });

      expect(resWebhook.handled).toBe(true);
      expect(resWebhook.acao).toBe("APROVADO_CLIENTE");

      // Verificações das mensagens enviadas:
      // 1. Mensagem de comemoração no grupo do cliente
      expect(mensagens.some((m) => m.number === jidCliente && m.text.includes("Estratégia e Briefing Aprovados"))).toBe(true);
      // 2. Alerta no grupo interno
      expect(mensagens.some((m) => m.number === jidInterno && m.text.includes("CLIENTE APROVOU A ESTRATÉGIA"))).toBe(true);

      // Verificações no banco
      const { rows: clienteAtualizado } = await db.query(
        `SELECT briefing_aprovacao_cliente_status, estado_atual FROM public.gd_clientes WHERE id = $1`,
        [clienteId]
      );
      expect(clienteAtualizado[0].briefing_aprovacao_cliente_status).toBe("APROVADO");
      expect(clienteAtualizado[0].estado_atual).toBe("ESTRATEGIA_APROVADA");

      // Evento no histórico
      const { rows: eventos } = await db.query(
        `SELECT estado_para, motivo FROM public.gd_cliente_eventos WHERE cliente_id = $1 ORDER BY seq DESC LIMIT 1`,
        [clienteId]
      );
      expect(eventos[0].estado_para).toBe("ESTRATEGIA_APROVADA");
      expect(eventos[0].motivo).toContain("WhatsApp");
    });
  });

  describe("5. Endpoints HTTP da API de Aprovação", () => {
    it("POST /api/gd/clientes/:id/briefing/enviar-aprovacao-interna", async () => {
      const { rows } = await db.query(
        `INSERT INTO public.gd_clientes (dono_client_id, nome, grupo_interno_jid, origem)
         VALUES ('geracao-digital', 'Beta 1 ' || gen_random_uuid(), '120363077777777777@g.us', 'fluxo')
         RETURNING id`
      );
      const clienteId = rows[0].id;
      await db.query(
        `SELECT public.gd_registrar_evento($1, 'BRIEFING_REALIZADO', now(), false, 'fluxo', 'sistema', 'teste', 'inicial')`,
        [clienteId]
      );

      const res = await chamar("POST", `/api/gd/clientes/${clienteId}/briefing/enviar-aprovacao-interna`);
      expect(res.status).toBe(200);
      expect(res.json.success).toBe(true);
      expect(res.json.grupo_interno_jid).toBe("120363077777777777@g.us");
    });

    it("POST /api/gd/clientes/:id/briefing/enviar-aprovacao-cliente", async () => {
      const { rows } = await db.query(
        `INSERT INTO public.gd_clientes (dono_client_id, nome, grupo_cliente_jid, origem)
         VALUES ('geracao-digital', 'Beta 2 ' || gen_random_uuid(), '120363088888888888@g.us', 'fluxo')
         RETURNING id`
      );
      const clienteId = rows[0].id;
      await db.query(
        `SELECT public.gd_registrar_evento($1, 'BRIEFING_APROVACAO_INTERNA', now(), false, 'fluxo', 'sistema', 'teste', 'inicial')`,
        [clienteId]
      );

      const res = await chamar("POST", `/api/gd/clientes/${clienteId}/briefing/enviar-aprovacao-cliente`);
      expect(res.status).toBe(200);
      expect(res.json.success).toBe(true);
      expect(res.json.grupo_cliente_jid).toBe("120363088888888888@g.us");
    });

    it("POST /api/gd/briefing/webhook-aprovacao", async () => {
      const jidInterno = `120363099999999999_${Date.now()}@g.us`;
      const { rows } = await db.query(
        `INSERT INTO public.gd_clientes (dono_client_id, nome, grupo_interno_jid, grupo_cliente_jid, origem)
         VALUES ('geracao-digital', 'Beta 3 ' || gen_random_uuid(), $1, '120363000000000000@g.us', 'fluxo')
         RETURNING id`,
        [jidInterno]
      );
      const clienteId = rows[0].id;
      await db.query(
        `SELECT public.gd_registrar_evento($1, 'BRIEFING_APROVACAO_INTERNA', now(), false, 'fluxo', 'sistema', 'teste', 'inicial')`,
        [clienteId]
      );

      const res = await chamar("POST", `/api/gd/briefing/webhook-aprovacao`, {
        body: {
          group_jid: jidInterno,
          text: "Aprovado",
        },
      });

      expect(res.status).toBe(200);
      expect(res.json.success).toBe(true);
      expect(res.json.handled).toBe(true);
      expect(res.json.acao).toBe("APROVADO_INTERNO");
    });
  });
});
