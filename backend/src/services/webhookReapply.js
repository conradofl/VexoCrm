// Reaplica o webhook da Evolution de todas as instâncias do Vexo com o token no cabeçalho e sem token na URL.
// CLI: src/scripts/reaplicarWebhooksEvolution.mjs (dry-run por padrão). Roteiro da troca no corpo do PR.
//
// Nunca imprime valor de token: da URL só host, caminho e NOMES dos parâmetros; dos cabeçalhos só os NOMES.
import { CABECALHO_TOKEN_WEBHOOK, tokenParaEnviar } from "./webhookAuth.js";
import { configureEvolutionInstanceWebhook, getEvolutionAdminConfig } from "./evolution.js";

function partesDaUrlDeDisparo(url) {
  try {
    const u = new URL(String(url));
    const partes = u.pathname.split("/");
    return { baseUrl: `${u.protocol}//${u.host}`, instancia: decodeURIComponent(partes[partes.length - 1] || "") || null };
  } catch {
    return { baseUrl: null, instancia: null };
  }
}

/** Descrição segura do webhook que a Evolution tem hoje. */
export function descreverWebhook(j) {
  const w = j && typeof j === "object" ? j.webhook || j : {};
  let host = null;
  let params = [];
  try {
    const u = new URL(String(w.url));
    host = u.host + u.pathname;
    params = Array.from(u.searchParams.keys());
  } catch {}
  const cabecalhos = w.headers && typeof w.headers === "object" ? Object.keys(w.headers).map((k) => k.toLowerCase()) : null;
  return {
    ligado: w.enabled === true,
    host,
    params,
    cabecalhos,
    tokenNaUrl: params.some((p) => p.toLowerCase() === "token"),
    temCabecalho: Array.isArray(cabecalhos) && cabecalhos.includes(CABECALHO_TOKEN_WEBHOOK),
    apontaParaVexo: Boolean(host && host.endsWith("/api/hardcoded-chat-webhook")),
  };
}

async function buscarWebhook(fetchImpl, baseUrl, instancia, apiKey) {
  try {
    const r = await fetchImpl(`${baseUrl}/webhook/find/${encodeURIComponent(instancia)}`, {
      headers: { apikey: apiKey, Accept: "application/json" },
    });
    let j = null;
    try {
      j = JSON.parse(await r.text());
    } catch {}
    return r.ok ? { ok: true, atual: descreverWebhook(j) } : { ok: false, erro: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, erro: String(e?.message || e).slice(0, 120) };
  }
}

const txt = (d) =>
  d ? `${d.ligado ? "ligado" : "DESLIGADO"} | ${d.host || "-"} | params: ${d.params.join(",") || "-"} | cabeçalhos: ${d.cabecalhos === null ? "(campo ausente)" : d.cabecalhos.join(",") || "-"}` : "-";

/**
 * aplicar=false: só lista o que mudaria. aplicar=true: reaplica e confere lendo de volta.
 * instancia: limita a uma instância (canário). Devolve o resumo; `log` recebe cada linha.
 */
