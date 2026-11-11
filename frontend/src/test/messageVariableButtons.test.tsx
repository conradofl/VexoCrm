// Botao de variavel: a variavel entra onde o cursor esta, nao no fim do texto.
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MessageSequenceStep } from "@/pages/LeadImports/MessageSequenceStep";

function montar(textoInicial: string, type: "text" | "link" = "text") {
  let atual = textoInicial;
  function Tela() {
    const [texto, setTexto] = useState(textoInicial);
    const props = {
      campaignSequence: [{ id: "s1", order: 1, type, text: texto, enabled: true, delayAfterSeconds: 0, linkUrl: "" }],
      updateCampaignStep: (_id: string, patch: { text?: string }) => {
        if (patch.text !== undefined) {
          atual = patch.text;
          setTexto(patch.text);
        }
      },
      moveCampaignStep: vi.fn(),
      removeCampaignStep: vi.fn(),
      addCampaignStep: vi.fn(),
      onSelectImageStep: vi.fn(),
      onSequenceImageChange: vi.fn(),
      sequenceImageInputRef: { current: null },
      isGeneratingVariants: false,
      onGenerateVariants: vi.fn(),
      variantCount: 10,
      onVariantCountChange: vi.fn(),
      suggestedVariantCount: 10,
      dailyQuota: 100,
      minVariantCount: 1,
      maxVariantCount: 30,
      onAddStepButton: vi.fn(),
      onRemoveStepButton: vi.fn(),
      onUpdateStepButton: vi.fn(),
    };
    return <MessageSequenceStep {...(props as any)} />;
  }
  render(<Tela />);
  return { texto: () => atual };
}

const campoDoPasso = () => document.querySelector("textarea") as HTMLTextAreaElement;
const clicar = (variavel: string) => fireEvent.click(screen.getByRole("button", { name: variavel }));

function posicionar(inicio: number, fim = inicio) {
  const campo = campoDoPasso();
  fireEvent.focus(campo);
  campo.focus();
  campo.setSelectionRange(inicio, fim);
}

describe("botões de variável inserem no cursor", () => {
  it("cursor no meio: a variável fica no meio, com espaço dos dois lados", () => {
    const tela = montar("Olá tudo bem");
    posicionar(3);
    clicar("{{nome}}");
    expect(tela.texto()).toBe("Olá {{nome}} tudo bem");
  });

  it("texto selecionado: a seleção é trocada pela variável", () => {
    const tela = montar("Olá Fulano, tudo bem");
    posicionar(4, 10);
    clicar("{{primeiro_nome}}");
    expect(tela.texto()).toBe("Olá {{primeiro_nome}}, tudo bem");
  });

  it("cursor colado em palavra dos dois lados: não gruda a variável", () => {
    const tela = montar("Oláamigo");
    posicionar(3);
    clicar("{{nome}}");
    expect(tela.texto()).toBe("Olá {{nome}} amigo");
  });

  it("cursor antes de pontuação: não cria espaço antes da vírgula", () => {
    const tela = montar("Olá, tudo bem");
    posicionar(3);
    clicar("{{nome}}");
    expect(tela.texto()).toBe("Olá {{nome}}, tudo bem");
  });

  it("nunca focou o campo: vai para o fim", () => {
    const tela = montar("Olá tudo bem");
    campoDoPasso().setSelectionRange(0, 0);
    clicar("{{telefone}}");
    expect(tela.texto()).toBe("Olá tudo bem {{telefone}}");
  });

  it("campo vazio: entra só a variável", () => {
    const tela = montar("");
    clicar("{{nome}}");
    expect(tela.texto()).toBe("{{nome}}");
  });

  it("devolve o foco com o cursor logo depois do que entrou", async () => {
    montar("Olá tudo bem");
    posicionar(3);
    // No navegador, clicar no botão tira o foco do campo; fireEvent não faz isso sozinho.
    campoDoPasso().blur();
    clicar("{{nome}}");
    await waitFor(() => expect(document.activeElement).toBe(campoDoPasso()));
    await waitFor(() => expect(campoDoPasso().selectionStart).toBe("Olá {{nome}}".length));
    expect(campoDoPasso().selectionEnd).toBe(campoDoPasso().selectionStart);
  });

  it("passo de link também insere no cursor", () => {
    const tela = montar("Olá segue o link", "link");
    posicionar(3);
    clicar("{{nome}}");
    expect(tela.texto()).toBe("Olá {{nome}} segue o link");
  });

  it.each(["text", "link"] as const)("passo %s oferece {{primeiro_nome}} junto de {{nome}}", (tipo) => {
    montar("", tipo);
    expect(screen.getByRole("button", { name: "{{nome}}" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "{{primeiro_nome}}" })).toBeInTheDocument();
  });
});
