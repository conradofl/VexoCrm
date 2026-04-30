import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";

export interface DashboardSummary {
  totalLeads: number;
  leadsToday: number;
  qualifiedLeads: number;
  qualificationRate: number;
  activeCities: number;
  hotLeads: number;
  warmLeads: number;
  coldLeads: number;
  noSignalLeads: number;
  conversions: number;
  conversionRate: number;
  revenueGenerated: number;
  averageTicket: number;
  performanceScore: number;
  funnelCoverage: number;
}

export interface DashboardChartPoint {
  day: string;
  leads: number;
  qualifiedLeads: number;
}

export interface DashboardBreakdownItem {
  name: string;
  value: number;
  color?: string;
}

export interface DashboardRecentLead {
  id: string;
  nome: string;
  tipo_cliente: string | null;
  cidade: string | null;
  status: string;
  temperature: string;
  data_hora: string;
}

export interface DashboardPayload {
  client: {
    id: string;
    name: string;
  };
  summary: DashboardSummary;
  leadsByDay: DashboardChartPoint[];
  temperatureBreakdown: DashboardBreakdownItem[];
  statusBreakdown: DashboardBreakdownItem[];
  typeBreakdown: DashboardBreakdownItem[];
  recentLeads: DashboardRecentLead[];
}

export function useDashboard(clientId: string) {
  const { isAuthenticated, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["dashboard", clientId],
    enabled: isAuthenticated && !!clientId,
    queryFn: async (): Promise<DashboardPayload> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetch(`${API_BASE_URL}/api/dashboard?clientId=${encodeURIComponent(clientId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Dashboard fetch failed: ${res.status} ${errText}`);
      }

      return res.json();
    },
    staleTime: 30 * 1000,
  });
}
