//! Registros: CRUD, edição em lote, subpastas, abrir arquivos e importação de planilha.

use super::*;

// ==========================================
// PURE IMPLEMENTATION FUNCTIONS (FOR TESTING & DIRECT USE)
// ==========================================

pub fn get_records_impl(
    db: &Mutex<Connection>,
    category: &str,
    search: Option<&str>,
    year: Option<i64>,
    tipo: Option<&str>,
) -> Result<Vec<RecordDto>, String> {
    let conn = db
        .lock()
        .map_err(|e| format!("Database lock failed: {}", e))?;
    queries::get_records(&conn, category, search, year, tipo)
        .map_err(|e| format!("Failed to get records: {}", e))
}

/// Pasta de comprovantes válida: `5_producoes\artigos_completos\` (não o marcador "folder").
pub fn valid_folder(f: &str) -> bool {
    let t = f.trim().trim_matches(|c| c == '\\' || c == '/');
    let first = t.split(['\\', '/']).next().unwrap_or("");
    !t.is_empty()
        && first
            .split_once('_')
            .map(|(n, _)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
            .unwrap_or(false)
}

/// Pasta de comprovantes válida que aponta para um subdiretório folha (pelo menos 2 níveis),
/// evitando que arquivos sejam salvos diretamente na pasta raiz da categoria (ex: `11_bancas\`).
pub fn valid_subfolder(f: &str) -> bool {
    let t = f.trim().trim_matches(|c| c == '\\' || c == '/');
    let parts: Vec<&str> = t.split(['\\', '/']).filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 {
        return false;
    }
    parts[0]
        .split_once('_')
        .map(|(n, _)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or(false)
}

/// Nome do grupo (subfolder_mappings.category_group) de uma categoria.
fn group_of(conn: &Connection, category: &str) -> Option<String> {
    if crate::custom::is_custom(category) {
        return conn
            .query_row(
                "SELECT name FROM custom_categories WHERE key = ?1",
                [category],
                |r| r.get(0),
            )
            .ok();
    }
    Some(
        match crate::db::schema::normalize_category(category)? {
            "dadosgerais" => "Dados gerais",
            "formacao" => "Formação",
            "atuacao" => "Atuação",
            "projetos" => "Projetos",
            "producoes" => "Produções",
            "patentes" => "Patentes",
            "inovacao" => "Inovação",
            "educacao_popularizacao" => "Educação e Popularização de C&T",
            "eventos" => "Eventos",
            "orientacoes" => "Orientações",
            "bancas" => "Bancas",
            "encargos" => "Encargos",
            "disciplinas" => "Disciplinas",
            _ => "Outros",
        }
        .to_string(),
    )
}

/// Garante uma pasta de destino real: a informada, a do registro, a do caminho atual
/// ou a da subcategoria (tipo). Corrige registros com o marcador "folder" da planilha
/// ou salvos equivocadamente na raiz da categoria.
pub(super) fn with_valid_folder(
    db: &Mutex<Connection>,
    category: &str,
    data: &Value,
    existing: Option<&RecordDto>,
) -> Result<Value, String> {
    let mut out = data.clone();
    let tipo = queries::json_str(data, "tipo").or_else(|| existing.and_then(|e| e.tipo.clone()));

    // 1. Se temos o tipo da categoria, a subpasta mapeada para ele em subfolder_mappings é prioritária
    if let Ok(conn) = db.lock() {
        if let Some(group) = group_of(&conn, category) {
            if let Some(ref t) = tipo {
                if let Ok(mapped_folder) = conn.query_row(
                    "SELECT folder FROM subfolder_mappings WHERE lower(category_group) = lower(?1) AND lower(description) = lower(?2) LIMIT 1",
                    rusqlite::params![group, t],
                    |r| r.get::<_, String>(0),
                ) {
                    if let Some(obj) = out.as_object_mut() {
                        obj.insert("folder".into(), Value::String(mapped_folder));
                    }
                    return Ok(out);
                }
            }
        }
    }

    // 2. Se a pasta informada já for uma subpasta válida (com subnível real), mantém
    if let Some(f) = queries::json_str(data, "folder") {
        if valid_subfolder(&f) {
            return Ok(out);
        }
    }

    // 3. Se o registro existente já tiver uma subpasta válida com subnível, mantém
    if let Some(e) = existing {
        if data.get("folder").is_none() && e.folder.as_deref().is_some_and(valid_subfolder) {
            return Ok(out);
        }
    }

    // 4. Tenta inferir pelo diretório do path existente
    let from_path = existing
        .and_then(|e| e.path.as_deref())
        .and_then(|p| {
            crate::files::to_db_rel(p)
                .rsplit_once('\\')
                .map(|(d, _)| format!("{}\\", d))
        })
        .filter(|d| valid_subfolder(d));

    // 5. Fallback para subfolder_mappings daquele grupo (primeira subpasta conhecida)
    let found = from_path.or_else(|| {
        let conn = db.lock().ok()?;
        let group = group_of(&conn, category)?;
        conn.query_row(
            "SELECT folder FROM subfolder_mappings WHERE lower(category_group) = lower(?1) ORDER BY CASE WHEN lower(description) = lower(?2) THEN 0 ELSE 1 END, id LIMIT 1",
            rusqlite::params![group, tipo.unwrap_or_default()],
            |r| r.get::<_, String>(0),
        )
        .ok()
    });

    if let (Some(f), Some(obj)) = (found, out.as_object_mut()) {
        obj.insert("folder".into(), Value::String(f));
        return Ok(out);
    }

    // 6. Último recurso: pasta de 1 nível se a categoria não possuir subpastas (ex: categoria customizada simples)
    if queries::json_str(data, "folder").is_some_and(|f| valid_folder(&f)) {
        return Ok(out);
    }

    Ok(out)
}

/// Link de um registro: só http(s). Sem esquema vira https://; DOI solto vira https://doi.org/….
pub fn normalize_url(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    let lower = s.to_ascii_lowercase();
    let full = if lower.starts_with("http://") || lower.starts_with("https://") {
        s.to_string()
    } else if lower.starts_with("10.") && s.contains('/') {
        format!("https://doi.org/{}", s)
    } else if lower.starts_with("doi:") {
        format!("https://doi.org/{}", s[4..].trim())
    } else if s
        .split(['/', '?', '#'])
        .next()
        .is_some_and(|h| h.contains(':'))
    {
        return Err(format!(
            "URL inválida: '{}'. Use um endereço http:// ou https://",
            s
        ));
    } else {
        format!("https://{}", s)
    };
    let host = full
        .split_once("://")
        .map(|(_, r)| r)
        .unwrap_or("")
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("");
    if full.contains(char::is_whitespace)
        || !host.contains('.')
        || host.starts_with('.')
        || host.ends_with('.')
    {
        return Err(format!("URL inválida: '{}'", s));
    }
    Ok(full)
}

/// Normaliza o campo "url" do payload (se presente); vazio vira null.
fn with_clean_url(data: &Value) -> Result<Value, String> {
    let mut out = data.clone();
    if let Some(v) = out.get_mut("url") {
        let s = v.as_str().unwrap_or("").trim().to_string();
        *v = if s.is_empty() {
            Value::Null
        } else {
            Value::String(normalize_url(&s)?)
        };
    }
    Ok(out)
}

pub fn create_record_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    category: &str,
    data: &Value,
    source_file: Option<&str>,
    source_files: Option<&[String]>,
) -> Result<RecordDto, String> {
    let data = &with_valid_folder(db, category, &with_clean_url(data)?, None)?;
    let mut files_to_attach: Vec<PathBuf> = Vec::new();

    if let Some(files) = source_files {
        for f in files {
            let s = f.trim();
            if !s.is_empty() {
                let p = PathBuf::from(s);
                if !p.exists() {
                    return Err(format!("Arquivo de origem não encontrado: '{}'", s));
                }
                files_to_attach.push(p);
            }
        }
    } else if let Some(src) = source_file {
        let src_trimmed = src.trim();
        if !src_trimmed.is_empty() {
            let src_path = PathBuf::from(src_trimmed);
            if !src_path.exists() {
                return Err(format!(
                    "Arquivo de origem não encontrado: '{}'",
                    src_trimmed
                ));
            }
            files_to_attach.push(src_path);
        }
    }

    let mut attached_file: Option<String> = None;
    let mut attached_path: Option<String> = None;
    let mut new_attachments: Vec<AttachmentDto> = Vec::new();

    if !files_to_attach.is_empty() {
        let folder_str = queries::json_str(data, "folder")
            .ok_or_else(|| "Subpasta de destino não informada no registro".to_string())?;

        let target_subfolder = crate::files::rel_join(root_dir, &folder_str);
        if !target_subfolder.exists() {
            std::fs::create_dir_all(&target_subfolder)
                .map_err(|e| format!("Falha ao criar subpasta '{:?}': {}", target_subfolder, e))?;
        }

        let base = crate::files::naming::record_base_name(category, data);

        for (idx, src_path) in files_to_attach.iter().enumerate() {
            let item_base = if files_to_attach.len() > 1 {
                base.as_ref().map(|b| format!("{}_{}", b, idx + 1))
            } else {
                base.clone()
            };
            let attachment = storage::save_attached_file_as(
                src_path,
                &target_subfolder,
                root_dir,
                item_base.as_deref(),
            )
            .map_err(|e| format!("Falha ao anexar arquivo: {}", e))?;

            if idx == 0 {
                attached_file = Some(attachment.filename.clone());
                attached_path = Some(attachment.relative_path.clone());
            }

            new_attachments.push(AttachmentDto {
                id: None,
                file: attachment.filename,
                path: attachment.relative_path,
                folder: Some(folder_str.clone()),
                description: None,
                ord: Some(idx as i64),
            });
        }
    }

    let mut data_clone = data.clone();
    if !new_attachments.is_empty() || data.get("attachments").is_some() {
        let mut existing_atts: Vec<AttachmentDto> = data
            .get("attachments")
            .and_then(|a| serde_json::from_value(a.clone()).ok())
            .unwrap_or_default();

        // Remove quaisquer anexos temporários que apontem para arquivos externos brutos
        // ou que correspondam aos arquivos de origem que acabaram de ser copiados para a pasta de destino.
        existing_atts.retain(|att| {
            let p = Path::new(&att.path);
            if p.is_absolute() {
                return false;
            }
            let att_norm = crate::files::to_db_rel(&att.path).to_lowercase();
            for src in &files_to_attach {
                let src_name = src
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if att.file.to_lowercase() == src_name {
                    return false;
                }
                if crate::files::path_to_db_rel(src).to_lowercase() == att_norm {
                    return false;
                }
            }
            true
        });

        let base_ord = existing_atts.len() as i64;
        for (i, mut a) in new_attachments.into_iter().enumerate() {
            a.ord = Some(base_ord + i as i64);
            existing_atts.push(a);
        }
        if let Some(obj) = data_clone.as_object_mut() {
            obj.insert(
                "attachments".to_string(),
                serde_json::to_value(&existing_atts).unwrap_or_default(),
            );
        }
    }

    let conn = db
        .lock()
        .map_err(|e| format!("Database lock failed: {}", e))?;
    queries::insert_record(&conn, category, &data_clone, attached_file, attached_path)
        .map_err(|e| format!("Falha ao inserir registro: {}", e))
}

pub fn update_record_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    category: &str,
    id: i64,
    data: &Value,
    new_source_file: Option<&str>,
    new_source_files: Option<&[String]>,
) -> Result<RecordDto, String> {
    let existing = {
        let conn = db
            .lock()
            .map_err(|e| format!("Database lock failed: {}", e))?;
        queries::get_record_by_id(&conn, category, id).ok()
    };
    let data = &with_valid_folder(db, category, &with_clean_url(data)?, existing.as_ref())?;

    let mut files_to_attach: Vec<PathBuf> = Vec::new();
    if let Some(files) = new_source_files {
        for f in files {
            let s = f.trim();
            if !s.is_empty() {
                let p = PathBuf::from(s);
                if !p.exists() {
                    return Err(format!("Novo arquivo de origem não encontrado: '{}'", s));
                }
                files_to_attach.push(p);
            }
        }
    } else if let Some(src) = new_source_file {
        let src_trimmed = src.trim();
        if !src_trimmed.is_empty() {
            let src_path = PathBuf::from(src_trimmed);
            if !src_path.exists() {
                return Err(format!(
                    "Novo arquivo de origem não encontrado: '{}'",
                    src_trimmed
                ));
            }
            files_to_attach.push(src_path);
        }
    }

    let mut attached_file: Option<String> = None;
    let mut attached_path: Option<String> = None;
    let mut new_attachments: Vec<AttachmentDto> = Vec::new();

    if !files_to_attach.is_empty() {
        let folder_str = if let Some(f) = queries::json_str(data, "folder") {
            f
        } else {
            let conn = db
                .lock()
                .map_err(|e| format!("Database lock failed: {}", e))?;
            let ex = queries::get_record_by_id(&conn, category, id)
                .map_err(|e| format!("Registro não encontrado: {}", e))?;
            ex.folder
                .ok_or_else(|| "Subpasta de destino não encontrada para o registro".to_string())?
        };

        let target_subfolder = crate::files::rel_join(root_dir, &folder_str);
        if !target_subfolder.exists() {
            std::fs::create_dir_all(&target_subfolder)
                .map_err(|e| format!("Falha ao criar subpasta '{:?}': {}", target_subfolder, e))?;
        }

        let merged = {
            let conn = db
                .lock()
                .map_err(|e| format!("Database lock failed: {}", e))?;
            let mut base = queries::get_record_by_id(&conn, category, id)
                .ok()
                .and_then(|r| serde_json::to_value(r).ok())
                .unwrap_or_else(|| Value::Object(Default::default()));
            if let (Some(b), Some(d)) = (base.as_object_mut(), data.as_object()) {
                for (k, v) in d {
                    b.insert(k.clone(), v.clone());
                }
            }
            base
        };
        let base = crate::files::naming::record_base_name(category, &merged);

        for (idx, src_path) in files_to_attach.iter().enumerate() {
            let item_base = if files_to_attach.len() > 1 {
                base.as_ref().map(|b| format!("{}_{}", b, idx + 1))
            } else {
                base.clone()
            };
            let attachment = storage::save_attached_file_as(
                src_path,
                &target_subfolder,
                root_dir,
                item_base.as_deref(),
            )
            .map_err(|e| format!("Falha ao salvar novo arquivo anexado: {}", e))?;

            if idx == 0 {
                attached_file = Some(attachment.filename.clone());
                attached_path = Some(attachment.relative_path.clone());
            }

            new_attachments.push(AttachmentDto {
                id: None,
                file: attachment.filename,
                path: attachment.relative_path,
                folder: Some(folder_str.clone()),
                description: None,
                ord: Some(idx as i64),
            });
        }
    }

    let mut data_clone = data.clone();
    if !new_attachments.is_empty() || data.get("attachments").is_some() {
        let mut existing_atts: Vec<AttachmentDto> = if let Some(arr) = data.get("attachments") {
            serde_json::from_value(arr.clone()).unwrap_or_default()
        } else {
            let conn = db
                .lock()
                .map_err(|e| format!("Database lock failed: {}", e))?;
            queries::get_attachments_for_record(&conn, category, id).unwrap_or_default()
        };

        // Remove quaisquer anexos temporários que apontem para arquivos externos brutos
        // ou que correspondam aos arquivos de origem que acabaram de ser copiados para a pasta de destino.
        existing_atts.retain(|att| {
            let p = Path::new(&att.path);
            if p.is_absolute() {
                return false;
            }
            let att_norm = crate::files::to_db_rel(&att.path).to_lowercase();
            for src in &files_to_attach {
                let src_name = src
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if att.file.to_lowercase() == src_name {
                    return false;
                }
                if crate::files::path_to_db_rel(src).to_lowercase() == att_norm {
                    return false;
                }
            }
            true
        });

        let base_ord = existing_atts.len() as i64;
        for (i, mut a) in new_attachments.into_iter().enumerate() {
            a.ord = Some(base_ord + i as i64);
            existing_atts.push(a);
        }
        if let Some(obj) = data_clone.as_object_mut() {
            obj.insert(
                "attachments".to_string(),
                serde_json::to_value(&existing_atts).unwrap_or_default(),
            );
        }
    }

    let conn = db
        .lock()
        .map_err(|e| format!("Database lock failed: {}", e))?;
    let res = queries::update_record(
        &conn,
        category,
        id,
        &data_clone,
        attached_file,
        attached_path,
    )
    .map_err(|e| format!("Falha ao atualizar registro: {}", e))?;
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);");
    Ok(res)
}

