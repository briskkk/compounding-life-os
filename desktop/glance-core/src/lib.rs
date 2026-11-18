//! 菜单栏展示与待办提醒。数字只来自服务端 JSON，这里做解析、着色和文案，不重算盈亏。

mod hook;
mod icon;
mod menu;
mod money;
mod summary;
mod tasks;
mod url_base;

pub use hook::SESSION_HOOK;
pub use icon::{render_status, Appearance, RgbaImage};
pub use menu::{
    baseline_after, menu_entries, notifications_due, status_text, tooltip, BarState, MenuEntry, StatusText,
    TaskSource, POLL_INTERVAL,
};
pub use money::{format_cny, format_percent, format_signed_amount, Tone};
pub use summary::{parse_summary, SummaryGlance};
pub use tasks::{notification_id, parse_tasks, TaskSnap};
pub use url_base::{
    normalize_base_url, page_url, preset_of, ServerPreset, UrlError, DEFAULT_BASE_URL, LOCAL_BASE_URL,
};

/// 登录接口返回的会话令牌。拒绝空值、过长值和口令字符，错误信息不回显原文。
pub fn accept_session_token(token: &str) -> Result<String, &'static str> {
    if (20..=128).contains(&token.len())
        && token
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        Ok(token.to_string())
    } else {
        Err("无效的会话令牌")
    }
}

#[cfg(test)]
mod source_guard {
    use std::fs;
    use std::path::Path;

    #[test]
    fn desktop_tree_does_not_hardcode_a_server_ip() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let mut offenders = Vec::new();
        walk(&root, &mut offenders);
        assert!(
            offenders.is_empty(),
            "desktop sources must not hardcode a public IP: {offenders:?}"
        );
    }

    fn walk(dir: &Path, offenders: &mut Vec<String>) {
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "target" || name == "node_modules" || name == "icons" || name.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                walk(&path, offenders);
                continue;
            }
            let text_ext = matches!(
                path.extension().and_then(|ext| ext.to_str()),
                Some("rs" | "json" | "md" | "mjs" | "toml" | "html" | "py" | "ts")
            );
            if !text_ext {
                continue;
            }
            let Ok(text) = fs::read_to_string(&path) else { continue };
            let forbidden = ["111", "229", "116", "222"].join(".");
            if text.contains(&forbidden) {
                offenders.push(path.display().to_string());
            }
        }
    }

    /// `npm run dev` starts Tauri with cwd = `desktop/` (the package.json directory).
    /// `frontendDist` stays relative to `src-tauri/tauri.conf.json`.
    #[test]
    fn before_dev_command_resolves_from_the_npm_package_directory() {
        let desktop = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let conf_path = desktop.join("src-tauri/tauri.conf.json");
        let conf: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&conf_path).expect("tauri.conf.json")).unwrap();
        let command = conf["build"]["beforeDevCommand"]
            .as_str()
            .expect("beforeDevCommand");
        let script = command
            .split_whitespace()
            .find(|part| part.ends_with(".mjs"))
            .expect("dev server script");
        assert!(
            desktop.join(script).is_file(),
            "beforeDevCommand {command:?} must name a file under desktop/, not src-tauri/"
        );
        let frontend = conf["build"]["frontendDist"].as_str().expect("frontendDist");
        assert!(
            conf_path.parent().unwrap().join(frontend).is_dir(),
            "frontendDist is relative to tauri.conf.json"
        );
    }
}
