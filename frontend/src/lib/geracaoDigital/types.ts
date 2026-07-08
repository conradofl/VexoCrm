// ─── TYPES & INTERFACES ──────────────────────────────────────────────────────
// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — movimento puro, sem alteração de forma.

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  parent: string;
  bio: string;
  responsibilities: string[];
  tools: string[];
  status: "Online" | "Em Reunião" | "Focando em IA" | "Offline" | "Gravando";
  avatarColor: string;
}

export interface BriefingField {
  id: string;
  label: string;
  placeholder: string;
  status: "pending" | "processing" | "completed";
  value: string;
  confidence: number;
  type?: "text" | "textarea" | "radio" | "checkboxes";
  options?: string[];
  subfields?: { id: string; label: string; value: string }[];
}

export interface RoadmapStep {
  week: string;
  title: string;
  subtitle: string;
  details: string[];
}

export interface CustomTheme {
  agencyName: string;
  agencySubtitle: string;
  primaryColor: string; // HSL color string or preset key
  prospectName: string;
  prospectLogoUrl: string;
  whatsappNumber: string;
  themePreset: "indigo" | "emerald" | "violet" | "rose" | "amber";
}

export interface TranscriptOption {
  id: string;
  title: string;
  description: string;
  text: string;
  extractedValues: Record<string, string>;
}
