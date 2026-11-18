// Payload de /api/dashboard para os harness do Dashboard: o formato que o servidor devolve, com números de teste.
export function dashboardPayload(overrides: Record<string, unknown> = {}) {
  return {
    client: { id: "geracao-digital", name: "Geração Digital" },
    period: "30d",
    lastUpdatedAt: "2026-11-13T03:27:00.000Z",
    cacheStatus: "fresh",
    lastError: null,
    hasProposalsAndContracts: false,
    unavailableBlocks: [],
    summary: {
      sent: { current: 180, previous: 150, delta: 20 },
      replied: { current: 60, previous: 40, delta: 50 },
      proposals: null,
      contracts: null,
      closings: { current: 0, previous: 0, delta: 0 },
    },
    rankings: { messages: [], chips: [], regions: [], failureReasons: [], chipsUnattributedSent: 0 },
    overview: {
      waiting: { status: "ready", waiting: 36, waitingOverThreshold: 36, thresholdHours: 3 },
      base: {
        total: 80320,
        slices: { invalidPhone: 63, inConversation: 168, noReply: 49, neverApproached: 80033, closedNoApproach: 7 },
        slicesAddUp: true,
        neverApproached: { reachable: 80033, totalPhones: 80033, totalLeads: 80033, optOutDiscounted: 0, optOutRecorded: false, shareOfBasePct: 99.6 },
      },
      meetings: { hasRecords: false, current: 0, previous: 0 },
      funnel: { received: { current: 18, previous: 13 }, replied: { current: 15, previous: 8 }, meetings: { hasRecords: false, current: 0, previous: 0 } },
      chips: [
        { instanceId: "a", name: "Comercial GD", chipState: "warm", active: true, sent: 120, reached: 110, replies: 40, sentToday: 37, quotaLimit: 40, quotaPercentage: 92.5 },
        { instanceId: "b", name: "Caio", chipState: "cold", active: true, sent: 60, reached: 58, replies: 20, sentToday: 4, quotaLimit: 200, quotaPercentage: 2 },
      ],
      chipsQuotaIsToday: true,
      firstHumanResponse: {
        conversations: 215, measured: 191, indeterminate: 24, coveragePct: 88.8, coverageLevel: "ok", answered: 147, waiting: 42, waitingBotOnly: 7,
        waitingOverThreshold: 35, answeredWithUnknownBefore: 7, thresholdHours: 3, medianMinutes: 4.3, p90Minutes: 333.8,
        waitBuckets: { upTo10: 90, upTo30: 25, upTo120: 17, over120: 15 },
      },
      campaigns: [
        { campaign_id: "c1", campaign_name: "Black Friday", message: null, sent_count: 120, replied_count: 46, reply_rate: 38 },
        { campaign_id: "c2", campaign_name: "Reativação de parados", message: null, sent_count: 90, replied_count: 8, reply_rate: 9 },
      ],
      regions: [],
      queue: {
        states: { waiting: 36, withLead: 120, withRobot: 0, cooled: 154 },
        waitingOverThreshold: 36,
        thresholdHours: 3,
        oldest: [{ phone: "5534991110001", name: "Lead de teste", chip: "Comercial GD", waitingSince: "2026-11-18T11:00:00.000Z" }],
      },
    },
    ...overrides,
  };
}
