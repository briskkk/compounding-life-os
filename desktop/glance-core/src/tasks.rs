use serde::Deserialize;
use serde::Serialize;

use crate::url_base::is_app_path;

/// 总览引擎已经生成的一条待办。href 只接受站内路径。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TaskSnap {
    pub key: String,
    pub count: u32,
    pub title: String,
    pub href: String,
}

#[derive(Debug, Deserialize)]
struct TasksBody {
    ok: Option<bool>,
    tasks: Option<Vec<TaskBody>>,
}

#[derive(Debug, Deserialize)]
struct TaskBody {
    key: Option<String>,
    count: Option<u32>,
    title: Option<String>,
    href: Option<String>,
}

pub fn parse_tasks(body: &str) -> Result<Vec<TaskSnap>, &'static str> {
    let parsed: TasksBody = serde_json::from_str(body).map_err(|_| "待办响应无法解析")?;
    if parsed.ok != Some(true) {
        return Err("待办响应被拒绝");
    }
    let mut tasks = Vec::new();
    for task in parsed.tasks.unwrap_or_default() {
        let Some(key) = task.key.filter(|key| !key.is_empty() && key.len() <= 64) else {
            continue;
        };
        let Some(count) = task.count.filter(|count| *count > 0) else {
            continue;
        };
        let Some(title) = task.title.filter(|title| !title.trim().is_empty() && title.len() <= 80) else {
            continue;
        };
        let Some(href) = task.href.filter(|href| is_app_path(href)) else {
            continue;
        };
        tasks.push(TaskSnap {
            key,
            count,
            title: title.trim().to_string(),
            href,
        });
    }
    Ok(tasks)
}

pub fn notification_id(key: &str) -> i32 {
    match key {
        "FUND_CONFIRMATION" => 1,
        "INVESTMENT_PLAN" => 2,
        "ACCOUNT_RECONCILIATION" => 3,
        other => {
            let mut hash = 17i32;
            for byte in other.bytes() {
                hash = hash.wrapping_mul(31).wrapping_add(i32::from(byte));
            }
            hash.unsigned_abs() as i32
        }
    }
    .max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_engine_tasks_and_drops_external_links() {
        let tasks = parse_tasks(
            r#"{"ok":true,"totalCount":9,"tasks":[
                {"key":"FUND_CONFIRMATION","count":2,"title":"2 笔基金份额待确认","href":"/fund-confirmations"},
                {"key":"EVIL","count":1,"title":"外部","href":"https://example.com"},
                {"key":"ZERO","count":0,"title":"没有","href":"/reconciliation"}
            ]}"#,
        )
        .unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].href, "/fund-confirmations");
        assert_eq!(notification_id("FUND_CONFIRMATION"), 1);
    }
}
