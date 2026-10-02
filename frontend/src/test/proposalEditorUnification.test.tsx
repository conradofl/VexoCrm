// frontend/src/test/proposalEditorUnification.test.tsx
//
// "Nova Proposta" abre o MESMO editor de "Editar Proposta". Estes testes percorrem o caminho inteiro,
// criando do zero pela tela: preencher → salvar → a proposta já nasce com tudo → reabrir em edição
// mostrando exatamente o que foi escolhido. O backend simulado só grava os campos que o backend
// real grava (shared/proposalEditorFields.json), então campo que "persistisse por acaso" não passa.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createGdBackend } from "./helpers/gdProposalsBackend";
import { TODAS_FORMAS } from "../lib/geracaoDigital/formasPagamento";
import {
  buildProposalBody,
  dataLocalDoInstante,
  emptyProposalEditorValues,
  proposalEditorValuesFromProposal,
  PROPOSTA_BASE_VAZIA,
  totaisAoVivoDoPlano,
  validateProposalEditor,
} from "../lib/geracaoDigital/proposalEditorModel";
import { calculateProposalValues } from "../lib/geracaoDigital/proposalCalculator";
import { planoVazio } from "../lib/geracaoDigital/plano";
import EDITOR_FIELDS from "../../../shared/proposalEditorFields.json";

let backend = createGdBackend();
let locationSearch = "";
const editorRenders: string[] = [];

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    getIdToken: async () => "token",
    isAuthenticated: true,
    clientId: "tenant-x",
    accessProfile: { role: "client" },
  }),
}));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useNavigate: () => vi.fn(), useLocation: () => ({ pathname: "/propostas-gd", search: locationSearch }) };
});
vi.mock("@/lib/api", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, fetchApi: (...args: any[]) => (backend.fetchApi as any)(...args) };
});
// Espia o ProposalEditor SEM trocá-lo: cada render registra o modo e delega ao componente real.
vi.mock("@/components/geracaoDigital/ProposalEditor", async (importOriginal) => {
  const actual: any = await importOriginal();
  const Spy = (props: any) => {
    editorRenders.push(props.mode);
    return React.createElement(actual.ProposalEditor, props);
  };
  return { ...actual, ProposalEditor: Spy, default: Spy };
});

const SAVED = {
  id: "p1",
  prospect_name: "Cliente Existente",
  itens: [],
  condicoes: "",
  status: "rascunho",
  created_at: "2026-10-01T10:00:00Z",
  owner_company: "geracao-digital",
};

function renderPage(Page: React.ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>
  );
}

async function openPage(seedProposals: any[] = [SAVED], opts: { vexo?: boolean } = {}) {
  backend = createGdBackend({ proposals: seedProposals });
  const { default: Page } = await import("../pages/GeracaoDigitalProposals");
  const Configured = () => <Page isVexoCommercial={opts.vexo === true} />;
  renderPage(Configured);
}

const clickNova = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /Nova Proposta/ }));
  await screen.findByTestId("proposal-editor");
};

