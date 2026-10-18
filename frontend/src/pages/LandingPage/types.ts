// frontend/src/pages/LandingPage/types.ts

import type { LucideIcon } from "lucide-react";

export interface MetricItem {
  value: string;
  label: string;
  detail: string;
}

export interface PillarItem {
  number: string;
  title: string;
  badge: string;
  description: string;
  items: string[];
  icon: LucideIcon;
  tone: string;
}

export interface MethodologyStep {
  step: string;
  title: string;
  description: string;
}

export interface CoreFoundationItem {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  features: string[];
}

export interface ModuleItem {
  number: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

export interface PlanCardItem {
  id: string;
  name: string;
  price: string;
  period: string;
  setup: string;
  tagline: string;
  badge?: string;
  highlighted?: boolean;
  ctaText: string;
  ctaAction?: "modal" | "link";
  featuresHeader?: string;
  features: string[];
  excludedFeatures?: string[];
}

export interface PlanComparisonRow {
  feature: string;
  disparo: string;
  essencial: string;
  avancado: string;
  plus: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface LeadFormData {
  fullName: string;
  email: string;
  phone: string;
  company: string;
  segment?: string;
  teamSize?: string;
  baseSize?: string;
  ticketMedio?: string;
  stalledLeadsPct?: string;
  responseTime?: string;
  followupProcess?: string;
  mainPain?: string;
  website_url?: string;
  source?: string;
  client_id?: string;
}
