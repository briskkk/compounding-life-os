'use client'

// 目标编辑弹窗：原生 <dialog> 模态。
// Esc 关闭、焦点圈禁在弹窗内、关闭后焦点归还触发按钮，均为 showModal() 原生行为；
// 这里只补遮罩点击关闭与每次打开重新挂载表单（避免保留上次未保存的输入）。
import { useEffect, useRef, useState } from 'react'
import { GoalForm, type GoalInitial } from '@/components/goal-form'
import { btnGhostCls } from '@/components/fields'

export function GoalEditDialog({ goalId, initial }: { goalId: string; initial: GoalInitial }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <>
      <button type="button" className={btnGhostCls} onClick={() => setOpen(true)}>
        编辑计划
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="goal-edit-dialog-title"
        className="goal-dialog"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          const dialog = dialogRef.current
          if (!dialog) return
          // 遮罩点击关闭：点击坐标落在对话框可视盒之外即为点中遮罩
          const rect = dialog.getBoundingClientRect()
          const inBox = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
          if (!inBox) dialog.close()
        }}
      >
        {open && (
          <div>
            <div className="flex items-center justify-between gap-4">
              <h2 id="goal-edit-dialog-title" className="text-[19px] font-medium text-ink">编辑目标</h2>
              <button
                type="button"
                aria-label="关闭编辑窗口"
                onClick={() => dialogRef.current?.close()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line text-[18px] text-ink-dim transition-colors hover:border-ink-faint hover:text-ink"
              >
                ×
              </button>
            </div>
            <GoalForm mode="edit" goalId={goalId} initial={initial} initiallyOpen onDone={() => dialogRef.current?.close()} />
          </div>
        )}
      </dialog>
    </>
  )
}
