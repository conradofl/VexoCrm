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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DistributionRulePayload } from "@/hooks/useCommercialIntelligence";
import { FilterField } from "./FilterField";

export function DistributionRuleDialog({
  open,
  onOpenChange,
  form,
  onChange,
  onSubmit,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: DistributionRulePayload & { city?: string; state?: string; region?: string; leadType?: string; campaignOrigin?: string; availabilityRequired?: boolean; dailyCapacity?: number; slaMinutes?: number; minContract?: number; maxContract?: number; };
  onChange: (next: DistributionRulePayload & { city?: string; state?: string; region?: string; leadType?: string; campaignOrigin?: string; availabilityRequired?: boolean; dailyCapacity?: number; slaMinutes?: number; minContract?: number; maxContract?: number; }) => void;
  onSubmit: () => void;
  isSaving: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-[1.5rem] border-border bg-card text-card-foreground shadow-2xl">
        <DialogHeader>
          <DialogTitle>Regra de distribuicao</DialogTitle>
          <DialogDescription>Configure prioridade, SLA e elegibilidade de forma persistente.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <FilterField label="Nome da regra" className="md:col-span-2">
            <Input value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} placeholder="Prioridade capital premium" />
          </FilterField>
          <FilterField label="Estrategia">
            <Select value={form.distributionMode} onValueChange={(value) => onChange({ ...form, distributionMode: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="round_robin">Round-robin</SelectItem>
                <SelectItem value="weighted_performance">Peso por performance</SelectItem>
                <SelectItem value="priority_region">Prioridade por regiao</SelectItem>
                <SelectItem value="priority_contract">Prioridade por valor potencial</SelectItem>
                <SelectItem value="hybrid">Distribuicao hibrida</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Fairness floor">
            <Input
              type="number"
              min={0}
              step="0.1"
              value={form.fairnessFloor}
              onChange={(event) => onChange({ ...form, fairnessFloor: Number(event.target.value) })}
            />
          </FilterField>
          <FilterField label="Cidade">
            <Input value={form.city || ""} onChange={(event) => onChange({ ...form, city: event.target.value })} placeholder="Cidade prioritaria" />
          </FilterField>
          <FilterField label="Estado">
            <Input value={form.state || ""} onChange={(event) => onChange({ ...form, state: event.target.value })} placeholder="UF" />
          </FilterField>
          <FilterField label="Regiao">
            <Input value={form.region || ""} onChange={(event) => onChange({ ...form, region: event.target.value })} placeholder="Capital, Sul..." />
          </FilterField>
          <FilterField label="Origem da campanha">
            <Input value={form.campaignOrigin || ""} onChange={(event) => onChange({ ...form, campaignOrigin: event.target.value })} placeholder="Origem ou nome da campanha" />
          </FilterField>
          <FilterField label="Tipo de lead">
            <Input value={form.leadType || ""} onChange={(event) => onChange({ ...form, leadType: event.target.value })} placeholder="Residencial, empresa..." />
          </FilterField>
          <FilterField label="Valor potencial" className="md:col-span-2">
            <div className="grid gap-3 md:grid-cols-2">
              <Input type="number" min={0} value={form.minContract ?? 0} onChange={(event) => onChange({ ...form, minContract: Number(event.target.value) })} placeholder="Valor minimo" />
              <Input type="number" min={0} value={form.maxContract ?? 0} onChange={(event) => onChange({ ...form, maxContract: Number(event.target.value) })} placeholder="Valor maximo" />
            </div>
          </FilterField>
          <FilterField label="Capacidade diaria">
            <Input type="number" min={1} value={form.dailyCapacity ?? 30} onChange={(event) => onChange({ ...form, dailyCapacity: Number(event.target.value) })} />
          </FilterField>
          <FilterField label="SLA de aceite (min)">
            <Input type="number" min={1} value={form.slaMinutes ?? form.reassignAfterMinutes} onChange={(event) => onChange({ ...form, slaMinutes: Number(event.target.value), reassignAfterMinutes: Number(event.target.value) })} />
          </FilterField>
          <FilterField label="Leads abertos por consultor">
            <Input type="number" min={1} value={form.maxOpenLeadsPerConsultant} onChange={(event) => onChange({ ...form, maxOpenLeadsPerConsultant: Number(event.target.value) })} />
          </FilterField>
          <FilterField label="Reatribuir apos (min)">
            <Input type="number" min={1} value={form.reassignAfterMinutes} onChange={(event) => onChange({ ...form, reassignAfterMinutes: Number(event.target.value) })} />
          </FilterField>
          <div className="flex flex-wrap items-center gap-6 md:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={form.prioritizeRegion} onCheckedChange={(checked) => onChange({ ...form, prioritizeRegion: checked })} />
              Priorizar regiao
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={form.prioritizeContractValue} onCheckedChange={(checked) => onChange({ ...form, prioritizeContractValue: checked })} />
              Priorizar valor potencial
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={form.prioritizeLeadType} onCheckedChange={(checked) => onChange({ ...form, prioritizeLeadType: checked })} />
              Priorizar tipo de lead
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={Boolean(form.availabilityRequired ?? true)} onCheckedChange={(checked) => onChange({ ...form, availabilityRequired: checked })} />
              Exigir consultor disponivel
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={form.active} onCheckedChange={(checked) => onChange({ ...form, active: checked })} />
              Regra ativa
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={isSaving || !form.name.trim()}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar regra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
