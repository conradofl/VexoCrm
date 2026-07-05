import { useMemo } from "react";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { type AccessProfileRecord } from "@/hooks/useAccessProfiles";
import { type LeadClient } from "@/hooks/useLeadClients";
import { type AccessView, type InternalPage } from "@/lib/access";
import {
  type AccessDraft,
  ROLE_BADGE_CLASS,
  ROLE_LABELS,
  INTERNAL_SHORTCUTS,
  applyAccessProfileToDraft,
  applySimpleAccessModel,
  buildInternalShortcutPatch,
  findAccessProfile,
  hasInternalShortcutAccess,
} from "@/lib/userAccessDraft";
import { AccessPagesTabs } from "@/components/access/AccessPagesTabs";

interface AccessGovernanceProps {
  draft: AccessDraft;
  accessProfiles: AccessProfileRecord[];
  clients: LeadClient[];
  selectedClientId: string;
  editable: boolean;
  onChange: (patch: Partial<AccessDraft>) => void;
}

export function resolveDraftClientBinding(draft: AccessDraft, clients: LeadClient[], selectedClientId: string) {
  if (draft.clientIds.length > 0) {
    const currentId = draft.clientIds[0];
    const currentClient = clients.find((client) => client.id === currentId);

    return {
      clientIds: [currentId],
      companyName: draft.companyName || currentClient?.name || "",
    };
  }

  if (selectedClientId) {
    const selectedClient = clients.find((client) => client.id === selectedClientId);
    if (selectedClient) {
      return {
        clientIds: [selectedClient.id],
        companyName: draft.companyName || selectedClient.name,
      };
    }
  }

  const normalizedCompany = draft.companyName.trim().toLowerCase();
  if (normalizedCompany) {
    const matchedClient = clients.find((client) => client.name.trim().toLowerCase() === normalizedCompany);
    if (matchedClient) {
      return {
        clientIds: [matchedClient.id],
        companyName: draft.companyName || matchedClient.name,
      };
    }
  }

  return {
    clientIds: [],
    companyName: draft.companyName,
  };
}

export function prepareDraftForPersistence<T extends AccessDraft>(
  draft: T,
  clients: LeadClient[],
  selectedClientId: string
): T {
  const normalized = applySimpleAccessModel(draft);
  if (normalized.role === "pending" || normalized.clientIds.length > 0) {
    return normalized;
  }

  const binding = resolveDraftClientBinding(normalized, clients, selectedClientId);
  if (binding.clientIds.length === 0) {
    return normalized;
  }

  return applySimpleAccessModel({
    ...normalized,
    clientIds: binding.clientIds,
    companyName: binding.companyName,
  }) as T;
}

