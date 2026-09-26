// frontend/src/components/academy/AcademyInstallDialog.tsx
//
// "Pede o que falta" — a receita não escolhe o agente sozinha. Sem agente
// configurado, nem abre o seletor: diz o que falta e não instala.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFupCompanies } from "@/hooks/useFollowupAdmin";
import { useInstallAcademyRecipe } from "@/hooks/useAcademyInstall";
import { toast } from "@/components/ui/use-toast";
import type { AcademyRecipe } from "@/data/academyRecipes";

interface AcademyInstallDialogProps {
  recipe: AcademyRecipe;
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AcademyInstallDialog({ recipe, clientId, open, onOpenChange }: AcademyInstallDialogProps) {
  const navigate = useNavigate();
  const { data: companies, isLoading } = useFupCompanies(clientId);
  const [companyId, setCompanyId] = useState("");
  const install = useInstallAcademyRecipe();

  useEffect(() => {
    if (open) setCompanyId("");
  }, [open]);

  const hasCompanies = !isLoading && (companies?.length || 0) > 0;

  const handleConfirm = () => {
    if (!companyId) return;
    install.mutate(
      { recipe, companyId, clientId },
      {
        onSuccess: (result) => {
          onOpenChange(false);
          toast({
            title: result.renamed ? `Criada como "${result.campaignName}"` : "Cadência criada",
            description: result.renamed
              ? `Já existia uma cadência chamada "${recipe.cadenceName}" para este agente — nada foi sobrescrito, esta ganhou outro nome. Está como rascunho, desligada: revise antes de ativar.`
              : "Está como rascunho, desligada: revise antes de ativar.",
          });
          navigate("/crm/followup");
        },
        onError: (err: any) => {
          toast({ title: "Erro ao instalar a receita", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Para qual agente instalar esta receita?</DialogTitle>
          <DialogDescription>
            "{recipe.cadenceName}" vai ser criada como rascunho, desligada — você revisa e liga quando quiser.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando agentes...
          </p>
        ) : !hasCompanies ? (
          <p className="text-sm text-warning">
            Nenhum agente configurado ainda. Crie um em Cadências de Follow-up antes de instalar esta receita.
          </p>
        ) : (
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger>
              <SelectValue placeholder="Escolha o agente..." />
            </SelectTrigger>
            <SelectContent>
              {companies!.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!companyId || install.isPending} onClick={handleConfirm}>
            {install.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Instalar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
