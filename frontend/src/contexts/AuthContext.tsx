import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  getCurrentIdTokenResult,
  User,
  changePassword as changeFirebasePassword,
  getIdToken as getFirebaseIdToken,
  loginWithEmail,
  logout as firebaseLogout,
  onAuthChange,
  registerWithEmail,
} from "@/lib/firebase";
import {
  buildPresetDefaults,
  getDefaultPresetForRole,
  getDefaultClientRoute,
  getDefaultInternalRoute,
  isFixedAdminAccount,
  normalizeAccessPreset,
  normalizeAccessRole,
  normalizeAccessScope,
  normalizeAllowedViews,
  normalizeApprovalLevel,
  normalizeInternalPages,
  normalizePermissions,
  normalizeString,
  normalizeStringArray,
  type AccessPermission,
  type AccessPreset,
  type AccessRole,
  type AccessScope,
  type AccessView,
  type ApprovalLevel,
  type InternalPage,
} from "@/lib/access";

export type {
  AccessPermission,
  AccessPreset,
  AccessRole,
  AccessScope,
  AccessView,
  ApprovalLevel,
  InternalPage,
} from "@/lib/access";

export interface AuthAccessProfile {
  uid: string;
  email: string | null;
  role: AccessRole;
  isAdmin: boolean;
  accessPreset: AccessPreset;
  scopeMode: AccessScope;
  approvalLevel: ApprovalLevel;
  clientId: string | null;
  clientIds: string[];
  allowedViews: AccessView[];
  internalPages: InternalPage[];
  permissions: AccessPermission[];
  companyName: string | null;
}

interface AuthContextType {
  user: User | null;
  firebaseUser: User | null;
  accessProfile: AuthAccessProfile | null;
  accessRole: AccessRole;
  accessPreset: AccessPreset;
  scopeMode: AccessScope;
  approvalLevel: ApprovalLevel;
  clientId: string | null;
  clientIds: string[];
  allowedViews: AccessView[];
  internalPages: InternalPage[];
  permissions: AccessPermission[];
  loading: boolean;
  isAuthenticated: boolean;
  isInternalUser: boolean;
  isClientUser: boolean;
  isPendingUser: boolean;
  isAdminUser: boolean;
  mustChangePassword: boolean;
  defaultRoute: string;
  login: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  updateInitialPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  canAccessClient: (targetClientId: string) => boolean;
  canAccessView: (view: AccessView) => boolean;
  canAccessInternalPage: (page: InternalPage) => boolean;
  hasPermission: (permission: AccessPermission) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const PASSWORD_RESET_KEY_PREFIX = "password_reset_done_";

const passwordResetKey = (uid: string) => `${PASSWORD_RESET_KEY_PREFIX}${uid}`;

const hasCompletedInitialPasswordReset = (uid: string) =>
  typeof window !== "undefined" && localStorage.getItem(passwordResetKey(uid)) === "1";

const markInitialPasswordResetAsDone = (uid: string) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(passwordResetKey(uid), "1");
};

const isFirstLogin = (user: User) => {
  const createdAt = user.metadata.creationTime ? new Date(user.metadata.creationTime).getTime() : NaN;
  const lastSignInAt = user.metadata.lastSignInTime
    ? new Date(user.metadata.lastSignInTime).getTime()
    : NaN;

  if (Number.isNaN(createdAt) || Number.isNaN(lastSignInAt)) {
    return false;
  }

  return Math.abs(lastSignInAt - createdAt) < 5000;
};

