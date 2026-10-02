import { useCallback, useState } from "react";
import {
  type ProposalEditorValues,
  emptyProposalEditorValues,
} from "@/lib/geracaoDigital/proposalEditorModel";

/**
 * Estado do formulário único de proposta. Um objeto só: criar e editar leem e gravam os mesmos
 * campos (ver lib/geracaoDigital/proposalEditorModel.ts).
 */
export function useProposalEditor() {
  const [values, setValues] = useState<ProposalEditorValues>(() => emptyProposalEditorValues());

  /** Altera só os campos informados. */
  const patch = useCallback((p: Partial<ProposalEditorValues>) => setValues((v) => ({ ...v, ...p })), []);

  /** Troca o formulário inteiro (abrir uma proposta salva, ou começar uma nova em branco). */
  const reset = useCallback((next: ProposalEditorValues) => setValues(next), []);

  return { values, patch, reset };
}
