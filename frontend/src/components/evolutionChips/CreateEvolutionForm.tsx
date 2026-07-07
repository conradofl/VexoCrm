import { Plus, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface CreateEvolutionFormProps {
  createMode: "provision" | "manual";
  evolutionDraft: {
    name: string;
    dispatchWebhookUrl: string;
    dispatchWebhookToken: string;
    active: boolean;
    isDefault: boolean;
  };
  onModeChange: (mode: "provision" | "manual") => void;
  onUpdateDraft: (patch: {
    name?: string;
    dispatchWebhookUrl?: string;
    dispatchWebhookToken?: string;
    active?: boolean;
    isDefault?: boolean;
  }) => void;
  onCreateEvolution: () => void;
  onProvisionEvolution: () => void;
  isCreatePending: boolean;
  isProvisionPending: boolean;
}

export function CreateEvolutionForm({
  createMode,
  evolutionDraft,
  onModeChange,
  onUpdateDraft,
  onCreateEvolution,
  onProvisionEvolution,
  isCreatePending,
  isProvisionPending,
}: CreateEvolutionFormProps) {
  return (
    <div className="grid gap-4 rounded-2xl border border-slate-200/60 bg-white/80 p-5 mt-4 dark:border-white/5 dark:bg-white/[0.03]">
      {/* Abas Internas de Criação (Linearidade e Organização) */}
      <div className="flex border-b border-slate-200/60 dark:border-white/10 pb-2 gap-2">
        <button
          type="button"
          onClick={() => onModeChange("provision")}
          className={cn(
            "pb-2 px-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all font-display",
            createMode === "provision"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Conectar Novo Chip (Automático)
        </button>
        <button
          type="button"
          onClick={() => onModeChange("manual")}
          className={cn(
            "pb-2 px-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all font-display",
            createMode === "manual"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Vincular Manualmente
        </button>
      </div>

      {createMode === "provision" ? (
        /* ABA A: Criar com QR Code automático */
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-foreground">Identificador do Chip</label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Input
                    className="rounded-xl h-10"
                    placeholder="Ex: chip-vendas-financeiro"
                    value={evolutionDraft.name}
                    onChange={(e) => onUpdateDraft({ name: e.target.value })}
                  />
                </TooltipTrigger>
                <TooltipContent>Escolha um nome simples para identificar este chip no Vexo OS</TooltipContent>
              </Tooltip>
              <p className="px-1 text-[10px] text-muted-foreground">
                Espaços viram hifen ao criar (ex.: "Chip Vendas" → "chip-vendas").
              </p>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-foreground">Chave de API Secundária (Opcional)</label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Input
                    className="rounded-xl h-10"
                    placeholder="Chave customizada para segurança"
                    value={evolutionDraft.dispatchWebhookToken}
                    onChange={(e) => onUpdateDraft({ dispatchWebhookToken: e.target.value })}
                  />
                </TooltipTrigger>
                <TooltipContent>Chave secreta para autorização na Evolution API (opcional)</TooltipContent>
              </Tooltip>
              <p className="px-1 text-[10px] text-muted-foreground">
                O sistema auto-gera uma chave segura se deixada em branco.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-4">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                  checked={evolutionDraft.active}
                  onChange={(e) => onUpdateDraft({ active: e.target.checked })}
                />
                Chip Ativo
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                  checked={evolutionDraft.isDefault}
                  onChange={(e) => onUpdateDraft({ isDefault: e.target.checked })}
                />
                Tornar Padrão de Envio
              </label>
            </div>
            <Button
              type="button"
              variant="default"
              className="rounded-xl px-5 h-10"
              disabled={isProvisionPending}
              onClick={onProvisionEvolution}
            >
              <Wand2 className="mr-2 h-4 w-4 animate-pulse" />
              {isProvisionPending ? "Conectando..." : "Gerar QR Code de Pareamento"}
            </Button>
          </div>
        </div>
      ) : (
        /* ABA B: Vinculação manual para dev/infra existente */
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,0.8fr)]">
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-foreground">Identificador do Chip</label>
              <Input
                className="rounded-xl h-10"
                placeholder="Ex: chip-suporte-manual"
                value={evolutionDraft.name}
                onChange={(e) => onUpdateDraft({ name: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-foreground">URL de Disparo Evolution</label>
              <Input
                className="rounded-xl h-10"
                placeholder="https://.../message/sendText/Instancia"
                value={evolutionDraft.dispatchWebhookUrl}
                onChange={(e) => onUpdateDraft({ dispatchWebhookUrl: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-foreground">API Key da Conexão</label>
              <Input
                className="rounded-xl h-10"
                placeholder="Chave do header apikey"
                value={evolutionDraft.dispatchWebhookToken}
                onChange={(e) => onUpdateDraft({ dispatchWebhookToken: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-4">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                  checked={evolutionDraft.active}
                  onChange={(e) => onUpdateDraft({ active: e.target.checked })}
                />
                Chip Ativo
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                  checked={evolutionDraft.isDefault}
                  onChange={(e) => onUpdateDraft({ isDefault: e.target.checked })}
                />
                Tornar Padrão de Envio
              </label>
            </div>
            <Button
              type="button"
              variant="default"
              className="rounded-xl px-5 h-10"
              disabled={isCreatePending || !evolutionDraft.dispatchWebhookUrl.trim()}
              onClick={onCreateEvolution}
            >
              <Plus className="mr-2 h-4 w-4" />
              {isCreatePending ? "Adicionando..." : "Vincular Conexão Existente"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
