// Tauri IPC commands for Lattes Desktop Manager

use crate::db::models::{AppStatsDto, MigrationReportDto, RecordDto, SubfolderMappingDto};
use crate::db::queries;
use crate::files::{shell, storage};
use crate::migration::calamine_importer;
use crate::AppState;
use rusqlite::Connection;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// ==========================================
// PURE IMPLEMENTATION FUNCTIONS (FOR TESTING & DIRECT USE)
// ==========================================

pub fn get_records_impl(
    db: &Mutex<Connection>,
    category: &str,
    search: Option<&str>,
    year: Option<i64>,
    tipo: Option<&str>,
) -> Result<Vec<RecordDto>, String> {
    let conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
    queries::get_records(&conn, category, search, year, tipo)
        .map_err(|e| format!("Failed to get records: {}", e))
}

/// Pasta de comprovantes válida: `5_producoes\artigos_completos\` (não o marcador "folder").
pub fn valid_folder(f: &str) -> bool {
    let t = f.trim().trim_matches('\\');
    let first = t.split('\\').next().unwrap_or("");
    !t.is_empty() && first.split_once('_').map(|(n, _)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())).unwrap_or(false)
}

/// Nome do grupo (subfolder_mappings.category_group) de uma categoria.
fn group_of(conn: &Connection, category: &str) -> Option<String> {
    if crate::custom::is_custom(category) {
        return conn.query_row("SELECT name FROM custom_categories WHERE key = ?1", [category], |r| r.get(0)).ok();
    }
    Some(
        match crate::db::schema::normalize_category(category)? {
            "dadosgerais" => "Dados gerais",
            "formacao" => "Formação",
            "encargos" => "Encargos",
            "disciplinas" => "Disciplinas",
            "projetos" => "Projetos",
            "producoes" => "Produções",
            "patentes" => "Patentes",
            "eventos" => "Eventos",
            "orientacoes" => "Orientações",
            _ => "Bancas",
        }
        .to_string(),
    )
}

/// Garante uma pasta de destino real: a informada, a do registro, a do caminho atual
/// ou a da subcategoria (tipo). Corrige registros com o marcador "folder" da planilha.
fn with_valid_folder(db: &Mutex<Connection>, category: &str, data: &Value, existing: Option<&RecordDto>) -> Result<Value, String> {
    let mut out = data.clone();
    if queries::json_str(data, "folder").is_some_and(|f| valid_folder(&f)) {
        return Ok(out);
    }
    if let Some(e) = existing {
        if data.get("folder").is_none() && e.folder.as_deref().is_some_and(valid_folder) {
            return Ok(out);
        }
    }
    let from_path = existing
        .and_then(|e| e.path.as_deref())
        .and_then(|p| p.replace('/', "\\").rsplit_once('\\').map(|(d, _)| format!("{}\\", d)))
        .filter(|d| valid_folder(d));
    let tipo = queries::json_str(data, "tipo").or_else(|| existing.and_then(|e| e.tipo.clone()));
    let found = from_path.or_else(|| {
        let conn = db.lock().ok()?;
        let group = group_of(&conn, category)?;
        conn.query_row(
            "SELECT folder FROM subfolder_mappings WHERE lower(category_group) = lower(?1) ORDER BY CASE WHEN lower(description) = lower(?2) THEN 0 ELSE 1 END, id LIMIT 1",
            rusqlite::params![group, tipo.unwrap_or_default()],
            |r| r.get::<_, String>(0),
        )
        .ok()
    });
    if let (Some(f), Some(obj)) = (found, out.as_object_mut()) {
        obj.insert("folder".into(), Value::String(f));
    }
    Ok(out)
}

/// Link de um registro: só http(s). Sem esquema vira https://; DOI solto vira https://doi.org/….
pub fn normalize_url(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    let lower = s.to_ascii_lowercase();
    let full = if lower.starts_with("http://") || lower.starts_with("https://") {
        s.to_string()
    } else if lower.starts_with("10.") && s.contains('/') {
        format!("https://doi.org/{}", s)
    } else if lower.starts_with("doi:") {
        format!("https://doi.org/{}", s[4..].trim())
    } else if s.split(['/', '?', '#']).next().is_some_and(|h| h.contains(':')) {
        return Err(format!("URL inválida: '{}'. Use um endereço http:// ou https://", s));
    } else {
        format!("https://{}", s)
    };
    let host = full.split_once("://").map(|(_, r)| r).unwrap_or("").split(['/', '?', '#']).next().unwrap_or("");
    if full.contains(char::is_whitespace) || !host.contains('.') || host.starts_with('.') || host.ends_with('.') {
        return Err(format!("URL inválida: '{}'", s));
    }
    Ok(full)
}

/// Normaliza o campo "url" do payload (se presente); vazio vira null.
fn with_clean_url(data: &Value) -> Result<Value, String> {
    let mut out = data.clone();
    if let Some(v) = out.get_mut("url") {
        let s = v.as_str().unwrap_or("").trim().to_string();
        *v = if s.is_empty() { Value::Null } else { Value::String(normalize_url(&s)?) };
    }
    Ok(out)
}

