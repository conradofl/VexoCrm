import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { GD_DONO, registerGdClientesRoutes } from "../domains/gdClientes/routes.js";
import {
  extrairTextoDeExportacao,
  parsearLinhasChatWhatsApp,
  filtrarConversasComerciais,
  minerarComHeuristicaLocal,
  minerarConversasComGemini,
  minerarConversasWhatsApp,
} from "../services/gdWhatsAppChatMinerService.js";
import {
  montarSystemPromptAgenteVexo,
  construirEAtivarAgenteInbound,
} from "../services/gdAgentBuilderService.js";

// Carregamento de migrations reais para validação de schema
const MIGRATION_BASE = readFileSync(
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

describe("Frente 6: Briefing Comercial Vexo, Mineração WhatsApp e 4 Pilares da IA", () => {
  // ─── PARTE 1: Testes Unitários de Ingestão e Parser de WhatsApp ───────────
  describe("gdWhatsAppChatMinerService (Parser & Mineração)", () => {
    it("1. Extrai texto bruto a partir de Buffer UTF-8 ou string simples", async () => {
      const chatTexto = "[08/11/2026, 10:00:00] Cliente 1: Olá, qual o valor do plano?";
      const buffer = Buffer.from(chatTexto, "utf8");

      const resString = await extrairTextoDeExportacao(chatTexto);
      const resBuffer = await extrairTextoDeExportacao(buffer, "chat.txt");

      expect(resString).toBe(chatTexto);
      expect(resBuffer).toBe(chatTexto);
    });

    it("2. Descompacta e extrai texto a partir de arquivo ZIP contendo _chat.txt", async () => {
      const conteudoOriginal = `[08/11/2026, 14:10:00] Maria: Gostaria de saber os prazos de entrega.\n[08/11/2026, 14:11:00] Vendedor: Entregamos em 5 dias úteis com frete grátis!`;

      const zip = new JSZip();
      zip.file("_chat.txt", conteudoOriginal);
      zip.file("foto.jpg", "dados-binarios-imagem");
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

      const textoExtraido = await extrairTextoDeExportacao(zipBuffer, "conversa.zip");
      expect(textoExtraido).toContain("Gostaria de saber os prazos de entrega.");
      expect(textoExtraido).toContain("Entregamos em 5 dias úteis com frete grátis!");
    });

    it("3. Reconhece e parseia linhas em múltiplos formatos (colchetes, hífens e multilinhas)", () => {
      const chatVariado = `
[08/11/2026, 09:15:20] Carlos: Bom dia! Vocês aceitam pagamento via Pix?
08/11/2026 09:16 - Vendedora: Olá Carlos! Aceitamos Pix e cartão parcelado.
E temos desconto especial à vista!
[08/11/26 09:20:00] Carlos: Excelente, qual a garantia do serviço?
      `.trim();

      const mensagens = parsearLinhasChatWhatsApp(chatVariado);

      expect(mensagens.length).toBe(3);
      expect(mensagens[0].autor).toBe("Carlos");
      expect(mensagens[0].texto).toBe("Bom dia! Vocês aceitam pagamento via Pix?");
      expect(mensagens[1].autor).toBe("Vendedora");
      expect(mensagens[1].texto).toContain("E temos desconto especial à vista!");
      expect(mensagens[2].texto).toBe("Excelente, qual a garantia do serviço?");
    });

    it("4. Filtra mensagens de sistema do WhatsApp e mensagens apagadas", () => {
      const chatComLixo = `
[08/11/2026, 10:00:00] As mensagens e chamadas são protegidas com a criptografia de ponta a ponta.
[08/11/2026, 10:01:00] Cliente: Olá, queria um orçamento.
[08/11/2026, 10:02:00] Cliente: <Arquivo de mídia oculto>
[08/11/2026, 10:03:00] Cliente: Esta mensagem foi apagada
[08/11/2026, 10:04:00] Chamada de voz perdida
[08/11/2026, 10:05:00] Atendente: Olá! Como posso ajudar você hoje?
      `.trim();

      const mensagens = parsearLinhasChatWhatsApp(chatComLixo);
      expect(mensagens.length).toBe(2);
      expect(mensagens[0].texto).toBe("Olá, queria um orçamento.");
      expect(mensagens[1].texto).toBe("Olá! Como posso ajudar você hoje?");
    });

    it("5. Descarta diálogos puramente pessoais mantendo o foco comercial", () => {
      const mensagens = [
        { autor: "João", texto: "Bom dia amor, dormiu bem?" },
        { autor: "Maria", texto: "Bom dia vida, compra pão na padaria?" },
        { autor: "Cliente Silva", texto: "Bom dia, quanto custa a instalação de ar condicionado?" },
        { autor: "Suporte", texto: "Olá Silva, o valor padrão é R$ 350 com garantia de 1 ano." },
      ];

      const filtradas = filtrarConversasComerciais(mensagens);
      expect(filtradas.length).toBe(2);
      expect(filtradas[0].autor).toBe("Cliente Silva");
      expect(filtradas[1].autor).toBe("Suporte");
    });

    it("6. Mineração Heurística Local sem chave de API extrai FAQs, Objeções e 4 Pilares", () => {
      const mensagensComerciais = [
        { autor: "Cliente", texto: "Vocês aceitam Pix com desconto?", data: "08/11/2026", hora: "10:00" },
        { autor: "Loja", texto: "Sim! Pagamento via Pix tem 5% de desconto à vista.", data: "08/11/2026", hora: "10:01" },
        { autor: "Cliente", texto: "Achei o valor um pouco caro comparado ao concorrente.", data: "08/11/2026", hora: "10:02" },
        { autor: "Cliente", texto: "Qual o prazo de entrega para São Paulo?", data: "08/11/2026", hora: "10:05" },
        { autor: "Loja", texto: "Enviamos por Sedex em até 48 horas úteis.", data: "08/11/2026", hora: "10:06" },
      ];

      const resultado = minerarComHeuristicaLocal({
        mensagens: mensagensComerciais,
        cliente: { nome: "Ótica Bella Vista" },
      });

      expect(resultado.resumo_estatisticas.total_mensagens_analisadas).toBe(5);
      expect(resultado.duvidas_frequentes.length).toBeGreaterThan(0);
      expect(resultado.objecoes_recorrentes.length).toBeGreaterThan(0);
      expect(resultado.pilares_identificados.pilar1_o_que_vende).toBeDefined();
      expect(resultado.pilares_identificados.pilar2_precos_pagamento).toBeDefined();
      expect(resultado.pilares_identificados.pilar3_prazos_entrega).toBeDefined();
      expect(resultado.pilares_identificados.pilar4_faq.length).toBeGreaterThan(0);
    });

    it("7. Mineração com Gemini Flash via llmCaller retorna estrutura completa", async () => {
      const mockLlm = vi.fn().mockResolvedValue({
        resumo_estatisticas: {
          total_mensagens_analisadas: 15,
          clientes_detectados: 4,
          principais_temas: ["Preço", "Prazos", "Armações"],
        },
        duvidas_frequentes: [
          { pergunta: "Fazem exame de vista no local?", resposta_observada: "Sim, aos sábados pela manhã.", categoria: "Serviços" },
        ],
        objecoes_recorrentes: [
          { objecao: "Lente multifocal demora a acostumar", contexto: "Cliente receoso", como_contornar: "Oferecemos garantia de adaptação de 30 dias." },
        ],
        termos_e_girias: [
          { termo: "grau", significado: "Refração esférica/cilíndrica" },
        ],
        pilares_identificados: {
          pilar1_o_que_vende: "Óculos de grau, solares e lentes de contato de alta tecnologia.",
          pilar2_precos_pagamento: "Armações a partir de R$ 199, parcelamento em até 10x sem juros.",
          pilar3_prazos_entrega: "Óculos prontos em 1 hora para monofocais e até 5 dias para multifocais.",
          pilar4_faq: [
            { pergunta: "Fazem exame de vista?", resposta: "Sim, aos sábados com optometrista parceiro." },
          ],
        },
      });

      const res = await minerarConversasComGemini({
        textoChat: "[08/11/2026, 11:00:00] Cliente: Olá, fazem exame de vista?",
        cliente: { nome: "Ótica Bella Vista" },
        llmCaller: mockLlm,
      });

      expect(mockLlm).toHaveBeenCalled();
      expect(res.duvidas_frequentes[0].pergunta).toContain("exame de vista");
      expect(res.pilares_identificados.pilar1_o_que_vende).toContain("Óculos de grau");
    });
  });

  // ─── PARTE 2: Gerador de Prompt nos 4 Pilares da IA ─────────────────────────
  describe("gdAgentBuilderService (Prompt dos 4 Pilares & Regras de Transbordo)", () => {
    it("8. Constrói o System Prompt completo consolidando os 4 Pilares, Objeções e Transbordo", () => {
      const prompt = montarSystemPromptAgenteVexo({
        cliente: { nome: "Sonhare Colchões" },
        pilares: {
          pilar1_o_que_vende: "Colchões ortopédicos magnéticos e camas box articuladas sob medida.",
          pilar2_precos_pagamento: "Valores entre R$ 1.800 e R$ 6.500. Parcelamento em até 12x no cartão ou 10% off no Pix.",
          pilar3_prazos_entrega: "Entrega e montagem gratuita na Grande São Paulo em até 72 horas.",
          pilar4_faq: [
            { pergunta: "Qual a garantia da espuma e das molas?", resposta: "10 anos de garantia na estrutura e molas ensacadas." },
          ],
        },
        mineracao: {
          objecoes_recorrentes: [
            { objecao: "Frete para o interior é caro", como_contornar: "Temos rota quinzenal com frete subsidiado pela fábrica." },
          ],
          termos_e_girias: [
            { termo: "densidade D33", significado: "Espuma com firmeza intermediária para até 100kg" },
          ],
        },
        chips: {
          chips: [
            { numero: "5511999990001", apelido: "Chip 1 Proteção" },
            { numero: "5511999990002", apelido: "Chip 2 Proteção" },
          ],
          responsavel: "Gabriel (até 72h após contratação)",
        },
        transbordoNumero: "5511988887777",
      });

      // Validação dos 4 pilares no prompt
      expect(prompt).toContain("## 1. IDENTIDADE E PROPÓSITO");
      expect(prompt).toContain("PILAR 1: O QUE A EMPRESA VENDE (PRODUTOS & SERVIÇOS)");
      expect(prompt).toContain("Colchões ortopédicos magnéticos");
      expect(prompt).toContain("PILAR 2: FAIXA DE PREÇO E FORMAS DE PAGAMENTO");
      expect(prompt).toContain("Valores entre R$ 1.800 e R$ 6.500");
      expect(prompt).toContain("PILAR 3: PRAZOS DE ENTREGA E EXECUÇÃO");
      expect(prompt).toContain("até 72 horas");
      expect(prompt).toContain("PILAR 4: FAQ ESTRUTURADO REFINADO PELO HISTÓRICO DE WHATSAPP");
      expect(prompt).toContain("Qual a garantia da espuma");

      // Objeções e termos
      expect(prompt).toContain("Frete para o interior é caro");
      expect(prompt).toContain("densidade D33");

      // Passagem de bastão (transbordo) e guardrails
      expect(prompt).toContain("5511988887777");
      expect(prompt).toContain("JAMAIS invente valores");
      expect(prompt).toContain("JAMAIS prometa prazos fora do padrão");
    });
  });

  // ─── PARTE 3: Testes de Integração de Rotas HTTP e Banco de Dados ───────────
  describe("Endpoints HTTP de Briefing Comercial Vexo (/api/gd/clientes/:id/vexto-briefing)", () => {
    let db;
    let server;
    let base;
    let clienteId;

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
      // Criação de banco Postgres em memória via PGlite
      db = await createPgliteDb(`
        SET TimeZone = 'UTC';
        CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text NOT NULL);
        INSERT INTO public.leads_clients VALUES ('geracao-digital', 'Geração Digital');

        CREATE TABLE IF NOT EXISTS public.followup_companies (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          evolution_instance TEXT,
          evolution_instances JSONB NOT NULL DEFAULT '[]'::jsonb,
          agent_kind TEXT NOT NULL DEFAULT 'atendimento',
          inbound_role TEXT NOT NULL DEFAULT 'qualificador',
          inbound_enabled BOOLEAN NOT NULL DEFAULT false,
          inbound_model TEXT,
          inbound_prompt TEXT,
          inbound_spin_fields JSONB DEFAULT '[]'::jsonb,
          sdr_whatsapp_number TEXT,
          sdr_transfer_enabled BOOLEAN DEFAULT false,
          instructions_consolidated_at TIMESTAMPTZ,
          archived_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      // Aplica as migrações sequenciais
      await db.exec(MIGRATION_BASE);
      await db.exec(MIGRATION_CAMPOS);
      await db.exec(MIGRATION_TRILHA);
      await db.exec(MIGRATION_DOCUMENTOS);
      await db.exec(MIGRATION_WHATSAPP);
      await db.exec(MIGRATION_CALENDAR);
      await db.exec(MIGRATION_BRIEFING);
      await db.exec(MIGRATION_FRENTE5);
      await db.exec(MIGRATION_FRENTE6);
      await db.exec(MIGRATION_CS_PORTAL);

      // Insere cliente de teste
      const resIns = await db.query(
        `INSERT INTO public.gd_clientes (dono_client_id, nome, origem)
         VALUES ('geracao-digital', 'Clínica Sorriso Prime', 'fluxo')
         RETURNING id`
      );
      clienteId = resIns.rows[0].id;

      // Inicializa servidor express
      const app = express();
      app.use(express.json({ limit: "50mb" }));

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

      registerGdClientesRoutes(app, {
        getPool: () => poolDe(db),
        requireFirebaseAuth,
      });

      await new Promise((resolveServer) => {
        server = http.createServer(app);
        server.listen(0, "127.0.0.1", () => {
          const port = server.address().port;
          base = `http://127.0.0.1:${port}`;
          resolveServer();
        });
      });
    });

    afterAll(async () => {
      if (server) await new Promise((r) => server.close(r));
      if (db) await db.close();
    });

    it("9. GET /api/gd/clientes/:id/vexto-briefing retorna estado inicial pendente", async () => {
      const res = await chamar("GET", `/api/gd/clientes/${clienteId}/vexto-briefing`);
      expect(res.status).toBe(200);
      expect(res.json.success).toBe(true);
      expect(res.json.cliente_id).toBe(clienteId);
      expect(res.json.status).toBe("PENDENTE");
      expect(res.json.chips_virtuais.responsavel).toContain("Gabriel");
      expect(res.json.chips_virtuais.recomendacao).toContain("2 a 3 chips");
    });

    it("10. POST /api/gd/clientes/:id/vexto-briefing/upload-chat processa histórico e salva mineração", async () => {
      const historicoTexto = `
[08/11/2026, 14:00:00] Paciente: Olá, vocês fazem implante dentário com sedação?
[08/11/2026, 14:01:00] Doutora: Sim, temos sedação consciente e avaliação gratuita!
[08/11/2026, 14:02:00] Paciente: Qual o valor médio do implante completo?
[08/11/2026, 14:03:00] Doutora: O investimento varia conforme a tomografia, a partir de R$ 1.500 no Pix.
      `.trim();

      const res = await chamar("POST", `/api/gd/clientes/${clienteId}/vexto-briefing/upload-chat`, {
        body: {
          chat_text: historicoTexto,
          fileName: "conversa_clinica.txt",
        },
      });

      expect(res.status).toBe(200);
      expect(res.json.success).toBe(true);
      expect(res.json.status).toBe("MINERADO");
      expect(res.json.mineracao).toBeDefined();
      expect(res.json.mineracao.duvidas_frequentes.length).toBeGreaterThan(0);

      // Validação no banco de dados
      const { rows } = await db.query(
        `SELECT vexto_briefing_status, vexto_briefing_mineracao FROM public.gd_clientes WHERE id = $1`,
        [clienteId]
      );
      expect(rows[0].vexto_briefing_status).toBe("MINERADO");
      expect(rows[0].vexto_briefing_mineracao.duvidas_frequentes).toBeDefined();
    });

    it("11. POST /api/gd/clientes/:id/vexto-briefing/salvar-pilares consolida os 4 pilares, ativa o agente e grava em followup_companies", async () => {
      const pilaresPayload = {
        pilares: {
          pilar1_o_que_vende: "Implantes dentários, alinhadores invisíveis e estética orofacial de alta precisão.",
          pilar2_precos_pagamento: "Planos a partir de R$ 1.500, parcelamento em até 24x no boleto bancário ou cartão.",
          pilar3_prazos_entrega: "Planejamento em 48 horas e início imediato do tratamento.",
          pilar4_faq: [
            { pergunta: "O procedimento dói?", resposta: "Não, utilizamos sedação consciente e anestesia digital indolor." },
          ],
          objecoes: [
            { objecao: "Medo de dor durante o procedimento", como_contornar: "Explicar nossa tecnologia de anestesia computadorizada sem agulha." },
          ],
        },
        chips: {
          chips: [
            { numero: "5511990001111", operadora: "Zenvia", apelido: "Chip 1 Atendimento" },
            { numero: "5511990002222", operadora: "Zenvia", apelido: "Chip 2 Atendimento" },
          ],
          responsavel: "Gabriel (até 72h após contratação)",
          status: "COMPRADOS_ATIVOS",
        },
        transbordo_numero: "5511999998888",
        instance_name: "instancia-sorriso-prime",
        instances: ["instancia-sorriso-prime"],
        ativar_agente: true,
      };

      const res = await chamar("POST", `/api/gd/clientes/${clienteId}/vexto-briefing/salvar-pilares`, {
        body: pilaresPayload,
      });

      expect(res.status).toBe(200);
      expect(res.json.success).toBe(true);
      expect(res.json.status).toBe("AGENTE_ATIVADO");
      expect(res.json.agente_id).toBeDefined();
      expect(res.json.prompt_gerado).toContain("PILAR 1: O QUE A EMPRESA VENDE");
      expect(res.json.prompt_gerado).toContain("5511999998888");

      // Validação em followup_companies
      const { rows: rowsAgent } = await db.query(
        `SELECT id, name, inbound_enabled, inbound_prompt, sdr_whatsapp_number, sdr_transfer_enabled, instructions_consolidated_at
         FROM public.followup_companies
         WHERE id = $1`,
        [res.json.agente_id]
      );
      expect(rowsAgent.length).toBe(1);
      expect(rowsAgent[0].inbound_enabled).toBe(true);
      expect(rowsAgent[0].sdr_whatsapp_number).toBe("5511999998888");
      expect(rowsAgent[0].sdr_transfer_enabled).toBe(true);
      expect(rowsAgent[0].instructions_consolidated_at).not.toBeNull();
      expect(rowsAgent[0].inbound_prompt).toContain("Implantes dentários, alinhadores invisíveis");
    });

    it("12. GET /api/gd/clientes/:id/vexto-briefing e alias /vexo-briefing retornam visão técnica consolidada", async () => {
      const resVexto = await chamar("GET", `/api/gd/clientes/${clienteId}/vexto-briefing`);
      const resVexo = await chamar("GET", `/api/gd/clientes/${clienteId}/vexo-briefing`);

      expect(resVexto.status).toBe(200);
      expect(resVexo.status).toBe(200);

      expect(resVexto.json.status).toBe("AGENTE_ATIVADO");
      expect(resVexto.json.chips_virtuais.chips.length).toBe(2);
      expect(resVexto.json.transbordo_numero).toBe("5511999998888");
      expect(resVexto.json.prompt_gerado).toContain("PILAR 1: O QUE A EMPRESA VENDE");

      // Equivalência de alias
      expect(resVexto.json.status).toBe(resVexo.json.status);
      expect(resVexto.json.prompt_gerado).toBe(resVexo.json.prompt_gerado);
    });
  });
});
