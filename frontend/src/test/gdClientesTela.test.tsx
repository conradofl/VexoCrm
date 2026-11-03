// frontend/src/test/gdClientesTela.test.tsx
//
// Tela interna dos clientes da Geração Digital (03/11/2026). Hooks useGdClientes reais e página real; só o fetch
// (o que sai do navegador) é simulado, com o formato de resposta da API /api/gd/clientes. A moldura PageShell é
// trocada por uma casca: ela busca ajuda e tema, que não são o alvo aqui.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import GeracaoDigitalClientes from "@/pages/GeracaoDigitalClientes";
import { corpoDoPatch } from "@/hooks/useGdClientes";
import { ordenarClientes, podeVerClientesGd, textoDoPrazo, type GdCliente } from "@/lib/gdClientes";

const toastMock = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({ toast: (...a: any[]) => toastMock(...a) }));
vi.mock("@/components/PageShell", () => ({
  PageShell: ({ title, children }: any) => <main><h1>{title}</h1>{children}</main>,
}));

const EQUIPE_GD = {
  uid: "uid-gd", role: "internal", isAdmin: false, clientId: "geracao-digital", clientIds: ["geracao-digital"],
  internalPages: ["propostas-gd"], granularPermissions: ["geracao_digital.proposals"],
};
let perfil: any = EQUIPE_GD;
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    getIdToken: async () => "tok",
    accessProfile: perfil,
    isInternalUser: perfil?.role === "internal",
    canAccessInternalPage: () => true,
  }),
}));

const ESTADOS = [
  { codigo: "PROPOSTA_ACEITA", ordem: 20, fase: "entrada", rotulo_interno: "Proposta aceita", prazo_contagem: "horas_uteis", prazo_horas: 4, terminal: false },
  { codigo: "ASSINADO", ordem: 40, fase: "entrada", rotulo_interno: "Assinado", prazo_contagem: "fim_do_dia_util", prazo_horas: null, terminal: false },
  { codigo: "GRUPOS_CRIADOS", ordem: 50, fase: "implantacao", rotulo_interno: "Grupos criados", prazo_contagem: "horas_corridas", prazo_horas: 24, terminal: false },
  { codigo: "ATIVO", ordem: 160, fase: "regime", rotulo_interno: "Cliente ativo", prazo_contagem: "horas_corridas", prazo_horas: null, terminal: false },
  { codigo: "PAUSADO", ordem: 900, fase: "fora_da_linha", rotulo_interno: "Pausado", prazo_contagem: "horas_corridas", prazo_horas: null, terminal: false },
];

const SEM_PRAZO = { regra: "sem_prazo", horas: null, vence_em: null, atrasado: false, calculo: "sem_prazo" } as const;

function cliente(id: string, nome: string, extra: Partial<GdCliente> = {}): GdCliente {
  return {
    id, nome, cnpj: null, cnpj_a_confirmar: false, aprovador_nome: null, aprovador_telefone: null, drive_url: null,
    escopo: null, escopo_original: null, origem: "fluxo", estado_atual: "ATIVO", rotulo_interno: "Cliente ativo",
    fase: "regime", ordem: 160, estado_desde: "2026-10-01T12:00:00Z", aproximado: false, prazo: { ...SEM_PRAZO },
    created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z", ...extra,
  };
}

function resposta(status: number, body: any) {
  const res: any = { ok: status >= 200 && status < 300, status, headers: { get: () => "application/json" }, json: async () => body };
  res.clone = () => res;
  return res;
}

type Chamada = { metodo: string; url: string; corpo: any };
let chamadas: Chamada[] = [];
let lista: GdCliente[] = [];
let detalhe: any = null;
// Resposta da próxima escrita (POST/PATCH); sem ela, a escrita dá certo.
let proximaEscrita: { status: number; body: any } | null = null;
let statusDaLista = 200;