pub fn create_record_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    category: &str,
    data: &Value,
    source_file: Option<&str>,
) -> Result<RecordDto, String> {
    let data = &with_valid_folder(db, category, &with_clean_url(data)?, None)?;
    let mut attached_file: Option<String> = None;
    let mut attached_path: Option<String> = None;

    if let Some(src) = source_file {
        let src_trimmed = src.trim();
        if !src_trimmed.is_empty() {
            let src_path = Path::new(src_trimmed);
            if !src_path.exists() {
                return Err(format!("Arquivo de origem não encontrado: '{}'", src_trimmed));
            }

            let folder_str = queries::json_str(data, "folder")
                .ok_or_else(|| "Subpasta de destino não informada no registro".to_string())?;

            let target_subfolder = crate::files::rel_join(root_dir, &folder_str);
            if !target_subfolder.exists() {
                std::fs::create_dir_all(&target_subfolder)
                    .map_err(|e| format!("Falha ao criar subpasta '{:?}': {}", target_subfolder, e))?;
            }

            // arquivo renomeado pelo título do registro: 001_titulo_do_trabalho.pdf
            let base = crate::files::naming::record_base_name(category, data);
            let attachment = storage::save_attached_file_as(src_path, &target_subfolder, root_dir, base.as_deref())
                .map_err(|e| format!("Falha ao anexar arquivo: {}", e))?;

            attached_file = Some(attachment.filename);
            attached_path = Some(attachment.relative_path);
        }
    }

    let conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
    queries::insert_record(&conn, category, data, attached_file, attached_path)
        .map_err(|e| format!("Falha ao inserir registro: {}", e))
}

pub fn update_record_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    category: &str,
    id: i64,
    data: &Value,
    new_source_file: Option<&str>,
) -> Result<RecordDto, String> {
    let existing = {
        let conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
        queries::get_record_by_id(&conn, category, id).ok()
    };
    let data = &with_valid_folder(db, category, &with_clean_url(data)?, existing.as_ref())?;
    let mut attached_file: Option<String> = None;
    let mut attached_path: Option<String> = None;

    if let Some(src) = new_source_file {
        let src_trimmed = src.trim();
        if !src_trimmed.is_empty() {
            let src_path = Path::new(src_trimmed);
            if !src_path.exists() {
                return Err(format!("Novo arquivo de origem não encontrado: '{}'", src_trimmed));
            }

            // Determine target folder from payload or existing record
            let folder_str = if let Some(f) = queries::json_str(data, "folder") {
                f
            } else {
                let conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
                let existing = queries::get_record_by_id(&conn, category, id)
                    .map_err(|e| format!("Registro não encontrado: {}", e))?;
                existing
                    .folder
                    .ok_or_else(|| "Subpasta de destino não encontrada para o registro".to_string())?
            };

            let target_subfolder = crate::files::rel_join(root_dir, &folder_str);
            if !target_subfolder.exists() {
                std::fs::create_dir_all(&target_subfolder)
                    .map_err(|e| format!("Falha ao criar subpasta '{:?}': {}", target_subfolder, e))?;
            }

            // nome pelo título: dados novos sobre o registro atual
            let merged = {
                let conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
                let mut base = queries::get_record_by_id(&conn, category, id)
                    .ok()
                    .and_then(|r| serde_json::to_value(r).ok())
                    .unwrap_or_else(|| Value::Object(Default::default()));
                if let (Some(b), Some(d)) = (base.as_object_mut(), data.as_object()) {
                    for (k, v) in d {
                        b.insert(k.clone(), v.clone());
                    }
                }
                base
            };
            let base = crate::files::naming::record_base_name(category, &merged);
            let attachment = storage::save_attached_file_as(src_path, &target_subfolder, root_dir, base.as_deref())
                .map_err(|e| format!("Falha ao salvar novo arquivo anexado: {}", e))?;

            attached_file = Some(attachment.filename);
            attached_path = Some(attachment.relative_path);
        }
    }

    let conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
    queries::update_record(&conn, category, id, data, attached_file, attached_path)
        .map_err(|e| format!("Falha ao atualizar registro: {}", e))
}

pub fn delete_record_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    category: &str,
    id: i64,
    delete_file: bool,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;

    if delete_file {
        if let Ok(rec) = queries::get_record_by_id(&conn, category, id) {
            if let Some(path_str) = rec.path {
                let trimmed = path_str.trim();
                if !trimmed.is_empty() {
                    if let Ok(full_path) = resolve_inside_root(root_dir, trimmed) {
                        if full_path.is_file() {
                            let _ = std::fs::remove_file(&full_path);
                        }
                    }
                }
            }
        }
    }

    queries::delete_record(&conn, category, id)
        .map_err(|e| format!("Falha ao excluir registro: {}", e))
}

pub fn get_subfolder_mappings_impl(
    db: &Mutex<Connection>,
    category_group: Option<&str>,
) -> Result<Vec<SubfolderMappingDto>, String> {
    let conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
    let mappings = queries::get_subfolder_mappings(&conn, category_group)
        .map_err(|e| format!("Falha ao carregar mapeamentos de subpastas: {}", e))?;
    Ok(mappings.into_iter().map(Into::into).collect())
}

pub fn add_subfolder_mapping_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    category_group: &str,
    description: &str,
    folder: &str,
) -> Result<SubfolderMappingDto, String> {
    let clean_folder = folder
        .trim()
        .replace('/', "\\")
        .trim_start_matches('\\')
        .to_string();

    let full_dir = crate::files::rel_join(root_dir, &clean_folder);
    if !full_dir.exists() {
        let _ = std::fs::create_dir_all(&full_dir);
    }

    let conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
    let mapping = queries::add_subfolder_mapping(&conn, category_group, description, &clean_folder)
        .map_err(|e| format!("Falha ao adicionar mapeamento de subpasta: {}", e))?;
    Ok(mapping.into())
}

pub fn open_file_impl(root_dir: &Path, relative_path: &str) -> Result<(), String> {
    let full_path = resolve_inside_root(root_dir, relative_path)?;
    shell::open_path(&full_path)
}

pub fn reveal_in_explorer_impl(root_dir: &Path, relative_path: &str) -> Result<(), String> {
    let full_path = resolve_inside_root(root_dir, relative_path)?;
    shell::reveal_in_explorer(&full_path)
}

pub fn open_folder_impl(root_dir: &Path, relative_path: &str) -> Result<(), String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() || trimmed == "." {
        shell::open_folder(root_dir)
    } else {
        let full_path = crate::files::rel_join(root_dir, trimmed);
        if !full_path.exists() {
            let _ = std::fs::create_dir_all(&full_path);
        }
        let full_path = resolve_inside_root(root_dir, trimmed)?;
        if !full_path.is_dir() {
            return Err(format!("Não é uma pasta: {}", full_path.display()));
        }
        shell::open_folder(&full_path)
    }
}

