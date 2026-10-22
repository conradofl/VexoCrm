import React, { useState, useEffect } from "react";
import { Rocket, Loader2, CheckCircle2, Hash, MessageSquare, Mail, AlertTriangle, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { BriefingField } from "@/lib/geracaoDigital/types";
import type { ClientContractInfo } from "./BriefingBlockContract";

interface BriefingDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientInfo: ClientContractInfo;
  briefingFields: BriefingField[];
  isDispatching: boolean;
  dispatchSuccess: boolean;
  dispatchResult: any;
  onConfirmDispatch: (config: DispatchConfig) => Promise<void>;
  onResetSuccess: () => void;
}

export interface DispatchConfig {
  slackChannelName: string;
  createWhatsappGroup: boolean;
  whatsappGroupName: string;
  whatsappGroupMembers: string;
  sendToProspectWhatsapp: boolean;
  sendToProspectEmail: boolean;
  prospectEmail: string;
  sendToSectors: boolean;
  sectorsWhatsapp: string;
  sectorsEmail: string;
}

export function BriefingDispatchModal({
  isOpen,
  onClose,
  clientInfo,
  briefingFields,
  isDispatching,
  dispatchSuccess,
  dispatchResult,
  onConfirmDispatch,
  onResetSuccess,
}: BriefingDispatchModalProps) {
  const [slackChannelName, setSlackChannelName] = useState("");
  const [createWhatsappGroup, setCreateWhatsappGroup] = useState(false);
  const [whatsappGroupName, setWhatsappGroupName] = useState("");
  const [whatsappGroupMembers, setWhatsappGroupMembers] = useState("");
  const [sendToProspectWhatsapp, setSendToProspectWhatsapp] = useState(true);
  const [sendToProspectEmail, setSendToProspectEmail] = useState(true);
  const [prospectEmail, setProspectEmail] = useState("");
  const [sendToSectors, setSendToSectors] = useState(true);
  const [sectorsWhatsapp, setSectorsWhatsapp] = useState("");
  const [sectorsEmail, setSectorsEmail] = useState("operacoes@geracaodigital.com.br");

  // Atualiza nomes padrão a partir do clientInfo
  useEffect(() => {
    const nome = clientInfo.razaoSocial || "cliente";
    const slug = nome
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 21);
    setSlackChannelName(`gd-${slug}`);

    const firstName = nome.split(" ")[0];
    setWhatsappGroupName(`GD & ${firstName}`);
    setProspectEmail(clientInfo.email || "");
  }, [clientInfo.razaoSocial, clientInfo.email]);

  const filledCount = briefingFields.filter((f) => f.value && f.value.trim().length > 0).length;

  const handleStart = async () => {
    await onConfirmDispatch({
      slackChannelName,
      createWhatsappGroup,
      whatsappGroupName,
      whatsappGroupMembers,
      sendToProspectWhatsapp,
      sendToProspectEmail,
      prospectEmail,
      sendToSectors,
      sectorsWhatsapp,
      sectorsEmail,
    });
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!isDispatching && !open) {
          onClose();
          if (dispatchSuccess) onResetSuccess();
        }
      }}
    >
      <DialogContent className="max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="space-y-1.5 pb-2 shrink-0">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Rocket className="w-4 h-4" />
            </div>
            <DialogTitle className="text-xl font-black text-slate-900 dark:text-white">
              Disparar Handoff para a Esteira Operacional
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Cria os canais no Slack, monta o dossiê com a esteira de atendimento e notifica os setores técnicos da agência.
          </DialogDescription>
        </DialogHeader>

        {!dispatchSuccess ? (
          <div className="space-y-5 overflow-y-auto pr-1 flex-1 py-2">
            {/* Resumo do Cliente */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-900 dark:text-white">
                  {clientInfo.razaoSocial || "Cliente Não Nomeado"}
                </p>
                <p className="text-[11px] text-slate-500">
                  {clientInfo.whatsapp || "Sem WhatsApp"} • {clientInfo.email || "Sem e-mail"}
                </p>
              </div>
              <Badge className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-mono text-xs">
                {filledCount} Requisitos Prontos
              </Badge>
            </div>

            {/* Configuração do Slack */}
            <div className="space-y-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                <Hash className="w-4 h-4 text-blue-500" />
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Canal do Cliente no Slack
                </h4>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nome do Canal
                </Label>
                <div className="flex items-center bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/10 transition-all">
                  <span className="text-slate-400 font-mono text-xs pr-1">#</span>
                  <Input
                    value={slackChannelName}
                    onChange={(e) => setSlackChannelName(e.target.value)}
                    placeholder="gd-nome-do-cliente"
                    className="h-10 text-xs border-none bg-transparent shadow-none px-0 focus-visible:ring-0 text-slate-900 dark:text-slate-100 font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Configuração de Comunicação com o Cliente */}
            <div className="space-y-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                <MessageSquare className="w-4 h-4 text-emerald-500" />
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Envio do Dossiê para o Cliente
                </h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendToProspectWhatsapp}
                    onChange={(e) => setSendToProspectWhatsapp(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                  />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Enviar WhatsApp ao Cliente
                  </span>
                </label>

                <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendToProspectEmail}
                    onChange={(e) => setSendToProspectEmail(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                  />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Enviar Cópia por E-mail
                  </span>
                </label>
              </div>

              {sendToProspectEmail && (
                <div className="space-y-1 pt-1">
                  <Label className="text-[11px] text-slate-500">E-mail do Cliente</Label>
                  <Input
                    value={prospectEmail}
                    onChange={(e) => setProspectEmail(e.target.value)}
                    placeholder="cliente@empresa.com.br"
                    className="h-9 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}
            </div>

            {/* Handoff Interno para Setores */}
            <div className="space-y-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendToSectors}
                  onChange={(e) => setSendToSectors(e.target.checked)}
                  className="rounded border-slate-300 text-purple-600 focus:ring-purple-500 h-4 w-4"
                />
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Notificar Setores Operacionais (Tráfego, Design e Atendimento)
                </span>
              </label>

              {sendToSectors && (
                <div className="space-y-2 pt-1">
                  <Label className="text-[11px] text-slate-500">E-mail Operacional dos Setores</Label>
                  <Input
                    value={sectorsEmail}
                    onChange={(e) => setSectorsEmail(e.target.value)}
                    placeholder="operacoes@geracaodigital.com.br"
                    className="h-9 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}
            </div>

            {/* Rodapé de Ação */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isDispatching}
                className="border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs h-10 px-4 rounded-xl"
              >
                Voltar
              </Button>

              <Button
                type="button"
                onClick={handleStart}
                disabled={isDispatching}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-10 px-6 rounded-xl gap-2 shadow-sm transition-all"
              >
                {isDispatching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Disparando para a Esteira...
                  </>
                ) : (
                  <>
                    <Rocket className="w-4 h-4 text-emerald-200" />
                    Confirmar Disparo
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          /* Estado de Sucesso */
          <div className="space-y-5 py-6 text-center animate-fade-in flex-1 flex flex-col justify-center items-center">
            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                Briefing Disparado para a Esteira!
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                O dossiê foi persistido e integrado com os canais da esteira operacional com sucesso.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-left space-y-1.5 w-full max-w-md">
              <p>
                <span className="text-indigo-600 dark:text-indigo-400 font-bold">CLIENTE:</span>{" "}
                {clientInfo.razaoSocial}
              </p>
              {slackChannelName && (
                <p>
                  <span className="text-blue-600 dark:text-blue-400 font-bold">SLACK:</span> #{slackChannelName}{" "}
                  ({dispatchResult?.slackStatus === "success" ? "Criado" : "Notificado"})
                </p>
              )}
              {sendToProspectWhatsapp && (
                <p>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">WHATSAPP:</span>{" "}
                  {clientInfo.whatsapp}
                </p>
              )}
            </div>

            <Button
              type="button"
              onClick={() => {
                onResetSuccess();
                onClose();
              }}
              className="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold text-xs h-10 px-6 rounded-xl"
            >
              Concluir e Voltar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
