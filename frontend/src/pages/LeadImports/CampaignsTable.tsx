import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/leadImports/spreadsheet";
import type { Campaign } from "@/hooks/useCampanhas";

interface CampaignsTableProps {
  campaigns: Campaign[];
  loadingCampaigns: boolean;
  onEditCampaign: (campaign: Campaign) => void;
  onDeleteCampaign: (campaign: Campaign) => void;
}

export function CampaignsTable({ campaigns, loadingCampaigns, onEditCampaign, onDeleteCampaign }: CampaignsTableProps) {
  return (
    <Card className="border-border bg-card shadow-lg text-card-foreground rounded-2xl">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base font-bold">Campanhas Configuradas</CardTitle>
          <CardDescription>Clique para editar as mensagens ou excluir as réguas</CardDescription>
        </div>
        <input
          className="h-9 w-44 rounded-xl border border-border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="Buscar campanha..."
          onChange={(e) => {
            // local filter or query triggers could go here
          }}
        />
      </CardHeader>
      <CardContent className="p-0">
        {loadingCampaigns ? (
          <div className="p-6 text-center text-xs text-muted-foreground animate-pulse">Carregando dados das campanhas...</div>
        ) : campaigns.length === 0 ? (
          <div className="p-8">
            <EmptyState title="Nenhuma campanha encontrada" description="Use o Novo Disparo para registrar a primeira campanha por planilha." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200/60 dark:border-white/5">
                  <TableHead className="px-6 py-4 text-xs font-semibold uppercase font-display">Campanha</TableHead>
                  <TableHead className="px-4 py-4 text-xs font-semibold uppercase font-display text-center">Modo</TableHead>
                  <TableHead className="px-4 py-4 text-xs font-semibold uppercase font-display text-center">Leads por Lote</TableHead>
                  <TableHead className="px-4 py-4 text-xs font-semibold uppercase font-display">Criada Em</TableHead>
                  <TableHead className="px-6 py-4 text-xs font-semibold uppercase font-display text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id} className="border-border hover:bg-muted/10">
                    <TableCell className="px-6 py-4">
                      <p className="text-sm font-bold text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.client_name ?? "Empresa padrão"} · {c.import_id ? "Base importada" : "Geral"}</p>
                    </TableCell>
                    <TableCell className="px-4 py-4 text-center">
                      <span className={cn("inline-block rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase", c.mode === "agente" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-border/50 text-slate-500")}>
                        {c.mode === "agente" ? "Agente IA" : "Disparo Direto"}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-4 text-center text-sm font-semibold">{c.limit_per_run}</TableCell>
                    <TableCell className="px-4 py-4 text-xs text-muted-foreground">{formatDateTime(c.created_at)}</TableCell>
                    <TableCell className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-8 w-8 p-0" title="Editar" onClick={() => onEditCampaign(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-rose-500 border-rose-200/40 hover:bg-rose-50 dark:hover:bg-rose-950/20" title="Excluir" onClick={() => void onDeleteCampaign(c)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