const typeInto = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const prazoRow = (label: string) => screen.getByText(label, { selector: "span" }).parentElement as HTMLElement;
const numberInputs = (row: HTMLElement) => Array.from(row.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
const descontoSetupInput = () => screen.getByText("Desconto no Setup (%)").parentElement!.querySelector("input") as HTMLInputElement;
const setupInput = () => screen.getByPlaceholderText("Ex: 1000") as HTMLInputElement;
const forma = (label: string, nth = 0) => screen.getAllByLabelText(label)[nth] as HTMLInputElement;

// Preenche o mínimo para criar: nome, escopo e o preço de um prazo.
async function preencherBasico(nome = "Cliente Beta", precoMensal = 1000) {
  typeInto(screen.getByLabelText(/Nome da empresa/), nome);
  fireEvent.click(await screen.findByRole("button", { name: "Tráfego Pago" }));
  typeInto(numberInputs(prazoRow("Mensal"))[0], String(precoMensal));
}

async function criar() {
  fireEvent.click(screen.getByRole("button", { name: "Criar Proposta" }));
  await waitFor(() => expect(backend.saves().filter((c) => c.method === "PUT")).toHaveLength(1));
  await waitFor(() => expect(screen.queryByTestId("proposal-editor")).toBeNull()); // fechou o modo "nova"
}

const ultimoPut = () => backend.saves().filter((c) => c.method === "PUT").at(-1)!;
const propostaGravada = () => backend.proposals.find((p) => p.prospect_name !== SAVED.prospect_name)!;

async function reabrirEmEdicao(nome: string) {
  await screen.findByRole("heading", { name: nome });
  fireEvent.click(await screen.findByRole("button", { name: /Editar Proposta/ }));
  await screen.findByTestId("proposal-editor");
}

beforeEach(() => {
  editorRenders.length = 0;
  locationSearch = "";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => cleanup());

describe("Um formulário só", () => {
  it("[TESTE OBRIGATÓRIO] criar e editar renderizam o MESMO componente (não parecidos: o mesmo)", async () => {
    await openPage();

    await clickNova();
    const criando = screen.getByTestId("proposal-editor");
    expect(criando).toHaveAttribute("data-mode", "new");
    expect(editorRenders).toContain("new");

    // volta e abre a proposta existente em edição
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByTestId("proposal-editor")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: /Editar Proposta/ }));
    const editando = await screen.findByTestId("proposal-editor");

    expect(editando).toHaveAttribute("data-mode", "edit");
    expect(editorRenders).toContain("edit");
    // o mesmo componente (o espião é montado uma vez por modo e delega ao mesmo ProposalEditor)
    expect(new Set(editorRenders)).toEqual(new Set(["new", "edit"]));
    // e é o mesmo formulário: os mesmos campos nos dois modos
    for (const rotulo of [/Nome da empresa/, /Segmento/, /Validade da proposta/, /Link de checkout/, /Carência do 1º vencimento/, /Mensalidade negociada/]) {
      expect(within(editando).getByLabelText(rotulo)).toBeInTheDocument();
    }
    expect(within(editando).getByText("Desconto no Setup (%)")).toBeInTheDocument();
    expect(within(editando).getByText("Formas de pagamento a ofertar")).toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] o assistente antigo não existe mais — nem o componente nem o hook", async () => {
    // import.meta.glob lista só os arquivos que EXISTEM (um import() literal de arquivo apagado nem compila)
    expect(Object.keys(import.meta.glob("../components/geracaoDigital/ProposalWizard.*"))).toEqual([]);
    expect(Object.keys(import.meta.glob("../hooks/useProposalWizard.*"))).toEqual([]);
    // e o formulário único existe, no lugar
    expect(Object.keys(import.meta.glob("../components/geracaoDigital/ProposalEditor.tsx"))).toHaveLength(1);
  });

  it("sem nenhuma proposta ainda, 'Nova Proposta' também abre o mesmo editor", async () => {
    await openPage([]);

    fireEvent.click(await screen.findByRole("button", { name: /Nova Proposta/ }));

    expect(await screen.findByTestId("proposal-editor")).toHaveAttribute("data-mode", "new");
  });

  it("abre com os campos VAZIOS (nada herdado da proposta que estava selecionada)", async () => {
    await openPage([{ ...SAVED, prospect_name: "Outra Empresa", condicoes_especiais: "Texto de outro", carencia_dias: 20, valor_setup_vexo: 3000, desconto_setup_pct: 100 }]);
    await screen.findByRole("heading", { name: "Outra Empresa" });

    await clickNova();

    expect((screen.getByLabelText(/Nome da empresa/) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Carência do 1º vencimento") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Validade da proposta") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/Link de checkout/) as HTMLInputElement).value).toBe("");
    expect(setupInput().value).toBe("0"); // o campo de setup do PlanoEditor mostra 0 quando vazio (não os 3000 da outra)
    expect(descontoSetupInput().value).toBe("0");
    expect((screen.getByPlaceholderText(/Pix à vista para o projeto pontual/) as HTMLTextAreaElement).value).toBe("");
  });

  it("'?nome=' na URL abre o formulário novo com o nome preenchido (atalho das Conversas)", async () => {
    locationSearch = "?nome=Lead%20da%20Conversa&phone=5511999999999";
    await openPage();

    await screen.findByTestId("proposal-editor");

    expect((screen.getByLabelText(/Nome da empresa/) as HTMLInputElement).value).toBe("Lead da Conversa");
  });
});

