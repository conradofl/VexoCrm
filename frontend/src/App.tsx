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
import { INTERNAL_PAGE_ORDER, getDefaultClientRoute, isInternalPageAllowedForClient } from "@/lib/access";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Dashboard from "./pages/Dashboard";
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
import WhatsAppInbox from "./pages/WhatsAppInbox";
import CommercialIntelligence from "./pages/CommercialIntelligence";
import Relatorios from "./pages/Relatorios";
import FollowupQueue from "./pages/FollowupQueue";
import OnboardingWizard from "./pages/OnboardingWizard";
import LivPub from "./pages/LivPub";
import GeracaoDigitalBriefings from "./pages/GeracaoDigitalBriefings";
import AgenteIA from "./pages/AgenteIA";
import ChipsWhatsapp from "./pages/ChipsWhatsapp";
import AdminPanel from "./pages/AdminPanel";
import ApresentacaoUnificada from "./pages/ApresentacaoUnificada";

const queryClient = new QueryClient();

function InternalIndexRedirect() {
  const { canAccessInternalPage } = useAuth();
  const crmClient = useOptionalCrmClient();
  const allowedTabs = crmClient?.selectedClient?.n8n_settings?.allowed_tabs;

  const target = INTERNAL_PAGE_ORDER.find(
    (page) => canAccessInternalPage(page) && isInternalPageAllowedForClient(page, allowedTabs)
  );

  if (!target) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <EmptyState
          title="Nenhuma página liberada"
          description="Este usuário interno não possui páginas liberadas ou a empresa atual não possui abas contratadas. Ajuste as permissões no painel para continuar."
        />
      </div>
    );
  }

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
    "inbound-agents": "inbound-agents",
  };

  const path = pageToPath[target] || target;
  return <Navigate to={path} replace />;
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
                path="eventos"
                element={
                  <ProtectedRoute allowedRoles={["internal"]}>
                    <Eventos />
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
                  <ProtectedRoute allowedRoles={["internal"]}>
                    <AgenteIA />
                  </ProtectedRoute>
                }
              />
              <Route path="chatbot" element={<Navigate to="/crm/agente?tab=operacao" replace />} />
              <Route path="inbound-agents" element={<Navigate to="/crm/agente?tab=inbound" replace />} />
              <Route path="chatbot-settings" element={<Navigate to="/crm/agente?tab=settings" replace />} />
              <Route path="chatbot-config" element={<Navigate to="/crm/agente?tab=settings" replace />} />
              <Route path="chatbot-docs" element={<Navigate to="/crm/agente?tab=docs" replace />} />
              <Route path="prompt-editor" element={<Navigate to="/crm/agente?tab=settings" replace />} />
              <Route path="chatbot-templates" element={<Navigate to="/crm/agente?tab=settings" replace />} />

              <Route
                path="followup"
                element={
                  <ProtectedRoute allowedRoles={["internal"]} requiredInternalPage="planilhas">
                    <FollowupQueue />
                  </ProtectedRoute>
                }
              />
              <Route path="followup-empresas" element={<Navigate to="/crm/followup?tab=config" replace />} />
              <Route path="followup-campanhas" element={<Navigate to="/crm/followup?tab=campanhas" replace />} />
              <Route path="followup-templates" element={<Navigate to="/crm/followup?tab=campanhas" replace />} />
              <Route path="followup-analytics" element={<Navigate to="/crm/followup?tab=metrics" replace />} />
              <Route path="followup-sugestoes" element={<Navigate to="/crm/followup?tab=sugestoes" replace />} />

              <Route
                path="admin"
                element={
                  <ProtectedRoute allowedRoles={["internal"]}>
                    <AdminPanel />
                  </ProtectedRoute>
                }
              />
              <Route path="empresas" element={<Navigate to="/crm/admin?tab=empresas" replace />} />
              <Route path="usuarios" element={<Navigate to="/crm/admin?tab=usuarios" replace />} />
              <Route path="integracoes" element={<Navigate to="/crm/admin?tab=integracoes" replace />} />

              <Route
                path="chips-whatsapp"
                element={
                  <ProtectedRoute allowedRoles={["internal"]}>
                    <ChipsWhatsapp />
                  </ProtectedRoute>
                }
              />
              <Route path="conexoes" element={<Navigate to="/crm/chips-whatsapp?tab=conexoes" replace />} />
              <Route path="aquecimento" element={<Navigate to="/crm/chips-whatsapp?tab=aquecimento" replace />} />
              <Route path="evolution-admin" element={<Navigate to="/crm/chips-whatsapp?tab=evolution-admin" replace />} />

              <Route
                path="relatorios"
                element={
                  <ProtectedRoute allowedRoles={["internal"]} requiredInternalPage="relatorios">
                    <Relatorios />
                  </ProtectedRoute>
                }
              />
              <Route
                path="livpub"
                element={
                  <ProtectedRoute allowedRoles={["internal"]} requiredInternalPage="livpub">
                    <LivPub />
                  </ProtectedRoute>
                }
              />
              <Route path="eventos" element={<Navigate to="/crm/livpub?tab=eventos" replace />} />
              <Route path="relacionamento" element={<Navigate to="/crm/livpub?tab=relacionamento" replace />} />

              <Route
                path="onboarding"
                element={
                  <ProtectedRoute allowedRoles={["internal"]}>
                    <OnboardingWizard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="apresentacao"
                element={
                  <ProtectedRoute allowedRoles={["internal"]}>
                    <ApresentacaoUnificada />
                  </ProtectedRoute>
                }
              />
              <Route path="apresentacao-gd" element={<Navigate to="/crm/apresentacao?deck=gd" replace />} />
              <Route
                path="briefings-gd"
                element={
                  <ProtectedRoute allowedRoles={["internal"]} requiredInternalPage="briefings-gd">
                    <GeracaoDigitalBriefings />
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
