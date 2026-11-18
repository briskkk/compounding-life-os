mod macos;
mod poll;
mod secret;
mod tray;

use std::path::PathBuf;
use std::sync::Mutex;

use glance_core::{accept_session_token, page_url, BarState, TaskSnap, DEFAULT_BASE_URL, LOCAL_BASE_URL};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

struct AppState {
    http: reqwest::Client,
    base_url: Mutex<String>,
    token: Mutex<Option<String>>,
    baseline: Mutex<Option<Vec<TaskSnap>>>,
    bar: Mutex<BarState>,
    generation: Mutex<u64>,
    poll_tx: UnboundedSender<()>,
}

#[derive(Serialize, Deserialize)]
struct ConfigFile {
    base_url: String,
    #[serde(default)]
    baseline: Option<Vec<TaskSnap>>,
}

pub fn run() {
    let (poll_tx, poll_rx) = unbounded_channel();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            http: reqwest::Client::builder()
                .user_agent("FamilyWealthTerminal/0.1")
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .expect("http client"),
            base_url: Mutex::new(DEFAULT_BASE_URL.to_string()),
            token: Mutex::new(None),
            baseline: Mutex::new(None),
            bar: Mutex::new(BarState::SignedOut),
            generation: Mutex::new(0),
            poll_tx,
        })
        .invoke_handler(tauri::generate_handler![store_session_token, clear_session])
        .setup(move |app| {
            let handle = app.handle().clone();
            load_startup(&handle);
            let base = handle.state::<AppState>().base_url.lock().unwrap_or_else(|err| err.into_inner()).clone();
            let start = page_url(&base, "/").unwrap_or_else(|_| format!("{DEFAULT_BASE_URL}/"));
            let url = url::Url::parse(&start).expect("base url");
            let window = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
                .title("家庭财富终端")
                .inner_size(1280.0, 840.0)
                .min_inner_size(960.0, 640.0)
                .initialization_script(glance_core::SESSION_HOOK)
                .build()?;
            let app_handle = handle.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                    #[cfg(target_os = "macos")]
                    let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
            });
            tray::create(&handle)?;
            tray::apply(&handle);
            let notify_handle = handle.clone();
            handle.notification().on_action(move |action| {
                if action.action_id() != "tap" {
                    return;
                }
                let href = action.notification().and_then(|notification| {
                    notification
                        .extra()
                        .get("href")
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                });
                if let Some(href) = href {
                    open_path(&notify_handle, &href);
                }
            });
            poll::spawn_poll(handle, poll_rx);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("启动家庭财富终端失败")
        .run(|app, event| {
            if let RunEvent::Reopen { .. } = event {
                show_main(app);
            }
        });
}

fn load_startup(app: &AppHandle) {
    let saved = read_config(app);
    let base = std::env::var("CLO_BASE_URL")
        .ok()
        .and_then(|value| glance_core::normalize_base_url(&value).ok())
        .or_else(|| saved.as_ref().and_then(|config| glance_core::normalize_base_url(&config.base_url).ok()))
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
    let state = app.state::<AppState>();
    *state.base_url.lock().unwrap_or_else(|err| err.into_inner()) = base;
    if let Some(config) = saved {
        *state.baseline.lock().unwrap_or_else(|err| err.into_inner()) = config.baseline;
    }
    let token = secret::load_token();
    *state.bar.lock().unwrap_or_else(|err| err.into_inner()) = if token.is_some() {
        BarState::Syncing
    } else {
        BarState::SignedOut
    };
    *state.token.lock().unwrap_or_else(|err| err.into_inner()) = token;
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
}

#[tauri::command]
fn store_session_token(app: AppHandle, token: String) {
    let Ok(token) = accept_session_token(&token) else { return };
    secret::save_token(&token);
    let state = app.state::<AppState>();
    *state.token.lock().unwrap_or_else(|err| err.into_inner()) = Some(token);
    *state.bar.lock().unwrap_or_else(|err| err.into_inner()) = BarState::Syncing;
    bump(&app);
    tray::apply(&app);
    let _ = state.poll_tx.send(());
}

#[tauri::command]
fn clear_session(app: AppHandle) {
    clear_session_state(&app);
}

pub fn clear_session_state(app: &AppHandle) {
    secret::clear_token();
    let state = app.state::<AppState>();
    *state.token.lock().unwrap_or_else(|err| err.into_inner()) = None;
    *state.bar.lock().unwrap_or_else(|err| err.into_inner()) = BarState::SignedOut;
    bump(app);
    tray::apply(app);
}

fn bump(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut generation = state.generation.lock().unwrap_or_else(|err| err.into_inner());
    *generation = generation.wrapping_add(1);
}

pub fn show_main(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    macos::activate();
}

pub fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => show_main(app),
        "refresh" => {
            let _ = app.state::<AppState>().poll_tx.send(());
        }
        "server-prod" => switch_server(app, DEFAULT_BASE_URL),
        "server-local" => switch_server(app, LOCAL_BASE_URL),
        "logout" => {
            clear_session_state(app);
            open_path(app, "/");
        }
        "quit" => app.exit(0),
        id if id.starts_with("task:") => {
            let key = &id["task:".len()..];
            if let Some(href) = task_href(app, key) {
                open_path(app, &href);
            }
        }
        _ => {}
    }
}

fn task_href(app: &AppHandle, key: &str) -> Option<String> {
    let bar = app.state::<AppState>().bar.lock().unwrap_or_else(|err| err.into_inner()).clone();
    let BarState::Ready { tasks, .. } = bar else { return None };
    let snaps = match tasks {
        glance_core::TaskSource::Engine(items) => items,
        glance_core::TaskSource::FundFallback { pending_purchase_count } if key == "FUND_CONFIRMATION" && pending_purchase_count > 0 => {
            return Some("/fund-confirmations".to_string());
        }
        _ => return None,
    };
    snaps.into_iter().find(|item| item.key == key).map(|item| item.href)
}

fn open_path(app: &AppHandle, path: &str) {
    let base = app.state::<AppState>().base_url.lock().unwrap_or_else(|err| err.into_inner()).clone();
    let Ok(target) = page_url(&base, path) else { return };
    let Ok(url) = url::Url::parse(&target) else { return };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.navigate(url);
    }
    show_main(app);
}

fn switch_server(app: &AppHandle, base: &str) {
    let Ok(base) = glance_core::normalize_base_url(base) else { return };
    {
        let state = app.state::<AppState>();
        let current = state.base_url.lock().unwrap_or_else(|err| err.into_inner()).clone();
        if current == base {
            show_main(app);
            return;
        }
        *state.base_url.lock().unwrap_or_else(|err| err.into_inner()) = base.clone();
        *state.baseline.lock().unwrap_or_else(|err| err.into_inner()) = None;
    }
    save_config(app);
    clear_session_state(app);
    open_path(app, "/");
}

pub fn save_config(app: &AppHandle) {
    let Some(path) = config_path(app) else { return };
    let state = app.state::<AppState>();
    let config = ConfigFile {
        base_url: state.base_url.lock().unwrap_or_else(|err| err.into_inner()).clone(),
        baseline: state.baseline.lock().unwrap_or_else(|err| err.into_inner()).clone(),
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(body) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write(path, body);
    }
}

fn read_config(app: &AppHandle) -> Option<ConfigFile> {
    let path = config_path(app)?;
    let body = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&body).ok()
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("config.json"))
}
