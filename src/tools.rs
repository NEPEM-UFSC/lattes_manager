//! Ferramentas: renomear comprovantes pelo título, verificar arquivos (ausentes/órfãos),
//! backup do banco e exportação para Excel.

use crate::db::{queries, schema};
use crate::files::{linker, naming};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// Todas as categorias (padrão + personalizadas).
pub fn all_categories(conn: &Connection) -> Vec<String> {
    let mut v: Vec<String> = schema::ENTITY_TABLES.iter().map(|s| s.to_string()).collect();
    v.extend(crate::custom::keys(conn));
    v
}

fn label_of(r: &crate::db::models::RecordDto) -> String {
    [&r.titulo, &r.descricao, &r.disciplina, &r.aluno, &r.tipo]
        .iter()
        .find_map(|x| x.as_ref().filter(|s| !s.trim().is_empty()).cloned())
        .unwrap_or_else(|| format!("Registro #{}", r.id))
}

// ---------------- Renomear comprovantes ----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameItem {
    pub category: String,
    pub id: i64,
    pub titulo: String,
    pub old_path: String,
    pub new_path: String,
}

fn split_prefix(name: &str) -> (Option<String>, String) {
    match name.split_once('_') {
        Some((a, b)) if a.len() >= 3 && a.chars().all(|c| c.is_ascii_digit()) => (Some(a.to_string()), b.to_string()),
        _ => (None, name.to_string()),
    }
}

/// Propõe `NNN_titulo_do_registro.ext` para cada comprovante cujo nome ainda não segue o padrão.
pub fn preview_renames(conn: &Connection, root: &Path) -> Result<Vec<RenameItem>, String> {
    let mut out = Vec::new();
    // nomes já ocupados por pasta (minúsculas) e maior prefixo por pasta
    let mut taken: HashMap<PathBuf, HashSet<String>> = HashMap::new();
    let mut max_prefix: HashMap<PathBuf, u32> = HashMap::new();
    for cat in all_categories(conn) {
        let recs = queries::get_records(conn, &cat, None, None, None).map_err(|e| e.to_string())?;
        for r in recs {
            let Some(rel) = r.path.clone().filter(|p| !p.trim().is_empty()) else { continue };
            let full = crate::files::rel_join(root, &rel);
            if !full.is_file() {
                continue;
            }
            let Some(dir) = full.parent().map(Path::to_path_buf) else { continue };
            let name = full.file_name().unwrap().to_string_lossy().to_string();
            let ext = full.extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase())).unwrap_or_default();
            let json = serde_json::to_value(&r).unwrap_or(Value::Null);
            let Some(base) = naming::record_base_name(&cat, &json) else { continue };
            let names = taken.entry(dir.clone()).or_insert_with(|| {
                std::fs::read_dir(&dir).map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().to_lowercase()).collect()).unwrap_or_default()
            });
            let maxp = *max_prefix.entry(dir.clone()).or_insert_with(|| {
                names.iter().filter_map(|n| split_prefix(n).0.and_then(|p| p.parse::<u32>().ok())).max().unwrap_or(0)
            });
            let (prefix, _) = split_prefix(&name);
            let prefix = match prefix {
                Some(p) => p,
                None => {
                    max_prefix.insert(dir.clone(), maxp + 1);
                    format!("{:03}", maxp + 1)
                }
            };
            let mut new_name = format!("{}_{}{}", prefix, base, ext);
            if new_name.eq_ignore_ascii_case(&name) {
                continue;
            }
            let mut n = 2;
            while names.contains(&new_name.to_lowercase()) {
                new_name = format!("{}_{}_{}{}", prefix, base, n, ext);
                n += 1;
            }
            names.remove(&name.to_lowercase());
            names.insert(new_name.to_lowercase());
            let new_full = dir.join(&new_name);
            out.push(RenameItem {
                category: cat.clone(),
                id: r.id,
                titulo: label_of(&r),
                old_path: rel.clone(),
                new_path: crate::files::compute_relative_path(&new_full, root),
            });
        }
    }
    Ok(out)
}

