// Leitura dos campos de gd_clientes, igual para a rota e para o script de importação: o mesmo dado
// não pode entrar por um caminho e ser recusado pelo outro. As travas da migration 20261103120000
// recusam o mesmo no banco; aqui o erro sai com código e mensagem, antes do INSERT.
export const GD_DONO = "geracao-digital";
export const ESCOPOS = ["google", "social", "linkedin", "meta", "consultoria", "eventos", "vexo"];

export class CampoInvalido extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const vazio = (v) => v == null || (typeof v === "string" && !v.trim());

function texto(bruto, code, rotulo, max) {
  if (vazio(bruto)) return null;
  if (typeof bruto !== "string") throw new CampoInvalido(code, `${rotulo} precisa ser texto.`);
  const t = bruto.trim();
  if (t.length > max) throw new CampoInvalido(code, `${rotulo} passa de ${max} caracteres.`);
  return t;
}

// Chave de deduplicação por nome dentro do dono: minúsculas, sem acento, espaços colapsados.
export function chaveDoNome(nome) {
  return String(nome).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function lerNome(bruto) {
  const nome = typeof bruto === "string" ? bruto.trim() : "";
  if (!nome || nome.length > 200) throw new CampoInvalido("NOME_INVALIDO", "Nome obrigatório, até 200 caracteres.");
  return nome;
}

// CNPJ guardado só com dígitos: "12.345.678/0001-90" e "12345678000190" seriam dois clientes
// para o índice único se entrassem como vieram.
export function lerCnpj(bruto) {
  if (vazio(bruto)) return null;
  if (typeof bruto !== "string") throw new CampoInvalido("CNPJ_INVALIDO", "CNPJ precisa ser texto com 14 dígitos.");
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length !== 14) throw new CampoInvalido("CNPJ_INVALIDO", "CNPJ precisa ter 14 dígitos.");
  return digitos;
}

// Sempre com o DDI 55, só dígitos. Com 10 ou 11 dígitos o 55 entra na frente; com 12 ou 13 o
// número já precisa começar com 55. DDD começando com 0 é recusado (o "5500" fabricado).
export function lerTelefone(bruto) {
  if (vazio(bruto)) return null;
  if (typeof bruto !== "string") throw new CampoInvalido("TELEFONE_INVALIDO", "Telefone precisa ser texto.");
  let d = bruto.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55[1-9][0-9]{9,10}$/.test(d)) {
    throw new CampoInvalido("TELEFONE_INVALIDO", "Telefone precisa ser brasileiro: DDD válido e 8 ou 9 dígitos, com ou sem 55.");
  }
  return d;
}

export function lerDriveUrl(bruto) {
  const url = texto(bruto, "DRIVE_URL_INVALIDA", "Link do Drive", 500);
  if (url === null) return null;
  if (!/^https:\/\//.test(url)) throw new CampoInvalido("DRIVE_URL_INVALIDA", "Link do Drive precisa começar com https://.");
  if (url.includes("/u/0/")) {
    throw new CampoInvalido("DRIVE_URL_INVALIDA", "Link do Drive com /u/0/ abre a conta de quem copiou; tire o /u/0/ do link.");
  }
  return url;
}

export function lerUrlOpcional(bruto, code, rotulo) {
  const url = texto(bruto, code, rotulo, 500);
  if (url === null) return null;
  if (!/^https:\/\//.test(url)) {
    throw new CampoInvalido(code, `${rotulo} precisa começar com https://.`);
  }
  return url;
}

export const lerContratoUrl = (bruto) => lerUrlOpcional(bruto, "CONTRATO_URL_INVALIDA", "Link do contrato");
export const lerBriefingUrl = (bruto) => lerUrlOpcional(bruto, "BRIEFING_URL_INVALIDA", "Link do briefing");
export const lerFichaVexoUrl = (bruto) => lerUrlOpcional(bruto, "FICHA_VEXO_URL_INVALIDA", "Link da ficha Vexo");
export const lerPlanejamentoUrl = (bruto) => lerUrlOpcional(bruto, "PLANEJAMENTO_URL_INVALIDA", "Link do planejamento");

// Lista de códigos, sem repetição. Lista vazia é "sem escopo informado".
export function lerEscopo(bruto) {
  if (bruto == null) return null;
  if (!Array.isArray(bruto)) throw new CampoInvalido("ESCOPO_INVALIDO", `Escopo precisa ser lista de: ${ESCOPOS.join(", ")}.`);
  const fora = bruto.filter((c) => !ESCOPOS.includes(c));
  if (fora.length) throw new CampoInvalido("ESCOPO_INVALIDO", `Escopo fora da lista: ${fora.join(", ")}. Válidos: ${ESCOPOS.join(", ")}.`);
  const unicos = [...new Set(bruto)];
  return unicos.length ? unicos : null;
}

export const lerEscopoOriginal = (bruto) => texto(bruto, "ESCOPO_ORIGINAL_INVALIDO", "Escopo original", 1000);
export const lerAprovadorNome = (bruto) => texto(bruto, "APROVADOR_NOME_INVALIDO", "Nome do aprovador", 200);

export function lerCnpjAConfirmar(bruto) {
  if (bruto == null) return false;
  if (typeof bruto !== "boolean") throw new CampoInvalido("CNPJ_A_CONFIRMAR_INVALIDO", "cnpj_a_confirmar precisa ser true ou false.");
  return bruto;
}

// Campos opcionais do cliente, na ordem das colunas. nome fica fora: é obrigatório e tem regra própria.
export const CAMPOS_OPCIONAIS = {
  cnpj: lerCnpj,
  aprovador_nome: lerAprovadorNome,
  aprovador_telefone: lerTelefone,
  drive_url: lerDriveUrl,
  contrato_url: lerContratoUrl,
  briefing_url: lerBriefingUrl,
  ficha_vexo_url: lerFichaVexoUrl,
  planejamento_url: lerPlanejamentoUrl,
  escopo: lerEscopo,
  escopo_original: lerEscopoOriginal,
  cnpj_a_confirmar: lerCnpjAConfirmar,
};