pub fn delete_record_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    category: &str,
    id: i64,
    delete_file: bool,
) -> Result<(), String> {
    let conn = db
        .lock()
        .map_err(|e| format!("Database lock failed: {}", e))?;

    if delete_file {
        if let Ok(rec) = queries::get_record_by_id(&conn, category, id) {
            if let Some(path_str) = rec.path {
                let trimmed = path_str.trim();
                if !trimmed.is_empty() {
                    if let Ok(full_path) = resolve_inside_root(root_dir, trimmed) {
                        if full_path.is_file() {
                            let _ = std::fs::remove_file(&full_path);
                        }
                    }
                }
            }
        }
    }

    queries::delete_record(&conn, category, id)
        .map_err(|e| format!("Falha ao excluir registro: {}", e))
}

fn validate_batch_category(conn: &Connection, category: &str) -> Result<String, String> {
    if crate::custom::is_custom(category) {
        let exists = conn
            .query_row(
                "SELECT 1 FROM custom_categories WHERE key = ?1",
                [category],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .is_some();
        if exists {
            return Ok(category.to_string());
        }
        return Err(format!("Categoria inválida: '{}'", category));
    }
    crate::db::schema::normalize_category(category)
        .map(str::to_string)
        .ok_or_else(|| format!("Categoria inválida: '{}'", category))
}

fn dedup_ids(ids: &[i64]) -> Vec<i64> {
    let mut seen = std::collections::HashSet::with_capacity(ids.len());
    ids.iter().copied().filter(|id| seen.insert(*id)).collect()
}

const ALLOWED_BATCH_COLUMNS: &[&str] = &[
    "ano",
    "ano_fim",
    "tipo",
    "instituicao",
    "titulo",
    "vinculo",
    "enquadramento",
    "horas",
    "semestres_ano",
    "horas_unidade",
    "semestre",
    "semestre_fim",
    "dedicacao_exclusiva",
    "vinculo_empregaticio",
    "descricao",
    "identifier",
    "journal",
    "qualis",
    "citations",
    "aluno",
    "curso",
    "disciplina",
    "alunos",
    "url",
    "folder",
];

pub fn batch_update_records_impl(
    db: &Mutex<Connection>,
    category: &str,
    ids: &[i64],
    ano: Option<i64>,
    tipo: Option<String>,
    qualis: Option<String>,
    data: Option<&serde_json::Value>,
) -> Result<usize, String> {
    let mut conn = db
        .lock()
        .map_err(|e| format!("Database lock failed: {}", e))?;
    let table = validate_batch_category(&conn, category)?;
    let unique_ids = dedup_ids(ids);
    if unique_ids.is_empty() {
        return Ok(0);
    }

    let is_cust = crate::custom::is_custom(&table);
    let table_cols: Vec<String> = if is_cust {
        ALLOWED_BATCH_COLUMNS
            .iter()
            .map(|s| s.to_string())
            .collect()
    } else {
        let mut pragma = conn
            .prepare(&format!("PRAGMA table_info({})", table))
            .map_err(|e| e.to_string())?;
        let rows = pragma
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let mut sets: Vec<String> = Vec::new();
    let mut base_params: Vec<rusqlite::types::Value> = Vec::new();

    // 1. Processa objeto data genérico (permite atualizar qualquer campo do cadastro)
    if let Some(obj) = data.and_then(|d| d.as_object()) {
        for (k, v) in obj {
            let col = k.to_lowercase();
            if !ALLOWED_BATCH_COLUMNS.contains(&col.as_str())
                || !table_cols.iter().any(|c| c.eq_ignore_ascii_case(&col))
            {
                continue;
            }
            if sets.iter().any(|s| s.starts_with(&format!("{} =", col))) {
                continue;
            }
            match v {
                serde_json::Value::Null => {
                    sets.push(format!("{} = ?", col));
                    base_params.push(rusqlite::types::Value::Null);
                }
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        sets.push(format!("{} = ?", col));
                        base_params.push(rusqlite::types::Value::Integer(i));
                    } else if let Some(f) = n.as_f64() {
                        sets.push(format!("{} = ?", col));
                        base_params.push(rusqlite::types::Value::Real(f));
                    }
                }
                serde_json::Value::String(s) => {
                    let trimmed = s.trim();
                    if trimmed.is_empty() {
                        sets.push(format!("{} = ?", col));
                        base_params.push(rusqlite::types::Value::Null);
                    } else {
                        sets.push(format!("{} = ?", col));
                        base_params.push(rusqlite::types::Value::Text(trimmed.to_string()));
                    }
                }
                _ => {}
            }
        }
    }

    // 2. Fallbacks diretos para ano, tipo e qualis
    if let Some(y) = ano {
        if !sets.iter().any(|s| s.starts_with("ano ="))
            && table_cols.iter().any(|c| c.eq_ignore_ascii_case("ano"))
        {
            sets.push("ano = ?".to_string());
            base_params.push(rusqlite::types::Value::Integer(y));
        }
    }
    if let Some(t) = tipo {
        let trimmed = t.trim().to_string();
        if !sets.iter().any(|s| s.starts_with("tipo ="))
            && table_cols.iter().any(|c| c.eq_ignore_ascii_case("tipo"))
        {
            sets.push("tipo = ?".to_string());
            base_params.push(if trimmed.is_empty() {
                rusqlite::types::Value::Null
            } else {
                rusqlite::types::Value::Text(trimmed)
            });
        }
    }
    let eff_qualis = if table == "producoes" { qualis } else { None };
    if let Some(q) = eff_qualis {
        let trimmed = q.trim().to_string();
        if !sets.iter().any(|s| s.starts_with("qualis ="))
            && table_cols.iter().any(|c| c.eq_ignore_ascii_case("qualis"))
        {
            sets.push("qualis = ?".to_string());
            base_params.push(if trimmed.is_empty() {
                rusqlite::types::Value::Null
            } else {
                rusqlite::types::Value::Text(trimmed)
            });
        }
    }

    if sets.is_empty() {
        return Ok(0);
    }

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    if table_cols.iter().any(|c| c.eq_ignore_ascii_case("log")) {
        sets.push("log = ?".to_string());
        base_params.push(rusqlite::types::Value::Text(now));
    }

    let sql = if is_cust {
        format!(
            "UPDATE custom_records SET {} WHERE category = ? AND id = ?",
            sets.join(", ")
        )
    } else {
        format!("UPDATE {} SET {} WHERE id = ?", table, sets.join(", "))
    };

    let tx = conn
        .transaction()
        .map_err(|e| format!("Falha ao iniciar transação: {}", e))?;
    let mut updated = 0usize;
    {
        let mut stmt = tx
            .prepare(&sql)
            .map_err(|e| format!("Falha ao preparar atualização em lote: {}", e))?;
        for id in unique_ids {
            let mut row_params = base_params.clone();
            if is_cust {
                row_params.push(rusqlite::types::Value::Text(table.clone()));
            }
            row_params.push(rusqlite::types::Value::Integer(id));
            updated += stmt
                .execute(rusqlite::params_from_iter(row_params))
                .map_err(|e| format!("Falha ao atualizar registro {}: {}", id, e))?;
        }
    }
    tx.commit()
        .map_err(|e| format!("Falha ao concluir transação: {}", e))?;
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);");
    Ok(updated)
}

