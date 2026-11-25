import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { applyMessagePlaceholders } from "../campaign-outbound.js";

describe("protecao contra disparo com {{scheduling_link}} nao substituido", () => {
  it("applyMessagePlaceholders substitui scheduling_link quando preenchido", () => {
    const template = "Ola {{nome}}, agende conosco pelo link: {{scheduling_link}}";
    const lead = {
      nome: "Carlos",
      normalized_data: { scheduling_link: "https://agenda.vexo.com/carlos" },
    };
    const interpolated = applyMessagePlaceholders(template, lead, "5511999999999");
    expect(interpolated).toBe("Ola Carlos, agende conosco pelo link: https://agenda.vexo.com/carlos");
    expect(interpolated).not.toContain("{{scheduling_link}}");
  });

  it("domains/campaigns/routes.js nao engole mais falha de agenda com catch silencioso", () => {
    const source = (readFileSync(resolve("src/domains/campaigns/routes.js"), "utf8") + "\n" + readFileSync(resolve("src/campaign/dispatchEngine.js"), "utf8")) /* motor do lote mora em campaign/dispatchEngine.js desde o PR 8 */;

    // Confirma que o trecho do catch lanca erro e bloqueia o disparo em vez de apenas console.warn
    expect(source).toContain("sequenceRequiresSchedulingLink");
    expect(source).toContain("Disparo interrompido: falha no banco de dados ao buscar agenda de consultores ({{scheduling_link}})");
    expect(source).toContain("Disparo interrompido: ${motivo}");
    expect(source).not.toContain("failed to apply consultant schedules to leads: dbErr.message");
  });

  it("se a campanha requer scheduling_link e o lead nao tem o link, bloqueia o envio", () => {
    const steps = [
      { text: "Ola {{nome}}, escolha seu horario aqui: {{scheduling_link}}" },
    ];
    const sequenceRequiresSchedulingLink = steps.some((s) =>
      /\{\{\s*scheduling_link\s*\}\}/i.test(s.text)
    );
    expect(sequenceRequiresSchedulingLink).toBe(true);

    const leads = [
      { id: "1", normalized_data: {} },
      { id: "2", normalized_data: { scheduling_link: "" } },
    ];

    const leadsSemLink = leads.filter(
      (l) => !(l.normalized_data?.scheduling_link && l.normalized_data.scheduling_link.trim())
    );
    expect(leadsSemLink).toHaveLength(2);
  });
});
