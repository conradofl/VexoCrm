import { Sparkles, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { COLOR_PRESETS, type ColorPreset } from "@/lib/appSidebar/constants";

// ─── BrandCustomizer ──────────────────────────────────────────────────────────
// Modal "Personalizar Marca": logo, nome do workspace e cor temática.
function BrandCustomizer({
  logo,
  title,
  color,
  selectedPreset,
  onClose,
  onColorSelect,
  onLogoUpload,
  onSaveBrand,
  onResetBrand,
}: {
  logo: string | null;
  title: string | null;
  color: string | null;
  selectedPreset: ColorPreset;
  onClose: () => void;
  onColorSelect: (key: string) => void;
  onLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSaveBrand: (newTitle: string, newColor: string) => void;
  onResetBrand: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900/95 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-3">
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-cyan-500" />
            Personalizar Marca
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-slate-100 dark:hover:bg-white/5 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 py-2">
          {/* Logo Upload */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Logo da Empresa</label>
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5",
                  !logo && "bg-gradient-to-br"
                )}
                style={!logo ? { backgroundImage: `linear-gradient(135deg, ${selectedPreset.from}, ${selectedPreset.to})` } : undefined}
              >
                {logo ? (
                  <img src={logo} alt="Preview" className="h-full w-full rounded-xl object-cover" />
                ) : (
                  <span className="text-lg font-black text-white">
                    {(title || "Vexo OS")[0]?.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-grow">
                <input
                  type="file"
                  id="brand-logo-file"
                  accept="image/png, image/jpeg"
                  onChange={onLogoUpload}
                  className="hidden"
                />
                <label
                  htmlFor="brand-logo-file"
                  className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Fazer Upload
                </label>
                <p className="mt-1 text-[10px] text-muted-foreground">PNG ou JPEG até 1MB</p>
              </div>
            </div>
          </div>

          {/* Workspace Title */}
          <div className="space-y-1.5">
            <label htmlFor="brand-title-input" className="text-xs font-semibold text-slate-500 dark:text-slate-400">Nome do Workspace</label>
            <input
              type="text"
              id="brand-title-input"
              placeholder="Vexo OS"
              defaultValue={title || "Vexo OS"}
              className="w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-foreground outline-none focus:border-cyan-500 dark:border-white/10 dark:bg-white/5"
            />
          </div>

          {/* Accent Color Presets */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Cor Temática Principal</label>
            <div className="flex gap-2">
              {Object.entries(COLOR_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onColorSelect(key)}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-all hover:scale-105",
                    (color || "default") === key ? "border-slate-800 dark:border-white" : "border-transparent"
                  )}
                  style={{ backgroundImage: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }}
                  title={preset.label}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end border-t border-slate-100 dark:border-white/5 pt-3">
          <button
            type="button"
            onClick={onResetBrand}
            className="rounded-xl px-3 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
          >
            Restaurar Padrão
          </button>
          <button
            type="button"
            onClick={() => {
              const input = document.getElementById("brand-title-input") as HTMLInputElement;
              onSaveBrand(input.value || "Vexo OS", color || "default");
            }}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-white/90"
          >
            Salvar Marca
          </button>
        </div>
      </div>
    </div>
  );
}

export { BrandCustomizer };
