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
    for part in safe_parts(rel) {
        p.push(part);
    }
    p
}

/// Partes de um caminho relativo, aceitando `\` e `/`, sem `.`, `..` nem prefixos de unidade.
fn safe_parts(rel: &str) -> impl Iterator<Item = &str> {
    rel.split(['\\', '/'])
        .filter(|s| !s.is_empty() && *s != "." && *s != ".." && !s.contains(':'))
}

/// Converte um caminho relativo em texto para o formato do banco (separador `\`).
/// Não mexe em mais nada: espaços e barras nas pontas ficam a cargo de quem chama.
pub fn to_db_rel(rel: &str) -> String {
    rel.replace('/', "\\")
}

/// Converte um caminho do sistema, já relativo à raiz, para o formato do banco.
pub fn path_to_db_rel(rel: &std::path::Path) -> String {
    to_db_rel(&rel.to_string_lossy())
}

/// Normaliza um caminho relativo para o formato do banco, com as mesmas regras de `rel_join`:
/// separador `\`, sem barras nas pontas, sem `.`, `..` nem prefixos de unidade.
pub fn normalize_db_rel(rel: &str) -> String {
    safe_parts(rel).collect::<Vec<_>>().join("\\")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn db_rel_helpers() {
        assert_eq!(to_db_rel("a/b\\c.pdf"), "a\\b\\c.pdf");
        assert_eq!(
            path_to_db_rel(&Path::new("a").join("b").join("c.pdf")),
            "a\\b\\c.pdf"
        );
        assert_eq!(normalize_db_rel("/a//b/../c\\"), "a\\b\\c");
        assert_eq!(normalize_db_rel("C:\\x\\y"), "x\\y");
        assert_eq!(
            rel_join(Path::new("r"), "a\\b/c"),
            Path::new("r").join("a").join("b").join("c")
        );
    }
}
