import { type AccessRole, type AccessView, useAuth } from "@/contexts/AuthContext";
import { type InternalPage, isPathAllowedForClient, isInternalPageAllowedForClient, getInheritedPlanPages } from "@/lib/access";
import { resolveTenantPlan } from "@/lib/planTier";
import { Navigate, useLocation } from "react-router-dom";
import { findFirstOpenableInternalPage } from "@/lib/pages";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { OPERATOR_MODULES, isOperatorModuleAllowed, getModuleIdFromPath, isOperatorAccess } from "@/lib/operatorPermissions";

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
    accessProfile,
  } = useAuth();
  const location = useLocation();
  const isSetPasswordPage = location.pathname === "/set-password";

  const crmClient = useOptionalCrmClient();
  const allowedTabs = crmClient?.selectedClient?.n8n_settings?.allowed_tabs;
  const planTier = resolveTenantPlan(crmClient?.selectedClient);
  const inheritedPages = getInheritedPlanPages(planTier, crmClient?.selectedClient);

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
  const isOperator = isOperatorAccess(isInternalUser, isAdminUser, accessProfile);

  // Trava rigorosa para operadores: se a rota atual corresponde a um módulo bloqueado, redireciona
  if (isOperator) {
    const operatorModId = getModuleIdFromPath(location.pathname);
    if (operatorModId && !isOperatorModuleAllowed(operatorModId, accessProfile)) {
      const firstAllowed = OPERATOR_MODULES.find((m) => isOperatorModuleAllowed(m.id, accessProfile));
      return <Navigate to={firstAllowed ? firstAllowed.url : "/crm"} replace />;
    }
  }

  const isManager = isInternalUser && (accessProfile?.accessPreset === "gestor" || accessProfile?.approvalLevel === "manager" || accessProfile?.approvalLevel === "director");

  const hasPageAccess = requiredInternalPage
    ? isAdminUser || isManager || canAccessInternalPage(requiredInternalPage) || (!isInternalUser && inheritedPages.includes(requiredInternalPage))
    : true;

  if (requiredInternalPage && (!hasPageAccess || (!isInternalUser && !isInternalPageAllowedForClient(requiredInternalPage, allowedTabs)))) {
    return <Navigate to="/crm" replace />;
  }

  if (location.pathname.startsWith("/crm") && (!isInternalUser && !isPathAllowedForClient(location.pathname, allowedTabs))) {
    const target = findFirstOpenableInternalPage(
      (page) => canAccessInternalPage(page),
      (page) => isInternalUser || isInternalPageAllowedForClient(page, allowedTabs)
    );
    if (target && isPathAllowedForClient(target.path, allowedTabs)) {
      return <Navigate to={target.path} replace />;
    }
    return <Navigate to="/crm" replace />;
  }

  if (requiredAdmin && !isAdminUser) {
    return <Navigate to={defaultRoute} replace />;
  }

  return <>{children}</>;
}
