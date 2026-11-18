use std::collections::HashMap;
use std::time::Duration;

use crate::money::{format_cny, Tone};
use crate::summary::SummaryGlance;
use crate::tasks::TaskSnap;
use crate::url_base::ServerPreset;

/// 后台自动刷新间隔。菜单里的「立即刷新」另走手动通道，不受这个间隔限制。
pub const POLL_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq)]
pub enum TaskSource {
    Engine(Vec<TaskSnap>),
    /// 生产还没有 `/api/desktop/tasks`。数量只来自 summary.pendingPurchases。
    FundFallback { pending_purchase_count: u32 },
    Unavailable,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BarState {
    SignedOut,
    Syncing,
    Unavailable,
    Ready {
        summary: SummaryGlance,
        tasks: TaskSource,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct StatusText {
    pub title: String,
    /// 有盈亏颜色时由原生菜单栏绘制红涨绿跌；没有则用系统菜单栏颜色。
    pub tone: Option<Tone>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MenuEntry {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    pub checked: bool,
    pub separator: bool,
}

impl MenuEntry {
    fn item(id: &str, label: impl Into<String>, enabled: bool) -> Self {
        Self {
            id: id.to_string(),
            label: label.into(),
            enabled,
            checked: false,
            separator: false,
        }
    }

    fn check(id: &str, label: impl Into<String>, checked: bool) -> Self {
        Self {
            id: id.to_string(),
            label: label.into(),
            enabled: true,
            checked,
            separator: false,
        }
    }

    fn sep() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            enabled: false,
            checked: false,
            separator: true,
        }
    }
}

pub fn status_text(state: &BarState) -> StatusText {
    match state {
        BarState::SignedOut => StatusText { title: "请登录".to_string(), tone: None },
        BarState::Syncing => StatusText { title: "同步中".to_string(), tone: None },
        BarState::Unavailable => StatusText { title: "暂无数据".to_string(), tone: None },
        BarState::Ready { summary, .. } => StatusText {
            title: summary.pnl_text.clone(),
            tone: Some(summary.tone),
        },
    }
}

pub fn tooltip(state: &BarState) -> String {
    match state {
        BarState::SignedOut => "请登录。点击打开家庭财富终端。".to_string(),
        BarState::Syncing => "正在读取服务器上的今日盈亏。".to_string(),
        BarState::Unavailable => "暂时没有读到今日盈亏。".to_string(),
        BarState::Ready { summary, tasks } => {
            let net = format_cny(summary.net_worth).unwrap_or_else(|| "—".to_string());
            let investable = format_cny(summary.investable).unwrap_or_else(|| "—".to_string());
            let todo = task_tooltip(tasks);
            let stamp = summary
                .updated_at
                .as_ref()
                .map(|stamp| format!("\n更新于 {stamp}"))
                .unwrap_or_default();
            format!(
                "今日盈亏 {}（{}）\n净资产 {net}\n可投资 {investable}\n{todo}{stamp}",
                summary.pnl_text, summary.pct_text
            )
        }
    }
}

fn task_tooltip(tasks: &TaskSource) -> String {
    match tasks {
        TaskSource::Engine(items) => {
            let total: u32 = items.iter().map(|item| item.count).sum();
            if total == 0 {
                "待办 没有待处理事项".to_string()
            } else {
                format!("待办 {total}")
            }
        }
        TaskSource::FundFallback { pending_purchase_count } => {
            format!("待办 基金份额待确认 {pending_purchase_count}")
        }
        TaskSource::Unavailable => "待办暂时无法读取".to_string(),
    }
}

pub fn menu_entries(state: &BarState, preset: ServerPreset) -> Vec<MenuEntry> {
    let mut entries = Vec::new();
    match state {
        BarState::SignedOut => {
            entries.push(MenuEntry::item("info-state", "请在窗口中登录", false));
        }
        BarState::Syncing => {
            entries.push(MenuEntry::item("info-state", "正在同步", false));
        }
        BarState::Unavailable => {
            entries.push(MenuEntry::item("info-state", "暂时没有读到今日盈亏", false));
        }
        BarState::Ready { summary, tasks } => {
            let net = format_cny(summary.net_worth).unwrap_or_else(|| "—".to_string());
            let investable = format_cny(summary.investable).unwrap_or_else(|| "—".to_string());
            entries.push(MenuEntry::item(
                "info-pnl",
                format!("今日盈亏 {}（{}）", summary.pnl_text, summary.pct_text),
                false,
            ));
            entries.push(MenuEntry::item("info-net", format!("净资产 {net}"), false));
            entries.push(MenuEntry::item("info-investable", format!("可投资 {investable}"), false));
            if let Some(stamp) = &summary.updated_at {
                entries.push(MenuEntry::item("info-updated", format!("更新于 {stamp}"), false));
            }
            entries.push(MenuEntry::sep());
            match tasks {
                TaskSource::Engine(items) if items.is_empty() => {
                    entries.push(MenuEntry::item("info-tasks", "没有待处理事项", false));
                }
                TaskSource::Engine(items) => {
                    for item in items {
                        entries.push(MenuEntry::item(
                            &format!("task:{}", item.key),
                            item.title.clone(),
                            true,
                        ));
                    }
                }
                TaskSource::FundFallback { pending_purchase_count } => {
                    if *pending_purchase_count == 0 {
                        entries.push(MenuEntry::item("info-tasks", "暂无待确认申购", false));
                    } else {
                        entries.push(MenuEntry::item(
                            "task:FUND_CONFIRMATION",
                            format!("{pending_purchase_count} 笔基金份额待确认"),
                            true,
                        ));
                    }
                    entries.push(MenuEntry::item(
                        "info-fallback",
                        "定投与账户对账待服务端更新后显示",
                        false,
                    ));
                }
                TaskSource::Unavailable => {
                    entries.push(MenuEntry::item("info-tasks", "待办暂时无法读取", false));
                }
            }
        }
    }
    entries.push(MenuEntry::sep());
    entries.push(MenuEntry::item("open", "打开主窗口", true));
    if matches!(state, BarState::Ready { .. } | BarState::Unavailable | BarState::Syncing) {
        entries.push(MenuEntry::item("refresh", "立即刷新", true));
    }
    entries.push(MenuEntry::sep());
    entries.push(MenuEntry::check(
        "server-prod",
        "生产服务器",
        preset == ServerPreset::Production,
    ));
    entries.push(MenuEntry::check(
        "server-local",
        "本机开发 localhost:3000",
        preset == ServerPreset::Local,
    ));
    entries.push(MenuEntry::sep());
    if !matches!(state, BarState::SignedOut) {
        entries.push(MenuEntry::item("logout", "退出登录", true));
    }
    entries.push(MenuEntry::item("quit", "退出", true));
    entries
}

/// 第一次看到待办会提醒一次；之后只在新增或数量增加时提醒。读取失败不改基线。
pub fn notifications_due(previous: Option<&[TaskSnap]>, tasks: &TaskSource) -> Option<Vec<TaskSnap>> {
    let current = snaps_of(tasks)?;
    let due = if let Some(previous) = previous {
        let counts: HashMap<&str, u32> = previous.iter().map(|item| (item.key.as_str(), item.count)).collect();
        current
            .into_iter()
            .filter(|item| item.count > counts.get(item.key.as_str()).copied().unwrap_or(0))
            .collect()
    } else {
        current.into_iter().filter(|item| item.count > 0).collect()
    };
    Some(due)
}

pub fn baseline_after(tasks: &TaskSource) -> Option<Vec<TaskSnap>> {
    snaps_of(tasks)
}

fn snaps_of(tasks: &TaskSource) -> Option<Vec<TaskSnap>> {
    match tasks {
        TaskSource::Unavailable => None,
        TaskSource::Engine(items) => Some(items.clone()),
        TaskSource::FundFallback { pending_purchase_count } => Some(fund_fallback(*pending_purchase_count)),
    }
}

fn fund_fallback(count: u32) -> Vec<TaskSnap> {
    if count == 0 {
        return Vec::new();
    }
    vec![TaskSnap {
        key: "FUND_CONFIRMATION".to_string(),
        count,
        title: format!("{count} 笔基金份额待确认"),
        href: "/fund-confirmations".to_string(),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::money::Tone;
    use crate::summary::SummaryGlance;

    fn summary() -> SummaryGlance {
        SummaryGlance {
            day_pnl: 12.0,
            day_pct: 0.3,
            net_worth: 100.0,
            investable: 80.0,
            updated_at: Some("15:04".to_string()),
            pending_purchase_count: Some(1),
            tone: Tone::Up,
            pnl_text: "+12.00".to_string(),
            pct_text: "+0.30%".to_string(),
        }
    }

    fn task(key: &str, count: u32) -> TaskSnap {
        TaskSnap {
            key: key.to_string(),
            count,
            title: format!("{count} {key}"),
            href: match key {
                "FUND_CONFIRMATION" => "/fund-confirmations",
                "INVESTMENT_PLAN" => "/investment-plans",
                _ => "/reconciliation",
            }
            .to_string(),
        }
    }

    #[test]
    fn signed_out_status_is_not_a_number() {
        let text = status_text(&BarState::SignedOut);
        assert_eq!(text.title, "请登录");
        assert!(text.tone.is_none());
        assert!(tooltip(&BarState::SignedOut).contains("请登录"));
        let labels: Vec<_> = menu_entries(&BarState::SignedOut, ServerPreset::Production)
            .into_iter()
            .map(|entry| entry.label)
            .collect();
        assert!(labels.iter().any(|label| label == "请在窗口中登录"));
        assert!(!labels.iter().any(|label| label.contains('¥') || label.contains('+')));
    }

    #[test]
    fn ready_menu_uses_server_numbers_and_task_titles() {
        let state = BarState::Ready {
            summary: summary(),
            tasks: TaskSource::Engine(vec![task("FUND_CONFIRMATION", 2)]),
        };
        assert_eq!(status_text(&state).tone, Some(Tone::Up));
        let entries = menu_entries(&state, ServerPreset::Local);
        assert!(entries.iter().any(|entry| entry.label == "今日盈亏 +12.00（+0.30%）"));
        assert!(entries.iter().any(|entry| entry.label == "净资产 ¥100.00"));
        assert!(entries.iter().any(|entry| entry.label == "可投资 ¥80.00"));
        assert!(entries.iter().any(|entry| entry.id == "task:FUND_CONFIRMATION" && entry.enabled));
        assert!(entries.iter().any(|entry| entry.id == "server-local" && entry.checked));
        assert!(tooltip(&state).contains("待办 2"));
    }

    #[test]
    fn fallback_does_not_invent_plan_or_reconciliation_counts() {
        let state = BarState::Ready {
            summary: summary(),
            tasks: TaskSource::FundFallback { pending_purchase_count: 2 },
        };
        let labels: Vec<_> = menu_entries(&state, ServerPreset::Production)
            .into_iter()
            .map(|entry| entry.label)
            .collect();
        assert!(labels.iter().any(|label| label == "2 笔基金份额待确认"));
        assert!(labels.iter().any(|label| label.contains("待服务端更新")));
        assert!(!labels.iter().any(|label| label.contains("定投节点") || label.contains("账户本月")));
    }

    #[test]
    fn notifications_follow_new_and_increased_counts_only() {
        let first = TaskSource::Engine(vec![task("FUND_CONFIRMATION", 1)]);
        let due = notifications_due(None, &first).unwrap();
        assert_eq!(due.len(), 1);
        let baseline = baseline_after(&first).unwrap();
        assert!(notifications_due(Some(&baseline), &first).unwrap().is_empty());
        let increased = TaskSource::Engine(vec![task("FUND_CONFIRMATION", 2), task("INVESTMENT_PLAN", 1)]);
        let due = notifications_due(Some(&baseline), &increased).unwrap();
        assert_eq!(
            due.iter().map(|item| item.key.as_str()).collect::<Vec<_>>(),
            vec!["FUND_CONFIRMATION", "INVESTMENT_PLAN"]
        );
        let decreased = TaskSource::Engine(vec![task("FUND_CONFIRMATION", 1)]);
        assert!(notifications_due(Some(&baseline_after(&increased).unwrap()), &decreased)
            .unwrap()
            .is_empty());
        assert!(notifications_due(Some(&baseline), &TaskSource::Unavailable).is_none());
        assert_eq!(POLL_INTERVAL.as_secs(), 60);
    }
}
