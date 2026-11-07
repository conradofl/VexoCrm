// Clientes da Geração Digital: leitura e escrita internas sobre gd_clientes / gd_cliente_eventos
// (migration 20261102120000). Desenho aprovado pelo dono em 03/11/2026.
//
// - Dono FIXO: GD_DONO, a chave texto de leads_clients. Não vem da requisição, não passa pelo
//   resolveAuthorizedClientId nem pelo tenantResolver (o fallback do uuid-zero fica fora daqui).
//   Cliente de outro dono responde 404, igual a id inexistente.
// - Estado só muda por gd_registrar_evento(), com ator_tipo 'humano' e ator_id = uid do Firebase.
//   Nada disso vem do corpo. 'importacao_inicial' nunca entra por rota (só por src/scripts/gdImportarClientes.js).
// - Estado pedido passa por duas barreiras: SELECT em gd_estados (existe E ativo) e, se mesmo assim
//   chegar ao banco, a FK (23503) vira o mesmo 422.
import crypto from "node:crypto";
import { requireFirebaseAuth as requireFirebaseAuthPadrao } from "../../access/middlewares.js";
import { hasInternalPageAccess } from "../../accessGuards.js";
import { pgDatabasePool } from "../../services/database.js";
import { sendError } from "../../services/httpInfra.js";
import {
  createEvolutionGroup,
  getEvolutionGroupInviteCode,
  sendTextMessageViaEvolution,
} from "../../services/evolution.js";
import { sendSlackMessage } from "../../services/trelloSlackReporter.js";
import { CAMPOS_OPCIONAIS, CampoInvalido, GD_DONO, lerNome, lerDriveUrl } from "./campos.js";
import { gerarPortalToken, hashPortalToken } from "./portalTokens.js";

export { GD_DONO, gerarPortalToken, hashPortalToken };
const PERMISSAO_GD = "geracao_digital.proposals";
const PAGINA_GD = "implantacao-gd";
const LIMITE_LISTA = 500;
// Relógio de quem chama pode estar um pouco à frente; mais que isso é data futura.
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Três perfis, iguais para leitura e escrita (decisão do dono, 03/11/2026): superadmin; interno
// administrador; interno com a GD no escopo e com a permissão ou a página da GD.
// Não reaproveita requireInternalPageAccess: ele recusa role !== "internal", e o fundador chega
// como "superadmin" (claims.js, buildAccessProfile) e tomaria 403.
export function podeGerirClientesGd(access) {
  if (!access) return false;
  if (access.role === "superadmin") return true;
  if (access.role !== "internal") return false;
  if (access.isAdmin) return true;
  const temGdNoEscopo = access.clientId === GD_DONO || (access.clientIds || []).includes(GD_DONO);
  if (!temGdNoEscopo) return false;
  return (access.permissions || []).includes(PERMISSAO_GD) || hasInternalPageAccess(access, PAGINA_GD);
}

export function requireGdClientesAccess(req, res, next) {
  const access = req.authAccess;
  if (access?.error === "TENANT_SETTINGS_READ_FAILED") {
    sendError(res, 503, "SERVICE_UNAVAILABLE", "Instabilidade temporária ao verificar permissões de acesso. Tente de novo em instantes.");
    return;
  }
  if (!podeGerirClientesGd(access)) {
    sendError(res, 403, "FORBIDDEN", "Clientes da Geração Digital restritos à equipe da GD");
    return;
  }
  next();
}

