import { useEffect, useState } from "react";
import { Activity, Monitor, Rocket, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CLIENT_VIEW_ORDER, type AccessView, type InternalPage } from "@/lib/access";
import {
  CLIENT_PAGE_TABS,
  INTERNAL_PAGE_LABELS,
  VIEW_LABELS,
  filterArray,
  toggleItem,
} from "@/lib/userAccessDraft";
import { InternalPagesHierarchyPanel } from "@/components/InternalPagesHierarchyPanel";
import { ChecklistPanel } from "@/components/access/ChecklistPanel";

interface AccessPagesTabsProps {
  role: "internal" | "client";
  selected: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}

export function AccessPagesTabs({ role, selected, disabled, onChange }: AccessPagesTabsProps) {
  if (role === "internal") {
    return <InternalPagesHierarchyPanel selected={selected} disabled={disabled} onChange={onChange} />;
  }

  const tabs = CLIENT_PAGE_TABS;
  const referenceOrder = CLIENT_VIEW_ORDER;
  const [activeTab, setActiveTab] = useState(tabs[0].value);

  useEffect(() => {
    setActiveTab(tabs[0].value);
  }, [tabs]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
      <TabsList
        className={cn(
          "w-full p-1.5 bg-muted/20 border border-border/40 rounded-[1.75rem] h-auto flex flex-wrap sm:grid",
          tabs.length === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2"
        )}
      >
        {tabs.map((tab) => {
          const selectedCount = tab.items.filter((item) => selected.includes(item)).length;
          const isOperacaoOrPortal = tab.value === "vendas" || tab.value === "portal";
          const isDisparosOrComunicacao = tab.value === "disparos" || tab.value === "comunicacao";
          const isSistema = tab.value === "sistema";

          return (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="rounded-2xl h-12 font-bold text-sm transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md flex items-center justify-center gap-2"
            >
              {isOperacaoOrPortal ? (
                <Activity className="h-4 w-4" />
              ) : isDisparosOrComunicacao ? (
                <Rocket className="h-4 w-4" />
              ) : isSistema ? (
                <Monitor className="h-4 w-4" />
              ) : (
                <Settings className="h-4 w-4" />
              )}
              <span className="truncate">{tab.label}</span>
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 rounded-full px-1.5 flex items-center justify-center text-[10px] font-extrabold bg-muted-foreground/10 text-muted-foreground data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                {selectedCount} / {tab.items.length}
              </Badge>
            </TabsTrigger>
          );
        })}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="mt-0 outline-none">
          <ChecklistPanel
            title={role === "client" ? "Páginas do Portal do Cliente" : "Módulos do Sistema (Interno)"}
            description={
              role === "client"
                ? "Marque as telas e funcionalidades que o cliente final enxergará ao fazer login."
                : "Libere os recursos operacionais e de gestão que esse membro interno terá no CRM."
            }
            items={tab.items}
            selected={selected}
            disabled={disabled}
            emptyMessage="Nenhuma página ou módulo disponível."
            onToggle={(item, checked) => onChange(toggleItem(selected, item, checked))}
            onSelectAll={() =>
              onChange(filterArray(Array.from(new Set([...selected, ...tab.items])), referenceOrder))
            }
            onClear={() => {
              const tabItems = tab.items as string[];
              onChange(selected.filter((item) => !tabItems.includes(item)));
            }}
            renderLabel={(item) =>
              role === "client"
                ? VIEW_LABELS[item as AccessView]
                : INTERNAL_PAGE_LABELS[item as InternalPage]
            }
            renderHint={(item) => {
              if (role === "client") {
                if (item === "whatsapp") return "Caixa de entrada e conversa";
                if (item === "planilhas") return "Envio de bases e histórico";
                if (item === "dashboard") return "Painel visual com métricas";
                return "Página do portal";
              }

              if (item === "dashboard") return "Métricas e inteligência comercial";
              if (item === "usuarios") return "Governança e auditoria de acessos";
              if (item === "agente") return "Configurações do agente de IA";
              if (item === "campanhas") return "Disparo e fluxo de contatos";
              if (item === "planilhas") return "Importação e limpeza de listas";
              if (item === "empresas") return "Organização de tenants/empresas";
              if (item === "inteligencia-comercial") return "Performance e equipe de vendas";
              if (item === "chatbot-kanban") return "Painel de leads do chatbot";
              if (item === "chatbot-config") return "Configurações e prompts do chatbot";
              if (item === "fila-de-followup") return "Fila e sugestões de follow-up";
              if (item === "chatbot-docs") return "Documentação do chatbot";
              if (item === "onboarding-wizard") return "Vídeos e tutoriais da plataforma";
              if (item === "apresentacao") return "Apresentação comercial e demo";
              if (item === "conexoes") return "Painel de chips de WhatsApp";
              if (item === "aquecimento") return "Aquecimento de números";
              if (item === "relatorios") return "Relatórios de consumo e uso";
              if (item === "apresentacao-gd") return "Apresentação de Onboarding Geração Digital";
              return "Módulo do CRM";
            }}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