fn table_for(cat: &str) -> Option<(String, bool)> {
    if crate::custom::is_custom(cat) {
        Some(("custom_records".into(), true))
    } else {
        schema::normalize_category(cat).map(|t| (t.to_string(), false))
    }
}

/// Atualiza file/path (e o identificador quando ele era o nome do arquivo) sem mexer na data.
fn set_file(conn: &Connection, cat: &str, id: i64, old_file: Option<&str>, file: Option<&str>, path: Option<&str>) -> Result<(), String> {
    let (table, custom) = table_for(cat).ok_or("categoria inválida")?;
    let extra = if custom { " AND category = ?6" } else { "" };
    let sql = format!(
        "UPDATE {} SET file = ?1, path = ?2, identifier = CASE WHEN identifier IS NOT NULL AND identifier = ?3 THEN ?4 ELSE identifier END WHERE id = ?5{}",
        table, extra
    );
    let n = if custom {
        conn.execute(&sql, params![file, path, old_file, file, id, cat])
    } else {
        conn.execute(&sql, params![file, path, old_file, file, id])
    }
    .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("registro {} não encontrado", id));
    }
    Ok(())
}

#[derive(Debug, Default, Serialize)]
pub struct ApplyResult {
    pub ok: usize,
    pub erros: Vec<String>,
}

pub fn apply_renames(conn: &Connection, root: &Path, items: &[RenameItem]) -> ApplyResult {
    let mut res = ApplyResult::default();
    for it in items {
        let r = (|| -> Result<(), String> {
            let rec = queries::get_record_by_id(conn, &it.category, it.id).map_err(|e| e.to_string())?;
            if rec.path.as_deref() != Some(it.old_path.as_str()) {
                return Err("o registro mudou desde a prévia".into());
            }
            let from = crate::files::rel_join(root, &it.old_path);
            let to = crate::files::rel_join(root, &it.new_path);
            if to.exists() && !to.to_string_lossy().eq_ignore_ascii_case(&from.to_string_lossy()) {
                return Err("já existe um arquivo com o novo nome".into());
            }
            std::fs::rename(&from, &to).map_err(|e| format!("não foi possível renomear ({}) — o arquivo está aberto?", e))?;
            let new_file = to.file_name().map(|n| n.to_string_lossy().to_string());
            if let Err(e) = set_file(conn, &it.category, it.id, rec.file.as_deref(), new_file.as_deref(), Some(&it.new_path)) {
                let _ = std::fs::rename(&to, &from); // desfaz
                return Err(e);
            }
            Ok(())
        })();
        match r {
            Ok(()) => res.ok += 1,
            Err(e) => res.erros.push(format!("{}: {}", it.old_path, e)),
        }
    }
    res
}

// ---------------- Verificar arquivos ----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingFile {
    pub category: String,
    pub id: i64,
    pub titulo: String,
    pub path: String,
}

#[derive(Debug, Default, Serialize)]
pub struct FileCheck {
    pub total_vinculados: usize,
    pub ausentes: Vec<MissingFile>,
    pub orfaos: Vec<String>,
    pub orfaos_bytes: u64,
}

pub fn check_files(conn: &Connection, root: &Path) -> Result<FileCheck, String> {
    let mut fc = FileCheck::default();
    let mut referenced = HashSet::new();
    for cat in all_categories(conn) {
        for r in queries::get_records(conn, &cat, None, None, None).map_err(|e| e.to_string())? {
            let Some(p) = r.path.clone().filter(|p| !p.trim().is_empty()) else { continue };
            fc.total_vinculados += 1;
            referenced.insert(linker::norm_rel(&p));
            if !crate::files::rel_join(root, &p).is_file() {
                fc.ausentes.push(MissingFile { category: cat.clone(), id: r.id, titulo: label_of(&r), path: p });
            }
        }
    }
    let mut files = Vec::new();
    for f in crate::config::category_folders(root) {
        linker::walk(&root.join(&f), root, &mut files);
    }
    for f in files {
        let low = f.to_lowercase();
        if referenced.contains(&linker::norm_rel(&f)) || low.ends_with("desktop.ini") || low.ends_with("thumbs.db") || low.contains("\\~$") {
            continue;
        }
        fc.orfaos_bytes += std::fs::metadata(crate::files::rel_join(root, &f)).map(|m| m.len()).unwrap_or(0);
        fc.orfaos.push(f);
    }
    fc.orfaos.sort();
    Ok(fc)
}

