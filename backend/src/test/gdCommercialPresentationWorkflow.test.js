import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";
import { createCanvas } from "@napi-rs/canvas";
import {
  parseLogoFilename,
  obterPaletaPadraoPorNicho,
  normalizarChaveNicho,
  extrairPaletaDaImagem,
  analisarLogoComGemini,
  refinarLogoEmAltaResolucao,
  processarRefinamentoELogo,
  salvarLogoRefinadaNaPasta,
  removerArquivoLogosNovas,
} from "../services/gdLogoEnhancerService.js";
import {
  obterConteudoNicho,
  gerarApresentacaoPptx,
  gerarApresentacaoPdf,
  gerarArquivosApresentacao,
  CATALOGO_CONTEUDO_NICHOS,
} from "../services/gdPresentationGeneratorService.js";
import {
  formatarMensagemWhatsAppCaio,
  executarFluxoApresentacaoComercial,
  processarIngestaoLogosNovas,
} from "../services/gdCommercialPresentationWorkflowService.js";
import {
  getOrCreateDriveFolder,
  ensureCommercialPresentationFolders,
  listFilesInDriveFolder,
  downloadFileFromDrive,
  deleteFileFromDrive,
} from "../services/googleDriveClientSetup.js";
import { registerGdClientesRoutes, GD_DONO } from "../domains/gdClientes/routes.js";

// Helper para criar buffer de imagem PNG de teste
function criarImagemMockPng(largura = 300, altura = 150, corFundo = "#1E3A8A") {
  const canvas = createCanvas(largura, altura);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = corFundo;
  ctx.fillRect(0, 0, largura, altura);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "24px sans-serif";
  ctx.fillText("LOGO TESTE", 20, 80);
  return canvas.toBuffer("image/png");
}

