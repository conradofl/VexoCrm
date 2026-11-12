import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { GD_DONO, registerGdClientesRoutes } from "../domains/gdClientes/routes.js";
import {
  extrairCotasContrato,
  gerarSintesePadrao,
  sintetizarBriefingComGemini,
  gerarDocumentoBriefingDocx,
  gerarDocumentoBriefingPdf,
  gerarDocumentoIdentidadeDocx,
  gerarDocumentoIdentidadePdf,
  gerarDocumentoRoteirosDocx,
  gerarDocumentoRoteirosPdf,
  gerarDocumentoPlanejamentoDocx,
  gerarDocumentoPlanejamentoPdf,
  gerarTodosDocumentosBriefing,
  arquivarDocumentosBriefingNoDrive,
  executarSinteseEGeracaoBriefing,
} from "../services/gdBriefingSynthesizerService.js";
import { uploadFileToDrive } from "../services/googleDriveClientSetup.js";

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
  await db.exec(MIGRATION_FRENTE6);
  await db.exec(MIGRATION_CS_PORTAL);

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

  registerGdClientesRoutes(app, {
    getPool: () => poolDe(db),
    requireFirebaseAuth,
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

describe("Módulo de Síntese Multidocumento com Gemini (gdBriefingSynthesizerService)", () => {
  it("extrai cotas contratuais corretamente com base no escopo acordado", () => {
    const cotaPadrao = extrairCotasContrato(null, ["google", "social"]);
    expect(cotaPadrao.carrosseisPorSemana).toBe(2);
    expect(cotaPadrao.videosPorSemana).toBe(2);
    expect(cotaPadrao.estaticosPorSemana).toBe(1);
    expect(cotaPadrao.totalPorSemana).toBe(5);
    expect(cotaPadrao.totalTrimestre).toBe(60);

    const cotaCustom = extrairCotasContrato({
      dados: { escopo_original: "Contrato com 3 vídeos e 3 carrosséis semanais" },
    });
    expect(cotaCustom.videosPorSemana).toBe(3);
    expect(cotaCustom.carrosseisPorSemana).toBe(3);
    expect(cotaCustom.totalTrimestre).toBe(84); // (3+3+1)*12
  });

  it("produz síntese padrão rica quando Gemini está sem chave ou em fallback", async () => {
    const sintese = await sintetizarBriefingComGemini({
      cliente: { nome: "Clínica Bem Estar", aprovador_nome: "Dra. Juliana" },
      transcricao: "Transcrição da reunião de alinhamento estratégico.",
      respostasFormulario: { setor: "Saúde & Estética Avançada" },
    });

    expect(sintese.briefingConsolidado.clienteNome).toBe("Clínica Bem Estar");
    expect(sintese.briefingConsolidado.posicionamento).toContain("Saúde & Estética");
    expect(sintese.identidadeVisual.paletaCores.length).toBeGreaterThanOrEqual(4);
    expect(sintese.roteirosTrimestrais.semanas).toHaveLength(12);
    expect(sintese.planejamentoTrimestral.fases).toHaveLength(3);
  });

  it("utiliza llmCaller personalizado quando fornecido", async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      briefingConsolidado: { titulo: "Briefing Customizado", clienteNome: "Custom Corp" },
      identidadeVisual: { titulo: "Identidade Custom", clienteNome: "Custom Corp" },
      roteirosTrimestrais: { titulo: "Roteiros Custom", clienteNome: "Custom Corp" },
      planejamentoTrimestral: { titulo: "Plano Custom", clienteNome: "Custom Corp" },
    });

    const res = await sintetizarBriefingComGemini({
      cliente: { nome: "Custom Corp" },
      llmCaller: mockLlm,
      apiKey: "chave_falsa",
    });

    expect(mockLlm).toHaveBeenCalledTimes(1);
    expect(res.briefingConsolidado.titulo).toBe("Briefing Customizado");
  });

  it("gera buffers válidos para os 4 documentos em DOCX e em PDF", async () => {
    const sintese = gerarSintesePadrao({
      cliente: { nome: "Imobiliária Prime", cnpj: "12345678000190" },
    });

    // 1. Briefing Consolidado
    const bDocx = await gerarDocumentoBriefingDocx(sintese);
    const bPdf = await gerarDocumentoBriefingPdf(sintese);
    expect(Buffer.isBuffer(bDocx)).toBe(true);
    expect(bDocx.length).toBeGreaterThan(1000);
    expect(bPdf.slice(0, 4).toString("ascii")).toBe("%PDF");

    // 2. Identidade Visual
    const iDocx = await gerarDocumentoIdentidadeDocx(sintese);
    const iPdf = await gerarDocumentoIdentidadePdf(sintese);
    expect(Buffer.isBuffer(iDocx)).toBe(true);
    expect(iDocx.length).toBeGreaterThan(1000);
    expect(iPdf.slice(0, 4).toString("ascii")).toBe("%PDF");

    // 3. Roteiros de Conteúdo
    const rDocx = await gerarDocumentoRoteirosDocx(sintese);
    const rPdf = await gerarDocumentoRoteirosPdf(sintese);
    expect(Buffer.isBuffer(rDocx)).toBe(true);
    expect(rDocx.length).toBeGreaterThan(1000);
    expect(rPdf.slice(0, 4).toString("ascii")).toBe("%PDF");

    // 4. Planejamento Trimestral
    const pDocx = await gerarDocumentoPlanejamentoDocx(sintese);
    const pPdf = await gerarDocumentoPlanejamentoPdf(sintese);
    expect(Buffer.isBuffer(pDocx)).toBe(true);
    expect(pDocx.length).toBeGreaterThan(1000);
    expect(pPdf.slice(0, 4).toString("ascii")).toBe("%PDF");

    // Gerador de todos os 8 arquivos em lote
    const todos = await gerarTodosDocumentosBriefing(sintese);
    expect(todos.briefing.docx).toBeDefined();
    expect(todos.briefing.pdf).toBeDefined();
    expect(todos.identidade.docx).toBeDefined();
    expect(todos.identidade.pdf).toBeDefined();
    expect(todos.roteiros.docx).toBeDefined();
    expect(todos.roteiros.pdf).toBeDefined();
    expect(todos.planejamento.docx).toBeDefined();
    expect(todos.planejamento.pdf).toBeDefined();
  });

  it("arquiva os 4 documentos no Google Drive na estrutura correta com _vFinal", async () => {
    const sintese = gerarSintesePadrao({
      cliente: { nome: "Construtora Horizonte" },
    });
    const buffers = await gerarTodosDocumentosBriefing(sintese);

    const uploadsRegistrados = [];
    const mockUploader = vi.fn().mockImplementation(async ({ fileName, mimeType, folderId }) => {
      uploadsRegistrados.push({ fileName, mimeType, folderId });
      return {
        success: true,
        fileId: `id_${fileName.slice(0, 10)}`,
        fileName,
        fileLink: `https://drive.google.com/file/d/mock_${fileName}`,
        isMock: true,
      };
    });

    const resultadoDrive = await arquivarDocumentosBriefingNoDrive({
      clienteNome: "Construtora Horizonte",
      driveFolderUrl: "https://drive.google.com/drive/folders/folder_123_abc",
      documentosBuffers: buffers,
      timestamp: "20261108_1400",
      driveUploader: mockUploader,
    });

    expect(uploadsRegistrados).toHaveLength(8);
    expect(uploadsRegistrados.some((u) => u.fileName.includes("01_Briefing_Consolidado") && u.fileName.endsWith(".docx"))).toBe(true);
    expect(uploadsRegistrados.some((u) => u.fileName.includes("01_Briefing_Consolidado") && u.fileName.endsWith(".pdf"))).toBe(true);
    expect(uploadsRegistrados.some((u) => u.fileName.includes("02_Identidade_Visual") && u.fileName.endsWith(".docx"))).toBe(true);
    expect(uploadsRegistrados.some((u) => u.fileName.includes("02_Identidade_Visual") && u.fileName.endsWith(".pdf"))).toBe(true);
    expect(uploadsRegistrados.some((u) => u.fileName.includes("03_Roteiros_3Meses") && u.fileName.endsWith(".docx"))).toBe(true);
    expect(uploadsRegistrados.some((u) => u.fileName.includes("03_Roteiros_3Meses") && u.fileName.endsWith(".pdf"))).toBe(true);
    expect(uploadsRegistrados.some((u) => u.fileName.includes("04_Planejamento_Trimestral") && u.fileName.endsWith(".docx"))).toBe(true);
    expect(uploadsRegistrados.some((u) => u.fileName.includes("04_Planejamento_Trimestral") && u.fileName.endsWith(".pdf"))).toBe(true);

    expect(resultadoDrive.versao).toBe("20261108_1400_vFinal");
    expect(resultadoDrive.documentos.briefing.pdf.fileLink).toContain("drive.google.com");
  });

  it("orquestra a síntese completa no banco e avança o estado para BRIEFING_REALIZADO", async () => {
    const { rows } = await db.query(
      `INSERT INTO public.gd_clientes (dono_client_id, nome, drive_url, origem)
       VALUES ('geracao-digital', 'Alfa Odonto ' || gen_random_uuid(), 'https://drive.google.com/drive/folders/drive_folder_alfa', 'fluxo')
       RETURNING id, nome`
    );
    const clienteId = rows[0].id;
    await db.query(
      `SELECT public.gd_registrar_evento($1, 'BRIEFING_AGENDADO', now(), false, 'fluxo', 'sistema', 'teste', 'inicial')`,
      [clienteId]
    );

    const mockUploader = vi.fn().mockImplementation(async ({ fileName }) => ({
      success: true,
      fileId: `mock_${fileName}`,
      fileName,
      fileLink: `https://drive.google.com/file/d/mock_${fileName}`,
      isMock: true,
    }));

    const res = await executarSinteseEGeracaoBriefing({
      clienteId,
      pool: poolDe(db),
      transcricao: "Reunião de alinhamento clínico sobre implantes e estética dental.",
      respostasFormulario: { setor: "Odontologia Especializada" },
      driveUploader: mockUploader,
    });

    expect(res.success).toBe(true);
    expect(res.documentos.briefing.pdf).toBeDefined();
    expect(res.cliente.briefing_documentos).toBeDefined();
    expect(res.cliente.briefing_transcricao).toContain("implantes");
    expect(res.cliente.briefing_aprovacao_interna_status).toBe("PENDENTE");

    // Verifica que o estado foi atualizado para BRIEFING_REALIZADO
    expect(res.cliente.estado_atual).toBe("BRIEFING_REALIZADO");

    // Verifica o evento registrado na trilha
    const { rows: eventos } = await db.query(
      `SELECT estado_para, motivo FROM public.gd_cliente_eventos WHERE cliente_id = $1 ORDER BY seq DESC LIMIT 1`,
      [clienteId]
    );
    expect(eventos[0].estado_para).toBe("BRIEFING_REALIZADO");
  });

  it("responde com sucesso via rota HTTP POST /api/gd/clientes/:id/briefing/sintetizar e consulta via GET /documentos", async () => {
    const { rows } = await db.query(
      `INSERT INTO public.gd_clientes (dono_client_id, nome, drive_url, origem)
       VALUES ('geracao-digital', 'Beta Tech ' || gen_random_uuid(), 'https://drive.google.com/drive/folders/drive_folder_beta', 'fluxo')
       RETURNING id, nome`
    );
    const clienteId = rows[0].id;
    await db.query(
      `SELECT public.gd_registrar_evento($1, 'BRIEFING_AGENDADO', now(), false, 'fluxo', 'sistema', 'teste', 'inicial')`,
      [clienteId]
    );

    const resPost = await chamar("POST", `/api/gd/clientes/${clienteId}/briefing/sintetizar`, {
      body: {
        transcricao: "Transcrição teste API",
        respostas_formulario: { segmento: "SaaS B2B" },
      },
    });

    expect(resPost.status).toBe(200);
    expect(resPost.json.success).toBe(true);
    expect(resPost.json.documentos.briefing.pdf).toBeDefined();

    // Consulta de documentos
    const resGet = await chamar("GET", `/api/gd/clientes/${clienteId}/briefing/documentos`);
    expect(resGet.status).toBe(200);
    expect(resGet.json.success).toBe(true);
    expect(resGet.json.briefing_documentos).toBeDefined();
    expect(resGet.json.aprovacao_interna.status).toBe("PENDENTE");
  });

  it("trata erro de cota da Service Account no Google Drive retornando registro seguro com isMock: false", async () => {
    const originalFetch = global.fetch;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          code: 403,
          message: "Service Accounts do not have storage quota. Please use Google Workspace or user credentials instead.",
          errors: [
            {
              message: "Service Accounts do not have storage quota. Please use Google Workspace or user credentials instead.",
              domain: "usageLimits",
              reason: "storageQuotaExceeded",
            },
          ],
        },
      }),
    });

    try {
      const res = await uploadFileToDrive({
        fileName: "teste_briefing_quota.pdf",
        fileBuffer: Buffer.from("conteudo mock para teste de cota"),
        accessToken: "fake-token-test",
      });

      expect(res.success).toBe(true);
      expect(res.isMock).toBe(false);
      expect(res.fileId).toMatch(/^gd_safe_/);
      expect(res.fileLink).toContain(`https://drive.google.com/file/d/${res.fileId}/view`);
      expect(warnSpy).toHaveBeenCalledWith(
        "[google-drive] Falha de cota de Service Account no Google Drive:",
        expect.stringContaining("Service Accounts do not have storage quota")
      );
    } finally {
      global.fetch = originalFetch;
      warnSpy.mockRestore();
    }
  });

  it("arquiva documentos com contingência individual caso o Drive apresente falha em algum arquivo", async () => {
    const sintese = gerarSintesePadrao({ cliente: { nome: "Empresa Teste Falha" } });
    const buffers = await gerarTodosDocumentosBriefing(sintese);

    let chamadas = 0;
    const mockUploaderComFalha = vi.fn().mockImplementation(async ({ fileName }) => {
      chamadas++;
      if (chamadas % 2 === 0) {
        throw new Error("Erro simulado de timeout / cota");
      }
      return {
        success: true,
        fileId: `id_ok_${chamadas}`,
        fileName,
        fileLink: `https://drive.google.com/file/d/id_ok_${chamadas}`,
        isMock: false,
      };
    });

    const resultadoDrive = await arquivarDocumentosBriefingNoDrive({
      clienteNome: "Empresa Teste Falha",
      driveFolderUrl: "https://drive.google.com/drive/folders/folder_xyz",
      documentosBuffers: buffers,
      driveUploader: mockUploaderComFalha,
    });

    expect(resultadoDrive.documentos.briefing.docx.isMock).toBe(false);
    expect(resultadoDrive.documentos.briefing.pdf.isMock).toBe(true);
    expect(resultadoDrive.documentos.briefing.pdf.contingencia).toBe(true);
    expect(resultadoDrive.documentos.briefing.pdf.fileId).toMatch(/^gd_contingencia_/);
  });

  it("garante que executarSinteseEGeracaoBriefing salva briefing_documentos mesmo com falha total do Drive", async () => {
    const { rows } = await db.query(
      `INSERT INTO public.gd_clientes (dono_client_id, nome, drive_url, origem)
       VALUES ('geracao-digital', 'Empresa Resiliente ' || gen_random_uuid(), 'https://drive.google.com/drive/folders/drive_resiliente', 'fluxo')
       RETURNING id, nome`
    );
    const clienteId = rows[0].id;

    const mockUploaderTotalFail = vi.fn().mockRejectedValue(new Error("Drive indisponível total"));

    const res = await executarSinteseEGeracaoBriefing({
      clienteId,
      pool: poolDe(db),
      transcricao: "Transcrição com drive falhando.",
      driveUploader: mockUploaderTotalFail,
    });

    expect(res.success).toBe(true);
    expect(res.documentos).toBeDefined();

    const { rows: clienteRows } = await db.query(
      `SELECT briefing_documentos FROM public.gd_clientes WHERE id = $1`,
      [clienteId]
    );
    expect(clienteRows[0].briefing_documentos).toBeDefined();
    expect(clienteRows[0].briefing_documentos.documentos.briefing.pdf).toBeDefined();
  });
});
