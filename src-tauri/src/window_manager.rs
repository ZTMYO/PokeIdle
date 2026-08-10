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

// 窗口倍率：按 320×400 基础尺寸等比缩放，且与系统 DPI 完全解耦。
// 1) 窗口尺寸用「物理像素」直接设定（320×render_scale 物理 px）。
// 2) webview ZoomFactor 设为 render_scale/DPR，抵消系统缩放对 CSS 像素的影响：
//    CSS 视口 = 物理窗口 / (zoom × DPR) = (320×render_scale) / (render_scale/DPR × DPR) = 320
// 3) render_scale 取 max(用户倍率, DPR)：set_zoom 在部分 WebView2 版本不可靠，
//    不生效时 CSS 视口 = 物理窗口 / DPR，需物理窗口 >= 320×DPR 才能保证视口 >= 320。
#[tauri::command]
pub fn set_window_scale(window: tauri::WebviewWindow, scale: f64) -> Result<(), String> {
    const BASE_W: f64 = 320.0;
    const BASE_H: f64 = 400.0;
    let s = if scale > 0.0 { scale } else { 1.0 };

    let dpr = window.scale_factor().unwrap_or(1.0).max(0.25);

    // 显示器物理像素上限（留 5% 边距）
    let max_s = if let Ok(Some(monitor)) = window.current_monitor() {
        let mon = monitor.size();
        ((mon.width as f64 * 0.95) / BASE_W)
            .min((mon.height as f64 * 0.95) / BASE_H)
    } else {
        f64::INFINITY
    };
    // 用户倍率经显示器钳制
    let effective = s.min(max_s).max(0.5);
    // 确保 CSS 视口 >= 基准尺寸：set_zoom 不可靠时物理窗口需 >= BASE×DPR
    let render_scale = effective.max(dpr).min(max_s);

    let w = (BASE_W * render_scale).floor() as u32;
    let h = (BASE_H * render_scale).floor() as u32;
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: w,
            height: h,
        }))
        .map_err(|e| e.to_string())?;
    window.set_zoom(render_scale / dpr).map_err(|e| e.to_string())?;
    let _ = window.center();
    Ok(())
}
