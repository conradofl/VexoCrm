import { X, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TeamMember } from "@/lib/geracaoDigital/types";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — drawer de detalhe do membro no Slide 3, movimento puro.
interface MemberDetailModalProps {
  member: TeamMember;
  onClose: () => void;
}

export function MemberDetailModal({ member: selectedMember, onClose }: MemberDetailModalProps) {
  return (
                  <div className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <Card className="max-w-md w-full border-white/10 bg-slate-900 text-white relative overflow-hidden animate-fade-in-up">
                      <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-violet-600 to-indigo-500" />
                      <button 
                        onClick={() => onClose()}
                        className="absolute top-4 right-4 text-slate-400 hover:text-white"
                      >
                        <X className="h-5 w-5" />
                      </button>
                      <CardHeader className="pt-6">
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-extrabold text-sm text-white">
                            {selectedMember.name.split(" ").map(n => n[0]).join("")}
                          </div>
                          <div>
                            <CardTitle className="text-base font-black text-white">{selectedMember.name}</CardTitle>
                            <CardDescription className="text-xs text-indigo-400 font-semibold">{selectedMember.role}</CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4 text-xs">
                        <p className="text-slate-300 leading-relaxed bg-slate-950/30 p-3 rounded-lg border border-white/5">{selectedMember.bio}</p>
                        
                        <div className="space-y-1.5">
                          <span className="font-bold text-slate-400 uppercase text-[9px] font-mono tracking-wider">Responsabilidade na Conta</span>
                          <ul className="space-y-1 text-slate-300">
                            {selectedMember.responsibilities.map((r, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                <span>{r}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="space-y-1.5">
                          <span className="font-bold text-slate-400 uppercase text-[9px] font-mono tracking-wider">Ferramentas de Trabalho</span>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedMember.tools.map((t, i) => (
                              <Badge key={i} className="bg-white/5 border-white/5 text-slate-300 text-[10px] font-mono">{t}</Badge>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
  );
}
