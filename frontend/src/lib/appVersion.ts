// A versão que ESTA aba carregou, embutida no build. É a mesma que o build
// escreve em /version.json — se o arquivo disser outra coisa, saiu versão
// nova. null em dev e nos testes: sem versão, a tela não consulta nada.
export const APP_VERSION: string | null = typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : null;

export const VERSION_FILE_PATH = "/version.json";

/** Cinco minutos: ninguém precisa saber de versão nova no mesmo segundo. */
export const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Lê a versão publicada agora. Devolve null quando não deu pra saber
 * (rede caiu, arquivo ausente, resposta que não é o JSON esperado — a
 * Vercel responde index.html pra caminho inexistente) — nunca inventa
 * versão, e null nunca vira aviso.
 */
export async function fetchLatestVersion(fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchFn(VERSION_FILE_PATH, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.version === "string" && data.version ? data.version : null;
  } catch {
    return null;
  }
}
