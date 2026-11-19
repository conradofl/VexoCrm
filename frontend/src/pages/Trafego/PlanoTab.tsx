// Aba Plano e aprovações (Fase 2, conselheiro): o plano do dia com número e
// motivo de cada item, aprovação pelos dois lados (gestor da GD E cliente),
// lista "aplicar à mão" e histórico.
//
// Nada daqui é aplicado em plataforma. Quem aplica é uma pessoa, no
// gerenciador de anúncios, e marca feito aqui. Os botões de aprovar seguem o
// papel de quem está logado (pelo email na lista de aprovadores); o servidor
// confere de novo e recusa o que não vale.
import { useState } from "react";
import { CheckCircle2, ClipboardCheck, History, Info, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DECISION_LABELS,
  formatDateTime,
  formatKpi,
  formatMoney,
  useApproveTrafficPlanItem,
  useGenerateTrafficPlan,
  useMarkTrafficPlanItemApplied,
  useRejectTrafficPlanItem,
  useTrafficPlanHistory,
  useTrafficPlanToday,
  type TrafficApproverRole,
  type TrafficPlanAction,
  type TrafficPlanItem,
  type TrafficPlanItemStatus,
  type TrafficPlanToday,
} from "@/hooks/useTraffic";

const ACTION_LABEL: Record<TrafficPlanAction, string> = {
  pausar: "Pausar",
  reduzir_verba: "Reduzir verba",
  aumentar_verba: "Aumentar verba",
  manter: "Manter",
};

const ACTION_STYLE: Record<TrafficPlanAction, string> = {
  pausar: "bg-red-600 text-white",
  reduzir_verba: "bg-amber-500 text-black",
  aumentar_verba: "bg-emerald-600 text-white",
  manter: "bg-slate-600 text-white",
};

const STATUS_LABEL: Record<TrafficPlanItemStatus, string> = {
  proposto: "Esperando as duas aprovações",
  aprovado_gd: "Aprovado pela GD, falta o cliente",
  aprovado_cliente: "Aprovado pelo cliente, falta a GD",
  aprovado: "Aprovado pelos dois",
  recusado: "Recusado",
  expirado: "Expirou sem aprovação",
};

const STATUS_STYLE: Record<TrafficPlanItemStatus, string> = {
  proposto: "border bg-muted text-foreground",
  aprovado_gd: "border border-sky-500/50 bg-sky-500/10 text-foreground",
  aprovado_cliente: "border border-sky-500/50 bg-sky-500/10 text-foreground",
  aprovado: "bg-emerald-600 text-white",
  recusado: "bg-red-600 text-white",
  expirado: "border bg-muted text-muted-foreground",
};

// Histórico: rótulo curto, para caber numa linha.
const HISTORY_LABEL: Record<TrafficPlanItemStatus, string> = {
  proposto: "esperando aprovação",
  aprovado_gd: "só a GD aprovou",
  aprovado_cliente: "só o cliente aprovou",
  aprovado: "aprovado pelos dois",
  recusado: "recusado",
  expirado: "expirado",
};

