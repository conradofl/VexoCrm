import { PageShell } from "@/components/PageShell";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useWebhookSettings, useGenerateWebhookSettings } from "@/hooks/useWebhooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, RefreshCw, Server, CreditCard, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/EmptyState";

export default function WebhooksIntegrations() {
  const crmClient = useOptionalCrmClient();
  const tenantId = crmClient?.selectedClientId || "";
  const { data: settings, isLoading } = useWebhookSettings(tenantId);
  const generateMutation = useGenerateWebhookSettings();
  const { toast } = useToast();

  const baseUrl = import.meta.env.VITE_API_URL || "https://api.vexo.com";

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copiado",
      description: `${label} copiado para a área de transferência.`,
    });
  };

  const handleGenerate = () => {
    generateMutation.mutate(tenantId, {
      onSuccess: () => {
        toast({
          title: "Tokens gerados",
          description: "Os tokens de webhook foram gerados com sucesso.",
        });
      },
    });
  };

  if (!tenantId) {
    return (
      <PageShell title="Integrações & Webhooks" subtitle="Conecte plataformas externas ao Vexo." compactHero>
        <EmptyState title="Selecione uma empresa" description="Escolha uma empresa no seletor para configurar as integrações." />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Integrações & Webhooks"
      subtitle="Obtenha as URLs e tokens para conectar formulários e gateways de pagamento ao seu painel."
      compactHero
      spacing="space-y-6"
    >
      {!settings && !isLoading ? (
        <Card className="border-dashed bg-muted/20">
          <CardHeader className="text-center">
            <CardTitle>Nenhuma integração configurada</CardTitle>
            <CardDescription>
              Para começar a receber leads e eventos de conversão de sistemas externos, gere seus tokens de integração.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-6">
            <Button onClick={handleGenerate} disabled={generateMutation.isPending} size="lg">
              {generateMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Server className="mr-2 h-4 w-4" />}
              Gerar Tokens de Integração
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="inbound" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="inbound"><ArrowRight className="mr-2 h-4 w-4"/> Inbound Leads</TabsTrigger>
            <TabsTrigger value="conversion"><CreditCard className="mr-2 h-4 w-4"/> Conversões (Vendas)</TabsTrigger>
          </TabsList>

          <TabsContent value="inbound" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Inbound Leads Webhook</CardTitle>
                <CardDescription>
                  URL para registrar novos leads automaticamente no Vexo.
                  Conecte no ActiveCampaign, Typeform, Meta Ads (via Make/Zapier), RD Station, etc.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>URL do Webhook (POST)</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={`${baseUrl}/api/webhooks/inbound/${tenantId}?token=${settings?.inbound_token || ""}`} className="font-mono text-xs" />
                    <Button variant="outline" size="icon" onClick={() => handleCopy(`${baseUrl}/api/webhooks/inbound/${tenantId}?token=${settings?.inbound_token || ""}`, "URL do Inbound Webhook")}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                
                <div className="bg-muted p-4 rounded-md text-sm text-muted-foreground mt-4">
                  <p className="font-medium mb-2 text-foreground">Formato do Payload JSON (Body):</p>
                  <pre className="font-mono text-xs bg-background p-2 rounded border">{`{
  "phone": "5511999999999",    // Obrigatório (com ou sem formatação)
  "name": "Nome do Lead",      // Opcional
  "source": "Meta Ads",        // Opcional
  "campaign": "C1 - Inverno"   // Opcional
}`}</pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="conversion" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Conversion Webhook (Vendas)</CardTitle>
                <CardDescription>
                  URL para registrar fechamentos e valores de contratos.
                  Conecte no seu Gateway de Pagamento, ERP (Bling, Omie) ou Hotmart/Kiwify.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>URL do Webhook (POST)</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={`${baseUrl}/api/webhooks/conversion/${tenantId}?token=${settings?.conversion_token || ""}`} className="font-mono text-xs" />
                    <Button variant="outline" size="icon" onClick={() => handleCopy(`${baseUrl}/api/webhooks/conversion/${tenantId}?token=${settings?.conversion_token || ""}`, "URL de Conversão")}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="bg-muted p-4 rounded-md text-sm text-muted-foreground mt-4">
                  <p className="font-medium mb-2 text-foreground">Formato do Payload JSON (Body):</p>
                  <pre className="font-mono text-xs bg-background p-2 rounded border">{`{
  "phone": "5511999999999",    // Obrigatório para cruzar com o lead existente
  "value": 1500.00             // Opcional: Valor do fechamento
}`}</pre>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end pt-4">
              <Button variant="outline" onClick={handleGenerate} disabled={generateMutation.isPending} className="text-muted-foreground">
                <RefreshCw className={`mr-2 h-4 w-4 ${generateMutation.isPending ? "animate-spin" : ""}`} />
                Regerar Tokens
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </PageShell>
  );
}