pub fn import_from_excel_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    xlsm_path: Option<&str>,
) -> Result<MigrationReportDto, String> {
    let path = xlsm_path
        .map(PathBuf::from)
        .unwrap_or_else(|| root_dir.join("lattes.xlsm"));

    if !path.exists() {
        return Err(format!("Arquivo Excel não encontrado em '{}'", path.display()));
    }

    let mut conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
    let report = calamine_importer::migrate_workbook(&mut conn, &path, root_dir)
        .map_err(|e| format!("Falha na migração do Excel: {}", e))?;

    Ok(MigrationReportDto {
        total_imported: report.total_records,
        counts_by_category: report.category_counts,
        total_mappings: report.total_mappings,
        warnings: report.warnings,
    })
}

pub fn get_app_stats_impl(db: &Mutex<Connection>, root_dir: &Path) -> Result<AppStatsDto, String> {
    let conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
    let db_path = root_dir.join("lattes.db").to_string_lossy().to_string();
    queries::get_app_stats(&conn, &db_path).map_err(|e| format!("Falha ao obter estatísticas: {}", e))
}

// ==========================================
// TAURI IPC COMMAND ENDPOINTS
// ==========================================

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command(async)]
pub fn get_records(
    state: tauri::State<'_, AppState>,
    category: String,
    search: Option<String>,
    year: Option<i64>,
    tipo: Option<String>,
) -> Result<Vec<RecordDto>, String> {
    get_records_impl(&state.db, &category, search.as_deref(), year, tipo.as_deref())
}

#[tauri::command(async)]
pub fn create_record(
    state: tauri::State<'_, AppState>,
    category: String,
    data: Value,
    source_file: Option<String>,
) -> Result<RecordDto, String> {
    create_record_impl(&state.db, &state.root_dir, &category, &data, source_file.as_deref())
}

#[tauri::command(async)]
pub fn update_record(
    state: tauri::State<'_, AppState>,
    category: String,
    id: i64,
    data: Value,
    new_source_file: Option<String>,
) -> Result<RecordDto, String> {
    update_record_impl(
        &state.db,
        &state.root_dir,
        &category,
        id,
        &data,
        new_source_file.as_deref(),
    )
}

#[tauri::command(async)]
pub fn delete_record(
    state: tauri::State<'_, AppState>,
    category: String,
    id: i64,
    delete_file: bool,
) -> Result<(), String> {
    delete_record_impl(&state.db, &state.root_dir, &category, id, delete_file)
}

#[tauri::command(async)]
pub fn get_subfolder_mappings(
    state: tauri::State<'_, AppState>,
    category_group: Option<String>,
) -> Result<Vec<SubfolderMappingDto>, String> {
    get_subfolder_mappings_impl(&state.db, category_group.as_deref())
}

#[tauri::command(async)]
pub fn add_subfolder_mapping(
    state: tauri::State<'_, AppState>,
    category_group: String,
    description: String,
    folder: String,
) -> Result<SubfolderMappingDto, String> {
    add_subfolder_mapping_impl(
        &state.db,
        &state.root_dir,
        &category_group,
        &description,
        &folder,
    )
}

#[tauri::command]
pub fn select_source_file() -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("Selecionar Comprovante / Documento")
        .add_filter(
            "Documentos e Imagens",
            &["pdf", "png", "jpg", "jpeg", "docx", "doc", "xlsx", "xls", "txt"],
        )
        .add_filter("PDF (*.pdf)", &["pdf"])
        .add_filter("Imagens (*.png, *.jpg, *.jpeg)", &["png", "jpg", "jpeg"])
        .add_filter("Todos os Arquivos (*.*)", &["*"])
        .pick_file();

    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

/// Caminho que pode ser aberto no sistema: dentro da pasta do currículo (relativo ou
/// absoluto) ou um arquivo que o próprio app gravou para o usuário (relatório, planilha, backup).
pub fn resolve_for_shell(state: &AppState, path: &str) -> Result<PathBuf, String> {
    resolve_inside_root(&state.root_dir, path).or_else(|e| {
        let p = PathBuf::from(path.trim());
        if p.is_file() && state.is_saved(&p) {
            Ok(crate::real_path(&p))
        } else {
            Err(e)
        }
    })
}

#[tauri::command]
pub fn open_file(
    state: tauri::State<'_, AppState>,
    relative_path: String,
) -> Result<(), String> {
    shell::open_path(&resolve_for_shell(&state, &relative_path)?)
}

#[tauri::command]
pub fn reveal_in_explorer(
    state: tauri::State<'_, AppState>,
    relative_path: String,
) -> Result<(), String> {
    shell::reveal_in_explorer(&resolve_for_shell(&state, &relative_path)?)
}

#[tauri::command]
pub fn open_folder(
    state: tauri::State<'_, AppState>,
    relative_path: String,
) -> Result<(), String> {
    open_folder_impl(&state.root_dir, &relative_path)
}

#[tauri::command(async)]
pub fn import_from_excel(
    state: tauri::State<'_, AppState>,
    xlsm_path: Option<String>,
) -> Result<MigrationReportDto, String> {
    import_from_excel_impl(&state.db, &state.root_dir, xlsm_path.as_deref())
}

// ==========================================
// XML LATTES / CONFIGURAÇÕES
// ==========================================

use crate::migration::lattes_xml::{self, XmlProduction};

fn resolve_xml_path(root_dir: &Path, xml_path: Option<&str>) -> PathBuf {
    match xml_path.map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => PathBuf::from(p),
        None => {
            let a = root_dir.join("lattes_xml.xml");
            if a.exists() { a } else { root_dir.join("lattes_xml") }
        }
    }
}

