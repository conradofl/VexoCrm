// frontend/src/test/instagramExport.test.ts
//
// Parse da exportação do Instagram — tudo no navegador, nada de IA, nada de
// rede. Telefone sai de regex validada (mesma régua de sanitizePhoneE164),
// resumo é a primeira mensagem da pessoa, literal, cortada em 200. Acento
// quebrado (UTF-8 codificado duas vezes) é corrigido na leitura.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fixInstagramEncoding,
  extractPhoneFromText,
  isInstagramMessageJsonPath,
  isInstagramMessageHtmlPath,
  parseInstagramExport,
  buildInstagramImportPayload,
  formatInstagramDirectMessage,
  isTrivialGreetingOrReaction,
  classifyInstagramConversation,
  type RawExportFile,
} from "@/lib/leadImports/instagramExport";

// Simula o defeito real do export do Instagram: cada byte UTF-8 da string
// correta vira um char code Latin-1 separado. É o INVERSO de
// fixInstagramEncoding — usado só pra montar fixture, nunca importado do
// código de produção.
function corruptLikeInstagram(correct: string): string {
  const bytes = new TextEncoder().encode(correct);
  return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
}

function jsonFile(path: string, data: unknown): RawExportFile {
  return { path, text: JSON.stringify(data) };
}

describe("fixInstagramEncoding", () => {
  it("[TESTE OBRIGATÓRIO] nome acentuado chega correto", () => {
    const nomeCorreto = "Fernanda Conceição";
    const nomeQuebrado = corruptLikeInstagram(nomeCorreto);
    // prova que a fixture está de fato quebrada, não só um round-trip vazio
    expect(nomeQuebrado).not.toBe(nomeCorreto);
    expect(fixInstagramEncoding(nomeQuebrado)).toBe(nomeCorreto);
  });

  it("string já correta (sem o defeito) não é estragada por engano", () => {
    // não deveria aparecer em export real, mas a função não pode piorar o
    // que já está certo
    const jaCorreta = "Sem acento nenhum aqui";
    expect(fixInstagramEncoding(jaCorreta)).toBe(jaCorreta);
  });
});

describe("extractPhoneFromText", () => {
  it("acha telefone brasileiro válido em prosa", () => {
    expect(extractPhoneFromText("Meu whatsapp é 34998765432, pode chamar")).toBe("+5534998765432");
    expect(extractPhoneFromText("me liga no (34) 99876-5432 depois")).toBe("+5534998765432");
  });

  it("[TESTE OBRIGATÓRIO] número inválido é descartado, não corrigido", () => {
    // 5 dígitos — não é candidato de telefone nenhum, sanitizePhone nunca
    // recebe isso pra "consertar"
    expect(extractPhoneFromText("liga pro ramal 12345 que resolve")).toBeNull();
  });

  it("texto sem nenhum telefone devolve null", () => {
    expect(extractPhoneFromText("Vocês entregam em Uberlândia?")).toBeNull();
  });
});

describe("isInstagramMessageJsonPath / isInstagramMessageHtmlPath", () => {
  it("aceita só message_N.json dentro de messages/inbox/<thread>/", () => {
    expect(isInstagramMessageJsonPath("export/messages/inbox/fernanda_123/message_1.json")).toBe(true);
    expect(isInstagramMessageJsonPath("export/messages/inbox/fernanda_123/message_2.json")).toBe(true);
  });

  it("ignora mídia, photos/, files/ e tudo que não seja message_N.json do inbox", () => {
    expect(isInstagramMessageJsonPath("export/messages/inbox/fernanda_123/photos/foto.jpg")).toBe(false);
    expect(isInstagramMessageJsonPath("export/messages/inbox/fernanda_123/files/arquivo.pdf")).toBe(false);
    expect(isInstagramMessageJsonPath("export/messages/message_requests/x/message_1.json")).toBe(false);
    expect(isInstagramMessageJsonPath("export/posts/post_1.json")).toBe(false);
  });

  it("identifica exportação em HTML (pra avisar que precisa ser JSON)", () => {
    expect(isInstagramMessageHtmlPath("export/messages/inbox/fernanda_123/message_1.html")).toBe(true);
    expect(isInstagramMessageJsonPath("export/messages/inbox/fernanda_123/message_1.html")).toBe(false);
  });
});

