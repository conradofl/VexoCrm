#!/usr/bin/env node

/**
 * vigia-gd.mjs
 *
 * Script do Vigia da Geração Digital & Vexo OS.
 * Realiza a leitura autenticada dos estados dos clientes via rota /api/gd/clientes/vigia,
 * calcula o tempo de permanência em relação ao SLA de cada estado e classifica gargalos.
 *
 * Uso:
 *   node backend/src/scripts/vigia-gd.mjs
 *   node backend/src/scripts/vigia-gd.mjs --dry-run
 *   node backend/src/scripts/vigia-gd.mjs --mock
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadEnvFallback() {
  const envCandidates = [
    path.resolve(__dirname, "../../.env"),
    path.resolve(__dirname, "../.env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "backend/.env"),
  ];
  const envPath = envCandidates.find((p) => fs.existsSync(p));
  if (!envPath) return;

  try {
    const raw = fs.readFileSync(envPath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // Silencioso em caso de arquivo inacessível
  }
}

/**
 * Classifica o cliente em relação ao seu SLA com base no tempo decorrido.
 * Função pura e determinística com injeção do parâmetro `agora`.
 */
export function classificarCliente(cliente, agora = new Date()) {
  const agoraMs = new Date(agora).getTime();
  const estado = cliente.estado_atual || "";
  const entrouEmMs = cliente.entrou_em ? new Date(cliente.entrou_em).getTime() : null;
  const horasDecorridas = (entrouEmMs != null && !Number.isNaN(entrouEmMs))
    ? Math.max(0, Math.floor((agoraMs - entrouEmMs) / (1000 * 60 * 60)))
    : 0;

  const responsavel = cliente.acao_do_cliente ? "Cliente" : "Equipe GD";
  const prazoHoras = cliente.prazo_horas != null ? Number(cliente.prazo_horas) : null;
  const prazoContagem = cliente.prazo_contagem || null;

  // a) Se estado_atual === 'ATIVO': classifica como EM REGIME
  if (estado === "ATIVO") {
    return {
      status: "EM REGIME",
      detalhe: "Em regime",
      horas_decorridas: horasDecorridas,
      responsavel,
      prazo_sla: "Sem prazo fatal",
    };
  }

  // b) Se estado_atual === 'PAUSADO': classifica como PAUSADO
  if (estado === "PAUSADO") {
    return {
      status: "PAUSADO",
      detalhe: "Pausado",
      horas_decorridas: horasDecorridas,
      responsavel,
      prazo_sla: "Sem prazo fatal",
    };
  }

  // c) Se estado_atual === 'ENCERRADO': classifica como ENCERRADO
  if (estado === "ENCERRADO") {
    return {
      status: "ENCERRADO",
      detalhe: "Encerrado",
      horas_decorridas: horasDecorridas,
      responsavel,
      prazo_sla: "Sem prazo fatal",
    };
  }

  // d) Se tem prazo_horas e prazo_contagem === 'horas_corridas'
  if (prazoHoras != null && prazoContagem === "horas_corridas") {
    if (horasDecorridas > prazoHoras) {
      const atraso = horasDecorridas - prazoHoras;
      return {
        status: "ATRASADO",
        detalhe: `Estourado por ${atraso}h`,
        horas_decorridas: horasDecorridas,
        responsavel,
        prazo_sla: `${prazoHoras}h corridas`,
      };
    }
    if (horasDecorridas >= prazoHoras * 0.8) {
      const falta = prazoHoras - horasDecorridas;
      return {
        status: "ALERTA",
        detalhe: `Faltam ${falta}h`,
        horas_decorridas: horasDecorridas,
        responsavel,
        prazo_sla: `${prazoHoras}h corridas`,
      };
    }
    const resta = prazoHoras - horasDecorridas;
    return {
      status: "NO_PRAZO",
      detalhe: `Restam ${resta}h`,
      horas_decorridas: horasDecorridas,
      responsavel,
      prazo_sla: `${prazoHoras}h corridas`,
    };
  }

  // e) Se prazo_contagem for 'horas_uteis' ou 'fim_do_dia_util'
  if (prazoContagem === "horas_uteis" || prazoContagem === "fim_do_dia_util") {
    const rotuloPrazo = prazoContagem === "fim_do_dia_util"
      ? "Fim do dia útil"
      : `${prazoHoras || 0}h úteis`;
    return {
      status: "EM_ANALISE_UTEIS",
      detalhe: `${horasDecorridas}h decorridas (regra ${prazoContagem})`,
      horas_decorridas: horasDecorridas,
      responsavel,
      prazo_sla: rotuloPrazo,
    };
  }

  // Demais estados sem prazo (ex: ESTRATEGIA_APROVADA)
  return {
    status: cliente.fase === "regime" ? "EM REGIME" : "SEM_PRAZO",
    detalhe: "Sem prazo de saída",
    horas_decorridas: horasDecorridas,
    responsavel,
    prazo_sla: "Sem prazo fatal",
  };
}

