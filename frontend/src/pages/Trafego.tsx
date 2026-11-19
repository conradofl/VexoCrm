// Gestor de Tráfego: conexão, metas, desempenho com a decisão sugerida por
// anúncio e, na Fase 2, o plano do dia com aprovação dupla. Nada daqui é
// aplicado em plataforma nenhuma.
import { useSearchParams } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { PageShell } from "@/components/PageShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTrafficAccess } from "@/hooks/useTraffic";
import { ConexaoTab } from "./Trafego/ConexaoTab";
import { MetasTab } from "./Trafego/MetasTab";
import { DesempenhoTab } from "./Trafego/DesempenhoTab";
import { PlanoTab } from "./Trafego/PlanoTab";

const TABS = ["conexao", "metas", "desempenho", "plano"] as const;
type TabKey = (typeof TABS)[number];

export default function Trafego() {
  const { clientId: authClientId } = useAuth();
  const crmClient = useOptionalCrmClient();
  const clientId = crmClient?.selectedClientId || authClientId || "";
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab") as TabKey | null;
  const tab: TabKey = requested && TABS.includes(requested) ? requested : "desempenho";

  const access = useTrafficAccess(clientId || undefined);

  const changeTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  return (
    <PageShell
      title="Tráfego"
      subtitle="Meta e Google Ads por empresa. O Vexo lê, sugere e pede aprovação: nada é alterado nas plataformas."
    >
      {access.isLoading ? (
        <div className="rounded-2xl border bg-card/60 p-8 text-center text-sm text-muted-foreground" role="status">
          Verificando acesso...
        </div>
      ) : access.isError ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm" role="alert">
          <p className="font-medium text-destructive">Não foi possível verificar o acesso.</p>
          <p className="mt-1 text-muted-foreground">{(access.error as Error)?.message}</p>
        </div>
      ) : !access.data?.allowed ? (
        <div className="flex items-start gap-3 rounded-2xl border bg-card/60 p-6" role="alert">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <p className="font-medium">Gestor de Tráfego indisponível</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {access.data?.message || "Esta empresa ou este usuário não tem acesso ao Gestor de Tráfego."}
            </p>
          </div>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={changeTab} className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 sm:inline-flex sm:w-auto">
            <TabsTrigger value="conexao">Conexão</TabsTrigger>
            <TabsTrigger value="metas">Metas e regras</TabsTrigger>
            <TabsTrigger value="desempenho">Desempenho</TabsTrigger>
            <TabsTrigger value="plano">Plano e aprovações</TabsTrigger>
          </TabsList>
          <TabsContent value="conexao">
            <ConexaoTab clientId={clientId} />
          </TabsContent>
          <TabsContent value="metas">
            <MetasTab clientId={clientId} />
          </TabsContent>
          <TabsContent value="desempenho">
            <DesempenhoTab clientId={clientId} onGoToTab={changeTab} />
          </TabsContent>
          <TabsContent value="plano">
            <PlanoTab clientId={clientId} onGoToTab={changeTab} />
          </TabsContent>
        </Tabs>
      )}
    </PageShell>
  );
}
