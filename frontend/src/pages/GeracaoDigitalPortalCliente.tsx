// Portal do Cliente da Geração Digital: tela pública para o cliente acompanhar
// a linha do tempo interativa em tempo real da sua jornada, documentos e suporte.
// Acesso por token único revogável (/acompanhamento/:token) ou slug (/portal/:slug).
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
  Bot,
  CalendarCheck2,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileCheck,
  FileText,
  FolderOpen,
  MessageCircle,
  Palette,
  Rocket,
  ShieldAlert,
  Sparkles,
  Star,
} from "lucide-react";
import type { GdEstado } from "@/lib/gdClientes";
import type { EventoMinimo } from "@/lib/gdTrilha";

interface BriefingDocItem {
  docx_url?: string | null;
  pdf_url?: string | null;
}

interface BriefingDocumentosPublico {
  briefing?: BriefingDocItem;
  identidade_visual?: BriefingDocItem;
  roteiro?: BriefingDocItem;
  planejamento?: BriefingDocItem;
  drive_pasta_url?: string | null;
}

interface ClientePublico {
  nome: string;
  estado_atual: string | null;
  estado_desde: string | null;
  estado_data_estimada: boolean;
  proposal_id: string | null;
  drive_url: string | null;
  contrato_url: string | null;
  briefing_url: string | null;
  ficha_vexo_url: string | null;
  planejamento_url: string | null;
  escopo: string[] | null;
  grupo_cliente_url?: string | null;
  onboarding_concluido_em?: string | null;
  portal_slug?: string | null;
  vexto_briefing_status?: string | null;
  briefing_documentos?: BriefingDocumentosPublico | null;
  chips_configurados?: {
    total: number;
    ativos: number;
    prontos: boolean;
  } | null;
}

interface PortalData {
  cliente: ClientePublico;
  estados: GdEstado[];
  eventos: EventoMinimo[];
  suporte?: {
    whatsapp?: string;
    google_review_url?: string;
    instagram_url?: string;
  };
}

export type StatusEtapaJornada = "concluido" | "ativo" | "futuro";

