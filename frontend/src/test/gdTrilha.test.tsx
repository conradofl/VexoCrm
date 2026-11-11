// frontend/src/test/gdTrilha.test.tsx
//
// Trilha do cliente GD (03/11/2026). Componente real com os 18 estados como a API manda depois da migration
// 20261103180000. O que este arquivo prova é estrutura (situação de cada etapa, o que o HTML contém); jsdom não tem
// layout nem avalia media query. Posição na janela e animação desligada por prefers-reduced-motion foram medidas num
// Chromium real (Playwright), não aqui.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { TrilhaGd } from "@/components/TrilhaGd";
import type { GdEstado, GdEvento } from "@/lib/gdClientes";

type Linha = [codigo: string, ordem: number, fase: string, interno: string, portal: string, acao?: boolean];
const LINHAS: Linha[] = [
  ["PROPOSTA_ENVIADA", 10, "comercial", "Proposta enviada", "Proposta enviada"],
  ["PROPOSTA_ACEITA", 20, "comercial", "Proposta aceita, gerar contrato", "Proposta aceita"],
  ["CONTRATO_EM_REVISAO", 30, "comercial", "Contrato no jurídico", "Contrato em preparação"],
  ["AGUARDANDO_ASSINATURA_CAIO", 40, "comercial", "Aguardando assinatura do Caio", "Aguardando nossa assinatura"],
  ["AGUARDANDO_ASSINATURA_CLIENTE", 50, "comercial", "Aguardando assinatura do cliente", "Aguardando sua assinatura", true],
  ["ASSINADO", 60, "entrada", "Assinado, criar pastas e grupos", "Contrato assinado"],
  ["GRUPOS_CRIADOS", 70, "entrada", "Grupos criados, agendar briefing", "Equipe montada"],
  ["BRIEFING_AGENDADO", 80, "entrada", "Briefing agendado", "Briefing agendado"],
  ["BRIEFING_REALIZADO", 90, "estrategia", "Reunião feita, gerar briefing", "Briefing em elaboração"],
  ["BRIEFING_APROVACAO_INTERNA", 100, "estrategia", "Briefing com o Caio", "Briefing em revisão"],
  ["BRIEFING_APROVACAO_CLIENTE", 110, "estrategia", "Briefing com o cliente", "Briefing para sua aprovação", true],
  ["IDENTIDADE_VISUAL", 120, "estrategia", "Identidade visual", "Identidade visual"],
  ["ROTEIRO", 130, "estrategia", "Roteiro (aprovação interna)", "Roteiro em produção"],
  ["PLANEJAMENTO_APROVACAO", 140, "estrategia", "Planejamento para aprovar", "Planejamento para sua aprovação", true],
  ["ESTRATEGIA_APROVADA", 150, "regime", "Estratégia aprovada", "Estratégia aprovada"],
  ["ATIVO", 160, "regime", "Cliente ativo", "Tudo rodando"],
  ["PAUSADO", 900, "fora_da_linha", "Pausado", "Atendimento pausado"],
  ["ENCERRADO", 990, "fora_da_linha", "Encerrado", "Atendimento encerrado"],
];
const ESTADOS: GdEstado[] = LINHAS.map(([codigo, ordem, fase, rotulo_interno, rotulo_portal, acao]) => ({
  codigo, ordem, fase, rotulo_interno, rotulo_portal, prazo_contagem: "horas_corridas", prazo_horas: null,
  terminal: codigo === "ENCERRADO", acao_do_cliente: acao === true,
}));

let seq = 0;
function ev(estado: string, dia: number, extra: Partial<GdEvento> = {}): GdEvento {
  seq += 1;
  const ocorrido = `2026-10-${String(dia).padStart(2, "0")}T15:00:00Z`;
  return {
    id: `ev-${seq}`, estado, estado_anterior: null, rotulo_interno: LINHAS.find((l) => l[0] === estado)![3],
    ocorrido_em: ocorrido, registrado_em: ocorrido, data_estimada: false, origem: "fluxo", ator_tipo: "humano",
    ator_id: "uidHumano123", motivo: null, ...extra,
  };
}