describe("Primeiro salvamento: tudo que foi escolhido na criação já nasce gravado", () => {
  it("[TESTE OBRIGATÓRIO] desconto na mensalidade escolhido na criação persiste no primeiro salvamento", async () => {
    await openPage();
    await clickNova();
    await preencherBasico("Cliente Beta", 1000);
    typeInto(numberInputs(prazoRow("Mensal"))[1], "15"); // Desc: 15 %

    await criar();

    const put = ultimoPut().body;
    expect(put.descontos_por_periodo).toEqual({ mensal: 15, trimestral: 0, semestral: 0, anual: 0 });
    expect(put.desconto_mensal_pct).toBe(15);
    const gravada = propostaGravada();
    expect(gravada.descontos_por_periodo.mensal).toBe(15);
    expect(gravada.desconto_mensal_pct).toBe(15);
    // exatamente um POST (cria a linha) e um PUT (grava tudo): nada a preencher depois
    expect(backend.saves().map((c) => c.method)).toEqual(["POST", "PUT"]);
  });

  it("[TESTE OBRIGATÓRIO] isenção de setup escolhida na criação persiste no primeiro salvamento", async () => {
    await openPage();
    await clickNova();
    await preencherBasico();
    typeInto(setupInput(), "3000");
    typeInto(descontoSetupInput(), "100"); // setup isento

    await criar();

    const gravada = propostaGravada();
    expect(gravada.valor_setup_vexo).toBe(3000); // o valor fica, para exibir "R$ 3.000 riscado — Isento"
    expect(gravada.cobrar_setup).toBe(true);
    expect(gravada.desconto_setup_pct).toBe(100);
  });

  it("[TESTE OBRIGATÓRIO] desconto na mensalidade E setup isento, juntos, no mesmo primeiro salvamento", async () => {
    await openPage();
    await clickNova();
    await preencherBasico("Cliente Gama", 2000);
    typeInto(numberInputs(prazoRow("Mensal"))[1], "20");
    typeInto(setupInput(), "4000");
    typeInto(descontoSetupInput(), "100");

    await criar();

    const gravada = propostaGravada();
    expect(gravada).toMatchObject({ desconto_mensal_pct: 20, desconto_setup_pct: 100, valor_setup_vexo: 4000, cobrar_setup: true });
  });

  it("[TESTE OBRIGATÓRIO] carência, validade e link de pagamento escolhidos na criação também persistem", async () => {
    await openPage();
    await clickNova();
    await preencherBasico();
    typeInto(screen.getByLabelText("Carência do 1º vencimento"), "20");
    typeInto(screen.getByLabelText("Validade da proposta"), "2026-12-31");
    typeInto(screen.getByLabelText(/Link de checkout/), "https://pay.exemplo/xyz");

    await criar();

    const gravada = propostaGravada();
    expect(gravada.carencia_dias).toBe(20);
    expect(gravada.payment_link).toBe("https://pay.exemplo/xyz");
    expect(dataLocalDoInstante(gravada.validade_ate)).toBe("2026-12-31");
  });

  it("mensalidade negociada (R$) escolhida na criação persiste no item do pacote", async () => {
    await openPage();
    await clickNova();
    await preencherBasico("Cliente Delta", 1000);
    typeInto(screen.getByLabelText(/Mensalidade negociada/), "850");

    await criar();

    const pacote = propostaGravada().itens.find((i: any) => String(i.descricao).startsWith("Pacote:"));
    expect(pacote).toMatchObject({ valor: 850, valor_override: true });
  });

  it("nome, escopo, preços por prazo e segmento persistem", async () => {
    await openPage();
    await clickNova();
    typeInto(screen.getByLabelText(/Nome da empresa/), "Cliente Épsilon");
    fireEvent.click(await screen.findByRole("button", { name: "Tráfego Pago" }));
    fireEvent.click(screen.getByRole("button", { name: "Social Media" }));
    typeInto(numberInputs(prazoRow("Mensal"))[0], "1000");
    typeInto(numberInputs(prazoRow("Anual"))[0], "800");
    typeInto(screen.getByLabelText(/Segmento \(roteiro/), "turismo");

    await criar();

    const gravada = propostaGravada();
    expect(gravada.segment_id).toBe("turismo");
    expect(gravada.pacotes_ofertados).toHaveLength(2); // mensal + anual
    const linhas = backend.packages.filter((p) => gravada.pacotes_ofertados.includes(p.id));
    expect(linhas.map((p) => [p.periodo, p.valor]).sort()).toEqual([["anual", 9600], ["mensal", 1000]]);
    expect(linhas[0].produtos_incluidos.map((p: any) => p.nome).sort()).toEqual(["Social Media", "Tráfego Pago"]);
  });
});

describe("Cada condição de pagamento que o editor oferece persiste na criação", () => {
  const casos = TODAS_FORMAS.map((def, i) => ({
    def,
    // "Parcelado no Cartão" existe nas duas seções (setup e mensalidade): a ordem na tela desempata
    nth: TODAS_FORMAS.filter((d, j) => j < i && d.label === def.label).length,
  }));

  it.each(casos)("[TESTE OBRIGATÓRIO] $def.id ($def.label)", async ({ def, nth }) => {
    await openPage();
    await clickNova();
    await preencherBasico();

    fireEvent.click(forma(def.label, nth));
    await criar();

    const ofertadas = propostaGravada().condicoes_pagamento.ofertadas;
    expect(ofertadas.map((t: any) => t.id)).toEqual([def.id]);
    expect(ofertadas[0].aplica_a).toBe(def.aplica_a);
    if (def.parcelavel) expect(ofertadas[0].config.num_parcelas).toBeGreaterThanOrEqual(1);
  });

  it("parcelas ajustadas na criação persistem (cartão parcelado do setup e da mensalidade)", async () => {
    await openPage();
    await clickNova();
    await preencherBasico();
    fireEvent.click(forma("Parcelado no Cartão", 0)); // setup (padrão 3x)
    fireEvent.click(screen.getAllByLabelText("Mais uma parcela")[0]); // 4x
    fireEvent.click(forma("Parcelado no Cartão", 1)); // mensalidade (padrão = meses do prazo)
    fireEvent.click(screen.getAllByLabelText("Mais uma parcela")[1]);

    await criar();

    const porId = Object.fromEntries(propostaGravada().condicoes_pagamento.ofertadas.map((t: any) => [t.id, t.config.num_parcelas]));
    expect(porId).toEqual({ cartao_parcelado: 4, cartao_parcelado_periodo: 2 });
  });

  it("todas as formas marcadas juntas persistem, na ordem do editor", async () => {
    await openPage();
    await clickNova();
    await preencherBasico();
    casos.forEach(({ def, nth }) => fireEvent.click(forma(def.label, nth)));

    await criar();

    expect(propostaGravada().condicoes_pagamento.ofertadas.map((t: any) => t.id)).toEqual(TODAS_FORMAS.map((d) => d.id));
  });

  it("condição especial em texto e 'ocultar valores' persistem", async () => {
    await openPage();
    await clickNova();
    await preencherBasico();
    typeInto(screen.getByPlaceholderText(/Pix à vista para o projeto pontual/), "Saldo em 2x no boleto");
    fireEvent.click(screen.getByLabelText(/Condições especiais \(ocultar valores/));

    await criar();

    expect(propostaGravada()).toMatchObject({ condicoes_especiais: "Saldo em 2x no boleto", esconder_valores: true });
  });
});

describe("Dono da proposta (Geração Digital × Comercial Vexo)", () => {
  it("[TESTE OBRIGATÓRIO] criar na Geração Digital: o POST e o PUT levam 'geracao-digital'", async () => {
    await openPage();
    await clickNova();
    await preencherBasico();

    await criar();

    const [post, put] = backend.saves();
    expect(post.body).toEqual({ client_id: "tenant-x", prospect_name: "Cliente Beta", owner_company: "geracao-digital" });
    expect(put.body.owner_company).toBe("geracao-digital");
  });

  it("[TESTE OBRIGATÓRIO] criar no Comercial Vexo: o POST e o PUT levam 'vexo' (o gate do servidor depende disso)", async () => {
    await openPage([], { vexo: true });
    fireEvent.click(await screen.findByRole("button", { name: /Nova Proposta Vexo OS/ }));
    await screen.findByTestId("proposal-editor");
    typeInto(screen.getByLabelText(/Nome da empresa/), "Cliente Vexo");
    fireEvent.click(await screen.findByRole("button", { name: /Plano Essencial Vexo OS/ }));
    typeInto(numberInputs(prazoRow("Mensal"))[0], "397");

    fireEvent.click(screen.getByRole("button", { name: "Criar Proposta" }));
    await waitFor(() => expect(backend.saves().filter((c) => c.method === "PUT")).toHaveLength(1));

    const [post, put] = backend.saves();
    expect(post.body.owner_company).toBe("vexo");
    expect(put.body.owner_company).toBe("vexo");
    expect(put.body.vexo_plan).toBe("essencial");
  });
});

describe("A proposta criada abre em edição com os mesmos valores", () => {
  it("[TESTE OBRIGATÓRIO] reabre mostrando exatamente o que foi escolhido, sem preencher de novo", async () => {
    await openPage();
    await clickNova();
    typeInto(screen.getByLabelText(/Nome da empresa/), "Cliente Zeta");
    fireEvent.click(await screen.findByRole("button", { name: "Tráfego Pago" }));
    typeInto(numberInputs(prazoRow("Mensal"))[0], "1500");
    typeInto(numberInputs(prazoRow("Mensal"))[1], "12");
    typeInto(setupInput(), "3000");
    typeInto(descontoSetupInput(), "100");
    typeInto(screen.getByLabelText("Carência do 1º vencimento"), "15");
    typeInto(screen.getByLabelText("Validade da proposta"), "2026-12-31");
    typeInto(screen.getByLabelText(/Link de checkout/), "https://pay.exemplo/zeta");
    typeInto(screen.getByLabelText(/Segmento \(roteiro/), "cafeteria");
    fireEvent.click(forma("Pix à vista"));
    fireEvent.click(forma("Cartão Recorrente (Sem comprometer limite)"));
    typeInto(screen.getByPlaceholderText(/Pix à vista para o projeto pontual/), "Condição combinada");

    await criar();
    await reabrirEmEdicao("Cliente Zeta");

    expect((screen.getByLabelText(/Nome da empresa/) as HTMLInputElement).value).toBe("Cliente Zeta");
    expect(numberInputs(prazoRow("Mensal"))[0].value).toBe("1500");
    expect(numberInputs(prazoRow("Mensal"))[1].value).toBe("12");
    expect(setupInput().value).toBe("3000");
    expect(descontoSetupInput().value).toBe("100");
    expect((screen.getByLabelText("Carência do 1º vencimento") as HTMLSelectElement).value).toBe("15");
    expect((screen.getByLabelText("Validade da proposta") as HTMLInputElement).value).toBe("2026-12-31");
    expect((screen.getByLabelText(/Link de checkout/) as HTMLInputElement).value).toBe("https://pay.exemplo/zeta");
    expect((screen.getByLabelText(/Segmento \(roteiro/) as HTMLSelectElement).value).toBe("cafeteria");
    expect(forma("Pix à vista").checked).toBe(true);
    expect(forma("Cartão Recorrente (Sem comprometer limite)").checked).toBe(true);
    expect(forma("Boleto Bancário Recorrente (Exclusivo PJ)").checked).toBe(false);
    expect((screen.getByPlaceholderText(/Pix à vista para o projeto pontual/) as HTMLTextAreaElement).value).toBe("Condição combinada");
    expect(screen.getByRole("button", { name: "Tráfego Pago" }).className).toContain("bg-purple-600"); // escopo marcado
  });

  it("[TESTE OBRIGATÓRIO] reabrir e salvar sem mexer não muda NADA do que foi gravado na criação", async () => {
    await openPage();
    await clickNova();
    await preencherBasico("Cliente Eta", 1000);
    typeInto(numberInputs(prazoRow("Mensal"))[1], "10");
    typeInto(setupInput(), "2500");
    typeInto(descontoSetupInput(), "100");
    typeInto(screen.getByLabelText("Validade da proposta"), "2026-12-31");
    fireEvent.click(forma("Pix à vista"));
    await criar();
    const aposCriar = JSON.parse(JSON.stringify(propostaGravada()));

    await reabrirEmEdicao("Cliente Eta");
    fireEvent.click(screen.getByRole("button", { name: "Salvar Configuração" }));
    await waitFor(() => expect(backend.saves().filter((c) => c.method === "PUT")).toHaveLength(2));

    const aposSalvar = JSON.parse(JSON.stringify(propostaGravada()));
    for (const campo of ["desconto_mensal_pct", "descontos_por_periodo", "desconto_setup_pct", "valor_setup_vexo", "cobrar_setup", "validade_ate", "condicoes_pagamento", "periodo_plano", "package_id", "pacotes_ofertados"]) {
      expect(aposSalvar[campo], campo).toEqual(aposCriar[campo]);
    }
  });

  it("a validade não anda um dia a cada salvamento (fatiar o ISO em UTC fazia isso no Brasil)", async () => {
    // Fixa o fuso do Brasil (UTC-3) para o teste valer em qualquer máquina, inclusive CI em UTC.
    const tzAntes = process.env.TZ;
    process.env.TZ = "America/Sao_Paulo";
    try {
      const fimDoDiaLocal = new Date(2026, 11, 31, 23, 59, 59).toISOString(); // 2027-01-01T02:59:59Z
      expect(fimDoDiaLocal.slice(0, 10)).toBe("2027-01-01"); // o ISO em UTC já é o dia seguinte
      await openPage([{ ...SAVED, validade_ate: fimDoDiaLocal }]);

      fireEvent.click(await screen.findByRole("button", { name: /Editar Proposta/ }));
      expect(((await screen.findByLabelText("Validade da proposta")) as HTMLInputElement).value).toBe("2026-12-31");
      fireEvent.click(screen.getByRole("button", { name: "Salvar Configuração" }));
      await waitFor(() => expect(backend.saves()).toHaveLength(1));

      expect(backend.saves()[0].body.validade_ate).toBe(fimDoDiaLocal);
    } finally {
      if (tzAntes === undefined) delete process.env.TZ;
      else process.env.TZ = tzAntes;
    }
  });
});

describe("Nada do assistente antigo sumiu", () => {
  // Lista congelada do corpo que o assistente enviava (useProposalWizard.handleCreateDirectProposal,
  // commit 85b37f0) e dos controles que ele mostrava. Cada item precisa existir no editor único.
  const CORPO_DO_ASSISTENTE = [
    "client_id", "prospect_name", "segment_id", "custom_segment_name", "prospect_logo", "package_id",
    "package_vexo_id", "pacotes_ofertados", "itens", "cobrar_setup", "valor_setup_vexo", "periodo_plano",
    "validade_ate", "payment_link", "carencia_dias", "valor_vp", "condicoes_pagamento", "owner_company",
    "condicoes_especiais", "esconder_valores",
  ];
  const CONTROLES_DO_ASSISTENTE: [string, RegExp | string][] = [
    ["nome do prospect", /Nome da empresa/],
    ["segmento", /Segmento \(roteiro/],
    ["logo do prospect", "Logo do cliente"],
    ["validade da proposta", "Validade da proposta"],
    ["carência do 1º vencimento", "Carência do 1º vencimento"],
    ["link de checkout / pagamento", /Link de checkout/],
    ["condições contratuais (texto)", "Condições Especiais Personalizadas (Opcional)"],
    ["esconder valores", /Condições especiais \(ocultar valores/],
  ];
  // Estados do assistente que nunca chegavam ao corpo (código morto): não há o que preservar.
  const MORTO_NO_ASSISTENTE = ["newPeriodo", "newVexoAvulsoIds", "newGdAvulsoIds", "editingProposalId"];

  it("[TESTE OBRIGATÓRIO] todo campo que o assistente enviava está no corpo que o editor único envia ao criar", async () => {
    await openPage();
    await clickNova();
    await preencherBasico();
    await criar();

    const corpo = Object.keys(ultimoPut().body);
    const faltando = CORPO_DO_ASSISTENTE.filter((k) => !corpo.includes(k));
    expect(faltando, `campos do assistente que o editor não envia: ${faltando.join(", ")}`).toEqual([]);
    expect(MORTO_NO_ASSISTENTE.length).toBe(4); // documentado: nunca iam no corpo
  });

  it("[TESTE OBRIGATÓRIO] todo controle que o assistente tinha existe no editor único", async () => {
    await openPage();
    await clickNova();

    const editor = screen.getByTestId("proposal-editor");
    const ausentes: string[] = [];
    for (const [nome, rotulo] of CONTROLES_DO_ASSISTENTE) {
      const achou = typeof rotulo === "string" ? within(editor).queryByText(rotulo) || within(editor).queryByLabelText(rotulo) : within(editor).queryByLabelText(rotulo);
      if (!achou) ausentes.push(nome);
    }
    // plano (escopo × prazos) e as oito formas de pagamento
    expect(within(editor).getByText("1. Escopo do plano")).toBeInTheDocument();
    expect(within(editor).getByText("2. Preço por prazo")).toBeInTheDocument();
    for (const def of TODAS_FORMAS) expect(within(editor).getAllByLabelText(def.label).length).toBeGreaterThan(0);
    expect(ausentes, `controles do assistente que sumiram: ${ausentes.join(", ")}`).toEqual([]);
  });

  it("o formulário só envia campos que o servidor grava (lista compartilhada com o backend)", async () => {
    await openPage();
    await clickNova();
    await preencherBasico();
    await criar();

    const permitidos = new Set([...(EDITOR_FIELDS as any).persisted.map((f: any) => f.field), ...(EDITOR_FIELDS as any).transient.map((f: any) => f.field)]);
    const estranhos = Object.keys(ultimoPut().body).filter((k) => !permitidos.has(k));
    expect(estranhos, `campos enviados que nenhuma coluna grava: ${estranhos.join(", ")}`).toEqual([]);
  });
});

describe("Mesma validação, criando ou editando", () => {
  it("[TESTE OBRIGATÓRIO] nome em branco é recusado ao criar e ao editar, sem chamar o servidor", async () => {
    await openPage();
    await clickNova();
    fireEvent.click(screen.getByRole("button", { name: "Criar Proposta" }));
    await waitFor(() => expect(screen.getByTestId("proposal-editor")).toBeInTheDocument());
    expect(backend.saves()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(await screen.findByRole("button", { name: /Editar Proposta/ }));
    typeInto(await screen.findByLabelText(/Nome da empresa/), "   ");
    fireEvent.click(screen.getByRole("button", { name: "Salvar Configuração" }));
    await waitFor(() => expect(screen.getByTestId("proposal-editor")).toBeInTheDocument());
    expect(backend.saves()).toHaveLength(0);
  });

  it("plano incompleto é recusado ao CRIAR (escopo + ao menos um prazo com preço)", async () => {
    await openPage();
    await clickNova();
    typeInto(screen.getByLabelText(/Nome da empresa/), "Sem Plano");

    fireEvent.click(screen.getByRole("button", { name: "Criar Proposta" }));

    await waitFor(() => expect(screen.getByTestId("proposal-editor")).toBeInTheDocument());
    expect(backend.saves()).toHaveLength(0); // nem a linha da proposta foi criada
  });

  it("link de pagamento que não é http(s) é recusado ANTES de criar (não deixa rascunho pela metade)", async () => {
    await openPage();
    await clickNova();
    await preencherBasico();
    typeInto(screen.getByLabelText(/Link de checkout/), "pay.exemplo/sem-protocolo");

    fireEvent.click(screen.getByRole("button", { name: "Criar Proposta" }));

    await waitFor(() => expect(screen.getByTestId("proposal-editor")).toBeInTheDocument());
    expect(backend.saves()).toHaveLength(0);
  });

  it("as regras são as mesmas em funções: nome, link e plano (só ao criar)", () => {
    const base = emptyProposalEditorValues({ prospectName: "X" });
    expect(validateProposalEditor(emptyProposalEditorValues(), "new").title).toBe("Nome obrigatório");
    expect(validateProposalEditor(emptyProposalEditorValues(), "edit").title).toBe("Nome obrigatório");
    expect(validateProposalEditor(base, "new").title).toBe("Plano incompleto");
    expect(validateProposalEditor(base, "edit").ok).toBe(true); // proposta legada sem plano reconstruível continua salvável
    expect(validateProposalEditor({ ...base, paymentLink: "ftp://x" }, "edit").title).toBe("Link de pagamento inválido");
    expect(validateProposalEditor({ ...base, paymentLink: "https://ok.com/x" }, "edit").ok).toBe(true);
  });
});

describe("Se a gravação dos detalhes falhar depois de criar a proposta", () => {
  it("[TESTE OBRIGATÓRIO] o 'Salvar' seguinte edita a MESMA proposta — nunca cria uma segunda", async () => {
    await openPage();
    await clickNova();
    await preencherBasico("Cliente Teta", 1000);
    typeInto(numberInputs(prazoRow("Mensal"))[1], "15");
    backend.failNextPut();

    fireEvent.click(screen.getByRole("button", { name: "Criar Proposta" }));
    await waitFor(() => expect(backend.saves().filter((c) => c.method === "PUT")).toHaveLength(1));

    // a linha existe, ainda sem os detalhes, e o formulário continua aberto com o que foi digitado
    expect(backend.proposals.filter((p) => p.prospect_name === "Cliente Teta")).toHaveLength(1);
    expect(backend.proposals.find((p) => p.prospect_name === "Cliente Teta")!.desconto_mensal_pct).toBeUndefined();
    const editor = await screen.findByTestId("proposal-editor");
    expect(editor).toHaveAttribute("data-mode", "edit");
    expect(numberInputs(prazoRow("Mensal"))[1].value).toBe("15");

    fireEvent.click(screen.getByRole("button", { name: "Salvar Configuração" }));
    await waitFor(() => expect(backend.saves().filter((c) => c.method === "PUT")).toHaveLength(2));

    expect(backend.saves().filter((c) => c.method === "POST")).toHaveLength(1); // um POST só
    expect(backend.proposals.filter((p) => p.prospect_name === "Cliente Teta")).toHaveLength(1);
    const [put1, put2] = backend.saves().filter((c) => c.method === "PUT");
    expect(put2.url).toBe(put1.url); // a mesma proposta
    expect(backend.proposals.find((p) => p.prospect_name === "Cliente Teta")!.desconto_mensal_pct).toBe(15);
  });
});

describe("Totais ao vivo do plano (parcelas ao criar)", () => {
  it("[TESTE OBRIGATÓRIO] criando, as parcelas já mostram valor (antes mostravam R$ 0 porque ainda não havia pacote salvo)", async () => {
    await openPage();
    await clickNova();
    await preencherBasico("Cliente Iota", 1000);
    typeInto(numberInputs(prazoRow("Anual"))[0], "800"); // prazo-base = o mais longo = anual (12x)
    fireEvent.click(forma("Parcelado no Cartão", 1)); // mensalidade; 12x padrão

    // 800 × 12 = 9.600 em 12x → "de R$ 800,00"
    expect(await screen.findByText(/de R\$\s*800,00/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*800,00\/mês · 12 meses/)).toBeInTheDocument();
  });

  it("os totais do plano batem com o cálculo que a proposta salva usa (calculateProposalValues)", () => {
    const plano: any = {
      ...planoVazio(),
      gdIds: ["g1"],
      precos: { mensal: 0, trimestral: 1000, semestral: 0, anual: 0 },
      descontosPorPeriodo: { mensal: 0, trimestral: 10, semestral: 0, anual: 0 },
      valorSetupVexo: 3000,
      descontoSetupPorcentagem: 50,
    };
    const ao_vivo = totaisAoVivoDoPlano(plano);
    const salvo = calculateProposalValues(
      {
        cobrar_setup: true,
        valor_setup_vexo: 3000,
        package_id: "pk",
        periodo_plano: "trimestral",
        itens: [{ descricao: "Pacote: X (Recorrência)", categoria: "gd", valor: 1000, recorrencia: "mensal", periodo: "trimestral", meses: 3, total_periodo: 3000 }],
        desconto_setup_pct: 50,
        descontos_por_periodo: plano.descontosPorPeriodo,
      },
      [{ id: "pk", tipo: "gd", periodo: "trimestral", valor: 3000 }]
    );

    expect(ao_vivo.setupFinal).toBe(salvo.setupFinal);
    expect(ao_vivo.mensalidadeFinal).toBe(salvo.mensalidadeFinal);
    expect(ao_vivo.mesesPeriodo).toBe(salvo.mesesPeriodo);
  });
});

describe("Modelo: criar e editar montam o corpo pela mesma função", () => {
  it("o corpo de criação traz os mesmos campos que o de edição", () => {
    const values = proposalEditorValuesFromProposal(
      { ...SAVED, desconto_mensal_pct: 10, carencia_dias: 15 },
      { catalogo: [], segmentsList: [] }
    );
    const novo = buildProposalBody({ values, base: PROPOSTA_BASE_VAZIA, catalogo: [], pkgId: "", pacotesOfertados: [], clientId: "t", isVexoCommercial: false, mode: "new" });
    const edicao = buildProposalBody({ values, base: SAVED, catalogo: [], pkgId: "", pacotesOfertados: [], clientId: "t", isVexoCommercial: false, mode: "edit" });

    expect(Object.keys(novo.body).sort()).toEqual(Object.keys(edicao.body).sort());
  });

  it("criar: 'condições' vazias vão como null (o servidor mantém o texto padrão); editar mantém como estava", () => {
    const values = emptyProposalEditorValues({ prospectName: "X" });
    const args = { values, base: PROPOSTA_BASE_VAZIA, catalogo: [], pkgId: "", pacotesOfertados: [], clientId: "t", isVexoCommercial: false };

    expect(buildProposalBody({ ...args, mode: "new" }).body.condicoes).toBeNull();
    expect(buildProposalBody({ ...args, mode: "edit" }).body.condicoes).toBe("");
  });

  it("o dono da proposta: Comercial Vexo grava 'vexo'; senão 'geracao-digital'", () => {
    const values = emptyProposalEditorValues({ prospectName: "X" });
    const args = { values, base: PROPOSTA_BASE_VAZIA, catalogo: [], pkgId: "", pacotesOfertados: [], clientId: "t", mode: "new" as const };

    expect(buildProposalBody({ ...args, isVexoCommercial: true }).body.owner_company).toBe("vexo");
    expect(buildProposalBody({ ...args, isVexoCommercial: false }).body.owner_company).toBe("geracao-digital");
  });
});