pub fn preview_lattes_xml_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    xml_path: Option<&str>,
) -> Result<Vec<XmlProduction>, String> {
    let path = resolve_xml_path(root_dir, xml_path);
    if !path.exists() {
        return Err(format!("Arquivo XML não encontrado em '{}'", path.display()));
    }
    let conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
    lattes_xml::preview(&conn, &path)
}

pub fn import_lattes_xml_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    items: &[XmlProduction],
) -> Result<usize, String> {
    let mut conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
    lattes_xml::import_items(&mut conn, root_dir, items)
}

#[tauri::command]
pub fn select_xml_file() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("Selecionar XML do Currículo Lattes")
        .add_filter("XML Lattes (*.xml)", &["xml"])
        .add_filter("Todos os Arquivos (*.*)", &["*"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command(async)]
pub fn preview_lattes_xml(
    state: tauri::State<'_, AppState>,
    xml_path: Option<String>,
) -> Result<Vec<XmlProduction>, String> {
    preview_lattes_xml_impl(&state.db, &state.root_dir, xml_path.as_deref())
}

#[tauri::command(async)]
pub fn import_lattes_xml(
    state: tauri::State<'_, AppState>,
    items: Vec<XmlProduction>,
) -> Result<usize, String> {
    import_lattes_xml_impl(&state.db, &state.root_dir, &items)
}

#[tauri::command(async)]
pub fn update_subfolder_mapping(
    state: tauri::State<'_, AppState>,
    id: i64,
    description: String,
    folder: String,
) -> Result<(), String> {
    let clean = folder.trim().replace('/', "\\").trim_start_matches('\\').to_string();
    let full = crate::files::rel_join(&state.root_dir, &clean);
    if !full.exists() {
        let _ = std::fs::create_dir_all(&full);
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE subfolder_mappings SET description = ?1, folder = ?2 WHERE id = ?3",
        rusqlite::params![description.trim(), clean, id],
    )
    .map_err(|e| format!("Falha ao atualizar opção: {}", e))?;
    Ok(())
}

#[tauri::command(async)]
pub fn delete_subfolder_mapping(state: tauri::State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM subfolder_mappings WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("Falha ao excluir opção: {}", e))?;
    Ok(())
}

/// Opções de listas simples (ex.: qualis) guardadas em app_metadata como JSON.
#[tauri::command(async)]
pub fn get_dropdown_options(state: tauri::State<'_, AppState>, field: String) -> Result<Option<Vec<String>>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_metadata WHERE key = ?1",
            rusqlite::params![format!("options.{}", field)],
            |r| r.get(0),
        )
        .ok();
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}

