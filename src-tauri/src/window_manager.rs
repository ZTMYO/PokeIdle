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
// 注意：若显示器容纳不下所设倍率，窗口与 zoom 必须使用同一「实际生效倍率」，
// 否则 CSS 视口会被压缩（视口 = 窗口逻辑尺寸 / zoom < 320×400），一屏显示内容变少、被迫滚动。
#[tauri::command]
pub fn set_window_scale(window: tauri::WebviewWindow, scale: f64) -> Result<(), String> {
    const BASE_W: f64 = 320.0;
    const BASE_H: f64 = 400.0;
    let s = if scale > 0.0 { scale } else { 1.0 };
    let mut effective = s;
    if let Ok(Some(monitor)) = window.current_monitor() {
        let sf = monitor.scale_factor();
        let max_s = ((monitor.size().width as f64) / sf / BASE_W)
            .min((monitor.size().height as f64) / sf / BASE_H);
        if s > max_s {
            effective = max_s;
        }
    }
    let effective = effective.max(0.5); // 极小屏下限保护，避免窗口缩到 0
    let w = (BASE_W * effective).floor();
    let h = (BASE_H * effective).floor();
    window
        .set_size(tauri::LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    window.set_zoom(effective).map_err(|e| e.to_string())?;
    let _ = window.center();
    Ok(())
}
