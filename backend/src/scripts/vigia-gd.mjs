#!/usr/bin/env node

/**
 * vigia-gd.mjs
 *
 * Script do Vigia da Geração Digital & Vexo OS.
 * Realiza a leitura autenticada dos estados dos clientes via rota /api/gd/clientes/vigia,
 * calcula o tempo de permanência em relação ao SLA de cada estado e classifica gargalos.
 * Gera briefings humanizados via GoClaw (Gemini 3 Flash) e despacha via Slack e WhatsApp.
 *
 * Uso:
 *   node backend/src/scripts/vigia-gd.mjs
 *   node backend/src/scripts/vigia-gd.mjs --dry-run
 *   node backend/src/scripts/vigia-gd.mjs --dispatch
 *   node backend/src/scripts/vigia-gd.mjs --periodo=checkin
 *   node backend/src/scripts/vigia-gd.mjs --periodo=fechamento
 *   node backend/src/scripts/vigia-gd.mjs --mock
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendSlackMessage } from "../services/trelloSlackReporter.js";
import { sendTextMessageViaEvolution } from "../services/evolution.js";

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
 * Determina o período da execução (checkin vs fechamento).
 * Respeita a flag --periodo=checkin|fechamento se fornecida.
 * Caso contrário, infere pelo horário em Brasília: antes das 12h = checkin, a partir das 12h = fechamento.
 */
export function determinarPeriodo(args = [], agora = new Date()) {
  const argPeriodo = args.find((a) => typeof a === "string" && a.startsWith("--periodo="));
  if (argPeriodo) {
    const val = argPeriodo.split("=")[1].toLowerCase().trim();
    if (val === "checkin" || val === "fechamento") {
      return val;
    }
  }

  let hora = agora.getHours();
  try {
    const spStr = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hour12: false,
    }).format(agora);
    const parsedHora = parseInt(spStr, 10);
    if (!Number.isNaN(parsedHora)) {
      hora = parsedHora;
    }
  } catch {
    // Mantém hora local como fallback
  }

  return hora < 12 ? "checkin" : "fechamento";
}

/**
 * Normaliza e valida números de telefone para envio no WhatsApp via Evolution API.
 * Remove caracteres não numéricos, adiciona DDI 55 se ausente e valida o padrão brasileiro.
 */
