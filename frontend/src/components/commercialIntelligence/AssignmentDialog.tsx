import { Loader2, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ConsultantItem, DistributionQueueRow } from "@/hooks/useCommercialIntelligence";
import { FilterField } from "./FilterField";

export function AssignmentDialog({
  open,
  onOpenChange,
  row,
  consultants,
  consultantId,
  reason,
  onConsultantChange,
  onReasonChange,
  onSubmit,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: DistributionQueueRow | null;
  consultants: ConsultantItem[];
  consultantId: string;
  reason: string;
  onConsultantChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onSubmit: () => void;
  isSaving: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-[1.5rem] border-border bg-card text-card-foreground shadow-2xl">
        <DialogHeader>
          <DialogTitle>Reatribuir lead</DialogTitle>
          <DialogDescription>
            {row ? `Defina o novo consultor para ${row.leadName}.` : "Selecione um consultor e o motivo da troca."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FilterField label="Novo consultor">
            <Select value={consultantId || "placeholder"} onValueChange={(value) => onConsultantChange(value === "placeholder" ? "" : value)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o consultor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="placeholder">Selecione</SelectItem>
                {consultants.map((consultant) => (
                  <SelectItem key={consultant.id} value={consultant.id}>
                    {consultant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Motivo">
            <Textarea value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="Explique a troca manual, excecao de territorio ou carga." />
          </FilterField>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={isSaving || !consultantId}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
            Confirmar reatribuicao
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
