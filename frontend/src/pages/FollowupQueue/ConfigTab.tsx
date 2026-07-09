// Extraído de src/pages/FollowupQueue.tsx (Onda 4 Run F6) — movimento puro, sem alteração de forma.
import { useState } from "react";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import {
  useFupCompanies,
  useCreateFupCompany,
  useUpdateFupCompany,
  useArchiveFupCompany,
  type FupCompany,
} from "@/hooks/useFollowupAdmin";
import { EMPTY_COMPANY_FORM } from "@/lib/followup/constants";

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTES DE CONFIGURAÇÕES (EMPRESAS)
// ═══════════════════════════════════════════════════════════════════════════════

function CompanyForm({
  initial,
  onSave,
  onCancel,
  isLoading,
}: {
  initial: typeof EMPTY_COMPANY_FORM;
  onSave: (v: typeof EMPTY_COMPANY_FORM) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form, v: unknown) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Nome da empresa *</Label>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Empresa XYZ"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Instância Evolution API *</Label>
          <Input
            value={form.evolution_instance}
            onChange={(e) => set("evolution_instance", e.target.value)}
            placeholder="minha-instancia"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Webhook URL (respostas)</Label>
          <Input
            value={form.webhook_url}
            onChange={(e) => set("webhook_url", e.target.value)}
            placeholder="https://seu-crm.com/webhook"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Secret Calendly (opcional)</Label>
          <Input
            value={form.calendly_webhook_secret}
            onChange={(e) => set("calendly_webhook_secret", e.target.value)}
            placeholder="secret_..."
          />
        </div>
      </div>
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 border-b pb-1">Horários de Disparo</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Dias de Envio</Label>
            <Select value={form.sending_days} onValueChange={(v) => set("sending_days", v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1,2,3,4,5" className="text-xs">Segunda a Sexta</SelectItem>
                <SelectItem value="0,1,2,3,4,5,6" className="text-xs">Todos os dias</SelectItem>
                <SelectItem value="1,2,3,4" className="text-xs">Segunda a Quinta</SelectItem>
                <SelectItem value="1" className="text-xs">Somente Segunda</SelectItem>
                <SelectItem value="2" className="text-xs">Somente Terça</SelectItem>
                <SelectItem value="3" className="text-xs">Somente Quarta</SelectItem>
                <SelectItem value="4" className="text-xs">Somente Quinta</SelectItem>
                <SelectItem value="5" className="text-xs">Somente Sexta</SelectItem>
                <SelectItem value="6" className="text-xs">Somente Sábado</SelectItem>
                <SelectItem value="0" className="text-xs">Somente Domingo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">Início</Label>
              <Input type="time" className="h-8 text-xs" value={form.sending_window_start} onChange={(e) => set("sending_window_start", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">Término</Label>
              <Input type="time" className="h-8 text-xs" value={form.sending_window_end} onChange={(e) => set("sending_window_end", e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 border-b pb-1">Regras de Saída (Proteção)</h4>

        <div className="flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex flex-col">
            <Label htmlFor="auto-pause" className="text-sm cursor-pointer font-medium text-amber-800 dark:text-amber-400">
              Pausar cadência se o lead responder (Auto-pause)
            </Label>
            <span className="text-[10px] text-amber-700/70 dark:text-amber-500/70">A IA interrompe mensagens programadas para atendimento humano.</span>
          </div>
          <Switch checked={form.auto_pause_on_reply} onCheckedChange={(v) => set("auto_pause_on_reply", v)} id="auto-pause" />
        </div>

        <div className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-lg border border-slate-200 dark:border-white/10">
          <div className="flex flex-col">
            <Label htmlFor="calendly-pause" className="text-sm cursor-pointer font-medium text-slate-700 dark:text-slate-300">
              Pausar cadência se agendar reunião (Calendly)
            </Label>
            <span className="text-[10px] text-slate-500">Requer o Webhook Secret do Calendly preenchido acima.</span>
          </div>
          <Switch checked={form.auto_pause_on_calendly} onCheckedChange={(v) => set("auto_pause_on_calendly", v)} id="calendly-pause" />
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 border-b pb-1">Motor de Varredura & Reabordagem</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Varredura do Motor (horas)</Label>
            <Input
              type="number"
              className="h-8 text-xs bg-white dark:bg-slate-900"
              value={form.engine_scan_interval_hours}
              onChange={(e) => set("engine_scan_interval_hours", Number(e.target.value))}
            />
            <span className="text-[9px] text-slate-400">De quanto em quanto tempo o motor analisa os leads.</span>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Sem Contato Inicial (horas)</Label>
            <Input
              type="number"
              className="h-8 text-xs bg-white dark:bg-slate-900"
              value={form.never_contacted_delay_hours}
              onChange={(e) => set("never_contacted_delay_hours", Number(e.target.value))}
            />
            <span className="text-[9px] text-slate-400">Tempo mínimo de espera antes do primeiro follow-up.</span>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Sem Resposta de Campanhas (horas)</Label>
            <Input
              type="number"
              className="h-8 text-xs bg-white dark:bg-slate-900"
              value={form.no_reply_delay_hours}
              onChange={(e) => set("no_reply_delay_hours", Number(e.target.value))}
            />
            <span className="text-[9px] text-slate-400">Tempo sem resposta para disparar nova cobrança.</span>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Inatividade de Leads LivPub (meses)</Label>
            <Input
              type="number"
              className="h-8 text-xs bg-white dark:bg-slate-900"
              value={form.livpub_inactive_delay_months}
              onChange={(e) => set("livpub_inactive_delay_months", Number(e.target.value))}
            />
            <span className="text-[9px] text-slate-400">Tempo sem visitas para considerar lead inativo.</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 dark:border-white/5 pt-3">
        <div className="flex flex-col">
          <Label htmlFor="panel-access" className="text-sm cursor-pointer">
            Acesso ao painel de analytics
          </Label>
        </div>
        <Switch checked={form.panel_access} onCheckedChange={(v) => set("panel_access", v)} id="panel-access" />
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isLoading}>
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={() => onSave(form)}
          disabled={isLoading || !form.name.trim() || !form.evolution_instance.trim()}
        >
          {isLoading ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function ConfigTab() {
  const { selectedClientId } = useOptionalCrmClient();
  const { data: companies = [], isLoading } = useFupCompanies(selectedClientId);
  const createMut = useCreateFupCompany();
  const updateMut = useUpdateFupCompany();
  const archiveMut = useArchiveFupCompany();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FupCompany | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FupCompany | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (c: FupCompany) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const handleSave = async (form: typeof EMPTY_COMPANY_FORM) => {
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, ...form });
        toast({ title: "Empresa atualizada" });
      } else {
        await createMut.mutateAsync({ ...form, tenant_id: selectedClientId });
        toast({ title: "Empresa criada" });
      }
      setDialogOpen(false);
    } catch (e) {
      toast({
        title: "Erro",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    try {
      await archiveMut.mutateAsync(archiveTarget.id);
      toast({ title: "Empresa arquivada", description: `"${archiveTarget.name}" foi removida das listagens.` });
    } catch (e) {
      toast({ title: "Erro ao arquivar", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    } finally {
      setArchiveTarget(null);
    }
  };

  const togglePanelAccess = async (c: FupCompany) => {
    try {
      await updateMut.mutateAsync({ id: c.id, company_id: c.id, panel_access: !c.panel_access });
      toast({ title: `Acesso ${!c.panel_access ? "habilitado" : "desabilitado"}` });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nova Empresa
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <Building2 className="h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400">Nenhuma empresa cadastrada ainda.</p>
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {companies.length} empresa{companies.length !== 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              {companies.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        {c.name}
                      </span>
                      {c.panel_access && (
                        <Badge variant="outline" className="border-indigo-300 text-indigo-700 text-[10px] dark:border-indigo-700 dark:text-indigo-400">
                          Acesso painel
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <span>Instância: <code className="font-mono">{c.evolution_instance}</code></span>
                      <span>{c.activeCampaigns} campanha{c.activeCampaigns !== 1 ? "s" : ""} ativa{c.activeCampaigns !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => togglePanelAccess(c)}
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                      title={c.panel_access ? "Desabilitar acesso ao painel" : "Habilitar acesso ao painel"}
                    >
                      {c.panel_access ? (
                        <ToggleRight className="h-5 w-5 text-indigo-500" />
                      ) : (
                        <ToggleLeft className="h-5 w-5" />
                      )}
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      onClick={() => openEdit(c)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                      onClick={() => setArchiveTarget(c)}
                      title="Arquivar empresa"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar empresa" : "Nova empresa (WhatsApp)"}</DialogTitle>
          </DialogHeader>
          <CompanyForm
            initial={
              editing
                ? {
                    name: editing.name,
                    evolution_instance: editing.evolution_instance,
                    webhook_url: editing.webhook_url || "",
                    calendly_webhook_secret: editing.calendly_webhook_secret || "",
                    panel_access: editing.panel_access,
                    auto_pause_on_reply: editing.auto_pause_on_reply || false,
                    auto_pause_on_calendly: editing.auto_pause_on_calendly || false,
                    sending_window_start: editing.sending_window_start || "08:00",
                    sending_window_end: editing.sending_window_end || "18:00",
                    sending_days: editing.sending_days || "1,2,3,4,5",
                    engine_scan_interval_hours: editing.engine_scan_interval_hours ?? 6,
                    never_contacted_delay_hours: editing.never_contacted_delay_hours ?? 2,
                    no_reply_delay_hours: editing.no_reply_delay_hours ?? 48,
                    livpub_inactive_delay_months: editing.livpub_inactive_delay_months ?? 6,
                  }
                : EMPTY_COMPANY_FORM
            }
            onSave={handleSave}
            onCancel={() => setDialogOpen(false)}
            isLoading={createMut.isPending || updateMut.isPending}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              A empresa <strong>"{archiveTarget?.name}"</strong> será removida de todos os dropdowns e filtros do sistema.
              Os dados de campanhas, leads e disparos associados são preservados mas ficam inacessíveis pela interface.
              Esta ação não pode ser desfeita pela interface.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleArchive}
              disabled={archiveMut.isPending}
            >
              {archiveMut.isPending ? "Arquivando..." : "Arquivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
