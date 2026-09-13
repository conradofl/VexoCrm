import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import {
  saveContractBuffer,
  getContractBuffer,
  buildContractStorageKey,
  CONTRACT_MAX_BYTES,
} from "../services/storage.js";
import {
  uploadSignedContract,
  downloadSignedContract,
} from "../domains/geracaoDigitalContracts/contractHandlers.js";

function createMockRes() {
  let responseStatus = 200;
  let responseBody = null;
  const headers = {};
  const res = {
    headersSent: false,
    status: vi.fn((code) => {
      responseStatus = code;
      return res;
    }),
    json: vi.fn((data) => {
      responseBody = data;
      return res;
    }),
    setHeader: vi.fn((k, v) => {
      headers[k.toLowerCase()] = v;
      return res;
    }),
    getHeader: vi.fn((k) => headers[k.toLowerCase()]),
    send: vi.fn((data) => {
      responseBody = data;
      return res;
    }),
    getStatus: () => responseStatus,
    getBody: () => responseBody,
    getHeaders: () => headers,
  };
  return res;
}

describe("Contratos Assinados: Armazenamento, Byte-a-Byte e Multi-Tenant", () => {
  const originalEnv = { ...process.env };
  const tenantA = "11111111-1111-4111-8111-111111111111";
  const tenantB = "22222222-2222-4222-8222-222222222222";
  const contractId = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("Preservação byte-a-byte: upload e download devolvem exatamente os mesmos bytes (assinatura digital gov.br)", async () => {
    // Simula um PDF com bytes binários e assinatura digital PKCS#7 embutida (gov.br)
    const header = Buffer.from("%PDF-1.7\n%âãÏÓ\n");
    const binaryData = Buffer.alloc(2048);
    for (let i = 0; i < binaryData.length; i++) {
      binaryData[i] = (i * 37 + 13) % 256;
    }
    const signatureMetadata = Buffer.from("\n/ByteRange [0 1500 1800 500]\n/Contents <308204f806092a864886f70d010702a08204e9...>\n%%EOF");
    const originalPdfBuffer = Buffer.concat([header, binaryData, signatureMetadata]);

    const timestamp = 1750000000000;

    // Salva via storage
    const saveRes = await saveContractBuffer({
      clientId: tenantA,
      contractId,
      buffer: originalPdfBuffer,
      timestamp,
    });

    expect(saveRes.storageKey).toBe(`contratos/${tenantA}/${contractId}/${timestamp}.pdf`);
    expect(saveRes.sizeBytes).toBe(originalPdfBuffer.length);

    // Recupera do storage
    const retrieved = await getContractBuffer(saveRes.storageKey);
    expect(retrieved).not.toBeNull();
    expect(retrieved.contentType).toBe("application/pdf");
    expect(retrieved.buffer.length).toBe(originalPdfBuffer.length);

    // Prova matemática: comparação byte a byte retorna 0 (idêntico)
    const diff = Buffer.compare(originalPdfBuffer, retrieved.buffer);
    expect(diff).toBe(0);

    // Agora testa o ciclo completo HTTP de download do mesmo arquivo
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("FROM public.gd_contracts WHERE id = $1 AND tenant_id = $2")) {
          return {
            rows: [
              {
                id: contractId,
                tenant_id: tenantA,
                signed_file_path: saveRes.storageKey,
                signed_file_name: "contrato_govbr_assinado.pdf",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    _setPgDatabasePoolForTesting(mockPool);

    const req = {
      params: { id: contractId },
      query: { client_id: tenantA },
      authAccess: { role: "client", clientIds: [tenantA] },
    };
    const res = createMockRes();
    await downloadSignedContract(req, res);

    expect(res.getStatus()).toBe(200);
    expect(Buffer.isBuffer(res.getBody())).toBe(true);
    expect(Buffer.compare(originalPdfBuffer, res.getBody())).toBe(0);
  });

  it("Isolamento Multi-Tenant: tentar baixar contrato de outro tenant responde 404 (NÃO 403)", async () => {
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        // Consulta do contrato escopada por tenant: WHERE id = $1 AND tenant_id = $2
        if (sql.includes("FROM public.gd_contracts WHERE id = $1 AND tenant_id = $2")) {
          const [reqContractId, reqTenantId] = params;
          if (reqContractId === contractId && reqTenantId === tenantA) {
            return {
              rows: [
                {
                  id: contractId,
                  tenant_id: tenantA,
                  signed_file_path: "contratos/tenantA/contract/123.pdf",
                  signed_file_name: "contrato-assinado-govbr.pdf",
                },
              ],
            };
          }
          // Tenant B não encontra o contrato do Tenant A
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    _setPgDatabasePoolForTesting(mockPool);

    // Requisição vinda do Tenant B para o contrato que pertence ao Tenant A
    const req = {
      params: { id: contractId },
      query: { client_id: tenantB },
      authAccess: { role: "client", clientIds: [tenantB], email: "usuario@tenantb.com" },
    };

    const res = createMockRes();

    await downloadSignedContract(req, res);

    // Deve responder 404 NOT_FOUND, e NUNCA 403
    expect(res.getStatus()).toBe(404);
    expect(res.getStatus()).not.toBe(403);
    expect(res.getBody()).toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "Contrato assinado não encontrado",
      },
    });
  });

  it("Teto de 20 MB: recusa arquivos acima de 20 MB com mensagem clara", async () => {
    // Cria buffer ligeiramente acima de 20 MB (20 MB + 1 byte)
    const tooLargeBuffer = Buffer.alloc(CONTRACT_MAX_BYTES + 1);
    tooLargeBuffer.fill("%PDF-test");

    // Teste direto na função de storage
    await expect(
      saveContractBuffer({
        clientId: tenantA,
        contractId,
        buffer: tooLargeBuffer,
      })
    ).rejects.toThrow(/excede o teto máximo permitido de 20 MB/);

    // Teste no handler HTTP
    const req = {
      params: { id: contractId },
      query: { client_id: tenantA },
      authAccess: { role: "client", clientIds: [tenantA] },
      body: tooLargeBuffer,
      headers: {},
    };

    const res = createMockRes();

    await uploadSignedContract(req, res);

    expect(res.getStatus()).toBe(400);
    expect(res.getBody()).toMatchObject({
      error: {
        code: "FILE_TOO_LARGE",
        message: expect.stringContaining("20 MB"),
      },
    });
  });

  it("Rejeição de arquivo que não seja PDF (%PDF magic bytes)", async () => {
    const nonPdfBuffer = Buffer.from("<html><body>Arquivo executável ou HTML</body></html>");

    const req = {
      params: { id: contractId },
      query: { client_id: tenantA },
      authAccess: { role: "client", clientIds: [tenantA] },
      body: nonPdfBuffer,
      headers: {},
    };

    const res = createMockRes();

    await uploadSignedContract(req, res);

    expect(res.getStatus()).toBe(400);
    expect(res.getBody()).toMatchObject({
      error: {
        code: "INVALID_FILE_TYPE",
        message: "Apenas arquivos PDF são aceitos.",
      },
    });
  });

  it("Substituição sem apagar: preserva histórico de versões em signed_file_history", async () => {
    // Estado existente: contrato já tem um arquivo V1 assinado
    const initialContract = {
      id: contractId,
      tenant_id: tenantA,
      status: "assinado",
      signed_file_path: "contratos/tenant1/c1/1000.pdf",
      signed_file_name: "versao_1.pdf",
      signed_uploaded_at: "2026-09-01T10:00:00Z",
      signed_uploaded_by: "conrado@vexo.com.br",
      signed_file_history: [],
    };

    let updatedRecord = null;

    const mockPool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("SELECT") && sql.includes("FROM public.gd_contracts")) {
          return { rows: [initialContract] };
        }
        if (sql.includes("UPDATE public.gd_contracts")) {
          // Captura o update
          const [filePath, fileName, uploadedBy, historyJson, id, tid] = params;
          updatedRecord = {
            id,
            tenant_id: tid,
            signed_file_path: filePath,
            signed_file_name: fileName,
            signed_uploaded_at: new Date().toISOString(),
            signed_uploaded_by: uploadedBy,
            signed_file_history: JSON.parse(historyJson),
            status: "assinado",
          };
          return { rows: [updatedRecord] };
        }
        return { rows: [] };
      }),
    };

    _setPgDatabasePoolForTesting(mockPool);

    const newPdfBuffer = Buffer.from("%PDF-1.7\nConteudo da nova versao 2 do contrato");

    const req = {
      params: { id: contractId },
      query: { client_id: tenantA },
      authAccess: { role: "client", clientIds: [tenantA], email: "conrado@vexo.com.br" },
      body: newPdfBuffer,
      headers: { "x-file-name": encodeURIComponent("versao_2_final.pdf") },
    };

    const res = createMockRes();

    await uploadSignedContract(req, res);

    expect(res.getStatus()).toBe(200);
    const body = res.getBody();
    expect(body.status).toBe("assinado");
    expect(body.signed_file_name).toBe("versao_2_final.pdf");
    expect(body.signed_file_path).toContain("contratos/");

    // O histórico guardou a versão 1 completa!
    expect(body.signed_file_history).toHaveLength(1);
    expect(body.signed_file_history[0]).toMatchObject({
      signed_file_path: "contratos/tenant1/c1/1000.pdf",
      signed_file_name: "versao_1.pdf",
      signed_uploaded_at: "2026-09-01T10:00:00Z",
      signed_uploaded_by: "conrado@vexo.com.br",
      archived_at: expect.any(String),
    });
  });

  it("Trava de ambiente: em produção sem credenciais R2, recusa salvar e lança erro (nunca usa disco do container)", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;

    const samplePdf = Buffer.from("%PDF-1.7 Teste Trava Producao");

    await expect(
      saveContractBuffer({
        clientId: tenantA,
        contractId: contractId,
        buffer: samplePdf,
      })
    ).rejects.toThrow(/Missing Cloudflare R2 credentials in production/);
  });
});
