// Leitura de imagem pelo agente: desligável, e nunca mais em silêncio.
//
// 22/10/2026: a conta Groq ficou sem nenhum modelo que aceite imagem. describeImage falhava, devolvia null, e o robô
// respondia como se nada tivesse chegado — o lead mandava foto e era ignorado. Agora:
//  (i) leitura desligada (padrão): nenhum provedor é chamado; o robô reconhece a imagem e pede o texto;
//  (k) leitura ligada mas o provedor falha: mesmo comportamento — o atendimento continua.
// A imagem fica marcada no histórico como não visualizada, para quem atende saber que o robô não viu.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CORPO_IMAGEM = {
  event: "messages.upsert",
  data: {
    key: { remoteJid: "5534997817660@s.whatsapp.net", fromMe: false, id: "3EB0IMAGEM000000000001" },
    pushName: "Lead",
    message: { imageMessage: { mimetype: "image/jpeg", base64: "ZmFrZS1qcGVn" } },
    messageType: "imageMessage",
    messageTimestamp: 1729600000,
  },
};

function supabaseQueGrava(existente = { id: "lead-1", historico: [], dados: {} }) {
  const gravado = { payload: null };
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [existente] }) }) }) }) }),
      update: (payload) => {
        gravado.payload = payload;
        return { eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) };
      },
    }),
  };
  return { supabase, gravado };
}

let fetchOriginal;
let envOriginal;
beforeEach(() => {
  fetchOriginal = globalThis.fetch;
  envOriginal = { ligada: process.env.IMAGE_UNDERSTANDING_ENABLED, chave: process.env.GROQ_API_KEY };
  vi.resetModules();
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  if (envOriginal.ligada === undefined) delete process.env.IMAGE_UNDERSTANDING_ENABLED;
  else process.env.IMAGE_UNDERSTANDING_ENABLED = envOriginal.ligada;
  if (envOriginal.chave === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = envOriginal.chave;
});

async function engine({ ligada }) {
  if (ligada) process.env.IMAGE_UNDERSTANDING_ENABLED = "true";
  else delete process.env.IMAGE_UNDERSTANDING_ENABLED;
  process.env.GROQ_API_KEY = "gsk_fake_key_for_test";
  return import("../chatbot-ai-engine.js");
}

describe("[OBRIGATÓRIO] leitura de imagem desligável e nunca silenciosa", () => {
  it("(i) desligada: nenhum provedor é chamado, e o robô reconhece a imagem e pede o texto", async () => {
    const chamadas = [];
    globalThis.fetch = vi.fn(async (url) => {
      chamadas.push(String(url));
      return { ok: false, status: 500, text: async () => "não deveria chamar", json: async () => ({}) };
    });
    const eng = await engine({ ligada: false });
    expect(eng.IMAGE_UNDERSTANDING_AVAILABLE).toBe(false);

    const msg = await eng.resolveMessageContent(CORPO_IMAGEM, { fromMe: false });
    expect(msg).toMatchObject({ type: "image", described: false, imageUnseen: true, text: eng.IMAGE_UNSEEN_MARKER });

    const { supabase, gravado } = supabaseQueGrava();
    const res = await eng.processBatch({ clientId: "vexo-adm", phone: "5534997817660", messages: [msg], supabase, model: "generico" });

    expect(chamadas).toEqual([]); // nem visão, nem LLM
    expect(res.mensagem).toBe(eng.IMAGE_UNSEEN_REPLY);
    expect(res.imageUnseen).toBe(true);
    expect(JSON.stringify(gravado.payload.historico)).toContain("[imagem não visualizada]");
    expect(gravado.payload.dados.image_unseen_warned_at).toBeDefined();
  });

  it("(k) ligada, mas o provedor falha (404): cai no mesmo aviso e o atendimento continua", async () => {
    const chamadas = [];
    globalThis.fetch = vi.fn(async (url) => {
      chamadas.push(String(url));
      return { ok: false, status: 404, text: async () => '{"error":{"message":"model not found"}}', json: async () => ({}) };
    });
    const eng = await engine({ ligada: true });
    expect(eng.IMAGE_UNDERSTANDING_AVAILABLE).toBe(true);

    const msg = await eng.resolveMessageContent(CORPO_IMAGEM, { fromMe: false });
    expect(chamadas.filter((u) => u.includes("/chat/completions"))).toHaveLength(1); // tentou o provedor de visão
    expect(msg).toMatchObject({ described: false, imageUnseen: true });

    const { supabase } = supabaseQueGrava();
    const res = await eng.processBatch({ clientId: "vexo-adm", phone: "5534997817660", messages: [msg], supabase, model: "generico" });
    expect(res.mensagem).toBe(eng.IMAGE_UNSEEN_REPLY);
    expect(res.status_conversa).toBe("em_atendimento");
  });

  it("segunda imagem não vista na mesma conversa: não repete o aviso, mas registra no histórico", async () => {
    globalThis.fetch = vi.fn();
    const eng = await engine({ ligada: false });
    const msg = await eng.resolveMessageContent(CORPO_IMAGEM, { fromMe: false });
    const { supabase, gravado } = supabaseQueGrava({
      id: "lead-1", historico: [], dados: { image_unseen_warned_at: "2026-10-22T10:00:00.000Z", image_unseen_count: 1 },
    });

    const res = await eng.processBatch({ clientId: "vexo-adm", phone: "5534997817660", messages: [msg], supabase, model: "generico" });

    expect(res.mensagem).toBeNull();
    expect(res.silencedRepeatedImageWarning).toBe(true);
    expect(JSON.stringify(gravado.payload.historico)).toContain("[imagem não visualizada]");
    expect(gravado.payload.dados.image_unseen_count).toBe(2);
  });

  it("imagem com legenda: a legenda segue como texto do lead (não vira marcador)", async () => {
    globalThis.fetch = vi.fn();
    const eng = await engine({ ligada: false });
    const corpo = structuredClone(CORPO_IMAGEM);
    corpo.data.message.imageMessage.caption = "quanto custa esse modelo?";
    const msg = await eng.resolveMessageContent(corpo, { fromMe: false });
    expect(msg).toMatchObject({ text: "quanto custa esse modelo?", imageUnseen: true, described: false });
  });
});
