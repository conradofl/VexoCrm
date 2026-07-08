import { FormEvent } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

interface BulkForm {
  oldBaseUrl: string;
  newBaseUrl: string;
  updateDispatchToken: boolean;
  dispatchWebhookToken: string;
}

interface BulkReplaceFormProps {
  form: BulkForm;
  onChange: (form: BulkForm) => void;
  onSubmit: (event: FormEvent) => void;
  isPending: boolean;
}

export function BulkReplaceForm({ form, onChange, onSubmit, isPending }: BulkReplaceFormProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Troca de host em massa</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto]"
          onSubmit={onSubmit}
        >
          <Input
            value={form.oldBaseUrl}
            onChange={(event) => onChange({ ...form, oldBaseUrl: event.target.value })}
            placeholder="https://evolution-antiga.com"
          />
          <Input
            value={form.newBaseUrl}
            onChange={(event) => onChange({ ...form, newBaseUrl: event.target.value })}
            placeholder="https://evolution-nova.com"
          />
          <div className="flex items-center gap-2 rounded-lg border px-3">
            <Switch
              checked={form.updateDispatchToken}
              onCheckedChange={(value) => onChange({ ...form, updateDispatchToken: value })}
            />
            <span className="whitespace-nowrap text-xs text-muted-foreground">sobrescrever token</span>
          </div>
          <Button type="submit" disabled={isPending}>
            <Save className="mr-2 h-4 w-4" />
            Aplicar
          </Button>
          {form.updateDispatchToken && (
            <Input
              className="lg:col-span-2"
              type="password"
              value={form.dispatchWebhookToken}
              onChange={(event) => onChange({ ...form, dispatchWebhookToken: event.target.value })}
              placeholder="Nova API key/token de disparo"
            />
          )}
        </form>
      </CardContent>
    </Card>
  );
}
