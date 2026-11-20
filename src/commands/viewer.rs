//! Visualizador interno e leitura de arquivos para o relatório de comprovantes.

use super::*;

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
    let root = crate::strip_verbatim(
        &std::fs::canonicalize(root_dir).unwrap_or_else(|_| root_dir.to_path_buf()),
    );
    let canon = crate::strip_verbatim(&std::fs::canonicalize(&full).map_err(|e| e.to_string())?);
    if !canon.starts_with(&root) {
        return Err("Caminho fora da pasta do currículo".into());
    }
    Ok(canon)
}

/// Caminho absoluto de um comprovante, para o visualizador interno (asset protocol).
#[tauri::command(async)]
pub fn resolve_file_path(
    state: tauri::State<'_, AppState>,
    relative_path: String,
) -> Result<String, String> {
    resolve_inside_root(&state.root_dir, &relative_path).map(|p| p.to_string_lossy().to_string())
}

/// Bytes de um comprovante (binário, sem JSON) para montar o PDF único.
#[tauri::command]
pub async fn read_file_bytes(
    state: tauri::State<'_, AppState>,
    relative_path: String,
) -> Result<tauri::ipc::Response, String> {
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
            &[
                "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                "/Library/Fonts/Arial Bold.ttf",
            ],
            &[
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            ],
        ),
        "semibold" => (
            &[
                "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                "/Library/Fonts/Arial Bold.ttf",
            ],
            &[
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            ],
        ),
        _ => (
            &[
                "/System/Library/Fonts/Supplemental/Arial.ttf",
                "/Library/Fonts/Arial.ttf",
            ],
            &[
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/TTF/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            ],
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
        return Err(format!(
            "Arquivo XML não encontrado em '{}'",
            path.display()
        ));
    }
    lattes_xml::parse_profile(&path)
}