describe("parseInstagramExport", () => {
  const SELF = "Loja Do Bairro"; // aparece em toda conversa — é quem exportou

  function conversaComTelefone(): RawExportFile {
    return jsonFile("export/messages/inbox/fernanda_123/message_1.json", {
      participants: [{ name: SELF }, { name: "Fernanda" }],
      messages: [
        { sender_name: "Fernanda", content: "Meu whatsapp é 34998765432, pode me chamar lá?", timestamp_ms: 2000 },
        { sender_name: "Fernanda", content: "Oi, vocês entregam em Uberlândia?", timestamp_ms: 1000 },
        { sender_name: SELF, content: "Oi! Entregamos sim.", timestamp_ms: 3000 },
      ],
    });
  }

  function conversaSemTelefone(): RawExportFile {
    return jsonFile("export/messages/inbox/bruno_456/message_1.json", {
      participants: [{ name: SELF }, { name: "Bruno" }],
      messages: [
        { sender_name: "Bruno", content: "Quanto custa o produto azul?", timestamp_ms: 1000 },
        { sender_name: SELF, content: "R$ 150,00", timestamp_ms: 2000 },
      ],
    });
  }

  function conversaComTelefoneInvalido(): RawExportFile {
    return jsonFile("export/messages/inbox/carla_789/message_1.json", {
      participants: [{ name: SELF }, { name: "Carla" }],
      messages: [
        { sender_name: "Carla", content: "Tem em azul? Me chama no ramal 123", timestamp_ms: 1000 },
      ],
    });
  }

  it("[TESTE OBRIGATÓRIO] três conversas: com telefone vira grupo 1, sem telefone e com telefone inválido vão pro grupo 2 (descartado, não corrigido)", () => {
    const result = parseInstagramExport([conversaComTelefone(), conversaSemTelefone(), conversaComTelefoneInvalido()]);

    expect(result.withPhone).toHaveLength(1);
    expect(result.withPhone[0].name).toBe("Fernanda");
    expect(result.withPhone[0].phone).toBe("+5534998765432");

    expect(result.withoutPhone).toHaveLength(2);
    const nomes = result.withoutPhone.map((c) => c.name).sort();
    expect(nomes).toEqual(["Bruno", "Carla"]);
    // Carla tinha "123" no texto — não virou telefone nenhum, nem um
    // fabricado
    const carla = result.withoutPhone.find((c) => c.name === "Carla")!;
    expect(carla.phone).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] o resumo é a primeira mensagem da PESSOA (não a minha), e não passa de 200 caracteres", () => {
    const result = parseInstagramExport([conversaComTelefone()]);
    // mensagens vêm mais-recente-primeiro no export; a primeira da Fernanda
    // em ordem cronológica é "Oi, vocês entregam...", não a de telefone
    // (que veio depois) nem a da loja
    expect(result.withPhone[0].resumo).toBe("Oi, vocês entregam em Uberlândia?");

    const textoLongo = "x".repeat(300);
    const longResult = parseInstagramExport([
      jsonFile("export/messages/inbox/longo_1/message_1.json", {
        participants: [{ name: SELF }, { name: "Textao" }],
        messages: [{ sender_name: "Textao", content: textoLongo, timestamp_ms: 1000 }],
      }),
    ]);
    expect(longResult.withoutPhone[0].resumo).toHaveLength(200);
  });

  it("nome acentuado de participante e de conteúdo chega correto na saída do parse", () => {
    const nomeCorreto = "José Conceição";
    const contentCorreto = "Vocês têm em São Paulo?";
    const result = parseInstagramExport([
      jsonFile("export/messages/inbox/jose_1/message_1.json", {
        participants: [{ name: SELF }, { name: corruptLikeInstagram(nomeCorreto) }],
        messages: [{ sender_name: corruptLikeInstagram(nomeCorreto), content: corruptLikeInstagram(contentCorreto), timestamp_ms: 1000 }],
      }),
    ]);
    expect(result.withoutPhone[0].name).toBe(nomeCorreto);
    expect(result.withoutPhone[0].resumo).toBe(contentCorreto);
  });

  it("[TESTE OBRIGATÓRIO] nenhuma chamada de rede/IA acontece neste fluxo", () => {
    const fetchSpy = vi.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchSpy as any;
    try {
      parseInstagramExport([conversaComTelefone(), conversaSemTelefone(), conversaComTelefoneInvalido()]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("grupo (3+ participantes) é ignorado — não dá pra saber qual é 'o contato'", () => {
    const result = parseInstagramExport([
      jsonFile("export/messages/inbox/grupo_1/message_1.json", {
        participants: [{ name: SELF }, { name: "A" }, { name: "B" }],
        messages: [{ sender_name: "A", content: "oi", timestamp_ms: 1000 }],
      }),
    ]);
    expect(result.withPhone).toHaveLength(0);
    expect(result.withoutPhone).toHaveLength(0);
  });

  it("arquivo .zip: avisa pra descompactar, não tenta ler", () => {
    const result = parseInstagramExport([{ path: "export.zip", text: "" }]);
    expect(result.warning).toBe("needs_unzip");
    expect(result.withPhone).toHaveLength(0);
    expect(result.withoutPhone).toHaveLength(0);
  });

  it("exportação em HTML: avisa que precisa ser JSON, não tenta interpretar HTML", () => {
    const result = parseInstagramExport([{ path: "export/messages/inbox/fernanda_123/message_1.html", text: "<html></html>" }]);
    expect(result.warning).toBe("needs_json_export");
  });

  it("nenhuma conversa encontrada (pasta errada) avisa em vez de devolver silêncio", () => {
    const result = parseInstagramExport([{ path: "export/photos/foto.jpg", text: "" }]);
    expect(result.warning).toBe("no_conversations_found");
  });

  it("mídia (photos/, files/) é ignorada mesmo quando misturada com conversas de verdade", () => {
    const result = parseInstagramExport([
      conversaComTelefone(),
      { path: "export/messages/inbox/fernanda_123/photos/foto.jpg", text: "binario-fake" },
      { path: "export/messages/inbox/fernanda_123/files/arquivo.pdf", text: "binario-fake" },
    ]);
    expect(result.withPhone).toHaveLength(1);
  });
});

describe("buildInstagramImportPayload", () => {
  it("[TESTE OBRIGATÓRIO] nada além de nome, telefone e resumo sai do navegador", () => {
    const result = parseInstagramExport([
      jsonFile("export/messages/inbox/fernanda_123/message_1.json", {
        participants: [{ name: "Loja Do Bairro" }, { name: "Fernanda" }],
        messages: [
          { sender_name: "Fernanda", content: "Meu whatsapp é 34998765432", timestamp_ms: 2000 },
          { sender_name: "Fernanda", content: "Vocês entregam em Uberlândia?", timestamp_ms: 1000 },
          { sender_name: "Loja Do Bairro", content: "informação interna da loja, não pode vazar", timestamp_ms: 3000 },
        ],
      }),
    ]);

    const payload = buildInstagramImportPayload(result);
    const body = JSON.stringify(payload);

    // inspeciona o corpo da requisição — as ÚNICAS chaves por contato
    expect(payload.contacts).toHaveLength(1);
    expect(Object.keys(payload.contacts[0]).sort()).toEqual(["name", "perfil", "phone", "resumo"]);
    // conteúdo interno da loja (não é o resumo) nunca aparece no corpo
    expect(body).not.toContain("informação interna da loja");
    // dúvida de serviço vira o resumo, e o telefone vai no campo phone separado
    expect(payload.contacts[0].resumo).not.toContain("34998765432");
    expect(payload.contacts[0].resumo).toBe("Vocês entregam em Uberlândia?");
  });
});

describe("classifyInstagramConversation - Heurísticas Semânticas", () => {
  const SELF = "Loja Do Bairro";

  it("isTrivialGreetingOrReaction identifica saudações e risadas triviais", () => {
    expect(isTrivialGreetingOrReaction("Olá tô bem e vc ?")).toBe(true);
    expect(isTrivialGreetingOrReaction("tudo bem?")).toBe(true);
    expect(isTrivialGreetingOrReaction("Oi!")).toBe(true);
    expect(isTrivialGreetingOrReaction("Kkkk")).toBe(true);
    expect(isTrivialGreetingOrReaction("Hahahahahahaha 😂")).toBe(true);
    expect(isTrivialGreetingOrReaction("Bom dia, tudo bem?")).toBe(true);
    expect(isTrivialGreetingOrReaction("Oi, vocês entregam em Uberlândia?")).toBe(false);
    expect(isTrivialGreetingOrReaction("Quanto custa o produto azul?")).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] 'Olá tô bem e vc ?' NUNCA vira dúvida de serviço nem resumo comercial", () => {
    const classification = classifyInstagramConversation(
      [
        { sender_name: "FranFranz", content: "Olá tô bem e vc ?", timestamp_ms: 1000 },
      ],
      SELF,
      "FranFranz"
    );

    expect(classification.category).toBe("personal");
    expect(classification.intentLabel).toBe("Conversa Pessoal");
    expect(classification.intentLabel).not.toBe("Dúvida de Serviço");
    expect(classification.resumo).toContain("Olá tô bem e vc ?");
  });

  it("conversa com piada de cerveja ou academia ('Kkkk vou comprar a Itaipava', peito e dorsal) é classificada como pessoal", () => {
    const classItaipava = classifyInstagramConversation(
      [
        { sender_name: "Amigo", content: "Kkkk vou comprar a Itaipava", timestamp_ms: 1000 },
      ],
      SELF,
      "Amigo"
    );
    expect(classItaipava.category).toBe("personal");
    expect(classItaipava.intentLabel).toBe("Conversa Pessoal");
    expect(classItaipava.intentLabel).not.toBe("Dúvida de Serviço");

    const classTreino = classifyInstagramConversation(
      [
        { sender_name: "Diego", content: "Sim, hoje foi dia de peito e dorsal...", timestamp_ms: 1000 },
      ],
      SELF,
      "Diego"
    );
    expect(classTreino.category).toBe("personal");
    expect(classTreino.intentLabel).toBe("Conversa Pessoal");
    expect(classTreino.intentLabel).not.toBe("Dúvida de Serviço");
  });

  it("[TESTE OBRIGATÓRIO] conversa com telefone mas informal/pessoal é classificada como 'Contato Informado' (e NÃO 'Dúvida de Serviço')", () => {
    const classification = classifyInstagramConversation(
      [
        { sender_name: "FranFranz", content: "Olá tô bem e vc ?", timestamp_ms: 1000 },
        { sender_name: "FranFranz", content: "me chama no (34) 99937-9744", timestamp_ms: 2000 },
      ],
      SELF,
      "FranFranz"
    );

    expect(classification.category).toBe("lead");
    expect(classification.intentLabel).toBe("Contato Informado");
    expect(classification.intentLabel).not.toBe("Dúvida de Serviço");
    expect(classification.phone).toBe("+5534999379744");
    expect(classification.resumo).toBe("me chama no (34) 99937-9744");
  });

  it("conversa comercial com saudação anterior seleciona a dúvida real (>= 15 chars) e ignora a saudação", () => {
    const classification = classifyInstagramConversation(
      [
        { sender_name: "Cliente", content: "Oi! Tudo bem?", timestamp_ms: 1000 },
        { sender_name: "Cliente", content: "Vocês têm pronta entrega do produto azul?", timestamp_ms: 2000 },
      ],
      SELF,
      "Cliente"
    );

    expect(classification.category).toBe("lead");
    expect(classification.intentLabel).toBe("Dúvida de Serviço");
    expect(classification.resumo).toBe("Vocês têm pronta entrega do produto azul?");
    expect(classification.resumo).not.toContain("Oi! Tudo bem?");
  });
});

describe("formatInstagramDirectMessage", () => {
  it("monta mensagem com o nome e o resumo da primeira mensagem", () => {
    const msg = formatInstagramDirectMessage("Fernanda", "Vocês entregam em Uberlândia?");
    expect(msg).toBe(
      "Oi Fernanda! Vi sua mensagem sobre 'Vocês entregam em Uberlândia?'. Me passa seu WhatsApp por aqui que te explico tudo em detalhes por lá rapidinho!"
    );
  });

  it("monta mensagem sem resumo quando vazio ou nulo", () => {
    const msg = formatInstagramDirectMessage("Bruno", "");
    expect(msg).toBe(
      "Oi Bruno! Vi sua mensagem no Direct. Me passa seu WhatsApp por aqui que te explico tudo em detalhes por lá rapidinho!"
    );
  });
});
