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

// ==========================================
// QUALIS OFICIAL DA CAPES
// ==========================================

#[tauri::command]
pub fn pick_qualis_file() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("Selecionar a planilha do Qualis (Plataforma Sucupira)")
        .add_filter(
            "Planilhas (*.xlsx, *.xls, *.ods, *.csv)",
            &["xlsx", "xls", "ods", "csv"],
        )
        .add_filter("Todos os Arquivos (*.*)", &["*"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string()))
}

/// Importa a planilha para a tabela `qualis_capes` (substitui a importação anterior). Com várias
/// áreas na planilha e `area` vazia, não grava nada e devolve as áreas para a tela pedir a escolha.
#[tauri::command(async)]
pub fn qualis_import(
    state: tauri::State<'_, AppState>,
    path: String,
    area: Option<String>,
) -> Result<crate::qualis::ImportResult, String> {
    let path = Path::new(path.trim());
    let table = crate::qualis::read_table(path)?;
    let arquivo = path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::qualis::store_table(&conn, &table, area.as_deref(), &arquivo)
}

/// Dados da tabela do Qualis importada (ou `null` se ainda não houve importação).
#[tauri::command]
pub fn qualis_info(
    state: tauri::State<'_, AppState>,
) -> Result<Option<crate::qualis::QualisInfo>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(crate::qualis::info(&conn))
}

/// Todos os periódicos da tabela do Qualis, com quantos artigos do banco caem em cada um.
#[tauri::command(async)]
pub fn qualis_list(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<crate::qualis::QualisRow>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::qualis::list(&conn)
}

/// Compara os artigos com a tabela do Qualis importada.
#[tauri::command(async)]
pub fn qualis_preview(
    state: tauri::State<'_, AppState>,
) -> Result<crate::qualis::QualisPreview, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::qualis::preview(&conn)
}

#[tauri::command(async)]
pub fn qualis_apply(
    state: tauri::State<'_, AppState>,
    items: Vec<crate::qualis::ApplyItem>,
) -> Result<crate::qualis::ApplyResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(crate::qualis::apply(&conn, &items))
}

// ==========================================
// CITESCORE (SCOPUS / ELSEVIER)
// ==========================================

#[tauri::command]
pub fn citescore_key_status() -> crate::citescore::KeyStatus {
    crate::citescore::key_status()
}

/// Grava a chave da API da Elsevier no config.json do usuário (vazia apaga).
#[tauri::command]
pub fn citescore_set_key(key: String) -> Result<crate::citescore::KeyStatus, String> {
    crate::citescore::set_key(&key)
}

#[derive(Debug, serde::Serialize)]
pub struct CiteScoreTeste {
    pub ok: bool,
    /// A chave só tem acesso à visão sem percentis.
    pub sem_percentil: bool,
    pub mensagem: String,
}

