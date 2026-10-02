import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import PlanoEditor from "@/components/geracaoDigital/PlanoEditor";
import FormasPagamentoEditor from "@/components/geracaoDigital/FormasPagamentoEditor";
import {
  type EditorMode,
  type ProposalEditorValues,
  totaisAoVivoDoPlano,
} from "@/lib/geracaoDigital/proposalEditorModel";

interface ProposalEditorProps {
  /** "new" = proposta ainda não existe (campos vazios); "edit" = proposta salva. O formulário é o mesmo. */
  mode: EditorMode;
  values: ProposalEditorValues;
  onChange: (patch: Partial<ProposalEditorValues>) => void;
  segmentsList: any[];
  gdProducts: any[];
  vexoProducts: any[];
  isVexoCommercial?: boolean;
  saving: boolean;
  onSave: () => void;
  /** Só ao criar: sair sem salvar. */
  onCancel?: () => void;
}

/**
 * O formulário único de proposta. "Nova Proposta" e "Editar Proposta" renderizam ESTE componente —
 * a diferença é só o `mode` (título, botão e se há "Cancelar"). Todo campo novo entra aqui uma vez.
 */
export function ProposalEditor({
  mode,
  values,
  onChange,
  segmentsList,
  gdProducts,
  vexoProducts,
  isVexoCommercial = false,
  saving,
  onSave,
  onCancel,
}: ProposalEditorProps) {
  const totais = totaisAoVivoDoPlano(values.plano);

  return (
    <div
      data-testid="proposal-editor"
      data-mode={mode}
      className="p-4 rounded-xl bg-white dark:bg-slate-800/40 border border-purple-200 dark:border-purple-900/30 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-black text-purple-700 dark:text-purple-300 uppercase tracking-wider">
          {mode === "new" ? "Nova Proposta" : "Configuração da Proposta"}
        </h4>
        {mode === "new" && onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">
            Cancelar
          </Button>
        )}
      </div>

      {/* Identificação: nome, segmento (roteiro da apresentação) e logo do cliente. */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="proposal-prospect-name" className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
            Nome da empresa (aparece na apresentação) *
          </Label>
          <input
            id="proposal-prospect-name"
            type="text"
            value={values.prospectName}
            onChange={(e) => onChange({ prospectName: e.target.value })}
            placeholder="Ex.: Clínica Dr. Diogo Teodoro"
            className="block w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-2 h-8 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="proposal-segment" className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
            Segmento (roteiro da apresentação)
          </Label>
          <select
            id="proposal-segment"
            value={values.segmentId}
            onChange={(e) => {
              onChange({ segmentId: e.target.value, ...(e.target.value !== "custom" ? { customSegment: "" } : {}) });
            }}
            className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-2 h-8 text-xs text-slate-800 dark:text-white focus:outline-none"
          >
            <option value="">Selecione o segmento…</option>
            <option value="custom" className="font-bold text-purple-600 dark:text-purple-400">
              ✨ Outro Segmento (Personalizado com IA)...
            </option>
            {(() => {
              const allSegs = [...segmentsList];
              if (!allSegs.some((s) => String(s.nome).toLowerCase().includes("turismo"))) {
                allSegs.push({ id: "turismo", nome: "Agências de Turismo & Viagens" });
              }
              if (!allSegs.some((s) => String(s.nome).toLowerCase().includes("cafeteria") || String(s.nome).toLowerCase().includes("café"))) {
                allSegs.push({ id: "cafeteria", nome: "Cafeterias, Bistrôs & Cafés Especiais" });
              }
              allSegs.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
              return allSegs.map((sg: any) => (
                <option key={sg.id} value={sg.id}>
                  {sg.nome}
                </option>
              ));
            })()}
          </select>
          {values.segmentId === "custom" && (
            <input
              type="text"
              aria-label="Segmento personalizado"
              value={values.customSegment}
              onChange={(e) => onChange({ customSegment: e.target.value })}
              placeholder="Digite o nicho livre..."
              className="block w-64 bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-800 rounded-lg px-2 h-8 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-500 mt-1"
            />
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Logo do cliente</Label>
          <div className="flex items-center gap-2">
            {values.prospectLogo && (
              <img src={values.prospectLogo} alt="logo" className="h-8 w-8 rounded object-contain border border-slate-200 dark:border-slate-700 bg-white" />
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => onChange({ prospectLogo: reader.result as string });
                reader.readAsDataURL(file);
              }}
              className="text-[10px] text-slate-500 dark:text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-indigo-50 file:px-2 file:py-0.5 file:text-indigo-600 file:text-[10px]"
            />
            {values.prospectLogo && (
              <button type="button" onClick={() => onChange({ prospectLogo: null })} className="text-[10px] text-slate-500 hover:underline">
                Remover
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Alavancas de negociação, prazos de validade e cobrança. */}
      <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-slate-100 dark:border-white/5">
        <div className="space-y-1">
          <Label htmlFor="proposal-mensalidade-negociada" className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
            Mensalidade negociada (R$)
          </Label>
          <Input
            id="proposal-mensalidade-negociada"
            type="number"
            placeholder="usa o pacote"
            value={values.mensalidadeNegociada === 0 ? "" : values.mensalidadeNegociada}
            onChange={(e) => onChange({ mensalidadeNegociada: e.target.value === "" ? 0 : Number(e.target.value) })}
            className="bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 text-xs h-8 w-44 font-mono"
          />
          <span className="block text-[9px] text-slate-450">
            Vazio = usa o preço do pacote. Preenchido, vence o catálogo só nesta proposta.
          </span>
        </div>
        <div className="space-y-1">
          <Label htmlFor="proposal-carencia" className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
            Carência do 1º vencimento
          </Label>
          <select
            id="proposal-carencia"
            value={values.carencia}
            onChange={(e) => onChange({ carencia: e.target.value })}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded px-2 text-xs text-slate-850 dark:text-white h-8"
          >
            <option value="">Imediato (na contratação)</option>
            <option value="15">15 dias</option>
            <option value="20">20 dias</option>
            <option value="30">30 dias</option>
          </select>
          <span className="block text-[9px] text-slate-450">Não altera valores — só a data.</span>
        </div>
        <div className="space-y-1">
          <Label htmlFor="proposal-validade" className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
            Validade da proposta
          </Label>
          <Input
            id="proposal-validade"
            type="date"
            value={values.validadeAte}
            onChange={(e) => onChange({ validadeAte: e.target.value })}
            className="bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 text-xs h-8 w-40"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="proposal-payment-link" className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
            Link de checkout / pagamento (opcional)
          </Label>
          <Input
            id="proposal-payment-link"
            value={values.paymentLink}
            onChange={(e) => onChange({ paymentLink: e.target.value })}
            placeholder="https://checkout.vexo.com.br/proposta"
            className="bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 text-xs h-8 w-72"
          />
        </div>
      </div>

      {/* Formas de pagamento fixas. Os valores de parcela vêm do plano na tela (não do pacote já
          salvo), para valerem também ao criar, quando ainda não há pacote. */}
      <div className="pt-3 border-t border-slate-100 dark:border-white/5">
        <FormasPagamentoEditor
          formas={values.formas}
          onChange={(formas) => onChange({ formas })}
          totalSetup={totais.setupFinal}
          mensalidade={totais.mensalidadeFinal}
          meses={totais.mesesPeriodo}
          condicaoEspecialTexto={values.condicoesEspeciais}
          onCondicaoEspecialChange={(condicoesEspeciais) => onChange({ condicoesEspeciais })}
          esconderValores={values.esconderValores}
          onEsconderValoresChange={(esconderValores) => onChange({ esconderValores })}
        />
      </div>

      {/* Plano: escopo × prazos, descontos e setup. */}
      <div className="pt-3 border-t border-slate-100 dark:border-white/5 space-y-3">
        <PlanoEditor
          plano={values.plano}
          onChange={(novoPlano) => {
            const setupVal = Number((novoPlano as any).valorSetupVexo ?? (novoPlano as any).valor_setup_vexo ?? 0);
            onChange({ plano: novoPlano, valorSetupVexo: setupVal, cobrarSetup: setupVal > 0 });
          }}
          gdProducts={gdProducts}
          vexoProducts={vexoProducts}
          isVexoCommercial={isVexoCommercial}
        />
      </div>

      {/* Um botão só: aplica o plano e grava a proposta. */}
      <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-white/5">
        <Button size="sm" disabled={saving} onClick={onSave} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs">
          {saving ? "Salvando..." : mode === "new" ? "Criar Proposta" : "Salvar Configuração"}
        </Button>
      </div>
    </div>
  );
}

export default ProposalEditor;