/// Desvincula os comprovantes dos registros (anexos e caminho principal) sem apagar os arquivos,
/// que continuam na pasta. Devolve quantos registros tinham algum comprovante.
pub fn batch_unlink_attachments_impl(db: &Mutex<Connection>, category: &str, ids: &[i64]) -> Result<usize, String> {
    let unique_ids = dedup_ids(ids);
    let mut conn = db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
    let table = validate_batch_category(&conn, category)?;
    let is_cust = crate::custom::is_custom(&table);
    let tx = conn.transaction().map_err(|e| format!("Falha ao iniciar transação: {}", e))?;
    let mut count = 0usize;
    for id in unique_ids {
        let anexos = tx
            .execute(
                "DELETE FROM record_attachments WHERE category IN (?1, ?2) AND record_id = ?3",
                rusqlite::params![category, &table, id],
            )
            .map_err(|e| format!("Falha ao remover anexos do registro {}: {}", id, e))?;
        let principal = if is_cust {
            tx.execute(
                "UPDATE custom_records SET file = NULL, path = NULL WHERE category = ?1 AND id = ?2 AND (COALESCE(TRIM(path), '') <> '' OR COALESCE(TRIM(file), '') <> '')",
                rusqlite::params![&table, id],
            )
        } else {
            tx.execute(
                &format!(
                    "UPDATE {} SET file = NULL, path = NULL WHERE id = ?1 AND (COALESCE(TRIM(path), '') <> '' OR COALESCE(TRIM(file), '') <> '')",
                    table
                ),
                rusqlite::params![id],
            )
        }
        .map_err(|e| format!("Falha ao desvincular o registro {}: {}", id, e))?;
        if anexos + principal > 0 {
            count += 1;
        }
    }
    tx.commit().map_err(|e| format!("Falha ao gravar: {}", e))?;
    Ok(count)
}

