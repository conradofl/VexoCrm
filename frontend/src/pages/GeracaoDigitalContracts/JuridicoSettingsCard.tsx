import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { Settings, ChevronDown } from "lucide-react";
import { useJuridicoSettings, useSaveJuridicoSettings, useEvolutionInstances } from "@/hooks/useJuridico";

// Onde o contrato é entregue para revisão: canal do Slack do jurídico + aviso no
// WhatsApp. A instância que envia é escolhida entre as já conectadas no sistema.
export function JuridicoSettingsCard() {
  const { data: settings } = useJuridicoSettings();
  const { data: instances } = useEvolutionInstances();
  const save = useSaveJuridicoSettings();
  const [open, setOpen] = useState(false);

  const [form, setForm] = useState({ slack_channel_id: "", whatsapp_number: "", evolution_instance: "" });

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const handleSave = () => {
    save.mutate(form, {
      onSuccess: () => toast({ title: "Configuração salva", description: "Destino do jurídico atualizado." }),
      onError: (err: any) => toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" }),
    });
  };

  return (
    <Card className="border-slate-200 dark:border-white/10 mb-4">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Settings className="h-4 w-4 text-purple-650" />
              Destino do Jurídico
            </CardTitle>
            <CardDescription className="text-xs">
              {settings?.slack_channel_id
                ? `Slack: ${settings.slack_channel_id}${settings.whatsapp_number ? ` · WhatsApp: ${settings.whatsapp_number}` : ""}`
                : "Configure o canal do Slack e o WhatsApp que recebem os contratos."}
            </CardDescription>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </CardHeader>

      {open && (
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Canal do Slack (ID)</Label>
            <Input
              value={form.slack_channel_id}
              onChange={(e) => setForm((f) => ({ ...f, slack_channel_id: e.target.value }))}
              placeholder="Ex: C0BHT4FDY4E"
            />
            <span className="text-[10px] text-slate-500">
              Está na URL do canal: /archives/<b>C0BHT4FDY4E</b>
            </span>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">WhatsApp do jurídico</Label>
            <Input
              value={form.whatsapp_number}
              onChange={(e) => setForm((f) => ({ ...f, whatsapp_number: e.target.value }))}
              placeholder="Ex: 34999999999"
            />
            <span className="text-[10px] text-slate-500">Quem recebe o aviso. Deixe vazio para não avisar.</span>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Instância que envia</Label>
            <select
              value={form.evolution_instance}
              onChange={(e) => setForm((f) => ({ ...f, evolution_instance: e.target.value }))}
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-md px-3 h-9 text-sm text-slate-800 dark:text-slate-100"
            >
              <option value="">— padrão do sistema —</option>
              {(instances || []).map((i) => (
                <option key={i.name} value={i.name}>
                  {i.name} {i.client_id ? `(${i.client_id})` : ""}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-slate-500">WhatsApp já conectado no sistema.</span>
          </div>

          <div className="md:col-span-3 flex justify-end">
            <Button onClick={handleSave} disabled={save.isPending} className="bg-purple-650 hover:bg-purple-700 text-white">
              {save.isPending ? "Salvando..." : "Salvar configuração"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
