/**
 * heloisaEngine.js - Motor da Heloísa (Secretária Executiva WhatsApp dos Sócios)
 *
 * Exclusivo para os diretores Conrado Finzi e Caio Almeida.
 * Recebe demandas em áudio (transcritas via Groq Whisper) ou texto,
 * interpreta intenções com Gemini 3 Flash / Groq LLM com Function Calling,
 * e executa tarefas reais no banco Vexo OS e WhatsApp da equipe.
 *
 * REGRA ABSOLUTA: ZERO SLACK. Tudo 100% WhatsApp via Evolution API.
 */

import { pgDatabasePool } from "../../services/database.js";
import {
  sendTextMessageViaEvolution,
  buildEvolutionAuthHeaders,
  extractEvolutionInstanceSlug,
} from "../../services/evolution.js";
import { extractMediaBase64, extractMediaMimetype, transcribeAudio } from "../../chatbot-ai-engine.js";
import fs from "node:fs";
import path from "node:path";
import { resolveGoclawDir } from "./routes.js";
import { defaultGroqModel } from "../../services/llmModels.js";
import { generateSpeechAudio } from "../../services/voiceService.js";

export const DIRETORES_AUTORIZADOS = {
  conrado: {
    nome: "Conrado Finzi",
    telefone: "5534997817660",
    telefoneAlt: "553497817660",
    papel: "Diretor Executivo / Sócio",
  },
  caio: {
    nome: "Caio Almeida",
    telefone: "5534997719779",
    telefoneAlt: "553497719779",
    papel: "Diretor Comercial / Sócio",
  },
};

export function normalizarTelefoneHeloisa(rawPhone) {
  if (!rawPhone) return "";
  const limpo = String(rawPhone).replace(/\D/g, "");
  return limpo;
}

export function identificarDiretor(phone) {
  const limpo = normalizarTelefoneHeloisa(phone);
  for (const [key, d] of Object.entries(DIRETORES_AUTORIZADOS)) {
    if (limpo === d.telefone || limpo === d.telefoneAlt || limpo.endsWith(d.telefone.slice(4)) || limpo.endsWith(d.telefoneAlt.slice(4))) {
      return { chave: key, ...d };
    }
  }
  return null;
}

export function isHeloisaAuthorizedSender(phone) {
  return Boolean(identificarDiretor(phone));
}

export async function identificarUsuarioAutorizado(phone, pool = pgDatabasePool) {
  const limpo = normalizarTelefoneHeloisa(phone);
  if (!limpo) return null;

  // 1. Consulta no banco na tabela heloisa_usuarios_autorizados
  if (pool && typeof pool.query === "function") {
    try {
      const { rows } = await pool.query(
        `SELECT id, client_id, nome, telefone, papel, ativo
         FROM public.heloisa_usuarios_autorizados
         WHERE ativo = true`
      );

      for (const u of rows) {
        const uTel = normalizarTelefoneHeloisa(u.telefone);
        if (
          limpo === uTel ||
          (uTel.length >= 8 && limpo.endsWith(uTel.slice(4))) ||
          (limpo.length >= 8 && uTel.endsWith(limpo.slice(4)))
        ) {
          return {
            id: u.id,
            chave: u.nome.toLowerCase().replace(/\s+/g, "_"),
            nome: u.nome,
            telefone: u.telefone,
            papel: u.papel,
            client_id: u.client_id,
            ativo: u.ativo,
          };
        }
      }
    } catch (err) {
      console.warn("[Heloísa] Aviso ao consultar heloisa_usuarios_autorizados, usando fallback:", err.message);
    }
  }

  // 2. Fallback de segurança em memória: Conrado e Caio
  return identificarDiretor(phone);
}

export async function isHeloisaAuthorizedSenderAsync(phone, pool = pgDatabasePool) {
  const user = await identificarUsuarioAutorizado(phone, pool);
  return Boolean(user);
}

// ─── Ferramentas de Execução da Heloísa ───────────────────────────────────────

export async function executarCadastrarCliente({ nome, telefone, empresa, valor, escopo }, pool = pgDatabasePool) {
  try {
    const nomeFinal = nome?.trim();
    if (!nomeFinal) return { sucesso: false, erro: "Nome do cliente é obrigatório." };

    const telFinal = normalizarTelefoneHeloisa(telefone) || null;
    const { rows } = await pool.query(
      `INSERT INTO public.gd_clientes (nome, telefone, empresa, valor_mensal, escopo, estado, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'novo', NOW(), NOW())
       ON CONFLICT (nome) DO UPDATE SET
         telefone = COALESCE(EXCLUDED.telefone, public.gd_clientes.telefone),
         empresa = COALESCE(EXCLUDED.empresa, public.gd_clientes.empresa),
         valor_mensal = COALESCE(EXCLUDED.valor_mensal, public.gd_clientes.valor_mensal),
         escopo = COALESCE(EXCLUDED.escopo, public.gd_clientes.escopo),
         updated_at = NOW()
       RETURNING id, nome, estado`,
      [nomeFinal, telFinal, empresa || null, valor ? Number(valor) : null, escopo || "Completo"]
    ).catch(async () => {
      // Fallback para tabela leads se schema gd_clientes tiver restrições diferentes
      return await pool.query(
        `INSERT INTO public.leads (nome, telefone, empresa, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'novo', NOW(), NOW())
         RETURNING id, nome, status as estado`,
        [nomeFinal, telFinal, empresa || null]
      );
    });

    return {
      sucesso: true,
      cliente: rows[0],
      mensagem: `Cliente "${nomeFinal}" registrado com sucesso no CRM.`,
    };
  } catch (err) {
    console.error("[Heloísa] Erro ao cadastrar cliente:", err);
    return { sucesso: false, erro: err.message };
  }
}

export async function obterInstanciaWhatsAppAtiva(pool = pgDatabasePool, tenantId = "vexo-adm") {
  try {
    if (process.env.GD_EVOLUTION_INSTANCE && process.env.GD_EVOLUTION_INSTANCE !== "heloisa") {
      return process.env.GD_EVOLUTION_INSTANCE;
    }

    if (pool && typeof pool.query === "function") {
      const allowedTenants = Array.from(new Set([tenantId, "vexo-adm", "geracao-digital"].filter(Boolean)));
      const { rows } = await pool.query(
        `SELECT name, client_id, is_default, connection_state, dispatch_webhook_url
         FROM public.lead_client_evolution_instances
         WHERE client_id = ANY($1::text[])
         ORDER BY (connection_state = 'open') DESC, is_default DESC, id DESC
         LIMIT 10`,
        [allowedTenants]
      ).catch(() => ({ rows: [] }));

      if (rows && rows.length > 0) {
        const aberta = rows.find((r) => r.connection_state === "open" || !r.connection_state);
        const alvo = aberta || rows[0];
        const slug =
          extractEvolutionInstanceSlug(alvo.dispatch_webhook_url) ||
          alvo.instance_name ||
          alvo.name;
        if (slug) return slug;
      }
    }
  } catch (err) {
    console.warn("[Heloísa] Falha ao consultar instâncias ativas do banco:", err.message);
  }

  // Fallback padrão seguro para a instância da Vexo
  return "vexo-adm-vexo-atende";
}

