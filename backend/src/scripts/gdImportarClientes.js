// backend/src/scripts/gdImportarClientes.js
//
// Carga inicial dos clientes ativos da Geração Digital em gd_clientes (03/11/2026).
//
// A LISTA NÃO MORA NO REPOSITÓRIO: traz o telefone dos aprovadores, que são pessoas reais. Ela entra
// no contêiner por heredoc em /tmp e é lida daqui por --arquivo.
//
// Cada cliente novo entra com origem 'importacao_inicial' e um evento ATIVO com ocorrido_em = início
// desta transação e data_estimada = true. importacao_inicial quer dizer "estado conhecido quando
// começamos a medir", NÃO "entrou nesse estado hoje": ninguém sabe quando cada um virou ATIVO e a
// data não é fabricada.
//
// Idempotente: rodar de novo com a mesma lista não cria cliente nem evento. Chave: CNPJ quando
// existir, senão o nome normalizado (chaveDoNome), sempre dentro do dono geracao-digital.
// - Cliente que já existe: só preenche campo vazio, nunca sobrescreve; não ganha evento se já tem
//   estado, e estado diferente de ATIVO só vira aviso.
// - Conflito (mesmo nome com outro CNPJ, ou nome e CNPJ apontando para clientes diferentes) aborta
//   a lista inteira sem gravar nada.
// - cnpj_a_confirmar só é gravado junto com o CNPJ que este script grava. Pendência desligada na
//   tela não volta numa segunda rodada.
//
// Uso (console do bk-vexo no EasyPanel):
//   node src/scripts/gdImportarClientes.js --arquivo /tmp/gd-lista.json --ator importacao:conrado --esperado 22
//   node src/scripts/gdImportarClientes.js --arquivo /tmp/gd-lista.json --ator importacao:conrado --esperado 22 --aplicar
// Sem --aplicar é ensaio: faz tudo dentro da transação e desfaz no fim (ROLLBACK).

import pg from "pg";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CAMPOS_OPCIONAIS, CampoInvalido, GD_DONO, chaveDoNome, lerNome } from "../domains/gdClientes/campos.js";

const CHAVES_ACEITAS = ["nome", ...Object.keys(CAMPOS_OPCIONAIS)];
const PREENCHIVEIS = ["cnpj", "aprovador_nome", "aprovador_telefone", "drive_url", "escopo", "escopo_original"];
const MOTIVO = "Importação inicial: estado conhecido quando começamos a medir, não a data em que entrou nele.";
// Duas execuções ao mesmo tempo esperam uma pela outra em vez de se cruzarem.
const TRAVA = "gd-importar-clientes";

export class ListaRecusada extends Error {
  constructor(message, problemas) {
    super(message);
    this.problemas = problemas;
  }
}

