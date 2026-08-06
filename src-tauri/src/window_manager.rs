use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

pub static IGNORE_BLUR: AtomicBool = AtomicBool::new(false);
pub static WINDOW_PINNED: AtomicBool = AtomicBool::new(false);
pub static LAST_SHOW_TIMESTAMP: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub fn set_ignore_blur(ignore: bool) -> Result<(), String> {
    IGNORE_BLUR.store(ignore, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn set_window_pinned(pinned: bool) -> Result<(), String> {
    WINDOW_PINNED.store(pinned, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn mark_show() -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    LAST_SHOW_TIMESTAMP.store(now, Ordering::Relaxed);
    Ok(())
}

// 窗口倍率：按 320×400 基础尺寸等比缩放窗口并同步缩放 webview 内容。
// 窗口用逻辑尺寸（与 tauri.conf.json 的 width/height 一致），webview 缩放用 WebView2 ZoomFactor
// （等价浏览器页面缩放：布局视口同步收缩为 320×400，vw/vh 与 DOM 坐标一致，游戏逻辑不受影响）
#[tauri::command]
pub fn set_window_scale(window: tauri::WebviewWindow, scale: f64) -> Result<(), String> {
    const BASE_W: f64 = 320.0;
    const BASE_H: f64 = 400.0;
    let s = if scale > 0.0 { scale } else { 1.0 };
    let mut w = BASE_W * s;
    let mut h = BASE_H * s;
    if let Ok(Some(monitor)) = window.current_monitor() {
        let sf = monitor.scale_factor();
        let max_s = ((monitor.size().width as f64) / sf / BASE_W)
            .min((monitor.size().height as f64) / sf / BASE_H);
        if s > max_s {
            w = (BASE_W * max_s).floor();
            h = (BASE_H * max_s).floor();
        }
    }
    window
        .set_size(tauri::LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    window.set_zoom(s).map_err(|e| e.to_string())?;
    let _ = window.center();
    Ok(())
}
