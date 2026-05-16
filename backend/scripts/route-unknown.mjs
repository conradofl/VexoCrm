import { readFileSync, writeFileSync } from "fs";
const s = readFileSync("src/server.js", "utf8");
const head = s.slice(0, s.indexOf("app.get(\"/health\""));
const route = s.slice(s.indexOf("app.get(\"/health\""), s.indexOf("app.use((error, req, res, _next)"));
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
const reId = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
const builtins = new Set(["async","await","true","false","null","undefined","class","const","let","var","if","else","for","while","return","try","catch","finally","throw","new","typeof","instanceof","import","export","from","default","extends","super","this","void","delete","switch","case","break","continue","of","in","function","static","get","set","yield"]);
const inRoute = new Set();
let m;
while ((m = reId.exec(route))) {
  inRoute.add(m[1]);
}
const unknown = [...inRoute].filter((id) => !defs.has(id) && !builtins.has(id) && id.length > 1).sort();
writeFileSync("scripts/route-unknown-ids.txt", unknown.join("\n"), "utf8");
console.log("unknown count", unknown.length);
console.log(unknown.slice(0, 80).join(", "));
