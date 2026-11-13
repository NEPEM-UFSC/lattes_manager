//! Backup completo (.zip) e restauração.
//!
//! Estrutura do arquivo:
//!   manifest.json   — versão do app, data, se inclui comprovantes, contagens
//!   lattes.db       — cópia consistente do banco (VACUUM INTO, funciona com o app aberto)
//!   <pastas>/…      — opcional: as pastas de comprovantes (1_dados_gerais, 5_producoes…)
//!
//! A restauração aceita esse .zip ou um `lattes.db` avulso (backups antigos da pasta `backups`).
//! Antes de substituir o banco, uma cópia de segurança do banco atual é criada em `backups/`.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

pub const MANIFEST: &str = "manifest.json";
pub const DB_ENTRY: &str = "lattes.db";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Manifest {
    pub app: String,
    pub version: String,
    pub created: String,
    pub include_files: bool,
    pub files: usize,
    pub files_bytes: u64,
    #[serde(default)]
    pub folders: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Estimate {
    pub files: usize,
    pub bytes: u64,
    pub db_bytes: u64,
    pub folders: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct BackupResult {
    pub path: String,
    pub bytes: u64,
    pub files: usize,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct BackupInspection {
    pub path: String,
    /// "zip" | "db"
    pub kind: String,
    pub bytes: u64,
    pub manifest: Option<Manifest>,
    pub has_db: bool,
    /// arquivos de comprovantes contidos no backup
    pub files: usize,
    pub records: usize,
    pub counts: Vec<(String, usize)>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct RestoreReport {
    pub db_restored: bool,
    pub files_written: usize,
    pub files_skipped: usize,
    pub safety_copy: Option<String>,
    pub errors: Vec<String>,
}

/// Pastas de comprovantes: subpastas "N_nome" + primeiras pastas citadas nos mapeamentos.
pub fn data_folders(conn: Option<&Connection>, root: &Path) -> Vec<String> {
    let mut set: BTreeSet<String> = crate::config::category_folders(root).into_iter().collect();
    if let Some(conn) = conn {
        if let Ok(mut st) = conn.prepare("SELECT folder FROM subfolder_mappings") {
            if let Ok(rows) = st.query_map([], |r| r.get::<_, String>(0)) {
                for f in rows.flatten() {
                    if let Some(first) = f.split(['\\', '/']).find(|s| !s.trim().is_empty()) {
                        if root.join(first).is_dir() {
                            set.insert(first.to_string());
                        }
                    }
                }
            }
        }
    }
    let mut v: Vec<String> = set.into_iter().filter(|f| !f.eq_ignore_ascii_case("backups")).collect();
    v.sort_by_key(|n| (n.split('_').next().and_then(|x| x.parse::<u32>().ok()).unwrap_or(999), n.clone()));
    v
}

/// Todos os arquivos (relativos à raiz, com "/") dentro das pastas de comprovantes.
fn walk_files(root: &Path, folders: &[String]) -> Vec<(String, PathBuf, u64)> {
    let mut out = Vec::new();
    let mut stack: Vec<PathBuf> = folders.iter().map(|f| root.join(f)).collect();
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let Ok(md) = e.metadata() else { continue };
            if md.is_dir() {
                stack.push(p);
            } else if md.is_file() {
                let name = e.file_name().to_string_lossy().to_string();
                // lixo do sistema
                if name.eq_ignore_ascii_case("thumbs.db") || name.eq_ignore_ascii_case("desktop.ini") || name == ".DS_Store" || name.starts_with("~$") {
                    continue;
                }
                if let Ok(rel) = p.strip_prefix(root) {
                    let rel = rel.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/");
                    out.push((rel, p.clone(), md.len()));
                }
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

pub fn estimate(conn: &Connection, root: &Path) -> Estimate {
    let folders = data_folders(Some(conn), root);
    let files = walk_files(root, &folders);
    Estimate {
        files: files.len(),
        bytes: files.iter().map(|f| f.2).sum(),
        db_bytes: std::fs::metadata(root.join("lattes.db")).map(|m| m.len()).unwrap_or(0)
            + std::fs::metadata(root.join("lattes.db-wal")).map(|m| m.len()).unwrap_or(0),
        folders,
    }
}

fn temp_path(tag: &str, ext: &str) -> PathBuf {
    std::env::temp_dir().join(format!("lattes_{}_{}_{}.{}", tag, std::process::id(), chrono::Local::now().format("%H%M%S%f"), ext))
}

/// Cópia consistente do banco em `target` (sem as páginas livres).
pub fn snapshot_db(conn: &Connection, target: &Path) -> Result<(), String> {
    if target.exists() {
        let _ = std::fs::remove_file(target);
    }
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().to_string()]).map_err(|e| format!("Falha ao copiar o banco: {}", e))?;
    Ok(())
}

/// Monta o .zip. `snapshot`: banco já copiado (feito com o banco travado, o resto não precisa dele).
pub fn write_zip(
    snapshot: &Path,
    root: &Path,
    folders: &[String],
    include_files: bool,
    version: &str,
    dest: &Path,
    mut progress: impl FnMut(usize, usize, &str),
) -> Result<BackupResult, String> {
    use zip::write::SimpleFileOptions;
    use zip::CompressionMethod;
    let files = if include_files { walk_files(root, folders) } else { Vec::new() };
    let manifest = Manifest {
        app: "Lattes Manager".into(),
        version: version.into(),
        created: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        include_files,
        files: files.len(),
        files_bytes: files.iter().map(|f| f.2).sum(),
        folders: folders.to_vec(),
    };
    // grava num temporário ao lado e renomeia no fim: um backup interrompido não fica pela metade
    let tmp = dest.with_extension("zip.part");
    let f = std::fs::File::create(&tmp).map_err(|e| format!("Não foi possível criar '{}': {}", dest.display(), e))?;
    let mut zw = zip::ZipWriter::new(std::io::BufWriter::new(f));
    let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated).large_file(true);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored).large_file(true);
    let res = (|| -> Result<(), String> {
        zw.start_file(MANIFEST, deflate).map_err(|e| e.to_string())?;
        zw.write_all(serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?.as_bytes()).map_err(|e| e.to_string())?;
        zw.start_file(DB_ENTRY, deflate).map_err(|e| e.to_string())?;
        let mut dbf = std::fs::File::open(snapshot).map_err(|e| e.to_string())?;
        std::io::copy(&mut dbf, &mut zw).map_err(|e| e.to_string())?;
        let total = files.len();
        for (i, (rel, abs, _)) in files.iter().enumerate() {
            let ext = Path::new(rel).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            // PDFs e imagens já são comprimidos: guardar direto é bem mais rápido
            let opt = if ["pdf", "jpg", "jpeg", "png", "zip", "docx", "xlsx", "pptx", "gif", "webp", "mp4"].contains(&ext.as_str()) { stored } else { deflate };
            zw.start_file(rel.as_str(), opt).map_err(|e| e.to_string())?;
            match std::fs::File::open(abs) {
                Ok(mut src) => {
                    std::io::copy(&mut src, &mut zw).map_err(|e| format!("{}: {}", rel, e))?;
                }
                Err(e) => return Err(format!("Falha ao ler '{}': {}", rel, e)),
            }
            if i % 5 == 0 || i + 1 == total {
                progress(i + 1, total, rel);
            }
        }
        let w = zw.finish().map_err(|e| e.to_string())?;
        w.into_inner().map_err(|e| e.to_string())?.sync_all().map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(e) = res {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    if dest.exists() {
        std::fs::remove_file(dest).map_err(|e| format!("Não foi possível substituir '{}': {}", dest.display(), e))?;
    }
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    Ok(BackupResult {
        path: dest.to_string_lossy().to_string(),
        bytes: std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0),
        files: files.len(),
    })
}

fn is_zip(path: &Path) -> bool {
    let mut sig = [0u8; 4];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut sig)).is_ok() && sig == *b"PK\x03\x04"
}

fn is_sqlite(path: &Path) -> bool {
    let mut sig = [0u8; 16];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut sig)).is_ok() && &sig == b"SQLite format 3\0"
}

