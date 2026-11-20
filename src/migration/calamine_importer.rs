use calamine::{open_workbook_auto, Data, DataType, Range, Reader};
use regex::Regex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

static RE_LATTES: OnceLock<Regex> = OnceLock::new();
static RE_DRIVE: OnceLock<Regex> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MigrationReport {
    pub success: bool,
    pub total_records: usize,
    pub total_mappings: usize,
    pub category_counts: HashMap<String, usize>,
    pub counts_per_category: HashMap<String, usize>,
    pub warnings: Vec<String>,
    pub execution_time_ms: u128,
}

/// Normalizes an absolute or relative path to be portable and relative to the root directory.
/// Strips drive letters (D:, E:) and prefixes matching .*lattes[\\/].
pub fn relativize_path(path_str: Option<&str>) -> Option<String> {
    let p = path_str?;
    let trimmed = p.trim();
    if trimmed.is_empty() {
        return None;
    }
    let unified = crate::files::to_db_rel(trimmed);

    // Match .*lattes[\\/](.*)
    let re_lattes = RE_LATTES
        .get_or_init(|| Regex::new(r"(?i)(?:[a-zA-Z]:)?[\\/].*?[\\/]lattes[\\/](.*)").unwrap());
    if let Some(caps) = re_lattes.captures(&unified) {
        return Some(caps[1].trim_start_matches('\\').to_string());
    }

    // Match drive letter e.g. E:\... or D:\...
    let re_drive = RE_DRIVE.get_or_init(|| Regex::new(r"(?i)^[a-zA-Z]:[\\/](.*)").unwrap());
    if let Some(caps) = re_drive.captures(&unified) {
        return Some(caps[1].trim_start_matches('\\').to_string());
    }

    Some(unified.trim_start_matches('\\').to_string())
}

/// A planilha traz os textos "file"/"folder" como marcadores nas colunas File/Folder:
/// o nome e a pasta reais vêm do caminho (Path).
pub fn fix_file_folder(
    file: Option<String>,
    folder: Option<String>,
    path: Option<&str>,
) -> (Option<String>, Option<String>) {
    let placeholder = |v: &Option<String>, w: &str| {
        v.as_deref()
            .map(|x| x.trim().eq_ignore_ascii_case(w) || x.trim().is_empty())
            .unwrap_or(true)
    };
    let p = path
        .map(crate::files::to_db_rel)
        .filter(|p| !p.trim().is_empty());
    let file = if placeholder(&file, "file") {
        p.as_deref()
            .and_then(|p| p.rsplit('\\').next())
            .map(String::from)
    } else {
        file
    };
    let folder = if placeholder(&folder, "folder") {
        p.as_deref()
            .and_then(|p| p.rsplit_once('\\'))
            .map(|(d, _)| format!("{}\\", d))
    } else {
        folder
    };
    (file, folder)
}

pub fn parse_i64(data: &Data) -> Option<i64> {
    match data {
        Data::Int(i) => Some(*i),
        Data::Float(f) => Some(*f as i64),
        Data::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                trimmed.parse::<f64>().ok().map(|f| f as i64)
            }
        }
        _ => None,
    }
}

pub fn parse_string(data: &Data) -> Option<String> {
    match data {
        Data::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Data::Int(i) => Some(i.to_string()),
        Data::Float(f) => {
            if f.fract() == 0.0 {
                Some((*f as i64).to_string())
            } else {
                Some(f.to_string())
            }
        }
        _ => None,
    }
}

pub fn parse_qualis(data: &Data) -> Option<String> {
    match data {
        Data::String(s) => Some(s.clone()),
        Data::Empty => None,
        _ => None,
    }
}

pub fn parse_datetime(data: &Data) -> Option<String> {
    if let Some(ndt) = data.as_datetime() {
        return Some(ndt.format("%Y-%m-%d %H:%M:%S").to_string());
    }
    match data {
        Data::DateTime(dt) => dt
            .as_datetime()
            .map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string()),
        Data::DateTimeIso(s) => Some(s.clone()),
        Data::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        _ => None,
    }
}

