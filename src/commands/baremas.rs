//! Documentos anexados aos baremas (portarias, resoluções, planilhas...), guardados em
//! `baremas/<id do barema>/` dentro da pasta do currículo (fora das pastas de comprovantes).

use super::*;
use serde::Serialize;

pub const BAREMAS_DIR: &str = "baremas";
const DOC_EXTS: &[&str] = &[
    "pdf", "doc", "docx", "odt", "rtf", "xls", "xlsx", "xlsm", "ods", "csv",
];
const DOC_MAX_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct BaremaDocDto {
    pub name: String,
    pub path: String,
    pub size: u64,
}

/// Nome seguro para pasta/arquivo: sem separadores nem caracteres proibidos no Windows.
fn safe_name(s: &str) -> String {
    let t: String = s
        .trim()
        .chars()
        .map(|c| {
            if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let t = t
        .trim_matches(|c: char| c == '.' || c.is_whitespace())
        .to_string();
    if t.is_empty() {
        "documento".into()
    } else {
        t.chars().take(120).collect()
    }
}

/// Copia `src` para `baremas/<barema_id>/`, sem sobrescrever (acrescenta " (2)", " (3)"...).
pub fn add_barema_document_impl(
    root_dir: &Path,
    barema_id: &str,
    src: &Path,
) -> Result<BaremaDocDto, String> {
    let ext = src
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !DOC_EXTS.contains(&ext.as_str()) {
        return Err(format!(
            "Formato não aceito ({}): use PDF, Word ou Excel",
            if ext.is_empty() {
                "sem extensão".into()
            } else {
                ext
            }
        ));
    }
    let size = std::fs::metadata(src)
        .map_err(|e| format!("Falha ao ler '{}': {}", src.display(), e))?
        .len();
    if size > DOC_MAX_BYTES {
        return Err("Arquivo muito grande (máximo de 200 MB)".into());
    }
    let folder = safe_name(barema_id);
    let dir = root_dir.join(BAREMAS_DIR).join(&folder);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Falha ao criar a pasta '{}': {}", dir.display(), e))?;
    let stem = safe_name(
        &src.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default(),
    );
    let mut name = format!("{}.{}", stem, ext);
    let mut n = 2;
    while dir.join(&name).exists() {
        name = format!("{} ({}).{}", stem, n, ext);
        n += 1;
    }
    std::fs::copy(src, dir.join(&name))
        .map_err(|e| format!("Falha ao copiar o documento: {}", e))?;
    Ok(BaremaDocDto {
        path: format!("{}/{}/{}", BAREMAS_DIR, folder, name),
        name,
        size,
    })
}

/// Apaga um documento de barema (só dentro de `baremas/`).
pub fn remove_barema_document_impl(root_dir: &Path, rel_path: &str) -> Result<(), String> {
    let norm = rel_path.trim().replace('\\', "/");
    let first = norm.split('/').find(|s| !s.is_empty()).unwrap_or("");
    if !first.eq_ignore_ascii_case(BAREMAS_DIR) || norm.split('/').any(|s| s == "..") {
        return Err("Caminho fora da pasta de documentos dos baremas".into());
    }
    let full = resolve_inside_root(root_dir, &norm)?;
    if full.is_file() {
        std::fs::remove_file(&full).map_err(|e| format!("Falha ao apagar o documento: {}", e))?;
    }
    Ok(())
}

/// Escolhe documentos (PDF, Word, Excel) e os copia para a pasta do barema.
#[tauri::command(async)]
pub fn add_barema_documents(
    state: tauri::State<'_, AppState>,
    barema_id: String,
) -> Result<Vec<BaremaDocDto>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("Anexar documentos ao barema (portaria, resolução, planilha...)")
        .add_filter("PDF, Word e Excel", DOC_EXTS)
        .add_filter("PDF (*.pdf)", &["pdf"])
        .add_filter(
            "Word (*.doc, *.docx, *.odt, *.rtf)",
            &["doc", "docx", "odt", "rtf"],
        )
        .add_filter(
            "Excel (*.xls, *.xlsx, *.ods, *.csv)",
            &["xls", "xlsx", "xlsm", "ods", "csv"],
        )
        .pick_files()
        .unwrap_or_default();
    picked
        .iter()
        .map(|p| add_barema_document_impl(&state.root_dir, &barema_id, p))
        .collect()
}

#[tauri::command(async)]
pub fn remove_barema_document(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    remove_barema_document_impl(&state.root_dir, &path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copia_sem_sobrescrever_e_remove_so_dentro_da_pasta() {
        let root = std::env::temp_dir().join(format!("lm_baremas_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let src = root.join("Portaria 154.pdf");
        std::fs::write(&src, b"%PDF-1.4").unwrap();
        let a = add_barema_document_impl(&root, "user_x/../y", &src).unwrap();
        let b = add_barema_document_impl(&root, "user_x/../y", &src).unwrap();
        assert_eq!(a.path, "baremas/user_x_.._y/Portaria 154.pdf");
        assert_eq!(b.name, "Portaria 154 (2).pdf");
        assert!(add_barema_document_impl(&root, "x", &root.join("nada.exe")).is_err());
        assert!(remove_barema_document_impl(&root, "1_dados/arquivo.pdf").is_err());
        remove_barema_document_impl(&root, &a.path).unwrap();
        assert!(!root.join(&a.path).exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
