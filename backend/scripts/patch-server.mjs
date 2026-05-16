import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const serverPath = join(root, "../src/server.js");
const snippetPath = join(root, "../src/http/populateRouteDeps.snippet.js");
let s = readFileSync(serverPath, "utf8");
const snippet = readFileSync(snippetPath, "utf8").trim();

const routeStart = s.indexOf("app.get(\"/health\"");
const routeEnd = s.indexOf("app.use((error, req, res, _next)");
if (routeStart < 0 || routeEnd < 0) throw new Error("markers not found");

const extraImports = `import { routeDeps } from "./http/routeDeps.js";
import { registerAllDomainRoutes } from "./domains/registerAllDomainRoutes.js";
`;

const insertBlock = `
${snippet}
registerAllDomainRoutes(app);
`;

const chatbotImportMarker = `} from "./chatbot-ai-engine.js";`;
const posImports = s.indexOf(chatbotImportMarker);
if (posImports < 0) throw new Error("chatbot import marker not found");
const posAfterImports = s.indexOf("\n", posImports + chatbotImportMarker.length) + 1;
s = s.slice(0, posAfterImports) + "\n" + extraImports + s.slice(posAfterImports);

const rs = s.indexOf("app.get(\"/health\"");
const re = s.indexOf("app.use((error, req, res, _next)");
s = s.slice(0, rs) + insertBlock + "\n" + s.slice(re);

writeFileSync(serverPath, s, "utf8");
console.log("patched server.js ok");
