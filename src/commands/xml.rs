//! XML do Lattes, mapeamento de subpastas e opções de listas.

use super::*;

// ==========================================
// XML LATTES / CONFIGURAÇÕES
// ==========================================

pub(super) fn resolve_xml_path(root_dir: &Path, xml_path: Option<&str>) -> PathBuf {
    match xml_path.map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => PathBuf::from(p),
        None => {
            let a = root_dir.join("lattes_xml.xml");
            if a.exists() {
                return a;
            }
            let b = root_dir.join("lattes_xml");
            if b.exists() {
                return b;
            }
            if let Ok(entries) = std::fs::read_dir(root_dir) {
                let mut candidates = Vec::new();
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|s| s.eq_ignore_ascii_case("xml"))
                        .unwrap_or(false)
                    {
                        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                        if stem.len() == 16 && stem.chars().all(|c| c.is_ascii_digit()) {
                            return path;
                        }
                        candidates.push(path);
                    }
                }
                if let Some(first) = candidates.into_iter().next() {
                    return first;
                }
            }
            a
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
        return Err(format!(
            "Arquivo XML não encontrado em '{}'",
            path.display()
        ));
    }
    let conn = db
        .lock()
        .map_err(|e| format!("Database lock failed: {}", e))?;
    lattes_xml::preview(&conn, &path)
}

pub fn import_lattes_xml_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    items: &[XmlProduction],
) -> Result<usize, String> {
    let mut conn = db
        .lock()
        .map_err(|e| format!("Database lock failed: {}", e))?;
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
    let clean = crate::files::to_db_rel(folder.trim())
        .trim_start_matches('\\')
        .to_string();
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
    conn.execute(
        "DELETE FROM subfolder_mappings WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| format!("Falha ao excluir opção: {}", e))?;
    Ok(())
}

/// Opções de listas simples (ex.: qualis) guardadas em app_metadata como JSON.
#[tauri::command(async)]
pub fn get_dropdown_options(
    state: tauri::State<'_, AppState>,
    field: String,
) -> Result<Option<Vec<String>>, String> {
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
pub fn get_all_records(
    state: tauri::State<'_, AppState>,
) -> Result<std::collections::HashMap<String, Vec<RecordDto>>, String> {
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

/// Completa os autores das produções já cadastradas a partir do XML do Lattes
/// (o da pasta do currículo, se `xml_path` vier vazio).
#[tauri::command(async)]
pub fn sync_autores_xml(
    state: tauri::State<'_, AppState>,
    xml_path: Option<String>,
) -> Result<crate::discentes::AuthorSync, String> {
    let path = resolve_xml_path(&state.root_dir, xml_path.as_deref());
    if !path.is_file() {
        return Err(
            "Não encontrei o XML do Lattes na pasta do currículo. Escolha o arquivo.".into(),
        );
    }
    let items = lattes_xml::parse_lattes_xml(&path)?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::discentes::sync_authors(&conn, &items)
}

/// Bibliometria: lê os autores do XML do Lattes, grava nas produções e reconstrói as tabelas
/// de autores e autoria.
#[tauri::command(async)]
pub fn biblio_import(
    state: tauri::State<'_, AppState>,
    xml_path: Option<String>,
) -> Result<crate::discentes::AuthorSync, String> {
    let r = sync_autores_xml(state.clone(), xml_path)?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::bibliometria::rebuild(&conn)?;
    Ok(r)
}

/// Dados da bibliometria (autores identificados e autoria de cada produção), reconstruídos a
/// partir das produções do banco.
#[tauri::command(async)]
pub fn biblio_data(
    state: tauri::State<'_, AppState>,
) -> Result<crate::bibliometria::BiblioData, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::bibliometria::rebuild(&conn)
}

/// Marca os autores `chaves` como a mesma pessoa que `destino`.
#[tauri::command(async)]
pub fn biblio_merge(
    state: tauri::State<'_, AppState>,
    chaves: Vec<String>,
    destino: String,
) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::bibliometria::merge(&conn, &chaves, &destino)
}

/// Desfaz uma mescla manual de autores.
#[tauri::command(async)]
pub fn biblio_unmerge(state: tauri::State<'_, AppState>, chave: String) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::bibliometria::unmerge(&conn, &chave)
}

#[tauri::command(async)]
pub fn discentes_report(
    state: tauri::State<'_, AppState>,
) -> Result<crate::discentes::DiscentesReport, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::discentes::report(&conn)
}
