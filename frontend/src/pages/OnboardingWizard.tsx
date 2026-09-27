import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, BookOpen, Check, Clock, Copy, Sparkles } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useAcademyDiagnostics, useLogAcademyRecipeUsage } from "@/hooks/useAcademy";
import { AcademyInstallDialog } from "@/components/academy/AcademyInstallDialog";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  ACADEMY_FUNDAMENTOS,
  ACADEMY_RECIPES,
  getAcademyContentById,
  isAcademyRecipe,
  type AcademyContent,
  type AcademyContactTemperature,
} from "@/data/academyRecipes";

// Vexo Academy — biblioteca de conteúdo, dois tipos que se comportam
// diferente: fundamento (ensina o sistema, só leitura e Copiar) e receita
// (resolve um objetivo, tem o botão que instala). Conteúdo é dado (vem de
// academyRecipes.ts, não deste componente) — esta tela lista, filtra,
// mostra o conteúdo inteiro, mede o que a pessoa faz com ele e instala
// usando os endpoints que já existem (useAcademyInstall.ts) — nunca liga
// nada sozinho, nunca sobrescreve, sempre pergunta o que falta.

const ALL_FILTER = "__all__";

const TEMPERATURE_LABELS: Record<AcademyContactTemperature, string> = {
  frio: "Contato frio",
  morno: "Contato morno",
  quente: "Contato quente",
};

