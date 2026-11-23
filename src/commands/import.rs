//! Cadastro rápido: metadados de PDF, DOI, classificação de documentos e importação em lote.

use super::*;

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
            .prepare(
                "SELECT description FROM subfolder_mappings WHERE category_group = 'Produções'",
            )
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.flatten().collect()
    };
    let online = online.unwrap_or(true);
    // leitura do PDF + Crossref fora da thread principal e sem travar o banco
    let mut md = tauri::async_runtime::spawn_blocking(move || {
        let bytes =
            std::fs::read(&p).map_err(|e| format!("Falha ao ler '{}': {}", p.display(), e))?;
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
pub async fn extract_record_doi(
    app: tauri::AppHandle,
    category: String,
    id: i64,
) -> Result<Option<String>, String> {
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
        let bytes = std::fs::read(&full)
            .map_err(|e| format!("Falha ao ler '{}': {}", full.display(), e))?;
        Ok(crate::tools::doi_in_pdf(&bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Auxiliar para abrir URL no navegador padrão com fallback robusto no Windows.
fn open_in_browser(url: &str) -> Result<(), String> {
    if let Err(e) = opener::open(url) {
        #[cfg(windows)]
        {
            let res = std::process::Command::new("cmd")
                .args(["/c", "start", "", url])
                .spawn();
            if let Err(cmd_err) = res {
                return Err(format!(
                    "Falha ao abrir no navegador: {} (fallback cmd: {})",
                    e, cmd_err
                ));
            }
        }
        #[cfg(not(windows))]
        {
            return Err(format!("Falha ao abrir no navegador: {}", e));
        }
    }
    Ok(())
}

/// Abre https://doi.org/<doi> no navegador padrão (só aceita DOIs).
#[tauri::command]
pub fn open_doi(doi: String) -> Result<(), String> {
    let clean = crate::doi::parse_doi(&doi).unwrap_or_else(|| {
        doi.trim()
            .trim_start_matches("https://doi.org/")
            .trim_start_matches("http://doi.org/")
            .trim_start_matches("https://dx.doi.org/")
            .trim_start_matches("http://dx.doi.org/")
            .trim_start_matches("doi:")
            .trim_start_matches("DOI:")
            .trim()
            .to_string()
    });
    let d = clean.trim();
    if !d.starts_with("10.") || d.contains(char::is_whitespace) {
        return Err("DOI inválido".into());
    }
    open_in_browser(&format!("https://doi.org/{}", d))
}

// ==========================================
// RESOLVER DOI (metadados + PDF em acesso aberto)
// ==========================================

fn producao_tipos(state: &AppState) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut st = conn
        .prepare("SELECT description FROM subfolder_mappings WHERE category_group = 'Produções'")
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
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
    let mut res =
        tauri::async_runtime::spawn_blocking(move || crate::doi::resolve(&doi, &tipos, download))
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
    open_in_browser(u)
}

// ==========================================

// ==========================================
// CLASSIFICAR DOCUMENTO (qualquer categoria)
// ==========================================

static INDEX_CACHE: std::sync::Mutex<
    Option<(
        std::time::Instant,
        std::sync::Arc<Vec<crate::classify::TrainDoc>>,
    )>,
> = std::sync::Mutex::new(None);

fn update_doc_index_with_docs(
    state: &AppState,
) -> Result<std::sync::Arc<Vec<crate::classify::TrainDoc>>, String> {
    let mut cache = INDEX_CACHE.lock().map_err(|e| e.to_string())?;
    if let Some((ts, ref docs_arc)) = *cache {
        if ts.elapsed() < std::time::Duration::from_secs(4) {
            return Ok(std::sync::Arc::clone(docs_arc));
        }
    }
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
    let arc = std::sync::Arc::new(docs);
    *cache = Some((std::time::Instant::now(), std::sync::Arc::clone(&arc)));
    Ok(arc)
}

/// Atualiza o índice de textos dos comprovantes vinculados (só o que mudou).
/// O texto é extraído sem segurar o banco; devolve quantos documentos de treino existem.
pub fn update_doc_index(state: &AppState) -> Result<usize, String> {
    Ok(update_doc_index_with_docs(state)?.len())
}

/// Sugere categoria/tipo, campos e registros existentes para um PDF ou imagem.
/// `text`: texto já obtido por OCR na interface (imagens e PDFs digitalizados).
#[tauri::command]
pub async fn analyze_document(
    app: tauri::AppHandle,
    path: String,
    text: Option<String>,
) -> Result<crate::classify::Analysis, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<AppState>();
        let p = PathBuf::from(path.trim());
        if !p.is_file() {
            return Err(format!("Arquivo não encontrado: {}", p.display()));
        }
        let docs = update_doc_index_with_docs(&state)?;
        let ntrain = docs.len();
        let is_pdf = p
            .extension()
            .map(|e| e.eq_ignore_ascii_case("pdf"))
            .unwrap_or(false);
        let text = match text {
            Some(t) => t,
            None if is_pdf => {
                std::panic::catch_unwind(|| crate::classify::pdf_text(&p)).unwrap_or_default()
            }
            None => String::new(),
        };
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let chars = text.chars().filter(|c| c.is_alphabetic()).count();
        let mut a = crate::classify::Analysis {
            chars,
            treino: ntrain,
            nome_arquivo: name.clone(),
            ..Default::default()
        };
        if chars < 60 {
            a.needs_ocr = true;
        }
        a.campos = crate::classify::extract_fields(&text);
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let valid: std::collections::HashSet<String> =
            crate::tools::all_categories(&conn).into_iter().collect();
        a.sugestoes = crate::classify::suggest_cached(&conn, &docs, &text, &name, &valid, None);
        a.sugestoes.truncate(5);
        // o papel descrito no documento (ouvinte, apresentação, banca de mestrado...) escolhe o tipo
        if let Some((papel, _)) = crate::classify::detect_papel(&text) {
            for s in a.sugestoes.iter_mut() {
                let tipos = category_tipos(&conn, &s.category);
                if let Some(t) = crate::classify::refine_tipo(papel, &tipos) {
                    s.tipo = t;
                }
            }
        }
        let top: Vec<String> = a
            .sugestoes
            .iter()
            .take(3)
            .map(|s| s.category.clone())
            .collect();
        a.registros = crate::classify::match_records(&conn, &text, &top);
        if chars >= 60 {
            if let Some((nome, cit)) = researcher_name(&conn, &state.root_dir) {
                a.cita_usuario = Some(crate::classify::mentions_person(&text, &nome, &cit));
            }
        }
        Ok(a)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Tipos usados numa categoria: os dos registros e os das subpastas mapeadas.
fn category_tipos(conn: &Connection, cat: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Some(table) = crate::db::schema::normalize_category(cat) {
        if let Ok(mut st) = conn.prepare(&format!(
            "SELECT DISTINCT tipo FROM {} WHERE tipo IS NOT NULL AND TRIM(tipo) <> ''",
            table
        )) {
            if let Ok(rows) = st.query_map([], |r| r.get::<_, String>(0)) {
                out.extend(rows.flatten());
            }
        }
    }
    let group = crate::migration::lattes_xml::category_group(cat);
    if let Ok(mut st) =
        conn.prepare("SELECT description FROM subfolder_mappings WHERE category_group = ?1")
    {
        if let Ok(rows) = st.query_map([group], |r| r.get::<_, String>(0)) {
            out.extend(rows.flatten());
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Nome e nome para citação do pesquisador: o que está salvo no Perfil ou, sem isso, o do XML.
fn researcher_name(conn: &Connection, root: &Path) -> Option<(String, String)> {
    let saved: Option<Value> = conn
        .query_row(
            "SELECT value FROM app_metadata WHERE key = 'settings.profile'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    let get = |k: &str| {
        saved
            .as_ref()
            .and_then(|v| v.pointer(&format!("/values/{}", k)))
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    if let Some(nome) = get("nome") {
        return Some((nome, get("nome_citacoes").unwrap_or_default()));
    }
    let xml = super::resolve_xml_path(root, None);
    let p = lattes_xml::parse_profile(&xml).ok()?;
    (!p.nome.trim().is_empty()).then_some((p.nome, p.nome_citacoes))
}

/// JPEG da 1ª página de um PDF digitalizado, para o OCR feito na interface.
#[tauri::command]
pub async fn pdf_scan_image(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::classify::scan_image(Path::new(path.trim()))
            .map(tauri::ipc::Response::new)
            .ok_or_else(|| {
                "O PDF não tem imagem digitalizada legível (JPEG) na 1ª página".to_string()
            })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lê um arquivo escolhido pelo usuário (fora da pasta de dados) — só imagens, para OCR.
#[tauri::command]
pub async fn read_image_file(path: String) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(path.trim());
    let ok = p
        .extension()
        .map(|e| {
            ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "gif"]
                .contains(&e.to_string_lossy().to_lowercase().as_str())
        })
        .unwrap_or(false);
    if !ok {
        return Err("Apenas imagens".into());
    }
    std::fs::read(&p)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

/// Rotação da 1ª página de um PDF (para endireitar a digitalização antes do OCR).
#[tauri::command]
pub async fn pdf_rotation(path: String) -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::classify::page_rotation(Path::new(path.trim()))
    })
    .await
    .map_err(|e| e.to_string())
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
        let Ok(rd) = std::fs::read_dir(&d) else {
            continue;
        };
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
