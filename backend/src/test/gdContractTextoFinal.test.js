import { describe, expect, it, vi } from "vitest";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { buildContractPdfBuffer } from "../domains/geracaoDigitalContracts/contractHandlers.js";

describe("buildContractPdfBuffer com texto_final editável (Leva A)", () => {
  it("renderiza texto_final diretamente quando presente, sem consultar templates", async () => {
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("FROM gd_contracts")) {
          return {
            rows: [
              {
                id: "contract-1",
                tenant_id: "tenant-1",
                dados: {
                  razao_social: "Cliente Teste Editado",
                  texto_final: "CONTRATO ESPECIAL CUSTOMIZADO\nCláusula 1 - Objeto Específico\nTexto editado à mão na tela.",
                },
              },
            ],
          };
        }
        if (sql.includes("FROM gd_contract_templates")) {
          throw new Error("Não deveria consultar templates quando texto_final existe!");
        }
        return { rows: [] };
      }),
    };

    _setPgDatabasePoolForTesting(mockPool);

    try {
      const result = await buildContractPdfBuffer("tenant-1", "contract-1");
      expect(result).toBeDefined();
      expect(result.contract.id).toBe("contract-1");
      expect(result.dados.texto_final).toContain("CONTRATO ESPECIAL CUSTOMIZADO");
      expect(Buffer.isBuffer(result.pdfData)).toBe(true);
      expect(result.pdfData.length).toBeGreaterThan(100);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });

  it("cai no fluxo normal de template quando texto_final não existe", async () => {
    let consultouTemplate = false;
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("FROM gd_contracts")) {
          return {
            rows: [
              {
                id: "contract-2",
                tenant_id: "tenant-1",
                dados: {
                  razao_social: "Cliente Segue Modelo",
                },
              },
            ],
          };
        }
        if (sql.includes("FROM gd_contract_templates")) {
          consultouTemplate = true;
          return {
            rows: [
              {
                id: "tpl-1",
                conteudo: "CONTRATO MODELO\nContratante: {{razao_social}}\nData: {{data_extenso}}",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    _setPgDatabasePoolForTesting(mockPool);

    try {
      const result = await buildContractPdfBuffer("tenant-1", "contract-2");
      expect(consultouTemplate).toBe(true);
      expect(result).toBeDefined();
      expect(Buffer.isBuffer(result.pdfData)).toBe(true);
      expect(result.pdfData.length).toBeGreaterThan(100);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });

  it("renderiza texto_final contendo negrito (**palavra**) e assinaturas personalizadas", async () => {
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("FROM gd_contracts")) {
          return {
            rows: [
              {
                id: "contract-3",
                tenant_id: "tenant-1",
                dados: {
                  razao_social: "Cafeeiro Lanches",
                  assinatura_contratada: "Geração Digital Publicidade LTDA",
                  assinatura_contratante: "Cafeeiro Lanches LTDA - Rep: Carlos",
                  texto_final: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS
Cláusula 1 - Condições Especiais
1º Pagamento: **R$ 2.400,00** à vista com **desconto de 10%**.
E, por estarem de acordo, assinam:

____________________________________________________
Contratada: Geração Digital Publicidade LTDA

____________________________________________________
Contratante: Cafeeiro Lanches LTDA - Rep: Carlos`,
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
      const result = await buildContractPdfBuffer("tenant-1", "contract-3");
      expect(result).toBeDefined();
      expect(Buffer.isBuffer(result.pdfData)).toBe(true);
      expect(result.pdfData.length).toBeGreaterThan(200);
    } finally {
      _setPgDatabasePoolForTesting(null);
    }
  });
});