pub fn clear_missing(conn: &Connection, root: &Path, items: &[MissingFile]) -> ApplyResult {
    let mut res = ApplyResult::default();
    for it in items {
        if crate::files::rel_join(root, &it.path).is_file() {
            res.erros.push(format!("{}: o arquivo existe — vínculo mantido", it.path));
            continue;
        }
        match set_file(conn, &it.category, it.id, None, None, None) {
            Ok(()) => res.ok += 1,
            Err(e) => res.erros.push(format!("#{}: {}", it.id, e)),
        }
    }
    res
}

// ---------------- Backup ----------------

#[derive(Debug, Serialize)]
pub struct BackupInfo {
    pub path: String,
    pub bytes: u64,
    pub total: usize,
}

pub fn backup(conn: &Connection, root: &Path) -> Result<BackupInfo, String> {
    let dir = root.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(format!("lattes_{}.db", chrono::Local::now().format("%Y-%m-%d_%H%M%S")));
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().to_string()]).map_err(|e| format!("Falha no backup: {}", e))?;
    let total = std::fs::read_dir(&dir).map(|rd| rd.flatten().filter(|e| e.path().extension().is_some_and(|x| x == "db")).count()).unwrap_or(1);
    Ok(BackupInfo { bytes: std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0), path: target.to_string_lossy().to_string(), total })
}

// ---------------- Excel ----------------

#[derive(Debug, Clone, Deserialize)]
pub struct Sheet {
    pub name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    #[serde(default)]
    pub title: Option<String>,
}

