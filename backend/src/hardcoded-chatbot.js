/**
 * Hardcoded Chatbot Engine
 * Fluxo de conversa fixo em código (estável), dados variáveis salvos incrementalmente em tempo real
 */

import { createClient as createRedisClient } from "redis";

let redisClient = null;

function initializeRedisClientNow() {
  if (redisClient) return redisClient;

  const host = process.env.REDIS_HOST || "localhost";
  const port = parseInt(process.env.REDIS_PORT || "6379");
  const username = process.env.REDIS_USERNAME || undefined;
  const password = process.env.REDIS_PASSWORD || undefined;

  console.log("[redis-chat] Conectando:", { host, port, hasUser: !!username, hasPass: !!password });

  redisClient = createRedisClient({
    host,
    port,
    username,
    password,
    db: 1,
  });

  redisClient.on("error", (err) => console.error("[redis-chat] Erro:", err.message));

  return redisClient;
}

export async function initializeRedisChat() {
  // Redis será conectado quando primeiro for usado (lazy loading)
  console.info("[redis-chat] ✅ Sistema pronto - Redis lazy loading ativado");
}

// Função para recuperar memória do PostgreSQL (fallback quando Redis não está disponível)
let supabaseClientRef = null;
export function setSupabaseClient(supabase) {
  supabaseClientRef = supabase;
}

function leadsTable(clientId) {
  return "leads";
}

