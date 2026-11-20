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
    let mut v: Vec<String> = schema::ENTITY_TABLES
        .iter()
        .map(|s| s.to_string())
        .collect();
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
        Some((a, b)) if a.len() >= 3 && a.chars().all(|c| c.is_ascii_digit()) => {
            (Some(a.to_string()), b.to_string())
        }
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
            let Some(rel) = r.path.clone().filter(|p| !p.trim().is_empty()) else {
                continue;
            };
            let full = crate::files::rel_join(root, &rel);
            if !full.is_file() {
                continue;
            }
            let Some(dir) = full.parent().map(Path::to_path_buf) else {
                continue;
            };
            let name = full.file_name().unwrap().to_string_lossy().to_string();
            let ext = full
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                .unwrap_or_default();
            let json = serde_json::to_value(&r).unwrap_or(Value::Null);
            let Some(base) = naming::record_base_name(&cat, &json) else {
                continue;
            };
            let names = taken.entry(dir.clone()).or_insert_with(|| {
                std::fs::read_dir(&dir)
                    .map(|rd| {
                        rd.flatten()
                            .map(|e| e.file_name().to_string_lossy().to_lowercase())
                            .collect()
                    })
                    .unwrap_or_default()
            });
            let maxp = *max_prefix.entry(dir.clone()).or_insert_with(|| {
                names
                    .iter()
                    .filter_map(|n| split_prefix(n).0.and_then(|p| p.parse::<u32>().ok()))
                    .max()
                    .unwrap_or(0)
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
fn set_file(
    conn: &Connection,
    cat: &str,
    id: i64,
    old_file: Option<&str>,
    file: Option<&str>,
    path: Option<&str>,
) -> Result<(), String> {
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
    if file.is_none() && path.is_none() {
        let _ = conn.execute(
            "DELETE FROM record_attachments WHERE (category = ?1 OR category = ?2) AND record_id = ?3",
            params![cat, table, id],
        );
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
            let rec =
                queries::get_record_by_id(conn, &it.category, it.id).map_err(|e| e.to_string())?;
            if rec.path.as_deref() != Some(it.old_path.as_str()) {
                return Err("o registro mudou desde a prévia".into());
            }
            let from = crate::files::rel_join(root, &it.old_path);
            let to = crate::files::rel_join(root, &it.new_path);
            if to.exists()
                && !to
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&from.to_string_lossy())
            {
                return Err("já existe um arquivo com o novo nome".into());
            }
            std::fs::rename(&from, &to).map_err(|e| {
                format!("não foi possível renomear ({}) — o arquivo está aberto?", e)
            })?;
            let new_file = to.file_name().map(|n| n.to_string_lossy().to_string());
            if let Err(e) = set_file(
                conn,
                &it.category,
                it.id,
                rec.file.as_deref(),
                new_file.as_deref(),
                Some(&it.new_path),
            ) {
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
    pub nivel: Option<String>,
    pub titulo: String,
    pub path: String,
    pub ano: Option<i64>,
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
            let mut checked_paths = HashSet::new();
            if let Some(p) = r.path.clone().filter(|p| !p.trim().is_empty()) {
                fc.total_vinculados += 1;
                let norm = linker::norm_rel(&p);
                referenced.insert(norm.clone());
                checked_paths.insert(norm);
                if !crate::files::rel_join(root, &p).is_file() {
                    fc.ausentes.push(MissingFile {
                        category: cat.clone(),
                        id: r.id,
                        nivel: r.tipo.clone(),
                        titulo: label_of(&r),
                        path: p,
                        ano: r.ano,
                    });
                }
            }
            for att in &r.attachments {
                let norm = linker::norm_rel(&att.path);
                if att.path.trim().is_empty() || checked_paths.contains(&norm) {
                    continue;
                }
                fc.total_vinculados += 1;
                referenced.insert(norm.clone());
                checked_paths.insert(norm);
                if !crate::files::rel_join(root, &att.path).is_file() {
                    fc.ausentes.push(MissingFile {
                        category: cat.clone(),
                        id: r.id,
                        nivel: r.tipo.clone(),
                        titulo: label_of(&r),
                        path: att.path.clone(),
                        ano: r.ano,
                    });
                }
            }
        }
    }
    let mut files = Vec::new();
    for f in crate::config::category_folders(root) {
        linker::walk(&root.join(&f), root, &mut files);
    }
    for f in files {
        let low = f.to_lowercase();
        if referenced.contains(&linker::norm_rel(&f))
            || low.ends_with("desktop.ini")
            || low.ends_with("thumbs.db")
            || low.contains("\\~$")
        {
            continue;
        }
        fc.orfaos_bytes += std::fs::metadata(crate::files::rel_join(root, &f))
            .map(|m| m.len())
            .unwrap_or(0);
        fc.orfaos.push(f);
    }
    fc.orfaos.sort();
    Ok(fc)
}

pub fn clear_missing(conn: &Connection, root: &Path, items: &[MissingFile]) -> ApplyResult {
    let mut res = ApplyResult::default();
    for it in items {
        if crate::files::rel_join(root, &it.path).is_file() {
            res.erros
                .push(format!("{}: o arquivo existe — vínculo mantido", it.path));
            continue;
        }
        let Some((table, custom)) = table_for(&it.category) else {
            res.erros.push(format!("#{}: categoria inválida", it.id));
            continue;
        };
        let norm_path = crate::files::to_db_rel(it.path.trim());
        let _ = conn.execute(
            "DELETE FROM record_attachments WHERE (category = ?1 OR category = ?2) AND record_id = ?3 AND (path = ?4 OR REPLACE(path, '/', '\\') = ?5)",
            params![&it.category, &table, it.id, &it.path, &norm_path],
        );
        let old_file = std::path::Path::new(&it.path)
            .file_name()
            .and_then(|s| s.to_str())
            .map(String::from);

        let att_cat = if custom {
            it.category.as_str()
        } else {
            table.as_str()
        };
        // Verifica se sobrou algum outro anexo válido em record_attachments
        let remaining = crate::db::queries::get_attachments_for_record(conn, att_cat, it.id)
            .unwrap_or_default()
            .into_iter()
            .find(|a| crate::files::rel_join(root, &a.path).is_file());

        let r = if let Some(att) = remaining {
            set_file(
                conn,
                &it.category,
                it.id,
                old_file.as_deref(),
                Some(&att.file),
                Some(&att.path),
            )
        } else {
            set_file(conn, &it.category, it.id, old_file.as_deref(), None, None)
        };
        match r {
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
    let target = dir.join(format!(
        "lattes_{}.db",
        chrono::Local::now().format("%Y-%m-%d_%H%M%S")
    ));
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().to_string()])
        .map_err(|e| format!("Falha no backup: {}", e))?;
    let total = std::fs::read_dir(&dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().extension().is_some_and(|x| x == "db"))
                .count()
        })
        .unwrap_or(1);
    Ok(BackupInfo {
        bytes: std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0),
        path: target.to_string_lossy().to_string(),
        total,
    })
}

