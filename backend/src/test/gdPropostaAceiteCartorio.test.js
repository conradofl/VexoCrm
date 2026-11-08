import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { registerGeracaoDigitalRoutes } from "../domains/geracaoDigitalRoutes.js";

const MIGRATION_ESTADOS = readFileSync(
  resolve("supabase/migrations/20261102120000_create_gd_estados_clientes.sql"),
  "utf8"
);
const MIGRATION_CAMPOS = readFileSync(
  resolve("supabase/migrations/20261103120000_gd_clientes_aprovador_drive_escopo.sql"),
  "utf8"
);
const MIGRATION_TRILHA = readFileSync(
  resolve("supabase/migrations/20261103180000_gd_estados_acao_rotulo_portal.sql"),
  "utf8"
);
const MIGRATION_CONTRACTS = readFileSync(
  resolve("supabase/migrations/20260715140000_create_gd_contracts_tables.sql"),
  "utf8"
);
const MIGRATION_CLAUSULAS = readFileSync(
  resolve("supabase/migrations/20260929120000_add_clausulas_to_gd_contract_templates.sql"),
  "utf8"
);
const MIGRATION_CALENDAR = readFileSync(
  resolve("supabase/migrations/20261108100000_gd_clientes_google_calendar_email.sql"),
  "utf8"
);
const MIGRATION_BRIEFING = readFileSync(
  resolve("supabase/migrations/20261108110000_gd_clientes_briefing_scheduling.sql"),
  "utf8"
);

let db;
let server;
let baseUrl;

function poolDe(pg) {
  const query = async (sql, params) => pg.query(sql, params);
  const client = { query, release() {} };
  return { query, connect: async () => client };
}

