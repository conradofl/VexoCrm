// /health -> llmConfig (PR 5 parte 2 do untangle, 25/11/2026). Prova, sem abrir o EasyPanel, qual modelo cada
// variável escolhe em produção antes de separar "modelo de campanha" de "modelo do agente".
// - modelos: o id do modelo é nome público do provedor, não segredo; vai como está. Valor que não parece id
//   de modelo (tem espaço, é longo demais) vira só true, para nunca vazar algo colado na variável errada.
// - chaves: só sim/não. Nunca o valor.
import { GROQ_MODELOS_MORTOS, llmModelLadder, resolveLlmLadder } from "./llmModels.js";

export const LLM_MODEL_ENVS = [
  "GROQ_CAMPAIGN_AI_MODEL",
  "LLM_MODEL_LADDER",
  "GROQ_MODEL",
  "LLM_VISION_MODEL",
  "GROQ_VISION_MODEL",
  "GROQ_TRANSCRIBE_MODEL",
  "RAG_EMBEDDING_MODEL",
];
export const LLM_KEY_ENVS = ["GROQ_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];

const PARECE_MODELO = /^[A-Za-z0-9._/:-]+(,[A-Za-z0-9._/:-]+)*$/;

function valorDeModelo(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const v = raw.trim().replace(/\s*,\s*/g, ",");
  if (v.length > 200 || !PARECE_MODELO.test(v)) return true;
  return v;
}

export function computeLlmConfigStatus(env = process.env) {
  const modelos = {};
  for (const nome of LLM_MODEL_ENVS) modelos[nome] = valorDeModelo(env[nome]);
  const chaves = {};
  for (const nome of LLM_KEY_ENVS) chaves[nome] = typeof env[nome] === "string" && env[nome].trim() !== "";
  const campanha = typeof modelos.GROQ_CAMPAIGN_AI_MODEL === "string" ? modelos.GROQ_CAMPAIGN_AI_MODEL : null;
  return {
    modelos,
    chaves,
    escadaPadrao: llmModelLadder(),
    // O que uma chamada sem modelo pedido tenta (desde o PR 5.2b não inclui mais GROQ_CAMPAIGN_AI_MODEL).
    escadaDoAgenteSemModelo: resolveLlmLadder(null),
    modeloDeCampanhaMorto: campanha ? GROQ_MODELOS_MORTOS.has(campanha) : null,
  };
}
