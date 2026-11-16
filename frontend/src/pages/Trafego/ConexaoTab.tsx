// Aba Conexão: contas por plataforma, estado, última coleta e erro visível.
// Conta sem token no servidor aparece como "não conectada", sem número.
import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock, Pause, Play, Plus, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatDateTime,
  useCreateTrafficAccount,
  useSetTrafficAccountStatus,
  useTrafficAccounts,
  type TrafficAccount,
} from "@/hooks/useTraffic";

const PLATFORM_LABEL = { meta: "Meta Ads", google: "Google Ads" } as const;

function AccountState({ account, platformConnected }: { account: TrafficAccount; platformConnected: boolean }) {
  if (!platformConnected) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Unplug className="h-4 w-4 shrink-0" />
        Não conectada. Sem coleta e sem número até o acesso ser configurado.
      </p>
    );
  }
  if (account.status === "paused") {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Pause className="h-4 w-4 shrink-0" />
        Coleta pausada.{" "}
        {account.lastSyncAt ? `Sem atualização desde ${formatDateTime(account.lastSyncAt)}.` : "Nunca coletada."}
      </p>
    );
  }
  if (account.lastSyncError) {
    return (
      <div className="space-y-1" role="alert">
        <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {account.lastSyncAt
            ? `Sem atualização desde ${formatDateTime(account.lastSyncAt)}.`
            : "Nenhuma coleta deu certo ainda."}
        </p>
        <p className="break-words text-sm text-muted-foreground">
          Última tentativa{account.lastSyncAttemptAt ? ` em ${formatDateTime(account.lastSyncAttemptAt)}` : ""}:{" "}
          {account.lastSyncError}
        </p>
      </div>
    );
  }
  if (!account.lastSyncAt) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Clock className="h-4 w-4 shrink-0" />
        Aguardando a primeira coleta.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      Última coleta em {formatDateTime(account.lastSyncAt)}.
    </p>
  );
}

export function ConexaoTab({ clientId }: { clientId: string }) {
  const { data, isLoading, isError, error } = useTrafficAccounts(clientId);
  const createAccount = useCreateTrafficAccount(clientId);
  const setStatus = useSetTrafficAccountStatus(clientId);
  const [accountId, setAccountId] = useState("");
  const [displayName, setDisplayName] = useState("");

  if (isLoading) {
    return <div className="rounded-2xl border bg-card/60 p-8 text-center text-sm text-muted-foreground">Carregando contas...</div>;
  }
  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm" role="alert">
        <p className="font-medium text-destructive">Não foi possível carregar as contas.</p>
        <p className="mt-1 text-muted-foreground">{(error as Error)?.message}</p>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await createAccount.mutateAsync({
        platform: "meta",
        externalAccountId: accountId.trim(),
        displayName: displayName.trim() || undefined,
      });
      setAccountId("");
      setDisplayName("");
      toast.success("Conta cadastrada.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const toggle = async (account: TrafficAccount) => {
    try {
      await setStatus.mutateAsync({ id: account.id, status: account.status === "active" ? "paused" : "active" });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["meta", "google"] as const).map((platform) => {
          const state = data.platforms[platform];
          return (
            <div key={platform} className="rounded-2xl border bg-card/60 p-4" data-testid={`plataforma-${platform}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{PLATFORM_LABEL[platform]}</p>
                {!state.available ? (
                  <Badge variant="outline">Disponível em breve</Badge>
                ) : state.connected ? (
                  <Badge className="bg-emerald-600 hover:bg-emerald-600">Conectada</Badge>
                ) : (
                  <Badge variant="secondary">Não conectada</Badge>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {!state.available
                  ? "A coleta do Google Ads entra na próxima entrega."
                  : state.connected
                    ? "O acesso de leitura está configurado no servidor."
                    : "O acesso de leitura ainda não foi configurado no servidor. Enquanto isso, nenhuma conta é lida."}
              </p>
            </div>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground" data-testid="estado-coleta">
        {data.collector.enabled
          ? `Coleta automática ligada: ${data.collector.hours.join(", ")} (horário de Brasília).`
          : "Coleta automática desligada no servidor. As contas abaixo não são atualizadas até ela ser ligada."}
      </p>

      <div className="rounded-2xl border bg-card/60">
        <div className="border-b p-4">
          <h2 className="font-medium">Contas de anúncio</h2>
        </div>
        {data.accounts.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Nenhuma conta cadastrada nesta empresa.</p>
        ) : (
          <ul className="divide-y">
            {data.accounts.map((account) => (
              <li key={account.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between" data-testid="conta">
                <div className="min-w-0 space-y-1">
                  <p className="break-words font-medium">
                    {account.displayName || `Conta ${account.externalAccountId}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {PLATFORM_LABEL[account.platform]} · {account.externalAccountId}
                    {account.currency ? ` · ${account.currency}` : ""}
                  </p>
                  <AccountState account={account} platformConnected={data.platforms[account.platform].connected} />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 self-start"
                  disabled={setStatus.isPending}
                  onClick={() => toggle(account)}
                >
                  {account.status === "active" ? (
                    <>
                      <Pause className="mr-1.5 h-4 w-4" /> Pausar coleta
                    </>
                  ) : (
                    <>
                      <Play className="mr-1.5 h-4 w-4" /> Retomar coleta
                    </>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={submit} className="rounded-2xl border bg-card/60 p-4">
        <h2 className="font-medium">Cadastrar conta da Meta</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use o número da conta de anúncios. A conta precisa estar compartilhada com a Geração Digital como parceira.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="trafego-conta-id">Número da conta</Label>
            <Input
              id="trafego-conta-id"
              inputMode="numeric"
              placeholder="Ex.: 1234567890"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trafego-conta-nome">Nome para identificar (opcional)</Label>
            <Input id="trafego-conta-nome" value={displayName} maxLength={120} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <Button type="submit" disabled={createAccount.isPending || !accountId.trim()}>
            <Plus className="mr-1.5 h-4 w-4" /> Cadastrar
          </Button>
        </div>
      </form>
    </div>
  );
}
