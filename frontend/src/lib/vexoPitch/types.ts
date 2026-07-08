// Extraído de src/pages/VexoPitch.tsx (Onda 4 Run F9) — movimento puro, sem alteração de forma.
export type Message = {
  sender: "bot" | "lead" | "system";
  text: string;
  time: string;
};

export interface CurrentStepData {
  title: string;
  reasoning: string;
  training: string;
  action: string;
}

export interface RoiResult {
  qualifiedLeads: number;
  operatorHoursSaved: number;
  currentSales: number;
  estimatedVexoSales: number;
  extraSales: number;
  additionalRevenue: number;
}
