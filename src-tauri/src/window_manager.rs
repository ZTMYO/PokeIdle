use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

pub static IGNORE_BLUR: AtomicBool = AtomicBool::new(false);
pub static WINDOW_PINNED: AtomicBool = AtomicBool::new(false);
pub static LAST_SHOW_TIMESTAMP: AtomicU64 = AtomicU64::new(0);

// JS 侧真实系统 dpr：前端在 zoom=1 时上报，或上报 devicePixelRatio / 当前 zoom。
// Rust 的 scale_factor() 与 WebView2 实际渲染用的 JS dpr 可能不一致（实测 Rust=2.0、JS=2.34），
// 用 Rust dpr 算 zoom 会导致 CSS 视口漂移，故必须以 JS 上报为准。
// 注意：WebView2 的 window.devicePixelRatio 包含 zoom factor，前端上报前已还原成系统 dpr。
static JS_DPR: Mutex<f64> = Mutex::new(0.0);

// 前端上报系统真实 devicePixelRatio（不含 webview zoom）
#[tauri::command]
pub fn set_device_pixel_ratio(dpr: f64) -> Result<(), String> {
    if dpr > 0.0 {
        *JS_DPR.lock().unwrap() = dpr;
    }
    Ok(())
}

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

// 窗口倍率：按 274×342 基础尺寸等比缩放，且与系统 DPI 完全解耦。
// 设计基准为 274×342（开发时所有页面均按此视口调校），任意设备画面一致。
// 1) 窗口尺寸用「物理像素」直接设定（274×render_scale 物理 px）。
// 2) webview ZoomFactor 设为 render_scale / js_dpr：CSS 视口 = 物理窗口 / (zoom × js_dpr)
//    = (274×render_scale) / (render_scale/js_dpr × js_dpr) = 274×342，恒为设计基准。
// 3) render_scale 取 max(用户倍率, js_dpr)：set_zoom 在部分 WebView2 版本不可靠，
//    不生效时 CSS 视口 = 物理窗口 / js_dpr，需物理窗口 >= 274×js_dpr 才能保证视口 >= 274。
#[tauri::command]
pub fn set_window_scale(window: tauri::WebviewWindow, scale: f64) -> Result<f64, String> {
    const BASE_W: f64 = 274.0;
    const BASE_H: f64 = 342.0;
    let s = if scale > 0.0 { scale } else { 1.0 };

    // 以 JS 上报的真实系统 dpr 为准（Rust scale_factor 与 WebView2 实际渲染可能不一致）
    let js_dpr = {
        let d = *JS_DPR.lock().unwrap();
        if d > 0.0 { d } else { window.scale_factor().unwrap_or(1.0) }
    };
    let dpr = js_dpr.max(0.25);

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
    // 确保 CSS 视口 >= 基准尺寸：set_zoom 不可靠时物理窗口需 >= BASE×dpr
    let render_scale = effective.max(dpr).min(max_s);

    let w = (BASE_W * render_scale).floor() as u32;
    let h = (BASE_H * render_scale).floor() as u32;
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: w,
            height: h,
        }))
        .map_err(|e| e.to_string())?;
    let zoom = render_scale / dpr;
    window.set_zoom(zoom).map_err(|e| e.to_string())?;
    let _ = window.center();
    // 返回实际 zoom：前端需用它把 devicePixelRatio 还原成系统 dpr（devicePixelRatio 含 zoom）
    Ok(zoom)
}
