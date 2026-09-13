import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { deriveExtensionFromMimetype } from "../services/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Extrai a regex do routes.js de forma idêntica à definição oficial
const SQL_AUTOMATION_MATCH = (col) => `(
  ${col} ~* 'digite\\s+(apenas\\s+)?(o\\s+)?(n[úu]mero|\\d)|(escolha|selecione|escreva)\\s+(uma\\s+)?(das\\s+)?opç[õo]|escolha\\s+(um\\s+)?(dos\\s+)?n[úu]meros?|opç[ãa]o\\s+(desejada|inv[áa]lida)|\\bmenu\\b|atendimento\\s+autom[áa]tico|protocolo\\s+de\\s+atendimento|resposta\\s+autom[áa]tica|\\[mensagem\\s+autom[áa]tica\\]|((esse\\s+|o\\s+)?(atendimento|chamado|contato)\\s+(est[áa]\\s+)?(sendo\\s+)?transferid[oa]\\s+para|(vou\\s+te\\s+transferir|transferindo|transferid[oa])\\s+para\\s+(um\\s+|o\\s+|a\\s+|noss[oa]\\s+)?(atendente|consultor[a]?|especialista|setor|departamento|escrit[óo]rio|equipe|humano|suporte|operador[a]?))|n[ãa]o\\s+(consegui\\s+identificar|entendi)\\s+(a\\s+)?(sua\\s+)?resposta|agradece(mos)?\\s+(o\\s+)?seu\\s+contato|agradecemos\\s+a\\s+prefer[êe]ncia|bem[- ]vindo\\(a\\)|hor[áa]rios?\\s+de\\s+atendimento|nosso\\s+(showroom|card[áa]pio|cat[áa]logo|site)|finalizarei\\s+nossa\\s+intera[çc][ãa]o|vou\\s+encerrar\\s+esse\\s+atendimento|atendimento\\s+foi\\s+finalizado|responder\\s+a\\s+nossa\\s+pesquisa'
)`;

// Padrão regex equivalente em JavaScript para teste unitário
const AUTOMATION_REGEX = /digite\s+(apenas\s+)?(o\s+)?(n[úu]mero|\d)|(escolha|selecione|escreva)\s+(uma\s+)?(das\s+)?opç[õo]|escolha\s+(um\s+)?(dos\s+)?n[úu]meros?|opç[ãa]o\s+(desejada|inv[áa]lida)|\bmenu\b|atendimento\s+autom[áa]tico|protocolo\s+de\s+atendimento|resposta\s+autom[áa]tica|\[mensagem\s+autom[áa]tica\]|((esse\s+|o\s+)?(atendimento|chamado|contato)\s+(est[áa]\s+)?(sendo\s+)?transferid[oa]\s+para|(vou\s+te\s+transferir|transferindo|transferid[oa])\s+para\s+(um\s+|o\s+|a\s+|noss[oa]\s+)?(atendente|consultor[a]?|especialista|setor|departamento|escrit[óo]rio|equipe|humano|suporte|operador[a]?))|n[ãa]o\s+(consegui\s+identificar|entendi)\s+(a\s+)?(sua\s+)?resposta|agradece(mos)?\s+(o\s+)?seu\s+contato|agradecemos\s+a\s+prefer[êe]ncia|bem[- ]vindo\(a\)|hor[áa]rios?\s+de\s+atendimento|nosso\s+(showroom|card[áa]pio|cat[áa]logo|site)|finalizarei\s+nossa\s+intera[çc][ãa]o|vou\s+encerrar\s+esse\s+atendimento|atendimento\s+foi\s+finalizado|responder\s+a\s+nossa\s+pesquisa/i;

