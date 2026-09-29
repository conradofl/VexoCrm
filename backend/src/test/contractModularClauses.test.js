// backend/src/test/contractModularClauses.test.js
//
// Testes automatizados da Peça 3: Cláusulas em Blocos, Numeração Ordinal Dinâmica,
// Extração de Variáveis e Gestão de Modelos de Contratos.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import {
  toExtenseOrdinal,
  assembleContractFromBlocks,
  parseTemplateContentToClauses,
  extractPlaceholders,
  extractDynamicPlaceholders,
  formatFieldLabel,
} from "../domains/geracaoDigitalContracts/contractMerge.js";
import {
  listContractTemplates,
  getContractTemplate,
  createContractTemplate,
  updateContractTemplate,
  deleteContractTemplate,
} from "../domains/geracaoDigitalContracts/contractHandlers.js";

const TENANT_A = "a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab";
const TENANT_B = "b2c3d4e5-f6a7-4b8c-9d0e-123456789abc";

describe("Peça 3 — Cláusulas Modulares em Blocos e Modelos de Contratos", () => {
  describe("1. Numeração Ordinal Dinâmica por Extenso", () => {
    it("converte índices 1-based corretamente para ordinais por extenso", () => {
      expect(toExtenseOrdinal(1)).toBe("Primeira");
      expect(toExtenseOrdinal(2)).toBe("Segunda");
      expect(toExtenseOrdinal(3)).toBe("Terceira");
      expect(toExtenseOrdinal(4)).toBe("Quarta");
      expect(toExtenseOrdinal(5)).toBe("Quinta");
      expect(toExtenseOrdinal(6)).toBe("Sexta");
      expect(toExtenseOrdinal(7)).toBe("Sétima");
      expect(toExtenseOrdinal(8)).toBe("Oitava");
      expect(toExtenseOrdinal(9)).toBe("Nona");
      expect(toExtenseOrdinal(10)).toBe("Décima");
      expect(toExtenseOrdinal(11)).toBe("Décima Primeira");
      expect(toExtenseOrdinal(20)).toBe("Vigésima");
      expect(toExtenseOrdinal(21)).toBe("Vigésima Primeira");
      expect(toExtenseOrdinal(30)).toBe("Trigésima");
      expect(toExtenseOrdinal(35)).toBe("35ª");
    });

    it("desativação de cláusula intermediária recalcula numeração ordinal sem deixar buracos", () => {
      const clausulas = [
        { id: "c1", titulo: "Das Partes", conteudo: "Texto partes", ativo: true },
        { id: "c2", titulo: "Dos Objetos", conteudo: "Texto objetos", ativo: true },
        { id: "c3", titulo: "Da Plataforma Vexo OS", conteudo: "Texto plataforma", ativo: false }, // DESATIVADA
        { id: "c4", titulo: "Das Obrigações", conteudo: "Texto obrigações", ativo: true },
        { id: "c5", titulo: "Do Preço", conteudo: "Texto preço", ativo: true },
        { id: "c6", titulo: "Do Foro", conteudo: "Texto foro", ativo: true },
      ];

      const assembled = assembleContractFromBlocks({
        tituloPrincipal: "CONTRATO DE SERVIÇOS",
        clausulas,
        fechamento: "Uberlândia, data.",
      });

      expect(assembled).toContain("Cláusula Primeira – Das Partes");
      expect(assembled).toContain("Cláusula Segunda – Dos Objetos");
      // Cláusula 3 foi desativada, então Cláusula 4 vira Terceira
      expect(assembled).toContain("Cláusula Terceira – Das Obrigações");
      expect(assembled).toContain("Cláusula Quarta – Do Preço");
      expect(assembled).toContain("Cláusula Quinta – Do Foro");

      // Não deve haver menção a Cláusula Sexta nem ao texto da Vexo OS
      expect(assembled).not.toContain("Da Plataforma Vexo OS");
      expect(assembled).not.toContain("Cláusula Sexta");
      expect(assembled).not.toContain("Texto plataforma");
    });

    it("reordenação de cláusulas atualiza a ordem e os ordinais instantaneamente", () => {
      const clausulas = [
        { id: "c2", titulo: "Dos Objetos", conteudo: "Texto objetos", ativo: true },
        { id: "c1", titulo: "Das Partes", conteudo: "Texto partes", ativo: true },
      ];

      const assembled = assembleContractFromBlocks({ clausulas });
      expect(assembled).toContain("Cláusula Primeira – Dos Objetos");
      expect(assembled).toContain("Cláusula Segunda – Das Partes");
    });
  });

  describe("2. Decomposição de Template Legado e Recomposição", () => {
    const legacyTemplate = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE MARKETING DIGITAL E PUBLICIDADE EM GERAL

Cláusula Primeira - Das Partes
Por instrumento particular, de um lado {{contratada_razao_social}} e de outro {{razao_social}}.

Cláusula Segunda - Dos Objetos
{{produtos}}

Cláusula Terceira - Da Plataforma Vexo OS
Acesso à plataforma Vexo OS durante a vigência.

Cláusula Quarta - Das Obrigações das Partes
Criação de até {{artes_mensais}} artes mensais.

Cláusula Quinta – Do Preço e Condições
O pagamento será {{forma_pagamento}}.
{{cronograma_pagamento}}

Cláusula Sexta - Do Prazo
O presente instrumento vigora por {{prazo_dias}} dias.

Cláusula Sétima – Do Foro
Foro da Comarca de {{foro_cidade}}.

E, por estarem assim justas e contratadas, firmam o presente contrato em 02 vias.

{{cidade_assinatura}}, {{data_extenso}}`;

    it("parseTemplateContentToClauses decompõe perfeitamente cabeçalho, cláusulas e fechamento", () => {
      const parsed = parseTemplateContentToClauses(legacyTemplate);

      expect(parsed.tituloPrincipal).toBe("CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE MARKETING DIGITAL E PUBLICIDADE EM GERAL");
      expect(parsed.clausulas).toHaveLength(7);
      expect(parsed.fechamento).toContain("E, por estarem assim justas e contratadas");
      expect(parsed.fechamento).toContain("{{data_extenso}}");

      // Cláusula 1: Das Partes (obrigatória)
      expect(parsed.clausulas[0].titulo).toBe("Das Partes");
      expect(parsed.clausulas[0].obrigatorio).toBe(true);
      expect(parsed.clausulas[0].conteudo).toContain("{{razao_social}}");

      // Cláusula 3: Da Plataforma Vexo OS
      expect(parsed.clausulas[2].titulo).toBe("Da Plataforma Vexo OS");
      expect(parsed.clausulas[2].conteudo).toContain("Vexo OS");

      // Cláusula 7: Do Foro
      expect(parsed.clausulas[6].titulo).toBe("Do Foro");
      expect(parsed.clausulas[6].conteudo).toContain("{{foro_cidade}}");
    });

    it("recompõe contrato legado mantendo integridade com assembleContractFromBlocks", () => {
      const parsed = parseTemplateContentToClauses(legacyTemplate);
      const reassembled = assembleContractFromBlocks(parsed);

      expect(reassembled).toContain("CONTRATO DE PRESTAÇÃO DE SERVIÇOS");
      expect(reassembled).toContain("Cláusula Primeira – Das Partes");
      expect(reassembled).toContain("Cláusula Sétima – Do Foro");
      expect(reassembled).toContain("E, por estarem assim justas e contratadas");
    });
  });

  describe("3. Extração Dinâmica de Marcadores (Placeholders)", () => {
    it("extractPlaceholders extrai marcadores de cláusulas ativas e ignora inativas", () => {
      const clausulas = [
        { id: "c1", titulo: "Partes", conteudo: "{{razao_social}} e {{cnpj}}", ativo: true },
        { id: "c2", titulo: "Objeto Solar", conteudo: "Potência: {{potencia_kwp}}, Área: {{area_m2}}", ativo: true },
        { id: "c3", titulo: "Inativo", conteudo: "{{variavel_inativa}}", ativo: false },
      ];

      const placeholders = extractPlaceholders(clausulas);
      expect(placeholders).toContain("razao_social");
      expect(placeholders).toContain("cnpj");
      expect(placeholders).toContain("potencia_kwp");
      expect(placeholders).toContain("area_m2");
      expect(placeholders).not.toContain("variavel_inativa");
    });

    it("extractDynamicPlaceholders separa campos padrão/sistema de variáveis dinâmicas customizadas", () => {
      const clausulas = [
        {
          id: "c1",
          titulo: "Mista",
          conteudo: "{{razao_social}} contrata {{potencia_kwp}} com {{cro_responsavel}} e {{data_extenso}}",
          ativo: true,
        },
      ];

      const dynamics = extractDynamicPlaceholders(clausulas);
      // Campos padrão (razao_social) e sistema (data_extenso) não entram
      expect(dynamics).not.toContain("razao_social");
      expect(dynamics).not.toContain("data_extenso");

      // Variáveis dinâmicas específicas do segmento entram
      expect(dynamics).toContain("potencia_kwp");
      expect(dynamics).toContain("cro_responsavel");
    });

    it("formatFieldLabel formata rótulos legíveis para a interface", () => {
      expect(formatFieldLabel("potencia_kwp")).toBe("Potencia Kwp");
      expect(formatFieldLabel("area_m2")).toBe("Area M2");
      expect(formatFieldLabel("cro_responsavel")).toBe("Cro Responsavel");
    });
  });

  describe("4. CRUD de Templates no Backend com Multi-Tenant Isolation", () => {
    let mockTemplates;
    let mockPool;

    beforeEach(() => {
      mockTemplates = [
        {
          id: "tpl-a1",
          tenant_id: TENANT_A,
          nome: "Modelo Marketing Digital A",
          conteudo: "Texto template A",
          clausulas: [{ id: "c1", titulo: "Partes", conteudo: "{{razao_social}}", ativo: true }],
          ativo: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "tpl-b1",
          tenant_id: TENANT_B,
          nome: "Modelo Energia Solar B",
          conteudo: "Texto template B",
          clausulas: [{ id: "cb1", titulo: "Solar", conteudo: "{{potencia_kwp}}", ativo: true }],
          ativo: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      mockPool = {
        query: vi.fn(async (sql, params = []) => {
          const text = sql.trim();

          // 1. SELECT list
          if (text.includes("SELECT") && text.includes("FROM gd_contract_templates") && text.includes("WHERE tenant_id = $1 AND ativo = true")) {
            const tenantId = params[0];
            const rows = mockTemplates.filter((t) => t.tenant_id === tenantId && t.ativo);
            return { rows };
          }

          // 2. SELECT single by id
          if (text.includes("SELECT") && text.includes("FROM gd_contract_templates") && text.includes("WHERE id = $1 AND tenant_id = $2")) {
            const [id, tenantId] = params;
            const rows = mockTemplates.filter((t) => t.id === id && t.tenant_id === tenantId);
            return { rows };
          }

          // 3. INSERT template
          if (text.startsWith("INSERT INTO gd_contract_templates")) {
            const [tenantId, nome, conteudo, clausulasJson, ativo] = params;
            const newTpl = {
              id: `tpl-${Date.now()}`,
              tenant_id: tenantId,
              nome,
              conteudo,
              clausulas: JSON.parse(clausulasJson || "[]"),
              ativo: ativo !== false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            mockTemplates.push(newTpl);
            return { rows: [newTpl] };
          }

          // 4. UPDATE template
          if (text.startsWith("UPDATE gd_contract_templates") && text.includes("SET nome =")) {
            const [nome, conteudo, clausulasJson, ativo, id, tenantId] = params;
            const item = mockTemplates.find((t) => t.id === id && t.tenant_id === tenantId);
            if (!item) return { rows: [] };
            if (nome !== null) item.nome = nome;
            if (conteudo !== null) item.conteudo = conteudo;
            if (clausulasJson !== null) item.clausulas = JSON.parse(clausulasJson);
            if (ativo !== null) item.ativo = ativo;
            item.updated_at = new Date().toISOString();
            return { rows: [item] };
          }

          // 5. DELETE template (soft delete)
          if (text.startsWith("UPDATE gd_contract_templates") && text.includes("SET ativo = false")) {
            const [id, tenantId] = params;
            const item = mockTemplates.find((t) => t.id === id && t.tenant_id === tenantId);
            if (!item) return { rows: [] };
            item.ativo = false;
            return { rows: [{ id: item.id }] };
          }

          return { rows: [] };
        }),
      };

      _setPgDatabasePoolForTesting(mockPool);
    });

    function makeMockRes() {
      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.body = data;
          return this;
        },
      };
      return res;
    }

    it("listContractTemplates: lista apenas os templates do tenant autenticado", async () => {
      const reqA = { query: { client_id: TENANT_A }, authAccess: { role: "internal", isAdmin: true, clientId: TENANT_A, clientIds: [TENANT_A] } };
      const resA = makeMockRes();

      await listContractTemplates(reqA, resA);
      expect(resA.body).toHaveLength(1);
      expect(resA.body[0].nome).toBe("Modelo Marketing Digital A");
      expect(resA.body[0].tenant_id).toBe(TENANT_A);
    });

    it("createContractTemplate: cria modelo com clausulas JSON estruturadas", async () => {
      const req = {
        body: {
          client_id: TENANT_A,
          nome: "Novo Modelo Odontologia",
          clausulas: [
            { id: "c1", titulo: "Partes", conteudo: "{{razao_social}}", ativo: true },
            { id: "c2", titulo: "Procedimento", conteudo: "CRO: {{cro_doutor}}", ativo: true },
          ],
        },
        authAccess: { role: "internal", isAdmin: true, clientId: TENANT_A, clientIds: [TENANT_A] },
      };
      const res = makeMockRes();

      await createContractTemplate(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.body.nome).toBe("Novo Modelo Odontologia");
      expect(res.body.clausulas).toHaveLength(2);
      expect(res.body.clausulas[1].titulo).toBe("Procedimento");
    });

    it("updateContractTemplate: atualiza clausulas e nome garantindo isolamento", async () => {
      const req = {
        params: { id: "tpl-a1" },
        body: {
          client_id: TENANT_A,
          nome: "Modelo Marketing Atualizado",
          clausulas: [
            { id: "c1", titulo: "Partes", conteudo: "{{razao_social}}", ativo: true },
            { id: "c2", titulo: "Entrega Vídeos", conteudo: "Até 8 vídeos", ativo: true },
          ],
        },
        authAccess: { role: "internal", isAdmin: true, clientId: TENANT_A, clientIds: [TENANT_A] },
      };
      const res = makeMockRes();

      await updateContractTemplate(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.nome).toBe("Modelo Marketing Atualizado");
      expect(res.body.clausulas).toHaveLength(2);
    });

    it("deleteContractTemplate: exclusão lógica (ativo = false) e bloqueio cross-tenant", async () => {
      // Tenant B tentando deletar template do Tenant A
      const reqInvasor = {
        params: { id: "tpl-a1" },
        body: { client_id: TENANT_B },
        authAccess: { role: "internal", isAdmin: true, clientId: TENANT_B, clientIds: [TENANT_B] },
      };
      const resInvasor = makeMockRes();

      await deleteContractTemplate(reqInvasor, resInvasor);
      expect(resInvasor.statusCode).toBe(404);

      // Template A continua ativo
      const tplA = mockTemplates.find((t) => t.id === "tpl-a1");
      expect(tplA.ativo).toBe(true);

      // Tenant A deletando seu próprio template
      const reqLegitimo = {
        params: { id: "tpl-a1" },
        body: { client_id: TENANT_A },
        authAccess: { role: "internal", isAdmin: true, clientId: TENANT_A, clientIds: [TENANT_A] },
      };
      const resLegitimo = makeMockRes();

      await deleteContractTemplate(reqLegitimo, resLegitimo);
      expect(resLegitimo.statusCode).toBe(200);
      expect(tplA.ativo).toBe(false);
    });
  });
});
