/// 注入到网页里的登录钩子。只把 `/api/auth/login` 已经返回的 token 交给外壳，不读取密码。
pub const SESSION_HOOK: &str = r#"
(() => {
  if (window.__cloSessionHook) return
  window.__cloSessionHook = true
  const invoke = (command, args) => {
    const internals = window.__TAURI_INTERNALS__
    if (!internals || typeof internals.invoke !== 'function') return Promise.resolve()
    return Promise.race([
      internals.invoke(command, args).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ])
  }
  const sameOrigin = (value) => {
    if (typeof value !== 'string' || value.length === 0) return false
    if (value.startsWith('/')) return true
    try { return new URL(value, location.href).origin === location.origin } catch (error) { return false }
  }
  const accept = (token) => {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(token)) return Promise.resolve()
    return invoke('store_session_token', { token })
  }
  const watch = async (value, response) => {
    if (!sameOrigin(value) || !response || typeof response.clone !== 'function') return
    let path = value
    try { path = new URL(value, location.href).pathname } catch (error) { return }
    if (path === '/api/auth/logout') {
      await invoke('clear_session')
      return
    }
    if (path !== '/api/auth/login' && path !== '/api/auth/register') return
    try {
      const data = await response.clone().json()
      if (data && data.ok === true) await accept(data.token)
    } catch (error) {}
  }
  const original = window.fetch
  if (typeof original !== 'function') return
  window.fetch = function (input, init) {
    return original.apply(this, arguments).then(async (response) => {
      const value = typeof input === 'string' ? input : (input && input.url) || ''
      await watch(String(value), response)
      return response
    })
  }
})()
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_forwards_only_the_login_token() {
        assert!(SESSION_HOOK.contains("store_session_token"));
        assert!(SESSION_HOOK.contains("clear_session"));
        assert!(SESSION_HOOK.contains("/api/auth/login"));
        assert!(SESSION_HOOK.contains("/api/auth/logout"));
        assert!(SESSION_HOOK.contains("await accept"));
        assert!(!SESSION_HOOK.to_lowercase().contains("console."));
        assert!(!SESSION_HOOK.to_lowercase().contains("password"));
    }
}
