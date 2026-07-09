import { useSearchParams } from "react-router-dom";
import { Sparkles, Briefcase, ArrowLeft } from "lucide-react";
import VexoPitch from "./VexoPitch";
import GeracaoDigitalPitch from "./GeracaoDigitalPitch";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ApresentacaoUnificada() {
  const [searchParams, setSearchParams] = useSearchParams();
  const deck = searchParams.get("deck");

  if (deck === "vexo") {
    return (
      <div className="relative">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => setSearchParams({})} 
          className="absolute top-4 left-4 z-50 gap-2 bg-background/80 backdrop-blur"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar à Escolha de Deck
        </Button>
        <VexoPitch />
      </div>
    );
  }

  if (deck === "gd") {
    return (
      <div className="relative">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => setSearchParams({})} 
          className="absolute top-4 left-4 z-50 gap-2 bg-background/80 backdrop-blur"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar à Escolha de Deck
        </Button>
        <GeracaoDigitalPitch />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 space-y-8">
      <div className="text-center max-w-xl space-y-3">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-violet-500 to-cyan-400 bg-clip-text text-transparent sm:text-4xl">
          Seletor de Apresentação Comercial
        </h1>
        <p className="text-muted-foreground text-sm">
          Selecione qual deck comercial interativo (Pitch) você deseja apresentar para o prospect.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
        <Card className="hover:shadow-lg transition-all border border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-500" />
              Pitch Comercial Vexo OS
            </CardTitle>
            <CardDescription>
              Apresentação completa do ecossistema CRM, automações e IA para clientes corporativos gerais.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => setSearchParams({ deck: "vexo" })}>
              Iniciar Apresentação Vexo
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-all border border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-pink-500" />
              Pitch Geração Digital (GD)
            </CardTitle>
            <CardDescription>
              Apresentação customizada focada na metodologia da Geração Digital, equipe comercial e briefing com IA.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => setSearchParams({ deck: "gd" })}>
              Iniciar Apresentação GD
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
