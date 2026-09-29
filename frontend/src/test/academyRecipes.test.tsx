// frontend/src/test/academyRecipes.test.tsx
//
// Vexo Academy — o conteúdo vem de academyRecipes.ts (dado, não
// componente). Dois tipos que se comportam diferente: fundamento (só
// leitura e Copiar, nunca instala) e receita (instala). Os testes aqui são
// os cinco pedidos no envio de conteúdo, mais a medição e os filtros que já
// existiam.

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ACADEMY_CONTENT, ACADEMY_FUNDAMENTOS, ACADEMY_RECIPES, isAcademyRecipe, SUPPORTED_ANCHOR_FIELDS } from "@/data/academyRecipes";

const getIdTokenMock = async () => "token";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: getIdTokenMock }),
}));

vi.mock("@/hooks/useCrmClient", () => ({
  useOptionalCrmClient: () => ({ selectedClientId: "tenant-teste", clients: [], isLoading: false, selectedClient: null }),
}));

vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Vexo Academy — conteúdo (fundamentos e receitas)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, headers: { get: () => "application/json" }, json: async () => ({ success: true }) }));
    global.fetch = fetchMock as any;
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  });

  it("[TESTE OBRIGATÓRIO] os dezenove entram e aparecem — quatro fundamento, quinze receita", () => {
    expect(ACADEMY_CONTENT).toHaveLength(19);
    expect(ACADEMY_FUNDAMENTOS).toHaveLength(4);
    expect(ACADEMY_RECIPES).toHaveLength(15);
    ACADEMY_FUNDAMENTOS.forEach((f) => expect(f.tipo).toBe("fundamento"));
    ACADEMY_RECIPES.forEach((r) => expect(r.tipo).toBe("receita"));
  });

  it("[TESTE OBRIGATÓRIO] três segmentos novos aparecem no filtro, junto com os dois que já existem", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    for (const segmento of ["Turismo", "Contabilidade", "Comércio local", "Prestadores de serviço", "Clubes de permuta e redes de negócios"]) {
      expect(screen.getByRole("button", { name: segmento }), `filtro de segmento "${segmento}" não apareceu`).toBeTruthy();
    }
  });

  it("[TESTE OBRIGATÓRIO] toda receita nova (envio 3) é instalável — sem manualSteps, sem installable false, sem fixed_date nem âncora", () => {
    const idsNovos = [
      "receita-comercio-local-comprou-nao-voltou",
      "receita-comercio-local-perguntou-preco",
      "receita-comercio-local-lista-quer-saber-primeiro",
      "receita-prestadores-servico-orcamento-sem-resposta",
      "receita-prestadores-servico-depois-do-servico",
      "receita-prestadores-servico-buraco-agenda",
      "receita-permuta-empresa-nao-associada",
      "receita-permuta-credito-parado",
      "receita-permuta-associado-anunciando",
    ];
    expect(idsNovos.length).toBe(9);
    for (const id of idsNovos) {
      const recipe = ACADEMY_RECIPES.find((r) => r.id === id);
      expect(recipe, `receita nova "${id}" não encontrada em ACADEMY_RECIPES`).toBeTruthy();
      expect(recipe!.installable, `${id} não pode ter installable: false`).not.toBe(false);
      expect(recipe!.manualSteps, `${id} não pode ter manualSteps`).toBeUndefined();
      expect(recipe!.templates.length, `${id} sem templates instaláveis`).toBeGreaterThan(0);
      for (const tpl of recipe!.templates) {
        expect(tpl.trigger_type, `${id} usa trigger_type "${tpl.trigger_type}" — deveria ser after_enrollment ou no_reply`).toMatch(
          /^(after_enrollment|no_reply)$/
        );
        expect(tpl.anchor_field, `${id} não pode ter anchor_field`).toBeUndefined();
      }
    }
  });

  it("[TESTE OBRIGATÓRIO] as receitas de um passo só instalam uma cadência com exatamente um passo", () => {
    const idsUmPasso = [
      "receita-comercio-local-lista-quer-saber-primeiro",
      "receita-prestadores-servico-buraco-agenda",
      "receita-permuta-associado-anunciando",
    ];
    for (const id of idsUmPasso) {
      const recipe = ACADEMY_RECIPES.find((r) => r.id === id);
      expect(recipe, `receita de um passo "${id}" não encontrada`).toBeTruthy();
      expect(recipe!.templates, `${id} deveria instalar exatamente 1 passo`).toHaveLength(1);
    }
  });

  it("[TESTE OBRIGATÓRIO] os dezenove aparecem na tela (sem filtro nenhum)", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    for (const content of ACADEMY_CONTENT) {
      expect(screen.getByText(content.title)).toBeTruthy();
    }
  });

  it("[TESTE OBRIGATÓRIO] fundamento não tem botão de instalar", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    for (const fundamento of ACADEMY_FUNDAMENTOS) {
      fireEvent.click(screen.getByText(fundamento.title));
      expect(screen.queryByRole("button", { name: /Usar esta receita/ })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Voltar para a lista/ }));
    }
  });

  it("receita tem o botão de instalar", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    fireEvent.click(screen.getByText(ACADEMY_RECIPES[0].title));
    expect(screen.getByRole("button", { name: /Usar esta receita/ })).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] o texto chega inteiro na tela, sem truncar — inclusive as notas", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    // receita: mensagens e nota na tela, byte a byte. Mensagem tem quebra de
    // linha real (\n) — o normalizador padrão do getByText colapsa espaço
    // em branco e quebra pode ficar dividida entre nós de texto no DOM
    // (whitespace-pre-wrap não muda a árvore, mas o normalizador compara
    // texto já colapsado); comparar textContent bruto é o jeito exato de
    // provar "inteiro, não truncado" sem depender de como o DOM particiona.
    const exactTextContent = (expected: string) => (_: string, element: Element | null) => element?.textContent === expected;

    for (const recipe of ACADEMY_RECIPES) {
      fireEvent.click(screen.getByText(recipe.title));
      for (const tpl of recipe.templates) {
        expect(screen.getByText(exactTextContent(tpl.message))).toBeTruthy();
      }
      expect(screen.getByText(recipe.screenNote)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /Voltar para a lista/ }));
    }

    // fundamento: cada seção (heading + corpo) inteira
    for (const fundamento of ACADEMY_FUNDAMENTOS) {
      fireEvent.click(screen.getByText(fundamento.title));
      for (const section of fundamento.sections) {
        expect(screen.getByText(section.heading)).toBeTruthy();
        expect(screen.getByText(section.body)).toBeTruthy();
      }
      fireEvent.click(screen.getByRole("button", { name: /Voltar para a lista/ }));
    }
  });

  it("[TESTE OBRIGATÓRIO] a receita com anexo avisa que o arquivo precisa ser enviado, em vez de instalar sem ele", async () => {
    const comAnexo = ACADEMY_RECIPES.find((r) => r.requiresAttachment);
    expect(comAnexo, "nenhuma receita com requiresAttachment=true — a receita de documentos deveria ter esse flag").toBeTruthy();

    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    fireEvent.click(screen.getByText(comAnexo!.title));
    expect(screen.getByText(/precisa ser enviado por você/)).toBeTruthy();

    // e as receitas sem anexo não mostram o aviso
    fireEvent.click(screen.getByRole("button", { name: /Voltar para a lista/ }));
    const semAnexo = ACADEMY_RECIPES.find((r) => !r.requiresAttachment)!;
    fireEvent.click(screen.getByText(semAnexo.title));
    expect(screen.queryByText(/precisa ser enviado por você/)).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] todo passo instalável com âncora usa uma âncora que o sistema tem de verdade", () => {
    // ANCHOR_FIELDS no backend (followup/service.js) só tem meeting_datetime
    // e data_nascimento — SUPPORTED_ANCHOR_FIELDS espelha essa lista. Passo
    // instalável com before_anchor/after_anchor fora dessa lista é a tela
    // prometendo uma data que o sistema não agenda.
    for (const recipe of ACADEMY_RECIPES) {
      for (const tpl of recipe.templates) {
        if (tpl.trigger_type === "before_anchor" || tpl.trigger_type === "after_anchor") {
          expect(tpl.anchor_field, `${recipe.id} / ${tpl.label} usa ${tpl.trigger_type} sem anchor_field`).toBeTruthy();
          expect(
            (SUPPORTED_ANCHOR_FIELDS as readonly string[]).includes(tpl.anchor_field!),
            `${recipe.id} / ${tpl.label} usa anchor_field '${tpl.anchor_field}', que não existe em ANCHOR_FIELDS`
          ).toBe(true);
        }
      }
    }
  });

  it("[TESTE OBRIGATÓRIO] nenhum passo instalável promete uma âncora que o sistema não tem — vira manual ou não instala", () => {
    // Regra da rodada 2: um cartão que diz "60 dias antes do aniversário de
    // casamento" e agenda por after_enrollment está mentindo pra quem
    // instala — o passo dispara dias depois da inscrição, não perto da
    // data prometida. Esse tipo de passo não pode estar em `templates`
    // (o array que o botão "Usar esta receita" instala).
    const promessasSemAncora = [
      "aniversário de casamento",
      "época de férias",
      "data de retorno",
      "depois da volta",
    ];
    for (const recipe of ACADEMY_RECIPES) {
      for (const tpl of recipe.templates) {
        const haystack = `${tpl.label} ${tpl.message}`.toLowerCase();
        for (const frase of promessasSemAncora) {
          expect(
            haystack.includes(frase),
            `${recipe.id} / ${tpl.label} promete '${frase}' num passo instalável, mas isso não tem âncora real`
          ).toBe(false);
        }
      }
    }
  });

  it("[TESTE OBRIGATÓRIO] nenhum passo fixed_date instalável traz scheduled_date inventada no catálogo estático", () => {
    for (const recipe of ACADEMY_RECIPES) {
      for (const tpl of recipe.templates) {
        if (tpl.trigger_type === "fixed_date") {
          expect(tpl.scheduled_date, `${recipe.id} / ${tpl.label} tem scheduled_date inventada no catálogo estático`).toBeUndefined();
        }
      }
    }
  });

  it("[TESTE OBRIGATÓRIO] toda receita não instalável não tem botão de instalar, e diz o que falta", async () => {
    const naoInstalaveis = ACADEMY_RECIPES.filter((r) => r.installable === false);
    expect(naoInstalaveis.length, "esperava apenas 'Quem acabou de voltar' como installable=false").toBe(1);

    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    for (const recipe of naoInstalaveis) {
      expect(recipe.templates, `${recipe.id} não instalável mas tem templates`).toHaveLength(0);
      expect(recipe.notInstallableReason, `${recipe.id} não instalável sem notInstallableReason`).toBeTruthy();
      expect(recipe.manualSteps?.length, `${recipe.id} não instalável mas sem manualSteps`).toBeGreaterThan(0);

      fireEvent.click(screen.getByText(recipe.title));
      expect(screen.queryByRole("button", { name: /Usar esta receita/ })).toBeNull();
      expect(screen.getByText(recipe.notInstallableReason!)).toBeTruthy();
      for (const step of recipe.manualSteps || []) {
        expect(screen.getByText((_, el) => el?.textContent === step.message)).toBeTruthy();
      }
      fireEvent.click(screen.getByRole("button", { name: /Voltar para a lista/ }));
    }
  });

  it("receita parcial declara na tela o que instala e o que fica manual", async () => {
    const parcial = ACADEMY_RECIPES.find((r) => r.partialInstallNote);
    expect(parcial, "nenhuma receita com partialInstallNote — 'As datas que voltam todo ano' deveria ter uma").toBeTruthy();
    expect(parcial!.templates.length).toBeGreaterThan(0);
    expect(parcial!.manualSteps?.length).toBeGreaterThan(0);

    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    fireEvent.click(screen.getByText(parcial!.title));
    expect(screen.getByText(parcial!.partialInstallNote!)).toBeTruthy();
    // instala normalmente — o botão continua lá
    expect(screen.getByRole("button", { name: /Usar esta receita/ })).toBeTruthy();
  });

  const FORBIDDEN_CLIENT_NAMES = ["geracao-digital", "geração digital", "sonhare", "vexo os", "infinie", "outlier"];

  it("[TESTE OBRIGATÓRIO] nenhum dos dezenove cita nome de empresa — só nome de segmento", () => {
    for (const content of ACADEMY_CONTENT) {
      const haystack = JSON.stringify(content).toLowerCase();
      for (const name of FORBIDDEN_CLIENT_NAMES) {
        expect(haystack).not.toContain(name);
      }
    }
  });

  it("[TESTE OBRIGATÓRIO] nome de cliente real não entra nem por comentário nem por fixture de teste", () => {
    // O teste acima só varre ACADEMY_CONTENT (o array exportado) — nome de
    // cliente em comentário, ou em fixture de outro teste, passa batido. A
    // regra do anonimato ("nem comentário, nem dado de teste") vale para o
    // arquivo inteiro, então lê o arquivo-fonte bruto, sem descontar
    // comentário (aqui, ao contrário do teste de new Date(), o comentário É
    // o lugar onde o nome também não pode estar).
    const filesToScan = ["src/data/academyRecipes.ts", "src/test/academyRecipes.test.tsx", "src/test/academyInstall.test.tsx"];
    for (const relPath of filesToScan) {
      const absPath = path.resolve(__dirname, "../../", relPath);
      const source = fs.readFileSync(absPath, "utf-8").toLowerCase();
      for (const name of FORBIDDEN_CLIENT_NAMES) {
        // Cada nome aparece 1x de propósito neste próprio arquivo, dentro da
        // lista FORBIDDEN_CLIENT_NAMES declarada acima — isso é o bloqueio,
        // não vazamento. Só falha se aparecer de novo, fora da lista.
        const occurrences = source.split(name).length - 1;
        const expectedOccurrences = relPath.endsWith("academyRecipes.test.tsx") ? 1 : 0;
        expect(
          occurrences,
          `${relPath} cita '${name}' ${occurrences}x (esperado ${expectedOccurrences}) — nome de cliente real fora da lista de bloqueio`
        ).toBe(expectedOccurrences);
      }
    }
  });

  it("fundamentos aparecem sempre, mesmo com filtro de segmento/contato aplicado", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    fireEvent.click(screen.getByRole("button", { name: "Turismo" }));

    for (const fundamento of ACADEMY_FUNDAMENTOS) {
      expect(screen.getByText(fundamento.title)).toBeTruthy();
    }
    // e a receita de outro segmento (Contabilidade) some
    const contabilidade = ACADEMY_RECIPES.find((r) => r.segments.includes("Contabilidade"))!;
    expect(screen.queryByText(contabilidade.title)).toBeNull();
  });

  it("lista filtrável por contato (frio/morno/quente) — escolher um esconde as receitas de outro", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    const morno = ACADEMY_RECIPES.find((r) => r.contactTemperature === "morno")!;
    const quente = ACADEMY_RECIPES.find((r) => r.contactTemperature === "quente")!;

    fireEvent.click(screen.getByRole("button", { name: "Contato morno" }));

    expect(screen.getByText(morno.title)).toBeTruthy();
    expect(screen.queryByText(quente.title)).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] a medição distingue abrir de copiar — cada ação é uma chamada própria", async () => {
    // "instalou" é medido dentro do fluxo de instalação de verdade (escolher
    // agente, confirmar) — coberto em academyInstall.test.tsx, não aqui.
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    const recipe = ACADEMY_RECIPES[0];

    // abrir
    fireEvent.click(screen.getByText(recipe.title));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    let call = fetchMock.mock.calls.find((c) => c[1]?.body && JSON.parse(c[1].body).action === "opened");
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1].body)).toMatchObject({ clientId: "tenant-teste", recipeId: recipe.id, action: "opened" });

    // copiar
    fetchMock.mockClear();
    const copyButtons = screen.getAllByRole("button", { name: /Copiar/ });
    fireEvent.click(copyButtons[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    call = fetchMock.mock.calls.find((c) => c[1]?.body && JSON.parse(c[1].body).action === "copied");
    expect(call).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(recipe.templates[0].message);
    // "copiado" nunca é confundido com "abriu" — ação própria, chamada própria
    expect(JSON.parse(call![1].body).action).not.toBe("opened");
  });

  it("fundamento também mede abrir e copiar (só não instala)", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    const fundamento = ACADEMY_FUNDAMENTOS[0];
    fireEvent.click(screen.getByText(fundamento.title));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find((c) => c[1]?.body && JSON.parse(c[1].body).action === "opened");
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1].body)).toMatchObject({ clientId: "tenant-teste", recipeId: fundamento.id, action: "opened" });
  });

  it("cada receita declara tipo, contactTemperature e segmento coerentes com o conteúdo", () => {
    for (const content of ACADEMY_CONTENT) {
      if (isAcademyRecipe(content)) {
        expect(["frio", "morno", "quente"]).toContain(content.contactTemperature);
        expect(content.segments.length).toBeGreaterThan(0);
        expect(content.segments).not.toContain("Todos os segmentos");
      } else {
        expect(content.segments).toEqual(["Todos os segmentos"]);
      }
    }
  });
});
