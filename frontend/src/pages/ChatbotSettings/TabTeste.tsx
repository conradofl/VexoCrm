import { useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

/**
 * "Failed to fetch" e "signal is aborted" não dizem nada a quem está testando um
 * prompt. Traduz para o que de fato aconteceu e para o que fazer.
 */
function describeRequestFailure(e: unknown): string {
  const nome = e instanceof DOMException ? e.name : "";
  const msg = e instanceof Error ? e.message : String(e);

  if (nome === "AbortError" || /abort/i.test(msg)) {
    return "o modelo demorou demais para responder e a requisição foi cancelada. Tente de novo; se repetir, o provedor de IA está lento ou fora.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "não foi possível falar com a API. Backend fora do ar, ou a origem desta página não está liberada no CORS do servidor.";
  }
  return msg || "erro desconhecido";
}

type SimMemoria = { historico: { role: "user" | "assistant"; content: string }[]; dados: Record<string, unknown> };
const memoriaVazia = (): SimMemoria => ({ historico: [], dados: {} });

export function TabTeste({ clientId }: { clientId: string }) {
  const { getIdToken } = useAuth();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversation, setConversation] = useState<{ role: "user" | "bot"; text: string }[]>([]);
  // Memória do teste mora AQUI, não num lead do banco (antes: telefone fixo
  // 5511999999999 gravado em public.leads). O servidor devolve a memória do
  // próximo turno e a tela manda de volta.
  const memoriaRef = useRef<SimMemoria>(memoriaVazia());
  // Cada limpeza abre uma geração nova: resposta antiga que chega depois do
  // clique é descartada e não destrava o envio da conversa nova.
  const geracaoRef = useRef(0);

  async function handleSend() {
    if (!message.trim()) return;
    const userMsg = message.trim();
    const geracao = geracaoRef.current;
    const atual = () => geracao === geracaoRef.current;
    setMessage("");
    setConversation((c) => [...c, { role: "user", text: userMsg }]);
    setLoading(true);
    try {
      const token = await getIdToken();
      const res = await fetchApi("/api/chatbot-test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clientId, message: userMsg, simulacao: memoriaRef.current }),
        // Um turno do agente é uma chamada de LLM com rotação de modelos: passa
        // dos 15s padrão com facilidade. No timeout o fetch é abortado e a tela
        // mostrava "Falha: Failed to fetch", como se a API estivesse fora.
        timeoutMs: 90000,
      });
      if (!atual()) return;
      if (res.ok) {
        const data = await readApiJson<{ response?: string | null; reason?: string; avisos?: string[]; simulacao?: SimMemoria }>(res, "chatbot_test");
        if (!atual()) return;
        if (data?.simulacao) memoriaRef.current = data.simulacao;
        const botMsg = data?.response;
        if (botMsg) setConversation((c) => [...c, { role: "bot", text: botMsg }]);
        else setConversation((c) => [...c, { role: "bot", text: `⚠️ ${data?.reason ?? "Sem resposta — verifique se o prompt padrão está configurado."}` }]);
        // Resposta gerada mas com problema por trás (não salvou, repetiu a
        // anterior). Sem isto o defeito só aparece dois turnos depois.
        for (const aviso of data?.avisos ?? []) {
          setConversation((c) => [...c, { role: "bot", text: `⚠️ ${aviso}` }]);
        }
      } else if (res.status === 503) {
        // Chave de IA quebrada: o dono resolve trocando a chave, nao mexendo no
        // prompt. Sem este ramo aparecia como "Prompt não configurado".
        const dados = await res.json().catch(() => null);
        if (dados?.code === "LLM_CREDENTIAL_INVALID") {
          setConversation((c) => [...c, { role: "bot", text: `🔑 Credencial de IA inválida — ${dados?.reason || "troque a chave no EasyPanel."}` }]);
        } else {
          setConversation((c) => [...c, { role: "bot", text: `Erro: ${dados?.reason || dados?.error || "Erro"}` }]);
        }
      } else if (res.status === 429) {
        // Cota esgotada não é erro técnico: é informação de negócio. Aparece com
        // rótulo próprio para o dono não confundir com "prompt errado".
        const dados = await res.json().catch(() => null);
        const detalhe = dados?.reason || dados?.error || "A cota de IA da conta acabou.";
        setConversation((c) => [...c, { role: "bot", text: `🚫 Cota de IA esgotada — ${detalhe}` }]);
      } else {
        const err = await readApiErrorMessage(res, "Erro");
        setConversation((c) => [...c, { role: "bot", text: `Erro: ${err}` }]);
      }
    } catch (e) {
      if (!atual()) return;
      setConversation((c) => [...c, { role: "bot", text: `Falha: ${describeRequestFailure(e)}` }]);
    } finally {
      if (atual()) setLoading(false);
    }
  }

  function limparConversa() {
    geracaoRef.current += 1;
    memoriaRef.current = memoriaVazia();
    setConversation([]);
    setLoading(false);
  }

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-slate-500">
        Simule uma conversa com o chatbot desta empresa. As mensagens não chegam ao WhatsApp real e não criam lead no Banco.
      </p>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="min-h-[320px] max-h-[400px] overflow-y-auto space-y-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900 p-3">
            {conversation.length === 0 && (
              <p className="text-center text-xs text-slate-400 py-8">Envie uma mensagem para iniciar a conversa.</p>
            )}
            {conversation.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-indigo-500 text-white rounded-br-sm"
                    : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 rounded-bl-sm"
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-2xl rounded-bl-sm px-3 py-2 text-xs text-slate-400">
                  digitando...
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder="Digite uma mensagem..."
              disabled={loading}
              className="h-9 text-sm"
            />
            <Button size="sm" aria-label="Enviar" className="h-9 gap-1.5" onClick={handleSend} disabled={loading || !message.trim()}>
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>

          {conversation.length > 0 && (
            <Button variant="ghost" size="sm" className="w-full text-xs text-slate-400" onClick={limparConversa}>
              Limpar conversa
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