pub fn batch_delete_records_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    category: &str,
    ids: &[i64],
    delete_files: bool,
) -> Result<usize, String> {
    let unique_ids = dedup_ids(ids);
    let (paths_to_delete, deleted) = {
        let mut conn = db
            .lock()
            .map_err(|e| format!("Database lock failed: {}", e))?;
        let table = validate_batch_category(&conn, category)?;
        if unique_ids.is_empty() {
            return Ok(0);
        }

        let is_cust = crate::custom::is_custom(&table);
        let select_sql = if is_cust {
            "SELECT path FROM custom_records WHERE category = ?1 AND id = ?2".to_string()
        } else {
            format!("SELECT path FROM {} WHERE id = ?1", table)
        };
        let delete_sql = if is_cust {
            "DELETE FROM custom_records WHERE category = ?1 AND id = ?2".to_string()
        } else {
            format!("DELETE FROM {} WHERE id = ?1", table)
        };

        let tx = conn
            .transaction()
            .map_err(|e| format!("Falha ao iniciar transação: {}", e))?;
        let mut collected_paths = Vec::new();
        let mut count = 0usize;
        {
            let mut sel_stmt = if delete_files {
                Some(
                    tx.prepare(&select_sql)
                        .map_err(|e| format!("Falha ao preparar consulta em lote: {}", e))?,
                )
            } else {
                None
            };
            let mut del_stmt = tx
                .prepare(&delete_sql)
                .map_err(|e| format!("Falha ao preparar exclusão em lote: {}", e))?;

            for id in unique_ids {
                if let Some(ref mut s) = sel_stmt {
                    let path_opt: Option<String> = if is_cust {
                        s.query_row(rusqlite::params![&table, id], |r| {
                            r.get::<_, Option<String>>(0)
                        })
                        .ok()
                        .flatten()
                    } else {
                        s.query_row(rusqlite::params![id], |r| r.get::<_, Option<String>>(0))
                            .ok()
                            .flatten()
                    };
                    if let Some(p) = path_opt {
                        let t = p.trim();
                        if !t.is_empty() {
                            collected_paths.push(t.to_string());
                        }
                    }
                }
                let n = if is_cust {
                    del_stmt.execute(rusqlite::params![&table, id])
                } else {
                    del_stmt.execute(rusqlite::params![id])
                }
                .map_err(|e| format!("Falha ao excluir registro {}: {}", id, e))?;
                // os anexos do registro excluído não podem ficar soltos no banco
                let _ = tx.execute(
                    "DELETE FROM record_attachments WHERE category IN (?1, ?2) AND record_id = ?3",
                    rusqlite::params![category, &table, id],
                );
                count += n;
            }
        }
        tx.commit()
            .map_err(|e| format!("Falha ao concluir transação: {}", e))?;
        (collected_paths, count)
    };

    if delete_files {
        let mut seen = std::collections::HashSet::new();
        for p in paths_to_delete {
            if !seen.insert(p.clone()) {
                continue;
            }
            if let Ok(full_path) = resolve_inside_root(root_dir, &p) {
                if full_path.is_file() {
                    let _ = std::fs::remove_file(&full_path);
                }
            }
        }
    }

    Ok(deleted)
}

