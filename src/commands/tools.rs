//! Ferramentas: categorias personalizadas, manutenção de arquivos, backup, comparação de XML e métricas.

use super::*;

// CATEGORIAS PERSONALIZADAS
// ==========================================

#[tauri::command(async)]
pub fn list_custom_categories(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<crate::custom::CustomCategory>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::custom::list_categories(&conn).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn save_custom_category(
    state: tauri::State<'_, AppState>,
    category: crate::custom::CustomCategory,
) -> Result<crate::custom::CustomCategory, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::custom::save_category(&conn, &state.root_dir, category)
}

#[tauri::command(async)]
pub fn delete_custom_category(
    state: tauri::State<'_, AppState>,
    key: String,
    force: Option<bool>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::custom::delete_category(&conn, &key, force.unwrap_or(false))
}

#[tauri::command(async)]
pub fn reorder_custom_categories(
    state: tauri::State<'_, AppState>,
    keys: Vec<String>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::custom::reorder(&conn, &keys).map_err(|e| e.to_string())
}

// ==========================================
// FERRAMENTAS
// ==========================================

#[tauri::command(async)]
pub fn preview_file_renames(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<crate::tools::RenameItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::tools::preview_renames(&conn, &state.root_dir)
}

#[tauri::command(async)]
pub fn apply_file_renames(
    state: tauri::State<'_, AppState>,
    items: Vec<crate::tools::RenameItem>,
) -> Result<crate::tools::ApplyResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(crate::tools::apply_renames(&conn, &state.root_dir, &items))
}

#[tauri::command(async)]
pub fn scan_pendencias(
    state: tauri::State<'_, AppState>,
) -> Result<crate::pendencias::Relatorio, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::pendencias::scan(&conn, &state.root_dir)
}

#[tauri::command(async)]
pub fn check_files(state: tauri::State<'_, AppState>) -> Result<crate::tools::FileCheck, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::tools::check_files(&conn, &state.root_dir)
}

#[tauri::command(async)]
pub fn clear_missing_links(
    state: tauri::State<'_, AppState>,
    items: Vec<crate::tools::MissingFile>,
) -> Result<crate::tools::ApplyResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(crate::tools::clear_missing(&conn, &state.root_dir, &items))
}

#[tauri::command(async)]
pub fn scan_root_folders(
    state: tauri::State<'_, AppState>,
) -> Result<crate::tools::RootFolderAudit, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::tools::scan_root_folders(&conn, &state.root_dir)
}

#[tauri::command(async)]
pub fn remove_audited_folders(
    state: tauri::State<'_, AppState>,
    rel_paths: Vec<String>,
    remove_mappings: Option<bool>,
    delete_unlinked_files: Option<bool>,
) -> Result<crate::tools::ApplyResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(crate::tools::remove_audited_folders(
        &conn,
        &state.root_dir,
        &rel_paths,
        remove_mappings.unwrap_or(false),
        delete_unlinked_files.unwrap_or(false),
    ))
}

#[tauri::command(async)]
pub fn create_missing_mapped_folders(
    state: tauri::State<'_, AppState>,
    rel_paths: Vec<String>,
) -> Result<crate::tools::ApplyResult, String> {
    Ok(crate::tools::create_missing_mapped_folders(
        &state.root_dir,
        &rel_paths,
    ))
}

#[tauri::command(async)]
pub fn remove_unlinked_mappings(
    state: tauri::State<'_, AppState>,
    mapping_ids: Vec<i64>,
) -> Result<crate::tools::ApplyResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(crate::tools::remove_unlinked_mappings(&conn, &mapping_ids))
}

#[tauri::command(async)]
pub fn delete_orphan_files(
    state: tauri::State<'_, AppState>,
    rel_files: Vec<String>,
) -> Result<crate::tools::ApplyResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(crate::tools::delete_orphan_files(
        &conn,
        &state.root_dir,
        &rel_files,
    ))
}

#[tauri::command(async)]
pub fn backup_database(
    state: tauri::State<'_, AppState>,
) -> Result<crate::tools::BackupInfo, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::tools::backup(&conn, &state.root_dir)
}

