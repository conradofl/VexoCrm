/**
 * Modelo LLM da Groq utilizado como primeiro degrau padrão na escada de modelos.
 * Sincronizado com o primeiro degrau de GROQ_MODEL_LADDER_PADRAO do backend (services/llmModels.js).
 */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

export function defaultGroqModel(): string {
  return DEFAULT_GROQ_MODEL;
}
