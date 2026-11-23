//! Foto de perfil, versão do app, gravação de relatórios e configurações.

use super::*;

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
    ["png", "jpg"]
        .iter()
        .map(|e| root_dir.join(PHOTO_DIR).join(format!("foto_perfil.{}", e)))
        .collect()
}

/// Caminho relativo da foto atual, se houver.
pub fn profile_photo_impl(root_dir: &Path) -> Option<String> {
    photo_files(root_dir)
        .into_iter()
        .find(|p| p.is_file())
        .and_then(|p| {
            p.file_name()
                .map(|n| format!("{}/{}", PHOTO_DIR, n.to_string_lossy()))
        })
}

/// Copia `src` como a foto de perfil, substituindo a anterior. Devolve o caminho relativo.
pub fn set_profile_photo_impl(root_dir: &Path, src: &Path) -> Result<String, String> {
    let size = std::fs::metadata(src)
        .map_err(|e| format!("Falha ao ler a foto: {}", e))?
        .len();
    if size > PHOTO_MAX_BYTES {
        return Err("Foto muito grande (máximo de 40 MB)".into());
    }
    let bytes = std::fs::read(src).map_err(|e| format!("Falha ao ler a foto: {}", e))?;
    let ext = photo_kind(&bytes).ok_or("A foto precisa ser um arquivo PNG ou JPG")?;
    let dir = root_dir.join(PHOTO_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Falha ao criar a pasta '{}': {}", dir.display(), e))?;
    remove_profile_photo_impl(root_dir)?;
    let target = dir.join(format!("foto_perfil.{}", ext));
    std::fs::write(&target, &bytes).map_err(|e| format!("Falha ao salvar a foto: {}", e))?;
    Ok(format!("{}/foto_perfil.{}", PHOTO_DIR, ext))
}

pub fn remove_profile_photo_impl(root_dir: &Path) -> Result<(), String> {
    for p in photo_files(root_dir).into_iter().filter(|p| p.is_file()) {
        std::fs::remove_file(&p)
            .map_err(|e| format!("Falha ao remover '{}': {}", p.display(), e))?;
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
pub fn select_save_path(
    state: tauri::State<'_, AppState>,
    suggested_name: String,
    kind: Option<String>,
) -> Result<Option<String>, String> {
    let (title, filter, ext): (&str, &str, &str) = match kind.as_deref() {
        Some("xlsx") => ("Salvar planilha do Excel", "Excel (*.xlsx)", "xlsx"),
        Some("html") => (
            "Salvar painel de indicadores",
            "Página HTML (*.html)",
            "html",
        ),
        Some("csv") => ("Salvar CSV", "CSV (*.csv)", "csv"),
        Some("bib") => ("Salvar arquivo BibTeX", "BibTeX (*.bib)", "bib"),
        Some("ris") => ("Salvar arquivo RIS", "RIS (*.ris)", "ris"),
        Some("txt") => ("Salvar referências em texto", "Texto (*.txt)", "txt"),
        Some("json") => ("Salvar barema de pontuação", "JSON (*.json)", "json"),
        Some("graphml") => (
            "Salvar rede (Gephi, Cytoscape, VOSviewer)",
            "GraphML (*.graphml)",
            "graphml",
        ),
        Some("svg") => ("Salvar imagem", "Imagem SVG (*.svg)", "svg"),
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
    std::fs::write(&target, bytes)
        .map_err(|e| format!("Falha ao salvar '{}': {}", target.display(), e))?;
    state.remember_saved(&target);
    {
        use tauri::Manager;
        let _ = app.asset_protocol_scope().allow_file(&target);
    }
    Ok(target.to_string_lossy().to_string())
}

/// Salva um PDF de pré-visualização temporário com nome legível e devolve o caminho absoluto.
#[tauri::command]
pub async fn write_preview_temp(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Conteúdo do PDF não recebido".into());
    };
    let raw_name = request
        .headers()
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("preview_comprovantes.pdf");
    let safe_name: String = raw_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let final_name = if safe_name.to_lowercase().ends_with(".pdf") {
        safe_name
    } else {
        format!("{}.pdf", safe_name)
    };
    let dir = std::env::temp_dir().join("LattesManager");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(final_name);
    std::fs::write(&target, bytes).map_err(|e| format!("Falha ao gravar preview: {}", e))?;
    state.remember_saved(&target);
    {
        use tauri::Manager;
        let _ = app.asset_protocol_scope().allow_file(&target);
    }
    Ok(target.to_string_lossy().to_string())
}

/// Comprime um PDF binário (imagens embutidas + streams/objetos) e devolve os bytes comprimidos.
#[tauri::command]
pub async fn compress_pdf(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Conteúdo do PDF não recebido".into());
    };
    let input = bytes.clone();
    let compressed = tauri::async_runtime::spawn_blocking(move || {
        crate::pdf_compress::compress_pdf_bytes(input)
    })
    .await
    .map_err(|e| format!("Falha ao comprimir PDF: {}", e))?;
    Ok(tauri::ipc::Response::new(compressed))
}

/// Configurações livres (JSON) guardadas em app_metadata, ex.: modelos de relatório.
#[tauri::command(async)]
pub fn get_setting(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<Option<Value>, String> {
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
pub fn set_setting(
    state: tauri::State<'_, AppState>,
    key: String,
    value: Value,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![format!("settings.{}", key), value.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
