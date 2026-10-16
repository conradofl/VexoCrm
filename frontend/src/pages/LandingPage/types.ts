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

export interface PlanItem {
  name: string;
  price: string;
  badge: string;
  description: string;
  features: string[];
  featured: boolean;
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
  teamSize: string;
}
