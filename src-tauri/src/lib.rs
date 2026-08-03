mod game_data;
mod window_manager;

use std::sync::Mutex;
use tauri::image::Image;
use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

// ===== 托盘走路动画 =====
// 前端一次性传入动画帧（RGBA 字节），后台线程按帧率循环切换托盘图标
#[derive(Default)]
struct TrayFrames(Mutex<Vec<Image<'static>>>);

#[derive(serde::Deserialize)]
struct TrayFrameData {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

// 托盘悬停提示文本：前端每秒推送一次（含 \n 换行，Windows 原生 tooltip 渲染成多行）
#[derive(Default)]
struct TrayStatus(Mutex<String>);

#[tauri::command]
fn set_tray_status(app: tauri::AppHandle, state: tauri::State<'_, TrayStatus>, text: String) {
    *state.0.lock().unwrap() = text.clone();
    if let Some(tray) = app.tray_by_id("tray") {
        let _ = tray.set_tooltip(Some(text));
    }
}

#[tauri::command]
fn set_tray_frames(state: tauri::State<'_, TrayFrames>, frames: Vec<TrayFrameData>) {
    let mut list = state.0.lock().unwrap();
    list.clear();
    for f in frames {
        if f.width == 0 || f.height == 0 || f.rgba.len() != (f.width * f.height * 4) as usize {
            continue;
        }
        list.push(Image::new_owned(f.rgba, f.width, f.height));
    }
}

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
                    .tooltip("口袋挂机");
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

            // 托盘走路动画：后台线程每 150ms 切一帧，帧数据由前端通过 set_tray_frames 传入
            app.manage(TrayFrames::default());
            app.manage(TrayStatus::default());
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let mut idx = 0usize;
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(150));
                        let tray_frames = handle.state::<TrayFrames>();
                        let frames = tray_frames.0.lock().unwrap();
                        if frames.is_empty() {
                            continue;
                        }
                        let frame = frames[idx % frames.len()].clone();
                        drop(frames);
                        if let Some(tray) = handle.tray_by_id("tray") {
                            let _ = tray.set_icon(Some(frame));
                        }
                        idx += 1;
                    }
                });
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
            set_tray_frames,
            set_tray_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
