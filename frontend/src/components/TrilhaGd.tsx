// Trilha do cliente GD (03/11/2026). Um componente, dois modos:
// - "interno": rótulo interno, data e hora, quem moveu e o motivo do último evento de cada etapa;
// - "portal": só rotulo_portal, data e "aproximado". Os dados passam por trilhaPortal, que joga fora
//   ator, uid, motivo, origem, rótulo interno e código antes de chegar aqui.
// Vertical sempre (16 etapas deitadas não cabem no celular). Ao abrir, rola até a etapa atual.
import { forwardRef, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { formatarDataHora, rotuloDoAtor, type GdEstado, type GdEvento } from "@/lib/gdClientes";
import { dataCurta, trilhaInterna, trilhaPortal, type EtapaInterna, type EtapaPortal, type Trilha } from "@/lib/gdTrilha";

type Props = {
  modo: "interno" | "portal";
  estados: GdEstado[];
  eventos: GdEvento[];
  estadoAtual: string | null;
};

export function TrilhaGd({ modo, estados, eventos, estadoAtual }: Props) {
  const trilha: Trilha<EtapaPortal | EtapaInterna> =
    modo === "portal" ? trilhaPortal(estados, eventos, estadoAtual) : trilhaInterna(estados, eventos, estadoAtual);
  const atualRef = useRef<HTMLLIElement>(null);
  const posicao = trilha.atual ? trilha.etapas.indexOf(trilha.atual) : -1;

  // Com 16 etapas a atual pode nascer fora da vista, e aí o pulso não serve para nada.
  useEffect(() => {
    atualRef.current?.scrollIntoView?.({ block: "center" });
  }, [posicao, estadoAtual]);

  const grupos: { fase: string | null; itens: (EtapaPortal | EtapaInterna)[] }[] = [];
  for (const etapa of trilha.etapas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.fase === etapa.fase) ultimo.itens.push(etapa);
    else grupos.push({ fase: etapa.fase, itens: [etapa] });
  }

  return (
    <section aria-label="Trilha do cliente" className="space-y-4">
      <Aviso trilha={trilha} modo={modo} />
      {grupos.map((grupo, g) => (
        <div key={g}>
          {grupo.fase && (
            <p className="mb-2 ml-7 text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">{grupo.fase}</p>
          )}
          <ol className="space-y-0">
            {grupo.itens.map((etapa, i) => (
              <Etapa
                key={i}
                etapa={etapa}
                modo={modo}
                ultima={g === grupos.length - 1 && i === grupo.itens.length - 1}
                tagParada={trilha.fora?.terminal ? "encerrado aqui" : "pausado aqui"}
                ref={etapa === trilha.atual ? atualRef : undefined}
              />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

function Aviso({ trilha, modo }: { trilha: Trilha<EtapaPortal | EtapaInterna>; modo: Props["modo"] }) {
  const { atual, fora } = trilha;
  let tipo: "acao" | "parada" | "normal" = "normal";
  let texto: React.ReactNode;
  if (fora) {
    tipo = "parada";
    const desde = fora.desde ? ` desde ${dataCurta(fora.desde)}` : "";
    texto = modo === "portal"
      ? <><b>{fora.rotulo}</b>{desde}.</>
      : <><b>{fora.rotulo}</b>{desde}.{atual ? ` Última etapa antes: ${atual.rotulo}.` : ""}</>;
  } else if (atual?.acaoDoCliente) {
    tipo = "acao";
    texto = <>{modo === "portal" ? "Agora é com você: " : "Esperando o cliente: "}<b>{atual.rotulo}</b>.</>;
  } else if (atual) {
    const desde = atual.data ? ` · desde ${dataCurta(atual.data)}${atual.aproximado ? " (aproximado)" : ""}` : "";
    texto = <>{modo === "portal" ? "Agora: " : "Etapa atual: "}<b>{atual.rotulo}</b>{desde}</>;
  } else {
    texto = "Nenhuma etapa registrada ainda.";
  }
  return (
    <p
      data-aviso={tipo}
      className={cn(
        "rounded-md px-3 py-2 text-sm",
        tipo === "acao" && "bg-warning/15",
        tipo === "parada" && "bg-muted",
        tipo === "normal" && "bg-accent",
      )}
    >
      {texto}
    </p>
  );
}

const TAG_SITUACAO: Partial<Record<EtapaPortal["situacao"], string>> = {
  pulada: "não registrada",
  antes: "antes do acompanhamento",
};

// Classes escritas por inteiro: o Tailwind não enxerga classe montada com template string.
const COR = {
  primary: { ponto: "bg-primary ring-4 ring-primary/25", anel: "border-primary" },
  warning: { ponto: "bg-warning ring-4 ring-warning/30", anel: "border-warning" },
  parada: { ponto: "bg-muted-foreground ring-4 ring-muted-foreground/20", anel: "border-muted-foreground" },
} as const;

type EtapaProps = { etapa: EtapaPortal | EtapaInterna; modo: Props["modo"]; ultima: boolean; tagParada: string };

const Etapa = forwardRef<HTMLLIElement, EtapaProps>(function Etapa({ etapa, modo, ultima, tagParada }, ref) {
  const { situacao, acaoDoCliente, parada } = etapa;
  const atual = situacao === "atual";
  const semEvento = situacao === "pulada" || situacao === "antes";
  const pulsa = atual && !parada;
  // Cor da etapa atual: ação do cliente (warning) ≠ sistema (primary) ≠ parada (muted).
  const cor = COR[parada ? "parada" : acaoDoCliente ? "warning" : "primary"];

  let tag: string | null = null;
  if (atual && parada) tag = tagParada;
  else if (atual && acaoDoCliente) tag = modo === "portal" ? "com você" : "com o cliente";
  else if (atual) tag = "aqui";
  else tag = TAG_SITUACAO[situacao] ?? null;

  const interno = modo === "interno" ? (etapa as EtapaInterna).evento : null;

  return (
    <li
      ref={ref}
      data-situacao={situacao}
      data-acao-do-cliente={acaoDoCliente || undefined}
      aria-current={atual ? "step" : undefined}
      className="relative min-w-0 pb-4 pl-7 last:pb-0"
    >
      {!ultima && (
        <span
          aria-hidden
          className={cn("absolute left-[7px] top-[18px] -bottom-px w-0.5", situacao === "concluida" ? "bg-primary" : "bg-border")}
        />
      )}
      <span
        aria-hidden
        data-ponto
        className={cn(
          "absolute left-0 top-[5px] h-4 w-4 rounded-full",
          situacao === "concluida" && "bg-primary",
          situacao === "futura" && "border-2 border-border bg-background",
          semEvento && "border-2 border-dashed border-muted-foreground/60 bg-background",
          atual && cor.ponto,
        )}
      >
        {atual && (
          <span
            data-anel
            data-pulsando={pulsa ? "true" : "false"}
            className={cn(
              "absolute -inset-0.5 rounded-full border-2",
              cor.anel,
              pulsa ? "motion-safe:animate-ping motion-reduce:opacity-60" : "opacity-50",
            )}
          />
        )}
      </span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span
          data-rotulo
          className={cn(
            "min-w-0",
            atual ? "font-semibold text-foreground" : situacao === "concluida" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {etapa.rotulo}
        </span>
        {etapa.data && (
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {modo === "portal" ? dataCurta(etapa.data) : formatarDataHora(etapa.data)}
            {etapa.aproximado ? " · aproximado" : ""}
          </span>
        )}
        {tag && (
          <span
            data-tag
            className={cn(
              "whitespace-nowrap rounded px-1.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide",
              semEvento && "border border-dashed border-border text-muted-foreground",
              atual && parada && "bg-muted text-muted-foreground",
              atual && !parada && acaoDoCliente && "bg-warning/15 text-foreground",
              atual && !parada && !acaoDoCliente && "bg-accent text-primary",
            )}
          >
            {tag}
          </span>
        )}
      </div>
      {interno && (
        <div className="mt-0.5 break-words text-xs text-muted-foreground">
          {rotuloDoAtor(interno)}{interno.motivo ? ` · ${interno.motivo}` : ""}
        </div>
      )}
    </li>
  );
});
