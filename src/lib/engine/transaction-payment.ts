import type { TxInput } from './types'

/** 流水的含费收付口径；只是金额计算，不证明现金已联动或已到账。 */
export function transactionPayment(tx: Pick<TxInput, 'type' | 'amount' | 'fee' | 'voidedAt'>): { label: string; amount: number } | null {
  if (tx.voidedAt) return null
  switch (tx.type) {
    case 'BUY':
      return { label: '买入支出', amount: tx.amount + tx.fee }
    case 'SELL':
      return { label: '卖出净额', amount: tx.amount - tx.fee }
    case 'DIVIDEND':
    case 'INTEREST':
      return { label: '收入净额', amount: tx.amount - tx.fee }
    default:
      return null
  }
}
