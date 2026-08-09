use tauri::Manager;

#[tauri::command]
pub fn save_game_data(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("save.json");
    std::fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_game_data(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("save.json");
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_save_data(_app: tauri::AppHandle, data: String) -> Result<String, String> {
    let dir = rfd::FileDialog::new()
        .set_title("选择存档导出目录")
        .pick_folder();
    match dir {
        Some(path) => {
            let save_path = path.join("save.json");
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
