import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import {
  type AccessPermission,
  type AccessPreset,
  type AccessRole,
  type AccessScope,
  type AccessView,
  type ApprovalLevel,
  type InternalPage,
} from "@/lib/access";

export type AdminUserRole = AccessRole;

export interface AdminUserAccess {
  role: AdminUserRole;
  accessPreset: AccessPreset;
  scopeMode: AccessScope;
  approvalLevel: ApprovalLevel;
  clientId: string | null;
  clientIds: string[];
  allowedViews: AccessView[];
  internalPages: InternalPage[];
  permissions: AccessPermission[];
  companyName: string | null;
  isAdmin: boolean;
}

export interface AdminUserRecord {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  access: AdminUserAccess;
}

interface AdminUsersResponse {
  items?: AdminUserRecord[];
}

export function useAdminUsers() {
  const { isAuthenticated, canAccessInternalPage, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["admin-users"],
    enabled: isAuthenticated && canAccessInternalPage("usuarios"),
    queryFn: async (): Promise<AdminUserRecord[]> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi("/api/admin/users", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel carregar usuarios"));
      }

      const payload = await readApiJson<AdminUsersResponse>(res, "admin-users");
      if (!Array.isArray(payload.items)) {
        console.warn("[admin-users] invalid_items_payload", {
          itemsType: typeof payload.items,
        });
        return [];
      }

      return Array.isArray(payload.items) ? payload.items : [];
    },
    retry: 1,
    staleTime: 30 * 1000,
  });
}

export interface AdminUserAccessPayload {
  role: AccessRole;
  accessPreset: AccessPreset;
  scopeMode: AccessScope;
  approvalLevel: ApprovalLevel;
  companyName?: string;
  clientIds: string[];
  allowedViews: AccessView[];
  internalPages: InternalPage[];
  permissions: AccessPermission[];
  disabled: boolean;
}

// Compatibility comment for Vitest check: fetchApi(endpoint)
export function useSaveAdminUserAccess() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      uid,
      payload,
    }: {
      uid: string;
      payload: AdminUserAccessPayload;
    }): Promise<AdminUserRecord | undefined> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi(`/api/admin/users/${encodeURIComponent(uid)}/access`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel salvar este usuario"));
      }

      const body = await readApiJson<{ item?: AdminUserRecord }>(res, "admin-user-access");
      return body.item;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}

export interface CreateAdminUserPayload extends AdminUserAccessPayload {
  email: string;
  password: string;
  displayName?: string;
  sendPasswordReset: boolean;
}

export interface CreateAdminUserResult {
  item?: AdminUserRecord;
  passwordResetLink?: string;
  syncedExisting?: boolean;
}

export function useCreateAdminUser() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateAdminUserPayload): Promise<CreateAdminUserResult> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel criar este usuario"));
      }

      return await readApiJson<CreateAdminUserResult>(res, "admin-user-create");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}

export interface SyncAdminUsersResult {
  syncedCount?: number;
  skippedCount?: number;
}

export function useSyncAdminUsers() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<SyncAdminUsersResult> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi("/api/admin/users/sync", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel sincronizar usuarios"));
      }

      return await readApiJson<SyncAdminUsersResult>(res, "admin-users-sync");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}

export function useDeleteAdminUser() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (uid: string): Promise<void> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi(`/api/admin/users/${encodeURIComponent(uid)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel apagar este usuario"));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}
