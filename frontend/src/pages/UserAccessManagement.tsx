import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageShell } from "@/components/PageShell";
import { useAccessProfiles } from "@/hooks/useAccessProfiles";
import { useLeadClients } from "@/hooks/useLeadClients";
import { type AdminUserRecord, useAdminUsers, useSyncAdminUsers } from "@/hooks/useAdminUsers";
import { cn } from "@/lib/utils";
import { ACCESS_PRESET_ORDER, getAccessPresetLabel, USER_MANAGEMENT_PRESETS } from "@/lib/access";
import {
  type ActionFeedbackState,
  type UserDraft,
  FALLBACK_ACCESS_PROFILE_DESCRIPTIONS,
  buildFallbackAccessProfiles,
  buildUserDraft,
  hasDraftChanges,
} from "@/lib/userAccessDraft";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { UsersTable } from "@/components/access/UsersTable";
import { UserCreateDialog } from "@/components/access/UserCreateDialog";
import { UserEditDialog } from "@/components/access/UserEditDialog";

export default function UserAccessManagement() {
  const { accessPreset, isAdminUser } = useAuth();
  const crmClient = useOptionalCrmClient();
  const selectedClientId = crmClient?.selectedClientId || "";
  const canEditUsers = isAdminUser || USER_MANAGEMENT_PRESETS.includes(accessPreset);
  const { data: users = [], isLoading, error, refetch } = useAdminUsers();
  const { data: accessProfiles = [], refetch: refetchAccessProfiles } = useAccessProfiles();
  const { data: clients = [] } = useLeadClients();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [syncingUsers, setSyncingUsers] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedbackState | null>(null);
  const [filteredUsers, setFilteredUsers] = useState<AdminUserRecord[]>([]);
  const syncMutation = useSyncAdminUsers();

  const resolvedAccessProfiles = useMemo(() => {
    const sourceProfiles = accessProfiles.length > 0 ? accessProfiles : buildFallbackAccessProfiles();
    const presetIndex = new Map(ACCESS_PRESET_ORDER.map((key, index) => [key, index]));

    return sourceProfiles
      .map((profile) => ({
        ...profile,
        label: profile.label || getAccessPresetLabel(profile.key),
        description: profile.description ?? FALLBACK_ACCESS_PROFILE_DESCRIPTIONS[profile.key] ?? null,
      }))
      .sort((left, right) => {
      if (left.isSystem !== right.isSystem) {
        return left.isSystem ? -1 : 1;
      }

      if (left.isSystem && right.isSystem) {
        return (presetIndex.get(left.key) ?? 999) - (presetIndex.get(right.key) ?? 999);
      }

      return left.label.localeCompare(right.label, "pt-BR");
      });
  }, [accessProfiles]);

  useEffect(() => {
    setDrafts((current) => {
      if (!users.length) {
        return {};
      }

      const next: Record<string, UserDraft> = {};
      for (const user of users) {
        const existingDraft = current[user.uid];
        next[user.uid] =
          existingDraft && hasDraftChanges(user, existingDraft) ? existingDraft : buildUserDraft(user);
      }
      return next;
    });
  }, [users]);

  useEffect(() => {
    if (selectedUserId && !users.some((user) => user.uid === selectedUserId)) {
      setSelectedUserId(null);
    }
  }, [users, selectedUserId]);

  const showActionFeedback = ({ tone, title, message, details }: ActionFeedbackState) => {
    setActionFeedback({ tone, title, message, details: details || null });
  };

  const clearActionFeedback = () => {
    setActionFeedback(null);
  };

  const syncFirebaseUsers = async () => {
    if (!canEditUsers) return;

    setSyncingUsers(true);
    clearActionFeedback();

    try {
      const body = await syncMutation.mutateAsync();

      showActionFeedback({
        tone: "success",
        title: "Usuarios sincronizados",
        message: `${body.syncedCount || 0} usuarios foram normalizados com claims de acesso. ${body.skippedCount || 0} ja estavam sincronizados.`,
      });
    } catch (err) {
      showActionFeedback({
        tone: "error",
        title: "Nao foi possivel sincronizar",
        message: err instanceof Error ? err.message : "Nao foi possivel sincronizar os usuarios do Firebase Auth.",
      });
    } finally {
      setSyncingUsers(false);
    }
  };

  return (
    <PageShell
      title="Usuarios e Acessos"
      subtitle="Cadastro e associacao por tipo, empresa e paginas liberadas."
      spacing="space-y-6"
      compactHero
      showGlobalClientSelector
      headerRight={
        <div className="flex flex-wrap items-center gap-2">
          {canEditUsers && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={syncFirebaseUsers}
                disabled={syncingUsers}
                className="h-9 rounded-lg"
              >
                <RefreshCw className={cn("h-4 w-4", syncingUsers && "animate-spin")} />
                {syncingUsers ? "Sincronizando..." : "Sincronizar Auth"}
              </Button>
              <UserCreateDialog
                clients={clients}
                selectedClientId={selectedClientId}
                accessProfiles={resolvedAccessProfiles}
                isAdminUser={isAdminUser}
                canEditUsers={canEditUsers}
                onFeedback={showActionFeedback}
                onClearFeedback={clearActionFeedback}
              />
            </>
          )}
        </div>
      }
    >
      {!canEditUsers && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
          Seu acesso esta em modo leitura. Apenas gestores podem criar usuarios, liberar cadastros e alterar permissoes.
        </div>
      )}
      <Dialog open={Boolean(actionFeedback)} onOpenChange={(open) => (!open ? clearActionFeedback() : null)}>
        <DialogContent className="max-w-md rounded-3xl border-border/80 bg-background/95">
          <DialogHeader className="space-y-3 text-left">
            <div
              className={cn(
                "inline-flex w-fit rounded-full px-3 py-1 text-xs font-medium",
                actionFeedback?.tone === "error"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-emerald-500/10 text-emerald-600"
              )}
            >
              {actionFeedback?.tone === "error" ? "Falha na acao" : "Acao concluida"}
            </div>
            <DialogTitle>{actionFeedback?.title}</DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">
              {actionFeedback?.message}
            </DialogDescription>
            {actionFeedback?.details ? (
              <div className="rounded-2xl border border-border/80 bg-background/60 px-4 py-3 text-xs leading-5 text-muted-foreground break-all">
                {actionFeedback.details}
              </div>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button onClick={clearActionFeedback}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UsersTable
        users={users}
        drafts={drafts}
        clients={clients}
        selectedClientId={selectedClientId}
        isLoading={isLoading}
        error={error}
        refetch={refetch}
        onSelectUser={setSelectedUserId}
        onFilteredUsersChange={setFilteredUsers}
      />

      <UserEditDialog
        selectedUserId={selectedUserId}
        onClose={() => setSelectedUserId(null)}
        users={users}
        drafts={drafts}
        setDrafts={setDrafts}
        clients={clients}
        selectedClientId={selectedClientId}
        accessProfiles={resolvedAccessProfiles}
        canEditUsers={canEditUsers}
        filteredUsers={filteredUsers}
        onFeedback={showActionFeedback}
        onClearFeedback={clearActionFeedback}
      />
    </PageShell>
  );
}
