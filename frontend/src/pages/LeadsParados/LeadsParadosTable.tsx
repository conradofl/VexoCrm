// frontend/src/pages/LeadsParados/LeadsParadosTable.tsx
import React from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Bell, RefreshCw, User, Phone, AlertCircle, ArrowUpRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StalledLead } from "@/hooks/useStalledLeads";
import { sanitizePhone } from "@/lib/phone";

interface LeadsParadosTableProps {
  leads: StalledLead[];
  onOpenReminder: (lead: StalledLead) => void;
  onOpenCadence: (lead: StalledLead) => void;
  isLoading?: boolean;
}

export function LeadsParadosTable({
  leads,
  onOpenReminder,
  onOpenCadence,
  isLoading = false,
}: LeadsParadosTableProps) {
  const navigate = useNavigate();

  const handleOpenConversation = (lead: StalledLead) => {
    const rawPhone = lead.telefone || lead.phone;
    const canonical = sanitizePhone(rawPhone);
    if (canonical) {
      navigate(`/crm/whatsapp?phone=${canonical}`);
    } else {
      navigate("/crm/whatsapp");
    }
  };

  const formatStageLabel = (stage?: string | null) => {
    if (!stage) return "Sem estágio";
    const map: Record<string, string> = {
      open_budget: "Orçamento Aberto",
      inquiry: "Primeiro Contato",
      cold: "Lead Frio",
      warm: "Interessado",
      hot: "Quente / Proposta",
      never_contacted: "Nunca Contatado",
    };
    return map[stage.toLowerCase()] || stage;
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl border bg-card/60 p-8 text-center space-y-3 animate-pulse">
        <div className="h-6 w-48 bg-muted rounded mx-auto" />
        <div className="h-4 w-72 bg-muted/60 rounded mx-auto" />
        <div className="h-32 bg-muted/20 rounded mt-4" />
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-2xl border bg-card/60 p-12 text-center space-y-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mx-auto ring-1 ring-emerald-500/20">
          <AlertCircle className="h-6 w-6" />
        </div>
        <h3 className="text-base font-bold text-foreground">Nenhum lead parado neste filtro</h3>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          Todos os contatos em etapas ativas estão dentro do SLA comercial de atendimento.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card/60 shadow-xs overflow-hidden">
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow>
            <TableHead className="w-[240px] font-semibold text-xs">Lead</TableHead>
            <TableHead className="w-[150px] font-semibold text-xs">Tempo Parado</TableHead>
            <TableHead className="w-[140px] font-semibold text-xs">Estágio</TableHead>
            <TableHead className="min-w-[220px] font-semibold text-xs">Última Mensagem</TableHead>
            <TableHead className="w-[170px] font-semibold text-xs">Responsável</TableHead>
            <TableHead className="w-[190px] text-right font-semibold text-xs">Ações em 1 Clique</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => {
            const rawPhone = lead.telefone || lead.phone || "";
            const isHighIdle = lead.days_idle >= 14;

            return (
              <TableRow key={lead.id} className="hover:bg-muted/40 transition-colors">
                {/* Nome e Telefone */}
                <TableCell>
                  <div className="space-y-1">
                    <p className="font-bold text-xs text-foreground truncate max-w-[220px]" title={lead.nome || "Lead Sem Nome"}>
                      {lead.nome || "Lead Sem Nome"}
                    </p>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Phone className="h-3 w-3 shrink-0" />
                      <span>{rawPhone || "Sem telefone"}</span>
                    </div>
                    {lead.tags && lead.tags.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap mt-1">
                        {lead.tags.slice(0, 2).map((tg, i) => (
                          <span key={i} className="text-[9.5px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                            {tg}
                          </span>
                        ))}
                        {lead.tags.length > 2 && (
                          <span className="text-[9px] text-muted-foreground">+{lead.tags.length - 2}</span>
                        )}
                      </div>
                    )}
                  </div>
                </TableCell>

                {/* Dias Parado */}
                <TableCell>
                  <div className="space-y-1">
                    <Badge
                      variant="outline"
                      className={`font-bold text-xs px-2 py-0.5 whitespace-nowrap ${
                        isHighIdle
                          ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                      }`}
                    >
                      ⚠️ Parado há {lead.days_idle}d
                    </Badge>
                    <p className="text-[10px] text-muted-foreground">
                      {lead.last_message_at
                        ? "desde última mensagem"
                        : lead.last_interaction_at
                        ? "desde última interação"
                        : "desde criação/atualização"}
                    </p>
                  </div>
                </TableCell>

                {/* Estágio Comercial */}
                <TableCell>
                  <Badge variant="secondary" className="text-[10.5px] font-semibold capitalize px-2 py-0.5">
                    {formatStageLabel(lead.stage)}
                  </Badge>
                </TableCell>

                {/* Última Mensagem / Resumo */}
                <TableCell>
                  <div className="max-w-[280px]">
                    {lead.last_message ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed cursor-default">
                              {lead.last_message}
                            </p>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs p-2.5">
                            <p className="font-semibold mb-1">Última Mensagem registrada:</p>
                            <p className="text-muted-foreground">{lead.last_message}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-xs text-muted-foreground/60 italic">Sem mensagem registrada</span>
                    )}
                  </div>
                </TableCell>

                {/* Responsável (SDR) */}
                <TableCell>
                  <div className="flex items-center gap-1.5 text-xs text-foreground font-medium">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground shrink-0">
                      <User className="h-3 w-3" />
                    </div>
                    <span className="truncate max-w-[120px]" title={lead.sdr_rotation_owner || lead.assigned_to || "Não atribuído"}>
                      {lead.sdr_rotation_owner || lead.assigned_to || "Não atribuído"}
                    </span>
                  </div>
                </TableCell>

                {/* Ações em 1 Clique */}
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {/* Ação 1: Abrir conversa */}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenConversation(lead)}
                            className="h-8 px-2 text-xs font-semibold rounded-xl border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                          >
                            <MessageSquare className="h-3.5 w-3.5 mr-1" />
                            <span>Conversa</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">
                          Abrir WhatsApp deste lead diretamente no Inbox
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    {/* Ação 2: Criar lembrete */}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenReminder(lead)}
                            className="h-8 px-2 text-xs font-semibold rounded-xl border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                          >
                            <Bell className="h-3.5 w-3.5 mr-1 text-amber-500" />
                            <span>Lembrete</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">
                          Criar lembrete pessoal com data e hora para este lead
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    {/* Ação 3: Inscrever em cadência */}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenCadence(lead)}
                            className="h-8 px-2 text-xs font-semibold rounded-xl border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-500/20"
                          >
                            <RefreshCw className="h-3.5 w-3.5 mr-1 text-purple-500" />
                            <span>Cadência</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">
                          Inscrever este lead em uma cadência de follow-up / reativação
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
