import { useState } from "react";
import { FileText, Image, Timer } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useLeadClients } from "@/hooks/useLeadClients";
import { useCampanhas } from "@/hooks/useCampanhas";
import { TRIGGER_MODE_LABELS } from "@/lib/chatbotDocs/constants";

// Extraído de src/pages/ChatbotDocs.tsx (Onda 4 Run F8) — movimento puro, sem alteração de forma.

function StepTypeIcon({ type }: { type: string }) {
  if (type === "image") return <Image className="h-3.5 w-3.5 text-violet-400" />;
  return <FileText className="h-3.5 w-3.5 text-slate-400" />;
}

export function CampaignSequenceViewer() {
  const { data: clients = [], isLoading: loadingClients } = useLeadClients();
  const [clientId, setClientId] = useState("");
  const [campaignId, setCampaignId] = useState("");

  const { data: campaigns = [], isLoading: loadingCampaigns } = useCampanhas(clientId || undefined);

  const selectedCampaign = campaigns.find((c) => c.id === campaignId);
  const sequence = selectedCampaign?.analytics_meta?.sequence ?? [];
  const dispatchOptions = selectedCampaign?.analytics_meta?.dispatchOptions;

  return (
    <div className="space-y-4">
      {/* Seletores */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-500 dark:text-slate-400">Empresa</Label>
          <Select
            value={clientId}
            onValueChange={(v) => { setClientId(v); setCampaignId(""); }}
            disabled={loadingClients}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Selecione a empresa" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-slate-500 dark:text-slate-400">Campanha</Label>
          <Select
            value={campaignId}
            onValueChange={setCampaignId}
            disabled={!clientId || loadingCampaigns}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={clientId ? "Selecione a campanha" : "— selecione empresa primeiro —"} />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Sequência */}
      {!campaignId ? (
        <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Selecione uma campanha para visualizar a sequência.</p>
        </div>
      ) : sequence.length === 0 ? (
        <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Esta campanha não tem sequência de mensagens configurada.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Opções de disparo */}
          {dispatchOptions && (
            <div className="flex flex-wrap gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-white/8 dark:bg-white/[0.03]">
              <span className="text-xs text-slate-500">
                <span className="font-medium text-slate-700 dark:text-slate-300">Delay entre leads:</span>{" "}
                {dispatchOptions.leadDelaySeconds}s
              </span>
              {dispatchOptions.waitForReply && (
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Aguarda resposta</span>
              )}
              {dispatchOptions.aiAssisted && (
                <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">IA assistida</span>
              )}
            </div>
          )}

          {/* Steps */}
          <div className="flex flex-col gap-0">
            {sequence
              .filter((s) => s.enabled !== false)
              .sort((a, b) => a.order - b.order)
              .map((step, i, arr) => (
                <div key={step.id} className="flex items-stretch gap-3">
                  <div className="flex flex-col items-center">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 bg-white text-xs font-bold text-slate-500 dark:border-white/20 dark:bg-white/5 dark:text-slate-400">
                      {i + 1}
                    </div>
                    {i < arr.length - 1 && (
                      <div className="w-px flex-1 bg-slate-200 dark:bg-white/10" style={{ minHeight: 16 }} />
                    )}
                  </div>

                  <div className="mb-2 flex-1 rounded-xl border border-slate-100 bg-white px-4 py-3 dark:border-white/8 dark:bg-white/[0.02]">
                    <div className="flex flex-wrap items-center gap-2">
                      <StepTypeIcon type={step.type} />
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {step.type === "image" ? "Imagem" : "Texto"}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-slate-400">
                        <Timer className="h-3 w-3" />
                        {step.delayAfterSeconds}s
                      </span>
                      <span className="ml-auto text-[10px] font-medium text-indigo-500 dark:text-indigo-400">
                        {TRIGGER_MODE_LABELS[step.triggerMode ?? "immediate"]}
                      </span>
                    </div>
                    {step.text && (
                      <p className="mt-1.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                        {step.text}
                      </p>
                    )}
                    {step.image && (
                      <p className="mt-1 text-[10px] text-violet-500">[imagem: {step.image.name}]</p>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