function buildAccessProfile(user: User, claims: Record<string, unknown> = {}): AuthAccessProfile {
  const requestedRole = normalizeAccessRole(
    claims.role ??
      claims.userRole ??
      claims.user_type ??
      claims.userType ??
      claims.tipo_usuario
  );
  const accessPreset = normalizeAccessPreset(claims.accessPreset, requestedRole);
  const permissions = normalizePermissions(claims.permissions, requestedRole, accessPreset);
  const rawClientId =
    claims.clientId ??
    claims.client_id ??
    claims.companyId ??
    claims.empresaId ??
    claims.tenantId ??
    null;
  const directClientId = normalizeString(rawClientId);
  const isAdmin = Boolean(
    directClientId === "vexo" ||
      isFixedAdminAccount(user.uid, user.email || claims.email || null)
  );
  const role = isAdmin ? "internal" : requestedRole;
  const normalizedPreset = role === requestedRole ? accessPreset : normalizeAccessPreset("admin_vexo", role);
  const scopeMode = normalizeAccessScope(
    claims.scopeMode ?? claims.tenantScope ?? claims.clientScope,
    role
  );
  const approvalLevel = normalizeApprovalLevel(claims.approvalLevel, role);
  const clientIds = Array.from(
    new Set([
      directClientId,
      ...normalizeStringArray(claims.clientIds),
      ...normalizeStringArray(claims.tenantIds),
    ].filter(Boolean))
  );
  const clientId =
    role === "pending" || scopeMode === "no_client_access" ? null : directClientId || clientIds[0] || null;
  const allowedViews =
    role === "client" ? normalizeAllowedViews(claims.allowedViews, role, normalizedPreset) : [];
  const internalPages =
    role === "internal" ? normalizeInternalPages(claims.internalPages, isAdmin, normalizedPreset) : [];
  const companyName = normalizeString(claims.companyName);

  return {
    uid: user.uid,
    email: user.email,
    role,
    isAdmin,
    accessPreset: isAdmin ? "admin_vexo" : normalizedPreset,
    scopeMode: isAdmin ? "all_clients" : scopeMode,
    approvalLevel: isAdmin ? "director" : approvalLevel,
    clientId,
    clientIds: role === "pending" || scopeMode === "no_client_access" ? [] : clientIds,
    allowedViews,
    internalPages,
    permissions: isAdmin ? [...buildPresetDefaults("admin_vexo").permissions] : permissions,
    companyName,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [accessProfile, setAccessProfile] = useState<AuthAccessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthChange(async (user) => {
      if (!active) return;

      setFirebaseUser(user);

      if (!user) {
        setAccessProfile(null);
        setMustChangePassword(false);
        setLoading(false);
        return;
      }

      try {
        const tokenResult = await getCurrentIdTokenResult();
        if (!active) return;

        setAccessProfile(buildAccessProfile(user, tokenResult?.claims));
      } catch (error) {
        console.error("Failed to read Firebase custom claims:", error);
        if (!active) return;
        setAccessProfile(buildAccessProfile(user));
      }

      const shouldChange = isFirstLogin(user) && !hasCompletedInitialPasswordReset(user.uid);
      setMustChangePassword(shouldChange);
      setLoading(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      setLoading(true);
      await loginWithEmail(email, password);
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    try {
      setLoading(true);
      await registerWithEmail(email, password, displayName);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      setLoading(true);
      await firebaseLogout();
      setMustChangePassword(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateInitialPassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!firebaseUser) {
        throw new Error("Usuário não autenticado.");
      }

      try {
        setLoading(true);
        await changeFirebasePassword(currentPassword, newPassword);
        markInitialPasswordResetAsDone(firebaseUser.uid);
        setMustChangePassword(false);
      } finally {
        setLoading(false);
      }
    },
    [firebaseUser]
  );

  const getIdToken = useCallback(async (forceRefresh = false): Promise<string | null> => {
    return getFirebaseIdToken(forceRefresh);
  }, []);

  const isAuthenticated = !!firebaseUser;
  const accessRole = accessProfile?.role || "internal";
  const accessPreset = accessProfile?.accessPreset || "internal_operator";
  const scopeMode = accessProfile?.scopeMode || "all_clients";
  const approvalLevel = accessProfile?.approvalLevel || "none";
  const isAdminUser = accessProfile?.isAdmin || false;
  const clientId = accessProfile?.clientId || null;
  const clientIds = accessProfile?.clientIds || [];
  const allowedViews = accessProfile?.allowedViews || [];
  const internalPages = accessProfile?.internalPages || [];
  const permissions = accessProfile?.permissions || [];
  const isInternalUser = accessRole === "internal";
  const isClientUser = accessRole === "client";
  const isPendingUser = accessRole === "pending";
  const canAccessClient = useCallback(
    (targetClientId: string) => {
      const isVexo = clientId === "vexo" || isFixedAdminAccount(firebaseUser?.uid, firebaseUser?.email);
      if (!isVexo) {
        return clientIds.includes(targetClientId);
      }
      if (isAdminUser) return true;
      if (isInternalUser && scopeMode === "all_clients") return true;
      return clientIds.includes(targetClientId);
    },
    [clientIds, isAdminUser, isInternalUser, scopeMode, clientId, firebaseUser]
  );
  const canAccessView = useCallback(
    (view: AccessView) => isInternalUser || allowedViews.includes(view),
    [allowedViews, isInternalUser]
  );
  const canAccessInternalPage = useCallback(
    (page: InternalPage) => {
      if (!isInternalUser) return false;
      if (page === "empresas") {
        const isVexo = clientId === "vexo" || isFixedAdminAccount(firebaseUser?.uid, firebaseUser?.email);
        if (!isVexo) return false;
      }
      return isAdminUser || internalPages.includes(page);
    },
    [internalPages, isAdminUser, isInternalUser, clientId, firebaseUser]
  );
  const hasPermission = useCallback(
    (permission: AccessPermission) => {
      if (permission === "tenants.manage") {
        const isVexo = clientId === "vexo" || isFixedAdminAccount(firebaseUser?.uid, firebaseUser?.email);
        if (!isVexo) return false;
      }
      return isAdminUser || permissions.includes(permission);
    },
    [isAdminUser, permissions, clientId, firebaseUser]
  );
  const defaultRoute = isPendingUser
    ? "/aguardando-aprovacao"
    : isClientUser
      ? clientId
        ? getDefaultClientRoute(clientId, allowedViews)
        : "/aguardando-aprovacao"
      : getDefaultInternalRoute(internalPages, isAdminUser);

  return (
    <AuthContext.Provider
      value={{
        user: firebaseUser,
        firebaseUser,
        accessProfile,
        accessRole,
        accessPreset,
        scopeMode,
        approvalLevel,
        clientId,
        clientIds,
        allowedViews,
        internalPages,
        permissions,
        loading,
        isAuthenticated,
        isInternalUser,
        isClientUser,
        isPendingUser,
        isAdminUser,
        mustChangePassword,
        defaultRoute,
        login,
        signIn: login,
        register,
        signUp: register,
        updateInitialPassword,
        logout,
        signOut: logout,
        getIdToken,
        canAccessClient,
        canAccessView,
        canAccessInternalPage,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
