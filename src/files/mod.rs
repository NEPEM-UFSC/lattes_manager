pub mod linker;
pub mod naming;
pub mod shell;
pub mod storage;

pub use naming::{calculate_next_filename, sanitize_windows_filename, strip_existing_prefix};
pub use shell::{open_folder, open_path, resolve_relative_path, reveal_in_explorer};
pub use storage::{
    compute_relative_path, save_attached_file, save_attached_file_as, RelativeAttachment,
};

/// Junta um caminho relativo salvo no banco (sempre com `\`) à pasta raiz, em qualquer sistema:
/// no Linux/macOS a barra invertida viraria parte do nome do arquivo.
/// Descarta `..` e prefixos de unidade (`C:`) para que o resultado nunca saia de `root`.
pub fn rel_join(root: &std::path::Path, rel: &str) -> std::path::PathBuf {
    let mut p = root.to_path_buf();
    for part in rel
        .split(['\\', '/'])
        .filter(|s| !s.is_empty() && *s != "." && *s != ".." && !s.contains(':'))
    {
        p.push(part);
    }
    p
}
