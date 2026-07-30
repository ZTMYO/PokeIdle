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
