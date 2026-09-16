// backend/src/services/embeddings.js
//
// Camada única de geração de embedding pra Base de Conhecimento RAG. O provedor
// é escolhido por variável de ambiente (RAG_EMBEDDING_PROVIDER) — trocar de um
// pra outro é mudar a variável. Nenhuma outra parte do código (indexação, busca
// no chatbot-ai-engine.js) sabe qual provedor está em uso: todas chamam só
// `embedTexts(textos)`.
//
// Provedores:
//   "gemini" (padrão, e o ÚNICO escolhido automaticamente) — text-embedding-004
//     via GEMINI_API_KEY. Rede, cobrado (camada gratuita com limite de
//     chamadas/minuto — daí o lote com espaçamento e retry em erro temporário).
//   "lexical" — sem chave, sem rede, NUNCA escolhido por padrão. Não é um
//     modelo de embedding — o nome antigo ("local") sugeria que era uma
//     segunda implementação do mesmo tipo de coisa, e não é: é um vetorizador
//     determinístico por hashing de trigramas de caracteres. Compara letras em
//     comum, não significado. "Vocês parcelam?" e "12x sem juros" têm zero
//     trigrama em comum — o Gemini acha essa resposta, o lexical não acha
//     nada. Serve bem pra teste automatizado (sem rede, determinístico) e pra
//     emergência declarada — nunca pra produção sem alguém ter decidido isso
//     explicitamente (por isso não há fallback automático de gemini pra
//     lexical em erro nenhum: sem GEMINI_API_KEY, embedTexts FALHA, não
//     rebaixa a qualidade em silêncio).
//
// Se um dia precisar de embedding local de qualidade neural de verdade
// (ex.: @xenova/transformers), isso é uma dependência nova — decisão de quem
// pede, não algo pra instalar por conta própria. Troca a IMPLEMENTAÇÃO deste
// arquivo, não o contrato de embedTexts — o resto do sistema não muda uma linha.

export const GEMINI_EMBEDDING_MODEL = "text-embedding-004";
export const GEMINI_EMBEDDING_DIM = 768;
const GEMINI_BATCH_SIZE = 10;
const GEMINI_BATCH_DELAY_MS = 1200;
const GEMINI_MAX_RETRIES = 3;
const GEMINI_RETRY_BASE_DELAY_MS = 2000;

export const LEXICAL_EMBEDDING_MODEL = "lexical-trigram-hash-v1";
export const LEXICAL_EMBEDDING_DIM = 256;

function resolveProvider(explicit) {
  const raw = explicit || process.env.RAG_EMBEDDING_PROVIDER || "gemini";
  const normalized = String(raw).toLowerCase().trim();
  return normalized === "lexical" ? "lexical" : "gemini";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Provedor lexical: hashing de n-gramas de caracteres, determinístico ─────

function hashStringToInt(str) {
  // FNV-1a de 32 bits — determinístico, sem dependência externa.
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function embedTextLexical(text, dim = LEXICAL_EMBEDDING_DIM) {
  const vector = new Array(dim).fill(0);
  const normalized = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // remove acentos — "preço" e "preco" caem no mesmo bucket

  // Trigramas de caracteres: robusto a plural/conjugação sem precisar de
  // tokenizador ou lista de stopwords.
  const n = 3;
  let count = 0;
  for (let i = 0; i <= normalized.length - n; i++) {
    const gram = normalized.slice(i, i + n);
    if (!gram.trim()) continue;
    const bucket = hashStringToInt(gram) % dim;
    vector[bucket] += 1;
    count++;
  }

  if (count === 0) return vector;

  // Normaliza pra norma unitária — cosine similarity fica estável independente
  // do tamanho do texto.
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

// ─── Provedor Gemini: text-embedding-004, em lotes com espaçamento e retry ───

async function embedBatchGemini(texts, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey}`;
  const body = {
    requests: texts.map((text) => ({
      model: `models/${GEMINI_EMBEDDING_MODEL}`,
      content: { parts: [{ text: String(text || "") }] },
    })),
  };

  let lastErr = null;
  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`Gemini embeddings: erro temporário ${res.status}`);
        if (attempt < GEMINI_MAX_RETRIES) {
          await sleep(GEMINI_RETRY_BASE_DELAY_MS * (attempt + 1));
          continue;
        }
        throw lastErr;
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Gemini embeddings: HTTP ${res.status} — ${errBody.slice(0, 300)}`);
      }

      const json = await res.json();
      const embeddings = Array.isArray(json?.embeddings) ? json.embeddings : [];
      if (embeddings.length !== texts.length) {
        throw new Error(
          `Gemini embeddings: esperava ${texts.length} vetores, recebeu ${embeddings.length}`
        );
      }
      return embeddings.map((e) => e.values || []);
    } catch (err) {
      lastErr = err;
      if (attempt < GEMINI_MAX_RETRIES) {
        await sleep(GEMINI_RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }
    }
  }
  throw lastErr || new Error("Gemini embeddings: falha desconhecida");
}

