/**
 * gdCustomerSuccessSchedulerService.js
 *
 * Serviço de Régua de Cuidado / Customer Success Autônomo da Geração Digital & Vexo OS (Frente 7).
 *
 * Responsabilidades:
 * 1. Disparo de mensagens automáticas de acompanhamento no grupo MÁQUINA DE VENDAS: {CLIENTE}
 *    a cada 10 a 15 dias (padrão quinzenal de 14 dias):
 *    "Passando para compartilhar o que nossa equipe entregou para você nestas últimas semanas..."
 * 2. Gatilho inteligente solicitando avaliação da agência no Google Meu Negócio e compartilhamento
 *    de links sociais após a primeira quinzena de sucesso (15 dias de operação).
 * 3. Idempotência estrita, registro de histórico em banco e suporte a execução periódica e sob demanda.
 */

import { sendTextMessageViaEvolution } from "./evolution.js";
import { pgDatabasePool } from "./database.js";
import { GD_DONO } from "../domains/gdClientes/campos.js";

export const DEFAULT_CS_INTERVAL_DAYS = 14;
export const GOOGLE_REVIEW_DAYS_THRESHOLD = 15;
export const SCHEDULE_ENABLED_ENV = "GD_CS_SCHEDULE_ENABLED";
export const ADVISORY_LOCK_ID = 843355007; // Advisory lock dedicado para CS GD
export const DEFAULT_TICK_INTERVAL_MS = 60_000;

export const GD_GOOGLE_REVIEW_URL = process.env.GD_GOOGLE_REVIEW_URL || "https://g.page/r/geracaodigital/review";
export const GD_INSTAGRAM_URL = process.env.GD_INSTAGRAM_URL || "https://instagram.com/geracaodigital";
export const GD_LINKEDIN_URL = process.env.GD_LINKEDIN_URL || "https://linkedin.com/company/geracaodigital";
export const GD_PORTAL_BASE_URL = process.env.GD_PORTAL_BASE_URL || "https://crm.geracaodigital.com/acompanhamento";

export const TIPOS_TOQUE_CS = {
  AVALIACAO_GOOGLE_15D: "AVALIACAO_GOOGLE_15D",
  ACOMPANHAMENTO_PERIODICO: "ACOMPANHAMENTO_PERIODICO",
};

let _csSchedulerInterval = null;
let _isCsProcessing = false;

/**
 * Verifica se o agendador de CS está habilitado por variável de ambiente.
 */
export function isGdCsScheduleEnabled() {
  return String(process.env[SCHEDULE_ENABLED_ENV] || "false").trim().toLowerCase() === "true";
}

/**
 * Monta mensagem de convite para avaliação no Google Meu Negócio após a 1ª quinzena de sucesso.
 */
export function montarMensagemPrimeiraQuinzena({
  cliente,
  reviewUrl = GD_GOOGLE_REVIEW_URL,
  instagramUrl = GD_INSTAGRAM_URL,
  linkedinUrl = GD_LINKEDIN_URL,
}) {
  const nomeEmpresa = cliente?.nome || "sua empresa";
  return (
    `🌟 *15 Dias da sua Máquina de Vendas no Ar!*\n\n` +
    `Olá, equipe *${nomeEmpresa}*!\n\n` +
    `Completamos nossa primeira quinzena de operação da sua máquina de vendas na *Geração Digital*! Nossos fluxos inteligentes, robôs e campanhas já estão trabalhando a todo vapor para acelerar seus resultados comerciais.\n\n` +
    `O seu feedback é o que nos move a entregar cada vez mais excelência. Poderia nos avaliar com 5 estrelas e um breve comentário no Google Meu Negócio? Leva menos de 1 minuto:\n` +
    `⭐ *Avaliar no Google:* ${reviewUrl}\n\n` +
    `Aproveite também para acompanhar nossos bastidores, novidades e estratégias nos canais oficiais da agência:\n` +
    `📸 *Instagram:* ${instagramUrl}\n` +
    `💼 *LinkedIn:* ${linkedinUrl}\n\n` +
    `Seguimos acelerando juntos rumo a novos recordes de conversão! 🚀`
  );
}

/**
 * Monta mensagem de acompanhamento periódico de CS (a cada 10-15 dias).
 */
export function montarMensagemAcompanhamentoPeriodico({
  cliente,
  portalUrl,
  driveUrl,
}) {
  const nomeEmpresa = cliente?.nome || "sua empresa";
  const urlDrive = driveUrl || cliente?.drive_url || "Link disponível no portal do cliente";
  const urlPortal = portalUrl || (cliente?.portal_slug ? `${GD_PORTAL_BASE_URL}/${cliente.portal_slug}` : "Acesse seu link de acompanhamento");

  return (
    `👋 *Acompanhamento de Customer Success | Geração Digital*\n\n` +
    `Passando para compartilhar o que nossa equipe entregou para você nestas últimas semanas e checar os resultados da sua *Máquina de Vendas* (*${nomeEmpresa}*)!\n\n` +
    `📌 *Status do Projeto:* Operação em pleno andamento e monitoramento contínuo\n` +
    `📁 *Pasta de Ativos & Criativos no Drive:* ${urlDrive}\n` +
    `🌐 *Portal do Cliente em Tempo Real:* ${urlPortal}\n\n` +
    `Têm algum alinhamento prioritário, sugestão ou nova meta para os próximos dias? Nossa equipe está 100% à disposição aqui neste grupo!\n\n` +
    `Tenha uma excelente semana e ótimas vendas! 🚀`
  );
}

