use crate::db::models::*;
use crate::db::schema::{normalize_category, ENTITY_TABLES};
use rusqlite::{params, Connection, Result};
use serde_json::Value;
use std::collections::HashMap;

/// Tabela de uma categoria (nativa ou personalizada), para as colunas comuns a todas.
fn table_of(category: &str) -> Option<&'static str> {
    if crate::custom::is_custom(category) {
        Some("custom_records")
    } else {
        normalize_category(category)
    }
}

/// Preenche `url` nos registros: mantida como fallback quando `url` ainda não foi carregada.
pub fn fill_urls(conn: &Connection, category: &str, recs: &mut [RecordDto]) -> Result<()> {
    let Some(table) = table_of(category) else { return Ok(()) };
    if recs.is_empty() || recs.iter().all(|r| r.url.is_some()) {
        return Ok(());
    }
    let mut st = conn.prepare(&format!("SELECT id, url FROM {} WHERE url IS NOT NULL AND url <> ''", table))?;
    let urls: HashMap<i64, String> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_>>()?;
    for r in recs.iter_mut() {
        if r.url.is_none() {
            r.url = urls.get(&r.id).cloned();
        }
    }
    Ok(())
}

/// Grava a URL quando o payload traz a chave "url" (vazia = sem link).
fn store_url(conn: &Connection, category: &str, id: i64, data: &Value) -> Result<()> {
    if data.get("url").is_none() {
        return Ok(());
    }
    let table = table_of(category).ok_or(rusqlite::Error::InvalidQuery)?;
    conn.execute(&format!("UPDATE {} SET url = ?1 WHERE id = ?2", table), params![json_str(data, "url"), id])?;
    Ok(())
}

/// Fetches filtered records for a given category.
pub fn get_records(
    conn: &Connection,
    category: &str,
    search: Option<&str>,
    year: Option<i64>,
    tipo: Option<&str>,
) -> Result<Vec<RecordDto>> {
    if crate::custom::is_custom(category) {
        return crate::custom::list(conn, category, search, year, tipo);
    }
    let table = normalize_category(category).ok_or(rusqlite::Error::InvalidQuery)?;

    let mut out: Vec<RecordDto> = match table {
        "dadosgerais" => list_dadosgerais(conn, search, year, tipo)?.into_iter().map(Into::into).collect(),
        "formacao" => list_formacao(conn, search, year, tipo)?.into_iter().map(Into::into).collect(),
        "encargos" => list_encargos(conn, search, year, tipo)?.into_iter().map(Into::into).collect(),
        "disciplinas" => list_disciplinas(conn, search, year, tipo)?.into_iter().map(Into::into).collect(),
        "projetos" => list_projetos(conn, search, year, tipo)?.into_iter().map(Into::into).collect(),
        "producoes" => list_producoes(conn, search, year, tipo)?.into_iter().map(Into::into).collect(),
        "patentes" => list_patentes(conn, search, year, tipo)?.into_iter().map(Into::into).collect(),
        "eventos" => list_eventos(conn, search, year, tipo)?.into_iter().map(Into::into).collect(),
        "orientacoes" => list_orientacoes(conn, search, year, tipo)?.into_iter().map(Into::into).collect(),
        "bancas" => list_bancas(conn, search, year, tipo)?.into_iter().map(Into::into).collect(),
        _ => vec![],
    };
    populate_attachments_for_records(conn, table, &mut out)?;
    Ok(out)
}

