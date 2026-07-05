// Extraído de src/pages/FollowupQueue.tsx (Onda 4 Run F6) — movimento puro, sem alteração de forma.
// NOTA: CampaignsTab não é renderizado em nenhuma aba do FollowupDashboard atual (só journeys/metrics/config).
// Preservado como estava no arquivo original — não removido nem religado, apenas movido.
// NOTA 2: o ícone `Bot` usado em CampaignTemplatesView já não era importado no arquivo original
// (erro pré-existente TS2304, parte do baseline de 36 erros do tsc). Preservado sem import, como estava.
import { useState, useEffect } from "react";
import {
  Play,
  Pause,
  Archive,
  Pencil,
  Plus,
  Copy,
  ExternalLink,
  GripVertical,
  Eye,
  Trash2,
  Megaphone,
  Clock,
  MessageSquare,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import {
  useFupCampaigns,
  useFupTemplates,
  useCreateFupCampaign,
  useUpdateFupCampaign,
  useDeleteFupCampaign,
  useCreateFupTemplate,
  useUpdateFupTemplate,
  useDeleteFupTemplate,
  useReorderFupTemplates,
  type FupCampaign,
  type FupTemplate,
} from "@/hooks/useFollowupAdmin";
import { labelForTemplate, renderPreview } from "@/lib/followup/helpers";
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_COLORS,
  EMPTY_CAMPAIGN_FORM,
  SEGMENT_VARS,
  EMPTY_TEMPLATE_FORM,
} from "@/lib/followup/constants";

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTES DE CAMPANHAS & TEMPLATES (DRILL DOWN IN-PLACE)
// ═══════════════════════════════════════════════════════════════════════════════