/**
 * Avalia se o cliente é elegível para um toque de CS nesta data.
 */
export function calcularElegibilidadeCs(cliente, now = new Date(), options = {}) {
  if (!cliente) return null;
  if (cliente.cs_regua_ativa === false) return null;
  if (!cliente.grupo_cliente_jid) return null;

  // Clientes elegíveis precisam estar ativos ou com onboarding concluído
  const estadosOperacionais = ["ATIVO", "ESTRATEGIA_APROVADA"];
  const isOperando = estadosOperacionais.includes(cliente.estado_atual) || Boolean(cliente.onboarding_concluido_em);
  if (!isOperando) return null;

  const nowTime = now.getTime();
  const dataInicioIso = cliente.onboarding_concluido_em || cliente.estado_desde || cliente.created_at;
  const dataInicioTime = dataInicioIso ? new Date(dataInicioIso).getTime() : nowTime;
  const diasOperando = Math.floor((nowTime - dataInicioTime) / (1000 * 60 * 60 * 24));

  const thresholdGoogle = options.thresholdGoogleDays ?? GOOGLE_REVIEW_DAYS_THRESHOLD;
  const intervaloDias = options.intervaloDias ?? DEFAULT_CS_INTERVAL_DAYS;

  // 1. Gatilho inteligente da 1ª Quinzena (15 dias de sucesso)
  if (diasOperando >= thresholdGoogle && !cliente.cs_avaliacao_google_enviada_em) {
    return {
      tipo: TIPOS_TOQUE_CS.AVALIACAO_GOOGLE_15D,
      motivo: `Primeira quinzena de sucesso atingida (${diasOperando} dias de operação). Solicitar avaliação no Google Meu Negócio.`,
      diasOperando,
    };
  }

  // 2. Toque periódico de CS (a cada 10-15 dias)
  const ultimoToqueIso = cliente.cs_ultimo_toque_em;
  if (!ultimoToqueIso) {
    // Nunca recebeu toque. Se já opera há pelo menos 10 dias, dispara o primeiro acompanhamento.
    if (diasOperando >= 10) {
      return {
        tipo: TIPOS_TOQUE_CS.ACOMPANHAMENTO_PERIODICO,
        motivo: `Primeiro acompanhamento de CS (${diasOperando} dias de operação).`,
        diasOperando,
      };
    }
    return null;
  }

  const ultimoToqueTime = new Date(ultimoToqueIso).getTime();
  const diasDesdeUltimoToque = Math.floor((nowTime - ultimoToqueTime) / (1000 * 60 * 60 * 24));

  // Checa agendamento explícito ou intervalo mínimo decorrido
  const agendadoParaTime = cliente.cs_proximo_toque_em ? new Date(cliente.cs_proximo_toque_em).getTime() : null;
  const venceuAgendamento = agendadoParaTime && nowTime >= agendadoParaTime;

  if (venceuAgendamento || diasDesdeUltimoToque >= intervaloDias) {
    return {
      tipo: TIPOS_TOQUE_CS.ACOMPANHAMENTO_PERIODICO,
      motivo: `Acompanhamento periódico de CS (${diasDesdeUltimoToque} dias desde o último contato).`,
      diasDesdeUltimoToque,
    };
  }

  return null;
}

/**
 * Processa a régua de Customer Success para todos os clientes elegíveis (ou um específico).
 */
