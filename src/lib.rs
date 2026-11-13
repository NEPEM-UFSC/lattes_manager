pub mod backup;
pub mod commands;
pub mod config;
pub mod metadata;
pub mod doi;
pub mod custom;
pub mod classify;
pub mod tools;
pub mod db;
pub mod files;
pub mod migration;

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub root_dir: PathBuf,
    /// Destino escolhido pelo usuário no diálogo "Salvar como" do relatório.
    pub pending_save: Mutex<Option<PathBuf>>,
}

impl AppState {
    pub fn new(conn: Connection, root_dir: PathBuf) -> Self {
        Self {
            db: Mutex::new(conn),
            root_dir,
            pending_save: Mutex::new(None),
        }
    }
}

/// Remove o prefixo verbatim `\\?\` que `canonicalize` adiciona no Windows.
pub fn strip_verbatim(p: &std::path::Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p.to_path_buf(),
    }
}
