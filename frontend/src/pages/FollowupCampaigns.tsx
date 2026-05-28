import { useState } from "react";
import {
  Play, Pause, Archive, Pencil, Trash2, Plus, Copy, RefreshCw, Megaphone, ExternalLink,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  useFupCompanies,
  useFupCampaigns,
  useCreateFupCampaign,
  useUpdateFupCampaign,
  useDeleteFupCampaign,
  type FupCampaign,
} from "@/hooks/useFollowupAdmin";
import { useNavigate } from "react-router-dom";

const STATUS_LABELS: Record<FupCampaign["status"], string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  archived: "Arquivada",
};

const STATUS_COLORS: Record<FupCampaign["status"], string> = {
  draft: "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
  active: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  paused: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  archived: "border-slate-300 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500",
};

const EMPTY_FORM = { name: "", description: "", default_origin: "" };

function CampaignForm({
  initial, onSave, onCancel, isLoading,
}: {
  initial: typeof EMPTY_FORM;
  onSave: (v: typeof EMPTY_FORM) => void;
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
  campaign, companyId, onEdit,
}: {
  campaign: FupCampaign;
  companyId: string;
  onEdit: (c: FupCampaign) => void;
}) {
  const navigate = useNavigate();
  const updateMut = useUpdateFupCampaign();
  const deleteMut = useDeleteFupCampaign();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const changeStatus = async (newStatus: FupCampaign["status"]) => {
    try {
      await updateMut.mutateAsync({ id: campaign.id, company_id: companyId, status: newStatus });
      toast({ title: `Campanha ${STATUS_LABELS[newStatus].toLowerCase()}` });
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
                <Badge className={`shrink-0 border text-[10px] font-medium ${STATUS_COLORS[campaign.status]}`}>
                  {STATUS_LABELS[campaign.status]}
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

          {/* Ações */}
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
              onClick={() => navigate(`/crm/followup-templates?campaignId=${campaign.id}&name=${encodeURIComponent(campaign.name)}`)}>
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

export default function FollowupCampaigns() {
  const { data: companies = [], isLoading: loadingCompanies } = useFupCompanies();
  const [companyId, setCompanyId] = useState("");
  const { data: campaigns = [], isLoading: loadingCampaigns } = useFupCampaigns(companyId || undefined);
  const createMut = useCreateFupCampaign();
  const updateMut = useUpdateFupCampaign();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FupCampaign | null>(null);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (c: FupCampaign) => { setEditing(c); setDialogOpen(true); };

  const handleSave = async (form: typeof EMPTY_FORM) => {
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
  };

  const selectedCompany = companies.find((c) => c.id === companyId);

  return (
    <PageShell
      title="FUP — Campanhas"
      subtitle="Gerencie campanhas de follow-up por empresa"
      spacing="space-y-6"
    >
      {/* Seletor de empresa */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px] space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Empresa</Label>
              <Select value={companyId} onValueChange={setCompanyId} disabled={loadingCompanies}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={loadingCompanies ? "Carregando..." : "Selecione uma empresa"} />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {companyId && (
              <Button size="sm" className="gap-2 h-8" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" />
                Nova Campanha
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cards de campanhas */}
      {companyId && (
        loadingCampaigns ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
            <Megaphone className="h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-400">
              {selectedCompany?.name} ainda não tem campanhas.
            </p>
            <Button size="sm" variant="outline" onClick={openCreate} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Criar primeira campanha
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {campaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} companyId={companyId} onEdit={openEdit} />
            ))}
          </div>
        )
      )}

      {!companyId && !loadingCompanies && companies.length === 0 && (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <Megaphone className="h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400">Nenhuma empresa cadastrada. Crie uma em FUP — Empresas primeiro.</p>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar campanha" : "Nova campanha"}</DialogTitle>
          </DialogHeader>
          <CampaignForm
            initial={
              editing
                ? { name: editing.name, description: editing.description || "", default_origin: editing.default_origin || "" }
                : EMPTY_FORM
            }
            onSave={handleSave}
            onCancel={() => setDialogOpen(false)}
            isLoading={createMut.isPending || updateMut.isPending}
          />
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
