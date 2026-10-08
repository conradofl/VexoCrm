import { Link } from "react-router-dom";
import { Sparkles, MessageCircle, Send, LayoutDashboard, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SetupCelebration() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 via-background to-indigo-950/30 p-6 md:p-8 shadow-lg">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-3 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            Implantação Concluída com Sucesso
          </div>

          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            🎉 Sua Operação Vexo OS está 100% Pronta!
          </h2>

          <p className="text-sm text-muted-foreground leading-relaxed">
            Parabéns! Todos os 3 pilares da sua máquina comercial inteligente foram configurados:
            chips de WhatsApp conectados, Agente de IA Comercial ativo e base de leads importada.
            Agora é hora de escalar seus resultados.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row md:flex-col gap-2.5 shrink-0">
          <Button
            asChild
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm gap-2"
          >
            <Link to="/crm/planilhas">
              <Send className="w-4 h-4" />
              Disparar Primeira Campanha
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            className="border-border/80 hover:bg-muted font-medium gap-2"
          >
            <Link to="/crm/whatsapp">
              <MessageCircle className="w-4 h-4 text-emerald-400" />
              Acompanhar no WhatsApp
            </Link>
          </Button>

          <Button
            asChild
            variant="ghost"
            className="text-xs text-muted-foreground hover:text-foreground gap-1.5"
          >
            <Link to="/crm/dashboard">
              <LayoutDashboard className="w-3.5 h-3.5" />
              Ver Central de Comando
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