#[tauri::command(async)]
pub fn set_dropdown_options(
    state: tauri::State<'_, AppState>,
    field: String,
    options: Vec<String>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let json = serde_json::to_string(&options).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![format!("options.{}", field), json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(async)]
pub fn get_all_records(state: tauri::State<'_, AppState>) -> Result<std::collections::HashMap<String, Vec<RecordDto>>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut out = std::collections::HashMap::new();
    for t in crate::db::schema::ENTITY_TABLES {
        let recs = queries::get_records(&conn, t, None, None, None).map_err(|e| e.to_string())?;
        out.insert(t.to_string(), recs);
    }
    for k in crate::custom::keys(&conn) {
        let recs = crate::custom::list(&conn, &k, None, None, None).map_err(|e| e.to_string())?;
        out.insert(k, recs);
    }
    Ok(out)
}

// ==========================================
// VISUALIZADOR INTERNO / RELATÓRIO DE COMPROVANTES
// ==========================================

/// Resolve um caminho da interface garantindo que ele fique dentro da pasta raiz.
/// Aceita caminho relativo à raiz ou absoluto — desde que, já resolvido, continue dentro dela.
pub fn resolve_inside_root(root_dir: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let trimmed = relative_path.trim();
    let full = if Path::new(trimmed).is_absolute() {
        PathBuf::from(trimmed)
    } else {
        shell::resolve_relative_path(root_dir, trimmed)
    };
    if !full.exists() {
        return Err(format!("Arquivo não encontrado: {}", full.display()));
    }
    let root = crate::strip_verbatim(&std::fs::canonicalize(root_dir).unwrap_or_else(|_| root_dir.to_path_buf()));
    let canon = crate::strip_verbatim(&std::fs::canonicalize(&full).map_err(|e| e.to_string())?);
    if !canon.starts_with(&root) {
        return Err("Caminho fora da pasta do currículo".into());
    }
    Ok(canon)
}

/// Caminho absoluto de um comprovante, para o visualizador interno (asset protocol).
#[tauri::command(async)]
pub fn resolve_file_path(state: tauri::State<'_, AppState>, relative_path: String) -> Result<String, String> {
    resolve_inside_root(&state.root_dir, &relative_path).map(|p| p.to_string_lossy().to_string())
}

/// Bytes de um comprovante (binário, sem JSON) para montar o PDF único.
#[tauri::command]
pub async fn read_file_bytes(state: tauri::State<'_, AppState>, relative_path: String) -> Result<tauri::ipc::Response, String> {
    let p = resolve_inside_root(&state.root_dir, &relative_path)?;
    let bytes = std::fs::read(&p).map_err(|e| format!("Falha ao ler '{}': {}", p.display(), e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Fontes do sistema permitidas para o relatório (Segoe UI).
#[tauri::command]
pub fn read_system_font(name: String) -> Result<tauri::ipc::Response, String> {
    // nomes lógicos (Segoe UI no Windows) → fonte equivalente em cada sistema
    let n = name.to_lowercase();
    let weight = match n.as_str() {
        "segoeui.ttf" | "segoeuil.ttf" | "segoeuii.ttf" => "regular",
        "seguisb.ttf" => "semibold",
        "segoeuib.ttf" => "bold",
        _ => return Err("Fonte não permitida".into()),
    };
    let mut cands: Vec<std::path::PathBuf> = Vec::new();
    if cfg!(windows) {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into());
        cands.push(Path::new(&windir).join("Fonts").join(&n));
    }
    let (mac, linux): (&[&str], &[&str]) = match weight {
        "bold" => (
            &["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf"],
            &["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"],
        ),
        "semibold" => (
            &["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf"],
            &["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"],
        ),
        _ => (
            &["/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf"],
            &["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/TTF/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"],
        ),
    };
    cands.extend(mac.iter().chain(linux.iter()).map(std::path::PathBuf::from));
    for c in cands {
        if let Ok(bytes) = std::fs::read(&c) {
            return Ok(tauri::ipc::Response::new(bytes));
        }
    }
    Err(format!("Fonte indisponível neste sistema ({})", n))
}

#[tauri::command(async)]
pub fn get_lattes_profile(
    state: tauri::State<'_, AppState>,
    xml_path: Option<String>,
) -> Result<lattes_xml::LattesProfile, String> {
    let path = resolve_xml_path(&state.root_dir, xml_path.as_deref());
    if !path.exists() {
        return Err(format!("Arquivo XML não encontrado em '{}'", path.display()));
    }
    lattes_xml::parse_profile(&path)
}

// ==========================================
// FOTO DE PERFIL (perfil/foto_perfil.png|jpg, fora das pastas de comprovantes)
// ==========================================

pub const PHOTO_DIR: &str = "perfil";
const PHOTO_MAX_BYTES: u64 = 40 * 1024 * 1024;

/// Extensão pelo conteúdo do arquivo (não pelo nome): só PNG e JPEG.
pub fn photo_kind(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else {
        None
    }
}

fn photo_files(root_dir: &Path) -> Vec<PathBuf> {
    ["png", "jpg"].iter().map(|e| root_dir.join(PHOTO_DIR).join(format!("foto_perfil.{}", e))).collect()
}

/// Caminho relativo da foto atual, se houver.
pub fn profile_photo_impl(root_dir: &Path) -> Option<String> {
    photo_files(root_dir)
        .into_iter()
        .find(|p| p.is_file())
        .and_then(|p| p.file_name().map(|n| format!("{}/{}", PHOTO_DIR, n.to_string_lossy())))
}

/// Copia `src` como a foto de perfil, substituindo a anterior. Devolve o caminho relativo.
pub fn set_profile_photo_impl(root_dir: &Path, src: &Path) -> Result<String, String> {
    let size = std::fs::metadata(src).map_err(|e| format!("Falha ao ler a foto: {}", e))?.len();
    if size > PHOTO_MAX_BYTES {
        return Err("Foto muito grande (máximo de 40 MB)".into());
    }
    let bytes = std::fs::read(src).map_err(|e| format!("Falha ao ler a foto: {}", e))?;
    let ext = photo_kind(&bytes).ok_or("A foto precisa ser um arquivo PNG ou JPG")?;
    let dir = root_dir.join(PHOTO_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Falha ao criar a pasta '{}': {}", dir.display(), e))?;
    remove_profile_photo_impl(root_dir)?;
    let target = dir.join(format!("foto_perfil.{}", ext));
    std::fs::write(&target, &bytes).map_err(|e| format!("Falha ao salvar a foto: {}", e))?;
    Ok(format!("{}/foto_perfil.{}", PHOTO_DIR, ext))
}

pub fn remove_profile_photo_impl(root_dir: &Path) -> Result<(), String> {
    for p in photo_files(root_dir).into_iter().filter(|p| p.is_file()) {
        std::fs::remove_file(&p).map_err(|e| format!("Falha ao remover '{}': {}", p.display(), e))?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn get_profile_photo(state: tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(profile_photo_impl(&state.root_dir))
}

/// Abre o diálogo de imagem e grava a escolhida como foto de perfil. `None` se cancelado.
#[tauri::command]
pub fn pick_profile_photo(state: tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    let Some(src) = rfd::FileDialog::new()
        .set_title("Selecionar foto de perfil")
        .add_filter("Imagens PNG ou JPG", &["png", "jpg", "jpeg"])
        .pick_file()
    else {
        return Ok(None);
    };
    set_profile_photo_impl(&state.root_dir, &src).map(Some)
}

#[tauri::command(async)]
pub fn remove_profile_photo(state: tauri::State<'_, AppState>) -> Result<(), String> {
    remove_profile_photo_impl(&state.root_dir)
}

#[tauri::command]
pub fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Abre o diálogo "Salvar como" e guarda o destino para `write_report`.
#[tauri::command]
pub fn select_save_path(state: tauri::State<'_, AppState>, suggested_name: String, kind: Option<String>) -> Result<Option<String>, String> {
    let (title, filter, ext): (&str, &str, &str) = match kind.as_deref() {
        Some("xlsx") => ("Salvar planilha do Excel", "Excel (*.xlsx)", "xlsx"),
        Some("html") => ("Salvar painel de indicadores", "Página HTML (*.html)", "html"),
        Some("csv") => ("Salvar CSV", "CSV (*.csv)", "csv"),
        _ => ("Salvar comprovantes em PDF", "PDF (*.pdf)", "pdf"),
    };
    let picked = rfd::FileDialog::new()
        .set_title(title)
        .set_directory(crate::strip_verbatim(&state.root_dir))
        .set_file_name(&suggested_name)
        .add_filter(filter, &[ext])
        .save_file();
    let mut slot = state.pending_save.lock().map_err(|e| e.to_string())?;
    *slot = picked.clone();
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

/// Recebe o PDF como corpo binário e grava no destino escolhido em `select_save_path`.
#[tauri::command]
pub async fn write_report(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Conteúdo do PDF não recebido".into());
    };
    let target = state
        .pending_save
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "Nenhum destino selecionado".to_string())?;
    std::fs::write(&target, bytes).map_err(|e| format!("Falha ao salvar '{}': {}", target.display(), e))?;
    state.remember_saved(&target);
    {
        use tauri::Manager;
        let _ = app.asset_protocol_scope().allow_file(&target);
    }
    Ok(target.to_string_lossy().to_string())
}

/// Configurações livres (JSON) guardadas em app_metadata, ex.: modelos de relatório.
#[tauri::command(async)]
pub fn get_setting(state: tauri::State<'_, AppState>, key: String) -> Result<Option<Value>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_metadata WHERE key = ?1",
            rusqlite::params![format!("settings.{}", key)],
            |r| r.get(0),
        )
        .ok();
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}

#[tauri::command(async)]
pub fn set_setting(state: tauri::State<'_, AppState>, key: String, value: Value) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![format!("settings.{}", key), value.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ==========================================
// VINCULAR COMPROVANTES / DUPLICATAS
// ==========================================

use crate::files::linker;

#[tauri::command]
pub async fn suggest_file_links(state: tauri::State<'_, AppState>) -> Result<Vec<linker::LinkSuggestion>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    linker::suggest_links(&conn, &state.root_dir)
}

#[tauri::command(async)]
pub fn apply_file_links(state: tauri::State<'_, AppState>, links: Vec<linker::LinkApply>) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    linker::apply_links(&conn, &state.root_dir, &links)
}

#[tauri::command(async)]
pub fn find_duplicate_records(state: tauri::State<'_, AppState>) -> Result<Vec<linker::DupPair>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    linker::find_duplicates(&conn)
}

#[tauri::command(async)]
pub fn get_app_stats(
    state: tauri::State<'_, AppState>,
) -> Result<AppStatsDto, String> {
    get_app_stats_impl(&state.db, &state.root_dir)
}

// ==========================================
// PASTA DE DADOS
// ==========================================

use crate::config;

#[tauri::command(async)]
pub fn get_data_dir_info(state: tauri::State<'_, AppState>) -> Result<config::DataDirInfo, String> {
    let root = crate::strip_verbatim(&state.root_dir);
    let db = root.join("lattes.db");
    let cfg = config::load();
    let from_config = cfg
        .data_dir
        .map(|d| crate::strip_verbatim(&std::fs::canonicalize(&d).unwrap_or_else(|_| PathBuf::from(&d))) == root)
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
pub fn set_data_dir(app: tauri::AppHandle, state: tauri::State<'_, AppState>, path: String, copy_db: bool) -> Result<(), String> {
    let target = PathBuf::from(path.trim());
    std::fs::create_dir_all(&target).map_err(|e| format!("Não foi possível usar a pasta '{}': {}", target.display(), e))?;
    let target_db = target.join("lattes.db");
    if copy_db {
        if target_db.exists() {
            return Err("A pasta escolhida já tem um lattes.db — escolha 'usar o banco que já está lá'.".into());
        }
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        // cópia consistente do banco (inclui o conteúdo do WAL)
        conn.execute("VACUUM INTO ?1", rusqlite::params![target_db.to_string_lossy().to_string()])
            .map_err(|e| format!("Falha ao copiar o banco: {}", e))?;
    }
    config::save(&config::AppConfig { data_dir: Some(target.to_string_lossy().to_string()) })?;
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
// METADADOS DE PDF (cadastro rápido)
// ==========================================

/// Lê um PDF (caminho absoluto escolhido pelo usuário) e devolve DOI, título, revista,
/// ano, autores + sugestões de tipo/Qualis e aviso de duplicata.
#[tauri::command]
pub async fn extract_pdf_metadata(
    state: tauri::State<'_, AppState>,
    path: String,
    online: Option<bool>,
) -> Result<crate::metadata::PdfMetadata, String> {
    let p = PathBuf::from(path.trim());
    if !p.is_file() {
        return Err(format!("Arquivo não encontrado: {}", p.display()));
    }
    let tipo_options: Vec<String> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut st = conn
            .prepare("SELECT description FROM subfolder_mappings WHERE category_group = 'Produções'")
            .map_err(|e| e.to_string())?;
        let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };
    let online = online.unwrap_or(true);
    // leitura do PDF + Crossref fora da thread principal e sem travar o banco
    let mut md = tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&p).map_err(|e| format!("Falha ao ler '{}': {}", p.display(), e))?;
        crate::metadata::extract_remote(&bytes, &tipo_options, online)
    })
    .await
    .map_err(|e| e.to_string())??;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::metadata::enrich_from_db(&conn, &mut md);
    Ok(md)
}

/// DOI declarado dentro do comprovante PDF de um registro (sem rede).
/// `None` quando o registro não tem PDF anexado ou o arquivo não traz DOI.
#[tauri::command]
pub async fn extract_record_doi(app: tauri::AppHandle, category: String, id: i64) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<AppState>();
        let rel = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            queries::get_record_by_id(&conn, &category, id)
                .map_err(|e| format!("Registro não encontrado: {}", e))?
                .path
        };
        let Some(rel) = rel.filter(|p| p.trim().to_lowercase().ends_with(".pdf")) else {
            return Ok(None);
        };
        let full = resolve_inside_root(&state.root_dir, &rel)?;
        let bytes = std::fs::read(&full).map_err(|e| format!("Falha ao ler '{}': {}", full.display(), e))?;
        Ok(crate::tools::doi_in_pdf(&bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Abre https://doi.org/<doi> no navegador padrão (só aceita DOIs).
#[tauri::command]
pub fn open_doi(doi: String) -> Result<(), String> {
    let d = doi.trim().trim_start_matches("https://doi.org/").trim_start_matches("doi:").trim();
    if !d.starts_with("10.") || d.contains(char::is_whitespace) {
        return Err("DOI inválido".into());
    }
    opener::open(format!("https://doi.org/{}", d)).map_err(|e| e.to_string())
}

// ==========================================
// RESOLVER DOI (metadados + PDF em acesso aberto)
// ==========================================

fn producao_tipos(state: &AppState) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut st = conn
        .prepare("SELECT description FROM subfolder_mappings WHERE category_group = 'Produções'")
        .map_err(|e| e.to_string())?;
    let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    let v = rows.flatten().collect();
    Ok(v)
}

/// DOI → metadados (Crossref/OpenAlex) + PDF de acesso aberto baixado numa pasta temporária.
#[tauri::command]
pub async fn resolve_doi(
    state: tauri::State<'_, AppState>,
    doi: String,
    download: Option<bool>,
) -> Result<crate::doi::DoiResult, String> {
    let tipos = producao_tipos(&state)?;
    let download = download.unwrap_or(true);
    let mut res = tauri::async_runtime::spawn_blocking(move || crate::doi::resolve(&doi, &tipos, download))
        .await
        .map_err(|e| e.to_string())??;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::metadata::enrich_from_db(&conn, &mut res.meta);
    Ok(res)
}

/// Procura o DOI de uma produção pelo título (Crossref, título ≥85% igual).
#[tauri::command]
pub async fn find_doi_by_title(titulo: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || crate::doi::find_doi_by_title(&titulo))
        .await
        .map_err(|e| e.to_string())?
}

/// Abre um endereço http(s) no navegador padrão (ex.: PDF que a editora não deixa baixar).
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let u = url.trim();
    if !(u.starts_with("https://") || u.starts_with("http://")) || u.contains(char::is_whitespace) {
        return Err("Endereço inválido".into());
    }
    opener::open(u).map_err(|e| e.to_string())
}

// ==========================================
// CATEGORIAS PERSONALIZADAS
// ==========================================

#[tauri::command(async)]
pub fn list_custom_categories(state: tauri::State<'_, AppState>) -> Result<Vec<crate::custom::CustomCategory>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::custom::list_categories(&conn).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn save_custom_category(state: tauri::State<'_, AppState>, category: crate::custom::CustomCategory) -> Result<crate::custom::CustomCategory, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::custom::save_category(&conn, &state.root_dir, category)
}

