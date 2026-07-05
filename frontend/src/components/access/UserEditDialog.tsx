import { useState } from "react";
import { AlertTriangle, LockKeyhole, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { type AdminUserRecord, useDeleteAdminUser, useSaveAdminUserAccess } from "@/hooks/useAdminUsers";
import { type AccessProfileRecord } from "@/hooks/useAccessProfiles";
import { type LeadClient } from "@/hooks/useLeadClients";
import { isFixedAdminAccount, type AccessView, type InternalPage } from "@/lib/access";
import {
  type ActionFeedbackState,
  type UserDraft,
  ROLE_BADGE_CLASS,
  ROLE_LABELS,
  INTERNAL_SHORTCUTS,
  applyAccessProfileToDraft,
  buildInternalShortcutPatch,
  buildPayload,
  buildUserDraft,
  findAccessProfile,
  formatDate,
  hasDraftChanges,
  hasInternalShortcutAccess,
  isProtectedAdmin,
  normalizeDraft,
  transitionDraft,
  validateDraft,
} from "@/lib/userAccessDraft";
import { prepareDraftForPersistence } from "@/components/access/AccessGovernance";
import { AccessGovernance } from "@/components/access/AccessGovernance";
import { AccessPagesTabs } from "@/components/access/AccessPagesTabs";

interface UserEditDialogProps {
  selectedUserId: string | null;
  onClose: () => void;
  users: AdminUserRecord[];
  drafts: Record<string, UserDraft>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, UserDraft>>>;
  clients: LeadClient[];
  selectedClientId: string;
  accessProfiles: AccessProfileRecord[];
  canEditUsers: boolean;
  filteredUsers: AdminUserRecord[];
  onFeedback: (state: ActionFeedbackState) => void;
  onClearFeedback: () => void;
}

export function UserEditDialog({
  selectedUserId,
  onClose,
  users,
  drafts,
  setDrafts,
  clients,
  selectedClientId,
  accessProfiles,
  canEditUsers,
  filteredUsers,
  onFeedback,
  onClearFeedback,
}: UserEditDialogProps) {
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const saveMutation = useSaveAdminUserAccess();
  const deleteMutation = useDeleteAdminUser();

  const selectedUser = users.find((user) => user.uid === selectedUserId) || null;
  const selectedDraft = selectedUser ? drafts[selectedUser.uid] || buildUserDraft(selectedUser) : null;

  const selectedProtectedAccount = selectedUser ? isProtectedAdmin(selectedUser) : false;
  const selectedEditable = Boolean(selectedUser && canEditUsers && !selectedProtectedAccount);
  const selectedHasChanges = selectedUser && selectedDraft ? hasDraftChanges(selectedUser, selectedDraft) : false;
  const selectedActivationReady = Boolean(
    selectedUser &&
      selectedDraft &&
      selectedUser.access.role === "pending" &&
      selectedDraft.role !== "pending"
  );
  const selectedHiddenByFilter = Boolean(
    selectedUser && selectedDraft && !filteredUsers.some((user) => user.uid === selectedUser.uid)
  );

  const updateDraft = (uid: string, patch: Partial<UserDraft>) => {
    setDrafts((current) => {
      const sourceUser = users.find((user) => user.uid === uid);
      if (!sourceUser) {
        return current;
      }

      const merged = {
        ...(current[uid] || buildUserDraft(sourceUser)),
        ...patch,
      };

      const next = patch.role || patch.accessPreset ? transitionDraft(merged) : normalizeDraft(merged);
      return {
        ...current,
        [uid]: next,
      };
    });
  };

  const saveUser = async (user: AdminUserRecord) => {
    if (!canEditUsers) return;

    const draft = drafts[user.uid];
    if (!draft) return;

    const preparedDraft = prepareDraftForPersistence(draft, clients, selectedClientId);
    const validationError = validateDraft(preparedDraft);
    if (validationError) {
      onFeedback({
        tone: "error",
        title: "Nao foi possivel salvar",
        message: validationError,
      });
      return;
    }

    setSavingUid(user.uid);
    onClearFeedback();

    try {
      const payload = buildPayload(preparedDraft);
      const item = await saveMutation.mutateAsync({ uid: user.uid, payload });

      onFeedback({
        tone: "success",
        title: user.access.role === "pending" && draft.role !== "pending" ? "Usuario ativado" : "Acessos atualizados",
        message:
          user.access.role === "pending" && draft.role !== "pending"
            ? `${user.email || user.uid} foi liberado(a) com sucesso e ja pode acessar os modulos selecionados.`
            : `As alteracoes de ${user.email || user.uid} foram salvas com sucesso.`,
      });
      setDrafts((current) => ({
        ...current,
        [user.uid]: buildUserDraft(item || user),
      }));
    } catch (err) {
      onFeedback({
        tone: "error",
        title: "Nao foi possivel salvar",
        message: err instanceof Error ? err.message : "Nao foi possivel salvar este usuario.",
      });
    } finally {
      setSavingUid(null);
    }
  };

  const deleteUser = async (user: AdminUserRecord) => {
    if (!canEditUsers || isProtectedAdmin(user)) return;

    const label = user.displayName || user.email || user.uid;
    const confirmMessage = selectedHasChanges
      ? `Apagar ${label}? As alteracoes nao salvas tambem serao perdidas.`
      : `Apagar ${label}? Essa acao nao pode ser desfeita.`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setDeletingUid(user.uid);
    onClearFeedback();

    try {
      await deleteMutation.mutateAsync(user.uid);

      onFeedback({
        tone: "success",
        title: "Usuario apagado",
        message: `O usuario ${user.email || user.uid} foi apagado com sucesso.`,
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[user.uid];
        return next;
      });
      onClose();
    } catch (err) {
      onFeedback({
        tone: "error",
        title: "Nao foi possivel apagar o usuario",
        message: err instanceof Error ? err.message : "Nao foi possivel apagar este usuario.",
      });
    } finally {
      setDeletingUid(null);
    }
  };

  return (
    <Dialog open={!!selectedUserId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-4xl flex flex-col p-0 border-border/60 shadow-2xl bg-background/95 backdrop-blur-xl sm:rounded-[2.5rem] overflow-hidden">
        {selectedUser && selectedDraft ? (
          <div className="flex flex-col h-full min-h-0 flex-1">
            <DialogHeader className="px-8 pb-6 pt-8 border-b border-border/40 bg-muted/10 shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <DialogTitle className="text-2xl font-bold tracking-tight">
                    {selectedUser.displayName || selectedUser.email || "Usuário sem nome"}
                  </DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground flex items-center gap-2">
                    {selectedUser.email || "Sem e-mail"}
                    <span>•</span>
                    Criado em {formatDate(selectedUser.createdAt)}
                  </DialogDescription>
                </div>
                <div className="flex items-center gap-2">
                  {selectedProtectedAccount ? (
                    <Badge className="gap-1 bg-primary/10 text-primary px-3 py-1 text-sm rounded-xl">
                      <LockKeyhole className="h-4 w-4" />
                      Admin protegido
                    </Badge>
                  ) : (
                    <Badge className={cn("px-3 py-1 text-sm rounded-xl", ROLE_BADGE_CLASS[selectedDraft.role])}>
                      {ROLE_LABELS[selectedDraft.role]}
                    </Badge>
                  )}
                </div>
              </div>

              {selectedHasChanges && (
                 <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
                   <AlertTriangle className="h-4 w-4" />
                   Você tem alterações não salvas neste perfil.
                 </div>
              )}
            </DialogHeader>

            <Tabs defaultValue="geral" className="flex flex-col flex-1 min-h-0">
              {selectedDraft.role !== "pending" && (
                <div className="px-8 border-b border-border/40 bg-muted/5 shrink-0">
                  <TabsList className="flex gap-2 bg-transparent p-0 h-12 border-b-0">
                    <TabsTrigger value="geral" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-full font-bold text-sm">
                      Geral
                    </TabsTrigger>
                    <TabsTrigger value="permissoes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-full font-bold text-sm">
                      Permissões & Módulos
                    </TabsTrigger>
                    <TabsTrigger value="acoes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-full font-bold text-sm text-destructive data-[state=active]:border-destructive">
                      Zona de Perigo
                    </TabsTrigger>
                  </TabsList>
                </div>
              )}

              <div className="flex-1 overflow-y-auto min-h-0 p-8 space-y-6">
                {selectedHiddenByFilter ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
                    O usuario selecionado nao aparece na lista atual por causa da busca ou do filtro ativo.
                  </div>
                ) : null}

                {selectedActivationReady ? (
                  <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary font-medium">
                    O cadastro ja esta pronto para liberacao. Revise os acessos, depois clique em Ativar usuario no rodapé.
                  </div>
                ) : null}

                {selectedDraft.role === "pending" ? (
                  <AccessGovernance
                    draft={selectedDraft}
                    accessProfiles={accessProfiles}
                    clients={clients}
                    selectedClientId={selectedClientId}
                    editable={selectedEditable}
                    onChange={(patch) => updateDraft(selectedUser.uid, patch)}
                  />
                ) : (
                  <>
                    <TabsContent value="geral" className="space-y-6 mt-0 outline-none">
                      <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Perfil de Acesso Principal</label>
                          <Select
                            value={selectedDraft.accessPreset}
                            disabled={!selectedEditable}
                            onValueChange={(value) => {
                              const profile = findAccessProfile(accessProfiles, value);
                              updateDraft(selectedUser.uid, applyAccessProfileToDraft({ ...selectedDraft, accessPreset: value }, profile));
                            }}
                          >
                            <SelectTrigger className="h-12 rounded-xl bg-muted/10 border-border/60 hover:bg-muted/20 text-base px-4">
                              <SelectValue placeholder="Selecionar perfil de acesso">
                                {selectedDraft.accessPreset ? findAccessProfile(accessProfiles, selectedDraft.accessPreset)?.label : undefined}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                              {accessProfiles.filter(p => p.role !== "pending").map((profile) => (
                                <SelectItem
                                  key={profile.key}
                                  value={profile.key}
                                  className="py-3 items-start"
                                >
                                  <div className="flex flex-col gap-1 pr-2 max-w-[280px]">
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-sm leading-none">{profile.label}</span>
                                      <Badge variant="outline" className="text-[10px] uppercase">{ROLE_LABELS[profile.role]}</Badge>
                                    </div>
                                    {profile.description && (
                                      <span className="text-[11px] text-muted-foreground whitespace-normal leading-snug">
                                        {profile.description}
                                      </span>
                                    )}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Empresa / Tenant Vinculado</label>
                          <Select
                            value={selectedDraft.clientIds[0] || "__none"}
                            disabled={!canEditUsers}
                            onValueChange={(value) => {
                              const selectedClient = clients.find((client) => client.id === value);
                              updateDraft(selectedUser.uid, {
                                clientIds: value === "__none" ? [] : [value],
                                companyName: value === "__none" ? "" : selectedClient?.name || "",
                              });
                            }}
                          >
                            <SelectTrigger className="h-12 rounded-xl bg-muted/10 border-border/60 hover:bg-muted/20 text-base px-4">
                              <SelectValue placeholder="Selecionar empresa" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                              <SelectItem value="__none" className="py-2.5 font-medium text-muted-foreground">
                                {selectedDraft.role === "client" ? "Selecionar empresa (Obrigatório)" : "Sem vínculo específico (Global)"}
                              </SelectItem>
                              {clients.map((client) => (
                                <SelectItem key={client.id} value={client.id} className="py-2.5">
                                  <span className="font-medium">{client.name}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Nome de Exibição da Empresa (Opcional)</label>
                        <Input
                          value={selectedDraft.companyName}
                          disabled={!canEditUsers}
                          onChange={(event) => updateDraft(selectedUser.uid, { companyName: event.target.value })}
                          placeholder="Ex: Vexo CRM"
                          className="h-12 rounded-xl bg-muted/10 border-border/60 hover:bg-muted/20 text-base px-4"
                        />
                        <p className="text-xs text-muted-foreground pl-1">Se preenchido, substitui o nome padrão da empresa na interface deste usuário.</p>
                      </div>

                      <div className="rounded-2xl border border-border/60 bg-muted/5 p-4 flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <p className="font-semibold text-sm text-foreground">Status do Acesso</p>
                          <p className="text-xs text-muted-foreground">Desative temporariamente ou reative o login deste usuário no CRM.</p>
                        </div>
                        <Switch
                          checked={!selectedDraft.disabled}
                          disabled={!canEditUsers || isFixedAdminAccount(selectedUser.uid, selectedUser.email)}
                          onCheckedChange={(checked) => updateDraft(selectedUser.uid, { disabled: !checked })}
                          className="scale-90 data-[state=checked]:bg-primary"
                        />
                      </div>
                    </TabsContent>

                    <TabsContent value="permissoes" className="space-y-6 mt-0 outline-none">
                      {selectedProtectedAccount && (
                        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-primary font-medium flex items-center gap-2">
                          <LockKeyhole className="h-4 w-4 shrink-0" />
                          Esta é uma conta de Administrador. As permissões e atalhos são fixos do sistema para garantir o acesso.
                        </div>
                      )}

                      {selectedDraft.role === "internal" && (
                        <div className="space-y-3">
                          <h4 className="text-sm font-bold text-foreground">Acessos Rápidos (Administração)</h4>
                          <div className="space-y-2">
                            {INTERNAL_SHORTCUTS.map((shortcut) => {
                              const enabled = hasInternalShortcutAccess(selectedDraft, shortcut.key);
                              const ShortcutIcon = shortcut.icon;

                              return (
                                <div
                                  key={shortcut.key}
                                  className="flex items-center justify-between py-3 px-4 rounded-xl border border-border/40 bg-muted/5 transition-colors"
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <ShortcutIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                                    <div className="space-y-0.5 min-w-0">
                                      <p className="font-semibold text-sm text-foreground">{shortcut.title}</p>
                                      <p className="text-xs text-muted-foreground truncate max-w-[400px]">{shortcut.description}</p>
                                    </div>
                                  </div>
                                  <Switch
                                    checked={enabled}
                                    disabled={!selectedEditable}
                                    onCheckedChange={(checked) => updateDraft(selectedUser.uid, buildInternalShortcutPatch(selectedDraft, shortcut.key, checked))}
                                    className="scale-90 data-[state=checked]:bg-primary"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="pt-4 border-t border-border/40 space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-bold text-foreground">Permissões Detalhadas de Módulos</h4>
                          <Badge variant="outline" className="font-medium bg-muted/20 text-[10px]">Configuração Avançada</Badge>
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-muted/5 p-1 overflow-hidden">
                          <AccessPagesTabs
                            role={selectedDraft.role}
                            selected={selectedDraft.role === "client" ? selectedDraft.allowedViews : selectedDraft.internalPages}
                            disabled={!selectedEditable}
                            onChange={(next) =>
                              selectedDraft.role === "client"
                                ? updateDraft(selectedUser.uid, { allowedViews: next as AccessView[] })
                                : updateDraft(selectedUser.uid, { internalPages: next as InternalPage[] })
                            }
                          />
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="acoes" className="space-y-6 mt-0 outline-none">
                      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 space-y-5">
                        <div className="space-y-1">
                          <h4 className="text-sm font-bold text-destructive flex items-center gap-2">
                            <AlertTriangle className="h-4.5 w-4.5 animate-bounce" />
                            Zona de Perigo
                          </h4>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            Apagar a conta deletará todas as credenciais e permissões vinculadas do usuário permanentemente. Essa ação é irreversível.
                          </p>
                        </div>

                        <Button
                          variant="destructive"
                          className="rounded-xl font-semibold"
                          onClick={() => deleteUser(selectedUser)}
                          disabled={!canEditUsers || isFixedAdminAccount(selectedUser.uid, selectedUser.email) || savingUid === selectedUser.uid || deletingUid === selectedUser.uid}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {deletingUid === selectedUser.uid ? "Apagando..." : "Apagar conta permanentemente"}
                        </Button>
                      </div>
                    </TabsContent>
                  </>
                )}
              </div>
            </Tabs>

            <DialogFooter className="px-8 py-5 border-t border-border/40 bg-muted/5 flex gap-3 justify-end shrink-0">
              <Button
                variant="outline"
                className="rounded-xl font-semibold"
                onClick={() => updateDraft(selectedUser.uid, buildUserDraft(selectedUser))}
                disabled={!canEditUsers || savingUid === selectedUser.uid || deletingUid === selectedUser.uid || !selectedHasChanges}
              >
                Descartar alterações
              </Button>
              <Button
                className="rounded-xl font-semibold shadow-md"
                onClick={() => saveUser(selectedUser)}
                disabled={!canEditUsers || savingUid === selectedUser.uid || deletingUid === selectedUser.uid}
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                {savingUid === selectedUser.uid
                  ? selectedActivationReady
                    ? "Ativando..."
                    : "Salvando..."
                  : selectedActivationReady
                    ? "Ativar usuario"
                    : "Salvar acessos"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground">Carregando...</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