beforeEach(() => {
  vi.clearAllMocks();
  perfil = EQUIPE_GD;
  chamadas = [];
  proximaEscrita = null;
  statusDaLista = 200;
  detalhe = null;
  lista = [];
  global.fetch = vi.fn(async (url: string, init: any = {}) => {
    const metodo = init.method || "GET";
    const corpo = init.body ? JSON.parse(init.body) : undefined;
    chamadas.push({ metodo, url: String(url), corpo });
    const caminho = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (metodo !== "GET") {
      const r = proximaEscrita || { status: 200, body: { cliente: lista[0] } };
      proximaEscrita = null;
      return resposta(r.status, r.body);
    }
    if (caminho === "/api/gd/estados") return resposta(200, { estados: ESTADOS });
    if (caminho.startsWith("/api/gd/clientes/")) return resposta(200, detalhe);
    if (caminho.startsWith("/api/gd/clientes")) {
      return statusDaLista === 200
        ? resposta(200, { clientes: lista })
        : resposta(statusDaLista, { error: { code: "FORBIDDEN", message: "Clientes da Geração Digital restritos à equipe da GD" } });
    }
    return resposta(404, {});
  }) as any;
});

function renderTela() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/crm/clientes-gd"]}>
        <GeracaoDigitalClientes />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const nomesDasLinhas = () => screen.getAllByTestId("linha-cliente").map((tr) => within(tr).getAllByRole("button")[0].textContent);
const leiturasDaLista = () => chamadas.filter((c) => c.metodo === "GET" && /\/api\/gd\/clientes(\?|$)/.test(c.url)).length;
const escritas = (metodo: string) => chamadas.filter((c) => c.metodo === metodo);

describe("ordem da lista", () => {
  it("atrasado sobe para a primeira linha, depois prazo mais próximo, depois nome", async () => {
    lista = [
      cliente("1", "Alfa"),
      cliente("2", "Bravo", { estado_atual: "GRUPOS_CRIADOS", prazo: { regra: "horas_corridas", horas: 24, vence_em: "2026-11-09T12:00:00Z", atrasado: false, calculo: "ok" } }),
      cliente("3", "Charlie", { estado_atual: "GRUPOS_CRIADOS", prazo: { regra: "horas_corridas", horas: 24, vence_em: "2026-11-01T12:00:00Z", atrasado: true, calculo: "ok" } }),
      cliente("4", "Delta", { estado_atual: "GRUPOS_CRIADOS", prazo: { regra: "horas_corridas", horas: 24, vence_em: "2026-11-05T12:00:00Z", atrasado: false, calculo: "ok" } }),
      cliente("5", "Eco"),
    ];
    renderTela();
    await screen.findByText("Charlie");
    expect(nomesDasLinhas()).toEqual(["Charlie", "Delta", "Bravo", "Alfa", "Eco"]);
  });

  it("o atraso manda mais que a data: atrasado com vence_em posterior ainda fica no topo", () => {
    // A API é quem diz atrasado (relógio dela). A tela não reinterpreta pela data.
    const ord = ordenarClientes([
      cliente("1", "Cedo", { prazo: { regra: "horas_corridas", horas: 24, vence_em: "2026-11-02T12:00:00Z", atrasado: false, calculo: "ok" } }),
      cliente("2", "Atrasado", { prazo: { regra: "horas_corridas", horas: 24, vence_em: "2026-11-05T12:00:00Z", atrasado: true, calculo: "ok" } }),
    ]);
    expect(ord.map((c) => c.nome)).toEqual(["Atrasado", "Cedo"]);
  });

  it("todos sem prazo: sai por nome, sem diferenciar acento e caixa", () => {
    const ord = ordenarClientes([cliente("1", "via permuta"), cliente("2", "Ágape"), cliente("3", "Cafeeiro")]);
    expect(ord.map((c) => c.nome)).toEqual(["Ágape", "Cafeeiro", "via permuta"]);
  });
});

