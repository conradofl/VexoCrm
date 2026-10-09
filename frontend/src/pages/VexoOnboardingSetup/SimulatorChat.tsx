import { useState, useRef, useEffect } from "react";
import {
  Send,
  RotateCcw,
  Bot,
  User,
  Sparkles,
  ShieldCheck,
  CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SimulatorChatProps {
  companyName: string;
  segment?: string;
  operatingHours: string;
  products: string;
  priceRange: string;
  deliveryTerms: string;
  forbiddenRules: string;
  hasConnectedChip?: boolean;
}

interface Message {
  id: string;
  sender: "user" | "bot";
  text: string;
  time: string;
}

const DEFAULT_SUGGESTIONS = [
  { label: "💰 Qual o valor do serviço?", query: "Qual é o valor do serviço?" },
  { label: "⏱️ Qual o prazo de entrega?", query: "Qual é o prazo de entrega?" },
  { label: "📍 Qual o horário de atendimento?", query: "Qual o horário de atendimento de vocês?" },
  { label: "❌ Me dá 90% de desconto agora?", query: "Pode me dar 90% de desconto agora no PIX?" },
];

export function SimulatorChat({
  companyName,
  segment,
  operatingHours,
  products,
  priceRange,
  deliveryTerms,
  forbiddenRules,
  hasConnectedChip,
}: SimulatorChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "initial-1",
      sender: "bot",
      text: `Olá! Sou o assistente virtual da ${companyName || "sua empresa"}. Como posso te ajudar hoje com ${products ? products.toLowerCase() : "nossos serviços"}?`,
      time: "Agora",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isTyping) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: "user",
      text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsTyping(true);

    // Gera resposta contextual da IA simulada
    setTimeout(() => {
      let botResponse = "";
      const lower = text.toLowerCase();

      if (lower.includes("desconto") || lower.includes("promete") || lower.includes("garante")) {
        botResponse = `Como consultor da ${companyName || "nossa equipe"}, temos diretrizes de segurança claras: ${
          forbiddenRules
            ? `não posso prometer ${forbiddenRules.toLowerCase()}`
            : "não posso conceder descontos fora da tabela oficial nem fazer promessas extraordinárias"
        }. Posso registrar sua necessidade e transferir para um especialista humano avaliar!`;
      } else if (lower.includes("preço") || lower.includes("valor") || lower.includes("custa") || lower.includes("orçamento")) {
        botResponse = `Nossos serviços e produtos têm investimento estimado em ${
          priceRange || "valores sob medida conforme o escopo desejado"
        }. Trabalhamos com planos flexíveis para garantir o melhor retorno para seu caso.`;
      } else if (lower.includes("prazo") || lower.includes("entrega") || lower.includes("demora") || lower.includes("tempo")) {
        botResponse = `Nosso prazo padrão de entrega e execução é de ${
          deliveryTerms || "prazos ágeis alinhados após a contratação"
        }. Cumprimos cada etapa com acompanhamento contínuo.`;
      } else if (lower.includes("horário") || lower.includes("atendimento") || lower.includes("aberto") || lower.includes("funciona")) {
        botResponse = `Nosso atendimento humano funciona em: ${
          operatingHours || "Segunda a Sexta, das 09h às 18h"
        }. Mas eu, como assistente virtual, fico ativo 24 horas por dia no WhatsApp para anotar seus pedidos e tirar dúvidas!`;
      } else if (lower.includes("o que") || lower.includes("serviço") || lower.includes("produto") || lower.includes("faz")) {
        botResponse = `A ${companyName || "nossa empresa"} é especialista em ${
          segment ? `${segment}. ` : ""
        }Oferecemos ${
          products || "soluções completas com atendimento de excelência"
        }. Gostaria de conhecer mais detalhes?`;
      } else {
        botResponse = `Perfeito! Entendi sua dúvida sobre "${text}". Nossos especialistas da ${
          companyName || "equipe"
        } priorizam soluções objetivas e sem enrolação. Se desejar, posso agendar uma demonstração ou tirar outra dúvida agora mesmo!`;
      }

      const botMsg: Message = {
        id: `bot-${Date.now()}`,
        sender: "bot",
        text: botResponse,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, botMsg]);
      setIsTyping(false);
    }, 600);
  };

  const handleReset = () => {
    setMessages([
      {
        id: `initial-${Date.now()}`,
        sender: "bot",
        text: `Olá! Sou o assistente virtual da ${companyName || "sua empresa"}. Como posso te ajudar hoje com ${products ? products.toLowerCase() : "nossos serviços"}?`,
        time: "Agora",
      },
    ]);
  };

  return (
    <div className="flex flex-col h-[460px] rounded-xl border border-slate-200/80 bg-white dark:bg-card dark:border-border/80 shadow-xs overflow-hidden">
      {/* Top Header do Simulador */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/70 dark:border-border/60 bg-slate-50/70 dark:bg-muted/40">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
              <Bot className="w-4 h-4" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-card" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              Simulador Interativo ao Vivo
              <span className="text-[10px] font-medium px-1.5 py-0.2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400">
                Modo Sandbox
              </span>
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {hasConnectedChip ? "Simulando inteligência do chip conectado" : "Teste a IA antes de liberar o número"}
            </p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          className="h-7 px-2 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 gap-1"
          title="Reiniciar conversa de teste"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Limpar
        </Button>
      </div>

      {/* Área de Mensagens */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-slate-50/30 to-white dark:from-background dark:to-card/50"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex gap-2 max-w-[85%]",
              msg.sender === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-[10px] mt-0.5",
                msg.sender === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
              )}
            >
              {msg.sender === "user" ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
            </div>

            <div
              className={cn(
                "rounded-2xl px-3.5 py-2 text-xs leading-relaxed shadow-2xs",
                msg.sender === "user"
                  ? "bg-indigo-600 text-white rounded-tr-xs"
                  : "bg-white border border-slate-200/80 text-slate-800 dark:bg-slate-900/80 dark:border-border dark:text-slate-200 rounded-tl-xs"
              )}
            >
              <p>{msg.text}</p>
              <div
                className={cn(
                  "flex items-center justify-end gap-1 text-[9px] mt-1",
                  msg.sender === "user" ? "text-indigo-200" : "text-slate-400"
                )}
              >
                <span>{msg.time}</span>
                {msg.sender === "user" && <CheckCheck className="w-3 h-3 text-indigo-200" />}
              </div>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-2 mr-auto text-slate-400 text-xs">
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
              <Bot className="w-3 h-3" />
            </div>
            <div className="bg-white border border-slate-200/80 dark:bg-slate-900/80 dark:border-border rounded-2xl px-3 py-1.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.2s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.4s]" />
            </div>
          </div>
        )}
      </div>

      {/* Sugestões Rápidas */}
      <div className="px-3 py-2 border-t border-slate-100 dark:border-border/40 bg-slate-50/50 dark:bg-muted/20 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        <span className="text-[10px] font-semibold text-slate-400 shrink-0">Testes rápidos:</span>
        {DEFAULT_SUGGESTIONS.map((sug, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSend(sug.query)}
            disabled={isTyping}
            className="text-[11px] whitespace-nowrap px-2.5 py-1 rounded-full bg-white border border-slate-200/80 hover:border-indigo-300 hover:text-indigo-600 dark:bg-card dark:border-border dark:hover:border-indigo-400 text-slate-600 dark:text-slate-300 transition-colors shrink-0 shadow-2xs"
          >
            {sug.label}
          </button>
        ))}
      </div>

      {/* Campo de Envio */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="p-3 border-t border-slate-200/70 dark:border-border/60 bg-white dark:bg-card flex items-center gap-2"
      >
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Digite uma mensagem de teste como se fosse seu cliente..."
          className="text-xs h-9 bg-slate-50/60 dark:bg-slate-900/60 border-slate-200 focus-visible:ring-indigo-500"
          disabled={isTyping}
        />
        <Button
          type="submit"
          size="sm"
          disabled={!inputValue.trim() || isTyping}
          className="h-9 px-3 bg-indigo-600 hover:bg-indigo-500 text-white shrink-0 shadow-xs"
        >
          <Send className="w-3.5 h-3.5" />
        </Button>
      </form>
    </div>
  );
}