export interface EtapaJornada {
  numero: number;
  titulo: string;
  subtitulo: string;
  descricao: string;
  status: StatusEtapaJornada;
  icone: React.ComponentType<{ className?: string }>;
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

/**
 * Calcula as 5 Grandes Etapas da Jornada do Cliente na Geração Digital (Frente 7)
 */
export function calcularJornada5Etapas(cliente: ClientePublico, estados: GdEstado[]): EtapaJornada[] {
  const estadoAtualObj = estados.find((e) => e.codigo === cliente.estado_atual);
  const ordemAtual = estadoAtualObj ? Number(estadoAtualObj.ordem) : 10;

  // 1. Contrato & Boas-Vindas
  const etapa1Concluida =
    ordemAtual >= 60 || Boolean(cliente.contrato_url) || Boolean(cliente.onboarding_concluido_em);
  const etapa1Status: StatusEtapaJornada = etapa1Concluida ? "concluido" : "ativo";

  // 2. Briefing & Identidade Visual
  let etapa2Status: StatusEtapaJornada = "futuro";
  if (ordemAtual >= 130 || (Boolean(cliente.briefing_url) && ordemAtual >= 120)) {
    etapa2Status = "concluido";
  } else if (ordemAtual >= 80 || etapa1Concluida) {
    etapa2Status = "ativo";
  }

  // 3. Roteiros & Planejamento Trimestral Aprovados
  let etapa3Status: StatusEtapaJornada = "futuro";
  if (ordemAtual >= 150 || (Boolean(cliente.planejamento_url) && ordemAtual >= 140)) {
    etapa3Status = "concluido";
  } else if (ordemAtual >= 130 || etapa2Status === "concluido") {
    etapa3Status = "ativo";
  }

  // 4. Chips Virtuais & Robô IA Ativado
  let etapa4Status: StatusEtapaJornada = "futuro";
  const chipsProntos =
    cliente.chips_configurados?.prontos === true ||
    cliente.vexto_briefing_status === "CONCLUIDO" ||
    ordemAtual >= 160;
  if (chipsProntos) {
    etapa4Status = "concluido";
  } else if (ordemAtual >= 150 || etapa3Status === "concluido") {
    etapa4Status = "ativo";
  }

  // 5. Tráfego Pago & Máquina de Vendas em Operação
  let etapa5Status: StatusEtapaJornada = "futuro";
  if (ordemAtual >= 160) {
    etapa5Status = "concluido";
  } else if (ordemAtual >= 150 && etapa4Status === "concluido") {
    etapa5Status = "ativo";
  }

  return [
    {
      numero: 1,
      titulo: "Contrato & Boas-Vindas",
      subtitulo: etapa1Status === "concluido" ? "Concluído" : "Em andamento",
      descricao: "Assinatura do instrumento jurídico, setup de acessos e integração do grupo de trabalho.",
      status: etapa1Status,
      icone: FileCheck,
    },
    {
      numero: 2,
      titulo: "Briefing & Identidade Visual",
      subtitulo: etapa2Status === "concluido" ? "Concluído" : etapa2Status === "ativo" ? "Em andamento" : "Próxima etapa",
      descricao: "Mapeamento aprofundado do público-alvo, diretrizes da marca e logotipo institucional calibrado.",
      status: etapa2Status,
      icone: Palette,
    },
    {
      numero: 3,
      titulo: "Roteiros & Planejamento Trimestral",
      subtitulo: etapa3Status === "concluido" ? "Aprovados" : etapa3Status === "ativo" ? "Em validação" : "Aguardando briefing",
      descricao: "Linhas editoriais, roteiros de captação e cronograma de campanhas validados com a equipe.",
      status: etapa3Status,
      icone: CalendarCheck2,
    },
    {
      numero: 4,
      titulo: "Chips Virtuais & Robô IA Ativado",
      subtitulo: etapa4Status === "concluido" ? "Ativado" : etapa4Status === "ativo" ? "Em parametrização" : "Aguardando estratégia",
      descricao: "Provisionamento de instâncias WhatsApp (Gabriel 72h), regras de negócio e agente IA ativado.",
      status: etapa4Status,
      icone: Bot,
    },
    {
      numero: 5,
      titulo: "Tráfego Pago & Máquina de Vendas",
      subtitulo: etapa5Status === "concluido" ? "Em Operação" : etapa5Status === "ativo" ? "Iniciando tráfego" : "Fase final",
      descricao: "Campanhas de tráfego ativas, SDR virtual convertendo leads e acompanhamento contínuo de CS.",
      status: etapa5Status,
      icone: Rocket,
    },
  ];
}

export default function GeracaoDigitalPortalCliente() {
  const { token, slug } = useParams<{ token?: string; slug?: string }>();
  const identifier = token || slug;

  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  useEffect(() => {
    let ativo = true;

    async function carregarPortal() {
      if (!identifier || !identifier.trim()) {
        setErrorStatus(404);
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorStatus(null);

      try {
        const res = await fetchApi(`/api/gd/public/portal/${encodeURIComponent(identifier.trim())}`);
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
      } catch {
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
  }, [identifier]);

  // 1. Estado de Carregamento
  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-5 w-48" />
          </div>
          <Skeleton className="h-28 w-full rounded-xl" />
          <div className="p-6 border rounded-xl space-y-4">
            <Skeleton className="h-6 w-36" />
            <div className="space-y-6 pt-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex gap-4 items-center">
                  <Skeleton className="h-6 w-6 rounded-full" />
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
    const whatsappErro = "5534997719779";
    const linkWhatsAppErro = `https://wa.me/${whatsappErro}?text=${encodeURIComponent(
      "Olá! Meu link de acompanhamento do portal está expirado ou inválido."
    )}`;

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
                <a href={linkWhatsAppErro} target="_blank" rel="noopener noreferrer">
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

  const { cliente, estados, eventos, suporte } = data;
  const estadoAtualObj = estados.find((e) => e.codigo === cliente.estado_atual);
  const rotuloAtual = estadoAtualObj?.rotulo_portal || cliente.estado_atual || "Em andamento";
  const acaoDoCliente = estadoAtualObj?.acao_do_cliente === true;
  const dataDesdeFormatada = formatarData(cliente.estado_desde);

  const suporteWhatsapp = suporte?.whatsapp || "5534997719779";
  const linkGoogleReview = suporte?.google_review_url || "https://g.page/r/CQma70R-HfV7EBM/review";
  const mensagemContextual = `Olá! Sou do projeto ${cliente.nome} e gostaria de tirar uma dúvida sobre a etapa atual: ${rotuloAtual}`;
  const linkWhatsAppSuporte = `https://wa.me/${suporteWhatsapp}?text=${encodeURIComponent(mensagemContextual)}`;

  // Link do grupo de WhatsApp do cliente (Máquina de Vendas)
  const linkGrupoWhatsApp = cliente.grupo_cliente_url || linkWhatsAppSuporte;

  // As 5 Grandes Etapas da Jornada do Cliente
  const jornadaEtapas = calcularJornada5Etapas(cliente, estados);

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20 pb-20">
      {/* Barra de marca superior */}
      <header className="border-b bg-card/60 backdrop-blur-md sticky top-0 z-20 shadow-xs">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground font-black flex items-center justify-center text-sm shadow-xs">
              GD
            </div>
            <div>
              <span className="font-bold tracking-tight text-sm sm:text-base">Geração Digital</span>
              <span className="text-muted-foreground text-xs font-medium ml-1.5 hidden sm:inline">
                · Portal do Cliente Vexo OS
              </span>
            </div>
          </div>
          <Badge variant="outline" className="text-xs font-normal border-primary/30 text-primary bg-primary/5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block mr-1.5 animate-pulse" />
            Tempo Real
          </Badge>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 space-y-8">
        {/* Cabeçalho do Cliente & Projeto */}
        <section aria-label="Identificação do projeto" className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded">
                Projeto Ativo
              </span>
              {cliente.portal_slug && (
                <span className="text-xs text-muted-foreground font-mono">
                  portal/{cliente.portal_slug}
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{cliente.nome}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Badge
              variant={acaoDoCliente ? "default" : "secondary"}
              className={acaoDoCliente ? "bg-amber-600 text-white hover:bg-amber-700 shadow-xs" : ""}
            >
              {rotuloAtual}
            </Badge>

            {dataDesdeFormatada && (
              <span className="text-xs text-muted-foreground flex items-center gap-1 bg-muted/50 px-2 py-1 rounded-md">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                Nesta etapa desde {dataDesdeFormatada}
                {cliente.estado_data_estimada ? " (estimado)" : ""}
              </span>
            )}
          </div>
        </section>

        {/* Botões de Acesso Rápido ao WhatsApp e Google Drive */}
        <section aria-label="Acessos diretos" className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Card WhatsApp Máquina de Vendas */}
          <Card className="border border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50 transition-all shadow-xs p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500 text-white shrink-0 shadow-xs">
                <MessageCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Grupo WhatsApp do Projeto</h3>
                <p className="text-xs text-muted-foreground mt-0.5">MÁQUINA DE VENDAS: {cliente.nome}</p>
              </div>
            </div>
            <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">
              <a href={linkGrupoWhatsApp} target="_blank" rel="noopener noreferrer">
                <span>Abrir Grupo</span>
                <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
              </a>
            </Button>
          </Card>

          {/* Card Google Drive Geral */}
          <Card className="border border-blue-500/30 bg-blue-500/5 hover:border-blue-500/50 transition-all shadow-xs p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-500 text-white shrink-0 shadow-xs">
                <FolderOpen className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Pasta Geral no Google Drive</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Arquivos brutos, criativos e gravações</p>
              </div>
            </div>
            {cliente.drive_url ? (
              <Button asChild size="sm" variant="outline" className="shrink-0 border-blue-500/30 hover:bg-blue-500/10 text-blue-700 dark:text-blue-300">
                <a href={cliente.drive_url} target="_blank" rel="noopener noreferrer">
                  <span>Acessar Drive</span>
                  <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                </a>
              </Button>
            ) : (
              <Button size="sm" variant="ghost" disabled className="text-xs opacity-60">
                Em breve
              </Button>
            )}
          </Card>
        </section>

        {/* Bloco de Ação: Destaca quando a etapa atual precisa do cliente */}
        {acaoDoCliente && (
          <Card className="border-amber-500/40 bg-amber-500/10 dark:bg-amber-950/20 shadow-sm" role="region" aria-label="Ação necessária">
            <CardContent className="p-4 sm:p-5 flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300 mt-0.5 shrink-0">
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

        {/* ─── LINHA DO TEMPO VISUAL DA JORNADA (5 ETAPAS FRENTE 7) ────────────── */}
        <section aria-label="Jornada do Cliente" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                Linha do Tempo da sua Jornada na GD
              </h2>
              <p className="text-xs text-muted-foreground">
                Acompanhe o progresso das 5 etapas fundamentais para a ativação da sua Máquina de Vendas.
              </p>
            </div>
            <Badge variant="outline" className="text-xs font-normal">
              5 Etapas
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-2">
            {jornadaEtapas.map((etapa) => {
              const Icone = etapa.icone;
              const isConcluido = etapa.status === "concluido";
              const isAtivo = etapa.status === "ativo";

              return (
                <Card
                  key={etapa.numero}
                  className={`relative p-4 flex flex-col justify-between transition-all duration-200 ${
                    isConcluido
                      ? "border-emerald-500/40 bg-emerald-500/5 shadow-xs"
                      : isAtivo
                      ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-md"
                      : "border-muted/60 opacity-65 bg-card/40"
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-muted text-muted-foreground">
                        {isConcluido ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : etapa.numero}
                      </span>
                      <Badge
                        variant={isConcluido ? "default" : isAtivo ? "secondary" : "outline"}
                        className={`text-[10px] font-medium ${
                          isConcluido
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                            : isAtivo
                            ? "bg-primary text-primary-foreground animate-pulse"
                            : ""
                        }`}
                      >
                        {etapa.subtitulo}
                      </Badge>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-foreground font-semibold text-sm">
                        <Icone className={`w-4 h-4 shrink-0 ${isConcluido ? "text-emerald-600" : isAtivo ? "text-primary" : "text-muted-foreground"}`} />
                        <h3 className="leading-snug">{etapa.titulo}</h3>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed pt-1">
                        {etapa.descricao}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-border/40 mt-3 text-[11px] font-medium flex items-center gap-1">
                    {isConcluido && (
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Etapa concluída
                      </span>
                    )}
                    {isAtivo && (
                      <span className="text-primary flex items-center gap-1 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                        Em andamento agora
                      </span>
                    )}
                    {!isConcluido && !isAtivo && (
                      <span className="text-muted-foreground">Próximo passo</span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        {/* ─── CENTRAL DOS 4 DOCUMENTOS-CHAVE & ATIVOS ───────────────────────── */}
        <section aria-label="Documentos do projeto" className="space-y-4">
          <div className="space-y-0.5">
            <h2 className="text-base sm:text-lg font-bold tracking-tight">Documentos do Projeto</h2>
            <p className="text-xs text-muted-foreground">Documentos oficiais e estratégicos gerados para a operação do seu contrato.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* 1. Contrato */}
            <Card className="border shadow-sm p-4 flex flex-col justify-between">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0 mt-0.5">
                    <FileCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Contrato de Prestação de Serviços</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Instrumento jurídico e vigência</p>
                  </div>
                </div>
                <Badge variant={cliente.contrato_url ? "default" : "outline"} className="text-[10px] shrink-0 font-normal">
                  {cliente.contrato_url ? "Assinado" : "Em elaboração / assinatura"}
                </Badge>
              </div>
              <div className="pt-4">
                {cliente.contrato_url ? (
                  <Button asChild size="sm" variant="outline" className="w-full text-xs justify-between">
                    <a href={cliente.contrato_url} target="_blank" rel="noopener noreferrer">
                      <span>Acessar contrato</span>
                      <ExternalLink className="w-3.5 h-3.5 ml-1" />
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled className="w-full text-xs justify-center opacity-60">
                    Disponível em breve
                  </Button>
                )}
              </div>
            </Card>

            {/* 2. Briefing de Marketing */}
            <Card className="border shadow-sm p-4 flex flex-col justify-between">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0 mt-0.5">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Briefing de Marketing</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Público-alvo, posicionamento e metas</p>
                  </div>
                </div>
                <Badge variant={cliente.briefing_url ? "default" : "outline"} className="text-[10px] shrink-0 font-normal">
                  {cliente.briefing_url ? "Aprovado" : "Aguardando reunião de briefing"}
                </Badge>
              </div>
              <div className="pt-4 space-y-2">
                {cliente.briefing_url ? (
                  <Button asChild size="sm" variant="outline" className="w-full text-xs justify-between">
                    <a href={cliente.briefing_url} target="_blank" rel="noopener noreferrer">
                      <span>Acessar briefing</span>
                      <ExternalLink className="w-3.5 h-3.5 ml-1" />
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled className="w-full text-xs justify-center opacity-60">
                    Disponível em breve
                  </Button>
                )}

                {/* Links rápidos para download PDF / DOCX quando disponíveis */}
                {cliente.briefing_documentos?.briefing && (
                  <div className="flex gap-2 pt-1">
                    {cliente.briefing_documentos.briefing.pdf_url && (
                      <Button asChild size="sm" variant="secondary" className="flex-1 text-[11px] h-7">
                        <a href={cliente.briefing_documentos.briefing.pdf_url} target="_blank" rel="noopener noreferrer">
                          <Download className="w-3 h-3 mr-1" /> PDF Oficial
                        </a>
                      </Button>
                    )}
                    {cliente.briefing_documentos.briefing.docx_url && (
                      <Button asChild size="sm" variant="secondary" className="flex-1 text-[11px] h-7">
                        <a href={cliente.briefing_documentos.briefing.docx_url} target="_blank" rel="noopener noreferrer">
                          <Download className="w-3 h-3 mr-1" /> DOCX
                        </a>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Card>

            {/* 3. Ficha Vexo & IA */}
            <Card className="border shadow-sm p-4 flex flex-col justify-between">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0 mt-0.5">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Ficha Vexo & IA</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Diretrizes do agente comercial e regras</p>
                  </div>
                </div>
                <Badge variant={cliente.ficha_vexo_url ? "default" : "outline"} className="text-[10px] shrink-0 font-normal">
                  {cliente.ficha_vexo_url ? "Configurado" : "Em parametrização"}
                </Badge>
              </div>
              <div className="pt-4">
                {cliente.ficha_vexo_url ? (
                  <Button asChild size="sm" variant="outline" className="w-full text-xs justify-between">
                    <a href={cliente.ficha_vexo_url} target="_blank" rel="noopener noreferrer">
                      <span>Acessar ficha técnica</span>
                      <ExternalLink className="w-3.5 h-3.5 ml-1" />
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled className="w-full text-xs justify-center opacity-60">
                    Disponível em breve
                  </Button>
                )}
              </div>
            </Card>

            {/* 4. Planejamento & Roteiros */}
            <Card className="border shadow-sm p-4 flex flex-col justify-between">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0 mt-0.5">
                    <CalendarDays className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Planejamento & Roteiros</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Calendário editorial e pautas aprovadas</p>
                  </div>
                </div>
                <Badge variant={cliente.planejamento_url ? "default" : "outline"} className="text-[10px] shrink-0 font-normal">
                  {cliente.planejamento_url ? "Ativo" : "Em elaboração"}
                </Badge>
              </div>
              <div className="pt-4 space-y-2">
                {cliente.planejamento_url ? (
                  <Button asChild size="sm" variant="outline" className="w-full text-xs justify-between">
                    <a href={cliente.planejamento_url} target="_blank" rel="noopener noreferrer">
                      <span>Acessar planejamento</span>
                      <ExternalLink className="w-3.5 h-3.5 ml-1" />
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled className="w-full text-xs justify-center opacity-60">
                    Disponível em breve
                  </Button>
                )}

                {/* Downloads rápidos de Roteiro e Planejamento sintetizados */}
                {(cliente.briefing_documentos?.roteiro || cliente.briefing_documentos?.planejamento) && (
                  <div className="flex gap-2 pt-1">
                    {cliente.briefing_documentos.roteiro?.pdf_url && (
                      <Button asChild size="sm" variant="secondary" className="flex-1 text-[11px] h-7">
                        <a href={cliente.briefing_documentos.roteiro.pdf_url} target="_blank" rel="noopener noreferrer">
                          <Download className="w-3 h-3 mr-1" /> Roteiros PDF
                        </a>
                      </Button>
                    )}
                    {cliente.briefing_documentos.planejamento?.pdf_url && (
                      <Button asChild size="sm" variant="secondary" className="flex-1 text-[11px] h-7">
                        <a href={cliente.briefing_documentos.planejamento.pdf_url} target="_blank" rel="noopener noreferrer">
                          <Download className="w-3 h-3 mr-1" /> Plano PDF
                        </a>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </section>

        {/* Acessos Complementares (Proposta Comercial, Drive Geral) */}
        {(cliente.proposal_id || cliente.drive_url) && (
          <section aria-label="Acessos úteis" className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {cliente.proposal_id && (
              <Button asChild variant="outline" className="h-auto p-4 justify-between border-border hover:bg-accent">
                <Link to={`/proposta/${cliente.proposal_id}`} target="_blank" rel="noopener noreferrer">
                  <div className="flex items-center gap-3 text-left">
                    <FileText className="w-5 h-5 text-primary shrink-0" />
                    <div>
                      <div className="font-medium text-sm">Ver Proposta Comercial</div>
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
                      <div className="font-medium text-sm">Pasta Geral no Drive</div>
                      <div className="text-xs text-muted-foreground">Criativos, roteiros e arquivos</div>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
                </a>
              </Button>
            )}
          </section>
        )}

        {/* Régua da Trilha de Entrada e Evolução Detalhada */}
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

        {/* ─── GATILHO INTELIGENTE: AVALIAÇÃO NO GOOGLE MEU NEGÓCIO ─────────── */}
        <Card className="border border-amber-500/30 bg-gradient-to-r from-amber-500/5 via-orange-500/5 to-primary/5 shadow-xs p-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-amber-500">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} className="w-4 h-4 fill-amber-400 text-amber-400" />
                ))}
                <span className="text-xs font-bold text-foreground ml-1.5">Sua opinião é fundamental!</span>
              </div>
              <h3 className="font-semibold text-sm sm:text-base">Como está sendo sua experiência com a Geração Digital?</h3>
              <p className="text-xs text-muted-foreground max-w-xl">
                Ajude outros empresários a conhecerem nosso trabalho deixando uma avaliação de 5 estrelas no Google Meu Negócio.
              </p>
            </div>
            <Button asChild size="sm" className="bg-amber-500 hover:bg-amber-600 text-amber-950 font-semibold shrink-0">
              <a href={linkGoogleReview} target="_blank" rel="noopener noreferrer">
                <Star className="w-4 h-4 mr-1.5 fill-amber-950" />
                Avaliar no Google
              </a>
            </Button>
          </div>
        </Card>

        {/* Rodapé e canal de suporte oficial */}
        <footer className="pt-4 text-center space-y-3 border-t">
          <p className="text-xs text-muted-foreground">
            Dúvidas ou precisa de suporte com alguma etapa?
          </p>
          <Button variant="ghost" size="sm" asChild className="text-xs">
            <a
              href={linkWhatsAppSuporte}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-primary"
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
