import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Heart,
  Info,
  ArrowLeft,
  Gift,
  UserMinus,
  Sliders,
  Building2
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SegmentacaoCatalog } from "@/components/livpub/SegmentacaoCatalog";
import { AniversariantesList } from "@/components/livpub/AniversariantesList";
import { InativosList } from "@/components/livpub/InativosList";
import { useFupCompanies } from "@/hooks/useFollowupAdmin";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Relacionamento() {
  const { data: companies = [], isLoading: loadingCompanies } = useFupCompanies();
  const [companyId, setCompanyId] = useState<string>("all");

  useEffect(() => {
    if (companies.length > 0 && companyId === "all") {
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId]);

  return (
    <PageShell
      title="Relacionamento & Segmentação"
      subtitle="Gerencie campanhas de aniversário, reativação de leads e filtros personalizados"
      spacing="space-y-6"
    >
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between border border-border bg-muted/20 p-4 rounded-lg gap-4">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-pink-400 mt-0.5" />
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold text-foreground">Gestão de Relacionamento</h4>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Esta tela agrupa a gestão de clientes aniversariantes, inativos e as definições do catálogo de segmentações. Aprove ou rejeite sugestões de abordagens automatizadas geradas proativamente.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="w-[200px]">
            <Select value={companyId} onValueChange={setCompanyId} disabled={loadingCompanies}>
              <SelectTrigger className="w-full bg-background border-border">
                <SelectValue placeholder="Selecione a empresa..." />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs whitespace-nowrap">
            <Link to="/crm/livpub">
              <ArrowLeft className="h-3 w-3" />
              Voltar ao Hub
            </Link>
          </Button>
        </div>
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
          <SegmentacaoCatalog companyId={companyId} />
        </TabsContent>

        <TabsContent value="aniversariantes" className="space-y-4 outline-none">
          <AniversariantesList companyId={companyId} />
        </TabsContent>

        <TabsContent value="inativos" className="space-y-4 outline-none">
          <InativosList companyId={companyId} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
