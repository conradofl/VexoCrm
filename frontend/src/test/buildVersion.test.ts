// frontend/src/test/buildVersion.test.ts
//
// O build emite a identidade dele: dist/version.json com a versão daquele
// build, a MESMA embutida no código da tela. E o arquivo precisa ir sem
// cache — se a Vercel servir a versão antiga dele, a verificação nunca
// detecta nada (é onde esse tipo de aviso costuma falhar em silêncio).

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { VERSION_FILE_NAME, emitVersionFile, resolveBuildVersion } from "../../vite-plugins/buildVersion";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, "../..");
const FIXED_NOW = () => new Date("2026-10-02T12:00:00.000Z");

describe("resolveBuildVersion", () => {
  it("usa o hash do commit que a Vercel informa", () => {
    const v = resolveBuildVersion({ envSha: "abc123", readGitSha: () => "ignorado", now: FIXED_NOW });
    expect(v).toBe("abc123");
  });

  it("sem variável de ambiente, lê o commit do git", () => {
    const v = resolveBuildVersion({ envSha: undefined, readGitSha: () => "def456\n", now: FIXED_NOW });
    expect(v).toBe("def456");
  });

  it("sem git (build fora de repositório), cai no instante do build — identidade real, nunca texto fixo", () => {
    const semGit = resolveBuildVersion({
      envSha: "",
      readGitSha: () => {
        throw new Error("not a git repository");
      },
      now: FIXED_NOW,
    });
    expect(semGit).toBe("build-2026-10-02T12:00:00.000Z");

    const outroBuild = resolveBuildVersion({
      envSha: null,
      readGitSha: () => null,
      now: () => new Date("2026-10-02T12:05:00.000Z"),
    });
    expect(outroBuild).not.toBe(semGit);
  });
});

describe("emitVersionFile", () => {
  it("[TESTE OBRIGATÓRIO] emite version.json com a versão do build", () => {
    const plugin = emitVersionFile("abc123") as any;
    const emitted: any[] = [];

    plugin.generateBundle.call({ emitFile: (f: any) => emitted.push(f) });

    expect(plugin.apply).toBe("build");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].fileName).toBe(VERSION_FILE_NAME);
    expect(VERSION_FILE_NAME).toBe("version.json");
    expect(JSON.parse(emitted[0].source)).toEqual({ version: "abc123" });
  });
});

// Resolve a config REAL do projeto (vite.config.ts) num processo Node limpo —
// o esbuild do Vite não roda dentro do jsdom em que estes testes vivem.
function resolveRealViteConfig(command: "build" | "serve", env: Record<string, string> = {}) {
  const script = `
    import { resolveConfig } from "vite";
    const config = await resolveConfig({ root: ${JSON.stringify(FRONTEND_DIR)}, configFile: ${JSON.stringify(
      path.join(FRONTEND_DIR, "vite.config.ts")
    )} }, ${JSON.stringify(command)});
    const plugin = config.plugins.find((p) => p.name === "emit-version-file");
    const emitted = [];
    if (plugin) plugin.generateBundle.call({ emitFile: (f) => emitted.push(f) });
    console.log("@@RESULT@@" + JSON.stringify({
      define: config.define?.__APP_VERSION__,
      hasPlugin: Boolean(plugin),
      emitted,
    }));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: FRONTEND_DIR,
    env: { ...process.env, ...env },
    encoding: "utf-8",
  });
  const line = out.split("\n").find((l) => l.startsWith("@@RESULT@@"));
  return JSON.parse(line!.replace("@@RESULT@@", ""));
}

describe("vite.config — a versão embutida e a do arquivo vêm do mesmo build", () => {
  it("[TESTE OBRIGATÓRIO] em build, __APP_VERSION__ é igual à versão que o plugin escreve no arquivo", () => {
    const result = resolveRealViteConfig("build", { VERCEL_GIT_COMMIT_SHA: "sha-do-deploy-123" });

    expect(result.hasPlugin, "plugin emit-version-file não está no build").toBe(true);
    const embedded = JSON.parse(result.define);
    expect(embedded).toBe("sha-do-deploy-123");
    expect(JSON.parse(result.emitted[0].source).version).toBe(embedded);
  }, 60000);

  it("em dev (serve) não há versão nem arquivo — a tela não consulta", () => {
    const result = resolveRealViteConfig("serve");

    expect(JSON.parse(result.define)).toBeNull();
    expect(result.hasPlugin).toBe(false);
  }, 60000);
});

describe("vercel.json — version.json vai sem cache", () => {
  const files = ["../../vercel.json", "../../../vercel.json"];

  for (const rel of files) {
    it(`[TESTE OBRIGATÓRIO] ${path.basename(path.resolve(__dirname, rel, ".."))}/vercel.json manda Cache-Control no-store em /version.json`, () => {
      const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, rel), "utf-8"));
      const entry = (config.headers as any[]).find((h) => h.source === "/version.json");

      expect(entry, "nenhuma regra de cabeçalho para /version.json").toBeTruthy();
      const cacheControl = entry.headers.find((h: any) => h.key.toLowerCase() === "cache-control");
      expect(cacheControl?.value).toContain("no-store");
    });
  }
});
