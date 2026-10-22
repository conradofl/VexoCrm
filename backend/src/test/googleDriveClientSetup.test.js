import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  setupClientDriveFolders,
  DRIVE_SUBFOLDERS,
  getGoogleDriveAccessToken,
} from "../services/googleDriveClientSetup.js";

describe("Google Drive Client Setup Service", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("deve rejeitar se clientName não for informado", async () => {
    await expect(setupClientDriveFolders({ clientName: "" })).rejects.toThrow(
      "clientName é obrigatório"
    );
  });

  it("deve gerar estrutura simulada com 4 subpastas quando em modo mock", async () => {
    const res = await setupClientDriveFolders({
      clientName: "Espaço Laser Estética",
      allowMockFallback: true,
    });

    expect(res.success).toBe(true);
    expect(res.isMock).toBe(true);
    expect(res.clientName).toBe("Espaço Laser Estética");
    expect(res.drive_folder_id).toMatch(/^mock_drive_/);
    expect(res.driveLink).toContain(res.drive_folder_id);

    // Verifica que as 4 subpastas padrão existem
    expect(res.subfolders).toHaveProperty("identidade");
    expect(res.subfolders).toHaveProperty("brutos");
    expect(res.subfolders).toHaveProperty("criativos");
    expect(res.subfolders).toHaveProperty("relatorios");

    expect(res.subfolders.identidade.name).toBe("01_Identidade_e_Logos");
    expect(res.subfolders.brutos.name).toBe("02_Fotos_e_Videos_Brutos");
    expect(res.subfolders.criativos.name).toBe("03_Criativos_Finalizados");
    expect(res.subfolders.relatorios.name).toBe("04_Relatorios");
  });

  it("deve lançar erro se allowMockFallback=false e não houver credenciais", async () => {
    await expect(
      setupClientDriveFolders({
        clientName: "Cliente Teste",
        allowMockFallback: false,
      })
    ).rejects.toThrow("Nenhuma credencial do Google Drive configurada");
  });

  it("deve criar pastas via API do Google Drive quando houver access token", async () => {
    process.env.GOOGLE_DRIVE_ACCESS_TOKEN = "ya29.test-mock-token";

    let folderCallCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url, opts) => {
      if (url.includes("/drive/v3/files?supportsAllDrives=true")) {
        folderCallCount++;
        const body = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: `folder_id_${folderCallCount}_${body.name}` }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    vi.stubGlobal("fetch", fetchMock);

    const res = await setupClientDriveFolders({
      clientName: "Restaurante Bom Sabor",
      parentFolderId: "parent_123",
      makePublic: true,
      allowMockFallback: false,
    });

    expect(res.success).toBe(true);
    expect(res.isMock).toBe(false);
    expect(res.clientName).toBe("Restaurante Bom Sabor");
    expect(res.drive_folder_id).toBe("folder_id_1_Restaurante Bom Sabor");
    expect(res.driveLink).toBe("https://drive.google.com/drive/folders/folder_id_1_Restaurante Bom Sabor");

    // Total de chamadas: 1 pasta raiz + 4 subpastas + 1 permissão = 6
    expect(folderCallCount).toBe(5);
    expect(res.subfolders.identidade.id).toContain("01_Identidade_e_Logos");
    expect(res.subfolders.brutos.id).toContain("02_Fotos_e_Videos_Brutos");
    expect(res.subfolders.criativos.id).toContain("03_Criativos_Finalizados");
    expect(res.subfolders.relatorios.id).toContain("04_Relatorios");
  });
});
