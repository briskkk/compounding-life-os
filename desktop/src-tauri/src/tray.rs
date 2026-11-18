use glance_core::{menu_entries, render_status, status_text, tooltip, Appearance, BarState, ServerPreset};
use tauri::image::Image;
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::{handle_menu, show_main, AppState};

const TEMPLATE_ICON: &[u8] = include_bytes!("../icons/tray-template.png");

pub fn create(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let menu = Menu::new(app)?;
    let icon = Image::from_bytes(TEMPLATE_ICON)?;
    let tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("家庭财富终端")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| {
            handle_menu(app, event.id.as_ref());
        })
        .build(app)?;
    Ok(tray)
}

pub fn apply(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("main") else { return };
    let state = app.state::<AppState>();
    let bar = state.bar.lock().unwrap_or_else(|err| err.into_inner()).clone();
    let base = state.base_url.lock().unwrap_or_else(|err| err.into_inner()).clone();
    let preset = glance_core::preset_of(&base);
    let _ = refresh_menu(app, &tray, &bar, preset);
    let _ = refresh_icon(&tray, &bar);
    let _ = tray.set_tooltip(Some(tooltip(&bar)));
}

fn refresh_menu(app: &AppHandle, tray: &TrayIcon, bar: &BarState, preset: ServerPreset) -> tauri::Result<()> {
    let menu = Menu::new(app)?;
    for entry in menu_entries(bar, preset) {
        if entry.separator {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
            continue;
        }
        if entry.id.starts_with("server-") {
            let item = CheckMenuItemBuilder::with_id(entry.id.as_str(), entry.label.as_str())
                .enabled(entry.enabled)
                .checked(entry.checked)
                .build(app)?;
            menu.append(&item)?;
            continue;
        }
        let item = MenuItemBuilder::with_id(entry.id.as_str(), entry.label.as_str())
            .enabled(entry.enabled)
            .build(app)?;
        menu.append(&item)?;
    }
    tray.set_menu(Some(menu))?;
    Ok(())
}

fn refresh_icon(tray: &TrayIcon<Wry>, bar: &BarState) -> tauri::Result<()> {
    let status = status_text(bar);
    match status.tone {
        Some(tone) => {
            let image = render_status(&status.title, tone, appearance());
            let icon = Image::new_owned(image.rgba, image.width, image.height);
            tray.set_icon_with_as_template(Some(icon), false)?;
            tray.set_title(Some(""))?;
        }
        None => {
            let icon = Image::from_bytes(TEMPLATE_ICON)?;
            tray.set_icon_with_as_template(Some(icon), true)?;
            tray.set_title(Some(status.title))?;
        }
    }
    Ok(())
}

fn appearance() -> Appearance {
    #[cfg(target_os = "macos")]
    {
        let dark = std::process::Command::new("defaults")
            .args(["read", "-g", "AppleInterfaceStyle"])
            .output()
            .map(|output| String::from_utf8_lossy(&output.stdout).to_ascii_lowercase().contains("dark"))
            .unwrap_or(false);
        if dark {
            return Appearance::Dark;
        }
    }
    Appearance::Light
}
