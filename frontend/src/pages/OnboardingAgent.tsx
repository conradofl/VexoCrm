import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Copy, Check, AlertCircle } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { useOnboarding, type OnboardingPayload, type OnboardingResult, type OnboardingTemplate } from "@/hooks/useOnboarding";
import { TRIGGER_OPTIONS, getTriggerLabel, replaceVariables } from "./OnboardingWizard";

const SYSTEM_PROMPT = `Você é um assistente de onboarding do Vexo OS. Analise a descrição do usuário e extraia as informações necessárias para criar um cliente no sistema. Retorne APENAS um JSON válido com a estrutura do endpoint POST /api/onboarding, sem texto adicional, sem markdown, sem blocos de código. Estrutura: { "company_name": string, "evolution_instance": string, "webhook_url": string | null, "campaign_name": string, "campaign_description": string | null, "default_origin": string | null, "templates": [{"name": string, "message": string, "trigger_type": string, "trigger_value": number, "trigger_unit": string, "trigger_direction": string | null, "order_index": number}] }. Para trigger_type use: on_schedule (imediato), before_meeting (antes da reunião), after_meeting (depois da reunião), no_reply (sem resposta). Para trigger_unit use: minutes, hours, days. Para trigger_direction: null para on_schedule e no_reply, "before" para before_meeting, "after" para after_meeting. Nas mensagens use {{lead_name}}, {{meeting_date}}, {{meeting_time}} onde apropriado.`;

const REQUIRED_FIELDS = ["company_name", "evolution_instance", "campaign_name", "templates"] as const;

function getTriggerLabelFromTemplate(t: OnboardingTemplate) {
  const match = TRIGGER_OPTIONS.find(
    (o) => o.trigger_type === t.trigger_type && o.trigger_value === t.trigger_value && o.trigger_unit === t.trigger_unit
  );
  return match?.label ?? getTriggerLabel(t);
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text);
  toast({ title: "Copiado!", description: `${label} copiado.` });
}

// ─── Success screen ───────────────────────────────────────────────────────────

function SuccessView({ result, onReset }: { result: OnboardingResult; onReset: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
        <CardContent className="pt-6 text-center">
          <div className="mb-3 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
              <Check className="h-7 w-7 text-green-600 dark:text-green-400" />
            </div>
          </div>
          <p className="font-semibold">Cliente criado com sucesso!</p>
          <p className="text-sm text-muted-foreground">
            {result.templates_created} template{result.templates_created !== 1 ? "s" : ""} criado{result.templates_created !== 1 ? "s" : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Webhook URL</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2.5 dark:bg-white/5">
            <code className="flex-1 truncate text-xs">{result.webhook_url}</code>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copyToClipboard(result.webhook_url, "Webhook URL")}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Configure esta URL no Calendly do cliente em <strong>Integrations → Webhooks</strong>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Webhook Secret</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2.5 dark:bg-white/5">
            <code className="flex-1 truncate text-xs">{result.webhook_secret}</code>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copyToClipboard(result.webhook_secret, "Webhook Secret")}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
            ⚠ Guarde este secret em local seguro. Não será exibido novamente.
          </p>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onReset}>
          Criar outro cliente
        </Button>
        <Button className="flex-1" onClick={() => navigate(`/crm/followup-campanhas?company_id=${result.company_id}`)}>
          Ver cliente
        </Button>
      </div>
    </div>
  );
}

// ─── Preview card ─────────────────────────────────────────────────────────────

