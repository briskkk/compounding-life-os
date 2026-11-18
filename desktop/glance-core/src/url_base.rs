pub const DEFAULT_BASE_URL: &str = "https://www.huayanpei.com";
pub const LOCAL_BASE_URL: &str = "http://localhost:3000";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerPreset {
    Production,
    Local,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UrlError {
    Invalid,
}

pub fn preset_of(base: &str) -> ServerPreset {
    if base == DEFAULT_BASE_URL {
        ServerPreset::Production
    } else if base == LOCAL_BASE_URL {
        ServerPreset::Local
    } else {
        ServerPreset::Custom
    }
}

/// 默认生产域名。明文 HTTP 只允许本机，地址里不能带账号口令，也不接受公网 IP。
pub fn normalize_base_url(input: &str) -> Result<String, UrlError> {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.contains(['@', '?', '#', '\\', ' ']) {
        return Err(UrlError::Invalid);
    }
    let (scheme, rest) = trimmed.split_once("://").ok_or(UrlError::Invalid)?;
    if rest.is_empty() || rest.contains('/') {
        return Err(UrlError::Invalid);
    }
    let (host, port) = split_host_port(rest)?;
    if host.is_empty() || is_public_ip(host) {
        return Err(UrlError::Invalid);
    }
    match scheme {
        "https" => {}
        "http" if host == "localhost" || host == "127.0.0.1" || host == "::1" => {}
        _ => return Err(UrlError::Invalid),
    }
    let origin = match (scheme, port) {
        ("https", None | Some(443)) => format!("https://{host}"),
        ("http", None | Some(80)) => format!("http://{host}"),
        (_, Some(port)) => format!("{scheme}://{host}:{port}"),
        _ => return Err(UrlError::Invalid),
    };
    Ok(origin)
}

fn split_host_port(rest: &str) -> Result<(&str, Option<u16>), UrlError> {
    if let Some(host) = rest.strip_prefix('[') {
        let (host, suffix) = host.split_once(']').ok_or(UrlError::Invalid)?;
        let port = parse_port_suffix(suffix)?;
        return Ok((host, port));
    }
    if let Some((host, port)) = rest.rsplit_once(':') {
        if !port.is_empty() && port.chars().all(|ch| ch.is_ascii_digit()) {
            let port = port.parse().map_err(|_| UrlError::Invalid)?;
            return Ok((host, Some(port)));
        }
    }
    Ok((rest, None))
}

fn parse_port_suffix(suffix: &str) -> Result<Option<u16>, UrlError> {
    if suffix.is_empty() {
        Ok(None)
    } else if let Some(port) = suffix.strip_prefix(':') {
        port.parse().map(Some).map_err(|_| UrlError::Invalid)
    } else {
        Err(UrlError::Invalid)
    }
}

fn is_public_ip(host: &str) -> bool {
    let octets: Vec<_> = host.split('.').collect();
    if octets.len() != 4 || octets.iter().any(|part| part.is_empty() || !part.chars().all(|ch| ch.is_ascii_digit())) {
        return false;
    }
    host != "127.0.0.1"
}

pub fn is_app_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.starts_with("//")
        && !path.contains('\\')
        && !path.contains("://")
        && !path.contains('\n')
        && path.len() <= 200
}

pub fn page_url(base: &str, path: &str) -> Result<String, UrlError> {
    let base = normalize_base_url(base)?;
    if path.is_empty() || path == "/" {
        return Ok(format!("{base}/"));
    }
    if !is_app_path(path) {
        return Err(UrlError::Invalid);
    }
    Ok(format!("{base}{path}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_local_dev_are_allowed() {
        assert_eq!(normalize_base_url(" https://www.huayanpei.com/ ").unwrap(), DEFAULT_BASE_URL);
        assert_eq!(normalize_base_url(LOCAL_BASE_URL).unwrap(), LOCAL_BASE_URL);
        assert_eq!(normalize_base_url("http://127.0.0.1:3000").unwrap(), "http://127.0.0.1:3000");
        assert!(normalize_base_url("http://example.com").is_err());
        assert!(normalize_base_url("https://user:secret@www.huayanpei.com").is_err());
        assert!(normalize_base_url("http://203.0.113.10").is_err());
        assert_eq!(
            page_url(DEFAULT_BASE_URL, "/fund-confirmations").unwrap(),
            "https://www.huayanpei.com/fund-confirmations"
        );
        assert!(page_url(DEFAULT_BASE_URL, "https://example.com").is_err());
    }
}
