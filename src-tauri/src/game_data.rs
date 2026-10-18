use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

// 写盘串行：前端多处 saveGame 并发调用，同时写同一个文件会互相截断成半截 JSON
static SAVE_LOCK: Mutex<()> = Mutex::new(());

fn save_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// 原子写：先写临时文件并 fsync 落盘，再改名覆盖主档。
// 直接写主档时中途失败/断电就只剩半个 JSON，读回来等于白档
fn write_atomic(path: &Path, data: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    {
        let mut f = File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    // 覆盖前留一份备份：主档写坏时启动还能回退
    if path.exists() {
        let _ = std::fs::copy(path, path.with_extension("bak"));
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

// 只认合法 JSON 且带 items 的档：半截内容读出来也算"成功"，会顶掉后面的好档
fn read_valid(path: &Path) -> Option<String> {
    let s = std::fs::read_to_string(path).ok()?;
    if s.trim().is_empty() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(&s).ok()?;
    if v.get("items").is_none() {
        return None;
    }
    Some(s)
}

#[tauri::command]
pub fn save_game_data(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let _guard = SAVE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = save_dir(&app)?.join("save.json");
    write_atomic(&path, &data)
}

#[tauri::command]
pub fn load_game_data(app: tauri::AppHandle) -> Result<String, String> {
    let path = save_dir(&app)?.join("save.json");
    if let Some(s) = read_valid(&path) {
        return Ok(s);
    }
    // 主档缺失/损坏 → 回退备份档
    if let Some(s) = read_valid(&path.with_extension("bak")) {
        return Ok(s);
    }
    Ok(String::new())
}

#[tauri::command]
pub fn export_save_data(_app: tauri::AppHandle, data: String) -> Result<String, String> {
    let dir = rfd::FileDialog::new()
        .set_title("选择存档导出目录")
        .pick_folder();
    match dir {
        Some(path) => {
            // 文件名带毫秒时间戳后缀（与移动端 exportSave 同款）：连导两次不会互相覆盖，也一眼看得出导出时间
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let save_path = path.join(format!("pokeidle-save-{}.json", stamp));
            std::fs::write(&save_path, &data).map_err(|e| e.to_string())?;
            Ok(save_path.to_string_lossy().to_string())
        }
        None => Err("用户取消了导出".to_string()),
    }
}

#[tauri::command]
pub fn import_save_data(_app: tauri::AppHandle) -> Result<String, String> {
    let file = rfd::FileDialog::new()
        .set_title("选择要导入的存档文件")
        .add_filter("存档文件", &["json"])
        .pick_file();
    match file {
        Some(path) => {
            std::fs::read_to_string(&path).map_err(|e| format!("读取失败: {}", e))
        }
        None => Err("用户取消了导入".to_string()),
    }
}

#[tauri::command]
pub fn read_gif_base64(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;

    // 尝试多个可能的基准路径（dev / 构建后）
    let candidates = vec![
        resource_dir.join("../../src").join(&path),
        resource_dir.join("../src").join(&path),
        resource_dir.join("src").join(&path),
        std::path::PathBuf::from("../src").join(&path),
        std::path::PathBuf::from("src").join(&path),
    ];

    for p in &candidates {
        if p.exists() {
            let bytes = std::fs::read(p).map_err(|e| format!("读取失败: {}", e))?;
            use base64::Engine;
            return Ok(base64::engine::general_purpose::STANDARD.encode(&bytes));
        }
    }

    Err(format!(
        "图片不存在（尝试了 {} 个路径，均失败）: {}",
        candidates.len(),
        path
    ))
}
