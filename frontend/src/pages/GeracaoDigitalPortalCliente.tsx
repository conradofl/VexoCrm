// Portal do Cliente da Geração Digital: tela pública para o cliente acompanhar
// a régua de entrada e evolução do seu projeto em tempo real.
// Acesso por token único e revogável (/acompanhamento/:token).
import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchApi } from "@/lib/api";
import { TrilhaGd } from "@/components/TrilhaGd";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  Clock,
  ExternalLink,
  FileText,
  FolderOpen,
  MessageCircle,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import type { GdEstado } from "@/lib/gdClientes";
import type { EventoMinimo } from "@/lib/gdTrilha";

interface ClientePublico {
  nome: string;
  estado_atual: string | null;
  estado_desde: string | null;
  estado_data_estimada: boolean;
  proposal_id: string | null;
  drive_url: string | null;
  escopo: string[] | null;
}

interface PortalData {
  cliente: ClientePublico;
  estados: GdEstado[];
  eventos: EventoMinimo[];
}

const FORMATADOR_DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

function formatarData(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return FORMATADOR_DATA.format(new Date(iso));
  } catch {
    return "";
  }
}

export default function GeracaoDigitalPortalCliente() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  useEffect(() => {
    let ativo = true;

    async function carregarPortal() {
      if (!token || !token.trim()) {
        setErrorStatus(404);
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorStatus(null);

      try {
        const res = await fetchApi(`/api/gd/public/portal/${encodeURIComponent(token.trim())}`);
        if (!res.ok) {
          if (ativo) {
            setErrorStatus(res.status);
            setLoading(false);
          }
          return;
        }

        const json = await res.json();
        if (ativo) {
          setData(json);
          setLoading(false);
        }
      } catch (err) {
        if (ativo) {
          setErrorStatus(500);
          setLoading(false);
        }
      }
    }

    carregarPortal();
    return () => {
      ativo = false;
    };
  }, [token]);

  // 1. Estado de Carregamento
  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-5 w-48" />
          </div>
          <Skeleton className="h-24 w-full rounded-lg" />
          <div className="p-6 border rounded-lg space-y-4">
            <Skeleton className="h-6 w-36" />
            <div className="space-y-6 pt-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex gap-4 items-center">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-60" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. Estado de Erro (404 Link inválido/expirado ou outros erros)
  if (errorStatus || !data) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6">
        <Card className="max-w-md w-full border-muted text-center shadow-lg">
          <CardHeader className="space-y-3 pb-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <CardTitle className="text-xl">Link inválido ou expirado</CardTitle>
            <CardDescription className="text-sm">
              Este link de acompanhamento não está mais ativo ou foi revogado por segurança.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Se você é o responsável pelo projeto, solicite um novo link diretamente ao seu consultor ou à equipe da Geração Digital.
            </p>
            <div className="pt-2">
              <Button asChild className="w-full">
                <a
                  href="https://wa.me/5511999998888?text=Ol%C3%A1%2C%20meu%20link%20de%20acompanhamento%20do%20portal%20est%C3%A1%20expirado."
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="w-4 h-4 mr-2" />
                  Falar com a Geração Digital
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { cliente, estados, eventos } = data;
  const estadoAtualObj = estados.find((e) => e.codigo === cliente.estado_atual);
  const rotuloAtual = estadoAtualObj?.rotulo_portal || cliente.estado_atual || "Em andamento";
  const acaoDoCliente = estadoAtualObj?.acao_do_cliente === true;
  const dataDesdeFormatada = formatarData(cliente.estado_desde);

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20 pb-16">
      {/* Barra de marca superior */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold tracking-tight text-base sm:text-lg">Geração Digital</span>
            <span className="text-muted-foreground text-xs font-medium">· Portal do Cliente</span>
          </div>
          <Badge variant="outline" className="text-xs font-normal">
            Acompanhamento
          </Badge>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 space-y-6">
        {/* Cabeçalho do Cliente */}
        <section aria-label="Identificação do projeto" className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Projeto</p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{cliente.nome}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge
              variant={acaoDoCliente ? "default" : "secondary"}
              className={acaoDoCliente ? "bg-amber-600 text-white hover:bg-amber-700" : ""}
            >
              {rotuloAtual}
            </Badge>

            {dataDesdeFormatada && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Nesta etapa desde {dataDesdeFormatada}
                {cliente.estado_data_estimada ? " (estimado)" : ""}
              </span>
            )}
          </div>
        </section>

        {/* Bloco de Ação: Destaca quando a etapa atual precisa do cliente */}
        {acaoDoCliente && (
          <Card className="border-amber-500/40 bg-amber-500/10 dark:bg-amber-950/20 shadow-sm" role="region" aria-label="Ação necessária">
            <CardContent className="p-4 sm:p-5 flex items-start gap-3">
              <div className="p-2 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 mt-0.5 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-amber-950 dark:text-amber-200">
                  Sua ação é necessária nesta etapa: {rotuloAtual}
                </p>
                <p className="text-xs sm:text-sm text-amber-900/90 dark:text-amber-300/90">
                  Para mantermos o cronograma do seu projeto avançando, nossa equipe está aguardando sua validação ou assinatura.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Acessos Úteis (Proposta, Drive de entregáveis) */}
        {(cliente.proposal_id || cliente.drive_url) && (
          <section aria-label="Acessos úteis" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {cliente.proposal_id && (
              <Button asChild variant="outline" className="h-auto p-4 justify-between border-border hover:bg-accent">
                <Link to={`/proposta/${cliente.proposal_id}`} target="_blank" rel="noopener noreferrer">
                  <div className="flex items-center gap-3 text-left">
                    <FileText className="w-5 h-5 text-primary shrink-0" />
                    <div>
                      <div className="font-medium text-sm">Ver Proposta</div>
                      <div className="text-xs text-muted-foreground">Termos e escopo aprovados</div>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
                </Link>
              </Button>
            )}

            {cliente.drive_url && (
              <Button asChild variant="outline" className="h-auto p-4 justify-between border-border hover:bg-accent">
                <a href={cliente.drive_url} target="_blank" rel="noopener noreferrer">
                  <div className="flex items-center gap-3 text-left">
                    <FolderOpen className="w-5 h-5 text-primary shrink-0" />
                    <div>
                      <div className="font-medium text-sm">Pasta no Drive</div>
                      <div className="text-xs text-muted-foreground">Criativos, roteiros e arquivos</div>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
                </a>
              </Button>
            )}
          </section>
        )}

        {/* Régua da Trilha de Entrada e Evolução */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base sm:text-lg flex items-center justify-between">
              <span>Linha do Tempo</span>
              <span className="text-xs font-normal text-muted-foreground">Tempo real</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Acompanhe as etapas de implantação e operação do seu contrato.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <TrilhaGd
              modo="portal"
              estados={estados}
              eventos={eventos}
              estadoAtual={cliente.estado_atual}
            />
          </CardContent>
        </Card>

        {/* Rodapé e canal de suporte */}
        <footer className="pt-4 text-center space-y-3 border-t">
          <p className="text-xs text-muted-foreground">
            Dúvidas ou precisa de suporte com alguma etapa?
          </p>
          <Button variant="ghost" size="sm" asChild className="text-xs">
            <a
              href="https://wa.me/5511999998888"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Falar com nossa equipe
            </a>
          </Button>
        </footer>
      </main>
    </div>
  );
}
