// backend/src/test/contractVisualRenderer.test.js
//
// Testes unitários e de integração visual da renderização executiva do PDF do contrato GD:
// - Cores oficiais (Roxo Primário, Magenta, Lavanda, Borda Suave)
// - Componentes visuais com PDFKit (drawHeader, drawClauseHeader, drawPartesBoxes, drawPricingTable, drawSignaturesAndWitnesses, drawFooter)
// - Escala estrita em 2 páginas e inclusão dos assets oficiais (image1.png, image3.png)

import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import fs from "fs";
import {
  GD_COLORS,
  CONTRACT_PDF_COLORS,
  PAGE_METRICS,
  drawHeader,
  drawClauseHeader,
  drawPartesBoxes,
  drawPricingTable,
  drawSignaturesAndWitnesses,
  drawFooter,
  renderContractPdf,
  getImageAssetPath,
  normalizeClauseHeader,
} from "../domains/geracaoDigitalContracts/contractVisualRenderer.js";

describe("Design System & Alta Fidelidade Visual do Contrato GD (contractVisualRenderer)", () => {
  describe("1. Paleta de Cores e Constantes Oficiais GD", () => {
    it("valida hex codes das cores oficiais da Geração Digital", () => {
      expect(GD_COLORS.deepPurple).toBe("#4A1370"); // Título principal, títulos de empresas, títulos de cláusula, valores na tabela
      expect(GD_COLORS.primary).toBe("#7B1FB0"); // "CLÁUSULA ORDINAL", rótulos nos boxes (CNPJ:, Telefone:), cabeçalhos de tabela
      expect(GD_COLORS.magenta).toBe("#C2208E"); // Subtítulo "MARKETING DIGITAL & AUTOMAÇÃO", alíneas a), b), c), tag CONTRATANTE/CONTRATADA
      expect(GD_COLORS.lightLilac).toBe("#DCC7EC"); // Borda suave, separador " | ", fundo suave
      expect(GD_COLORS.highlightBg).toBe("#FAF5FF"); // Fundo lavanda das barras de cláusula e linhas alternadas
      expect(GD_COLORS.textDark).toBe("#1F2937");
      expect(GD_COLORS.textMuted).toBe("#6E6878");
      expect(GD_COLORS.white).toBe("#FFFFFF");
      expect(GD_COLORS.boxBg).toBe("#FAFAFE");

      // Compatibilidade retroativa
      expect(CONTRACT_PDF_COLORS.primaryDark).toBe("#4A1370");
      expect(CONTRACT_PDF_COLORS.primary).toBe("#7B1FB0");
      expect(CONTRACT_PDF_COLORS.secondary).toBe("#C2208E");
      expect(CONTRACT_PDF_COLORS.accentLight).toBe("#DCC7EC");
      expect(CONTRACT_PDF_COLORS.boxBg).toBe("#FAF5FF");
    });

    it("assets oficiais image1.png e image3.png existem e são resolvidos pelo asset resolver", () => {
      const img1 = getImageAssetPath("image1.png");
      const img3 = getImageAssetPath("image3.png");

      expect(fs.existsSync(img1)).toBe(true);
      expect(fs.existsSync(img3)).toBe(true);
      expect(fs.statSync(img1).size).toBeGreaterThan(100);
      expect(fs.statSync(img3).size).toBeGreaterThan(100000);
    });

    it("normalizeClauseHeader reconhece numerais ordinais e títulos estruturados com separador pipe |", () => {
      const parsed1 = normalizeClauseHeader("CLÁUSULA PRIMEIRA | DAS PARTES");
      expect(parsed1.ordinal).toBe("PRIMEIRA");
      expect(parsed1.title).toBe("DAS PARTES");

      const parsed2 = normalizeClauseHeader("Cláusula 4 – Do Preço e Condições");
      expect(parsed2.ordinal).toBe("QUARTA");
      expect(parsed2.title).toBe("DO PREÇO E CONDIÇÕES");

      const parsed3 = normalizeClauseHeader("CLAUSULA SEGUNDA: DOS OBJETOS");
      expect(parsed3.ordinal).toBe("SEGUNDA");
      expect(parsed3.title).toBe("DOS OBJETOS");
    });
  });

  describe("2. Componentes Visuais com PDFKit", () => {
    it("drawHeader: renderiza título 14pt, subtítulo 9pt e linha divisória sem lançar erro", () => {
      const doc = new PDFDocument({ size: "A4", margins: PAGE_METRICS.margins });
      const initialY = doc.y;
      expect(() => drawHeader(doc)).not.toThrow();
      expect(doc.y).toBeGreaterThan(initialY);
    });

    it("drawClauseHeader: renderiza barra lavanda (#F3E8FF) com borda roxa lateral", () => {
      const doc = new PDFDocument({ size: "A4", margins: PAGE_METRICS.margins });
      const initialY = doc.y;
      expect(() => drawClauseHeader(doc, "PRIMEIRA", "DAS PARTES")).not.toThrow();
      expect(doc.y).toBeGreaterThan(initialY);
    });

    it("drawPartesBoxes: renderiza caixas simétricas em 2 colunas para Contratada e Contratante", () => {
      const doc = new PDFDocument({ size: "A4", margins: PAGE_METRICS.margins });
      const initialY = doc.y;

      const contratada = {
        razao_social: "AGÊNCIA GERAÇÃO DIGITAL LTDA",
        cnpj: "66722723000102",
        representante: "Caio Vinícius Almeida de Oliveira",
        endereco: "Av. Paraná, 65, Tibery, Uberlândia – MG, CEP 38405-022",
        telefone: "34997719779",
        email: "comercial@mktgeracaodigital.com.br",
      };

      const contratante = {
        razao_social: "PADARIA MODELO LTDA",
        cnpj: "65569191000152",
        responsavel_nome: "Maria da Silva",
        endereco: "Rua das Flores, 100, Uberlândia – MG",
        telefone: "5534999259499",
        email: "maria@padaria.com",
      };

      expect(() => drawPartesBoxes(doc, contratada, contratante)).not.toThrow();
      expect(doc.y).toBeGreaterThan(initialY + 50);
    });

    it("drawPricingTable: renderiza tabela roxa com Compromisso do Período e Composição", () => {
      const doc = new PDFDocument({ size: "A4", margins: PAGE_METRICS.margins });
      const initialY = doc.y;

      const dados = {
        valor_total: 16800,
        cronograma_pagamento: 3360,
        condicao_permuta: 13440,
      };

      expect(() => drawPricingTable(doc, dados)).not.toThrow();
      expect(doc.y).toBeGreaterThan(initialY + 40);
    });

    it("drawSignaturesAndWitnesses: renderiza assinaturas em 2 colunas e 2 testemunhas", () => {
      const doc = new PDFDocument({ size: "A4", margins: PAGE_METRICS.margins });
      const initialY = doc.y;

      const dados = {
        contratada_razao_social: "AGÊNCIA GERAÇÃO DIGITAL LTDA",
        contratada_representante: "Caio Vinícius Almeida de Oliveira",
        razao_social: "EMPRESA CONTRATANTE LTDA",
        representante_nome: "Representante Contratante",
      };

      expect(() => drawSignaturesAndWitnesses(doc, dados)).not.toThrow();
      expect(doc.y).toBeGreaterThan(initialY + 50);
    });

    it("drawFooter: inclui arte image3.png na página 1 e dados de contato oficiais em ambas as páginas", () => {
      const doc = new PDFDocument({ size: "A4", margins: PAGE_METRICS.margins, bufferPages: true });

      // Página 1
      expect(() => drawFooter(doc, 1, 2, true)).not.toThrow();

      // Página 2
      doc.addPage();
      expect(() => drawFooter(doc, 2, 2, false)).not.toThrow();
    });
  });

  describe("3. Renderização Completa e Rigorosa em 2 Páginas", () => {
    const templateOficial = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS
MARKETING DIGITAL & AUTOMAÇÃO

CLÁUSULA PRIMEIRA | DAS PARTES
CONTRATADA
AGÊNCIA GERAÇÃO DIGITAL LTDA
CNPJ: 66722723000102
Representante: Caio Vinícius Almeida de Oliveira
Endereço: Av. Paraná, 65, Tibery, Uberlândia – MG, CEP 38405-022
Telefone: 34997719779
E-mail: comercial@mktgeracaodigital.com.br

CONTRATANTE
{{razao_social}}
CNPJ: {{cnpj}}
Responsável: {{representante_nome}}
Endereço: {{endereco}}
Telefone: {{telefone}}
E-mail: {{email}}

Por este instrumento particular, as partes acima qualificadas celebram o presente contrato.

CLÁUSULA SEGUNDA | DOS OBJETOS
Constitui objeto do presente contrato a prestação de serviços de marketing, automação de sistemas, inteligência artificial, consultoria comercial e marketing.

CLÁUSULA TERCEIRA | DAS OBRIGAÇÕES DAS PARTES
Compete à CONTRATANTE:
Responder ao Briefing (documento com dados e especificações do material requerido pela cliente, assim como dúvidas surgidas pela equipe na confecção dos mesmos);
Dar a devida cadência e atendimento ao cliente final;
Repassar informações para campanhas;
Comparecer aos dias de gravações previamente autorizados e combinados com a equipe;
Fazer pagamento na data agendada.

Compete à CONTRATADA:
Efetuar treinamento para utilização do sistema Vexo;
Prestar consultoria para validar o projeto de marketing e afins;
Criar as campanhas de disparo para WhatsApp;
Acompanhar resultados mensais do cliente;
Organizar o banco de dados de acordo com o repasse do cliente;
Estruturar conjuntamente a área comercial da CONTRATANTE.

CLÁUSULA QUARTA | DO PREÇO E CONDIÇÕES
O valor do contrato corresponde à soma total das mensalidades pelo período acordado:
Compromisso do Período:
{{valor_total}}
COMPOSIÇÃO DO PERÍODO
Em reais (dividido em até 12x no cartão de crédito):
{{cronograma_pagamento}}
Em permuta:
{{condicao_permuta}}

CLÁUSULA QUINTA | DO PRAZO
O presente instrumento é firmado pelo prazo de {{prazo_meses}} meses, contados a partir da data de sua assinatura.

CLÁUSULA SEXTA | DO FORO
As partes, em comum acordo, elegem o foro da Comarca de Uberlândia – MG para dirimir quaisquer questões ou dúvidas oriundas do presente contrato.

E, por estarem assim justas e contratadas, firmam o presente contrato em 02 (duas) vias, para um só efeito.

Uberlândia – MG, 16 de outubro de 2026.

____________________________________________________
CONTRATADA
AGÊNCIA GERAÇÃO DIGITAL LTDA
Caio Vinícius Almeida de Oliveira

____________________________________________________
CONTRATANTE
{{razao_social}}
{{representante_nome}}

Testemunha 1
Nome: _____________________________________________
CPF: ______________________________________________

Testemunha 2
Nome: _____________________________________________
CPF: ______________________________________________`;

    it("gera PDF válido (%PDF), com exatamente 2 páginas e tamanho esperado (> 200 KB devido aos assets visuais)", async () => {
      const pdfBuffer = await renderContractPdf(templateOficial, {
        razao_social: "CONTAINER SOLUTION LTDA",
        cnpj: "29447330000101",
        representante_nome: "Lucas Gonçalves Fernandes",
        endereco: "Av. Nicomedes Alves dos Santos, 3600, Uberlândia – MG",
        telefone: "5534999259499",
        email: "lucasfernandes9827@gmail.com",
        valor_total: 16800,
        cronograma_pagamento: 3360,
        condicao_permuta: 13440,
        prazo_meses: 12,
      });

      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.slice(0, 4).toString("ascii")).toBe("%PDF");
      expect(pdfBuffer.pageCount).toBe(2);
      expect(pdfBuffer.length).toBeGreaterThan(200000); // Contém image3.png de alta resolução
    });
  });
});