function PreviewCard({ payload }: { payload: Partial<OnboardingPayload> }) {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Empresa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {payload.company_name && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Nome</span>
              <span className="font-medium">{payload.company_name}</span>
            </div>
          )}
          {payload.evolution_instance && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Instância</span>
              <code className="text-xs">{payload.evolution_instance}</code>
            </div>
          )}
          {payload.webhook_url && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Webhook</span>
              <span className="max-w-[180px] truncate text-xs">{payload.webhook_url}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {payload.campaign_name && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Campanha</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Nome</span>
              <span className="font-medium">{payload.campaign_name}</span>
            </div>
            {payload.campaign_description && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Descrição</span>
                <span className="text-xs">{payload.campaign_description}</span>
              </div>
            )}
            {payload.default_origin && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Origem</span>
                <Badge variant="outline" className="text-[10px]">{payload.default_origin}</Badge>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {payload.templates && payload.templates.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Templates ({payload.templates.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {payload.templates.map((t, i) => (
              <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium">{i + 1}. {t.name || "(sem nome)"}</span>
                  <Badge variant="outline" className="text-[9px]">{getTriggerLabelFromTemplate(t)}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {replaceVariables(t.message || "")}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OnboardingAgent() {
  const { submitOnboarding, isLoading, result, reset } = useOnboarding();
  const [description, setDescription] = useState("");
  const [parsedPayload, setParsedPayload] = useState<Partial<OnboardingPayload> | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  async function handleAnalyze() {
    setParseError(null);
    setMissingFields([]);
    setParsedPayload(null);
    setIsAnalyzing(true);

    try {
      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
      if (!apiKey) {
        setParseError("VITE_ANTHROPIC_API_KEY não configurado no ambiente.");
        return;
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: description }],
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error((errData as { error?: { message?: string } }).error?.message || `Erro da API: ${response.status}`);
      }

      const data = await response.json() as { content?: Array<{ text?: string }> };
      const rawText = data.content?.[0]?.text?.trim() || "";

      let parsed: Partial<OnboardingPayload>;
      try {
        parsed = JSON.parse(rawText) as Partial<OnboardingPayload>;
      } catch {
        setParseError("Não consegui interpretar. Tente ser mais específico sobre os gatilhos das mensagens.");
        return;
      }

      const missing = REQUIRED_FIELDS.filter((f) => {
        if (f === "templates") return !Array.isArray(parsed.templates) || parsed.templates.length === 0;
        return !parsed[f as keyof typeof parsed];
      });

      if (missing.length > 0) {
        setMissingFields(missing);
        setParsedPayload(parsed);
        return;
      }

      setParsedPayload(parsed);
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : "Erro ao chamar a IA");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleConfirm() {
    if (!parsedPayload) return;
    const fullPayload: OnboardingPayload = {
      company_name: parsedPayload.company_name || "",
      evolution_instance: parsedPayload.evolution_instance || "",
      webhook_url: parsedPayload.webhook_url || "",
      panel_access: parsedPayload.panel_access || false,
      user_email: parsedPayload.user_email || "",
      user_name: parsedPayload.user_name || "",
      create_user: !!(parsedPayload.user_email),
      campaign_name: parsedPayload.campaign_name || "",
      campaign_description: parsedPayload.campaign_description || "",
      default_origin: parsedPayload.default_origin || "",
      templates: parsedPayload.templates || [],
    };
    const res = await submitOnboarding(fullPayload);
    if (!res) {
      toast({ title: "Erro", description: "Não foi possível criar o cliente.", variant: "destructive" });
    }
  }

  function handleReset() {
    reset();
    setParsedPayload(null);
    setParseError(null);
    setMissingFields([]);
    setDescription("");
  }

  if (result) {
    return (
      <PageShell title="Criar cliente com IA" icon={Sparkles}>
        <SuccessView result={result} onReset={handleReset} />
      </PageShell>
    );
  }

  return (
    <PageShell title="Criar cliente com IA" icon={Sparkles}>
      <div className="mx-auto max-w-xl space-y-5">
        <Card>
          <CardContent className="space-y-3 pt-5">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o cliente. Ex: Cria a empresa Solar Prime, instância solar-prime-evo, campanha pós-agendamento com 3 mensagens: uma imediata de boas vindas, uma no dia anterior à reunião lembrando, e uma 2 dias depois sem resposta perguntando se ainda tem interesse."
              className="min-h-[140px] resize-none text-sm"
            />
            <Button
              className="w-full gap-2"
              disabled={!description.trim() || isAnalyzing}
              onClick={handleAnalyze}
            >
              <Sparkles className="h-4 w-4" />
              {isAnalyzing ? "Analisando..." : "Criar com IA"}
            </Button>
          </CardContent>
        </Card>

        {parseError && (
          <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
            <CardContent className="flex items-start gap-3 pt-4">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <p className="text-sm text-red-700 dark:text-red-300">{parseError}</p>
            </CardContent>
          </Card>
        )}

        {missingFields.length > 0 && (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
            <CardContent className="pt-4">
              <p className="mb-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                Campos obrigatórios faltando:
              </p>
              <ul className="list-disc space-y-1 pl-4">
                {missingFields.map((f) => (
                  <li key={f} className="text-sm text-amber-700 dark:text-amber-300">{f}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Por favor, edite a descrição e tente novamente com essas informações.
              </p>
            </CardContent>
          </Card>
        )}

        {parsedPayload && missingFields.length === 0 && (
          <>
            <div>
              <p className="mb-3 text-sm font-medium text-muted-foreground">O que será criado:</p>
              <PreviewCard payload={parsedPayload} />
            </div>
            <Button className="w-full" disabled={isLoading} onClick={handleConfirm}>
              {isLoading ? "Criando..." : "Confirmar e criar"}
            </Button>
          </>
        )}
      </div>
    </PageShell>
  );
}
