import { FormEvent, useMemo, useState } from "react";
import { Briefcase, CalendarClock, Eye, Plus, Save, Trash2 } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  VEXO_SALES_INTERACTION_TYPES,
  VEXO_SALES_PRIORITIES,
  VEXO_SALES_STAGES,
  VEXO_SALES_STATUSES,
  type VexoSalesInteractionType,
  type VexoSalesOpportunity,
  type VexoSalesOpportunityPayload,
  type VexoSalesPriority,
  type VexoSalesStage,
  type VexoSalesStatus,
  useCreateVexoSalesInteraction,
  useCreateVexoSalesOpportunity,
  useDeleteVexoSalesOpportunity,
  useUpdateVexoSalesOpportunity,
  useVexoSalesInteractions,
  useVexoSalesOpportunities,
} from "@/hooks/useVexoSales";
import { cn } from "@/lib/utils";

interface OpportunityFormState {
  company_name: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  source: string;
  segment: string;
  estimated_value: string;
  stage: VexoSalesStage;
  status: VexoSalesStatus;
  priority: VexoSalesPriority;
  assigned_to: string;
  expected_close_date: string;
  notes: string;
}

interface InteractionFormState {
  type: VexoSalesInteractionType;
  description: string;
  interaction_at: string;
  responsible_user: string;
}

const emptyOpportunityForm: OpportunityFormState = {
  company_name: "",
  contact_name: "",
  contact_phone: "",
  contact_email: "",
  source: "",
  segment: "",
  estimated_value: "0",
  stage: "Novo lead",
  status: "ativo",
  priority: "media",
  assigned_to: "",
  expected_close_date: "",
  notes: "",
};

