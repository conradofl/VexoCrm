import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const dir = dirname(fileURLToPath(import.meta.url));
const serverPath = join(dir, "../src/server.js");
const s = readFileSync(serverPath, "utf8");
const start = s.indexOf('app.get("/health"');
const end = s.indexOf("app.use((error, req, res, _next)");
const routeBody = s.slice(start, end);
const re = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
const builtins = new Set([
  "async", "await", "break", "case", "catch", "const", "class", "continue", "default",
  "delete", "do", "else", "export", "extends", "false", "finally", "for", "from", "function",
  "if", "import", "in", "instanceof", "let", "new", "null", "return", "super", "switch", "this",
  "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield", "of", "static",
  "get", "set", "res", "req", "_req", "_next", "next", "Error", "JSON", "Promise", "Date", "Math",
  "Number", "parseInt", "String", "Object", "Array", "console", "process", "Buffer",
  "encodeURIComponent", "decodeURIComponent", "fetch", "setTimeout", "clearTimeout", "isNaN",
  "RegExp", "URL", "Map", "Set", "BigInt", "undefined", "app",
]);
const freq = new Map();
let m;
while ((m = re.exec(routeBody))) {
  const id = m[1];
  if (builtins.has(id)) continue;
  freq.set(id, (freq.get(id) || 0) + 1);
}
const ids = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
writeFileSync(join(dir, "route-identifiers.json"), JSON.stringify(ids, null, 2), "utf8");
console.log("count", ids.length);
console.log(ids.slice(0, 40).join(", "));
