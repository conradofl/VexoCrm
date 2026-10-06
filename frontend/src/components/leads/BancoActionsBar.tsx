import {
  Bot,
  CalendarClock,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Instagram,
  MessageCircle,
  Plus,
  RefreshCw,
  Rocket,
  ScanSearch,
  Upload,
  ChevronDown,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LeadBulkActions } from "@/components/leads/LeadBulkActions";

interface BancoActionsBarProps {
  loading: boolean;
  onRefresh: () => void;
  // 1) o que TRAZ dado
  onExtractWhatsApp: () => void;
  onImportInstagram: () => void;
  onPasteText: () => void;
  onImportSpreadsheet: () => void;
  onManageSpreadsheets?: () => void;
  // 2) o que LEVA dado
  onExportXLSX: () => void;
  onExportCSV: () => void;
  // 3) o que AGE sobre a base
  onCreateCampaign: () => void;
  onNewLead: () => void;
  selectedCount: number;
  onApplyFollowup: () => void;
  onSingleReminder: () => void;
  // 4) a exclusão, separada
  clientId: string;
  canManageBulk: boolean;
}

/**
 * Barra de ações do Banco de Dados, agrupada por função, nesta ordem:
 *   traz dado (Extrair ▾ + Importar planilha) → leva dado (Exportar leads ▾) → age sobre a base
 *   (Criar campanha, Novo lead) → por último, afastada e discreta, a exclusão por tag.
 * "Atualizar" continua onde estava, no começo. Apagar leads em massa nunca fica ao lado de criar um.
 */
export function BancoActionsBar(props: BancoActionsBarProps) {
  const {
    loading,
    onRefresh,
    onExtractWhatsApp,
    onImportInstagram,
    onPasteText,
    onImportSpreadsheet,
    onManageSpreadsheets,
    onExportXLSX,
    onExportCSV,
    onCreateCampaign,
    onNewLead,
    selectedCount,
    onApplyFollowup,
    onSingleReminder,
    clientId,
    canManageBulk,
  } = props;

  return (
    <div data-testid="banco-actions-bar" className="flex w-full flex-wrap items-center gap-x-5 gap-y-2">
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-2 text-xs">
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        Atualizar
      </Button>

      {/* 1) Traz dado */}
      <div data-group="traz" className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="default" size="sm" data-testid="btn-extract-menu" className="gap-2 bg-emerald-600 text-xs text-white hover:bg-emerald-700">
              <ScanSearch className="w-3.5 h-3.5" />
              Extrair
              <ChevronDown className="w-3 h-3 opacity-80" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem data-testid="extract-whatsapp" onClick={onExtractWhatsApp} className="cursor-pointer gap-2 text-xs">
              <MessageCircle className="w-4 h-4 text-emerald-600" />
              Extrair do WhatsApp (QR Code)
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="extract-instagram" onClick={onImportInstagram} className="cursor-pointer gap-2 text-xs">
              <Instagram className="w-4 h-4 text-pink-500" />
              Importar do Instagram
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="extract-text" onClick={onPasteText} className="cursor-pointer gap-2 text-xs">
              <Bot className="w-4 h-4 text-purple-500" />
              Colar texto avulso (chat / e-mail)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="sm" data-testid="btn-import-spreadsheet" onClick={onImportSpreadsheet} className="gap-2 text-xs">
          <Upload className="w-3.5 h-3.5" />
          Importar planilha
        </Button>

        {onManageSpreadsheets && (
          <Button variant="outline" size="sm" data-testid="btn-manage-spreadsheets" onClick={onManageSpreadsheets} className="gap-2 text-xs">
            <Database className="w-3.5 h-3.5" />
            Planilhas salvas
          </Button>
        )}
      </div>

      {/* 2) Leva dado */}
      <div data-group="leva" className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="btn-export-menu" className="gap-2 text-xs">
              <Download className="w-3.5 h-3.5" />
              Exportar leads
              <ChevronDown className="w-3 h-3 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={onExportXLSX} className="cursor-pointer gap-2 text-xs">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              Exportar Excel (.xlsx)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportCSV} className="cursor-pointer gap-2 text-xs">
              <FileText className="w-4 h-4 text-blue-600" />
              Exportar CSV (.csv)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 3) Age sobre a base */}
      <div data-group="age" className="flex flex-wrap items-center gap-2">
        <Button variant="default" size="sm" data-testid="btn-create-campaign" onClick={onCreateCampaign} className="gap-2 bg-amber-600 text-xs text-white hover:bg-amber-700">
          <Rocket className="w-3.5 h-3.5" />
          Criar campanha
        </Button>

        {selectedCount > 0 && (
          <>
            <Button variant="default" size="sm" onClick={onApplyFollowup} className="gap-2 bg-emerald-600 text-xs text-white hover:bg-emerald-700">
              <CalendarClock className="w-3.5 h-3.5" />
              Aplicar Follow-up ({selectedCount})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onSingleReminder}
              className="gap-1.5 border-emerald-600/40 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
            >
              <Clock className="w-3.5 h-3.5 text-emerald-500" />
              Lembrete avulso
            </Button>
          </>
        )}

        <Button variant="default" size="sm" data-testid="btn-new-lead" onClick={onNewLead} className="gap-2 bg-indigo-600 text-xs text-white hover:bg-indigo-700">
          <Plus className="w-3.5 h-3.5" />
          Novo lead
        </Button>
      </div>

      {/* 4) Por último, separada e discreta: a exclusão em massa */}
      {canManageBulk && (
        <>
          <span role="separator" aria-orientation="vertical" className="ml-auto hidden h-6 w-px bg-border sm:block" />
          <div data-group="exclui" className="flex items-center">
            <LeadBulkActions clientId={clientId} canManage={canManageBulk} />
          </div>
        </>
      )}
    </div>
  );
}
