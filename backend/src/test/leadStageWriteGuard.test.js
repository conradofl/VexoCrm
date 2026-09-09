// Teste-Guarda: Nenhuma escrita de `stage` em leads fora do ponto centralizado.
//
// Regra de Ouro (Bloco 1):
// A proteção de leads com stage_source = 'manual' só é garantida se TODOS os
// fluxos automáticos passarem centralizadamente por `services/leadUpsert.js`.
//
// Locais autorizados a escrever stage em public.leads / leadsTable:
// 1. src/services/leadUpsert.js (ponto centralizado de proteção contra sobrescrita)
// 2. src/domains/leads/routes.js (rotas MANUAIS explícitas: PATCH /api/leads/:id e POST /api/leads/bulk-update)
// 3. src/webhooks/routes.js (webhook de conversão: POST /api/webhooks/conversion/:tenant_id)
// 4. src/lead-client-tables.js (bootstrap de schema DDL: ADD COLUMN IF NOT EXISTS)
//
// Qualquer outro arquivo que grave na tabela de leads (como chatbot-ai-engine.js,
// automações, webhooks de entrada, sincronizações) NUNCA pode escrever stage diretamente.

import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join, relative } from "path";
import { describe, expect, it } from "vitest";

function listarArquivosJs(dir, achados = []) {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === "test") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      listarArquivosJs(caminho, achados);
    } else if (nome.endsWith(".js")) {
      achados.push(caminho);
    }
  }
  return achados;
}

// Arquivos autorizados e suas regras
const ALLOWED_FILES = new Set([
  "services/leadUpsert.js",
  "lead-client-tables.js",
  "domains/leads/routes.js",
  "webhooks/routes.js",
]);

/**
 * Verifica se um arquivo interage com escrita de leads (leads / leadsTable / public.leads)
 */
function gravaTabelaLeads(conteudo) {
  const padroesGravacao = [
    /\.from\(\s*(?:leadsTable|["']leads["'])\s*\)\s*\.(?:update|insert|upsert)/,
    /UPDATE\s+(?:public\.)?leads\b/i,
    /INSERT\s+INTO\s+(?:public\.)?leads\b/i,
  ];
  return padroesGravacao.some((p) => p.test(conteudo));
}

/**
 * Procura padrões de escrita ou atribuição de stage no arquivo
 */
function encontraEscritasDeStage(conteudo) {
  const linhas = conteudo.split("\n");
  const ocorrencias = [];

  linhas.forEach((linha, idx) => {
    // Ignora comentários
    const trimmed = linha.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;

    // Padrões de escrita de stage em payload / update / insert / SQL
    const padroes = [
      /\bstage\s*:/,                          // stage: "buyer" em payload/objeto
      /\bpayload\.stage\s*=/,                 // payload.stage = ...
      /\bupdates\.stage\s*=/,                 // updates.stage = ...
      /\blead\.stage\s*=/,                    // lead.stage = ...
      /\bitem\.stage\s*=/,                    // item.stage = ...
      /UPDATE\s+(?:public\.)?leads\b.*SET.*\bstage\s*=/i,
      /\bstage\s*=\s*(?:\$|'|"|COALESCE)/i,  // SQL stage = $1 ou stage = 'buyer'
    ];

    for (const p of padroes) {
      if (p.test(linha)) {
        ocorrencias.push({ linha: idx + 1, texto: trimmed });
        break;
      }
    }
  });

  return ocorrencias;
}

describe("Teste-Guarda: Proteção contra escrita de stage fora do ponto centralizado", () => {
  const raizSrc = resolve("src");
  const todosArquivos = listarArquivosJs(raizSrc);

  it("a varredura encontrou arquivos JS em backend/src", () => {
    expect(todosArquivos.length).toBeGreaterThan(25);
  });

  it("nenhum arquivo não-autorizado que grava em leads escreve stage", () => {
    const violacoes = [];

    for (const caminho of todosArquivos) {
      const relPath = relative(raizSrc, caminho);

      // Pula arquivos da whitelist autorizada
      if (ALLOWED_FILES.has(relPath)) continue;

      const conteudo = readFileSync(caminho, "utf8");

      // Se o arquivo grava na tabela de leads, NÃO pode ter atribuição/escrita de stage
      if (gravaTabelaLeads(conteudo)) {
        const escritas = encontraEscritasDeStage(conteudo);
        if (escritas.length > 0) {
          escritas.forEach((e) => {
            violacoes.push(
              `[VIOLAÇÃO DE SEGURANÇA] ${relPath}:${e.linha} grava stage fora do ponto centralizado:\n  -> "${e.texto}"`
            );
          });
        }
      }
    }

    expect(violacoes, `\n${violacoes.join("\n")}`).toEqual([]);
  });

  it("em domains/leads/routes.js, escrita direta de stage ocorre exclusivamente nas rotas manuais (PATCH /api/leads/:id e POST /api/leads/bulk-update)", () => {
    const caminho = join(raizSrc, "domains/leads/routes.js");
    const conteudo = readFileSync(caminho, "utf8");
    const linhas = conteudo.split("\n");

    let rotaAtual = "";
    const violacoes = [];

    linhas.forEach((linha, idx) => {
      const trimmed = linha.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

      const rotaMatch = linha.match(/app\.(get|post|patch|put|delete)\(["']([^"']+)["']/);
      if (rotaMatch) {
        rotaAtual = `${rotaMatch[1].toUpperCase()} ${rotaMatch[2]}`;
      }

      if (/\bupdates\.stage\s*=/.test(linha) || /SET.*\bstage\s*=/.test(linha)) {
        const rotasPermitidas = ["PATCH /api/leads/:id", "POST /api/leads/bulk-update"];
        if (!rotasPermitidas.includes(rotaAtual)) {
          violacoes.push(`Linha ${idx + 1} em "${rotaAtual}": escrita direta de stage proibida`);
        }
      }
    });

    expect(violacoes).toEqual([]);
  });

  it("em webhooks/routes.js, escrita direta de stage ocorre exclusivamente no webhook de conversão", () => {
    const caminho = join(raizSrc, "webhooks/routes.js");
    const conteudo = readFileSync(caminho, "utf8");
    const linhas = conteudo.split("\n");

    let rotaAtual = "";
    const violacoes = [];

    linhas.forEach((linha, idx) => {
      const trimmed = linha.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

      const rotaMatch = linha.match(/app\.(get|post|patch|put|delete)\(["']([^"']+)["']/);
      if (rotaMatch) {
        rotaAtual = `${rotaMatch[1].toUpperCase()} ${rotaMatch[2]}`;
      }

      if (/\bstage\s*=\s*'buyer'/.test(linha)) {
        if (rotaAtual !== "POST /api/webhooks/conversion/:tenant_id") {
          violacoes.push(`Linha ${idx + 1} em "${rotaAtual}": escrita de stage fora do webhook de conversão`);
        }
      }
    });

    expect(violacoes).toEqual([]);
  });
});
