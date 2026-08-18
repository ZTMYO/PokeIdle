use tauri::Manager;

const SAVE_MAX_BYTES: u64 = 20 * 1024 * 1024;
const IMPORT_BACKUP_FILE: &str = "save.import-backup.json";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSaveFile {
    pub name: String,
    pub content: String,
    pub size: u64,
}

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
pub fn export_save_data(data: String, file_name: String) -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .set_title("导出口袋挂机存档")
        .add_filter("存档文件", &["json"])
        .set_file_name(&file_name)
        .save_file();
    match file {
        Some(path) => {
            std::fs::write(&path, &data).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn import_save_data(_app: tauri::AppHandle) -> Result<Option<ImportedSaveFile>, String> {
    let file = rfd::FileDialog::new()
        .set_title("选择要导入的存档文件")
        .add_filter("存档文件", &["json"])
        .pick_file();
    match file {
        Some(path) => {
            let size = std::fs::metadata(&path)
                .map_err(|e| format!("读取失败: {}", e))?
                .len();
            if size > SAVE_MAX_BYTES {
                return Err("SAVE_TOO_LARGE: 存档文件不能超过 20 MB".to_string());
            }
            let bytes = std::fs::read(&path).map_err(|e| format!("读取失败: {}", e))?;
            let content = String::from_utf8(bytes).map_err(|e| format!("读取失败: {}", e))?;
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("save.json")
                .to_string();
            Ok(Some(ImportedSaveFile {
                name,
                content,
                size,
            }))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn create_import_backup(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(IMPORT_BACKUP_FILE), data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_import_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(IMPORT_BACKUP_FILE);
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|e| e.to_string())
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
