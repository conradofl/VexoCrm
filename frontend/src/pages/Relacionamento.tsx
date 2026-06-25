import { Link } from "react-router-dom";
import { 
  Heart, 
  Info, 
  ArrowLeft, 
  Gift, 
  UserMinus, 
  Sliders
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SegmentacaoCatalog } from "@/components/livpub/SegmentacaoCatalog";
import { AniversariantesList } from "@/components/livpub/AniversariantesList";
import { InativosList } from "@/components/livpub/InativosList";

export default function Relacionamento() {
  return (
    <PageShell
      title="Relacionamento & Segmentação"
      subtitle="Gerencie campanhas de aniversário, reativação de leads e filtros personalizados"
      spacing="space-y-6"
    >
      <div className="flex items-center justify-between border border-border bg-muted/20 p-4 rounded-lg">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-pink-400 mt-0.5" />
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold text-foreground">Planejamento do Track B (Luiz)</h4>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Esta tela agrupará a gestão de clientes aniversariantes, inativos e as definições do catálogo de segmentações. As esteiras automáticas 3 e 4 serão acopladas a esta interface na Semana 4.
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs">
          <Link to="/crm/livpub">
            <ArrowLeft className="h-3 w-3" />
            Voltar ao Hub
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="segmentacao" className="w-full space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-md bg-muted border border-border h-10 p-1">
          <TabsTrigger value="segmentacao" className="text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
            <Sliders className="h-3.5 w-3.5 mr-1.5" />
            Catálogo
          </TabsTrigger>
          <TabsTrigger value="aniversariantes" className="text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
            <Gift className="h-3.5 w-3.5 mr-1.5" />
            Aniversariantes
          </TabsTrigger>
          <TabsTrigger value="inativos" className="text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
            <UserMinus className="h-3.5 w-3.5 mr-1.5" />
            Clientes Inativos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="segmentacao" className="space-y-4 outline-none">
          <SegmentacaoCatalog />
        </TabsContent>

        <TabsContent value="aniversariantes" className="space-y-4 outline-none">
          <AniversariantesList />
        </TabsContent>

        <TabsContent value="inativos" className="space-y-4 outline-none">
          <InativosList />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
