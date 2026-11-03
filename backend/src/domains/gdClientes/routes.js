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
import { requireFirebaseAuth as requireFirebaseAuthPadrao } from "../../access/middlewares.js";
import { hasInternalPageAccess } from "../../accessGuards.js";
import { pgDatabasePool } from "../../services/database.js";
import { sendError } from "../../services/httpInfra.js";
import { CAMPOS_OPCIONAIS, CampoInvalido, GD_DONO, lerNome } from "./campos.js";

export { GD_DONO };
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
         c.drive_url, c.escopo, c.escopo_original, c.origem, c.estado_atual, c.estado_desde,
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

async function registrarEvento(client, clienteId, mov, uid) {
  // SAVEPOINT: depois do erro da FK a transação fica abortada, e a lista de estados válidos da
  // resposta não poderia mais ser lida (a barreira 2 respondia 500; pego por mutação).
  await client.query("SAVEPOINT gd_evento");
  try {
    const { rows } = await client.query(
      `SELECT (e).id, (e).ocorrido_em, (e).origem
         FROM (SELECT public.gd_registrar_evento($1, $2, COALESCE($3::timestamptz, now()), $4, $5, 'humano', $6, $7) AS e) x`,
      [clienteId, mov.estado, mov.ocorridoEm, mov.dataEstimada, mov.origem, uid, mov.motivo]
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
} = {}) {
  const guarda = [requireFirebaseAuth, requireGdClientesAccess];
  const pool = () => {
    const p = getPool();
    if (!p) throw new ErroDeRota(503, "DATABASE_UNAVAILABLE", "Banco indisponível.");
    return p;
  };

  app.get("/api/gd/estados", ...guarda, async (_req, res) => {
    try {
      const { rows } = await pool().query(
        `SELECT codigo, ordem, fase, rotulo_interno, prazo_contagem, prazo_horas, terminal
           FROM public.gd_estados WHERE ativo ORDER BY ordem`
      );
      res.json({ estados: rows });
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
}
