// A tela e o envio tem que concordar sobre {{primeiro_nome}}: antes, a auditoria dizia
// que todo lead seria segurado e a previa mostrava a variavel crua, enquanto o envio
// substituia normalmente.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { auditMessageVariablesAgainstLeads } from "@/lib/leadImports/spreadsheet";
import { FIRST_NAME_VARIABLES, NAME_VARIABLES, renderPreviewNames } from "@/lib/leadImports/messageVariables";
import { SchedulingStep } from "@/pages/LeadImports/SchedulingStep";

const LEADS = [
  { id: "1", nome: "João Silva", telefone: "5511999990001" },
  { id: "2", nome: "Maria", telefone: "5511999990002" },
  { id: "3", nome: "", telefone: "5511999990003" },
];

const alternativas = (fonte: string, nome: string) => {
  const m = fonte.match(new RegExp(`\\(\\?:([^)]*\\b${nome}\\b[^)]*)\\)\\\\s\\*\\\\}\\\\}/gi`));
  if (!m) throw new Error(`alternativa de ${nome} nao encontrada em messagePlaceholders.js`);
  return m[1].split("|").map((v) => v.replace("\\s+", " ")).sort();
};

describe("{{primeiro_nome}}: tela e envio concordam", () => {
  it("a lista é a mesma do envio (messagePlaceholders.js)", () => {
    const fonte = readFileSync(resolve(__dirname, "../../../backend/src/services/messagePlaceholders.js"), "utf-8");

    expect([...FIRST_NAME_VARIABLES].sort()).toEqual(alternativas(fonte, "primeiro_nome"));
    expect([...NAME_VARIABLES].sort()).toEqual(alternativas(fonte, "lead_name"));
  });

  it.each(["primeiro_nome", "primeironome", "primeiro nome", "first_name", "firstname", "PRIMEIRO_NOME"])(
    "auditoria não segura lead por {{%s}}",
    (variavel) => {
      const audit = auditMessageVariablesAgainstLeads([`Oi {{${variavel}}}`], LEADS);

      expect(audit.heldLeadsCount).toBe(0);
      expect(audit.sendableLeadsCount).toBe(3);
      expect(audit.variableAudits).toEqual([]);
    }
  );

  it("campo que falta de verdade continua segurando, mesmo junto de {{primeiro_nome}}", () => {
    const audit = auditMessageVariablesAgainstLeads(["Oi {{primeiro_nome}}, plano {{plano}}"], LEADS);

    expect(audit.heldLeadsCount).toBe(3);
    expect(audit.variableAudits.map((v) => v.variable)).toEqual(["plano"]);
  });

  it.each(["primeiro_nome", "primeironome", "primeiro nome", "first_name", "firstname", " Primeiro_Nome "])(
    "prévia substitui {{%s}} pelo primeiro nome",
    (variavel) => {
      expect(renderPreviewNames(`Oi {{${variavel}}}!`)).toBe("Oi Maria!");
    }
  );

  it("prévia mantém {{nome}} como nome completo", () => {
    expect(renderPreviewNames("{{nome}} / {{primeiro_nome}}")).toBe("Maria Silva / Maria");
  });

  it("o aviso de leads segurados some da tela para {{primeiro_nome}}", () => {
    const props = {
      dispatchOptions: { evolutionInstanceId: null },
      setDispatchOptions: () => {},
      evolutionInstanceOptions: [],
      batchingEnabled: false,
      setBatchingEnabled: () => {},
      batchSize: "100",
      setBatchSize: () => {},
      batchIntervalHours: "1",
      setBatchIntervalHours: () => {},
      replyAgent: "passos",
      setReplyAgent: () => {},
      campaignAgentPrompt: "",
      setCampaignAgentPrompt: () => {},
      passosAposResposta: 0,
      multiAgendaEnabled: false,
      setMultiAgendaEnabled: () => {},
      consultants: [],
      loadingConsultants: false,
      activeClientId: "c",
      newConsultantName: "",
      setNewConsultantName: () => {},
      newConsultantLink: "",
      setNewConsultantLink: () => {},
      preDispatchAudit: auditMessageVariablesAgainstLeads(["Oi {{primeiro_nome}}"], LEADS),
    };
    render(<SchedulingStep {...(props as any)} />);

    expect(screen.queryByText(/serão segurados/)).not.toBeInTheDocument();
  });
});