function montar(modo: "interno" | "portal", eventos: GdEvento[], estadoAtual: string | null, estados = ESTADOS) {
  const { container } = render(<TrilhaGd modo={modo} estados={estados} eventos={eventos} estadoAtual={estadoAtual} />);
  const etapa = (rotulo: string) => {
    const li = [...container.querySelectorAll("li")].find((l) => l.querySelector("[data-rotulo]")?.textContent === rotulo);
    if (!li) throw new Error(`etapa ${rotulo} não encontrada`);
    return li;
  };
  return { container, etapa, aviso: container.querySelector("[data-aviso]")! };
}

const ponto = (li: Element) => li.querySelector("[data-ponto]")!.className.split(/\s+/);

beforeEach(() => {
  seq = 0;
});

describe("trilha: as 16 etapas", () => {
  it("aparecem sempre, mesmo as que ainda não chegaram, e PAUSADO/ENCERRADO ficam fora", () => {
    const { container } = montar("portal", [ev("PROPOSTA_ENVIADA", 1)], "PROPOSTA_ENVIADA");
    expect(container.querySelectorAll("li")).toHaveLength(16);
    expect(container.innerHTML).not.toContain("Atendimento pausado");
    expect(container.querySelectorAll('[data-situacao="futura"]')).toHaveLength(15);
  });
});

describe("pulada nunca vira concluída", () => {
  // Cliente que assinou em cartório e pulou o jurídico e as assinaturas.
  const cartorio = () => [
    ev("PROPOSTA_ENVIADA", 20), ev("PROPOSTA_ACEITA", 22), ev("ASSINADO", 29), ev("GRUPOS_CRIADOS", 30), ev("BRIEFING_AGENDADO", 31),
  ];

  it.each(["portal", "interno"] as const)("buraco no meio aparece tracejado, 'não registrada', sem data (%s)", (modo) => {
    const { etapa } = montar(modo, cartorio(), "BRIEFING_AGENDADO");
    const nomes = modo === "portal"
      ? ["Contrato em preparação", "Aguardando nossa assinatura", "Aguardando sua assinatura"]
      : ["Contrato no jurídico", "Aguardando assinatura do Caio", "Aguardando assinatura do cliente"];
    for (const nome of nomes) {
      const li = etapa(nome);
      expect(li.dataset.situacao).toBe("pulada");
      expect(li.querySelector("[data-tag]")).toHaveTextContent("não registrada");
      expect(ponto(li)).toContain("border-dashed");
      expect(ponto(li)).not.toContain("bg-primary");
      expect(li.textContent).not.toMatch(/\d{2}\/\d{2}/);
    }
    const assinado = etapa(modo === "portal" ? "Contrato assinado" : "Assinado, criar pastas e grupos");
    expect(assinado.dataset.situacao).toBe("concluida");
    expect(ponto(assinado)).toContain("bg-primary");
  });

  it("cliente importado: as 15 anteriores ao primeiro evento são 'antes do acompanhamento', nenhuma 'não registrada'", () => {
    const { container, etapa } = montar("portal", [ev("ATIVO", 3, { data_estimada: true, origem: "importacao_inicial" })], "ATIVO");
    expect(container.querySelectorAll('[data-situacao="antes"]')).toHaveLength(15);
    expect(container.querySelectorAll('[data-situacao="concluida"]')).toHaveLength(0);
    expect(container.innerHTML).not.toContain("não registrada");
    expect(etapa("Proposta enviada").querySelector("[data-tag]")).toHaveTextContent("antes do acompanhamento");
    expect(ponto(etapa("Proposta enviada"))).toContain("border-dashed");
    expect(etapa("Tudo rodando")).toHaveTextContent("03/10/2026 · aproximado");
  });

  // Pedido do dono depois da captura de produção (03/11/2026): 15 etiquetas iguais dominavam a tela.
  it("'antes do acompanhamento' aparece uma vez, na primeira da sequência; as outras seguem tracejadas e sem etiqueta", () => {
    const { container, etapa } = montar("portal", [ev("ATIVO", 3, { data_estimada: true })], "ATIVO");
    const etiquetas = [...container.querySelectorAll("[data-tag]")].filter((t) => t.textContent === "antes do acompanhamento");
    expect(etiquetas).toHaveLength(1);
    expect(etiquetas[0].closest("li")).toBe(etapa("Proposta enviada"));
    for (const nome of ["Proposta aceita", "Contrato assinado", "Estratégia aprovada"]) {
      const li = etapa(nome);
      expect(li.dataset.situacao).toBe("antes");
      expect(ponto(li)).toContain("border-dashed");
      expect(li.querySelector("[data-tag]")).toBeNull();
    }
  });

  it("cliente que entrou no meio: uma etiqueta 'antes' no começo, e cada buraco depois continua 'não registrada'", () => {
    const eventos = [ev("ASSINADO", 1), ev("BRIEFING_AGENDADO", 3)];
    const { container, etapa } = montar("portal", eventos, "BRIEFING_AGENDADO");
    const textos = [...container.querySelectorAll("[data-tag]")].map((t) => t.textContent);
    expect(textos.filter((t) => t === "antes do acompanhamento")).toHaveLength(1);
    expect(textos.filter((t) => t === "não registrada")).toHaveLength(1);
    expect(etapa("Equipe montada").querySelector("[data-tag]")).toHaveTextContent("não registrada");
  });
});