async function getChatMemoryFromPostgres(phone, clientId) {
  if (!supabaseClientRef) return null;
  try {
    const { data: dataArray, error } = await supabaseClientRef
      .from(leadsTable(clientId))
      .select("*")
      .eq("client_id", clientId)
      .eq("telefone", phone)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) {
      console.warn("[redis-chat] Query error:", error.message);
      return null;
    }

    const data = dataArray?.[0] || null;
    if (!data) {
      console.log("[redis-chat] No record found for", { clientId, phone: phone.slice(-4) });
      return null;
    }

    const dados = data.dados || {};
    const currentStepId = dados._currentStepId || "situation_interest";
    const { _currentStepId, ...collectedData } = dados; // Exclude _currentStepId from collectedData

    console.log("[redis-chat] Memory loaded for", { clientId, phone: phone.slice(-4), currentStepId, collectedDataKeys: Object.keys(collectedData) });

    return {
      phone,
      clientId,
      currentStepId,
      collectedData,
      status: data.status_conversa || "em_atendimento",
      startedAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch (err) {
    console.warn("[redis-chat] Error reading from PostgreSQL:", err.message);
    return null;
  }
}

export async function getChatMemory(phone, clientId) {
  // Redis desabilitado - usando apenas PostgreSQL
  return await getChatMemoryFromPostgres(phone, clientId);
}

export async function setChatMemory(phone, clientId, memory, ttlSeconds = 86400) {
  if (!supabaseClientRef || !memory) return;

  try {
    // Buscar registro existente
    const { data: existingArray, error: fetchErr } = await supabaseClientRef
      .from(leadsTable(clientId))
      .select("id, mensagem")
      .eq("client_id", clientId)
      .eq("telefone", phone)
      .order("created_at", { ascending: false })
      .limit(1);

    const existing = existingArray?.[0] || null;

    const dadosToSave = {
      ...memory.collectedData,
      _currentStepId: memory.currentStepId, // Store current step in dados
    };

    const payload = {
      client_id: clientId,
      telefone: phone,
      status_conversa: memory.status,
      dados: dadosToSave,
      mensagem: memory.lastMessage || "Conversa ativa",
      finalizado: memory.status === "finalizado",
      updated_at: new Date().toISOString(),
    };

    console.log("[redis-chat] Saving payload with dados:", { currentStepId: dadosToSave._currentStepId, keys: Object.keys(dadosToSave) });

    if (existing?.id) {
      // Atualizar
      console.log("[redis-chat] Updating record id:", existing.id);
      const { data: updated, error } = await supabaseClientRef
        .from(leadsTable(clientId))
        .update(payload)
        .eq("id", existing.id)
        .select();
      if (error) {
        console.error("[redis-chat] Update error:", error);
        throw error;
      }
      console.log("[redis-chat] Updated successfully, rows:", updated?.length);
    } else {
      // Inserir novo
      console.log("[redis-chat] Inserting new record");
      const { data: inserted, error } = await supabaseClientRef
        .from(leadsTable(clientId))
        .insert([{ ...payload, created_at: new Date().toISOString() }])
        .select();
      if (error) {
        console.error("[redis-chat] Insert error:", error);
        throw error;
      }
      console.log("[redis-chat] Inserted successfully");
    }
    console.log("[redis-chat] Memory saved for", { clientId, phone: phone.slice(-4), currentStepId: memory.currentStepId });
  } catch (err) {
    console.warn("[redis-chat] Error saving memory to PostgreSQL:", err.message);
  }
}

export async function clearChatMemory(phone, clientId) {
  // Redis desabilitado
}

/**
 * Estrutura de passo do chatbot
 * Cada passo tem: pergunta, validação, próximo passo, campo a salvar
 */
export class ChatbotStep {
  constructor(config) {
    this.id = config.id;
    this.message = config.message; // Pergunta ou mensagem
    this.dataField = config.dataField; // Campo em lead_import_items
    this.validator = config.validator; // Função (response) => { valid: bool, error?: string }
    this.nextStepId = config.nextStepId; // Próximo passo ou null (fim)
    this.shouldAsk = config.shouldAsk || (() => true); // Função para decidir se pergunta
  }
}

/**
 * Classe base para modelos de chatbot
 */
export class HardcodedChatbot {
  constructor(clientId, modelConfig) {
    this.clientId = clientId;
    this.steps = new Map(); // id -> ChatbotStep
    this.startStepId = null;
    this.loadConfig(modelConfig);
  }

  loadConfig(modelConfig) {
    this.steps.clear();
    modelConfig.steps?.forEach((step) => {
      this.steps.set(step.id, new ChatbotStep(step));
    });
    this.startStepId = modelConfig.startStepId;
  }

  /**
   * Processa resposta do usuário e retorna próximo passo
   */
  async processResponse(phone, userMessage, currentData = {}) {
    let memory = await getChatMemory(phone, this.clientId);

    if (!memory) {
      // Se não há memória, criar nova conversa
      const initResult = await this.initializeChat(phone);
      // Após inicializar, tentar processar a resposta novamente
      if (initResult.status === "started") {
        memory = await getChatMemory(phone, this.clientId);
      } else {
        return initResult;
      }
    }

    if (!memory) {
      return { error: "Failed to initialize chat", status: "failed" };
    }

    const currentStep = this.steps.get(memory.currentStepId);
    if (!currentStep) {
      return { error: "Invalid current step", status: "failed" };
    }

    // Validar resposta
    const validation = currentStep.validator(userMessage);
    if (!validation.valid) {
      return {
        message: validation.error || "Resposta inválida",
        status: "invalid_response",
        retryStepId: memory.currentStepId,
      };
    }

    // Salvar dado coletado
    if (currentStep.dataField) {
      memory.collectedData[currentStep.dataField] = userMessage;
    }

    // Determinar próximo passo
    const nextStepId = currentStep.nextStepId;

    if (!nextStepId) {
      // Conversa finalizada
      memory.status = "finalizado";
      memory.finishedAt = new Date().toISOString();
      memory.lastMessage = "Obrigado! Suas informações foram salvas.";
      await setChatMemory(phone, this.clientId, memory);
      return {
        message: "Obrigado! Suas informações foram salvas.",
        status: "completed",
        collectedData: memory.collectedData,
      };
    }

    // Próximo passo
    const nextStep = this.steps.get(nextStepId);
    if (!nextStep) {
      memory.status = "error";
      memory.lastMessage = "Erro na configuração do fluxo";
      await setChatMemory(phone, this.clientId, memory);
      return { error: "Invalid next step configuration", status: "failed" };
    }

    // Decidir se faz a pergunta
    if (nextStep.shouldAsk(memory.collectedData)) {
      memory.currentStepId = nextStepId;
      memory.updatedAt = new Date().toISOString();
      memory.lastMessage = nextStep.message;
      await setChatMemory(phone, this.clientId, memory);
      return {
        message: nextStep.message,
        status: "next_step",
        stepId: nextStepId,
        collectedData: memory.collectedData,
      };
    }

    // Pular passo - ir para o próximo do próximo
    if (nextStep.nextStepId) {
      return this.processResponse(phone, "", memory.collectedData);
    }

    // Fim
    memory.status = "finalizado";
    memory.finishedAt = new Date().toISOString();
    memory.lastMessage = "Obrigado! Suas informações foram salvas.";
    await setChatMemory(phone, this.clientId, memory);
    return {
      message: "Obrigado! Suas informações foram salvas.",
      status: "completed",
      collectedData: memory.collectedData,
    };
  }

  /**
   * Inicializa nova conversa
   */
  async initializeChat(phone) {
    if (!this.startStepId) {
      return { error: "Chatbot not configured", status: "failed" };
    }

    const startStep = this.steps.get(this.startStepId);
    if (!startStep) {
      return { error: "Start step not found", status: "failed" };
    }

    const memory = {
      phone,
      clientId: this.clientId,
      currentStepId: this.startStepId,
      collectedData: {},
      status: "em_atendimento",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastMessage: startStep.message,
    };

    await setChatMemory(phone, this.clientId, memory);

    return {
      message: startStep.message,
      status: "started",
      stepId: this.startStepId,
    };
  }

  /**
   * Valida se dados coletados atendem requisitos mínimos
   */
  validateCollectedData(data) {
    // Pode ser sobrescrito por subclasses
    return { valid: true };
  }

  /**
   * Gera resumo/métricas da conversa
   */
  generateMetrics(memory) {
    return {
      durationSeconds: memory.finishedAt
        ? Math.round(
            (new Date(memory.finishedAt) - new Date(memory.startedAt)) / 1000
          )
        : Math.round((new Date() - new Date(memory.startedAt)) / 1000),
      stepsCompleted: Object.keys(memory.collectedData).length,
      isCompleted: memory.status === "finalizado",
      status: memory.status,
    };
  }
}

export default HardcodedChatbot;