export async function processarReguaCustomerSuccess({
  pool = pgDatabasePool,
  now = new Date(),
  evolutionSender = sendTextMessageViaEvolution,
  instanceName = null,
  clienteId = null,
  reviewUrl = GD_GOOGLE_REVIEW_URL,
  instagramUrl = GD_INSTAGRAM_URL,
  linkedinUrl = GD_LINKEDIN_URL,
  portalBaseUrl = GD_PORTAL_BASE_URL,
  intervaloDias = DEFAULT_CS_INTERVAL_DAYS,
  forceTipo = null,
} = {}) {
  const db = pool || pgDatabasePool;
  if (!db) {
    return { processados: 0, toquesPeriodicos: 0, avaliacoesGoogle: 0, error: "DATABASE_UNAVAILABLE" };
  }

  const effectiveInstance =
    instanceName ||
    process.env.GD_ONBOARDING_EVOLUTION_INSTANCE ||
    process.env.GD_EVOLUTION_INSTANCE ||
    "vexo-adm-vexo-atende";

  // Busca clientes pertencentes à GD que tenham grupo de WhatsApp do cliente configurado
  const { rows: clientes } = await db.query(
    `SELECT c.id, c.nome, c.estado_atual, c.estado_desde, c.onboarding_concluido_em,
            c.grupo_cliente_jid, c.grupo_cliente_url, c.drive_url, c.portal_slug,
            c.created_at, c.cs_regua_ativa, c.cs_ultimo_toque_em,
            c.cs_avaliacao_google_enviada_em, c.cs_proximo_toque_em,
            COALESCE(c.cs_toques_historico, '[]'::jsonb) AS cs_toques_historico
       FROM public.gd_clientes c
      WHERE c.dono_client_id = $1
        AND ($2::uuid IS NULL OR c.id = $2::uuid)
        AND (c.cs_regua_ativa IS TRUE OR c.cs_regua_ativa IS NULL)
        AND c.grupo_cliente_jid IS NOT NULL`,
    [GD_DONO, clienteId]
  );

  let toquesPeriodicos = 0;
  let avaliacoesGoogle = 0;
  const resultados = [];

  for (const c of clientes) {
    let decisao = calcularElegibilidadeCs(c, now, { intervaloDias });

    if (forceTipo) {
      decisao = { tipo: forceTipo, motivo: "Disparo forçado sob demanda" };
    }

    if (!decisao) continue;

    let mensagemTexto = "";
    if (decisao.tipo === TIPOS_TOQUE_CS.AVALIACAO_GOOGLE_15D) {
      mensagemTexto = montarMensagemPrimeiraQuinzena({
        cliente: c,
        reviewUrl,
        instagramUrl,
        linkedinUrl,
      });
    } else {
      const portalUrl = c.portal_slug ? `${portalBaseUrl}/${c.portal_slug}` : `${portalBaseUrl}`;
      mensagemTexto = montarMensagemAcompanhamentoPeriodico({
        cliente: c,
        portalUrl,
        driveUrl: c.drive_url,
      });
    }

    try {
      // Disparo no grupo MÁQUINA DE VENDAS: {CLIENTE}
      await evolutionSender({
        instanceName: effectiveInstance,
        number: c.grupo_cliente_jid,
        text: mensagemTexto,
      });

      const proximoToque = new Date(now.getTime() + intervaloDias * 24 * 60 * 60 * 1000).toISOString();
      const novoHistorico = [
        ...(Array.isArray(c.cs_toques_historico) ? c.cs_toques_historico : []),
        {
          tipo: decisao.tipo,
          motivo: decisao.motivo,
          enviado_em: now.toISOString(),
          destinatario_jid: c.grupo_cliente_jid,
        },
      ];

      const isGoogle = decisao.tipo === TIPOS_TOQUE_CS.AVALIACAO_GOOGLE_15D;

      await db.query(
        `UPDATE public.gd_clientes
            SET cs_ultimo_toque_em = $1,
                cs_proximo_toque_em = $2,
                cs_avaliacao_google_enviada_em = CASE WHEN $3 THEN $1 ELSE cs_avaliacao_google_enviada_em END,
                cs_toques_historico = $4::jsonb
          WHERE id = $5 AND dono_client_id = $6`,
        [now.toISOString(), proximoToque, isGoogle, JSON.stringify(novoHistorico), c.id, GD_DONO]
      );

      if (isGoogle) {
        avaliacoesGoogle++;
      } else {
        toquesPeriodicos++;
      }

      resultados.push({
        clienteId: c.id,
        nome: c.nome,
        tipo: decisao.tipo,
        sucesso: true,
      });
    } catch (err) {
      resultados.push({
        clienteId: c.id,
        nome: c.nome,
        tipo: decisao.tipo,
        sucesso: false,
        erro: err.message,
      });
    }
  }

  return {
    processados: clientes.length,
    enviados: toquesPeriodicos + avaliacoesGoogle,
    toquesPeriodicos,
    avaliacoesGoogle,
    resultados,
  };
}

/**
 * Inicia o loop periódico do agendador de Customer Success
 */
export function iniciarCsScheduler({
  pool = pgDatabasePool,
  intervalMs = DEFAULT_TICK_INTERVAL_MS,
  evolutionSender = sendTextMessageViaEvolution,
} = {}) {
  if (_csSchedulerInterval) return _csSchedulerInterval;

  _csSchedulerInterval = setInterval(async () => {
    if (!isGdCsScheduleEnabled() || _isCsProcessing) return;
    _isCsProcessing = true;

    try {
      // Advisory lock para concorrência entre réplicas
      const lockRes = await pool.query(
        `SELECT pg_try_advisory_lock($1) AS obtido`,
        [ADVISORY_LOCK_ID]
      );

      if (!lockRes.rows[0]?.obtido) {
        return;
      }

      try {
        await processarReguaCustomerSuccess({ pool, evolutionSender });
      } finally {
        await pool.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_ID]);
      }
    } catch (err) {
      console.warn("[gd-cs-scheduler] Erro no ciclo de CS:", err.message);
    } finally {
      _isCsProcessing = false;
    }
  }, intervalMs);

  return _csSchedulerInterval;
}

/**
 * Para o loop do agendador
 */
export function pararCsScheduler() {
  if (_csSchedulerInterval) {
    clearInterval(_csSchedulerInterval);
    _csSchedulerInterval = null;
  }
  _isCsProcessing = false;
}
