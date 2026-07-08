import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TemplateField } from "@/hooks/useChatbotTemplates";

export function FieldEditor({
  field,
  isRequired,
  index,
  total,
  onUpdate,
  onToggleRequired,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  field: TemplateField;
  isRequired: boolean;
  index: number;
  total: number;
  onUpdate: (patch: Partial<TemplateField>) => void;
  onToggleRequired: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-white/10 p-3">
      <div className="mt-2 flex flex-col gap-0.5 text-slate-400">
        <button onClick={onMoveUp} disabled={index === 0} className="disabled:opacity-30">
          <ChevronUp className="size-3.5" />
        </button>
        <GripVertical className="size-3.5" />
        <button onClick={onMoveDown} disabled={index === total - 1} className="disabled:opacity-30">
          <ChevronDown className="size-3.5" />
        </button>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Chave (key)</Label>
          <Input
            value={field.key}
            onChange={(e) => onUpdate({ key: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
            placeholder="ex: cidade"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Label</Label>
          <Input
            value={field.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            placeholder="ex: Cidade"
            className="h-8 text-sm"
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Descrição (instrução para o agente)</Label>
          <Input
            value={field.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="ex: Cidade onde o lead mora"
            className="h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-2 col-span-2">
          <Switch id={`req-${index}`} checked={isRequired} onCheckedChange={onToggleRequired} />
          <Label htmlFor={`req-${index}`} className="text-xs cursor-pointer">
            Obrigatório
          </Label>
        </div>
      </div>
      <Button variant="ghost" size="icon" className="size-7 shrink-0 mt-1 text-red-500" onClick={onRemove}>
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
