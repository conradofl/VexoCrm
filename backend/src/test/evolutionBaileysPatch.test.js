// Patch da Baileys rc.9 na imagem da Evolution (ops/evolution-api): ack do nó <status> e fila offline que não trava.
// 19/11/2026: 4 instâncias "open" recebiam com 8 a 37 h de atraso, em lotes a cada ~50 min (stream:error ack
// class=status). O teste aplica o patch num trecho LITERAL da rc.9 e executa o código resultante.
import { EventEmitter } from "events";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { execFileSync } from "child_process";
import { afterAll, describe, expect, it, vi } from "vitest";
import { aplicarPatch, MARCA, TROCAS } from "../../../ops/evolution-api/patch-baileys-status-ack.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const TRECHO = readFileSync(join(AQUI, "fixtures", "baileys-rc9-messages-recv-trecho.mjs"), "utf8");
const DOCKERFILE = readFileSync(join(AQUI, "..", "..", "..", "ops", "evolution-api", "Dockerfile"), "utf8");
const pasta = mkdtempSync(join(tmpdir(), "vexo-baileys-"));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

let seq = 0;
async function carregar(texto) {
  seq += 1;
  const f = join(pasta, `trecho-${seq}.mjs`);
  writeFileSync(f, texto);
  execFileSync(process.execPath, ["--check", f]); // o mesmo node --check do build
  return (await import(pathToFileURL(f).href)).montar;
}

// Socket falso: o que sai do processo (o ack para o WhatsApp) é o dublê; a lógica da fila é a da Baileys.
function socketFalso(montar, { handleNotification = vi.fn(async () => {}) } = {}) {
  const ws = new EventEmitter();
  ws.isOpen = true;
  const acks = [];
  const erros = [];
  const sock = montar({
    ws,
    ev: { buffer: vi.fn(), flush: vi.fn() },
    sendMessageAck: vi.fn(async (node) => {
      acks.push(node.attrs.id);
    }),
    onUnexpectedError: vi.fn((err, onde) => erros.push(`${onde}: ${err.message}`)),
    handleMessage: vi.fn(async () => {}),
    handleCall: vi.fn(async () => {}),
    handleReceipt: vi.fn(async () => {}),
    handleNotification,
    handleBadAck: vi.fn(async () => {}),
  });
  return { ws, acks, erros, sock };
}
const status = (id, offline = undefined) => ({ tag: "status", attrs: { id, from: "5534999001001@s.whatsapp.net", type: "media", ...(offline ? { offline } : {}) } });
const notif = (id, offline = undefined) => ({ tag: "notification", attrs: { id, ...(offline ? { offline } : {}) } });
const esperarFila = () => new Promise((r) => setTimeout(r, 20));

describe("rc.9 SEM o patch (o defeito)", () => {
  it("<status> fica sem ack: ninguém escuta 'CB:status'", async () => {
    const { ws, acks } = socketFalso(await carregar(TRECHO));
    expect(ws.listenerCount("CB:status")).toBe(0);
    ws.emit("CB:status", status("S1"));
    await esperarFila();
    expect(acks).toEqual([]);
  });

  it("um handler que lança erro trava a fila offline para sempre", async () => {
    let n = 0;
    const handleNotification = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("falha qualquer");
    });
    const { ws } = socketFalso(await carregar(TRECHO), { handleNotification });
    ws.emit("CB:notification", notif("N1", "1"));
    await esperarFila();
    ws.emit("CB:notification", notif("N2", "1"));
    await esperarFila();
    expect(handleNotification).toHaveBeenCalledTimes(1); // N2 nunca roda: isProcessing ficou true
  });
});

