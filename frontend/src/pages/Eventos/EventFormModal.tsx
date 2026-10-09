import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EventoItem, useCreateEvento, useUpdateEvento } from "@/hooks/useEventos";

interface EventFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventoToEdit?: EventoItem | null;
  clientId?: string;
}

export const EventFormModal: React.FC<EventFormModalProps> = ({
  open,
  onOpenChange,
  eventoToEdit,
  clientId,
}) => {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [ticketsSold, setTicketsSold] = useState<number | string>(0);

  const createMutation = useCreateEvento();
  const updateMutation = useUpdateEvento();
  const isEditing = Boolean(eventoToEdit);

  useEffect(() => {
    if (eventoToEdit) {
      setName(eventoToEdit.name || "");
      // Formata data ISO para YYYY-MM-DD ou YYYY-MM-DDTHH:mm
      if (eventoToEdit.date) {
        const d = new Date(eventoToEdit.date);
        if (!isNaN(d.getTime())) {
          const iso = d.toISOString();
          setDate(iso.slice(0, 16));
        } else {
          setDate(eventoToEdit.date);
        }
      } else {
        setDate("");
      }
      setLocation(eventoToEdit.location || "");
      setDescription(eventoToEdit.description || "");
      setTicketsSold(eventoToEdit.tickets_sold ?? eventoToEdit.ticketsSold ?? 0);
    } else {
      setName("");
      setDate("");
      setLocation("");
      setDescription("");
      setTicketsSold(0);
    }
  }, [eventoToEdit, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Nome do evento é obrigatório.");
      return;
    }
    if (!date) {
      toast.error("Data do evento é obrigatória.");
      return;
    }

    try {
      if (isEditing && eventoToEdit) {
        await updateMutation.mutateAsync({
          id: eventoToEdit.id,
          name: name.trim(),
          date: new Date(date).toISOString(),
          location: location.trim() || null,
          description: description.trim() || null,
          tickets_sold: Number(ticketsSold) || 0,
          clientId,
        });
        toast.success("Evento atualizado com sucesso!");
      } else {
        await createMutation.mutateAsync({
          name: name.trim(),
          date: new Date(date).toISOString(),
          location: location.trim() || null,
          description: description.trim() || null,
          tickets_sold: Number(ticketsSold) || 0,
          clientId,
        });
        toast.success("Evento criado com sucesso!");
      }

      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar evento.");
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Editar Evento" : "Criar Novo Evento"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Atualize as informações do evento e das réguas de relacionamento."
                : "Preencha os dados do evento para sincronizar com o calendário e acionar as esteiras."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="event-name">Nome do Evento *</Label>
              <Input
                id="event-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Sunset Festival 2026, Baile VIP..."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="event-date">Data & Hora *</Label>
                <Input
                  id="event-date"
                  type="datetime-local"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="event-tickets">Ingressos Vendidos</Label>
                <Input
                  id="event-tickets"
                  type="number"
                  min={0}
                  value={ticketsSold}
                  onChange={(e) => setTicketsSold(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-location">Local / Espaço</Label>
              <Input
                id="event-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Ex: LivPub Lounge, Espaço Sunset, Uberlândia - MG"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-desc">Descrição / Detalhes</Label>
              <Textarea
                id="event-desc"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detalhes sobre atrações, lotes, camarotes ou regras das esteiras..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving} className="bg-pink-600 hover:bg-pink-700 text-white">
              {isSaving ? "Salvando..." : isEditing ? "Salvar Alterações" : "Criar Evento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
