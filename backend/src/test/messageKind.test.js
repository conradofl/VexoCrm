// O rótulo "[Mensagem]" não existe mais: cada tipo do WhatsApp vira o conteúdo que tem, ou o nome do tipo.
import { describe, expect, it } from "vitest";
import { detectMessageType, extractTextFromBody } from "../chatbot-ai-engine.js";
import { rawMessageKind } from "../services/messageKind.js";

const body = (message) => ({ data: { key: { remoteJid: "5534990000001@s.whatsapp.net", fromMe: false }, message } });
const text = (message) => extractTextFromBody(body(message));

describe("texto que vinha embrulhado e virava [Mensagem]", () => {
  it("mensagem temporária mostra o texto de verdade", () => {
    const message = { messageContextInfo: {}, ephemeralMessage: { message: { extendedTextMessage: { text: "Quero o orçamento" } } } };
    expect(text(message)).toBe("Quero o orçamento");
    expect(detectMessageType(body(message))).toBe("text");
  });

  it("visualização única com imagem é reconhecida como imagem", () => {
    const message = { viewOnceMessageV2: { message: { imageMessage: { caption: "Foto da fachada" } } } };
    expect(detectMessageType(body(message))).toBe("image");
    expect(text(message)).toBe("Foto da fachada");
  });

  it("áudio dentro de mensagem temporária é reconhecido como áudio", () => {
    expect(detectMessageType(body({ ephemeralMessage: { message: { audioMessage: { seconds: 4 } } } }))).toBe("audio");
  });
});

describe("tipos que não são texto ganham conteúdo ou nome", () => {
  it.each([
    ["localização com nome e endereço", { locationMessage: { name: "Padaria Central", address: "Rua A, 10", degreesLatitude: -18.9, degreesLongitude: -48.2 } }, "[Localização] Padaria Central · Rua A, 10"],
    ["localização só com coordenadas", { locationMessage: { degreesLatitude: -18.91234, degreesLongitude: -48.27654 } }, "[Localização] -18.91234, -48.27654"],
    ["localização em tempo real", { liveLocationMessage: {} }, "[Localização em tempo real]"],
    ["contato", { contactMessage: { displayName: "Marcos Eletricista" } }, "[Contato] Marcos Eletricista"],
    ["vários contatos", { contactsArrayMessage: { contacts: [{ displayName: "Ana" }, { displayName: "Beto" }] } }, "[Contatos] Ana, Beto"],
    ["enquete", { pollCreationMessageV3: { name: "Qual horário?" } }, "[Enquete] Qual horário?"],
    ["voto em enquete", { pollUpdateMessage: {} }, "[Voto em enquete]"],
    ["modelo com botão mostra o texto do modelo", { templateMessage: { hydratedTemplate: { hydratedContentText: "Confirme sua presença" } } }, "Confirme sua presença"],
    ["botões mostram o texto", { buttonsMessage: { contentText: "Escolha uma opção" } }, "Escolha uma opção"],
    ["botão sem texto", { buttonsMessage: {} }, "[Botão]"],
    ["lista mostra a descrição", { listMessage: { title: "Planos", description: "Veja os planos" } }, "Veja os planos"],
    ["lista só com título", { listMessage: { title: "Planos" } }, "[Lista] Planos"],
    ["mensagem apagada", { protocolMessage: { type: "REVOKE" } }, "[Mensagem apagada]"],
    ["mensagem editada mostra o texto novo", { editedMessage: { message: { protocolMessage: { type: "MESSAGE_EDIT", editedMessage: { conversation: "Às 15h, não 14h" } } } } }, "[Mensagem editada] Às 15h, não 14h"],
    ["convite de grupo", { groupInviteMessage: { groupName: "Obra Jardim" } }, "[Convite de grupo] Obra Jardim"],
    ["vídeo de recado", { ptvMessage: {} }, "[Vídeo de recado]"],
  ])("%s", (_name, message, expected) => {
    expect(text(message)).toBe(expected);
  });

  it("tipo sem nome em português diz o tipo técnico, nunca [Mensagem]", () => {
    const message = { messageContextInfo: {}, stickerPackMessage: { name: "pack" } };
    expect(text(message)).toBe("[Tipo não reconhecido: stickerPackMessage]");
    expect(rawMessageKind(message)).toBe("stickerPackMessage");
  });

  it("mensagem que chegou sem conteúdo diz isso", () => {
    expect(text({})).toBe("[Mensagem sem conteúdo]");
    expect(text({ messageContextInfo: {} })).toBe("[Mensagem sem conteúdo]");
    expect(rawMessageKind({ messageContextInfo: {} })).toBeNull();
  });

  it("nenhum caso devolve o rótulo antigo", () => {
    for (const message of [{}, { locationMessage: {} }, { contactMessage: {} }, { protocolMessage: {} }, { algoNovoMessage: {} }]) {
      expect(text(message)).not.toBe("[Mensagem]");
      expect(text(message).length).toBeGreaterThan(2);
    }
  });
});

describe("o que já funcionava continua igual", () => {
  it.each([
    [{ conversation: "oi" }, "oi", "text"],
    [{ extendedTextMessage: { text: "bom dia" } }, "bom dia", "text"],
    [{ imageMessage: {} }, "[Imagem]", "image"],
    [{ audioMessage: {} }, "[Áudio]", "audio"],
    [{ stickerMessage: {} }, "[Sticker]", "sticker"],
    [{ buttonsResponseMessage: { selectedDisplayText: "Sim" } }, "Sim", "interactive"],
  ])("%j", (message, expectedText, expectedType) => {
    expect(text(message)).toBe(expectedText);
    expect(detectMessageType(body(message))).toBe(expectedType);
  });
});