/**
 * Consulta em tempo real na Evolution API as instâncias que estão com conexão ativa (open).
 * Restringe estritamente às instâncias oficiais da Vexo / GD para evitar vazamento entre tenants.
 */
export async function obterInstanciasEvolutionAbertas(baseUrl, apiKey = null) {
  try {
    const url = `${(baseUrl || "https://vexo-evolution-api.xdvm8y.easypanel.host").replace(/\/+$/, "")}/instance/fetchInstances`;
    const key =
      apiKey ||
      process.env.EVOLUTION_API_KEY ||
      process.env.GD_EVOLUTION_API_TOKEN ||
      process.env.GD_EVOLUTION_TOKEN ||
      "429683C4C977415CAAFCCE10F7D57E11";

    const headers = {
      Accept: "application/json",
      ...(typeof buildEvolutionAuthHeaders === "function"
        ? buildEvolutionAuthHeaders(key)
        : { apikey: key, Authorization: `Bearer ${key}` }),
    };

    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3500),
    });

    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    const authorizedInstances = new Set(["vexo-adm-vexo-atende", "geracao-digital-teste-vexo"]);
    return list
      .filter((i) => i && (i.connectionStatus === "open" || i.connection_state === "open"))
      .map((i) => i.name)
      .filter((name) => authorizedInstances.has(name));
  } catch (err) {
    console.warn("[Heloísa] Falha ao consultar fetchInstances na Evolution:", err.message);
    return [];
  }
}

/**
 * Envia mensagem no WhatsApp com contingência automática de instâncias.
 * IMPORTANTE: Heloísa pertence à diretoria da Vexo / Geração Digital.
 * Suas mensagens DEVEM OBRIGATORIAMENTE ser enviadas pelas instâncias oficiais da Vexo:
 * - Instância onde o diretor enviou a mensagem (ex: vexo-adm-vexo-atende)
 * - Contingência oficial: geracao-digital-teste-vexo (que usa o mesmo número da Vexo +55 34 9175-1267)
 * NUNCA utilizar instâncias dinâmicas de outros clientes/tenants da Evolution API.
 */
export async function enviarMensagemWhatsAppComFallback({
  numero,
  texto,
  instanceName = null,
  tenantId = "vexo-adm",
  pool = pgDatabasePool,
}) {
  const baseUrl =
    process.env.GD_EVOLUTION_URL ||
    process.env.EVOLUTION_API_URL ||
    "https://vexo-evolution-api.xdvm8y.easypanel.host";

  const primaryInstance =
    instanceName ||
    (await obterInstanciaWhatsAppAtiva(pool, tenantId));

  // Instâncias estritamente autorizadas para a Heloísa (pertencentes ao número oficial da Vexo: +55 34 9175-1267).
  // JAMAIS enviar por instâncias de outros clientes/tenants da Evolution API.
  const authorizedVexoInstances = ["vexo-adm-vexo-atende", "geracao-digital-teste-vexo"];

  const candidates = [
    primaryInstance,
    ...authorizedVexoInstances,
  ].filter(Boolean).filter((val, idx, self) => self.indexOf(val) === idx);

  let lastError = null;

  for (const candidate of candidates) {
    try {
      console.log(`[Heloísa] Tentando envio de WhatsApp para ${numero} via instância autorizada "${candidate}"...`);
      const envio = await sendTextMessageViaEvolution({
        instanceName: candidate,
        number: numero,
        text: texto,
        baseUrl,
      });
      console.log(`[Heloísa] Mensagem enviada com sucesso para ${numero} via instância autorizada "${candidate}"!`);
      return { envio, instanceName: candidate };
    } catch (err) {
      console.warn(`[Heloísa] Falha ao enviar via instância autorizada "${candidate}": ${err.message}. Tentando contingência autorizada...`);
      lastError = err;
    }
  }

  throw lastError || new Error("Nenhuma instância autorizada da Vexo disponível para envio.");
}

export async function executarEnviarMensagemWhatsApp(
  { destinatario, mensagem, telefone = null, tenant_id = null },
  pool = pgDatabasePool,
  instanceName = null
) {
  try {
    const dest = String(destinatario || "").trim();
    const msg = String(mensagem || "").trim();
    if (!msg) return { sucesso: false, erro: "O texto da mensagem é obrigatório." };

    let numeroNormalizado = null;
    let nomeFinal = dest || "Destinatário";

    // 1. Telefone explícito ou se destinatário já for número
    const rawNumber = String(telefone || dest).replace(/\D/g, "");
    if (rawNumber.length >= 10 && rawNumber.length <= 13) {
      numeroNormalizado = rawNumber.startsWith("55") ? rawNumber : `55${rawNumber}`;
    }

    // 2. Busca por nome conhecido
    if (!numeroNormalizado) {
      const destLower = dest.toLowerCase();

      if (destLower.includes("conrado")) {
        numeroNormalizado = "5534997817660";
        nomeFinal = "Conrado Finzi";
      } else if (destLower.includes("caio")) {
        numeroNormalizado = "5534997719779";
        nomeFinal = "Caio Almeida";
      }

      // Busca em heloisa_usuarios_autorizados
      if (!numeroNormalizado && pool && typeof pool.query === "function") {
        const { rows: diretores } = await pool.query(
          `SELECT nome, telefone FROM public.heloisa_usuarios_autorizados WHERE ativo = true AND LOWER(nome) LIKE $1 LIMIT 1`,
          [`%${destLower}%`]
        ).catch(() => ({ rows: [] }));
        if (diretores.length > 0) {
          numeroNormalizado = String(diretores[0].telefone).replace(/\D/g, "");
          nomeFinal = diretores[0].nome;
        }
      }

      // Busca em gd_colaboradores
      if (!numeroNormalizado && pool && typeof pool.query === "function") {
        const { rows: colabs } = await pool.query(
          `SELECT nome, telefone FROM public.gd_colaboradores WHERE ativo = true AND (LOWER(nome) LIKE $1 OR LOWER(funcao) LIKE $1) LIMIT 1`,
          [`%${destLower}%`]
        ).catch(() => ({ rows: [] }));
        if (colabs.length > 0) {
          numeroNormalizado = String(colabs[0].telefone).replace(/\D/g, "");
          nomeFinal = colabs[0].nome;
        }
      }

      // Busca em gd_clientes ou leads
      if (!numeroNormalizado && pool && typeof pool.query === "function") {
        const { rows: clientes } = await pool.query(
          `SELECT nome, telefone FROM public.gd_clientes WHERE LOWER(nome) LIKE $1 OR LOWER(empresa) LIKE $1 LIMIT 1`,
          [`%${destLower}%`]
        ).catch(() => ({ rows: [] }));
        if (clientes.length > 0 && clientes[0].telefone) {
          numeroNormalizado = String(clientes[0].telefone).replace(/\D/g, "");
          nomeFinal = clientes[0].nome;
        }
      }
    }

    if (!numeroNormalizado) {
      return {
        sucesso: false,
        erro: `Não encontrei o telefone de "${dest}". Por favor, especifique o número com DDD.`,
      };
    }

    if (!numeroNormalizado.startsWith("55") && (numeroNormalizado.length === 10 || numeroNormalizado.length === 11)) {
      numeroNormalizado = `55${numeroNormalizado}`;
    }

    console.log(`[Heloísa] Disparando WhatsApp para ${nomeFinal} (${numeroNormalizado})`);

    const { envio, instanceName: instanciaUsada } = await enviarMensagemWhatsAppComFallback({
      numero: numeroNormalizado,
      texto: msg,
      instanceName,
      tenantId: tenant_id || "geracao-digital",
      pool,
    });

    return {
      sucesso: true,
      destinatario: nomeFinal,
      telefone: numeroNormalizado,
      instanceName: instanciaUsada,
      mensagem: msg,
      waMessageId: envio?.waMessageId || null,
    };
  } catch (err) {
    console.error("[Heloísa] Erro ao enviar mensagem WhatsApp:", err);
    return {
      sucesso: false,
      erro: err.message || "Falha ao enviar mensagem pelo WhatsApp.",
    };
  }
}

