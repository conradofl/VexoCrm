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

describe("Implantação: Kit de Documentos por Segmento e As Cinco Objeções", () => {
  let handlers = {};
  let mockPool;
  let storedBriefings = new Map();

  beforeEach(() => {
    vi.clearAllMocks();
    storedBriefings.clear();
    handlers = {};

    mockPool = {
      query: vi.fn(async (sql, params = []) => {
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

          const newId = `briefing-${Date.now()}-${Math.random().toString(36).substring(7)}`;
          const parsedPilares = JSON.parse(cinco_pilares || "{}");
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
            cinco_pilares: parsedPilares,
            status,
            owner_company,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          storedBriefings.set(newId, record);
          return { rows: [record] };
        }

        // SELECT owner_company guard
        if (sql.includes("SELECT owner_company FROM public.gd_implementation_briefings")) {
          const id = params[0];
          const item = storedBriefings.get(id);
          if (!item) return { rows: [] };
          return { rows: [{ owner_company: item.owner_company || "geracao-digital" }] };
        }

        // SELECT * FROM public.gd_implementation_briefings WHERE id = $1
        if (sql.includes("SELECT * FROM public.gd_implementation_briefings WHERE id = $1")) {
          const id = params[0];
          const item = storedBriefings.get(id);
          if (!item) return { rows: [] };
          return { rows: [item] };
        }

        // SELECT * FROM public.gd_implementation_briefings (list)
        if (sql.includes("SELECT * FROM public.gd_implementation_briefings")) {
          return { rows: Array.from(storedBriefings.values()) };
        }

        // UPDATE public.gd_implementation_briefings
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

  it("[TESTE 1] os três estados de cada item do kit gravam, inclusive 'o cliente não tem' com a observação", async () => {
    const postRoute = handlers["POST /api/gd/implementation-briefings"];
    const handler = postRoute[postRoute.length - 1];

    const documentosKitPayload = [
      { id: "cardapio_preco", titulo: "Cardápio com preço", status: "recebido", observacao: "" },
      { id: "area_taxa_entrega", titulo: "Área e taxa de entrega", status: "pendente", observacao: "" },
      {
        id: "horario_funcionamento",
        titulo: "Horário de funcionamento",
        status: "nao_tem",
        observacao: "Cliente não tem folheto, mas opera de terça a domingo das 18h às 23h30 e fecha segunda.",
      },
      {
        id: "nao_tem_delivery",
        titulo: "O que não tem no delivery",
        status: "nao_tem",
        observacao: "Sobremesas de sorvete não vão no delivery porque derretem no trajeto.",
      },
    ];

    const req = {
      user: { uid: "user-test" },
      authAccess: adminAuthAccess(),
      body: {
        client_name: "Pizzaria Bella Forneria",
        tenant_id: "bella-forneria",
        segmento: "restaurantes_bares",
        documentos_kit: documentosKitPayload,
        cinco_pilares: {
          pilar1_produtos_servicos: "Pizzas artesanais napolitanas",
          pilar2_preco_condicoes: "Pizzas de R$ 65 a R$ 90",
          pilar3_funcionamento_prazos: "Entrega em até 40 min",
          pilar4_duvidas_frequentes: "Tem massa sem glúten?",
          pilar5_nao_prometer: "Não prometer entrega fora do raio de 8km",
        },
      },
    };
    const res = fakeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const savedBriefing = res.body.data;
    expect(savedBriefing.documentos_kit).toEqual(documentosKitPayload);
    expect(savedBriefing.cinco_pilares.documentos_kit).toEqual(documentosKitPayload);

    // Valida especificamente o estado "nao_tem" com a observação inserida
    const itemNaoTem = savedBriefing.documentos_kit.find((i) => i.id === "horario_funcionamento");
    expect(itemNaoTem.status).toBe("nao_tem");
    expect(itemNaoTem.observacao).toBe(
      "Cliente não tem folheto, mas opera de terça a domingo das 18h às 23h30 e fecha segunda."
    );
  });

  it("[TESTE 2] as cinco objeções e as cinco respostas persistem e voltam intactas ao reabrir o briefing", async () => {
    const postRoute = handlers["POST /api/gd/implementation-briefings"];
    const postHandler = postRoute[postRoute.length - 1];

    const cincoObjecoesPayload = [
      {
        id: 1,
        objecao: "Achei a taxa de entrega muito cara para o meu bairro.",
        resposta: "Explicamos que usamos entrega expressa própria aquecida e temos cupom de R$ 5 na primeira compra.",
      },
      {
        id: 2,
        objecao: "Demora muito para chegar na sexta-feira?",
        resposta: "Passamos o tempo médio real de 35 a 45 minutos e mandamos o link de acompanhamento do entregador.",
      },
      {
        id: 3,
        objecao: "Vocês têm opção sem glúten?",
        resposta: "Temos 2 sabores com massa de mandioca, mas avisamos que a cozinha tem traços de farinha.",
      },
      {
        id: 4,
        objecao: "Posso pedir meia pizza de dois sabores?",
        resposta: "Sim, cobramos o valor da pizza de maior valor sem taxa extra de montagem.",
      },
      {
        id: 5,
        objecao: "Meu pedido veio frio ou errado da última vez.",
        resposta: "Pedimos desculpa imediata, pegamos o número do pedido anterior e mandamos o item novo ou cupom sem burocracia.",
      },
    ];

    const reqCreate = {
      user: { uid: "user-test" },
      authAccess: adminAuthAccess(),
      body: {
        client_name: "Forneria do Chefe",
        tenant_id: "forneria-chefe",
        segmento: "restaurantes_bares",
        cinco_objecoes: cincoObjecoesPayload,
        cinco_pilares: {
          pilar1_produtos_servicos: "Pizzas e calzones",
        },
      },
    };
    const resCreate = fakeRes();
    await postHandler(reqCreate, resCreate);

    expect(resCreate.statusCode).toBe(200);
    const createdId = resCreate.body.data.id;
    expect(resCreate.body.data.cinco_objecoes).toEqual(cincoObjecoesPayload);

    // Consulta GET pelo ID (simula o reabrir do briefing no formulário)
    const getRoute = handlers["GET /api/gd/implementation-briefings/:id"];
    const getHandler = getRoute[getRoute.length - 1];
    const reqGet = {
      params: { id: createdId },
      user: { uid: "user-test" },
      authAccess: adminAuthAccess(),
    };
    const resGet = fakeRes();
    await getHandler(reqGet, resGet);

    expect(resGet.statusCode).toBe(200);
    expect(resGet.body.data.cinco_objecoes).toEqual(cincoObjecoesPayload);
    expect(resGet.body.data.cinco_pilares.cinco_objecoes).toEqual(cincoObjecoesPayload);
    expect(resGet.body.data.cinco_objecoes).toHaveLength(5);
  });

  it("[TESTE 3] atualizações via PUT preservam as cinco objeções e o kit de documentos sem perda de dados", async () => {
    // 1. Cria briefing inicial
    const postRoute = handlers["POST /api/gd/implementation-briefings"];
    const postHandler = postRoute[postRoute.length - 1];
    const reqCreate = {
      user: { uid: "user-test" },
      authAccess: adminAuthAccess(),
      body: {
        client_name: "Agência Viagens & Destinos",
        tenant_id: "viagens-destinos",
        segmento: "turismo",
        cinco_objecoes: [
          { id: 1, objecao: "Pacote tá caro.", resposta: "Mostramos o que está incluso." },
          { id: 2, objecao: "", resposta: "" },
          { id: 3, objecao: "", resposta: "" },
          { id: 4, objecao: "", resposta: "" },
          { id: 5, objecao: "", resposta: "" },
        ],
        documentos_kit: [
          { id: "pacotes_preco_incluso", titulo: "Planilha de pacotes", status: "pendente", observacao: "" },
          { id: "politica_cancelamento", titulo: "Política de cancelamento", status: "pendente", observacao: "" },
          { id: "formas_pagamento", titulo: "Formas de pagamento", status: "pendente", observacao: "" },
        ],
      },
    };
    const resCreate = fakeRes();
    await postHandler(reqCreate, resCreate);
    const briefingId = resCreate.body.data.id;

    // 2. Atualiza via PUT com os documentos recebidos e a 2ª objeção preenchida
    const putRoute = handlers["PUT /api/gd/implementation-briefings/:id"];
    const putHandler = putRoute[putRoute.length - 1];

    const updatedObjecoes = [
      { id: 1, objecao: "Pacote tá caro.", resposta: "Mostramos que inclui seguro 24h e guia bilíngue." },
      { id: 2, objecao: "E se chover?", resposta: "Explicamos a política de remarcação sem taxa." },
      { id: 3, objecao: "", resposta: "" },
      { id: 4, objecao: "", resposta: "" },
      { id: 5, objecao: "", resposta: "" },
    ];

    const updatedKit = [
      { id: "pacotes_preco_incluso", titulo: "Planilha de pacotes", status: "recebido", observacao: "" },
      { id: "politica_cancelamento", titulo: "Política de cancelamento", status: "recebido", observacao: "" },
      { id: "formas_pagamento", titulo: "Formas de pagamento", status: "nao_tem", observacao: "Só aceita cartão de crédito em até 10x sem juros ou Pix." },
    ];

    const reqUpdate = {
      params: { id: briefingId },
      user: { uid: "user-test" },
      authAccess: adminAuthAccess(),
      body: {
        cinco_objecoes: updatedObjecoes,
        documentos_kit: updatedKit,
      },
    };
    const resUpdate = fakeRes();
    await putHandler(reqUpdate, resUpdate);

    expect(resUpdate.statusCode).toBe(200);
    expect(resUpdate.body.data.cinco_objecoes).toEqual(updatedObjecoes);
    expect(resUpdate.body.data.documentos_kit).toEqual(updatedKit);

    // Consulta GET novamente para certificar que persistiu no banco
    const getRoute = handlers["GET /api/gd/implementation-briefings/:id"];
    const getHandler = getRoute[getRoute.length - 1];
    const resGet = fakeRes();
    await getHandler({ params: { id: briefingId }, user: { uid: "u" }, authAccess: adminAuthAccess() }, resGet);

    expect(resGet.body.data.cinco_objecoes[1].objecao).toBe("E se chover?");
    expect(resGet.body.data.documentos_kit[2].status).toBe("nao_tem");
    expect(resGet.body.data.documentos_kit[2].observacao).toContain("Só aceita cartão de crédito");
  });

  it("[TESTE 4] exemplo sugerido nunca é gravado como resposta do cliente quando campos ficam vazios", async () => {
    const postRoute = handlers["POST /api/gd/implementation-briefings"];
    const handler = postRoute[postRoute.length - 1];

    // O consultor escolheu o segmento "contabilidade", mas não digitou nenhuma objeção
    const emptyObjecoes = [
      { id: 1, objecao: "", resposta: "" },
      { id: 2, objecao: "", resposta: "" },
      { id: 3, objecao: "", resposta: "" },
      { id: 4, objecao: "", resposta: "" },
      { id: 5, objecao: "", resposta: "" },
    ];

    const req = {
      user: { uid: "user-test" },
      authAccess: adminAuthAccess(),
      body: {
        client_name: "Contabilidade Silva & Associados",
        tenant_id: "silva-contabilidade",
        segmento: "contabilidade",
        cinco_objecoes: emptyObjecoes,
      },
    };
    const res = fakeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.body.data;

    // Certifica que não houve injeção automática de textos sugeridos
    data.cinco_objecoes.forEach((par) => {
      expect(par.objecao).toBe("");
      expect(par.resposta).toBe("");
      expect(par.objecao).not.toContain("A contabilidade online cobra bem mais barato");
    });
  });

  it("[TESTE 5] briefing salvo sem nenhuma objeção continua válido; nada aqui é obrigatório", async () => {
    const postRoute = handlers["POST /api/gd/implementation-briefings"];
    const handler = postRoute[postRoute.length - 1];

    // Salvando sem enviar campo cinco_objecoes ou documentos_kit
    const req = {
      user: { uid: "user-test" },
      authAccess: adminAuthAccess(),
      body: {
        client_name: "Loja Teste Vazia",
        tenant_id: "loja-teste-vazia",
        model_type: "essencial",
      },
    };
    const res = fakeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.client_name).toBe("Loja Teste Vazia");
    expect(Array.isArray(res.body.data.cinco_objecoes)).toBe(true);
    expect(Array.isArray(res.body.data.documentos_kit)).toBe(true);
  });
});
