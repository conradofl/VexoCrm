import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardPayload, DashboardPeriod, DashboardRange } from "@/hooks/useDashboard";
import { useDashboardPlan, useDownloadPlanSheet, useSaveDashboardPlan, type SavePlanVariables } from "@/hooks/useDashboardPlan";
import {
  PLAN_EXPORT_KEYS,
  buildDirective,
  buildItemsToSave,
  buildPlanActions,
  buildPlanFindings,
  choiceFor,
  choicesFromItems,
  describeFollowUp,
  planItemId,
  storedOnlyItems,
  weekLabel,
  weekLabelFromIso,
  type DashboardPlanResponse,
  type PlanChoice,
  type PlanChoices,
  type PlanExportList,
  type PlanFinding,
  type PlanItemInput,
} from "@/lib/dashboard/plan";

// Plano de ação: à esquerda o que o período mostrou (fato e número), à direita o plano que sai dali.
// O sistema não inventa responsável nem prazo: os dois nascem "definir" e quem preenche é a pessoa.
// O plano mora no servidor, um por empresa por semana. Só a equipe Vexo edita; o cliente vê.

const CARD = "rounded-2xl border border-border bg-card";
const NOTE = "text-[12.5px] text-muted-foreground";
const HEAD = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";
const FIELD =
  "min-h-[44px] w-full rounded-md border px-2 text-[13px] text-foreground placeholder:font-bold placeholder:text-orange-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-70 dark:placeholder:text-orange-300";
const FIELD_EMPTY = "border-dashed border-orange-300 bg-orange-50 dark:border-orange-500/50 dark:bg-orange-500/10";
const FIELD_FILLED = "border-border bg-background";
const COLUMNS = "minmax(0,2.2fr) minmax(0,1.9fr) 130px 120px minmax(0,1.2fr)";
const SAVE_DELAY_MS = 700;

export type PlanServerState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "unavailable" }
  | { status: "ready"; plan: DashboardPlanResponse };

export type PlanSaveState = { status: "idle" } | { status: "saving" } | { status: "saved"; at: string | null } | { status: "failed"; message: string };

interface PlanTabProps {
  data: DashboardPayload;
  clientId: string;
  companyName?: string;
  period?: DashboardPeriod;
  range?: DashboardRange | null;
}

/** Liga o quadro ao servidor: lê o plano da semana, grava (com espera curta entre teclas) e baixa a planilha. */
export function PlanTab({ data, clientId, companyName, period = "30d", range = null }: PlanTabProps) {
  const query = useDashboardPlan(clientId, period, range);
  const save = useSaveDashboardPlan();
  const download = useDownloadPlanSheet(clientId);
  const [saveState, setSaveState] = useState<PlanSaveState>({ status: "idle" });
  // O que espera para ser gravado leva a empresa e o período de quando foi digitado.
  const pending = useRef<SavePlanVariables | null>(null);
  const timer = useRef<number | null>(null);
  const mutate = useRef(save.mutate);
  mutate.current = save.mutate;
  const current = useRef({ clientId, period, range });
  current.current = { clientId, period, range };

  const server: PlanServerState = query.isLoading
    ? { status: "loading" }
    : query.error
    ? { status: "error", message: (query.error as Error).message }
    : query.data?.status === "unavailable"
    ? { status: "unavailable" }
    : query.data?.status === "ready"
    ? { status: "ready", plan: query.data.plan }
    : { status: "loading" };

  const flush = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const variables = pending.current;
    pending.current = null;
    if (!variables) return;
    const isOnScreen = () => current.current.clientId === variables.clientId;
    if (isOnScreen()) setSaveState({ status: "saving" });
    mutate.current(variables, {
      onSuccess: (saved) => isOnScreen() && setSaveState({ status: "saved", at: saved?.updatedAt ?? null }),
      onError: (err) => {
        if (!isOnScreen()) return;
        // Sem perder o que foi digitado: fica guardado para o "tentar de novo".
        pending.current = pending.current ?? variables;
        setSaveState({ status: "failed", message: err instanceof Error ? err.message : "Não foi possível salvar o plano." });
      },
    });
  }, []);

  const onChange = useCallback(
    (items: PlanItemInput[]) => {
      pending.current = { ...current.current, items };
      setSaveState({ status: "saving" });
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush]
  );

  // Trocar de empresa ou sair da aba com gravação pendente: grava antes, na empresa em que foi digitado.
  useEffect(() => {
    setSaveState({ status: "idle" });
    return () => flush();
  }, [clientId, flush]);

  return (
    <PlanBoard
      data={data}
      clientId={clientId}
      companyName={companyName}
      server={server}
      saveState={saveState}
      onChange={onChange}
      onRetry={flush}
      onDownload={download}
    />
  );
}