describe("modo portal não vaza", () => {
  // Cada valor é único e procurado no HTML inteiro, atributos incluídos.
  const SEGREDOS = ["MOTIVO-SECRETO-7731", "uid-SEGREDO-4412", "goclaw", "importacao_inicial", "correcao"];
  const eventos = () => [
    ev("PROPOSTA_ENVIADA", 1, { ator_tipo: "goclaw", ator_id: "uid-SEGREDO-4412", motivo: "MOTIVO-SECRETO-7731", origem: "importacao_inicial" }),
    ev("CONTRATO_EM_REVISAO", 3, { ator_tipo: "goclaw", ator_id: "uid-SEGREDO-4412", motivo: "MOTIVO-SECRETO-7731", origem: "correcao" }),
    ev("AGUARDANDO_ASSINATURA_CAIO", 4, { ator_tipo: "goclaw", ator_id: "uid-SEGREDO-4412", motivo: "MOTIVO-SECRETO-7731" }),
    ev("AGUARDANDO_ASSINATURA_CLIENTE", 5, { ator_tipo: "goclaw", ator_id: "uid-SEGREDO-4412", motivo: "MOTIVO-SECRETO-7731", data_estimada: true }),
  ];
  // Rótulo interno que difere do rótulo do portal, todos os códigos e os nomes de fase do banco.
  const INTERNOS = [
    ...LINHAS.filter(([, , , interno, portal]) => interno !== portal).map((l) => l[3]),
    ...LINHAS.map((l) => l[0]),
    "comercial", "estrategia", "regime", "fora_da_linha", "Caio", "jurídico",
  ];

  it("ator, uid, motivo, origem, rótulo interno e código não aparecem no HTML do portal", () => {
    const { container } = montar("portal", eventos(), "AGUARDANDO_ASSINATURA_CLIENTE");
    const html = container.innerHTML;
    for (const s of [...SEGREDOS, ...INTERNOS]) expect(html, `vazou: ${s}`).not.toContain(s);
    expect(html).not.toMatch(/estimad/i);
    // O que pode aparecer, aparece.
    expect(html).toContain("Aguardando nossa assinatura");
    expect(html).toContain("aproximado");
  });

  it("o mesmo cliente no modo interno mostra o que o portal esconde (o teste acima não passa por acaso)", () => {
    const html = montar("interno", eventos(), "AGUARDANDO_ASSINATURA_CLIENTE").container.innerHTML;
    expect(html).toContain("MOTIVO-SECRETO-7731");
    expect(html).toContain("uid-SEGREDO-4412");
    expect(html).toContain("Aguardando assinatura do Caio");
  });

  it("rótulo do portal vazio vira 'Etapa N', nunca o código nem o nome interno", () => {
    const estados = ESTADOS.map((e) => (e.codigo === "AGUARDANDO_ASSINATURA_CAIO" ? { ...e, rotulo_portal: "" } : e.codigo === "ROTEIRO" ? { ...e, rotulo_portal: null } : e));
    const { container } = montar("portal", [ev("ASSINADO", 2)], "ASSINADO", estados);
    expect(container.innerHTML).toContain("Etapa 4");
    expect(container.innerHTML).toContain("Etapa 13");
    for (const s of ["AGUARDANDO_ASSINATURA_CAIO", "Aguardando assinatura do Caio", "ROTEIRO", "Roteiro (aprovação interna)"]) {
      expect(container.innerHTML).not.toContain(s);
    }
  });

  it("fases no portal com nome amigável; no interno, o nome do banco", () => {
    const portal = montar("portal", [], null).container.innerHTML;
    for (const f of ["Proposta e contrato", "Montagem", "Estratégia", "Rodando"]) expect(portal).toContain(f);
    const interno = montar("interno", [], null).container.textContent;
    expect(interno).toContain("comercial");
  });
});

