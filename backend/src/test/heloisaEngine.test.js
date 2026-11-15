import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../services/evolution.js", () => ({
  sendTextMessageViaEvolution: vi.fn().mockResolvedValue({ success: true }),
  getBase64FromMediaMessage: vi.fn().mockResolvedValue(null),
}));

import {
  identificarDiretor,
  identificarUsuarioAutorizado,
  isHeloisaAuthorizedSender,
  isHeloisaAuthorizedSenderAsync,
  executarCadastrarCliente,
  executarEnviarMensagemWhatsApp,
  executarCobrarColaborador,
  executarAgendarCompromisso,
  executarCriarFollowup,
  executarConsultarOperacao,
  enviarMensagemWhatsAppComFallback,
  DIRETORES_AUTORIZADOS,
  chamarLlmHeloisa,
} from "../domains/goclaw/heloisaEngine.js";
import { sendTextMessageViaEvolution } from "../services/evolution.js";
import { GROQ_MODELOS_MORTOS, defaultGroqModel } from "../services/llmModels.js";

describe("Heloísa Engine (heloisaEngine.js)", () => {
  it("identifica corretamente Conrado e Caio por telefone canônico ou alternativo", () => {
    // Conrado
    const conrado1 = identificarDiretor("5534997817660");
    expect(conrado1).not.toBeNull();
    expect(conrado1.nome).toBe("Conrado Finzi");

    const conrado2 = identificarDiretor("+55 (34) 99781-7660");
    expect(conrado2).not.toBeNull();
    expect(conrado2.nome).toBe("Conrado Finzi");

    // Caio
    const caio1 = identificarDiretor("5534997719779");
    expect(caio1).not.toBeNull();
    expect(caio1.nome).toBe("Caio Almeida");

    const caio2 = identificarDiretor("553497719779");
    expect(caio2).not.toBeNull();
    expect(caio2.nome).toBe("Caio Almeida");

    // Desconhecido
    expect(identificarDiretor("5511999999999")).toBeNull();
    expect(isHeloisaAuthorizedSender("5511999999999")).toBe(false);
  });

  it("identificarUsuarioAutorizado consulta tabela heloisa_usuarios_autorizados com fallback", async () => {
    const mockPoolComUsuario = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "user-gabriel",
            client_id: "geracao-digital",
            nome: "Gabriel Gestor",
            telefone: "5534996916397",
            papel: "Gestor de Operações",
            ativo: true,
          },
        ],
      }),
    };

    // Usuário cadastrado no banco ativo
    const gabriel = await identificarUsuarioAutorizado("5534996916397", mockPoolComUsuario);
    expect(gabriel).not.toBeNull();
    expect(gabriel.nome).toBe("Gabriel Gestor");
    expect(gabriel.papel).toBe("Gestor de Operações");

    const authGabriel = await isHeloisaAuthorizedSenderAsync("5534996916397", mockPoolComUsuario);
    expect(authGabriel).toBe(true);

    // Fallback de segurança para Conrado caso banco não tenha a linha
    const conrado = await identificarUsuarioAutorizado("5534997817660", mockPoolComUsuario);
    expect(conrado).not.toBeNull();
    expect(conrado.nome).toBe("Conrado Finzi");

    // Desconhecido
    const desconhecido = await identificarUsuarioAutorizado("5511999999999", mockPoolComUsuario);
    expect(desconhecido).toBeNull();
    const authDesconhecido = await isHeloisaAuthorizedSenderAsync("5511999999999", mockPoolComUsuario);
    expect(authDesconhecido).toBe(false);
  });

  it("executa cadastrar_cliente inserindo no banco de dados", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: "cli-123", nome: "Empresa Teste", estado: "novo" }],
      }),
    };

    const res = await executarCadastrarCliente(
      { nome: "Empresa Teste", telefone: "34999998888", valor: 3500 },
      mockPool
    );

    expect(res.sucesso).toBe(true);
    expect(res.cliente.nome).toBe("Empresa Teste");
    expect(mockPool.query).toHaveBeenCalled();
  });

  it("executa cobrar_colaborador buscando o colaborador da equipe e enviando mensagem", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "colab-1",
            nome: "Santana",
            funcao: "Diretor de arte",
            telefone: "5516982447360",
            recebe_cobranca_whatsapp: true,
            ativo: true,
          },
        ],
      }),
    };

    // Colaborador encontrado no mock pool

    const res = await executarCobrarColaborador(
      { colaborador: "Santana", mensagem: "Favor finalizar a arte do cliente X hoje." },
      mockPool,
      "heloisa-chip"
    );

    expect(res.sucesso).toBe(true);
    expect(res.colaborador).toBe("Santana");
    expect(res.telefone).toBe("5516982447360");
  });

  it("executa enviar_mensagem_whatsapp para Caio com fallback automático quando a primeira instância falha com 404", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { name: "vexo-adm-vexo-atende", client_id: "geracao-digital", connection_state: "open" },
        ],
      }),
    };

    // Configura o mock do sendTextMessageViaEvolution para falhar na primeira instância (404)
    // e ter sucesso na segunda ("geracao-digital-teste-vexo")
    sendTextMessageViaEvolution
      .mockRejectedValueOnce(new Error('Evolution HTTP 404: {"message":["The \\"vexo-adm-vexo-atende\\" instance does not exist"]}'))
      .mockResolvedValueOnce({ waMessageId: "msg-caio-123" });

    const res = await executarEnviarMensagemWhatsApp(
      { destinatario: "Caio", mensagem: "Oi Caio! A Heloísa agora está ativa por voz no Vexo OS." },
      mockPool,
      "vexo-adm-vexo-atende"
    );

    expect(res.sucesso).toBe(true);
    expect(res.destinatario).toBe("Caio Almeida");
    expect(res.telefone).toBe("5534997719779");
    expect(res.instanceName).toBe("geracao-digital-teste-vexo");
    expect(res.waMessageId).toBe("msg-caio-123");
  });

  it("executa agendar_compromisso e criar_followup com sucesso", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((queryText) => {
        if (queryText.includes("events")) {
          return Promise.resolve({
            rows: [{ id: "ev-1", name: "Reunião Diretoria", date: "2026-11-15T14:00:00Z" }],
          });
        }
        return Promise.resolve({
          rows: [{ id: "rem-1", title: "Ligar para cliente", remind_at: "2026-11-16T10:00:00Z" }],
        });
      }),
    };

    const resAgendamento = await executarAgendarCompromisso(
      { titulo: "Reunião Diretoria", data_hora: "2026-11-15T14:00:00Z" },
      mockPool
    );
    expect(resAgendamento.sucesso).toBe(true);
    expect(resAgendamento.compromisso.name).toBe("Reunião Diretoria");

    const resFollowup = await executarCriarFollowup(
      { titulo: "Ligar para cliente", cliente_nome: "Acme", data_lembrete: "2026-11-16T10:00:00Z" },
      mockPool
    );
    expect(resFollowup.sucesso).toBe(true);
    expect(resFollowup.followup.title).toBe("Ligar para cliente");
  });

  it("executa consultar_operacao para colaboradores e resumo geral", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((queryText) => {
        if (queryText.includes("gd_colaboradores")) {
          return Promise.resolve({
            rows: [
              { nome: "Caio", funcao: "Comercial" },
              { nome: "Conrado", funcao: "Executivo" },
            ],
          });
        }
        return Promise.resolve({ rows: [{ total: 2 }] });
      }),
    };

    const resColabs = await executarConsultarOperacao({ tipo: "colaboradores" }, mockPool);
    expect(resColabs.sucesso).toBe(true);
    expect(resColabs.colaboradores.length).toBe(2);

    const resResumo = await executarConsultarOperacao({ tipo: "resumo_geral" }, mockPool);
    expect(resResumo.sucesso).toBe(true);
    expect(resResumo.tipo).toBe("resumo_geral");
  });
});

