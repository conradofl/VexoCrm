import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  UserPlus, Check, Copy, ChevronRight, ChevronLeft,
  Plus, Trash2, ArrowUp, ArrowDown, Eye,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { useOnboarding, type OnboardingTemplate, type OnboardingPayload } from "@/hooks/useOnboarding";

// ─── Trigger options ──────────────────────────────────────────────────────────

export const TRIGGER_OPTIONS = [
  { label: "Assim que o webhook for disparado", trigger_type: "on_schedule", trigger_value: 0, trigger_unit: "minutes", trigger_direction: null },
  { label: "5 minutos antes", trigger_type: "before_meeting", trigger_value: 5, trigger_unit: "minutes", trigger_direction: "before" },
  { label: "15 minutos antes", trigger_type: "before_meeting", trigger_value: 15, trigger_unit: "minutes", trigger_direction: "before" },
  { label: "30 minutos antes", trigger_type: "before_meeting", trigger_value: 30, trigger_unit: "minutes", trigger_direction: "before" },
  { label: "1 hora antes", trigger_type: "before_meeting", trigger_value: 1, trigger_unit: "hours", trigger_direction: "before" },
  { label: "3 horas antes", trigger_type: "before_meeting", trigger_value: 3, trigger_unit: "hours", trigger_direction: "before" },
  { label: "6 horas antes", trigger_type: "before_meeting", trigger_value: 6, trigger_unit: "hours", trigger_direction: "before" },
  { label: "12 horas antes", trigger_type: "before_meeting", trigger_value: 12, trigger_unit: "hours", trigger_direction: "before" },
  { label: "1 dia antes", trigger_type: "before_meeting", trigger_value: 1, trigger_unit: "days", trigger_direction: "before" },
  { label: "2 dias antes", trigger_type: "before_meeting", trigger_value: 2, trigger_unit: "days", trigger_direction: "before" },
  { label: "30 minutos depois", trigger_type: "after_meeting", trigger_value: 30, trigger_unit: "minutes", trigger_direction: "after" },
  { label: "1 hora depois", trigger_type: "after_meeting", trigger_value: 1, trigger_unit: "hours", trigger_direction: "after" },
  { label: "3 horas depois", trigger_type: "after_meeting", trigger_value: 3, trigger_unit: "hours", trigger_direction: "after" },
  { label: "6 horas depois", trigger_type: "after_meeting", trigger_value: 6, trigger_unit: "hours", trigger_direction: "after" },
  { label: "12 horas depois", trigger_type: "after_meeting", trigger_value: 12, trigger_unit: "hours", trigger_direction: "after" },
  { label: "1 dia depois", trigger_type: "after_meeting", trigger_value: 1, trigger_unit: "days", trigger_direction: "after" },
  { label: "2 dias depois", trigger_type: "after_meeting", trigger_value: 2, trigger_unit: "days", trigger_direction: "after" },
  { label: "3 dias depois", trigger_type: "after_meeting", trigger_value: 3, trigger_unit: "days", trigger_direction: "after" },
  { label: "7 dias depois", trigger_type: "after_meeting", trigger_value: 7, trigger_unit: "days", trigger_direction: "after" },
  { label: "Se não respondeu em 1 hora", trigger_type: "no_reply", trigger_value: 1, trigger_unit: "hours", trigger_direction: null },
  { label: "Se não respondeu em 3 horas", trigger_type: "no_reply", trigger_value: 3, trigger_unit: "hours", trigger_direction: null },
  { label: "Se não respondeu em 6 horas", trigger_type: "no_reply", trigger_value: 6, trigger_unit: "hours", trigger_direction: null },
  { label: "Se não respondeu em 12 horas", trigger_type: "no_reply", trigger_value: 12, trigger_unit: "hours", trigger_direction: null },
  { label: "Se não respondeu em 1 dia", trigger_type: "no_reply", trigger_value: 1, trigger_unit: "days", trigger_direction: null },
  { label: "Se não respondeu em 2 dias", trigger_type: "no_reply", trigger_value: 2, trigger_unit: "days", trigger_direction: null },
] as const;

export function getTriggerKey(t: Pick<OnboardingTemplate, "trigger_type" | "trigger_value" | "trigger_unit">) {
  return `${t.trigger_type}:${t.trigger_value}:${t.trigger_unit}`;
}

