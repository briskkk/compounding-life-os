use glance_core::accept_session_token;

const SERVICE: &str = "com.huayanpei.family-wealth";
const ACCOUNT: &str = "session";

pub fn load_token() -> Option<String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).ok()?;
    let value = entry.get_password().ok()?;
    accept_session_token(&value).ok()
}

pub fn save_token(token: &str) -> bool {
    let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) else {
        return false;
    };
    entry.set_password(token).is_ok()
}

pub fn clear_token() {
    if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
        let _ = entry.delete_password();
    }
}
