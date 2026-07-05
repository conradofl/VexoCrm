import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { type AdminUserRecord } from "@/hooks/useAdminUsers";
import { type LeadClient } from "@/hooks/useLeadClients";
import {
  type ManagedRole,
  type UserDraft,
  ROLE_BADGE_CLASS,
  ROLE_LABELS,
  buildSearchIndex,
  buildUserDraft,
  isProtectedAdmin,
  summarizeClientAssignments,
} from "@/lib/userAccessDraft";

type RoleFilter = "all" | ManagedRole;

interface UsersTableProps {
  users: AdminUserRecord[];
  drafts: Record<string, UserDraft>;
  clients: LeadClient[];
  selectedClientId: string;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  onSelectUser: (uid: string) => void;
  onFilteredUsersChange?: (users: AdminUserRecord[]) => void;
}

export function UsersTable({
  users,
  drafts,
  clients,
  selectedClientId,
  isLoading,
  error,
  refetch,
  onSelectUser,
  onFilteredUsersChange,
}: UsersTableProps) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [pageSize, setPageSize] = useState<10 | 20>(10);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, selectedClientId, pageSize]);

  const clientScopedUsers = useMemo(() => {
    if (!selectedClientId) {
      return users;
    }

    const selectedClient = clients.find((client) => client.id === selectedClientId);
    const selectedClientName = selectedClient?.name.trim().toLowerCase() || "";

    return users.filter((user) => {
      const draft = drafts[user.uid] || buildUserDraft(user);

      if (draft.clientIds.includes(selectedClientId)) {
        return true;
      }

      if (selectedClientName && draft.companyName.trim().toLowerCase() === selectedClientName) {
        return true;
      }

      // Se for um usuário interno global (sem cliente específico vinculado)
      if (draft.role === "internal" && draft.clientIds.length === 0) {
        return true;
      }

      if (draft.role !== "pending") {
        return false;
      }

      if (!selectedClientName) {
        return true;
      }

      return draft.companyName.trim().toLowerCase() === selectedClientName;
    });
  }, [clients, drafts, selectedClientId, users]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    const ordered = [...clientScopedUsers].sort((a, b) => {
      if (a.access.isAdmin !== b.access.isAdmin) {
        return a.access.isAdmin ? -1 : 1;
      }

      const order: Record<ManagedRole, number> = { pending: 0, client: 1, internal: 2 };
      return order[a.access.role] - order[b.access.role];
    });

    return ordered.filter((user) => {
      const draft = drafts[user.uid] || buildUserDraft(user);
      if (roleFilter !== "all" && draft.role !== roleFilter) return false;
      if (!term) return true;
      return buildSearchIndex(user, draft).includes(term);
    });
  }, [clientScopedUsers, drafts, roleFilter, search]);

  useEffect(() => {
    onFilteredUsersChange?.(filteredUsers);
  }, [filteredUsers, onFilteredUsersChange]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const paginatedUsers = useMemo(() => {
    return filteredUsers.slice(
      (safePage - 1) * pageSize,
      safePage * pageSize
    );
  }, [filteredUsers, safePage, pageSize]);

  return (
    <Card className="border-border/80">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-xl">Liberacao e acessos dos usuarios</CardTitle>
            <CardDescription>Selecione uma pessoa, defina a funcao, vincule a empresa e marque exatamente os modulos que ela pode acessar.</CardDescription>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">


            <div className="relative min-w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome, e-mail ou empresa"
                className="pl-9"
              />
            </div>

            <Select value={roleFilter} onValueChange={(value: RoleFilter) => setRoleFilter(value)}>
              <SelectTrigger className="min-w-[180px]">
                <SelectValue placeholder="Filtrar categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                <SelectItem value="internal">Interno</SelectItem>
                <SelectItem value="client">Cliente</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

      </CardHeader>

      <CardContent className="space-y-5">
        {isLoading ? <EmptyState message="Carregando usuarios..." /> : null}

        {!isLoading && error ? (
          <div className="rounded-[1.5rem] border border-destructive/30 bg-destructive/10 p-8 text-center">
            <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-destructive" />
            <p className="text-sm font-medium text-foreground">Nao foi possivel carregar usuarios</p>
            <p className="mx-auto mt-2 max-w-2xl text-xs leading-6 text-muted-foreground">
              {(error as Error).message ||
                "A API de usuarios nao respondeu dentro do tempo esperado. Tente novamente ou verifique o backend."}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => void refetch()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          </div>
        ) : null}

        {!isLoading && !error && filteredUsers.length === 0 ? (
          <EmptyState
            title="Nenhum usuario encontrado"
            description={
              selectedClientId
                ? "Nao existem usuarios vinculados a empresa selecionada ou os filtros atuais esconderam os resultados."
                : "Ajuste a busca, troque o filtro de categoria ou cadastre um novo usuario."
            }
          />
        ) : null}

        {!isLoading && !error && filteredUsers.length > 0 ? (
          <>
            <div className="flex justify-end">
              <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                {filteredUsers.length} usuarios visiveis
              </Badge>
            </div>

            <div className="rounded-[2rem] border border-border/60 bg-background/50 overflow-hidden shadow-sm">
              <Table>
                <TableHeader className="bg-muted/20">
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead className="w-[40%] font-medium text-foreground py-4 px-6">Usuário</TableHead>
                    <TableHead className="font-medium text-foreground py-4 px-6">Empresa</TableHead>
                    <TableHead className="font-medium text-foreground py-4 px-6">Status</TableHead>
                    <TableHead className="text-right font-medium text-foreground py-4 px-6">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedUsers.map((user) => {
                    const draft = drafts[user.uid] || buildUserDraft(user);
                    const protectedAccount = isProtectedAdmin(user);
                    const tenantName = draft.companyName || summarizeClientAssignments(draft.clientIds, clients);

                    return (
                      <TableRow key={user.uid} className="border-border/60 transition-colors hover:bg-muted/30">
                        <TableCell className="py-4 px-6">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-foreground">{user.displayName || user.email || "Usuário sem nome"}</p>
                            <p className="text-xs text-muted-foreground">{user.email || "Sem e-mail"}</p>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 px-6">
                          <span className="text-sm font-medium text-foreground/80">{tenantName}</span>
                        </TableCell>
                        <TableCell className="py-4 px-6">
                          <div className="flex flex-wrap gap-2">
                            {draft.disabled && <Badge variant="outline" className="text-destructive border-destructive/30 bg-destructive/5">Inativo</Badge>}
                            <Badge className={cn("font-medium", protectedAccount ? "bg-primary/10 text-primary" : ROLE_BADGE_CLASS[draft.role])}>
                              {protectedAccount ? "Admin Protegido" : ROLE_LABELS[draft.role]}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right py-4 px-6">
                          <Button variant="outline" size="sm" className="rounded-xl h-8 px-4 font-medium" onClick={() => onSelectUser(user.uid)}>
                            Configurar
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-3 text-xs text-muted-foreground dark:border-white/10">
              <div className="flex items-center gap-4">
                <span>
                  Mostrando {filteredUsers.length === 0 ? 0 : (safePage - 1) * pageSize + 1}-
                  {Math.min(safePage * pageSize, filteredUsers.length)} de {filteredUsers.length}
                </span>

                <div className="flex items-center gap-1.5">
                  <span>Usuários por página:</span>
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

              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Anterior
                  </Button>
                  <span className="rounded-md border border-slate-200/80 bg-white px-2.5 py-1 font-semibold text-foreground dark:border-white/10 dark:bg-white/[0.04]">
                    {safePage}/{totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Próximo
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
