// backend/src/test/ragChatSearch.test.js
//
// Testes da ponte RAG↔motor (rag/chatSearch.js), Etapa 5 / Leva 2 / Commit 3.
// Banco fake em memória filtra por client_id/company_id exatamente como o SQL
// real de chatSearch.js — se o código real perder o filtro ou trocar a ordem
// dos parâmetros, estes testes quebram (provado por mutação abaixo).
//
// O teste mais importante da leva: isolamento por tenant. Documento indexado
// pra "sonhare" não pode aparecer numa pergunta feita no contexto de
// "geracao-digital" — mesmo com conteúdo IDÊNTICO (mesmo embedding), pra
// garantir que quem separa é o filtro de tenant, não a similaridade.

import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.RAG_EMBEDDING_PROVIDER = "lexical";

let docs = [];
let chunks = [];

const fakePool = {
  query: vi.fn(async (sql, params) => {
    const text = String(sql);

    // A filtragem por client_id só é aplicada se o texto do SQL REALMENTE tiver
    // a cláusula — isto é uma simulação de banco, não uma trava fixa em JS. Se
    // o código real perder "client_id = $1" da query, o fake pool também para
    // de filtrar, exatamente como o Postgres devolveria linhas de tenants
    // misturados. É isso que faz o teste de isolamento pegar a mutação.
    if (text.includes("COUNT(*)::int AS n") && text.includes("FROM public.rag_documents")) {
      const [clientId, companyId] = params;
      const filtraCliente = text.includes("client_id = $1");
      const n = docs.filter(
        (d) => (!filtraCliente || d.client_id === clientId) && d.status === "ready" && (d.company_id == null || d.company_id === companyId)
      ).length;
      return { rows: [{ n }] };
    }

    if (text.includes("FROM public.rag_chunks rc") && text.includes("JOIN public.rag_documents rd")) {
      const [clientId, companyId] = params;
      const filtraCliente = text.includes("rd.client_id = $1");
      const matchingDocIds = new Set(
        docs
          .filter((d) => (!filtraCliente || d.client_id === clientId) && d.status === "ready" && (d.company_id == null || d.company_id === companyId))
          .map((d) => d.id)
      );
      const rows = chunks
        .filter((c) => matchingDocIds.has(c.document_id))
        .map((c) => ({
          document_id: c.document_id,
          content: c.content,
          embedding: JSON.stringify(c.embedding), // string — prova o parse em chatSearch.js
          embedding_provider: c.embedding_provider,
          embedding_model: c.embedding_model,
        }));
      return { rows };
    }

    throw new Error("query inesperada no fake pool: " + text.slice(0, 120));
  }),
};

vi.mock("../services/database.js", () => ({
  get pgDatabasePool() {
    return fakePool;
  },
}));

const { findRagContextForQuestion, buildRagContextBlock } = await import("../rag/chatSearch.js");
const { embedTexts, resolveEmbeddingIdentity } = await import("../services/embeddings.js");

const TEXTO_COMUM = "Parcelamos em até 12x sem juros no cartão de crédito.";
const TEXTO_IRRELEVANTE = "Nosso horário de atendimento é de segunda a sexta, das 9h às 18h.";