function CampaignForm({
  initial, onSave, onCancel, isLoading,
}: {
  initial: typeof EMPTY_CAMPAIGN_FORM;
  onSave: (v: typeof EMPTY_CAMPAIGN_FORM) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Nome da campanha *</Label>
        <Input value={form.name} onChange={(e) => set("name", e.target.value)}
          placeholder="Ex: Agendamento Consulta Maio" className="h-8 text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Descrição</Label>
        <Textarea value={form.description} onChange={(e) => set("description", e.target.value)}
          placeholder="Descreva o objetivo desta campanha..." className="text-sm min-h-[72px]" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Origem padrão</Label>
        <Input value={form.default_origin} onChange={(e) => set("default_origin", e.target.value)}
          placeholder="Ex: Instagram Ads Maio" className="h-8 text-sm" />
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Usada quando o lead não traz parâmetros UTM. Ex: "Instagram Ads", "WhatsApp Orgânico".
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isLoading}>Cancelar</Button>
        <Button size="sm" onClick={() => onSave(form)}
          disabled={isLoading || !form.name.trim()}>
          {isLoading ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function WebhookInfo({ campaign }: { campaign: FupCampaign }) {
  const [showSecret, setShowSecret] = useState(false);

  const copyUrl = () => {
    if (campaign.webhook_trigger_url) {
      navigator.clipboard.writeText(campaign.webhook_trigger_url);
      toast({ title: "URL copiada!" });
    }
  };

  const copySecret = () => {
    if (campaign.webhook_secret) {
      navigator.clipboard.writeText(campaign.webhook_secret);
      toast({ title: "Secret copiado!" });
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-white/10 dark:bg-slate-900/30">
      <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">Webhook de entrada (Calendly ou genérico)</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {campaign.webhook_trigger_url || "—"}
        </code>
        <button onClick={copyUrl} className="shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {showSecret ? (campaign.webhook_secret || "—") : "••••••••••••"}
        </code>
        <button onClick={() => setShowSecret(!showSecret)}
          className="shrink-0 text-[10px] text-slate-400 hover:text-slate-700">
          {showSecret ? "Ocultar" : "Ver"}
        </button>
        <button onClick={copySecret} className="shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">
        No Calendly: Integrations → Webhooks → POST com esta URL. Adicione o header{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">X-Hub-Signature-256</code>{" "}
        com o secret acima.
      </p>
    </div>
  );
}

function CampaignCard({
  campaign, companyId, onEdit, onSelectTemplates,
}: {
  campaign: FupCampaign;
  companyId: string;
  onEdit: (c: FupCampaign) => void;
  onSelectTemplates: (c: FupCampaign) => void;
}) {
  const updateMut = useUpdateFupCampaign();
  const deleteMut = useDeleteFupCampaign();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const changeStatus = async (newStatus: FupCampaign["status"]) => {
    try {
      await updateMut.mutateAsync({ id: campaign.id, company_id: companyId, status: newStatus });
      toast({ title: `Campanha ${CAMPAIGN_STATUS_LABELS[newStatus].toLowerCase()}` });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMut.mutateAsync({ id: campaign.id, company_id: companyId });
      toast({ title: "Campanha excluída" });
      setDeleteOpen(false);
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const canDelete = campaign.status === "draft" || campaign.status === "archived";
  const isMutating = updateMut.isPending || deleteMut.isPending;

  return (
    <>
      <Card className="overflow-hidden">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                  {campaign.name}
                </h3>
                <Badge className={`shrink-0 border text-[10px] font-medium ${CAMPAIGN_STATUS_COLORS[campaign.status]}`}>
                  {CAMPAIGN_STATUS_LABELS[campaign.status]}
                </Badge>
              </div>
              {campaign.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                  {campaign.description}
                </p>
              )}
              {campaign.default_origin && (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Origem padrão: <span className="font-medium">{campaign.default_origin}</span>
                </p>
              )}
              <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
                <span>{campaign.totalLeads} leads</span>
                <span>{campaign.messagesSent} mensagens enviadas</span>
              </div>
            </div>
          </div>

          <WebhookInfo campaign={campaign} />

          <div className="flex flex-wrap gap-1.5">
            {campaign.status === "draft" || campaign.status === "paused" ? (
              <Button size="sm" variant="outline"
                className="h-7 gap-1 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/20"
                onClick={() => changeStatus("active")} disabled={isMutating}>
                <Play className="h-3 w-3" /> Iniciar
              </Button>
            ) : null}
            {campaign.status === "active" && (
              <Button size="sm" variant="outline"
                className="h-7 gap-1 text-xs text-amber-600 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/20"
                onClick={() => changeStatus("paused")} disabled={isMutating}>
                <Pause className="h-3 w-3" /> Pausar
              </Button>
            )}
            {(campaign.status === "active" || campaign.status === "paused") && (
              <Button size="sm" variant="outline"
                className="h-7 gap-1 text-xs text-slate-500"
                onClick={() => changeStatus("archived")} disabled={isMutating}>
                <Archive className="h-3 w-3" /> Arquivar
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"
              onClick={() => onEdit(campaign)} disabled={isMutating}>
              <Pencil className="h-3 w-3" /> Editar
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-indigo-600 border-indigo-200 hover:bg-indigo-50 dark:text-indigo-400 dark:border-indigo-800 dark:hover:bg-indigo-900/20"
              onClick={() => onSelectTemplates(campaign)}>
              <ExternalLink className="h-3 w-3" /> Templates
            </Button>
            {canDelete && (
              <Button size="sm" variant="ghost"
                className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                onClick={() => setDeleteOpen(true)} disabled={isMutating}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              A campanha <strong>{campaign.name}</strong> e todos os seus templates serão excluídos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-red-500 hover:bg-red-600" onClick={handleDelete} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTES DE GERENCIAMENTO DE TEMPLATES (EMBUTIDO NAS CAMPANHAS)
// ═══════════════════════════════════════════════════════════════════════════════

function TemplateForm({
  initial, onSave, onCancel, isLoading, campaignId, orderIndex,
}: {
  initial: typeof EMPTY_TEMPLATE_FORM;
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

  const handleSave = () => {
    onSave({
      campaign_id: campaignId,
      name: form.name,
      message: form.message,
      trigger_type: form.trigger_type,
      trigger_value: form.trigger_type === "on_schedule" ? 0 : form.trigger_value,
      trigger_unit: form.trigger_type === "on_schedule" ? "minutes" : form.trigger_unit,
      trigger_direction: form.trigger_type === "before_meeting" ? "before" : form.trigger_type === "after_meeting" ? "after" : null,
      is_active: form.is_active,
      order_index: orderIndex,
    });
  };

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Nome do Estágio *</Label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)}
            placeholder="Ex: Mensagem Dia 1" className="h-8 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Segmento (Variáveis)</Label>
          <Select value={form.segment} onValueChange={(v) => set("segment", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="geral" className="text-xs">Geral</SelectItem>
              <SelectItem value="b2b" className="text-xs">B2B</SelectItem>
              <SelectItem value="restaurante" className="text-xs">Restaurante</SelectItem>
              <SelectItem value="turismo" className="text-xs">Turismo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="p-3 border border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-900/10 rounded-lg space-y-3">
        <Label className="text-xs font-bold text-indigo-800 dark:text-indigo-300">Regra de Disparo</Label>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3 sm:col-span-1 space-y-1.5">
            <Label className="text-[10px] text-slate-500">Tipo de Gatilho</Label>
            <Select value={form.trigger_type} onValueChange={(v) => set("trigger_type", v)}>
              <SelectTrigger className="h-8 text-xs bg-white dark:bg-slate-900">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="on_schedule" className="text-xs">Envio Imediato</SelectItem>
                <SelectItem value="no_reply" className="text-xs">Após Inatividade</SelectItem>
                <SelectItem value="before_meeting" className="text-xs">Antes do Agendamento</SelectItem>
                <SelectItem value="after_meeting" className="text-xs">Depois do Agendamento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.trigger_type !== "on_schedule" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[10px] text-slate-500">Quantidade</Label>
                <Input type="number" min={1} value={form.trigger_value} onChange={(e) => set("trigger_value", parseInt(e.target.value) || 1)}
                  className="h-8 text-sm bg-white dark:bg-slate-900" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] text-slate-500">Unidade de Tempo</Label>
                <Select value={form.trigger_unit} onValueChange={(v) => set("trigger_unit", v)}>
                  <SelectTrigger className="h-8 text-xs bg-white dark:bg-slate-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes" className="text-xs">Minutos</SelectItem>
                    <SelectItem value="hours" className="text-xs">Horas</SelectItem>
                    <SelectItem value="days" className="text-xs">Dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Texto da Mensagem *</Label>
          <button onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-700">
            <Eye className="h-3 w-3" />
            {showPreview ? "Editar" : "Preview"}
          </button>
        </div>
        {showPreview ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-700 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-300 whitespace-pre-wrap min-h-[100px]">
            {renderPreview(form.message, form.segment) || <span className="text-slate-400 italic">Nenhuma mensagem</span>}
          </div>
        ) : (
          <Textarea
            value={form.message}
            onChange={(e) => set("message", e.target.value)}
            placeholder="Olá {{lead_name}}, conseguimos falar sobre a proposta?"
            className="text-sm min-h-[100px] font-mono"
          />
        )}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {(SEGMENT_VARS[form.segment] || SEGMENT_VARS.geral).map((v) => (
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
        <Label htmlFor="tpl-active" className="text-sm cursor-pointer">Estágio ativo (Pronto para envio)</Label>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isLoading}>Cancelar</Button>
        <Button size="sm" onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700"
          disabled={isLoading || !form.name.trim() || !form.message.trim()}>
          {isLoading ? "Salvando..." : "Salvar Estágio"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function CampaignTemplatesView({ campaign, onBack }: { campaign: FupCampaign; onBack: () => void }) {
  const { data: templates = [], isLoading } = useFupTemplates(campaign.id);
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
      await deleteMut.mutateAsync({ id: deleteTarget.id, campaign_id: campaign.id });
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
    await reorderMut.mutateAsync({ items, campaign_id: campaign.id });
  };

  const moveDown = async (idx: number) => {
    if (idx >= localOrder.length - 1) return;
    const next = [...localOrder];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    const items = next.map((t, i) => ({ id: t.id, order_index: i }));
    setLocalOrder(next);
    await reorderMut.mutateAsync({ items, campaign_id: campaign.id });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b pb-3 border-slate-100 dark:border-white/5">
        <div className="space-y-0.5">
          <button onClick={onBack} className="text-xs font-semibold text-indigo-500 hover:text-indigo-700 flex items-center gap-1">
            ← Voltar para Regras de Cadência
          </button>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Estágios da Cadência — {campaign.name}</h3>
        </div>
        <Button size="sm" className="gap-2 bg-indigo-600 hover:bg-indigo-700" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Adicionar Estágio
        </Button>
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex gap-4">
        <Bot className="h-6 w-6 text-amber-500 shrink-0" />
        <div>
          <h4 className="font-bold text-amber-800 dark:text-amber-500 mb-1 text-sm">Atenção: A Regra da Pausa Automática</h4>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Qualquer mensagem configurada aqui será disparada na ordem e data corretas. Porém, <strong>se o cliente responder a qualquer momento</strong>, a cadência inteira será pausada e este lead sairá do fluxo de Follow-up para ser assumido por você.
          </p>
        </div>
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
            <div key={t.id} className="relative">
              {idx > 0 && (
                <div className="absolute -top-3 left-6 flex items-center justify-center w-full max-w-[200px]">
                  <div className="h-6 w-px bg-slate-200 dark:bg-white/10 absolute left-0" />
                  <div className="bg-slate-50 border dark:bg-slate-900 dark:border-white/10 rounded-full px-3 py-1 text-[10px] font-medium text-slate-600 shadow-sm z-10 flex items-center gap-1.5 -translate-y-2">
                    <Clock className="w-3.5 h-3.5 text-indigo-500" /> ⏱️ {labelForTemplate(t)}
                  </div>
                </div>
              )}
              <div className={`flex items-start gap-3 rounded-xl border p-3 transition-opacity ${t.is_active ? "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/40" : "border-slate-100 bg-slate-50/50 opacity-60 dark:border-white/5 dark:bg-slate-900/20"} ${idx > 0 ? "mt-4" : ""}`}>
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
                  <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 border border-green-100 dark:border-green-900/30">
                    <MessageSquare className="w-3 h-3" /> WhatsApp
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 font-mono">
                  {renderPreview(t.message)}
                </p>
              </div>

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
          </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Estágio" : "Novo Estágio da Cadência"}</DialogTitle>
          </DialogHeader>
          <TemplateForm
            campaignId={campaign.id}
            orderIndex={localOrder.length}
            initial={
              editing
                ? {
                    name: editing.name,
                    message: editing.message,
                    trigger_type: editing.trigger_type,
                    trigger_value: editing.trigger_value,
                    trigger_unit: editing.trigger_unit,
                    segment: "geral",
                    is_active: editing.is_active,
                  }
                : EMPTY_TEMPLATE_FORM
            }
            onSave={handleSave}
            onCancel={() => setDialogOpen(false)}
            isLoading={createMut.isPending || updateMut.isPending}
          />
        </DialogContent>
      </Dialog>

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
    </div>
  );
}

export function CampaignsTab({ companyId }: { companyId: string }) {
  const { data: campaigns = [], isLoading: loadingCampaigns } = useFupCampaigns(companyId !== "all" ? companyId : undefined);
  const createMut = useCreateFupCampaign();
  const updateMut = useUpdateFupCampaign();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FupCampaign | null>(null);
  const [selectedCampaignForTemplates, setSelectedCampaignForTemplates] = useState<FupCampaign | null>(null);

  useEffect(() => {
    // Reset templates drilldown on company change
    setSelectedCampaignForTemplates(null);
  }, [companyId]);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (c: FupCampaign) => { setEditing(c); setDialogOpen(true); };

  if (companyId === "all") {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
        <Megaphone className="h-7 w-7 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-400">Selecione uma empresa específica no cabeçalho para gerenciar as campanhas.</p>
      </div>
    );
  }

  // Drill down view
  if (selectedCampaignForTemplates) {
    return (
      <CampaignTemplatesView
        campaign={selectedCampaignForTemplates}
        onBack={() => setSelectedCampaignForTemplates(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2 h-8 bg-indigo-600 hover:bg-indigo-700" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          Nova Regra de Cadência
        </Button>
      </div>

      {loadingCampaigns ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <Megaphone className="h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400">
            A empresa selecionada ainda não possui regras de cadência ativas.
          </p>
          <Button size="sm" variant="outline" onClick={openCreate} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Criar primeira regra de cadência
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              companyId={companyId}
              onEdit={openEdit}
              onSelectTemplates={(campaign) => setSelectedCampaignForTemplates(campaign)}
            />
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Regra de Cadência" : "Nova Regra de Cadência"}</DialogTitle>
            {!editing && (
              <p className="text-sm text-slate-500">Defina o nome desta regra (ex: Lead Frio, Proposta Enviada) para poder jogar os leads nela.</p>
            )}
          </DialogHeader>
          <CampaignForm
            initial={
              editing
                ? { name: editing.name, description: editing.description || "", default_origin: editing.default_origin || "" }
                : EMPTY_CAMPAIGN_FORM
            }
            onSave={async (form) => {
              try {
                if (editing) {
                  await updateMut.mutateAsync({ id: editing.id, company_id: companyId, ...form });
                  toast({ title: "Campanha atualizada" });
                } else {
                  await createMut.mutateAsync({ company_id: companyId, ...form });
                  toast({ title: "Campanha criada" });
                }
                setDialogOpen(false);
              } catch (e) {
                toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
              }
            }}
            onCancel={() => setDialogOpen(false)}
            isLoading={createMut.isPending || updateMut.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