const ROLE_LABEL: Record<TrafficApproverRole, string> = { gestor_gd: "GD", cliente: "cliente" };
const LEVEL_LABEL = { campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" } as const;
const PENDING: TrafficPlanItemStatus[] = ["proposto", "aprovado_gd", "aprovado_cliente"];

function dateBr(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function Stamp({ label, stamp }: { label: string; stamp: { email: string | null; at: string } | null }) {
  return (
    <p className="min-w-0 break-words text-xs">
      <span className="text-muted-foreground">{label}: </span>
      {stamp ? (
        <span>
          {stamp.email || "sem email"} em {formatDateTime(stamp.at)}
        </span>
      ) : (
        <span className="text-muted-foreground">pendente</span>
      )}
    </p>
  );
}

function ItemCard({
  item,
  myRoles,
  clientId,
}: {
  item: TrafficPlanItem;
  myRoles: TrafficApproverRole[];
  clientId: string;
}) {
  const approve = useApproveTrafficPlanItem(clientId);
  const reject = useRejectTrafficPlanItem(clientId);
  const [rejecting, setRejecting] = useState<TrafficApproverRole | null>(null);
  const [reason, setReason] = useState("");

  const pending = PENDING.includes(item.status);
  const canApprove = (role: TrafficApproverRole) =>
    pending && myRoles.includes(role) && !item.approvals[role];
  const rejectRole = myRoles.find((role) => !item.approvals[role]) || myRoles[0];
  const busy = approve.isPending || reject.isPending;

  const doApprove = async (role: TrafficApproverRole) => {
    try {
      await approve.mutateAsync({ id: item.id, role });
      toast.success(role === "gestor_gd" ? "Aprovado pelo lado da GD." : "Aprovado pelo lado do cliente.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const doReject = async () => {
    if (!rejecting) return;
    try {
      await reject.mutateAsync({ id: item.id, role: rejecting, reason });
      toast.success("Item recusado.");
      setRejecting(null);
      setReason("");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const hasValues = item.action === "aumentar_verba" || item.action === "reduzir_verba";

  return (
    <li className="space-y-3 rounded-xl border p-3" data-testid="item-plano" data-status={item.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_STYLE[item.action]}`}>
              {ACTION_LABEL[item.action]}
            </span>
            <span className="text-xs text-muted-foreground">
              {LEVEL_LABEL[item.level]} · {item.platform === "meta" ? "Meta" : "Google"}
            </span>
          </div>
          <p className="mt-1 break-words text-sm font-medium">{item.entityName || `${LEVEL_LABEL[item.level]} ${item.entityId}`}</p>
          {item.level !== "campaign" && item.campaignName && (
            <p className="break-words text-xs text-muted-foreground">Campanha: {item.campaignName}</p>
          )}
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[item.status]}`}>
          {STATUS_LABEL[item.status]}
        </span>
      </div>

      {hasValues && (
        <p className="text-sm tabular-nums" data-testid="valores">
          Verba diária: <span className="font-medium">{formatMoney(item.currentValue)}</span> →{" "}
          <span className="font-medium">{formatMoney(item.proposedValue)}</span>
        </p>
      )}
      <p className="break-words text-sm" data-testid="motivo">{item.reason}</p>
      <p className="text-xs text-muted-foreground">
        Decisão: {item.decision ? DECISION_LABELS[item.decision] : "sem decisão"} · janela {dateBr(item.window.since)} a {dateBr(item.window.until)}
        {pending ? ` · vence ${formatDateTime(item.expiresAt)}` : ""}
      </p>

      <div className="grid gap-1 sm:grid-cols-2">
        <Stamp label="GD" stamp={item.approvals.gestor_gd} />
        <Stamp label="Cliente" stamp={item.approvals.cliente} />
      </div>
      {item.rejection && (
        <p className="break-words rounded-lg bg-red-500/10 p-2 text-xs">
          Recusado pelo lado {item.rejection.role === "gestor_gd" ? "da GD" : "do cliente"} ({item.rejection.email}) em{" "}
          {formatDateTime(item.rejection.at)}: {item.rejection.reason}
        </p>
      )}

      {pending && myRoles.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {(["gestor_gd", "cliente"] as TrafficApproverRole[])
              .filter((role) => canApprove(role))
              .map((role) => (
                <Button key={role} size="sm" disabled={busy} onClick={() => doApprove(role)}>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Aprovar como {ROLE_LABEL[role]}
                </Button>
              ))}
            {!rejecting && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(rejectRole)}>
                <XCircle className="mr-1.5 h-4 w-4" /> Recusar
              </Button>
            )}
          </div>
          {rejecting && (
            <div className="space-y-2">
              <Textarea
                aria-label="Motivo da recusa"
                placeholder="Motivo da recusa (obrigatório)"
                rows={2}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="destructive" disabled={busy || reason.trim().length < 5} onClick={doReject}>
                  Confirmar recusa
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ApplyQueue({ items, clientId }: { items: TrafficPlanItem[]; clientId: string }) {
  const applied = useMarkTrafficPlanItemApplied(clientId);
  const markDone = async (id: string) => {
    try {
      await applied.mutateAsync({ id });
      toast.success("Marcado como aplicado.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <section className="rounded-2xl border bg-card/60 p-4" aria-labelledby="aplicar-a-mao">
      <h2 id="aplicar-a-mao" className="flex items-center gap-2 font-medium">
        <ClipboardCheck className="h-4 w-4" /> Aplicar à mão
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Só entra aqui o que a GD e o cliente aprovaram. Aplique no gerenciador de anúncios e marque feito.
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nada aprovado pelos dois para aplicar.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3" data-testid="aplicar-item">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">
                  {ACTION_LABEL[item.action]}: {item.entityName || item.entityId}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.action === "aumentar_verba" || item.action === "reduzir_verba"
                    ? `Verba diária ${formatMoney(item.currentValue)} → ${formatMoney(item.proposedValue)} · `
                    : ""}
                  {item.platform === "meta" ? "Meta" : "Google"}
                  {item.level !== "campaign" && item.campaignName ? ` · ${item.campaignName}` : ""}
                </p>
              </div>
              {item.applied ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  Feito por {item.applied.email} em {formatDateTime(item.applied.at)}
                </p>
              ) : (
                <Button size="sm" variant="outline" disabled={applied.isPending} onClick={() => markDone(item.id)}>
                  Marcar feito
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PlanHistory({ clientId }: { clientId: string }) {
  const history = useTrafficPlanHistory(clientId);
  const plans = history.data?.plans || [];
  return (
    <section className="rounded-2xl border bg-card/60 p-4" aria-labelledby="historico-planos">
      <h2 id="historico-planos" className="flex items-center gap-2 font-medium">
        <History className="h-4 w-4" /> Histórico
      </h2>
      {history.isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Carregando...</p>
      ) : history.isError ? (
        <p className="mt-3 text-sm text-destructive">{(history.error as Error)?.message}</p>
      ) : plans.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum plano gerado ainda.</p>
      ) : (
        <ul className="mt-3 divide-y">
          {plans.map((plan) => (
            <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid="historico-plano">
              <span className="font-medium">{dateBr(plan.date)}</span>
              <span className="min-w-0 break-words text-xs text-muted-foreground">
                {(Object.keys(HISTORY_LABEL) as TrafficPlanItemStatus[])
                  .filter((status) => plan.counts[status])
                  .map((status) => `${plan.counts[status]} ${HISTORY_LABEL[status]}`)
                  .join(" · ") || "sem item"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PlanHeader({ data, clientId, onGoToTab }: { data: TrafficPlanToday; clientId: string; onGoToTab: (tab: string) => void }) {
  const generate = useGenerateTrafficPlan(clientId);
  const run = async () => {
    try {
      await generate.mutateAsync();
      toast.success("Plano do dia gerado.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (data.autonomyLevel === "relatorio") {
    return (
      <div className="flex items-start gap-3 rounded-2xl border bg-card/60 p-4" role="status">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
        <div className="min-w-0 text-sm">
          <p className="font-medium">O perfil desta empresa está em "Relatório".</p>
          <p className="mt-1 text-muted-foreground">
            Nesse nível o Vexo só mostra a decisão no Desempenho e não monta plano. Para receber o plano do dia, mude o nível para "Sugere e pede
            aprovação" em Metas e regras.
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => onGoToTab("metas")}>
            Abrir Metas e regras
          </Button>
        </div>
      </div>
    );
  }

  if (!data.plan) {
    return (
      <div className="rounded-2xl border bg-card/60 p-4 text-sm" role="status">
        <p className="font-medium">Ainda não há plano hoje.</p>
        <p className="mt-1 text-muted-foreground">
          O plano nasce sozinho depois da coleta das 7h, 13h e 19h. Também dá para gerar agora; sem coleta nova desde o último plano, o Vexo
          não gera e diz por quê.
        </p>
        <Button size="sm" className="mt-3" disabled={generate.isPending} onClick={run}>
          <RefreshCw className="mr-1.5 h-4 w-4" /> {generate.isPending ? "Gerando..." : "Gerar plano agora"}
        </Button>
      </div>
    );
  }

  const caps = data.plan.summary.caps;
  return (
    <div className="rounded-2xl border bg-card/60 p-4 text-sm">
      <p className="font-medium">Plano de {dateBr(data.plan.date)}</p>
      <p className="mt-1 break-words text-muted-foreground">
        {data.plan.summary.primaryKpiLabel || data.plan.primaryKpi} contra a meta de {formatKpi(data.plan.summary.target ?? null, data.plan.summary.primaryKpiUnit ?? null)} · janela de{" "}
        {data.plan.windowDays} dias ({dateBr(data.plan.window.since)} a {dateBr(data.plan.window.until)}) · coleta de{" "}
        {formatDateTime(data.plan.dataCollectedAt)} · gerado {data.plan.generatedBy === "agendador" ? "pelo agendador" : "à mão"} em{" "}
        {formatDateTime(data.plan.generatedAt)}
      </p>
      {caps && (
        <p className="mt-1 break-words text-xs text-muted-foreground">
          Verbas diárias somam {formatMoney(caps.currentTotal)}
          {caps.effective !== null ? ` · teto em vigor ${formatMoney(caps.effective)} por dia` : " · sem teto no perfil"}
          {` · aumento máximo ${data.plan.summary.maxIncreasePct ?? 0}% · mínimo ${formatMoney(data.plan.summary.minDailyBudget ?? 10)} por dia`}
          {caps.shortfall ? ` · mesmo reduzindo, faltam ${formatMoney(caps.shortfall)} para caber no teto` : ""}
        </p>
      )}
    </div>
  );
}

export function PlanoTab({ clientId, onGoToTab }: { clientId: string; onGoToTab: (tab: string) => void }) {
  const today = useTrafficPlanToday(clientId);

  if (today.isLoading) {
    return <div className="rounded-2xl border bg-card/60 p-8 text-center text-sm text-muted-foreground">Carregando o plano...</div>;
  }
  if (today.isError || !today.data) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm" role="alert">
        <p className="font-medium text-destructive">Não foi possível carregar o plano do dia.</p>
        <p className="mt-1 text-muted-foreground">{(today.error as Error)?.message}</p>
      </div>
    );
  }

  const data = today.data;
  const skipped = data.plan?.summary.skipped || [];

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-2xl border border-sky-500/40 bg-sky-500/5 p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <span className="min-w-0">
          Nada é aplicado nas plataformas. Cada item precisa da GD e do cliente, por pessoas diferentes, em até 24 horas. Aprovado pelos dois vai
          para "Aplicar à mão".
        </span>
      </p>

      <PlanHeader data={data} clientId={clientId} onGoToTab={onGoToTab} />

      {data.plan && data.myRoles.length === 0 && (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm" role="status">
          Seu email não está na lista de aprovadores desta empresa: você vê o plano, mas não aprova. A lista fica em Metas e regras.
        </p>
      )}

      {data.plan && (
        <section aria-labelledby="itens-do-plano">
          <h2 id="itens-do-plano" className="sr-only">
            Itens do plano
          </h2>
          {data.items.length === 0 ? (
            <p className="rounded-2xl border bg-card/60 p-4 text-sm text-muted-foreground">Nenhuma ação proposta hoje. O motivo de cada campanha está abaixo.</p>
          ) : (
            <ul className="space-y-3">
              {data.items.map((item) => (
                <ItemCard key={item.id} item={item} myRoles={data.myRoles} clientId={clientId} />
              ))}
            </ul>
          )}
        </section>
      )}

      {skipped.length > 0 && (
        <details className="rounded-2xl border bg-card/60 p-4" data-testid="fora-do-plano">
          <summary className="cursor-pointer text-sm font-medium">Fora do plano e por quê ({skipped.length})</summary>
          <ul className="mt-3 space-y-2">
            {skipped.map((entry, index) => (
              <li key={`${entry.campaignId}-${index}`} className="break-words text-sm">
                <span className="font-medium">{entry.campaignName || entry.campaignId || "Sem campanha"}</span>
                <span className="text-muted-foreground"> · {entry.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ApplyQueue items={data.applyQueue} clientId={clientId} />
      <PlanHistory clientId={clientId} />
    </div>
  );
}