/// Contagem de registros por tabela de um banco de backup (só leitura).
fn count_records(db: &Path) -> Result<Vec<(String, usize)>, String> {
    let conn = Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let tables: Vec<String> = {
        let mut st = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").map_err(|e| e.to_string())?;
        let v = st.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?.flatten().collect();
        v
    };
    if !tables.iter().any(|t| t == "producoes") {
        return Err("O arquivo não parece ser um banco do Lattes Manager".into());
    }
    let mut out = Vec::new();
    for t in crate::db::schema::ENTITY_TABLES.iter().chain(["custom_records"].iter()) {
        if tables.iter().any(|x| x == t) {
            let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {}", t), [], |r| r.get(0)).unwrap_or(0);
            out.push((t.to_string(), n as usize));
        }
    }
    Ok(out)
}

/// Extrai `lattes.db` do zip para um temporário.
fn extract_db(zip_path: &Path) -> Result<PathBuf, String> {
    let f = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut za = zip::ZipArchive::new(f).map_err(|e| format!("Arquivo .zip inválido: {}", e))?;
    let mut entry = za.by_name(DB_ENTRY).map_err(|_| "O backup não contém o banco (lattes.db)".to_string())?;
    let tmp = temp_path("restore", "db");
    let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    Ok(tmp)
}

