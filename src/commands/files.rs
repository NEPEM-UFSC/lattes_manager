//! Vincular comprovantes, pasta de dados e Vassoura de Comprovantes.

use super::*;

// ==========================================
// VINCULAR COMPROVANTES / DUPLICATAS
// ==========================================

#[tauri::command]
pub async fn suggest_file_links(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<linker::LinkSuggestion>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    linker::suggest_links(&conn, &state.root_dir)
}

#[tauri::command(async)]
pub fn apply_file_links(
    state: tauri::State<'_, AppState>,
    links: Vec<linker::LinkApply>,
) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    linker::apply_links(&conn, &state.root_dir, &links)
}

#[tauri::command(async)]
pub fn find_duplicate_records(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<linker::DupPair>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    linker::find_duplicates(&conn)
}

#[tauri::command(async)]
pub fn get_app_stats(state: tauri::State<'_, AppState>) -> Result<AppStatsDto, String> {
    get_app_stats_impl(&state.db, &state.root_dir)
}

// ==========================================
// PASTA DE DADOS
// ==========================================

#[tauri::command(async)]
pub fn get_data_dir_info(state: tauri::State<'_, AppState>) -> Result<config::DataDirInfo, String> {
    let root = crate::strip_verbatim(&state.root_dir);
    let db = root.join("lattes.db");
    let cfg = config::load();
    let from_config = cfg
        .data_dir
        .map(|d| {
            crate::strip_verbatim(&std::fs::canonicalize(&d).unwrap_or_else(|_| PathBuf::from(&d)))
                == root
        })
        .unwrap_or(false);
    Ok(config::DataDirInfo {
        data_dir: root.to_string_lossy().to_string(),
        db_path: db.to_string_lossy().to_string(),
        config_file: config::config_file().to_string_lossy().to_string(),
        from_config,
        folders: config::category_folders(&root),
        db_size: std::fs::metadata(&db).map(|m| m.len()).unwrap_or(0),
    })
}

#[tauri::command]
pub fn pick_folder(title: Option<String>) -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title(title.as_deref().unwrap_or("Selecionar pasta"))
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command(async)]
pub fn inspect_data_dir(path: String) -> Result<config::DataDirInspection, String> {
    Ok(config::inspect(Path::new(path.trim())))
}

/// Troca a pasta de dados e reinicia o app.
/// `copy_db`: copia o banco atual para a nova pasta (só se lá ainda não houver lattes.db).
#[tauri::command]
pub fn set_data_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
    copy_db: bool,
) -> Result<(), String> {
    let target = PathBuf::from(path.trim());
    std::fs::create_dir_all(&target).map_err(|e| {
        format!(
            "Não foi possível usar a pasta '{}': {}",
            target.display(),
            e
        )
    })?;
    let target_db = target.join("lattes.db");
    if copy_db {
        if target_db.exists() {
            return Err(
                "A pasta escolhida já tem um lattes.db — escolha 'usar o banco que já está lá'."
                    .into(),
            );
        }
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        // cópia consistente do banco (inclui o conteúdo do WAL)
        conn.execute(
            "VACUUM INTO ?1",
            rusqlite::params![target_db.to_string_lossy().to_string()],
        )
        .map_err(|e| format!("Falha ao copiar o banco: {}", e))?;
    }
    config::save(&config::AppConfig {
        data_dir: Some(target.to_string_lossy().to_string()),
    })?;
    app.restart();
}

/// Volta à detecção automática da pasta de dados e reinicia.
#[tauri::command]
pub fn reset_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let f = config::config_file();
    if f.exists() {
        std::fs::remove_file(&f).map_err(|e| e.to_string())?;
    }
    app.restart();
}

// ==========================================
// VASSOURA DE COMPROVANTES
// ==========================================

#[tauri::command]
pub async fn scan_vassoura(
    state: tauri::State<'_, AppState>,
    external_dir: String,
) -> Result<Vec<crate::vassoura::VassouraMatch>, String> {
    let root = state.root_dir.clone();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let matches = crate::vassoura::scan_vassoura(&conn, &root, Path::new(external_dir.trim()))?;
    for m in &matches {
        state.remember_saved(Path::new(&m.file_path));
    }
    Ok(matches)
}

#[tauri::command]
pub async fn apply_vassoura(
    state: tauri::State<'_, AppState>,
    items: Vec<crate::vassoura::VassouraApplyItem>,
    move_files: bool,
) -> Result<crate::vassoura::VassouraApplyResult, String> {
    let root = state.root_dir.clone();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::vassoura::apply_vassoura(&conn, &root, &items, move_files)
}

// ==========================================

/// Registros com título muito parecido, para o formulário avisar antes de salvar.
#[tauri::command(async)]
pub fn find_similar_records(
    state: tauri::State<'_, AppState>,
    category: String,
    titulo: String,
    ano: Option<i64>,
    exclude_id: Option<i64>,
) -> Result<Vec<linker::SimilarRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    linker::similar_records(&conn, &category, &titulo, ano, exclude_id)
}
