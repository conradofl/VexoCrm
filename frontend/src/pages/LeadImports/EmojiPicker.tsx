import { useState } from "react";
import { Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Seletor de emoji SEM dependencia nova.
//
// Nao ha biblioteca de emoji no package.json, e as usuais (emoji-mart e afins)
// trazem centenas de KB e um indice completo Unicode para um campo de mensagem de
// WhatsApp — onde na pratica se usa um punhado de emojis comerciais. Uma lista
// curada cobre o caso real, entra em bytes, e nao adiciona superficie de
// atualizacao/seguranca. Se um dia precisar de busca e skin tones, troca-se por
// uma lib de verdade; ate la isto resolve.
//
// O emoji e INSERIDO no cursor e nao substitui o texto: variaveis como
// {{nome}} continuam intactas, e a contagem de caracteres segue a do proprio
// campo (o valor final e so texto).
const GRUPOS: Array<{ nome: string; emojis: string[] }> = [
  {
    nome: "Frequentes",
    emojis: ["😀", "😃", "😄", "😉", "😊", "🙂", "😍", "🤩", "😎", "🤝", "👋", "👍", "🙏", "💪", "👏", "🎯"],
  },
  {
    nome: "Comercial",
    emojis: ["🚀", "✅", "⭐", "🔥", "💡", "📈", "💰", "🏆", "🎁", "🛒", "🏠", "☀️", "⚡", "🔋", "📊", "💎"],
  },
  {
    nome: "Contato",
    emojis: ["📱", "📞", "💬", "📧", "📅", "🕐", "📍", "🔗", "📎", "✍️", "❤️", "🎉", "⚠️", "❗", "➡️", "✨"],
  },
];

interface EmojiPickerProps {
  /** Recebe o emoji escolhido; o chamador decide onde inserir. */
  onSelect: (emoji: string) => void;
  disabled?: boolean;
  className?: string;
  iconClassName?: string;
}

export function EmojiPicker({ onSelect, disabled, className, iconClassName }: EmojiPickerProps) {
  const [aberto, setAberto] = useState(false);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label="Inserir emoji"
          title="Inserir emoji"
          className={cn("h-7 px-2 text-muted-foreground hover:text-foreground", className)}
        >
          <Smile className={cn("h-3.5 w-3.5", iconClassName)} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[268px] p-2 space-y-2">
        {GRUPOS.map((grupo) => (
          <div key={grupo.nome} className="space-y-1">
            <p className="text-[10px] uppercase font-bold tracking-wide text-slate-400">{grupo.nome}</p>
            <div className="grid grid-cols-8 gap-0.5">
              {grupo.emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Inserir ${emoji}`}
                  onClick={() => {
                    onSelect(emoji);
                    setAberto(false);
                  }}
                  className="h-7 w-7 rounded text-base leading-none hover:bg-accent"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