fn get_col_map(range: &Range<Data>) -> HashMap<String, usize> {
    let mut map = HashMap::new();
    for c in 0..range.width() {
        if let Some(Data::String(header_str)) = range.get((0, c)) {
            let h = header_str.trim().to_lowercase();
            let norm = match h.as_str() {
                "foler" => "folder".to_string(),
                "título do trabalho" | "título" | "titulo" => "titulo".to_string(),
                "descrição" | "descricao" => "descricao".to_string(),
                "id" => "identifier".to_string(),
                other => other.to_string(),
            };
            map.insert(norm, c);
        }
    }
    map
}

fn get_cell<'a>(
    range: &'a Range<Data>,
    col_map: &HashMap<String, usize>,
    row: usize,
    col_name: &str,
) -> Option<&'a Data> {
    col_map.get(col_name).and_then(|&c| range.get((row, c)))
}

/// Executes complete migration of lattes.xlsm into SQLite inside a single atomic transaction.
pub fn migrate_workbook(
    conn: &mut Connection,
    xlsm_path: &Path,
    _root_dir: &Path,
) -> Result<MigrationReport, Box<dyn std::error::Error>> {
    let start_time = std::time::Instant::now();
    let mut workbook = open_workbook_auto(xlsm_path)?;

    let tx = conn.transaction()?;

    // Clear previous migration data for idempotency
    for table in crate::db::schema::ENTITY_TABLES {
        tx.execute(&format!("DELETE FROM {}", table), [])?;
    }
    tx.execute("DELETE FROM subfolder_mappings", [])?;
    let _ = tx.execute("DELETE FROM sqlite_sequence WHERE name IN ('subfolder_mappings', 'dadosgerais', 'formacao', 'encargos', 'disciplinas', 'projetos', 'producoes', 'patentes', 'eventos', 'orientacoes', 'bancas')", []);

    let mut category_counts: HashMap<String, usize> = HashMap::new();

    // 1. Path Sheet (Subfolder Mappings)
    let path_range = workbook
        .worksheet_range("path")
        .map_err(|e| format!("Missing 'path' sheet: {}", e))?;
    let mut mapping_count = 0;
    for r in 1..path_range.height() {
        let group = path_range.get((r, 0)).and_then(|d| match d {
            Data::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
            _ => None,
        });
        let desc = path_range.get((r, 1)).and_then(|d| match d {
            Data::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
            _ => None,
        });
        let folder = path_range.get((r, 2)).and_then(|d| match d {
            Data::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
            _ => None,
        });

        if let (Some(g), Some(d), Some(f)) = (group, desc, folder) {
            tx.execute(
                "INSERT OR IGNORE INTO subfolder_mappings (category_group, description, folder) VALUES (?1, ?2, ?3)",
                params![g, d, f],
            )?;
            mapping_count += 1;
        }
    }

    // 2. dadosgerais
    {
        let range = workbook.worksheet_range("dadosgerais")?;
        let cols = get_col_map(&range);
        let mut count = 0;
        for r in 1..range.height() {
            let ano = get_cell(&range, &cols, r, "ano").and_then(parse_i64);
            if ano.is_none() {
                continue;
            }
            let tipo = get_cell(&range, &cols, r, "tipo").and_then(parse_string);
            let identifier = get_cell(&range, &cols, r, "identifier").and_then(parse_string);
            let file = get_cell(&range, &cols, r, "file").and_then(parse_string);
            let folder = get_cell(&range, &cols, r, "folder").and_then(parse_string);
            let descricao = get_cell(&range, &cols, r, "descricao").and_then(parse_string);
            let log = get_cell(&range, &cols, r, "log").and_then(parse_datetime);
            let path = relativize_path(
                get_cell(&range, &cols, r, "path")
                    .and_then(parse_string)
                    .as_deref(),
            );

            let (file, folder) = fix_file_folder(file, folder, path.as_deref());

            tx.execute(
                "INSERT INTO dadosgerais (ano, tipo, identifier, file, folder, descricao, log, path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![ano, tipo, identifier, file, folder, descricao, log, path],
            )?;
            count += 1;
        }
        category_counts.insert("dadosgerais".to_string(), count);
    }

    // 3. formação -> formacao
    {
        let range = workbook.worksheet_range("formação")?;
        let cols = get_col_map(&range);
        let mut count = 0;
        for r in 1..range.height() {
            let ano = get_cell(&range, &cols, r, "ano").and_then(parse_i64);
            if ano.is_none() {
                continue;
            }
            let tipo = get_cell(&range, &cols, r, "tipo").and_then(parse_string);
            let identifier = get_cell(&range, &cols, r, "identifier").and_then(parse_string);
            let file = get_cell(&range, &cols, r, "file").and_then(parse_string);
            let folder = get_cell(&range, &cols, r, "folder").and_then(parse_string);
            let descricao = get_cell(&range, &cols, r, "descricao").and_then(parse_string);
            let horas = get_cell(&range, &cols, r, "horas").and_then(parse_i64);
            let log = get_cell(&range, &cols, r, "log").and_then(parse_datetime);
            let path = relativize_path(
                get_cell(&range, &cols, r, "path")
                    .and_then(parse_string)
                    .as_deref(),
            );

            let (file, folder) = fix_file_folder(file, folder, path.as_deref());

            tx.execute(
                "INSERT INTO formacao (ano, tipo, identifier, file, folder, descricao, horas, log, path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![ano, tipo, identifier, file, folder, descricao, horas, log, path],
            )?;
            count += 1;
        }
        category_counts.insert("formacao".to_string(), count);
    }

    // 4. encargos
    {
        let range = workbook.worksheet_range("encargos")?;
        let cols = get_col_map(&range);
        let mut count = 0;
        for r in 1..range.height() {
            let ano = get_cell(&range, &cols, r, "ano").and_then(parse_i64);
            if ano.is_none() {
                continue;
            }
            let tipo = get_cell(&range, &cols, r, "tipo").and_then(parse_string);
            let identifier = get_cell(&range, &cols, r, "identifier").and_then(parse_string);
            let file = get_cell(&range, &cols, r, "file").and_then(parse_string);
            let folder = get_cell(&range, &cols, r, "folder").and_then(parse_string);
            let descricao = get_cell(&range, &cols, r, "descricao").and_then(parse_string);
            let horas = get_cell(&range, &cols, r, "horas").and_then(parse_i64);
            let log = get_cell(&range, &cols, r, "log").and_then(parse_datetime);
            let path = relativize_path(
                get_cell(&range, &cols, r, "path")
                    .and_then(parse_string)
                    .as_deref(),
            );

            let (file, folder) = fix_file_folder(file, folder, path.as_deref());

            tx.execute(
                "INSERT INTO atuacao (ano, tipo, instituicao, titulo, identifier, file, folder, descricao, horas, log, path)
                 VALUES (?1, ?2, 'UFSC', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![ano, tipo, descricao, identifier, file, folder, descricao, horas, log, path],
            )?;
            count += 1;
        }
        category_counts.insert("encargos".to_string(), count);
    }

    // 5. disciplinas
    {
        let range = workbook.worksheet_range("disciplinas")?;
        let cols = get_col_map(&range);
        let mut count = 0;
        for r in 1..range.height() {
            let ano = get_cell(&range, &cols, r, "ano").and_then(parse_i64);
            if ano.is_none() {
                continue;
            }
            let tipo = get_cell(&range, &cols, r, "tipo").and_then(parse_string);
            let curso = get_cell(&range, &cols, r, "curso").and_then(parse_string);
            let identifier = get_cell(&range, &cols, r, "identifier").and_then(parse_string);
            let file = get_cell(&range, &cols, r, "file").and_then(parse_string);
            let folder = get_cell(&range, &cols, r, "folder").and_then(parse_string);
            let disciplina = get_cell(&range, &cols, r, "disciplina").and_then(parse_string);
            let horas = get_cell(&range, &cols, r, "horas").and_then(parse_i64);
            let alunos = get_cell(&range, &cols, r, "alunos").and_then(parse_i64);
            let log = get_cell(&range, &cols, r, "log").and_then(parse_datetime);
            let path = relativize_path(
                get_cell(&range, &cols, r, "path")
                    .and_then(parse_string)
                    .as_deref(),
            );

            let (file, folder) = fix_file_folder(file, folder, path.as_deref());

            let desc = alunos
                .map(|a| format!("{} alunos", a))
                .or_else(|| disciplina.clone());
            tx.execute(
                "INSERT INTO atuacao (ano, tipo, instituicao, titulo, enquadramento, horas, descricao, identifier, file, folder, log, path)
                 VALUES (?1, ?2, ?3, ?4, 'Docente', ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![ano, tipo, curso, disciplina, horas, desc, identifier, file, folder, log, path],
            )?;
            count += 1;
        }
        category_counts.insert("disciplinas".to_string(), count);
    }

    // 6. projetos
    {
        let range = workbook.worksheet_range("projetos")?;
        let cols = get_col_map(&range);
        let mut count = 0;
        for r in 1..range.height() {
            let ano = get_cell(&range, &cols, r, "ano").and_then(parse_i64);
            if ano.is_none() {
                continue;
            }
            let tipo = get_cell(&range, &cols, r, "tipo").and_then(parse_string);
            let identifier = get_cell(&range, &cols, r, "identifier").and_then(parse_string);
            let file = get_cell(&range, &cols, r, "file").and_then(parse_string);
            let folder = get_cell(&range, &cols, r, "folder").and_then(parse_string);
            let descricao = get_cell(&range, &cols, r, "descricao").and_then(parse_string);
            let log = get_cell(&range, &cols, r, "log").and_then(parse_datetime);
            let path = relativize_path(
                get_cell(&range, &cols, r, "path")
                    .and_then(parse_string)
                    .as_deref(),
            );

            let (file, folder) = fix_file_folder(file, folder, path.as_deref());

            tx.execute(
                "INSERT INTO projetos (ano, tipo, identifier, file, folder, descricao, log, path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![ano, tipo, identifier, file, folder, descricao, log, path],
            )?;
            count += 1;
        }
        category_counts.insert("projetos".to_string(), count);
    }

    // 7. produções -> producoes
    {
        let range = workbook.worksheet_range("produções")?;
        let cols = get_col_map(&range);
        let mut count = 0;
        for r in 1..range.height() {
            let ano = get_cell(&range, &cols, r, "ano").and_then(parse_i64);
            if ano.is_none() {
                continue;
            }
            let tipo = get_cell(&range, &cols, r, "tipo").and_then(parse_string);
            let identifier = get_cell(&range, &cols, r, "identifier").and_then(parse_string);
            let file = get_cell(&range, &cols, r, "file").and_then(parse_string);
            let folder = get_cell(&range, &cols, r, "folder").and_then(parse_string);
            let titulo = get_cell(&range, &cols, r, "titulo").and_then(parse_string);
            let journal = get_cell(&range, &cols, r, "journal").and_then(parse_string);
            let qualis = get_cell(&range, &cols, r, "qualis").and_then(parse_qualis);
            let log = get_cell(&range, &cols, r, "log").and_then(parse_datetime);
            let path = relativize_path(
                get_cell(&range, &cols, r, "path")
                    .and_then(parse_string)
                    .as_deref(),
            );

            let (file, folder) = fix_file_folder(file, folder, path.as_deref());

            tx.execute(
                "INSERT INTO producoes (ano, tipo, identifier, file, folder, titulo, journal, qualis, log, path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![ano, tipo, identifier, file, folder, titulo, journal, qualis, log, path],
            )?;
            count += 1;
        }
        category_counts.insert("producoes".to_string(), count);
    }

    // 8. patentes
    {
        let range = workbook.worksheet_range("patentes")?;
        let cols = get_col_map(&range);
        let mut count = 0;
        for r in 1..range.height() {
            let ano = get_cell(&range, &cols, r, "ano").and_then(parse_i64);
            if ano.is_none() {
                continue;
            }
            let tipo = get_cell(&range, &cols, r, "tipo").and_then(parse_string);
            let identifier = get_cell(&range, &cols, r, "identifier").and_then(parse_string);
            let file = get_cell(&range, &cols, r, "file").and_then(parse_string);
            let folder = get_cell(&range, &cols, r, "folder").and_then(parse_string);
            let descricao = get_cell(&range, &cols, r, "descricao").and_then(parse_string);
            let log = get_cell(&range, &cols, r, "log").and_then(parse_datetime);
            let path = relativize_path(
                get_cell(&range, &cols, r, "path")
                    .and_then(parse_string)
                    .as_deref(),
            );

            let (file, folder) = fix_file_folder(file, folder, path.as_deref());

            tx.execute(
                "INSERT INTO patentes (ano, tipo, identifier, file, folder, descricao, log, path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![ano, tipo, identifier, file, folder, descricao, log, path],
            )?;
            count += 1;
        }
        category_counts.insert("patentes".to_string(), count);
    }

    // 9. eventos
    {
        let range = workbook.worksheet_range("eventos")?;
        let cols = get_col_map(&range);
        let mut count = 0;
        for r in 1..range.height() {
            let ano = get_cell(&range, &cols, r, "ano").and_then(parse_i64);
            if ano.is_none() {
                continue;
            }
            let tipo = get_cell(&range, &cols, r, "tipo").and_then(parse_string);
            let identifier = get_cell(&range, &cols, r, "identifier").and_then(parse_string);
            let file = get_cell(&range, &cols, r, "file").and_then(parse_string);
            let folder = get_cell(&range, &cols, r, "folder").and_then(parse_string);
            let descricao = get_cell(&range, &cols, r, "descricao").and_then(parse_string);
            let log = get_cell(&range, &cols, r, "log").and_then(parse_datetime);
            let path = relativize_path(
                get_cell(&range, &cols, r, "path")
                    .and_then(parse_string)
                    .as_deref(),
            );

            let (file, folder) = fix_file_folder(file, folder, path.as_deref());

            tx.execute(
                "INSERT INTO eventos (ano, tipo, identifier, file, folder, descricao, log, path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![ano, tipo, identifier, file, folder, descricao, log, path],
            )?;
            count += 1;
        }
        category_counts.insert("eventos".to_string(), count);
    }

    // 10. orientações -> orientacoes
    {
        let range = workbook.worksheet_range("orientações")?;
        let cols = get_col_map(&range);
        let mut count = 0;
        for r in 1..range.height() {
            let ano = get_cell(&range, &cols, r, "ano").and_then(parse_i64);
            if ano.is_none() {
                continue;
            }
            let tipo = get_cell(&range, &cols, r, "tipo").and_then(parse_string);
            let identifier = get_cell(&range, &cols, r, "identifier").and_then(parse_string);
            let file = get_cell(&range, &cols, r, "file").and_then(parse_string);
            let folder = get_cell(&range, &cols, r, "folder").and_then(parse_string);
            let aluno = get_cell(&range, &cols, r, "aluno").and_then(parse_string);
            let titulo = get_cell(&range, &cols, r, "titulo").and_then(parse_string);
            let log = get_cell(&range, &cols, r, "log").and_then(parse_datetime);
            let path = relativize_path(
                get_cell(&range, &cols, r, "path")
                    .and_then(parse_string)
                    .as_deref(),
            );

            let (file, folder) = fix_file_folder(file, folder, path.as_deref());

            tx.execute(
                "INSERT INTO orientacoes (ano, tipo, identifier, file, folder, aluno, titulo, log, path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![ano, tipo, identifier, file, folder, aluno, titulo, log, path],
            )?;
            count += 1;
        }
        category_counts.insert("orientacoes".to_string(), count);
    }

    // 11. bancas
    {
        let range = workbook.worksheet_range("bancas")?;
        let cols = get_col_map(&range);
        let mut count = 0;
        for r in 1..range.height() {
            let ano = get_cell(&range, &cols, r, "ano").and_then(parse_i64);
            if ano.is_none() {
                continue;
            }
            let tipo = get_cell(&range, &cols, r, "tipo").and_then(parse_string);
            let raw_path = get_cell(&range, &cols, r, "path").and_then(parse_string);
            let path = relativize_path(raw_path.as_deref());

            // Extract identifier fallback from path if empty
            let mut identifier = get_cell(&range, &cols, r, "identifier").and_then(parse_string);
            if identifier.is_none() || identifier.as_deref() == Some("") {
                if let Some(ref p_str) = raw_path {
                    let p = Path::new(p_str);
                    if let Some(fname) = p.file_name().and_then(|f| f.to_str()) {
                        identifier = Some(fname.to_string());
                    }
                }
            }

            let file = get_cell(&range, &cols, r, "file").and_then(parse_string);
            let folder = get_cell(&range, &cols, r, "folder").and_then(parse_string);
            let aluno = get_cell(&range, &cols, r, "aluno").and_then(parse_string);
            let titulo = get_cell(&range, &cols, r, "titulo").and_then(parse_string);
            let log = get_cell(&range, &cols, r, "log").and_then(parse_datetime);

            let (file, folder) = fix_file_folder(file, folder, path.as_deref());

            tx.execute(
                "INSERT INTO bancas (ano, tipo, identifier, file, folder, aluno, titulo, log, path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![ano, tipo, identifier, file, folder, aluno, titulo, log, path],
            )?;
            count += 1;
        }
        category_counts.insert("bancas".to_string(), count);
    }

    let total_records: usize = category_counts.values().sum();

    // Set metadata
    let now_str = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('last_migration_at', ?1)",
        params![now_str],
    )?;
    tx.execute(
        "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('imported_records', ?1)",
        params![total_records.to_string()],
    )?;
    tx.execute(
        "INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('imported_mappings', ?1)",
        params![mapping_count.to_string()],
    )?;

    // Commit transaction
    tx.commit()?;

    let duration = start_time.elapsed();

    Ok(MigrationReport {
        success: true,
        total_records,
        total_mappings: mapping_count,
        counts_per_category: category_counts.clone(),
        category_counts,
        warnings: Vec::new(),
        execution_time_ms: duration.as_millis(),
    })
}

/// Convenience alias without explicit root directory
pub fn migrate_workbook_simple(
    conn: &mut Connection,
    xlsm_path: &Path,
) -> Result<MigrationReport, Box<dyn std::error::Error>> {
    let root_dir = xlsm_path.parent().unwrap_or_else(|| Path::new("."));
    migrate_workbook(conn, xlsm_path, root_dir)
}

#[cfg(test)]
mod placeholder_tests {
    use super::fix_file_folder;

    #[test]
    fn placeholders_come_from_path() {
        let (f, d) = fix_file_folder(
            Some("file".into()),
            Some("folder".into()),
            Some(r"2_formacao\formacao_complementar\034_certificado-85023.pdf"),
        );
        assert_eq!(f.as_deref(), Some("034_certificado-85023.pdf"));
        assert_eq!(d.as_deref(), Some(r"2_formacao\formacao_complementar\"));
        let (f, d) = fix_file_folder(Some("file".into()), Some("folder".into()), None);
        assert_eq!((f, d), (None, None));
        assert!(crate::commands::valid_folder(
            r"5_producoes\artigos_completos\"
        ));
        assert!(!crate::commands::valid_folder("folder"));
    }
}
