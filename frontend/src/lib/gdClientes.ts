// Clientes da Geração Digital (tela interna, 03/11/2026). Tipos da API /api/gd/clientes e as três
// regras puras da tela: quem vê, em que ordem, e como o prazo vira texto.
import type { AuthAccessProfile } from "@/contexts/AuthContext";

export const GD_DONO = "geracao-digital";
export const PERMISSAO_GD = "geracao_digital.proposals";
export const ESCOPOS = ["google", "social", "linkedin", "meta", "consultoria", "eventos", "vexo"] as const;
export type Escopo = (typeof ESCOPOS)[number];

// Páginas da GD que o backend aceita no guarda (accessGuards.js, hasInternalPageAccess).
const PAGINAS_GD = [
  "geracao-digital", "implantacao-gd", "propostas-gd", "briefings-gd", "apresentacao-gd",
  "dashboard-gd", "contratos-gd", "pacotes-gd", "condicoes-gd",
];

export interface GdPrazo {
  regra: "horas_corridas" | "horas_uteis" | "fim_do_dia_util" | "sem_prazo";
  horas: number | null;
  vence_em: string | null;
  atrasado: boolean | null;
  calculo: "ok" | "pendente" | "sem_prazo";
}

export interface GdCliente {
  id: string;
  nome: string;
  portal_slug?: string | null;
  cnpj: string | null;
  cnpj_a_confirmar: boolean;
  aprovador_nome: string | null;
  aprovador_telefone: string | null;
  google_calendar_email?: string | null;
  drive_url: string | null;
  contrato_url?: string | null;
  briefing_url?: string | null;
  ficha_vexo_url?: string | null;
  planejamento_url?: string | null;
  grupo_interno_jid?: string | null;
  grupo_interno_url?: string | null;
  grupo_cliente_jid?: string | null;
  grupo_cliente_url?: string | null;
  onboarding_concluido_em?: string | null;
  escopo: Escopo[] | null;
  escopo_original: string | null;
  origem: "fluxo" | "importacao_inicial";
  estado_atual: string | null;
  rotulo_interno: string | null;
  fase: string | null;
  ordem: number | null;
  estado_desde: string | null;
  aproximado: boolean;
  prazo: GdPrazo | null;
  created_at: string;
  updated_at: string;
}

export interface GdEstado {
  codigo: string;
  ordem: number;
  fase: string;
  rotulo_interno: string;
  rotulo_portal?: string | null;
  prazo_contagem: string;
  prazo_horas: number | null;
  terminal: boolean;
  // Ausente quando a migration 20261103180000 não rodou: a trilha trata como false.
  acao_do_cliente?: boolean;
}

export interface GdEvento {
  id: string;
  estado: string;
  estado_anterior: string | null;
  rotulo_interno: string;
  ocorrido_em: string;
  registrado_em: string;
  data_estimada: boolean;
  origem: "fluxo" | "importacao_inicial" | "correcao";
  ator_tipo: "humano" | "goclaw" | "sistema" | "importacao";
  ator_id: string;
  motivo: string | null;
}

// Campos que o PATCH aceita, iguais à lista branca da rota. Estado não está aqui de propósito:
// estado só muda por POST /eventos.
export const CAMPOS_EDITAVEIS = [
  "nome", "cnpj", "cnpj_a_confirmar", "aprovador_nome", "aprovador_telefone",
  "drive_url", "contrato_url", "briefing_url", "ficha_vexo_url", "planejamento_url",
  "escopo", "escopo_original", "portal_slug",
] as const;
export type CampoEditavel = (typeof CAMPOS_EDITAVEIS)[number];

