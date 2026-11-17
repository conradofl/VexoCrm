// Trava por chip: um chip nunca dispara dois lotes ao mesmo tempo.
//
// Nous, 17/11/2026 09:27 SP: ao retomar a campanha, os lotes adiados para "abre 08:00" venceram juntos e o agendador
// (setInterval de 30 s sem guarda de reentrada) começou um lote por tick no mesmo Chip 2 frio; os lotes 5, 6, 7 e 8
// enviaram intercalados. A trava por campanha (findConcurrentRunningDispatch) só vale para ocorrência recorrente.
//
// Registro em memória: o backend é um contêiner só (um processo), e o agendador, o "Disparar Agora" e o "Disparar não
// processados" rodam todos aqui. Reservar e conferir é síncrono, então dois ticks intercalados não passam juntos.
// Depois de um boot o registro começa vazio, e os lotes que ficaram 'running' são recolhidos por recoverOrphanDispatches.
//
// chips = lista de ids de chip do lote; vazia/nula = lote sem chip definido, que pode sair por qualquer chip da empresa e
// por isso conflita com qualquer lote da mesma empresa. Empresas diferentes nunca dividem chip.

function conflita(a, b) {
  if (a.clientId !== b.clientId) return false;
  if (!a.chips || !b.chips) return true;
  for (const c of a.chips) if (b.chips.has(c)) return true;
  return false;
}

export function createChipDispatchLock() {
  const emUso = new Map(); // dispatchId -> { clientId, chips: Set | null, nome }

  return {
    // { ok: true } e o lote fica reservado, ou { ok: false, bloqueadoPor: { dispatchId, nome } } sem reservar nada.
    reservar({ dispatchId, clientId, chips, nome }) {
      const id = String(dispatchId);
      const lista = Array.isArray(chips) ? chips.map((c) => String(c ?? "").trim()).filter(Boolean) : [];
      const pedido = { clientId: String(clientId ?? ""), chips: lista.length > 0 ? new Set(lista) : null, nome: nome || id };
      // O mesmo lote já reservado (outro fluxo pegou antes): recusa, para que o liberar de quem perdeu não solte a
      // reserva de quem ganhou.
      if (emUso.has(id)) return { ok: false, bloqueadoPor: { dispatchId: id, nome: emUso.get(id).nome }, mesmoLote: true };
      for (const [outroId, atual] of emUso) {
        if (conflita(pedido, atual)) return { ok: false, bloqueadoPor: { dispatchId: outroId, nome: atual.nome } };
      }
      emUso.set(id, pedido);
      return { ok: true };
    },
    liberar(dispatchId) {
      emUso.delete(String(dispatchId));
    },
    emUso() {
      return [...emUso.keys()];
    },
  };
}

export function describeChipBusyForButton(nome) {
  return `O chip deste lote já está disparando outro lote ("${nome}"). Aguarde ele terminar e dispare este de novo.`;
}

export function describeChipBusyForScheduler(nome) {
  return `Aguardando o chip terminar outro lote ("${nome}"). Começa logo em seguida, sem precisar clicar.`;
}
