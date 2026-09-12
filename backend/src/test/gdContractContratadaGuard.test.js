import { describe, expect, it, vi } from "vitest";
import zlib from "zlib";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { buildContractPdfBuffer } from "../domains/geracaoDigitalContracts/contractHandlers.js";
import { getJuridicoSettings, saveJuridicoSettings } from "../domains/geracaoDigitalContracts/juridicoHandlers.js";

function extractPdfText(pdfBuffer) {
  let raw = "";
  const bufStr = pdfBuffer.toString("binary");
  const regex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = regex.exec(bufStr)) !== null) {
    try {
      const decompressed = zlib.inflateSync(Buffer.from(match[1], "binary")).toString("latin1");
      raw += decompressed + "\n";
    } catch {
      raw += match[1] + "\n";
    }
  }

  // Extrai texto real dos blocos TJ (arrays de hex com ajustes numéricos de kerning)
  let extracted = "";
  raw.replace(/\[([\s\S]*?)\]\s*TJ/g, (_, tjContent) => {
    let blockText = "";
    const hexRegex = /<([0-9a-fA-F]+)>/g;
    let m;
    while ((m = hexRegex.exec(tjContent)) !== null) {
      blockText += Buffer.from(m[1], "hex").toString("latin1");
    }
    extracted += blockText + "\n";
  });

  const decodedRaw = raw.replace(/<([0-9a-fA-F]+)>/g, (_, hex) => {
    return Buffer.from(hex, "hex").toString("latin1");
  });

  return `${extracted}\n${decodedRaw}`;
}

