import React from "react";
import {
  X,
  ExternalLink,
  FolderOpen,
  Hash,
  Phone,
  Mail,
  Calendar,
  Layers,
  TrendingUp,
  FileText,
  UserCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PortfolioClient } from "./PortfolioTable";

interface ClientDrawerProps {
  client: PortfolioClient | null;
  onClose: () => void;
  onOpenIdentityWizard: (client: PortfolioClient) => void;
}

export function ClientDrawer({ client, onClose, onOpenIdentityWizard }: ClientDrawerProps) {
  if (!client) return null;

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
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg transition-colors"
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
              <UserCheck className="w-4 h-4 text-purple-600" />
              <span className="font-semibold">{client.contactName}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <Phone className="w-4 h-4 text-emerald-600" />
              <span>{client.contactWhatsapp}</span>
            </div>
            {client.contactEmail && (
              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <Mail className="w-4 h-4 text-blue-600" />
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
            {client.products.map((p, i) => (
              <Badge key={i} variant="outline" className="text-xs py-1 px-2.5">
                {p}
              </Badge>
            ))}
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

        {/* Links Operacionais */}
        <div className="space-y-2.5 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Acessos Operacionais
          </p>

          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenIdentityWizard(client)}
            className="w-full justify-start gap-2 h-10 border-slate-200 dark:border-slate-800 font-bold"
          >
            <FileText className="w-4 h-4 text-indigo-500" />
            Abrir Wizard de Identidade Visual
          </Button>

          {client.driveFolderUrl && (
            <a
              href={client.driveFolderUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors font-medium text-slate-700 dark:text-slate-300"
            >
              <FolderOpen className="w-4 h-4 text-blue-500" />
              <span>Pasta de Ativos no Google Drive</span>
              <ExternalLink className="w-3.5 h-3.5 ml-auto text-slate-400" />
            </a>
          )}

          {client.slackChannel && (
            <a
              href={`https://geracaodigital.slack.com/messages/${client.slackChannel}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors font-medium text-slate-700 dark:text-slate-300"
            >
              <Hash className="w-4 h-4 text-emerald-500" />
              <span>Canal no Slack (#{client.slackChannel})</span>
              <ExternalLink className="w-3.5 h-3.5 ml-auto text-slate-400" />
            </a>
          )}

          <a
            href={`/portal/${client.slug}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 p-2.5 rounded-xl border border-purple-200 dark:border-purple-800/40 bg-purple-50/50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 font-bold"
          >
            <ExternalLink className="w-4 h-4 text-purple-600" />
            <span>Abrir Portal do Cliente</span>
          </a>
        </div>
      </div>
    </div>
  );
}