// ---------------- DOI dos comprovantes ----------------

/// DOI gravado dentro de um comprovante PDF (sem rede).
/// `catch_unwind`: numa varredura em lote, um PDF malformado não pode derrubar o app.
pub fn doi_in_pdf(bytes: &[u8]) -> Option<String> {
    std::panic::catch_unwind(|| {
        crate::metadata::extract_local(bytes)
            .ok()
            .and_then(|m| m.doi)
    })
    .unwrap_or(None)
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
    let head = Format::new()
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x4F46E5))
        .set_border_bottom(FormatBorder::Thin);
    let title_fmt = Format::new()
        .set_bold()
        .set_font_size(14)
        .set_font_color(Color::RGB(0x1E1B4B));
    let mut used = HashSet::new();
    for sh in sheets {
        // nome de aba: até 31 caracteres, sem []:*?/\ e único
        let mut name: String = sh
            .name
            .chars()
            .filter(|c| !"[]:*?/\\".contains(*c))
            .take(31)
            .collect();
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
            ws.write_with_format(0, 0, t.as_str(), &title_fmt)
                .map_err(|e| e.to_string())?;
            r0 = 2;
        }
        for (c, h) in sh.columns.iter().enumerate() {
            ws.write_with_format(r0, c as u16, h.as_str(), &head)
                .map_err(|e| e.to_string())?;
        }
        for (i, row) in sh.rows.iter().enumerate() {
            let r = r0 + 1 + i as u32;
            for (c, v) in row.iter().enumerate() {
                let c = c as u16;
                match v {
                    Value::Number(x) => {
                        ws.write(r, c, x.as_f64().unwrap_or(0.0))
                            .map_err(|e| e.to_string())?;
                    }
                    Value::Null => {}
                    Value::String(s) => {
                        ws.write(r, c, s.as_str()).map_err(|e| e.to_string())?;
                    }
                    Value::Bool(b) => {
                        ws.write(r, c, if *b { "sim" } else { "não" })
                            .map_err(|e| e.to_string())?;
                    }
                    other => {
                        ws.write(r, c, other.to_string())
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
        if !sh.columns.is_empty() {
            ws.set_freeze_panes(r0 + 1, 0).map_err(|e| e.to_string())?;
            let last_row = r0 + sh.rows.len().max(1) as u32;
            ws.autofilter(r0, 0, last_row, sh.columns.len() as u16 - 1)
                .map_err(|e| e.to_string())?;
        }
        ws.autofit();
        // colunas de texto longo (títulos) não passam de ~70 caracteres
        for c in 0..sh.columns.len() as u16 {
            let longest = sh
                .rows
                .iter()
                .filter_map(|r| r.get(c as usize))
                .map(|v| v.as_str().map(|s| s.chars().count()).unwrap_or(6))
                .max()
                .unwrap_or(8);
            if longest > 70 {
                ws.set_column_width(c, 70).map_err(|e| e.to_string())?;
            }
        }
    }
    wb.save(path)
        .map_err(|e| format!("Falha ao salvar a planilha: {}", e))
}

// ---------------- Auditoria e Limpeza Recursiva de Pastas ----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditedFolderItem {
    pub rel_path: String,
    pub abs_path: String,
    pub exists_on_disk: bool,
    pub is_mapped: bool,
    pub is_parent_of_mapped: bool,
    pub mapping_id: Option<i64>,
    pub category_group: Option<String>,
    pub suggested_group: String,
    pub description: String,
    pub direct_files: usize,
    pub total_tree_files: usize,
    pub subdirs_count: usize,
    pub linked_files_count: usize,
    pub unlinked_files_count: usize,
    pub records_using_folder: usize,
    pub unlinked_files: Vec<String>,
    pub unlinked_bytes: u64,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct RootFolderAudit {
    pub root_path: String,
    pub total_disk_folders: usize,
    pub empty_folders: Vec<AuditedFolderItem>,
    pub unmapped_folders: Vec<AuditedFolderItem>,
    pub folders_with_unlinked_files: Vec<AuditedFolderItem>,
    pub missing_disk_folders: Vec<AuditedFolderItem>,
}

fn is_ignored_top_dir(name_lower: &str) -> bool {
    matches!(
        name_lower,
        ".git"
            | ".pytest_cache"
            | "backups"
            | "perfil"
            | "system volume information"
            | "$recycle.bin"
    ) || name_lower.starts_with('.')
}

fn is_os_junk_file(name_lower: &str) -> bool {
    matches!(name_lower, "desktop.ini" | "thumbs.db" | ".ds_store") || name_lower.starts_with("~$")
}

fn infer_group_from_rel(rel_path: &str) -> String {
    let first = rel_path
        .split(['\\', '/'])
        .next()
        .unwrap_or("")
        .to_lowercase();
    match first.as_str() {
        s if s.starts_with("1_dados") => "Dados gerais",
        s if s.starts_with("2_formacao") || s == "formacao_academica" => "Formação",
        s if s.starts_with("3_atuacao")
            || s.starts_with("12_atuacao")
            || s.starts_with("13_atuacao") =>
        {
            "Atuação"
        }
        s if s.starts_with("4_projetos") => "Projetos",
        s if s.starts_with("5_producoes") => "Produções",
        s if s.starts_with("6_patentes") => "Patentes",
        s if s.starts_with("7_inovacao") => "Inovação",
        s if s.starts_with("8_educacao") => "Educação e Popularização de C&T",
        s if s.starts_with("9_eventos") => "Eventos",
        s if s.starts_with("10_orientacoes") => "Orientações",
        s if s.starts_with("11_bancas") => "Bancas",
        _ => "Dados gerais",
    }
    .to_string()
}

fn humanize_folder_name(rel_path: &str) -> String {
    let base = rel_path
        .trim_end_matches(['\\', '/'])
        .split(['\\', '/'])
        .next_back()
        .unwrap_or(rel_path);
    let clean = base.replace('_', " ").trim().to_string();
    let mut chars = clean.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => clean,
    }
}

fn collect_referenced_state(
    conn: &Connection,
) -> Result<(HashSet<String>, HashMap<String, usize>), String> {
    let mut referenced_files = HashSet::new();
    let mut records_by_folder: HashMap<String, usize> = HashMap::new();
    for cat in all_categories(conn) {
        for r in queries::get_records(conn, &cat, None, None, None).map_err(|e| e.to_string())? {
            if let Some(fld) = r
                .folder
                .as_deref()
                .map(linker::norm_rel)
                .filter(|s| !s.is_empty())
            {
                *records_by_folder.entry(fld).or_insert(0) += 1;
            }
            if let Some(p) = r.path.as_deref().filter(|s| !s.trim().is_empty()) {
                referenced_files.insert(linker::norm_rel(p));
            }
            for att in &r.attachments {
                if !att.path.trim().is_empty() {
                    referenced_files.insert(linker::norm_rel(&att.path));
                }
            }
        }
    }
    Ok((referenced_files, records_by_folder))
}

fn count_tree_real_files(dir: &Path) -> usize {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut count = 0usize;
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            count += count_tree_real_files(&p);
        } else {
            let name_low = entry.file_name().to_string_lossy().to_lowercase();
            if !is_os_junk_file(&name_low) {
                count += 1;
            }
        }
    }
    count
}

