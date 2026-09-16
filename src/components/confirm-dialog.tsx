'use client'

// 统一确认对话框：原生 <dialog> 模态（Esc 关闭、焦点圈禁、关闭后焦点归还触发元素均为
// showModal() 原生行为），这里额外补三件事：
// 1) 影响面清单：把「会被改动 / 会被保留」逐条列出，替代只有一句反问的 window.confirm；
// 2) 默认焦点落在「取消」，危险操作不会被一次回车直接执行；
// 3) 可选输入确认词（不可撤销的重操作），确认词不匹配时确认按钮禁用。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cx } from '@/lib/format'

export interface ConfirmOptions {
  title: string
  /** 一句话说明这次操作会改变什么 */
  description?: string
  /** 影响面清单：逐条列出会被改动 / 会被保留的对象 */
  impacts?: string[]
  confirmLabel?: string
  cancelLabel?: string
  /** danger 用于不可撤销或会作废数据的操作 */
  tone?: 'default' | 'danger'
  /** 需要用户输入的确认词（例如家庭名称），不匹配时无法确认 */
  requireText?: string
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [text, setText] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback<ConfirmFn>((options) => new Promise<boolean>((resolve) => {
    setText('')
    setPending({ ...options, resolve })
  }), [])

  const value = useMemo(() => confirm, [confirm])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (pending && !dialog.open) dialog.showModal()
    else if (!pending && dialog.open) dialog.close()
  }, [pending])

  // 危险操作默认焦点在取消：避免「确认」被回车直接触发
  useEffect(() => {
    if (pending) cancelRef.current?.focus()
  }, [pending])

  function settle(ok: boolean) {
    pending?.resolve(ok)
    setPending(null)
    setText('')
  }

  const danger = pending?.tone === 'danger'
  const textOk = pending?.requireText == null || text === pending.requireText

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <dialog
        ref={dialogRef}
        aria-labelledby="confirm-dialog-title"
        className="confirm-dialog"
        onCancel={(event) => {
          event.preventDefault()
          settle(false)
        }}
        onClick={(event) => {
          // 点击遮罩区域（dialog 自身）视为取消
          if (event.target === dialogRef.current) settle(false)
        }}
      >
        {pending && (
          <div className="confirm-dialog-body">
            <h2 id="confirm-dialog-title" className="confirm-dialog-title">{pending.title}</h2>
            {pending.description && <p className="confirm-dialog-desc">{pending.description}</p>}
            {pending.impacts && pending.impacts.length > 0 && (
              <ul className="confirm-dialog-impacts" data-testid="confirm-impacts">
                {pending.impacts.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
            {pending.requireText && (
              <label className="confirm-dialog-require">
                <span>输入「<b>{pending.requireText}</b>」以确认</span>
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <input
                  autoFocus
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={pending.requireText}
                  aria-label="确认词"
                  className="confirm-dialog-input"
                />
              </label>
            )}
            <div className="confirm-dialog-actions">
              <button ref={cancelRef} type="button" className="confirm-dialog-cancel" onClick={() => settle(false)}>
                {pending.cancelLabel ?? '取消'}
              </button>
              <button
                type="button"
                data-testid="confirm-accept"
                disabled={!textOk}
                onClick={() => settle(true)}
                className={cx('confirm-dialog-accept', danger && 'is-danger')}
              >
                {pending.confirmLabel ?? '确认'}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  )
}

const FALLBACK: ConfirmFn = () => Promise.resolve(false)

export function useConfirm(): ConfirmFn {
  // 未挂载 Provider 时返回「不确认」而不是抛错：宁可不动数据，也不整页崩溃
  return useContext(ConfirmContext) ?? FALLBACK
}
