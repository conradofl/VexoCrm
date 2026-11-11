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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useCriarGruposWhatsapp, useEmitirGdPortalToken } from "@/hooks/useGdClientes";
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

export function ClientDrawer({ client, onClose }: ClientDrawerProps) {
  const criarGrupos = useCriarGruposWhatsapp();
  const emitirPortal = useEmitirGdPortalToken();
  const [criandoGrupos, setCriandoGrupos] = React.useState(false);
  const [abrindoPortal, setAbrindoPortal] = React.useState(false);
  const [copiandoPortal, setCopiandoPortal] = React.useState(false);
  const [copiado, setCopiado] = React.useState(false);

  if (!client) return null;

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