// Espelho do requireGdClientesAccess (backend/src/domains/gdClientes/routes.js) para mostrar ou
// esconder a aba. Quem decide é o backend: a tela trata o 403 com mensagem própria.
//
// DÍVIDA (03/11/2026): access.ts tem lista tipada própria (normalizePermissions,
// normalizeInternalPages) que descarta em silêncio "geracao_digital.proposals" e a página
// "implantacao-gd", que o backend usa. Por isso a permissão é lida de granularPermissions, a lista
// crua das claims. Um caso não dá para espelhar: o backend aceita internalPages vazio para quem é
// da GD, e o frontend preenche o vazio com o padrão do preset antes de chegar aqui. A falha é
// para o lado seguro: quem passaria no backend e falha aqui não vê a aba; o contrário não acontece.
// Corrigir a lista tipada é a saída de verdade, e vai morder em outra tela.
export function podeVerClientesGd(perfil: Pick<AuthAccessProfile, "role" | "isAdmin" | "clientId" | "clientIds" | "internalPages" | "granularPermissions"> | null | undefined): boolean {
  if (!perfil || perfil.role !== "internal") return false;
  if (perfil.isAdmin) return true;
  const temGd = perfil.clientId === GD_DONO || (perfil.clientIds || []).includes(GD_DONO);
  if (!temGd) return false;
  if ((perfil.granularPermissions || []).includes(PERMISSAO_GD)) return true;
  return (perfil.internalPages || []).some((p) => PAGINAS_GD.includes(p));
}

// Atrasado primeiro, depois o prazo que vence antes, depois nome. Só usa o que a API mandou
// (atrasado e vence_em); prazo pendente ou sem prazo fica depois de todo prazo com data.
export function ordenarClientes(clientes: GdCliente[]): GdCliente[] {
  const venc = (c: GdCliente) => (c.prazo?.vence_em ? Date.parse(c.prazo.vence_em) : Number.POSITIVE_INFINITY);
  return [...clientes].sort((a, b) => {
    const atrasoA = a.prazo?.atrasado === true ? 0 : 1;
    const atrasoB = b.prazo?.atrasado === true ? 0 : 1;
    if (atrasoA !== atrasoB) return atrasoA - atrasoB;
    const va = venc(a);
    const vb = venc(b);
    if (va !== vb) return va < vb ? -1 : 1;
    return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
  });
}

const DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
});
const DATA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });

export const formatarDataHora = (iso: string) => DATA_HORA.format(new Date(iso)).replace(",", "");
export const formatarData = (iso: string) => DATA.format(new Date(iso));

// Recebe SÓ o objeto prazo da API. Não tem acesso a estado_desde nem a prazo_horas do estado, então
// não tem como inventar data: onde a API devolve vence_em null, sai a regra em texto.
export function textoDoPrazo(prazo: GdPrazo | null): { texto: string; atrasado: boolean } {
  if (!prazo) return { texto: "—", atrasado: false };
  if (prazo.regra === "horas_corridas" && prazo.calculo === "ok" && prazo.vence_em) {
    return { texto: `vence ${formatarDataHora(prazo.vence_em)}`, atrasado: prazo.atrasado === true };
  }
  if (prazo.regra === "horas_uteis") {
    return { texto: `${prazo.horas ?? "?"} h úteis, cálculo pendente`, atrasado: false };
  }
  if (prazo.regra === "fim_do_dia_util") return { texto: "vence no fim do dia útil", atrasado: false };
  return { texto: "sem prazo", atrasado: false };
}

// "Há quanto tempo está no estado". Data estimada não vira contagem: a importação inicial sabe o
// estado, não quando o cliente entrou nele.
export function textoDesde(cliente: Pick<GdCliente, "estado_desde" | "aproximado">, agora: Date = new Date()): string {
  if (!cliente.estado_desde) return "—";
  if (cliente.aproximado) return `desde ${formatarData(cliente.estado_desde)} (estimada)`;
  const dias = Math.floor((agora.getTime() - Date.parse(cliente.estado_desde)) / 86_400_000);
  if (dias <= 0) return "hoje";
  return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
}

export const linkWhatsApp = (telefone: string) => `https://wa.me/${telefone.replace(/\D/g, "")}`;

export function rotuloDoAtor(ev: Pick<GdEvento, "ator_tipo" | "ator_id">): string {
  // Sem nome: a lista de usuários (/api/admin/users) exige a página "usuarios", que a equipe da GD
  // não tem. Decisão do dono (03/11/2026): uid curto, sem rota nova.
  if (ev.ator_tipo === "humano") return `humano · ${ev.ator_id.slice(0, 8)}`;
  return `${ev.ator_tipo} · ${ev.ator_id}`;
}
