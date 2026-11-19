#!/usr/bin/env node
// Patch da Baileys 7.0.0-rc.9 (a que vem na imagem oficial evoapicloud/evolution-api:v2.3.7): ack do nó <status>.
//
// Problema (19/11/2026, medido no Vexo): 4 instâncias "open" recebiam com 8 a 37 horas de atraso, em lotes a cada
// ~50 min. O WhatsApp passou a mandar o status dos contatos como nó <status> de nível superior, e a rc.9 não tem
// handler para ele: sem ack, o servidor segura as mensagens novas da sessão e fecha o stream ~50 min depois com
// stream:error ack class="status". Cada reconexão solta um pedaço do que ficou preso.
//
// Ajuste igual ao do PR 2883 da Baileys (aberto, não lançado), escrito para o JavaScript compilado da rc.9:
//   1. handleStatus: manda o ack do <status> pelo sendMessageAck que já existe (não decodifica o conteúdo).
//   2. registra 'status' no processador da fila offline, para o <status offline="..."> ser confirmado na ordem.
//   3. try/catch em volta de cada item da fila offline: na rc.9 um erro em qualquer handler quebrava o laço e deixava
//      isProcessing=true para sempre, e a fila offline daquela sessão parava de andar.
//   4. ws.on('CB:status') passando pelo processNode, como os outros tipos.
//
// Uso (Dockerfile ao lado): node patch-baileys-status-ack.mjs /evolution/node_modules/baileys/lib/Socket/messages-recv.js
// Falha (código 1, e o build junto) se: a versão da Baileys não for a rc.9, o arquivo não for o original esperado,
// qualquer âncora não aparecer EXATAMENTE uma vez, o patch já estiver aplicado ou o resultado não passar no node --check.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const VERSAO_ESPERADA = "7.0.0-rc.9";
// sha256 do lib/Socket/messages-recv.js do tarball oficial baileys-7.0.0-rc.9.tgz (integridade conferida com o npm).
export const SHA256_ORIGINAL = "8b9329ddf95fa7a1785826d8861af236f5f055ff22a5ed1ce52afdf9565d873e";
export const MARCA = "/* vexo: ack do <status> (Baileys PR 2883) */";

export const TROCAS = [
  {
    nome: "handleStatus antes do processador offline",
    ancora: "    const makeOfflineNodeProcessor = () => {\n",
    novo:
      `    ${MARCA}\n` +
      "    // O WhatsApp manda o status dos contatos como nó <status> de nível superior. Sem ack, o servidor segura as\n" +
      "    // mensagens novas da sessão e fecha o stream ~50 min depois (stream:error ack class=status).\n" +
      "    const handleStatus = async (node) => {\n" +
      "        try {\n" +
      "            await sendMessageAck(node);\n" +
      "        }\n" +
      "        catch (error) {\n" +
      "            onUnexpectedError(error, 'acking status stanza');\n" +
      "        }\n" +
      "    };\n" +
      "    const makeOfflineNodeProcessor = () => {\n",
  },
  {
    nome: "status no processador da fila offline",
    ancora: "            ['notification', handleNotification]\n        ]);\n",
    novo: "            ['notification', handleNotification],\n            ['status', handleStatus]\n        ]);\n",
  },
  {
    nome: "try/catch em cada item da fila offline",
    ancora: "                    await nodeProcessor(node);\n",
    novo:
      "                    try {\n" +
      "                        await nodeProcessor(node);\n" +
      "                    }\n" +
      "                    catch (error) {\n" +
      "                        onUnexpectedError(error, 'processing offline node');\n" +
      "                    }\n",
  },
  {
    nome: "ws.on('CB:status')",
    ancora: "    ws.on('CB:ack,class:message', (node) => {\n",
    novo:
      "    ws.on('CB:status', async (node) => {\n" +
      "        await processNode('status', node, 'acking status stanza', handleStatus).catch(error => onUnexpectedError(error, 'acking status stanza'));\n" +
      "    });\n" +
      "    ws.on('CB:ack,class:message', (node) => {\n",
  },
];

function contar(texto, trecho) {
  return texto.split(trecho).length - 1;
}

/** Aplica as 4 trocas. Lança se o patch já estiver aplicado ou se qualquer âncora não aparecer exatamente uma vez. */
export function aplicarPatch(texto) {
  if (texto.includes(MARCA)) throw new Error("patch já aplicado neste arquivo");
  if (texto.includes("'CB:status'")) throw new Error("o arquivo já tem handler de 'CB:status': esta Baileys não é a rc.9 sem o ajuste");
  // Confere todas as âncoras no texto ORIGINAL antes de trocar qualquer uma.
  for (const t of TROCAS) {
    const n = contar(texto, t.ancora);
    if (n !== 1) throw new Error(`âncora "${t.nome}" apareceu ${n} vez(es); esperado exatamente 1`);
  }
  let s = texto;
  for (const t of TROCAS) s = s.replace(t.ancora, () => t.novo);
  // O resultado tem cada peça uma vez só.
  for (const [trecho, esperado] of [
    [MARCA, 1],
    ["const handleStatus = async (node) =>", 1],
    ["['status', handleStatus]", 1],
    ["ws.on('CB:status'", 1],
    ["onUnexpectedError(error, 'processing offline node')", 1],
  ]) {
    const n = contar(s, trecho);
    if (n !== esperado) throw new Error(`depois do patch "${trecho}" aparece ${n} vez(es); esperado ${esperado}`);
  }
  return s;
}

export function sha256(texto) {
  return createHash("sha256").update(texto).digest("hex");
}

function principal(arquivo) {
  const alvo = resolve(arquivo);
  // lib/Socket/messages-recv.js -> package.json da Baileys dois níveis acima.
  const pacote = JSON.parse(readFileSync(join(dirname(alvo), "..", "..", "package.json"), "utf8"));
  if (pacote.name !== "baileys" || pacote.version !== VERSAO_ESPERADA) {
    throw new Error(`Baileys ${pacote.name}@${pacote.version}; este patch é só para baileys@${VERSAO_ESPERADA}`);
  }
  const original = readFileSync(alvo, "utf8");
  const hash = sha256(original);
  if (hash !== SHA256_ORIGINAL) throw new Error(`messages-recv.js não é o original da rc.9 (sha256 ${hash})`);
  const novo = aplicarPatch(original);
  writeFileSync(alvo, novo);
  try {
    execFileSync(process.execPath, ["--check", alvo], { stdio: "pipe" });
  } catch (e) {
    writeFileSync(alvo, original);
    throw new Error(`node --check falhou depois do patch (arquivo restaurado): ${String(e.stderr || e.message).slice(0, 400)}`);
  }
  console.log(`[patch-baileys] OK: ${TROCAS.length} trocas em ${alvo}`);
  for (const t of TROCAS) console.log(`[patch-baileys]   ${t.nome}`);
  console.log(`[patch-baileys] sha256 antes ${hash} | depois ${sha256(novo)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error("uso: node patch-baileys-status-ack.mjs <caminho do messages-recv.js>");
    principal(process.argv[2]);
  } catch (e) {
    console.error(`[patch-baileys] FALHOU: ${e.message}`);
    process.exit(1);
  }
}
