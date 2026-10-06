import { useEffect, useRef, useState } from "react";
import {
  fetchSecondNumberAudience,
  fetchSecondNumberCampaigns,
  secondNumberNotices,
  type LeadRequest,
  type SecondNumberAudienceResponse,
  type SecondNumberCampaign,
} from "@/lib/leads/leadListApi";

export interface SecondNumberSelection {
  campaignId: string;
  campaignName: string;
  waitDays: number;
  /** marcado de propósito: manda também para o número que já recebeu (a mesma empresa duas vezes) */
  includePrincipal: boolean;
  audience: SecondNumberAudienceResponse | null;
}

interface Props {
  request: LeadRequest;
  clientId: string;
  onChange: (selection: SecondNumberSelection) => void;
}

const nf = (n: number) => n.toLocaleString("pt-BR");

/**
 * "Tentar o número adicional de quem não respondeu". A unidade é a EMPRESA: o disparo vai só para o número adicional que ainda não recebeu a
 * campanha, de quem recebeu, não respondeu em nenhum número e passou do prazo. Os avisos da prévia ficam sempre visíveis.
 */
export function SecondNumberPanel({ request, clientId, onChange }: Props) {
  // o pai recria `request` a cada render: dependência de efeito seria um laço de requisições
  const requestRef = useRef(request);
  requestRef.current = request;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [campaigns, setCampaigns] = useState<SecondNumberCampaign[] | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [waitDays, setWaitDays] = useState(7);
  const [includePrincipal, setIncludePrincipal] = useState(false);
  const [audience, setAudience] = useState<SecondNumberAudienceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSecondNumberCampaigns((...a) => requestRef.current(...a), clientId)
      .then((list) => alive && setCampaigns(list))
      .catch((e: Error) => alive && (setError(e.message), setCampaigns([])));
    return () => {
      alive = false;
    };
  }, [clientId]);

  useEffect(() => {
    setAudience(null);
    if (!campaignId || !Number.isInteger(waitDays) || waitDays < 1 || waitDays > 90) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetchSecondNumberAudience((...a) => requestRef.current(...a), { clientId, campaignId, waitDays })
      .then((a) => alive && setAudience(a))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [clientId, campaignId, waitDays]);

  useEffect(() => {
    const name = campaigns?.find((c) => c.id === campaignId)?.name ?? "";
    onChangeRef.current({ campaignId, campaignName: name, waitDays, includePrincipal, audience });
  }, [campaignId, waitDays, includePrincipal, audience, campaigns]);

  const notices = audience ? secondNumberNotices(audience.counts) : null;
  const c = audience?.counts;

  return (
    <div className="space-y-4 border-t border-border pt-4" data-testid="second-number-panel">
      <p className="text-[11px] text-muted-foreground">
        Pega quem recebeu uma campanha, <b>não respondeu em nenhum dos números</b> e tem outro telefone cadastrado, e manda só para o número que ainda
        não recebeu. A unidade é a empresa, não o telefone.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-foreground">
          Campanha que já foi enviada
          <select
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            data-testid="second-number-campaign"
          >
            <option value="">{campaigns === null ? "Carregando…" : campaigns.length === 0 ? "Nenhuma campanha com envio registrado" : "Escolha a campanha"}</option>
            {(campaigns ?? []).map((camp) => (
              <option key={camp.id} value={camp.id}>
                {camp.name} ({nf(camp.sentCount)} envios)
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-foreground">
          Esperar quantos dias depois do último envio
          <input
            type="number"
            min={1}
            max={90}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            value={Number.isFinite(waitDays) ? waitDays : ""}
            onChange={(e) => setWaitDays(e.target.value === "" ? NaN : Number(e.target.value))}
            data-testid="second-number-wait"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400" data-testid="second-number-error">
          {error}
        </p>
      )}
      {loading && <p className="text-xs text-muted-foreground">Calculando o público…</p>}

      {c && notices && (
        <div className="space-y-2" data-testid="second-number-preview">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-2.5 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between">
            <span>Empresas que receberão a segunda tentativa:</span>
            <span className="font-bold" data-testid="second-number-eligible">{nf(c.elegiveis)}</span>
          </div>
          <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
            <li>{nf(c.received)} empresas receberam a campanha{c.periodoDesde ? ` (desde ${new Date(c.periodoDesde).toLocaleDateString("pt-BR")})` : ""}</li>
            <li data-testid="second-number-excluded">{notices.excluded}</li>
            <li>{nf(c.respondeuMesmoNumero)} responderam no número que recebeu</li>
            <li>{nf(c.dentroDoPrazo)} ainda dentro do prazo de {c.waitDays} dias</li>
            <li>{nf(c.semAdicional)} sem outro número cadastrado (ou o outro número também já recebeu)</li>
          </ul>
          <p className="text-[11px] text-foreground" data-testid="second-number-unlinked">{notices.unlinked}</p>
          <p className="text-[11px] text-foreground" data-testid="second-number-legacy">{notices.legacy}</p>
        </div>
      )}

      <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={includePrincipal}
          onChange={(e) => setIncludePrincipal(e.target.checked)}
          data-testid="second-number-both"
          className="mt-0.5"
        />
        <span>
          Mandar também para o número que já recebeu. <b>Atenção: é a mesma empresa recebendo duas vezes.</b> Por padrão fica desmarcado.
        </span>
      </label>
    </div>
  );
}
