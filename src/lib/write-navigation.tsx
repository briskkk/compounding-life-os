'use client'

// 写入成功后的视图更新与反馈。
//
// - 数据刷新：同页写入用 router.refresh()（它会重渲染当前路由并包含布局，家庭/会话相关
//   计数也会更新）；需要换页或改查询参数时用 router.push()。
// - 反馈：写入结果通过客户端 toast 展示（不写进 URL），因此不会污染可分享链接，
//   也不依赖组件本地状态；警告语气用于「已保存但有未完成部分」。
//
// 注意：不要用 window.location.assign 式整页跳转，也不要直接改 history（replaceState）
// 绕过 App Router——两者都会与客户端路由状态失配（历史教训见审计 P0-11/P0-12）。
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export interface WriteFlash {
  /** 面向用户的一句话结果（中文） */
  message: string
  /** warn 用于「已保存但有未完成部分」，例如快照未重建 */
  tone?: 'ok' | 'warn'
}

export interface WriteNavigationOptions {
  /** 覆盖目标路径（默认停留在当前页），例如删除资产后回到资产目录 */
  path?: string
  /** 追加查询参数（会触发一次导航） */
  params?: Record<string, string>
}

interface WriteFlashContextValue {
  flash: WriteFlash | null
  show: (flash: WriteFlash) => void
  clear: () => void
}

const WriteFlashContext = createContext<WriteFlashContextValue | null>(null)

/** 写入结果提示的宿主：包在应用壳层内，供任意写路径调用 */
export function WriteFlashProvider({ children }: { children: ReactNode }) {
  const [flash, setFlash] = useState<WriteFlash | null>(null)
  const value = useMemo<WriteFlashContextValue>(() => ({
    flash,
    show: (next) => setFlash(next),
    clear: () => setFlash(null),
  }), [flash])

  // 自动收敛：提示只作为一次性回执，不长期占据版面
  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 8000)
    return () => window.clearTimeout(timer)
  }, [flash])

  return <WriteFlashContext.Provider value={value}>{children}</WriteFlashContext.Provider>
}

const FALLBACK: WriteFlashContextValue = {
  flash: null,
  show: () => {
    if (process.env.NODE_ENV !== 'production') console.warn('写入提示未挂载 WriteFlashProvider，本次提示被丢弃')
  },
  clear: () => {},
}

export function useWriteFlash(): WriteFlashContextValue {
  // 降级而非抛错：写路径若被渲染到壳层之外，页面仍应可用（只丢一次性提示）
  return useContext(WriteFlashContext) ?? FALLBACK
}

export function useNavigateAfterWrite() {
  const router = useRouter()
  const pathname = usePathname()
  const { show } = useWriteFlash()

  return useCallback((flash: WriteFlash, options?: WriteNavigationOptions) => {
    show(flash)
    const params = new URLSearchParams(options?.params ?? {})
    const target = options?.path ?? pathname
    if (options?.path || params.toString()) {
      const query = params.toString()
      router.push(`${target}${query ? `?${query}` : ''}`, { scroll: false })
      return
    }
    // 同页写入：刷新当前路由（含布局），列表、合计与侧栏计数都会取到写入后的服务端结果
    router.refresh()
  }, [router, pathname, show])
}
