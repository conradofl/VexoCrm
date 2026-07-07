import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Save, Loader2 } from "lucide-react";
import { useUpdateFupCompany } from "@/hooks/useFollowupAdmin";
import { toast } from "sonner";

export function AITrainingTab({ companyId, company }: { companyId: string, company: any }) {
  const updateCompany = useUpdateFupCompany();
  const [promptAniversario, setPromptAniversario] = useState("");
  const [promptInativo, setPromptInativo] = useState("");

  useEffect(() => {
    if (company) {
      setPromptAniversario(company.livpub_aniversario_prompt || "");
      setPromptInativo(company.livpub_inativo_prompt || "");
    }
  }, [company]);

  const handleSave = async () => {
    try {
      await updateCompany.mutateAsync({
        id: companyId,
        livpub_aniversario_prompt: promptAniversario,
        livpub_inativo_prompt: promptInativo
      });
      toast.success("Prompts de IA salvos com sucesso!");
    } catch (err) {
      toast.error("Erro ao salvar prompts de IA");
    }
  };

  if (!companyId || companyId === "all") {
    return (
      <div className="border border-dashed border-border py-12 rounded-lg text-center flex flex-col items-center justify-center">
        <Bot className="h-8 w-8 text-muted-foreground mb-3" />
        <span className="text-sm font-medium text-muted-foreground">Selecione uma empresa</span>
        <span className="text-xs text-muted-foreground mt-0.5">
          Para configurar a IA, escolha uma empresa no topo da página.
        </span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4.5 w-4.5 text-indigo-400" />
            Treinamento e Prompts da IA
          </CardTitle>
          <CardDescription>
            Personalize as diretrizes, regras e tom de voz que a Inteligência Artificial utilizará para redigir as abordagens em cada esteira.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div>
              <label className="text-sm font-semibold text-foreground">Prompt: Esteira 3 (Aniversariantes)</label>
              <p className="text-xs text-muted-foreground">
                Instrua como a IA deve oferecer a mesa VIP e os mimos de aniversário. Ex: "Você é um promoter, chame o cliente pelo nome, seja animado..."
              </p>
            </div>
            <Textarea
              className="min-h-[150px] font-sans text-sm resize-y"
              placeholder="Deixe em branco para usar o prompt padrão do sistema..."
              value={promptAniversario}
              onChange={(e) => setPromptAniversario(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-semibold text-foreground">Prompt: Esteira 4 (Inativos)</label>
              <p className="text-xs text-muted-foreground">
                Instrua como a IA deve tentar reativar um cliente ausente há mais de 6 meses. Ex: "Diga que sentimos falta dele, ofereça um desconto no próximo show..."
              </p>
            </div>
            <Textarea
              className="min-h-[150px] font-sans text-sm resize-y"
              placeholder="Deixe em branco para usar o prompt padrão do sistema..."
              value={promptInativo}
              onChange={(e) => setPromptInativo(e.target.value)}
            />
          </div>

          <div className="flex justify-end pt-2">
            <Button 
              onClick={handleSave} 
              disabled={updateCompany.isPending}
              className="bg-indigo-500 hover:bg-indigo-600 text-white"
            >
              {updateCompany.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {updateCompany.isPending ? "Salvando..." : "Salvar Configurações"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