/// Grava as planilhas no destino escolhido em `select_save_path(kind = "xlsx")`.
#[tauri::command(async)]
pub fn export_xlsx(
    state: tauri::State<'_, AppState>,
    sheets: Vec<crate::tools::Sheet>,
) -> Result<String, String> {
    let target = state
        .pending_save
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "Nenhum destino selecionado".to_string())?;
    crate::tools::write_xlsx(&target, &sheets)?;
    state.remember_saved(&target);
    Ok(target.to_string_lossy().to_string())
}

// ==========================================
// BACKUP COMPLETO E RESTAURAÇÃO
// ==========================================

#[tauri::command(async)]
pub fn backup_estimate(
    state: tauri::State<'_, AppState>,
) -> Result<crate::backup::Estimate, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(crate::backup::estimate(&conn, &state.root_dir))
}

#[tauri::command]
pub fn pick_backup_target(
    state: tauri::State<'_, AppState>,
    include_files: bool,
) -> Result<Option<String>, String> {
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H%M");
    let name = if include_files {
        format!("LattesManager_Cofre_{}.lattespack", stamp)
    } else {
        format!("LattesManager_banco_{}.lattespack", stamp)
    };
    let dir = crate::strip_verbatim(&state.root_dir).join("backups");
    let _ = std::fs::create_dir_all(&dir);
    Ok(rfd::FileDialog::new()
        .set_title("Salvar Cofre / Backup do Lattes Manager")
        .set_directory(&dir)
        .set_file_name(&name)
        .add_filter(
            "Cofre do Lattes Manager (*.lattespack, *.zip)",
            &["lattespack", "zip"],
        )
        .save_file()
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn create_backup(
    app: tauri::AppHandle,
    path: String,
    include_files: bool,
) -> Result<crate::backup::BackupResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::{Emitter, Manager};
        let state = app.state::<AppState>();
        let dest = PathBuf::from(path.trim());
        let snap = std::env::temp_dir().join(format!("lattes_backup_{}.db", std::process::id()));
        let folders = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            crate::backup::snapshot_db(&conn, &snap)?;
            crate::backup::data_folders(Some(&conn), &state.root_dir)
        };
        let res = crate::backup::write_zip(
            &snap,
            &state.root_dir,
            &folders,
            include_files,
            env!("CARGO_PKG_VERSION"),
            &dest,
            |done, total, name| {
                let _ = app.emit(
                    "backup-progress",
                    serde_json::json!({ "done": done, "total": total, "name": name }),
                );
            },
        );
        let _ = std::fs::remove_file(&snap);
        if res.is_ok() {
            state.remember_saved(&dest);
        }
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn pick_backup_file(state: tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    let dir = crate::strip_verbatim(&state.root_dir).join("backups");
    let mut d = rfd::FileDialog::new()
        .set_title("Escolher Cofre / Backup para restaurar")
        .add_filter(
            "Cofre do Lattes Manager (*.lattespack, *.zip, *.db)",
            &["lattespack", "zip", "db"],
        );
    if dir.is_dir() {
        d = d.set_directory(&dir);
    }
    Ok(d.pick_file().map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn inspect_backup(path: String) -> Result<crate::backup::BackupInspection, String> {
    tauri::async_runtime::spawn_blocking(move || crate::backup::inspect(Path::new(path.trim())))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn verify_backup_integrity(
    path: String,
) -> Result<crate::backup::IntegrityReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::backup::verify_integrity(Path::new(path.trim()))
    })
    .await
    .map_err(|e| e.to_string())?
}

// LATTES TIME MACHINE (DIFF XML)
// ==========================================

#[tauri::command]
pub async fn diff_lattes_xml(
    state: tauri::State<'_, AppState>,
    xml_path_new: String,
    xml_path_old: Option<String>,
) -> Result<crate::diff::LattesDiffResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let old_buf = xml_path_old
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from);
    crate::diff::compare_lattes_versions(&conn, Path::new(xml_path_new.trim()), old_buf.as_deref())
}

#[tauri::command]
pub async fn cross_check_lattes_xml(
    state: tauri::State<'_, AppState>,
    xml_path: String,
) -> Result<crate::diff::CrossCheckResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::diff::cross_check_db_vs_xml(&conn, Path::new(xml_path.trim()))
}