export async function reaplicarWebhooks({ pool, fetchImpl = globalThis.fetch, env = process.env, aplicar = false, instancia = null, log = console.log }) {
  const resumo = { total: 0, mudariam: 0, aplicadas: 0, conferidas: 0, falhas: 0, puladas: 0, foraDoBanco: [] };
  if (aplicar && !tokenParaEnviar(env)) {
    log("ABORTADO: EVOLUTION_WEBHOOK_TOKEN não está no ambiente. Sem ele a Evolution passaria a mandar sem token nenhum.");
    resumo.falhas = 1;
    return resumo;
  }
  const admin = getEvolutionAdminConfig();
  const { rows } = await pool.query(
    `SELECT client_id, name, dispatch_webhook_url, dispatch_webhook_token, webhook_enabled, active
       FROM public.lead_client_evolution_instances ORDER BY client_id, name`
  );
  log(`${aplicar ? "APLICAR" : "DRY-RUN (nada é alterado)"} | ${rows.length} instância(s) no banco${instancia ? ` | só ${instancia}` : ""}`);

  const vistas = new Map();
  for (const row of rows) {
    const { baseUrl, instancia: nome } = partesDaUrlDeDisparo(row.dispatch_webhook_url);
    if (!nome || !baseUrl) {
      log(`  ${row.client_id} | ${row.name} | URL de disparo ilegível: pulada`);
      resumo.puladas += 1;
      continue;
    }
    if (instancia && nome !== instancia) continue;
    if (vistas.has(nome)) {
      log(`  ${nome} | ${row.client_id} | instância repetida no banco (já vista em ${vistas.get(nome)}): pulada`);
      resumo.puladas += 1;
      continue;
    }
    vistas.set(nome, row.client_id);
    resumo.total += 1;
    const apiKey = row.dispatch_webhook_token || admin.apiKey;
    const antes = await buscarWebhook(fetchImpl, baseUrl, nome, apiKey);
    const prefixo = `  ${nome} | ${row.client_id}`;
    if (row.webhook_enabled !== true) {
      log(`${prefixo} | webhook desligado no Vexo: não mexe | Evolution hoje: ${antes.ok ? txt(antes.atual) : antes.erro}`);
      resumo.puladas += 1;
      continue;
    }
    const precisa = !antes.ok || antes.atual.tokenNaUrl || !antes.atual.temCabecalho || !antes.atual.ligado;
    if (!precisa) {
      log(`${prefixo} | já está certo | ${txt(antes.atual)}`);
      continue;
    }
    resumo.mudariam += 1;
    if (!aplicar) {
      log(`${prefixo} | MUDARIA | hoje: ${antes.ok ? txt(antes.atual) : antes.erro} | depois: sem token na URL, cabeçalho ${CABECALHO_TOKEN_WEBHOOK}`);
      continue;
    }
    try {
      await configureEvolutionInstanceWebhook(row.client_id, row.dispatch_webhook_url, row.dispatch_webhook_token, true);
      resumo.aplicadas += 1;
    } catch (e) {
      log(`${prefixo} | FALHOU ao aplicar: ${String(e?.message || e).slice(0, 200)}`);
      resumo.falhas += 1;
      continue;
    }
    const depois = await buscarWebhook(fetchImpl, baseUrl, nome, apiKey);
    const certo = depois.ok && depois.atual.ligado && !depois.atual.tokenNaUrl && depois.atual.temCabecalho;
    if (certo) resumo.conferidas += 1;
    else resumo.falhas += 1;
    log(`${prefixo} | ${certo ? "OK" : "FALHOU NA CONFERÊNCIA"} | agora: ${depois.ok ? txt(depois.atual) : depois.erro}`);
  }

  // Instâncias da Evolution que mandam para o Vexo mas não estão no banco: não são mexidas, só listadas.
  if (!instancia && admin.configured) {
    try {
      const r = await fetchImpl(`${admin.baseUrl}/instance/fetchInstances`, { headers: { apikey: admin.apiKey, Accept: "application/json" } });
      const lista = r.ok ? JSON.parse(await r.text()) : [];
      for (const i of Array.isArray(lista) ? lista : []) {
        const nome = i?.name || i?.instanceName;
        if (!nome || vistas.has(nome)) continue;
        const w = await buscarWebhook(fetchImpl, admin.baseUrl, nome, admin.apiKey);
        if (w.ok && w.atual.apontaParaVexo) {
          resumo.foraDoBanco.push(nome);
          log(`  ${nome} | FORA DO BANCO, manda para o Vexo: não mexida | ${txt(w.atual)}`);
        }
      }
    } catch (e) {
      log(`  (lista da Evolution indisponível: ${String(e?.message || e).slice(0, 120)})`);
    }
  }

  log(
    `RESUMO | instâncias ${resumo.total} | ${aplicar ? `aplicadas ${resumo.aplicadas} | conferidas ${resumo.conferidas}` : `mudariam ${resumo.mudariam}`} | falhas ${resumo.falhas} | puladas ${resumo.puladas} | fora do banco ${resumo.foraDoBanco.length}`
  );
  return resumo;
}
