//! Categorias criadas pelo usuário (ex.: "Prêmios", "Consultorias").
//!
//! Cada categoria tem uma chave `x_<slug>` e seus registros ficam na tabela única
//! `custom_records` (ano, tipo, título, descrição + campos de comprovante). As
//! subcategorias são as opções de "Tipo" (tabela `subfolder_mappings`, grupo = nome).

use crate::db::models::RecordDto;
use crate::db::queries::{json_i64, json_str};
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

pub const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS custom_categories (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    subtitle TEXT,
    folder TEXT NOT NULL,
    title_label TEXT,
    desc_label TEXT,
    position INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS custom_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    ano INTEGER,
    tipo TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    titulo TEXT,
    descricao TEXT,
    log TEXT,
    path TEXT
);
CREATE INDEX IF NOT EXISTS idx_custom_records_cat ON custom_records(category);
"#;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CustomCategory {
    #[serde(default)]
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub title_label: Option<String>,
    #[serde(default)]
    pub desc_label: Option<String>,
    #[serde(default)]
    pub position: i64,
    /// só na criação/edição: nomes das subcategorias (opções de Tipo)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tipos: Vec<String>,
    #[serde(default)]
    pub count: i64,
}

pub fn is_custom(category: &str) -> bool {
    category.starts_with("x_")
}

pub fn slug(s: &str) -> String {
    crate::files::naming::slugify(s, 40)
}

pub fn list_categories(conn: &Connection) -> Result<Vec<CustomCategory>> {
    let mut st = conn.prepare(
        "SELECT c.key, c.name, c.icon, c.subtitle, c.folder, c.title_label, c.desc_label, c.position,
                (SELECT COUNT(*) FROM custom_records r WHERE r.category = c.key)
         FROM custom_categories c ORDER BY c.position, c.created_at",
    )?;
    let rows = st.query_map([], |r| {
        Ok(CustomCategory {
            key: r.get(0)?,
            name: r.get(1)?,
            icon: r.get(2)?,
            subtitle: r.get(3)?,
            folder: r.get(4)?,
            title_label: r.get(5)?,
            desc_label: r.get(6)?,
            position: r.get::<_, Option<i64>>(7)?.unwrap_or(0),
            tipos: vec![],
            count: r.get(8)?,
        })
    })?;
    rows.collect()
}

pub fn keys(conn: &Connection) -> Vec<String> {
    list_categories(conn).map(|v| v.into_iter().map(|c| c.key).collect()).unwrap_or_default()
}

/// Próxima pasta numerada da raiz ("12_premios") quando o usuário não escolhe uma.
fn next_root_folder(root: &Path, name: &str) -> String {
    let max = crate::config::category_folders(root)
        .iter()
        .filter_map(|n| n.split('_').next()?.parse::<u32>().ok())
        .max()
        .unwrap_or(10)
        .max(10);
    format!("{}_{}", max + 1, slug(name))
}

