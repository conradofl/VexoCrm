// backend/src/test/leadCaptureTurnoZero.test.js
// Formulário "turno-zero-kit": grava o lead com etiqueta própria e NÃO manda mensagem
// (nem auto-resposta ao lead, nem aviso de diagnóstico à equipe de vendas).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerLeadCaptureRoutes } from "../domains/leads/captureRoutes.js";
import {
  resetCaptureRateLimit,
  resolveCaptureForm,
  isQualifiedTurnoZeroLead,
  validateCapturePayload,
} from "../services/leadCapture.js";
import * as evolutionModule from "../services/evolution.js";
import * as leadUpsertModule from "../services/leadUpsert.js";

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) {
      this.statusCode = s;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

function getHandler(deps) {
  const routes = {};
  registerLeadCaptureRoutes({ post: (p, ...h) => { routes[p] = h[h.length - 1]; } }, deps);
  return routes["/api/public/leads/capture"];
}

describe("resolveCaptureForm", () => {
  it("reconhece turno-zero-kit sem diferenciar maiúscula", () => {
    const f = resolveCaptureForm(" Turno-Zero-Kit ");
    expect(f).toMatchObject({ key: "turno-zero-kit", tag: "turno-zero", autoReply: false, ownerAlert: false });
  });

  it("valor desconhecido ou vazio cai no diagnóstico padrão (null)", () => {
    expect(resolveCaptureForm("qualquer")).toBeNull();
    expect(resolveCaptureForm("")).toBeNull();
    expect(resolveCaptureForm(undefined)).toBeNull();
    expect(resolveCaptureForm("constructor")).toBeNull();
  });
});

describe("isQualifiedTurnoZeroLead", () => {
  it("dono com 10 ou mais mensagens por dia é qualificado", () => {
    expect(isQualifiedTurnoZeroLead({ isOwner: "Sim", dailyMessages: "De 10 a 30" })).toBe(true);
    expect(isQualifiedTurnoZeroLead({ isOwner: "sim", dailyMessages: "10 a 30" })).toBe(true);
    expect(isQualifiedTurnoZeroLead({ isOwner: "Sim", dailyMessages: "Mais de 30" })).toBe(true);
  });

  it("não dono, pouco volume ou resposta ausente não é qualificado", () => {
    expect(isQualifiedTurnoZeroLead({ isOwner: "Não", dailyMessages: "Mais de 30" })).toBe(false);
    expect(isQualifiedTurnoZeroLead({ isOwner: "Sim", dailyMessages: "Até 10" })).toBe(false);
    expect(isQualifiedTurnoZeroLead({ isOwner: null, dailyMessages: null })).toBe(false);
    expect(isQualifiedTurnoZeroLead()).toBe(false);
  });
});

describe("validateCapturePayload com formulário", () => {
  it("sem campo formulario mantém form null (diagnóstico padrão)", () => {
    const v = validateCapturePayload({ fullName: "Ana Souza", phone: "34991751267" });
    expect(v.valid).toBe(true);
    expect(v.data.form).toBeNull();
  });
});

describe("POST /api/public/leads/capture com formulario=turno-zero-kit", () => {
  let pool;
  let deps;

  beforeEach(() => {
    resetCaptureRateLimit();
    vi.restoreAllMocks();
    pool = {
      query: vi.fn(async (sql) => {
        if (sql.includes("FROM public.lead_client_evolution_instances")) {
          return { rows: [{ name: "Vexo", dispatch_webhook_url: "https://evo.example/message/sendText/vexo-adm-chip", dispatch_webhook_token: "tok" }] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    deps = {
      pgDatabasePool: pool,
      sendError: (res, status, code, message) => res.status(status).json({ error: code, message }),
    };
  });

  it("grava no vexo-adm com etiqueta turno-zero e qualificado, sem mandar nenhuma mensagem", async () => {
    const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone").mockResolvedValue("inserted");
    const sendSpy = vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockResolvedValue({ success: true });

    const res = fakeRes();
    await getHandler(deps)(
      {
        headers: { "x-forwarded-for": "200.1.2.3" },
        body: {
          formulario: "turno-zero-kit",
          fullName: "Marta Lima",
          phone: "(34) 99175-1267",
          segment: "Studio ou academia",
          ehDono: "Sim",
          mensagensDia: "Mais de 30",
          attribution: { utm_source: "fb", utm_medium: "paid_social", campaign_id: "120200000000001", ad_id: "120200000000003" },
        },
      },
      res
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: "Pronto! Recebemos seus dados." });
    expect(upsertSpy).toHaveBeenCalledWith(
      pool,
      "vexo-adm",
      "5534991751267",
      expect.objectContaining({
        tags: ["turno-zero"],
        lead_origin: "turno-zero-kit",
        lead_source: "trafego_pago",
        dados: expect.objectContaining({
          captura_origem: "turno-zero-kit",
          qualificado: true,
          isOwner: "Sim",
          dailyMessages: "Mais de 30",
          segment: "Studio ou academia",
        }),
      })
    );
    expect(sendSpy).not.toHaveBeenCalled();
    const notif = pool.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO public.notifications"));
    expect(notif[1][1]).toBe("Cadastro Turno Zero: Marta Lima");
  });

  it("formulário desconhecido segue o diagnóstico padrão (etiqueta diagnostico-site e auto-resposta)", async () => {
    const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone").mockResolvedValue("inserted");
    const sendSpy = vi.spyOn(evolutionModule, "sendTextMessageViaEvolution").mockResolvedValue({ success: true, waMessageId: "X" });

    const res = fakeRes();
    await getHandler(deps)(
      { headers: { "x-forwarded-for": "200.1.2.4" }, body: { formulario: "outro", fullName: "João Prado", phone: "34991751267" } },
      res
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(res.statusCode).toBe(200);
    expect(upsertSpy).toHaveBeenCalledWith(pool, "vexo-adm", "5534991751267", expect.objectContaining({ tags: ["diagnostico-site"] }));
    const dados = upsertSpy.mock.calls[0][3].dados;
    expect(dados).not.toHaveProperty("qualificado");
    expect(dados).not.toHaveProperty("isOwner");
    expect(sendSpy).toHaveBeenCalled();
  });
});
