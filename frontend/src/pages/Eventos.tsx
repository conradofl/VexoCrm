import React, { useState } from "react";
import PageShell from "../components/PageShell";
import { DashboardEsteiras, EsteirasStatus } from "../components/DashboardEsteiras";

interface EventoMock {
  id: string;
  name: string;
  date: string;
  esteiras: EsteirasStatus;
}

const mockEventos: EventoMock[] = [
  {
    id: "evt-future-1",
    name: "LivPub Pré-venda VIP",
    date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    esteiras: {
      esteira1: "aguardando_disparo",
      esteira2: "processando_prompts",
      esteira5: "aguardando_data"
    }
  },
  {
    id: "evt-past-1",
    name: "LivPub Masterclass",
    date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    esteiras: {
      esteira1: "enviado",
      esteira2: "enviado",
      esteira5: "cupom_enviado"
    }
  }
];

export const Eventos: React.FC = () => {
  const [eventos] = useState<EventoMock[]>(mockEventos);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(mockEventos[0].id);

  const selectedEvent = eventos.find((e) => e.id === selectedEventId);

  return (
    <PageShell
      title="Gestão de Eventos"
      description="Acompanhe os eventos da LivPub e o status das campanhas (Esteiras 1, 2 e 5)."
    >
      <div className="flex flex-col gap-8">
        {/* Sessão da Listagem de Eventos - Track B substituirá isso por Table modular */}
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

        {/* Dashboard de Esteiras para o Evento Selecionado */}
        {selectedEvent && (
          <div>
            <h2 className="text-xl font-semibold border-b pb-2">
              Dashboard de Esteiras: <span className="text-primary">{selectedEvent.name}</span>
            </h2>
            <DashboardEsteiras esteiras={selectedEvent.esteiras} />
          </div>
        )}
      </div>
    </PageShell>
  );
};

export default Eventos;
