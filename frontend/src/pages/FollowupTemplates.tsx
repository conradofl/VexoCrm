import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Pencil, Trash2, GripVertical, Eye } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/use-toast";
import {
  useFupTemplates,
  useCreateFupTemplate,
  useUpdateFupTemplate,
  useDeleteFupTemplate,
  useReorderFupTemplates,
  type FupTemplate,
} from "@/hooks/useFollowupAdmin";

// ─── Opções pré-definidas de gatilho ─────────────────────────────────────────

const TRIGGER_OPTIONS: {
  label: string;
  trigger_type: FupTemplate["trigger_type"];
  trigger_value: number;
  trigger_unit: FupTemplate["trigger_unit"];
  trigger_direction: "before" | "after" | null;
}[] = [
  // Imediato
  { label: "Assim que o webhook for disparado", trigger_type: "on_schedule", trigger_value: 0, trigger_unit: "minutes", trigger_direction: null },
  // Antes da reunião
  { label: "5 minutos antes", trigger_type: "before_meeting", trigger_value: 5, trigger_unit: "minutes", trigger_direction: "before" },
  { label: "15 minutos antes", trigger_type: "before_meeting", trigger_value: 15, trigger_unit: "minutes", trigger_direction: "before" },
  { label: "30 minutos antes", trigger_type: "before_meeting", trigger_value: 30, trigger_unit: "minutes", trigger_direction: "before" },
  { label: "1 hora antes", trigger_type: "before_meeting", trigger_value: 1, trigger_unit: "hours", trigger_direction: "before" },
  { label: "3 horas antes", trigger_type: "before_meeting", trigger_value: 3, trigger_unit: "hours", trigger_direction: "before" },
  { label: "6 horas antes", trigger_type: "before_meeting", trigger_value: 6, trigger_unit: "hours", trigger_direction: "before" },
  { label: "12 horas antes", trigger_type: "before_meeting", trigger_value: 12, trigger_unit: "hours", trigger_direction: "before" },
  { label: "1 dia antes", trigger_type: "before_meeting", trigger_value: 1, trigger_unit: "days", trigger_direction: "before" },
  { label: "2 dias antes", trigger_type: "before_meeting", trigger_value: 2, trigger_unit: "days", trigger_direction: "before" },
  // Depois da reunião
  { label: "30 minutos depois", trigger_type: "after_meeting", trigger_value: 30, trigger_unit: "minutes", trigger_direction: "after" },
  { label: "1 hora depois", trigger_type: "after_meeting", trigger_value: 1, trigger_unit: "hours", trigger_direction: "after" },
  { label: "3 horas depois", trigger_type: "after_meeting", trigger_value: 3, trigger_unit: "hours", trigger_direction: "after" },
  { label: "6 horas depois", trigger_type: "after_meeting", trigger_value: 6, trigger_unit: "hours", trigger_direction: "after" },
  { label: "12 horas depois", trigger_type: "after_meeting", trigger_value: 12, trigger_unit: "hours", trigger_direction: "after" },
  { label: "1 dia depois", trigger_type: "after_meeting", trigger_value: 1, trigger_unit: "days", trigger_direction: "after" },
  { label: "2 dias depois", trigger_type: "after_meeting", trigger_value: 2, trigger_unit: "days", trigger_direction: "after" },
  { label: "3 dias depois", trigger_type: "after_meeting", trigger_value: 3, trigger_unit: "days", trigger_direction: "after" },
  { label: "7 dias depois", trigger_type: "after_meeting", trigger_value: 7, trigger_unit: "days", trigger_direction: "after" },
  // Sem resposta
  { label: "Se não respondeu em 1 hora", trigger_type: "no_reply", trigger_value: 1, trigger_unit: "hours", trigger_direction: null },
  { label: "Se não respondeu em 3 horas", trigger_type: "no_reply", trigger_value: 3, trigger_unit: "hours", trigger_direction: null },
  { label: "Se não respondeu em 6 horas", trigger_type: "no_reply", trigger_value: 6, trigger_unit: "hours", trigger_direction: null },
  { label: "Se não respondeu em 12 horas", trigger_type: "no_reply", trigger_value: 12, trigger_unit: "hours", trigger_direction: null },
  { label: "Se não respondeu em 1 dia", trigger_type: "no_reply", trigger_value: 1, trigger_unit: "days", trigger_direction: null },
  { label: "Se não respondeu em 2 dias", trigger_type: "no_reply", trigger_value: 2, trigger_unit: "days", trigger_direction: null },
];

function optionKey(o: (typeof TRIGGER_OPTIONS)[number]) {
  return `${o.trigger_type}:${o.trigger_value}:${o.trigger_unit}`;
}

function labelForTemplate(t: FupTemplate) {
  const match = TRIGGER_OPTIONS.find(
    (o) => o.trigger_type === t.trigger_type && o.trigger_value === t.trigger_value && o.trigger_unit === t.trigger_unit
  );
  return match?.label || `${t.trigger_type} ${t.trigger_value} ${t.trigger_unit}`;
}

