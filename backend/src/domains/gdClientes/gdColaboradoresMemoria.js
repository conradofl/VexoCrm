// RAG de Memória Oficial — Equipe Geração Digital
// Fonte: Planilha Relação de colaboradores - Agencia GD.xlsx
// PENDÊNCIA: Será integrado à Central de Controle de Dados dos Agentes no CRM.

export const GD_COLABORADORES = [
  { nome: "Caio Almeida", cargo: "Diretor - proprietário", telefone: "5534997719779" },
  { nome: "Conrado Finzi", cargo: "TI / Sistemas", telefone: "5534997817660" },
  { nome: "Gabriel", cargo: "Gestor de operações", telefone: "5534996916397" },
  { nome: "Maria Eduarda", cargo: "Gerente de operações", telefone: "5534997066114" },
  { nome: "Éflen", cargo: "Editor de Vídeo", telefone: "5534991531361" },
  { nome: "Santana", cargo: "Diretor de arte", telefone: "5516982447360" },
  { nome: "Humberto", cargo: "Gestor de Tráfego", telefone: "5534992223651" },
  { nome: "Carlos", cargo: "Videomaker", telefone: "5534997690926" },
];

export function obterTelefonesEquipeGd() {
  return GD_COLABORADORES.map((c) => c.telefone);
}