// Degrau da Groq na chamada da Heloísa (Gemini -> Groq -> GoClaw). O modelo
// estava chumbado num id que a Groq descontinuou: o degrau tomava 404 e, como
// recusa não lança, ninguém via. Dublado só o fetch (sai do processo).
describe("chamarLlmHeloisa — degrau da Groq", () => {
  const ambiente = { ...process.env };
  let chamadas;

  function instalarFetch(responder) {
    chamadas = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      chamadas.push({ url: String(url), body: JSON.parse(init.body) });
      return responder(String(url));
    }));
  }
  const ok = (texto) => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: texto } }] }), { status: 200 });

  beforeEach(() => {
    process.env = { ...ambiente, GROQ_API_KEY: "chave-de-teste" };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LLM_MODEL_LADDER;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ambiente };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("chama a Groq com o modelo da escada, que não está na lista de descontinuados", async () => {
    instalarFetch(() => ok("oi"));
    const resposta = await chamarLlmHeloisa({ systemPrompt: "s", messages: [{ role: "user", content: "oi" }] });

    expect(resposta.content).toBe("oi");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(chamadas[0].body.model).toBe(defaultGroqModel());
    expect(GROQ_MODELOS_MORTOS.has(chamadas[0].body.model)).toBe(false);
  });

  it("segue a escada configurada por variável de ambiente, sem deploy", async () => {
    process.env.LLM_MODEL_LADDER = "gemini-flash-latest,openai/gpt-oss-20b";
    instalarFetch(() => ok("oi"));
    await chamarLlmHeloisa({ systemPrompt: "s", messages: [] });
    expect(chamadas[0].body.model).toBe("openai/gpt-oss-20b");
  });

  it("Groq recusa (404): avisa no log com o status e cai para o GoClaw", async () => {
    instalarFetch((url) => (url.includes("api.groq.com") ? new Response("model not found", { status: 404 }) : ok("do goclaw")));
    const resposta = await chamarLlmHeloisa({ systemPrompt: "s", messages: [] });

    expect(resposta.content).toBe("do goclaw");
    expect(chamadas.map((c) => c.url.includes("api.groq.com"))).toEqual([true, false]);
    expect(console.warn).toHaveBeenCalledWith("[Heloísa] Groq recusou a chamada, tentando GoClaw runtime:", { status: 404 });
  });
});