export async function executarCobrarColaborador({ colaborador, mensagem }, pool = pgDatabasePool, instanceName = null) {
  try {
    const termo = String(colaborador || "").trim().toLowerCase();
    if (!termo) return { sucesso: false, erro: "Nome ou função do colaborador não informada." };

    let colab = null;

    if (termo.includes("conrado")) {
      colab = { nome: "Conrado Finzi", funcao: "Diretor / Sócio", telefone: "5534997817660" };
    } else if (termo.includes("caio")) {
      colab = { nome: "Caio Almeida", funcao: "Diretor / Sócio", telefone: "5534997719779" };
    } else {
      // Busca o colaborador no banco
      const { rows } = await pool.query(
        `SELECT id, nome, funcao, telefone, recebe_cobranca_whatsapp, ativo
         FROM public.gd_colaboradores
         WHERE ativo = true AND (LOWER(nome) LIKE $1 OR LOWER(funcao) LIKE $1)
         LIMIT 1`,
        [`%${termo}%`]
      );

      if (rows.length === 0) {
        return {
          sucesso: false,
          erro: `Não encontrei nenhum colaborador ativo na equipe com o termo "${colaborador}".`,
        };
      }

      colab = rows[0];
    }

    let telCanonico = String(colab.telefone).replace(/\D/g, "");
    if (!telCanonico.startsWith("55") && (telCanonico.length === 10 || telCanonico.length === 11)) {
      telCanonico = `55${telCanonico}`;
    }

    const textoMensagem = `Olá ${colab.nome}! Aqui é a *Heloísa* (Secretária Executiva da Diretoria).\n\n${mensagem}\n\n_Mensagem enviada sob orientação da diretoria da Geração Digital._`;

    // Dispara WhatsApp com contingência automática
    const { envio, instanceName: instanciaUsada } = await enviarMensagemWhatsAppComFallback({
      numero: telCanonico,
      texto: textoMensagem,
      instanceName,
      tenantId: "geracao-digital",
      pool,
    });

    console.log(`[Heloísa] Cobrança/Aviso enviado para ${colab.nome} (${telCanonico}) via ${instanciaUsada}`);

    return {
      sucesso: true,
      colaborador: colab.nome,
      funcao: colab.funcao,
      telefone: telCanonico,
      instanceName: instanciaUsada,
      mensagem: `Mensagem enviada com sucesso no WhatsApp de ${colab.nome} (${colab.funcao}).`,
      waMessageId: envio?.waMessageId || null,
    };
  } catch (err) {
    console.error("[Heloísa] Erro ao cobrar colaborador:", err);
    return { sucesso: false, erro: err.message };
  }
}

export async function executarAgendarCompromisso({ titulo, data_hora, local_ou_link }, pool = pgDatabasePool) {
  try {
    const tit = String(titulo || "Compromisso Agendado").trim();
    let dataIso = new Date().toISOString();
    try {
      const parsed = new Date(data_hora);
      if (!isNaN(parsed.getTime())) dataIso = parsed.toISOString();
    } catch {
      // Mantém default
    }

    const { rows } = await pool.query(
      `INSERT INTO public.events (name, date, location, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id, name, date, location`,
      [tit, dataIso, local_ou_link || "Google Meet"]
    );

    return {
      sucesso: true,
      compromisso: rows[0],
      mensagem: `Compromisso "${tit}" agendado para ${dataIso}.`,
    };
  } catch (err) {
    console.error("[Heloísa] Erro ao agendar compromisso:", err);
    return { sucesso: false, erro: err.message };
  }
}

export async function executarCriarFollowup({ titulo, cliente_nome, data_lembrete, notas }, pool = pgDatabasePool) {
  try {
    const tit = String(titulo || "Lembrete").trim();
    let dataIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    try {
      if (data_lembrete) {
        const parsed = new Date(data_lembrete);
        if (!isNaN(parsed.getTime())) dataIso = parsed.toISOString();
      }
    } catch {
      // default 24h
    }

    const { rows } = await pool.query(
      `INSERT INTO public.lead_reminders (client_id, phone, lead_name, title, notes, remind_at, status, created_at, updated_at)
       VALUES ('geracao-digital', '5534997817660', $1, $2, $3, $4, 'pending', NOW(), NOW())
       RETURNING id, title, remind_at`,
      [cliente_nome || "Geração Digital", tit, notas || null, dataIso]
    );

    return {
      sucesso: true,
      followup: rows[0],
      mensagem: `Lembrete "${tit}" criado para ${dataIso}.`,
    };
  } catch (err) {
    console.error("[Heloísa] Erro ao criar follow-up:", err);
    return { sucesso: false, erro: err.message };
  }
}

