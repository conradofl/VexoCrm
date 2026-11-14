import { useEffect, useMemo, useState } from "react";
import type { DashboardPayload } from "@/hooks/useDashboard";
import {
  buildDirective,
  buildPlanActions,
  buildPlanFindings,
  choiceFor,
  readPlanChoices,
  weekLabel,
  writePlanChoices,
  type FindingKey,
  type PlanChoice,
  type PlanChoices,
} from "@/lib/dashboard/plan";

// Plano de ação: à esquerda o que o período mostrou (fato e número), à direita o plano que sai dali.
// O sistema não inventa responsável nem prazo: os dois nascem "definir" e quem preenche é a pessoa.

const CARD = "rounded-2xl border border-border bg-card";
const NOTE = "text-[12.5px] text-muted-foreground";
const HEAD = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";
const FIELD =
  "min-h-[44px] w-full rounded-md border px-2 text-[13px] text-foreground placeholder:font-bold placeholder:text-orange-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:placeholder:text-orange-300";
const FIELD_EMPTY = "border-dashed border-orange-300 bg-orange-50 dark:border-orange-500/50 dark:bg-orange-500/10";
const FIELD_FILLED = "border-border bg-background";
const COLUMNS = "minmax(0,2.2fr) minmax(0,1.9fr) 130px 120px minmax(0,1.2fr)";

interface PlanTabProps {
  data: DashboardPayload;
  clientId: string;
  companyName?: string;
}