#[tauri::command(async)]
pub fn delete_custom_category(state: tauri::State<'_, AppState>, key: String, force: Option<bool>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::custom::delete_category(&conn, &key, force.unwrap_or(false))
}

#[tauri::command(async)]
pub fn reorder_custom_categories(state: tauri::State<'_, AppState>, keys: Vec<String>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::custom::reorder(&conn, &keys).map_err(|e| e.to_string())
}

// ==========================================
// FERRAMENTAS
// ==========================================

#[tauri::command(async)]
pub fn preview_file_renames(state: tauri::State<'_, AppState>) -> Result<Vec<crate::tools::RenameItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::tools::preview_renames(&conn, &state.root_dir)
}

#[tauri::command(async)]
pub fn apply_file_renames(state: tauri::State<'_, AppState>, items: Vec<crate::tools::RenameItem>) -> Result<crate::tools::ApplyResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(crate::tools::apply_renames(&conn, &state.root_dir, &items))
}

#[tauri::command(async)]
pub fn check_files(state: tauri::State<'_, AppState>) -> Result<crate::tools::FileCheck, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::tools::check_files(&conn, &state.root_dir)
}

#[tauri::command(async)]
pub fn clear_missing_links(state: tauri::State<'_, AppState>, items: Vec<crate::tools::MissingFile>) -> Result<crate::tools::ApplyResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(crate::tools::clear_missing(&conn, &state.root_dir, &items))
}

