import { useEffect, useState } from "react";
import { Plus, UserRound } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type AccessProfileRecord } from "@/hooks/useAccessProfiles";
import { type LeadClient } from "@/hooks/useLeadClients";
import { useCreateAdminUser } from "@/hooks/useAdminUsers";
import { type AccessView, type InternalPage } from "@/lib/access";
import {
  type ActionFeedbackState,
  type CreateUserDraft,
  applyAccessProfileToDraft,
  buildCreateDraft,
  buildPayload,
  findAccessProfile,
  normalizeCreateDraftForSimpleForm,
  validateDraft,
} from "@/lib/userAccessDraft";
import { prepareDraftForPersistence } from "@/components/access/AccessGovernance";
import { AccessPagesTabs } from "@/components/access/AccessPagesTabs";

interface UserCreateDialogProps {
  clients: LeadClient[];
  selectedClientId: string;
  accessProfiles: AccessProfileRecord[];
  isAdminUser: boolean;
  canEditUsers: boolean;
  onFeedback: (state: ActionFeedbackState) => void;
  onClearFeedback: () => void;
}

export function UserCreateDialog({
  clients,
  selectedClientId,
  accessProfiles,
  isAdminUser,
  canEditUsers,
  onFeedback,
  onClearFeedback,
}: UserCreateDialogProps) {
  const [createDraft, setCreateDraft] = useState<CreateUserDraft>(() => buildCreateDraft());
  const [creating, setCreating] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const createMutation = useCreateAdminUser();

  useEffect(() => {
    if (!selectedClientId || clients.length === 0) {
      return;
    }

    const selectedClient = clients.find((client) => client.id === selectedClientId);
    if (!selectedClient) {
      return;
    }

    setCreateDraft((current) => {
      if (current.clientIds.length > 0 || current.companyName.trim()) {
        return current;
      }

      return normalizeCreateDraftForSimpleForm({
        ...current,
        clientIds: [selectedClient.id],
        companyName: selectedClient.name,
      });
    });
  }, [clients, selectedClientId]);

  const updateCreateDraft = (patch: Partial<CreateUserDraft>) => {
    setCreateDraft((current) => {
      return normalizeCreateDraftForSimpleForm({
        ...current,
        ...patch,
      });
    });
  };

  const createUser = async () => {
    if (!canEditUsers) return;

    const preparedDraft = prepareDraftForPersistence(
      normalizeCreateDraftForSimpleForm(createDraft),
      clients,
      selectedClientId
    );
    const validationError = validateDraft(preparedDraft);
    if (validationError) {
      onFeedback({
        tone: "error",
        title: "Nao foi possivel criar o usuario",
        message: validationError,
      });
      return;
    }

    setCreating(true);
    onClearFeedback();

    try {
      const payload = {
        ...buildPayload(preparedDraft),
        email: preparedDraft.email.trim().toLowerCase(),
        password: preparedDraft.password,
        displayName: preparedDraft.displayName.trim() || undefined,
        sendPasswordReset: preparedDraft.sendPasswordReset,
      };

      const body = await createMutation.mutateAsync(payload);

      onFeedback({
        tone: "success",
        title: body.syncedExisting ? "Usuario sincronizado" : "Usuario criado",
        message: body.syncedExisting
          ? `O usuario ${body.item?.email || payload.email} ja existia no Firebase Auth e teve o acesso sincronizado.`
          : `O usuario ${body.item?.email || payload.email} foi criado com sucesso.`,
        details: body.passwordResetLink ? `Link de redefinicao: ${body.passwordResetLink}` : null,
      });
      setCreateDraft(buildCreateDraft());
      setCreateDialogOpen(false);
    } catch (err) {
      onFeedback({
        tone: "error",
        title: "Nao foi possivel criar o usuario",
        message: err instanceof Error ? err.message : "Nao foi possivel criar este usuario.",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={createDialogOpen}
      onOpenChange={(open) => {
        setCreateDialogOpen(open);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="h-9 rounded-lg">
          <Plus className="h-4 w-4" />
          Novo usuario
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-4xl flex flex-col p-0 border-border/60 shadow-2xl bg-background/95 backdrop-blur-xl sm:rounded-[2.5rem] overflow-hidden">
        <DialogHeader className="px-8 pb-6 pt-8 border-b border-border/40 bg-muted/10 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <DialogTitle className="text-2xl font-bold tracking-tight">Novo usuário</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Defina as credenciais básicas, selecione o perfil inicial e configure as permissões.
              </DialogDescription>
            </div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
              <UserRound className="h-5 w-5" />
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="cadastro" className="flex flex-col flex-1 min-h-0">
          {createDraft.role !== "pending" && (
            <div className="px-8 border-b border-border/40 bg-muted/5 shrink-0">
              <TabsList className="flex gap-2 bg-transparent p-0 h-12 border-b-0">
                <TabsTrigger value="cadastro" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-full font-bold text-sm">
                  Cadastro & Dados
                </TabsTrigger>
                <TabsTrigger value="permissoes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-full font-bold text-sm">
                  Permissões Iniciais
                </TabsTrigger>
              </TabsList>
            </div>
          )}

          <div className="flex-1 overflow-y-auto min-h-0 p-8 space-y-6">
            <TabsContent value="cadastro" className="space-y-6 mt-0 outline-none">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">E-mail</label>
                  <Input
                    value={createDraft.email}
                    onChange={(event) => updateCreateDraft({ email: event.target.value })}
                    placeholder="E-mail do usuario"
                    type="email"
                    className="h-12 rounded-xl bg-muted/10 border-border/60 focus-visible:ring-primary/20"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Senha Inicial</label>
                  <Input
                    value={createDraft.password}
                    onChange={(event) => updateCreateDraft({ password: event.target.value })}
                    placeholder="Senha inicial"
                    type="password"
                    className="h-12 rounded-xl bg-muted/10 border-border/60 focus-visible:ring-primary/20"
                  />
                </div>
                <div className="sm:col-span-2 space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Nome de Exibição</label>
                  <Input
                    value={createDraft.displayName}
                    onChange={(event) => updateCreateDraft({ displayName: event.target.value })}
                    placeholder="Nome completo ou alcunha"
                    className="h-12 rounded-xl bg-muted/10 border-border/60 focus-visible:ring-primary/20"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Tipo de Usuário</label>
                  <Select
                    value={createDraft.accessPreset}
                    onValueChange={(value) => {
                      const profile = findAccessProfile(accessProfiles, value);
                      setCreateDraft((current) =>
                        normalizeCreateDraftForSimpleForm(
                          applyAccessProfileToDraft(
                            {
                              ...current,
                              accessPreset: value,
                            },
                            profile
                          )
                        )
                      );
                    }}
                  >
                    <SelectTrigger className="h-12 rounded-xl bg-muted/10 border-border/60 hover:bg-muted/20">
                      <SelectValue placeholder="Tipo de usuario">
                        {createDraft.accessPreset ? findAccessProfile(accessProfiles, createDraft.accessPreset)?.label : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {accessProfiles
                        .filter((profile) => {
                          if (profile.key === "pending") return false;
                          if (profile.key === "admin_vexo") return false;
                          if (isAdminUser) return true;
                          return profile.key === "operador";
                        })
                        .map((profile) => (
                          <SelectItem
                            key={profile.key}
                            value={profile.key}
                            className="py-3 items-start"
                            data-testid={`profile-option-${profile.key}`}
                          >
                            <div className="flex flex-col gap-1 pr-2 max-w-[280px]">
                              <span className="font-semibold text-sm leading-none">{profile.label}</span>
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
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Empresa / Tenant</label>
                  <Select
                    value={createDraft.clientIds[0] || "__none"}
                    onValueChange={(value) => {
                      const selectedClient = clients.find((client) => client.id === value);
                      updateCreateDraft({
                        clientIds: value === "__none" ? [] : [value],
                        companyName: value === "__none" ? "" : selectedClient?.name || "",
                      });
                    }}
                  >
                    <SelectTrigger className="h-12 rounded-xl bg-muted/10 border-border/60 hover:bg-muted/20">
                      <SelectValue placeholder="Empresa / tenant" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="__none" className="py-2.5">
                        {createDraft.role === "client" ? "Selecionar empresa" : "Sem empresa vinculada"}
                      </SelectItem>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id} className="py-2.5">
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>


              <div className="rounded-2xl border border-border/60 bg-muted/5 p-4">
                <label className="flex items-center gap-3 text-sm text-foreground font-semibold cursor-pointer">
                  <Checkbox
                    checked={createDraft.sendPasswordReset}
                    onCheckedChange={(checked) => updateCreateDraft({ sendPasswordReset: checked === true })}
                  />
                  Enviar e-mail de redefinicao de senha apos o cadastro
                </label>
              </div>

              {createDraft.role === "pending" && (
                <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
                  Usuario pendente nao recebe paginas, views nem permissoes operacionais ate a aprovacao.
                </div>
              )}
            </TabsContent>

            {createDraft.role !== "pending" && (
              <TabsContent value="permissoes" className="space-y-6 mt-0 outline-none">
                <div className="rounded-[2rem] border border-border/60 bg-muted/5 p-2 overflow-hidden">
                  <AccessPagesTabs
                    role={createDraft.role}
                    selected={createDraft.role === "client" ? createDraft.allowedViews : createDraft.internalPages}
                    disabled={!canEditUsers}
                    onChange={(next) =>
                      createDraft.role === "client"
                        ? updateCreateDraft({ allowedViews: next as AccessView[] })
                        : updateCreateDraft({ internalPages: next as InternalPage[] })
                    }
                  />
                </div>
              </TabsContent>
            )}
          </div>
        </Tabs>

        <DialogFooter className="px-8 py-5 border-t border-border/40 bg-muted/5 flex gap-3 justify-end shrink-0">
          <Button variant="outline" type="button" className="rounded-xl font-semibold" onClick={() => setCreateDialogOpen(false)}>
            Cancelar
          </Button>
          <Button className="rounded-xl font-semibold" onClick={createUser} disabled={creating}>
            <UserRound className="h-4 w-4 mr-2" />
            {creating ? "Criando..." : "Criar usuario"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
