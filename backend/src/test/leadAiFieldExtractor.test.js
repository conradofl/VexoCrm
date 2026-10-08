// backend/src/test/leadAiFieldExtractor.test.js
// Pilar 4: Agente que Preenche a Ficha do Lead (Extração Semântica da Conversa para Campos Customizados)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import {
  extractCommercialProfileFromChat,
  syncExtractedFieldsToLead,
  sanitizeExtractedCommercialProfile,
  normalizeChatMessages,
  parseJsonSafely,
  COMMERCIAL_FIELD_LABELS,
} from "../services/leadAiFieldExtractor.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS public.leads (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    telefone TEXT,
    phone TEXT,
    nome TEXT,
    dados JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.lead_custom_fields (
    id TEXT PRIMARY KEY DEFAULT 'cf_' || substr(md5(random()::text), 1, 8),
    client_id TEXT NOT NULL,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_lead_custom_fields_client_key UNIQUE (client_id, key)
  );
`;

describe("Pilar 4: Agente que Preenche a Ficha do Lead (Extração Semântica da Conversa)", () => {
  describe("Funções puras e sanitização de extração", () => {
    it("normalizeChatMessages lida com múltiplos formatos de mensagens", () => {
      const messages = [
        "Olá, gostaria de saber mais",
        { role: "assistant", content: "Claro! Como posso te ajudar?" },
        { sender: "Lead", text: "Tenho uma transportadora e busco caminhão" },
        { mensagem: "Qual a faixa de valor?" },
        null,
        "",
      ];
      const normalized = normalizeChatMessages(messages);
      expect(normalized).toHaveLength(4);
      expect(normalized[0]).toBe("Olá, gostaria de saber mais");
      expect(normalized[1]).toBe("Consultor: Claro! Como posso te ajudar?");
      expect(normalized[2]).toBe("Lead: Tenho uma transportadora e busco caminhão");
      expect(normalized[3]).toBe("Qual a faixa de valor?");
    });

    it("parseJsonSafely extrai JSON de texto puro e de blocos markdown", () => {
      const plain = '{"interesse": "Consórcio Imobiliário", "faixa_valor": "R$ 500k"}';
      expect(parseJsonSafely(plain)).toEqual({
        interesse: "Consórcio Imobiliário",
        faixa_valor: "R$ 500k",
      });

      const markdown = 'Aqui está a extração:\n```json\n{"tipo_negocio": "Advocacia"}\n```\nObrigado!';
      expect(parseJsonSafely(markdown)).toEqual({
        tipo_negocio: "Advocacia",
      });

      const mixed = 'Texto antes {"cidade_regiao": "Uberlândia - MG"} texto depois';
      expect(parseJsonSafely(mixed)).toEqual({
        cidade_regiao: "Uberlândia - MG",
      });
    });

    it("sanitizeExtractedCommercialProfile descarta 'não informado', nulos e alucinações vazias", () => {
      const raw = {
        interesse: "Consórcio Imobiliário",
        faixa_valor: "não falou",
        tipo_negocio: "Transportadora",
        cidade_regiao: "null",
        urgencia: "alta",
        campo_inexistente: "ignorar",
      };

      const sanitized = sanitizeExtractedCommercialProfile(raw);
      expect(sanitized).toEqual({
        interesse: "Consórcio Imobiliário",
        tipo_negocio: "Transportadora",
        urgencia: "alta",
      });
      expect(sanitized).not.toHaveProperty("faixa_valor");
      expect(sanitized).not.toHaveProperty("cidade_regiao");
      expect(sanitized).not.toHaveProperty("campo_inexistente");
    });
  });

  describe("extractCommercialProfileFromChat com simulação de conversa", () => {
    it("extrai perfil comercial completo com alta confiança", async () => {
      const mockLlm = {
        interesse: "Consórcio Imobiliário",
        faixa_valor: "R$ 500k a 1M",
        tipo_negocio: "Clínica Odontológica",
        cidade_regiao: "Uberlândia - MG",
        urgencia: "alta",
      };

      const result = await extractCommercialProfileFromChat({
        messages: [
          "Oi, procuro um consórcio imobiliário para comprar a sede da minha clínica odontológica em Uberlândia.",
          "Legal! Qual a faixa de valor que você planeja investir?",
          "Entre 500 mil e 1 milhão. Precisamos definir isso com urgência.",
        ],
        leadName: "Dra. Renata",
        mockLlmResponse: mockLlm,
      });

      expect(result).toEqual({
        interesse: "Consórcio Imobiliário",
        faixa_valor: "R$ 500k a 1M",
        tipo_negocio: "Clínica Odontológica",
        cidade_regiao: "Uberlândia - MG",
        urgencia: "alta",
      });
    });

    it("NUNCA alucina faixa_valor quando o cliente não mencionou dinheiro", async () => {
      const mockLlm = {
        interesse: "Permuta de Mídia",
        faixa_valor: null, // Lead não falou de valores
        tipo_negocio: "Agência de Marketing",
        cidade_regiao: "São Paulo - SP",
        urgencia: "media",
      };

      const result = await extractCommercialProfileFromChat({
        messages: [
          "Olá, temos interesse em anunciar na rádio através de permuta.",
          "Somos uma agência aqui de SP.",
        ],
        leadName: "Carlos",
        mockLlmResponse: mockLlm,
      });

      expect(result.interesse).toBe("Permuta de Mídia");
      expect(result.tipo_negocio).toBe("Agência de Marketing");
      expect(result.cidade_regiao).toBe("São Paulo - SP");
      expect(result.faixa_valor).toBeUndefined(); // não foi alucinado
    });

    it("retorna objeto vazio se a conversa for puramente vazia", async () => {
      const result = await extractCommercialProfileFromChat({
        messages: [],
      });
      expect(result).toEqual({});
    });
  });

  describe("syncExtractedFieldsToLead em Postgres Real (pglite)", () => {
    let db;
    const TENANT_A = "tenant_ademicon";
    const TENANT_B = "tenant_viapermuta";

    beforeEach(async () => {
      db = await createPgliteDb(SCHEMA);

      // Lead 1: Tenant A, já possui um campo importado previamente
      await db.query(
        `INSERT INTO public.leads (id, client_id, telefone, phone, nome, dados)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          "lead-1",
          TENANT_A,
          "34999990001",
          "34999990001",
          "João Silva",
          JSON.stringify({
            campos: {
              renda_mensal: "R$ 15.000",
            },
          }),
        ]
      );

      // Lead 2: Tenant B (para teste de isolamento)
      await db.query(
        `INSERT INTO public.leads (id, client_id, telefone, phone, nome, dados)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          "lead-2",
          TENANT_B,
          "11988880002",
          "11988880002",
          "Marina Souza",
          JSON.stringify({}),
        ]
      );
    });

    afterEach(async () => {
      if (db) await db.close();
    });

    it("1. realiza merge atômico em dados.campos sem apagar campos pré-existentes", async () => {
      const extracted = {
        interesse: "Consórcio Imobiliário",
        faixa_valor: "R$ 500k",
        tipo_negocio: "Transportadora",
      };

      const res = await syncExtractedFieldsToLead(db, {
        leadId: "lead-1",
        clientId: TENANT_A,
        extractedFields: extracted,
      });

      expect(res.success).toBe(true);
      expect(res.updated).toBe(true);

      // Verifica no banco
      const { rows } = await db.query("SELECT dados FROM public.leads WHERE id = 'lead-1'");
      const dadosSalvos = rows[0].dados;

      // Campo anterior sobreviveu
      expect(dadosSalvos.campos.renda_mensal).toBe("R$ 15.000");
      // Novos campos inseridos pela IA
      expect(dadosSalvos.campos.interesse).toBe("Consórcio Imobiliário");
      expect(dadosSalvos.campos.faixa_valor).toBe("R$ 500k");
      expect(dadosSalvos.campos.tipo_negocio).toBe("Transportadora");

      // Marcação de procedência da IA gravada
      expect(dadosSalvos.ai_extracted_fields).toContain("interesse");
      expect(dadosSalvos.ai_extracted_fields).toContain("faixa_valor");
      expect(dadosSalvos.ai_extracted_fields).toContain("tipo_negocio");
      expect(dadosSalvos.ai_extracted_fields).not.toContain("renda_mensal");
    });

    it("2. auto-registra chaves em lead_custom_fields do tenant com rótulos amigáveis", async () => {
      await syncExtractedFieldsToLead(db, {
        leadId: "lead-1",
        clientId: TENANT_A,
        extractedFields: {
          interesse: "Consórcio Pesado",
          cidade_regiao: "Uberlândia - MG",
        },
      });

      const { rows: customFields } = await db.query(
        "SELECT key, label, type, client_id FROM public.lead_custom_fields WHERE client_id = $1 ORDER BY key",
        [TENANT_A]
      );

      expect(customFields).toHaveLength(2);
      expect(customFields[0]).toEqual({
        key: "cidade_regiao",
        label: "Cidade / Região",
        type: "text",
        client_id: TENANT_A,
      });
      expect(customFields[1]).toEqual({
        key: "interesse",
        label: "Interesse",
        type: "text",
        client_id: TENANT_A,
      });
    });

    it("3. PRESERVA campos manuais: operador humano tem prioridade e a IA não sobrescreve", async () => {
      // Configura lead com campo editado manualmente por vendedor
      await db.query(
        `UPDATE public.leads 
         SET dados = $1 
         WHERE id = 'lead-1'`,
        [
          JSON.stringify({
            campos: {
              faixa_valor: "R$ 1.500.000 (Validação Manual pelo Vendedor)",
            },
            manual_fields: ["faixa_valor"], // Protegido contra IA
          }),
        ]
      );

      // Robô de IA tenta extrair valor diferente da conversa
      const res = await syncExtractedFieldsToLead(db, {
        leadId: "lead-1",
        clientId: TENANT_A,
        extractedFields: {
          interesse: "Consórcio Agro",
          faixa_valor: "R$ 800k (Palpite da IA)",
        },
      });

      expect(res.success).toBe(true);

      const { rows } = await db.query("SELECT dados FROM public.leads WHERE id = 'lead-1'");
      const dados = rows[0].dados;

      // faixa_valor NÃO foi alterado pela IA
      expect(dados.campos.faixa_valor).toBe("R$ 1.500.000 (Validação Manual pelo Vendedor)");
      // interesse (que não era manual) foi atualizado normalmente
      expect(dados.campos.interesse).toBe("Consórcio Agro");
      expect(dados.ai_extracted_fields).toContain("interesse");
      expect(dados.ai_extracted_fields).not.toContain("faixa_valor");
    });

    it("4. Isolamento Multi-Tenant estrito: Tenant A não acessa nem altera lead do Tenant B", async () => {
      const res = await syncExtractedFieldsToLead(db, {
        leadId: "lead-2", // Pertence ao Tenant B
        clientId: TENANT_A, // Requisição feita pelo Tenant A
        extractedFields: {
          interesse: "Invasão Tenant",
        },
      });

      expect(res.success).toBe(false);
      expect(res.reason).toBe("LEAD_NOT_FOUND");

      // Garante que o lead do Tenant B permanece intocado
      const { rows } = await db.query("SELECT dados FROM public.leads WHERE id = 'lead-2'");
      expect(rows[0].dados).toEqual({});
    });
  });
});
