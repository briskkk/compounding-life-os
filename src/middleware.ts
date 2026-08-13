// 登录保护：页面路径无会话（cookie 或 Bearer）重定向 /login；API 与静态资源放行（API 自行鉴权）
// 透传 x-pathname 供 layout 处理"cookie 存在但会话失效"的兜底重定向
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SESSION_COOKIE = 'fw_session'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  // 放行：登录/注册页、所有 API、Next 内部资源、静态文件（带扩展名）
  if (
    pathname === '/login' ||
    pathname === '/register' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }
  const token =
    req.cookies.get(SESSION_COOKIE)?.value ??
    (req.headers.get('authorization')?.startsWith('Bearer ') ? req.headers.get('authorization')!.slice(7) : null)
  if (!token) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }
  const res = NextResponse.next()
  res.headers.set('x-pathname', pathname)
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