describe("prazo: só o que a API manda", () => {
  it("horas úteis e fim do dia útil mostram a regra, nunca uma data calculada pela tela", async () => {
    lista = [
      cliente("1", "Aceita", { estado_atual: "PROPOSTA_ACEITA", estado_desde: "2026-11-03T12:00:00Z", prazo: { regra: "horas_uteis", horas: 4, vence_em: null, atrasado: null, calculo: "pendente" } }),
      cliente("2", "Assinou", { estado_atual: "ASSINADO", estado_desde: "2026-11-03T12:00:00Z", prazo: { regra: "fim_do_dia_util", horas: null, vence_em: null, atrasado: null, calculo: "pendente" } }),
    ];
    renderTela();
    await screen.findByText("Aceita");
    const prazos = screen.getAllByTestId("prazo").map((td) => td.textContent);
    expect(prazos).toEqual(["4 h úteis, cálculo pendente", "vence no fim do dia útil"]);
    // estado_desde + 4 h = 03/11 13:00 em Brasília; essa data não pode aparecer.
    for (const p of prazos) expect(p).not.toMatch(/\d{2}\/\d{2}|\d{2}:\d{2}/);
  });

  it("horas corridas: data e atraso vêm da API; PAUSADO e ATIVO sem prazo nunca mostram atraso", async () => {
    lista = [
      cliente("1", "Atrasado", { estado_atual: "GRUPOS_CRIADOS", prazo: { regra: "horas_corridas", horas: 24, vence_em: "2026-11-01T15:00:00Z", atrasado: true, calculo: "ok" } }),
      cliente("2", "Cliente pausado", { estado_atual: "PAUSADO", prazo: { ...SEM_PRAZO } }),
      cliente("3", "Ativo", { prazo: { ...SEM_PRAZO } }),
    ];
    renderTela();
    await screen.findByText("Cliente pausado");
    const prazos = screen.getAllByTestId("prazo").map((td) => td.textContent);
    expect(prazos).toEqual(["vence 01/11 12:00atrasado", "sem prazo", "sem prazo"]);
  });

  it("sem prazo nunca é atraso, nem com atrasado null ou true", () => {
    for (const atrasado of [null, true]) {
      expect(textoDoPrazo({ regra: "sem_prazo", horas: null, vence_em: null, atrasado, calculo: "sem_prazo" } as any)).toEqual({ texto: "sem prazo", atrasado: false });
    }
  });

  it("atraso só quando a API manda atrasado: true, mesmo com vence_em no passado", () => {
    expect(textoDoPrazo({ regra: "horas_corridas", horas: 24, vence_em: "2020-01-01T00:00:00Z", atrasado: false, calculo: "ok" }).atrasado).toBe(false);
  });
});

