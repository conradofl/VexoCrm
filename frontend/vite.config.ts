import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import { componentTagger } from "lovable-tagger";
import { emitVersionFile, resolveBuildVersion } from "./vite-plugins/buildVersion";

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  // Em build a versão é real e a mesma nos dois lugares: embutida no
  // código (__APP_VERSION__) e escrita em dist/version.json. Em dev/teste
  // fica null — a tela nem consulta, não há versão nova pra avisar.
  const isBuild = command === "build";
  const version = isBuild
    ? resolveBuildVersion({
        envSha: process.env.VERCEL_GIT_COMMIT_SHA,
        readGitSha: () =>
          execSync("git rev-parse HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString(),
        now: () => new Date(),
      })
    : null;

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    plugins: [react(), ...(version ? [emitVersionFile(version)] : [])],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
