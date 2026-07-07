import { useEffect, useMemo, useState } from "react";
import { Search, Settings } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadClient, type LeadClientTableStatus } from "@/hooks/useLeadClients";
import { formatCreatedAt } from "@/lib/tenants/helpers";

interface TenantsTableProps {
  tenants: LeadClient[];
  isLoading: boolean;
  error: unknown;
  tableStatuses: Record<string, LeadClientTableStatus>;
  onSelectTenant: (tenant: LeadClient) => void;
}

export function TenantsTable({ tenants, isLoading, error, tableStatuses, onSelectTenant }: TenantsTableProps) {
  const [search, setSearch] = useState("");
  const [tenantsPage, setTenantsPage] = useState(1);
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "alphabetical_asc" | "alphabetical_desc">("newest");
  const [pageSize, setPageSize] = useState<10 | 20>(10);

  useEffect(() => {
    setTenantsPage(1);
  }, [search, sortBy, pageSize]);

  const filteredTenants = useMemo(() => {
    let result = [...tenants];
    const normalizedSearch = search.trim().toLowerCase();
    if (normalizedSearch) {
      result = result.filter(
        (tenant) =>
          tenant.name.toLowerCase().includes(normalizedSearch) ||
          tenant.id.toLowerCase().includes(normalizedSearch)
      );
    }

    result.sort((a, b) => {
      if (sortBy === "newest") {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      }
      if (sortBy === "oldest") {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateA - dateB;
      }
      if (sortBy === "alphabetical_asc") {
        return a.name.localeCompare(b.name, "pt-BR");
      }
      if (sortBy === "alphabetical_desc") {
        return b.name.localeCompare(a.name, "pt-BR");
      }
      return 0;
    });

    return result;
  }, [tenants, search, sortBy]);

  const totalTenantPages = Math.max(1, Math.ceil(filteredTenants.length / pageSize));
  const safeTenantsPage = Math.min(tenantsPage, totalTenantPages);
  const paginatedTenants = filteredTenants.slice(
    (safeTenantsPage - 1) * pageSize,
    safeTenantsPage * pageSize
  );

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Tenants cadastrados</CardTitle>
            <CardDescription>
              Consulte IDs, datas de criacao e a rota base de cada empresa.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative w-full max-w-xs sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9 text-xs"
                placeholder="Buscar por nome ou tenant ID"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select
              value={sortBy}
              onValueChange={(value) => setSortBy(value as any)}
            >
              <SelectTrigger className="h-9 w-44 rounded-xl text-xs bg-white/80 dark:bg-white/[0.02] border-slate-200 dark:border-white/10">
                <SelectValue placeholder="Ordenar por" />
              </SelectTrigger>
              <SelectContent className="border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-white/10 dark:bg-[#0b0e1a] dark:text-white text-xs">
                <SelectItem value="newest">Mais recentes</SelectItem>
                <SelectItem value="oldest">Mais antigas</SelectItem>
                <SelectItem value="alphabetical_asc">Ordem alfabética A-Z</SelectItem>
                <SelectItem value="alphabetical_desc">Ordem alfabética Z-A</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorMessage message={error ? (error as Error).message : null} variant="banner" />

        {isLoading ? (
          <div className="rounded-lg border border-slate-200/80 bg-white/70 px-4 py-6 text-center text-xs text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
            Carregando empresas...
          </div>
        ) : filteredTenants.length === 0 ? (
          <EmptyState
            title={search ? "Nenhuma empresa encontrada" : "Nenhuma empresa cadastrada"}
            description={
              search
                ? "Ajuste o termo buscado para localizar outro tenant."
                : "Crie o primeiro tenant para liberar operacao por empresa dentro do CRM."
            }
          />
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-slate-200/60 dark:border-white/5 bg-slate-50/20 dark:bg-white/[0.01]">
              <Table className="text-xs">
                <TableHeader className="bg-slate-50/50 dark:bg-white/[0.02]">
                  <TableRow className="border-slate-200/60 dark:border-white/5">
                    <TableHead className="px-4 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Nome / ID</TableHead>
                    <TableHead className="px-4 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Criado em</TableHead>
                    <TableHead className="px-4 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-center">Onboarding</TableHead>
                    <TableHead className="px-4 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Tabela de Leads</TableHead>
                    <TableHead className="px-4 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedTenants.map((tenant) => {
                    const tableStatus = tableStatuses[tenant.id] || tenant.leads_table;
                    const expectedTableName = tableStatus?.tableName || `leads_${tenant.id.replace(/-/g, "_")}`;
                    return (
                      <TableRow
                        key={tenant.id}
                        className="border-slate-200/60 hover:bg-slate-50/50 dark:border-white/5 dark:hover:bg-white/[0.01] cursor-pointer"
                        onClick={() => onSelectTenant(tenant)}
                      >
                        <TableCell className="px-4 py-3 font-medium text-foreground">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{tenant.name}</span>
                            <Badge className="border border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200 text-[10px] font-mono font-medium">
                              {tenant.id}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {formatCreatedAt(tenant.created_at)}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-center">
                          <Badge className="border border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-[10px] font-medium capitalize">
                            {tenant.n8n_onboarding_status || "pendente"}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[160px]" title={expectedTableName}>
                              {expectedTableName}
                            </span>
                            <Badge
                              className={
                                tableStatus?.exists
                                  ? "border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-[10px]"
                                  : "border border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-200 text-[10px]"
                              }
                            >
                              {tableStatus?.exists ? "OK" : "Não verif."}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5"
                            onClick={() => onSelectTenant(tenant)}
                            title="Configurações Avançadas"
                          >
                            <Settings className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {filteredTenants.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-3 text-xs text-muted-foreground dark:border-white/10">
                <div className="flex items-center gap-4">
                  <span>
                    Mostrando {filteredTenants.length === 0 ? 0 : (safeTenantsPage - 1) * pageSize + 1}-
                    {Math.min(safeTenantsPage * pageSize, filteredTenants.length)} de {filteredTenants.length}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <span>Empresas por página:</span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(val) => setPageSize(Number(val) as 10 | 20)}
                    >
                      <SelectTrigger className="h-7 w-16 rounded-lg text-xs bg-white/80 dark:bg-white/[0.02] border-slate-200 dark:border-white/10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-white/10 dark:bg-[#0b0e1a] dark:text-white text-xs">
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {totalTenantPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      disabled={safeTenantsPage <= 1}
                      onClick={() => setTenantsPage((page) => Math.max(1, page - 1))}
                    >
                      Anterior
                    </Button>
                    <span className="rounded-md border border-slate-200/80 bg-white px-2.5 py-1 font-semibold text-foreground dark:border-white/10 dark:bg-white/[0.04]">
                      {safeTenantsPage}/{totalTenantPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      disabled={safeTenantsPage >= totalTenantPages}
                      onClick={() => setTenantsPage((page) => Math.min(totalTenantPages, page + 1))}
                    >
                      Próxima
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
