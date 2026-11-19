// Aba Metas e regras: o perfil da empresa. Nível de autonomia aparece com as
// três opções; habilitadas só as que o servidor diz estarem disponíveis
// (Fase 2: Relatório e Sugere). O servidor recusa "aplica" de qualquer forma.
import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  useSaveTrafficProfile,
  useTrafficProfile,
  type TrafficApprover,
  type TrafficAutonomy,
  type TrafficProfileResponse,
} from "@/hooks/useTraffic";

type KpiRow = { enabled: boolean; target: string; scalePct: string; killPct: string; minSpend: string };

const AUTONOMY_TEXT: Record<TrafficAutonomy, { label: string; description: string }> = {
  relatorio: { label: "Relatório", description: "O Vexo lê, compara com as metas e mostra a decisão sugerida. Nada é alterado." },
  sugere: { label: "Sugere e pede aprovação", description: "Monta o plano do dia e pede aprovação do gestor e do cliente." },
  aplica_com_limites: { label: "Aplica dentro dos limites", description: "Pausa e ajusta verba sozinho, dentro dos tetos, depois das duas aprovações." },
};

const SELECT_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function toText(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value).replace(".", ",");
}

function toNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // "1.234,5" (padrão brasileiro) e "1234.5" valem os dois; ponto só é milhar quando há vírgula.
  return Number(trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed);
}

function pctText(fraction: number) {
  return String(Math.round(fraction * 10000) / 100).replace(".", ",");
}

function initialRows(data: TrafficProfileResponse): Record<string, KpiRow> {
  const rows: Record<string, KpiRow> = {};
  for (const definition of data.catalog) {
    const saved = data.profile.kpis.find((kpi) => kpi.key === definition.key);
    rows[definition.key] = {
      enabled: Boolean(saved),
      target: toText(saved?.target),
      scalePct: pctText(saved?.scale_at ?? 0.2),
      killPct: pctText(saved?.kill_at ?? 0.5),
      minSpend: toText(saved?.min_spend),
    };
  }
  return rows;
}