pub fn get_subfolder_mappings_impl(
    db: &Mutex<Connection>,
    category_group: Option<&str>,
) -> Result<Vec<SubfolderMappingDto>, String> {
    let conn = db
        .lock()
        .map_err(|e| format!("Database lock failed: {}", e))?;
    let mappings = queries::get_subfolder_mappings(&conn, category_group)
        .map_err(|e| format!("Falha ao carregar mapeamentos de subpastas: {}", e))?;
    Ok(mappings.into_iter().map(Into::into).collect())
}

pub fn add_subfolder_mapping_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    category_group: &str,
    description: &str,
    folder: &str,
) -> Result<SubfolderMappingDto, String> {
    let clean_folder = crate::files::to_db_rel(folder.trim())
        .trim_start_matches('\\')
        .to_string();

    let full_dir = crate::files::rel_join(root_dir, &clean_folder);
    if !full_dir.exists() {
        let _ = std::fs::create_dir_all(&full_dir);
    }

    let conn = db
        .lock()
        .map_err(|e| format!("Database lock failed: {}", e))?;
    let mapping = queries::add_subfolder_mapping(&conn, category_group, description, &clean_folder)
        .map_err(|e| format!("Falha ao adicionar mapeamento de subpasta: {}", e))?;
    Ok(mapping.into())
}

