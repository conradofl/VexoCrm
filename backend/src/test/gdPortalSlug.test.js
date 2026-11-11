import { describe, expect, it } from "vitest";
import {
  TAMANHO_SUFIXO,
  garantirPortalSlugSecreto,
  gerarPortalSlug,
  gerarSufixoSecreto,
  temSufixoSecreto,
} from "../domains/gdClientes/portalSlug.js";
import { lerPortalSlug } from "../domains/gdClientes/campos.js";
import { montarMensagemAcompanhamentoPeriodico } from "../services/gdCustomerSuccessSchedulerService.js";

describe("slug secreto do portal do cliente", () => {
  it("o sufixo tem 12 símbolos e não repete entre chamadas", () => {
    const vistos = new Set();
    for (let i = 0; i < 200; i += 1) {
      const sufixo = gerarSufixoSecreto();
      expect(sufixo).toMatch(/^[a-km-np-z2-9]{12}$/);
      vistos.add(sufixo);
    }
    expect(TAMANHO_SUFIXO).toBe(12);
    expect(vistos.size).toBe(200);
  });

  it("gera slug a partir do nome, sem acento, com sufixo no fim", () => {
    const slug = gerarPortalSlug("Padaria Pão de Mel");
    expect(slug).toMatch(/^padaria-pao-de-mel-[a-km-np-z2-9]{12}$/);
    expect(temSufixoSecreto(slug)).toBe(true);
  });

  it("nome vazio ou só símbolos ainda gera slug válido, e nome longo cabe em 100 caracteres", () => {
    expect(gerarPortalSlug("")).toMatch(/^cliente-[a-km-np-z2-9]{12}$/);
    expect(gerarPortalSlug("!!!")).toMatch(/^cliente-[a-km-np-z2-9]{12}$/);
    const longo = gerarPortalSlug("a".repeat(300));
    expect(longo.length).toBeLessThanOrEqual(100);
    expect(temSufixoSecreto(longo)).toBe(true);
  });

  it("[OBRIGATÓRIO] nome de empresa comum não passa por slug secreto", () => {
    for (const nome of ["infinie-energia", "padaria-pao-de-mel", "vox2you-uberlandia", "cliente-solar-1762800000000", "", null, undefined, 42]) {
      expect(temSufixoSecreto(nome), String(nome)).toBe(false);
    }
  });

  it("o slug digitado no CRM ganha sufixo; o que já tem sufixo é mantido", () => {
    const novo = lerPortalSlug("Meu Slug");
    expect(novo).toMatch(/^meu-slug-[a-km-np-z2-9]{12}$/);
    expect(lerPortalSlug(novo)).toBe(novo);
    expect(lerPortalSlug("")).toBeNull();
  });

  it("[OBRIGATÓRIO] a mensagem da régua nunca leva link com slug sem sufixo", () => {
    const semLink = montarMensagemAcompanhamentoPeriodico({ cliente: { nome: "Alfa", portal_slug: "alfa" } });
    expect(semLink).not.toContain("/alfa");
    expect(semLink).toContain("Acesse seu link de acompanhamento");

    const slug = gerarPortalSlug("Alfa");
    const comLink = montarMensagemAcompanhamentoPeriodico({ cliente: { nome: "Alfa", portal_slug: slug } });
    expect(comLink).toContain(`/${slug}`);
  });
});

describe("garantirPortalSlugSecreto", () => {
  function bancoFalso(linha) {
    const estado = { ...linha };
    const chamadas = [];
    return {
      estado,
      chamadas,
      async query(sql, params) {
        chamadas.push(sql.trim().split(/\s+/)[0]);
        if (/^\s*SELECT/i.test(sql)) return { rows: estado.existe === false ? [] : [{ nome: estado.nome, portal_slug: estado.portal_slug }] };
        if (/^\s*UPDATE/i.test(sql)) {
          if (estado.portal_slug !== params[3]) return { rows: [] };
          estado.portal_slug = params[0];
          return { rows: [{ portal_slug: params[0] }] };
        }
        throw new Error("consulta inesperada");
      },
    };
  }

  it("troca o slug antigo por um com sufixo e grava", async () => {
    const db = bancoFalso({ nome: "Infinie Energia", portal_slug: "infinie-energia" });
    const slug = await garantirPortalSlugSecreto(db, { clienteId: "c1", donoClientId: "d1" });
    expect(slug).toMatch(/^infinie-energia-[a-km-np-z2-9]{12}$/);
    expect(db.estado.portal_slug).toBe(slug);
  });

  it("cliente sem slug ganha um a partir do nome", async () => {
    const db = bancoFalso({ nome: "Padaria Pão de Mel", portal_slug: null });
    const slug = await garantirPortalSlugSecreto(db, { clienteId: "c1", donoClientId: "d1" });
    expect(slug).toMatch(/^padaria-pao-de-mel-[a-km-np-z2-9]{12}$/);
  });

  it("não grava quando o slug já tem sufixo", async () => {
    const atual = gerarPortalSlug("Alfa");
    const db = bancoFalso({ nome: "Alfa", portal_slug: atual });
    expect(await garantirPortalSlugSecreto(db, { clienteId: "c1", donoClientId: "d1" })).toBe(atual);
    expect(db.chamadas).toEqual(["SELECT"]);
  });

  it("devolve null para cliente que não existe nesse dono", async () => {
    const db = bancoFalso({ existe: false });
    expect(await garantirPortalSlugSecreto(db, { clienteId: "c1", donoClientId: "d1" })).toBeNull();
  });
});