describe("findRagContextForQuestion — busca RAG escopada por tenant/agente", () => {
  beforeEach(() => {
    fakePool.query.mockClear();
    docs = [];
    chunks = [];
  });

  it("sem clientId ou pergunta vazia: applies false, nunca toca o banco", async () => {
    const r1 = await findRagContextForQuestion({ clientId: null, question: "oi" });
    expect(r1).toEqual({ applies: false, chunks: [], needsReindexDocumentIds: [] });

    const r2 = await findRagContextForQuestion({ clientId: "geracao-digital", question: "   " });
    expect(r2.applies).toBe(false);

    expect(fakePool.query).not.toHaveBeenCalled();
  });

  it("tenant sem nenhum documento pronto: applies false, só a contagem é consultada (embedding nunca é gerado)", async () => {
    docs = [{ id: "doc-1", client_id: "geracao-digital", company_id: null, status: "pending" }];

    const r = await findRagContextForQuestion({ clientId: "geracao-digital", question: "vocês parcelam?" });

    expect(r.applies).toBe(false);
    expect(r.chunks).toEqual([]);
    expect(fakePool.query).toHaveBeenCalledTimes(1);
  });

  it("[teste mais importante da leva] isolamento por tenant: documento da Sonhare não aparece na busca da Geração Digital, mesmo com conteúdo e embedding idênticos", async () => {
    const identity = resolveEmbeddingIdentity();
    const [embComum] = await embedTexts([TEXTO_COMUM], { provider: "lexical" });

    docs = [
      { id: "doc-gd", client_id: "geracao-digital", company_id: null, status: "ready" },
      { id: "doc-sonhare", client_id: "sonhare", company_id: null, status: "ready" },
    ];
    chunks = [
      {
        document_id: "doc-gd",
        content: `(Geração Digital) ${TEXTO_COMUM}`,
        embedding: embComum,
        embedding_provider: identity.provider,
        embedding_model: identity.model,
      },
      {
        document_id: "doc-sonhare",
        content: `(Sonhare) ${TEXTO_COMUM}`,
        embedding: embComum,
        embedding_provider: identity.provider,
        embedding_model: identity.model,
      },
    ];

    const r = await findRagContextForQuestion({ clientId: "geracao-digital", question: TEXTO_COMUM });

    expect(r.applies).toBe(true);
    expect(r.chunks).toHaveLength(1);
    expect(r.chunks[0].content).toContain("Geração Digital");
    expect(r.chunks.some((c) => c.content.includes("Sonhare"))).toBe(false);
  });

  it("escopo por empresa (companyId): documento amarrado a uma empresa não aparece na busca de outra empresa do mesmo tenant; documento sem empresa (tenant inteiro) aparece pras duas", async () => {
    const identity = resolveEmbeddingIdentity();
    const [embComum] = await embedTexts([TEXTO_COMUM], { provider: "lexical" });

    docs = [
      { id: "doc-empresa-a", client_id: "geracao-digital", company_id: "empresa-a", status: "ready" },
      { id: "doc-tenant-wide", client_id: "geracao-digital", company_id: null, status: "ready" },
    ];
    chunks = [
      {
        document_id: "doc-empresa-a",
        content: `(Empresa A) ${TEXTO_COMUM}`,
        embedding: embComum,
        embedding_provider: identity.provider,
        embedding_model: identity.model,
      },
      {
        document_id: "doc-tenant-wide",
        content: `(Tenant inteiro) ${TEXTO_COMUM}`,
        embedding: embComum,
        embedding_provider: identity.provider,
        embedding_model: identity.model,
      },
    ];

    const rEmpresaB = await findRagContextForQuestion({ clientId: "geracao-digital", companyId: "empresa-b", question: TEXTO_COMUM });
    expect(rEmpresaB.chunks.map((c) => c.document_id)).toEqual(["doc-tenant-wide"]);

    const rEmpresaA = await findRagContextForQuestion({ clientId: "geracao-digital", companyId: "empresa-a", question: TEXTO_COMUM });
    const idsEmpresaA = rEmpresaA.chunks.map((c) => c.document_id).sort();
    expect(idsEmpresaA).toEqual(["doc-empresa-a", "doc-tenant-wide"].sort());
  });

  it("nenhum trecho acima do limiar de similaridade: applies true, chunks vazio (não confunde com 'sem documento')", async () => {
    const identity = resolveEmbeddingIdentity();
    const [embIrrelevante] = await embedTexts([TEXTO_IRRELEVANTE], { provider: "lexical" });

    docs = [{ id: "doc-1", client_id: "geracao-digital", company_id: null, status: "ready" }];
    chunks = [
      {
        document_id: "doc-1",
        content: TEXTO_IRRELEVANTE,
        embedding: embIrrelevante,
        embedding_provider: identity.provider,
        embedding_model: identity.model,
      },
    ];

    const r = await findRagContextForQuestion({ clientId: "geracao-digital", question: "vocês parcelam em quantas vezes no cartão de crédito?" });

    expect(r.applies).toBe(true);
    expect(r.chunks).toEqual([]);
  });

  it("colunas de procedência (embedding_provider/embedding_model) estão no SELECT que busca os trechos", async () => {
    const identity = resolveEmbeddingIdentity();
    const [emb] = await embedTexts([TEXTO_COMUM], { provider: "lexical" });
    docs = [{ id: "doc-1", client_id: "geracao-digital", company_id: null, status: "ready" }];
    chunks = [{ document_id: "doc-1", content: TEXTO_COMUM, embedding: emb, embedding_provider: identity.provider, embedding_model: identity.model }];

    await findRagContextForQuestion({ clientId: "geracao-digital", question: TEXTO_COMUM });

    const chunkQueryCall = fakePool.query.mock.calls.find(([sql]) => sql.includes("FROM public.rag_chunks"));
    expect(chunkQueryCall).toBeTruthy();
    expect(chunkQueryCall[0]).toContain("rd.embedding_provider");
    expect(chunkQueryCall[0]).toContain("rd.embedding_model");
  });
});

describe("buildRagContextBlock — bloco de contexto injetado no prompt", () => {
  it("sem trechos: string vazia (prompt não muda)", () => {
    expect(buildRagContextBlock([])).toBe("");
    expect(buildRagContextBlock(null)).toBe("");
    expect(buildRagContextBlock(undefined)).toBe("");
  });

  it("com trechos: inclui o conteúdo e a instrução de responder só com o que está ali, sem citar fonte", () => {
    const block = buildRagContextBlock([{ content: "Parcelamos em 12x." }, { content: "Entrega em 5 dias úteis." }]);

    expect(block).toContain("Parcelamos em 12x.");
    expect(block).toContain("Entrega em 5 dias úteis.");
    expect(block).toContain("BASE DE CONHECIMENTO");
    expect(block.toLowerCase()).not.toMatch(/trecho \d|documento \d/);
  });
});