describe("mover de estado", () => {
  it("manda estado_esperado; 409 ESTADO_MUDOU recarrega, avisa e não manda de novo", async () => {
    lista = [cliente("c1", "Cafeeiro")];
    renderTela();
    await screen.findByText("Cafeeiro");
    const antes = leiturasDaLista();
    proximaEscrita = { status: 409, body: { error: { code: "ESTADO_MUDOU", message: "mudou", details: { estado_atual: "PAUSADO" } } } };

    fireEvent.change(screen.getByLabelText("Mover Cafeeiro"), { target: { value: "GRUPOS_CRIADOS" } });
    fireEvent.click(screen.getByRole("button", { name: "Mover" }));

    expect(await screen.findByText(/Outra pessoa moveu Cafeeiro para Pausado/)).toBeInTheDocument();
    const posts = escritas("POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toMatch(/\/api\/gd\/clientes\/c1\/eventos$/);
    expect(posts[0].corpo).toEqual({ estado: "GRUPOS_CRIADOS", estado_esperado: "ATIVO" });
    await waitFor(() => expect(leiturasDaLista()).toBeGreaterThan(antes));
    expect(escritas("PATCH")).toHaveLength(0);
  });
});

describe("cadastro", () => {
  it("CNPJ a confirmar aparece na lista e no detalhe; o botão manda só cnpj_a_confirmar: false", async () => {
    const vantage = cliente("v1", "Vantage", { cnpj: "50607080000190", cnpj_a_confirmar: true });
    lista = [vantage];
    detalhe = { cliente: vantage, eventos: [] };
    renderTela();
    expect(await screen.findByText("CNPJ a confirmar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vantage" }));
    expect(await screen.findByRole("status")).toHaveTextContent("CNPJ a confirmar");
    fireEvent.click(screen.getByRole("button", { name: "CNPJ conferido" }));
    await waitFor(() => expect(escritas("PATCH")).toHaveLength(1));
    expect(escritas("PATCH")[0].corpo).toEqual({ cnpj_a_confirmar: false });
  });

  it("editar manda só o campo que mudou, e nunca estado", async () => {
    const c = cliente("e1", "Tinge", { aprovador_telefone: "5534999990001", escopo: ["social"] });
    lista = [c];
    detalhe = { cliente: c, eventos: [] };
    renderTela();
    fireEvent.click(await screen.findByRole("button", { name: "Tinge" }));
    fireEvent.click(await screen.findByRole("button", { name: "Editar dados" }));
    fireEvent.change(screen.getByLabelText("Telefone do aprovador"), { target: { value: "(34) 98888-0002" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(escritas("PATCH")).toHaveLength(1));
    expect(escritas("PATCH")[0].corpo).toEqual({ aprovador_telefone: "(34) 98888-0002" });
  });

  it("a lista branca do PATCH descarta estado mesmo que alguém o coloque nas mudanças", () => {
    expect(corpoDoPatch({ nome: "X", estado_atual: "ENCERRADO", estado: "ENCERRADO", estado_desde: "2020" })).toEqual({ nome: "X" });
  });

  it("links: Drive em aba nova com noopener noreferrer; telefone vira wa.me; escopo original ao lado dos códigos", async () => {
    lista = [cliente("l1", "Via Permuta", {
      drive_url: "https://drive.google.com/drive/folders/abc", aprovador_nome: "Fulana", aprovador_telefone: "5534999990003",
      escopo: ["vexo", "linkedin"], escopo_original: "Vexo disparo (dezembro), LinkedIn (Criar)",
    })];
    renderTela();
    const pasta = await screen.findByRole("link", { name: "Pasta" });
    expect(pasta).toHaveAttribute("href", "https://drive.google.com/drive/folders/abc");
    expect(pasta).toHaveAttribute("target", "_blank");
    expect(pasta).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/5534999990003");
    expect(screen.getByText("vexo, linkedin")).toBeInTheDocument();
    expect(screen.getByText("Vexo disparo (dezembro), LinkedIn (Criar)")).toBeInTheDocument();
  });

  it("data estimada da importação não vira contagem de dias", async () => {
    lista = [cliente("i1", "Importado", { origem: "importacao_inicial", aproximado: true, estado_desde: "2026-11-03T15:19:06Z" })];
    renderTela();
    expect(await screen.findByText("desde 03/11/2026 (estimada)")).toBeInTheDocument();
    expect(screen.queryByText(/há \d+ dias|hoje/)).not.toBeInTheDocument();
  });

  it("linha do tempo mostra estado anterior, origem, ator e motivo", async () => {
    const c = cliente("t1", "Crepfy");
    lista = [c];
    detalhe = {
      cliente: c,
      eventos: [
        { id: "a", estado: "ATIVO", estado_anterior: null, rotulo_interno: "Cliente ativo", ocorrido_em: "2026-11-03T15:19:06Z", registrado_em: "2026-11-03T15:19:06Z", data_estimada: true, origem: "importacao_inicial", ator_tipo: "importacao", ator_id: "importacao:conrado", motivo: "Importação inicial" },
        { id: "b", estado: "PAUSADO", estado_anterior: "ATIVO", rotulo_interno: "Pausado", ocorrido_em: "2026-11-04T12:00:00Z", registrado_em: "2026-11-04T12:00:00Z", data_estimada: false, origem: "fluxo", ator_tipo: "humano", ator_id: "AbCdEfGh123456", motivo: "cliente pediu" },
      ],
    };
    renderTela();
    fireEvent.click(await screen.findByRole("button", { name: "Crepfy" }));
    const linha = await screen.findByRole("list", { name: "Linha do tempo" });
    expect(linha).toHaveTextContent("Cliente ativo · 03/11 12:19 (estimada)");
    expect(linha).toHaveTextContent("importacao_inicial · importacao · importacao:conrado · Importação inicial");
    expect(linha).toHaveTextContent("ATIVO → Pausado");
    expect(linha).toHaveTextContent("fluxo · humano · AbCdEfGh · cliente pediu");
  });
});

describe("criar", () => {
  it("nome e estado bastam; o corpo leva só os dois", async () => {
    renderTela();
    fireEvent.click(await screen.findByRole("button", { name: "Novo cliente" }));
    const form = screen.getByRole("form", { name: "Novo cliente" });
    await waitFor(() => expect(within(form).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "  Cliente Novo " } });
    fireEvent.change(within(form).getByLabelText("Estado inicial"), { target: { value: "PROPOSTA_ACEITA" } });
    fireEvent.click(within(form).getByRole("button", { name: "Criar cliente" }));
    await waitFor(() => expect(escritas("POST")).toHaveLength(1));
    expect(escritas("POST")[0].corpo).toEqual({ nome: "Cliente Novo", estado: "PROPOSTA_ACEITA" });
  });

  it("sem estado não chama a API; 422 TELEFONE_INVALIDO aparece no campo do telefone", async () => {
    renderTela();
    fireEvent.click(await screen.findByRole("button", { name: "Novo cliente" }));
    const form = screen.getByRole("form", { name: "Novo cliente" });
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "Sem estado" } });
    fireEvent.click(within(form).getByRole("button", { name: "Criar cliente" }));
    expect(await within(form).findByText("Escolha o estado.")).toBeInTheDocument();
    expect(escritas("POST")).toHaveLength(0);

    await waitFor(() => expect(within(form).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(within(form).getByLabelText("Estado inicial"), { target: { value: "ATIVO" } });
    fireEvent.click(within(form).getByRole("button", { name: "Mais dados (opcional)" }));
    fireEvent.change(within(form).getByLabelText("Telefone do aprovador"), { target: { value: "5500999991234" } });
    proximaEscrita = { status: 422, body: { error: { code: "TELEFONE_INVALIDO", message: "Telefone precisa ser brasileiro." } } };
    fireEvent.click(within(form).getByRole("button", { name: "Criar cliente" }));
    const campo = within(form).getByLabelText("Telefone do aprovador").closest("label")!;
    expect(await within(campo).findByText("Telefone precisa ser brasileiro.")).toBeInTheDocument();
    expect(escritas("POST")[0].corpo).toEqual({ nome: "Sem estado", estado: "ATIVO", aprovador_telefone: "5500999991234" });
  });
});