/// Testa a chave consultando uma revista conhecida (Nature, ISSN 0028-0836).
#[tauri::command(async)]
pub async fn citescore_test_key(key: Option<String>) -> Result<CiteScoreTeste, String> {
    let key = key
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .or_else(crate::citescore::key)
        .ok_or("Informe a chave da API da Elsevier.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut view = 0;
        let agent = crate::citescore::agent();
        match crate::citescore::consultar(&agent, "0028-0836", &key, &mut view) {
            Ok(crate::citescore::Consulta::Ok(m)) => CiteScoreTeste {
                ok: true,
                sem_percentil: m.percentil.is_none(),
                mensagem: format!(
                    "Chave funcionando: {} — CiteScore {} {}{}.",
                    m.titulo.unwrap_or_else(|| "Nature".into()),
                    m.ano.map(|a| a.to_string()).unwrap_or_default(),
                    m.citescore
                        .map(|c| format!("{c:.1}"))
                        .unwrap_or_else(|| "—".into()),
                    m.percentil
                        .map(|p| format!(", percentil {p}"))
                        .unwrap_or_else(|| {
                            " (sem percentil: a chave só acessa a visão básica)".into()
                        })
                ),
            },
            Ok(crate::citescore::Consulta::NaoEncontrada) => CiteScoreTeste {
                ok: true,
                sem_percentil: false,
                mensagem: "A chave foi aceita, mas a revista de teste não veio. Tente consultar as suas revistas.".into(),
            },
            Err(f) => CiteScoreTeste {
                ok: false,
                sem_percentil: false,
                mensagem: f.mensagem(),
            },
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn citescore_data(
    state: tauri::State<'_, AppState>,
) -> Result<crate::citescore::CiteScoreData, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut d = crate::citescore::data(&conn)?;
    d.chave = Some(crate::citescore::key_status());
    Ok(d)
}

/// Métricas da revista de cada artigo (Qualis oficial, CiteScore, percentil, SJR, SNIP), para a
/// coluna "Métricas" da tabela de produções.
#[tauri::command(async)]
pub fn journal_metrics(
    state: tauri::State<'_, AppState>,
) -> Result<std::collections::HashMap<i64, crate::citescore::MetricasRevista>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::citescore::por_producao(&conn)
}

#[derive(Debug, Default, serde::Serialize)]
pub struct CiteScoreFetch {
    pub consultadas: usize,
    pub encontradas: usize,
    pub nao_encontradas: usize,
    /// A chave não tem acesso aos percentis (só CiteScore).
    pub sem_percentil: bool,
    /// Motivo da interrupção (chave, acesso, cota); o que foi consultado antes fica gravado.
    pub erro: Option<String>,
}

/// Consulta na Elsevier o CiteScore das revistas dos artigos (`todos`: também as já consultadas),
/// com eventos "citescore-progress" { done, total, issn }.
#[tauri::command(async)]
pub async fn citescore_fetch(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    todos: Option<bool>,
) -> Result<CiteScoreFetch, String> {
    use tauri::Emitter;
    let key = crate::citescore::key().ok_or("Configure a chave da API da Elsevier primeiro.")?;
    let issns = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        crate::citescore::issns_pendentes(&conn, todos.unwrap_or(false))?
    };
    let total = issns.len();
    let app2 = app.clone();
    let (resultados, erro) = tauri::async_runtime::spawn_blocking(move || {
        let agent = crate::citescore::agent();
        let mut view = 0;
        let mut out = Vec::new();
        let mut erro = None;
        for (i, issn) in issns.iter().enumerate() {
            let _ = app2.emit(
                "citescore-progress",
                serde_json::json!({ "done": i, "total": total, "issn": issn }),
            );
            match crate::citescore::consultar(&agent, issn, &key, &mut view) {
                Ok(r) => out.push((issn.clone(), r)),
                Err(f) => {
                    erro = Some(f.mensagem());
                    break;
                }
            }
            std::thread::sleep(crate::citescore::PAUSA);
        }
        let _ = app2.emit(
            "citescore-progress",
            serde_json::json!({ "done": out.len(), "total": total, "issn": "" }),
        );
        (out, erro)
    })
    .await
    .map_err(|e| e.to_string())?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut res = CiteScoreFetch {
        consultadas: resultados.len(),
        erro,
        ..Default::default()
    };
    let mut com_percentil = 0;
    for (issn, r) in &resultados {
        crate::citescore::store(&conn, issn, r)?;
        match r {
            crate::citescore::Consulta::Ok(m) => {
                res.encontradas += 1;
                com_percentil += usize::from(m.percentil.is_some());
            }
            crate::citescore::Consulta::NaoEncontrada => res.nao_encontradas += 1,
        }
    }
    res.sem_percentil = res.encontradas > 0 && com_percentil == 0;
    Ok(res)
}

/// Busca na OpenAlex o ISSN dos artigos com DOI que ainda não têm ISSN.
#[tauri::command(async)]
pub async fn fill_issn_openalex(
    state: tauri::State<'_, AppState>,
) -> Result<crate::qualis::IssnFill, String> {
    let rows: Vec<_> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let missing: std::collections::HashSet<i64> = {
            let mut st = conn
                .prepare("SELECT id FROM producoes WHERE issn IS NULL OR TRIM(issn) = ''")
                .map_err(|e| e.to_string())?;
            let ids = st
                .query_map([], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            ids.flatten().collect()
        };
        crate::academic::load_producoes_with_doi(&conn)?
            .into_iter()
            .filter(|r| missing.contains(&r.id))
            .collect()
    };
    let mut out = crate::qualis::IssnFill {
        consultados: rows.len(),
        ..Default::default()
    };
    if rows.is_empty() {
        return Ok(out);
    }
    let dois: Vec<String> = rows.iter().map(|r| r.doi.clone()).collect();
    let (parsed, errors) = tauri::async_runtime::spawn_blocking(move || {
        crate::academic::fetch_openalex_for_dois(&dois)
    })
    .await
    .map_err(|e| format!("Falha ao consultar OpenAlex: {}", e))?;
    out.erros = errors;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    out.preenchidos = crate::qualis::store_issn(&conn, &rows, &parsed);
    Ok(out)
}
