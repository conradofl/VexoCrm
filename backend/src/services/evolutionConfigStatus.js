// Prova, sem abrir o EasyPanel nem o banco à mão, o que falta para tirar do código o host e a
// chave da Evolution e escolher a instância padrão de cada fluxo (PR 4b do untangle, 24/11/2026).
//
// Vai no /health. Só sim/não e contagens: nunca valor de variável, chave, token ou URL.
// - env: quais variáveis de host/chave estão definidas (o código ainda cai num valor escrito
//   no código quando falta; este bloco diz se esse valor ainda é usado de fato).
// - instanciasPadrao: para cada nome que o código usa como padrão, se existe cadastrada, se está
//   ativa e se está conectada (por nome ou pelo fim da dispatch_webhook_url).
// Consulta que falha devolve { medido: false } (o /health não cai por causa disto).

export const EVOLUTION_URL_ENVS = ["EVOLUTION_API_URL", "EVOLUTION_API_ENDPOINT", "GD_EVOLUTION_URL"];
export const EVOLUTION_KEY_ENVS = [
  "EVOLUTION_API_KEY",
  "EVOLUTION_GLOBAL_KEY",
  "GD_EVOLUTION_API_TOKEN",
  "GD_EVOLUTION_TOKEN",
];
export const EVOLUTION_INSTANCE_ENVS = ["GD_EVOLUTION_INSTANCE", "GD_ONBOARDING_EVOLUTION_INSTANCE"];

// Nomes que o código usa como instância padrão quando a empresa não diz qual: services/defaultInstances.js (um lugar só).
export { INSTANCIAS_PADRAO_DO_CODIGO } from "./defaultInstances.js";
import { INSTANCIAS_PADRAO_DO_CODIGO } from "./defaultInstances.js";

function definida(nome, env) {
  return typeof env[nome] === "string" && env[nome].trim() !== "";
}

export function evolutionEnvStatus(env = process.env) {
  const out = {};
  for (const nome of [...EVOLUTION_URL_ENVS, ...EVOLUTION_KEY_ENVS, ...EVOLUTION_INSTANCE_ENVS]) {
    out[nome] = definida(nome, env);
  }
  return out;
}

export const SQL_INSTANCIAS_PADRAO = `
  SELECT n.nome,
         count(i.id)::int AS cadastradas,
         count(i.id) FILTER (WHERE i.active)::int AS ativas,
         count(i.id) FILTER (WHERE i.active AND i.connection_state = 'open')::int AS conectadas
    FROM unnest($1::text[]) AS n(nome)
    LEFT JOIN public.lead_client_evolution_instances i
      ON i.name = n.nome
      OR rtrim(i.dispatch_webhook_url, '/') LIKE '%/' || n.nome
   GROUP BY n.nome
`;

export async function computeEvolutionConfigStatus(pool, env = process.env) {
  const status = { env: evolutionEnvStatus(env), instanciasPadrao: { medido: false } };
  if (!pool) return status;
  try {
    const { rows } = await pool.query(SQL_INSTANCIAS_PADRAO, [INSTANCIAS_PADRAO_DO_CODIGO]);
    const porNome = {};
    for (const r of rows) {
      porNome[r.nome] = { cadastradas: r.cadastradas, ativas: r.ativas, conectadas: r.conectadas };
    }
    status.instanciasPadrao = { medido: true, ...porNome };
  } catch {
    status.instanciasPadrao = { medido: false };
  }
  return status;
}
