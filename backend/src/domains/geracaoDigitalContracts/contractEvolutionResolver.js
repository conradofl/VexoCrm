import { extractEvolutionInstanceSlug } from "../../services/evolution.js";

export async function resolveCandidateEvolutionInstances(dbPool, requestedInstance) {
  const candidates = [];
  const added = new Set();
  const addCandidate = (inst) => {
    if (!inst) return;
    const clean = String(inst).trim();
    if (!clean || added.has(clean)) return;
    added.add(clean);
    candidates.push(clean);
  };

  // 1. Se houver chip configurado no jurídico, resolve seu slug técnico
  if (requestedInstance) {
    try {
      const { rows } = await dbPool.query(
        `SELECT name, dispatch_webhook_url 
         FROM public.lead_client_evolution_instances 
         WHERE active = true AND (name = $1 OR dispatch_webhook_url ILIKE '%' || $1 || '%' OR id::text = $1) 
         LIMIT 1`,
        [requestedInstance]
      );
      if (rows && rows[0]) {
        addCandidate(extractEvolutionInstanceSlug(rows[0].dispatch_webhook_url) || rows[0].name);
      }
    } catch (_) {}
    addCandidate(requestedInstance);
  }

  // 2. Chips do tenant 'geracao-digital' que estejam conectados
  try {
    const { rows } = await dbPool.query(
      `SELECT name, dispatch_webhook_url 
       FROM public.lead_client_evolution_instances 
       WHERE active = true AND client_id = 'geracao-digital' 
         AND (connection_state IN ('open', 'connected', 'online') OR chip_state = 'connected') 
       ORDER BY is_default DESC, name ASC`
    );
    for (const r of (rows || [])) {
      addCandidate(extractEvolutionInstanceSlug(r.dispatch_webhook_url) || r.name);
    }
  } catch (_) {}

  // 3. Qualquer outro chip ativo do tenant 'geracao-digital'
  try {
    const { rows } = await dbPool.query(
      `SELECT name, dispatch_webhook_url 
       FROM public.lead_client_evolution_instances 
       WHERE active = true AND client_id = 'geracao-digital' 
       ORDER BY is_default DESC, name ASC`
    );
    for (const r of (rows || [])) {
      addCandidate(extractEvolutionInstanceSlug(r.dispatch_webhook_url) || r.name);
    }
  } catch (_) {}

  // 4. Se a lista ainda estiver vazia, fallback para env ou outros chips ativos no banco
  if (candidates.length === 0) {
    if (process.env.GD_EVOLUTION_INSTANCE) {
      addCandidate(process.env.GD_EVOLUTION_INSTANCE);
    }
    try {
      const { rows } = await dbPool.query(
        `SELECT name, dispatch_webhook_url 
         FROM public.lead_client_evolution_instances 
         WHERE active = true 
         ORDER BY (CASE WHEN connection_state IN ('open', 'connected', 'online') THEN 0 ELSE 1 END), is_default DESC, name ASC 
         LIMIT 5`
      );
      for (const r of (rows || [])) {
        addCandidate(extractEvolutionInstanceSlug(r.dispatch_webhook_url) || r.name);
      }
    } catch (_) {}
  }

  return candidates;
}
