export interface SettlementAccountNode {
  id: string
  settlementAccountId: string | null
}

/** 自结算允许；跨账户结算不能形成环或接入已有异常环。 */
export function createsSettlementCycle(
  accountId: string,
  settlementAccountId: string | null,
  accounts: SettlementAccountNode[],
): boolean {
  if (!settlementAccountId || settlementAccountId === accountId) return false
  const nextById = new Map(accounts.map((account) => [account.id, account.settlementAccountId]))
  const visited = new Set<string>()
  let currentId: string | null = settlementAccountId

  while (currentId) {
    if (currentId === accountId) return true
    if (visited.has(currentId)) return true
    visited.add(currentId)
    const nextId: string | null = nextById.get(currentId) ?? null
    if (nextId === currentId) return false
    currentId = nextId
  }
  return false
}