pub fn inspect(path: &Path) -> Result<BackupInspection, String> {
    if !path.is_file() {
        return Err(format!("Arquivo não encontrado: {}", path.display()));
    }
    let mut ins = BackupInspection {
        path: path.to_string_lossy().to_string(),
        bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        ..Default::default()
    };
    if is_zip(path) {
        ins.kind = "zip".into();
        let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let mut za = zip::ZipArchive::new(f).map_err(|e| format!("Arquivo .zip inválido: {}", e))?;
        if let Ok(mut m) = za.by_name(MANIFEST) {
            let mut s = String::new();
            let _ = m.read_to_string(&mut s);
            ins.manifest = serde_json::from_str(&s).ok();
        }
        ins.has_db = za.by_name(DB_ENTRY).is_ok();
        ins.files = za.file_names().filter(|n| *n != MANIFEST && *n != DB_ENTRY && !n.ends_with('/')).count();
        if ins.has_db {
            let tmp = extract_db(path)?;
            let r = count_records(&tmp);
            let _ = std::fs::remove_file(&tmp);
            ins.counts = r?;
        }
    } else if is_sqlite(path) {
        ins.kind = "db".into();
        ins.has_db = true;
        ins.counts = count_records(path)?;
    } else {
        return Err("Formato não reconhecido: escolha um backup .zip do Lattes Manager ou um arquivo lattes.db".into());
    }
    ins.records = ins.counts.iter().map(|c| c.1).sum();
    Ok(ins)
}