describe("pausado e encerrado", () => {
  const ate = (ultima: string) => {
    const lista: GdEvento[] = [];
    for (const [codigo] of LINHAS) {
      lista.push(ev(codigo, lista.length + 1));
      if (codigo === ultima) break;
    }
    return lista;
  };

  it("a pausa fica na última etapa com evento, não no fim da trilha, e o anel não pulsa", () => {
    const eventos = [...ate("IDENTIDADE_VISUAL"), ev("PAUSADO", 25, { motivo: "cliente pediu" })];
    const { container, etapa, aviso } = montar("portal", eventos, "PAUSADO");
    const atual = container.querySelector('[aria-current="step"]')!;
    expect(atual).toBe(etapa("Identidade visual"));
    expect(atual.querySelector("[data-tag]")).toHaveTextContent("pausado aqui");
    expect(etapa("Tudo rodando").dataset.situacao).toBe("futura");
    expect(etapa("Roteiro em produção").dataset.situacao).toBe("futura");
    expect(container.querySelector("[data-anel]")!.getAttribute("data-pulsando")).toBe("false");
    expect(container.querySelectorAll('[data-pulsando="true"]')).toHaveLength(0);
    expect(aviso).toHaveAttribute("data-aviso", "parada");
    expect(aviso).toHaveTextContent("Atendimento pausado desde 25/10/2026.");
    // Nada de promessa de que o cliente pediu.
    expect(aviso.textContent).not.toMatch(/sinal|retomamos/i);
  });

  it("pausa em etapa de ação do cliente: vence a pausa, sem cor de ação", () => {
    const { container, aviso } = montar("portal", [...ate("AGUARDANDO_ASSINATURA_CLIENTE"), ev("PAUSADO", 20)], "PAUSADO");
    expect(container.querySelector("[data-acao-do-cliente]")).toBeNull();
    expect(container.innerHTML).not.toContain("bg-warning");
    expect(aviso).toHaveAttribute("data-aviso", "parada");
  });

  it("encerrado marca 'encerrado aqui' na última etapa com evento", () => {
    const { container, aviso } = montar("portal", [...ate("ATIVO"), ev("ENCERRADO", 28)], "ENCERRADO");
    expect(container.querySelector('[aria-current="step"]')).toHaveTextContent("Tudo rodando");
    expect(container.querySelector('[aria-current="step"] [data-tag]')).toHaveTextContent("encerrado aqui");
    expect(aviso).toHaveTextContent("Atendimento encerrado desde 28/10/2026.");
  });
});