pub fn open_file_impl(root_dir: &Path, relative_path: &str) -> Result<(), String> {
    let full_path = resolve_inside_root(root_dir, relative_path)?;
    shell::open_path(&full_path)
}

pub fn reveal_in_explorer_impl(root_dir: &Path, relative_path: &str) -> Result<(), String> {
    let full_path = resolve_inside_root(root_dir, relative_path)?;
    shell::reveal_in_explorer(&full_path)
}

pub fn open_folder_impl(root_dir: &Path, relative_path: &str) -> Result<(), String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() || trimmed == "." {
        shell::open_folder(root_dir)
    } else {
        let full_path = crate::files::rel_join(root_dir, trimmed);
        if !full_path.exists() {
            let _ = std::fs::create_dir_all(&full_path);
        }
        let full_path = resolve_inside_root(root_dir, trimmed)?;
        if !full_path.is_dir() {
            return Err(format!("Não é uma pasta: {}", full_path.display()));
        }
        shell::open_folder(&full_path)
    }
}

pub fn import_from_excel_impl(
    db: &Mutex<Connection>,
    root_dir: &Path,
    xlsm_path: Option<&str>,
) -> Result<MigrationReportDto, String> {
    let path = xlsm_path
        .map(PathBuf::from)
        .unwrap_or_else(|| root_dir.join("lattes.xlsm"));

    if !path.exists() {
        return Err(format!(
            "Arquivo Excel não encontrado em '{}'",
            path.display()
        ));
    }

    let mut conn = db
        .lock()
        .map_err(|e| format!("Database lock failed: {}", e))?;
    let report = calamine_importer::migrate_workbook(&mut conn, &path, root_dir)
        .map_err(|e| format!("Falha na migração do Excel: {}", e))?;

    Ok(MigrationReportDto {
        total_imported: report.total_records,
        counts_by_category: report.category_counts,
        total_mappings: report.total_mappings,
        warnings: report.warnings,
    })
}

