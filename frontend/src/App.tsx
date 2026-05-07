import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ClientPortalLayout } from "@/components/ClientPortalLayout";
import { EmptyState } from "@/components/EmptyState";
import { MainLayout } from "@/components/MainLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import { INTERNAL_PAGE_ORDER, getDefaultClientRoute } from "@/lib/access";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Dashboard from "./pages/Dashboard";
import Agente from "./pages/Agente";
import ClientPortalDashboard from "./pages/ClientPortalDashboard";
import ClientPortalLeads from "./pages/ClientPortalLeads";
import ClientPortalPlanilhas from "./pages/ClientPortalPlanilhas";
import ClientPortalWhatsApp from "./pages/ClientPortalWhatsApp";
import LandingPage from "./pages/LandingPage";
import Leads from "./pages/Leads";
import LeadImports from "./pages/LeadImports";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import SetPassword from "./pages/SetPassword";
import PendingApproval from "./pages/PendingApproval";
import ClientSignup from "./pages/ClientSignup";
import UserAccessManagement from "./pages/UserAccessManagement";
import WhatsAppInbox from "./pages/WhatsAppInbox";
import Tenants from "./pages/Tenants";
import CommercialIntelligence from "./pages/CommercialIntelligence";
import VexoSales from "./pages/VexoSales";

const queryClient = new QueryClient();

function InternalIndexRedirect() {
  const { canAccessInternalPage } = useAuth();
  const target = INTERNAL_PAGE_ORDER.find((page) => canAccessInternalPage(page));

  if (!target) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <EmptyState
          title="Nenhuma pagina liberada"
          description="Este usuario interno nao possui paginas liberadas. Ajuste as permissoes no painel para continuar."
        />
      </div>
    );
  }

  return <Navigate to={target} replace />;
}

function ClientIndexRedirect() {
  const { accessProfile } = useAuth();
  const { clientId } = useParams();

  if (!clientId || !accessProfile) {
    return <Navigate to="/aguardando-aprovacao" replace />;
  }

  return <Navigate to={getDefaultClientRoute(clientId, accessProfile.allowedViews)} replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      {/* Particles removed */}
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/home" element={<LandingPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/cadastro-cliente" element={<ClientSignup />} />
            <Route path="/crm/login" element={<Navigate to="/login" replace />} />
            <Route
              path="/set-password"
              element={
                <ProtectedRoute>
                  <SetPassword />
                </ProtectedRoute>
              }
            />
            <Route
              path="/aguardando-aprovacao"
              element={
                <ProtectedRoute allowedRoles={["pending"]}>
                  <PendingApproval />
                </ProtectedRoute>
              }
            />
            <Route path="/dashboard" element={<Navigate to="/crm/dashboard" replace />} />
            <Route path="/leads" element={<Navigate to="/crm/leads" replace />} />
            <Route path="/planilhas" element={<Navigate to="/crm/planilhas" replace />} />
            <Route path="/campanhas" element={<Navigate to="/crm/planilhas" replace />} />
            <Route path="/inteligencia-comercial" element={<Navigate to="/crm/inteligencia-comercial" replace />} />
            <Route path="/agente" element={<Navigate to="/crm/agente" replace />} />
            <Route path="/whatsapp" element={<Navigate to="/crm/whatsapp" replace />} />
            <Route path="/empresas" element={<Navigate to="/crm/empresas" replace />} />
            <Route
              path="/crm"
              element={
                <ProtectedRoute allowedRoles={["internal"]}>
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<InternalIndexRedirect />} />
              <Route
                path="dashboard"
                element={
                  <ProtectedRoute allowedRoles={["internal"]} requiredInternalPage="dashboard">
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="leads"
                element={
                  <ProtectedRoute allowedRoles={["internal"]} requiredInternalPage="leads">
                    <Leads />
                  </ProtectedRoute>
                }
              />
              <Route
                path="planilhas"
                element={
                  <ProtectedRoute allowedRoles={["internal"]} requiredInternalPage="planilhas">
                    <LeadImports />
                  </ProtectedRoute>
                }
              />
              <Route path="campanhas" element={<Navigate to="/crm/planilhas" replace />} />
              <Route
                path="inteligencia-comercial"
                element={
                  <ProtectedRoute allowedRoles={["internal"]} requiredInternalPage="dashboard">
                    <CommercialIntelligence />
                  </ProtectedRoute>
                }
              />
              <Route
                path="whatsapp"
                element={
                  <ProtectedRoute allowedRoles={["internal"]} requiredInternalPage="whatsapp">
                    <WhatsAppInbox />
                  </ProtectedRoute>
                }
              />
              <Route
                path="agente"
                element={
                  <ProtectedRoute allowedRoles={["internal"]} requiredInternalPage="agente">
                    <Agente />
                  </ProtectedRoute>
                }
              />
              <Route
                path="usuarios"
                element={
                  <ProtectedRoute allowedRoles={["internal"]} requiredInternalPage="usuarios">
                    <ErrorBoundary>
                      <UserAccessManagement />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="empresas"
                element={
                  <ProtectedRoute allowedRoles={["internal"]} requiredInternalPage="empresas">
                    <Tenants />
                  </ProtectedRoute>
                }
              />
              <Route
                path="vexo-sales"
                element={
                  <ProtectedRoute allowedRoles={["internal"]} requiredAdmin>
                    <VexoSales />
                  </ProtectedRoute>
                }
              />
            </Route>
              <Route
                path="/clientes/:clientId"
                element={
                  <ProtectedRoute allowedRoles={["internal", "client"]}>
                    <ClientPortalLayout />
                </ProtectedRoute>
              }
            >
              <Route
                index
                element={
                  <ProtectedRoute allowedRoles={["internal", "client"]}>
                    <ClientIndexRedirect />
                  </ProtectedRoute>
                }
              />
              <Route
                path="dashboard"
                element={
                  <ProtectedRoute allowedRoles={["internal", "client"]} requiredView="dashboard">
                    <ClientPortalDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="leads"
                element={
                  <ProtectedRoute allowedRoles={["internal", "client"]} requiredView="leads">
                    <ClientPortalLeads />
                  </ProtectedRoute>
                }
              />
              <Route
                path="planilhas"
                element={
                  <ProtectedRoute allowedRoles={["internal", "client"]} requiredView="planilhas">
                    <ClientPortalPlanilhas />
                  </ProtectedRoute>
                }
              />
              <Route
                path="whatsapp"
                element={
                  <ProtectedRoute allowedRoles={["internal", "client"]} requiredView="whatsapp">
                    <ClientPortalWhatsApp />
                  </ProtectedRoute>
                }
              />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