describe("Guard Test Multi-Tenant: Isolamento de Dados da Contratada (Peça 1)", () => {
  it("GUARD: um tenant sem configuração de contratada NUNCA produz PDF com CNPJ 66.722.723/0001-02 nem nome fixo", async () => {
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        // Leitura de tenant_modules: sem configuração de contratada
        if (sql.includes("FROM public.tenant_modules")) {
          return { rows: [{ config: {} }] };
        }
        // Leitura do contrato
        if (sql.includes("FROM gd_contracts")) {
          return {
            rows: [
              {
                id: "contract-unconfigured",
                tenant_id: "tenant-sonhare",
                dados: {
                  razao_social: "Cliente Teste Sem Config",
                },
              },
            ],
          };
        }
        // Leitura do template (com marcadores novos)
        if (sql.includes("FROM gd_contract_templates")) {
          return {
            rows: [
              {
                id: "tpl-1",
                conteudo: "CONTRATO\nContratada: {{contratada_razao_social}}, CNPJ: {{contratada_cnpj}}\nContratante: {{razao_social}}",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    _setPgDatabasePoolForTesting(mockPool);

    try {
      const result = await buildContractPdfBuffer("tenant-sonhare", "contract-unconfigured");
      expect(result).toBeDefined();
      expect(Buffer.isBuffer(result.pdfData)).toBe(true);

      // Conversão do buffer em string para verificar que NUNCA há vazamento de dados de outro tenant
      const pdfText = extractPdfText(result.pdfData);
      expect(pdfText).toContain("Cliente Teste Sem Config");
      expect(pdfText).not.toContain("66.722.723/0001-02");
      expect(pdfText).not.toContain("40.508.817/0001-90");
      expect(pdfText).not.toContain("CAIO VINÍCIUS ALMEIDA DE OLIVEIRA");
      expect(pdfText).not.toContain("AGÊNCIA GERAÇÃO DIGITAL LTDA");

      // Verifica que no objeto dados enriquecido os campos estão vazios por padrão
      expect(result.dados.contratada_cnpj).toBe("");
      expect(result.dados.contratada_razao_social).toBe("");
      expect(result.dados.assinatura_contratada).toBe("");
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });

  it("renderiza PDF com os dados configurados quando o tenant possui configuração salva", async () => {
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("FROM public.tenant_modules")) {
          return {
            rows: [
              {
                config: {
                  contratada: {
                    razao_social: "EMPRESA MINHA LTDA",
                    cnpj: "12.345.678/0001-99",
                    representante: "Fulano de Tal",
                    endereco: "Rua Teste, 100",
                    telefone: "(34) 98888-7777",
                    email: "contato@minhaempresa.com",
                    comarca: "Belo Horizonte-MG",
                    assinatura: "EMPRESA MINHA LTDA",
                  },
                },
              },
            ],
          };
        }
        if (sql.includes("FROM gd_contracts")) {
          return {
            rows: [
              {
                id: "contract-configured",
                tenant_id: "tenant-minha-empresa",
                dados: {
                  razao_social: "Cliente do Tenant",
                },
              },
            ],
          };
        }
        if (sql.includes("FROM gd_contract_templates")) {
          return {
            rows: [
              {
                id: "tpl-1",
                conteudo: "CONTRATO\nContratada: {{contratada_razao_social}}, CNPJ: {{contratada_cnpj}}, Comarca: {{contratada_comarca}}\nContratante: {{razao_social}}",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    _setPgDatabasePoolForTesting(mockPool);

    try {
      const result = await buildContractPdfBuffer("tenant-minha-empresa", "contract-configured");
      expect(result).toBeDefined();
      expect(result.dados.contratada_razao_social).toBe("EMPRESA MINHA LTDA");
      expect(result.dados.contratada_cnpj).toBe("12.345.678/0001-99");
      expect(result.dados.contratada_comarca).toBe("Belo Horizonte-MG");

      const pdfText = extractPdfText(result.pdfData);
      expect(pdfText).toContain("12.345.678/0001-99");
      expect(pdfText).not.toContain("66.722.723/0001-02");
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });

  it("sobrescrita por contrato tem precedência sobre a configuração do tenant", async () => {
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("FROM public.tenant_modules")) {
          return {
            rows: [
              {
                config: {
                  contratada: {
                    razao_social: "EMPRESA PADRAO LTDA",
                    cnpj: "11.111.111/0001-11",
                  },
                },
              },
            ],
          };
        }
        if (sql.includes("FROM gd_contracts")) {
          return {
            rows: [
              {
                id: "contract-override",
                tenant_id: "tenant-1",
                dados: {
                  razao_social: "Cliente XPTO",
                  contratada_razao_social: "OUTRA PESSOA JURIDICA LTDA",
                  contratada_cnpj: "22.222.222/0001-22",
                },
              },
            ],
          };
        }
        if (sql.includes("FROM gd_contract_templates")) {
          return {
            rows: [
              {
                id: "tpl-1",
                conteudo: "CONTRATO\nContratada: {{contratada_razao_social}}, CNPJ: {{contratada_cnpj}}",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    _setPgDatabasePoolForTesting(mockPool);

    try {
      const result = await buildContractPdfBuffer("tenant-1", "contract-override");
      expect(result.dados.contratada_razao_social).toBe("OUTRA PESSOA JURIDICA LTDA");
      expect(result.dados.contratada_cnpj).toBe("22.222.222/0001-22");

      const pdfText = extractPdfText(result.pdfData);
      expect(pdfText).toContain("22.222.222/0001-22");
      expect(pdfText).not.toContain("11.111.111/0001-11");
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });

  it("injeta dados da contratada mesmo quando o contrato utiliza texto_final editado", async () => {
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("FROM public.tenant_modules")) {
          return {
            rows: [
              {
                config: {
                  contratada: {
                    razao_social: "AGÊNCIA TESTE",
                    cnpj: "99.999.999/0001-99",
                  },
                },
              },
            ],
          };
        }
        if (sql.includes("FROM gd_contracts")) {
          return {
            rows: [
              {
                id: "contract-text-final",
                tenant_id: "tenant-1",
                dados: {
                  texto_final: "TEXTO EDITADO NA TELA\nContratada: {{contratada_razao_social}} - {{contratada_cnpj}}",
                },
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    _setPgDatabasePoolForTesting(mockPool);

    try {
      const result = await buildContractPdfBuffer("tenant-1", "contract-text-final");
      expect(result.dados.contratada_cnpj).toBe("99.999.999/0001-99");
      const pdfText = extractPdfText(result.pdfData);
      expect(pdfText).toContain("99.999.999/0001-99");
      expect(pdfText).not.toContain("{{contratada_cnpj}}");
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });
});