pub fn get_app_stats_impl(db: &Mutex<Connection>, root_dir: &Path) -> Result<AppStatsDto, String> {
    let conn = db
        .lock()
        .map_err(|e| format!("Database lock failed: {}", e))?;
    let db_path = root_dir.join("lattes.db").to_string_lossy().to_string();
    queries::get_app_stats(&conn, &db_path)
        .map_err(|e| format!("Falha ao obter estatísticas: {}", e))
}

// ==========================================
// TAURI IPC COMMAND ENDPOINTS
// ==========================================

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command(async)]
pub fn get_records(
    state: tauri::State<'_, AppState>,
    category: String,
    search: Option<String>,
    year: Option<i64>,
    tipo: Option<String>,
) -> Result<Vec<RecordDto>, String> {
    get_records_impl(
        &state.db,
        &category,
        search.as_deref(),
        year,
        tipo.as_deref(),
    )
}

#[tauri::command(async)]
pub fn create_record(
    state: tauri::State<'_, AppState>,
    category: String,
    data: Value,
    source_file: Option<String>,
    source_files: Option<Vec<String>>,
) -> Result<RecordDto, String> {
    create_record_impl(
        &state.db,
        &state.root_dir,
        &category,
        &data,
        source_file.as_deref(),
        source_files.as_deref(),
    )
}

#[tauri::command(async)]
pub fn update_record(
    state: tauri::State<'_, AppState>,
    category: String,
    id: i64,
    data: Value,
    new_source_file: Option<String>,
    new_source_files: Option<Vec<String>>,
) -> Result<RecordDto, String> {
    update_record_impl(
        &state.db,
        &state.root_dir,
        &category,
        id,
        &data,
        new_source_file.as_deref(),
        new_source_files.as_deref(),
    )
}

#[tauri::command(async)]
pub fn add_record_attachment(
    state: tauri::State<'_, AppState>,
    category: String,
    record_id: i64,
    file_path: String,
    description: Option<String>,
) -> Result<RecordDto, String> {
    let p = Path::new(&file_path);
    if !p.exists() {
        return Err(format!("Arquivo não encontrado: '{}'", file_path));
    }
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("DB lock error: {}", e))?;
    let mut rec = queries::get_record_by_id(&conn, &category, record_id)
        .map_err(|e| format!("Registro não encontrado: {}", e))?;

    let folder_str = rec.folder.clone().unwrap_or_else(|| "outros".to_string());
    let target_subfolder = crate::files::rel_join(&state.root_dir, &folder_str);
    if !target_subfolder.exists() {
        let _ = std::fs::create_dir_all(&target_subfolder);
    }

    let json_rec = serde_json::to_value(&rec).unwrap_or(serde_json::Value::Null);
    let rec_base = crate::files::naming::record_base_name(&category, &json_rec)
        .unwrap_or_else(|| rec.identifier.clone().unwrap_or_else(|| "doc".to_string()));
    let base = format!("{}_{}", rec_base, rec.attachments.len() + 1);
    let att = storage::save_attached_file_as(p, &target_subfolder, &state.root_dir, Some(&base))
        .map_err(|e| format!("Falha ao salvar anexo: {}", e))?;

    let new_att = AttachmentDto {
        id: None,
        file: att.filename,
        path: att.relative_path,
        folder: Some(folder_str),
        description,
        ord: Some(rec.attachments.len() as i64),
    };
    rec.attachments.push(new_att);
    queries::sync_record_attachments(&conn, &category, record_id, &rec.attachments)
        .map_err(|e| format!("Falha ao sincronizar anexos: {}", e))?;

    queries::get_record_by_id(&conn, &category, record_id)
        .map_err(|e| format!("Falha ao recarregar registro: {}", e))
}