export function getTriggerLabel(t: OnboardingTemplate) {
  const match = TRIGGER_OPTIONS.find(
    (o) => o.trigger_type === t.trigger_type && o.trigger_value === t.trigger_value && o.trigger_unit === t.trigger_unit
  );
  return match?.label ?? `${t.trigger_type} ${t.trigger_value} ${t.trigger_unit}`;
}

export function replaceVariables(msg: string) {
  return msg
    .replace(/\{\{lead_name\}\}/g, "João Silva")
    .replace(/\{\{meeting_date\}\}/g, "28/05/2026")
    .replace(/\{\{meeting_time\}\}/g, "14:00");
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-6 flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-all ${
            i < step
              ? "bg-violet-500"
              : i === step
              ? "bg-violet-300"
              : "bg-slate-200 dark:bg-white/10"
          }`}
        />
      ))}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

const INITIAL_STATE: OnboardingPayload = {
  company_name: "",
  evolution_instance: "",
  webhook_url: "",
  panel_access: false,
  user_email: "",
  user_name: "",
  create_user: false,
  campaign_name: "",
  campaign_description: "",
  default_origin: "",
  templates: [],
};

// ─── Wizard ───────────────────────────────────────────────────────────────────

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const { submitOnboarding, isLoading, result, reset } = useOnboarding();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<OnboardingPayload>(INITIAL_STATE);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const set = <K extends keyof OnboardingPayload>(k: K, v: OnboardingPayload[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Template helpers
  function addTemplate() {
    const opt = TRIGGER_OPTIONS[0];
    setForm((f) => ({
      ...f,
      templates: [
        ...f.templates,
        {
          name: "",
          message: "",
          trigger_type: opt.trigger_type,
          trigger_value: opt.trigger_value,
          trigger_unit: opt.trigger_unit,
          trigger_direction: opt.trigger_direction as string | null,
          order_index: f.templates.length,
        },
      ],
    }));
  }

  function updateTemplate(i: number, patch: Partial<OnboardingTemplate>) {
    setForm((f) => ({
      ...f,
      templates: f.templates.map((t, idx) => (idx === i ? { ...t, ...patch } : t)),
    }));
  }

  function removeTemplate(i: number) {
    setForm((f) => ({
      ...f,
      templates: f.templates
        .filter((_, idx) => idx !== i)
        .map((t, idx) => ({ ...t, order_index: idx })),
    }));
    if (previewIndex === i) setPreviewIndex(null);
  }

  function moveTemplate(i: number, dir: -1 | 1) {
    const j = i + dir;
    setForm((f) => {
      if (j < 0 || j >= f.templates.length) return f;
      const templates = [...f.templates];
      [templates[i], templates[j]] = [templates[j], templates[i]];
      return { ...f, templates: templates.map((t, idx) => ({ ...t, order_index: idx })) };
    });
  }

  function setTriggerFromKey(i: number, key: string) {
    const opt = TRIGGER_OPTIONS.find((o) => getTriggerKey(o) === key);
    if (!opt) return;
    updateTemplate(i, {
      trigger_type: opt.trigger_type,
      trigger_value: opt.trigger_value,
      trigger_unit: opt.trigger_unit,
      trigger_direction: opt.trigger_direction as string | null,
    });
  }

  // Validation
  function canAdvance() {
    if (step === 0) return form.company_name.trim() && form.evolution_instance.trim();
    if (step === 1) {
      if (!form.create_user) return true;
      return form.user_email.trim() && form.user_name.trim();
    }
    if (step === 2) return form.campaign_name.trim();
    if (step === 3) return form.templates.length > 0;
    return true;
  }

  async function handleCreate() {
    const res = await submitOnboarding(form);
    if (res) {
      setStep(5);
    } else {
      toast({ title: "Erro", description: "Não foi possível criar o cliente.", variant: "destructive" });
    }
  }

  function handleCreateAnother() {
    reset();
    setForm(INITIAL_STATE);
    setStep(0);
    setPreviewIndex(null);
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copiado!", description: `${label} copiado para a área de transferência.` });
  }

  // ─── Success screen ─────────────────────────────────────────────────────────

  if (step === 5 && result) {
    return (
      <PageShell title="Cliente criado com sucesso!" icon={Check}>
        <div className="mx-auto max-w-lg space-y-5">
          <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
            <CardContent className="pt-6 text-center">
              <div className="mb-3 flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                  <Check className="h-7 w-7 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <p className="font-semibold">Onboarding concluído!</p>
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
              <div className="flex items-center gap-2 rounded-lg bg-slate-100 dark:bg-white/5 px-3 py-2.5">
                <code className="flex-1 truncate text-xs text-slate-700 dark:text-slate-300">{result.webhook_url}</code>
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
              <div className="flex items-center gap-2 rounded-lg bg-slate-100 dark:bg-white/5 px-3 py-2.5">
                <code className="flex-1 truncate text-xs text-slate-700 dark:text-slate-300">{result.webhook_secret}</code>
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
            <Button variant="outline" className="flex-1" onClick={handleCreateAnother}>
              Criar outro cliente
            </Button>
            <Button className="flex-1" onClick={() => navigate(`/crm/followup-campanhas?company_id=${result.company_id}`)}>
              Ver cliente
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Onboarding de Cliente" icon={UserPlus}>
      <div className="mx-auto max-w-xl">
        <ProgressBar step={step} total={5} />

        {/* Passo 1: Dados do cliente */}
        {step === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Passo 1 — Dados do cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Nome da empresa *</Label>
                <Input
                  value={form.company_name}
                  onChange={(e) => set("company_name", e.target.value)}
                  placeholder="Solar Prime"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Instância Evolution API *</Label>
                <Input
                  value={form.evolution_instance}
                  onChange={(e) => set("evolution_instance", e.target.value)}
                  placeholder="ex: infinie-evo"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">URL de resposta webhook (opcional)</Label>
                <Input
                  value={form.webhook_url}
                  onChange={(e) => set("webhook_url", e.target.value)}
                  placeholder="https://..."
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.panel_access}
                  onCheckedChange={(v) => set("panel_access", v)}
                  id="panel_access"
                />
                <Label htmlFor="panel_access" className="cursor-pointer text-sm">
                  Acesso ao painel analytics
                </Label>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Passo 2: Acesso do cliente */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Passo 2 — Acesso do cliente (opcional)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.create_user}
                  onCheckedChange={(v) => set("create_user", v)}
                  id="create_user"
                />
                <Label htmlFor="create_user" className="cursor-pointer text-sm">
                  Criar acesso ao painel para o cliente
                </Label>
              </div>
              {form.create_user && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Email do usuário *</Label>
                    <Input
                      value={form.user_email}
                      onChange={(e) => set("user_email", e.target.value)}
                      placeholder="cliente@empresa.com"
                      type="email"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nome completo *</Label>
                    <Input
                      value={form.user_name}
                      onChange={(e) => set("user_name", e.target.value)}
                      placeholder="João Silva"
                      className="h-8 text-sm"
                    />
                  </div>
                  <p className="rounded-lg bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-[11px] text-blue-700 dark:text-blue-300">
                    Uma senha temporária será gerada e enviada por email ao usuário.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Passo 3: Campanha */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Passo 3 — Campanha</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Nome da campanha *</Label>
                <Input
                  value={form.campaign_name}
                  onChange={(e) => set("campaign_name", e.target.value)}
                  placeholder="Pós-agendamento"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Descrição (opcional)</Label>
                <Input
                  value={form.campaign_description}
                  onChange={(e) => set("campaign_description", e.target.value)}
                  placeholder="Mensagens enviadas após o cliente agendar"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Origem padrão</Label>
                <Input
                  value={form.default_origin}
                  onChange={(e) => set("default_origin", e.target.value)}
                  placeholder="ex: instagram, google, indicação"
                  className="h-8 text-sm"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Passo 4: Templates */}
        {step === 3 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Passo 4 — Templates</CardTitle>
              <Button size="sm" variant="outline" onClick={addTemplate} className="h-7 gap-1.5 text-xs">
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </Button>
            </CardHeader>
            <CardContent>
              {form.templates.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum template. Clique em Adicionar para começar.
                </p>
              )}
              <div className="space-y-4">
                {form.templates.map((tpl, i) => (
                  <div
                    key={i}
                    className="space-y-3 rounded-lg border bg-slate-50/50 p-3 dark:bg-white/[0.02]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-4 font-mono text-xs text-muted-foreground">{i + 1}</span>
                      <Input
                        value={tpl.name}
                        onChange={(e) => updateTemplate(i, { name: e.target.value })}
                        placeholder="Nome do template"
                        className="h-7 flex-1 text-xs"
                      />
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7"
                          onClick={() => moveTemplate(i, -1)} disabled={i === 0}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7"
                          onClick={() => moveTemplate(i, 1)} disabled={i === form.templates.length - 1}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon" variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => removeTemplate(i)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7"
                          onClick={() => setPreviewIndex(previewIndex === i ? null : i)}
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    <Select
                      value={getTriggerKey(tpl)}
                      onValueChange={(v) => setTriggerFromKey(i, v)}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder="Selecionar gatilho" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on_schedule:0:minutes">
                          Assim que o webhook for disparado
                        </SelectItem>
                        {TRIGGER_OPTIONS.filter((o) => o.trigger_type === "before_meeting").map((o) => (
                          <SelectItem key={getTriggerKey(o)} value={getTriggerKey(o)}>
                            {o.label}
                          </SelectItem>
                        ))}
                        {TRIGGER_OPTIONS.filter((o) => o.trigger_type === "after_meeting").map((o) => (
                          <SelectItem key={getTriggerKey(o)} value={getTriggerKey(o)}>
                            {o.label}
                          </SelectItem>
                        ))}
                        {TRIGGER_OPTIONS.filter((o) => o.trigger_type === "no_reply").map((o) => (
                          <SelectItem key={getTriggerKey(o)} value={getTriggerKey(o)}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <div className="space-y-1">
                      <Textarea
                        value={tpl.message}
                        onChange={(e) => updateTemplate(i, { message: e.target.value })}
                        placeholder="Digite a mensagem..."
                        className="min-h-[80px] resize-none text-xs"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Variáveis:{" "}
                        <code className="rounded bg-slate-100 px-1 dark:bg-white/10">{"{{lead_name}}"}</code>{" "}
                        <code className="rounded bg-slate-100 px-1 dark:bg-white/10">{"{{meeting_date}}"}</code>{" "}
                        <code className="rounded bg-slate-100 px-1 dark:bg-white/10">{"{{meeting_time}}"}</code>
                        <span className="ml-2 text-slate-400">{tpl.message.length} chars</span>
                      </p>
                    </div>

                    {previewIndex === i && (
                      <div className="rounded-lg border border-green-200 bg-green-50 p-2.5 dark:border-green-900 dark:bg-green-950/30">
                        <p className="mb-1 text-[10px] font-semibold text-green-700 dark:text-green-400">
                          Preview
                        </p>
                        <p className="whitespace-pre-wrap text-xs text-green-800 dark:text-green-300">
                          {replaceVariables(tpl.message) || "(mensagem vazia)"}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Passo 5: Preview e confirmação */}
        {step === 4 && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Empresa</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nome</span>
                  <span className="font-medium">{form.company_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Instância</span>
                  <code className="text-xs">{form.evolution_instance}</code>
                </div>
                {form.webhook_url && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Webhook</span>
                    <span className="max-w-[200px] truncate text-xs">{form.webhook_url}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Painel</span>
                  <Badge variant={form.panel_access ? "default" : "secondary"} className="text-[10px]">
                    {form.panel_access ? "Sim" : "Não"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {form.create_user && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Acesso do cliente</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email</span>
                    <span>{form.user_email}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Nome</span>
                    <span>{form.user_name}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Campanha</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nome</span>
                  <span className="font-medium">{form.campaign_name}</span>
                </div>
                {form.campaign_description && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Descrição</span>
                    <span className="text-xs">{form.campaign_description}</span>
                  </div>
                )}
                {form.default_origin && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Origem</span>
                    <Badge variant="outline" className="text-[10px]">{form.default_origin}</Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Templates ({form.templates.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {form.templates.map((t, i) => (
                  <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.03]">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium">{i + 1}. {t.name || "(sem nome)"}</span>
                      <Badge variant="outline" className="text-[9px]">{getTriggerLabel(t)}</Badge>
                    </div>
                    <p className="line-clamp-2 text-[11px] text-muted-foreground">
                      {t.message || "(sem mensagem)"}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-6 flex gap-3">
          {step > 0 && (
            <Button variant="outline" className="flex-1" onClick={() => setStep((s) => s - 1)}>
              <ChevronLeft className="mr-1.5 h-4 w-4" /> Voltar
            </Button>
          )}
          {step < 4 ? (
            <Button className="flex-1" disabled={!canAdvance()} onClick={() => setStep((s) => s + 1)}>
              Próximo <ChevronRight className="ml-1.5 h-4 w-4" />
            </Button>
          ) : (
            <Button className="flex-1" disabled={isLoading} onClick={handleCreate}>
              {isLoading ? "Criando..." : "Criar cliente"}
            </Button>
          )}
        </div>
      </div>
    </PageShell>
  );
}
