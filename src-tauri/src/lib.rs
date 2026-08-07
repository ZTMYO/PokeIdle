mod game_data;
mod window_manager;

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::image::Image;
use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

// ===== 托盘走路动画 =====
// 前端一次性传入动画帧（RGBA 字节）与每帧间隔 delay（毫秒），后台线程按帧率循环切换托盘图标
#[derive(Default)]
struct TrayFrames(Mutex<Vec<Image<'static>>>);

// 当前动画每帧间隔（毫秒）：随 set_tray_frames 一起更新，让走路/跑步/骑车/钓鱼等
// 不同动画各自按游戏实际节奏切换（如钓鱼 800ms/帧，走路 150ms/帧）
#[derive(Default)]
struct TrayDelay(Mutex<u64>);

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

static ALLOW_CLOSE: AtomicBool = AtomicBool::new(false);

// 用户确认退出：置放行标志后触发真正关闭
#[tauri::command]
fn force_close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    ALLOW_CLOSE.store(true, Ordering::Relaxed);
    window.close().map_err(|e| e.to_string())
}

// 用户选择最小化到托盘：隐藏窗口，游戏继续后台挂机
#[tauri::command]
fn hide_to_tray(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_tray_frames(
    state: tauri::State<'_, TrayFrames>,
    delay_state: tauri::State<'_, TrayDelay>,
    frames: Vec<TrayFrameData>,
    delay: Option<u64>,
) {
    let mut list = state.0.lock().unwrap();
    list.clear();
    for f in frames {
        if f.width == 0 || f.height == 0 || f.rgba.len() != (f.width * f.height * 4) as usize {
            continue;
        }
        list.push(Image::new_owned(f.rgba, f.width, f.height));
    }
    // 每帧间隔随本次动画一起更新；默认 150ms，最低 30ms 防止误传 0 造成忙转
    let mut d = delay_state.0.lock().unwrap();
    *d = delay.unwrap_or(150).max(30);
}

// 切换主窗口的显示状态（托盘点击 / Ctrl+Alt+1 全局快捷键共用）：
// - 窗口可见且未最小化 → 收起（隐藏窗口与任务栏图标）
// - 窗口可见但处于最小化 → 还原显示（点击托盘从任务栏恢复，而不是把图标也藏起来）
// - 窗口已隐藏 → 弹出到前台
fn toggle_window_visibility(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                if window.is_minimized().unwrap_or(false) {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                } else {
                    let _ = window.hide();
                }
            }
            _ => {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window_manager::mark_show();
            }
        }
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
                        toggle_window_visibility(&app_handle);
                    });
                })
                .build(),
        )
        .setup(|app| {
            let target = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Digit1);
            if let Err(e) = app.global_shortcut().register(target) {
                eprintln!("注册快捷键失败: {}", e);
            }

            // Windows: 系统圆角 + 窗口阴影
            // 注意：不用透明窗口（transparent=false）。透明窗口在 Windows 是 layered window，
            // WebView2 会退化为软件合成，拖拽窗口明显卡顿；亚克力效果也被不透明外壳完全遮挡，故一并移除。
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
                        unsafe {
                            let corner_pref = DWM_WINDOW_CORNER_PREFERENCE(DWMWCP_ROUND.0);
                            let _ = DwmSetWindowAttribute(
                                hwnd,
                                DWMWA_WINDOW_CORNER_PREFERENCE,
                                &corner_pref as *const _ as _,
                                std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
                            );
                        }
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
                                    toggle_window_visibility(&app_handle);
                                });
                            }
                        }
                    })
                    .build(&handle)?;
            }

            // 托盘动画：后台线程按当前动画的每帧间隔切帧，帧数据与间隔由前端通过 set_tray_frames 传入
            app.manage(TrayFrames::default());
            app.manage(TrayStatus::default());
            app.manage(TrayDelay::default());
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let mut idx = 0usize;
                    loop {
                        // 每次循环读取最新帧间隔（切换动画时即时生效）
                        let delay_ms = *handle.state::<TrayDelay>().0.lock().unwrap();
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
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
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 未确认退出：拦截关闭并通知前端弹二次确认框（右上角叉 / 任务栏关闭均走此路径）
                if !ALLOW_CLOSE.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.emit("close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            window_manager::set_ignore_blur,
            window_manager::set_window_pinned,
            window_manager::set_window_scale,
            window_manager::mark_show,
            game_data::save_game_data,
            game_data::load_game_data,
            game_data::read_gif_base64,
            set_tray_frames,
            set_tray_status,
            force_close_window,
            hide_to_tray,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
