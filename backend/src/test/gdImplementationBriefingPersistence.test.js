import { describe, expect, it, vi, beforeEach } from "vitest";
import { registerGeracaoDigitalRoutes } from "../domains/geracaoDigitalRoutes.js";

function fakeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(s) {
      res.statusCode = s;
      return res;
    },
    json(b) {
      res.body = b;
      return res;
    },
  };
  return res;
}

function adminAuthAccess() {
  return {
    role: "internal",
    isAdmin: true,
    clientId: "geracao-digital",
    clientIds: ["geracao-digital"],
  };
}

describe("Item 03 — Persistência do Briefing de Implantação e os 5 Pilares do Agente", () => {
  let handlers = {};
  let mockPool;
  let storedBriefings = new Map();

  beforeEach(() => {
    vi.clearAllMocks();
    storedBriefings.clear();
    handlers = {};

    mockPool = {
      query: vi.fn(async (sql, params = []) => {
        // DDL migrations and table creations
        if (sql.includes("CREATE TABLE") || sql.includes("ALTER TABLE")) {
          return { rows: [] };
        }

        // INSERT into gd_implementation_briefings
        if (sql.includes("INSERT INTO public.gd_implementation_briefings")) {
          const [
            tenant_id, client_name, model_type, suggested_model, num_employees,
            has_commercial_sector, prerequisites, operacao, inteligencia, agente_ia,
            canais, modulos_custom, fechamento, team_users, knowledge_files, cinco_pilares, status, owner_company
          ] = params;

          const newId = `briefing-${Date.now()}`;
          const record = {
            id: newId,
            tenant_id,
            client_name,
            model_type,
            suggested_model,
            num_employees,
            has_commercial_sector,
            prerequisites: JSON.parse(prerequisites || "{}"),
            operacao: JSON.parse(operacao || "{}"),
            inteligencia: JSON.parse(inteligencia || "{}"),
            agente_ia: JSON.parse(agente_ia || "{}"),
            canais: JSON.parse(canais || "{}"),
            modulos_custom: JSON.parse(modulos_custom || "{}"),
            fechamento: JSON.parse(fechamento || "{}"),
            team_users: JSON.parse(team_users || "[]"),
            knowledge_files: JSON.parse(knowledge_files || "[]"),
            cinco_pilares: JSON.parse(cinco_pilares || "{}"),
            status,
            owner_company,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          storedBriefings.set(newId, record);
          return { rows: [record] };
        }

        // SELECT owner_company for guard
        if (sql.includes("SELECT owner_company FROM public.gd_implementation_briefings")) {
          const id = params[0];
          const item = storedBriefings.get(id);
          if (!item) return { rows: [] };
          return { rows: [{ owner_company: item.owner_company || "geracao-digital" }] };
        }

        // SELECT * for GET by ID or update check
        if (sql.includes("SELECT * FROM public.gd_implementation_briefings WHERE id = $1")) {
          const id = params[0];
          const item = storedBriefings.get(id);
          if (!item) return { rows: [] };
          return { rows: [item] };
        }

        // UPDATE gd_implementation_briefings
        if (sql.includes("UPDATE public.gd_implementation_briefings SET")) {
          const [
            client_name, model_type, suggested_model,
            num_employees, has_commercial_sector,
            prerequisites, operacao, inteligencia, agente_ia,
            canais, modulos_custom, fechamento,
            team_users, knowledge_files, cinco_pilares,
            newStatus, id
          ] = params;

          const existing = storedBriefings.get(id);
          if (!existing) return { rows: [] };

          const updated = {
            ...existing,
            client_name: client_name !== null && client_name !== undefined ? client_name : existing.client_name,
            model_type: model_type !== null && model_type !== undefined ? model_type : existing.model_type,
            suggested_model: suggested_model !== null && suggested_model !== undefined ? suggested_model : existing.suggested_model,
            num_employees: num_employees !== null && num_employees !== undefined ? num_employees : existing.num_employees,
            has_commercial_sector: has_commercial_sector !== null && has_commercial_sector !== undefined ? has_commercial_sector : existing.has_commercial_sector,
            prerequisites: prerequisites ? JSON.parse(prerequisites) : existing.prerequisites,
            operacao: operacao ? JSON.parse(operacao) : existing.operacao,
            inteligencia: inteligencia ? JSON.parse(inteligencia) : existing.inteligencia,
            agente_ia: agente_ia ? JSON.parse(agente_ia) : existing.agente_ia,
            canais: canais ? JSON.parse(canais) : existing.canais,
            modulos_custom: modulos_custom ? JSON.parse(modulos_custom) : existing.modulos_custom,
            fechamento: fechamento ? JSON.parse(fechamento) : existing.fechamento,
            team_users: team_users !== null && team_users !== undefined ? JSON.parse(team_users) : existing.team_users,
            knowledge_files: knowledge_files !== null && knowledge_files !== undefined ? JSON.parse(knowledge_files) : existing.knowledge_files,
            cinco_pilares: cinco_pilares !== null && cinco_pilares !== undefined ? JSON.parse(cinco_pilares) : existing.cinco_pilares,
            status: newStatus || existing.status,
            updated_at: new Date().toISOString(),
          };
          storedBriefings.set(id, updated);
          return { rows: [updated] };
        }

        return { rows: [] };
      }),
    };

    const fakeApp = {
      get: (path, ...args) => { handlers[`GET ${path}`] = args; },
      post: (path, ...args) => { handlers[`POST ${path}`] = args; },
      put: (path, ...args) => { handlers[`PUT ${path}`] = args; },
      delete: (path, ...args) => { handlers[`DELETE ${path}`] = args; },
      use: vi.fn(),
    };

    const passMiddleware = (req, res, next) => next();
    registerGeracaoDigitalRoutes(fakeApp, mockPool, passMiddleware, () => passMiddleware);
  });

  it("[TESTE OBRIGATÓRIO] O endpoint POST /api/gd/implementation-briefings persiste team_users e knowledge_files no banco de dados e retorna esses campos na resposta", async () => {
    const postRoute = handlers["POST /api/gd/implementation-briefings"];
    expect(postRoute).toBeDefined();
    const handler = postRoute[postRoute.length - 1];

    const teamUsersPayload = [
      { id: "usr-1", name: "Roberta Vendas", email: "roberta@cliente.com", role: "sdr" },
      { id: "usr-2", name: "Carlos Gestor", email: "carlos@cliente.com", role: "admin" },
    ];
    const knowledgeFilesPayload = [
      { id: "file-1", name: "Tabela_Precos_2026.pdf", size: 1048576, type: "application/pdf" },
      { id: "file-2", name: "Manual_Atendimento.docx", size: 524288, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    ];
    const cincoPilaresPayload = {
      pilar1_produtos_servicos: "Software CRM para Clínicas",
      pilar2_preco_condicoes: "Mensalidade R$ 1.500 em até 12x",
      pilar3_funcionamento_prazos: "Go-live em 7 dias úteis",
      pilar4_duvidas_frequentes: "Funciona integrado com WhatsApp? Sim.",
      pilar5_nao_prometer: "Desconto sem aprovação da diretoria",
    };

    const req = {
      authAccess: adminAuthAccess(),
      body: {
        client_name: "Clínica Sorriso Dental",
        tenant_id: "clinica-sorriso",
        model_type: "avancado",
        team_users: teamUsersPayload,
        knowledge_files: knowledgeFilesPayload,
        cinco_pilares: cincoPilaresPayload,
        status: "em_andamento",
      },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();

    // Valida que o INSERT recebeu e salvou os campos JSON
    expect(res.body.data.team_users).toEqual(teamUsersPayload);
    expect(res.body.data.knowledge_files).toEqual(knowledgeFilesPayload);
    expect(res.body.data.cinco_pilares).toEqual(cincoPilaresPayload);

    // Valida que a query foi executada com JSONB serializado
    const insertCall = mockPool.query.mock.calls.find(c => c[0].includes("INSERT INTO public.gd_implementation_briefings"));
    expect(insertCall).toBeDefined();
    const params = insertCall[1];
    expect(params[13]).toBe(JSON.stringify(teamUsersPayload)); // team_users
    expect(params[14]).toBe(JSON.stringify(knowledgeFilesPayload)); // knowledge_files
    expect(params[15]).toBe(JSON.stringify(cincoPilaresPayload)); // cinco_pilares
  });

  it("[TESTE OBRIGATÓRIO] O endpoint PUT /api/gd/implementation-briefings/:id atualiza team_users, knowledge_files e cinco_pilares preservando a integridade dos dados", async () => {
    // 1. Cria briefing inicial no banco mock
    const initialId = "briefing-teste-123";
    storedBriefings.set(initialId, {
      id: initialId,
      tenant_id: "empresa-alvo",
      client_name: "Empresa Alvo Ltda",
      model_type: "essencial",
      team_users: [{ id: "usr-old", name: "Antigo", email: "antigo@empresa.com", role: "atendente" }],
      knowledge_files: [{ id: "file-old", name: "antigo.pdf", size: 100 }],
      cinco_pilares: { pilar1_produtos_servicos: "Versão 1" },
      status: "em_andamento",
      owner_company: "geracao-digital",
    });

    const putRoute = handlers["PUT /api/gd/implementation-briefings/:id"];
    expect(putRoute).toBeDefined();
    const handler = putRoute[putRoute.length - 1];

    const updatedTeam = [
      { id: "usr-new-1", name: "Novo Atendente 1", email: "atendente1@empresa.com", role: "sdr" },
      { id: "usr-new-2", name: "Novo Atendente 2", email: "atendente2@empresa.com", role: "admin" },
    ];
    const updatedFiles = [
      { id: "file-new-1", name: "Cardapio_Atualizado.pdf", size: 204800, type: "application/pdf" },
    ];
    const updatedCincoPilares = {
      pilar1_produtos_servicos: "Cardápio Executivo e Delivery",
      pilar2_preco_condicoes: "Pratos de R$ 40 a R$ 90, Pix e Cartão",
      pilar3_funcionamento_prazos: "Aberto das 11h às 23h, entrega em até 40 min",
      pilar4_duvidas_frequentes: "Entrega em condomínio? Sim, na portaria.",
      pilar5_nao_prometer: "Entrega grátis fora do raio de 5km",
    };

    const req = {
      params: { id: initialId },
      authAccess: adminAuthAccess(),
      body: {
        client_name: "Empresa Alvo Atualizada",
        team_users: updatedTeam,
        knowledge_files: updatedFiles,
        cinco_pilares: updatedCincoPilares,
        status: "concluido",
      },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Valida integridade e atualização dos dados retornados
    expect(res.body.data.team_users).toEqual(updatedTeam);
    expect(res.body.data.knowledge_files).toEqual(updatedFiles);
    expect(res.body.data.cinco_pilares).toEqual(updatedCincoPilares);
    expect(res.body.data.status).toBe("concluido");

    // Valida no banco persistido
    const stored = storedBriefings.get(initialId);
    expect(stored.team_users).toEqual(updatedTeam);
    expect(stored.knowledge_files).toEqual(updatedFiles);
    expect(stored.cinco_pilares).toEqual(updatedCincoPilares);
  });

  it("[TESTE OBRIGATÓRIO] Consulta GET /api/gd/implementation-briefings/:id devolve team_users e knowledge_files como arrays estruturados, sem perder usuários ou anexos", async () => {
    const briefingId = "briefing-consulta-456";
    const team = [
      { id: "u-1", name: "Mariana Souza", email: "mariana@consultorio.com", role: "sdr" },
      { id: "u-2", name: "Felipe Andrade", email: "felipe@consultorio.com", role: "atendente" },
    ];
    const files = [
      { id: "f-1", name: "Politica_Agendamento.pdf", size: 300000, type: "application/pdf" },
      { id: "f-2", name: "Tabela_Convenios.xlsx", size: 150000, type: "application/vnd.ms-excel" },
    ];
    const pilares = {
      pilar1_produtos_servicos: "Consultas de Especialidades",
      pilar2_preco_condicoes: "R$ 350 a consulta",
      pilar3_funcionamento_prazos: "Agendamento com antecedência de 24h",
      pilar4_duvidas_frequentes: "Emite nota para reembolso? Sim.",
      pilar5_nao_prometer: "Não prometer encaixe sem consultar a recepção",
    };

    storedBriefings.set(briefingId, {
      id: briefingId,
      tenant_id: "consultorio-dr-felipe",
      client_name: "Consultório Dr. Felipe",
      team_users: team,
      knowledge_files: files,
      cinco_pilares: pilares,
      owner_company: "geracao-digital",
    });

    const getRoute = handlers["GET /api/gd/implementation-briefings/:id"];
    expect(getRoute).toBeDefined();
    const handler = getRoute[getRoute.length - 1];

    const req = {
      params: { id: briefingId },
      authAccess: adminAuthAccess(),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(Array.isArray(data.team_users)).toBe(true);
    expect(data.team_users).toHaveLength(2);
    expect(data.team_users[0].name).toBe("Mariana Souza");
    expect(data.team_users[1].email).toBe("felipe@consultorio.com");

    expect(Array.isArray(data.knowledge_files)).toBe(true);
    expect(data.knowledge_files).toHaveLength(2);
    expect(data.knowledge_files[0].name).toBe("Politica_Agendamento.pdf");
    expect(data.knowledge_files[1].name).toBe("Tabela_Convenios.xlsx");

    expect(data.cinco_pilares).toEqual(pilares);
  });
});