async function chamar(metodo, caminho, body) {
  const res = await fetch(`${baseUrl}${caminho}`, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

describe("Chat GD · Proposta e Contrato — Aceite da Proposta e Agente Cartório", () => {
  beforeAll(async () => {
    db = await createPgliteDb(`
      SET TimeZone = 'UTC';
      CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text NOT NULL);
      INSERT INTO public.leads_clients VALUES ('geracao-digital', 'Geração Digital');

      CREATE TABLE public.tenants (id uuid PRIMARY KEY, name text);
      INSERT INTO public.tenants VALUES ('00000000-0000-0000-0000-000000000000', 'Geração Digital');

      CREATE TABLE public.tenant_modules (tenant_id uuid PRIMARY KEY, config jsonb);
      INSERT INTO public.tenant_modules VALUES (
        '00000000-0000-0000-0000-000000000000',
        '{"contratada":{"razao_social":"Geração Digital Treinamentos","cnpj":"40.508.817/0001-90","representante":"Caio Vinícius","endereco":"Av. Paraná, 65","telefone":"5534997719779","email":"contato@geracaodigital.com","comarca":"Uberlândia"}}'::jsonb
      );
    `);

    await db.exec(MIGRATION_ESTADOS);
    await db.exec(MIGRATION_CAMPOS);
    await db.exec(MIGRATION_TRILHA);
    await db.exec(MIGRATION_CONTRACTS);
    await db.exec(MIGRATION_CLAUSULAS);
    await db.exec(MIGRATION_CALENDAR);
    await db.exec(MIGRATION_BRIEFING);

    // Template ativo padrão para a GD
    await db.exec(`
      INSERT INTO public.gd_contract_templates (id, tenant_id, nome, conteudo, ativo)
      VALUES (
        '11111111-2222-3333-4444-555555555555',
        '00000000-0000-0000-0000-000000000000',
        'Template GD Padrão',
        'CONTRATO DE PRESTAÇÃO DE SERVIÇOS\\n\\nContratante: {{razao_social}}, CNPJ: {{cnpj}}',
        true
      ) ON CONFLICT DO NOTHING;
    `);

    const app = express();
    app.use(express.json());

    const noopAuth = (req, _res, next) => next();
    registerGeracaoDigitalRoutes(app, poolDe(db), noopAuth, () => noopAuth);

    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (db) await db.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Recusa aceite com CNPJ inválido ou zerado (HTTP 422) e validações de razão social e e-mail (HTTP 400)", async () => {
    const propId = "a1111111-1111-1111-1111-111111111111";
    await db.query(`
      INSERT INTO public.gd_proposals (id, tenant_id, prospect_name, valor_total, status)
      VALUES ($1, '00000000-0000-0000-0000-000000000000', 'Prospect Teste', 5000, 'enviada')
      ON CONFLICT (id) DO UPDATE SET status = 'enviada'
    `, [propId]);

    // CNPJ zerado -> 422
    const resZerado = await chamar("POST", `/api/gd/public/proposals/${propId}/assinar`, {
      assinatura: "data:image/png;base64,assinatura_teste",
      signer_name: "Representante",
      razao_social: "Empresa Teste Ltda",
      cnpj: "00000000000000",
      email_contratante: "cliente@teste.com",
    });
    expect(resZerado.status).toBe(422);
    expect(resZerado.json.error).toBe("CNPJ_INVALIDO");

    // CNPJ matematicamente inválido (dígitos verificadores errados) -> 422
    const resDigitosInvalidos = await chamar("POST", `/api/gd/public/proposals/${propId}/assinar`, {
      assinatura: "data:image/png;base64,assinatura_teste",
      signer_name: "Representante",
      razao_social: "Empresa Teste Ltda",
      cnpj: "12.345.678/0001-90",
      email_contratante: "cliente@teste.com",
    });
    expect(resDigitosInvalidos.status).toBe(422);
    expect(resDigitosInvalidos.json.error).toBe("CNPJ_INVALIDO");

    // Falta razão social -> 400
    const resSemRazao = await chamar("POST", `/api/gd/public/proposals/${propId}/assinar`, {
      assinatura: "assinatura",
      cnpj: "00.000.000/0001-91", // CNPJ válido (Banco do Brasil)
      email_contratante: "cliente@teste.com",
    });
    expect(resSemRazao.status).toBe(400);
    expect(resSemRazao.json.error).toBe("RAZAO_SOCIAL_OBRIGATORIA");

    // Falta e-mail -> 400
    const resSemEmail = await chamar("POST", `/api/gd/public/proposals/${propId}/assinar`, {
      assinatura: "assinatura",
      razao_social: "Empresa Teste Ltda",
      cnpj: "00.000.000/0001-91",
    });
    expect(resSemEmail.status).toBe(400);
    expect(resSemEmail.json.error).toBe("EMAIL_CONTRATANTE_OBRIGATORIO");

    // Falta e-mail da agenda Google -> 400
    const resSemEmailAgenda = await chamar("POST", `/api/gd/public/proposals/${propId}/assinar`, {
      assinatura: "assinatura",
      razao_social: "Empresa Teste Ltda",
      cnpj: "00.000.000/0001-91",
      email_contratante: "cliente@teste.com",
    });
    expect(resSemEmailAgenda.status).toBe(400);
    expect(resSemEmailAgenda.json.error).toBe("EMAIL_AGENDA_GOOGLE_OBRIGATORIO");
  });

  it("2, 3 e 4. Aceite com dados válidos: grava proposta aceita, cria cliente em gd_clientes com dados cadastrais e escopo, registra eventos PROPOSTA_ACEITA e CONTRATO_EM_REVISAO em ordem, gera minuta gd_contracts e notifica Slack", async () => {
    const propId = "b2222222-2222-2222-2222-222222222222";
    await db.query(`
      INSERT INTO public.gd_proposals (
        id, tenant_id, prospect_name, valor_total, condicoes, status, itens, condicoes_pagamento
      )
      VALUES (
        $1,
        '00000000-0000-0000-0000-000000000000',
        'Clínica Sorriso Perfeito',
        12000,
        '12x de R$ 1.000',
        'enviada',
        '[{"descricao":"Gestão Google Ads","valor":1000,"recorrencia":"mensal"}]'::jsonb,
        '{"parcelas":[{"data":"2026-12-01","valor":1000,"tipo":"dinheiro"}]}'::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET status = 'enviada'
    `, [propId]);

    // Mock do Slack Webhook
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/TEST/SLACK/WEBHOOK";
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).includes("slack.com")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return originalFetch(url, init);
    });

    const payload = {
      assinatura: "assinatura-base64-desenho",
      signer_name: "Dra. Ana Paula",
      assinatura_metodo: "desenho",
      razao_social: "Clínica Sorriso Perfeito Ltda",
      cnpj: "00.000.000/0001-91", // CNPJ válido (Banco do Brasil)
      endereco: {
        cep: "38400-100",
        logradouro: "Av. Afonso Pena",
        numero: "1500",
        complemento: "Sala 302",
        bairro: "Centro",
        cidade: "Uberlândia",
        uf: "MG",
      },
      responsavel_nome: "Ana Paula Silva",
      responsavel_cpf: "123.456.789-00",
      telefone: "34988887777",
      email_contratante: "contato@sorrisoperfeito.com.br",
      email_agenda_google: "agenda@sorrisoperfeito.com.br",
      escopo: ["google", "social", "meta"],
    };

    const resAceite = await chamar("POST", `/api/gd/public/proposals/${propId}/assinar`, payload);
    expect(resAceite.status).toBe(200);
    expect(resAceite.json.success).toBe(true);

    // 2. Comprova proposta aceita e dados cadastrais gravados
    const propNoBanco = (await db.query(`SELECT * FROM public.gd_proposals WHERE id = $1`, [propId])).rows[0];
    expect(propNoBanco.status).toBe("aceita");
    expect(propNoBanco.assinatura).toBe(payload.assinatura);
    expect(propNoBanco.signer_name).toBe(payload.signer_name);
    expect(propNoBanco.dados_cadastrais).toBeDefined();
    expect(propNoBanco.dados_cadastrais.razao_social).toBe("Clínica Sorriso Perfeito Ltda");
    expect(propNoBanco.dados_cadastrais.cnpj).toBe("00000000000191");
    expect(propNoBanco.dados_cadastrais.email_contratante).toBe("contato@sorrisoperfeito.com.br");
    expect(propNoBanco.dados_cadastrais.escopo).toEqual(["google", "social", "meta"]);

    // Comprova cliente em public.gd_clientes criado e atualizado com dados cadastrais e escopo
    const clienteNoBanco = (await db.query(`SELECT * FROM public.gd_clientes WHERE proposal_id = $1`, [propId])).rows[0];
    expect(clienteNoBanco).toBeDefined();
    expect(clienteNoBanco.nome).toBe("Clínica Sorriso Perfeito Ltda");
    expect(clienteNoBanco.cnpj).toBe("00000000000191");
    expect(clienteNoBanco.aprovador_nome).toBe("Ana Paula Silva");
    expect(clienteNoBanco.aprovador_telefone).toBe("5534988887777");
    expect(clienteNoBanco.google_calendar_email).toBe("agenda@sorrisoperfeito.com.br");
    expect(clienteNoBanco.escopo).toEqual(["google", "social", "meta"]);
    expect(clienteNoBanco.estado_atual).toBe("CONTRATO_EM_REVISAO");

    // 3. Comprova que os dois eventos da esteira foram criados em ordem (PROPOSTA_ACEITA e depois CONTRATO_EM_REVISAO)
    const eventos = (await db.query(`
      SELECT estado_para, origem, ator_tipo, ator_id, motivo
      FROM public.gd_cliente_eventos
      WHERE cliente_id = $1
      ORDER BY seq ASC
    `, [clienteNoBanco.id])).rows;

    expect(eventos).toHaveLength(2);

    expect(eventos[0].estado_para).toBe("PROPOSTA_ACEITA");
    expect(eventos[0].origem).toBe("fluxo");
    expect(eventos[0].ator_tipo).toBe("sistema");
    expect(eventos[0].ator_id).toBe("public-proposal");

    expect(eventos[1].estado_para).toBe("CONTRATO_EM_REVISAO");
    expect(eventos[1].origem).toBe("fluxo");
    expect(eventos[1].ator_tipo).toBe("sistema");
    expect(eventos[1].ator_id).toBe("agente-cartorio");

    // 4. Comprova que a minuta em gd_contracts foi criada com os dados da empresa e vinculada ao cliente (gd_clientes.contract_id)
    const contratoNoBanco = (await db.query(`SELECT * FROM public.gd_contracts WHERE proposal_id = $1`, [propId])).rows[0];
    expect(contratoNoBanco).toBeDefined();
    expect(contratoNoBanco.status).toBe("rascunho");
    expect(clienteNoBanco.contract_id).toBe(contratoNoBanco.id);

    // Dados do contrato
    const dadosContrato = contratoNoBanco.dados;
    expect(dadosContrato.razao_social).toBe("Clínica Sorriso Perfeito Ltda");
    expect(dadosContrato.cnpj).toBe("00000000000191");
    expect(dadosContrato.representante).toBe("Ana Paula Silva");
    expect(dadosContrato.telefone).toBe("5534988887777");
    expect(dadosContrato.email).toBe("contato@sorrisoperfeito.com.br");
    expect(dadosContrato.email_agenda_google).toBe("agenda@sorrisoperfeito.com.br");
    expect(dadosContrato.endereco).toContain("Av. Afonso Pena, 1500");
    expect(dadosContrato.endereco).toContain("Uberlândia - MG");
    expect(dadosContrato.contratada_razao_social).toBe("Geração Digital Treinamentos");
    expect(dadosContrato.contratada_cnpj).toBe("40.508.817/0001-90");

    // 5. Comprova notificação Slack disparada
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/TEST/SLACK/WEBHOOK",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "📝 *[Cartório GD]* Nova proposta aceita! Contrato gerado em revisão para *Clínica Sorriso Perfeito Ltda* (CNPJ: 00.000.000/0001-91). Prazo de revisão: 4h úteis.",
        }),
      })
    );

    delete process.env.SLACK_WEBHOOK_URL;
  });

  it("3. Atualiza cliente pré-existente sem duplicar quando CNPJ coincide", async () => {
    const propId = "c3333333-3333-3333-3333-333333333333";
    const cnpjExistente = "11.222.333/0001-81"; // CNPJ matematicamente válido
    const cnpjLimpo = "11222333000181";

    // Cria cliente pré-existente na base (ex: importação anterior ou lead)
    const insCli = await db.query(`
      INSERT INTO public.gd_clientes (dono_client_id, nome, cnpj, origem)
      VALUES ('geracao-digital', 'Empresa Prévia Ltda', $1, 'importacao_inicial')
      RETURNING id
    `, [cnpjLimpo]);
    const clienteExistenteId = insCli.rows[0].id;

    // Registra evento inicial para o cliente prévio ter um estado
    await db.query(`
      SELECT public.gd_registrar_evento($1, 'PROPOSTA_ENVIADA', now() - interval '1 day', false, 'fluxo', 'sistema', 'seed-teste')
    `, [clienteExistenteId]);

    // Insere proposta
    await db.query(`
      INSERT INTO public.gd_proposals (id, tenant_id, prospect_name, valor_total, status)
      VALUES ($1, '00000000-0000-0000-0000-000000000000', 'Empresa Prévia', 8000, 'enviada')
      ON CONFLICT (id) DO UPDATE SET status = 'enviada'
    `, [propId]);

    const payload = {
      assinatura: "assinatura-atualizada",
      signer_name: "Diretor Geral",
      razao_social: "Empresa Prévia Nova Razão Ltda",
      cnpj: cnpjExistente,
      responsavel_nome: "Diretor Geral da Silva",
      telefone: "11977776666",
      email_contratante: "diretoria@empresa.com",
      email_agenda_google: "agenda@empresa.com",
      escopo: ["google", "linkedin"],
    };

    const res = await chamar("POST", `/api/gd/public/proposals/${propId}/assinar`, payload);
    expect(res.status).toBe(200);
    expect(res.json.cliente_id).toBe(clienteExistenteId);

    // Confirma que não houve duplicação de cliente
    const countClientes = (await db.query(
      `SELECT count(*)::int as count FROM public.gd_clientes WHERE cnpj = $1`,
      [cnpjLimpo]
    )).rows[0].count;
    expect(countClientes).toBe(1);

    // Confirma atualização dos dados cadastrais e escopo no cliente existente
    const clienteAtualizado = (await db.query(
      `SELECT * FROM public.gd_clientes WHERE id = $1`,
      [clienteExistenteId]
    )).rows[0];
    expect(clienteAtualizado.nome).toBe("Empresa Prévia Nova Razão Ltda");
    expect(clienteAtualizado.proposal_id).toBe(propId);
    expect(clienteAtualizado.contract_id).toBeTruthy();
    expect(clienteAtualizado.aprovador_nome).toBe("Diretor Geral da Silva");
    expect(clienteAtualizado.aprovador_telefone).toBe("5511977776666");
    expect(clienteAtualizado.google_calendar_email).toBe("agenda@empresa.com");
    expect(clienteAtualizado.escopo).toEqual(["google", "linkedin"]);
    expect(clienteAtualizado.estado_atual).toBe("CONTRATO_EM_REVISAO");
  });
});