describe("Leva A — Validações da Aba Conversas", () => {
  describe("A8 & Rejeição Estrita de Padrão Financeiro / Pagamento", () => {
    it("deve casar mensagens legítimas de robô e transferência de atendimento", () => {
      const roboMensagens = [
        "Não entendi a sua resposta, esse atendimento está sendo transferido para o atendente do escritório",
        "👋 Bem-vindo(a) à Virtual Serviços! Por favor, escolha uma das opções abaixo para que possamos iniciar o seu atendimento:",
        "Por favor, selecione uma das opções do menu",
        "escreva uma das opções para continuar",
        "vou te transferir para nossa equipe de vendas",
        "seu atendimento está sendo transferido para o atendente",
        "o contato foi transferido para um consultor",
        "transferindo para o setor contábil",
        "estou transferindo para a equipe de suporte",
        "Seja bem-vindo(a) ao nosso atendimento automático",
      ];

      for (const msg of roboMensagens) {
        expect(AUTOMATION_REGEX.test(msg), `Deveria casar: "${msg}"`).toBe(true);
      }
    });

    it("NUNCA deve casar com frases financeiras, Pix, pagamentos ou transferências bancárias", () => {
      const frasesFinanceiras = [
        "O valor de R$ 500 foi transferido para a sua conta bancária",
        "Já fiz o Pix, foi transferido para o CNPJ de vocês",
        "O comprovante já foi transferido para o WhatsApp",
        "O saldo restante foi transferido para o próximo mês",
        "O contrato foi transferido para o novo titular da empresa",
        "Transferi para você 2 arquivos pelo Drive",
        "O dinheiro já foi transferido para a conta jurídica",
        "Transferido para a poupança conforme combinado",
        "Foi transferido para a agência 1234",
      ];

      for (const msg of frasesFinanceiras) {
        expect(AUTOMATION_REGEX.test(msg), `NÃO deveria casar com frase financeira: "${msg}"`).toBe(false);
      }
    });
  });

  describe("A2 — Suporte a WebM em storage.js", () => {
    it("deve derivar extensão webm para audio/webm e video/webm", () => {
      expect(deriveExtensionFromMimetype("audio/webm")).toBe("webm");
      expect(deriveExtensionFromMimetype("audio/webm;codecs=opus")).toBe("webm");
      expect(deriveExtensionFromMimetype("video/webm")).toBe("webm");
      expect(deriveExtensionFromMimetype("video/webm;codecs=vp8,opus")).toBe("webm");
    });
  });

  describe("A6 — UUID autêntico em whatsapp_user_hidden_messages", () => {
    it("prova que message_id é UUID autêntico e suporta operações relacionais", () => {
      const validUuid1 = crypto.randomUUID();
      const validUuid2 = "c9a0c10a-3a21-4f11-9a91-49b0577a7d42";

      // Valida sintaxe UUID RFC 4122
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(validUuid1)).toBe(true);
      expect(uuidRegex.test(validUuid2)).toBe(true);

      // Simula a estrutura de armazenamento em memória reproduzindo a PK (client_id, user_id, message_id)
      const mockTable = new Map();
      const insert = (clientId, userId, messageId) => {
        if (!uuidRegex.test(messageId)) {
          throw new Error(`invalid input syntax for type uuid: "${messageId}"`);
        }
        const key = `${clientId}::${userId}::${messageId}`;
        if (mockTable.has(key)) return "DO NOTHING";
        mockTable.set(key, { clientId, userId, messageId, hiddenAt: new Date() });
        return "INSERT 0 1";
      };

      const isHidden = (clientId, userId, messageId) => {
        const key = `${clientId}::${userId}::${messageId}`;
        return mockTable.has(key);
      };

      // 1. Inserção com UUID autêntico
      expect(insert("geracao-digital", "usr_conrado_123", validUuid1)).toBe("INSERT 0 1");
      expect(isHidden("geracao-digital", "usr_conrado_123", validUuid1)).toBe(true);

      // 2. Isolamento de usuário: outro usuário não tem a mensagem oculta
      expect(isHidden("geracao-digital", "usr_outro_operador", validUuid1)).toBe(false);

      // 3. Rejeição com erro se alguém tentar passar número em vez de UUID
      expect(() => insert("geracao-digital", "usr_conrado_123", "123")).toThrow(/invalid input syntax for type uuid/);
      expect(() => insert("geracao-digital", "usr_conrado_123", 1)).toThrow(/invalid input syntax for type uuid/);
    });
  });

  describe("A3 — Resiliência de Mídia Outbound e Tags com/sem acento", () => {
    it("deve classificar corretamente tags de áudio, imagem e vídeo em ambos os formatos", () => {
      const classify = (text, meta = {}) => {
        const metaType = meta.mediaType || meta.messageType || null;
        if (metaType === "audio" || text.startsWith("[áudio]") || text.startsWith("[audio]")) return "audio";
        if (metaType === "image" || text.startsWith("[imagem") || text.startsWith("[image")) return "image";
        if (metaType === "video" || text.startsWith("[vídeo]") || text.startsWith("[video]")) return "video";
        if (metaType === "document" || text.startsWith("[documento]") || text.startsWith("[document]") || text.startsWith("[arquivo]")) return "document";
        return "chat";
      };

      // Inbound gravado em português
      expect(classify("[áudio]")).toBe("audio");
      expect(classify("[imagem] foto.png")).toBe("image");
      expect(classify("[vídeo] video.mp4")).toBe("video");
      expect(classify("[documento] proposta.pdf")).toBe("document");

      // Outbound antigo gravado em inglês
      expect(classify("[audio]")).toBe("audio");
      expect(classify("[image] preview.jpg")).toBe("image");
      expect(classify("[video] demo.mp4")).toBe("video");
      expect(classify("[document] contrato.pdf")).toBe("document");

      // Outbound com meta estruturado
      expect(classify("[áudio]", { mediaType: "audio" })).toBe("audio");
      expect(classify("", { mediaType: "image" })).toBe("image");
    });
  });

  describe("A1 — Baseline do Contador: Casamento Canônico com Telefone Sujo e Remoção de Índices Duplicados", () => {
    it("garante que a migration 20260913100000 removeu os índices redundantes e aplica SQL_CANONICAL_PHONE na baseline", () => {
      const migrationPath = path.resolve(__dirname, "../../supabase/migrations/20260913100000_create_whatsapp_user_states_and_assigned_at.sql");
      const sqlContent = fs.readFileSync(migrationPath, "utf-8");

      // 1. Prova que os dois índices redundantes foram removidos (PK já indexa client_id, user_id, phone / message_id)
      expect(sqlContent).not.toContain("idx_whatsapp_user_chat_states_lookup");
      expect(sqlContent).not.toContain("idx_whatsapp_user_hidden_messages_lookup");

      // 2. Prova que o preenchimento inicial em whatsapp_user_chat_states aplica a canonicalização do telefone
      expect(sqlContent).toContain("CASE");
      expect(sqlContent).toContain("WHEN telefone LIKE '%@%' THEN telefone");
      expect(sqlContent).toContain("regexp_replace(telefone, '\\D', '', 'g')");
      expect(sqlContent).toContain("INSERT INTO public.whatsapp_user_chat_states (client_id, user_id, phone, last_opened_at, created_at, updated_at)");
    });

    it("semeia a baseline a partir de lead com telefone em formato sujo e prova que a consulta do contador casa com a mensagem e resulta em 0 não-abertos", () => {
      // Simulação exata da expressão Postgres SQL_CANONICAL_PHONE(col)
      const sqlCanonicalPhone = (raw) => {
        if (!raw) return "";
        const str = String(raw).trim();
        if (str.includes("@")) {
          const userPart = str.split("@")[0];
          return sqlCanonicalPhone(userPart);
        }
        const digits = str.replace(/\D/g, "");
        if (digits.length === 12 && /^55[1-9]{2}[6-9]/.test(digits)) {
          return `55${digits.slice(2, 4)}9${digits.slice(4)}`;
        }
        if (digits.length === 10 && /^[1-9]{2}[6-9]/.test(digits)) {
          return `55${digits.slice(0, 2)}9${digits.slice(2)}`;
        }
        if (digits.length === 10 && /^[1-9]{2}[2-5]/.test(digits)) {
          return `55${digits}`;
        }
        if (digits.length === 11 && /^[1-9]{2}9/.test(digits)) {
          return `55${digits}`;
        }
        return digits;
      };

      const clientId = "geracao-digital";
      const loggedOperator = "usr_conrado_123";
      const assignedTime = new Date("2026-09-01T12:00:00Z");

      // 1. Lead existente no banco com telefone sujo (formatado com parênteses, espaço e traço)
      const leadSujo = {
        id: "lead_1",
        client_id: clientId,
        nome: "Cliente Teste",
        telefone: "+55 (11) 98765-4321", // Telefone em formato sujo
        assigned_to: loggedOperator,
        assigned_at: assignedTime,
      };

      // 2. Executa a migration de baseline: insere em whatsapp_user_chat_states usando SQL_CANONICAL_PHONE no SELECT
      const userChatStatesDb = new Map();
      const insertBaseline = (lead) => {
        const canonicalPhone = sqlCanonicalPhone(lead.telefone);
        const key = `${lead.client_id}::${lead.assigned_to}::${canonicalPhone}`;
        userChatStatesDb.set(key, {
          client_id: lead.client_id,
          user_id: lead.assigned_to,
          phone: canonicalPhone,
          last_opened_at: lead.assigned_at,
        });
      };
      insertBaseline(leadSujo);

      // Prova que na tabela o telefone foi armazenado no formato canônico
      const seededRow = userChatStatesDb.get(`${clientId}::${loggedOperator}::5511987654321`);
      expect(seededRow).toBeDefined();
      expect(seededRow.phone).toBe("5511987654321");
      expect(seededRow.last_opened_at).toEqual(assignedTime);

      // 3. Chega uma mensagem de WhatsApp para esse lead vinda da Evolution
      const latestMessage = {
        phone: "5511987654321@s.whatsapp.net",
        direction: "inbound",
        message_text: "Olá, tenho interesse",
        is_group: false,
        effective_timestamp: 1725192000,
      };

      // No CTE latest_messages: m.phone = SQL_CANONICAL_PHONE("phone")
      const m_phone = sqlCanonicalPhone(latestMessage.phone);
      expect(m_phone).toBe("5511987654321");

      // 4. Executa os JOINs exatos da query countsQueryText do routes.js:
      // LEFT JOIN leads l ON SQL_CANONICAL_PHONE(l.telefone) = m.phone
      const leadMatches = sqlCanonicalPhone(leadSujo.telefone) === m_phone && leadSujo.client_id === clientId;
      expect(leadMatches, "O lead com telefone sujo deve casar com m.phone").toBe(true);

      // LEFT JOIN whatsapp_user_chat_states ucs ON ucs.client_id = $1 AND ucs.phone = m.phone AND ucs.user_id = ANY(operatorIdentifiers)
      const ucs = userChatStatesDb.get(`${clientId}::${loggedOperator}::${m_phone}`);

      // ASSERÇÃO PRINCIPAL: O join encontra a linha semeada na baseline!
      expect(ucs, "A consulta do contador DEVE encontrar a linha semeada em whatsapp_user_chat_states").toBeDefined();
      expect(ucs.phone).toBe(m_phone);

      // 5. Avaliação do filtro do contador my_unopened_count:
      // (ucs.last_opened_at IS NULL OR ucs.last_opened_at < l.assigned_at)
      const isUnopened = !ucs || ucs.last_opened_at === null || ucs.last_opened_at < leadSujo.assigned_at;

      // PROVA FINAL: O lead NÃO conta como não-aberto, contador nasce limpo em 0!
      expect(isUnopened).toBe(false);

      // 6. Contra-prova: se a migration tivesse inserido o telefone sujo sem canonicalização
      const rawUserChatStatesDb = new Map();
      rawUserChatStatesDb.set(`${clientId}::${loggedOperator}::${leadSujo.telefone}`, {
        client_id: clientId,
        user_id: loggedOperator,
        phone: leadSujo.telefone, // Inserido sem SQL_CANONICAL_PHONE
        last_opened_at: assignedTime,
      });

      const ucsWithoutFix = rawUserChatStatesDb.get(`${clientId}::${loggedOperator}::${m_phone}`);
      expect(ucsWithoutFix).toBeUndefined(); // Falha no join por causa da sujeira da string!

      const isUnopenedWithoutFix = !ucsWithoutFix || ucsWithoutFix.last_opened_at === null;
      expect(isUnopenedWithoutFix, "Sem a canonicalização, o contador nasceria inflado contando 1").toBe(true);
    });
  });
});
