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
// 1) 窗口尺寸用「物理像素」直接设定（320×scale 物理 px）：任何 DPI 下同一倍率的
//    物理大小一致（175% 与 100% DPI 屏幕看到的窗口同样大）。
// 2) webview ZoomFactor 设为 实际倍率/DPR，抵消系统缩放对 CSS 像素的影响：
//    布局视口恒为 320×400、1 CSS px = scale 物理 px，画面在高/低 DPI 下逐像素一致。
//    公式：CSS 视口 = 窗口物理尺寸 / (zoom × DPR) = (320×scale) / (scale/DPR × DPR) = 320
// 注意：若显示器容纳不下所设倍率，窗口与 zoom 必须使用同一「实际生效倍率」，
// 否则 CSS 视口会被压缩，一屏显示内容变少、被迫滚动。
#[tauri::command]
pub fn set_window_scale(window: tauri::WebviewWindow, scale: f64) -> Result<(), String> {
    const BASE_W: f64 = 320.0;
    const BASE_H: f64 = 400.0;
    let s = if scale > 0.0 { scale } else { 1.0 };

    // 当前显示器 DPR：ZoomFactor 用 倍率/DPR，把 DPI 缩放抵消掉
    let dpr = window.scale_factor().unwrap_or(1.0).max(0.25);

    // 实际生效倍率：物理窗口尺寸按显示器物理像素上限钳制（留 5% 边距）
    let mut effective = s;
    if let Ok(Some(monitor)) = window.current_monitor() {
        let mon = monitor.size();
        let max_s = ((mon.width as f64 * 0.95) / BASE_W)
            .min((mon.height as f64 * 0.95) / BASE_H);
        if s > max_s {
            effective = max_s;
        }
    }
    let effective = effective.max(0.5); // 极小屏下限保护，避免窗口缩到 0

    let w = (BASE_W * effective).floor() as u32;
    let h = (BASE_H * effective).floor() as u32;
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: w,
            height: h,
        }))
        .map_err(|e| e.to_string())?;
    window.set_zoom(effective / dpr).map_err(|e| e.to_string())?;
    let _ = window.center();
    Ok(())
}