export function isGoclawAuthenticated(req) {
  const configuredToken = process.env.GOCLAW_READ_TOKEN;
  if (!configuredToken || typeof configuredToken !== "string" || configuredToken.trim() === "") {
    return false;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(configuredToken.trim());
  return tokenBuf.length === expectedBuf.length && crypto.timingSafeEqual(tokenBuf, expectedBuf);
}

export function requireGoclawReadToken(req, res, next) {
  if (!isGoclawAuthenticated(req)) {
    res.status(401).json({ error: "Token de acesso do GoClaw inválido ou não configurado." });
    return;
  }
  next();
}

export function requireGdOrGoclawAuth(requireFirebaseAuth = requireFirebaseAuthPadrao) {
  return (req, res, next) => {
    if (isGoclawAuthenticated(req)) {
      req.authActor = { tipo: "goclaw", id: "goclaw" };
      return next();
    }
    requireFirebaseAuth(req, res, () => {
      requireGdClientesAccess(req, res, () => {
        req.authActor = { tipo: "humano", id: req.authAccess?.uid || "humano" };
        next();
      });
    });
  };
}

class ErroDeRota extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const SELECT_CLIENTE = `
  SELECT c.id, c.nome, c.cnpj, c.cnpj_a_confirmar, c.aprovador_nome, c.aprovador_telefone,
         c.drive_url, c.contrato_url, c.briefing_url, c.ficha_vexo_url, c.planejamento_url,
         c.grupo_interno_jid, c.grupo_interno_url, c.grupo_cliente_jid, c.grupo_cliente_url,
         c.onboarding_concluido_em,
         c.escopo, c.escopo_original, c.origem, c.estado_atual, c.estado_desde,
         c.estado_data_estimada, c.created_at, c.updated_at,
         e.rotulo_interno, e.fase, e.ordem, e.prazo_contagem, e.prazo_horas,
         CASE WHEN e.prazo_contagem = 'horas_corridas' AND e.prazo_horas IS NOT NULL
              THEN c.estado_desde + make_interval(hours => e.prazo_horas) END AS prazo_vence_em,
         now() AS agora
    FROM public.gd_clientes c
    LEFT JOIN public.gd_estados e ON e.codigo = c.estado_atual`;

// Prazo só onde a conta é honesta: horas corridas. Horas úteis e fim do dia útil ficam com o
// Síndico; até lá a tela mostra a regra com vence_em null, sem inventar data.
function prazoDe(linha) {
  if (linha.prazo_contagem === "horas_corridas") {
    if (linha.prazo_horas == null) return { regra: "sem_prazo", horas: null, vence_em: null, atrasado: false, calculo: "sem_prazo" };
    const vence = new Date(linha.prazo_vence_em);
    return { regra: "horas_corridas", horas: linha.prazo_horas, vence_em: vence.toISOString(), atrasado: vence < new Date(linha.agora), calculo: "ok" };
  }
  if (!linha.prazo_contagem) return null;
  return { regra: linha.prazo_contagem, horas: linha.prazo_horas, vence_em: null, atrasado: null, calculo: "pendente" };
}

function clienteDe(linha) {
  return {
    id: linha.id,
    nome: linha.nome,
    cnpj: linha.cnpj,
    cnpj_a_confirmar: linha.cnpj_a_confirmar,
    aprovador_nome: linha.aprovador_nome,
    aprovador_telefone: linha.aprovador_telefone,
    drive_url: linha.drive_url,
    contrato_url: linha.contrato_url ?? null,
    briefing_url: linha.briefing_url ?? null,
    ficha_vexo_url: linha.ficha_vexo_url ?? null,
    planejamento_url: linha.planejamento_url ?? null,
    grupo_interno_jid: linha.grupo_interno_jid ?? null,
    grupo_interno_url: linha.grupo_interno_url ?? null,
    grupo_cliente_jid: linha.grupo_cliente_jid ?? null,
    grupo_cliente_url: linha.grupo_cliente_url ?? null,
    onboarding_concluido_em: linha.onboarding_concluido_em ?? null,
    escopo: linha.escopo,
    escopo_original: linha.escopo_original,
    origem: linha.origem,
    estado_atual: linha.estado_atual,
    rotulo_interno: linha.rotulo_interno ?? null,
    fase: linha.fase ?? null,
    ordem: linha.ordem ?? null,
    estado_desde: linha.estado_desde,
    aproximado: linha.estado_data_estimada === true,
    prazo: prazoDe(linha),
    created_at: linha.created_at,
    updated_at: linha.updated_at,
  };
}

// Campos opcionais presentes no corpo, já lidos. Chave ausente fica de fora; chave com null limpa.
function lerOpcionais(body) {
  const lidos = {};
  for (const [campo, ler] of Object.entries(CAMPOS_OPCIONAIS)) {
    if (campo in body) lidos[campo] = ler(body[campo]);
  }
  return lidos;
}

// escopo é jsonb: vai como texto JSON e o SQL faz o cast.
const valorSql = (campo, valor) => (campo === "escopo" && valor !== null ? JSON.stringify(valor) : valor);
const colunaSql = (campo, n) => (campo === "escopo" ? `$${n}::jsonb` : `$${n}`);

// Sem ocorrido_em: fluxo, agora. Com ocorrido_em: correção, com motivo obrigatório; nunca no futuro.
function lerMovimento(body) {
  const estado = typeof body.estado === "string" ? body.estado.trim() : "";
  if (!estado) throw new ErroDeRota(422, "ESTADO_INVALIDO", "Informe o estado.");
  const motivo = typeof body.motivo === "string" && body.motivo.trim() ? body.motivo.trim() : null;
  if (body.data_estimada != null && typeof body.data_estimada !== "boolean") {
    throw new ErroDeRota(422, "DATA_ESTIMADA_INVALIDA", "data_estimada precisa ser true ou false.");
  }

  if (body.ocorrido_em == null || body.ocorrido_em === "") {
    if (body.data_estimada === true) {
      throw new ErroDeRota(422, "DATA_ESTIMADA_SEM_DATA", "data_estimada só vale numa correção com ocorrido_em.");
    }
    return { estado, motivo, ocorridoEm: null, dataEstimada: false, origem: "fluxo" };
  }

  const ocorrido = new Date(body.ocorrido_em);
  if (typeof body.ocorrido_em !== "string" || Number.isNaN(ocorrido.getTime())) {
    throw new ErroDeRota(422, "OCORRIDO_EM_INVALIDO", "ocorrido_em precisa ser uma data ISO.");
  }
  if (ocorrido.getTime() > Date.now() + TOLERANCIA_FUTURO_MS) {
    throw new ErroDeRota(422, "OCORRIDO_EM_FUTURO", "ocorrido_em não pode estar no futuro.");
  }
  if (!motivo) throw new ErroDeRota(422, "MOTIVO_OBRIGATORIO", "Correção com data passada exige motivo.");
  return { estado, motivo, ocorridoEm: ocorrido.toISOString(), dataEstimada: body.data_estimada === true, origem: "correcao" };
}

function uidDe(req) {
  const uid = req.authAccess?.uid;
  if (!uid) throw new ErroDeRota(401, "UNAUTHENTICATED", "Usuário sem uid: não dá para registrar quem fez.");
  return String(uid);
}

const CAMPOS_ESTADO = ["codigo", "ordem", "fase", "rotulo_interno", "rotulo_portal", "prazo_contagem", "prazo_horas", "terminal"];

// Lista fechada de campos, mais acao_do_cliente só quando a coluna existe.
function estadoDe(linha) {
  const estado = {};
  for (const campo of CAMPOS_ESTADO) estado[campo] = linha[campo] ?? null;
  if (typeof linha.acao_do_cliente === "boolean") estado.acao_do_cliente = linha.acao_do_cliente;
  return estado;
}

async function estadosAtivos(client) {
  const { rows } = await client.query(`SELECT codigo FROM public.gd_estados WHERE ativo ORDER BY ordem`);
  return rows.map((r) => r.codigo);
}

// Barreira 1: existe e está ativo. A FK sozinha não pega estado desativado.
async function exigirEstadoValido(client, estado) {
  const { rows } = await client.query(
    `SELECT 1 FROM public.gd_estados WHERE codigo = $1 AND ativo`,
    [estado]
  );
  if (rows.length === 0) {
    throw new ErroDeRota(422, "ESTADO_INVALIDO", `Estado ${estado} não existe ou está inativo.`, {
      validos: await estadosAtivos(client),
    });
  }
}

async function registrarEvento(client, clienteId, mov, uid, atorTipo = "humano", dados = null) {
  // SAVEPOINT: depois do erro da FK a transação fica abortada, e a lista de estados válidos da
  // resposta não poderia mais ser lida (a barreira 2 respondia 500; pego por mutação).
  await client.query("SAVEPOINT gd_evento");
  try {
    const { rows } = await client.query(
      `SELECT (e).id, (e).ocorrido_em, (e).origem
         FROM (SELECT public.gd_registrar_evento($1, $2, COALESCE($3::timestamptz, now()), $4, $5, $6, $7, $8, COALESCE($9::jsonb, '{}'::jsonb)) AS e) x`,
      [clienteId, mov.estado, mov.ocorridoEm, mov.dataEstimada, mov.origem, atorTipo, uid, mov.motivo, dados ? JSON.stringify(dados) : null]
    );
    await client.query("RELEASE SAVEPOINT gd_evento");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT gd_evento");
    // Barreira 2: estado sumiu entre a checagem e o INSERT.
    if (err?.code === "23503") {
      throw new ErroDeRota(422, "ESTADO_INVALIDO", `Estado ${mov.estado} não existe.`, {
        validos: await estadosAtivos(client),
      });
    }
    throw err;
  }
}

async function lerCliente(client, id) {
  const { rows } = await client.query(`${SELECT_CLIENTE} WHERE c.id = $1 AND c.dono_client_id = $2`, [id, GD_DONO]);
  return rows[0] ? clienteDe(rows[0]) : null;
}

function exigirUuid(id) {
  if (!UUID_RE.test(String(id || ""))) throw new ErroDeRota(404, "CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado.");
}

function responderErro(res, err, rota) {
  if (err instanceof ErroDeRota) {
    sendError(res, err.status, err.code, err.message, err.details);
    return;
  }
  if (err instanceof CampoInvalido) {
    sendError(res, 422, err.code, err.message);
    return;
  }
  // Trava da migration que a leitura acima deixou passar (ex.: cnpj_a_confirmar sem cnpj).
  if (err?.code === "23514") {
    sendError(res, 422, "CAMPO_INVALIDO", "Valor recusado pelas regras do cliente.", { regra: err.constraint });
    return;
  }
  if (err?.code === "23505") {
    sendError(res, 409, "CLIENTE_DUPLICADO", "Já existe cliente da GD com esse nome ou CNPJ.");
    return;
  }
  console.error(`[gd-clientes] ${rota}:`, err?.message || err);
  sendError(res, 500, "INTERNAL_ERROR", "Erro ao processar clientes da GD.");
}

async function emTransacao(getPool, fn) {
  const pool = getPool();
  if (!pool) throw new ErroDeRota(503, "DATABASE_UNAVAILABLE", "Banco indisponível.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await fn(client);
    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function registerGdClientesRoutes(app, {
  getPool = () => pgDatabasePool,
  requireFirebaseAuth = requireFirebaseAuthPadrao,
  requireGoclawToken = requireGoclawReadToken,
  evolutionGroupCreator = createEvolutionGroup,
  evolutionInviteGetter = getEvolutionGroupInviteCode,
  evolutionMessageSender = sendTextMessageViaEvolution,
  slackSender = sendSlackMessage,
} = {}) {
  const guarda = [requireFirebaseAuth, requireGdClientesAccess];
  const pool = () => {
    const p = getPool();
    if (!p) throw new ErroDeRota(503, "DATABASE_UNAVAILABLE", "Banco indisponível.");
    return p;
  };

  // Endpoint do Vigia GoClaw: leitura autenticada por token de serviço (GOCLAW_READ_TOKEN).
  app.get("/api/gd/clientes/vigia", requireGoclawToken, async (_req, res) => {
    try {
      const { rows } = await pool().query(
        `SELECT c.id, c.nome AS nome_empresa, c.estado_atual, e.fase, e.ordem, c.estado_desde AS entrou_em,
                e.prazo_horas, e.prazo_contagem, e.rotulo_interno, e.acao_do_cliente
           FROM public.gd_clientes c
           LEFT JOIN public.gd_estados e ON e.codigo = c.estado_atual
          WHERE c.dono_client_id = $1
          ORDER BY e.ordem NULLS LAST, c.estado_desde, c.nome`,
        [GD_DONO]
      );
      res.json({
        clientes: rows.map((r) => ({
          id: r.id,
          nome_empresa: r.nome_empresa,
          estado_atual: r.estado_atual || null,
          fase: r.fase || null,
          ordem: r.ordem != null ? Number(r.ordem) : null,
          entrou_em: r.entrou_em ? new Date(r.entrou_em).toISOString() : null,
          prazo_horas: r.prazo_horas != null ? Number(r.prazo_horas) : null,
          prazo_contagem: r.prazo_contagem || null,
          rotulo_interno: r.rotulo_interno || null,
          acao_do_cliente: Boolean(r.acao_do_cliente),
        })),
      });
    } catch (err) {
      responderErro(res, err, "GET /api/gd/clientes/vigia");
    }
  });

  app.get("/api/gd/estados", ...guarda, async (_req, res) => {
    try {
      // to_jsonb(e) em vez de listar colunas: acao_do_cliente vem de uma migration posterior e, se
      // ela não tiver rodado, a rota segue respondendo sem o campo em vez de cair em 500 (a tela
      // trata a falta como "nenhuma etapa é ação do cliente").
      const { rows } = await pool().query(
        `SELECT to_jsonb(e) AS e FROM public.gd_estados e WHERE e.ativo ORDER BY e.ordem`
      );
      res.json({ estados: rows.map(({ e }) => estadoDe(e)) });
    } catch (err) {
      responderErro(res, err, "GET /api/gd/estados");
    }
  });

  app.get("/api/gd/clientes", ...guarda, async (req, res) => {
    try {
      const filtros = [`c.dono_client_id = $1`];
      const params = [GD_DONO];
      if (typeof req.query.estado === "string" && req.query.estado) {
        params.push(req.query.estado);
        filtros.push(`c.estado_atual = $${params.length}`);
      }
      if (typeof req.query.fase === "string" && req.query.fase) {
        params.push(req.query.fase);
        filtros.push(`e.fase = $${params.length}`);
      }
      params.push(LIMITE_LISTA);
      const { rows } = await pool().query(
        `${SELECT_CLIENTE} WHERE ${filtros.join(" AND ")}
          ORDER BY e.ordem NULLS LAST, c.estado_desde, c.nome
          LIMIT $${params.length}`,
        params
      );
      res.json({ clientes: rows.map(clienteDe) });
    } catch (err) {
      responderErro(res, err, "GET /api/gd/clientes");
    }
  });

  app.get("/api/gd/clientes/:id", ...guarda, async (req, res) => {
    try {
      exigirUuid(req.params.id);
      const db = pool();
      const cliente = await lerCliente(db, req.params.id);
      if (!cliente) throw new ErroDeRota(404, "CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado.");
      // Sem estado_de na tabela: o estado anterior sai da própria linha do tempo.
      const { rows } = await db.query(
        `SELECT ev.id, ev.estado_para AS estado,
                LAG(ev.estado_para) OVER (ORDER BY ev.ocorrido_em, ev.seq) AS estado_anterior,
                es.rotulo_interno, ev.ocorrido_em, ev.registrado_em, ev.data_estimada,
                ev.origem, ev.ator_tipo, ev.ator_id, ev.motivo
           FROM public.gd_cliente_eventos ev
           JOIN public.gd_estados es ON es.codigo = ev.estado_para
          WHERE ev.cliente_id = $1
          ORDER BY ev.ocorrido_em, ev.seq`,
        [cliente.id]
      );
      res.json({ cliente, eventos: rows });
    } catch (err) {
      responderErro(res, err, "GET /api/gd/clientes/:id");
    }
  });

  // Cliente novo do funil: nasce sem estado (o trigger exige) e recebe o primeiro evento na mesma
  // transação. Se o evento falhar, o cliente não fica.
  app.post("/api/gd/clientes", ...guarda, async (req, res) => {
    try {
      const body = req.body || {};
      const uid = uidDe(req);
      const nome = lerNome(body.nome);
      const opcionais = lerOpcionais(body);
      const mov = lerMovimento(body);
      const colunas = ["dono_client_id", "nome", "origem"];
      const valores = ["$1", "$2", "'fluxo'"];
      const params = [GD_DONO, nome];
      for (const [campo, valor] of Object.entries(opcionais)) {
        params.push(valorSql(campo, valor));
        colunas.push(campo);
        valores.push(colunaSql(campo, params.length));
      }
      const cliente = await emTransacao(getPool, async (client) => {
        await exigirEstadoValido(client, mov.estado);
        const { rows } = await client.query(
          `INSERT INTO public.gd_clientes (${colunas.join(", ")})
           VALUES (${valores.join(", ")}) RETURNING id`,
          params
        );
        await registrarEvento(client, rows[0].id, mov, uid);
        return lerCliente(client, rows[0].id);
      });
      res.status(201).json({ cliente });
    } catch (err) {
      responderErro(res, err, "POST /api/gd/clientes");
    }
  });

  // Só nome e os campos de cadastro (CAMPOS_OPCIONAIS). Qualquer outra chave é recusada aqui; o
  // trigger gd_clientes_trava_estado recusa estado_* no banco mesmo que esta lista um dia afrouxe.
  app.patch("/api/gd/clientes/:id", ...guarda, async (req, res) => {
    try {
      exigirUuid(req.params.id);
      const body = req.body || {};
      const chaves = Object.keys(body);
      const editaveis = ["nome", ...Object.keys(CAMPOS_OPCIONAIS)];
      const proibidas = chaves.filter((k) => !editaveis.includes(k));
      if (proibidas.length) {
        throw new ErroDeRota(422, "CAMPO_NAO_EDITAVEL", "Só os dados de cadastro são editáveis; estado muda por evento.", { campos: proibidas, editaveis });
      }
      if (chaves.length === 0) throw new ErroDeRota(422, "NADA_PARA_ALTERAR", `Informe algum de: ${editaveis.join(", ")}.`);

      const sets = [];
      const params = [];
      if ("nome" in body) { params.push(lerNome(body.nome)); sets.push(`nome = $${params.length}`); }
      for (const [campo, valor] of Object.entries(lerOpcionais(body))) {
        params.push(valorSql(campo, valor));
        sets.push(`${campo} = ${colunaSql(campo, params.length)}`);
      }
      params.push(req.params.id, GD_DONO);

      const cliente = await emTransacao(getPool, async (client) => {
        const { rowCount } = await client.query(
          `UPDATE public.gd_clientes SET ${sets.join(", ")}
            WHERE id = $${params.length - 1} AND dono_client_id = $${params.length}`,
          params
        );
        if (rowCount !== 1) throw new ErroDeRota(404, "CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado.");
        return lerCliente(client, req.params.id);
      });
      res.json({ cliente });
    } catch (err) {
      responderErro(res, err, "PATCH /api/gd/clientes/:id");
    }
  });

  app.post("/api/gd/clientes/:id/eventos", ...guarda, async (req, res) => {
    try {
      exigirUuid(req.params.id);
      const body = req.body || {};
      const uid = uidDe(req);
      const mov = lerMovimento(body);
      const esperado = typeof body.estado_esperado === "string" ? body.estado_esperado : null;

      const resultado = await emTransacao(getPool, async (client) => {
        const { rows } = await client.query(
          `SELECT estado_atual FROM public.gd_clientes
            WHERE id = $1 AND dono_client_id = $2 FOR UPDATE`,
          [req.params.id, GD_DONO]
        );
        if (rows.length === 0) throw new ErroDeRota(404, "CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado.");
        const atual = rows[0].estado_atual;

        // Duas pessoas movendo o mesmo cliente: quem viu um estado velho recarrega.
        if (esperado !== null && esperado !== atual) {
          throw new ErroDeRota(409, "ESTADO_MUDOU", "O cliente mudou de estado enquanto a tela estava aberta.", { estado_atual: atual });
        }
        if (mov.origem === "fluxo" && mov.estado === atual) {
          throw new ErroDeRota(409, "ESTADO_IGUAL", `O cliente já está em ${atual}.`, { estado_atual: atual });
        }
        await exigirEstadoValido(client, mov.estado);
        const evento = await registrarEvento(client, req.params.id, mov, uid);
        return { evento, cliente: await lerCliente(client, req.params.id) };
      });
      res.status(201).json(resultado);
    } catch (err) {
      responderErro(res, err, "POST /api/gd/clientes/:id/eventos");
    }
  });

  // ─── Portal do Cliente: emissão e consulta segura por token ───────────────

  // Emissão de token de acompanhamento do portal (acesso interno restrito à GD).
  // Gera token de alta entropia (base64url) e salva apenas o SHA-256 no banco.
  // Revoga automaticamente qualquer token anterior que ainda estiver ativo.
  app.post("/api/gd/clientes/:id/portal-token", ...guarda, async (req, res) => {
    try {
      exigirUuid(req.params.id);
      const uid = req.authAccess?.uid || req.authAccess?.email || "sistema";
      const token = gerarPortalToken();
      const tokenHash = hashPortalToken(token);

      const criado_em = await emTransacao(getPool, async (client) => {
        const { rows } = await client.query(
          `SELECT id FROM public.gd_clientes WHERE id = $1 AND dono_client_id = $2 FOR UPDATE`,
          [req.params.id, GD_DONO]
        );
        if (rows.length === 0) {
          throw new ErroDeRota(404, "CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado.");
        }

        await client.query(
          `UPDATE public.gd_cliente_portal_tokens
              SET revogado_em = now(),
                  revogado_por = $2
            WHERE cliente_id = $1
              AND revogado_em IS NULL`,
          [req.params.id, uid]
        );

        const { rows: insertRows } = await client.query(
          `INSERT INTO public.gd_cliente_portal_tokens (cliente_id, token_sha256, criado_em, criado_por)
           VALUES ($1, $2, now(), $3)
           RETURNING criado_em`,
          [req.params.id, tokenHash, uid]
        );
        return insertRows[0].criado_em;
      });

      res.status(201).json({
        token,
        url: `/acompanhamento/${token}`,
        criado_em,
      });
    } catch (err) {
      responderErro(res, err, "POST /api/gd/clientes/:id/portal-token");
    }
  });

  // Consulta pública da linha do tempo do cliente por token revogável.
  // Não requer autenticação de usuário; validação feita exclusivamente via SHA-256 do token.
  // Retorna apenas dados públicos/sanitizados: sem dados sigilosos, notas, motivos, atores ou rótulos internos.
  app.get("/api/gd/public/portal/:token", async (req, res) => {
    try {
      const rawToken = req.params.token;
      if (!rawToken || typeof rawToken !== "string" || !rawToken.trim()) {
        res.status(404).json({ error: "Link de acompanhamento inválido ou expirado." });
        return;
      }

      const tokenHash = hashPortalToken(rawToken.trim());
      const db = pool();

      const { rows: tokenRows } = await db.query(
        `SELECT id, cliente_id
           FROM public.gd_cliente_portal_tokens
          WHERE token_sha256 = $1
            AND revogado_em IS NULL`,
        [tokenHash]
      );

      if (tokenRows.length === 0) {
        res.status(404).json({ error: "Link de acompanhamento inválido ou expirado." });
        return;
      }

      const { id: tokenId, cliente_id: clienteId } = tokenRows[0];

      // Atualiza último acesso
      await db.query(
        `UPDATE public.gd_cliente_portal_tokens
            SET ultimo_acesso_em = now()
          WHERE id = $1`,
        [tokenId]
      );

      const [clienteRes, estadosRes, eventosRes] = await Promise.all([
        db.query(
          `SELECT nome, estado_atual, estado_desde, estado_data_estimada,
                  proposal_id, drive_url, escopo,
                  contrato_url, briefing_url, ficha_vexo_url, planejamento_url
             FROM public.gd_clientes
            WHERE id = $1 AND dono_client_id = $2`,
          [clienteId, GD_DONO]
        ),
        db.query(
          `SELECT codigo, ordem, fase, rotulo_portal, terminal, acao_do_cliente
             FROM public.gd_estados
            WHERE ativo
            ORDER BY ordem`
        ),
        db.query(
          `SELECT estado_para AS estado, ocorrido_em, data_estimada
             FROM public.gd_cliente_eventos
            WHERE cliente_id = $1
            ORDER BY ocorrido_em, seq`,
          [clienteId]
        ),
      ]);

      if (clienteRes.rows.length === 0) {
        res.status(404).json({ error: "Link de acompanhamento inválido ou expirado." });
        return;
      }

      const c = clienteRes.rows[0];
      const cliente = {
        nome: c.nome,
        estado_atual: c.estado_atual,
        estado_desde: c.estado_desde,
        estado_data_estimada: Boolean(c.estado_data_estimada),
        proposal_id: c.proposal_id || null,
        drive_url: c.drive_url || null,
        escopo: c.escopo || null,
        contrato_url: c.contrato_url || null,
        briefing_url: c.briefing_url || null,
        ficha_vexo_url: c.ficha_vexo_url || null,
        planejamento_url: c.planejamento_url || null,
      };

      const estados = estadosRes.rows.map((r) => ({
        codigo: r.codigo,
        ordem: Number(r.ordem),
        fase: r.fase,
        rotulo_portal: r.rotulo_portal,
        terminal: Boolean(r.terminal),
        acao_do_cliente: Boolean(r.acao_do_cliente),
      }));

      const eventos = eventosRes.rows.map((r) => ({
        estado: r.estado,
        ocorrido_em: r.ocorrido_em,
        data_estimada: Boolean(r.data_estimada),
      }));

      const suporte = {
        whatsapp: process.env.GD_SUPORTE_WHATSAPP || "5534997719779",
      };

      res.json({ cliente, estados, eventos, suporte });
    } catch (err) {
      responderErro(res, err, "GET /api/gd/public/portal/:token");
    }
  });

  // ─── Onboarding Operacional: criação de grupos de WhatsApp (Braços GoClaw) ──
  app.post(
    "/api/gd/clientes/:id/onboarding/whatsapp-groups",
    requireGdOrGoclawAuth(requireFirebaseAuth),
    async (req, res) => {
      try {
        exigirUuid(req.params.id);
        const body = req.body || {};
        const clienteId = req.params.id;
        const ator = req.authActor || { tipo: "humano", id: req.authAccess?.uid || "humano" };

        const db = pool();
        const cliente = await lerCliente(db, clienteId);
        if (!cliente) {
          throw new ErroDeRota(404, "CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado.");
        }

        if (cliente.grupo_interno_jid && cliente.grupo_cliente_jid && !body.force) {
          res.json({
            status: "already_created",
            message: "Grupos de WhatsApp já haviam sido criados para este cliente.",
            cliente,
            grupos: {
              interno: { jid: cliente.grupo_interno_jid, url: cliente.grupo_interno_url },
              cliente: { jid: cliente.grupo_cliente_jid, url: cliente.grupo_cliente_url },
            },
          });
          return;
        }

        const instanceName =
          (typeof body.instance_name === "string" && body.instance_name.trim()) ||
          process.env.GD_ONBOARDING_EVOLUTION_INSTANCE ||
          process.env.GD_EVOLUTION_INSTANCE ||
          "vexo-adm-vexo-atende";

        // Equipe GD (Conrado, Caio, Gabriel)
        const envEquipe = process.env.GD_ONBOARDING_EQUIPE_TELEFONES;
        const equipeConfigurada = envEquipe
          ? envEquipe.split(",").map((s) => s.trim()).filter(Boolean)
          : ["5534991751267", "5534997719779", "5534991241824"];

        const equipeParticipantes = Array.isArray(body.equipe_telefones)
          ? body.equipe_telefones
          : typeof body.equipe_telefones === "string"
          ? body.equipe_telefones.split(",").map((s) => s.trim()).filter(Boolean)
          : equipeConfigurada;

        const clienteTelefone = body.cliente_telefone || cliente.aprovador_telefone || null;

        // 1. Criar Grupo Interno GD
        const subjectInterno = `[INTERNO] ${cliente.nome}`.slice(0, 100);
        const resInterno = await evolutionGroupCreator({
          instanceName,
          subject: subjectInterno,
          description: `Grupo interno da equipe Geração Digital para alinhamento e operação de ${cliente.nome}.`,
          participants: equipeParticipantes,
        });

        const jidInterno = resInterno.groupJid;
        let urlInterno = null;
        if (jidInterno) {
          try {
            const invite = await evolutionInviteGetter({ instanceName, groupJid: jidInterno });
            urlInterno = invite?.inviteUrl || null;
          } catch (e) {
            console.warn(`[GD-Onboarding] Falha ao obter invite code do grupo interno (${jidInterno}):`, e.message);
          }
        }

        // 2. Criar Grupo com o Cliente
        const subjectCliente = `GD + ${cliente.nome}`.slice(0, 100);
        const participantesClienteGrupo = [...equipeParticipantes];
        if (clienteTelefone) {
          participantesClienteGrupo.push(clienteTelefone);
        }

        const resCliente = await evolutionGroupCreator({
          instanceName,
          subject: subjectCliente,
          description: `Canal oficial de acompanhamento e suporte da Geração Digital para ${cliente.nome}.`,
          participants: participantesClienteGrupo,
        });

        const jidCliente = resCliente.groupJid;
        let urlCliente = null;
        if (jidCliente) {
          try {
            const invite = await evolutionInviteGetter({ instanceName, groupJid: jidCliente });
            urlCliente = invite?.inviteUrl || null;
          } catch (e) {
            console.warn(`[GD-Onboarding] Falha ao obter invite code do grupo do cliente (${jidCliente}):`, e.message);
          }

          // Mensagem de boas-vindas no grupo do cliente
          const nomeDestinatario = cliente.aprovador_nome || cliente.nome;
          const textoBoasVindas =
            typeof body.mensagem_boas_vindas === "string" && body.mensagem_boas_vindas.trim()
              ? body.mensagem_boas_vindas.trim()
              : `Olá, ${nomeDestinatario}! Seja muito bem-vindo(a) à Geração Digital! 🚀\n\nEste é o nosso canal oficial de atendimento, alinhamento e acompanhamento com toda a nossa equipe. Qualquer dúvida ou solicitação, estamos sempre por aqui.\n\nEm breve daremos início aos próximos passos do seu onboarding!`;

          try {
            await evolutionMessageSender({
              instanceName,
              number: jidCliente,
              text: textoBoasVindas,
            });
          } catch (e) {
            console.warn(`[GD-Onboarding] Falha ao enviar mensagem de boas-vindas no grupo ${jidCliente}:`, e.message);
          }
        }

        // 3. Atualizar gd_clientes e registrar evento de transição se aplicável
        const driveUrlInformada = body.drive_url ? lerDriveUrl(body.drive_url) : null;

        const resultado = await emTransacao(getPool, async (client) => {
          await client.query(
            `UPDATE public.gd_clientes
                SET grupo_interno_jid = $1,
                    grupo_interno_url = $2,
                    grupo_cliente_jid = $3,
                    grupo_cliente_url = $4,
                    onboarding_concluido_em = now(),
                    drive_url = COALESCE($5, drive_url)
              WHERE id = $6 AND dono_client_id = $7`,
            [jidInterno, urlInterno, jidCliente, urlCliente, driveUrlInformada, clienteId, GD_DONO]
          );

          // Transiciona estado para GRUPOS_CRIADOS caso o cliente esteja em estado anterior
          let evento = null;
          if (cliente.estado_atual !== "GRUPOS_CRIADOS") {
            const mov = {
              estado: "GRUPOS_CRIADOS",
              motivo: "Pastas e grupos de WhatsApp criados via automação GoClaw.",
              ocorridoEm: null,
              dataEstimada: false,
              origem: "fluxo",
            };

            const dadosEvento = {
              grupo_interno: { jid: jidInterno, url: urlInterno },
              grupo_cliente: { jid: jidCliente, url: urlCliente },
              drive_url: driveUrlInformada || cliente.drive_url,
            };

            await exigirEstadoValido(client, mov.estado);
            evento = await registrarEvento(client, clienteId, mov, ator.id, ator.tipo, dadosEvento);
          }

          const clienteAtualizado = await lerCliente(client, clienteId);
          return { evento, cliente: clienteAtualizado };
        });

        // 4. Notificação Slack (não bloqueante)
        try {
          const slackText =
            `🚀 *Onboarding GD · Grupos de WhatsApp Criados!*\n` +
            `• *Cliente:* ${cliente.nome}\n` +
            `• *Grupo Interno:* ${urlInterno || jidInterno || "Sem link"}\n` +
            `• *Grupo Cliente:* ${urlCliente || jidCliente || "Sem link"}\n` +
            `• *Estado:* GRUPOS_CRIADOS`;
          await slackSender({ text: slackText, channel: "01-ops-geral" });
        } catch (e) {
          console.warn("[GD-Onboarding] Falha ao notificar Slack:", e.message);
        }

        res.status(201).json({
          success: true,
          cliente: resultado.cliente,
          evento: resultado.evento,
          grupos: {
            interno: { jid: jidInterno, url: urlInterno },
            cliente: { jid: jidCliente, url: urlCliente },
          },
        });
      } catch (err) {
        responderErro(res, err, "POST /api/gd/clientes/:id/onboarding/whatsapp-groups");
      }
    }
  );
}