/**
 * Calcula os totais do resumo operacional.
 */
export function calcularResumo(classificados = []) {
  let ativos = 0;
  let onboarding = 0;
  let atrasados = 0;
  let alerta = 0;

  for (const item of classificados) {
    const { cliente, info } = item;
    if (cliente.estado_atual === "ATIVO" || info.status === "EM REGIME") {
      ativos++;
    } else if (cliente.estado_atual !== "PAUSADO" && cliente.estado_atual !== "ENCERRADO") {
      onboarding++;
    }

    if (info.status === "ATRASADO") {
      atrasados++;
    } else if (info.status === "ALERTA") {
      alerta++;
    }
  }

  return { ativos, onboarding, atrasados, alerta };
}

/**
 * Gera os dados estruturados do relatório.
 */
export function gerarRelatorioVigia(clientes = [], agora = new Date()) {
  const classificados = clientes.map((c) => ({
    cliente: c,
    info: classificarCliente(c, agora),
  }));

  const resumo = calcularResumo(classificados);
  return { classificados, resumo, agora };
}

/**
 * Formata tabela e resumo para exibição no terminal.
 */
export function formatarRelatorioTerminal({ classificados, resumo, agora, apiUrl }) {
  const d = new Date(agora);
  const dataIso = d.toISOString();
  let dataSp = "";
  try {
    dataSp = d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    dataSp = dataIso;
  }

  const linhas = [];
  linhas.push("===============================================================================================================");
  linhas.push("🔍 RELATÓRIO DO VIGIA GD · MONITORAMENTO DE ESTADOS E SLAS");
  linhas.push(`• Horário UTC:         ${dataIso}`);
  linhas.push(`• Horário de Brasília: ${dataSp} (America/Sao_Paulo)`);
  if (apiUrl) {
    linhas.push(`• Origem dos dados:    ${apiUrl}`);
  }
  linhas.push("===============================================================================================================");
  linhas.push("");

  // Cabeçalho da tabela
  const colEmpresa = 28;
  const colEstado = 28;
  const colResp = 13;
  const colTempo = 26;
  const colSla = 18;
  const colStatus = 16;

  const pad = (str, len) => {
    const s = String(str || "");
    return s.length > len ? s.slice(0, len - 1) + "…" : s.padEnd(len, " ");
  };

  linhas.push(
    pad("Empresa", colEmpresa) + " | " +
    pad("Estado Atual", colEstado) + " | " +
    pad("Responsável", colResp) + " | " +
    pad("Tempo no Estado", colTempo) + " | " +
    pad("Prazo SLA", colSla) + " | " +
    pad("Status", colStatus)
  );
  linhas.push("-".repeat(colEmpresa + colEstado + colResp + colTempo + colSla + colStatus + 15));

  for (const { cliente, info } of classificados) {
    const estadoRotulo = cliente.rotulo_interno || cliente.estado_atual || "Sem estado";
    const tempoStr = `${info.horas_decorridas}h (${info.detalhe})`;
    linhas.push(
      pad(cliente.nome_empresa, colEmpresa) + " | " +
      pad(estadoRotulo, colEstado) + " | " +
      pad(info.responsavel, colResp) + " | " +
      pad(tempoStr, colTempo) + " | " +
      pad(info.prazo_sla, colSla) + " | " +
      pad(info.status, colStatus)
    );
  }

  linhas.push("-".repeat(colEmpresa + colEstado + colResp + colTempo + colSla + colStatus + 15));
  linhas.push("");
  linhas.push("===============================================================================================================");
  linhas.push("📊 RESUMO OPERACIONAL:");
  linhas.push(`• Clientes Ativos (em regime):  ${resumo.ativos}`);
  linhas.push(`• Clientes em Onboarding/Funil: ${resumo.onboarding}`);
  linhas.push(`• Demandas Atrasadas:           ${resumo.atrasados > 0 ? `🚨 ${resumo.atrasados}` : "0"}`);
  linhas.push(`• Demandas em Alerta:           ${resumo.alerta > 0 ? `⚠️  ${resumo.alerta}` : "0"}`);
  linhas.push("===============================================================================================================");

  return linhas.join("\n");
}

