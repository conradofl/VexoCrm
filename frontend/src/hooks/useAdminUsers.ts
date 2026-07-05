import { useQuery } from "@tanstack/react-query";
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
