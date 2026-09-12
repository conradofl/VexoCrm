import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { Settings, ChevronDown, Building2, Send } from "lucide-react";
import { useJuridicoSettings, useSaveJuridicoSettings, useEvolutionInstances } from "@/hooks/useJuridico";

// Configurações gerais de contratos do tenant:
// 1. Dados da Contratada (padrão preenchido nos contratos e modelos)
// 2. Destino do Jurídico (canal do Slack e WhatsApp de revisão)
export function JuridicoSettingsCard() {
  const { data: settings } = useJuridicoSettings();
  const { data: instances } = useEvolutionInstances();
  const save = useSaveJuridicoSettings();
  const [open, setOpen] = useState(false);

  const [form, setForm] = useState({
    slack_channel_id: "",
    whatsapp_number: "",
    evolution_instance: "",
    contratada: {
      razao_social: "",
      cnpj: "",
      representante: "",
      endereco: "",
      telefone: "",
      email: "",
      comarca: "",
      assinatura: "",
    },
  });

  useEffect(() => {
    if (settings) {
      setForm({
        slack_channel_id: settings.slack_channel_id || "",
        whatsapp_number: settings.whatsapp_number || "",
        evolution_instance: settings.evolution_instance || "",
        contratada: {
          razao_social: settings.contratada?.razao_social || "",
          cnpj: settings.contratada?.cnpj || "",
          representante: settings.contratada?.representante || "",
          endereco: settings.contratada?.endereco || "",
          telefone: settings.contratada?.telefone || "",
          email: settings.contratada?.email || "",
          comarca: settings.contratada?.comarca || "",
          assinatura: settings.contratada?.assinatura || "",
        },
      });
    }
  }, [settings]);

  const handleContratadaChange = (field: string, value: string) => {
    setForm((f) => ({
      ...f,
      contratada: {
        ...f.contratada,
        [field]: value,
      },
    }));
  };

  const handleSave = () => {
    save.mutate(form, {
      onSuccess: () => toast({ title: "Configuração salva", description: "Dados da Contratada e do Jurídico atualizados." }),
      onError: (err: any) => toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" }),
    });
  };

  const hasContratada = Boolean(form.contratada.razao_social || form.contratada.cnpj);

  return (
    <Card className="border-slate-200 dark:border-white/10 mb-4">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Settings className="h-4 w-4 text-purple-650" />
              Configurações da Contratada e Jurídico
            </CardTitle>
            <CardDescription className="text-xs">
              {hasContratada
                ? `Contratada: ${form.contratada.razao_social || "Sem Razão Social"}${form.contratada.cnpj ? ` · CNPJ: ${form.contratada.cnpj}` : ""}`
                : "Configure os dados da sua empresa (Contratada) e os destinos de envio do jurídico."}
            </CardDescription>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-6 pt-1">
          {/* SEÇÃO 1: DADOS DA CONTRATADA */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-2">
              <Building2 className="h-4 w-4 text-purple-650" />
              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Dados Padrão da Contratada (sua empresa nos contratos)
              </h4>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Razão Social</Label>
                <Input
                  value={form.contratada.razao_social}
                  onChange={(e) => handleContratadaChange("razao_social", e.target.value)}
                  placeholder="Ex: AGÊNCIA GERAÇÃO DIGITAL LTDA"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">CNPJ</Label>
                <Input
                  value={form.contratada.cnpj}
                  onChange={(e) => handleContratadaChange("cnpj", e.target.value)}
                  placeholder="Ex: 66.722.723/0001-02"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Representante Legal</Label>
                <Input
                  value={form.contratada.representante}
                  onChange={(e) => handleContratadaChange("representante", e.target.value)}
                  placeholder="Ex: CAIO VINÍCIUS ALMEIDA DE OLIVEIRA"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Nome no Bloco de Assinatura</Label>
                <Input
                  value={form.contratada.assinatura}
                  onChange={(e) => handleContratadaChange("assinatura", e.target.value)}
                  placeholder="Ex: AGÊNCIA GERAÇÃO DIGITAL LTDA"
                />
              </div>

              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">Endereço Completo</Label>
                <Input
                  value={form.contratada.endereco}
                  onChange={(e) => handleContratadaChange("endereco", e.target.value)}
                  placeholder="Ex: Av. Paraná – 65, Tibery, Sala 105, CEP 38405-022, Uberlândia"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Telefone de Contato</Label>
                <Input
                  value={form.contratada.telefone}
                  onChange={(e) => handleContratadaChange("telefone", e.target.value)}
                  placeholder="Ex: (34) 99771-9779"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">E-mail Comercial</Label>
                <Input
                  value={form.contratada.email}
                  onChange={(e) => handleContratadaChange("email", e.target.value)}
                  placeholder="Ex: comercial@mktgeracaodigital.com.br"
                />
              </div>

              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">Comarca do Foro</Label>
                <Input
                  value={form.contratada.comarca}
                  onChange={(e) => handleContratadaChange("comarca", e.target.value)}
                  placeholder="Ex: Uberlândia-MG"
                />
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  Usada na cláusula de foro e resolução de disputas do contrato.
                </span>
              </div>
            </div>
          </div>

          {/* SEÇÃO 2: DESTINO DO JURÍDICO */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-white/5 pb-2">
              <Send className="h-4 w-4 text-purple-650" />
              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Destino do Jurídico (Revisão e Envio)
              </h4>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Canal do Slack (ID)</Label>
                <Input
                  value={form.slack_channel_id}
                  onChange={(e) => setForm((f) => ({ ...f, slack_channel_id: e.target.value }))}
                  placeholder="Ex: C0BHT4FDY4E"
                />
                <span className="text-[10px] text-slate-500">
                  URL do canal: /archives/<b>C0BHT4FDY4E</b>
                </span>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">WhatsApp do jurídico</Label>
                <Input
                  value={form.whatsapp_number}
                  onChange={(e) => setForm((f) => ({ ...f, whatsapp_number: e.target.value }))}
                  placeholder="Ex: 34999999999"
                />
                <span className="text-[10px] text-slate-500">Número que recebe o aviso.</span>
              </div>

              <div className="space-y-1">
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
                <span className="text-[10px] text-slate-500">Instância WhatsApp conectada.</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-white/5">
            <Button onClick={handleSave} disabled={save.isPending} className="bg-purple-650 hover:bg-purple-700 text-white">
              {save.isPending ? "Salvando..." : "Salvar configurações"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
