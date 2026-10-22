import React, { useState } from "react";
import { KeyRound, ChevronDown, ChevronUp, Link as LinkIcon, ExternalLink } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BriefingField } from "@/lib/geracaoDigital/types";

interface BriefingBlockTechnicalProps {
  briefingFields: BriefingField[];
  onUpdateField: (fieldId: string, value: string) => void;
}

export function BriefingBlockTechnical({
  briefingFields,
  onUpdateField,
}: BriefingBlockTechnicalProps) {
  const [isOpen, setIsOpen] = useState(true);

  const techIds = [
    "logo",
    "instagram",
    "facebook",
    "possui_bm",
    "google",
    "site",
    "dominios_dns",
    "localizacao",
  ];

  const blockFields = briefingFields.filter((f) => techIds.includes(f.id));
  const completedCount = blockFields.filter((f) => f.value && f.value.trim().length > 0).length;

  const getField = (id: string) => briefingFields.find((f) => f.id === id);

  const logoField = getField("logo");
  const instagramField = getField("instagram");
  const facebookField = getField("facebook");
  const possuiBmField = getField("possui_bm");
  const googleField = getField("google");
  const siteField = getField("site");
  const dominiosDnsField = getField("dominios_dns");
  const localizacaoField = getField("localizacao");

  return (
    <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden transition-all">
      <CardHeader
        className="p-5 flex flex-row items-center justify-between cursor-pointer select-none bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center font-bold">
            <KeyRound className="w-4 h-4" />
          </div>
          <div>
            <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              Bloco D · Acessos e Ativos Técnicos
            </CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Credenciais de redes sociais, Meta BM, Google Ads, DNS e links de arquivos.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge
            className={cn(
              "font-mono text-xs font-semibold px-2.5 py-0.5 border",
              completedCount >= blockFields.length
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
            )}
          >
            {completedCount}/{blockFields.length} preenchidos
          </Badge>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            aria-label="Expandir ou recolher"
          >
            {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>
      </CardHeader>

      {isOpen && (
        <CardContent className="p-6 space-y-5">
          {/* Link da Logomarca */}
          {logoField && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={logoField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <LinkIcon className="w-3.5 h-3.5 text-indigo-500" />
                  {logoField.label}
                </Label>
                {logoField.value && (
                  <a
                    href={logoField.value.startsWith("http") ? logoField.value : `https://${logoField.value}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-semibold"
                  >
                    Abrir Link <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <Input
                id={logoField.id}
                value={logoField.value || ""}
                onChange={(e) => onUpdateField(logoField.id, e.target.value)}
                placeholder="https://drive.google.com/drive/folders/..."
                className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
              <p className="text-[11px] text-slate-400">
                Cole o link da pasta no Google Drive ou Dropbox contendo arquivos editáveis (.ai, .eps, vetores e PNGs).
              </p>
            </div>
          )}

          {/* Logins e Acessos */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
            {instagramField && (
              <div className="space-y-1.5">
                <Label htmlFor={instagramField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {instagramField.label}
                </Label>
                <Input
                  id={instagramField.id}
                  value={instagramField.value || ""}
                  onChange={(e) => onUpdateField(instagramField.id, e.target.value)}
                  placeholder="@usuario / senha"
                  className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            )}

            {facebookField && (
              <div className="space-y-1.5">
                <Label htmlFor={facebookField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {facebookField.label}
                </Label>
                <Input
                  id={facebookField.id}
                  value={facebookField.value || ""}
                  onChange={(e) => onUpdateField(facebookField.id, e.target.value)}
                  placeholder="E-mail / senha da página"
                  className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            )}

            {googleField && (
              <div className="space-y-1.5">
                <Label htmlFor={googleField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {googleField.label}
                </Label>
                <Input
                  id={googleField.id}
                  value={googleField.value || ""}
                  onChange={(e) => onUpdateField(googleField.id, e.target.value)}
                  placeholder="ID da conta Google Ads ou e-mail"
                  className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            )}

            {siteField && (
              <div className="space-y-1.5">
                <Label htmlFor={siteField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {siteField.label}
                </Label>
                <Input
                  id={siteField.id}
                  value={siteField.value || ""}
                  onChange={(e) => onUpdateField(siteField.id, e.target.value)}
                  placeholder="www.empresa.com.br"
                  className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            )}

            {dominiosDnsField && (
              <div className="space-y-1.5">
                <Label htmlFor={dominiosDnsField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {dominiosDnsField.label}
                </Label>
                <Input
                  id={dominiosDnsField.id}
                  value={dominiosDnsField.value || ""}
                  onChange={(e) => onUpdateField(dominiosDnsField.id, e.target.value)}
                  placeholder="Ex: Cloudflare, Registro.br, Hostinger"
                  className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            )}

            {localizacaoField && (
              <div className="space-y-1.5">
                <Label htmlFor={localizacaoField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {localizacaoField.label}
                </Label>
                <Input
                  id={localizacaoField.id}
                  value={localizacaoField.value || ""}
                  onChange={(e) => onUpdateField(localizacaoField.id, e.target.value)}
                  placeholder="Ex: São Paulo / Brasil"
                  className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            )}
          </div>

          {/* Possui BM? */}
          {possuiBmField && (
            <div className="pt-2">
              <Label className="text-xs font-bold text-slate-800 dark:text-slate-200 block mb-1.5">
                {possuiBmField.label}
              </Label>
              <div className="flex gap-2">
                {possuiBmField.options?.map((opt) => {
                  const isSelected = possuiBmField.value === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => onUpdateField(possuiBmField.id, opt)}
                      className={cn(
                        "text-xs font-medium py-1.5 px-4 rounded-xl border transition-all duration-150 cursor-pointer select-none",
                        isSelected
                          ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                          : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900"
                      )}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
