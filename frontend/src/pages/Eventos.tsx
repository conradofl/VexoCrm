import React, { useState, useEffect } from "react";
import { PageShell } from "../components/PageShell";
import { DashboardEsteiras, EsteirasStatus } from "../components/DashboardEsteiras";
import { fetchApi } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

interface Evento {
  id: string;
  name: string;
  date: string;
  location?: string;
  esteiras?: EsteirasStatus;
}

export const Eventos: React.FC = () => {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const { getIdToken } = useAuth();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newEventName, setNewEventName] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [newEventLocation, setNewEventLocation] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const fetchEventos = async () => {
      try {
        setLoading(true);
        setError(null);
        const token = await getIdToken();
        if (!token) return;
        const response = await fetchApi("/api/eventos", {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Falha ao carregar eventos: ${response.status} ${response.statusText} - ${text}`);
        }
        const data = await response.json();
        
        // Mapeia os eventos do banco e adiciona status default paras as esteiras,
        // já que a tabela "events" ainda não possui essas colunas reais.
        const mappedData = data.map((e: Partial<Evento>) => ({
          ...e,
          esteiras: e.esteiras || {
            esteira1: "aguardando_disparo",
            esteira2: "aguardando_vaga",
            esteira5: "aguardando_data",
          }
        }));
        
        setEventos(mappedData);
        if (mappedData.length > 0) {
          setSelectedEventId(mappedData[0].id);
        }
      } catch (err) {
        console.error("Erro ao buscar eventos:", err);
        setError(err instanceof Error ? err.message : "Erro desconhecido ao carregar eventos.");
      } finally {
        setLoading(false);
      }
    };

    fetchEventos();
  }, []);

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventName || !newEventDate) return;
    try {
      setCreating(true);
      const token = await getIdToken();
      if (!token) return;
      const response = await fetchApi("/api/eventos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newEventName,
          date: newEventDate,
          location: newEventLocation,
        }),
      });
      if (!response.ok) {
        throw new Error("Falha ao criar evento");
      }
      const createdEvent = await response.json();
      const mappedEvent = {
        ...createdEvent,
        esteiras: {
          esteira1: "aguardando_disparo",
          esteira2: "aguardando_vaga",
          esteira5: "aguardando_data",
        },
      };
      setEventos((prev) => [mappedEvent, ...prev]);
      setSelectedEventId(mappedEvent.id);
      setIsDialogOpen(false);
      setNewEventName("");
      setNewEventDate("");
      setNewEventLocation("");
    } catch (err) {
      console.error(err);
      alert("Erro ao criar evento: " + (err instanceof Error ? err.message : "Erro desconhecido"));
    } finally {
      setCreating(false);
    }
  };

  const selectedEvent = eventos.find((e) => e.id === selectedEventId);

  return (
    <PageShell
      title="Gestão de Eventos"
      subtitle="Acompanhe os eventos da LivPub e o status das campanhas (Esteiras 1, 2 e 5)."
    >
      <div className="flex flex-col gap-6">
        {/* Custom Header since PageShell is hidden when nested */}
        <div className="flex items-center justify-between border-b pb-4">
          <div>
            <h1 className="text-xl font-extrabold text-foreground">Gestão de Eventos</h1>
            <p className="text-xs text-muted-foreground">Acompanhe os eventos da LivPub e o status das campanhas (Esteiras 1, 2 e 5).</p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Novo Evento</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <form onSubmit={handleCreateEvent}>
                <DialogHeader>
                  <DialogTitle>Criar Novo Evento</DialogTitle>
                  <DialogDescription>
                    Preencha os dados do evento para inicializar as esteiras de relacionamento.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="name" className="text-right">
                      Nome
                    </Label>
                    <Input
                      id="name"
                      required
                      value={newEventName}
                      onChange={(e) => setNewEventName(e.target.value)}
                      placeholder="Nome do Evento"
                      className="col-span-3"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="date" className="text-right">
                      Data
                    </Label>
                    <Input
                      id="date"
                      type="date"
                      required
                      value={newEventDate}
                      onChange={(e) => setNewEventDate(e.target.value)}
                      className="col-span-3"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="location" className="text-right">
                      Local
                    </Label>
                    <Input
                      id="location"
                      value={newEventLocation}
                      onChange={(e) => setNewEventLocation(e.target.value)}
                      placeholder="Local (Opcional)"
                      className="col-span-3"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={creating}>
                    {creating ? "Criando..." : "Criar Evento"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="p-8 text-center text-muted-foreground border rounded-md">
            Carregando eventos...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-destructive border border-destructive/50 rounded-md bg-destructive/10">
            {error}
          </div>
        ) : eventos.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground border rounded-md flex flex-col items-center justify-center gap-4">
            <span>Nenhum evento encontrado. Crie um evento para visualizar as esteiras.</span>
            <Button onClick={() => setIsDialogOpen(true)} variant="outline">
              Criar Primeiro Evento
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="border rounded-md p-4 bg-card text-card-foreground shadow-sm md:col-span-1">
              <h2 className="text-lg font-semibold mb-4">Eventos Ativos</h2>
              <div className="space-y-2">
                {eventos.map((evento) => (
                  <div 
                    key={evento.id} 
                    className={`p-3 border rounded-md cursor-pointer transition-colors ${selectedEventId === evento.id ? "bg-accent/50 border-primary" : "hover:bg-accent/20"}`}
                    onClick={() => setSelectedEventId(evento.id)}
                  >
                    <div className="font-medium text-sm">{evento.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Data: {new Date(evento.date).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedEvent && selectedEvent.esteiras && (
              <div className="md:col-span-3 space-y-4">
                <h2 className="text-lg font-semibold border-b pb-2">
                  Dashboard de Esteiras: <span className="text-primary">{selectedEvent.name}</span>
                </h2>
                <DashboardEsteiras esteiras={selectedEvent.esteiras} />
              </div>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
};

export default Eventos;