async function embedTextsGemini(texts) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY não configurada no servidor (Easypanel).");
    err.code = "GEMINI_API_KEY_MISSING";
    throw err;
  }

  const results = [];
  for (let i = 0; i < texts.length; i += GEMINI_BATCH_SIZE) {
    const batch = texts.slice(i, i + GEMINI_BATCH_SIZE);
    const vectors = await embedBatchGemini(batch, apiKey);
    results.push(...vectors);
    // Espaçamento entre lotes — camada gratuita do Gemini tem limite de
    // chamadas por minuto. Indexação é assíncrona, então esperar não incomoda.
    if (i + GEMINI_BATCH_SIZE < texts.length) {
      await sleep(GEMINI_BATCH_DELAY_MS);
    }
  }
  return results;
}

/**
 * Gera embeddings pra uma lista de textos. Provedor resolvido por
 * RAG_EMBEDDING_PROVIDER (ou pelo parâmetro `provider`, usado só em teste).
 * Devolve um array de vetores (array de números), na MESMA ordem de entrada.
 */
export async function embedTexts(texts, { provider: explicitProvider } = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const provider = resolveProvider(explicitProvider);

  if (provider === "lexical") {
    return texts.map((t) => embedTextLexical(t));
  }

  return embedTextsGemini(texts);
}

/**
 * Identidade do embedding que `embedTexts` vai gerar AGORA, dado o provedor
 * ativo (env ou explícito). É isso que rag_documents grava em
 * embedding_provider/embedding_model/embedding_dim no momento da indexação —
 * a procedência que permite saber depois o que precisa ser reindexado quando
 * o provedor, o modelo ou a dimensão mudarem.
 */
export function resolveEmbeddingIdentity(explicitProvider) {
  const provider = resolveProvider(explicitProvider);
  if (provider === "lexical") {
    return { provider: "lexical", model: LEXICAL_EMBEDDING_MODEL, dim: LEXICAL_EMBEDDING_DIM };
  }
  return { provider: "gemini", model: GEMINI_EMBEDDING_MODEL, dim: GEMINI_EMBEDDING_DIM };
}

/**
 * Similaridade de cosseno entre dois vetores. Dimensão incompatível LANÇA —
 * não devolve 0. Comparar vetores de espaços diferentes (Gemini 768 contra
 * lexical 256, ou dois modelos Gemini diferentes) não é "semelhança baixa",
 * é pergunta sem sentido matemático — o número resultante não significa nada,
 * e se isso vazasse como 0 a busca leria como "nenhum trecho relevante" sem
 * jamais indicar QUE o índice está misturado. Foi exatamente esse silêncio
 * que escondia a base inteira ficando invisível depois de uma troca de
 * provedor: nenhum erro, nenhum log, só "o RAG não funciona".
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    throw new Error("cosineSimilarity: os dois argumentos precisam ser arrays.");
  }
  if (a.length !== b.length) {
    const err = new Error(
      `cosineSimilarity: dimensões incompatíveis (${a.length} vs ${b.length}). ` +
      "Vetores de provedores/modelos de embedding diferentes não são comparáveis — reindexe."
    );
    err.code = "EMBEDDING_DIMENSION_MISMATCH";
    throw err;
  }
  if (a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function currentEmbeddingProvider() {
  return resolveProvider();
}
