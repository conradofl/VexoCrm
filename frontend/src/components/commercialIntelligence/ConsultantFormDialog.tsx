import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ConsultantPayload } from "@/hooks/useCommercialIntelligence";
import {
  LEAD_TYPE_OPTIONS,
  parseAvailableHours,
  parseCsvList,
  REGION_OPTIONS,
  serializeCsvList,
} from "@/lib/commercialIntelligence/helpers";
import { FilterField } from "./FilterField";

export function ConsultantFormDialog({
  open,
  onOpenChange,
  title,
  form,
  onChange,
  onSubmit,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  form: ConsultantPayload & { availableHoursLabel?: string };
  onChange: (next: ConsultantPayload & { availableHoursLabel?: string }) => void;
  onSubmit: () => void;
  isSaving: boolean;
}) {
  const leadTypes = form.leadTypes || [];
  const regions = form.territoryRegions || [];

  const toggleArrayValue = (key: "leadTypes" | "territoryRegions", value: string) => {
    const current = new Set(key === "leadTypes" ? leadTypes : regions);
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    onChange({ ...form, [key]: Array.from(current) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto rounded-[1.5rem] border-border bg-card text-card-foreground">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Configure criterios reais de distribuicao e atendimento do consultor.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <FilterField label="Nome">
            <Input value={form.name || ""} onChange={(event) => onChange({ ...form, name: event.target.value })} placeholder="Nome completo" />
          </FilterField>
          <FilterField label="Cargo">
            <Input value={form.position || ""} onChange={(event) => onChange({ ...form, position: event.target.value })} placeholder="Closer, executivo, consultor..." />
          </FilterField>
          <FilterField label="Telefone">
            <Input value={form.phone || ""} onChange={(event) => onChange({ ...form, phone: event.target.value })} placeholder="(11) 99999-9999" />
          </FilterField>
          <FilterField label="Email">
            <Input type="email" value={form.email || ""} onChange={(event) => onChange({ ...form, email: event.target.value })} placeholder="consultor@empresa.com" />
          </FilterField>
          <FilterField label="Cidade base">
            <Input value={form.city || ""} onChange={(event) => onChange({ ...form, city: event.target.value })} placeholder="Cidade principal" />
          </FilterField>
          <FilterField label="Estado base">
            <Input value={form.state || ""} onChange={(event) => onChange({ ...form, state: event.target.value })} placeholder="UF" />
          </FilterField>
          <FilterField label="Cidades atendidas" className="lg:col-span-2">
            <Input
              value={serializeCsvList(form.territoryCities)}
              onChange={(event) => onChange({ ...form, territoryCities: parseCsvList(event.target.value) })}
              placeholder="Sao Paulo, Campinas, Sorocaba"
            />
          </FilterField>
          <FilterField label="Estados atendidos" className="lg:col-span-2">
            <Input
              value={serializeCsvList(form.territoryStates)}
              onChange={(event) => onChange({ ...form, territoryStates: parseCsvList(event.target.value) })}
              placeholder="SP, RJ, MG"
            />
          </FilterField>
          <FilterField label="Regioes atendidas" className="lg:col-span-2">
            <div className="flex flex-wrap gap-2">
              {REGION_OPTIONS.map((option) => {
                const active = regions.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleArrayValue("territoryRegions", option)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      active
                        ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200"
                        : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </FilterField>
          <FilterField label="Faixa de contrato" className="lg:col-span-2">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                type="number"
                min={0}
                value={form.contractValueMin ?? 0}
                onChange={(event) => onChange({ ...form, contractValueMin: Number(event.target.value) })}
                placeholder="Valor minimo"
              />
              <Input
                type="number"
                min={0}
                value={form.contractValueMax ?? 0}
                onChange={(event) => onChange({ ...form, contractValueMax: Number(event.target.value) })}
                placeholder="Valor maximo"
              />
            </div>
          </FilterField>
          <FilterField label="Tipos de lead" className="lg:col-span-2">
            <div className="flex flex-wrap gap-2">
              {LEAD_TYPE_OPTIONS.map((option) => {
                const active = leadTypes.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleArrayValue("leadTypes", option)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      active
                        ? "border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-200"
                        : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </FilterField>
          <FilterField label="Capacidade diaria">
            <Input
              type="number"
              min={1}
              value={form.dailyCapacity ?? 20}
              onChange={(event) => onChange({ ...form, dailyCapacity: Number(event.target.value) })}
            />
          </FilterField>
          <FilterField label="Limite de leads abertos">
            <Input
              type="number"
              min={1}
              value={form.openLeadLimit ?? 30}
              onChange={(event) => onChange({ ...form, openLeadLimit: Number(event.target.value) })}
            />
          </FilterField>
          <FilterField label="Peso de distribuicao">
            <Input
              type="number"
              min={1}
              value={form.assignmentWeight ?? 1}
              onChange={(event) => onChange({ ...form, assignmentWeight: Number(event.target.value) })}
            />
          </FilterField>
          <FilterField label="Prioridade">
            <Input
              type="number"
              min={1}
              value={form.priorityRank ?? 1}
              onChange={(event) => onChange({ ...form, priorityRank: Number(event.target.value) })}
            />
          </FilterField>
          <FilterField label="Horario disponivel" className="lg:col-span-2">
            <Input
              value={form.availableHoursLabel || ""}
              onChange={(event) => onChange({ ...form, availableHoursLabel: event.target.value, availableHours: parseAvailableHours(event.target.value) })}
              placeholder="Seg a sex, 08:00 as 18:00"
            />
          </FilterField>
          <FilterField label="Observacoes" className="lg:col-span-2">
            <Textarea value={form.notes || ""} onChange={(event) => onChange({ ...form, notes: event.target.value })} placeholder="Notas de territorio, escalacao ou SLA." />
          </FilterField>
          <div className="flex flex-wrap items-center gap-6 lg:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={Boolean(form.active ?? true)} onCheckedChange={(checked) => onChange({ ...form, active: checked })} />
              Ativo
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={Boolean(form.available ?? true)} onCheckedChange={(checked) => onChange({ ...form, available: checked })} />
              Disponivel para receber
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={Boolean(form.acceptsAutoAssign ?? true)} onCheckedChange={(checked) => onChange({ ...form, acceptsAutoAssign: checked })} />
              Aceita distribuicao automatica
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={isSaving || !form.name?.trim()}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar consultor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
