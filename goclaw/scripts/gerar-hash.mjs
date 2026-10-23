#!/usr/bin/env node

/**
 * gerar-hash.mjs
 * 
 * Script utilitário local para geração de hash de senha Argon2id compatível
 * com o runtime GoClaw (Golang).
 * 
 * Parâmetros de conformidade GoClaw:
 *   - Variante: Argon2id (type: 2)
 *   - Versão: 19 (0x13)
 *   - Memória (m): 65536 (64 MB)
 *   - Iterações / Tempo (t): 1
 *   - Paralelismo (p): 4
 *   - Formato GoClaw: $argon2id$v=19$m=65536,t=1,p=4$<salt>$<hash>
 * 
 * Segurança:
 *   - A senha é lida EXCLUSIVAMENTE via stdin (pipe ou digitação no terminal).
 *   - NUNCA aceita senha por argumento de linha de comando para não vazar no histórico do shell (`history` ou `ps`).
 *   - Não grava nada em disco. Execução estritamente local na máquina do operador.
 * 
 * Exemplos de Uso:
 *   1) Modo Pipe (seguro em scripts ou via read -s):
 *      read -s PWD && echo -n "$PWD" | node goclaw/scripts/gerar-hash.mjs
 * 
 *   2) Modo Interativo (digitação no terminal com ocultação de caracteres):
 *      node goclaw/scripts/gerar-hash.mjs
 */

import argon2 from "argon2";
import readline from "node:readline";

async function readPasswordFromStdin() {
  if (!process.stdin.isTTY) {
    // Modo pipe: dados recebidos via stream stdin
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString("utf-8");
    // Remove apenas a quebra de linha final (LF ou CRLF), preservando espaços internos
    return input.replace(/[\r\n]+$/, "");
  }

  // Modo interativo no terminal TTY: oculta a digitação da senha
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    process.stderr.write("Digite a senha para gerar o hash Argon2id (caracteres ocultos): ");

    const origWrite = rl._writeToOutput;
    rl._writeToOutput = function (stringToWrite) {
      if (stringToWrite.includes("\r") || stringToWrite.includes("\n")) {
        origWrite.call(rl, "\n");
      } else {
        origWrite.call(rl, "*");
      }
    };

    rl.question("", (answer) => {
      rl.close();
      resolve(answer.replace(/[\r\n]+$/, ""));
    });
  });
}

async function main() {
  // Garante que nenhuma senha foi passada por argumento
  if (process.argv.length > 2) {
    console.error("❌ ERRO DE SEGURANÇA: Nunca passe a senha como argumento de linha de comando.");
    console.error("Envie via stdin através de pipe ou execute o script de forma interativa.");
    console.error("Exemplo: read -s PWD && echo -n \"$PWD\" | node goclaw/scripts/gerar-hash.mjs\n");
    process.exit(1);
  }

  try {
    const password = await readPasswordFromStdin();
    if (!password) {
      console.error("❌ Erro: Nenhuma senha foi informada via stdin.");
      process.exit(1);
    }

    let hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 1,
      parallelism: 4,
      version: 19,
    });

    // Garante a ordem dos parâmetros esperada pelo GoClaw: m=...,t=...,p=...
    // (o parser em GoClaw usa fmt.Fscanf com "m=%d,t=%d,p=%d")
    hash = hash.replace(/m=(\d+),p=(\d+),t=(\d+)/, "m=$1,t=$3,p=$2");

    // Imprime exclusivamente o hash final no stdout
    process.stdout.write(hash + "\n");
  } catch (err) {
    console.error("❌ Falha ao gerar hash Argon2id:", err.message);
    process.exit(1);
  }
}

main();
