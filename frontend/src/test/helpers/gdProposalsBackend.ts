// Backend simulado das propostas de Geração Digital, só para os testes da página.
// Guarda as propostas e os pacotes em memória e responde às mesmas rotas que a página chama.
// Registra cada POST/PUT para o teste inspecionar o corpo exato enviado.
//
// Fidelidade ao backend real: o POST cria a linha só com nome e dono (o que a página manda), e o PUT
// grava SOMENTE os campos de shared/proposalEditorFields.json — a mesma lista que o teste do backend
// garante. Um campo que o PUT real não gravasse também sumiria aqui, em vez de "persistir" por acaso.
import EDITOR_FIELDS from "../../../../shared/proposalEditorFields.json";

const PERSISTED: { field: string; column: string }[] = (EDITOR_FIELDS as any).persisted;

export interface RecordedCall {
  method: string;
  url: string;
  body: any;
}

export const GD_PRODUCTS = [
  { id: "g1", nome: "Tráfego Pago" },
  { id: "g2", nome: "Social Media" },
];

export function createGdBackend(seed: { proposals?: any[]; packages?: any[] } = {}) {
  const proposals: any[] = (seed.proposals || []).map((p) => ({ ...p }));
  const packages: any[] = (seed.packages || []).map((p) => ({ ...p }));
  const calls: RecordedCall[] = [];
  let seq = 0;
  let failNextPut = false;

  const json = (status: number, payload: any) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    blob: async () => new Blob(),
  });

  async function fetchApi(url: string, init: any = {}) {
    const method = String(init.method || "GET").toUpperCase();
    const path = String(url).split("?")[0];
    const query = new URLSearchParams(String(url).split("?")[1] || "");
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method !== "GET") calls.push({ method, url: String(url), body });

    if (method === "GET") {
      if (path === "/api/gd/proposals") return json(200, { success: true, data: proposals });
      if (path === "/api/gd/packages") {
        // sem ids = catálogo da biblioteca (ad_hoc fica de fora); com ids = os referenciados
        const ids = query.get("ids");
        const data = ids ? packages.filter((p) => ids.split(",").includes(p.id)) : packages.filter((p) => !p.ad_hoc);
        return json(200, { success: true, data });
      }
      if (path === "/api/gd/products") return json(200, { success: true, data: GD_PRODUCTS });
      return json(200, { success: true, data: [] }); // segments, vexo-products, payment-terms
    }

    if (path === "/api/gd/packages" && method === "POST") {
      const row = { id: `pk-new-${++seq}`, tipo: "gd", ...body };
      packages.push(row);
      return json(201, { success: true, data: row });
    }
    const pkgMatch = path.match(/^\/api\/gd\/packages\/(.+)$/);
    if (pkgMatch && method === "PUT") {
      const idx = packages.findIndex((p) => p.id === pkgMatch[1]);
      packages[idx] = { ...packages[idx], ...body };
      return json(200, { success: true, data: packages[idx] });
    }

    if (path === "/api/gd/proposals" && method === "POST") {
      // o POST real cria a linha com o que o corpo trouxer; a página manda só nome e dono
      const row = {
        id: `prop-new-${++seq}`,
        status: "rascunho",
        created_at: new Date().toISOString(),
        prospect_name: body.prospect_name,
        owner_company: body.owner_company,
        itens: [],
      };
      proposals.unshift(row);
      return json(201, { success: true, data: row });
    }
    const propMatch = path.match(/^\/api\/gd\/proposals\/(.+)$/);
    if (propMatch && method === "PUT") {
      const idx = proposals.findIndex((p) => p.id === propMatch[1]);
      if (failNextPut) {
        failNextPut = false;
        return json(500, { error: "falha simulada ao gravar" });
      }
      const next = { ...proposals[idx] };
      for (const { field, column } of PERSISTED) {
        if (Object.prototype.hasOwnProperty.call(body, field) && body[field] !== undefined) next[column] = body[field];
      }
      proposals[idx] = next;
      return json(200, { success: true, data: next });
    }

    return json(404, { error: `rota não simulada: ${method} ${path}` });
  }

  return {
    fetchApi,
    proposals,
    packages,
    calls,
    saves: () => calls.filter((c) => c.url.startsWith("/api/gd/proposals")),
    /** o próximo PUT de proposta responde 500 (para testar o "criada, mas não gravou") */
    failNextPut: () => {
      failNextPut = true;
    },
  };
}