fn walk_disk_dirs(dir: &Path, is_root: bool, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let name_low = entry.file_name().to_string_lossy().to_lowercase();
        if is_root && is_ignored_top_dir(&name_low) {
            continue;
        }
        if !is_root && name_low.starts_with('.') {
            continue;
        }
        out.push(p.clone());
        walk_disk_dirs(&p, false, out);
    }
}

fn safe_rel_inside_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let trimmed = rel.trim().trim_matches(|c| c == '\\' || c == '/');
    if trimmed.is_empty() {
        return Err("Caminho vazio não permitido".to_string());
    }
    let p = Path::new(trimmed);
    if p.is_absolute() {
        return Err(format!("Caminho absoluto não permitido: {}", rel));
    }
    for comp in p.components() {
        match comp {
            std::path::Component::ParentDir
            | std::path::Component::RootDir
            | std::path::Component::Prefix(_) => {
                return Err(format!("Caminho inválido fora da pasta raiz: {}", rel));
            }
            _ => {}
        }
    }
    let top = trimmed
        .split(['\\', '/'])
        .next()
        .unwrap_or("")
        .to_lowercase();
    if is_ignored_top_dir(&top) {
        return Err(format!(
            "Pasta protegida do sistema não pode ser alterada: {}",
            rel
        ));
    }
    let full = crate::files::rel_join(root, trimmed);
    if full.exists() {
        if let (Ok(c_full), Ok(c_root)) = (full.canonicalize(), root.canonicalize()) {
            if !c_full.starts_with(&c_root) || c_full == c_root {
                return Err(format!("Caminho fora da pasta raiz permitida: {}", rel));
            }
        }
    }
    Ok(full)
}