describe("rc.9 COM o patch", () => {
  const corrigido = aplicarPatch(TRECHO);

  it("<status> ao vivo recebe ack", async () => {
    const { ws, acks, erros } = socketFalso(await carregar(corrigido));
    ws.emit("CB:status", status("S1"));
    await esperarFila();
    expect(acks).toEqual(["S1"]);
    expect(erros).toEqual([]);
  });

  it("<status offline> é confirmado na ordem da fila offline", async () => {
    const ordem = [];
    const handleNotification = vi.fn(async (node) => {
      ordem.push(node.attrs.id);
    });
    const { ws, acks, erros } = socketFalso(await carregar(corrigido), { handleNotification });
    ws.emit("CB:notification", notif("N1", "1"));
    ws.emit("CB:status", status("S1", "1"));
    ws.emit("CB:notification", notif("N2", "1"));
    await esperarFila();
    expect(ordem).toEqual(["N1", "N2"]);
    expect(acks).toEqual(["S1"]);
    expect(erros).toEqual([]);
  });

  it("erro num item da fila offline não trava os seguintes", async () => {
    let n = 0;
    const handleNotification = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("falha qualquer");
    });
    const { ws, acks, erros } = socketFalso(await carregar(corrigido), { handleNotification });
    ws.emit("CB:notification", notif("N1", "1"));
    ws.emit("CB:status", status("S1", "1"));
    await esperarFila();
    ws.emit("CB:notification", notif("N2", "1"));
    await esperarFila();
    expect(handleNotification).toHaveBeenCalledTimes(2);
    expect(acks).toEqual(["S1"]);
    expect(erros).toEqual(["processing offline node: falha qualquer"]);
  });

  it("falha ao mandar o ack vira erro reportado, sem derrubar nada", async () => {
    const montar = await carregar(corrigido);
    const ws = new EventEmitter();
    ws.isOpen = true;
    const erros = [];
    montar({
      ws,
      ev: { buffer() {}, flush() {} },
      sendMessageAck: async () => {
        throw new Error("socket fechado");
      },
      onUnexpectedError: (err, onde) => erros.push(`${onde}: ${err.message}`),
      handleMessage: async () => {},
      handleCall: async () => {},
      handleReceipt: async () => {},
      handleNotification: async () => {},
      handleBadAck: async () => {},
    });
    ws.emit("CB:status", status("S1"));
    ws.emit("CB:status", status("S2", "1"));
    await esperarFila();
    expect(erros).toEqual(["acking status stanza: socket fechado", "acking status stanza: socket fechado"]);
  });
});

describe("script de patch: só aplica no arquivo esperado", () => {
  it("cada âncora aparece exatamente uma vez no trecho literal da rc.9", () => {
    for (const t of TROCAS) expect(TRECHO.split(t.ancora).length - 1, t.nome).toBe(1);
  });

  it("segunda aplicação falha", () => {
    expect(() => aplicarPatch(aplicarPatch(TRECHO))).toThrow(/já aplicado/);
  });

  it.each(TROCAS.map((t) => [t.nome, t.ancora]))("âncora ausente (%s) falha sem trocar nada", (_nome, ancora) => {
    expect(() => aplicarPatch(TRECHO.replace(ancora, "// removido\n"))).toThrow(/apareceu 0 vez/);
  });

  it("âncora repetida falha", () => {
    const t = TROCAS[2];
    expect(() => aplicarPatch(TRECHO.replace(t.ancora, t.ancora + t.ancora))).toThrow(/apareceu 2 vez/);
  });

  it("Baileys que já trata 'CB:status' (versão nova) falha", () => {
    expect(() => aplicarPatch(TRECHO + "\nws.on('CB:status', () => {});\n")).toThrow(/já tem handler/);
  });

  it("resultado tem a marca uma vez", () => {
    expect(aplicarPatch(TRECHO).split(MARCA).length - 1).toBe(1);
  });
});

describe("Dockerfile", () => {
  it("parte da imagem oficial fixada por digest e roda o patch no arquivo certo", () => {
    expect(DOCKERFILE).toMatch(/^FROM evoapicloud\/evolution-api:v2\.3\.7@sha256:[0-9a-f]{64}\s*$/m);
    expect(DOCKERFILE).toContain("RUN node /tmp/vexo-patch/patch-baileys-status-ack.mjs /evolution/node_modules/baileys/lib/Socket/messages-recv.js");
    expect(DOCKERFILE).not.toMatch(/^ENTRYPOINT|^CMD/m); // o boot é o da imagem oficial
  });
});