export async function executarConsultarOperacao({ tipo }, pool = pgDatabasePool) {
  try {
    if (tipo === "colaboradores") {
      const { rows } = await pool.query(
        `SELECT nome, funcao, telefone, recebe_cobranca_whatsapp, ativo
         FROM public.gd_colaboradores
         ORDER BY nome ASC`
      );
      return { sucesso: true, tipo, colaboradores: rows };
    }

    if (tipo === "clientes_atrasados") {
      const { rows } = await pool.query(
        `SELECT c.id, c.nome, c.estado, c.prazo_vence_em
         FROM public.gd_clientes c
         WHERE c.prazo_vence_em IS NOT NULL AND c.prazo_vence_em < NOW()
         ORDER BY c.prazo_vence_em ASC
         LIMIT 10`
      ).catch(() => ({ rows: [] }));

      return { sucesso: true, tipo, clientesAtrasados: rows };
    }

    // Resumo geral
    const { rows: colabs } = await pool.query(`SELECT COUNT(*) as total FROM public.gd_colaboradores WHERE ativo = true`);
    const { rows: clientes } = await pool.query(`SELECT COUNT(*) as total FROM public.gd_clientes`).catch(() => ({ rows: [{ total: 0 }] }));

    return {
      sucesso: true,
      tipo: "resumo_geral",
      totalColaboradoresAtivos: Number(colabs[0]?.total || 0),
      totalClientes: Number(clientes[0]?.total || 0),
    };
  } catch (err) {
    console.error("[Heloísa] Erro ao consultar operação:", err);
    return { sucesso: false, erro: err.message };
  }
}

export async function executarAuditarGeralVexo({ tenant_id }, pool = pgDatabasePool) {
  try {
    const tid = tenant_id ? String(tenant_id).trim() : null;

    // 1. Leads por estágio
    let leadsQuery = `
      SELECT COALESCE(stage, 'sem_estagio') as estagio, COUNT(*)::int as total
      FROM public.leads
    `;
    const leadsParams = [];
    if (tid) {
      leadsQuery += ` WHERE client_id = $1 `;
      leadsParams.push(tid);
    }
    leadsQuery += ` GROUP BY stage ORDER BY total DESC LIMIT 15`;
    const { rows: leadsPorEstagio } = await pool.query(leadsQuery, leadsParams).catch(() => ({ rows: [] }));

    // Leads parados
    let leadsParadosQuery = `
      SELECT COUNT(*)::int as total
      FROM public.leads
      WHERE (status = 'parado' OR status = 'sem_resposta' OR status = 'alerta')
    `;
    const paradosParams = [];
    if (tid) {
      leadsParadosQuery += ` AND client_id = $1 `;
      paradosParams.push(tid);
    }
    const { rows: [leadsParados] } = await pool.query(leadsParadosQuery, paradosParams).catch(() => ({ rows: [{ total: 0 }] }));

    // 2. Campanhas
    let campQuery = `
      SELECT COALESCE(status, 'rascunho') as status, COUNT(*)::int as total
      FROM public.campaigns
    `;
    const campParams = [];
    if (tid) {
      campQuery += ` WHERE client_id = $1 `;
      campParams.push(tid);
    }
    campQuery += ` GROUP BY status ORDER BY total DESC`;
    const { rows: campanhasPorStatus } = await pool.query(campQuery, campParams).catch(() => ({ rows: [] }));

    // 3. Chips / Instâncias WhatsApp
    let chipsQuery = `
      SELECT name, client_id, active, COALESCE(connection_state, 'desconhecido') as status_conexao
      FROM public.lead_client_evolution_instances
    `;
    const chipsParams = [];
    if (tid) {
      chipsQuery += ` WHERE client_id = $1 `;
      chipsParams.push(tid);
    }
    chipsQuery += ` ORDER BY active DESC, name ASC LIMIT 10`;
    const { rows: chips } = await pool.query(chipsQuery, chipsParams).catch(async () => {
      try {
        const { rows } = await pool.query(`SELECT name, client_id, active FROM public.tenant_whatsapp_instances LIMIT 10`);
        return { rows };
      } catch {
        return { rows: [] };
      }
    });

    // 4. Clientes GD
    let totalClientesGd = 0;
    try {
      const { rows } = await pool.query(`SELECT COUNT(*)::int as total FROM public.gd_clientes`);
      totalClientesGd = Number(rows[0]?.total || 0);
    } catch {
      totalClientesGd = 0;
    }

    return {
      sucesso: true,
      tenant: tid || "Todos os Tenants do Vexo OS (Visão Global)",
      leadsPorEstagio,
      leadsParados: Number(leadsParados?.total || 0),
      campanhasPorStatus,
      chipsAtivos: chips.filter((c) => c.active).length,
      chipsTotal: chips.length,
      chipsDetalhe: chips.map((c) => `${c.name} (${c.active ? "Ativo" : "Inativo"})`),
      totalClientesGd,
    };
  } catch (err) {
    console.error("[Heloísa] Erro ao auditar Vexo OS:", err);
    return { sucesso: false, erro: err.message };
  }
}

export async function executarConsultarClienteOuLead({ termo_busca, tenant_id }, pool = pgDatabasePool) {
  try {
    const termo = String(termo_busca || "").trim();
    if (!termo) return { sucesso: false, erro: "Termo de busca é obrigatório." };

    const tid = tenant_id ? String(tenant_id).trim() : null;
    const termoLike = `%${termo}%`;

    // 1. Busca em public.leads
    let leadsSql = `
      SELECT id, client_id, COALESCE(nome, '') as nome, COALESCE(phone, telefone, '') as telefone, COALESCE(stage, status, '') as estagio
      FROM public.leads
      WHERE (nome ILIKE $1 OR phone ILIKE $1 OR telefone ILIKE $1)
    `;
    const leadsParams = [termoLike];
    if (tid) {
      leadsSql += ` AND client_id = $2`;
      leadsParams.push(tid);
    }
    leadsSql += ` ORDER BY id DESC LIMIT 5`;
    const { rows: leadsEncontrados } = await pool.query(leadsSql, leadsParams).catch(() => ({ rows: [] }));

    // 2. Busca em public.gd_clientes
    const { rows: clientesGd } = await pool.query(
      `SELECT id, nome, empresa, COALESCE(telefone, '') as telefone, COALESCE(estado_atual, estado, '') as estado, valor_mensal, prazo_vence_em
       FROM public.gd_clientes
       WHERE nome ILIKE $1 OR empresa ILIKE $1 OR telefone ILIKE $1
       ORDER BY id DESC LIMIT 5`,
      [termoLike]
    ).catch(() => ({ rows: [] }));

    return {
      sucesso: true,
      termoBusca: termo,
      totalLeads: leadsEncontrados.length,
      leads: leadsEncontrados,
      totalClientesGd: clientesGd.length,
      clientesGd,
    };
  } catch (err) {
    console.error("[Heloísa] Erro ao consultar cliente/lead:", err);
    return { sucesso: false, erro: err.message };
  }
}

// ─── Definição de Ferramentas para LLM (OpenAI Tool Calling Format) ──────────

