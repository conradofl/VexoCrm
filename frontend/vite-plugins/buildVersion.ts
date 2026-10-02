// Identidade do build, pra tela saber que existe versão nova sem service
// worker. O build escreve dist/version.json com a versão daquele build; a
// tela carrega a MESMA versão embutida (__APP_VERSION__) e compara.
import type { Plugin } from "vite";

export const VERSION_FILE_NAME = "version.json";

/**
 * Hash do commit quando existe — na Vercel vem em VERCEL_GIT_COMMIT_SHA,
 * local vem do git. Sem nenhum dos dois (build fora de repositório), cai no
 * instante do build: continua sendo identidade real de um build, e dois
 * builds diferentes nunca empatam. Nada aqui é escrito à mão.
 */
export function resolveBuildVersion(input: {
  envSha?: string | null;
  readGitSha: () => string | null | undefined;
  now: () => Date;
}): string {
  const fromEnv = input.envSha?.trim();
  if (fromEnv) return fromEnv;

  try {
    const fromGit = input.readGitSha()?.trim();
    if (fromGit) return fromGit;
  } catch {
    // sem git disponível — segue pro instante do build
  }

  return `build-${input.now().toISOString()}`;
}

export function emitVersionFile(version: string): Plugin {
  return {
    name: "emit-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: VERSION_FILE_NAME,
        source: `${JSON.stringify({ version })}\n`,
      });
    },
  };
}
