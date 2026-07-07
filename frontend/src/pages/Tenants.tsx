import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/PageShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  LeadClient,
  useLeadClients,
  type LeadClientTableStatus,
} from "@/hooks/useLeadClients";
import { formatCreatedAt } from "@/lib/tenants/helpers";
import { CreateTenantDialog } from "@/pages/Tenants/CreateTenantDialog";
import { TenantsTable } from "@/pages/Tenants/TenantsTable";
import { TenantConfigDialog } from "@/pages/Tenants/TenantConfigDialog";

export default function Tenants() {
  const { data: tenants = [], isLoading, error } = useLeadClients();
  const { hasPermission, isAdminUser } = useAuth();
  const [tableStatuses, setTableStatuses] = useState<Record<string, LeadClientTableStatus>>({});
  const [selectedTenantForConfig, setSelectedTenantForConfig] = useState<LeadClient | null>(null);
  const canManageTenants = hasPermission("tenants.manage");
  const canManageN8n = isAdminUser;

  const latestTenant = tenants.reduce<string | null>((latest, tenant) => {
    if (!tenant.created_at) return latest;
    if (!latest) return tenant.created_at;
    return new Date(tenant.created_at).getTime() > new Date(latest).getTime()
      ? tenant.created_at
      : latest;
  }, null);

  return (
    <PageShell
      title="Empresas"
      subtitle="Crie e organize os tenants que vao operar dentro do CRM e do portal do cliente."
      spacing="space-y-4"
      compactHero
      headerRight={
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-700 dark:text-cyan-200">
            {tenants.length} tenants
          </Badge>
          <Badge className="border border-slate-300/80 bg-white/90 px-2 py-0.5 text-[11px] text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/80">
            {canManageTenants ? "Criacao liberada" : "Consulta apenas"}
          </Badge>
          <Badge className="border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-200">
            {canManageN8n ? "Disparo Evolution liberado" : "Evolution restrito a admins"}
          </Badge>
          <CreateTenantDialog
            onTenantCreated={(tenant) => {
              if (tenant.leads_table) {
                setTableStatuses((current) => ({
                  ...current,
                  [tenant.id]: tenant.leads_table!,
                }));
              }
            }}
          />
        </div>
      }
    >
      <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Base operacional</CardDescription>
                <CardTitle className="text-2xl">{tenants.length}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                Total de empresas prontas para receber usuarios, dados e campanhas.
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Ultimo cadastro</CardDescription>
                <CardTitle className="text-base">
                  {latestTenant ? formatCreatedAt(latestTenant) : "Nenhum tenant criado"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                Use esse painel para garantir que todo novo cliente entre com `clientId` padrao e
                rota consistente.
              </CardContent>
            </Card>
          </div>

          <TenantsTable
            tenants={tenants}
            isLoading={isLoading}
            error={error}
            tableStatuses={tableStatuses}
            onSelectTenant={setSelectedTenantForConfig}
          />

          {/* ── MODAL DE CONFIGURAÇÕES DA EMPRESA ───────────────────────────────── */}
          <TenantConfigDialog
            tenant={selectedTenantForConfig}
            onClose={() => setSelectedTenantForConfig(null)}
            tableStatuses={tableStatuses}
            setTableStatuses={setTableStatuses}
          />

          <div className="rounded-[22px] border border-cyan-500/20 bg-cyan-500/5 px-5 py-4 text-sm text-slate-700 dark:text-white/75 shadow-sm">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-200" />
              <div className="space-y-1">
                <p className="font-medium text-foreground">Tenant criado, operacao liberada</p>
                <p>
                  Depois do cadastro, o novo `clientId` fica disponivel para vinculacao no modulo
                  de acessos. Em perfis com escopo restrito, ele passa a aparecer nos seletores
                  assim que esse vinculo for aplicado ao usuario.
                </p>
              </div>
            </div>
          </div>
      </div>

    </PageShell>
  );
}
