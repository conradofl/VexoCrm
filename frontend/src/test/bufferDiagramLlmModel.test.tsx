import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { BufferDiagram } from "../pages/ChatbotDocs/BufferDiagram";
import { defaultGroqModel } from "../lib/llmModels";

describe("BufferDiagram - Exibição do Modelo LLM Padrão", () => {
  it("Exibe o modelo ativo do primeiro degrau (defaultGroqModel) e não possui llama-3.3-70b chumbado", () => {
    render(<BufferDiagram />);

    const activeModel = defaultGroqModel();
    expect(activeModel).toBe("openai/gpt-oss-120b");

    // Deve conter o primeiro degrau real
    expect(screen.getByText(activeModel)).toBeInTheDocument();

    // NÃO deve conter o modelo descontinuado llama-3.3-70b
    expect(screen.queryByText(/llama-3\.3-70b/i)).not.toBeInTheDocument();
  });
});
