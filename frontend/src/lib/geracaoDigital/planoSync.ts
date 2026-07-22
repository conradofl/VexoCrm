import { fetchApi } from "@/lib/api";
import { type Plano, type PeriodoKey, planoParaPacotes, PERIODOS } from "./plano";

// Grava o plano como linhas `gd_packages` ad_hoc — uma por prazo ofertado.
// Reaproveita a linha existente do mesmo prazo (PUT) em vez de criar outra,
// para não repetir o histórico de duplicatas que a biblioteca acumulou
// ("Pacote Vitallis" x3, "Pacote Start - Cópia"). Prazo que deixou de ser
// ofertado tem a linha apagada.

export interface SyncPlanoResult {
  /** ids na ordem dos prazos — o cliente escolhe entre eles */
  pacotesOfertados: string[];
  /** prazo mais longo ofertado; pré-seleção da proposta */
  packageId: string;
  /** linhas gravadas, para o caller atualizar o cache de pacotes */
  pacotes: any[];
}

export async function syncPlanoPackages(opts: {
  plano: Plano;
  nomeBase: string;
  clientId: string | null;
  gdProducts: any[];
  vexoProducts: any[];
  /** linhas ad_hoc já ofertadas por esta proposta, se estiver editando */
  existentes?: any[];
  getIdToken: () => Promise<string | null>;
}): Promise<SyncPlanoResult> {
  const { plano, nomeBase, clientId, gdProducts, vexoProducts, existentes = [], getIdToken } = opts;

  const token = await getIdToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const payloads = planoParaPacotes(plano, nomeBase, gdProducts, vexoProducts);
  const porPeriodo = new Map<string, any>();
  existentes.forEach((p) => {
    if (p?.ad_hoc && p?.periodo && !porPeriodo.has(p.periodo)) porPeriodo.set(p.periodo, p);
  });

  const pacotes: any[] = [];
  for (const payload of payloads) {
    const existente = porPeriodo.get(payload.periodo);
    const body = JSON.stringify({ client_id: clientId, ...payload });
    const res = existente
      ? await fetchApi(`/api/gd/packages/${existente.id}`, { method: "PUT", headers, body })
      : await fetchApi("/api/gd/packages", { method: "POST", headers, body });
    if (!res.ok) throw new Error(`Falha ao gravar o preço ${payload.periodo}.`);
    const json = await res.json();
    pacotes.push(json.data);
    porPeriodo.delete(payload.periodo);
  }

  // Prazos que saíram da oferta: apaga a linha para não virar lixo no catálogo.
  for (const orfa of porPeriodo.values()) {
    try {
      await fetchApi(`/api/gd/packages/${orfa.id}`, { method: "DELETE", headers });
    } catch {
      // Falha aqui não invalida o plano: a linha só deixa de ser ofertada.
    }
  }

  // Ordem dos prazos = ordem de PERIODOS (mensal → anual), previsível na proposta.
  const ordenados = PERIODOS.map((p) => pacotes.find((x) => x.periodo === p.key)).filter(Boolean);
  const maisLongo = [...ordenados].reverse()[0];

  return {
    pacotesOfertados: ordenados.map((p: any) => p.id),
    packageId: maisLongo?.id || "",
    pacotes: ordenados,
  };
}
