//! Configuração do aplicativo fora do banco (o banco mora dentro da pasta de dados).
//! Arquivo: %APPDATA%\com.ufsc.lattes\config.json

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AppConfig {
    /// Pasta que contém `lattes.db` e as subpastas de comprovantes.
    #[serde(default)]
    pub data_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DataDirInfo {
    pub data_dir: String,
    pub db_path: String,
    pub config_file: String,
    pub from_config: bool,
    pub folders: Vec<String>,
    pub db_size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DataDirInspection {
    pub path: String,
    pub exists: bool,
    pub has_db: bool,
    pub folders: Vec<String>,
}

/// Pasta de configurações do usuário em cada sistema
/// (Windows: %APPDATA%, macOS: ~/Library/Application Support, Linux: $XDG_CONFIG_HOME ou ~/.config).
fn config_base() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .ok();
    if cfg!(windows) {
        if let Ok(a) = std::env::var("APPDATA") {
            return PathBuf::from(a);
        }
    } else if cfg!(target_os = "macos") {
        if let Some(h) = &home {
            return h.join("Library").join("Application Support");
        }
    } else if let Ok(x) = std::env::var("XDG_CONFIG_HOME") {
        return PathBuf::from(x);
    } else if let Some(h) = &home {
        return h.join(".config");
    }
    home.unwrap_or_else(std::env::temp_dir)
}

pub fn config_file() -> PathBuf {
    config_base().join("com.ufsc.lattes").join("config.json")
}

pub fn load() -> AppConfig {
    std::fs::read_to_string(config_file())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(cfg: &AppConfig) -> Result<(), String> {
    let f = config_file();
    if let Some(d) = f.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&f, json).map_err(|e| format!("Falha ao gravar '{}': {}", f.display(), e))
}

/// Subpastas de comprovantes no padrão "N_nome" (1_dados_gerais, 5_producoes…).
pub fn category_folders(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| {
                    n.split_once('_')
                        .map(|(a, _)| !a.is_empty() && a.chars().all(|c| c.is_ascii_digit()))
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort_by_key(|n| {
        n.split('_')
            .next()
            .and_then(|x| x.parse::<u32>().ok())
            .unwrap_or(999)
    });
    v
}

pub fn inspect(path: &Path) -> DataDirInspection {
    DataDirInspection {
        path: path.to_string_lossy().to_string(),
        exists: path.is_dir(),
        has_db: path.join("lattes.db").is_file(),
        folders: category_folders(path),
    }
}

/// Decide a pasta de dados na inicialização:
/// 1. pasta configurada pelo usuário; 2. pasta do executável (ou acima) com lattes.db;
/// 3. pasta histórica do projeto; 4. Documentos\Lattes Manager.
pub fn resolve_data_dir() -> (PathBuf, bool) {
    if let Some(d) = load().data_dir.map(PathBuf::from).filter(|d| d.is_dir()) {
        return (d, true);
    }
    let mut candidates: Vec<PathBuf> = vec![PathBuf::from("."), PathBuf::from("..")];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            candidates.push(d.to_path_buf());
            if let Some(p) = d.parent() {
                candidates.push(p.to_path_buf());
            }
        }
    }
    for c in candidates {
        if c.join("lattes.db").is_file() {
            return (c, false);
        }
    }
    if cfg!(windows) {
        let legacy = PathBuf::from(r"d:\Desktop\UFSC\lattes");
        if legacy.is_dir() {
            return (legacy, false);
        }
    }
    // Documentos/Lattes Manager (USERPROFILE no Windows, HOME no macOS/Linux)
    let docs = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(|u| PathBuf::from(u).join("Documents").join("Lattes Manager"))
        .unwrap_or_else(|_| PathBuf::from("Lattes Manager"));
    let _ = std::fs::create_dir_all(&docs);
    (docs, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_category_folders() {
        let tmp = std::env::temp_dir().join(format!("lattes_cfg_{}", std::process::id()));
        for d in [
            "5_producoes",
            "10_orientacoes",
            "1_dados_gerais",
            "app",
            "x_y",
        ] {
            std::fs::create_dir_all(tmp.join(d)).unwrap();
        }
        assert_eq!(
            category_folders(&tmp),
            vec!["1_dados_gerais", "5_producoes", "10_orientacoes"]
        );
        let i = inspect(&tmp);
        assert!(i.exists && !i.has_db);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn config_roundtrip_json() {
        let c = AppConfig {
            data_dir: Some(r"D:\dados".into()),
        };
        let s = serde_json::to_string(&c).unwrap();
        assert_eq!(serde_json::from_str::<AppConfig>(&s).unwrap(), c);
        assert_eq!(
            serde_json::from_str::<AppConfig>("{}").unwrap(),
            AppConfig::default()
        );
    }
}
