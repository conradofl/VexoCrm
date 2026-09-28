import React, { useState } from "react";
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Filter,
  Instagram,
  Loader2,
  MessageCircle,
  RotateCcw,
  Search,
  Sparkles,
  User,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useContactsWithoutChannel,
  useUpdateContactWithoutChannel,
  type ContactWithoutChannel,
} from "@/hooks/useContactsWithoutChannel";
import { formatInstagramDirectMessage } from "@/lib/leadImports/instagramExport";

interface ContactsWithoutChannelSectionProps {
  clientId: string;
  onLeadConverted?: () => void;
}

export function ContactsWithoutChannelSection({
  clientId,
  onLeadConverted,
}: ContactsWithoutChannelSectionProps) {
  const { data: contacts = [], isLoading, isError, error, refetch } =
    useContactsWithoutChannel(clientId);
  const updateMutation = useUpdateContactWithoutChannel();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "asked" | "converted">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyMessage = async (contact: ContactWithoutChannel) => {
    const text = formatInstagramDirectMessage(contact.nome, contact.resumo);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback para ambientes sem suporte a clipboard API
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedId(contact.id);
      setTimeout(() => setCopiedId(null), 2500);
      toast.success("Mensagem copiada para a área de transferência!", {
        description: "Cole diretamente na conversa do Direct com a pessoa.",
      });
    } catch {
      toast.error("Não foi possível copiar automaticamente para a área de transferência.");
    }
  };

  const handleToggleAsked = async (contact: ContactWithoutChannel) => {
    const nextValue = !contact.askedWhatsappAt;
    try {
      await updateMutation.mutateAsync({
        clientId,
        contactId: contact.id,
        field: "asked_whatsapp",
        value: nextValue,
      });
      if (nextValue) {
        toast.success(`Marcado como 'WhatsApp Solicitado' para ${contact.nome}`);
      } else {
        toast.info(`Desmarcado 'WhatsApp Solicitado' para ${contact.nome}`);
      }
    } catch (err: any) {
      toast.error("Erro ao atualizar status", {
        description: err?.message || "Tente novamente.",
      });
    }
  };

  const handleToggleBecameLead = async (contact: ContactWithoutChannel) => {
    const nextValue = !contact.becameLeadAt;
    try {
      await updateMutation.mutateAsync({
        clientId,
        contactId: contact.id,
        field: "became_lead",
        value: nextValue,
      });
      if (nextValue) {
        toast.success(`Parabéns! ${contact.nome} virou lead! 🎉`, {
          description: "Agora você pode cadastrá-lo com o telefone obtido.",
        });
        onLeadConverted?.();
      } else {
        toast.info(`Desmarcado 'Virou Lead' para ${contact.nome}`);
      }
    } catch (err: any) {
      toast.error("Erro ao atualizar status", {
        description: err?.message || "Tente novamente.",
      });
    }
  };

  const filteredContacts = contacts.filter((c) => {
    const q = search.toLowerCase().trim();
    if (q) {
      const matchName = c.nome?.toLowerCase().includes(q);
      const matchPerfil = c.perfil?.toLowerCase().includes(q);
      const matchResumo = c.resumo?.toLowerCase().includes(q);
      if (!matchName && !matchPerfil && !matchResumo) return false;
    }

    if (statusFilter === "pending") {
      return !c.askedWhatsappAt && !c.becameLeadAt;
    }
    if (statusFilter === "asked") {
      return !!c.askedWhatsappAt && !c.becameLeadAt;
    }
    if (statusFilter === "converted") {
      return !!c.becameLeadAt;
    }

    return true;
  });

  const counts = {
    all: contacts.length,
    pending: contacts.filter((c) => !c.askedWhatsappAt && !c.becameLeadAt).length,
    asked: contacts.filter((c) => !!c.askedWhatsappAt && !c.becameLeadAt).length,
    converted: contacts.filter((c) => !!c.becameLeadAt).length,
  };

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return "-";
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return "-";
    }
  };

  return (
    <div className="space-y-4" data-testid="contacts-without-channel-section">
      {/* Header explicativo da lista manual */}
      <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 mt-0.5">
            <Instagram className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              Lista de Trabalho Manual (Instagram Direct)
              <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[11px]">
                Sem WhatsApp
              </Badge>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
              Estes contatos conversaram pelo Direct mas não enviaram o telefone durante a conversa.
              Use os botões de copiar mensagem para solicitar o WhatsApp pelo próprio Instagram.
              Eles <strong>não entram no CRM nem em campanhas automáticas</strong> até que o número seja obtido.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="text-xs gap-1.5 h-8"
          >
            <RotateCcw className="w-3 h-3" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStatusFilter("all")}
            className={`rounded-full text-xs h-8 ${
              statusFilter === "all" ? "bg-muted font-medium text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            Todos ({counts.all})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStatusFilter("pending")}
            className={`rounded-full text-xs h-8 ${
              statusFilter === "pending" ? "bg-muted font-medium text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            Pendentes de Contato ({counts.pending})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStatusFilter("asked")}
            className={`rounded-full text-xs h-8 ${
              statusFilter === "asked" ? "bg-muted font-medium text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            WhatsApp Solicitado ({counts.asked})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStatusFilter("converted")}
            className={`rounded-full text-xs h-8 ${
              statusFilter === "converted" ? "bg-muted font-medium text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            Virou Lead ({counts.converted})
          </Button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou mensagem..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 text-xs h-8"
          />
        </div>
      </div>

      {/* Conteúdo Principal / Tabela */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center p-12 space-y-3">
          <Loader2 className="w-6 h-6 text-amber-600 animate-spin" />
          <p className="text-xs text-muted-foreground">Carregando contatos do Instagram...</p>
        </div>
      ) : isError ? (
        <div className="p-8 text-center text-xs text-rose-600">
          {(error as any)?.message || "Falha ao carregar lista de contatos."}
        </div>
      ) : filteredContacts.length === 0 ? (
        <Card className="border border-dashed border-border bg-muted/10">
          <CardContent className="p-12 text-center space-y-2">
            <Instagram className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium text-foreground">Nenhum contato encontrado</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {search || statusFilter !== "all"
                ? "Tente ajustar os filtros ou a busca para encontrar os contatos."
                : "Quando você importar uma pasta do Instagram que contenha conversas sem telefone, elas aparecerão aqui para abordagem manual."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden bg-card shadow-sm">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="border-b border-border text-[10px] uppercase font-semibold text-muted-foreground">
                <TableHead className="w-[220px]">Nome & Perfil</TableHead>
                <TableHead className="min-w-[280px]">Primeira Mensagem / Dúvida</TableHead>
                <TableHead className="w-[120px]">Data Importação</TableHead>
                <TableHead className="w-[150px]">Pedi o WhatsApp?</TableHead>
                <TableHead className="w-[130px]">Virou Lead?</TableHead>
                <TableHead className="w-[160px] text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border text-xs">
              {filteredContacts.map((contact) => {
                const isAsked = !!contact.askedWhatsappAt;
                const isConverted = !!contact.becameLeadAt;
                const isCopied = copiedId === contact.id;

                return (
                  <TableRow
                    key={contact.id}
                    data-testid={`contact-row-${contact.id}`}
                    className={`hover:bg-muted/30 transition-colors ${
                      isConverted ? "bg-emerald-500/[0.02]" : isAsked ? "bg-amber-500/[0.02]" : ""
                    }`}
                  >
                    <TableCell className="py-3 font-medium">
                      <div className="space-y-0.5">
                        <div className="text-foreground flex items-center gap-1.5 font-semibold">
                          <User className="w-3.5 h-3.5 text-muted-foreground" />
                          {contact.nome}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {contact.perfil}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="py-3 max-w-[340px]">
                      {contact.resumo ? (
                        <p className="text-[11.5px] text-foreground/90 italic line-clamp-2">
                          "{contact.resumo}"
                        </p>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          Sem resumo da conversa
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="py-3 text-[11px] text-muted-foreground">
                      {formatDate(contact.createdAt)}
                    </TableCell>

                    <TableCell className="py-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`asked-${contact.id}`}
                          data-testid={`checkbox-asked-${contact.id}`}
                          checked={isAsked}
                          disabled={updateMutation.isPending}
                          onCheckedChange={() => handleToggleAsked(contact)}
                        />
                        <label
                          htmlFor={`asked-${contact.id}`}
                          className="text-xs cursor-pointer select-none"
                        >
                          {isAsked ? (
                            <span className="text-amber-700 dark:text-amber-400 font-medium">
                              Pedido {contact.askedWhatsappAt ? `(${formatDate(contact.askedWhatsappAt)})` : ""}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Pendente</span>
                          )}
                        </label>
                      </div>
                    </TableCell>

                    <TableCell className="py-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`converted-${contact.id}`}
                          data-testid={`checkbox-converted-${contact.id}`}
                          checked={isConverted}
                          disabled={updateMutation.isPending}
                          onCheckedChange={() => handleToggleBecameLead(contact)}
                        />
                        <label
                          htmlFor={`converted-${contact.id}`}
                          className="text-xs cursor-pointer select-none"
                        >
                          {isConverted ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Sim
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Não</span>
                          )}
                        </label>
                      </div>
                    </TableCell>

                    <TableCell className="py-3 text-right">
                      <Button
                        type="button"
                        variant={isCopied ? "default" : "outline"}
                        size="sm"
                        data-testid={`btn-copy-message-${contact.id}`}
                        onClick={() => handleCopyMessage(contact)}
                        className={`h-7 px-2.5 text-xs gap-1.5 transition-all ${
                          isCopied
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "border-border text-foreground hover:bg-muted"
                        }`}
                        title="Copiar mensagem pronta para envio no Direct"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3 h-3" />
                            Copiado!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-muted-foreground" />
                            Copiar Mensagem
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
