import { createContext } from "react";
import type { LeadClient } from "@/hooks/useLeadClients";

export interface CrmClientContextValue {
  clients: LeadClient[];
  selectedClientId: string;
  selectedClient: LeadClient | null;
  isLoading: boolean;
  error: Error | null;
  setSelectedClientId: (clientId: string) => void;
}

export const CrmClientContext = createContext<CrmClientContextValue | null>(null);
