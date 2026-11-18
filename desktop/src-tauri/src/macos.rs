#[cfg(target_os = "macos")]
pub fn activate() {
    use objc::runtime::{Class, Object};
    use objc::{msg_send, sel, sel_impl};

    unsafe {
        let Some(class) = Class::get("NSApplication") else { return };
        let app: *mut Object = msg_send![class, sharedApplication];
        if app.is_null() {
            return;
        }
        let _: () = msg_send![app, activateIgnoringOtherApps: true];
    }
}

#[cfg(not(target_os = "macos"))]
pub fn activate() {}