describe("permissão", () => {
  it.each([
    ["admin interno", { role: "internal", isAdmin: true, clientIds: [] }, true],
    ["equipe da GD com a permissão", EQUIPE_GD, true],
    ["equipe da GD só com página da GD", { ...EQUIPE_GD, granularPermissions: [] }, true],
    ["interno de outra empresa", { ...EQUIPE_GD, clientId: "tinge-brasil", clientIds: ["tinge-brasil"] }, false],
    ["GD sem permissão nem página da GD", { ...EQUIPE_GD, granularPermissions: [], internalPages: ["planilhas"] }, false],
    ["cliente", { ...EQUIPE_GD, role: "client" }, false],
    ["pendente", { role: "pending" }, false],
  ])("%s", (_n, p, esperado) => {
    expect(podeVerClientesGd(p as any)).toBe(esperado);
  });

  it("sem permissão no espelho: mensagem e nenhuma chamada à API", async () => {
    perfil = { ...EQUIPE_GD, clientId: "tinge-brasil", clientIds: ["tinge-brasil"] };
    renderTela();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem permissão para clientes da GD");
    expect(chamadas).toHaveLength(0);
  });

  it("API respondendo 403: a mesma mensagem, não lista vazia", async () => {
    statusDaLista = 403;
    renderTela();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem permissão para clientes da GD");
    expect(screen.queryByTestId("linha-cliente")).not.toBeInTheDocument();
  });
});
