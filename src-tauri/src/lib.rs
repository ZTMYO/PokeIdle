mod game_data;
mod window_manager;

use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let target = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Digit1);
                    if shortcut != &target || event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            match window.is_visible() {
                                Ok(true) => { let _ = window.hide(); }
                                _ => {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                    window_manager::mark_show().ok();
                                }
                            }
                        }
                    });
                })
                .build(),
        )
        .setup(|app| {
            let target = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Digit1);
            if let Err(e) = app.global_shortcut().register(target) {
                eprintln!("注册快捷键失败: {}", e);
            }

            // Acrylic blur effect on Windows
            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    use windows::Win32::Graphics::Dwm::{
                        DwmSetWindowAttribute, DWM_WINDOW_CORNER_PREFERENCE,
                        DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
                    };
                    use windows::Win32::Foundation::HWND;

                    if let Ok(hwnd) = window.hwnd() {
                        let hwnd = HWND(hwnd.0 as _);
                        let _ = window_vibrancy::clear_vibrancy(&window);
                        unsafe {
                            let corner_pref = DWM_WINDOW_CORNER_PREFERENCE(DWMWCP_ROUND.0);
                            let _ = DwmSetWindowAttribute(
                                hwnd,
                                DWMWA_WINDOW_CORNER_PREFERENCE,
                                &corner_pref as *const _ as _,
                                std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
                            );
                        }
                        let _ = window_vibrancy::apply_acrylic(&window, Some((255, 255, 255, 20)));
                        let _ = window.set_shadow(true);
                    }
                }
            }

            // Tray icon
            {
                let handle = app.handle().clone();

                let show_item = MenuItem::with_id(&handle, "show", "显示 / 隐藏", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(&handle, "quit", "退出", true, None::<&str>)?;
                let tray_menu = Menu::with_items(&handle, &[&show_item, &quit_item])?;

                let tray_icon = handle.default_window_icon().cloned();

                let mut tray_builder = TrayIconBuilder::with_id("tray")
                    .menu(&tray_menu)
                    .show_menu_on_left_click(false)
                    .tooltip("宝可梦挂机");
                if let Some(icon) = tray_icon {
                    tray_builder = tray_builder.icon(icon);
                }

                tray_builder
                    .on_menu_event(move |app_handle: &tauri::AppHandle, event: tauri::menu::MenuEvent| {
                        match event.id().as_ref() {
                            "show" => {
                                if let Some(window) = app_handle.get_webview_window("main") {
                                    match window.is_visible() {
                                        Ok(true) => { let _ = window.hide(); }
                                        _ => {
                                            let _ = window.show();
                                            let _ = window.set_focus();
                                        }
                                    }
                                }
                            }
                            "quit" => {
                                app_handle.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(move |tray: &tauri::tray::TrayIcon, event: TrayIconEvent| {
                        if let TrayIconEvent::Click { button, button_state, .. } = event {
                            if button == MouseButton::Left && button_state == MouseButtonState::Up {
                                let app_handle = tray.app_handle().clone();
                                tauri::async_runtime::spawn(async move {
                                    if let Some(window) = app_handle.get_webview_window("main") {
                                        match window.is_visible() {
                                            Ok(true) => { let _ = window.hide(); }
                                            _ => {
                                                let _ = window.show();
                                                let _ = window.set_focus();
                                            }
                                        }
                                    }
                                });
                            }
                        }
                    })
                    .build(&handle)?;
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            window_manager::set_ignore_blur,
            window_manager::set_window_pinned,
            window_manager::mark_show,
            game_data::save_game_data,
            game_data::load_game_data,
            game_data::read_gif_base64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
