/// 菜单栏金额。只格式化服务端已经算好的数字。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    /// 红涨。零与服务端总览一致，按非负着色。
    Up,
    /// 绿跌。
    Down,
}

pub fn tone_of(amount: f64) -> Option<Tone> {
    if !amount.is_finite() {
        return None;
    }
    Some(if amount < 0.0 { Tone::Down } else { Tone::Up })
}

pub fn format_signed_amount(amount: f64) -> Option<String> {
    let grouped = format_abs(amount)?;
    let sign = if amount < 0.0 { "-" } else { "+" };
    Some(format!("{sign}{grouped}"))
}

pub fn format_cny(amount: f64) -> Option<String> {
    let grouped = format_abs(amount)?;
    if amount < 0.0 {
        Some(format!("-¥{grouped}"))
    } else {
        Some(format!("¥{grouped}"))
    }
}

pub fn format_percent(percent: f64) -> Option<String> {
    if !percent.is_finite() {
        return None;
    }
    let sign = if percent < 0.0 { "-" } else { "+" };
    Some(format!("{sign}{:.2}%", percent.abs()))
}

fn format_abs(amount: f64) -> Option<String> {
    if !amount.is_finite() {
        return None;
    }
    let cents = (amount.abs() * 100.0).round() as u64;
    let whole = cents / 100;
    let frac = cents % 100;
    Some(format!("{}.{:02}", group_digits(whole), frac))
}

fn group_digits(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::new();
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_cny_and_keeps_the_sign() {
        assert_eq!(format_signed_amount(1234.5).as_deref(), Some("+1,234.50"));
        assert_eq!(format_signed_amount(-860.0).as_deref(), Some("-860.00"));
        assert_eq!(format_signed_amount(0.0).as_deref(), Some("+0.00"));
        assert_eq!(format_cny(1_234_567.8).as_deref(), Some("¥1,234,567.80"));
        assert_eq!(format_percent(-0.32).as_deref(), Some("-0.32%"));
        assert_eq!(tone_of(0.0), Some(Tone::Up));
        assert_eq!(tone_of(-0.01), Some(Tone::Down));
        assert!(format_signed_amount(f64::NAN).is_none());
    }
}
