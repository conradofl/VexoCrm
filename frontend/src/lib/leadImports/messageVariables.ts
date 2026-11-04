// Variaveis de nome que o envio substitui (backend/src/services/messagePlaceholders.js).
// A tela le daqui: auditoria e previa nao podem discordar do que de fato sai para o lead.
// firstNameVariableParity.test.tsx compara estas listas com as do backend.
export const FIRST_NAME_VARIABLES = ["primeiro_nome", "primeironome", "primeiro nome", "first_name", "firstname"];
export const NAME_VARIABLES = ["nome", "name", "lead_name", "cliente"];

const normalizar = (variavel: string) => variavel.trim().toLowerCase().replace(/\s+/g, " ");

export const isFirstNameVariable = (variavel: string) => FIRST_NAME_VARIABLES.includes(normalizar(variavel));
export const isNameVariable = (variavel: string) => NAME_VARIABLES.includes(normalizar(variavel));

const placeholderDe = (variaveis: string[]) =>
  new RegExp(`\\{\\{\\s*(?:${variaveis.map((v) => v.replace(" ", "\\s+")).join("|")})\\s*\\}\\}`, "gi");

const PRIMEIRO_NOME = placeholderDe(FIRST_NAME_VARIABLES);
const NOME = placeholderDe(NAME_VARIABLES);

/** Nome ficticio da previa, nas mesmas variaveis que o envio substitui. */
export function renderPreviewNames(texto: string) {
  return texto.replace(PRIMEIRO_NOME, "Maria").replace(NOME, "Maria Silva");
}
