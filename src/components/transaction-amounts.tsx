import { cx, fmtMoney } from '@/lib/format'
import { transactionPayment } from '@/lib/engine/transaction-payment'
import type { TxInput } from '@/lib/engine/types'

export function TransactionAmountHeaders() {
  return (
    <>
      <th scope="col" className="px-2 py-2.5 text-right font-normal" title="买卖为不含手续费的成交金额；其他类型为流水记录金额">流水金额</th>
      <th scope="col" className="px-2 py-2.5 text-right font-normal">手续费</th>
      <th scope="col" className="px-2 py-2.5 text-right font-normal" title="买入加手续费，卖出及收入减手续费。按账本计算，不代表已联动现金或已到账；作废及非买卖收入流水不显示">含费收付</th>
    </>
  )
}

export function TransactionAmountCells({
  type,
  amount,
  fee,
  voidedAt,
  currency,
  amountClassName,
}: Pick<TxInput, 'type' | 'amount' | 'fee' | 'voidedAt'> & { currency: string; amountClassName?: string }) {
  const payment = transactionPayment({ type, amount, fee, voidedAt })
  return (
    <>
      <td data-testid="transaction-amount" className={cx('num px-2 py-2 text-right', amountClassName ?? 'text-ink')}>
        {fmtMoney(amount, currency)}
      </td>
      <td data-testid="transaction-fee" className="num px-2 py-2 text-right text-ink-dim">{fmtMoney(fee, currency)}</td>
      <td data-testid="transaction-payment" className="px-2 py-2 text-right text-ink" title="按流水与手续费计算，不代表已到账或已联动现金">
        {payment ? <><span className="mr-2 text-[12px] text-ink-faint">{payment.label}</span><span className="num">{fmtMoney(payment.amount, currency)}</span></> : <span className="text-ink-faint">—</span>}
      </td>
    </>
  )
}