describe("Frente 3: Gerador Autônomo da Apresentação Comercial 'Máquina de Vendas'", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ─── 1. SERVIÇO DE LOGO & PALETA DE CORES (gdLogoEnhancerService) ─────────
  describe("1. gdLogoEnhancerService (Parser, Gemini Vision e Upscale)", () => {
    it("parseLogoFilename extrai Nome da Empresa e Nicho corretamente a partir de múltiplos padrões", () => {
      // Padrão 1: "Empresa - Nicho"
      const r1 = parseLogoFilename("Advocacia Silva & Santos - Direito Trabalhista.png");
      expect(r1.prospectName).toBe("Advocacia Silva & Santos");
      expect(r1.niche).toBe("Direito Trabalhista");

      // Padrão 2: "Empresa_Nicho"
      const r2 = parseLogoFilename("Clinica_Vitta_Estetica_Facial.jpeg");
      expect(r2.prospectName).toBe("Clinica Vitta");
      expect(r2.niche).toBe("Estetica Facial");

      // Padrão 3: "Empresa (Nicho)"
      const r3 = parseLogoFilename("Oticas Visao (Saude Visual).png");
      expect(r3.prospectName).toBe("Oticas Visao");
      expect(r3.niche).toBe("Saude Visual");

      // Padrão 4: Sem separador explícito, inferência por palavras-chave
      const r4 = parseLogoFilename("Dr. Roberto Odontologia.jpg");
      expect(r4.prospectName).toBe("Dr. Roberto Odontologia");
      expect(r4.niche).toContain("Odontologia");
    });

    it("normalizarChaveNicho e obterPaletaPadraoPorNicho mapeiam paletas institucionais adequadas", () => {
      expect(normalizarChaveNicho("Direito Tributário")).toBe("advocacia");
      expect(normalizarChaveNicho("Harmonização Facial e Botox")).toBe("estetica");
      expect(normalizarChaveNicho("Clínica Geral e Pediatria")).toBe("clinica_medica");
      expect(normalizarChaveNicho("Óculos de Sol e Lentes")).toBe("otica");
      expect(normalizarChaveNicho("Loja de Roupas")).toBe("varejo");

      const paletaAdv = obterPaletaPadraoPorNicho("advocacia");
      expect(paletaAdv.primaria).toBe("#0F172A");
      expect(paletaAdv.destaque).toBe("#D97706");

      const paletaEst = obterPaletaPadraoPorNicho("estetica");
      expect(paletaEst.primaria).toBe("#831843");
      expect(paletaEst.destaque).toBe("#F43F5E");
    });

    it("extrairPaletaDaImagem analisa pixels da imagem e retorna cores válidas", async () => {
      const imgBuffer = criarImagemMockPng(200, 100, "#1E3E62");
      const paleta = await extrairPaletaDaImagem(imgBuffer, {
        prospectName: "Empresa Azul",
        niche: "Varejo",
      });

      expect(paleta).toHaveProperty("primaria");
      expect(paleta).toHaveProperty("secundaria");
      expect(paleta).toHaveProperty("destaque");
      expect(paleta.primaria).toMatch(/^#[0-9A-F]{6}$/i);
    });

    it("analisarLogoComGemini integra com Gemini Vision e aceita llmCaller mock", async () => {
      const mockLlm = vi.fn().mockResolvedValue({
        prospectName: "Dr. Roberto Implantes",
        nicho: "Odontologia Especializada",
        paletaCores: {
          primaria: "#082F49",
          secundaria: "#0284C7",
          destaque: "#38BDF8",
          fundo: "#F0F9FF",
        },
        estiloVisual: "moderno e cirúrgico",
        elementosGraficos: "Ícone de dente estilizado",
        recomendacoes: ["Alto contraste"],
      });

      const res = await analisarLogoComGemini({
        imageBuffer: criarImagemMockPng(),
        fileName: "Dr. Roberto Implantes - Odontologia.png",
        llmCaller: mockLlm,
      });

      expect(mockLlm).toHaveBeenCalledTimes(1);
      expect(res.prospectName).toBe("Dr. Roberto Implantes");
      expect(res.nicho).toBe("Odontologia Especializada");
      expect(res.paletaCores.primaria).toBe("#082F49");
      expect(res.paletaCores.destaque).toBe("#38BDF8");
    });

    it("refinarLogoEmAltaResolucao gera PNG em alta resolução (1200x1200) com suavização", async () => {
      const inputBuffer = criarImagemMockPng(150, 75, "#0F766E");
      const upscale = await refinarLogoEmAltaResolucao({
        imageBuffer: inputBuffer,
        targetWidth: 1200,
        targetHeight: 1200,
      });

      expect(upscale).toBeDefined();
      expect(Buffer.isBuffer(upscale.enhancedBuffer)).toBe(true);
      expect(upscale.width).toBe(1200);
      expect(upscale.height).toBe(1200);
      expect(upscale.mimeType).toBe("image/png");
      expect(upscale.enhancedBuffer.length).toBeGreaterThan(1000);
    });

    it("salvarLogoRefinadaNaPasta e removerArquivoLogosNovas executam uploads e exclusões", async () => {
      const mockUploader = vi.fn().mockResolvedValue({
        fileId: "logo_refinada_id",
        fileLink: "https://drive.google.com/file/d/logo_refinada_id/view",
      });
      const mockDeleter = vi.fn().mockResolvedValue({
        success: true,
        fileId: "raw_logo_print_id",
      });

      const saveRes = await salvarLogoRefinadaNaPasta({
        prospectName: "Óticas Visão",
        logoBuffer: criarImagemMockPng(),
        folderId: "prospect_folder_123",
        driveUploader: mockUploader,
      });

      expect(saveRes.fileId).toBe("logo_refinada_id");
      expect(mockUploader).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: "Logo_Refinada__ticas_Vis_o.png",
          folderId: "prospect_folder_123",
        })
      );

      const delRes = await removerArquivoLogosNovas({
        fileId: "raw_logo_print_id",
        driveDeleter: mockDeleter,
      });
      expect(delRes.success).toBe(true);
      expect(mockDeleter).toHaveBeenCalledWith({ fileId: "raw_logo_print_id" });
    });
  });

  // ─── 2. GERADOR DE SLIDES POR NICHO (gdPresentationGeneratorService) ───────
  describe("2. gdPresentationGeneratorService (Conteúdo por Nicho, PPTX e PDF)", () => {
    it("obterConteudoNicho adapta dores, diagnósticos e soluções para cada nicho", async () => {
      const adv = await obterConteudoNicho({ nicho: "Advocacia", prospectName: "Melo Advogados" });
      expect(adv.nichoNome).toContain("Advocacia");
      expect(adv.dores).toHaveLength(3);
      expect(adv.dores[0].titulo).toContain("Indicações");
      expect(adv.estatisticaMercado).toContain("82%");
      expect(adv.solucaoPilares).toHaveLength(3);

      const est = await obterConteudoNicho({ nicho: "Estética", prospectName: "Espaço Laser" });
      expect(est.nichoNome).toContain("Estética");
      expect(est.dores[0].titulo).toContain("No-Show");
      expect(est.metricas[0].label).toContain("No-Show");
    });

    it("gerarApresentacaoPptx cria apresentação PowerPoint (.pptx) com layout 16:9 e slides formatados", async () => {
      const logoBuffer = criarImagemMockPng(200, 100, "#1E3E62");
      const pptxBuffer = await gerarApresentacaoPptx({
        prospectName: "Clínica Vitta",
        nicho: "Estética Avançada",
        paletaCores: {
          primaria: "#831843",
          secundaria: "#BE185D",
          destaque: "#F43F5E",
          fundo: "#FFF1F2",
        },
        logoBuffer,
      });

      expect(Buffer.isBuffer(pptxBuffer)).toBe(true);
      expect(pptxBuffer.length).toBeGreaterThan(10000);
    });

    it("gerarApresentacaoPdf cria apresentação em PDF (.pdf) em formato widescreen 16:9", async () => {
      const logoBuffer = criarImagemMockPng(200, 100, "#0F172A");
      const pdfBuffer = await gerarApresentacaoPdf({
        prospectName: "Almeida & Silva Advocacia",
        nicho: "Advocacia Trabalhista",
        paletaCores: {
          primaria: "#0F172A",
          secundaria: "#1E3A8A",
          destaque: "#D97706",
          fundo: "#F8FAFC",
        },
        logoBuffer,
      });

      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.length).toBeGreaterThan(2000);
      // Assinatura de PDF (%PDF-)
      expect(pdfBuffer.toString("utf8", 0, 5)).toBe("%PDF-");
    });

    it("gerarArquivosApresentacao gera simultaneamente .pptx e .pdf prontos para entrega", async () => {
      const resultado = await gerarArquivosApresentacao({
        prospectName: "Ótica Bela Vista",
        nicho: "Óticas",
        paletaCores: {
          primaria: "#0C4A6E",
          secundaria: "#0284C7",
          destaque: "#F59E0B",
          fundo: "#F8FAFC",
        },
        logoBuffer: criarImagemMockPng(),
      });

      expect(resultado).toHaveProperty("pptx");
      expect(resultado).toHaveProperty("pdf");
      expect(resultado.pptx.fileName).toContain("Apresentacao_Maquina_de_Vendas_");
      expect(resultado.pptx.fileName).toContain(".pptx");
      expect(resultado.pdf.fileName).toContain(".pdf");
      expect(resultado.pptx.size).toBeGreaterThan(5000);
      expect(resultado.pdf.size).toBeGreaterThan(1000);
    });
  });

  // ─── 3. ORQUESTRADOR DO FLUXO COMERCIAL (gdCommercialPresentationWorkflow) ─
  describe("3. gdCommercialPresentationWorkflowService (Orquestração e Notificação)", () => {
    it("formatarMensagemWhatsAppCaio monta texto com todos os links e dados institucionais", () => {
      const texto = formatarMensagemWhatsAppCaio({
        prospectName: "Clínica Dermato",
        nicho: "Estética",
        paletaCores: { primaria: "#831843", secundaria: "#BE185D", destaque: "#F43F5E" },
        pptxLink: "https://drive.google.com/file/d/pptx_123/view",
        pdfLink: "https://drive.google.com/file/d/pdf_123/view",
        logoLink: "https://drive.google.com/file/d/logo_123/view",
        folderLink: "https://drive.google.com/drive/folders/folder_123",
      });

      expect(texto).toContain("Clínica Dermato");
      expect(texto).toContain("Estética");
      expect(texto).toContain("#831843");
      expect(texto).toContain("pptx_123");
      expect(texto).toContain("pdf_123");
      expect(texto).toContain("folder_123");
    });

    it("executarFluxoApresentacaoComercial realiza upscale, gera PPTX/PDF, arquiva no Drive, limpa arquivo original e notifica Caio", async () => {
      const mockFoldersEnsurer = vi.fn().mockResolvedValue({
        prospectFolderId: "drive_prospect_folder_id",
        prospectFolderLink: "https://drive.google.com/drive/folders/drive_prospect_folder_id",
        isMock: true,
      });

      let uploadCount = 0;
      const mockUploader = vi.fn().mockImplementation(async ({ fileName }) => {
        uploadCount++;
        return {
          fileId: `file_${uploadCount}_${fileName}`,
          fileName,
          fileLink: `https://drive.google.com/file/d/file_${uploadCount}/view`,
        };
      });

      const mockDeleter = vi.fn().mockResolvedValue({
        success: true,
        fileId: "print_baixo_res_id",
      });

      const mockEvolution = vi.fn().mockResolvedValue({ success: true });

      const res = await executarFluxoApresentacaoComercial({
        fileBuffer: criarImagemMockPng(),
        fileName: "Consultoria Alpha - Servicos B2B.png",
        fileId: "print_baixo_res_id",
        caioNumero: "5534997719779",
        instanceName: "vexo-adm",
        foldersEnsurer: mockFoldersEnsurer,
        driveUploader: mockUploader,
        driveDeleter: mockDeleter,
        evolutionSender: mockEvolution,
      });

      expect(res.success).toBe(true);
      expect(res.prospectName).toBe("Consultoria Alpha");
      expect(res.nicho).toBe("Servicos B2B");

      // Verifica 3 uploads no Drive: Logo refinada, PPTX e PDF
      expect(mockUploader).toHaveBeenCalledTimes(3);
      expect(res.files.pptx.link).toContain("https://drive.google.com/file/d/");
      expect(res.files.pdf.link).toContain("https://drive.google.com/file/d/");
      expect(res.files.logo.link).toContain("https://drive.google.com/file/d/");

      // Verifica limpeza do print de baixa resolução em Logos Novas
      expect(mockDeleter).toHaveBeenCalledTimes(1);
      expect(mockDeleter).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: "print_baixo_res_id" })
      );

      // Verifica notificação de WhatsApp para o Caio
      expect(mockEvolution).toHaveBeenCalledTimes(1);
      expect(mockEvolution).toHaveBeenCalledWith({
        instanceName: "vexo-adm",
        number: "5534997719779",
        text: expect.stringContaining("Máquina de Vendas Pronta"),
      });
    });

    it("processarIngestaoLogosNovas varre pasta do Drive, processa prints pendentes e remove arquivos", async () => {
      const mockLister = vi.fn().mockResolvedValue([
        { id: "file_001", name: "Clinica Sorriso - Odontologia.png" },
        { id: "file_002", name: "Otica Real - Saude Visual.jpeg" },
      ]);
      const mockDownloader = vi.fn().mockResolvedValue(criarImagemMockPng());
      const mockWorkflowExecutor = vi.fn().mockResolvedValue({
        success: true,
        prospectName: "Mock Prospect",
      });

      const batchRes = await processarIngestaoLogosNovas({
        folderId: "folder_logos_novas_id",
        driveFilesLister: mockLister,
        driveFileDownloader: mockDownloader,
        workflowExecutor: mockWorkflowExecutor,
      });

      expect(batchRes.success).toBe(true);
      expect(batchRes.totalProcessed).toBe(2);
      expect(mockDownloader).toHaveBeenCalledTimes(2);
      expect(mockWorkflowExecutor).toHaveBeenCalledTimes(2);
    });
  });

  // ─── 4. ENDPOINT HTTP POST /api/gd/comercial/gerar-apresentacao ─────────────
  describe("4. Endpoint HTTP POST /api/gd/comercial/gerar-apresentacao", () => {
    let app;
    let server;
    let baseUrl;

    beforeEach(async () => {
      app = express();
      app.use(express.json({ limit: "50mb" }));

      // Simulação do middleware de autenticação GD para testes
      const mockAuthMiddleware = (req, _res, next) => {
        req.authActor = { tipo: "humano", id: "uid_conrado_caio" };
        req.authAccess = { uid: "uid_conrado_caio", role: "superadmin" };
        next();
      };

      const mockWorkflowExecutor = vi.fn().mockResolvedValue({
        success: true,
        prospectName: "Advocacia Souza",
        nicho: "Direito Trabalhista",
        paletaCores: { primaria: "#0F172A", destaque: "#D97706" },
        driveFolder: { link: "https://drive.google.com/drive/folders/souza_123" },
        files: {
          pptx: { link: "https://drive.google.com/file/d/pptx_souza/view" },
          pdf: { link: "https://drive.google.com/file/d/pdf_souza/view" },
          logo: { link: "https://drive.google.com/file/d/logo_souza/view" },
        },
        whatsappNotification: { sent: true },
      });

      const mockBatchIngestion = vi.fn().mockResolvedValue({
        success: true,
        totalProcessed: 1,
        processed: [{ fileId: "drive_f1", fileName: "Auto_Vendas.png" }],
      });

      registerGdClientesRoutes(app, {
        getPool: () => ({ query: async () => ({ rows: [] }) }),
        requireFirebaseAuth: mockAuthMiddleware,
        commercialWorkflowExecutor: mockWorkflowExecutor,
        commercialBatchIngestion: mockBatchIngestion,
      });

      await new Promise((resolve) => {
        server = http.createServer(app).listen(0, "127.0.0.1", () => {
          baseUrl = `http://127.0.0.1:${server.address().port}`;
          resolve();
        });
      });
    });

    afterEach(async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it("POST /api/gd/comercial/gerar-apresentacao processa upload direto com base64 e metadados", async () => {
      const imgBuf = criarImagemMockPng();
      const base64 = `data:image/png;base64,${imgBuf.toString("base64")}`;

      const res = await fetch(`${baseUrl}/api/gd/comercial/gerar-apresentacao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileBase64: base64,
          fileName: "Advocacia Souza - Direito Trabalhista.png",
          prospectName: "Advocacia Souza",
          nicho: "Direito Trabalhista",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.modo).toBe("upload_direto");
      expect(data.prospectName).toBe("Advocacia Souza");
      expect(data.files.pptx.link).toContain("pptx_souza");
      expect(data.files.pdf.link).toContain("pdf_souza");
    });

    it("POST /api/gd/comercial/gerar-apresentacao aciona modo watcher / ingestão quando poll=true", async () => {
      const res = await fetch(`${baseUrl}/api/gd/comercial/gerar-apresentacao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poll: true,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.modo).toBe("ingestao_logos_novas");
      expect(data.totalProcessed).toBe(1);
    });
  });
});
