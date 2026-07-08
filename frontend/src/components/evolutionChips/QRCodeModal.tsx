import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface QRCodeModalProps {
  open: boolean;
  qrModal: {
    base64: string;
    tenantName: string;
    instanceName: string | null;
  } | null;
  onClose: () => void;
}

export function QRCodeModal({ open, qrModal, onClose }: QRCodeModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md rounded-2xl p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">Parear WhatsApp</DialogTitle>
          <DialogDescription className="text-xs">
            Siga as instruções abaixo para vincular o chip <strong>{qrModal?.instanceName ?? "da empresa"}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          {qrModal?.base64 && (
            <div className="p-3 bg-white border border-slate-200/80 rounded-2xl shadow-sm dark:border-white/10">
              <img
                src={qrModal.base64}
                alt="QR Code para parear o WhatsApp"
                className="h-60 w-60 rounded-xl"
              />
            </div>
          )}
          <div className="text-center text-sm space-y-2">
            <p className="font-medium text-foreground text-xs">
              No celular, abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho
            </p>
            <p className="text-[11px] text-muted-foreground px-4">
              O QR Code expira rapidamente. Se necessário, feche este modal, remova a conexão criada e gere um novo QR Code.
            </p>
          </div>
        </div>
        <DialogFooter className="sm:justify-center">
          <Button type="button" variant="outline" className="rounded-xl w-full sm:w-28" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
