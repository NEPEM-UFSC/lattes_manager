//! "Vassoura de Comprovantes" — Varredura inteligente de pastas externas (Downloads, Documentos...)
//! para encontrar arquivos PDF e vinculá-los automaticamente aos registros sem comprovante.

use crate::db::{queries, schema};
use crate::files::naming::fold;
use crate::migration::lattes_xml::normalize_title;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VassouraMatch {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub category: String,
    pub category_label: String,
    pub record_id: i64,
    pub record_title: String,
    pub record_year: Option<i64>,
    pub record_tipo: Option<String>,
    pub record_extra: Option<String>,
    pub suggested_folder: String,
    pub suggested_filename: String,
    pub score: u32,
    pub match_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VassouraApplyItem {
    pub file_path: String,
    pub category: String,
    pub record_id: i64,
    pub suggested_folder: String,
    pub suggested_filename: String,
}

#[derive(Debug, Default, Serialize)]
pub struct VassouraApplyResult {
    pub ok: usize,
    pub errors: Vec<String>,
}

fn category_label(cat: &str) -> String {
    match cat {
        "dadosgerais" => "Dados Gerais",
        "formacao" => "Formação Acadêmica",
        "encargos" => "Encargos e Funções",
        "disciplinas" => "Disciplinas Ministradas",
        "projetos" => "Projetos de Pesquisa/Extensão",
        "producoes" => "Produções Intelectuais",
        "patentes" => "Patentes e Registros",
        "inovacao" => "Inovação",
        "educacao_popularizacao" => "Educação e Popularização de C&T",
        "eventos" => "Participação em Eventos",
        "orientacoes" => "Orientações e Supervisões",
        "bancas" => "Bancas Examinadoras",
        "atuacao" => "Atuação Profissional",
        other => other,
    }
    .to_string()
}

/// Extrai tokens de texto normalizados (minúsculos, sem acentos, >=3 letras).
fn tokenize(text: &str) -> HashSet<String> {
    let mut flat = String::with_capacity(text.len());
    for c in text.chars() {
        if let Some(f) = fold(c) {
            flat.push_str(f);
        } else if c.is_ascii_alphanumeric() {
            flat.push(c.to_ascii_lowercase());
        } else {
            flat.push(' ');
        }
    }
    flat.split_whitespace()
        .filter(|w| w.len() >= 3 && w.len() <= 30)
        .map(String::from)
        .collect()
}

/// Extrai anos prováveis (1970..2030) de uma string de texto.
fn extract_years(text: &str) -> HashSet<i64> {
    let mut years = HashSet::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i + 4 <= chars.len() {
        if (i == 0 || !chars[i - 1].is_ascii_digit()) && (i + 4 == chars.len() || !chars[i + 4].is_ascii_digit()) {
            let slice: String = chars[i..i + 4].iter().collect();
            if let Ok(y) = slice.parse::<i64>() {
                if (1970..=2030).contains(&y) {
                    years.insert(y);
                }
            }
        }
        i += 1;
    }
    years
}

/// Estrutura para busca rápida de registros sem comprovante.
struct CandidateRecord {
    category: String,
    id: i64,
    ano: Option<i64>,
    tipo: Option<String>,
    titulo: String,
    extra: Option<String>,
    tokens: HashSet<String>,
    ideal_folder: String,
}

/// Lê subfolder_mappings para descobrir onde cada tipo é salvo por padrão.
fn load_folder_mappings(conn: &Connection) -> HashMap<(String, String), String> {
    let mut map = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT category_group, description, folder FROM subfolder_mappings") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        }) {
            for r in rows.flatten() {
                let cat_key = schema::normalize_category(&r.0)
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| r.0.to_lowercase());
                let tipo_norm = r.1.trim().to_lowercase();
                map.insert((cat_key, tipo_norm), r.2);
            }
        }
    }
    map
}

