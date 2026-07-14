import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Briefcase, ListChecks, FileText, Layers, CreditCard } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export function GeracaoDigitalTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const { canAccessInternalPage } = useAuth();

  const hasApresentacao = canAccessInternalPage("apresentacao-gd");
  const hasBriefings = canAccessInternalPage("briefings-gd");
  const hasPropostas = canAccessInternalPage("propostas-gd");
  const hasPacotes = canAccessInternalPage("pacotes-gd");
  const hasCondicoes = canAccessInternalPage("condicoes-gd");
  const hasContratos = canAccessInternalPage("contratos-gd");

  // Determine active tab based on path name
  let activeTab = "";
  if (location.pathname.includes("apresentacao-gd")) activeTab = "apresentacao";
  else if (location.pathname.includes("geracao-digital")) activeTab = "briefing";
  else if (location.pathname.includes("propostas-gd")) activeTab = "propostas";
  else if (location.pathname.includes("pacotes-gd")) activeTab = "pacotes";
  else if (location.pathname.includes("condicoes-gd")) activeTab = "condicoes";
  else if (location.pathname.includes("contratos-gd")) activeTab = "contratos";

  const handleTabChange = (val: string) => {
    if (val === "apresentacao") navigate("/crm/apresentacao-gd");
    else if (val === "briefing") navigate("/crm/geracao-digital");
    else if (val === "propostas") navigate("/crm/propostas-gd");
    else if (val === "pacotes") navigate("/crm/pacotes-gd");
    else if (val === "condicoes") navigate("/crm/condicoes-gd");
    else if (val === "contratos") navigate("/crm/contratos-gd");
  };

  return (
    <div className="border-b border-slate-200 dark:border-white/10 pb-2 mb-6">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="flex w-full max-w-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 h-10 p-1 rounded-xl">
          {hasApresentacao && (
            <TabsTrigger value="apresentacao" className="flex-1 text-xs font-bold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-purple-650 data-[state=active]:shadow-sm">
              <Briefcase className="h-3.5 w-3.5 mr-1.5" />
              Apresentação
            </TabsTrigger>
          )}
          {hasBriefings && (
            <TabsTrigger value="briefing" className="flex-1 text-xs font-bold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-purple-650 data-[state=active]:shadow-sm">
              <ListChecks className="h-3.5 w-3.5 mr-1.5" />
              Briefing
            </TabsTrigger>
          )}
          {hasPropostas && (
            <TabsTrigger value="propostas" className="flex-1 text-xs font-bold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-purple-650 data-[state=active]:shadow-sm">
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Propostas
            </TabsTrigger>
          )}
          {hasPacotes && (
            <TabsTrigger value="pacotes" className="flex-1 text-xs font-bold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-purple-650 data-[state=active]:shadow-sm">
              <Layers className="h-3.5 w-3.5 mr-1.5" />
              Pacotes
            </TabsTrigger>
          )}
          {hasCondicoes && (
            <TabsTrigger value="condicoes" className="flex-1 text-xs font-bold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-purple-650 data-[state=active]:shadow-sm">
              <CreditCard className="h-3.5 w-3.5 mr-1.5" />
              Condições
            </TabsTrigger>
          )}
          {hasContratos && (
            <TabsTrigger value="contratos" className="flex-1 text-xs font-bold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-purple-650 data-[state=active]:shadow-sm">
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Contratos
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>
    </div>
  );
}
