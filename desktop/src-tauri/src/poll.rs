use std::time::Duration;

use glance_core::{
    baseline_after, notifications_due, notification_id, page_url, parse_summary, parse_tasks, BarState,
    TaskSource, POLL_INTERVAL,
};
use tauri::async_runtime::spawn;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::mpsc::UnboundedReceiver;

use crate::tray;
use crate::AppState;

pub fn spawn_poll(app: AppHandle, mut poll_rx: UnboundedReceiver<()>) {
    spawn(async move {
        let mut ticker = tokio::time::interval(POLL_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = ticker.tick() => poll_once(&app).await,
                Some(()) = poll_rx.recv() => poll_once(&app).await,
            }
        }
    });
}

pub async fn poll_once(app: &AppHandle) {
    let state = app.state::<AppState>();
    let generation = *state.generation.lock().unwrap_or_else(|err| err.into_inner());
    let token = state.token.lock().unwrap_or_else(|err| err.into_inner()).clone();
    let base = state.base_url.lock().unwrap_or_else(|err| err.into_inner()).clone();
    let Some(token) = token else {
        if generation_current(app, generation) {
            set_bar(app, BarState::SignedOut);
        }
        return;
    };

    let Ok(summary_url) = page_url(&base, "/api/mobile/summary") else {
        set_bar(app, BarState::Unavailable);
        return;
    };
    let summary_response = state
        .http
        .get(summary_url)
        .bearer_auth(&token)
        .header("accept", "application/json")
        .send()
        .await;
    if !generation_current(app, generation) {
        return;
    }
    let summary_response = match summary_response {
        Ok(response) => response,
        Err(_) => {
            keep_or_unavailable(app);
            return;
        }
    };
    if summary_response.status().as_u16() == 401 || summary_response.status().as_u16() == 403 {
        crate::clear_session_state(app);
        reopen_login(app, &base);
        return;
    }
    if !summary_response.status().is_success() {
        keep_or_unavailable(app);
        return;
    }
    let Ok(summary_body) = summary_response.text().await else {
        keep_or_unavailable(app);
        return;
    };
    let Ok(summary) = parse_summary(&summary_body) else {
        keep_or_unavailable(app);
        return;
    };
    if !generation_current(app, generation) {
        return;
    }

    let fetched = load_tasks(app, &base, &token, summary.pending_purchase_count).await;
    if !generation_current(app, generation) {
        return;
    }
    let source = match fetched {
        TaskFetch::SignedOut => {
            crate::clear_session_state(app);
            reopen_login(app, &base);
            return;
        }
        TaskFetch::Live(source) => source,
    };
    remind(app, &source);
    set_bar(app, BarState::Ready { summary, tasks: source });
}

enum TaskFetch {
    SignedOut,
    Live(glance_core::TaskSource),
}

async fn load_tasks(app: &AppHandle, base: &str, token: &str, pending: Option<u32>) -> TaskFetch {
    let Ok(url) = page_url(base, "/api/desktop/tasks") else {
        return TaskFetch::Live(fallback(pending));
    };
    let state = app.state::<AppState>();
    let response = state
        .http
        .get(url)
        .bearer_auth(token)
        .header("accept", "application/json")
        .timeout(Duration::from_secs(20))
        .send()
        .await;
    let Ok(response) = response else {
        return TaskFetch::Live(glance_core::TaskSource::Unavailable);
    };
    let status = response.status().as_u16();
    if status == 401 || status == 403 {
        return TaskFetch::SignedOut;
    }
    if status == 404 || status == 501 {
        return TaskFetch::Live(fallback(pending));
    }
    if !response.status().is_success() {
        return TaskFetch::Live(glance_core::TaskSource::Unavailable);
    }
    let Ok(body) = response.text().await else {
        return TaskFetch::Live(glance_core::TaskSource::Unavailable);
    };
    match parse_tasks(&body) {
        Ok(tasks) => TaskFetch::Live(glance_core::TaskSource::Engine(tasks)),
        Err(_) => TaskFetch::Live(glance_core::TaskSource::Unavailable),
    }
}

fn fallback(pending: Option<u32>) -> glance_core::TaskSource {
    match pending {
        Some(count) => glance_core::TaskSource::FundFallback { pending_purchase_count: count },
        None => glance_core::TaskSource::Unavailable,
    }
}

fn remind(app: &AppHandle, source: &TaskSource) {
    let state = app.state::<AppState>();
    let previous = state.baseline.lock().unwrap_or_else(|err| err.into_inner()).clone();
    let Some(due) = notifications_due(previous.as_deref(), source) else { return };
    for task in &due {
        let _ = app
            .notification()
            .builder()
            .id(notification_id(&task.key))
            .title("家庭财富终端")
            .body(&task.title)
            .extra("href", &task.href)
            .show();
    }
    if let Some(next) = baseline_after(source) {
        *state.baseline.lock().unwrap_or_else(|err| err.into_inner()) = Some(next);
        crate::save_config(app);
    }
}

fn keep_or_unavailable(app: &AppHandle) {
    let state = app.state::<AppState>();
    let current = state.bar.lock().unwrap_or_else(|err| err.into_inner()).clone();
    if !matches!(current, BarState::Ready { .. }) {
        set_bar(app, BarState::Unavailable);
    }
}

fn set_bar(app: &AppHandle, bar: BarState) {
    *app.state::<AppState>().bar.lock().unwrap_or_else(|err| err.into_inner()) = bar;
    tray::apply(app);
}

fn generation_current(app: &AppHandle, generation: u64) -> bool {
    *app.state::<AppState>().generation.lock().unwrap_or_else(|err| err.into_inner()) == generation
}

fn reopen_login(app: &AppHandle, base: &str) {
    let Ok(target) = page_url(base, "/") else { return };
    let Ok(url) = url::Url::parse(&target) else { return };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.navigate(url);
    }
}