/**
 * Busca clientes na rota autenticada do Vigia.
 */
export async function buscarClientesVigia({ apiUrl, token }) {
  const url = `${apiUrl.replace(/\/+$/, "")}/api/gd/clientes/vigia`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const erroTexto = await res.text().catch(() => "");
    throw new Error(`Falha na requisição ao Vigia (HTTP ${res.status}): ${erroTexto || res.statusText}`);
  }

  const payload = await res.json();
  if (!payload || !Array.isArray(payload.clientes)) {
    throw new Error("Resposta inválida da rota do Vigia: campo 'clientes' não é um array.");
  }

  return payload.clientes;
}

// Dados mock para execução demonstrativa/dry-run se a API não estiver acessível
const CLIENTES_MOCK = [
  {
    id: "mock-1",
    nome_empresa: "Óticas Exemplo",
    estado_atual: "BRIEFING_AGENDADO",
    fase: "entrada",
    ordem: 80,
    entrou_em: new Date(Date.now() - 75 * 3600 * 1000).toISOString(),
    prazo_horas: 72,
    prazo_contagem: "horas_corridas",
    rotulo_interno: "Briefing agendado",
    acao_do_cliente: false,
  },
  {
    id: "mock-2",
    nome_empresa: "Laboratório Saúde",
    estado_atual: "PLANEJAMENTO_APROVACAO",
    fase: "estrategia",
    ordem: 140,
    entrou_em: new Date(Date.now() - 40 * 3600 * 1000).toISOString(),
    prazo_horas: 48,
    prazo_contagem: "horas_corridas",
    rotulo_interno: "Planejamento para aprovar",
    acao_do_cliente: true,
  },
  {
    id: "mock-3",
    nome_empresa: "Clínica Dental Prime",
    estado_atual: "PROPOSTA_ENVIADA",
    fase: "comercial",
    ordem: 10,
    entrou_em: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
    prazo_horas: 168,
    prazo_contagem: "horas_corridas",
    rotulo_interno: "Proposta enviada",
    acao_do_cliente: false,
  },
  {
    id: "mock-4",
    nome_empresa: "Studio Pilates Movimento",
    estado_atual: "ATIVO",
    fase: "regime",
    ordem: 160,
    entrou_em: new Date(Date.now() - 500 * 3600 * 1000).toISOString(),
    prazo_horas: null,
    prazo_contagem: "horas_corridas",
    rotulo_interno: "Cliente ativo",
    acao_do_cliente: false,
  },
];

async function main() {
  loadEnvFallback();

  const apiUrl = process.env.VEXO_API_URL || "https://vexo-backend.xdvm8y.easypanel.host";
  const token = process.env.GOCLAW_READ_TOKEN;
  const isMockExplicit = process.argv.includes("--mock");

  let clientes = [];
  let origemDescricao = "";

  if (isMockExplicit || !token) {
    if (!token && !isMockExplicit) {
      console.warn("⚠️  GOCLAW_READ_TOKEN não encontrado no ambiente. Executando em modo de demonstração com dados simulados.");
      console.warn("   Para conectar na API real, exporte GOCLAW_READ_TOKEN=<token>.\n");
    }
    clientes = CLIENTES_MOCK;
    origemDescricao = "Simulação Local (Mock)";
  } else {
    try {
      clientes = await buscarClientesVigia({ apiUrl, token });
      origemDescricao = `${apiUrl}/api/gd/clientes/vigia`;
    } catch (err) {
      console.error(`❌ Não foi possível consultar a API real (${err.message}).`);
      console.log("   Alternando para simulação de demonstração para visualização do formato:\n");
      clientes = CLIENTES_MOCK;
      origemDescricao = "Simulação de Contingência (Mock)";
    }
  }

  const relatorio = gerarRelatorioVigia(clientes, new Date());
  const textoFormatado = formatarRelatorioTerminal({
    classificados: relatorio.classificados,
    resumo: relatorio.resumo,
    agora: relatorio.agora,
    apiUrl: origemDescricao,
  });

  console.log(textoFormatado);
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith("vigia-gd.mjs") ||
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
);

if (isMain) {
  main().catch((err) => {
    console.error("❌ Erro fatal no Vigia GD:", err);
    process.exit(1);
  });
}