pub fn write_xlsx(path: &Path, sheets: &[Sheet]) -> Result<(), String> {
    use rust_xlsxwriter::{Color, Format, FormatBorder, Workbook};
    let mut wb = Workbook::new();
    let head = Format::new().set_bold().set_font_color(Color::White).set_background_color(Color::RGB(0x4F46E5)).set_border_bottom(FormatBorder::Thin);
    let title_fmt = Format::new().set_bold().set_font_size(14).set_font_color(Color::RGB(0x1E1B4B));
    let mut used = HashSet::new();
    for sh in sheets {
        // nome de aba: até 31 caracteres, sem []:*?/\ e único
        let mut name: String = sh.name.chars().filter(|c| !"[]:*?/\\".contains(*c)).take(31).collect();
        if name.trim().is_empty() {
            name = "Planilha".into();
        }
        let mut n = 2;
        while !used.insert(name.to_lowercase()) {
            name = format!("{} {}", name.chars().take(27).collect::<String>(), n);
            n += 1;
        }
        let ws = wb.add_worksheet();
        ws.set_name(&name).map_err(|e| e.to_string())?;
        let mut r0: u32 = 0;
        if let Some(t) = &sh.title {
            ws.write_with_format(0, 0, t.as_str(), &title_fmt).map_err(|e| e.to_string())?;
            r0 = 2;
        }
        for (c, h) in sh.columns.iter().enumerate() {
            ws.write_with_format(r0, c as u16, h.as_str(), &head).map_err(|e| e.to_string())?;
        }
        for (i, row) in sh.rows.iter().enumerate() {
            let r = r0 + 1 + i as u32;
            for (c, v) in row.iter().enumerate() {
                let c = c as u16;
                match v {
                    Value::Number(x) => {
                        ws.write(r, c, x.as_f64().unwrap_or(0.0)).map_err(|e| e.to_string())?;
                    }
                    Value::Null => {}
                    Value::String(s) => {
                        ws.write(r, c, s.as_str()).map_err(|e| e.to_string())?;
                    }
                    Value::Bool(b) => {
                        ws.write(r, c, if *b { "sim" } else { "não" }).map_err(|e| e.to_string())?;
                    }
                    other => {
                        ws.write(r, c, other.to_string()).map_err(|e| e.to_string())?;
                    }
                }
            }
        }
        if !sh.columns.is_empty() {
            ws.set_freeze_panes(r0 + 1, 0).map_err(|e| e.to_string())?;
            let last_row = r0 + sh.rows.len().max(1) as u32;
            ws.autofilter(r0, 0, last_row, sh.columns.len() as u16 - 1).map_err(|e| e.to_string())?;
        }
        ws.autofit();
        // colunas de texto longo (títulos) não passam de ~70 caracteres
        for c in 0..sh.columns.len() as u16 {
            let longest = sh.rows.iter().filter_map(|r| r.get(c as usize)).map(|v| v.as_str().map(|s| s.chars().count()).unwrap_or(6)).max().unwrap_or(8);
            if longest > 70 {
                ws.set_column_width(c, 70).map_err(|e| e.to_string())?;
            }
        }
    }
    wb.save(path).map_err(|e| format!("Falha ao salvar a planilha: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xlsx_and_renames() {
        let dir = std::env::temp_dir().join("lattes_tools_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("5_producoes").join("artigos")).unwrap();
        let sheets = vec![Sheet { name: "Por ano".into(), title: Some("Resumo".into()), columns: vec!["Ano".into(), "Total".into()], rows: vec![vec![2024.into(), 3.into()], vec![2025.into(), Value::Null]] }];
        write_xlsx(&dir.join("t.xlsx"), &sheets).unwrap();
        assert!(std::fs::metadata(dir.join("t.xlsx")).unwrap().len() > 1000);

        let conn = crate::db::open_in_memory().unwrap();
        std::fs::write(dir.join("5_producoes\\artigos\\007_Artigo Final (v2).pdf"), b"%PDF").unwrap();
        conn.execute(
            "INSERT INTO producoes (titulo, file, path, identifier, folder) VALUES ('Seleção genômica em milho', '007_Artigo Final (v2).pdf', '5_producoes\\artigos\\007_Artigo Final (v2).pdf', '10.1/x', '5_producoes\\artigos')",
            [],
        )
        .unwrap();
        let items = preview_renames(&conn, &dir).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].new_path, "5_producoes\\artigos\\007_selecao_genomica_em_milho.pdf");
        let r = apply_renames(&conn, &dir, &items);
        assert_eq!(r.ok, 1, "{:?}", r.erros);
        assert!(dir.join("5_producoes\\artigos\\007_selecao_genomica_em_milho.pdf").is_file());
        let (ident, path): (String, String) = conn.query_row("SELECT identifier, path FROM producoes", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(ident, "10.1/x"); // DOI preservado
        assert!(path.ends_with("007_selecao_genomica_em_milho.pdf"));
        assert!(preview_renames(&conn, &dir).unwrap().is_empty());

        std::fs::write(dir.join("5_producoes\\artigos\\solto.pdf"), b"x").unwrap();
        let fc = check_files(&conn, &dir).unwrap();
        assert_eq!(fc.orfaos, vec!["5_producoes\\artigos\\solto.pdf".to_string()]);
        assert!(fc.ausentes.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod real {
    /// Só leitura no banco real: LATTES_REAL=1 cargo test --lib real_preview -- --nocapture
    #[test]
    fn real_preview_if_enabled() {
        if std::env::var("LATTES_REAL").is_err() {
            return;
        }
        let root = std::path::Path::new(r"d:\Desktop\UFSC\lattes");
        let conn = rusqlite::Connection::open_with_flags(root.join("lattes.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let items = super::preview_renames(&conn, root).unwrap();
        println!("renomear: {}", items.len());
        for it in items.iter().take(6) {
            println!("  {}  ->  {}", it.old_path, it.new_path);
        }
        let fc = super::check_files(&conn, root).unwrap();
        println!("vinculados={} ausentes={} orfaos={}", fc.total_vinculados, fc.ausentes.len(), fc.orfaos.len());
    }
}