export function AccessGovernance({ draft, accessProfiles, clients, selectedClientId, editable, onChange }: AccessGovernanceProps) {
  const normalized = applySimpleAccessModel(draft);
  const matrixDisabled = !editable || normalized.role === "pending";
  const applyPatch = (patch: Partial<AccessDraft>) => onChange(applySimpleAccessModel({ ...normalized, ...patch }));
  const selectedType = findAccessProfile(accessProfiles, normalized.accessPreset);
  const approvalProfiles = useMemo(
    () => accessProfiles.filter((profile) => profile.role !== "pending"),
    [accessProfiles]
  );
  const internalApprovalProfile = approvalProfiles.find((profile) => profile.role === "internal") || null;
  const clientApprovalProfile = approvalProfiles.find((profile) => profile.role === "client") || null;
  const applyApprovalProfile = (profileKey: string) => {
    const profile = findAccessProfile(accessProfiles, profileKey);
    if (!profile) return;
    const binding = resolveDraftClientBinding(normalized, clients, selectedClientId);

    onChange(
      applyAccessProfileToDraft(
        {
          ...normalized,
          accessPreset: profileKey,
          clientIds: binding.clientIds,
          companyName: binding.companyName,
        },
        profile
      )
    );
  };
  const resolvedBinding = resolveDraftClientBinding(normalized, clients, selectedClientId);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">

      {normalized.role === "pending" ? (
        <div className="rounded-[2rem] border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-amber-500/5 p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <ShieldCheck className="w-32 h-32 text-amber-500" />
          </div>
          <div className="relative z-10">
            <h3 className="text-xl font-bold text-amber-600 mb-2">Liberação de Acesso</h3>
            <p className="text-sm text-amber-700/80 max-w-[60%] mb-8 leading-relaxed">
              Este usuário solicitou acesso, mas precisa da sua aprovação. Defina como ele irá operar no CRM para destravar os módulos do sistema.
            </p>

            <div className="space-y-4">
              <p className="text-sm font-semibold text-amber-800">Selecione o perfil de liberação:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {approvalProfiles.map((profile) => (
                  <button
                    key={profile.key}
                    type="button"
                    disabled={!editable}
                    onClick={() => applyApprovalProfile(profile.key)}
                    className={cn(
                      "text-left p-5 rounded-2xl border transition-all duration-200 group",
                      normalized.accessPreset === profile.key
                        ? "border-amber-500 bg-amber-500/10 shadow-sm"
                        : "border-amber-500/20 bg-background/50 hover:bg-amber-500/5 hover:border-amber-500/40"
                    )}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-bold text-amber-900">{profile.label}</span>
                      <Badge className={ROLE_BADGE_CLASS[profile.role]}>{ROLE_LABELS[profile.role]}</Badge>
                    </div>
                    {profile.description && (
                      <p className="text-xs text-amber-800/70 leading-5">{profile.description}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <label className="text-sm font-bold text-foreground flex items-center gap-2">
                Perfil de Acesso Principal
              </label>
              <Select
                value={normalized.accessPreset}
                disabled={!editable}
                onValueChange={(value) => {
                  const profile = findAccessProfile(accessProfiles, value);
                  onChange(applyAccessProfileToDraft({ ...normalized, accessPreset: value }, profile));
                }}
              >
                <SelectTrigger className="h-14 rounded-2xl bg-muted/10 border-border/60 hover:bg-muted/20 transition-colors text-base px-4">
                  <SelectValue placeholder="Selecionar perfil de acesso" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {accessProfiles.filter(p => p.role !== "pending").map((profile) => (
                    <SelectItem key={profile.key} value={profile.key} className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{profile.label}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">{ROLE_LABELS[profile.role]}</Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedType?.description && (
                <p className="text-xs text-muted-foreground leading-relaxed pl-1">{selectedType.description}</p>
              )}
            </div>

            <div className="space-y-3">
              <label className="text-sm font-bold text-foreground">Empresa / Tenant Vinculado</label>
              <Select
                value={normalized.clientIds[0] || resolvedBinding.clientIds[0] || "__none"}
                disabled={!editable}
                onValueChange={(value) => {
                  const selectedClient = clients.find((client) => client.id === value);
                  applyPatch({
                    clientIds: value === "__none" ? [] : [value],
                    companyName: value === "__none" ? "" : selectedClient?.name || "",
                  });
                }}
              >
                <SelectTrigger className="h-14 rounded-2xl bg-muted/10 border-border/60 hover:bg-muted/20 transition-colors text-base px-4">
                  <SelectValue placeholder="Selecionar empresa" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="__none" className="py-3 font-medium text-muted-foreground">
                    {normalized.role === "client" ? "Selecionar empresa (Obrigatório)" : "Sem vínculo específico (Global)"}
                  </SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id} className="py-3">
                      <span className="font-medium">{client.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-bold text-foreground">Nome de Exibição da Empresa (Opcional)</label>
            <Input
              value={normalized.companyName}
              disabled={!editable}
              onChange={(event) => applyPatch({ companyName: event.target.value })}
              placeholder="Ex: Vexo CRM"
              className="h-14 rounded-2xl bg-muted/10 border-border/60 hover:bg-muted/20 transition-colors text-base px-4"
            />
            <p className="text-xs text-muted-foreground pl-1">Se preenchido, substitui o nome padrão da empresa na interface deste usuário.</p>
          </div>
        </div>
      )}

      {normalized.role === "internal" ? (
        <div className="pt-8 border-t border-border/40 space-y-5">
          <h4 className="text-base font-bold text-foreground">Acessos Rápidos (Administração)</h4>
          <div className="grid gap-4 md:grid-cols-2">
            {INTERNAL_SHORTCUTS.map((shortcut) => {
              const enabled = hasInternalShortcutAccess(normalized, shortcut.key);
              const ShortcutIcon = shortcut.icon;

              return (
                <button
                  key={shortcut.key}
                  type="button"
                  disabled={!editable}
                  onClick={() => applyPatch(buildInternalShortcutPatch(normalized, shortcut.key, !enabled))}
                  className={cn(
                    "text-left rounded-[2rem] border p-6 transition-all duration-300 relative overflow-hidden group",
                    enabled
                      ? "border-primary/40 bg-primary/5 shadow-md"
                      : "border-border/60 bg-muted/5 hover:border-border hover:bg-muted/10"
                  )}
                >
                  <div className="flex items-start justify-between gap-4 relative z-10">
                    <div className="flex items-start gap-4">
                      <div className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-2xl transition-colors",
                        enabled ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground group-hover:text-foreground"
                      )}>
                        <ShortcutIcon className="h-5 w-5" />
                      </div>
                      <div className="space-y-1 mt-1">
                        <p className={cn("font-bold", enabled ? "text-primary" : "text-foreground")}>{shortcut.title}</p>
                        <p className="text-xs leading-5 text-muted-foreground">{shortcut.description}</p>
                      </div>
                    </div>
                    <div className="pt-2">
                      <Switch checked={enabled} disabled={!editable} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {normalized.role !== "pending" ? (
        <div className="pt-8 border-t border-border/40 space-y-5">
           <div className="flex items-center justify-between">
             <h4 className="text-base font-bold text-foreground">Permissões Detalhadas de Módulos</h4>
             <Badge variant="outline" className="font-medium bg-muted/20">Configuração Avançada</Badge>
           </div>
          <div className="rounded-[2rem] border border-border/60 bg-muted/5 p-2 overflow-hidden">
            <AccessPagesTabs
              role={normalized.role}
              selected={normalized.role === "client" ? normalized.allowedViews : normalized.internalPages}
              disabled={matrixDisabled}
              onChange={(next) =>
                normalized.role === "client"
                  ? applyPatch({ allowedViews: next as AccessView[] })
                  : applyPatch({ internalPages: next as InternalPage[] })
              }
            />
          </div>
        </div>
      ) : null}
    </div>  );
}