const emptyInteractionForm: InteractionFormState = {
  type: "observacao",
  description: "",
  interaction_at: "",
  responsible_user: "",
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatCurrency(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return currencyFormatter.format(Number.isFinite(parsed) ? parsed : 0);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : dateFormatter.format(date);
}

function opportunityToForm(opportunity: VexoSalesOpportunity): OpportunityFormState {
  return {
    company_name: opportunity.company_name || "",
    contact_name: opportunity.contact_name || "",
    contact_phone: opportunity.contact_phone || "",
    contact_email: opportunity.contact_email || "",
    source: opportunity.source || "",
    segment: opportunity.segment || "",
    estimated_value: String(opportunity.estimated_value || 0),
    stage: opportunity.stage,
    status: opportunity.status,
    priority: opportunity.priority,
    assigned_to: opportunity.assigned_to || "",
    expected_close_date: opportunity.expected_close_date || "",
    notes: opportunity.notes || "",
  };
}

function formToPayload(form: OpportunityFormState): VexoSalesOpportunityPayload {
  return {
    company_name: form.company_name,
    contact_name: form.contact_name || null,
    contact_phone: form.contact_phone || null,
    contact_email: form.contact_email || null,
    source: form.source || null,
    segment: form.segment || null,
    estimated_value: Number(form.estimated_value || 0),
    stage: form.stage,
    status: form.status,
    priority: form.priority,
    assigned_to: form.assigned_to || null,
    expected_close_date: form.expected_close_date || null,
    notes: form.notes || null,
  };
}

function statusBadgeClass(status: VexoSalesStatus) {
  if (status === "ganho") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200";
  if (status === "perdido") return "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-200";
  if (status === "pausado") return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-200";
  return "border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200";
}

export default function VexoSales() {
  const [filters, setFilters] = useState({
    stage: "all",
    status: "all",
    assignedTo: "",
    source: "",
    priority: "all",
  });
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingOpportunity, setEditingOpportunity] = useState<VexoSalesOpportunity | null>(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<VexoSalesOpportunity | null>(null);
  const [form, setForm] = useState<OpportunityFormState>(emptyOpportunityForm);
  const [interactionForm, setInteractionForm] = useState<InteractionFormState>(emptyInteractionForm);
  const [formError, setFormError] = useState<string | null>(null);

  const opportunitiesQuery = useVexoSalesOpportunities(filters);
  const interactionsQuery = useVexoSalesInteractions(selectedOpportunity?.id);
  const createOpportunity = useCreateVexoSalesOpportunity();
  const updateOpportunity = useUpdateVexoSalesOpportunity();
  const deleteOpportunity = useDeleteVexoSalesOpportunity();
  const createInteraction = useCreateVexoSalesInteraction();

  const opportunities = useMemo(() => opportunitiesQuery.data?.items || [], [opportunitiesQuery.data?.items]);
  const summary = opportunitiesQuery.data?.summary || {
    total: 0,
    open: 0,
    estimatedNegotiationValue: 0,
    wonThisMonth: 0,
    conversionRate: 0,
  };

  const uniqueSources = useMemo(
    () => Array.from(new Set(opportunities.map((item) => item.source).filter(Boolean))) as string[],
    [opportunities]
  );

  const openCreate = () => {
    setEditingOpportunity(null);
    setForm(emptyOpportunityForm);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (opportunity: VexoSalesOpportunity) => {
    setEditingOpportunity(opportunity);
    setForm(opportunityToForm(opportunity));
    setFormError(null);
    setFormOpen(true);
  };

  const openDetails = (opportunity: VexoSalesOpportunity) => {
    setSelectedOpportunity(opportunity);
    setInteractionForm(emptyInteractionForm);
    setDetailOpen(true);
  };

  const handleSaveOpportunity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!form.company_name.trim()) {
      setFormError("Informe a empresa para salvar a oportunidade.");
      return;
    }

    try {
      if (editingOpportunity) {
        await updateOpportunity.mutateAsync({ id: editingOpportunity.id, payload: formToPayload(form) });
      } else {
        await createOpportunity.mutateAsync(formToPayload(form));
      }
      setFormOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Nao foi possivel salvar a oportunidade.");
    }
  };

  const handleCreateInteraction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedOpportunity || !interactionForm.description.trim()) return;

    await createInteraction.mutateAsync({
      opportunityId: selectedOpportunity.id,
      payload: {
        type: interactionForm.type,
        description: interactionForm.description,
        interaction_at: interactionForm.interaction_at || undefined,
        responsible_user: interactionForm.responsible_user || undefined,
      },
    });
    setInteractionForm(emptyInteractionForm);
  };

  const handleDelete = async (opportunity: VexoSalesOpportunity) => {
    const confirmed = window.confirm(`Excluir oportunidade de ${opportunity.company_name}?`);
    if (!confirmed) return;
    await deleteOpportunity.mutateAsync(opportunity.id);
  };

  return (
    <PageShell
      title="Vendas Vexo"
      subtitle="Pipeline comercial interno da Vexo, isolado dos clientes e disponivel apenas para administradores."
      compactHero
      headerRight={
        <Button onClick={openCreate} className="gap-2 rounded-xl">
          <Plus className="h-4 w-4" />
          Nova oportunidade
        </Button>
      }
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total", summary.total],
          ["Abertas", summary.open],
          ["Valor em negociacao", formatCurrency(summary.estimatedNegotiationValue)],
          ["Ganhos no mes", summary.wonThisMonth],
          ["Conversao", `${summary.conversionRate}%`],
        ].map(([label, value]) => (
          <Card key={label} className="rounded-2xl border-slate-200/80 bg-white/80 dark:border-white/10 dark:bg-white/[0.03]">
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-black tracking-tight">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl border-slate-200/80 bg-white/82 dark:border-white/10 dark:bg-white/[0.03]">
        <CardHeader className="gap-4 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Briefcase className="h-5 w-5 text-cyan-600 dark:text-cyan-200" />
              Oportunidades internas
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Dados gravados em tabelas internas, sem misturar com leads ou campanhas dos clientes.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <Select value={filters.stage} onValueChange={(stage) => setFilters((current) => ({ ...current, stage }))}>
              <SelectTrigger className="bg-white dark:bg-white/[0.04]">
                <SelectValue placeholder="Estagio" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os estagios</SelectItem>
                {VEXO_SALES_STAGES.map((stage) => (
                  <SelectItem key={stage} value={stage}>{stage}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(status) => setFilters((current) => ({ ...current, status }))}>
              <SelectTrigger className="bg-white dark:bg-white/[0.04]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {VEXO_SALES_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>{status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.priority} onValueChange={(priority) => setFilters((current) => ({ ...current, priority }))}>
              <SelectTrigger className="bg-white dark:bg-white/[0.04]">
                <SelectValue placeholder="Prioridade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as prioridades</SelectItem>
                {VEXO_SALES_PRIORITIES.map((priority) => (
                  <SelectItem key={priority} value={priority}>{priority}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={filters.assignedTo}
              onChange={(event) => setFilters((current) => ({ ...current, assignedTo: event.target.value }))}
              placeholder="Responsavel"
              className="bg-white dark:bg-white/[0.04]"
            />
            <Input
              value={filters.source}
              onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))}
              placeholder={uniqueSources[0] ? `Origem: ${uniqueSources[0]}` : "Origem"}
              className="bg-white dark:bg-white/[0.04]"
            />
          </div>

          {opportunitiesQuery.isLoading ? (
            <EmptyState title="Carregando oportunidades" description="Buscando dados internos da Vexo." />
          ) : opportunities.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="Nenhuma oportunidade cadastrada"
              description="Crie a primeira oportunidade interna da Vexo para iniciar o pipeline."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200/80 dark:border-white/10">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Estagio</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Responsavel</TableHead>
                    <TableHead>Atualizacao</TableHead>
                    <TableHead className="text-right">Acoes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {opportunities.map((opportunity) => (
                    <TableRow key={opportunity.id}>
                      <TableCell className="font-semibold">{opportunity.company_name}</TableCell>
                      <TableCell>{opportunity.contact_name || "-"}</TableCell>
                      <TableCell>{opportunity.contact_phone || "-"}</TableCell>
                      <TableCell>{opportunity.source || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{opportunity.stage}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("capitalize", statusBadgeClass(opportunity.status))}>
                          {opportunity.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatCurrency(opportunity.estimated_value)}</TableCell>
                      <TableCell>{opportunity.assigned_to || "-"}</TableCell>
                      <TableCell>{formatDate(opportunity.updated_at)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => openDetails(opportunity)} className="gap-1">
                            <Eye className="h-3.5 w-3.5" />
                            Detalhes
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => openEdit(opportunity)}>
                            Editar
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handleDelete(opportunity)} className="text-rose-600">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingOpportunity ? "Editar oportunidade" : "Nova oportunidade"}</DialogTitle>
            <DialogDescription>Registre a operacao comercial interna da Vexo sem afetar dados de clientes.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveOpportunity} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Empresa">
                <Input value={form.company_name} onChange={(event) => setForm((current) => ({ ...current, company_name: event.target.value }))} required />
              </Field>
              <Field label="Contato">
                <Input value={form.contact_name} onChange={(event) => setForm((current) => ({ ...current, contact_name: event.target.value }))} />
              </Field>
              <Field label="Telefone">
                <Input value={form.contact_phone} onChange={(event) => setForm((current) => ({ ...current, contact_phone: event.target.value }))} />
              </Field>
              <Field label="E-mail">
                <Input type="email" value={form.contact_email} onChange={(event) => setForm((current) => ({ ...current, contact_email: event.target.value }))} />
              </Field>
              <Field label="Origem">
                <Input value={form.source} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))} />
              </Field>
              <Field label="Segmento">
                <Input value={form.segment} onChange={(event) => setForm((current) => ({ ...current, segment: event.target.value }))} />
              </Field>
              <Field label="Valor estimado">
                <Input type="number" min="0" step="0.01" value={form.estimated_value} onChange={(event) => setForm((current) => ({ ...current, estimated_value: event.target.value }))} />
              </Field>
              <Field label="Responsavel">
                <Input value={form.assigned_to} onChange={(event) => setForm((current) => ({ ...current, assigned_to: event.target.value }))} />
              </Field>
              <Field label="Estagio">
                <Select value={form.stage} onValueChange={(stage: VexoSalesStage) => setForm((current) => ({ ...current, stage }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VEXO_SALES_STAGES.map((stage) => <SelectItem key={stage} value={stage}>{stage}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status">
                <Select value={form.status} onValueChange={(status: VexoSalesStatus) => setForm((current) => ({ ...current, status }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VEXO_SALES_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Prioridade">
                <Select value={form.priority} onValueChange={(priority: VexoSalesPriority) => setForm((current) => ({ ...current, priority }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VEXO_SALES_PRIORITIES.map((priority) => <SelectItem key={priority} value={priority}>{priority}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Previsao de fechamento">
                <Input type="date" value={form.expected_close_date} onChange={(event) => setForm((current) => ({ ...current, expected_close_date: event.target.value }))} />
              </Field>
            </div>
            <Field label="Observacoes">
              <Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows={4} />
            </Field>
            {formError && <p className="text-sm text-rose-600">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createOpportunity.isPending || updateOpportunity.isPending} className="gap-2">
                <Save className="h-4 w-4" />
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedOpportunity?.company_name || "Detalhes da oportunidade"}</DialogTitle>
            <DialogDescription>Historico comercial interno e proximas acoes registradas pela equipe Vexo.</DialogDescription>
          </DialogHeader>
          {selectedOpportunity && (
            <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
              <div className="space-y-4">
                <Card>
                  <CardContent className="grid gap-3 p-4 md:grid-cols-2">
                    <Detail label="Contato" value={selectedOpportunity.contact_name} />
                    <Detail label="Telefone" value={selectedOpportunity.contact_phone} />
                    <Detail label="E-mail" value={selectedOpportunity.contact_email} />
                    <Detail label="Origem" value={selectedOpportunity.source} />
                    <Detail label="Segmento" value={selectedOpportunity.segment} />
                    <Detail label="Valor" value={formatCurrency(selectedOpportunity.estimated_value)} />
                    <Detail label="Responsavel" value={selectedOpportunity.assigned_to} />
                    <Detail label="Previsao" value={selectedOpportunity.expected_close_date || "-"} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Interacoes</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {interactionsQuery.isLoading ? (
                      <EmptyState message="Carregando interacoes..." />
                    ) : (interactionsQuery.data || []).length === 0 ? (
                      <EmptyState message="Nenhuma interacao registrada ainda." />
                    ) : (
                      (interactionsQuery.data || []).map((interaction) => (
                        <div key={interaction.id} className="rounded-xl border border-slate-200/80 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                          <div className="flex items-center justify-between gap-3">
                            <Badge variant="outline">{interaction.type}</Badge>
                            <span className="text-xs text-muted-foreground">{formatDate(interaction.interaction_at)}</span>
                          </div>
                          <p className="mt-2 text-sm">{interaction.description}</p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Responsavel: {interaction.responsible_user || interaction.created_by || "-"}
                          </p>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CalendarClock className="h-4 w-4" />
                    Registrar interacao
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateInteraction} className="space-y-4">
                    <Field label="Tipo">
                      <Select value={interactionForm.type} onValueChange={(type: VexoSalesInteractionType) => setInteractionForm((current) => ({ ...current, type }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {VEXO_SALES_INTERACTION_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Data">
                      <Input type="datetime-local" value={interactionForm.interaction_at} onChange={(event) => setInteractionForm((current) => ({ ...current, interaction_at: event.target.value }))} />
                    </Field>
                    <Field label="Responsavel">
                      <Input value={interactionForm.responsible_user} onChange={(event) => setInteractionForm((current) => ({ ...current, responsible_user: event.target.value }))} placeholder="Opcional" />
                    </Field>
                    <Field label="Descricao">
                      <Textarea value={interactionForm.description} onChange={(event) => setInteractionForm((current) => ({ ...current, description: event.target.value }))} rows={5} required />
                    </Field>
                    <Button type="submit" disabled={createInteraction.isPending} className="w-full gap-2">
                      <Plus className="h-4 w-4" />
                      Registrar
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value || "-"}</p>
    </div>
  );
}
