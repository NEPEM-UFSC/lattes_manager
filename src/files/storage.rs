use std::fs;
use std::path::Path;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};

use super::naming;

static STORAGE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelativeAttachment {
    pub filename: String,
    pub relative_path: String,
    pub file_size: u64,
    pub created_at: String,
}

/// Helper function to compute a portable relative path with backslashes relative to `root_dir`.
pub fn compute_relative_path(path: &Path, root_dir: &Path) -> String {
    // 1. Try direct strip_prefix
    if let Ok(rel) = path.strip_prefix(root_dir) {
        return rel
            .to_string_lossy()
            .replace('/', "\\")
            .trim_start_matches('\\')
            .to_string();
    }

    // 2. Try canonicalized versions
    if let (Ok(c_path), Ok(c_root)) = (path.canonicalize(), root_dir.canonicalize()) {
        if let Ok(rel) = c_path.strip_prefix(&c_root) {
            return rel
                .to_string_lossy()
                .replace('/', "\\")
                .trim_start_matches('\\')
                .to_string();
        }
    }

    // 3. Fallback: normalize slashes and relativize via migration path normalizer
    let path_str = path.to_string_lossy().to_string();
    crate::migration::calamine_importer::relativize_path(Some(&path_str))
        .unwrap_or_else(|| path_str.replace('/', "\\").trim_start_matches('\\').to_string())
}

/// Ingests a file proof into the managed directory structure:
/// - Verifies `source_path` exists.
/// - Computes next sequential filename in `target_subfolder`.
/// - Copies `source_path` to `target_subfolder.join(&next_filename)`.
/// - Computes portable relative path with backslashes relative to `root_dir` (e.g. `11_bancas\graduação\082_doc.pdf`).
/// - Returns populated `RelativeAttachment`.
pub fn save_attached_file(
    source_path: &Path,
    target_subfolder: &Path,
    root_dir: &Path,
) -> Result<RelativeAttachment, String> {
    save_attached_file_as(source_path, target_subfolder, root_dir, None)
}

/// Igual a `save_attached_file`, mas grava como `NNN_<base_name>.<ext>` quando `base_name` é dado
/// (nome derivado do título do registro, só ASCII e `_`).
pub fn save_attached_file_as(
    source_path: &Path,
    target_subfolder: &Path,
    root_dir: &Path,
    base_name: Option<&str>,
) -> Result<RelativeAttachment, String> {
    if !source_path.exists() {
        return Err(format!("Source path '{}' does not exist", source_path.display()));
    }

    let _lock = STORAGE_LOCK
        .lock()
        .map_err(|e| format!("Storage lock error: {}", e))?;

    let src_name = source_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "arquivo".to_string());
    let orig_name = match base_name.filter(|b| !b.trim().is_empty()) {
        Some(b) => {
            let ext = source_path.extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase())).unwrap_or_default();
            format!("{}{}", b.trim(), ext)
        }
        None => src_name,
    };

    let mut next_filename = naming::calculate_next_filename(target_subfolder, &orig_name)?;
    let mut dest_path = target_subfolder.join(&next_filename);

    // Collision & overwrite resistance:
    // If dest_path already exists, loop until a unique non-colliding sequential filename is found.
    let mut attempts = 0;
    while dest_path.exists() {
        attempts += 1;
        if attempts > 1000 {
            return Err(format!(
                "Unable to find unique filename in '{}' after {} attempts",
                target_subfolder.display(),
                attempts
            ));
        }

        // Re-calculate next filename based on updated folder state
        let candidate = naming::calculate_next_filename(target_subfolder, &orig_name)?;
        if candidate != next_filename && !target_subfolder.join(&candidate).exists() {
            next_filename = candidate;
            dest_path = target_subfolder.join(&next_filename);
            break;
        }

        // If candidate still matches or exists, increment the numeric prefix explicitly
        let clean_base = naming::strip_existing_prefix(&orig_name);
        let sanitized = naming::sanitize_windows_filename(&clean_base);
        let cur_num = next_filename
            .split('_')
            .next()
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        next_filename = format!("{:03}_{}", cur_num + 1, sanitized);
        dest_path = target_subfolder.join(&next_filename);
    }

    fs::copy(source_path, &dest_path).map_err(|e| {
        format!(
            "Failed to copy file from '{}' to '{}': {}",
            source_path.display(),
            dest_path.display(),
            e
        )
    })?;

    let file_size = fs::metadata(&dest_path).map(|m| m.len()).unwrap_or(0);
    let created_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let relative_path = compute_relative_path(&dest_path, root_dir);

    Ok(RelativeAttachment {
        filename: next_filename,
        relative_path,
        file_size,
        created_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn test_save_attached_file() {
        let base_dir = std::env::temp_dir().join("lattes_test_storage");
        let _ = fs::remove_dir_all(&base_dir);
        fs::create_dir_all(&base_dir).unwrap();

        let source_file = base_dir.join("meu_artigo.pdf");
        {
            let mut f = File::create(&source_file).unwrap();
            f.write_all(b"%PDF-1.4 test document").unwrap();
        }

        let target_subfolder = base_dir.join("5_producoes").join("artigos");
        let attachment = save_attached_file(&source_file, &target_subfolder, &base_dir).unwrap();

        assert_eq!(attachment.filename, "001_meu_artigo.pdf");
        assert_eq!(attachment.file_size, 22);
        assert_eq!(
            attachment.relative_path,
            "5_producoes\\artigos\\001_meu_artigo.pdf"
        );
        assert!(target_subfolder.join("001_meu_artigo.pdf").exists());

        // Attach a second file with existing prefix
        let source_file_2 = base_dir.join("001_outro_artigo.pdf");
        {
            let mut f = File::create(&source_file_2).unwrap();
            f.write_all(b"second file content").unwrap();
        }

        let attachment_2 = save_attached_file(&source_file_2, &target_subfolder, &base_dir).unwrap();
        assert_eq!(attachment_2.filename, "002_outro_artigo.pdf");
        assert_eq!(
            attachment_2.relative_path,
            "5_producoes\\artigos\\002_outro_artigo.pdf"
        );

        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn test_save_non_existent_source_fails() {
        let base_dir = std::env::temp_dir().join("lattes_test_storage_non_existent");
        let target_subfolder = base_dir.join("11_bancas");
        let fake_source = base_dir.join("does_not_exist.pdf");

        let res = save_attached_file(&fake_source, &target_subfolder, &base_dir);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("does not exist"));
    }
}
