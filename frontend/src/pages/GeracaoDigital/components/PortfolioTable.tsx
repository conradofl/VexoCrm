import React from "react";
import {
  ExternalLink,
  FolderOpen,
  Hash,
  Eye,
  CheckCircle2,
  Clock,
  AlertCircle,
  PauseCircle,
  Sparkles,
  Megaphone,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PortfolioClient {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  avatarColor: string;
  contactName: string;
  contactWhatsapp: string;
  contactEmail?: string;
  products: string[];
  stage: "onboarding" | "identidade_visual" | "producao_ativa" | "aguardando_aprovacao" | "pausado";
  weeklyPostsDelivered: number;
  weeklyPostsTarget: number;
  trafficStatus: "ativo" | "setup" | "pausado";
  monthlyBudget: string;
  trelloActiveCards: number;
  trelloOverdueCards: number;
  driveFolderUrl?: string;
  slackChannel?: string;
}

interface PortfolioTableProps {
  clients: PortfolioClient[];
  onSelectClient: (client: PortfolioClient) => void;
}

export function PortfolioTable({ clients, onSelectClient }: PortfolioTableProps) {
  const getStageBadge = (stage: PortfolioClient["stage"]) => {
    switch (stage) {
      case "onboarding":
        return (
          <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[11px] font-bold">
            <Clock className="w-3 h-3 mr-1" /> Onboarding
          </Badge>
        );
      case "identidade_visual":
        return (
          <Badge className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 text-[11px] font-bold">
            <Sparkles className="w-3 h-3 mr-1" /> Identidade Visual
          </Badge>
        );
      case "producao_ativa":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[11px] font-bold">
            <CheckCircle2 className="w-3 h-3 mr-1" /> Produção Ativa
          </Badge>
        );
      case "aguardando_aprovacao":
        return (
          <Badge className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 text-[11px] font-bold">
            <AlertCircle className="w-3 h-3 mr-1" /> Aguardando Aprovação
          </Badge>
        );
      case "pausado":
        return (
          <Badge className="bg-slate-500/10 text-slate-500 dark:text-slate-400 border border-slate-500/20 text-[11px] font-bold">
            <PauseCircle className="w-3 h-3 mr-1" /> Pausado
          </Badge>
        );
    }
  };

  const getProductColor = (prod: string) => {
    const p = prod.toLowerCase();
    if (p.includes("vídeo") || p.includes("video")) return "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-900";
    if (p.includes("tráfego") || p.includes("trafego")) return "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-900";
    if (p.includes("social") || p.includes("instagram")) return "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-900";
    if (p.includes("branding") || p.includes("logo")) return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900";
    return "bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700";
  };

  const getTrafficBadge = (status: PortfolioClient["trafficStatus"], budget: string) => {
    if (status === "ativo") {
      return (
        <div className="space-y-0.5">
          <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
            Campanhas Ativas
          </Badge>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{budget}</p>
        </div>
      );
    }
    if (status === "setup") {
      return (
        <div className="space-y-0.5">
          <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-[10px] font-bold">
            Pixel & Setup
          </Badge>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{budget}</p>
        </div>
      );
    }
    return (
      <Badge className="bg-slate-500/10 text-slate-500 border border-slate-500/20 text-[10px]">
        Pausado
      </Badge>
    );
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 select-none">
              <th className="py-3.5 px-4">Empresa / Cliente</th>
              <th className="py-3.5 px-4">Pacotes Contratados</th>
              <th className="py-3.5 px-4">Fase da Esteira</th>
              <th className="py-3.5 px-4">Posts da Semana</th>
              <th className="py-3.5 px-4">Tráfego & Mídia</th>
              <th className="py-3.5 px-4">Demandas Trello</th>
              <th className="py-3.5 px-4 text-right">Ações Rápidas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
            {clients.map((client) => {
              const postsPercent =
                client.weeklyPostsTarget > 0
                  ? Math.round((client.weeklyPostsDelivered / client.weeklyPostsTarget) * 100)
                  : 0;

              return (
                <tr
                  key={client.id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors group"
                >
                  {/* Empresa / Cliente */}
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-2xs text-sm shrink-0",
                          client.avatarColor
                        )}
                      >
                        {client.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onSelectClient(client)}
                          className="font-bold text-slate-900 dark:text-white hover:text-purple-650 dark:hover:text-purple-400 transition-colors text-left block truncate max-w-[200px]"
                        >
                          {client.name}
                        </button>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-[200px]">
                          {client.contactName} • {client.contactWhatsapp}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Produtos */}
                  <td className="py-4 px-4">
                    <div className="flex flex-wrap gap-1 max-w-[240px]">
                      {client.products.map((p, idx) => (
                        <span
                          key={idx}
                          className={cn(
                            "px-2 py-0.5 rounded-md text-[10px] font-semibold border",
                            getProductColor(p)
                          )}
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>

                  {/* Fase da Esteira */}
                  <td className="py-4 px-4 whitespace-nowrap">
                    {getStageBadge(client.stage)}
                  </td>

                  {/* Postagens da Semana */}
                  <td className="py-4 px-4 whitespace-nowrap">
                    <div className="space-y-1.5 w-28">
                      <div className="flex justify-between items-center text-[11px] font-mono">
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {client.weeklyPostsDelivered}/{client.weeklyPostsTarget}
                        </span>
                        <span className="text-slate-400 text-[10px]">{postsPercent}%</span>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            postsPercent >= 100
                              ? "bg-emerald-500"
                              : postsPercent >= 50
                              ? "bg-purple-500"
                              : "bg-amber-500"
                          )}
                          style={{ width: `${Math.min(postsPercent, 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>

                  {/* Status do Tráfego */}
                  <td className="py-4 px-4 whitespace-nowrap">
                    {getTrafficBadge(client.trafficStatus, client.monthlyBudget)}
                  </td>

                  {/* Demandas Trello */}
                  <td className="py-4 px-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 text-[11px] font-mono">
                        {client.trelloActiveCards} ativas
                      </Badge>
                      {client.trelloOverdueCards > 0 && (
                        <Badge className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[11px] font-bold">
                          {client.trelloOverdueCards} atrasadas
                        </Badge>
                      )}
                    </div>
                  </td>

                  {/* Ações Rápidas */}
                  <td className="py-4 px-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onSelectClient(client)}
                        className="h-8 w-8 p-0 text-slate-500 hover:text-purple-650 dark:hover:text-purple-400"
                        title="Ver Ficha Operacional"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>

                      {client.driveFolderUrl && (
                        <a
                          href={client.driveFolderUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                          title="Abrir Pasta no Google Drive"
                        >
                          <FolderOpen className="w-4 h-4" />
                        </a>
                      )}

                      {client.slackChannel && (
                        <a
                          href={`https://geracaodigital.slack.com/messages/${client.slackChannel}`}
                          target="_blank"
                          rel="noreferrer"
                          className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                          title={`Canal Slack #${client.slackChannel}`}
                        >
                          <Hash className="w-4 h-4" />
                        </a>
                      )}

                      <a
                        href={`/portal/${client.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="h-8 px-2.5 rounded-lg flex items-center gap-1 text-[11px] font-bold text-purple-650 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/50 hover:bg-purple-100 dark:hover:bg-purple-900/40 border border-purple-200 dark:border-purple-800/40 transition-all"
                        title="Abrir Portal do Cliente"
                      >
                        <span>Portal</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
