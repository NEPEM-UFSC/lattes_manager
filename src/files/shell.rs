use std::path::{Path, PathBuf};
#[cfg(any(windows, target_os = "macos"))]
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Monta o argumento do Explorer do Windows para selecionar um arquivo: `/select,"<caminho>"`.
/// Remove o prefixo `\\?\` quando presente.
pub fn format_reveal_arg(full_path: &Path) -> String {
    let path_str = full_path.to_string_lossy();
    let clean_path = path_str.strip_prefix(r"\\?\").unwrap_or(path_str.as_ref());
    format!(r#"/select,"{}""#, clean_path)
}

/// Abre um arquivo no aplicativo padrão do sistema (Windows, macOS ou Linux).
pub fn open_path(full_path: &Path) -> Result<(), String> {
    opener::open(full_path)
        .map_err(|e| format!("Failed to open path '{}': {}", full_path.display(), e))
}

/// Mostra o arquivo no gerenciador de arquivos: selecionado no Explorer (Windows) ou no Finder
/// (macOS); no Linux, abre a pasta que o contém.
pub fn reveal_in_explorer(full_path: &Path) -> Result<(), String> {
    if !full_path.exists() {
        return Err(format!("Path '{}' does not exist", full_path.display()));
    }

    #[cfg(any(windows, target_os = "macos"))]
    let path_str = full_path.to_string_lossy();
    #[cfg(any(windows, target_os = "macos"))]
    let clean_path = path_str.strip_prefix(r"\\?\").unwrap_or(path_str.as_ref());

    #[cfg(windows)]
    {
        // Use raw_arg to guarantee /select,"<path>" format without Rust standard library
        // auto-wrapping the entire /select argument in outer double quotes when spaces are present.
        let arg = format!(r#"/select,"{}""#, clean_path);
        Command::new("explorer.exe")
            .raw_arg(arg)
            .spawn()
            .map_err(|e| format!("Failed to reveal '{}' in explorer: {}", clean_path, e))?;
    }

    #[cfg(target_os = "macos")]
    {
        // Finder com o arquivo selecionado
        Command::new("open")
            .arg("-R")
            .arg(clean_path)
            .spawn()
            .map_err(|e| format!("Failed to reveal '{}' in Finder: {}", clean_path, e))?;
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        // Linux: abre a pasta que contém o arquivo no gerenciador padrão
        let dir = full_path.parent().unwrap_or(full_path);
        opener::open(dir)
            .map_err(|e| format!("Failed to open folder '{}': {}", dir.display(), e))?;
    }

    Ok(())
}

/// Abre uma pasta no gerenciador de arquivos do sistema.
pub fn open_folder(folder_path: &Path) -> Result<(), String> {
    opener::open(folder_path)
        .map_err(|e| format!("Failed to open folder '{}': {}", folder_path.display(), e))
}

/// Junta um caminho relativo do banco (com `\` ou `/`) a `root_dir`, em qualquer sistema.
/// Ignora barras iniciais e canonicaliza o resultado quando ele existe no disco.
pub fn resolve_relative_path(root_dir: &Path, rel_path: &str) -> PathBuf {
    let clean_rel = rel_path
        .trim()
        .trim_start_matches('\\')
        .trim_start_matches('/');
    let joined = crate::files::rel_join(root_dir, clean_rel);

    if let Ok(c) = joined.canonicalize() {
        let s = c.to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
        c
    } else {
        joined
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_relative_path() {
        let root = Path::new(r"d:\Desktop\UFSC\lattes");
        let rel = r"5_producoes\artigos_completos\001_paper.pdf";
        let resolved = resolve_relative_path(root, rel);
        assert!(resolved.ends_with(crate::files::rel_join(
            Path::new(""),
            r"5_producoes\artigos_completos\001_paper.pdf"
        )));
    }

    #[test]
    fn test_resolve_with_leading_slashes() {
        let root = Path::new(r"d:\Desktop\UFSC\lattes");
        let rel = r"\11_bancas\doutorado\005_ata.pdf";
        let resolved = resolve_relative_path(root, rel);
        assert!(resolved.ends_with(crate::files::rel_join(
            Path::new(""),
            r"11_bancas\doutorado\005_ata.pdf"
        )));
    }
}
