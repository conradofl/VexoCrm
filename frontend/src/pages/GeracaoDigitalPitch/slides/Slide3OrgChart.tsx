import { Badge } from "@/components/ui/badge";
import { MemberNode } from "../MemberNode";
import { MemberDetailModal } from "../MemberDetailModal";
import type { TeamMember } from "@/lib/geracaoDigital/types";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — Slide 3 (organograma interativo), movimento puro.
interface Slide3OrgChartProps {
  team: TeamMember[];
  selectedMember: TeamMember | null;
  onSelectMember: (member: TeamMember) => void;
  onCloseMemberDetail: () => void;
}

export function Slide3OrgChart({ team, selectedMember, onSelectMember, onCloseMemberDetail }: Slide3OrgChartProps) {
  return (
              <div className="max-w-7xl w-full space-y-6 animate-fade-in-up">
                <div className="text-center space-y-3">
                  <Badge className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 text-xs px-4 py-1.5 uppercase tracking-wider font-mono">
                    Slide 03 · Estrutura Organizacional Interativa
                  </Badge>
                  <h2 className="text-3xl md:text-5xl font-black text-white">Nossa Equipe de Performance</h2>
                  <p className="text-xs md:text-sm text-slate-400 max-w-2xl mx-auto">
                    Conheça os especialistas que farão o motor digital da sua empresa rodar. Clique sobre um profissional para inspecionar suas atribuições e ferramentas.
                  </p>
                </div>

                {/* The Tech Organogram Tree */}
                <div className="relative border border-white/5 bg-slate-950/80 p-8 rounded-3xl overflow-x-auto">
                  <div className="w-full max-w-[1200px] mx-auto pb-32">
                    
                    {/* Level 1 Horizontal Connect Bar */}
                    <div className="relative w-full mt-4">
                      <div className="absolute top-0 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-cyan-500 via-indigo-500 to-pink-500" />
                    </div>

                    {/* Four Main Columns Grid */}
                    <div className="grid grid-cols-4 gap-6 pt-6">
                      
                      {/* Column 1: Comercial (Caio) */}
                      <div className="flex flex-col items-center">
                        <div className="h-6 w-px bg-cyan-500/40 -mt-6" />
                        {<MemberNode team={team} memberId="caio" size="md" onSelect={onSelectMember} />}
                        
                        <div className="h-8 w-px bg-cyan-500/40" />
                        
                        <div className="relative w-full">
                          <div className="absolute top-0 left-[25%] right-[25%] h-px bg-cyan-500/40" />
                          <div className="grid grid-cols-2 gap-4 pt-6">
                            <div className="flex flex-col items-center">
                              <div className="h-6 w-px bg-cyan-500/40 -mt-6" />
                              {<MemberNode team={team} memberId="priscila" size="sm" onSelect={onSelectMember} />}
                            </div>
                            <div className="flex flex-col items-center">
                              <div className="h-6 w-px bg-cyan-500/40 -mt-6" />
                              {<MemberNode team={team} memberId="gabriel" size="sm" onSelect={onSelectMember} />}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Column 2: IA (Conrado) */}
                      <div className="flex flex-col items-center">
                        <div className="h-6 w-px bg-purple-500/40 -mt-6" />
                        {<MemberNode team={team} memberId="conrado" size="md" onSelect={onSelectMember} />}
                        
                        <div className="h-8 w-px bg-purple-500/40" />
                        <div className="flex flex-col items-center">
                          {<MemberNode team={team} memberId="luiz_felipe" size="sm" onSelect={onSelectMember} />}
                        </div>
                      </div>

                      {/* Column 3: Atendimento (Aline) */}
                      <div className="flex flex-col items-center">
                        <div className="h-6 w-px bg-indigo-500/40 -mt-6" />
                        {<MemberNode team={team} memberId="aline" size="md" onSelect={onSelectMember} />}
                        
                        <div className="h-8 w-px bg-indigo-500/40" />
                        
                        <div className="relative w-full">
                          <div className="absolute top-0 left-[25%] right-[25%] h-px bg-gradient-to-r from-blue-500 to-orange-500" />
                          
                          <div className="grid grid-cols-2 gap-4 pt-6">
                            <div className="flex flex-col items-center">
                              <div className="h-6 w-px bg-blue-500/40 -mt-6" />
                              {<MemberNode team={team} memberId="humberto" size="sm" onSelect={onSelectMember} />}
                              
                              <div className="h-8 w-px bg-blue-500/40" />
                              <div className="flex flex-col items-center">
                                {<MemberNode team={team} memberId="arthur" size="sm" onSelect={onSelectMember} />}
                                <div className="h-4 w-px bg-blue-500/40" />
                                {<MemberNode team={team} memberId="cabalim" size="sm" onSelect={onSelectMember} />}
                              </div>
                            </div>

                            <div className="flex flex-col items-center">
                              <div className="h-6 w-px bg-orange-500/40 -mt-6" />
                              {<MemberNode team={team} memberId="jheyson" size="sm" onSelect={onSelectMember} />}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Column 4: Operacional (Raquel) */}
                      <div className="flex flex-col items-center">
                        <div className="h-6 w-px bg-pink-500/40 -mt-6" />
                        {<MemberNode team={team} memberId="raquel" size="md" onSelect={onSelectMember} />}
                        
                        <div className="h-8 w-px bg-pink-500/40" />
                        
                        <div className="flex flex-col items-center w-full">
                          {<MemberNode team={team} memberId="maria_eduarda" size="sm" onSelect={onSelectMember} />}
                          
                          <div className="h-8 w-px bg-rose-500/40" />
                          <div className="flex flex-col items-center">
                            {<MemberNode team={team} memberId="eflen" size="sm" onSelect={onSelectMember} />}
                            <div className="h-4 w-px bg-rose-500/40" />
                            {<MemberNode team={team} memberId="carlos" size="sm" onSelect={onSelectMember} />}
                            <div className="h-4 w-px bg-rose-500/40" />
                            {<MemberNode team={team} memberId="santana" size="sm" onSelect={onSelectMember} />}
                            <div className="h-4 w-px bg-rose-500/40" />
                            {<MemberNode team={team} memberId="karolina" size="sm" onSelect={onSelectMember} />}
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>

                {/* Team Member detail display card drawer modal */}
                {selectedMember && <MemberDetailModal member={selectedMember} onClose={onCloseMemberDetail} />}

              </div>
  );
}
