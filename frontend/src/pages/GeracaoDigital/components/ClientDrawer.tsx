import React from "react";
import {
  X,
  ExternalLink,
  FolderOpen,
  Phone,
  Mail,
  UserCheck,
  Loader2,
  Copy,
  Check,
  Calendar,
  Video,
  CheckCircle2,
  Clock,
  Sparkles,
  RotateCw,
  FileText,
  Palette,
  Film,
  CalendarDays,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import {
  useCriarGruposWhatsapp,
  useEmitirGdPortalToken,
  useOferecerHorariosBriefing,
  useConfirmarAgendamentoBriefing,
  useSintetizarBriefing,
} from "@/hooks/useGdClientes";
import type { PortfolioClient } from "./PortfolioTable";

interface ClientDrawerProps {
  client: PortfolioClient | null;
  onClose: () => void;
  onOpenIdentityWizard?: (client: PortfolioClient) => void;
}

function isValidDriveUrl(url?: string | null): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return false;
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

function formatarDataHora(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const DOCS_CONFIG = [
  {
    key: "briefing" as const,
    titulo: "01. Briefing Consolidado (11 Blocos)",
    descricao: "Resumo, concorrência, dores, pauta e próximos passos",
    icone: FileText,
    cor: "text-blue-500 bg-blue-500/10 border-blue-500/20",
  },
  {
    key: "identidade" as const,
    titulo: "02. Identidade Visual & Diretrizes",
    descricao: "Regra de ouro, personalidade, cores, fontes e fotos reais",
    icone: Palette,
    cor: "text-purple-500 bg-purple-500/10 border-purple-500/20",
  },
  {
    key: "roteiros" as const,
    titulo: "03. Roteiros de Gravação (3 Meses)",
    descricao: "Roteiros categorizados prontos para gravação e reels",
    icone: Film,
    cor: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  },
  {
    key: "planejamento" as const,
    titulo: "04. Planejamento Trimestral",
    descricao: "Cronograma de produção, metas e canais de aquisição",
    icone: CalendarDays,
    cor: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
  },
];

export function ClientDrawer({ client, onClose }: ClientDrawerProps) {
  const criarGrupos = useCriarGruposWhatsapp();
  const emitirPortal = useEmitirGdPortalToken();
  const oferecerBriefing = useOferecerHorariosBriefing();
  const confirmarBriefing = useConfirmarAgendamentoBriefing();
  const sintetizarBriefing = useSintetizarBriefing();

  const [criandoGrupos, setCriandoGrupos] = React.useState(false);
  const [abrindoPortal, setAbrindoPortal] = React.useState(false);
  const [copiandoPortal, setCopiandoPortal] = React.useState(false);
  const [copiado, setCopiado] = React.useState(false);
  const [oferecendoBriefing, setOferecendoBriefing] = React.useState(false);
  const [confirmandoOpcao, setConfirmandoOpcao] = React.useState<number | null>(null);
  const [sintetizandoBriefing, setSintetizandoBriefing] = React.useState(false);

  if (!client) return null;

  const handleSintetizarBriefing = async () => {
    if (!client?.id) return;
    setSintetizandoBriefing(true);
    try {
      await sintetizarBriefing.mutateAsync(client.id);
      toast({
        title: "⚡ Briefing e Documentos Gerados!",
        description: "Os 4 documentos oficiais nos 11 blocos foram gerados com IA e salvos no Google Drive.",
      });
    } catch (err) {
      toast({
        title: "Erro ao sintetizar briefing",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSintetizandoBriefing(false);
    }
  };

  const handleCriarGrupos = async () => {
    if (!client?.id) return;
    setCriandoGrupos(true);
    try {
      const res = await criarGrupos.mutateAsync({
        clienteId: client.id,
        force: false,
      });
      if (res.status === "already_created") {
        toast({
          title: "Grupos e Pastas já existem",
          description: "Os grupos de WhatsApp e pastas no Google Drive já haviam sido criados anteriormente.",
        });
      } else {
        toast({
          title: "🚀 Sucesso!",
          description: "Grupos de WhatsApp e pastas no Google Drive provisionados com sucesso.",
        });
      }
    } catch (err) {
      toast({
        title: "Erro ao criar grupos e pastas",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setCriandoGrupos(false);
    }
  };

  const handleAbrirPortal = async () => {
    if (!client?.id) return;
    setAbrindoPortal(true);
    try {
      const data = await emitirPortal.mutateAsync(client.id);
      window.open(`/acompanhamento/${data.token}`, "_blank");
    } catch (err) {
      toast({
        title: "Erro ao abrir portal",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setAbrindoPortal(false);
    }
  };

  const handleCopiarLink = async () => {
    if (!client?.id) return;
    setCopiandoPortal(true);
    try {
      const data = await emitirPortal.mutateAsync(client.id);
      const url = `${window.location.origin}/acompanhamento/${data.token}`;
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
      toast({
        title: "Link do portal copiado!",
        description: url,
      });
    } catch (err) {
      toast({
        title: "Erro ao copiar link do portal",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setCopiandoPortal(false);
    }
  };

  const handleOferecerBriefing = async () => {
    if (!client?.id) return;
    setOferecendoBriefing(true);
    try {
      await oferecerBriefing.mutateAsync(client.id);
      toast({
        title: "📅 Horários Oferecidos!",
        description: "Opções de horários de briefing enviadas no WhatsApp do cliente.",
      });
    } catch (err) {
      toast({
        title: "Erro ao oferecer horários",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setOferecendoBriefing(false);
    }
  };

  const handleConfirmarOpcao = async (opcao: number) => {
    if (!client?.id) return;
    setConfirmandoOpcao(opcao);
    try {
      await confirmarBriefing.mutateAsync({ clienteId: client.id, opcao });
      toast({
        title: "✅ Briefing Agendado!",
        description: `Opção ${opcao} confirmada no Google Calendar e no grupo.`,
      });
    } catch (err) {
      toast({
        title: "Erro ao agendar briefing",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setConfirmandoOpcao(null);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl z-50 flex flex-col animate-slide-in-right">
      {/* Header da Gaveta */}
      <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/60 dark:bg-slate-800/40">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-xs text-sm ${client.avatarColor}`}
          >
            {client.name.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white leading-tight">{client.name}</h3>
            <p className="text-xs text-slate-400">Ficha Operacional da Carteira</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Conteúdo da Gaveta */}
      <div className="p-6 space-y-6 overflow-y-auto flex-1 text-xs">
        {/* Contato Principal */}
        <div className="space-y-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Aprovador / Contato Direto
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <UserCheck className="w-4 h-4 text-purple-600 shrink-0" />
              <span className="font-semibold">{client.contactName}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <Phone className="w-4 h-4 text-emerald-600 shrink-0" />
              {client.contactWhatsapp && client.contactWhatsapp !== "—" ? (
                <a
                  href={`https://wa.me/${client.contactWhatsapp.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline hover:text-emerald-600 transition-colors"
                >
                  {client.contactWhatsapp}
                </a>
              ) : (
                <span>{client.contactWhatsapp}</span>
              )}
            </div>
            {client.contactEmail && (
              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <Mail className="w-4 h-4 text-blue-600 shrink-0" />
                <span>{client.contactEmail}</span>
              </div>
            )}
          </div>
        </div>

        {/* Pacotes Contratados */}
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Serviços Contratados
          </p>
          <div className="flex flex-wrap gap-1.5">
            {client.products && client.products.length > 0 ? (
              client.products.map((p, i) => (
                <Badge key={i} variant="outline" className="text-xs py-1 px-2.5">
                  {p}
                </Badge>
              ))
            ) : (
              <span className="text-slate-400 text-xs">Nenhum produto cadastrado</span>
            )}
          </div>
        </div>

        {/* Metas e Postagens */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <p className="text-[10px] font-bold text-slate-400 uppercase">Posts Semanais</p>
            <p className="text-xl font-black text-slate-900 dark:text-white mt-1">
              {client.weeklyPostsDelivered} / {client.weeklyPostsTarget}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">Meta da semana</p>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <p className="text-[10px] font-bold text-slate-400 uppercase">Verba de Mídia</p>
            <p className="text-xl font-black text-slate-900 dark:text-white mt-1">
              {client.monthlyBudget}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">Status: {client.trafficStatus}</p>
          </div>
        </div>

        {/* Briefing & Google Meet */}
        <div className="space-y-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-purple-600" />
              <span>Briefing & Reunião Inicial</span>
            </p>
            {client.briefingAgendadoInicio ? (
              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                <CheckCircle2 className="w-3 h-3 mr-1" /> Briefing Confirmado
              </Badge>
            ) : (
              <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-bold">
                <Clock className="w-3 h-3 mr-1" /> Pendente
              </Badge>
            )}
          </div>

          {client.briefingAgendadoInicio ? (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-semibold text-xs">
                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>{formatarDataHora(client.briefingAgendadoInicio)}</span>
              </div>
              {client.briefingMeetUrl && (
                <a
                  href={client.briefingMeetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 w-full p-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold transition-all shadow-xs"
                >
                  <Video className="w-4 h-4" />
                  <span>Entrar no Google Meet ↗</span>
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-2.5 pt-1">
              <Button
                type="button"
                onClick={handleOferecerBriefing}
                disabled={oferecendoBriefing}
                variant="outline"
                className="w-full justify-center gap-2 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 font-bold hover:bg-purple-50 dark:hover:bg-purple-950/40 cursor-pointer"
              >
                {oferecendoBriefing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>Oferecendo Horários...</span>
                  </>
                ) : (
                  <>
                    <Calendar className="w-4 h-4" />
                    <span>📅 Oferecer Horários no WhatsApp</span>
                  </>
                )}
              </Button>

              {client.briefingSlotsOferecidos && client.briefingSlotsOferecidos.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Horários oferecidos (Confirmação Manual):
                  </p>
                  <div className="space-y-1">
                    {client.briefingSlotsOferecidos.map((slot) => {
                      const numOpcao = slot.opcao ?? slot.id;
                      return (
                        <div
                          key={numOpcao}
                          className="flex items-center justify-between p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs"
                        >
                          <span className="text-slate-700 dark:text-slate-300 font-medium truncate max-w-[180px]">
                            {slot.label || formatarDataHora(slot.inicio)}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={confirmandoOpcao !== null}
                            onClick={() => handleConfirmarOpcao(numOpcao)}
                            className="h-7 text-[11px] font-bold px-2.5 cursor-pointer"
                          >
                            {confirmandoOpcao === numOpcao ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              `Confirmar Opção ${numOpcao}`
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Documentos Oficiais & Síntese de Briefing (11 Blocos) */}
        <div className="space-y-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              <span>Documentos Oficiais (IA)</span>
            </p>
            {client.briefingDocumentos && Object.keys(client.briefingDocumentos).length > 0 ? (
              <Badge className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 text-[10px] font-bold">
                4 Documentos Prontos
              </Badge>
            ) : (
              <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-bold">
                Pendente
              </Badge>
            )}
          </div>

          {client.briefingDocumentos && Object.keys(client.briefingDocumentos).length > 0 ? (
            <div className="space-y-2 pt-1">
              {DOCS_CONFIG.map(({ key, titulo, descricao, icone: Icone, cor }) => {
                const doc = client.briefingDocumentos?.[key];
                const linkVisualizar = doc?.pdfUrl || doc?.docxUrl;
                return (
                  <div
                    key={key}
                    className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col gap-1.5 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`p-1.5 rounded-md border shrink-0 ${cor}`}>
                          <Icone className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 dark:text-slate-200 truncate text-[11px]">
                            {titulo}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">{descricao}</p>
                        </div>
                      </div>
                      {linkVisualizar && (
                        <a
                          href={linkVisualizar}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-purple-600 hover:text-purple-700 dark:text-purple-400 text-[11px] font-bold flex items-center gap-1 hover:underline pt-0.5"
                        >
                          <span>Acessar</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    {(doc?.pdfUrl || doc?.docxUrl) && (
                      <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/60 text-[10px]">
                        {doc.pdfUrl && (
                          <a
                            href={doc.pdfUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-red-600 dark:text-red-400 hover:underline font-semibold flex items-center gap-0.5"
                          >
                            <span>PDF ↗</span>
                          </a>
                        )}
                        {doc.docxUrl && (
                          <a
                            href={doc.docxUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:underline font-semibold flex items-center gap-0.5"
                          >
                            <span>DOCX ↗</span>
                          </a>
                        )}
                        {doc.versao && (
                          <span className="ml-auto text-slate-400 font-mono text-[9px]">
                            {doc.versao}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <Button
                type="button"
                variant="outline"
                onClick={handleSintetizarBriefing}
                disabled={sintetizandoBriefing}
                className="w-full justify-center gap-2 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-100 dark:hover:bg-slate-800/60 cursor-pointer text-xs mt-2"
              >
                {sintetizandoBriefing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-purple-600" />
                    <span>Regerando Briefing com IA...</span>
                  </>
                ) : (
                  <>
                    <RotateCw className="w-3.5 h-3.5 text-slate-500" />
                    <span>🔄 Regerar Briefing Oficial</span>
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Gere os 4 documentos oficiais da Geração Digital (Briefing 11 Blocos, Identidade Visual, Roteiros de 3 Meses e Planejamento Trimestral) estruturados com IA e arquivados no Google Drive.
              </p>
              <Button
                type="button"
                onClick={handleSintetizarBriefing}
                disabled={sintetizandoBriefing}
                className="w-full justify-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold py-2.5 rounded-xl shadow-xs cursor-pointer transition-all disabled:opacity-50 text-xs"
              >
                {sintetizandoBriefing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>Sintetizando Briefing com IA...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>⚡ Gerar Briefing Oficial & Documentos (IA)</span>
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Ações Operacionais */}
        <div className="space-y-2.5 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Ações Operacionais
          </p>
          <Button
            type="button"
            onClick={handleCriarGrupos}
            disabled={criandoGrupos}
            className="w-full justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-2.5 rounded-xl shadow-xs cursor-pointer transition-all disabled:opacity-50"
          >
            {criandoGrupos ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>Criando Grupos & Pastas...</span>
              </>
            ) : (
              <>
                <span>🚀 Criar Grupos & Pastas Drive</span>
              </>
            )}
          </Button>
        </div>

        {/* Links Operacionais */}
        <div className="space-y-2.5 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Acessos Operacionais
          </p>

          {isValidDriveUrl(client.driveFolderUrl) && (
            <a
              href={client.driveFolderUrl!}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors font-medium text-slate-700 dark:text-slate-300"
            >
              <FolderOpen className="w-4 h-4 text-blue-500" />
              <span>Pasta de Ativos no Google Drive</span>
              <ExternalLink className="w-3.5 h-3.5 ml-auto text-slate-400" />
            </a>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAbrirPortal}
              disabled={abrindoPortal || copiandoPortal}
              className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-xl border border-purple-200 dark:border-purple-800/40 bg-purple-50/50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 font-bold hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors cursor-pointer disabled:opacity-50"
            >
              {abrindoPortal ? (
                <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
              ) : (
                <ExternalLink className="w-4 h-4 text-purple-600" />
              )}
              <span>Abrir Portal do Cliente</span>
            </button>

            <button
              type="button"
              onClick={handleCopiarLink}
              disabled={abrindoPortal || copiandoPortal}
              className="flex items-center justify-center gap-1.5 p-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium transition-colors cursor-pointer disabled:opacity-50 shrink-0"
              title="Copiar Link do Portal"
            >
              {copiandoPortal ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
              ) : copiado ? (
                <Check className="w-4 h-4 text-emerald-600" />
              ) : (
                <Copy className="w-4 h-4 text-slate-500" />
              )}
              <span>{copiado ? "Copiado!" : "Copiar Link"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