#[tauri::command(async)]
pub fn remove_record_attachment(
    state: tauri::State<'_, AppState>,
    category: String,
    record_id: i64,
    path: String,
    delete_file: bool,
) -> Result<RecordDto, String> {
    let conn = state
        .db
        .lock()
        .map_err(|e| format!("DB lock error: {}", e))?;
    let mut rec = queries::get_record_by_id(&conn, &category, record_id)
        .map_err(|e| format!("Registro não encontrado: {}", e))?;

    rec.attachments.retain(|a| a.path != path);
    queries::sync_record_attachments(&conn, &category, record_id, &rec.attachments)
        .map_err(|e| format!("Falha ao atualizar anexos: {}", e))?;

    if delete_file {
        let full = crate::files::rel_join(&state.root_dir, &path);
        let _ = std::fs::remove_file(full);
    }

    queries::get_record_by_id(&conn, &category, record_id)
        .map_err(|e| format!("Falha ao recarregar registro: {}", e))
}

#[tauri::command(async)]
pub fn delete_record(
    state: tauri::State<'_, AppState>,
    category: String,
    id: i64,
    delete_file: bool,
) -> Result<(), String> {
    delete_record_impl(&state.db, &state.root_dir, &category, id, delete_file)
}

#[tauri::command(async)]
pub fn batch_update_records(
    state: tauri::State<'_, AppState>,
    category: String,
    ids: Vec<i64>,
    ano: Option<i64>,
    tipo: Option<String>,
    qualis: Option<String>,
    data: Option<serde_json::Value>,
) -> Result<usize, String> {
    batch_update_records_impl(&state.db, &category, &ids, ano, tipo, qualis, data.as_ref())
}

#[tauri::command(async)]
pub fn batch_unlink_attachments(state: tauri::State<'_, AppState>, category: String, ids: Vec<i64>) -> Result<usize, String> {
    batch_unlink_attachments_impl(&state.db, &category, &ids)
}

#[tauri::command(async)]
pub fn batch_delete_records(
    state: tauri::State<'_, AppState>,
    category: String,
    ids: Vec<i64>,
    delete_files: bool,
) -> Result<usize, String> {
    batch_delete_records_impl(&state.db, &state.root_dir, &category, &ids, delete_files)
}

#[tauri::command(async)]
pub fn get_subfolder_mappings(
    state: tauri::State<'_, AppState>,
    category_group: Option<String>,
) -> Result<Vec<SubfolderMappingDto>, String> {
    get_subfolder_mappings_impl(&state.db, category_group.as_deref())
}

#[tauri::command(async)]
pub fn add_subfolder_mapping(
    state: tauri::State<'_, AppState>,
    category_group: String,
    description: String,
    folder: String,
) -> Result<SubfolderMappingDto, String> {
    add_subfolder_mapping_impl(
        &state.db,
        &state.root_dir,
        &category_group,
        &description,
        &folder,
    )
}

#[tauri::command]
pub fn select_source_file() -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("Selecionar Comprovante / Documento")
        .add_filter(
            "Documentos e Imagens",
            &[
                "pdf", "png", "jpg", "jpeg", "docx", "doc", "xlsx", "xls", "txt",
            ],
        )
        .add_filter("PDF (*.pdf)", &["pdf"])
        .add_filter("Imagens (*.png, *.jpg, *.jpeg)", &["png", "jpg", "jpeg"])
        .add_filter("Todos os Arquivos (*.*)", &["*"])
        .pick_file();

    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

/// Caminho que pode ser aberto no sistema: dentro da pasta do currículo (relativo ou
/// absoluto) ou um arquivo que o próprio app gravou para o usuário (relatório, planilha, backup).
pub fn resolve_for_shell(state: &AppState, path: &str) -> Result<PathBuf, String> {
    resolve_inside_root(&state.root_dir, path).or_else(|e| {
        let p = PathBuf::from(path.trim());
        if p.is_file() && state.is_saved(&p) {
            Ok(crate::real_path(&p))
        } else {
            Err(e)
        }
    })
}

#[tauri::command]
pub fn open_file(state: tauri::State<'_, AppState>, relative_path: String) -> Result<(), String> {
    shell::open_path(&resolve_for_shell(&state, &relative_path)?)
}

#[tauri::command]
pub fn reveal_in_explorer(
    state: tauri::State<'_, AppState>,
    relative_path: String,
) -> Result<(), String> {
    shell::reveal_in_explorer(&resolve_for_shell(&state, &relative_path)?)
}

#[tauri::command]
pub fn open_folder(state: tauri::State<'_, AppState>, relative_path: String) -> Result<(), String> {
    open_folder_impl(&state.root_dir, &relative_path)
}

#[tauri::command(async)]
pub fn import_from_excel(
    state: tauri::State<'_, AppState>,
    xlsm_path: Option<String>,
) -> Result<MigrationReportDto, String> {
    import_from_excel_impl(&state.db, &state.root_dir, xlsm_path.as_deref())
}
