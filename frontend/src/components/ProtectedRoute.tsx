import { type AccessRole, type AccessView, useAuth } from "@/contexts/AuthContext";
import { type InternalPage } from "@/lib/access";
import { Navigate, useLocation } from "react-router-dom";

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

  if (requiredInternalPage && !canAccessInternalPage(requiredInternalPage)) {
    return <Navigate to="/crm" replace />;
  }

  if (requiredAdmin && !isAdminUser) {
    return <Navigate to={defaultRoute} replace />;
  }

  return <>{children}</>;
}