export const HELOISA_TOOLS = [
  {
    type: "function",
    function: {
      name: "cadastrar_cliente",
      description: "Cadastra ou atualiza um cliente no CRM da Geração Digital / Vexo OS.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome do cliente ou empresa" },
          telefone: { type: "string", description: "Telefone ou WhatsApp de contato" },
          empresa: { type: "string", description: "Empresa se diferente do nome" },
          valor: { type: "number", description: "Valor mensal do contrato" },
          escopo: { type: "string", description: "Escopo contratado (ex: Social Media, Tráfego Pago, Vexo)" },
        },
        required: ["nome"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enviar_mensagem_whatsapp",
      description: "Envia uma mensagem real e direta no WhatsApp para qualquer pessoa: diretores (Conrado Finzi, Caio Almeida), colaboradores (Santana, Duda, Éflen, Humberto, etc.), clientes ou qualquer número de telefone (com DDD). Use SEMPRE que o usuário pedir para enviar mensagem, mandar WhatsApp, cobrar, avisar ou fazer follow-up por WhatsApp.",
      parameters: {
        type: "object",
        properties: {
          destinatario: {
            type: "string",
            description: "Nome da pessoa (ex: Conrado, Caio, Santana, cliente) ou número de telefone direto com DDD (ex: 34997817660)",
          },
          mensagem: {
            type: "string",
            description: "Conteúdo da mensagem a ser enviada no WhatsApp",
          },
          telefone: {
            type: "string",
            description: "Telefone com DDD se disponível (opcional)",
          },
          tenant_id: {
            type: "string",
            description: "ID do tenant se houver um específico (opcional)",
          },
        },
        required: ["destinatario", "mensagem"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cobrar_colaborador",
      description: "Dispara uma mensagem de cobrança ou aviso no WhatsApp de um colaborador da equipe GD.",
      parameters: {
        type: "object",
        properties: {
          colaborador: { type: "string", description: "Nome ou função (Santana, Éflen, Humberto, Carlos, Duda, Gabriel)" },
          mensagem: { type: "string", description: "Texto da cobrança a ser enviado para ele no WhatsApp" },
        },
        required: ["colaborador", "mensagem"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agendar_compromisso",
      description: "Agenda uma reunião ou compromisso na agenda / calendário do CRM.",
      parameters: {
        type: "object",
        properties: {
          titulo: { type: "string", description: "Título do compromisso" },
          data_hora: { type: "string", description: "Data e horário (ex: 2026-11-15 14:00 ou amanhã às 14h)" },
          local_ou_link: { type: "string", description: "Link do Google Meet ou local físico" },
        },
        required: ["titulo", "data_hora"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "criar_followup",
      description: "Cria um lembrete ou tarefa de follow-up interno no CRM.",
      parameters: {
        type: "object",
        properties: {
          titulo: { type: "string", description: "Assunto do lembrete" },
          cliente_nome: { type: "string", description: "Nome do cliente se houver" },
          data_lembrete: { type: "string", description: "Data do lembrete" },
          notas: { type: "string", description: "Observações ou detalhes da tarefa" },
        },
        required: ["titulo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_operacao",
      description: "Consulta o status dos colaboradores ou prazos da agência.",
      parameters: {
        type: "object",
        properties: {
          tipo: {
            type: "string",
            enum: ["clientes_atrasados", "colaboradores", "resumo_geral"],
            description: "O que consultar",
          },
        },
        required: ["tipo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auditar_geral_vexo",
      description: "Audita status de leads por estágio, leads parados, status de campanhas e chips de WhatsApp de qualquer tenant ou do Vexo OS inteiro (Nous Gestão, Tinge Brasil, Udi Capas, Geração Digital, etc.).",
      parameters: {
        type: "object",
        properties: {
          tenant_id: { type: "string", description: "ID ou slug do tenant (opcional; se omitido, audita a operação inteira)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_cliente_ou_lead",
      description: "Pesquisa por nome, telefone ou empresa em todos os leads e clientes de qualquer tenant do Vexo OS.",
      parameters: {
        type: "object",
        properties: {
          termo_busca: { type: "string", description: "Nome, telefone ou empresa do lead/cliente a consultar" },
          tenant_id: { type: "string", description: "Tenant específico (opcional)" },
        },
        required: ["termo_busca"],
      },
    },
  },
];

// ─── Chamada ao LLM com Fallback (Gemini -> Groq -> GoClaw) ──────────────────

export async function chamarLlmHeloisa({ systemPrompt, messages, tools = HELOISA_TOOLS }) {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const goclawUrl = (process.env.GOCLAW_URL || "http://vexo_goclaw:1337").replace(/\/+$/, "");

  const fullMessages = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  // 1. Tentar Gemini Flash
  if (geminiKey) {
    try {
      const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${geminiKey}`,
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: fullMessages,
          tools,
          tool_choice: "auto",
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (resp.ok) {
        const data = await resp.json();
        return data.choices?.[0]?.message;
      }
    } catch (e) {
      console.warn("[Heloísa] Falha ao chamar Gemini, tentando fallback:", e.message);
    }
  }

  // 2. Tentar Groq (Fallback)
  if (groqKey) {
    try {
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          // Modelo da Groq vem da escada (services/llmModels.js), nunca fixo
          // aqui: o id que estava chumbado foi descontinuado pela Groq e este
          // degrau respondia 404 em silêncio, sobrando só o GoClaw de reserva.
          model: defaultGroqModel(),
          messages: fullMessages,
          tools,
          tool_choice: "auto",
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (resp.ok) {
        const data = await resp.json();
        return data.choices?.[0]?.message;
      }
      // Recusa do provedor (404 de modelo, 429 de cota, 413 de tamanho) não
      // lança: sem este aviso o degrau falhava sem deixar rastro no log.
      console.warn("[Heloísa] Groq recusou a chamada, tentando GoClaw runtime:", { status: resp.status });
    } catch (e) {
      console.warn("[Heloísa] Falha ao chamar Groq, tentando GoClaw runtime:", e.message);
    }
  }

  // 3. Tentar GoClaw Local Runtime
  try {
    const resp = await fetch(`${goclawUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.GOCLAW_GATEWAY_TOKEN ? { Authorization: `Bearer ${process.env.GOCLAW_GATEWAY_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        model: "gemini/gemini-3-flash-preview",
        messages: fullMessages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (resp.ok) {
      const data = await resp.json();
      return data.choices?.[0]?.message;
    }
  } catch (e) {
    console.warn("[Heloísa] Falha ao chamar GoClaw runtime:", e.message);
  }

  throw new Error("Nenhum provedor de IA (Gemini / Groq / GoClaw) respondeu com sucesso.");
}

// ─── Processamento Principal da Mensagem da Heloísa ──────────────────────────

export async function processarMensagemHeloisa({
  phone,
  texto,
  audioBase64 = null,
  audioMimetype = "audio/ogg",
  instanceName = "heloisa",
  pool = pgDatabasePool,
}) {
  const diretor = await identificarUsuarioAutorizado(phone, pool);
  if (!diretor) {
    console.warn(`[Heloísa] Mensagem recebida de remetente não autorizado: ${phone}`);
    return {
      autorizado: false,
      resposta: "Acesso restrito. Este canal é exclusivo para a diretoria da Geração Digital & Vexo OS.",
    };
  }

  let promptUsuario = (texto || "").trim();
  if (/^\[[áa]udio\]$/i.test(promptUsuario)) {
    promptUsuario = "";
  }

  // Transcrição de áudio se recebido
  if (!promptUsuario && audioBase64) {
    try {
      console.log(`[Heloísa] Transcrevendo áudio recebido de ${diretor.nome}...`);
      const transcrito = await transcribeAudio(audioBase64, audioMimetype);
      if (transcrito) {
        promptUsuario = transcrito;
        console.log(`[Heloísa] Áudio de ${diretor.nome} transcrito com sucesso: "${promptUsuario}"`);
      }
    } catch (e) {
      console.error("[Heloísa] Erro na transcrição de áudio:", e);
    }
  }

  if (!promptUsuario) {
    const msgAviso = `Olá ${diretor.nome}! Sou a Heloísa. Recebi seu áudio, mas não consegui ouvir com clareza. Pode reenviar ou me mandar por texto?`;
    try {
      await enviarMensagemWhatsAppComFallback({
        numero: diretor.telefone,
        texto: msgAviso,
        instanceName,
        pool,
      });
      console.log(`[Heloísa] Aviso de áudio não compreendido enviado para ${diretor.nome} (${diretor.telefone})`);
    } catch (errEnvio) {
      console.error(`[Heloísa] Falha ao enviar aviso de áudio para ${diretor.nome}:`, errEnvio);
    }

    return {
      autorizado: true,
      resposta: msgAviso,
    };
  }

  // Carrega prompt da Heloísa
  let systemPrompt = "";
  try {
    const promptPath = path.join(resolveGoclawDir(), "prompts", "heloisa_executiva.md");
    if (fs.existsSync(promptPath)) {
      systemPrompt = fs.readFileSync(promptPath, "utf-8");
    }
  } catch (e) {
    console.warn("[Heloísa] Aviso ao ler prompt:", e.message);
  }

  if (!systemPrompt) {
    systemPrompt = `Você é Heloísa, secretária executiva e copiloto de Conrado e Caio na Geração Digital e Vexo OS. ZERO SLACK, tudo WhatsApp.`;
  }

  systemPrompt += `\n\n=== CONTEXTO DO DIRETOR ATUAL ===\nVocê está conversando diretamente com: ${diretor.nome} (${diretor.papel}). Telefone: ${diretor.telefone}.\nData e Hora Atual: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`;

  // 1ª Chamada: Determinar intenção e tool calling
  const assistantMessage = await chamarLlmHeloisa({
    systemPrompt,
    messages: [{ role: "user", content: promptUsuario }],
    tools: HELOISA_TOOLS,
  });

  const toolCalls = assistantMessage?.tool_calls || [];
  const toolResults = [];

  // Executa as tools solicitadas pelo modelo
  for (const tc of toolCalls) {
    const fnName = tc.function?.name;
    let args = {};
    try {
      args = JSON.parse(tc.function?.arguments || "{}");
    } catch {
      args = {};
    }

    console.log(`[Heloísa] Executando tool "${fnName}":`, args);

    let resultado = null;
    if (fnName === "cadastrar_cliente") {
      resultado = await executarCadastrarCliente(args, pool);
    } else if (fnName === "enviar_mensagem_whatsapp") {
      resultado = await executarEnviarMensagemWhatsApp(args, pool, instanceName);
    } else if (fnName === "cobrar_colaborador") {
      resultado = await executarCobrarColaborador(args, pool, instanceName);
    } else if (fnName === "agendar_compromisso") {
      resultado = await executarAgendarCompromisso(args, pool);
    } else if (fnName === "criar_followup") {
      resultado = await executarCriarFollowup(args, pool);
    } else if (fnName === "consultar_operacao") {
      resultado = await executarConsultarOperacao(args, pool);
    } else if (fnName === "auditar_geral_vexo") {
      resultado = await executarAuditarGeralVexo(args, pool);
    } else if (fnName === "consultar_cliente_ou_lead") {
      resultado = await executarConsultarClienteOuLead(args, pool);
    }

    toolResults.push({
      tool_call_id: tc.id,
      name: fnName,
      resultado,
    });
  }

  // 2ª Chamada: Formatar resposta executiva final para o WhatsApp
  let respostaFinal = assistantMessage?.content || "";

  if (toolResults.length > 0) {
    const synthesisMessages = [
      { role: "user", content: promptUsuario },
      assistantMessage,
      ...toolResults.map((tr) => ({
        role: "tool",
        tool_call_id: tr.tool_call_id,
        name: tr.name,
        content: JSON.stringify(tr.resultado),
      })),
    ];

    const finalResponse = await chamarLlmHeloisa({
      systemPrompt,
      messages: synthesisMessages,
      tools: HELOISA_TOOLS,
    });

    respostaFinal = finalResponse?.content || "Prontinho! Já resolvi tudo por aqui.";
  }

  // Disparo de volta no WhatsApp do Diretor com contingência de instância
  try {
    await enviarMensagemWhatsAppComFallback({
      numero: diretor.telefone,
      texto: respostaFinal,
      instanceName,
      pool,
    });
    console.log(`[Heloísa] Resposta enviada com sucesso para ${diretor.nome} (${diretor.telefone})`);
  } catch (err) {
    console.error(`[Heloísa] Falha ao enviar resposta WhatsApp para ${diretor.nome}:`, err);
  }

  return {
    autorizado: true,
    diretor: diretor.nome,
    textoOriginal: promptUsuario,
    toolResults,
    resposta: respostaFinal,
  };
}

// ─── Snapshot Operacional do CRM (Consciência Situacional da Heloísa) ─────────

/**
 * Consulta dados em tempo real do CRM para dar consciência situacional à Heloísa:
 * - Clientes GD com prazo vencido (gd_clientes WHERE prazo_vence_em < NOW())
 * - Quantidade e lista de colaboradores ativos (gd_colaboradores WHERE ativo = true)
 * - Compromissos de hoje e amanhã (events ou lead_reminders)
 */
export async function obterSnapshotOperacional(pool = pgDatabasePool) {
  let clientesAtrasados = [];
  let colaboradoresAtivos = [];
  let compromissos = [];

  if (!pool || typeof pool.query !== "function") {
    return { clientesAtrasados, colaboradoresAtivos, compromissos };
  }

  // 1. Clientes GD com prazo vencido
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, empresa, estado, prazo_vence_em
       FROM public.gd_clientes
       WHERE prazo_vence_em IS NOT NULL AND prazo_vence_em < NOW()
       ORDER BY prazo_vence_em ASC
       LIMIT 10`
    );
    clientesAtrasados = rows || [];
  } catch {
    // Fallback tolerante para outros esquemas
    try {
      const { rows } = await pool.query(
        `SELECT id, nome, estado_atual as estado
         FROM public.gd_clientes
         LIMIT 5`
      );
      clientesAtrasados = rows || [];
    } catch {
      clientesAtrasados = [];
    }
  }

  // 2. Colaboradores ativos
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, funcao, telefone, recebe_cobranca_whatsapp
       FROM public.gd_colaboradores
       WHERE ativo = true
       ORDER BY nome ASC`
    );
    colaboradoresAtivos = rows || [];
  } catch {
    colaboradoresAtivos = [];
  }

  // 3. Compromissos de hoje e amanhã
  try {
    const { rows } = await pool.query(
      `SELECT id, name as titulo, date as data_hora, location
       FROM public.events
       WHERE date >= CURRENT_DATE AND date < (CURRENT_DATE + INTERVAL '2 day')
       ORDER BY date ASC
       LIMIT 10`
    );
    compromissos = rows || [];
  } catch {
    try {
      const { rows } = await pool.query(
        `SELECT id, title as titulo, remind_at as data_hora, lead_name
         FROM public.lead_reminders
         WHERE remind_at >= CURRENT_DATE AND remind_at < (CURRENT_DATE + INTERVAL '2 day')
         ORDER BY remind_at ASC
         LIMIT 10`
      );
      compromissos = rows || [];
    } catch {
      compromissos = [];
    }
  }

  return {
    clientesAtrasados,
    colaboradoresAtivos,
    compromissos,
  };
}

// ─── Processamento Bidirecional de Voz da Heloísa (Voice Assistant Two-Way) ──

/**
 * Endpoint de Voz da Heloísa:
 * Etapa 1 (STT): Transcreve áudio se recebido com Groq Whisper (transcribeAudio)
 * Etapa 2 (Snapshot Operacional): Consulta dados situacionais do CRM
 * Etapa 3 (Inteligência & Tools): Executa motor da Heloísa com HELOISA_TOOLS ativas
 * Etapa 4 (TTS - Voz da Heloísa): Sintetiza resposta em áudio via generateSpeechAudio
 */
export async function processarVozHeloisa({
  text,
  audioBase64 = null,
  audioMimetype = "audio/webm",
  currentPage = "Dashboard",
  clientId = "geracao-digital",
  userName = "Conrado",
  userRole = "Diretor Executivo",
  history = [],
  pool = pgDatabasePool,
  goclawDir = resolveGoclawDir(),
} = {}) {
  let userText = (text || "").trim();

  let cleanUserName = String(userName || "").trim().split(" ")[0];
  if (!cleanUserName || /^diretor$/i.test(cleanUserName)) {
    cleanUserName = "Conrado";
  }

  // Etapa 1 (STT): Se vier áudio, transcreve com transcribeAudio (Groq Whisper)
  if (audioBase64) {
    try {
      const audioTranscrito = await transcribeAudio(audioBase64, audioMimetype);
      if (audioTranscrito && audioTranscrito.trim()) {
        userText = audioTranscrito.trim();
        console.log(`[Heloísa Voz] Áudio do usuário transcrito: "${userText}"`);
      }
    } catch (err) {
      console.warn("[Heloísa Voz] Falha na transcrição STT, usando texto se presente:", err.message);
    }
  }

  if (!userText) {
    return {
      ok: true,
      userText: "",
      responseText: "Olá! Não consegui ouvir sua mensagem. Pode falar novamente ou digitar no campo abaixo?",
      audioBase64: null,
      audioMimetype: "audio/mp3",
      executedTools: [],
    };
  }

  // Etapa 2 (Snapshot Operacional): Consciência situacional do CRM
  const snapshot = await obterSnapshotOperacional(pool);

  const clientesAtrasadosTexto = snapshot.clientesAtrasados.length > 0
    ? snapshot.clientesAtrasados.map((c) => `• ${c.nome || c.empresa || "Cliente"} (${c.estado || "Atrasado"})`).join("\n")
    : "Nenhum cliente com prazo vencido no momento.";

  const colaboradoresTexto = snapshot.colaboradoresAtivos.length > 0
    ? snapshot.colaboradoresAtivos.map((c) => `• ${c.nome} (${c.funcao})`).join("\n")
    : "Nenhum colaborador ativo cadastrado.";

  const compromissosTexto = snapshot.compromissos.length > 0
    ? snapshot.compromissos.map((ev) => `• ${ev.titulo || ev.name} - ${ev.data_hora || ev.date}`).join("\n")
    : "Nenhum compromisso agendado para hoje ou amanhã.";

  // Etapa 3 (Inteligência & Tools): Carrega prompt da Heloísa
  let systemPrompt = "";
  try {
    const promptPath = path.join(goclawDir, "prompts", "heloisa_executiva.md");
    if (fs.existsSync(promptPath)) {
      systemPrompt = fs.readFileSync(promptPath, "utf-8");
    }
  } catch (e) {
    console.warn("[Heloísa Voz] Aviso ao carregar prompt heloisa_executiva.md:", e.message);
  }

  const previousMessages = Array.isArray(history)
    ? history
        .filter((m) => m && m.text && typeof m.text === "string" && m.text.trim())
        .slice(-6)
        .map((m) => ({
          role: m.sender === "heloisa" ? "assistant" : "user",
          content: m.text.trim(),
        }))
    : [];

  if (!systemPrompt) {
    systemPrompt = `Você é a Heloísa, copiloto inteligente e secretária executiva do Vexo OS e da Geração Digital, trabalhando lado a lado com ${cleanUserName} (e Caio). Você possui autoridade e acesso total para consultar qualquer tenant da plataforma.`;
  } else {
    systemPrompt = `Você é a Heloísa, copiloto inteligente e secretária executiva do Vexo OS e da Geração Digital, trabalhando lado a lado com ${cleanUserName} (e Caio). Você possui autoridade e acesso total para consultar qualquer tenant da plataforma.\n\n` + systemPrompt;
  }

  systemPrompt += `\n\n=== CONTEXTO DA SESSÃO DE VOZ (WIDGET FLUTUANTE VEXO OS) ===
Você está conversando por VOZ em tempo real com: ${cleanUserName}.
Página atual do CRM: ${currentPage || "Dashboard"}.
Empresa ativa: ${clientId || "geracao-digital"}.
Data e Hora Atual: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.

=== SNAPSHOT OPERACIONAL DO CRM EM TEMPO REAL ===
[Clientes com Prazo Vencido - ${snapshot.clientesAtrasados.length}]
${clientesAtrasadosTexto}

[Colaboradores Ativos - ${snapshot.colaboradoresAtivos.length}]
${colaboradoresTexto}

[Compromissos Hoje e Amanhã - ${snapshot.compromissos.length}]
${compromissosTexto}

=== REGRAS MANDATÓRIAS DE NATURALIDADE, CONTINUIDADE & POSTURA ===
1. NUNCA CHAME O USUÁRIO DE "DIRETOR". Jamais use as expressões "Oi Diretor", "Olá Diretor", "Sim Diretor" ou "Diretor". Se for se dirigir a ele, chame de ${cleanUserName}, mas sem ficar repetindo o nome a todo momento (converse normalmente).
2. CONTINUIDADE CONVERSACIONAL (NÃO REINICIE A CONVERSA):
   - Você está no meio de uma conversa contínua. NUNCA comece suas respostas se reapresentando (ex: NUNCA diga "Oi, eu sou a Heloísa, sua secretária...").
   - Se o usuário fez uma pergunta ou pedido, NUNCA repita saudações ("Oi", "Olá", "Tudo bem?"). Dê seguimento IMEDIATO e DIRETO ao que ele acabou de falar.
   - Se o usuário perguntar o que você faz ou suas capacidades, responda DIRETO, por exemplo:
     "Consigo auditar qualquer tenant do Vexo, buscar leads e clientes, cadastrar novos contatos, agendar reuniões e mandar mensagens no WhatsApp pro Caio ou pra equipe. O que você quer que eu veja agora?"
   - Apenas faça uma saudação se for o primeiríssimo contato absoluto da conversa E o usuário tiver falado apenas um cumprimento isolado (ex: "Oi", "Heloísa").
3. ZERO AFETAÇÃO E ZERO FRASES MELOSAS:
   - NUNCA use frases artificiais como "com um toque de amizade", "com todo carinho", "anotei com muito carinho" ou "meu querido".
   - Fale como uma colega sênior competente, prática, inteligente, descontraída e ágil.
4. VARIE AS ABERTURAS DAS FRASES:
   - Não comece as respostas sempre da mesma forma. Varie naturalmente a abertura conforme o que foi perguntado.
5. RESPOSTA FALADA EM ÁUDIO (1 a 3 frases):
   - Mantenha respostas curtas, fluidas e bem pontuadas para o sintetizador de voz. NUNCA use markdown (sem asteriscos **, sem hashtags, sem listas numeradas).
6. EXECUÇÃO DE TAREFAS:
   - Se o usuário pedir para mandar WhatsApp, cobrar colaborador, cadastrar cliente, agendar reunião, criar follow-up ou auditar a operação, execute a ferramenta necessária em HELOISA_TOOLS e confirme de forma direta e natural.`;

  let assistantMessage = null;
  const executedTools = [];

  try {
    assistantMessage = await chamarLlmHeloisa({
      systemPrompt,
      messages: [...previousMessages, { role: "user", content: userText }],
      tools: HELOISA_TOOLS,
    });
  } catch (err) {
    console.warn("[Heloísa Voz] Falha no provedor LLM principal, aplicando contingência:", err.message);
    assistantMessage = {
      content: `Tive uma oscilação momentânea na conexão, mas anotei sua solicitação: "${userText}". O que deseja fazer?`,
    };
  }

  const toolCalls = assistantMessage?.tool_calls || [];
  const toolResults = [];

  for (const tc of toolCalls) {
    const fnName = tc.function?.name;
    let args = {};
    try {
      args = JSON.parse(tc.function?.arguments || "{}");
    } catch {
      args = {};
    }

    console.log(`[Heloísa Voz] Executando ferramenta "${fnName}":`, args);
    let resultado = null;

    if (fnName === "cadastrar_cliente") {
      resultado = await executarCadastrarCliente(args, pool);
    } else if (fnName === "enviar_mensagem_whatsapp") {
      resultado = await executarEnviarMensagemWhatsApp(args, pool);
    } else if (fnName === "cobrar_colaborador") {
      resultado = await executarCobrarColaborador(args, pool);
    } else if (fnName === "agendar_compromisso") {
      resultado = await executarAgendarCompromisso(args, pool);
    } else if (fnName === "criar_followup") {
      resultado = await executarCriarFollowup(args, pool);
    } else if (fnName === "consultar_operacao") {
      resultado = await executarConsultarOperacao(args, pool);
    } else if (fnName === "auditar_geral_vexo") {
      resultado = await executarAuditarGeralVexo(args, pool);
    } else if (fnName === "consultar_cliente_ou_lead") {
      resultado = await executarConsultarClienteOuLead(args, pool);
    }

    toolResults.push({
      tool_call_id: tc.id,
      name: fnName,
      resultado,
    });

    executedTools.push({
      name: fnName,
      args,
      resultado,
    });
  }

  let responseText = assistantMessage?.content || "";

  if (toolResults.length > 0) {
    const synthesisMessages = [
      ...previousMessages,
      { role: "user", content: userText },
      assistantMessage,
      ...toolResults.map((tr) => ({
        role: "tool",
        tool_call_id: tr.tool_call_id,
        name: tr.name,
        content: JSON.stringify(tr.resultado),
      })),
    ];

    try {
      const finalAssistantMessage = await chamarLlmHeloisa({
        systemPrompt,
        messages: synthesisMessages,
        tools: HELOISA_TOOLS,
      });

      const primeiroErro = toolResults.find((tr) => tr.resultado && tr.resultado.sucesso === false)?.resultado?.erro;

      if (primeiroErro && (!finalAssistantMessage?.content || finalAssistantMessage.content.toLowerCase().includes("sucesso"))) {
        responseText = `Houve uma oscilação no WhatsApp ao tentar enviar: ${primeiroErro}. Quer que eu tente de novo?`;
      } else {
        responseText =
          finalAssistantMessage?.content ||
          (primeiroErro
            ? `Deu um problema no envio: ${primeiroErro}`
            : `Prontinho, ação executada com sucesso.`);
      }
    } catch (err) {
      console.warn("[Heloísa Voz] Falha ao sintetizar resposta de tools, usando fallback:", err.message);
      const primeiroErro = toolResults.find((tr) => tr.resultado && tr.resultado.sucesso === false)?.resultado?.erro;
      if (primeiroErro) {
        responseText = `Houve uma oscilação momentânea: ${primeiroErro}. Quer que eu tente de novo?`;
      } else {
        responseText = `Prontinho, ação executada com sucesso.`;
      }
    }
  }

  if (!responseText) {
    responseText = `Tô por aqui, pode falar o que precisa.`;
  }

  // Etapa 4 (TTS - Voz da Heloísa): Sintetiza resposta em áudio via generateSpeechAudio
  let audioRespostaBase64 = null;
  const audioMimetypeRetorno = "audio/mp3";

  try {
    const speech = await generateSpeechAudio({
      text: responseText,
      voice: "nova",
      speed: 1.0,
    });
    if (speech?.base64) {
      audioRespostaBase64 = speech.base64;
    }
  } catch (err) {
    console.warn("[Heloísa Voz] Falha ao sintetizar áudio de resposta:", err.message);
  }

  return {
    ok: true,
    userText,
    responseText,
    audioBase64: audioRespostaBase64,
    audioMimetype: audioMimetypeRetorno,
    executedTools,
  };
}
