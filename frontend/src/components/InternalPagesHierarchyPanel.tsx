import { INTERNAL_PAGE_HIERARCHY } from "@/lib/INTERNAL_PAGE_HIERARCHY";
import { InternalPage, INTERNAL_PAGE_ORDER } from "@/lib/access";

interface Props {
  selected: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}

export function InternalPagesHierarchyPanel({ selected, disabled, onChange }: Props) {
  const isSelected = (key: string) => selected.includes(key);

  const handleToggleKey = (key: string, isChecked: boolean, allChildren?: string[]) => {
    let current = [...selected];
    if (isChecked) {
      if (!current.includes(key)) current.push(key);
      if (allChildren) {
        allChildren.forEach((child) => {
          if (!current.includes(child)) current.push(child);
        });
      }
    } else {
      current = current.filter((k) => k !== key);
      if (allChildren) {
        current = current.filter((k) => !allChildren.includes(k));
      }
    }
    onChange(current);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 pt-1">
      {INTERNAL_PAGE_HIERARCHY.map((module) => (
        <div
          key={module.key}
          className="space-y-3 p-3 rounded-lg border border-slate-200/80 bg-white dark:border-white/5 dark:bg-black/20"
        >
          <h5 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            {module.label}
          </h5>
          <div className="space-y-3.5">
            {module.children.map((tab) => {
              const childrenKeys = tab.children ? tab.children.map(c => c.key) : [];
              return (
                <div key={tab.key} className="space-y-1.5">
                  <label className={`inline-flex items-center gap-2 text-xs font-semibold text-foreground select-none ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      disabled={disabled}
                      className="rounded border-slate-300 dark:border-white/10 text-cyan-600 focus:ring-cyan-500 disabled:opacity-50"
                      checked={isSelected(tab.key)}
                      onChange={(e) => handleToggleKey(tab.key, e.target.checked, childrenKeys)}
                    />
                    {tab.label}
                  </label>

                  {tab.children && tab.children.length > 0 && (
                    <div className="pl-4 border-l border-slate-100 dark:border-white/5 space-y-1.5 ml-1.5 mt-1">
                      {tab.children.map((subTab) => (
                        <label
                          key={subTab.key}
                          className={`inline-flex items-center gap-2 text-[11px] select-none ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${
                            !isSelected(tab.key) ? "opacity-50" : "text-foreground"
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={disabled || !isSelected(tab.key)}
                            className="rounded border-slate-300 dark:border-white/10 text-cyan-600 focus:ring-cyan-500 disabled:opacity-50"
                            checked={isSelected(subTab.key)}
                            onChange={(e) => handleToggleKey(subTab.key, e.target.checked)}
                          />
                          {subTab.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