pub fn scan_root_folders(conn: &Connection, root: &Path) -> Result<RootFolderAudit, String> {
    let clean_root = crate::strip_verbatim(root);
    let mut audit = RootFolderAudit {
        root_path: clean_root.to_string_lossy().to_string(),
        ..Default::default()
    };

    let mappings = queries::get_subfolder_mappings(conn, None).map_err(|e| e.to_string())?;
    let mut mapped_by_norm: HashMap<String, crate::db::models::SubfolderMapping> = HashMap::new();
    for m in &mappings {
        let key = linker::norm_rel(&m.folder);
        if !key.is_empty() {
            mapped_by_norm.entry(key).or_insert_with(|| m.clone());
        }
    }

    let (referenced_files, records_by_folder) = collect_referenced_state(conn)?;

    let mut disk_dirs = Vec::new();
    walk_disk_dirs(root, true, &mut disk_dirs);
    audit.total_disk_folders = disk_dirs.len();

    for dir_path in disk_dirs {
        let Ok(rel) = dir_path.strip_prefix(root) else {
            continue;
        };
        let rel_path = crate::files::path_to_db_rel(rel)
            .trim_matches('\\')
            .to_string();
        if rel_path.is_empty() {
            continue;
        }
        let norm_dir = linker::norm_rel(&rel_path);
        let mapping = mapped_by_norm.get(&norm_dir);
        let prefix = format!("{}\\", norm_dir);
        let is_parent_of_mapped = mapped_by_norm.keys().any(|k| k.starts_with(&prefix));

        let mut direct_files = 0usize;
        let mut subdirs_count = 0usize;
        let mut linked_files_count = 0usize;
        let mut unlinked_files_count = 0usize;
        let mut unlinked_files = Vec::new();
        let mut unlinked_bytes = 0u64;

        if let Ok(rd) = std::fs::read_dir(&dir_path) {
            for entry in rd.flatten() {
                let p = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                let name_low = name.to_lowercase();
                if p.is_dir() {
                    if !name_low.starts_with('.') {
                        subdirs_count += 1;
                    }
                    continue;
                }
                if is_os_junk_file(&name_low) {
                    continue;
                }
                direct_files += 1;
                let file_rel = format!("{}\\{}", rel_path, name);
                if referenced_files.contains(&linker::norm_rel(&file_rel)) {
                    linked_files_count += 1;
                } else {
                    unlinked_files_count += 1;
                    unlinked_bytes += std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                    unlinked_files.push(file_rel);
                }
            }
        }
        unlinked_files.sort();
        let total_tree_files = count_tree_real_files(&dir_path);
        let records_using_folder = records_by_folder.get(&norm_dir).copied().unwrap_or(0);
        let is_mapped = mapping.is_some();
        let suggested_group = mapping
            .map(|m| m.category_group.clone())
            .unwrap_or_else(|| infer_group_from_rel(&rel_path));
        let description = mapping
            .map(|m| m.description.clone())
            .unwrap_or_else(|| humanize_folder_name(&rel_path));

        let item = AuditedFolderItem {
            rel_path,
            abs_path: crate::strip_verbatim(&dir_path)
                .to_string_lossy()
                .to_string(),
            exists_on_disk: true,
            is_mapped,
            is_parent_of_mapped,
            mapping_id: mapping.map(|m| m.id),
            category_group: mapping.map(|m| m.category_group.clone()),
            suggested_group,
            description,
            direct_files,
            total_tree_files,
            subdirs_count,
            linked_files_count,
            unlinked_files_count,
            records_using_folder,
            unlinked_files,
            unlinked_bytes,
        };

        if total_tree_files == 0 {
            audit.empty_folders.push(item.clone());
        }
        if !is_mapped && !is_parent_of_mapped {
            audit.unmapped_folders.push(item.clone());
        }
        if unlinked_files_count > 0 {
            audit.folders_with_unlinked_files.push(item);
        }
    }

    for m in mappings {
        let clean_rel = crate::files::to_db_rel(m.folder.trim())
            .trim_matches('\\')
            .to_string();
        if clean_rel.is_empty() {
            continue;
        }
        let full = crate::files::rel_join(root, &clean_rel);
        if !full.is_dir() {
            let norm_dir = linker::norm_rel(&clean_rel);
            let records_using_folder = records_by_folder.get(&norm_dir).copied().unwrap_or(0);
            audit.missing_disk_folders.push(AuditedFolderItem {
                rel_path: clean_rel,
                abs_path: crate::strip_verbatim(&full).to_string_lossy().to_string(),
                exists_on_disk: false,
                is_mapped: true,
                is_parent_of_mapped: false,
                mapping_id: Some(m.id),
                category_group: Some(m.category_group.clone()),
                suggested_group: m.category_group,
                description: m.description,
                direct_files: 0,
                total_tree_files: 0,
                subdirs_count: 0,
                linked_files_count: 0,
                unlinked_files_count: 0,
                records_using_folder,
                unlinked_files: Vec::new(),
                unlinked_bytes: 0,
            });
        }
    }

    audit
        .empty_folders
        .sort_by_key(|a| a.rel_path.to_lowercase());
    audit
        .unmapped_folders
        .sort_by_key(|a| a.rel_path.to_lowercase());
    audit
        .folders_with_unlinked_files
        .sort_by_key(|a| a.rel_path.to_lowercase());
    audit
        .missing_disk_folders
        .sort_by_key(|a| a.rel_path.to_lowercase());

    Ok(audit)
}

