import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  renderGdBrandingAvatar,
  generateAndApplyGdBrandingAvatar,
} from "../services/gdBrandingAvatarService.js";
import {
  updateEvolutionGroupPicture,
  linkEvolutionGroupToCommunity,
} from "../services/evolution.js";

describe("GD Branding Avatar Service", () => {
  it("renderGdBrandingAvatar gera buffer PNG e Base64 válidos em 500x500", async () => {
    const res = await renderGdBrandingAvatar({
      clientName: "Óticas Visão Real Ltda",
      niche: "Óticas & Saúde Visual",
    });

    expect(res).toBeDefined();
    expect(Buffer.isBuffer(res.buffer)).toBe(true);
    expect(res.buffer.length).toBeGreaterThan(1000);
    expect(res.base64).toMatch(/^data:image\/png;base64,/);
  });

  it("renderGdBrandingAvatar ajusta dinamicamente nomes longos sem quebrar", async () => {
    const res = await renderGdBrandingAvatar({
      clientName: "Empresa de Engenharia e Equipamentos Industriais de Alta Precisão do Brasil Ltda",
    });

    expect(res.buffer).toBeInstanceOf(Buffer);
    expect(res.base64).toContain("data:image/png;base64,");
  });

  it("generateAndApplyGdBrandingAvatar envia foto via Evolution e faz upload no Google Drive", async () => {
    const mockEvolutionUpdater = vi.fn().mockResolvedValue({ success: true });
    const mockDriveUploader = vi.fn().mockResolvedValue({
      success: true,
      fileId: "drive_file_001",
      fileLink: "https://drive.google.com/file/d/drive_file_001/view",
    });

    const resultado = await generateAndApplyGdBrandingAvatar({
      clientName: "Sonhare Odontologia",
      groupJid: "120363111222@g.us",
      instanceName: "vexo-adm",
      identidadeFolderId: "folder_01_identidade",
      evolutionUpdater: mockEvolutionUpdater,
      driveUploader: mockDriveUploader,
    });

    expect(resultado.success).toBe(true);
    expect(resultado.evolutionUpdated).toBe(true);
    expect(resultado.groupJid).toBe("120363111222@g.us");
    expect(resultado.driveFile.fileId).toBe("drive_file_001");

    // Verifica chamada da Evolution API
    expect(mockEvolutionUpdater).toHaveBeenCalledTimes(1);
    expect(mockEvolutionUpdater).toHaveBeenCalledWith({
      instanceName: "vexo-adm",
      groupJid: "120363111222@g.us",
      image: expect.stringMatching(/^data:image\/png;base64,/),
      fetchFn: expect.any(Function),
    });

    // Verifica chamada do Google Drive (pasta 01_Identidade_e_Logos)
    expect(mockDriveUploader).toHaveBeenCalledTimes(1);
    expect(mockDriveUploader).toHaveBeenCalledWith({
      fileName: "Avatar_Maquina_de_Vendas_Sonhare_Odontologia.png",
      mimeType: "image/png",
      fileBuffer: expect.any(Buffer),
      folderId: "folder_01_identidade",
      allowMockFallback: true,
    });
  });

  it("generateAndApplyGdBrandingAvatar tolera falhas externas sem abortar fluxo", async () => {
    const mockEvolutionFail = vi.fn().mockRejectedValue(new Error("Evolution offline"));
    const mockDriveFail = vi.fn().mockRejectedValue(new Error("Drive sem quota"));

    const resultado = await generateAndApplyGdBrandingAvatar({
      clientName: "Empresa Resiliente",
      groupJid: "120363333444@g.us",
      instanceName: "vexo-adm",
      identidadeFolderId: "folder_01",
      evolutionUpdater: mockEvolutionFail,
      driveUploader: mockDriveFail,
    });

    expect(resultado.success).toBe(true);
    expect(resultado.evolutionUpdated).toBe(false);
    expect(resultado.driveFile).toBeNull();
  });
});

describe("Evolution API Community & Picture Helpers", () => {
  it("linkEvolutionGroupToCommunity chama o endpoint /community/linkGroup corretamente", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    const res = await linkEvolutionGroupToCommunity({
      instanceName: "vexo-adm",
      groupJid: "120363888@g.us",
      communityName: "GD — Operação Interna",
      baseUrl: "https://evolution.teste.com",
      webhookToken: "token-teste",
      fetchFn: fakeFetch,
    });

    expect(res.success).toBe(true);
    expect(res.community).toBe("GD — Operação Interna");
    expect(res.groupJid).toBe("120363888@g.us");

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const [callUrl, callOptions] = fakeFetch.mock.calls[0];
    expect(callUrl).toBe("https://evolution.teste.com/community/linkGroup/vexo-adm");

    const sentBody = JSON.parse(callOptions.body);
    expect(sentBody.groupJid).toBe("120363888@g.us");
    expect(sentBody.community).toBe("GD — Operação Interna");
  });

  it("updateEvolutionGroupPicture chama /group/updateGroupPicture com groupJid e base64", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    const res = await updateEvolutionGroupPicture({
      instanceName: "vexo-adm",
      groupJid: "120363888@g.us",
      image: "data:image/png;base64,teste",
      baseUrl: "https://evolution.teste.com",
      webhookToken: "token-teste",
      fetchFn: fakeFetch,
    });

    expect(res.success).toBe(true);
    expect(res.groupJid).toBe("120363888@g.us");

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const [callUrl, callOptions] = fakeFetch.mock.calls[0];
    expect(callUrl).toBe("https://evolution.teste.com/group/updateGroupPicture/vexo-adm?groupJid=120363888%40g.us");

    const sentBody = JSON.parse(callOptions.body);
    expect(sentBody.groupJid).toBe("120363888@g.us");
    expect(sentBody.image).toBe("data:image/png;base64,teste");
  });
});