/// Cria ou atualiza uma categoria (e acrescenta subcategorias novas).
pub fn save_category(conn: &Connection, root: &Path, mut c: CustomCategory) -> std::result::Result<CustomCategory, String> {
    let name = c.name.trim().to_string();
    if name.chars().filter(|ch| ch.is_alphanumeric()).count() < 2 {
        return Err("Informe um nome para a categoria".into());
    }
    let builtin = ["dados gerais", "formação", "formacao", "encargos", "disciplinas", "projetos", "produções", "producoes", "patentes", "eventos", "orientações", "orientacoes", "bancas"];
    if builtin.contains(&name.to_lowercase().as_str()) {
        return Err("Já existe uma categoria padrão com esse nome".into());
    }
    let existing: Option<(String, String)> = if c.key.is_empty() {
        None
    } else {
        conn.query_row("SELECT name, folder FROM custom_categories WHERE key = ?1", [&c.key], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(|e| e.to_string())?
    };
    let clash: Option<String> = conn
        .query_row("SELECT key FROM custom_categories WHERE lower(name) = lower(?1)", [&name], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if clash.as_deref().is_some_and(|k| k != c.key) {
        return Err("Já existe uma categoria com esse nome".into());
    }

    match existing {
        None => {
            let mut key = format!("x_{}", slug(&name));
            let mut n = 2;
            while conn.query_row("SELECT 1 FROM custom_categories WHERE key = ?1", [&key], |_| Ok(())).optional().map_err(|e| e.to_string())?.is_some() {
                key = format!("x_{}_{}", slug(&name), n);
                n += 1;
            }
            c.key = key;
            if c.folder.trim().is_empty() {
                c.folder = next_root_folder(root, &name);
            }
            let pos: i64 = conn.query_row("SELECT COALESCE(MAX(position), 0) + 1 FROM custom_categories", [], |r| r.get(0)).map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO custom_categories (key, name, icon, subtitle, folder, title_label, desc_label, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![c.key, name, c.icon, c.subtitle, c.folder.trim(), c.title_label, c.desc_label, pos],
            )
            .map_err(|e| e.to_string())?;
        }
        Some((old_name, old_folder)) => {
            if c.folder.trim().is_empty() {
                c.folder = old_folder;
            }
            conn.execute(
                "UPDATE custom_categories SET name = ?2, icon = ?3, subtitle = ?4, folder = ?5, title_label = ?6, desc_label = ?7 WHERE key = ?1",
                params![c.key, name, c.icon, c.subtitle, c.folder.trim(), c.title_label, c.desc_label],
            )
            .map_err(|e| e.to_string())?;
            if old_name != name {
                conn.execute("UPDATE subfolder_mappings SET category_group = ?2 WHERE category_group = ?1", params![old_name, name])
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    let folder = c.folder.trim().trim_end_matches('\\').to_string();
    let _ = std::fs::create_dir_all(crate::files::rel_join(root, &folder));
    // subcategorias: acrescenta as que ainda não existem (grupo = nome da categoria)
    let mut tipos: Vec<String> = c.tipos.iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
    let has_any: i64 = conn.query_row("SELECT COUNT(*) FROM subfolder_mappings WHERE category_group = ?1", [&name], |r| r.get(0)).map_err(|e| e.to_string())?;
    if tipos.is_empty() && has_any == 0 {
        tipos.push("Geral".into());
    }
    for t in tipos {
        let exists: Option<i64> = conn
            .query_row("SELECT id FROM subfolder_mappings WHERE category_group = ?1 AND lower(description) = lower(?2)", params![name, t], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            let sub = format!("{}\\{}", folder, slug(&t));
            let _ = std::fs::create_dir_all(crate::files::rel_join(root, &sub));
            conn.execute("INSERT INTO subfolder_mappings (category_group, description, folder) VALUES (?1, ?2, ?3)", params![name, t, sub])
                .map_err(|e| e.to_string())?;
        }
    }
    c.name = name;
    c.tipos.clear();
    Ok(c)
}

/// Exclui a categoria. Com registros, só se `force` (os arquivos no disco ficam).
pub fn delete_category(conn: &Connection, key: &str, force: bool) -> std::result::Result<(), String> {
    let name: String = conn
        .query_row("SELECT name FROM custom_categories WHERE key = ?1", [key], |r| r.get(0))
        .map_err(|_| "Categoria não encontrada".to_string())?;
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM custom_records WHERE category = ?1", [key], |r| r.get(0)).map_err(|e| e.to_string())?;
    if n > 0 && !force {
        return Err(format!("A categoria tem {} registro(s)", n));
    }
    conn.execute("DELETE FROM custom_records WHERE category = ?1", [key]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM subfolder_mappings WHERE category_group = ?1", [&name]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM custom_categories WHERE key = ?1", [key]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn reorder(conn: &Connection, keys: &[String]) -> Result<()> {
    for (i, k) in keys.iter().enumerate() {
        conn.execute("UPDATE custom_categories SET position = ?2 WHERE key = ?1", params![k, i as i64])?;
    }
    Ok(())
}

// ---------------- registros ----------------

fn row_to_dto(r: &rusqlite::Row) -> Result<RecordDto> {
    Ok(RecordDto {
        id: r.get(0)?,
        category: r.get(1)?,
        ano: r.get(2)?,
        tipo: r.get(3)?,
        identifier: r.get(4)?,
        file: r.get(5)?,
        folder: r.get(6)?,
        titulo: r.get(7)?,
        descricao: r.get(8)?,
        log: r.get(9)?,
        path: r.get(10)?,
        horas: None,
        curso: None,
        disciplina: None,
        alunos: None,
        journal: None,
        qualis: None,
        aluno: None,
    })
}

const COLS: &str = "id, category, ano, tipo, identifier, file, folder, titulo, descricao, log, path";

pub fn list(conn: &Connection, category: &str, search: Option<&str>, year: Option<i64>, tipo: Option<&str>) -> Result<Vec<RecordDto>> {
    let mut st = conn.prepare(&format!("SELECT {} FROM custom_records WHERE category = ?1 ORDER BY ano DESC, id DESC", COLS))?;
    let rows: Vec<RecordDto> = st.query_map([category], row_to_dto)?.collect::<Result<_>>()?;
    let s = search.map(|s| s.to_lowercase()).filter(|s| !s.trim().is_empty());
    Ok(rows
        .into_iter()
        .filter(|r| year.is_none_or(|y| r.ano == Some(y)))
        .filter(|r| tipo.is_none_or(|t| t.trim().is_empty() || r.tipo.as_deref() == Some(t)))
        .filter(|r| {
            s.as_ref().is_none_or(|s| {
                [&r.titulo, &r.descricao, &r.tipo, &r.identifier].iter().any(|f| f.as_ref().is_some_and(|v| v.to_lowercase().contains(s.as_str())))
            })
        })
        .collect())
}

pub fn get(conn: &Connection, category: &str, id: i64) -> Result<RecordDto> {
    conn.query_row(&format!("SELECT {} FROM custom_records WHERE category = ?1 AND id = ?2", COLS), params![category, id], row_to_dto)
}

fn now() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn insert(conn: &Connection, category: &str, data: &Value, file: Option<String>, path: Option<String>) -> Result<RecordDto> {
    let exists: Option<i64> = conn.query_row("SELECT 1 FROM custom_categories WHERE key = ?1", [category], |r| r.get(0)).optional()?;
    if exists.is_none() {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let file = file.or_else(|| json_str(data, "file"));
    let path = path.or_else(|| json_str(data, "path"));
    let identifier = json_str(data, "identifier").or_else(|| file.clone());
    conn.execute(
        "INSERT INTO custom_records (category, ano, tipo, identifier, file, folder, titulo, descricao, log, path) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![category, json_i64(data, "ano"), json_str(data, "tipo"), identifier, file, json_str(data, "folder"), json_str(data, "titulo"), json_str(data, "descricao"), now(), path],
    )?;
    get(conn, category, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, category: &str, id: i64, data: &Value, new_file: Option<String>, new_path: Option<String>) -> Result<RecordDto> {
    let e = get(conn, category, id)?;
    let pick_s = |k: &str, old: Option<String>| if data.get(k).is_some() { json_str(data, k) } else { old };
    let file = new_file.or_else(|| pick_s("file", e.file.clone()));
    let path = new_path.or_else(|| pick_s("path", e.path.clone()));
    let identifier = if data.get("identifier").is_some() {
        json_str(data, "identifier")
    } else if file.is_some() && e.file != file {
        file.clone()
    } else {
        e.identifier.clone()
    };
    let ano = if data.get("ano").is_some() { json_i64(data, "ano") } else { e.ano };
    conn.execute(
        "UPDATE custom_records SET ano = ?3, tipo = ?4, identifier = ?5, file = ?6, folder = ?7, titulo = ?8, descricao = ?9, log = ?10, path = ?11 WHERE category = ?1 AND id = ?2",
        params![
            category,
            id,
            ano,
            pick_s("tipo", e.tipo),
            identifier,
            file,
            pick_s("folder", e.folder),
            pick_s("titulo", e.titulo),
            pick_s("descricao", e.descricao),
            now(),
            path
        ],
    )?;
    get(conn, category, id)
}

pub fn delete(conn: &Connection, category: &str, id: i64) -> Result<()> {
    conn.execute("DELETE FROM custom_records WHERE category = ?1 AND id = ?2", params![category, id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn custom_category_roundtrip() {
        let conn = crate::db::open_in_memory().unwrap();
        let root = std::env::temp_dir().join("lattes_custom_test");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("11_bancas")).unwrap();
        let c = save_category(&conn, &root, CustomCategory { name: "Prêmios e Títulos".into(), tipos: vec!["Prêmio".into(), "Menção honrosa".into()], ..Default::default() }).unwrap();
        assert_eq!(c.key, "x_premios_e_titulos");
        assert_eq!(c.folder, "12_premios_e_titulos");
        assert!(root.join("12_premios_e_titulos").join("mencao_honrosa").is_dir());
        let maps: i64 = conn.query_row("SELECT COUNT(*) FROM subfolder_mappings WHERE category_group = 'Prêmios e Títulos'", [], |r| r.get(0)).unwrap();
        assert_eq!(maps, 2);

        let r = insert(&conn, &c.key, &json!({"ano": 2024, "tipo": "Prêmio", "titulo": "Melhor trabalho"}), None, None).unwrap();
        assert_eq!(r.category, c.key);
        let r = update(&conn, &c.key, r.id, &json!({"descricao": "SBMP"}), None, None).unwrap();
        assert_eq!(r.titulo.as_deref(), Some("Melhor trabalho"));
        assert_eq!(r.descricao.as_deref(), Some("SBMP"));
        assert_eq!(list(&conn, &c.key, Some("melhor"), None, None).unwrap().len(), 1);
        assert!(delete_category(&conn, &c.key, false).is_err());
        delete_category(&conn, &c.key, true).unwrap();
        assert!(list_categories(&conn).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