fn dir_tree_safety_check(
    dir: &Path,
    root: &Path,
    referenced: &HashSet<String>,
    delete_unlinked_files: bool,
) -> Result<(), String> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            dir_tree_safety_check(&p, root, referenced, delete_unlinked_files)?;
        } else {
            let name_low = entry.file_name().to_string_lossy().to_lowercase();
            if is_os_junk_file(&name_low) {
                continue;
            }
            if let Ok(rel) = p.strip_prefix(root) {
                let rel_str = rel.to_string_lossy().to_string();
                if referenced.contains(&linker::norm_rel(&rel_str)) {
                    return Err("contém comprovante(s) vinculado(s) a registros".to_string());
                }
            }
            if !delete_unlinked_files {
                return Err("a pasta não está vazia".to_string());
            }
        }
    }
    Ok(())
}

pub fn remove_audited_folders(
    conn: &Connection,
    root: &Path,
    rel_paths: &[String],
    remove_mappings: bool,
    delete_unlinked_files: bool,
) -> ApplyResult {
    let mut res = ApplyResult::default();
    let (referenced, _) = match collect_referenced_state(conn) {
        Ok(x) => x,
        Err(e) => {
            res.erros.push(e);
            return res;
        }
    };

    let mut sorted: Vec<String> = rel_paths
        .iter()
        .map(|s| {
            crate::files::to_db_rel(s.trim())
                .trim_matches('\\')
                .to_string()
        })
        .filter(|s| !s.is_empty())
        .collect();
    sorted.sort_by(|a, b| {
        let da = a.matches('\\').count();
        let db = b.matches('\\').count();
        db.cmp(&da).then_with(|| a.cmp(b))
    });
    sorted.dedup_by(|a, b| a.eq_ignore_ascii_case(b));

    for rel in sorted {
        let r = (|| -> Result<(), String> {
            let full = safe_rel_inside_root(root, &rel)?;
            if full.exists() {
                if !full.is_dir() {
                    return Err("não é uma pasta".to_string());
                }
                dir_tree_safety_check(&full, root, &referenced, delete_unlinked_files)?;
                std::fs::remove_dir_all(&full)
                    .map_err(|e| format!("falha ao remover pasta: {}", e))?;
            }
            if remove_mappings {
                let norm = linker::norm_rel(&rel);
                let _ = conn.execute(
                    "DELETE FROM subfolder_mappings WHERE TRIM(REPLACE(LOWER(folder), '/', '\\'), '\\') = ?1",
                    params![norm],
                );
            }
            Ok(())
        })();
        match r {
            Ok(()) => res.ok += 1,
            Err(e) => res.erros.push(format!("{}: {}", rel, e)),
        }
    }
    res
}

