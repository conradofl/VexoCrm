import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { registerGeracaoDigitalRoutes } from "../domains/geracaoDigitalRoutes.js";
import { parseTemplateContentToClauses, assembleContractFromBlocks } from "../domains/geracaoDigitalContracts/contractMerge.js";
import { validarCnpjMatematico } from "../domains/gdClientes/campos.js";

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
const MIGRATION_NOVO_MODELO = readFileSync(
  resolve("supabase/migrations/20261106110000_update_gd_contract_template_novo_modelo.sql"),
  "utf8"
);
const MIGRATION_CALENDAR = readFileSync(
  resolve("supabase/migrations/20261108100000_gd_clientes_google_calendar_email.sql"),
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

describe("Chat GD · Atualização e Unificação do Modelo Oficial de Contrato Jurídico GD", () => {
  beforeAll(async () => {
    db = await createPgliteDb(`
      SET TimeZone = 'UTC';
      CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text NOT NULL);
      INSERT INTO public.leads_clients VALUES ('geracao-digital', 'Geração Digital');

      CREATE TABLE public.tenants (id uuid PRIMARY KEY, name text);
      INSERT INTO public.tenants VALUES ('00000000-0000-0000-0000-000000000000', 'Geração Digital');

      CREATE TABLE public.tenant_modules (tenant_id uuid PRIMARY KEY, config jsonb, updated_at timestamptz DEFAULT now());
    `);

    await db.exec(MIGRATION_ESTADOS);
    await db.exec(MIGRATION_CAMPOS);
    await db.exec(MIGRATION_TRILHA);
    await db.exec(MIGRATION_CONTRACTS);
    await db.exec(MIGRATION_CLAUSULAS);
    await db.exec(MIGRATION_NOVO_MODELO);
    await db.exec(MIGRATION_CALENDAR);

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

  it("1. Migration grava dados oficiais da Contratada GD em tenant_modules", async () => {
    const res = await db.query(
      `SELECT config FROM public.tenant_modules WHERE tenant_id = '00000000-0000-0000-0000-000000000000'`
    );
    expect(res.rows.length).toBe(1);
    const config = res.rows[0].config;
    const contratada = config.contratada;

    expect(contratada.razao_social).toBe("AGÊNCIA GERAÇÃO DIGITAL LTDA");
    expect(contratada.cnpj).toBe("66.722.723/0001-02");
    expect(contratada.representante).toBe("Caio Vinícius Almeida de Oliveira");
    expect(contratada.endereco).toContain("Av. Paraná, 65, Tibery, Uberlândia – MG");
    expect(contratada.telefone).toBe("(34) 99771-9779");
    expect(contratada.email).toBe("comercial@mktgeracaodigital.com.br");
    expect(contratada.comarca).toBe("Uberlândia – MG");
    expect(contratada.assinatura).toBe("Caio Vinícius Almeida de Oliveira");
  });

  it("2. Migration cadastra o novo modelo oficial ativo com as 6 cláusulas estruturadas", async () => {
    const res = await db.query(
      `SELECT * FROM public.gd_contract_templates
       WHERE tenant_id = '00000000-0000-0000-0000-000000000000' AND ativo = true`
    );
    expect(res.rows.length).toBe(1);
    const template = res.rows[0];

    expect(template.nome).toBe("Contrato Oficial de Parceria - Marketing Digital & Automação");
    expect(template.conteudo).toContain("CONTRATO DE PRESTAÇÃO DE SERVIÇOS");
    expect(template.conteudo).toContain("MARKETING DIGITAL & AUTOMAÇÃO");

    const clausulas = template.clausulas;
    expect(Array.isArray(clausulas)).toBe(true);
    expect(clausulas.length).toBe(6);

    const ids = clausulas.map((c) => c.id);
    expect(ids).toEqual(["partes", "objetos", "obrigacoes", "preco_condicoes", "prazo", "foro"]);

    const titulos = clausulas.map((c) => c.titulo);
    expect(titulos).toEqual([
      "Das Partes",
      "Dos Objetos",
      "Das Obrigações das Partes",
      "Do Preço e Condições",
      "Do Prazo",
      "Do Foro",
    ]);

    // Cláusula de obrigações deve conter menção ao sistema Vexo
    expect(clausulas[2].conteudo).toContain("utilização do sistema Vexo");
  });

  it("3. Parser e assembler tratam títulos de cláusula com separador pipe |", () => {
    const rawContent = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS
MARKETING DIGITAL & AUTOMAÇÃO

CLÁUSULA PRIMEIRA | DAS PARTES
Contratada: {{contratada_razao_social}}
Contratante: {{razao_social}}

CLÁUSULA SEGUNDA | DOS OBJETOS
Serviços de marketing e automação.

E, por estarem assim justas e contratadas, assinam.`;

    const parsed = parseTemplateContentToClauses(rawContent);
    expect(parsed.clausulas.length).toBe(2);
    expect(parsed.clausulas[0].titulo).toBe("DAS PARTES");
    expect(parsed.clausulas[1].titulo).toBe("DOS OBJETOS");

    const assembled = assembleContractFromBlocks({
      tituloPrincipal: parsed.tituloPrincipal,
      clausulas: parsed.clausulas,
      fechamento: parsed.fechamento,
    });

    expect(assembled).toContain("Cláusula Primeira – DAS PARTES");
    expect(assembled).toContain("Cláusula Segunda – DOS OBJETOS");
  });

  it("4. Agente Cartório gera minuta vinculada ao novo modelo oficial no aceite da proposta", async () => {
    // 1. Cria proposta
    const propRes = await db.query(
      `INSERT INTO public.gd_proposals (
         tenant_id, prospect_name, valor_total, condicoes_pagamento, status
       )
       VALUES (
         '00000000-0000-0000-0000-000000000000',
         'Container Solution Ltda',
         16800.00,
         '{"ofertadas":[{"id":"cond-1","parcelas":[{"numero":1,"valor":3360,"tipo":"cartao"},{"numero":2,"valor":13440,"tipo":"permuta"}]}]}'::jsonb,
         'enviada'
       )
       RETURNING id`
    );
    const proposalId = propRes.rows[0].id;

    // 2. Aceita a proposta com os dados da empresa do docx modelo
    const payload = {
      assinatura: "Lucas Gonçalves Fernandes",
      signer_name: "Lucas Gonçalves Fernandes",
      assinatura_metodo: "digitado",
      condicao_escolhida_id: "cond-1",
      razao_social: "CONTAINER SOLUTION LTDA",
      cnpj: "29.447.330/0001-01",
      responsavel_nome: "Lucas Gonçalves Fernandes",
      responsavel_cpf: "12345678901",
      telefone: "5534999259499",
      email_contratante: "lucasfernandes9827@gmail.com",
      email_agenda_google: "lucasfernandes9827@gmail.com",
      endereco: {
        logradouro: "Av. Nicomedes Alves dos Santos",
        numero: "3600",
        cidade: "Uberlândia",
        uf: "MG",
      },
    };

    const resAssinar = await chamar("POST", `/api/gd/public/proposals/${proposalId}/assinar`, payload);
    expect(resAssinar.status).toBe(200);
    expect(resAssinar.json.success).toBe(true);

    // 3. Verifica minuta gerada em public.gd_contracts
    const contractRes = await db.query(
      `SELECT * FROM public.gd_contracts WHERE proposal_id = $1`,
      [proposalId]
    );
    expect(contractRes.rows.length).toBe(1);
    const contract = contractRes.rows[0];

    expect(contract.status).toBe("rascunho");
    expect(contract.dados.razao_social).toBe("CONTAINER SOLUTION LTDA");
    expect(contract.dados.cnpj).toBe("29447330000101");
    expect(contract.dados.representante_nome).toBe("Lucas Gonçalves Fernandes");
    expect(contract.dados.prazo_meses).toBe("12");

    // Verifica que os dados da Contratada oficial GD vieram populados
    expect(contract.dados.contratada_razao_social).toBe("AGÊNCIA GERAÇÃO DIGITAL LTDA");
    expect(contract.dados.contratada_cnpj).toBe("66.722.723/0001-02");
    expect(contract.dados.contratada_representante).toBe("Caio Vinícius Almeida de Oliveira");
    expect(contract.dados.contratada_comarca).toBe("Uberlândia – MG");

    // Verifica que o cliente em public.gd_clientes foi atualizado e vinculado ao contrato
    const cliRes = await db.query(
      `SELECT * FROM public.gd_clientes WHERE proposal_id = $1`,
      [proposalId]
    );
    expect(cliRes.rows.length).toBe(1);
    const cliente = cliRes.rows[0];
    expect(cliente.contract_id).toBe(contract.id);
    expect(cliente.nome).toBe("CONTAINER SOLUTION LTDA");
  });

  it("5. Validador matemático de CNPJ reconhece o CNPJ oficial da GD e do docx", () => {
    expect(validarCnpjMatematico("66.722.723/0001-02")).toBe(true); // GD oficial
    expect(validarCnpjMatematico("29.447.330/0001-01")).toBe(true); // Container Solution docx
    expect(validarCnpjMatematico("40.508.817/0001-90")).toBe(true); // Legado Caio
    expect(validarCnpjMatematico("00.000.000/0000-00")).toBe(false); // Zerado
    expect(validarCnpjMatematico("66.722.723/0001-03")).toBe(false); // DV errado
  });
});