// Valida a lista inteira antes de abrir conexão. Erro em qualquer linha recusa todas. As mensagens
// citam a linha e o nome, nunca o valor do telefone.
export function validarLista(bruta, { esperado } = {}) {
  const lista = Array.isArray(bruta) ? bruta : bruta?.clientes;
  if (!Array.isArray(lista)) throw new ListaRecusada("A lista precisa ser um array JSON (ou { \"clientes\": [...] }).", []);
  if (esperado != null && lista.length !== esperado) {
    throw new ListaRecusada(`A lista tem ${lista.length} clientes; o esperado era ${esperado}.`, []);
  }
  const problemas = [];
  const linhas = [];
  const porChave = new Map();
  lista.forEach((item, i) => {
    const onde = `linha ${i + 1}${typeof item?.nome === "string" ? ` (${item.nome.trim()})` : ""}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problemas.push(`${onde}: não é um objeto.`);
      return;
    }
    const estranhas = Object.keys(item).filter((k) => !CHAVES_ACEITAS.includes(k));
    if (estranhas.length) problemas.push(`${onde}: campo desconhecido ${estranhas.join(", ")} (aceitos: ${CHAVES_ACEITAS.join(", ")}).`);
    try {
      const linha = { nome: lerNome(item.nome) };
      for (const [campo, ler] of Object.entries(CAMPOS_OPCIONAIS)) {
        try {
          linha[campo] = ler(item[campo]);
        } catch (err) {
          if (!(err instanceof CampoInvalido)) throw err;
          problemas.push(`${onde}: ${campo}: ${err.message}`);
        }
      }
      if (linha.cnpj_a_confirmar && !linha.cnpj) problemas.push(`${onde}: cnpj_a_confirmar sem cnpj.`);
      linha.chave = chaveDoNome(linha.nome);
      for (const k of [`nome:${linha.chave}`, linha.cnpj && `cnpj:${linha.cnpj}`].filter(Boolean)) {
        if (porChave.has(k)) problemas.push(`${onde}: repete ${k.startsWith("cnpj") ? "o CNPJ" : "o nome"} da linha ${porChave.get(k) + 1}.`);
        else porChave.set(k, i);
      }
      linhas.push(linha);
    } catch (err) {
      if (!(err instanceof CampoInvalido)) throw err;
      problemas.push(`${onde}: ${err.message}`);
    }
  });
  if (problemas.length) throw new ListaRecusada(`Lista recusada: ${problemas.length} problema(s). Nada foi gravado.`, problemas);
  return linhas;
}

const valorSql = (campo, valor) => (campo === "escopo" && valor !== null ? JSON.stringify(valor) : valor);
const colunaSql = (campo, n) => (campo === "escopo" ? `$${n}::jsonb` : `$${n}`);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function importarClientes(pool, bruta, { ator, aplicar = false, esperado, log = console.log } = {}) {
  if (typeof ator !== "string" || !ator.trim()) throw new ListaRecusada("Informe --ator (ex.: importacao:conrado).", []);
  const linhas = validarLista(bruta, { esperado });
  const resumo = { aplicado: false, recebidos: linhas.length, criados: 0, ja_existiam: 0, eventos: 0, campos_preenchidos: 0, avisos: [] };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [TRAVA]);
    // Um T só para a carga inteira: o now() da transação.
    const { rows: [{ t }] } = await client.query("SELECT now() AS t");

    const { rows: existentes } = await client.query(
      `SELECT id, nome, estado_atual, ${PREENCHIVEIS.join(", ")}
         FROM public.gd_clientes WHERE dono_client_id = $1 FOR UPDATE`,
      [GD_DONO]
    );
    const porCnpj = new Map();
    const porNome = new Map();
    const conflitos = [];
    for (const c of existentes) {
      if (c.cnpj) porCnpj.set(c.cnpj, c);
      const k = chaveDoNome(c.nome);
      if (porNome.has(k)) conflitos.push(`no banco, "${porNome.get(k).nome}" e "${c.nome}" têm o mesmo nome normalizado.`);
      porNome.set(k, c);
    }

    const usados = new Map();
    const plano = linhas.map((linha) => {
      const pCnpj = linha.cnpj ? porCnpj.get(linha.cnpj) : undefined;
      const pNome = porNome.get(linha.chave);
      if (pCnpj && pNome && pCnpj.id !== pNome.id) {
        conflitos.push(`${linha.nome}: o CNPJ é de "${pCnpj.nome}" e o nome é de outro cliente.`);
      }
      const existente = pCnpj || pNome;
      if (existente && linha.cnpj && existente.cnpj && existente.cnpj !== linha.cnpj) {
        conflitos.push(`${linha.nome}: no banco o CNPJ é ${existente.cnpj}, na lista é ${linha.cnpj}.`);
      }
      if (existente && usados.has(existente.id)) {
        conflitos.push(`${linha.nome} e ${usados.get(existente.id)} apontam para o mesmo cliente do banco ("${existente.nome}").`);
      }
      if (existente) usados.set(existente.id, linha.nome);
      return { linha, existente };
    });
    if (conflitos.length) {
      throw new ListaRecusada(`Conflito com o banco: ${conflitos.length}. Nada foi gravado.`, conflitos);
    }

    for (const { linha, existente } of plano) {
      let id;
      let precisaEvento;
      if (!existente) {
        const colunas = ["dono_client_id", "nome", "origem"];
        const valores = ["$1", "$2", "'importacao_inicial'"];
        const params = [GD_DONO, linha.nome];
        for (const campo of [...PREENCHIVEIS, "cnpj_a_confirmar"]) {
          if (linha[campo] === null) continue;
          params.push(valorSql(campo, linha[campo]));
          colunas.push(campo);
          valores.push(colunaSql(campo, params.length));
        }
        const { rows } = await client.query(
          `INSERT INTO public.gd_clientes (${colunas.join(", ")}) VALUES (${valores.join(", ")}) RETURNING id`,
          params
        );
        id = rows[0].id;
        precisaEvento = true;
        resumo.criados += 1;
      } else {
        id = existente.id;
        resumo.ja_existiam += 1;
        const sets = [];
        const params = [];
        const mantidos = [];
        for (const campo of PREENCHIVEIS) {
          if (linha[campo] === null) continue;
          if (existente[campo] === null) {
            params.push(valorSql(campo, linha[campo]));
            sets.push(`${campo} = ${colunaSql(campo, params.length)}`);
            if (campo === "cnpj" && linha.cnpj_a_confirmar) sets.push("cnpj_a_confirmar = true");
          } else if (!igual(existente[campo], linha[campo])) {
            mantidos.push(campo);
          }
        }
        if (sets.length) {
          params.push(id);
          await client.query(`UPDATE public.gd_clientes SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
          resumo.campos_preenchidos += params.length - 1;
        }
        if (mantidos.length) {
          resumo.avisos.push(`${existente.nome}: mantido o valor do banco em ${mantidos.join(", ")} (a lista traz outro).`);
        }
        precisaEvento = existente.estado_atual === null;
        if (existente.estado_atual && existente.estado_atual !== "ATIVO") {
          resumo.avisos.push(`${existente.nome}: está em ${existente.estado_atual}; não mexi no estado.`);
        }
      }
      if (precisaEvento) {
        await client.query(
          `SELECT public.gd_registrar_evento($1, 'ATIVO', $2, true, 'importacao_inicial', 'importacao', $3, $4)`,
          [id, t, ator.trim(), MOTIVO]
        );
        resumo.eventos += 1;
      }
    }

    if (aplicar) {
      await client.query("COMMIT");
      resumo.aplicado = true;
    } else {
      await client.query("ROLLBACK");
    }
    resumo.ocorrido_em = new Date(t).toISOString();
    log(`[gd-importar] ${aplicar ? "APLICADO" : "ENSAIO (nada gravado)"}: ${JSON.stringify(resumo)}`);
    return resumo;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function argumento(nome) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL não configurada no ambiente.");
    process.exit(1);
  }
  const url = new URL(connectionString);
  // Mesma trava dos outros scripts: toda a produção vive em 72.61.37.181 (banco db-vexo, base vexo).
  const ALLOWED_HOSTS = ["72.61.37.181", "db-vexo", "vexo_db-vexo", "localhost", "127.0.0.1"];
  const dbName = url.pathname.slice(1).toLowerCase();
  if (!ALLOWED_HOSTS.includes(url.hostname.toLowerCase()) || !(dbName === "vexo" || url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    console.error(`Conexão abortada: host '${url.hostname}' ou banco '${dbName}' fora do esperado. Não escrever.`);
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  try {
    const arquivo = argumento("--arquivo");
    if (!arquivo) throw new ListaRecusada("Informe --arquivo /tmp/gd-lista.json.", []);
    const esperadoBruto = argumento("--esperado");
    const esperado = esperadoBruto === undefined ? undefined : Number(esperadoBruto);
    await importarClientes(pool, JSON.parse(readFileSync(arquivo, "utf8")), {
      ator: argumento("--ator"),
      aplicar: process.argv.includes("--aplicar"),
      esperado,
    });
  } catch (err) {
    // Falha de conexão chega como AggregateError, com message vazia e o motivo em code.
    console.error(`[gd-importar] ${err.message || err.code || String(err)}`);
    for (const p of err.problemas || []) console.error(`  - ${p}`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
    process.exit();
  }
}
