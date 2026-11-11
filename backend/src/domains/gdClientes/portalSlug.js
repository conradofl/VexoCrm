// Slug público do portal do cliente GD.
//
// O portal abre sem login em /portal/:slug e /acompanhamento/:slug. Um slug igual ao nome da empresa
// ("infinie-energia") é adivinhável: quem sabe o nome do cliente abre contrato, Drive e briefing dele.
// Por isso o slug que vale para acesso público termina num sufixo aleatório ("infinie-energia-k7m2p9qd4xwt").
// Slug sem sufixo continua podendo existir no banco (histórico), mas NÃO abre o portal público.
import { randomBytes } from "node:crypto";

// 32 símbolos, sem 0/o/1/l para não confundir ao ler em voz alta. 12 símbolos = 60 bits.
const ALFABETO = "abcdefghijkmnpqrstuvwxyz23456789";
export const TAMANHO_SUFIXO = 12;
const SUFIXO_SECRETO_RE = new RegExp(`-[${ALFABETO}]{${TAMANHO_SUFIXO}}$`);
const TAMANHO_MAXIMO_SLUG = 100;

export function normalizarBaseSlug(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function gerarSufixoSecreto() {
  const bytes = randomBytes(TAMANHO_SUFIXO);
  let out = "";
  // 256 é múltiplo de 32: o resto da divisão não enviesa a escolha.
  for (const b of bytes) out += ALFABETO[b % ALFABETO.length];
  return out;
}

export function temSufixoSecreto(slug) {
  return typeof slug === "string" && SUFIXO_SECRETO_RE.test(slug.trim().toLowerCase());
}

// Recebe o nome da empresa ou um slug antigo sem sufixo e devolve um slug novo, com sufixo.
export function gerarPortalSlug(base) {
  const limite = TAMANHO_MAXIMO_SLUG - TAMANHO_SUFIXO - 1;
  const limpo = normalizarBaseSlug(base).slice(0, limite).replace(/-+$/g, "") || "cliente";
  return `${limpo}-${gerarSufixoSecreto()}`;
}

// Garante que o cliente tem slug com sufixo secreto e devolve o slug que vale. Grava só quando falta.
// Devolve null se o cliente não existe para esse dono.
export async function garantirPortalSlugSecreto(db, { clienteId, donoClientId }) {
  const { rows } = await db.query(
    `SELECT nome, portal_slug FROM public.gd_clientes WHERE id = $1 AND dono_client_id = $2`,
    [clienteId, donoClientId]
  );
  if (rows.length === 0) return null;
  const atual = rows[0].portal_slug;
  if (temSufixoSecreto(atual)) return atual.trim().toLowerCase();

  const novo = gerarPortalSlug(atual || rows[0].nome);
  // Só troca se ninguém trocou no meio do caminho; senão fica o que o outro gravou.
  const { rows: gravado } = await db.query(
    `UPDATE public.gd_clientes
        SET portal_slug = $1
      WHERE id = $2 AND dono_client_id = $3 AND portal_slug IS NOT DISTINCT FROM $4
      RETURNING portal_slug`,
    [novo, clienteId, donoClientId, atual]
  );
  if (gravado.length > 0) return gravado[0].portal_slug;

  const { rows: denovo } = await db.query(
    `SELECT portal_slug FROM public.gd_clientes WHERE id = $1 AND dono_client_id = $2`,
    [clienteId, donoClientId]
  );
  const outro = denovo[0]?.portal_slug;
  return temSufixoSecreto(outro) ? outro.trim().toLowerCase() : null;
}
