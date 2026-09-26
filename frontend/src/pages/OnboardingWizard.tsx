import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Clock, Copy, ListChecks, Sparkles } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useAcademyDiagnostics, useLogAcademyRecipeUsage } from "@/hooks/useAcademy";
import { AcademyInstallDialog } from "@/components/academy/AcademyInstallDialog";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { ACADEMY_RECIPES, getAcademyRecipeById, type AcademyRecipe } from "@/data/academyRecipes";

// Vexo Academy — biblioteca de receitas por objetivo. Receita é dado (vem de
// academyRecipes.ts, não deste componente): esta tela lista, filtra, mostra
// o conteúdo inteiro, mede o que a pessoa faz com ele e instala usando os
// endpoints que já existem (useAcademyInstall.ts) — nunca liga nada sozinho,
// nunca sobrescreve, sempre pergunta o que falta.

const ALL_FILTER = "__all__";

export default function OnboardingWizard() {
  const crmClient = useOptionalCrmClient();
  const selectedClientId = crmClient?.selectedClientId || "";
  const logUsage = useLogAcademyRecipeUsage();

  const [segmentFilter, setSegmentFilter] = useState<string>(ALL_FILTER);
  const [objectiveFilter, setObjectiveFilter] = useState<string>(ALL_FILTER);
  const [openRecipeId, setOpenRecipeId] = useState<string | null>(null);
  const [installRecipeId, setInstallRecipeId] = useState<string | null>(null);

  const { data: diagnosticLines = [] } = useAcademyDiagnostics(selectedClientId || null);

  const segments = useMemo(() => {
    const set = new Set<string>();
    ACADEMY_RECIPES.forEach((r) => r.segments.forEach((s) => set.add(s)));
    return Array.from(set).sort();
  }, []);

  const objectives = useMemo(() => {
    const set = new Set<string>();
    ACADEMY_RECIPES.forEach((r) => set.add(r.objective));
    return Array.from(set).sort();
  }, []);

  const filteredRecipes = useMemo(() => {
    return ACADEMY_RECIPES.filter((r) => {
      if (segmentFilter !== ALL_FILTER && !r.segments.includes(segmentFilter)) return false;
      if (objectiveFilter !== ALL_FILTER && r.objective !== objectiveFilter) return false;
      return true;
    });
  }, [segmentFilter, objectiveFilter]);

  const openRecipe = openRecipeId ? getAcademyRecipeById(openRecipeId) : null;

  const handleOpenRecipe = (recipe: AcademyRecipe) => {
    setOpenRecipeId(recipe.id);
    if (selectedClientId) {
      logUsage.mutate({ clientId: selectedClientId, recipeId: recipe.id, action: "opened" });
    }
  };

  const handleCopy = async (recipe: AcademyRecipe, label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `Copiado: ${label}` });
    } catch {
      toast({ title: "Não foi possível copiar", variant: "destructive" });
      return;
    }
    if (selectedClientId) {
      logUsage.mutate({ clientId: selectedClientId, recipeId: recipe.id, action: "copied" });
    }
  };

  const handleUseRecipe = (recipe: AcademyRecipe) => {
    if (!selectedClientId) {
      toast({ title: "Selecione uma empresa antes de instalar", variant: "destructive" });
      return;
    }
    setInstallRecipeId(recipe.id);
  };

  const installRecipe = installRecipeId ? getAcademyRecipeById(installRecipeId) : null;

  const handleDiagnosticClick = (recipeId: string) => {
    const recipe = getAcademyRecipeById(recipeId);
    if (recipe) handleOpenRecipe(recipe);
  };

  if (openRecipe) {
    return (
      <PageShell title="Vexo Academy" subtitle={openRecipe.title}>
        <div className="space-y-6 animate-fade-in-up">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setOpenRecipeId(null)}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar para a lista
          </Button>

          <Card>
            <CardHeader className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-primary/10 text-primary border-primary/20 text-xs font-bold">
                  {openRecipe.objective}
                </Badge>
                <Badge variant="outline" className="text-xs font-bold flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {openRecipe.estimatedMinutes} min
                </Badge>
              </div>
              <CardTitle className="text-2xl">{openRecipe.title}</CardTitle>
              <CardDescription className="text-base text-foreground">{openRecipe.resultPhrase}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg bg-accent border border-border p-4 text-sm text-accent-foreground">
                <strong>O que vai acontecer: </strong>
                {openRecipe.whatHappens}
              </div>

              <div className="bg-muted/40 border border-border rounded-lg p-5 space-y-2">
                <h4 className="font-bold text-sm">Pré-requisitos</h4>
                <ul className="space-y-1.5 text-sm">
                  {openRecipe.prerequisites.map((p, i) => (
                    <li key={i} className="flex gap-2">
                      <Check className="h-4 w-4 mt-0.5 shrink-0 text-success" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-muted/40 border border-border rounded-lg p-5 space-y-3">
                <h4 className="font-bold text-sm flex items-center gap-1.5">
                  <ListChecks className="h-4 w-4" />
                  Passo a passo
                </h4>
                <ol className="space-y-3 text-sm">
                  {openRecipe.steps.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="shrink-0 h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center font-mono">
                        {i + 1}
                      </span>
                      <div>
                        <span className="font-semibold text-primary">{step.screen}</span>
                        <span className="text-muted-foreground"> — {step.instruction}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="space-y-3">
                <h4 className="font-bold text-sm">Conteúdo — {openRecipe.cadenceName}</h4>
                {openRecipe.templates.map((tpl) => (
                  <div key={tpl.label} className="border border-border rounded-lg p-4 space-y-2 bg-card">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        {tpl.label}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px] gap-1"
                        onClick={() => handleCopy(openRecipe, tpl.label, tpl.message)}
                      >
                        <Copy className="h-3 w-3" />
                        Copiar
                      </Button>
                    </div>
                    <p className="text-sm font-mono whitespace-pre-wrap">{tpl.message}</p>
                  </div>
                ))}
              </div>

              <Button
                onClick={() => handleUseRecipe(openRecipe)}
                className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Usar esta receita
              </Button>
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
      subtitle="Receitas prontas por objetivo — resultado, passo a passo e o conteúdo de verdade, com um botão que instala."
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

        <div className="flex flex-wrap items-center gap-2">
          <FilterPills
            options={segments}
            active={segmentFilter}
            onChange={setSegmentFilter}
            allLabel="Todos os segmentos"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterPills
            options={objectives}
            active={objectiveFilter}
            onChange={setObjectiveFilter}
            allLabel="Todos os objetivos"
          />
        </div>

        {filteredRecipes.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma receita para esse filtro ainda.
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredRecipes.map((recipe) => (
              <button key={recipe.id} type="button" onClick={() => handleOpenRecipe(recipe)} className="text-left">
                <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all cursor-pointer">
                  <CardHeader className="space-y-2">
                    <Badge className="w-fit bg-primary/10 text-primary border-primary/20 text-[10px] font-bold">
                      {recipe.objective}
                    </Badge>
                    <CardTitle className="text-base">{recipe.title}</CardTitle>
                    <CardDescription>{recipe.resultPhrase}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {recipe.estimatedMinutes} min
                    </span>
                    <span>{recipe.segments.length} {recipe.segments.length === 1 ? "segmento" : "segmentos"}</span>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        )}
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
          active === ALL_FILTER
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/70"
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
            active === opt
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/70"
          )}
        >
          {opt}
        </button>
      ))}
    </>
  );
}