export function MetasTab({ clientId }: { clientId: string }) {
  const { data, isLoading, isError, error } = useTrafficProfile(clientId);
  const save = useSaveTrafficProfile(clientId);

  const [objectives, setObjectives] = useState("");
  const [rows, setRows] = useState<Record<string, KpiRow>>({});
  const [primaryKpi, setPrimaryKpi] = useState<string>("");
  const [windows, setWindows] = useState<number[]>([]);
  const [minSpendFactor, setMinSpendFactor] = useState("");
  const [dailyCap, setDailyCap] = useState("");
  const [monthlyCap, setMonthlyCap] = useState("");
  const [maxIncrease, setMaxIncrease] = useState("");
  const [approvers, setApprovers] = useState<TrafficApprover[]>([]);
  const [autonomy, setAutonomy] = useState<TrafficAutonomy>("relatorio");

  useEffect(() => {
    if (!data) return;
    const p = data.profile;
    setObjectives(p.objectives.join("\n"));
    setRows(initialRows(data));
    setPrimaryKpi(p.primaryKpi || "");
    setWindows(p.windows);
    setMinSpendFactor(toText(p.minSpendFactor));
    setDailyCap(toText(p.dailyBudgetCap));
    setMonthlyCap(toText(p.monthlyBudgetCap));
    setMaxIncrease(toText(p.maxIncreasePct));
    setApprovers(p.approvers);
    setAutonomy(p.autonomyLevel);
  }, [data]);

  if (isLoading) {
    return <div className="rounded-2xl border bg-card/60 p-8 text-center text-sm text-muted-foreground">Carregando metas...</div>;
  }
  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm" role="alert">
        <p className="font-medium text-destructive">Não foi possível carregar metas e regras.</p>
        <p className="mt-1 text-muted-foreground">{(error as Error)?.message}</p>
      </div>
    );
  }

  const setRow = (key: string, patch: Partial<KpiRow>) =>
    setRows((current) => ({ ...current, [key]: { ...current[key], ...patch } }));

  const toggleKpi = (key: string, enabled: boolean) => {
    setRow(key, { enabled });
    if (!enabled && primaryKpi === key) setPrimaryKpi("");
  };

  const submit = async () => {
    try {
      await save.mutateAsync({
        objectives: objectives.split("\n").map((line) => line.trim()).filter(Boolean),
        kpis: data.catalog
          .filter((definition) => rows[definition.key]?.enabled)
          .map((definition) => {
            const row = rows[definition.key];
            const scale = toNumber(row.scalePct);
            const kill = toNumber(row.killPct);
            return {
              key: definition.key,
              target: toNumber(row.target),
              scale_at: scale === null ? 0.2 : scale / 100,
              kill_at: kill === null ? 0.5 : kill / 100,
              min_spend: toNumber(row.minSpend),
            };
          }),
        primaryKpi: primaryKpi || null,
        windows,
        minSpendFactor: toNumber(minSpendFactor) ?? 1.2,
        dailyBudgetCap: toNumber(dailyCap),
        monthlyBudgetCap: toNumber(monthlyCap),
        maxIncreasePct: toNumber(maxIncrease) ?? 50,
        autonomyLevel: autonomy,
        approvers: approvers
          .filter((approver) => approver.name.trim())
          .map((approver) => (approver.email?.trim() ? { ...approver, email: approver.email.trim() } : { name: approver.name, role: approver.role })),
      });
      toast.success("Metas e regras salvas.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      {!data.profile.exists && (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm" role="status">
          Esta empresa ainda não tem metas. Sem meta, o Desempenho mostra os números mas não sugere decisão.
        </p>
      )}

      <section className="rounded-2xl border bg-card/60 p-4">
        <Label htmlFor="trafego-objetivos" className="font-medium">Objetivos</Label>
        <p className="mt-1 text-sm text-muted-foreground">Um por linha. Ex.: gerar conversas no WhatsApp.</p>
        <Textarea id="trafego-objetivos" className="mt-2" rows={3} value={objectives} onChange={(e) => setObjectives(e.target.value)} />
      </section>

      <section className="rounded-2xl border bg-card/60 p-4">
        <h2 className="font-medium">KPIs e metas</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Marque os KPIs que valem para esta empresa. A decisão por anúncio usa o KPI principal.
        </p>
        <div className="mt-3 space-y-3">
          {data.catalog.map((definition) => {
            const row = rows[definition.key];
            if (!row) return null;
            const id = `trafego-kpi-${definition.key}`;
            return (
              <div key={definition.key} className="rounded-xl border p-3" data-testid={`kpi-${definition.key}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Checkbox id={id} checked={row.enabled} onCheckedChange={(checked) => toggleKpi(definition.key, checked === true)} />
                    <Label htmlFor={id} className="font-medium">{definition.label}</Label>
                    <span className="text-xs text-muted-foreground">
                      {definition.better === "lower" ? "quanto menor, melhor" : "quanto maior, melhor"}
                    </span>
                  </div>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name="trafego-kpi-principal"
                      className="h-4 w-4"
                      checked={primaryKpi === definition.key}
                      disabled={!row.enabled}
                      onChange={() => setPrimaryKpi(definition.key)}
                    />
                    KPI principal
                  </label>
                </div>
                {row.enabled && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label htmlFor={`${id}-meta`}>
                        Meta{definition.unit === "currency" ? " (R$)" : definition.unit === "percent" ? " (%)" : ""}
                      </Label>
                      <Input id={`${id}-meta`} inputMode="decimal" value={row.target} onChange={(e) => setRow(definition.key, { target: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${id}-escala`}>Escala quando melhor que a meta em (%)</Label>
                      <Input id={`${id}-escala`} inputMode="decimal" value={row.scalePct} onChange={(e) => setRow(definition.key, { scalePct: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${id}-corte`}>Corta quando pior que a meta em (%)</Label>
                      <Input id={`${id}-corte`} inputMode="decimal" value={row.killPct} onChange={(e) => setRow(definition.key, { killPct: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${id}-minimo`}>
                        Gasto mínimo para decidir (R$){definition.better === "higher" ? ", obrigatório" : ""}
                      </Label>
                      <Input
                        id={`${id}-minimo`}
                        inputMode="decimal"
                        placeholder={definition.better === "lower" ? "Vazio: fator x meta" : ""}
                        value={row.minSpend}
                        onChange={(e) => setRow(definition.key, { minSpend: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border bg-card/60 p-4">
        <h2 className="font-medium">Janelas e limites</h2>
        <div className="mt-3 flex flex-wrap gap-4">
          {data.allowedWindows.map((days) => (
            <label key={days} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={windows.includes(days)}
                onCheckedChange={(checked) =>
                  setWindows((current) => (checked === true ? [...current, days].sort((a, b) => a - b) : current.filter((d) => d !== days)))
                }
              />
              {days} dias
            </label>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="trafego-fator">Fator de gasto mínimo (x meta)</Label>
            <Input id="trafego-fator" inputMode="decimal" value={minSpendFactor} onChange={(e) => setMinSpendFactor(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trafego-teto-dia">Teto de verba por dia (R$)</Label>
            <Input id="trafego-teto-dia" inputMode="decimal" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trafego-teto-mes">Teto de verba por mês (R$)</Label>
            <Input id="trafego-teto-mes" inputMode="decimal" value={monthlyCap} onChange={(e) => setMonthlyCap(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trafego-aumento">Aumento máximo por mudança (%)</Label>
            <Input id="trafego-aumento" inputMode="decimal" value={maxIncrease} onChange={(e) => setMaxIncrease(e.target.value)} />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          No nível "Sugere", o plano do dia respeita estes tetos, o aumento máximo e o mínimo de R$ 10 por dia. Nenhuma verba é alterada pelo Vexo.
        </p>
      </section>

      <section className="rounded-2xl border bg-card/60 p-4">
        <h2 className="font-medium">Nível de autonomia</h2>
        <RadioGroup
          value={autonomy}
          onValueChange={(value) => setAutonomy(value as TrafficAutonomy)}
          className="mt-3 space-y-2"
          aria-label="Nível de autonomia"
        >
          {data.autonomy.levels.map((level) => {
            const available = data.autonomy.available.includes(level);
            return (
              <div key={level} className={`flex items-start gap-3 rounded-xl border p-3 ${available ? "" : "opacity-60"}`}>
                <RadioGroupItem value={level} id={`trafego-autonomia-${level}`} disabled={!available} className="mt-1" />
                <div className="min-w-0">
                  <Label htmlFor={`trafego-autonomia-${level}`} className="font-medium">
                    {AUTONOMY_TEXT[level].label}
                    {!available && <span className="ml-2 text-xs font-normal text-muted-foreground">disponível na próxima fase</span>}
                  </Label>
                  <p className="text-sm text-muted-foreground">{AUTONOMY_TEXT[level].description}</p>
                </div>
              </div>
            );
          })}
        </RadioGroup>
      </section>

      <section className="rounded-2xl border bg-card/60 p-4">
        <h2 className="font-medium">Aprovadores</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada item do plano só vale com o gestor da GD e o cliente aprovando, por pessoas diferentes. O email precisa ser o mesmo do login no
          Vexo: é por ele que o servidor sabe de que lado a pessoa aprova. Sem email, a pessoa aparece na lista mas não aprova.
        </p>
        <div className="mt-3 space-y-2">
          {approvers.map((approver, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_180px_auto]">
              <Input
                aria-label={`Nome do aprovador ${index + 1}`}
                placeholder="Nome"
                value={approver.name}
                maxLength={80}
                onChange={(e) => setApprovers((list) => list.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)))}
              />
              <Input
                aria-label={`Email do aprovador ${index + 1}`}
                placeholder="Email do login"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={approver.email || ""}
                maxLength={160}
                onChange={(e) => setApprovers((list) => list.map((item, i) => (i === index ? { ...item, email: e.target.value } : item)))}
              />
              <select
                aria-label={`Papel do aprovador ${index + 1}`}
                className={SELECT_CLASS}
                value={approver.role}
                onChange={(e) =>
                  setApprovers((list) => list.map((item, i) => (i === index ? { ...item, role: e.target.value as TrafficApprover["role"] } : item)))
                }
              >
                <option value="gestor_gd">Gestor da GD</option>
                <option value="cliente">Cliente</option>
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover aprovador ${index + 1}`}
                onClick={() => setApprovers((list) => list.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={approvers.length >= 10}
            onClick={() => setApprovers((list) => [...list, { name: "", role: "gestor_gd" }])}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Adicionar aprovador
          </Button>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={save.isPending}>
          <Save className="mr-1.5 h-4 w-4" /> {save.isPending ? "Salvando..." : "Salvar metas e regras"}
        </Button>
      </div>
    </div>
  );
}
