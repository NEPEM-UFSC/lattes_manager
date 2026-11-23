pub mod academic;
pub mod backup;
pub mod bibliometria;
pub mod citescore;
pub mod classify;
pub mod commands;
pub mod config;
pub mod custom;
pub mod db;
pub mod diff;
pub mod discentes;
pub mod doi;
pub mod files;
pub mod metadata;
pub mod migration;
pub mod pdf_compress;
pub mod pendencias;
pub mod qualis;
pub mod scholar;
pub mod tools;
pub mod vassoura;

use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub root_dir: PathBuf,
    /// Destino escolhido pelo usuário no diálogo "Salvar como" do relatório.
    pub pending_save: Mutex<Option<PathBuf>>,
    /// Arquivos que o app gravou para o usuário fora da pasta do currículo (relatório,
    /// planilha, backup). Só esses caminhos absolutos podem ser abertos ou mostrados na pasta.
    saved_files: Mutex<Vec<PathBuf>>,
}

impl AppState {
    pub fn new(conn: Connection, root_dir: PathBuf) -> Self {
        Self {
            db: Mutex::new(conn),
            root_dir,
            pending_save: Mutex::new(None),
            saved_files: Mutex::new(Vec::new()),
        }
    }

    pub fn remember_saved(&self, p: &Path) {
        let p = real_path(p);
        if let Ok(mut v) = self.saved_files.lock() {
            if v.contains(&p) {
                return;
            }
            if v.len() >= 64 {
                v.remove(0);
            }
            v.push(p);
        }
    }

    pub fn is_saved(&self, p: &Path) -> bool {
        let p = real_path(p);
        self.saved_files.lock().is_ok_and(|v| v.contains(&p))
    }
}

/// Caminho canônico (sem `\\?\`) para comparar dois caminhos do mesmo arquivo.
pub fn real_path(p: &Path) -> PathBuf {
    strip_verbatim(&std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()))
}

/// Remove o prefixo verbatim `\\?\` que `canonicalize` adiciona no Windows.
pub fn strip_verbatim(p: &std::path::Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p.to_path_buf(),
    }
}