export function PlanTab({ data, clientId, companyName }: PlanTabProps) {
  const findings = useMemo(() => buildPlanFindings(data), [data]);
  const [choices, setChoices] = useState<PlanChoices>(() => readPlanChoices(clientId));
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  // Trocar de empresa sem sair da tela: vale o que foi guardado para a empresa nova.
  useEffect(() => {
    setChoices(readPlanChoices(clientId));
    setCopied("idle");
  }, [clientId]);

  const update = (key: FindingKey, patch: Partial<PlanChoice>) => {
    const finding = findings.find((f) => f.key === key);
    if (!finding) return;
    const next = { ...choices, [key]: { ...choiceFor(finding, choices), ...patch } };
    setChoices(next);
    writePlanChoices(clientId, next);
    setCopied("idle");
  };

  const actions = useMemo(() => buildPlanActions(findings, choices), [findings, choices]);
  const checkedCount = actions.length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildDirective(actions, { companyName }));
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="tab-plan">
      <h2 className="text-xl font-bold text-foreground">Plano de ação · semana de {weekLabel()}</h2>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Esquerda: o que o sistema achou. Quem escolhe o que entra é a pessoa. */}
        <section className={`${CARD} flex flex-col gap-2.5 p-[18px]`} aria-label="O que o período mostrou" data-testid="plan-findings">
          <div>
            <h3 className="text-[15px] font-bold text-foreground">O que o período mostrou</h3>
            <p className={`${NOTE} mt-0.5`}>
              {findings.length === 0
                ? "Nenhum número deste período pede ação."
                : `Marque o que vira ação. ${checkedCount} de ${findings.length} ${findings.length === 1 ? "marcado" : "marcados"}.`}
            </p>
          </div>

          {findings.map((finding) => {
            const checked = choiceFor(finding, choices).checked;
            return (
              <label
                key={finding.key}
                className={`flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5 ${
                  checked ? "border-indigo-300 bg-indigo-50 dark:border-indigo-500/50 dark:bg-indigo-500/10" : "border-border bg-card"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => update(finding.key, { checked: event.target.checked })}
                  className="mt-0.5 h-4 w-4 flex-none accent-indigo-600"
                />
                <span className="min-w-0 text-[13px] leading-snug text-foreground">
                  <strong className="block break-words">{finding.title}</strong>
                  <span className="text-muted-foreground">{finding.detail}</span>
                </span>
              </label>
            );
          })}

          <span className="flex-1" />
          <p className="border-t border-border/60 pt-2.5 text-xs leading-relaxed text-muted-foreground">
            O sistema traz o fato e o número. Dono e prazo quem decide é você: ele não inventa responsável.
          </p>
        </section>

        {/* Direita: o plano, pronto para sair da tela */}
        <section className={`${CARD} flex min-w-0 flex-col gap-3.5 px-5 py-[18px]`} aria-label="Ações do plano" data-testid="plan-actions">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="min-w-0 flex-1 text-[15px] font-bold text-foreground">
              {checkedCount === 0 ? "Nenhuma ação marcada" : `${checkedCount} ${checkedCount === 1 ? "ação" : "ações"} para esta semana`}
            </h3>
            <button
              type="button"
              onClick={copy}
              disabled={checkedCount === 0}
              className="min-h-[44px] rounded-[9px] bg-indigo-600 px-3.5 text-[12.5px] font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Copiar como diretriz
            </button>
          </div>
          <p className={NOTE} role="status" aria-live="polite">
            {copied === "done"
              ? "Copiado. É o plano em texto corrido, pronto para colar no grupo da equipe."
              : copied === "failed"
              ? "Não foi possível copiar. O navegador bloqueou o acesso à área de transferência."
              : "O botão copia o plano em texto corrido, pronto para colar no grupo da equipe."}
          </p>

          {checkedCount === 0 ? (
            <p className={NOTE}>{findings.length === 0 ? "Sem achado, não há plano para montar." : "Marque ao lado o que vira ação."}</p>
          ) : (
            <div className="overflow-hidden rounded-[10px] border border-border" role="table" aria-label="Plano de ação">
              <div role="row" className="hidden gap-3 bg-muted/60 px-3.5 py-2.5 lg:grid" style={{ gridTemplateColumns: COLUMNS }}>
                {["Ação", "Por quê (o número)", "Dono", "Prazo", "Mede-se por"].map((header) => (
                  <span key={header} role="columnheader" className={HEAD}>
                    {header}
                  </span>
                ))}
              </div>
              {actions.map((action) => (
                <div
                  key={action.key}
                  role="row"
                  className="flex flex-col gap-2 border-t border-border/60 px-3.5 py-3.5 text-[13px] leading-snug first:border-t-0 lg:grid lg:items-start lg:gap-3 lg:border-t"
                  style={{ gridTemplateColumns: COLUMNS }}
                >
                  <span role="cell" className="font-semibold text-foreground">
                    {action.action}
                  </span>
                  <span role="cell" className="text-foreground/80">
                    <span className={`${HEAD} mb-0.5 block lg:hidden`}>Por quê</span>
                    {action.why}
                  </span>
                  <span role="cell">
                    <label className={`${HEAD} mb-0.5 block lg:sr-only`} htmlFor={`plan-owner-${action.key}`}>
                      Dono
                    </label>
                    <input
                      id={`plan-owner-${action.key}`}
                      type="text"
                      value={action.owner}
                      placeholder="definir"
                      maxLength={60}
                      onChange={(event) => update(action.key, { owner: event.target.value })}
                      className={`${FIELD} ${action.owner ? FIELD_FILLED : FIELD_EMPTY}`}
                    />
                  </span>
                  <span role="cell">
                    <label className={`${HEAD} mb-0.5 block lg:sr-only`} htmlFor={`plan-due-${action.key}`}>
                      Prazo
                    </label>
                    <input
                      id={`plan-due-${action.key}`}
                      type="text"
                      value={action.due}
                      placeholder="definir"
                      maxLength={40}
                      onChange={(event) => update(action.key, { due: event.target.value })}
                      className={`${FIELD} ${action.due ? FIELD_FILLED : FIELD_EMPTY}`}
                    />
                  </span>
                  <span role="cell" className="text-muted-foreground">
                    <span className={`${HEAD} mb-0.5 block lg:hidden`}>Mede-se por</span>
                    {action.metric}
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className={NOTE} data-testid="plan-storage-note">
            O plano fica salvo só neste navegador. Outra pessoa, ou você em outro computador, não vê o que foi marcado aqui.
          </p>
        </section>
      </div>
    </div>
  );
}