/// Varre a pasta externa informada procurando arquivos PDF e comparando com registros sem anexo.
pub fn scan_vassoura(conn: &Connection, root: &Path, external_dir: &Path) -> Result<Vec<VassouraMatch>, String> {
    if !external_dir.is_dir() {
        return Err(format!("A pasta '{}' não existe ou não é acessível.", external_dir.display()));
    }

    let folder_map = load_folder_mappings(conn);
    let all_cats = crate::tools::all_categories(conn);

    // 1. Carrega todos os registros sem comprovante do SQLite
    let mut candidates: Vec<CandidateRecord> = Vec::new();
    for cat in &all_cats {
        let recs = queries::get_records(conn, cat, None, None, None).map_err(|e| e.to_string())?;
        for r in recs {
            let has_file = r.path.as_deref().map(|p| !p.trim().is_empty()).unwrap_or(false);
            if has_file {
                continue;
            }
            let titulo = [&r.titulo, &r.descricao, &r.disciplina]
                .iter()
                .filter_map(|x| x.as_ref().filter(|s| !s.trim().is_empty()))
                .cloned()
                .next()
                .unwrap_or_default();

            if titulo.trim().is_empty() {
                continue;
            }

            let extra = [&r.aluno, &r.journal, &r.curso]
                .iter()
                .filter_map(|x| x.as_ref().filter(|s| !s.trim().is_empty()))
                .cloned()
                .next();

            let all_text = format!("{} {} {}", titulo, r.tipo.as_deref().unwrap_or(""), extra.as_deref().unwrap_or(""));
            let toks = tokenize(&all_text);

            // Determina subpasta ideal
            let tipo_str = r.tipo.clone().unwrap_or_default().trim().to_lowercase();
            let def_folder = folder_map
                .get(&(cat.clone(), tipo_str))
                .cloned()
                .unwrap_or_else(|| {
                    // Fallback para pasta padrão da categoria
                    crate::config::category_folders(root)
                        .into_iter()
                        .find(|f| f.to_lowercase().contains(&cat.to_lowercase()))
                        .unwrap_or_else(|| format!("{}_comprovantes", cat))
                });

            candidates.push(CandidateRecord {
                category: cat.clone(),
                id: r.id,
                ano: r.ano,
                tipo: r.tipo.clone(),
                titulo,
                extra,
                tokens: toks,
                ideal_folder: def_folder,
            });
        }
    }

    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    // 2. Coleta arquivos PDF na pasta externa (máx 400 arquivos)
    let mut pdf_files: Vec<PathBuf> = Vec::new();
    let mut stack = vec![external_dir.to_path_buf()];
    let mut depth = 0;
    while let Some(dir) = stack.pop() {
        if depth > 400 {
            break;
        }
        depth += 1;
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                // não entra em node_modules ou pastas ocultas
                let name = p.file_name().unwrap_or_default().to_string_lossy();
                if !name.starts_with('.') && name != "node_modules" && name != "target" {
                    stack.push(p);
                }
            } else if p.is_file() {
                if let Some(ext) = p.extension() {
                    if ext.eq_ignore_ascii_case("pdf") {
                        pdf_files.push(p);
                        if pdf_files.len() >= 350 {
                            break;
                        }
                    }
                }
            }
        }
        if pdf_files.len() >= 350 {
            break;
        }
    }

    // 3. Para cada PDF, extrai texto e calcula score contra os candidatos
    let mut matches = Vec::new();
    let mut matched_rec_ids: HashSet<(String, i64)> = HashSet::new();

    for pdf_path in pdf_files {
        let file_name = pdf_path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let meta = std::fs::metadata(&pdf_path).ok();
        let file_size = meta.as_ref().map(|m| m.len()).unwrap_or(0);

        // Se arquivo muito pequeno ou corrompido, pula
        if file_size < 1000 {
            continue;
        }

        // Extrai texto das primeiras páginas (protegido contra crash)
        let text = std::panic::catch_unwind(|| crate::classify::pdf_text(&pdf_path)).unwrap_or_default();
        let doc_tokens = tokenize(&text);
        let fn_tokens = tokenize(&file_name);
        let doc_years = extract_years(&text);
        let fn_years = extract_years(&file_name);

        let mut best_score = 0u32;
        let mut best_cand: Option<&CandidateRecord> = None;
        let mut best_reason = String::new();

        for cand in &candidates {
            if matched_rec_ids.contains(&(cand.category.clone(), cand.id)) {
                continue;
            }

            let mut score = 0u32;
            let mut reasons = Vec::new();

            // Intersecção de tokens com o título do registro
            if !cand.tokens.is_empty() {
                let hit_doc = cand.tokens.iter().filter(|t| doc_tokens.contains(*t)).count();
                let hit_fn = cand.tokens.iter().filter(|t| fn_tokens.contains(*t)).count();
                let total = cand.tokens.len();

                let doc_ratio = (hit_doc as f64) / (total as f64);
                let fn_ratio = (hit_fn as f64) / (total as f64);

                if fn_ratio >= 0.7 && cand.tokens.len() >= 3 {
                    score += 60;
                    reasons.push(format!("Nome do arquivo bate com o título ({:.0}%)", fn_ratio * 100.0));
                } else if fn_ratio >= 0.4 {
                    score += 35;
                    reasons.push(format!("Palavras no nome do arquivo ({:.0}%)", fn_ratio * 100.0));
                }

                if doc_ratio >= 0.75 {
                    score += 65;
                    reasons.push(format!("Texto do documento bate com o título ({:.0}%)", doc_ratio * 100.0));
                } else if doc_ratio >= 0.5 {
                    score += 45;
                    reasons.push(format!("Palavras do título no texto ({:.0}%)", doc_ratio * 100.0));
                } else if doc_ratio >= 0.3 && total >= 4 {
                    score += 25;
                }
            }

            // Bônus se o ano do registro está no documento ou no nome do arquivo
            if let Some(y) = cand.ano {
                if fn_years.contains(&y) {
                    score += 15;
                    reasons.push(format!("Ano {} no nome", y));
                } else if doc_years.contains(&y) {
                    score += 10;
                    reasons.push(format!("Ano {} no texto", y));
                }
            }

            // Bônus se aluno/orientando ou periódico está no documento
            if let Some(ref extra) = cand.extra {
                let extra_toks = tokenize(extra);
                if !extra_toks.is_empty() {
                    let hit_extra = extra_toks.iter().filter(|t| doc_tokens.contains(*t)).count();
                    if hit_extra >= 2 || (hit_extra == 1 && extra_toks.len() == 1) {
                        score += 20;
                        reasons.push(format!("Detalhe/Autor '{}' encontrado", extra));
                    }
                }
            }

            // Limita a 100%
            let final_score = score.min(100);

            if final_score >= 35 && final_score > best_score {
                best_score = final_score;
                best_cand = Some(cand);
                best_reason = reasons.join(" · ");
            }
        }

        if let Some(cand) = best_cand {
            if best_score >= 38 {
                // Monta nome sugerido de destino: "NNN_titulo_normalizado.pdf"
                let prefix = format!("{:03}", cand.id);
                let clean_title = normalize_title(&cand.titulo)
                    .chars()
                    .take(45)
                    .collect::<String>()
                    .trim_end_matches(['_', '-'])
                    .to_string();
                let clean_base = if clean_title.is_empty() {
                    format!("registro_{}", cand.id)
                } else {
                    clean_title
                };
                let suggested_filename = format!("{}_{}.pdf", prefix, clean_base);

                matches.push(VassouraMatch {
                    file_path: pdf_path.to_string_lossy().to_string(),
                    file_name,
                    file_size,
                    category: cand.category.clone(),
                    category_label: category_label(&cand.category),
                    record_id: cand.id,
                    record_title: cand.titulo.clone(),
                    record_year: cand.ano,
                    record_tipo: cand.tipo.clone(),
                    record_extra: cand.extra.clone(),
                    suggested_folder: cand.ideal_folder.clone(),
                    suggested_filename,
                    score: best_score,
                    match_reason: best_reason,
                });

                matched_rec_ids.insert((cand.category.clone(), cand.id));
            }
        }
    }

    // Ordena pelo score decrescente
    matches.sort_by(|a, b| b.score.cmp(&a.score));
    Ok(matches)
}