#[tauri::command(async)]
pub fn backup_database(state: tauri::State<'_, AppState>) -> Result<crate::tools::BackupInfo, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::tools::backup(&conn, &state.root_dir)
}

/// Grava as planilhas no destino escolhido em `select_save_path(kind = "xlsx")`.
#[tauri::command(async)]
pub fn export_xlsx(state: tauri::State<'_, AppState>, sheets: Vec<crate::tools::Sheet>) -> Result<String, String> {
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
// CLASSIFICAR DOCUMENTO (qualquer categoria)
// ==========================================

static INDEX_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Atualiza o índice de textos dos comprovantes vinculados (só o que mudou).
/// O texto é extraído sem segurar o banco; devolve quantos documentos de treino existem.
pub fn update_doc_index(state: &AppState) -> Result<usize, String> {
    let _g = INDEX_LOCK.lock().map_err(|e| e.to_string())?;
    let (docs, stale) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let docs = crate::classify::training_docs(&conn, &state.root_dir);
        let stale = crate::classify::stale_paths(&conn, &state.root_dir, &docs);
        (docs, stale)
    };
    for chunk in stale.chunks(25) {
        let rows = crate::classify::extract_for_index(&state.root_dir, chunk);
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        crate::classify::store_index(&conn, &rows);
    }
    Ok(docs.len())
}

/// Sugere categoria/tipo, campos e registros existentes para um PDF ou imagem.
/// `text`: texto já obtido por OCR na interface (imagens e PDFs digitalizados).
#[tauri::command]
pub async fn analyze_document(app: tauri::AppHandle, path: String, text: Option<String>) -> Result<crate::classify::Analysis, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<AppState>();
        let p = PathBuf::from(path.trim());
        if !p.is_file() {
            return Err(format!("Arquivo não encontrado: {}", p.display()));
        }
        let ntrain = update_doc_index(&state)?;
        let is_pdf = p.extension().map(|e| e.eq_ignore_ascii_case("pdf")).unwrap_or(false);
        let text = match text {
            Some(t) => t,
            None if is_pdf => std::panic::catch_unwind(|| crate::classify::pdf_text(&p)).unwrap_or_default(),
            None => String::new(),
        };
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let chars = text.chars().filter(|c| c.is_alphabetic()).count();
        let mut a = crate::classify::Analysis { chars, treino: ntrain, nome_arquivo: name.clone(), ..Default::default() };
        if chars < 60 {
            a.needs_ocr = true;
        }
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let docs = crate::classify::training_docs(&conn, &state.root_dir);
        let (model, knn) = crate::classify::build_all(&conn, &docs);
        let valid: std::collections::HashSet<String> = crate::tools::all_categories(&conn).into_iter().collect();
        a.sugestoes = crate::classify::suggest(&model, &knn, &text, &name, &valid, None);
        a.sugestoes.truncate(5);
        a.campos = crate::classify::extract_fields(&text);
        let top: Vec<String> = a.sugestoes.iter().take(2).map(|s| s.category.clone()).collect();
        a.registros = crate::classify::match_records(&conn, &text, &top);
        Ok(a)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// JPEG da 1ª página de um PDF digitalizado, para o OCR feito na interface.