const EXAMPLE = { lead_name: "Maria Silva", meeting_date: "20/06/2026", meeting_time: "14:00" };

function renderPreview(msg: string) {
  return msg
    .replace(/\{\{lead_name\}\}/gi, EXAMPLE.lead_name)
    .replace(/\{\{meeting_date\}\}/gi, EXAMPLE.meeting_date)
    .replace(/\{\{meeting_time\}\}/gi, EXAMPLE.meeting_time);
}

const EMPTY_FORM = {
  name: "",
  message: "",
  triggerKey: TRIGGER_OPTIONS[0] ? optionKey(TRIGGER_OPTIONS[0]) : "",
  is_active: true,
};

function TemplateForm({
  initial, onSave, onCancel, isLoading, campaignId, orderIndex,
}: {
  initial: typeof EMPTY_FORM;
  onSave: (v: Omit<FupTemplate, "id" | "created_at">) => void;
  onCancel: () => void;
  isLoading: boolean;
  campaignId: string;
  orderIndex: number;
}) {
  const [form, setForm] = useState(initial);
  const [showPreview, setShowPreview] = useState(false);
  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const insertVar = (v: string) => set("message", form.message + v);

  const selectedOption = TRIGGER_OPTIONS.find((o) => optionKey(o) === form.triggerKey) || TRIGGER_OPTIONS[0];

  const handleSave = () => {
    if (!selectedOption) return;
    onSave({
      campaign_id: campaignId,
      name: form.name,
      message: form.message,
      trigger_type: selectedOption.trigger_type,
      trigger_value: selectedOption.trigger_value,
      trigger_unit: selectedOption.trigger_unit,
      trigger_direction: selectedOption.trigger_direction,
      is_active: form.is_active,
      order_index: orderIndex,
    });
  };

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div className="space-y-1.5">
        <Label className="text-xs">Nome do template *</Label>
        <Input value={form.name} onChange={(e) => set("name", e.target.value)}
          placeholder="Ex: Confirmação imediata" className="h-8 text-sm" />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Gatilho de envio *</Label>
        <Select value={form.triggerKey} onValueChange={(v) => set("triggerKey", v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={optionKey(TRIGGER_OPTIONS[0])} className="text-xs font-medium text-slate-500">
              — IMEDIATO —
            </SelectItem>
            {TRIGGER_OPTIONS.slice(0, 1).map((o) => (
              <SelectItem key={optionKey(o)} value={optionKey(o)} className="text-xs pl-4">{o.label}</SelectItem>
            ))}
            <SelectItem value="__sep1__" disabled className="text-xs font-medium text-slate-500">— ANTES DA REUNIÃO —</SelectItem>
            {TRIGGER_OPTIONS.filter((o) => o.trigger_type === "before_meeting").map((o) => (
              <SelectItem key={optionKey(o)} value={optionKey(o)} className="text-xs pl-4">{o.label}</SelectItem>
            ))}
            <SelectItem value="__sep2__" disabled className="text-xs font-medium text-slate-500">— DEPOIS DA REUNIÃO —</SelectItem>
            {TRIGGER_OPTIONS.filter((o) => o.trigger_type === "after_meeting").map((o) => (
              <SelectItem key={optionKey(o)} value={optionKey(o)} className="text-xs pl-4">{o.label}</SelectItem>
            ))}
            <SelectItem value="__sep3__" disabled className="text-xs font-medium text-slate-500">— SEM RESPOSTA —</SelectItem>
            {TRIGGER_OPTIONS.filter((o) => o.trigger_type === "no_reply").map((o) => (
              <SelectItem key={optionKey(o)} value={optionKey(o)} className="text-xs pl-4">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Mensagem *</Label>
          <button onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-700">
            <Eye className="h-3 w-3" />
            {showPreview ? "Editar" : "Preview"}
          </button>
        </div>
        {showPreview ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-700 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-300 whitespace-pre-wrap min-h-[100px]">
            {renderPreview(form.message) || <span className="text-slate-400 italic">Nenhuma mensagem</span>}
          </div>
        ) : (
          <Textarea
            value={form.message}
            onChange={(e) => set("message", e.target.value)}
            placeholder="Olá {{lead_name}}, sua reunião é em {{meeting_date}} às {{meeting_time}}..."
            className="text-sm min-h-[100px] font-mono"
          />
        )}
        <div className="flex flex-wrap gap-1.5">
          {["{{lead_name}}", "{{meeting_date}}", "{{meeting_time}}"].map((v) => (
            <button key={v}
              onClick={() => insertVar(v)}
              className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400 dark:hover:bg-indigo-900/40">
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} id="tpl-active" />
        <Label htmlFor="tpl-active" className="text-sm cursor-pointer">Template ativo</Label>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isLoading}>Cancelar</Button>
        <Button size="sm" onClick={handleSave}
          disabled={isLoading || !form.name.trim() || !form.message.trim()}>
          {isLoading ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function FollowupTemplates() {
  const [params] = useSearchParams();
  const campaignId = params.get("campaignId") || "";
  const campaignName = params.get("name") || "Campanha";

  const { data: templates = [], isLoading } = useFupTemplates(campaignId || undefined);
  const createMut = useCreateFupTemplate();
  const updateMut = useUpdateFupTemplate();
  const deleteMut = useDeleteFupTemplate();
  const reorderMut = useReorderFupTemplates();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FupTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FupTemplate | null>(null);
  const [localOrder, setLocalOrder] = useState<FupTemplate[]>([]);

  useEffect(() => {
    setLocalOrder(templates);
  }, [templates]);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (t: FupTemplate) => { setEditing(t); setDialogOpen(true); };

  const handleSave = async (data: Omit<FupTemplate, "id" | "created_at">) => {
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, ...data });
        toast({ title: "Template atualizado" });
      } else {
        await createMut.mutateAsync(data);
        toast({ title: "Template criado" });
      }
      setDialogOpen(false);
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync({ id: deleteTarget.id, campaign_id: campaignId });
      toast({ title: "Template excluído" });
      setDeleteTarget(null);
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const toggleActive = async (t: FupTemplate) => {
    try {
      await updateMut.mutateAsync({ id: t.id, campaign_id: t.campaign_id, is_active: !t.is_active });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const moveUp = async (idx: number) => {
    if (idx === 0) return;
    const next = [...localOrder];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    const items = next.map((t, i) => ({ id: t.id, order_index: i }));
    setLocalOrder(next);
    await reorderMut.mutateAsync({ items, campaign_id: campaignId });
  };

  const moveDown = async (idx: number) => {
    if (idx >= localOrder.length - 1) return;
    const next = [...localOrder];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    const items = next.map((t, i) => ({ id: t.id, order_index: i }));
    setLocalOrder(next);
    await reorderMut.mutateAsync({ items, campaign_id: campaignId });
  };

  if (!campaignId) {
    return (
      <PageShell title="FUP — Templates" subtitle="Acesse via página de Campanhas">
        <p className="text-sm text-slate-400">Nenhuma campanha selecionada.</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={`Templates — ${campaignName}`}
      subtitle="Configure as mensagens de follow-up para esta campanha"
      spacing="space-y-6"
    >
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Adicionar Mensagem
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : localOrder.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Nenhum template ainda. Adicione a primeira mensagem.</p>
          <Button size="sm" variant="outline" onClick={openCreate} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {localOrder.map((t, idx) => (
            <div key={t.id}
              className={`flex items-start gap-3 rounded-xl border p-3 transition-opacity ${t.is_active ? "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/40" : "border-slate-100 bg-slate-50/50 opacity-60 dark:border-white/5 dark:bg-slate-900/20"}`}>
              {/* Reordenação */}
              <div className="flex flex-col gap-0.5 pt-0.5">
                <button onClick={() => moveUp(idx)} disabled={idx === 0}
                  className="text-slate-300 hover:text-slate-600 disabled:opacity-0 transition-colors">
                  <GripVertical className="h-3.5 w-3.5 rotate-90" />
                </button>
                <button onClick={() => moveDown(idx)} disabled={idx >= localOrder.length - 1}
                  className="text-slate-300 hover:text-slate-600 disabled:opacity-0 transition-colors">
                  <GripVertical className="h-3.5 w-3.5 -rotate-90" />
                </button>
              </div>

              {/* Conteúdo */}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    #{idx + 1}
                  </span>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{t.name}</span>
                  <Badge variant="outline" className="text-[10px] border-indigo-200 text-indigo-600 dark:border-indigo-800 dark:text-indigo-400">
                    {labelForTemplate(t)}
                  </Badge>
                  {!t.is_active && (
                    <Badge variant="outline" className="text-[10px] text-slate-400">Inativo</Badge>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 font-mono">
                  {renderPreview(t.message)}
                </p>
              </div>

              {/* Ações */}
              <div className="flex shrink-0 items-center gap-1">
                <Switch checked={t.is_active} onCheckedChange={() => toggleActive(t)}
                  className="scale-75" />
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  onClick={() => openEdit(t)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                  onClick={() => setDeleteTarget(t)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de template */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar template" : "Nova mensagem"}</DialogTitle>
          </DialogHeader>
          <TemplateForm
            campaignId={campaignId}
            orderIndex={localOrder.length}
            initial={
              editing
                ? {
                    name: editing.name,
                    message: editing.message,
                    triggerKey: optionKey(editing as any),
                    is_active: editing.is_active,
                  }
                : EMPTY_FORM
            }
            onSave={handleSave}
            onCancel={() => setDialogOpen(false)}
            isLoading={createMut.isPending || updateMut.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Confirmar exclusão */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir template?</AlertDialogTitle>
            <AlertDialogDescription>
              O template <strong>{deleteTarget?.name}</strong> será excluído permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-red-500 hover:bg-red-600" onClick={handleDelete}
              disabled={deleteMut.isPending}>
              {deleteMut.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