pub fn list_dadosgerais(
    conn: &Connection,
    search: Option<&str>,
    year: Option<i64>,
    tipo: Option<&str>,
) -> Result<Vec<DadosGeraisRecord>> {
    let mut sql = "SELECT id, ano, tipo, identifier, file, folder, descricao, log, path, url FROM dadosgerais WHERE 1=1".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(y) = year {
        sql.push_str(" AND ano = ?");
        params_vec.push(Box::new(y));
    }
    if let Some(t) = tipo {
        sql.push_str(" AND tipo = ?");
        params_vec.push(Box::new(t.to_string()));
    }
    if let Some(s) = search {
        if !s.trim().is_empty() {
            sql.push_str(" AND (fold(descricao) LIKE ? OR fold(identifier) LIKE ?)");
            let pattern = format!("%{}%", crate::db::fold(s.trim()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }
    sql.push_str(" ORDER BY ano DESC, id DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_slice.as_slice(), DadosGeraisRecord::from_row)?;
    rows.collect()
}

pub fn list_formacao(
    conn: &Connection,
    search: Option<&str>,
    year: Option<i64>,
    tipo: Option<&str>,
) -> Result<Vec<FormacaoRecord>> {
    let mut sql = "SELECT id, ano, tipo, identifier, file, folder, descricao, horas, log, path, url FROM formacao WHERE 1=1".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(y) = year {
        sql.push_str(" AND ano = ?");
        params_vec.push(Box::new(y));
    }
    if let Some(t) = tipo {
        sql.push_str(" AND tipo = ?");
        params_vec.push(Box::new(t.to_string()));
    }
    if let Some(s) = search {
        if !s.trim().is_empty() {
            sql.push_str(" AND (fold(descricao) LIKE ? OR fold(identifier) LIKE ?)");
            let pattern = format!("%{}%", crate::db::fold(s.trim()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }
    sql.push_str(" ORDER BY ano DESC, id DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_slice.as_slice(), FormacaoRecord::from_row)?;
    rows.collect()
}

pub fn list_encargos(
    conn: &Connection,
    search: Option<&str>,
    year: Option<i64>,
    tipo: Option<&str>,
) -> Result<Vec<EncargosRecord>> {
    let mut sql = "SELECT id, ano, tipo, identifier, file, folder, descricao, horas, log, path, url FROM encargos WHERE 1=1".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(y) = year {
        sql.push_str(" AND ano = ?");
        params_vec.push(Box::new(y));
    }
    if let Some(t) = tipo {
        sql.push_str(" AND tipo = ?");
        params_vec.push(Box::new(t.to_string()));
    }
    if let Some(s) = search {
        if !s.trim().is_empty() {
            sql.push_str(" AND (fold(descricao) LIKE ? OR fold(identifier) LIKE ?)");
            let pattern = format!("%{}%", crate::db::fold(s.trim()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }
    sql.push_str(" ORDER BY ano DESC, id DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_slice.as_slice(), EncargosRecord::from_row)?;
    rows.collect()
}

pub fn list_disciplinas(
    conn: &Connection,
    search: Option<&str>,
    year: Option<i64>,
    tipo: Option<&str>,
) -> Result<Vec<DisciplinasRecord>> {
    let mut sql = "SELECT id, ano, tipo, curso, identifier, file, folder, disciplina, horas, alunos, log, path, url FROM disciplinas WHERE 1=1".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(y) = year {
        sql.push_str(" AND ano = ?");
        params_vec.push(Box::new(y));
    }
    if let Some(t) = tipo {
        sql.push_str(" AND tipo = ?");
        params_vec.push(Box::new(t.to_string()));
    }
    if let Some(s) = search {
        if !s.trim().is_empty() {
            sql.push_str(" AND (fold(disciplina) LIKE ? OR fold(curso) LIKE ? OR fold(identifier) LIKE ?)");
            let pattern = format!("%{}%", crate::db::fold(s.trim()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }
    sql.push_str(" ORDER BY ano DESC, id DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_slice.as_slice(), DisciplinasRecord::from_row)?;
    rows.collect()
}

pub fn list_projetos(
    conn: &Connection,
    search: Option<&str>,
    year: Option<i64>,
    tipo: Option<&str>,
) -> Result<Vec<ProjetosRecord>> {
    let mut sql = "SELECT id, ano, tipo, identifier, file, folder, descricao, log, path, url FROM projetos WHERE 1=1".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(y) = year {
        sql.push_str(" AND ano = ?");
        params_vec.push(Box::new(y));
    }
    if let Some(t) = tipo {
        sql.push_str(" AND tipo = ?");
        params_vec.push(Box::new(t.to_string()));
    }
    if let Some(s) = search {
        if !s.trim().is_empty() {
            sql.push_str(" AND (fold(descricao) LIKE ? OR fold(identifier) LIKE ?)");
            let pattern = format!("%{}%", crate::db::fold(s.trim()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }
    sql.push_str(" ORDER BY ano DESC, id DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_slice.as_slice(), ProjetosRecord::from_row)?;
    rows.collect()
}

pub fn list_producoes(
    conn: &Connection,
    search: Option<&str>,
    year: Option<i64>,
    tipo: Option<&str>,
) -> Result<Vec<ProducoesRecord>> {
    let mut sql = "SELECT id, ano, tipo, identifier, file, folder, titulo, journal, qualis, log, path, url, citations FROM producoes WHERE 1=1".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(y) = year {
        sql.push_str(" AND ano = ?");
        params_vec.push(Box::new(y));
    }
    if let Some(t) = tipo {
        sql.push_str(" AND tipo = ?");
        params_vec.push(Box::new(t.to_string()));
    }
    if let Some(s) = search {
        if !s.trim().is_empty() {
            sql.push_str(" AND (fold(titulo) LIKE ? OR fold(journal) LIKE ? OR fold(identifier) LIKE ?)");
            let pattern = format!("%{}%", crate::db::fold(s.trim()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }
    sql.push_str(" ORDER BY ano DESC, id DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_slice.as_slice(), ProducoesRecord::from_row)?;
    rows.collect()
}

pub fn list_patentes(
    conn: &Connection,
    search: Option<&str>,
    year: Option<i64>,
    tipo: Option<&str>,
) -> Result<Vec<PatentesRecord>> {
    let mut sql = "SELECT id, ano, tipo, identifier, file, folder, descricao, log, path, url FROM patentes WHERE 1=1".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(y) = year {
        sql.push_str(" AND ano = ?");
        params_vec.push(Box::new(y));
    }
    if let Some(t) = tipo {
        sql.push_str(" AND tipo = ?");
        params_vec.push(Box::new(t.to_string()));
    }
    if let Some(s) = search {
        if !s.trim().is_empty() {
            sql.push_str(" AND (fold(descricao) LIKE ? OR fold(identifier) LIKE ?)");
            let pattern = format!("%{}%", crate::db::fold(s.trim()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }
    sql.push_str(" ORDER BY ano DESC, id DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_slice.as_slice(), PatentesRecord::from_row)?;
    rows.collect()
}

pub fn list_eventos(
    conn: &Connection,
    search: Option<&str>,
    year: Option<i64>,
    tipo: Option<&str>,
) -> Result<Vec<EventosRecord>> {
    let mut sql = "SELECT id, ano, tipo, identifier, file, folder, descricao, log, path, url FROM eventos WHERE 1=1".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(y) = year {
        sql.push_str(" AND ano = ?");
        params_vec.push(Box::new(y));
    }
    if let Some(t) = tipo {
        sql.push_str(" AND tipo = ?");
        params_vec.push(Box::new(t.to_string()));
    }
    if let Some(s) = search {
        if !s.trim().is_empty() {
            sql.push_str(" AND (fold(descricao) LIKE ? OR fold(identifier) LIKE ?)");
            let pattern = format!("%{}%", crate::db::fold(s.trim()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }
    sql.push_str(" ORDER BY ano DESC, id DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_slice.as_slice(), EventosRecord::from_row)?;
    rows.collect()
}

pub fn list_orientacoes(
    conn: &Connection,
    search: Option<&str>,
    year: Option<i64>,
    tipo: Option<&str>,
) -> Result<Vec<OrientacoesRecord>> {
    let mut sql = "SELECT id, ano, tipo, identifier, file, folder, aluno, titulo, log, path, url FROM orientacoes WHERE 1=1".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(y) = year {
        sql.push_str(" AND ano = ?");
        params_vec.push(Box::new(y));
    }
    if let Some(t) = tipo {
        sql.push_str(" AND tipo = ?");
        params_vec.push(Box::new(t.to_string()));
    }
    if let Some(s) = search {
        if !s.trim().is_empty() {
            sql.push_str(" AND (fold(aluno) LIKE ? OR fold(titulo) LIKE ? OR fold(identifier) LIKE ?)");
            let pattern = format!("%{}%", crate::db::fold(s.trim()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }
    sql.push_str(" ORDER BY ano DESC, id DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_slice.as_slice(), OrientacoesRecord::from_row)?;
    rows.collect()
}

pub fn list_bancas(
    conn: &Connection,
    search: Option<&str>,
    year: Option<i64>,
    tipo: Option<&str>,
) -> Result<Vec<BancasRecord>> {
    let mut sql = "SELECT id, ano, tipo, identifier, file, folder, aluno, titulo, log, path, url FROM bancas WHERE 1=1".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(y) = year {
        sql.push_str(" AND ano = ?");
        params_vec.push(Box::new(y));
    }
    if let Some(t) = tipo {
        sql.push_str(" AND tipo = ?");
        params_vec.push(Box::new(t.to_string()));
    }
    if let Some(s) = search {
        if !s.trim().is_empty() {
            sql.push_str(" AND (fold(aluno) LIKE ? OR fold(titulo) LIKE ? OR fold(identifier) LIKE ?)");
            let pattern = format!("%{}%", crate::db::fold(s.trim()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern.clone()));
            params_vec.push(Box::new(pattern));
        }
    }
    sql.push_str(" ORDER BY ano DESC, id DESC");

    let params_slice: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_slice.as_slice(), BancasRecord::from_row)?;
    rows.collect()
}

/// Subfolder mapping queries
pub fn get_subfolder_mappings(conn: &Connection, group: Option<&str>) -> Result<Vec<SubfolderMapping>> {
    if let Some(g) = group {
        let mut stmt = conn.prepare("SELECT id, category_group, description, folder, created_at FROM subfolder_mappings WHERE category_group = ? ORDER BY description ASC")?;
        let rows = stmt.query_map(params![g], SubfolderMapping::from_row)?;
        rows.collect()
    } else {
        let mut stmt = conn.prepare("SELECT id, category_group, description, folder, created_at FROM subfolder_mappings ORDER BY category_group ASC, description ASC")?;
        let rows = stmt.query_map([], SubfolderMapping::from_row)?;
        rows.collect()
    }
}

pub fn add_subfolder_mapping(conn: &Connection, group: &str, description: &str, folder: &str) -> Result<SubfolderMapping> {
    conn.execute(
        "INSERT INTO subfolder_mappings (category_group, description, folder) VALUES (?1, ?2, ?3)",
        params![group, description, folder],
    )?;
    let id = conn.last_insert_rowid();
    Ok(SubfolderMapping {
        id,
        category_group: group.to_string(),
        description: description.to_string(),
        folder: folder.to_string(),
        created_at: None,
    })
}

/// App statistics
pub fn get_app_stats(conn: &Connection, db_path: &str) -> Result<AppStatsDto> {
    let mut counts = HashMap::new();
    let mut with_file = HashMap::new();
    let mut total_records: i64 = 0;

    for table in ENTITY_TABLES {
        let (count, wf): (i64, i64) = conn.query_row(
            &format!(
                "SELECT COUNT(*), COUNT(CASE WHEN path IS NOT NULL AND TRIM(path) <> '' THEN 1 END) FROM {}",
                table
            ),
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        counts.insert(table.to_string(), count);
        with_file.insert(table.to_string(), wf);
        total_records += count;
    }

    for (key, (count, wf)) in crate::custom::counts_with_files(conn) {
        total_records += count;
        counts.insert(key.clone(), count);
        with_file.insert(key, wf);
    }

    let total_mappings: i64 = conn.query_row("SELECT COUNT(*) FROM subfolder_mappings", [], |r| r.get(0))?;

    Ok(AppStatsDto {
        total_records,
        counts_by_category: counts,
        with_file_by_category: with_file,
        total_mappings,
        db_path: db_path.to_string(),
    })
}

pub fn json_str(val: &Value, key: &str) -> Option<String> {
    val.get(key).and_then(|v| match v {
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        _ => None,
    })
}

pub fn json_i64(val: &Value, key: &str) -> Option<i64> {
    val.get(key).and_then(|v| match v {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                t.parse::<i64>().ok()
            }
        }
        _ => None,
    })
}

pub fn get_record_by_id(conn: &Connection, category: &str, id: i64) -> Result<RecordDto> {
    if crate::custom::is_custom(category) {
        return crate::custom::get(conn, category, id);
    }
    let norm = normalize_category(category).ok_or(rusqlite::Error::InvalidQuery)?;
    let mut rec: RecordDto = match norm {
        "dadosgerais" => {
            let mut stmt = conn.prepare(
                "SELECT id, ano, tipo, identifier, file, folder, descricao, log, path, url FROM dadosgerais WHERE id = ?1",
            )?;
            stmt.query_row([id], DadosGeraisRecord::from_row).map(Into::into)?
        }
        "formacao" => {
            let mut stmt = conn.prepare(
                "SELECT id, ano, tipo, identifier, file, folder, descricao, horas, log, path, url FROM formacao WHERE id = ?1",
            )?;
            stmt.query_row([id], FormacaoRecord::from_row).map(Into::into)?
        }
        "encargos" => {
            let mut stmt = conn.prepare(
                "SELECT id, ano, tipo, identifier, file, folder, descricao, horas, log, path, url FROM encargos WHERE id = ?1",
            )?;
            stmt.query_row([id], EncargosRecord::from_row).map(Into::into)?
        }
        "disciplinas" => {
            let mut stmt = conn.prepare(
                "SELECT id, ano, tipo, curso, identifier, file, folder, disciplina, horas, alunos, log, path, url FROM disciplinas WHERE id = ?1",
            )?;
            stmt.query_row([id], DisciplinasRecord::from_row).map(Into::into)?
        }
        "projetos" => {
            let mut stmt = conn.prepare(
                "SELECT id, ano, tipo, identifier, file, folder, descricao, log, path, url FROM projetos WHERE id = ?1",
            )?;
            stmt.query_row([id], ProjetosRecord::from_row).map(Into::into)?
        }
        "producoes" => {
            let mut stmt = conn.prepare(
                "SELECT id, ano, tipo, identifier, file, folder, titulo, journal, qualis, log, path, url, citations FROM producoes WHERE id = ?1",
            )?;
            stmt.query_row([id], ProducoesRecord::from_row).map(Into::into)?
        }
        "patentes" => {
            let mut stmt = conn.prepare(
                "SELECT id, ano, tipo, identifier, file, folder, descricao, log, path, url FROM patentes WHERE id = ?1",
            )?;
            stmt.query_row([id], PatentesRecord::from_row).map(Into::into)?
        }
        "eventos" => {
            let mut stmt = conn.prepare(
                "SELECT id, ano, tipo, identifier, file, folder, descricao, log, path, url FROM eventos WHERE id = ?1",
            )?;
            stmt.query_row([id], EventosRecord::from_row).map(Into::into)?
        }
        "orientacoes" => {
            let mut stmt = conn.prepare(
                "SELECT id, ano, tipo, identifier, file, folder, aluno, titulo, log, path, url FROM orientacoes WHERE id = ?1",
            )?;
            stmt.query_row([id], OrientacoesRecord::from_row).map(Into::into)?
        }
        "bancas" => {
            let mut stmt = conn.prepare(
                "SELECT id, ano, tipo, identifier, file, folder, aluno, titulo, log, path, url FROM bancas WHERE id = ?1",
            )?;
            stmt.query_row([id], BancasRecord::from_row).map(Into::into)?
        }
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    populate_attachments_for_records(conn, norm, std::slice::from_mut(&mut rec))?;
    Ok(rec)
}

pub fn delete_record(conn: &Connection, category: &str, id: i64) -> Result<()> {
    let _ = conn.execute(
        "DELETE FROM record_attachments WHERE category = ?1 AND record_id = ?2",
        rusqlite::params![category, id],
    );
    if crate::custom::is_custom(category) {
        return crate::custom::delete(conn, category, id);
    }
    let table = normalize_category(category).ok_or(rusqlite::Error::InvalidQuery)?;
    conn.execute(&format!("DELETE FROM {} WHERE id = ?1", table), [id])?;
    Ok(())
}

pub fn insert_record(
    conn: &Connection,
    category: &str,
    data: &Value,
    attached_file: Option<String>,
    attached_path: Option<String>,
) -> Result<RecordDto> {
    if crate::custom::is_custom(category) {
        let rec = crate::custom::insert(conn, category, data, attached_file, attached_path)?;
        store_url(conn, category, rec.id, data)?;
        return get_record_by_id(conn, category, rec.id);
    }
    let table = normalize_category(category).ok_or(rusqlite::Error::InvalidQuery)?;
    let ano = json_i64(data, "ano");
    let tipo = json_str(data, "tipo");
    let folder = json_str(data, "folder");
    let file = attached_file.or_else(|| json_str(data, "file"));
    let path = attached_path.or_else(|| json_str(data, "path"));
    let identifier = json_str(data, "identifier").or_else(|| file.clone());
    let log = json_str(data, "log").or_else(|| Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()));

    match table {
        "dadosgerais" | "projetos" | "patentes" | "eventos" => {
            let descricao = json_str(data, "descricao");
            conn.execute(
                &format!(
                    "INSERT INTO {} (ano, tipo, identifier, file, folder, descricao, log, path) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    table
                ),
                params![ano, tipo, identifier, file, folder, descricao, log, path],
            )?;
        }
        "formacao" | "encargos" => {
            let descricao = json_str(data, "descricao");
            let horas = json_i64(data, "horas");
            conn.execute(
                &format!(
                    "INSERT INTO {} (ano, tipo, identifier, file, folder, descricao, horas, log, path) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    table
                ),
                params![ano, tipo, identifier, file, folder, descricao, horas, log, path],
            )?;
        }
        "disciplinas" => {
            let curso = json_str(data, "curso");
            let disciplina = json_str(data, "disciplina");
            let horas = json_i64(data, "horas");
            let alunos = json_i64(data, "alunos");
            conn.execute(
                "INSERT INTO disciplinas (ano, tipo, curso, identifier, file, folder, disciplina, horas, alunos, log, path) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![ano, tipo, curso, identifier, file, folder, disciplina, horas, alunos, log, path],
            )?;
        }
        "producoes" => {
            let titulo = json_str(data, "titulo");
            let journal = json_str(data, "journal");
            let qualis = json_str(data, "qualis");
            let citations = data.get("citations").and_then(|c| c.as_i64());
            conn.execute(
                "INSERT INTO producoes (ano, tipo, identifier, file, folder, titulo, journal, qualis, log, path, citations) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![ano, tipo, identifier, file, folder, titulo, journal, qualis, log, path, citations],
            )?;
        }
        "orientacoes" | "bancas" => {
            let aluno = json_str(data, "aluno");
            let titulo = json_str(data, "titulo");
            conn.execute(
                &format!(
                    "INSERT INTO {} (ano, tipo, identifier, file, folder, aluno, titulo, log, path) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    table
                ),
                params![ano, tipo, identifier, file, folder, aluno, titulo, log, path],
            )?;
        }
        _ => return Err(rusqlite::Error::InvalidQuery),
    }

    let id = conn.last_insert_rowid();
    if let Some(arr) = data.get("attachments") {
        if let Ok(atts) = serde_json::from_value::<Vec<AttachmentDto>>(arr.clone()) {
            let _ = sync_record_attachments(conn, table, id, &atts);
        }
    } else if file.is_some() || path.is_some() {
        let att = AttachmentDto {
            id: None,
            file: file.clone().unwrap_or_default(),
            path: path.clone().unwrap_or_default(),
            folder: folder.clone(),
            description: None,
            ord: Some(0),
        };
        let _ = sync_record_attachments(conn, table, id, &[att]);
    }

    store_url(conn, table, id, data)?;
    get_record_by_id(conn, table, id)
}

pub fn update_record(
    conn: &Connection,
    category: &str,
    id: i64,
    data: &Value,
    new_attached_file: Option<String>,
    new_attached_path: Option<String>,
) -> Result<RecordDto> {
    if crate::custom::is_custom(category) {
        crate::custom::update(conn, category, id, data, new_attached_file, new_attached_path)?;
        store_url(conn, category, id, data)?;
        return get_record_by_id(conn, category, id);
    }
    let table = normalize_category(category).ok_or(rusqlite::Error::InvalidQuery)?;
    let existing = get_record_by_id(conn, table, id)?;
    let has_new_attachment = new_attached_file.is_some() || new_attached_path.is_some();

    let ano = if data.get("ano").is_some() {
        json_i64(data, "ano")
    } else {
        existing.ano
    };
    let tipo = if data.get("tipo").is_some() {
        json_str(data, "tipo")
    } else {
        existing.tipo
    };
    let folder = if data.get("folder").is_some() {
        json_str(data, "folder")
    } else {
        existing.folder
    };
    let file = new_attached_file.or_else(|| {
        if data.get("file").is_some() {
            json_str(data, "file")
        } else {
            existing.file.clone()
        }
    });
    let path = new_attached_path.or_else(|| {
        if data.get("path").is_some() {
            json_str(data, "path")
        } else {
            existing.path
        }
    });
    let identifier = if data.get("identifier").is_some() {
        json_str(data, "identifier")
    } else if file.is_some() && existing.file != file {
        file.clone()
    } else {
        existing.identifier
    };
    let log = Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());

    match table {
        "dadosgerais" | "projetos" | "patentes" | "eventos" => {
            let descricao = if data.get("descricao").is_some() {
                json_str(data, "descricao")
            } else {
                existing.descricao
            };
            conn.execute(
                &format!(
                    "UPDATE {} SET ano = ?1, tipo = ?2, identifier = ?3, file = ?4, folder = ?5, descricao = ?6, log = ?7, path = ?8 WHERE id = ?9",
                    table
                ),
                params![ano, tipo, identifier, file, folder, descricao, log, path, id],
            )?;
        }
        "formacao" | "encargos" => {
            let descricao = if data.get("descricao").is_some() {
                json_str(data, "descricao")
            } else {
                existing.descricao
            };
            let horas = if data.get("horas").is_some() {
                json_i64(data, "horas")
            } else {
                existing.horas
            };
            conn.execute(
                &format!(
                    "UPDATE {} SET ano = ?1, tipo = ?2, identifier = ?3, file = ?4, folder = ?5, descricao = ?6, horas = ?7, log = ?8, path = ?9 WHERE id = ?10",
                    table
                ),
                params![ano, tipo, identifier, file, folder, descricao, horas, log, path, id],
            )?;
        }
        "disciplinas" => {
            let curso = if data.get("curso").is_some() {
                json_str(data, "curso")
            } else {
                existing.curso
            };
            let disciplina = if data.get("disciplina").is_some() {
                json_str(data, "disciplina")
            } else {
                existing.disciplina
            };
            let horas = if data.get("horas").is_some() {
                json_i64(data, "horas")
            } else {
                existing.horas
            };
            let alunos = if data.get("alunos").is_some() {
                json_i64(data, "alunos")
            } else {
                existing.alunos
            };
            conn.execute(
                "UPDATE disciplinas SET ano = ?1, tipo = ?2, curso = ?3, identifier = ?4, file = ?5, folder = ?6, disciplina = ?7, horas = ?8, alunos = ?9, log = ?10, path = ?11 WHERE id = ?12",
                params![ano, tipo, curso, identifier, file, folder, disciplina, horas, alunos, log, path, id],
            )?;
        }
        "producoes" => {
            let titulo = if data.get("titulo").is_some() {
                json_str(data, "titulo")
            } else {
                existing.titulo
            };
            let journal = if data.get("journal").is_some() {
                json_str(data, "journal")
            } else {
                existing.journal
            };
            let qualis = if data.get("qualis").is_some() {
                json_str(data, "qualis")
            } else {
                existing.qualis
            };
            let citations = if data.get("citations").is_some() {
                data.get("citations").and_then(|c| c.as_i64())
            } else {
                existing.citations
            };
            conn.execute(
                "UPDATE producoes SET ano = ?1, tipo = ?2, identifier = ?3, file = ?4, folder = ?5, titulo = ?6, journal = ?7, qualis = ?8, log = ?9, path = ?10, citations = ?11 WHERE id = ?12",
                params![ano, tipo, identifier, file, folder, titulo, journal, qualis, log, path, citations, id],
            )?;
        }
        "orientacoes" | "bancas" => {
            let aluno = if data.get("aluno").is_some() {
                json_str(data, "aluno")
            } else {
                existing.aluno
            };
            let titulo = if data.get("titulo").is_some() {
                json_str(data, "titulo")
            } else {
                existing.titulo
            };
            conn.execute(
                &format!(
                    "UPDATE {} SET ano = ?1, tipo = ?2, identifier = ?3, file = ?4, folder = ?5, aluno = ?6, titulo = ?7, log = ?8, path = ?9 WHERE id = ?10",
                    table
                ),
                params![ano, tipo, identifier, file, folder, aluno, titulo, log, path, id],
            )?;
        }
        _ => return Err(rusqlite::Error::InvalidQuery),
    }

    if let Some(arr) = data.get("attachments") {
        if let Ok(atts) = serde_json::from_value::<Vec<AttachmentDto>>(arr.clone()) {
            let _ = sync_record_attachments(conn, table, id, &atts);
        }
    } else if has_new_attachment {
        let att = AttachmentDto {
            id: None,
            file: file.clone().unwrap_or_default(),
            path: path.clone().unwrap_or_default(),
            folder: folder.clone(),
            description: None,
            ord: Some(0),
        };
        let _ = sync_record_attachments(conn, table, id, &[att]);
    }

    store_url(conn, table, id, data)?;
    get_record_by_id(conn, table, id)
}

// ==========================================
// Múltiplos comprovantes (record_attachments)
// ==========================================

pub fn get_attachments_for_record(
    conn: &Connection,
    category: &str,
    record_id: i64,
) -> Result<Vec<AttachmentDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, file, path, folder, description, ord FROM record_attachments WHERE category = ?1 AND record_id = ?2 ORDER BY ord ASC, id ASC"
    )?;
    let rows = stmt.query_map(params![category, record_id], |row| {
        Ok(AttachmentDto {
            id: Some(row.get(0)?),
            file: row.get(1)?,
            path: row.get(2)?,
            folder: row.get(3)?,
            description: row.get(4)?,
            ord: Some(row.get(5)?),
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn populate_attachments_for_records(
    conn: &Connection,
    category: &str,
    records: &mut [RecordDto],
) -> Result<()> {
    if records.is_empty() {
        return Ok(());
    }

    let mut stmt = match conn.prepare(
        "SELECT id, record_id, file, path, folder, description, ord FROM record_attachments WHERE category = ?1 ORDER BY ord ASC, id ASC"
    ) {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };

    let mut map: HashMap<i64, Vec<AttachmentDto>> = HashMap::new();
    let rows = stmt.query_map([category], |row| {
        let id: i64 = row.get(0)?;
        let record_id: i64 = row.get(1)?;
        let file: String = row.get(2)?;
        let path: String = row.get(3)?;
        let folder: Option<String> = row.get(4)?;
        let description: Option<String> = row.get(5)?;
        let ord: i64 = row.get(6)?;
        Ok((record_id, AttachmentDto {
            id: Some(id),
            file,
            path,
            folder,
            description,
            ord: Some(ord),
        }))
    })?;

    for r in rows.flatten() {
        map.entry(r.0).or_default().push(r.1);
    }

    for rec in records.iter_mut() {
        if let Some(atts) = map.remove(&rec.id) {
            if !atts.is_empty() {
                if rec.path.is_none() || rec.path.as_deref() == Some("") {
                    rec.path = Some(atts[0].path.clone());
                    rec.file = Some(atts[0].file.clone());
                    rec.folder = atts[0].folder.clone();
                }
                rec.attachments = atts;
                continue;
            }
        }
        // Fallback: se o registro tem path/file na linha principal mas ainda não na tabela de attachments
        if let Some(ref p) = rec.path {
            if !p.trim().is_empty() {
                rec.attachments = vec![AttachmentDto {
                    id: None,
                    file: rec.file.clone().unwrap_or_else(|| {
                        std::path::Path::new(p)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string()
                    }),
                    path: p.clone(),
                    folder: rec.folder.clone(),
                    description: None,
                    ord: Some(0),
                }];
            }
        }
    }

    Ok(())
}

pub fn sync_record_attachments(
    conn: &Connection,
    category: &str,
    record_id: i64,
    attachments: &[AttachmentDto],
) -> Result<()> {
    conn.execute(
        "DELETE FROM record_attachments WHERE category = ?1 AND record_id = ?2",
        params![category, record_id],
    )?;

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut stmt = conn.prepare(
        "INSERT INTO record_attachments (category, record_id, file, path, folder, description, ord, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
    )?;

    for (idx, att) in attachments.iter().enumerate() {
        let ord = att.ord.unwrap_or(idx as i64);
        stmt.execute(params![
            category,
            record_id,
            att.file,
            att.path,
            att.folder,
            att.description,
            ord,
            now
        ])?;
    }

    // Mantém sincronizada a primeira anotação na linha principal da tabela para compatibilidade retroativa
    let first = attachments.first();
    let first_file = first.map(|a| a.file.clone());
    let first_path = first.map(|a| a.path.clone());
    let first_folder = first.and_then(|a| a.folder.clone());

    if let Some(tbl) = normalize_category(category) {
        let _ = conn.execute(
            &format!("UPDATE {} SET file = ?1, path = ?2, folder = ?3 WHERE id = ?4", tbl),
            params![first_file, first_path, first_folder, record_id],
        );
    } else if crate::custom::is_custom(category) {
        let _ = conn.execute(
            "UPDATE custom_records SET file = ?1, path = ?2, folder = ?3 WHERE category = ?4 AND id = ?5",
            params![first_file, first_path, first_folder, category, record_id],
        );
    }

    Ok(())
}