#[tauri::command]
pub async fn pdf_scan_image(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::classify::scan_image(Path::new(path.trim()))
            .map(tauri::ipc::Response::new)
            .ok_or_else(|| "O PDF não tem imagem digitalizada legível (JPEG) na 1ª página".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lê um arquivo escolhido pelo usuário (fora da pasta de dados) — só imagens, para OCR.
#[tauri::command]
pub async fn read_image_file(path: String) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(path.trim());
    let ok = p.extension().map(|e| ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "gif"].contains(&e.to_string_lossy().to_lowercase().as_str())).unwrap_or(false);
    if !ok {
        return Err("Apenas imagens".into());
    }
    std::fs::read(&p).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/// Rotação da 1ª página de um PDF (para endireitar a digitalização antes do OCR).
#[tauri::command]
pub async fn pdf_rotation(path: String) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || crate::classify::page_rotation(Path::new(path.trim()))).await.map_err(|e| e.to_string())
}

// ==========================================
// IMPORTAÇÃO EM LOTE
// ==========================================

#[derive(Debug, Clone, serde::Serialize)]
pub struct BatchFile {
    pub path: String,
    pub name: String,
    pub size: u64,
}

const BATCH_EXTS: &[&str] = &["pdf", "png", "jpg", "jpeg"];

fn batch_file(p: &Path) -> Option<BatchFile> {
    let ext = p.extension()?.to_string_lossy().to_lowercase();
    if !BATCH_EXTS.contains(&ext.as_str()) {
        return None;
    }
    let md = std::fs::metadata(p).ok()?;
    if !md.is_file() {
        return None;
    }
    Some(BatchFile {
        path: crate::strip_verbatim(p).to_string_lossy().to_string(),
        name: p.file_name()?.to_string_lossy().to_string(),
        size: md.len(),
    })
}

/// Seleção de vários comprovantes de uma vez (PDF e imagens).
#[tauri::command]
pub fn pick_files() -> Result<Vec<BatchFile>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("Selecionar comprovantes para importar")
        .add_filter("PDF e imagens", BATCH_EXTS)
        .pick_files()
        .unwrap_or_default();
    Ok(picked.iter().filter_map(|p| batch_file(p)).collect())
}

/// Arquivos importáveis de uma pasta (PDF e imagens), opcionalmente com as subpastas.
#[tauri::command(async)]
pub fn list_folder_files(path: String, recursive: bool) -> Result<Vec<BatchFile>, String> {
    let dir = PathBuf::from(path.trim());
    if !dir.is_dir() {
        return Err(format!("Pasta não encontrada: {}", dir.display()));
    }
    let mut out = Vec::new();
    let mut stack = vec![dir];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                if recursive && out.len() < 5000 {
                    stack.push(p);
                }
            } else if let Some(f) = batch_file(&p) {
                out.push(f);
            }
        }
    }
    out.sort_by_key(|a| a.path.to_lowercase());
    Ok(out)
}

// ==========================================
// BACKUP COMPLETO E RESTAURAÇÃO
// ==========================================

#[tauri::command(async)]
pub fn backup_estimate(state: tauri::State<'_, AppState>) -> Result<crate::backup::Estimate, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(crate::backup::estimate(&conn, &state.root_dir))
}

#[tauri::command]
pub fn pick_backup_target(state: tauri::State<'_, AppState>, include_files: bool) -> Result<Option<String>, String> {
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H%M");
    let name = if include_files {
        format!("LattesManager_backup_completo_{}.zip", stamp)
    } else {
        format!("LattesManager_backup_{}.zip", stamp)
    };
    let dir = crate::strip_verbatim(&state.root_dir).join("backups");
    let _ = std::fs::create_dir_all(&dir);
    Ok(rfd::FileDialog::new()
        .set_title("Salvar backup do Lattes Manager")
        .set_directory(&dir)
        .set_file_name(&name)
        .add_filter("Backup do Lattes Manager (*.zip)", &["zip"])
        .save_file()
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn create_backup(app: tauri::AppHandle, path: String, include_files: bool) -> Result<crate::backup::BackupResult, String> {
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
        let res = crate::backup::write_zip(&snap, &state.root_dir, &folders, include_files, env!("CARGO_PKG_VERSION"), &dest, |done, total, name| {
            let _ = app.emit("backup-progress", serde_json::json!({ "done": done, "total": total, "name": name }));
        });
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
        .set_title("Escolher backup para restaurar")
        .add_filter("Backup do Lattes Manager (*.zip, *.db)", &["zip", "db"]);
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
            let safety = dir.join(format!("lattes_antes_restauracao_{}.db", chrono::Local::now().format("%Y-%m-%d_%H%M%S")));
            crate::backup::snapshot_db(&conn, &safety)?;
            rep.safety_copy = Some(safety.to_string_lossy().to_string());
            let r = crate::backup::swap_db(&mut conn, &state.root_dir, &new_db);
            let _ = std::fs::remove_file(&new_db);
            r?;
            rep.db_restored = true;
        }
        if restore_files {
            crate::backup::restore_files(&src, &state.root_dir, overwrite, &mut rep, |done, total, name| {
                let _ = app.emit("backup-progress", serde_json::json!({ "done": done, "total": total, "name": name }));
            })?;
        }
        Ok(rep)
    })
    .await
    .map_err(|e| e.to_string())?
}
