// Dublê do contexto de autenticação, só para o harness de tela (e2e/harness). O harness não
// fala com o Firebase: quem está logado é fixo e todo pedido leva um token de mentira.
import type { ReactNode } from "react";

const value = {
  user: { uid: "harness-uid", email: "harness@vexo.test", displayName: "Harness" },
  firebaseUser: null,
  accessProfile: null,
  accessRole: "internal",
  accessPreset: "admin",
  scopeMode: "all_clients",
  approvalLevel: "admin",
  clientId: "geracao-digital",
  clientIds: ["geracao-digital"],
  allowedViews: [],
  internalPages: [],
  permissions: [],
  loading: false,
  currentTenant: "geracao-digital",
  isAuthenticated: true,
  isInternalUser: true,
  isClientUser: false,
  isPendingUser: false,
  isAdminUser: true,
  mustChangePassword: false,
  defaultRoute: "/",
  login: async () => {},
  signIn: async () => {},
  register: async () => {},
  signUp: async () => {},
  updateInitialPassword: async () => {},
  changePassword: async () => {},
  logout: async () => {},
  signOut: async () => {},
  getIdToken: async () => "harness-token",
  canAccessClient: () => true,
  canAccessView: () => true,
  canAccessInternalPage: () => true,
  hasPermission: () => true,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useAuth(): any {
  return value;
}
