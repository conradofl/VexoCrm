import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const serverPath = join(root, "../src/server.js");
const s = readFileSync(serverPath, "utf8");
const routeStart = s.indexOf("app.get(\"/health\"");
const routeEnd = s.indexOf("app.use((error, req, res, _next)");
const head = s.slice(0, routeStart);
const routeBody = s.slice(routeStart, routeEnd);

const defs = new Set();
for (const line of head.split("\n")) {
  for (const re of [
    /^function ([a-zA-Z0-9_]+)\s*\(/,
    /^async function ([a-zA-Z0-9_]+)\s*\(/,
    /^const ([A-Za-z0-9_]+)\s*=/,
    /^let ([A-Za-z0-9_]+)\s*=/,
  ]) {
    const m = re.exec(line);
    if (m) defs.add(m[1]);
  }
}
defs.delete("app");

const headLines = head.split("\n");
const importEnd = headLines.findIndex((ln) => ln.startsWith("const __dirname"));
const importBlockRaw = headLines.slice(0, importEnd).join("\n");
const importBlock = importBlockRaw.replace(/from "\.\//g, 'from "../').replace(/from '\.\//g, "from '../");

const destructureNames = [...defs].sort();
const destructure = `  const {\n${destructureNames.map((n) => `    ${n},`).join("\n")}\n  } = routeDeps;`;

const out = `${importBlock}
import { routeDeps } from "../http/routeDeps.js";

/**
 * Registers all HTTP routes (extracted from legacy server.js).
 * routeDeps must be populated in server.js before this runs.
 */
export function registerAllDomainRoutes(app) {
${destructure}

${routeBody
    .split("\n")
    .map((ln) => (ln.length ? `  ${ln}` : ""))
    .join("\n")}
}
`;

const outPath = join(root, "../src/domains/registerAllDomainRoutes.js");
writeFileSync(outPath, out, "utf8");
console.log("wrote", outPath, "lines", out.split("\n").length);

const assignKeys = [...defs].sort();
const assign = `Object.assign(routeDeps, {\n${assignKeys.map((k) => `  ${k},`).join("\n")}\n});`;
writeFileSync(join(root, "../src/http/populateRouteDeps.snippet.js"), assign, "utf8");
