import { FormEvent } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EditForm, EditTarget, EvolutionInventory } from "@/lib/evolutionAdmin/types";

interface EditDialogProps {
  open: boolean;
  target: EditTarget | null;
  form: EditForm;
  inventory: EvolutionInventory | undefined;
  onFormChange: (form: EditForm) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  isPending: boolean;
}

export function EditDialog({
  open,
  target,
  form,
  inventory,
  onFormChange,
  onSubmit,
  onClose,
  isPending,
}: EditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar configuracao Evolution</DialogTitle>
          <DialogDescription>Campos de segredo vazios preservam o valor atual.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          {target?.type === "instance" && (
            <>
              <div className="grid gap-2">
                <Label>Nome da instancia</Label>
                <Input value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>URL de disparo</Label>
                <Input value={form.dispatchWebhookUrl} onChange={(event) => onFormChange({ ...form, dispatchWebhookUrl: event.target.value })} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>API key/token</Label>
                  <Input type="password" value={form.dispatchWebhookToken} onChange={(event) => onFormChange({ ...form, dispatchWebhookToken: event.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Inbound bearer token</Label>
                  <Input type="password" value={form.inboundBearerToken} onChange={(event) => onFormChange({ ...form, inboundBearerToken: event.target.value })} />
                </div>
              </div>
            </>
          )}
          {target?.type === "legacy" && (
            <>
              <div className="grid gap-2">
                <Label>URL de disparo legada</Label>
                <Input value={form.dispatchWebhookUrl} onChange={(event) => onFormChange({ ...form, dispatchWebhookUrl: event.target.value })} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>API key/token</Label>
                  <Input type="password" value={form.dispatchWebhookToken} onChange={(event) => onFormChange({ ...form, dispatchWebhookToken: event.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Inbound bearer token</Label>
                  <Input type="password" value={form.inboundBearerToken} onChange={(event) => onFormChange({ ...form, inboundBearerToken: event.target.value })} />
                </div>
              </div>
            </>
          )}
          {target?.type === "followup" && (
            <>
              <div className="grid gap-2">
                <Label>Nome da instancia Evolution</Label>
                <Input value={form.evolutionInstance} onChange={(event) => onFormChange({ ...form, evolutionInstance: event.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Webhook de repasse</Label>
                <Input value={form.webhookUrl} onChange={(event) => onFormChange({ ...form, webhookUrl: event.target.value })} />
              </div>
            </>
          )}
          {target?.type === "remote" && (
            <>
              <div className="grid gap-2">
                <Label>Empresa</Label>
                <Select value={form.tenantId} onValueChange={(value) => onFormChange({ ...form, tenantId: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {(inventory?.tenants ?? []).map((tenant) => (
                      <SelectItem key={tenant.id} value={tenant.id}>
                        {tenant.name} ({tenant.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Nome local</Label>
                <Input value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>URL de disparo</Label>
                <Input value={form.dispatchWebhookUrl} disabled />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>API key/token</Label>
                  <Input type="password" value={form.dispatchWebhookToken} onChange={(event) => onFormChange({ ...form, dispatchWebhookToken: event.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Inbound bearer token</Label>
                  <Input type="password" value={form.inboundBearerToken} onChange={(event) => onFormChange({ ...form, inboundBearerToken: event.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.isDefault} onCheckedChange={(value) => onFormChange({ ...form, isDefault: value })} />
                <Label>Definir como padrao da empresa</Label>
              </div>
            </>
          )}
          {target?.type !== "followup" && (
            <div className="flex items-center gap-2">
              <Switch checked={form.active} onCheckedChange={(value) => onFormChange({ ...form, active: value })} />
              <Label>Ativo</Label>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              <Save className="mr-2 h-4 w-4" />
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
