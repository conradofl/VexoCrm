// Trilha do cliente GD (03/11/2026): o caminho inteiro desenhado, com a posição atual marcada. Regra
// pura, sem React. Decisões do dono:
// - etapa da linha = gd_estados com fase diferente de fora_da_linha, em ordem; aparecem SEMPRE;
// - concluída só com evento. Sem evento antes da posição é tracejada: "antes do acompanhamento"
//   quando fica antes do primeiro evento do cliente, "não registrada" quando é buraco no meio;
// - PAUSADO/ENCERRADO ficam fora da linha: a posição vira a última etapa da linha com evento;
// - acao_do_cliente ausente (migration que não rodou) = nenhuma etapa é ação do cliente.
import type { GdEstado, GdEvento } from "@/lib/gdClientes";

export type Situacao = "concluida" | "atual" | "pulada" | "antes" | "futura";

// O que o portal pode receber. Nada de ator, uid, motivo, origem, rótulo interno ou código: o código
// AGUARDANDO_ASSINATURA_CAIO já carrega um nome de dentro da agência.
export interface EtapaPortal {
  rotulo: string;
  fase: string | null;
  situacao: Situacao;
  data: string | null;
  aproximado: boolean;
  acaoDoCliente: boolean;
  parada: boolean;
}

export interface EtapaInterna extends EtapaPortal {
  codigo: string;
  evento: GdEvento | null;
}

export interface Trilha<E> {
  etapas: E[];
  // Estado fora da linha (PAUSADO, ENCERRADO) quando é o atual.
  fora: { rotulo: string; desde: string | null; terminal: boolean } | null;
  atual: E | null;
}

export type EventoMinimo = Pick<GdEvento, "estado" | "ocorrido_em" | "data_estimada">;

const FASES_PORTAL: Record<string, string> = {
  comercial: "Proposta e contrato",
  entrada: "Montagem",
  estrategia: "Estratégia",
  regime: "Rodando",
};

const DATA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
export const dataCurta = (iso: string) => DATA.format(new Date(iso));

// Núcleo comum aos dois modos: só usa estado, data e data_estimada de cada evento.
function calcular<E extends EventoMinimo>(estados: GdEstado[], eventos: E[], estadoAtual: string | null) {
  const linha = estados.filter((e) => e.fase !== "fora_da_linha").sort((a, b) => a.ordem - b.ordem);
  const indice = new Map(linha.map((e, i) => [e.codigo, i]));
  // A API manda em ordem de ocorrido_em; o último de cada etapa vale.
  const ultimo = new Map<string, E>();
  for (const ev of eventos) ultimo.set(ev.estado, ev);
  const daLinha = eventos.filter((ev) => indice.has(ev.estado));
  const primeiro = daLinha.length ? indice.get(daLinha[0].estado)! : -1;

  const estadoFora = estadoAtual && !indice.has(estadoAtual) ? estados.find((e) => e.codigo === estadoAtual) ?? null : null;
  let posicao = -1;
  if (estadoAtual && indice.has(estadoAtual)) posicao = indice.get(estadoAtual)!;
  // Pausado/encerrado: onde o cliente estava, ou seja, a etapa do último evento da linha.
  else if (estadoAtual && daLinha.length) posicao = indice.get(daLinha[daLinha.length - 1].estado)!;

  const etapas = linha.map((estado, i) => {
    const evento = ultimo.get(estado.codigo) ?? null;
    let situacao: Situacao;
    if (i === posicao) situacao = "atual";
    else if (i > posicao) situacao = "futura";
    else if (evento) situacao = "concluida";
    else situacao = i < primeiro ? "antes" : "pulada";
    const comData = situacao === "concluida" || situacao === "atual";
    return {
      estado,
      evento: comData ? evento : null,
      situacao,
      data: comData && evento ? evento.ocorrido_em : null,
      aproximado: comData && evento ? evento.data_estimada : false,
      acaoDoCliente: situacao === "atual" && !estadoFora && estado.acao_do_cliente === true,
      parada: situacao === "atual" && Boolean(estadoFora),
    };
  });
  const desdeFora = estadoFora ? ultimo.get(estadoFora.codigo)?.ocorrido_em ?? null : null;
  return { etapas, estadoFora, desdeFora, posicao };
}

// Rótulo do portal vazio não pode cair no código nem no nome interno: vira "Etapa N".
// N é a posição na linha que a rota entrega (estados ativos, sem fora_da_linha): anda se um estado da linha for desativado.
function rotuloPortal(estado: GdEstado, i: number) {
  const r = typeof estado.rotulo_portal === "string" ? estado.rotulo_portal.trim() : "";
  return r || `Etapa ${i + 1}`;
}

export function trilhaPortal(estados: GdEstado[], eventos: EventoMinimo[], estadoAtual: string | null): Trilha<EtapaPortal> {
  // O portal só recebe estado, data e data_estimada, nem que alguém passe o evento inteiro.
  const minimos = eventos.map(({ estado, ocorrido_em, data_estimada }) => ({ estado, ocorrido_em, data_estimada }));
  const { etapas, estadoFora, desdeFora, posicao } = calcular(estados, minimos, estadoAtual);
  const saida = etapas.map(({ estado, situacao, data, aproximado, acaoDoCliente, parada }, i): EtapaPortal => ({
    rotulo: rotuloPortal(estado, i),
    fase: FASES_PORTAL[estado.fase] ?? null,
    situacao, data, aproximado, acaoDoCliente, parada,
  }));
  return {
    etapas: saida,
    fora: estadoFora ? { rotulo: estadoFora.rotulo_portal?.trim() || (estadoFora.terminal ? "Atendimento encerrado" : "Atendimento pausado"), desde: desdeFora, terminal: estadoFora.terminal } : null,
    atual: posicao >= 0 ? saida[posicao] : null,
  };
}

export function trilhaInterna(estados: GdEstado[], eventos: GdEvento[], estadoAtual: string | null): Trilha<EtapaInterna> {
  const { etapas, estadoFora, desdeFora, posicao } = calcular(estados, eventos, estadoAtual);
  const saida = etapas.map(({ estado, evento, situacao, data, aproximado, acaoDoCliente, parada }): EtapaInterna => ({
    codigo: estado.codigo,
    rotulo: estado.rotulo_interno,
    fase: estado.fase,
    evento, situacao, data, aproximado, acaoDoCliente, parada,
  }));
  return {
    etapas: saida,
    fora: estadoFora ? { rotulo: estadoFora.rotulo_interno, desde: desdeFora, terminal: estadoFora.terminal } : null,
    atual: posicao >= 0 ? saida[posicao] : null,
  };
}