export default function OnboardingWizard() {
  const crmClient = useOptionalCrmClient();
  const selectedClientId = crmClient?.selectedClientId || "";
  const logUsage = useLogAcademyRecipeUsage();

  const [segmentFilter, setSegmentFilter] = useState<string>(ALL_FILTER);
  const [temperatureFilter, setTemperatureFilter] = useState<string>(ALL_FILTER);
  const [openContentId, setOpenContentId] = useState<string | null>(null);
  const [installRecipeId, setInstallRecipeId] = useState<string | null>(null);

  const { data: diagnosticLines = [] } = useAcademyDiagnostics(selectedClientId || null);

  const segments = useMemo(() => {
    const set = new Set<string>();
    ACADEMY_RECIPES.forEach((r) => r.segments.forEach((s) => set.add(s)));
    return Array.from(set).sort();
  }, []);

  const temperatures = useMemo(() => {
    const set = new Set<AcademyContactTemperature>();
    ACADEMY_RECIPES.forEach((r) => set.add(r.contactTemperature));
    return Array.from(set);
  }, []);

  // Fundamentos aparecem sempre, independentemente do filtro — valem para
  // todos e são pré-requisito. Só as receitas respeitam segmento/contato.
  const filteredRecipes = useMemo(() => {
    return ACADEMY_RECIPES.filter((r) => {
      if (segmentFilter !== ALL_FILTER && !r.segments.includes(segmentFilter)) return false;
      if (temperatureFilter !== ALL_FILTER && r.contactTemperature !== temperatureFilter) return false;
      return true;
    });
  }, [segmentFilter, temperatureFilter]);

  const openContent = openContentId ? getAcademyContentById(openContentId) : null;

  const handleOpenContent = (content: AcademyContent) => {
    setOpenContentId(content.id);
    if (selectedClientId) {
      logUsage.mutate({ clientId: selectedClientId, recipeId: content.id, action: "opened" });
    }
  };

  const handleCopy = async (content: AcademyContent, label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `Copiado: ${label}` });
    } catch {
      toast({ title: "Não foi possível copiar", variant: "destructive" });
      return;
    }
    if (selectedClientId) {
      logUsage.mutate({ clientId: selectedClientId, recipeId: content.id, action: "copied" });
    }
  };

  const handleUseRecipe = (contentId: string) => {
    if (!selectedClientId) {
      toast({ title: "Selecione uma empresa antes de instalar", variant: "destructive" });
      return;
    }
    setInstallRecipeId(contentId);
  };

  const installContent = installRecipeId ? getAcademyContentById(installRecipeId) : null;
  const installRecipe = installContent && isAcademyRecipe(installContent) ? installContent : null;

  const handleDiagnosticClick = (contentId: string) => {
    const content = getAcademyContentById(contentId);
    if (content) handleOpenContent(content);
  };

  if (openContent) {
    const isRecipe = isAcademyRecipe(openContent);
    return (
      <PageShell title="Vexo Academy" subtitle={openContent.title}>
        <div className="space-y-6 animate-fade-in-up">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setOpenContentId(null)}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar para a lista
          </Button>

          <Card>
            <CardHeader className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                {isRecipe ? (
                  <Badge className="bg-primary/10 text-primary border-primary/20 text-xs font-bold">
                    {TEMPERATURE_LABELS[openContent.contactTemperature]}
                  </Badge>
                ) : (
                  <Badge className="bg-muted text-muted-foreground border-border text-xs font-bold flex items-center gap-1">
                    <BookOpen className="h-3 w-3" />
                    Fundamento
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs font-bold flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {openContent.timeLabel}
                </Badge>
              </div>
              <CardTitle className="text-2xl">{openContent.title}</CardTitle>
              <CardDescription className="text-base text-foreground">{openContent.resultPhrase}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {isRecipe && (
                <div className="rounded-lg bg-accent border border-border p-4 text-sm text-accent-foreground">
                  <strong>Instala: </strong>
                  {openContent.whatHappens}
                </div>
              )}

              <div className="bg-muted/40 border border-border rounded-lg p-5 space-y-2">
                <h4 className="font-bold text-sm">Pré-requisitos</h4>
                <ul className="space-y-1.5 text-sm">
                  {openContent.prerequisites.map((p, i) => (
                    <li key={i} className="flex gap-2">
                      <Check className="h-4 w-4 mt-0.5 shrink-0 text-success" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {isRecipe ? (
                <>
                  {openContent.requiresAttachment && (
                    <div className="rounded-lg bg-warning/10 border border-warning/30 p-4 text-sm text-warning flex gap-2">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>
                        Esta receita usa um anexo que precisa ser enviado por você — a instalação cria a mensagem, mas o
                        arquivo tem que ser anexado depois, na tela de Cadências, antes de ligar a cadência.
                      </span>
                    </div>
                  )}

                  <div className="space-y-3">
                    <h4 className="font-bold text-sm">Conteúdo — {openContent.cadenceName}</h4>
                    {openContent.templates.map((tpl) => (
                      <div key={tpl.label} className="border border-border rounded-lg p-4 space-y-2 bg-card">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{tpl.label}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px] gap-1"
                            onClick={() => handleCopy(openContent, tpl.label, tpl.message)}
                          >
                            <Copy className="h-3 w-3" />
                            Copiar
                          </Button>
                        </div>
                        <p className="text-sm font-mono whitespace-pre-wrap">{tpl.message}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg bg-muted/40 border border-border p-4 text-sm">
                    <strong>Nota na tela: </strong>
                    {openContent.screenNote}
                  </div>

                  <Button
                    onClick={() => handleUseRecipe(openContent.id)}
                    className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Usar esta receita
                  </Button>
                </>
              ) : (
                <div className="space-y-3">
                  {openContent.sections.map((section) => (
                    <div key={section.heading} className="border border-border rounded-lg p-4 space-y-2 bg-card">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-sm text-primary">{section.heading}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] gap-1"
                          onClick={() => handleCopy(openContent, section.heading, section.body)}
                        >
                          <Copy className="h-3 w-3" />
                          Copiar
                        </Button>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{section.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        {installRecipe && selectedClientId && (
          <AcademyInstallDialog
            recipe={installRecipe}
            clientId={selectedClientId}
            open={!!installRecipe}
            onOpenChange={(next) => !next && setInstallRecipeId(null)}
          />
        )}
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Vexo Academy"
      subtitle="Fundamentos do sistema e receitas por segmento — resultado, conteúdo de verdade e um botão que instala."
    >
      <div className="space-y-6 animate-fade-in-up">
        {diagnosticLines.length > 0 && (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-warning flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                O que falta nesta empresa
              </p>
              <ul className="space-y-1.5">
                {diagnosticLines.map((line) => (
                  <li key={line.id}>
                    <button
                      type="button"
                      onClick={() => handleDiagnosticClick(line.recipeId)}
                      className="text-sm text-left hover:underline text-foreground"
                    >
                      {line.text}
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Fundamentos</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ACADEMY_FUNDAMENTOS.map((fundamento) => (
              <button key={fundamento.id} type="button" onClick={() => handleOpenContent(fundamento)} className="text-left">
                <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all cursor-pointer">
                  <CardHeader className="space-y-2">
                    <Badge className="w-fit bg-muted text-muted-foreground border-border text-[10px] font-bold flex items-center gap-1">
                      <BookOpen className="h-3 w-3" />
                      Fundamento
                    </Badge>
                    <CardTitle className="text-base">{fundamento.title}</CardTitle>
                    <CardDescription>{fundamento.resultPhrase}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {fundamento.timeLabel}
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Receitas por segmento</h3>

          <div className="flex flex-wrap items-center gap-2">
            <FilterPills options={segments} active={segmentFilter} onChange={setSegmentFilter} allLabel="Todos os segmentos" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterPills
              options={temperatures.map((t) => TEMPERATURE_LABELS[t])}
              active={temperatureFilter === ALL_FILTER ? ALL_FILTER : TEMPERATURE_LABELS[temperatureFilter as AcademyContactTemperature]}
              onChange={(label) => {
                if (label === ALL_FILTER) {
                  setTemperatureFilter(ALL_FILTER);
                  return;
                }
                const found = temperatures.find((t) => TEMPERATURE_LABELS[t] === label);
                setTemperatureFilter(found || ALL_FILTER);
              }}
              allLabel="Todos os contatos"
            />
          </div>

          {filteredRecipes.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Nenhuma receita para esse filtro ainda.</Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredRecipes.map((recipe) => (
                <button key={recipe.id} type="button" onClick={() => handleOpenContent(recipe)} className="text-left">
                  <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all cursor-pointer">
                    <CardHeader className="space-y-2">
                      <Badge className="w-fit bg-primary/10 text-primary border-primary/20 text-[10px] font-bold">
                        {TEMPERATURE_LABELS[recipe.contactTemperature]}
                      </Badge>
                      <CardTitle className="text-base">{recipe.title}</CardTitle>
                      <CardDescription>{recipe.resultPhrase}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {recipe.timeLabel}
                      </span>
                      <span>
                        {recipe.segments.length} {recipe.segments.length === 1 ? "segmento" : "segmentos"}
                      </span>
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}

function FilterPills({
  options,
  active,
  onChange,
  allLabel,
}: {
  options: string[];
  active: string;
  onChange: (value: string) => void;
  allLabel: string;
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => onChange(ALL_FILTER)}
        className={cn(
          "rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
          active === ALL_FILTER ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
        )}
      >
        {allLabel}
      </button>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
            active === opt ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
          )}
        >
          {opt}
        </button>
      ))}
    </>
  );
}