pub fn create_missing_mapped_folders(root: &Path, rel_paths: &[String]) -> ApplyResult {
    let mut res = ApplyResult::default();
    for rel in rel_paths {
        let r = (|| -> Result<(), String> {
            let full = safe_rel_inside_root(root, rel)?;
            std::fs::create_dir_all(&full).map_err(|e| e.to_string())
        })();
        match r {
            Ok(()) => res.ok += 1,
            Err(e) => res.erros.push(format!("{}: {}", rel, e)),
        }
    }
    res
}

pub fn remove_unlinked_mappings(conn: &Connection, mapping_ids: &[i64]) -> ApplyResult {
    let mut res = ApplyResult::default();
    for &id in mapping_ids {
        match conn.execute("DELETE FROM subfolder_mappings WHERE id = ?1", params![id]) {
            Ok(n) if n > 0 => res.ok += 1,
            Ok(_) => res.erros.push(format!("Mapeamento #{} não encontrado", id)),
            Err(e) => res.erros.push(format!("#{}: {}", id, e)),
        }
    }
    res
}

pub fn delete_orphan_files(conn: &Connection, root: &Path, rel_files: &[String]) -> ApplyResult {
    let mut res = ApplyResult::default();
    let (referenced, _) = match collect_referenced_state(conn) {
        Ok(x) => x,
        Err(e) => {
            res.erros.push(e);
            return res;
        }
    };
    for rel in rel_files {
        let r = (|| -> Result<(), String> {
            let full = safe_rel_inside_root(root, rel)?;
            if referenced.contains(&linker::norm_rel(rel)) {
                return Err("arquivo está vinculado a um registro".to_string());
            }
            if !full.is_file() {
                return Err("arquivo não encontrado".to_string());
            }
            std::fs::remove_file(&full).map_err(|e| e.to_string())
        })();
        match r {
            Ok(()) => res.ok += 1,
            Err(e) => res.erros.push(format!("{}: {}", rel, e)),
        }
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xlsx_and_renames() {
        let tmpdir = tempfile::tempdir().unwrap();
        let dir = tmpdir.path().join("lattes_tools_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("5_producoes").join("artigos")).unwrap();
        let sheets = vec![Sheet {
            name: "Por ano".into(),
            title: Some("Resumo".into()),
            columns: vec!["Ano".into(), "Total".into()],
            rows: vec![vec![2024.into(), 3.into()], vec![2025.into(), Value::Null]],
        }];
        write_xlsx(&dir.join("t.xlsx"), &sheets).unwrap();
        assert!(std::fs::metadata(dir.join("t.xlsx")).unwrap().len() > 1000);

        let conn = crate::db::open_in_memory().unwrap();
        std::fs::write(
            crate::files::rel_join(&dir, "5_producoes\\artigos\\007_Artigo Final (v2).pdf"),
            b"%PDF",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO producoes (titulo, file, path, identifier, folder) VALUES ('Seleção genômica em milho', '007_Artigo Final (v2).pdf', '5_producoes\\artigos\\007_Artigo Final (v2).pdf', '10.1/x', '5_producoes\\artigos')",
            [],
        )
        .unwrap();
        let items = preview_renames(&conn, &dir).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0].new_path,
            "5_producoes\\artigos\\007_selecao_genomica_em_milho.pdf"
        );
        let r = apply_renames(&conn, &dir, &items);
        assert_eq!(r.ok, 1, "{:?}", r.erros);
        assert!(crate::files::rel_join(
            &dir,
            "5_producoes\\artigos\\007_selecao_genomica_em_milho.pdf"
        )
        .is_file());
        let (ident, path): (String, String) = conn
            .query_row("SELECT identifier, path FROM producoes", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(ident, "10.1/x"); // DOI preservado
        assert!(path.ends_with("007_selecao_genomica_em_milho.pdf"));
        assert!(preview_renames(&conn, &dir).unwrap().is_empty());

        std::fs::write(
            crate::files::rel_join(&dir, "5_producoes\\artigos\\solto.pdf"),
            b"x",
        )
        .unwrap();
        let fc = check_files(&conn, &dir).unwrap();
        assert_eq!(
            fc.orfaos,
            vec!["5_producoes\\artigos\\solto.pdf".to_string()]
        );
        assert!(fc.ausentes.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_scan_and_clean_root_folders() {
        let tmpdir = tempfile::tempdir().unwrap();
        let dir = tmpdir.path().join("lattes_folder_audit_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("6_patentes").join("patentes")).unwrap();
        std::fs::create_dir_all(dir.join("6_patentes").join("teste")).unwrap();
        std::fs::create_dir_all(dir.join("5_producoes").join("artigos_completos")).unwrap();
        std::fs::create_dir_all(dir.join("backups")).unwrap();

        let conn = crate::db::open_in_memory().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO subfolder_mappings (category_group, description, folder) VALUES ('Patentes', 'Patentes', '6_patentes\\patentes\\')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO subfolder_mappings (category_group, description, folder) VALUES ('Produções', 'Artigos completos', '5_producoes\\artigos_completos\\')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO subfolder_mappings (category_group, description, folder) VALUES ('Inovação', 'Produtos tecnológicos', '7_inovacao\\produtos_tecnologicos\\')",
            [],
        ).unwrap();

        std::fs::write(
            crate::files::rel_join(&dir, "5_producoes\\artigos_completos\\001_artigo.pdf"),
            b"%PDF",
        )
        .unwrap();
        std::fs::write(
            crate::files::rel_join(&dir, "5_producoes\\artigos_completos\\solto.pdf"),
            b"%PDF",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO producoes (ano, titulo, file, path, folder) VALUES (2025, 'Artigo 1', '001_artigo.pdf', '5_producoes\\artigos_completos\\001_artigo.pdf', '5_producoes\\artigos_completos\\')",
            [],
        ).unwrap();

        let audit = scan_root_folders(&conn, &dir).unwrap();
        assert!(audit
            .empty_folders
            .iter()
            .any(|f| f.rel_path == r"6_patentes\teste"));
        assert!(audit
            .empty_folders
            .iter()
            .any(|f| f.rel_path == r"6_patentes\patentes"));
        assert!(audit
            .unmapped_folders
            .iter()
            .any(|f| f.rel_path == r"6_patentes\teste"));
        assert!(!audit
            .unmapped_folders
            .iter()
            .any(|f| f.rel_path == "backups"));
        assert!(
            audit
                .folders_with_unlinked_files
                .iter()
                .any(|f| f.rel_path == r"5_producoes\artigos_completos"
                    && f.unlinked_files_count == 1)
        );
        assert!(audit
            .missing_disk_folders
            .iter()
            .any(|f| f.rel_path == r"7_inovacao\produtos_tecnologicos"));

        // Safety: refuse deleting folder containing a linked file
        let blocked = remove_audited_folders(
            &conn,
            &dir,
            &[r"5_producoes\artigos_completos".to_string()],
            false,
            true,
        );
        assert_eq!(blocked.ok, 0);
        assert_eq!(blocked.erros.len(), 1);
        assert!(
            crate::files::rel_join(&dir, r"5_producoes\artigos_completos\001_artigo.pdf").is_file()
        );

        // Remove empty unmapped folder
        let removed = remove_audited_folders(
            &conn,
            &dir,
            &[r"6_patentes\teste".to_string()],
            false,
            false,
        );
        assert_eq!(removed.ok, 1, "{:?}", removed.erros);
        assert!(!crate::files::rel_join(&dir, r"6_patentes\teste").exists());

        // Delete orphan file safely
        let del_orphan = delete_orphan_files(
            &conn,
            &dir,
            &[r"5_producoes\artigos_completos\solto.pdf".to_string()],
        );
        assert_eq!(del_orphan.ok, 1, "{:?}", del_orphan.erros);
        assert!(!crate::files::rel_join(&dir, r"5_producoes\artigos_completos\solto.pdf").exists());

        // Create missing mapped folder on disk
        let created =
            create_missing_mapped_folders(&dir, &[r"7_inovacao\produtos_tecnologicos".to_string()]);
        assert_eq!(created.ok, 1, "{:?}", created.erros);
        assert!(crate::files::rel_join(&dir, r"7_inovacao\produtos_tecnologicos").is_dir());

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
        let conn = rusqlite::Connection::open_with_flags(
            root.join("lattes.db"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let items = super::preview_renames(&conn, root).unwrap();
        println!("renomear: {}", items.len());
        for it in items.iter().take(6) {
            println!("  {}  ->  {}", it.old_path, it.new_path);
        }
        let fc = super::check_files(&conn, root).unwrap();
        println!(
            "vinculados={} ausentes={} orfaos={}",
            fc.total_vinculados,
            fc.ausentes.len(),
            fc.orfaos.len()
        );
    }
}
