import type { Dispatch, SetStateAction } from "react";
import { Clock, MessageSquare, Zap } from "lucide-react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LeadClientEvolutionInstance } from "@/hooks/useLeadClients";

export function TabEsteira({
  instances,
  warmingActive,
  setWarmingActive,
  warmingInterval,
  setWarmingInterval,
  checkedChips,
  setCheckedChips,
  logs,
}: {
  instances: LeadClientEvolutionInstance[];
  warmingActive: boolean;
  setWarmingActive: Dispatch<SetStateAction<boolean>>;
  warmingInterval: string;
  setWarmingInterval: Dispatch<SetStateAction<string>>;
  checkedChips: Record<string, boolean>;
  setCheckedChips: Dispatch<SetStateAction<Record<string, boolean>>>;
  logs: Array<{ time: string; from: string; to: string; msg: string }>;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Left Config Panel */}
      <Card className="lg:col-span-1 border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.04] rounded-2xl flex flex-col justify-between overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Zap className="h-5 w-5 text-indigo-500" />
            Esteira Automática Mútua
          </CardTitle>
          <CardDescription className="text-xs">
            Simule conversas aleatórias entre os seus próprios chips locais para aumentar a reputação junto ao WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Toggle Loop Active */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200/50 bg-slate-50/50 dark:border-white/5 dark:bg-white/[0.01]">
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-foreground">Status do Aquecimento</p>
              <p className="text-[10px] text-muted-foreground">Exibição de logs em tempo real</p>
            </div>
            <Button
              size="sm"
              variant={warmingActive ? "default" : "outline"}
              className="rounded-xl text-xs h-8 px-4"
              onClick={() => setWarmingActive(!warmingActive)}
            >
              {warmingActive ? "Executando" : "Pausado"}
            </Button>
          </div>

          {/* Interval Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              Intervalo de Envio
            </label>
            <Select value={warmingInterval} onValueChange={setWarmingInterval}>
              <SelectTrigger className="rounded-xl h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="2">Demonstração Rápida (2s)</SelectItem>
                <SelectItem value="5">Seguro (5s)</SelectItem>
                <SelectItem value="10">Mais Seguro (10s)</SelectItem>
                <SelectItem value="15">Extremamente Seguro (15s)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Checklist of participating chips */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-foreground">Chips Participantes</p>
            {instances.length < 2 && (
              <p className="text-[10px] text-rose-500">
                Atenção: É necessário pelo menos 2 chips conectados para usar a esteira mútua.
              </p>
            )}
            <div className="space-y-1.5 rounded-xl border border-slate-200/50 bg-slate-50/50 p-3.5 dark:border-white/5 dark:bg-white/[0.01] max-h-[160px] overflow-y-auto">
              {instances.map((inst) => (
                <label
                  key={inst.id}
                  className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer hover:opacity-85 py-1"
                >
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                    checked={checkedChips[inst.id] ?? false}
                    onChange={(e) =>
                      setCheckedChips((prev) => ({ ...prev, [inst.id]: e.target.checked }))
                    }
                  />
                  <span>{inst.name}</span>
                  {inst.chip_state === "cold" ? (
                    <Badge className="border border-blue-400/25 bg-blue-500/10 text-blue-700 dark:text-blue-200 text-[8px] scale-90 py-0 px-1 rounded-xl">
                      Frio
                    </Badge>
                  ) : (
                    <Badge className="border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-[8px] scale-90 py-0 px-1 rounded-xl">
                      Pronto
                    </Badge>
                  )}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
        <CardFooter className="p-6 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.01] text-[10px] text-muted-foreground leading-relaxed">
          Esta simulação visual demonstra como os bots conversam entre si no backend para trocar pacotes de dados legítimos, gerando fluxo saudável de entrada e saída.
        </CardFooter>
      </Card>

      {/* Live Chat Log Feed Panel */}
      <Card className="lg:col-span-2 border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.04] rounded-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-slate-100 dark:border-white/5">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-indigo-500" />
            Monitor de Conversas Mútuas
          </CardTitle>
          <CardDescription className="text-xs">
            Logs em tempo real de mensagens trocadas entre seus chips WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {logs.length === 0 ? (
            <div className="h-[340px] flex flex-col items-center justify-center text-center p-6 text-muted-foreground gap-2">
              <Zap className={`h-8 w-8 text-slate-300 ${warmingActive && instances.length >= 2 ? "animate-pulse" : ""}`} />
              <p className="text-xs font-semibold text-foreground">Nenhuma mensagem trocada ainda</p>
              <p className="text-[11px] max-w-xs leading-normal">
                {instances.length < 2
                  ? "Conecte mais de um chip para iniciar o intercâmbio de mensagens."
                  : "Certifique-se de que a esteira está ativada para visualizar o fluxo."}
              </p>
            </div>
          ) : (
            <div className="p-4 h-[380px] overflow-y-auto font-mono text-[11px] space-y-2.5">
              {logs.map((log, index) => (
                <div
                  key={index}
                  className="p-3.5 rounded-xl border border-slate-200/60 bg-gradient-to-br from-white to-slate-50/20 dark:from-white/[0.02] dark:to-transparent dark:border-white/5 shadow-sm space-y-1 flex items-start justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-indigo-600 dark:text-indigo-400">
                        {log.from}
                      </span>
                      <span className="text-muted-foreground text-[10px]">➔</span>
                      <span className="font-bold text-teal-600 dark:text-teal-400">
                        {log.to}
                      </span>
                    </div>
                    <p className="text-foreground text-[12px] italic leading-normal">
                      "{log.msg}"
                    </p>
                  </div>
                  <span className="text-muted-foreground text-[9px] whitespace-nowrap pt-0.5">
                    {log.time}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
