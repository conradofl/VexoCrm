import React, { useState, useEffect } from "react";
import { PageShell } from "../components/PageShell";
import { DashboardEsteiras, EsteirasStatus } from "../components/DashboardEsteiras";
import { fetchApi } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
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
  const { hasAppViewAccess, getIdToken } = useAuth();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

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

  const selectedEvent = eventos.find((e) => e.id === selectedEventId);

  return (
    <PageShell
      title="Gestão de Eventos"
      description="Acompanhe os eventos da LivPub e o status das campanhas (Esteiras 1, 2 e 5)."
    >
      <div className="flex flex-col gap-8">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground border rounded-md">
            Carregando eventos...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-destructive border border-destructive/50 rounded-md bg-destructive/10">
            {error}
          </div>
        ) : eventos.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground border rounded-md">
            Nenhum evento encontrado. Crie um evento para visualizar as esteiras.
          </div>
        ) : (
          <>
            <div className="border rounded-md p-4 bg-card text-card-foreground shadow-sm">
              <h2 className="text-xl font-semibold mb-4">Eventos Ativos</h2>
              <div className="space-y-2">
                {eventos.map((evento) => (
                  <div 
                    key={evento.id} 
                    className={`p-3 border rounded-md cursor-pointer transition-colors ${selectedEventId === evento.id ? "bg-accent/50 border-primary" : "hover:bg-accent/20"}`}
                    onClick={() => setSelectedEventId(evento.id)}
                  >
                    <div className="font-medium">{evento.name}</div>
                    <div className="text-sm text-muted-foreground">
                      Data: {new Date(evento.date).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedEvent && selectedEvent.esteiras && (
              <div>
                <h2 className="text-xl font-semibold border-b pb-2">
                  Dashboard de Esteiras: <span className="text-primary">{selectedEvent.name}</span>
                </h2>
                <DashboardEsteiras esteiras={selectedEvent.esteiras} />
              </div>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
};

export default Eventos;
