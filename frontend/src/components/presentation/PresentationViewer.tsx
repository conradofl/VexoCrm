import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { buildPitch, type PitchSlide } from "@/lib/presentation/pitchContent";

// PresentationViewer — componente 100% VISUAL e genérico.
//
// Recebe tudo via props (nome da empresa, logo, id do segmento) e renderiza o
// roteiro SPIN Selling resolvido pelo motor em lib/presentation/pitchContent.
//
// ISOLAMENTO TOTAL: não importa, lê ou altera ProposalConfig / pacotes / venda
// casada. É só a apresentação. Nada aqui persiste ou muda estado comercial.

interface PresentationViewerProps {
  companyName: string;
  segmentId?: string | null;
  logoUrl?: string | null;
  onClose?: () => void;
  // CTA final "Ir para a proposta" — passe um link OU um handler.
  proposalHref?: string | null;
  onGoToProposal?: () => void;
}

const easeOut = [0.22, 1, 0.36, 1] as const;

const slideVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 60 : -60, filter: "blur(6px)" }),
  center: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -60 : 60, filter: "blur(6px)" }),
};

export function PresentationViewer({ companyName, segmentId, logoUrl, onClose, proposalHref, onGoToProposal }: PresentationViewerProps) {
  const { group, slides } = useMemo(
    () => buildPitch({ companyName, segmentId }),
    [companyName, segmentId]
  );

  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const total = slides.length;

  const go = useCallback(
    (next: number) => {
      setIndex((cur) => {
        const clamped = Math.max(0, Math.min(total - 1, next));
        setDir(clamped >= cur ? 1 : -1);
        return clamped;
      });
    },
    [total]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { e.preventDefault(); go(index + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
      else if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go, onClose]);

  const slide = slides[index];
  const accent = group.accent;
  const progress = ((index + 1) / total) * 100;

  return (
    <div
      className="fixed inset-0 z-[120] overflow-hidden bg-slate-950 text-white select-none"
      style={{ ["--accent" as any]: accent }}
    >
      {/* Fundo — gradientes suaves + glow do accent */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-black" />
        <div
          className="absolute -top-40 -right-32 h-[38rem] w-[38rem] rounded-full blur-[140px] opacity-30"
          style={{ background: accent }}
        />
        <div
          className="absolute -bottom-48 -left-40 h-[36rem] w-[36rem] rounded-full blur-[150px] opacity-20"
          style={{ background: accent }}
        />
        <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-8 py-6 sm:px-14">
        {/* No 1º slide a marca aparece grande no palco, então o canto fica limpo. */}
        <div className={"flex items-center gap-3 transition-opacity " + (index === 0 ? "pointer-events-none opacity-0" : "opacity-100")}>
          {logoUrl ? (
            <img src={logoUrl} alt={companyName} className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/15" />
          ) : (
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black ring-1 ring-white/15"
              style={{ background: `${accent}22`, color: accent }}
            >
              {companyName?.trim()?.charAt(0)?.toUpperCase() || "V"}
            </div>
          )}
          <div className="leading-tight">
            <p className="text-xs font-bold tracking-wide">{companyName || "Proposta"}</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">{group.label}</p>
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 ring-1 ring-white/10 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Fechar apresentação"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      {/* Palco */}
      <main className="relative z-10 flex h-[calc(100%-9.5rem)] items-center justify-center px-8 sm:px-14">
        <AnimatePresence custom={dir} mode="wait">
          <motion.section
            key={slide.id}
            custom={dir}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.5, ease: easeOut }}
            className="max-h-full w-full max-w-4xl overflow-y-auto py-2 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <SlideBody
              slide={slide}
              accent={accent}
              companyName={companyName}
              logoUrl={logoUrl}
              proposalHref={proposalHref}
              onGoToProposal={onGoToProposal}
            />
          </motion.section>
        </AnimatePresence>
      </main>

      {/* Barra de progresso */}
      <div className="absolute bottom-[4.75rem] left-0 right-0 z-10 px-8 sm:px-14">
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full"
            style={{ background: accent }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: easeOut }}
          />
        </div>
      </div>

      {/* Navegação */}
      <footer className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between px-8 py-6 sm:px-14">
        <button
          onClick={() => go(index - 1)}
          disabled={index === 0}
          className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs font-bold text-white/70 ring-1 ring-white/10 transition-all hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>

        <div className="flex items-center gap-2">
          {slides.map((s, i) => (
            <button
              key={s.id}
              onClick={() => go(i)}
              aria-label={`Ir para o slide ${i + 1}`}
              className="h-2 rounded-full transition-all"
              style={{
                width: i === index ? 26 : 8,
                background: i === index ? accent : "rgba(255,255,255,0.25)",
              }}
            />
          ))}
        </div>

        {index < total - 1 ? (
          <button
            onClick={() => go(index + 1)}
            className="flex items-center gap-2 rounded-full px-5 py-2 text-xs font-black text-slate-950 shadow-lg transition-all hover:brightness-110"
            style={{ background: accent, boxShadow: `0 10px 30px -8px ${accent}` }}
          >
            Avançar
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <span className="rounded-full bg-white/5 px-5 py-2 text-xs font-bold text-white/40 ring-1 ring-white/10">
            Fim
          </span>
        )}
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Corpo do slide — layout muda conforme o tipo (kind)
// ---------------------------------------------------------------------------

function SlideBody({
  slide,
  accent,
  companyName,
  logoUrl,
  proposalHref,
  onGoToProposal,
}: {
  slide: PitchSlide;
  accent: string;
  companyName: string;
  logoUrl?: string | null;
  proposalHref?: string | null;
  onGoToProposal?: () => void;
}) {
  const stagger = {
    hidden: {},
    show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
  };
  const item = {
    hidden: { opacity: 0, y: 18 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: easeOut } },
  };

  const isImpact = slide.kind === "impact";
  const isClose = slide.kind === "close";

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-7">
      {/* 1º slide: logo + nome da empresa em evidência (apresentação personalizada).
          Logo grande e sem recorte quadrado — acomoda tanto ícone quanto
          logotipo com nome completo por extenso. */}
      {isImpact && (
        <motion.div variants={item} className="space-y-5">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">
            Apresentação preparada para
          </p>
          {logoUrl ? (
            <div className="flex flex-wrap items-center gap-5">
              <img
                src={logoUrl}
                alt={companyName}
                className="h-28 w-auto max-w-full rounded-2xl object-contain sm:h-40"
                style={{ filter: `drop-shadow(0 20px 45px ${accent}66)` }}
              />
              <span className="text-3xl font-black leading-tight tracking-tight sm:text-5xl">
                {companyName}
              </span>
            </div>
          ) : (
            <div
              className="inline-flex items-center gap-5 rounded-3xl border border-white/10 bg-white/[0.04] px-7 py-5 backdrop-blur-md"
              style={{ boxShadow: `0 24px 60px -28px ${accent}` }}
            >
              <span
                className="flex h-20 w-20 items-center justify-center rounded-2xl text-4xl font-black ring-2 ring-white/15 sm:h-24 sm:w-24"
                style={{ background: `${accent}22`, color: accent }}
              >
                {companyName?.trim()?.charAt(0)?.toUpperCase() || "V"}
              </span>
              <span className="text-3xl font-black leading-tight tracking-tight sm:text-5xl">
                {companyName}
              </span>
            </div>
          )}
        </motion.div>
      )}

      <motion.span
        variants={item}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.25em] backdrop-blur"
        style={{ color: accent }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
        {slide.eyebrow}
      </motion.span>

      <motion.h1
        variants={item}
        className={
          "font-black leading-[1.02] tracking-tight " +
          (isImpact || isClose ? "text-5xl sm:text-7xl" : "text-4xl sm:text-6xl")
        }
      >
        {slide.title}
      </motion.h1>

      {slide.subtitle && (
        <motion.p variants={item} className="max-w-2xl text-lg font-medium text-white/70 sm:text-2xl">
          {slide.subtitle}
        </motion.p>
      )}

      {slide.body && (
        <motion.p variants={item} className="max-w-2xl text-lg leading-relaxed text-white/75 sm:text-xl">
          {slide.body}
        </motion.p>
      )}

      {/* Antes / Depois — impacto visual (loja vazia -> cheia) */}
      {slide.compare && (
        <motion.div variants={item} className="grid gap-4 pt-1 sm:grid-cols-2">
          <CompareTile
            img={slide.compare.before.img}
            label={slide.compare.before.label}
            accent={accent}
            variant="before"
          />
          <CompareTile
            img={slide.compare.after.img}
            label={slide.compare.after.label}
            accent={accent}
            variant="after"
          />
        </motion.div>
      )}

      {/* Passos numerados (slide de solução) */}
      {slide.steps && (
        <motion.ol variants={stagger} className="space-y-3 pt-1">
          {slide.steps.map((step, i) => (
            <motion.li
              key={i}
              variants={item}
              className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md sm:p-5"
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black text-slate-950"
                style={{ background: accent }}
              >
                {i + 1}
              </span>
              <span className="pt-1 text-base leading-snug text-white/85 sm:text-lg">{step}</span>
            </motion.li>
          ))}
        </motion.ol>
      )}

      {/* Parceria — colunas GD + Vexo */}
      {slide.fronts && (
        <motion.div variants={stagger} className="grid gap-4 pt-1 sm:grid-cols-2">
          {slide.fronts.map((front, i) => (
            <motion.div
              key={i}
              variants={item}
              className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-md sm:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-lg font-black tracking-tight sm:text-xl">{front.label}</span>
                <span
                  className="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider"
                  style={{ background: `${accent}1f`, color: accent }}
                >
                  {front.tag}
                </span>
              </div>
              <ul className="mt-4 space-y-2.5">
                {front.items.map((it, j) => (
                  <li key={j} className="flex items-start gap-2.5 text-sm text-white/80 sm:text-[15px]">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: accent }}
                    />
                    <span className="leading-snug">{it}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Métrica de destaque (ROI / benchmark) */}
      {slide.metric && (
        <motion.div
          variants={item}
          className="mt-2 inline-flex flex-col rounded-3xl border border-white/10 bg-white/[0.05] p-6 backdrop-blur-xl sm:p-7"
          style={{ boxShadow: `inset 0 1px 0 0 rgba(255,255,255,0.06), 0 24px 60px -30px ${accent}` }}
        >
          <span className="text-4xl font-black tracking-tight sm:text-6xl" style={{ color: accent }}>
            {slide.metric.value}
          </span>
          <span className="mt-2 max-w-sm text-sm font-medium text-white/55">{slide.metric.caption}</span>
        </motion.div>
      )}

      {/* Frase de efeito / gatilho mental (slide de fechamento) */}
      {isClose && slide.punch && (
        <motion.p
          variants={item}
          className="max-w-2xl border-l-2 pl-5 text-xl font-black leading-snug tracking-tight sm:text-3xl"
          style={{ borderColor: accent }}
        >
          {slide.punch}
        </motion.p>
      )}

      {/* Fim da apresentação + CTA para a proposta (só no slide de fechamento) */}
      {isClose && (
        <motion.div variants={item} className="flex flex-col gap-5 pt-3 sm:flex-row sm:items-center">
          {(proposalHref || onGoToProposal) && (
            proposalHref ? (
              <a
                href={proposalHref}
                className="inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-sm font-black text-slate-950 shadow-lg transition-all hover:brightness-110"
                style={{ background: accent, boxShadow: `0 14px 40px -10px ${accent}` }}
              >
                Ir para a proposta
                <ArrowRight className="h-4 w-4" />
              </a>
            ) : (
              <button
                onClick={onGoToProposal}
                className="inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-sm font-black text-slate-950 shadow-lg transition-all hover:brightness-110"
                style={{ background: accent, boxShadow: `0 14px 40px -10px ${accent}` }}
              >
                Ir para a proposta
                <ArrowRight className="h-4 w-4" />
              </button>
            )
          )}
          <span className="text-xs font-bold uppercase tracking-[0.25em] text-white/35">
            Fim da apresentação
          </span>
        </motion.div>
      )}
    </motion.div>
  );
}

// Tile de antes/depois. Imagem quebrada cai num placeholder estilizado — nunca
// mostra ícone de imagem quebrada.
function CompareTile({
  img,
  label,
  accent,
  variant,
}: {
  img?: string;
  label: string;
  accent: string;
  variant: "before" | "after";
}) {
  const [broken, setBroken] = useState(false);
  const isAfter = variant === "after";
  const showImg = img && !broken;

  return (
    <div
      className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-slate-900"
      style={isAfter ? { boxShadow: `0 24px 60px -30px ${accent}` } : undefined}
    >
      {showImg ? (
        <img
          src={img}
          alt={label}
          onError={() => setBroken(true)}
          className={
            "h-full w-full object-cover transition-all duration-700 " +
            (isAfter ? "" : "grayscale-[0.55] brightness-75")
          }
        />
      ) : (
        // Placeholder: cinza/vazio no "antes", vivo no "depois".
        <div
          className="flex h-full w-full items-center justify-center"
          style={{
            background: isAfter
              ? `radial-gradient(120% 120% at 50% 0%, ${accent}55, ${accent}10 60%, transparent)`
              : "radial-gradient(120% 120% at 50% 0%, rgba(255,255,255,0.06), transparent)",
          }}
        >
          <span className={"text-5xl " + (isAfter ? "opacity-90" : "opacity-30 grayscale")}>
            {isAfter ? "🎉" : "🕸️"}
          </span>
        </div>
      )}

      {/* Selo do variant */}
      <div className="absolute left-3 top-3">
        <span
          className="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider backdrop-blur"
          style={
            isAfter
              ? { background: accent, color: "#0a0a0a" }
              : { background: "rgba(15,23,42,0.7)", color: "rgba(255,255,255,0.7)" }
          }
        >
          {isAfter ? "Depois" : "Antes"}
        </span>
      </div>

      {/* Legenda */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
        <span className="text-sm font-bold text-white sm:text-[15px]">{label}</span>
      </div>
    </div>
  );
}

export default PresentationViewer;
