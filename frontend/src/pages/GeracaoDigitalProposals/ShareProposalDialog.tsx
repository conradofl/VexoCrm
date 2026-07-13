import { useState } from "react";
import { toast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Share2, Copy, MessageSquare, Mail } from "lucide-react";
import { fetchApi } from "@/lib/api";

interface ShareProposalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  prospectName: string;
  clientId: string | null | undefined;
  getIdToken: () => Promise<string | null>;
}

// Modal de compartilhamento do link público da proposta: copiar, WhatsApp e
// e-mail (via ResendProvider no backend — mesma infra do briefing/handoff).
export function ShareProposalDialog({
  open,
  onOpenChange,
  proposalId,
  prospectName,
  clientId,
  getIdToken
}: ShareProposalDialogProps) {
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [email, setEmail] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const shareLink = `${window.location.origin}/proposta/${proposalId}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareLink);
    toast({ title: "Link Copiado", description: "O link da proposta foi copiado para a área de transferência." });
  };

  const handleWhatsApp = () => {
    const numberClean = whatsappNumber.replace(/\D/g, "");
    if (!numberClean) {
      toast({
        title: "Número inválido",
        description: "Por favor, digite o número com DDI (ex: 55 para Brasil) e DDD.",
        variant: "destructive"
      });
      return;
    }
    const msg = `Olá! Segue o link para visualizar a sua proposta comercial da Geração Digital: ${shareLink}`;
    window.open(`https://wa.me/${numberClean}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const handleEmail = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "E-mail inválido", description: "Digite um e-mail válido de destino.", variant: "destructive" });
      return;
    }
    try {
      setIsSendingEmail(true);
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetchApi(`/api/gd/proposals/${proposalId}/enviar-email`, {
        method: "POST",
        headers,
        body: JSON.stringify({ client_id: clientId, email, base_url: window.location.origin })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Erro ao enviar o e-mail.");
      toast({ title: "E-mail Enviado", description: data.message || `Proposta enviada para ${email}.` });
      setEmail("");
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro no Envio", description: err.message, variant: "destructive" });
    } finally {
      setIsSendingEmail(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white border border-slate-200 shadow-2xl rounded-2xl p-6 space-y-4">
        <DialogHeader>
          <DialogTitle className="text-lg font-black text-slate-800 flex items-center gap-2">
            <Share2 className="h-5 w-5 text-indigo-600" />
            Compartilhar Proposta Comercial
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-505 font-light">
            A proposta de <strong>{prospectName}</strong> está pronta. Use os canais abaixo para entregar o link de acesso público.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block">Link Público da Proposta</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={shareLink}
                className="bg-slate-50 border-slate-200 text-xs font-mono text-slate-700 h-9 flex-1"
              />
              <Button
                size="sm"
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 h-9 border border-slate-200"
                onClick={handleCopy}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <Label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block">Enviar por WhatsApp</Label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="Ex: 5511999999999 (com DDI + DDD)"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                className="bg-white border-slate-200 text-xs text-slate-700 h-9 flex-1"
              />
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-9 gap-1.5"
                onClick={handleWhatsApp}
              >
                <MessageSquare className="h-4 w-4" />
                Enviar
              </Button>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <Label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider flex items-center gap-1">
              <Mail className="h-3.5 w-3.5 text-slate-400" />
              Enviar por E-mail
            </Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="cliente@empresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-white border-slate-200 text-xs text-slate-700 h-9 flex-1"
              />
              <Button
                size="sm"
                disabled={isSendingEmail}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold h-9 gap-1.5"
                onClick={handleEmail}
              >
                <Mail className="h-4 w-4" />
                {isSendingEmail ? "Enviando..." : "Enviar"}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button
            variant="outline"
            className="w-full border-slate-200 text-slate-600 hover:bg-slate-50 h-9 font-bold"
            onClick={() => onOpenChange(false)}
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
