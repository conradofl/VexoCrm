import { extractEvolutionInstanceSlug } from "../../services/evolution.js";

function extractBaseUrl(dispatchWebhookUrl) {
  if (!dispatchWebhookUrl) return null;
  try {
    const u = new URL(dispatchWebhookUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function makeCandidate(slug, meta = {}) {
  const clean = String(slug || "").trim();
  return {
    slug: clean,
    name: meta.name || clean,
    baseUrl: meta.baseUrl || null,
    webhookToken: meta.webhookToken || null,
    connectionState: meta.connectionState || null,
    toString() {
      return clean;
    },
    valueOf() {
      return clean;
    },
    [Symbol.toPrimitive]() {
      return clean;
    },
  };
}

export async function resolveCandidateEvolutionInstances(dbPool, requestedInstance) {
  const candidates = [];
  const added = new Set();

  const addCandidate = (slug, meta = {}) => {
    if (!slug) return;
    const clean = String(slug).trim();
    if (!clean || added.has(clean)) return;
    added.add(clean);
    candidates.push(makeCandidate(clean, meta));
  };

  // 1. Se houver chip configurado no jurídico, resolve seu slug técnico e credenciais
  if (requestedInstance) {
    try {
      const { rows } = await dbPool.query(
        `SELECT name, dispatch_webhook_url, dispatch_webhook_token, connection_state, chip_state 
         FROM public.lead_client_evolution_instances 
         WHERE active = true AND (name = $1 OR dispatch_webhook_url ILIKE '%' || $1 || '%' OR id::text = $1) 
         LIMIT 1`,
        [requestedInstance]
      );
      if (rows && rows[0]) {
        const slug = extractEvolutionInstanceSlug(rows[0].dispatch_webhook_url) || rows[0].name;
        addCandidate(slug, {
          name: rows[0].name,
          baseUrl: extractBaseUrl(rows[0].dispatch_webhook_url),
          webhookToken: rows[0].dispatch_webhook_token,
          connectionState: rows[0].connection_state,
        });
      }
    } catch (_) {}
    addCandidate(requestedInstance);
  }

  // 2. Chips do tenant 'geracao-digital' que estejam conectados (open / connected / online)
  try {
    const { rows } = await dbPool.query(
      `SELECT name, dispatch_webhook_url, dispatch_webhook_token, connection_state, chip_state 
       FROM public.lead_client_evolution_instances 
       WHERE active = true AND client_id = 'geracao-digital' 
         AND (connection_state IN ('open', 'connected', 'online') OR chip_state = 'connected') 
       ORDER BY is_default DESC, name ASC`
    );
    for (const r of (rows || [])) {
      const slug = extractEvolutionInstanceSlug(r.dispatch_webhook_url) || r.name;
      addCandidate(slug, {
        name: r.name,
        baseUrl: extractBaseUrl(r.dispatch_webhook_url),
        webhookToken: r.dispatch_webhook_token,
        connectionState: r.connection_state,
      });
    }
  } catch (_) {}

  // 3. Fallback de segurança: se NENHUM chip conectado foi encontrado, busca outros chips de 'geracao-digital'
  if (candidates.length === 0) {
    try {
      const { rows } = await dbPool.query(
        `SELECT name, dispatch_webhook_url, dispatch_webhook_token, connection_state, chip_state 
         FROM public.lead_client_evolution_instances 
         WHERE active = true AND client_id = 'geracao-digital' 
         ORDER BY is_default DESC, name ASC`
      );
      for (const r of (rows || [])) {
        const slug = extractEvolutionInstanceSlug(r.dispatch_webhook_url) || r.name;
        addCandidate(slug, {
          name: r.name,
          baseUrl: extractBaseUrl(r.dispatch_webhook_url),
          webhookToken: r.dispatch_webhook_token,
          connectionState: r.connection_state,
        });
      }
    } catch (_) {}
  }

  // 4. Se a lista ainda estiver vazia, fallback para env ou outros chips ativos no banco
  if (candidates.length === 0) {
    if (process.env.GD_EVOLUTION_INSTANCE) {
      addCandidate(process.env.GD_EVOLUTION_INSTANCE);
    }
    try {
      const { rows } = await dbPool.query(
        `SELECT name, dispatch_webhook_url, dispatch_webhook_token, connection_state, chip_state 
         FROM public.lead_client_evolution_instances 
         WHERE active = true 
         ORDER BY (CASE WHEN connection_state IN ('open', 'connected', 'online') THEN 0 ELSE 1 END), is_default DESC, name ASC 
         LIMIT 5`
      );
      for (const r of (rows || [])) {
        const slug = extractEvolutionInstanceSlug(r.dispatch_webhook_url) || r.name;
        addCandidate(slug, {
          name: r.name,
          baseUrl: extractBaseUrl(r.dispatch_webhook_url),
          webhookToken: r.dispatch_webhook_token,
          connectionState: r.connection_state,
        });
      }
    } catch (_) {}
  }

  return candidates;
}
