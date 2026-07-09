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
                    <Card className="border-slate-200 bg-white shadow-lg shadow-slate-200/50 rounded-3xl max-h-[600px] overflow-y-auto">
                      <CardHeader className="pb-4 border-b border-slate-100 flex flex-row items-center justify-between sticky top-0 bg-slate-50 z-20">
                        <div>
                          <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-700">Requisitos do Briefing da Agência</CardTitle>
                          <CardDescription className="text-xs text-slate-500">20 dados chaves coletados e validados pelo robô.</CardDescription>
                        </div>
                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 font-bold font-mono px-3 py-1 text-xs">
                          {briefingFields.filter(f => f.value).length} / 20 Completos
                        </Badge>
                      </CardHeader>
                      <CardContent className="p-6 space-y-4">
                        
                        <div className="grid gap-4 sm:grid-cols-2">
                          {briefingFields.map((field) => {
                            if (field.id === "publico_alvo") {
                              return (
                                <div key={field.id} className="sm:col-span-2 p-5 rounded-2xl border border-slate-200 bg-slate-50 space-y-4">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-xs font-bold text-slate-700 uppercase tracking-wider">{field.label}</Label>
                                    {field.status === "completed" ? (
                                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] font-bold flex items-center gap-1 px-2 py-0.5 h-5 shadow-sm">
                                        <Check className="h-3 w-3 text-emerald-600" />
                                        IA ({field.confidence}%)
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-200 text-slate-600 text-[10px] px-2 py-0.5 h-5 border border-slate-300 font-medium">
                                        Pendente
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="grid gap-4 sm:grid-cols-2">
                                    {field.subfields?.map((sf) => (
                                      <div key={sf.id} className="space-y-1.5">
                                        <Label className="text-[11px] text-slate-600 font-semibold">{sf.label}</Label>
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
                                          className="h-10 text-sm border-slate-300 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 text-slate-900 shadow-sm"
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
                                <div key={field.id} className="sm:col-span-2 p-5 rounded-2xl border border-slate-200 bg-slate-50 space-y-4">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-xs font-bold text-slate-700 uppercase tracking-wider">{field.label}</Label>
                                    {field.status === "completed" ? (
                                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] font-bold flex items-center gap-1 px-2 py-0.5 h-5 shadow-sm">
                                        <Check className="h-3 w-3 text-emerald-600" />
                                        IA ({field.confidence}%)
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-200 text-slate-600 text-[10px] px-2 py-0.5 h-5 border border-slate-300 font-medium">
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
                                            "text-xs font-semibold px-3 py-1.5 rounded-full border transition-all duration-200",
                                            isSelected 
                                              ? "bg-indigo-100 border-indigo-300 text-indigo-700 shadow-sm" 
                                              : "bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 shadow-sm"
                                          )}
                                        >
                                          {opt === "Outros ______________" ? "Outros" : opt}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {isProdutos && hasOutros && (
                                    <div className="space-y-1.5 mt-3 animate-fade-in-up">
                                      <Label className="text-xs text-slate-600 font-medium">Especifique os outros produtos:</Label>
                                      <Input
                                        value={outrosText}
                                        onChange={(e) => handleOutrosTextChange(e.target.value)}
                                        placeholder="Ex: Assessoria de imprensa, Tráfego para afiliados..."
                                        className="h-10 text-sm border-slate-300 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 text-slate-900 shadow-sm"
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            }

                            if (field.type === "radio") {
                              return (
                                <div key={field.id} className="space-y-1.5">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-xs font-bold text-slate-700 leading-tight">{field.label}</Label>
                                    {field.status === "completed" ? (
                                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] font-bold flex items-center gap-1 px-2 py-0.5 h-5 shadow-sm">
                                        <Check className="h-3 w-3 text-emerald-600" />
                                        IA ({field.confidence}%)
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-200 text-slate-600 text-[10px] px-2 py-0.5 h-5 border border-slate-300 font-medium">
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
                                            "flex-1 text-xs font-semibold py-2 px-3 rounded-xl border transition-all duration-200",
                                            isSelected 
                                              ? "bg-indigo-100 border-indigo-300 text-indigo-700 shadow-sm" 
                                              : "bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 shadow-sm"
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
                                <div key={field.id} className="sm:col-span-2 space-y-1.5">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-xs font-bold text-slate-700" htmlFor={field.id}>{field.label}</Label>
                                    {field.status === "completed" ? (
                                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] font-bold flex items-center gap-1 px-2 py-0.5 h-5 shadow-sm">
                                        <Check className="h-3 w-3 text-emerald-600" />
                                        IA ({field.confidence}%)
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-200 text-slate-600 text-[10px] px-2 py-0.5 h-5 border border-slate-300 font-medium">
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
                                      "w-full h-24 p-4 text-sm bg-white border border-slate-200 rounded-2xl text-slate-900 font-sans focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none leading-relaxed resize-none shadow-sm",
                                      field.status === "completed" && "border-emerald-300 bg-emerald-50 focus:border-emerald-500 focus:ring-emerald-500/10"
                                    )}
                                  />
                                </div>
                              );
                            }

                            return (
                              <div key={field.id} className="space-y-1.5">
                                <div className="flex justify-between items-center gap-1.5">
                                  <Label className="text-xs font-bold text-slate-700 leading-tight" htmlFor={field.id}>{field.label}</Label>
                                  {field.status === "completed" ? (
                                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] font-bold flex items-center gap-1 px-2 py-0.5 h-5 shadow-sm">
                                      <Check className="h-3 w-3 text-emerald-600" />
                                      IA ({field.confidence}%)
                                    </Badge>
                                  ) : (
                                    <Badge className="bg-slate-200 text-slate-600 text-[10px] px-2 py-0.5 h-5 border border-slate-300 font-medium">
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
                                    "h-10 text-sm border-slate-200 bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 text-slate-900 shadow-sm",
                                    field.status === "completed" && "border-emerald-300 bg-emerald-50 focus:border-emerald-500 focus:ring-emerald-500/10 text-emerald-900"
                                  )}
                                />
                              </div>
                            );
                          })}
                        </div>

                        {/* Send Dossier Action */}
                        <div className="pt-6 border-t border-slate-100 sticky bottom-0 bg-white p-4 -mx-6 -mb-6 shadow-[0_-4px_15px_-3px_rgba(0,0,0,0.05)] rounded-b-3xl">
                          <Button
                            onClick={handleSendBriefing}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 font-black text-sm text-white h-12 gap-2 shadow-lg shadow-emerald-600/20"
                          >
                            <FileText className="h-5 w-5" />
                            Avançar e Revisar Handoff
                          </Button>
                        </div>

                      </CardContent>
                    </Card>
                  </div>
  );
}