interface PlanBoardProps {
  data: DashboardPayload;
  clientId: string;
  companyName?: string;
  server: PlanServerState;
  saveState: PlanSaveState;
  onChange: (items: PlanItemInput[]) => void;
  onRetry: () => void;
  onDownload: (list: PlanExportList) => Promise<void>;
}

const formatSavedAt = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

export function PlanBoard({ data, clientId, companyName, server, saveState, onChange, onRetry, onDownload }: PlanBoardProps) {
  const findings = useMemo(() => buildPlanFindings(data), [data]);
  const plan = server.status === "ready" ? server.plan : null;
  const storedItems = plan?.current?.items ?? null;
  const [choices, setChoices] = useState<PlanChoices>(() => choicesFromItems(storedItems));
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [sheet, setSheet] = useState<{ list: PlanExportList; status: "loading" | "failed"; message?: string } | null>(null);

  // O plano salvo chega depois do primeiro desenho, e outra empresa tem outro plano: vale o que veio do servidor.
  const loadedKey = `${clientId}|${plan?.weekStart ?? ""}|${server.status}`;
  const lastLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (lastLoaded.current === loadedKey) return;
    lastLoaded.current = loadedKey;
    setChoices(choicesFromItems(storedItems));
    setCopied("idle");
    setSheet(null);
  }, [loadedKey, storedItems]);

  const canEdit = server.status === "ready" ? server.plan.canEdit : server.status === "unavailable";
  const canExport = plan?.canExport ?? false;
  const stored = useMemo(() => storedOnlyItems(findings, storedItems), [findings, storedItems]);

  const update = (finding: Pick<PlanFinding, "key" | "subject" | "checkedByDefault">, patch: Partial<PlanChoice>) => {
    if (!canEdit) return;
    const id = planItemId(finding.key, finding.subject);
    const next = { ...choices, [id]: { ...choiceFor(finding, choices), ...patch } };
    setChoices(next);
    setCopied("idle");
    if (server.status === "ready") onChange(buildItemsToSave(findings, next, stored));
  };

  const actions = useMemo(() => buildPlanActions(findings, choices, stored), [findings, choices, stored]);
  const checkedCount = actions.length;
  const actionSource = (id: string) =>
    findings.find((f) => planItemId(f.key, f.subject) === id) ?? stored.map((s) => ({ ...s, checkedByDefault: s.checked })).find((s) => planItemId(s.key, s.subject) === id);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildDirective(actions, { companyName }));
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };

  const downloadSheet = async (list: PlanExportList) => {
    setSheet({ list, status: "loading" });
    try {
      await onDownload(list);
      setSheet(null);
    } catch (err) {
      setSheet({ list, status: "failed", message: err instanceof Error ? err.message : "Não foi possível baixar a planilha." });
    }
  };

  const followUp = plan?.previous && plan.previous.items.length > 0 ? plan.previous : null;
  const savedAt = saveState.status === "saved" ? formatSavedAt(saveState.at) : null;

  return (
    <div className="flex flex-col gap-4" data-testid="tab-plan">
      <h2 className="text-xl font-bold text-foreground">Plano de ação · semana de {plan ? weekLabelFromIso(plan.weekStart) : weekLabel()}</h2>

      {followUp && (
        <section className={`${CARD} flex flex-col gap-3 p-[18px]`} aria-label="O que foi combinado na semana anterior" data-testid="plan-followup">
          <div>
            <h3 className="text-[15px] font-bold text-foreground">Semana de {weekLabelFromIso(followUp.weekStart)}: o que foi combinado</h3>
            <p className={`${NOTE} mt-0.5`}>O número do dia em que entrou no plano, ao lado do número de hoje.</p>
          </div>
          <ul className="flex flex-col gap-2.5">
            {followUp.items.map((item) => (
              <li key={planItemId(item.key, item.subject)} className="rounded-[10px] border border-border px-3.5 py-3 text-[13px] leading-snug" data-testid="plan-followup-item">
                <p className="text-foreground">
                  Você combinou: <strong className="break-words">{item.action}</strong>
                </p>
                <p className="text-muted-foreground">
                  Dono: {item.owner || "a definir"} · Prazo: {item.due || "a definir"}
                </p>
                <p className="mt-1 font-semibold text-foreground">{describeFollowUp(item)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Esquerda: o que o sistema achou. Quem escolhe o que entra é a pessoa. */}
        <section className={`${CARD} flex flex-col gap-2.5 p-[18px]`} aria-label="O que o período mostrou" data-testid="plan-findings">
          <div>
            <h3 className="text-[15px] font-bold text-foreground">O que o período mostrou</h3>
            <p className={`${NOTE} mt-0.5`}>
              {findings.length === 0
                ? "Nenhum número deste período pede ação."
                : `${canEdit ? "Marque o que vira ação. " : ""}${actions.filter((a) => findings.some((f) => planItemId(f.key, f.subject) === a.id)).length} de ${findings.length} ${findings.length === 1 ? "marcado" : "marcados"}.`}
            </p>
          </div>

          {findings.map((finding) => {
            const checked = choiceFor(finding, choices).checked;
            const exportable = canExport && PLAN_EXPORT_KEYS.includes(finding.key);
            const list = finding.key as PlanExportList;
            return (
              <div key={planItemId(finding.key, finding.subject)} className="flex flex-col gap-1.5">
                <label
                  className={`flex min-h-[44px] items-start gap-2.5 rounded-[10px] border px-3 py-2.5 ${canEdit ? "cursor-pointer" : "cursor-default"} ${
                    checked ? "border-indigo-300 bg-indigo-50 dark:border-indigo-500/50 dark:bg-indigo-500/10" : "border-border bg-card"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!canEdit}
                    onChange={(event) => update(finding, { checked: event.target.checked })}
                    className="mt-0.5 h-4 w-4 flex-none accent-indigo-600"
                  />
                  <span className="min-w-0 text-[13px] leading-snug text-foreground">
                    <strong className="block break-words">{finding.title}</strong>
                    <span className="text-muted-foreground">{finding.detail}</span>
                  </span>
                </label>
                {exportable && (
                  <div className="flex flex-wrap items-center gap-2 pl-1">
                    <button
                      type="button"
                      onClick={() => downloadSheet(list)}
                      disabled={sheet?.status === "loading"}
                      className="min-h-[44px] rounded-[9px] border border-border bg-background px-3 text-[12.5px] font-semibold text-foreground hover:bg-muted/50 disabled:cursor-wait disabled:opacity-60"
                      data-testid={`plan-sheet-${list}`}
                    >
                      {sheet?.list === list && sheet.status === "loading" ? "Montando a planilha…" : "Baixar planilha (nome e telefone)"}
                    </button>
                    {sheet?.list === list && sheet.status === "failed" && (
                      <span role="alert" className="text-[12px] text-red-600 dark:text-red-400">
                        {sheet.message}
                      </span>
                    )}
                  </div>
                )}
              </div>
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
            <p className={NOTE}>{findings.length === 0 ? "Sem achado, não há plano para montar." : canEdit ? "Marque ao lado o que vira ação." : "Nenhuma ação combinada ainda."}</p>
          ) : (
            <div className="overflow-hidden rounded-[10px] border border-border" role="table" aria-label="Plano de ação">
              <div role="row" className="hidden gap-3 bg-muted/60 px-3.5 py-2.5 lg:grid" style={{ gridTemplateColumns: COLUMNS }}>
                {["Ação", "Por quê (o número)", "Dono", "Prazo", "Mede-se por"].map((header) => (
                  <span key={header} role="columnheader" className={HEAD}>
                    {header}
                  </span>
                ))}
              </div>
              {actions.map((action) => {
                const source = actionSource(action.id);
                return (
                  <div
                    key={action.id}
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
                      <label className={`${HEAD} mb-0.5 block lg:sr-only`} htmlFor={`plan-owner-${action.id}`}>
                        Dono
                      </label>
                      <input
                        id={`plan-owner-${action.id}`}
                        type="text"
                        value={action.owner}
                        placeholder={canEdit ? "definir" : "a definir"}
                        maxLength={60}
                        disabled={!canEdit}
                        onChange={(event) => source && update(source, { owner: event.target.value })}
                        className={`${FIELD} ${action.owner || !canEdit ? FIELD_FILLED : FIELD_EMPTY}`}
                      />
                    </span>
                    <span role="cell">
                      <label className={`${HEAD} mb-0.5 block lg:sr-only`} htmlFor={`plan-due-${action.id}`}>
                        Prazo
                      </label>
                      <input
                        id={`plan-due-${action.id}`}
                        type="text"
                        value={action.due}
                        placeholder={canEdit ? "definir" : "a definir"}
                        maxLength={40}
                        disabled={!canEdit}
                        onChange={(event) => source && update(source, { due: event.target.value })}
                        className={`${FIELD} ${action.due || !canEdit ? FIELD_FILLED : FIELD_EMPTY}`}
                      />
                    </span>
                    <span role="cell" className="text-muted-foreground">
                      <span className={`${HEAD} mb-0.5 block lg:hidden`}>Mede-se por</span>
                      {action.metric}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <PlanStorageNote server={server} saveState={saveState} savedAt={savedAt} onRetry={onRetry} />
        </section>
      </div>
    </div>
  );
}

function PlanStorageNote({
  server,
  saveState,
  savedAt,
  onRetry,
}: {
  server: PlanServerState;
  saveState: PlanSaveState;
  savedAt: string | null;
  onRetry: () => void;
}) {
  if (server.status === "loading") {
    return (
      <p className={NOTE} data-testid="plan-storage-note">
        Carregando o plano salvo…
      </p>
    );
  }
  if (server.status === "error") {
    return (
      <p className={NOTE} data-testid="plan-storage-note" role="alert">
        Não foi possível carregar o plano salvo agora. Nada do que aparece aqui foi gravado.
      </p>
    );
  }
  if (server.status === "unavailable") {
    return (
      <p className={NOTE} data-testid="plan-storage-note">
        O plano ainda não pode ser salvo no servidor. O que for marcado agora vale só nesta visita.
      </p>
    );
  }
  if (!server.plan.canEdit) {
    return (
      <p className={NOTE} data-testid="plan-storage-note">
        Só a equipe Vexo edita este plano. Aqui você vê o que foi combinado.
      </p>
    );
  }
  if (saveState.status === "failed") {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="plan-storage-note" role="alert">
        <p className="text-[12.5px] text-red-600 dark:text-red-400">{saveState.message} O que você digitou continua na tela.</p>
        <button
          type="button"
          onClick={onRetry}
          className="min-h-[44px] rounded-[9px] border border-border px-3 text-[12.5px] font-semibold text-foreground hover:bg-muted/50"
        >
          Tentar de novo
        </button>
      </div>
    );
  }
  return (
    <p className={NOTE} data-testid="plan-storage-note">
      {saveState.status === "saving"
        ? "Salvando…"
        : savedAt
        ? `Salvo às ${savedAt}. Quem abrir o Dashboard desta empresa vê este plano.`
        : "O plano fica salvo para a empresa: quem abrir o Dashboard desta empresa vê este plano."}
    </p>
  );
}