/// Caminho seguro dentro da raiz (sem "..", sem caminhos absolutos).
fn safe_rel(name: &str) -> Option<PathBuf> {
    let p = Path::new(name);
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Banco do backup pronto para substituir o atual (extraído do zip ou copiado do .db).
pub fn prepare_db(path: &Path) -> Result<PathBuf, String> {
    let tmp = if is_zip(path) {
        extract_db(path)?
    } else if is_sqlite(path) {
        let t = temp_path("restore", "db");
        std::fs::copy(path, &t).map_err(|e| e.to_string())?;
        t
    } else {
        return Err("Formato de backup não reconhecido".into());
    };
    if let Err(e) = count_records(&tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(tmp)
}

/// Substitui o banco aberto em `slot` pelo arquivo `new_db`. O banco atual é fechado,
/// trocado e reaberto (com as migrações de esquema). Em caso de falha, o original volta.
pub fn swap_db(slot: &mut Connection, root: &Path, new_db: &Path) -> Result<(), String> {
    let db_path = root.join("lattes.db");
    // fecha o banco atual (checkpoint do WAL) trocando por um banco em memória
    let old = std::mem::replace(slot, Connection::open_in_memory().map_err(|e| e.to_string())?);
    drop(old);
    let keep = temp_path("before_swap", "db");
    let had = db_path.exists();
    if had {
        std::fs::copy(&db_path, &keep).map_err(|e| e.to_string())?;
    }
    let result = (|| -> Result<Connection, String> {
        for ext in ["db-wal", "db-shm"] {
            let _ = std::fs::remove_file(root.join(format!("lattes.{}", ext)));
        }
        std::fs::copy(new_db, &db_path).map_err(|e| format!("Falha ao gravar o banco: {}", e))?;
        crate::db::init_db(&db_path).map_err(|e| format!("Falha ao abrir o banco restaurado: {}", e))
    })();
    match result {
        Ok(conn) => {
            *slot = conn;
            let _ = std::fs::remove_file(&keep);
            Ok(())
        }
        Err(e) => {
            if had {
                let _ = std::fs::copy(&keep, &db_path);
                let _ = std::fs::remove_file(&keep);
            }
            if let Ok(c) = crate::db::init_db(&db_path) {
                *slot = c;
            }
            Err(e)
        }
    }
}

/// Extrai os comprovantes do zip para a pasta de dados.
pub fn restore_files(zip_path: &Path, root: &Path, overwrite: bool, report: &mut RestoreReport, mut progress: impl FnMut(usize, usize, &str)) -> Result<(), String> {
    if !is_zip(zip_path) {
        return Ok(());
    }
    let f = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut za = zip::ZipArchive::new(f).map_err(|e| format!("Arquivo .zip inválido: {}", e))?;
    let total = za.len();
    for i in 0..total {
        let mut entry = match za.by_index(i) {
            Ok(e) => e,
            Err(e) => {
                report.errors.push(e.to_string());
                continue;
            }
        };
        let name = entry.name().to_string();
        if entry.is_dir() || name == MANIFEST || name == DB_ENTRY {
            continue;
        }
        let Some(rel) = safe_rel(&name) else {
            report.errors.push(format!("Ignorado (caminho inseguro): {}", name));
            continue;
        };
        let target = root.join(&rel);
        if target.exists() && !overwrite {
            report.files_skipped += 1;
        } else {
            if let Some(dir) = target.parent() {
                if let Err(e) = std::fs::create_dir_all(dir) {
                    report.errors.push(format!("{}: {}", name, e));
                    continue;
                }
            }
            match std::fs::File::create(&target).and_then(|mut out| std::io::copy(&mut entry, &mut out)) {
                Ok(_) => report.files_written += 1,
                Err(e) => report.errors.push(format!("{}: {}", name, e)),
            }
        }
        if i % 5 == 0 || i + 1 == total {
            progress(i + 1, total, &name);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_roundtrip_with_files() {
        let base = std::env::temp_dir().join(format!("lattes_bk_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("dados");
        std::fs::create_dir_all(root.join("5_producoes/artigos")).unwrap();
        std::fs::write(root.join("5_producoes/artigos/001_a.pdf"), b"%PDF-1.4 teste").unwrap();
        std::fs::create_dir_all(root.join("backups")).unwrap();
        std::fs::write(root.join("backups/x.db"), b"nao entra").unwrap();
        let conn = crate::db::init_db(root.join("lattes.db")).unwrap();
        conn.execute("INSERT INTO producoes (ano, tipo, titulo) VALUES (2023, 'Artigos completos', 'Teste')", []).unwrap();

        let est = estimate(&conn, &root);
        assert_eq!(est.files, 1);
        let snap = base.join("snap.db");
        snapshot_db(&conn, &snap).unwrap();
        let dest = base.join("bk.zip");
        let r = write_zip(&snap, &root, &est.folders, true, "9.9.9", &dest, |_, _, _| {}).unwrap();
        assert_eq!(r.files, 1);

        let ins = inspect(&dest).unwrap();
        assert_eq!(ins.kind, "zip");
        assert!(ins.has_db);
        assert_eq!(ins.files, 1);
        assert_eq!(ins.counts.iter().find(|c| c.0 == "producoes").unwrap().1, 1);
        assert!(ins.manifest.unwrap().include_files);

        // restaura em outra pasta
        let root2 = base.join("restaurado");
        std::fs::create_dir_all(&root2).unwrap();
        let mut slot = crate::db::init_db(root2.join("lattes.db")).unwrap();
        let tmp = prepare_db(&dest).unwrap();
        swap_db(&mut slot, &root2, &tmp).unwrap();
        let n: i64 = slot.query_row("SELECT COUNT(*) FROM producoes", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let mut rep = RestoreReport::default();
        restore_files(&dest, &root2, false, &mut rep, |_, _, _| {}).unwrap();
        assert_eq!(rep.files_written, 1);
        assert!(root2.join("5_producoes/artigos/001_a.pdf").is_file());
        let mut rep2 = RestoreReport::default();
        restore_files(&dest, &root2, false, &mut rep2, |_, _, _| {}).unwrap();
        assert_eq!(rep2.files_skipped, 1);
        drop(slot);
        drop(conn);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn rejects_unsafe_paths() {
        assert!(safe_rel("../x.pdf").is_none());
        assert!(safe_rel("/etc/passwd").is_none());
        assert_eq!(safe_rel("5_producoes/a.pdf").unwrap(), PathBuf::from("5_producoes").join("a.pdf"));
    }
}
