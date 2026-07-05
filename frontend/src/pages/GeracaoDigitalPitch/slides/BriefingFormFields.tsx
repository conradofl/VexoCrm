import type { Dispatch, SetStateAction } from "react";
import { Check, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BriefingField } from "@/lib/geracaoDigital/types";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — coluna direita do Slide 5 (formulário dinâmico de 20 campos), movimento puro.
interface BriefingFormFieldsProps {
  briefingFields: BriefingField[];
  setBriefingFields: Dispatch<SetStateAction<BriefingField[]>>;
  handleSendBriefing: () => void;
}

export function BriefingFormFields({ briefingFields, setBriefingFields, handleSendBriefing }: BriefingFormFieldsProps) {
  return (
                  <div className="md:col-span-3">
                    <Card className="border-white/5 bg-slate-900/30 backdrop-blur-md max-h-[500px] overflow-y-auto">
                      <CardHeader className="pb-3 border-b border-white/5 flex flex-row items-center justify-between sticky top-0 bg-slate-900/80 backdrop-blur z-20">
                        <div>
                          <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">Requisitos do Briefing da Agência</CardTitle>
                          <CardDescription className="text-[10px]">20 dados chaves coletados e validados pelo robô.</CardDescription>
                        </div>
                        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-bold font-mono">
                          {briefingFields.filter(f => f.value).length} / 20 Completos
                        </Badge>
                      </CardHeader>
                      <CardContent className="p-6 space-y-4">
                        
                        <div className="grid gap-4 sm:grid-cols-2">
                          {briefingFields.map((field) => {
                            if (field.id === "publico_alvo") {
                              return (
                                <div key={field.id} className="sm:col-span-2 p-4 rounded-xl border border-white/5 bg-slate-950/40 space-y-3">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">{field.label}</Label>
                                    {field.status === "completed" ? (
                                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px] font-bold flex items-center gap-0.5 px-1 py-0 h-4">
                                        <Check className="h-2.5 w-2.5 text-emerald-400" />
                                        IA ({field.confidence}%)
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-950 text-slate-500 text-[8px] px-1 py-0 h-4 border border-white/5">
                                        Pendente
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    {field.subfields?.map((sf) => (
                                      <div key={sf.id} className="space-y-1">
                                        <Label className="text-[10px] text-slate-400 font-medium">{sf.label}</Label>
                                        <Input
                                          value={sf.value}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setBriefingFields((prev) =>
                                              prev.map((f) => {
                                                if (f.id === "publico_alvo") {
                                                  const updatedSub = f.subfields?.map((s) => s.id === sf.id ? { ...s, value: val } : s) || [];
                                                  const anyVal = updatedSub.some((s) => s.value.trim());
                                                  const summary = updatedSub.filter((s) => s.value).map((s) => `${s.label}: ${s.value}`).join(" | ");
                                                  return {
                                                    ...f,
                                                    subfields: updatedSub,
                                                    value: anyVal ? summary : "",
                                                    status: anyVal ? "completed" : "pending"
                                                  };
                                                }
                                                return f;
                                              })
                                            );
                                          }}
                                          placeholder={`Defina ${sf.label.toLowerCase()}`}
                                          className="h-8 text-xs border-white/5 bg-slate-950/60 focus:border-indigo-500/50 text-slate-200"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            }

                            if (field.type === "checkboxes") {
                              const selectedList = field.value ? field.value.split(", ").map(x => x.trim()) : [];
                              const isProdutos = field.id === "produtos";
                              const outrosItem = selectedList.find(x => x.startsWith("Outros:") || x.toLowerCase().startsWith("outros"));
                              const hasOutros = !!outrosItem;
                              const outrosText = outrosItem ? (outrosItem.includes(":") ? outrosItem.split(":")[1].trim() : outrosItem.replace(/outros/i, "").trim()) : "";

                              const handleToggleProduct = (option: string) => {
                                let newList = [...selectedList];
                                if (newList.includes(option)) {
                                  newList = newList.filter(x => x !== option);
                                } else {
                                  newList.push(option);
                                }
                                newList = newList.filter(Boolean);
                                const joined = newList.join(", ");
                                setBriefingFields((prev) =>
                                  prev.map((f) => f.id === field.id ? { ...f, value: joined, status: joined ? "completed" : "pending" } : f)
                                );
                              };

                              const handleOutrosTextChange = (text: string) => {
                                let newList = selectedList.filter(x => !x.startsWith("Outros:") && !x.toLowerCase().startsWith("outros"));
                                if (text.trim()) {
                                  newList.push(`Outros: ${text.trim()}`);
                                } else {
                                  newList.push("Outros");
                                }
                                const joined = newList.join(", ");
                                setBriefingFields((prev) =>
                                  prev.map((f) => f.id === "produtos" ? { ...f, value: joined, status: joined ? "completed" : "pending" } : f)
                                );
                              };

                              return (
                                <div key={field.id} className="sm:col-span-2 p-4 rounded-xl border border-white/5 bg-slate-950/40 space-y-3">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">{field.label}</Label>
                                    {field.status === "completed" ? (
                                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px] font-bold flex items-center gap-0.5 px-1 py-0 h-4">
                                        <Check className="h-2.5 w-2.5 text-emerald-400" />
                                        IA ({field.confidence}%)
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-950 text-slate-500 text-[8px] px-1 py-0 h-4 border border-white/5">
                                        Pendente
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {field.options?.map((opt) => {
                                      const isSelected = selectedList.includes(opt) || (opt === "Outros ______________" && hasOutros);
                                      return (
                                        <button
                                          key={opt}
                                          type="button"
                                          onClick={() => {
                                            if (opt === "Outros ______________") {
                                              if (hasOutros) {
                                                const newList = selectedList.filter(x => !x.startsWith("Outros:") && !x.toLowerCase().startsWith("outros"));
                                                const joined = newList.join(", ");
                                                setBriefingFields((prev) =>
                                                  prev.map((f) => f.id === field.id ? { ...f, value: joined, status: joined ? "completed" : "pending" } : f)
                                                );
                                              } else {
                                                handleToggleProduct("Outros");
                                              }
                                            } else {
                                              handleToggleProduct(opt);
                                            }
                                          }}
                                          className={cn(
                                            "text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-all duration-200",
                                            isSelected 
                                              ? "bg-indigo-600/20 border-indigo-500 text-indigo-300 shadow-md shadow-indigo-600/10" 
                                              : "bg-slate-900 border-white/5 text-slate-400 hover:text-slate-300 hover:bg-slate-800"
                                          )}
                                        >
                                          {opt === "Outros ______________" ? "Outros" : opt}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {isProdutos && hasOutros && (
                                    <div className="space-y-1 mt-2 animate-fade-in-up">
                                      <Label className="text-[10px] text-slate-400 font-mono">Especifique os outros produtos:</Label>
                                      <Input
                                        value={outrosText}
                                        onChange={(e) => handleOutrosTextChange(e.target.value)}
                                        placeholder="Ex: Assessoria de imprensa, Tráfego para afiliados..."
                                        className="h-8 text-xs border-white/5 bg-slate-950/60 focus:border-indigo-500/50 text-slate-200"
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            }

                            if (field.type === "radio") {
                              return (
                                <div key={field.id} className="space-y-1">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-[11px] font-bold text-slate-300 leading-tight">{field.label}</Label>
                                    {field.status === "completed" ? (
                                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px] font-bold flex items-center gap-0.5 px-1 py-0 h-4">
                                        <Check className="h-2.5 w-2.5 text-emerald-400" />
                                        IA ({field.confidence}%)
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-950 text-slate-500 text-[8px] px-1 py-0 h-4 border border-white/5">
                                        Pendente
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex gap-2">
                                    {field.options?.map((opt) => {
                                      const isSelected = field.value === opt;
                                      return (
                                        <button
                                          key={opt}
                                          type="button"
                                          onClick={() => {
                                            setBriefingFields((prev) =>
                                              prev.map((f) => f.id === field.id ? { ...f, value: opt, status: "completed", confidence: 99 } : f)
                                            );
                                          }}
                                          className={cn(
                                            "flex-1 text-[10px] font-semibold py-1.5 px-2.5 rounded-lg border transition-all duration-200",
                                            isSelected 
                                              ? "bg-indigo-600/20 border-indigo-500 text-indigo-300" 
                                              : "bg-slate-950/60 border-white/5 text-slate-400 hover:text-slate-300 hover:bg-slate-900"
                                          )}
                                        >
                                          {opt}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            }

                            if (field.type === "textarea") {
                              return (
                                <div key={field.id} className="sm:col-span-2 space-y-1">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-[11px] font-bold text-slate-300" htmlFor={field.id}>{field.label}</Label>
                                    {field.status === "completed" ? (
                                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px] font-bold flex items-center gap-0.5 px-1 py-0 h-4">
                                        <Check className="h-2.5 w-2.5 text-emerald-400" />
                                        IA ({field.confidence}%)
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-950 text-slate-500 text-[8px] px-1 py-0 h-4 border border-white/5">
                                        Pendente
                                      </Badge>
                                    )}
                                  </div>
                                  <textarea
                                    id={field.id}
                                    value={field.value}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setBriefingFields((prev) =>
                                        prev.map((f) => (f.id === field.id ? { ...f, value: val, status: val ? "completed" : "pending" } : f))
                                      );
                                    }}
                                    placeholder={field.placeholder}
                                    className={cn(
                                      "w-full h-20 p-3 text-xs bg-slate-950/80 border border-white/5 rounded-xl text-slate-200 font-sans focus:border-indigo-500/50 outline-none leading-relaxed resize-none",
                                      field.status === "completed" && "border-emerald-500/20 bg-emerald-950/5 focus:border-emerald-500/50"
                                    )}
                                  />
                                </div>
                              );
                            }

                            return (
                              <div key={field.id} className="space-y-1">
                                <div className="flex justify-between items-center gap-1.5">
                                  <Label className="text-[11px] font-bold text-slate-300 leading-tight" htmlFor={field.id}>{field.label}</Label>
                                  {field.status === "completed" ? (
                                    <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px] font-bold flex items-center gap-0.5 px-1 py-0 h-4">
                                      <Check className="h-2.5 w-2.5 text-emerald-400" />
                                      IA ({field.confidence}%)
                                    </Badge>
                                  ) : (
                                    <Badge className="bg-slate-950 text-slate-500 text-[8px] px-1 py-0 h-4 border border-white/5">
                                      Pendente
                                    </Badge>
                                  )}
                                </div>
                                <Input
                                  id={field.id}
                                  value={field.value}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setBriefingFields((prev) =>
                                      prev.map((f) => (f.id === field.id ? { ...f, value: val, status: val ? "completed" : "pending" } : f))
                                    );
                                  }}
                                  placeholder={field.placeholder}
                                  className={cn(
                                    "h-8 text-xs border-white/5 bg-slate-950/60 transition-colors focus:border-indigo-500/50 text-slate-200",
                                    field.status === "completed" && "border-emerald-500/20 bg-emerald-950/5 focus:border-emerald-500/50"
                                  )}
                                />
                              </div>
                            );
                          })}
                        </div>

                        {/* Send Dossier Action */}
                        <div className="pt-4 border-t border-white/5 flex justify-end">
                          <Button
                            onClick={handleSendBriefing}
                            className="bg-emerald-600 hover:bg-emerald-500 font-extrabold text-xs text-white h-9 px-6 gap-2"
                          >
                            <FileText className="h-4 w-4" />
                            Enviar Dossiê & Disparar Handoff
                          </Button>
                        </div>

                      </CardContent>
                    </Card>
                  </div>
  );
}
