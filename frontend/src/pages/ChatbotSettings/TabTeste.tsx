import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";

export function TabTeste({ clientId }: { clientId: string }) {
  const { getIdToken } = useAuth();
  const [phone] = useState("5511999999999");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversation, setConversation] = useState<{ role: "user" | "bot"; text: string }[]>([]);

  async function handleSend() {
    if (!message.trim()) return;
    const userMsg = message.trim();
    setMessage("");
    setConversation((c) => [...c, { role: "user", text: userMsg }]);
    setLoading(true);
    try {
      const token = await getIdToken();
      const res = await fetchApi("/api/chatbot-test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clientId, phone, message: userMsg }),
      });
      if (res.ok) {
        const data = await readApiJson<{ response?: string | null; reason?: string }>(res, "chatbot_test");
        const botMsg = data?.response;
        if (botMsg) setConversation((c) => [...c, { role: "bot", text: botMsg }]);
        else setConversation((c) => [...c, { role: "bot", text: `⚠️ ${data?.reason ?? "Sem resposta — verifique se o prompt padrão está configurado."}` }]);
      } else {
        const err = await readApiErrorMessage(res, "Erro");
        setConversation((c) => [...c, { role: "bot", text: `Erro: ${err}` }]);
      }
    } catch (e) {
      setConversation((c) => [...c, { role: "bot", text: `Falha: ${e instanceof Error ? e.message : "Erro desconhecido"}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-slate-500">
        Simule uma conversa com o chatbot desta empresa. As mensagens usam um número fictício e não chegam ao WhatsApp real.
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
            <Button size="sm" className="h-9 gap-1.5" onClick={handleSend} disabled={loading || !message.trim()}>
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>

          {conversation.length > 0 && (
            <Button variant="ghost" size="sm" className="w-full text-xs text-slate-400" onClick={() => setConversation([])}>
              Limpar conversa
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
