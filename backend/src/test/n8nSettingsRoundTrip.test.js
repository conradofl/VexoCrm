import { describe, expect, it } from "vitest";
import {
  N8N_SETTINGS_SELECT_FIELDS,
  buildN8nSettingsPayload,
  maskN8nSettings,
  resolveSingleLeadClientSettings,
} from "../services/n8nSettings.js";

describe("n8nSettings Round-Trip: Gravação e Leitura com Paridade Total", () => {
  it("contém todas as colunas necessárias em N8N_SETTINGS_SELECT_FIELDS", () => {
    const fields = N8N_SETTINGS_SELECT_FIELDS.split(",").map((s) => s.trim());
    expect(fields).toContain("client_id");
    expect(fields).toContain("send_window_start");
    expect(fields).toContain("send_window_end");
    expect(fields).toContain("send_window_days");
    expect(fields).toContain("send_window_timezone");
    expect(fields).toContain("send_window_enabled");
    expect(fields).toContain("agent_replies_outside_window");
    expect(fields).toContain("chatbot_enabled");
    expect(fields).toContain("chatbot_model");
    expect(fields).toContain("chatbot_llm_model");
  });

  it("Round-trip completo: todos os campos gravados no payload são preservados ao ler via maskN8nSettings", () => {
    const originalInput = {
      client_id: "sonhare",
      dispatchWebhookUrl: "https://evo.vexo.com.br/webhook/sonhare",
      dispatchWebhookToken: "secret-token-123",
      inboundBearerToken: "inbound-bearer-456",
      active: true,
      chatbotEnabled: true,
      chatbotModel: "generico",
      chatbotLlmModel: "openai/gpt-oss-120b",
      chatbotInstances: ["instancia-sonhare-1", "instancia-sonhare-2"],
      chatbotInboundScope: "all",
      recontactMessage: "Olá! Como podemos te ajudar hoje?",
      sdrWhatsappNumbers: ["5511999998888", "5511988887777"],
      allowedTabs: ["leads", "disparador", "chatbot"],
      planTier: "avancado",
      modulosAvulsos: ["modulo_campanhas"],
      sendWindowStart: "07:30",
      sendWindowEnd: "21:00",
      sendWindowDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
      sendWindowTimezone: "America/Manaus",
      sendWindowEnabled: true,
      agentRepliesOutsideWindow: false,
      chatbotVoiceMode: "mirror",
      chatbotVoiceId: "echo",
      chatbotVoiceSpeed: 1.15,
    };

    const authAccess = { uid: "user-123", email: "admin@sonhare.com" };

    // 1. Gravação: buildN8nSettingsPayload
    const payload = {
      client_id: "sonhare",
      ...buildN8nSettingsPayload(originalInput, authAccess, null),
    };

    // 2. Simula o retorno do Postgres (o que o DB devolve após o INSERT/SELECT)
    const simulatedDbRow = {
      ...payload,
      updated_by_email: authAccess.email,
    };

    // 3. Leitura: maskN8nSettings
    const masked = maskN8nSettings(simulatedDbRow);

    // 4. Verificação de paridade campo a campo
    expect(masked.client_id).toBe("sonhare");
    expect(masked.dispatch_webhook_url).toBe("https://evo.vexo.com.br/webhook/sonhare");
    expect(masked.has_dispatch_webhook_token).toBe(true);
    expect(masked.has_inbound_bearer_token).toBe(true);
    expect(masked.active).toBe(true);
    expect(masked.chatbot_enabled).toBe(true);
    expect(masked.chatbot_model).toBe("generico");
    expect(masked.chatbot_llm_model).toBe("openai/gpt-oss-120b");
    expect(masked.chatbot_instances).toEqual(["instancia-sonhare-1", "instancia-sonhare-2"]);
    expect(masked.chatbot_inbound_scope).toBe("all");
    expect(masked.recontact_message).toBe("Olá! Como podemos te ajudar hoje?");
    expect(masked.sdr_whatsapp_numbers).toEqual(["5511999998888", "5511988887777"]);
    // modulo_campanhas concede automaticamente a aba "campanhas" via ensureModuleTabs
    expect(masked.allowed_tabs).toEqual(["leads", "disparador", "chatbot", "campanhas"]);
    expect(masked.plan_tier).toBe("avancado");
    expect(masked.modulos_avulsos).toEqual(["modulo_campanhas"]);
    expect(masked.send_window_start).toBe("07:30");
    expect(masked.send_window_end).toBe("21:00");
    expect(masked.send_window_days).toEqual(["mon", "tue", "wed", "thu", "fri", "sat"]);
    expect(masked.send_window_timezone).toBe("America/Manaus");
    expect(masked.send_window_enabled).toBe(true);
    expect(masked.agent_replies_outside_window).toBe(false);
    expect(masked.chatbot_voice_mode).toBe("mirror");
    expect(masked.chatbot_voice_id).toBe("echo");
    expect(masked.chatbot_voice_speed).toBe(1.15);
  });

  it("não usa mais 'outlier' como fallback padrão em tenants novos ou nulos", () => {
    const masked = maskN8nSettings(null);
    expect(masked.chatbot_model).toBe("generico");
    expect(masked.segmentation_config).toBeDefined();

    const payloadWithEmptyModel = buildN8nSettingsPayload({ chatbotModel: "" }, null, null);
    expect(payloadWithEmptyModel.chatbot_model).toBe("generico");
  });

  it("PATCH parcial preserva campos existentes não enviados sem sobrescrever com defaults", () => {
    const existing = {
      client_id: "sonhare",
      chatbot_model: "sonhare-custom",
      chatbot_enabled: true,
      send_window_start: "09:00",
      send_window_end: "19:00",
      send_window_days: ["mon", "wed", "fri"],
      send_window_timezone: "America/Cuiaba",
      send_window_enabled: true,
      agent_replies_outside_window: true,
      sdr_whatsapp_numbers: ["5534999991111"],
    };

    // Atualiza apenas chatbotEnabled (desliga o bot)
    const patchPayload = buildN8nSettingsPayload({ chatbotEnabled: false }, null, existing);

    expect(patchPayload.chatbot_enabled).toBe(false);
    expect(patchPayload.chatbot_model).toBe("sonhare-custom");
    expect(patchPayload.send_window_start).toBe("09:00");
    expect(patchPayload.send_window_end).toBe("19:00");
    expect(patchPayload.send_window_days).toEqual(["mon", "wed", "fri"]);
    expect(patchPayload.send_window_timezone).toBe("America/Cuiaba");
  });

  it("parseSendWindowDays aceita JSON string, Array nativo e strings separadas por vírgula", () => {
    const rowFromJsonString = {
      client_id: "t1",
      send_window_days: '["mon","tue","wed"]',
    };
    expect(maskN8nSettings(rowFromJsonString).send_window_days).toEqual(["mon", "tue", "wed"]);

    const rowFromPgArray = {
      client_id: "t2",
      send_window_days: "{mon,tue,fri}",
    };
    expect(maskN8nSettings(rowFromPgArray).send_window_days).toEqual(["mon", "tue", "fri"]);

    const rowFromNativeArray = {
      client_id: "t3",
      send_window_days: ["thu", "fri"],
    };
    expect(maskN8nSettings(rowFromNativeArray).send_window_days).toEqual(["thu", "fri"]);
  });
});
