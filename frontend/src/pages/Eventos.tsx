import React, { useState } from "react";
import {
  Calendar,
  Plus,
  Search,
  Sparkles,
  Ticket,
  CalendarCheck,
  PartyPopper,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EventoItem, useEventos } from "@/hooks/useEventos";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { EventCard, getEventCountdown } from "./Eventos/EventCard";
import { EventFormModal } from "./Eventos/EventFormModal";
import { DeleteEventDialog } from "./Eventos/DeleteEventDialog";

export const Eventos: React.FC = () => {
  const crmClient = useOptionalCrmClient();
  const effectiveTenantId = crmClient?.selectedClientId || crmClient?.selectedClient?.id || undefined;

  const { data: eventos = [], isLoading, error, refetch } = useEventos(effectiveTenantId);

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvento, setEditingEvento] = useState<EventoItem | null>(null);
  const [deletingEvento, setDeletingEvento] = useState<EventoItem | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleOpenCreate = () => {
    setEditingEvento(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (evento: EventoItem) => {
    setEditingEvento(evento);
    setModalOpen(true);
  };

  const handleOpenDelete = (evento: EventoItem) => {
    setDeletingEvento(evento);
    setDeleteDialogOpen(true);
  };

  const filteredEventos = eventos.filter((ev) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      ev.name.toLowerCase().includes(term) ||
      (ev.location && ev.location.toLowerCase().includes(term)) ||
      (ev.description && ev.description.toLowerCase().includes(term))
    );
  });

  // Métricas rápidas
  const totalTickets = eventos.reduce(
    (acc, ev) => acc + (ev.tickets_sold ?? ev.ticketsSold ?? 0),
    0
  );
  const upcomingEvents = eventos.filter((ev) => {
    const cd = getEventCountdown(ev.date);
    return cd.variant !== "slate";
  });

  return (
    <PageShell
      title="Gestão de Eventos & Réguas"
      subtitle="Gerencie festas e congressos, acompanhe as esteiras automáticas (Pré-venda, VIP e Pós-evento) e sincronize com o calendário."
    >
      <div className="flex flex-col gap-6">
        {/* Barra Superior de Ações & Busca */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div className="space-y-0.5">
            <h1 className="text-xl font-extrabold text-foreground flex items-center gap-2">
              <PartyPopper className="h-5 w-5 text-pink-500" />
              Painel de Eventos
            </h1>
            <p className="text-xs text-muted-foreground">
              Acompanhe as datas programadas e o disparo inteligente das réguas temporais.
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              size="sm"
              onClick={handleOpenCreate}
              className="bg-pink-600 hover:bg-pink-700 text-white gap-1.5 shadow-sm shrink-0"
            >
              <Plus className="h-4 w-4" /> Novo Evento
            </Button>
          </div>
        </div>

        {/* Métricas e KPIs Rápidos */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-border/70 bg-card">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <CalendarCheck className="h-3.5 w-3.5 text-pink-500" />
                Eventos Programados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{eventos.length}</div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {upcomingEvents.length} nos próximos dias
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Ticket className="h-3.5 w-3.5 text-amber-500" />
                Ingressos Vendidos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{totalTickets.toLocaleString("pt-BR")}</div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Total acumulado
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                Réguas Temporais
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">3 Esteiras</div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Pré-venda (D-7), VIP e Pós-evento (D+1)
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Barra de Filtro e Busca */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, local ou atração..."
              className="pl-8 h-9 text-xs"
            />
          </div>
        </div>

        {/* Conteúdo Principal: Lista de Cards ou Estados Vazios */}
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground border rounded-lg bg-card/50 flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-pink-600" />
            <span className="text-xs">Carregando eventos e esteiras…</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center border border-destructive/40 rounded-lg bg-destructive/10 space-y-3">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto" />
            <p className="text-xs text-destructive font-medium">
              {error instanceof Error ? error.message : "Falha ao carregar eventos."}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1 text-xs">
              <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
            </Button>
          </div>
        ) : filteredEventos.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground border border-dashed rounded-lg bg-card flex flex-col items-center justify-center gap-3">
            <div className="h-12 w-12 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-600">
              <Calendar className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                {search ? "Nenhum evento corresponde à busca." : "Nenhum evento cadastrado ainda."}
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Cadastre seus eventos para alimentar o calendário operacional e acionar automaticamente as esteiras de pré-venda e pós-evento.
              </p>
            </div>
            {!search && (
              <Button size="sm" onClick={handleOpenCreate} className="bg-pink-600 hover:bg-pink-700 text-white gap-1 mt-1">
                <Plus className="h-4 w-4" /> Criar Primeiro Evento
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredEventos.map((evento) => (
              <EventCard
                key={evento.id}
                evento={evento}
                onEdit={handleOpenEdit}
                onDelete={handleOpenDelete}
              />
            ))}
          </div>
        )}

        {/* Modais de Formulário e Confirmação */}
        <EventFormModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          eventoToEdit={editingEvento}
          clientId={effectiveTenantId}
        />

        <DeleteEventDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          evento={deletingEvento}
          clientId={effectiveTenantId}
        />
      </div>
    </PageShell>
  );
};

export default Eventos;
