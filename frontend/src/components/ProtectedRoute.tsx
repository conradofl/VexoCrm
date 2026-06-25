import { type AccessRole, type AccessView, useAuth } from "@/contexts/AuthContext";
import { type InternalPage, INTERNAL_PAGE_ORDER, isPathAllowedForClient, isInternalPageAllowedForClient } from "@/lib/access";
import { Navigate, useLocation } from "react-router-dom";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AccessRole[];
  requiredView?: AccessView;
  requiredInternalPage?: InternalPage;
  requiredAdmin?: boolean;
}

export default function ProtectedRoute({
  children,
  allowedRoles,
  requiredView,
  requiredInternalPage,
  requiredAdmin = false,
}: ProtectedRouteProps) {
  const {
    isAuthenticated,
    loading,
    mustChangePassword,
    accessRole,
    defaultRoute,
    isAdminUser,
    canAccessView,
    canAccessInternalPage,
  } = useAuth();
  const location = useLocation();
  const isSetPasswordPage = location.pathname === "/set-password";

  const crmClient = useOptionalCrmClient();
  const allowedTabs = crmClient?.selectedClient?.n8n_settings?.allowed_tabs;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen w-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (mustChangePassword && !isSetPasswordPage) {
    return <Navigate to="/set-password" replace state={{ from: location }} />;
  }

  if (!mustChangePassword && isSetPasswordPage) {
    return <Navigate to={defaultRoute} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(accessRole)) {
    return <Navigate to={defaultRoute} replace />;
  }

  if (requiredView && !canAccessView(requiredView)) {
    return <Navigate to={defaultRoute} replace />;
  }

  const isInternalUser = accessRole === "internal";

  if (requiredInternalPage && (!canAccessInternalPage(requiredInternalPage) || (!isInternalUser && !isInternalPageAllowedForClient(requiredInternalPage, allowedTabs)))) {
    return <Navigate to="/crm" replace />;
  }

  if (location.pathname.startsWith("/crm") && (!isInternalUser && !isPathAllowedForClient(location.pathname, allowedTabs))) {
    const targetPage = INTERNAL_PAGE_ORDER.find(
      (page) => canAccessInternalPage(page) && (isInternalUser || isInternalPageAllowedForClient(page, allowedTabs))
    );
    if (targetPage) {
      const pageToPath: Record<string, string> = {
        dashboard: "dashboard",
        leads: "leads",
        planilhas: "planilhas",
        whatsapp: "whatsapp",
        agente: "agente",
        usuarios: "usuarios",
        empresas: "empresas",
        campanhas: "planilhas",
        "inteligencia-comercial": "inteligencia-comercial",
        "chatbot-kanban": "chatbot",
        "chatbot-config": "chatbot-settings",
        "fila-de-followup": "followup",
        "followup-empresas": "followup",
        "followup-campanhas": "followup",
        "followup-analytics": "followup",
        "followup-sugestoes": "followup",
        "chatbot-docs": "chatbot-docs",
        "onboarding-wizard": "onboarding",
        conexoes: "conexoes",
        aquecimento: "aquecimento",
        relatorios: "relatorios",
        apresentacao: "apresentacao",
        "apresentacao-gd": "apresentacao-gd",
      };
      const path = pageToPath[targetPage] || targetPage;
      return <Navigate to={`/crm/${path}`} replace />;
    }
    return <Navigate to="/crm" replace />;
  }

  if (requiredAdmin && !isAdminUser) {
    return <Navigate to={defaultRoute} replace />;
  }

  return <>{children}</>;
}