export function normalizarNumerosWhatsApp(rawInput) {
  if (!rawInput) return [];
  const partes = Array.isArray(rawInput)
    ? rawInput
    : String(rawInput).split(",");

  const validos = new Set();

  for (const item of partes) {
    if (!item) continue;
    let digitos = String(item).replace(/\D/g, "");
    if (!digitos) continue;

    // Se tem 10 ou 11 dígitos (DDD + número), adiciona DDI 55
    if (digitos.length === 10 || digitos.length === 11) {
      digitos = `55${digitos}`;
    }

    // Valida regex: DDI 55 + DDD (11-99) + 8 ou 9 dígitos -> total 12 ou 13 dígitos
    if (/^55[1-9][0-9]{9,10}$/.test(digitos)) {
      validos.add(digitos);
    }
  }

  return Array.from(validos);
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
 * Monta o prompt do GoClaw (Gemini 3 Flash) com a persona do Vigia GD.
 */
export function gerarPromptGoClaw({ relatorio, periodo }) {
  const isCheckin = periodo === "checkin";
  const periodoTitulo = isCheckin ? "Check-in Matinal" : "Fechamento Operacional";
  const { resumo, classificados } = relatorio;

  const pendencias = classificados
    .filter((c) => c.info.status === "ATRASADO" || c.info.status === "ALERTA")
    .map((c) => {
      const rotulo = c.cliente.rotulo_interno || c.cliente.estado_atual;
      return `- ${c.cliente.nome_empresa}: Estado "${rotulo}" | Status: ${c.info.status} (${c.info.detalhe}) | Responsável pela ação: ${c.info.responsavel} | Tempo: ${c.info.horas_decorridas}h decorridas (SLA: ${c.info.prazo_sla})`;
    });

  const outrosEmTransicao = classificados
    .filter((c) => c.info.status !== "EM REGIME" && c.info.status !== "PAUSADO" && c.info.status !== "ENCERRADO" && c.info.status !== "ATRASADO" && c.info.status !== "ALERTA")
    .map((c) => {
      const rotulo = c.cliente.rotulo_interno || c.cliente.estado_atual;
      return `- ${c.cliente.nome_empresa}: Estado "${rotulo}" | Responsável: ${c.info.responsavel} | Tempo: ${c.info.horas_decorridas}h decorridas (SLA: ${c.info.prazo_sla})`;
    });

  const system = [
    "Você é o Vigia Operacional da Geração Digital & Vexo OS.",
    "Seu papel é emitir um briefing executivo, ágil e conversado sobre o status da carteira de clientes GD para envio direto no Slack e WhatsApp da diretoria (Conrado e Caio).",
    "Diretrizes obrigatórias:",
    "1. Tom de voz direto, profissional, assertivo e sem floreios ou enrolações.",
    "2. Se houver demandas ATRASADAS ou em ALERTA, aponte exatamente quem deve ser cobrado (Cliente vs Equipe GD), qual é a empresa e há quanto tempo está no estado.",
    "3. Se TODOS os clientes estiverem em regime (ou sem pendências/atrasos), comemore a estabilidade operacional da carteira de maneira sóbria e executiva.",
    "4. Formate a mensagem de modo escaneável e agradável para leitura rápida no celular (títulos em negrito, bullets objetivos, emojis pontuais e bem posicionados).",
    `5. Contexto do envio: ${periodoTitulo}.`,
  ].join("\n");

  const user = [
    `=== DADOS OPERACIONAIS DO VIGIA GD (${periodoTitulo.toUpperCase()}) ===`,
    `Período: ${periodoTitulo}`,
    `Resumo:`,
    `- Clientes Ativos (em regime): ${resumo.ativos}`,
    `- Clientes em Onboarding/Funil: ${resumo.onboarding}`,
    `- Demandas Atrasadas: ${resumo.atrasados}`,
    `- Demandas em Alerta: ${resumo.alerta}`,
    "",
    `Pendências Críticas (Atrasados / Alerta):`,
    pendencias.length > 0 ? pendencias.join("\n") : "Nenhuma demanda atrasada ou em alerta no momento.",
    "",
    `Outros Clientes em Transição (No prazo / Em análise):`,
    outrosEmTransicao.length > 0 ? outrosEmTransicao.join("\n") : "Nenhum.",
    "",
    "Gere o briefing operacional pronto para publicação.",
  ].join("\n");

  return { system, user };
}

/**
 * Gera um briefing de contingência limpo e determinístico caso o GoClaw esteja indisponível.
 */
export function gerarBriefingFallback({ relatorio, periodo }) {
  const isCheckin = periodo === "checkin";
  const saudacao = isCheckin ? "☀️ *Check-in Operacional GD*" : "🌙 *Fechamento Operacional GD*";
  const { resumo, classificados } = relatorio;

  const linhas = [
    saudacao,
    "",
    `• Clientes Ativos (em regime): *${resumo.ativos}*`,
    `• Clientes em Onboarding/Funil: *${resumo.onboarding}*`,
    `• Demandas Atrasadas: ${resumo.atrasados > 0 ? `🚨 *${resumo.atrasados}*` : "0"}`,
    `• Demandas em Alerta: ${resumo.alerta > 0 ? `⚠️ *${resumo.alerta}*` : "0"}`,
  ];

  const pendencias = classificados.filter(
    (c) => c.info.status === "ATRASADO" || c.info.status === "ALERTA"
  );

  if (pendencias.length > 0) {
    linhas.push("");
    linhas.push("*Atenção requerida:*");
    for (const item of pendencias) {
      const icone = item.info.status === "ATRASADO" ? "🚨" : "⚠️";
      const estadoRotulo = item.cliente.rotulo_interno || item.cliente.estado_atual;
      linhas.push(
        `${icone} *${item.cliente.nome_empresa}*: ${estadoRotulo} (${item.info.detalhe}) — Cobrar: *${item.info.responsavel}*`
      );
    }
  } else {
    linhas.push("");
    linhas.push("✅ Carteira 100% em dia. Nenhuma demanda atrasada ou em alerta.");
  }

  return linhas.join("\n");
}

/**
 * Consulta o GoClaw LLM (Gemini 3 Flash) para gerar o briefing humanizado com fallback resiliente.
 */
export async function gerarBriefingGoClaw({
  relatorio,
  periodo,
  goclawUrl = process.env.GOCLAW_URL || "http://vexo_goclaw:1337",
  goclawToken = process.env.GOCLAW_GATEWAY_TOKEN,
  timeoutMs = 8000,
  fetchFn = fetch,
}) {
  const fallback = gerarBriefingFallback({ relatorio, periodo });

  if (!goclawToken) {
    return fallback;
  }

  const effectiveUrl = (goclawUrl || "http://localhost:1337").replace(/\/+$/, "");
  const endpoint = `${effectiveUrl}/v1/chat/completions`;
  const prompt = gerarPromptGoClaw({ relatorio, periodo });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${goclawToken}`,
      },
      body: JSON.stringify({
        model: "gemini/gemini-3-flash-preview",
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn(`[Vigia] GoClaw LLM retornou HTTP ${res.status}: ${txt || res.statusText}. Usando briefing fallback.`);
      return fallback;
    }

    const data = await res.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim().length > 0) {
      return content.trim();
    }

    console.warn("[Vigia] Resposta do GoClaw não continha choices[0].message.content válido. Usando briefing fallback.");
    return fallback;
  } catch (err) {
    clearTimeout(timer);
    const motivo = err.name === "AbortError" ? `timeout de ${timeoutMs}ms` : err.message;
    console.warn(`[Vigia] Erro ao consultar GoClaw LLM (${motivo}). Usando briefing fallback.`);
    return fallback;
  }
}

/**
 * Despacha o briefing do Vigia para o Slack (#01-ops-geral) e WhatsApp (Evolution API).
 */
export async function despacharVigia({
  briefingTexto,
  relatorio,
  dryRun = true,
  periodo = "checkin",
  slackSender = sendSlackMessage,
  evolutionSender = sendTextMessageViaEvolution,
  config = {},
}) {
  const slackChannel = config.slackChannel || process.env.GD_VIGIA_SLACK_CHANNEL || "01-ops-geral";
  const slackToken = config.slackToken || process.env.SLACK_BOT_TOKEN;

  const rawWhatsapp = config.whatsappNumbers != null
    ? config.whatsappNumbers
    : (process.env.GD_VIGIA_WHATSAPP_NUMBERS || "");
  const whatsappNumbers = normalizarNumerosWhatsApp(rawWhatsapp);

  const evolutionInstance = config.instanceName || process.env.GD_EVOLUTION_INSTANCE || "Teste";
  const evolutionUrl = config.evolutionUrl || process.env.EVOLUTION_API_URL;
  const evolutionApiKey = config.evolutionApiKey || process.env.EVOLUTION_API_KEY || process.env.GD_EVOLUTION_API_TOKEN;

  if (dryRun) {
    return {
      dryRun: true,
      slack: {
        enviado: false,
        canal: slackChannel,
        motivo: "dry-run ativo (--dispatch não fornecido)",
      },
      whatsapp: {
        enviado: false,
        destinatarios: whatsappNumbers,
        instancia: evolutionInstance,
        motivo: "dry-run ativo (--dispatch não fornecido)",
      },
    };
  }

  // 1. Despacho real para o Slack
  const slackResult = { canal: slackChannel, enviado: false };
  if (!slackToken) {
    slackResult.erro = "SLACK_BOT_TOKEN não configurado no ambiente.";
    console.warn(`[Vigia Slack] Não enviado: ${slackResult.erro}`);
  } else {
    try {
      const resp = await slackSender({
        text: briefingTexto,
        channel: slackChannel,
        token: slackToken,
      });
      slackResult.enviado = true;
      slackResult.resposta = resp;
    } catch (err) {
      slackResult.erro = err.message;
      console.error(`[Vigia Slack] Erro ao enviar para #${slackChannel}:`, err.message);
    }
  }

  // 2. Despacho real para o WhatsApp via Evolution
  const whatsappResults = [];
  if (whatsappNumbers.length === 0) {
    console.warn("[Vigia WhatsApp] Nenhum destinatário válido configurado em GD_VIGIA_WHATSAPP_NUMBERS.");
  }

  for (const numero of whatsappNumbers) {
    try {
      const resp = await evolutionSender({
        instanceName: evolutionInstance,
        number: numero,
        text: briefingTexto,
        baseUrl: evolutionUrl,
        webhookToken: evolutionApiKey,
      });
      whatsappResults.push({
        numero,
        enviado: true,
        waMessageId: resp?.waMessageId || null,
      });
    } catch (err) {
      console.error(`[Vigia WhatsApp] Erro ao enviar para ${numero}:`, err.message);
      whatsappResults.push({
        numero,
        enviado: false,
        erro: err.message,
      });
    }
  }

  return {
    dryRun: false,
    slack: slackResult,
    whatsapp: {
      enviado: whatsappResults.some((r) => r.enviado),
      destinatarios: whatsappResults,
    },
  };
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
  const isDispatch = process.argv.includes("--dispatch");
  const isDryRun = !isDispatch;
  const periodo = determinarPeriodo(process.argv, new Date());

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
  const textoTerminal = formatarRelatorioTerminal({
    classificados: relatorio.classificados,
    resumo: relatorio.resumo,
    agora: relatorio.agora,
    apiUrl: origemDescricao,
  });

  console.log(textoTerminal);

  console.log("\n🤖 Gerando briefing executivo do Vigia (GoClaw LLM)...");
  const briefingTexto = await gerarBriefingGoClaw({
    relatorio,
    periodo,
    goclawUrl: process.env.GOCLAW_URL,
    goclawToken: process.env.GOCLAW_GATEWAY_TOKEN,
  });

  console.log("\n---------------------------------------------------------------------------------------------------------------");
  console.log(`📝 BRIEFING DO VIGIA (${periodo.toUpperCase()})`);
  console.log("---------------------------------------------------------------------------------------------------------------");
  console.log(briefingTexto);
  console.log("---------------------------------------------------------------------------------------------------------------\n");

  const resultadoDespacho = await despacharVigia({
    briefingTexto,
    relatorio,
    dryRun: isDryRun,
    periodo,
  });

  if (isDryRun) {
    console.log("ℹ️  Modo DRY-RUN ativo. Nenhuma mensagem foi despachada para canais externos.");
    console.log("   Para realizar o envio real para Slack e WhatsApp, execute com a flag --dispatch.");
  } else {
    console.log("🚀 Resultado do Despacho:");
    console.log(`• Slack:    ${resultadoDespacho.slack.enviado ? "✅ Enviado" : `❌ Falhou (${resultadoDespacho.slack.erro || "não enviado"})`}`);
    const zapTotal = resultadoDespacho.whatsapp.destinatarios?.length || 0;
    const zapSucesso = resultadoDespacho.whatsapp.destinatarios?.filter((d) => d.enviado).length || 0;
    console.log(`• WhatsApp: ${zapSucesso}/${zapTotal} enviados com sucesso.`);
  }
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
