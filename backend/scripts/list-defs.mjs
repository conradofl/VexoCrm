import { readFileSync, writeFileSync } from "fs";
const s = readFileSync("src/server.js", "utf8");
const head = s.slice(0, s.indexOf("app.get(\"/health\""));
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
const arr = [...defs].sort();
writeFileSync("scripts/defined-names.txt", arr.join("\n"), "utf8");
console.log(arr.length);