#[tauri::command]
pub async fn sync_openalex_metrics(
    state: tauri::State<'_, AppState>,
    update_citations: Option<bool>,
) -> Result<crate::academic::OpenAlexSyncReport, String> {
    let rows = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        crate::academic::load_producoes_with_doi(&conn)?
    };

    let mut seen = std::collections::HashSet::new();
    let dois: Vec<String> = rows
        .iter()
        .filter_map(|r| {
            let d = r.doi.trim().to_ascii_lowercase();
            if !d.is_empty() && seen.insert(d.clone()) {
                Some(d)
            } else {
                None
            }
        })
        .collect();

    let (parsed, errors) = tauri::async_runtime::spawn_blocking(move || {
        crate::academic::fetch_openalex_for_dois(&dois)
    })
    .await
    .map_err(|e| format!("Falha ao consultar OpenAlex: {}", e))?;

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::academic::build_and_apply_openalex_report(
        &conn,
        &rows,
        &parsed,
        errors,
        update_citations.unwrap_or(true),
    )
}

#[tauri::command]
pub async fn sync_orcid_works(
    state: tauri::State<'_, AppState>,
    orcid: String,
) -> Result<crate::academic::OrcidSyncReport, String> {
    let clean = crate::academic::clean_orcid(&orcid)
        .ok_or_else(|| "ORCID inválido. Use o formato 0000-0000-0000-0000.".to_string())?;
    let clean_clone = clean.clone();
    let raw = tauri::async_runtime::spawn_blocking(move || {
        crate::academic::fetch_orcid_works(&clean_clone)
    })
    .await
    .map_err(|e| format!("Falha ao consultar ORCID: {}", e))??;

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::academic::compare_orcid_with_db(&conn, &clean, raw)
}

/// Restaura um backup. `restore_db`: substitui o banco (com cópia de segurança do atual em `backups/`);
/// `restore_files`: extrai os comprovantes do zip; `overwrite`: substitui arquivos que já existem.
#[tauri::command]
pub async fn restore_backup(
    app: tauri::AppHandle,
    path: String,
    restore_db: bool,
    restore_files: bool,
    overwrite: bool,
) -> Result<crate::backup::RestoreReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::{Emitter, Manager};
        let state = app.state::<AppState>();
        let src = PathBuf::from(path.trim());
        let mut rep = crate::backup::RestoreReport::default();
        if restore_db {
            let new_db = crate::backup::prepare_db(&src)?;
            let mut conn = state.db.lock().map_err(|e| e.to_string())?;
            // cópia de segurança do banco atual
            let dir = state.root_dir.join("backups");
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let safety = dir.join(format!(
                "lattes_antes_restauracao_{}.db",
                chrono::Local::now().format("%Y-%m-%d_%H%M%S")
            ));
            crate::backup::snapshot_db(&conn, &safety)?;
            rep.safety_copy = Some(safety.to_string_lossy().to_string());
            let r = crate::backup::swap_db(&mut conn, &state.root_dir, &new_db);
            let _ = std::fs::remove_file(&new_db);
            r?;
            rep.db_restored = true;
        }
        if restore_files {
            crate::backup::restore_files(
                &src,
                &state.root_dir,
                overwrite,
                &mut rep,
                |done, total, name| {
                    let _ = app.emit(
                        "backup-progress",
                        serde_json::json!({ "done": done, "total": total, "name": name }),
                    );
                },
            )?;
        }
        Ok(rep)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ==========================================
// GOOGLE SCHOLAR CITATIONS (SERPAPI)
// ==========================================

#[tauri::command(async)]
pub fn get_scholar_config(
    state: tauri::State<'_, AppState>,
) -> Result<crate::scholar::ScholarConfig, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::scholar::get_scholar_config(&conn)
}

#[tauri::command(async)]
pub fn save_scholar_config(
    state: tauri::State<'_, AppState>,
    author_id: String,
    api_key: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::scholar::save_scholar_config(&conn, &author_id, &api_key)
}

#[tauri::command]
pub async fn sync_scholar_citations(
    state: tauri::State<'_, AppState>,
    author_id: Option<String>,
    api_key: Option<String>,
) -> Result<crate::scholar::ScholarSyncReport, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::scholar::sync_scholar_citations(&conn, author_id.as_deref(), api_key.as_deref())
}

#[tauri::command]
pub fn get_unmatched_scholar_articles(
    state: tauri::State<'_, AppState>,
    force_refresh: Option<bool>,
) -> Result<crate::scholar::UnmatchedScholarReport, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::scholar::get_unmatched_scholar_articles(&conn, force_refresh.unwrap_or(false))
}