describe("etapa de ação do cliente", () => {
  it("quando é a atual: cor própria e aviso 'Agora é com você' (portal) / 'Esperando o cliente' (interno)", () => {
    const eventos = [ev("PROPOSTA_ENVIADA", 1), ev("PROPOSTA_ACEITA", 2), ev("CONTRATO_EM_REVISAO", 3), ev("AGUARDANDO_ASSINATURA_CAIO", 4), ev("AGUARDANDO_ASSINATURA_CLIENTE", 5)];
    const portal = montar("portal", eventos, "AGUARDANDO_ASSINATURA_CLIENTE");
    expect(portal.aviso).toHaveTextContent("Agora é com você: Aguardando sua assinatura.");
    expect(portal.aviso).toHaveAttribute("data-aviso", "acao");
    const li = portal.etapa("Aguardando sua assinatura");
    expect(ponto(li)).toContain("bg-warning");
    expect(ponto(li)).not.toContain("bg-primary");
    expect(li.querySelector("[data-tag]")).toHaveTextContent("com você");

    const interno = montar("interno", eventos, "AGUARDANDO_ASSINATURA_CLIENTE");
    expect(interno.aviso).toHaveTextContent("Esperando o cliente: Aguardando assinatura do cliente.");
  });

  it("só ela: as outras etapas de ação, já passadas, não ganham o tratamento", () => {
    const eventos = LINHAS.slice(0, 13).map(([codigo], i) => ev(codigo, i + 1));
    const { container, aviso } = montar("portal", eventos, "ROTEIRO");
    expect(container.querySelectorAll("[data-acao-do-cliente]")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("bg-warning");
    expect(aviso).toHaveAttribute("data-aviso", "normal");
    expect(aviso).toHaveTextContent("Agora: Roteiro em produção · desde 13/10/2026");
  });

  it("API sem acao_do_cliente (migration que não rodou): a trilha fica de pé, sem etapa de ação", () => {
    const semCampo = ESTADOS.map(({ acao_do_cliente: _ignorado, ...resto }) => resto);
    const { container, aviso } = montar("portal", [ev("AGUARDANDO_ASSINATURA_CLIENTE", 5)], "AGUARDANDO_ASSINATURA_CLIENTE", semCampo);
    expect(container.querySelectorAll("li")).toHaveLength(16);
    expect(container.querySelector("[data-acao-do-cliente]")).toBeNull();
    expect(aviso).toHaveTextContent("Agora: Aguardando sua assinatura");
  });
});

describe("anel, datas e movimento", () => {
  it.each([
    ["no começo", [ev("PROPOSTA_ENVIADA", 1)], "PROPOSTA_ENVIADA"],
    ["no meio", [ev("PROPOSTA_ENVIADA", 1), ev("ROTEIRO", 9)], "ROTEIRO"],
    ["no fim", [ev("ATIVO", 3)], "ATIVO"],
    ["na ação do cliente", [ev("BRIEFING_APROVACAO_CLIENTE", 3)], "BRIEFING_APROVACAO_CLIENTE"],
  ] as const)("existe exatamente um anel, e ele pulsa (%s)", (_n, eventos, atual) => {
    const { container } = montar("portal", [...eventos], atual);
    expect(container.querySelectorAll("[data-anel]")).toHaveLength(1);
    expect(container.querySelectorAll('[data-pulsando="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it("cliente sem estado: nenhuma etapa atual, nenhum anel", () => {
    const { container, aviso } = montar("portal", [], null);
    expect(container.querySelectorAll("[data-anel]")).toHaveLength(0);
    expect(aviso).toHaveTextContent("Nenhuma etapa registrada ainda.");
  });

  it("futura não mostra data, nem quando tem evento antigo (cliente que voltou etapa)", () => {
    const eventos = [ev("PROPOSTA_ENVIADA", 1), ev("ROTEIRO", 10), ev("BRIEFING_AGENDADO", 12, { motivo: "voltou" })];
    const { etapa } = montar("portal", eventos, "BRIEFING_AGENDADO");
    const roteiro = etapa("Roteiro em produção");
    expect(roteiro.dataset.situacao).toBe("futura");
    expect(roteiro.textContent).not.toContain("10/10/2026");
    expect(roteiro.textContent).not.toMatch(/\d{2}\/\d{2}/);
    for (const li of document.querySelectorAll('[data-situacao="futura"]')) expect(li.textContent).not.toMatch(/\d{2}\/\d{2}/);
  });

  // jsdom não avalia prefers-reduced-motion: aqui só dá para conferir que a animação está presa ao motion-safe (a
  // variante do Tailwind que só anima sem a preferência). Que ela de fato para foi medido no Chromium com
  // reducedMotion "reduce": getAnimations() do anel = 0, contra 1 sem a preferência.
  it("a animação do anel só existe sob motion-safe (DOM; a prova de tela é no Chromium)", () => {
    const { container } = montar("portal", [ev("PROPOSTA_ENVIADA", 1)], "PROPOSTA_ENVIADA");
    const classes = container.querySelector("[data-anel]")!.className.split(/\s+/);
    expect(classes).toContain("motion-safe:animate-ping");
    expect(classes).not.toContain("animate-ping");
  });

  it("ao montar, pede para rolar até a etapa atual (DOM; a medição na janela é no Chromium)", () => {
    const rolar = vi.fn();
    Element.prototype.scrollIntoView = rolar;
    try {
      const { container } = montar("portal", [ev("PROPOSTA_ENVIADA", 1), ev("ROTEIRO", 9)], "ROTEIRO");
      expect(rolar).toHaveBeenCalledWith({ block: "center" });
      expect(rolar.mock.contexts.at(-1)).toBe(container.querySelector('[aria-current="step"]'));
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