/// Aplica as vinculações selecionadas (copiando ou movendo os arquivos para as pastas do Lattes).
pub fn apply_vassoura(
    conn: &Connection,
    root: &Path,
    items: &[VassouraApplyItem],
    move_files: bool,
) -> Result<VassouraApplyResult, String> {
    let mut res = VassouraApplyResult::default();

    for it in items {
        let from_path = Path::new(&it.file_path);
        if !from_path.is_file() {
            res.errors.push(format!("Arquivo não encontrado: {}", it.file_path));
            continue;
        }

        // Subpasta de destino
        let clean_folder = it.suggested_folder.replace('/', "\\").trim_matches('\\').to_string();
        let target_dir = root.join(&clean_folder);
        if let Err(e) = std::fs::create_dir_all(&target_dir) {
            res.errors.push(format!("Falha ao criar pasta '{}': {}", clean_folder, e));
            continue;
        }

        // Garante nome único de destino
        let mut target_name = it.suggested_filename.clone();
        let mut target_file = target_dir.join(&target_name);
        let mut counter = 2;
        let stem = Path::new(&it.suggested_filename)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "comprovante".into());

        while target_file.exists() && target_file != from_path {
            target_name = format!("{}_{}.pdf", stem, counter);
            target_file = target_dir.join(&target_name);
            counter += 1;
        }

        // Copia ou move
        let transfer_ok = if move_files {
            match std::fs::rename(from_path, &target_file) {
                Ok(_) => true,
                Err(_) => {
                    // Fallback para cross-device move (ex: C:\ para D:\)
                    if std::fs::copy(from_path, &target_file).is_ok() {
                        let _ = std::fs::remove_file(from_path);
                        true
                    } else {
                        false
                    }
                }
            }
        } else {
            std::fs::copy(from_path, &target_file).is_ok()
        };

        if !transfer_ok {
            res.errors.push(format!("Não foi possível transferir '{}' para '{}'.", it.file_name(), target_file.display()));
            continue;
        }

        // Calcula caminho relativo: "pasta\arquivo.pdf"
        let rel_path = format!("{}\\{}", clean_folder, target_name);

        // Atualiza banco SQLite
        let table = match schema::normalize_category(&it.category) {
            Some(t) => t.to_string(),
            None => {
                if crate::custom::is_custom(&it.category) {
                    "custom_records".to_string()
                } else {
                    res.errors.push(format!("Categoria inválida: {}", it.category));
                    continue;
                }
            }
        };

        let is_custom = table == "custom_records";
        let sql = if is_custom {
            format!("UPDATE {} SET file = ?1, path = ?2 WHERE id = ?3 AND category = ?4", table)
        } else {
            format!("UPDATE {} SET file = ?1, path = ?2 WHERE id = ?3", table)
        };

        let db_res = if is_custom {
            conn.execute(&sql, params![target_name, rel_path, it.record_id, it.category])
        } else {
            conn.execute(&sql, params![target_name, rel_path, it.record_id])
        };

        match db_res {
            Ok(n) if n > 0 => res.ok += 1,
            Ok(_) => res.errors.push(format!("Registro #{} não encontrado no banco", it.record_id)),
            Err(e) => res.errors.push(format!("Erro ao atualizar registro #{}: {}", it.record_id, e)),
        }
    }

    Ok(res)
}

impl VassouraApplyItem {
    fn file_name(&self) -> String {
        Path::new(&self.file_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| self.file_path.clone())
    }
}
