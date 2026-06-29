import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Bot, Save, AlertCircle, Sparkles, Smartphone, Plus, Trash2, Send, Zap } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useFupCompanies, useUpdateFupCompany } from "@/hooks/useFollowupAdmin";

export default function InboundAgentConfig() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultTab = searchParams.get("tab") || "config";
  const [activeTab, setActiveTab] = useState(defaultTab);
  const { toast } = useToast();
  const { selectedClientId } = useOptionalCrmClient();

  const { data: companies = [], isLoading: loadingCompanies } = useFupCompanies(selectedClientId);
  const [companyId, setCompanyId] = useState<string>("all");
  const updateCompany = useUpdateFupCompany();

  useEffect(() => {
    if (activeTab !== defaultTab) {
      setSearchParams((p) => {
        p.set("tab", activeTab);
        return p;
      });
    }
  }, [activeTab, defaultTab, setSearchParams]);

  useEffect(() => {
    if (companies.length > 0 && companyId === "all") {
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId]);

  const activeCompany = companies.find((c) => c.id === companyId);

  const [inboundEnabled, setInboundEnabled] = useState(false);
  const [inboundModel, setInboundModel] = useState("gpt-4o");
  const [inboundPrompt, setInboundPrompt] = useState("");
  const [sdrPhone, setSdrPhone] = useState("");
  const [sdrTransferEnabled, setSdrTransferEnabled] = useState(false);
  const [spinFields, setSpinFields] = useState<{ id: string; name: string; required: boolean }[]>([]);
  const [inboundWebhookUrl, setInboundWebhookUrl] = useState("");

  const [simMessages, setSimMessages] = useState<{ role: "user" | "bot"; text: string }[]>([
    { role: "bot", text: "Olá! Como posso ajudar?" }
  ]);
  const [simInput, setSimInput] = useState("");

  useEffect(() => {
    if (activeCompany) {
      setInboundEnabled(activeCompany.inbound_enabled ?? false);
      setInboundModel(activeCompany.inbound_model ?? "gpt-4o");
      setInboundPrompt(activeCompany.inbound_prompt ?? "");
      setSdrPhone(activeCompany.sdr_whatsapp_number ?? "");
      setSdrTransferEnabled(activeCompany.sdr_transfer_enabled ?? false);
      setSpinFields(activeCompany.inbound_spin_fields ?? []);
      setInboundWebhookUrl(activeCompany.inbound_webhook_url ?? "");
    }
  }, [activeCompany]);

  const handleSave = async () => {
    if (!activeCompany) return;
    try {
      await updateCompany.mutateAsync({
        id: activeCompany.id,
        inbound_enabled: inboundEnabled,
        inbound_model: inboundModel,
        inbound_prompt: inboundPrompt,
        inbound_spin_fields: spinFields,
        inbound_webhook_url: inboundWebhookUrl,
        sdr_whatsapp_number: sdrPhone,
        sdr_transfer_enabled: sdrTransferEnabled,
      });
      toast({ title: "Sucesso", description: "Configurações salvas." });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  };

  const addSpinField = () => {
    setSpinFields([...spinFields, { id: Date.now().toString(), name: "", required: true }]);
  };

  const updateSpinField = (id: string, updates: any) => {
    setSpinFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  const removeSpinField = (id: string) => {
    setSpinFields((prev) => prev.filter((f) => f.id !== id));
  };

  const handleSimulate = () => {
    if (!simInput.trim()) return;
    setSimMessages((prev) => [...prev, { role: "user", text: simInput }]);
    setSimInput("");
    setTimeout(() => {
      setSimMessages((prev) => [
        ...prev,
        { role: "bot", text: "Simulação: Conexão com LLM (Em breve neste painel de testes)." }
      ]);
    }, 1000);
  };

  if (loadingCompanies) {
    return (
      <PageShell title="Assistentes Inbound" description="Gerencie seus agentes receptivos.">
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-slate-900 dark:border-slate-100" />
        </div>
      </PageShell>
    );
  }

  if (companies.length === 0) {
    return (
      <PageShell title="Assistentes Inbound" description="Nenhuma instância encontrada.">
        <div className="flex h-40 flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
          <AlertCircle className="mb-2 h-8 w-8 text-slate-400" />
          <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100">
            Crie uma Instância
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Você precisa configurar uma empresa/instância no Follow-up antes de usar os Assistentes.
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Assistentes Inbound"
      description="Configure IAs que respondem ativamente quem chama no seu WhatsApp."
    >
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900/30 dark:bg-blue-900/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Número do WhatsApp (Conexão)
            </Label>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Selecione o número de WhatsApp que este agente irá assumir.
            </p>
          </div>
        </div>
        <div className="w-full sm:w-[300px]">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-full bg-white dark:bg-slate-950">
              <SelectValue placeholder="Selecione um número..." />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                    ({c.evolution_instance})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!activeCompany ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <p className="text-sm text-slate-500">Selecione um Número de WhatsApp acima.</p>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-6">
          <TabsList className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 h-auto p-1 grid w-full max-w-2xl grid-cols-4">
            <TabsTrigger value="config" className="rounded-md py-2 data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-900">
              Configuração Geral
            </TabsTrigger>
            <TabsTrigger value="identidade" className="rounded-md py-2 data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-900">
              Identidade & Prompt
            </TabsTrigger>
            <TabsTrigger value="coleta" className="rounded-md py-2 data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-900">
              Coleta SPIN
            </TabsTrigger>
            <TabsTrigger value="simulador" className="rounded-md py-2 data-[state=active]:bg-slate-100 dark:data-[state=active]:bg-slate-900">
              Simulador
            </TabsTrigger>
          </TabsList>

          <TabsContent value="config" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Bot className="h-5 w-5 text-indigo-500" />
                  Status do Assistente
                </CardTitle>
                <CardDescription>Ative ou desative o agente de IA para esta instância.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <div className="space-y-0.5">
                    <Label className="text-base">Agente Inbound Ativado</Label>
                    <p className="text-sm text-slate-500">
                      Se ativo, a IA responderá automaticamente às mensagens recebidas neste número.
                    </p>
                  </div>
                  <Switch checked={inboundEnabled} onCheckedChange={setInboundEnabled} />
                </div>

                <div className="space-y-2 max-w-md">
                  <Label>Modelo de IA</Label>
                  <Select value={inboundModel} onValueChange={setInboundModel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o modelo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-4o">GPT-4 Omni (Recomendado)</SelectItem>
                      <SelectItem value="gpt-4o-mini">GPT-4 Omni Mini (Rápido)</SelectItem>
                      <SelectItem value="claude-3-5-sonnet">Claude 3.5 Sonnet</SelectItem>
                      <SelectItem value="llama3-70b-8192">Llama 3 70B (Groq)</SelectItem>
                      <SelectItem value="llama3-8b-8192">Llama 3 8B (Groq)</SelectItem>
                      <SelectItem value="mixtral-8x7b-32768">Mixtral 8x7B (Groq)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Transbordo Humano (SDR)</CardTitle>
                <CardDescription>Configuração de encaminhamento para atendentes humanos.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <div className="space-y-0.5">
                    <Label className="text-base">Permitir Transferência</Label>
                    <p className="text-sm text-slate-500">
                      O robô poderá avisar ou transferir o lead para um humano quando necessário.
                    </p>
                  </div>
                  <Switch checked={sdrTransferEnabled} onCheckedChange={setSdrTransferEnabled} />
                </div>

                {sdrTransferEnabled && (
                  <div className="space-y-2 max-w-md">
                    <Label>WhatsApp do SDR (Notificação)</Label>
                    <Input
                      placeholder="Ex: 5511999999999"
                      value={sdrPhone}
                      onChange={(e) => setSdrPhone(e.target.value)}
                    />
                    <p className="text-xs text-slate-500">
                      Número que receberá o resumo quando o robô transferir o lead.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="identidade" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Prompt Principal (Instruções)</CardTitle>
                <CardDescription>
                  Defina o comportamento, tom de voz e objetivo principal do seu agente para esta instância.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={inboundPrompt}
                  onChange={(e) => setInboundPrompt(e.target.value)}
                  placeholder="Você é uma assistente virtual de um restaurante... Seu objetivo é realizar reservas..."
                  className="min-h-[400px] font-mono text-sm"
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="coleta" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-indigo-500" />
                  Coleta de Dados (SPIN)
                </CardTitle>
                <CardDescription>
                  Quais informações o robô deve extrair obrigatoriamente antes de finalizar o atendimento?
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  {spinFields.map((field, index) => (
                    <div key={field.id} className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 font-mono text-sm text-slate-500 dark:bg-slate-800">
                        {index + 1}
                      </div>
                      <Input
                        placeholder="Nome do campo (ex: Data da Reserva)"
                        value={field.name}
                        onChange={(e) => updateSpinField(field.id, { name: e.target.value })}
                        className="flex-1"
                      />
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={field.required}
                          onCheckedChange={(c) => updateSpinField(field.id, { required: c })}
                        />
                        <Label className="text-xs text-slate-500">Obrigatório</Label>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeSpinField(field.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" onClick={addSpinField} className="w-full sm:w-auto">
                    <Plus className="mr-2 h-4 w-4" /> Adicionar Dado para Coleta
                  </Button>
                </div>

                <div className="my-6 border-t border-slate-200 dark:border-slate-800" />

                <div className="space-y-3 max-w-xl">
                  <Label className="text-base font-semibold">Webhook de Finalização (Agenda/Integração)</Label>
                  <p className="text-sm text-slate-500">
                    Quando o robô coletar todas as informações SPIN obrigatórias, ele enviará um POST com os dados para esta URL.
                  </p>
                  <Input
                    placeholder="https://sua-url.com/webhook"
                    value={inboundWebhookUrl}
                    onChange={(e) => setInboundWebhookUrl(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="simulador" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5 text-indigo-500" />
                  Simulador de Conversa
                </CardTitle>
                <CardDescription>
                  Teste seu agente usando o prompt e os campos de coleta SPIN definidos.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col h-[500px] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                  <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50 dark:bg-slate-900/50">
                    {simMessages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                            msg.role === "user"
                              ? "bg-indigo-600 text-white"
                              : "bg-white border border-slate-200 text-slate-900 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center gap-2">
                    <Input
                      placeholder="Digite sua mensagem..."
                      value={simInput}
                      onChange={(e) => setSimInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSimulate();
                      }}
                      className="flex-1"
                    />
                    <Button onClick={handleSimulate} className="shrink-0 bg-indigo-600 hover:bg-indigo-700">
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <div className="flex items-center justify-end border-t border-slate-200 pt-6 dark:border-slate-800">
            <Button
              onClick={handleSave}
              disabled={updateCompany.isPending}
              className="bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700"
            >
              {updateCompany.isPending ? (
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar Alterações
            </Button>
          </div>
        </Tabs>
      )}
    </PageShell>
  );
}
