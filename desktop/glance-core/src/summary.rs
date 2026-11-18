use serde::Deserialize;

use crate::money::{format_percent, format_signed_amount, Tone};

/// `GET /api/mobile/summary` 里菜单栏会用到的字段。没有的字段保持空，不补零。
#[derive(Debug, Clone, PartialEq)]
pub struct SummaryGlance {
    pub day_pnl: f64,
    pub day_pct: f64,
    pub net_worth: f64,
    pub investable: f64,
    pub updated_at: Option<String>,
    pub pending_purchase_count: Option<u32>,
    pub tone: Tone,
    pub pnl_text: String,
    pub pct_text: String,
}

#[derive(Debug, Deserialize)]
struct SummaryBody {
    ok: Option<bool>,
    #[serde(rename = "netWorth")]
    net_worth: Option<NetWorthBody>,
    #[serde(rename = "pendingPurchases")]
    pending_purchases: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
struct NetWorthBody {
    #[serde(rename = "netWorth")]
    net_worth: Option<f64>,
    investable: Option<f64>,
    #[serde(rename = "dayPnl")]
    day_pnl: Option<f64>,
    #[serde(rename = "dayPct")]
    day_pct: Option<f64>,
    #[serde(rename = "updatedAt")]
    updated_at: Option<String>,
}

pub fn parse_summary(body: &str) -> Result<SummaryGlance, &'static str> {
    let parsed: SummaryBody = serde_json::from_str(body).map_err(|_| "总览响应无法解析")?;
    if parsed.ok != Some(true) {
        return Err("总览响应被拒绝");
    }
    let net = parsed.net_worth.ok_or("总览缺少净资产")?;
    let day_pnl = finite(net.day_pnl, "总览缺少今日盈亏")?;
    let day_pct = finite(net.day_pct, "总览缺少今日涨跌幅")?;
    let net_worth = finite(net.net_worth, "总览缺少净资产")?;
    let investable = finite(net.investable, "总览缺少可投资资产")?;
    let tone = crate::money::tone_of(day_pnl).ok_or("今日盈亏无效")?;
    let pnl_text = format_signed_amount(day_pnl).ok_or("今日盈亏无效")?;
    let pct_text = format_percent(day_pct).ok_or("今日涨跌幅无效")?;
    let updated_at = net.updated_at.and_then(clean_stamp);
    let pending_purchase_count = parsed
        .pending_purchases
        .map(|items| u32::try_from(items.len()).unwrap_or(u32::MAX));
    Ok(SummaryGlance {
        day_pnl,
        day_pct,
        net_worth,
        investable,
        updated_at,
        pending_purchase_count,
        tone,
        pnl_text,
        pct_text,
    })
}

fn finite(value: Option<f64>, missing: &'static str) -> Result<f64, &'static str> {
    match value {
        Some(value) if value.is_finite() => Ok(value),
        Some(_) => Err("总览数字无效"),
        None => Err(missing),
    }
}

fn clean_stamp(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 16 || trimmed.chars().any(|ch| ch.is_control()) {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_production_summary_fields_without_inventing_todos() {
        let glance = parse_summary(
            r#"{"ok":true,"netWorth":{"netWorth":10,"investable":8,"dayPnl":-1.2,"dayPct":-0.4,"updatedAt":"15:04"},"pendingPurchases":[{},{}]}"#,
        )
        .unwrap();
        assert_eq!(glance.day_pnl, -1.2);
        assert_eq!(glance.net_worth, 10.0);
        assert_eq!(glance.investable, 8.0);
        assert_eq!(glance.pnl_text, "-1.20");
        assert_eq!(glance.pending_purchase_count, Some(2));
        assert_eq!(glance.tone, Tone::Down);
    }

    #[test]
    fn missing_purchase_list_is_not_zero() {
        let glance = parse_summary(
            r#"{"ok":true,"netWorth":{"netWorth":1,"investable":1,"dayPnl":0,"dayPct":0}}"#,
        )
        .unwrap();
        assert_eq!(glance.pending_purchase_count, None);
        assert_eq!(glance.tone, Tone::Up);
    }

    #[test]
    fn rejects_failed_and_non_finite_payloads() {
        assert!(parse_summary(r#"{"ok":false}"#).is_err());
        assert!(parse_summary(r#"{"ok":true,"netWorth":{"netWorth":1,"investable":1,"dayPnl":null,"dayPct":0}}"#).is_err());
    }
}
