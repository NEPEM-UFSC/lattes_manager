use std::collections::{HashMap, HashSet};
use std::time::Duration;

use regex::Regex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::doi::parse_doi;
use crate::files::linker::{dice, trigrams};
use crate::migration::lattes_xml::normalize_title;

const UA: &str = concat!(
    "LattesManager/",
    env!("CARGO_PKG_VERSION"),
    " (gerenciador de curriculo; mailto:lattesmanager@ufsc.br)"
);

fn agent(secs: u64) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(secs))
        .redirects(6)
        .build()
}

// ==========================================
// MÉTRICAS OPENALEX (API ABERTA / GRATUITA)
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DbProdDoiRow {
    pub id: i64,
    pub ano: Option<i64>,
    pub titulo: String,
    pub journal: Option<String>,
    pub citations: Option<i64>,
    pub doi: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenAlexParsedWork {
    pub doi: String,
    pub title: Option<String>,
    pub year: Option<i64>,
    pub cited_by_count: i64,
    pub oa_status: Option<String>,
    pub oa_pdf_url: Option<String>,
    pub journal: Option<String>,
    pub issn: Option<String>,
    pub authors: Vec<String>,
    pub institutions: Vec<String>,
    pub counts_by_year: Vec<(i64, i64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenAlexWorkItem {
    pub id: i64,
    pub titulo: String,
    pub ano: Option<i64>,
    pub doi: String,
    pub journal: Option<String>,
    pub issn: Option<String>,
    pub citations_before: Option<i64>,
    pub citations_after: i64,
    pub oa_status: Option<String>,
    pub oa_pdf_url: Option<String>,
    pub authors: Vec<String>,
    pub institutions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct OpenAlexCollaborator {
    pub name: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct OpenAlexYearlyCitation {
    pub year: i64,
    pub citations: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenAlexSyncReport {
    pub total_with_doi: usize,
    pub matched_count: usize,
    pub updated_citations_count: usize,
    pub total_citations: i64,
    pub h_index: i64,
    pub i10_index: i64,
    pub oa_counts: HashMap<String, usize>,
    pub yearly_citations: Vec<OpenAlexYearlyCitation>,
    pub top_coauthors: Vec<OpenAlexCollaborator>,
    pub top_institutions: Vec<OpenAlexCollaborator>,
    pub items: Vec<OpenAlexWorkItem>,
    pub errors: Vec<String>,
    pub synced_at: String,
}

/// Carrega todas as produções que possuem DOI válido (em `identifier` ou `url`).
pub fn load_producoes_with_doi(conn: &Connection) -> Result<Vec<DbProdDoiRow>, String> {
    let mut stmt = conn
        .prepare("SELECT id, ano, titulo, journal, citations, identifier, url FROM producoes")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<i64>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows.flatten() {
        let (id, ano, titulo, journal, citations, identifier, url) = row;
        let doi_opt = identifier
            .as_deref()
            .and_then(parse_doi)
            .or_else(|| url.as_deref().and_then(parse_doi));
        if let Some(d) = doi_opt {
            out.push(DbProdDoiRow {
                id,
                ano,
                titulo: titulo.unwrap_or_default(),
                journal,
                citations,
                doi: d.to_ascii_lowercase(),
            });
        }
    }
    Ok(out)
}

/// Faz parse da resposta JSON de `/works` da API OpenAlex.
pub fn parse_openalex_works_json(val: &Value) -> HashMap<String, OpenAlexParsedWork> {
    let mut map = HashMap::new();
    let Some(results) = val.get("results").and_then(|r| r.as_array()) else {
        return map;
    };

    for w in results {
        let Some(doi_raw) = w.get("doi").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(doi_norm) = parse_doi(doi_raw).map(|s| s.to_ascii_lowercase()) else {
            continue;
        };

        let title = w
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let year = w.get("publication_year").and_then(|v| v.as_i64());
        let cited_by_count = w
            .get("cited_by_count")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        let oa_status = w
            .pointer("/open_access/oa_status")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty());

        let oa_pdf_url = w
            .pointer("/best_oa_location/pdf_url")
            .and_then(|v| v.as_str())
            .or_else(|| {
                w.pointer("/primary_location/pdf_url")
                    .and_then(|v| v.as_str())
            })
            .or_else(|| w.pointer("/open_access/oa_url").and_then(|v| v.as_str()))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let journal = w
            .pointer("/primary_location/source/display_name")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let issn = w
            .pointer("/primary_location/source/issn_l")
            .and_then(|v| v.as_str())
            .or_else(|| {
                w.pointer("/primary_location/source/issn/0")
                    .and_then(|v| v.as_str())
            })
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let mut authors = Vec::new();
        let mut institutions = Vec::new();
        let mut seen_inst = HashSet::new();
        if let Some(auths) = w.get("authorships").and_then(|v| v.as_array()) {
            for a in auths {
                if let Some(name) = a.pointer("/author/display_name").and_then(|v| v.as_str()) {
                    let clean = name.trim().to_string();
                    if !clean.is_empty() {
                        authors.push(clean);
                    }
                }
                if let Some(insts) = a.get("institutions").and_then(|v| v.as_array()) {
                    for inst in insts {
                        if let Some(iname) = inst.get("display_name").and_then(|v| v.as_str()) {
                            let clean = iname.trim().to_string();
                            if !clean.is_empty() && seen_inst.insert(clean.to_ascii_lowercase()) {
                                institutions.push(clean);
                            }
                        }
                    }
                }
            }
        }

        let mut counts_by_year = Vec::new();
        if let Some(cby) = w.get("counts_by_year").and_then(|v| v.as_array()) {
            for entry in cby {
                if let (Some(y), Some(c)) = (
                    entry.get("year").and_then(|v| v.as_i64()),
                    entry.get("cited_by_count").and_then(|v| v.as_i64()),
                ) {
                    counts_by_year.push((y, c));
                }
            }
        }

        map.insert(
            doi_norm.clone(),
            OpenAlexParsedWork {
                doi: doi_norm,
                title,
                year,
                cited_by_count,
                oa_status,
                oa_pdf_url,
                journal,
                issn,
                authors,
                institutions,
                counts_by_year,
            },
        );
    }

    map
}

/// Consulta a API pública do OpenAlex em lotes de até 40 DOIs por requisição.
pub fn fetch_openalex_for_dois(
    dois: &[String],
) -> (HashMap<String, OpenAlexParsedWork>, Vec<String>) {
    let mut seen = HashSet::new();
    let unique: Vec<String> = dois
        .iter()
        .map(|d| d.trim().to_ascii_lowercase())
        .filter(|d| !d.is_empty() && seen.insert(d.clone()))
        .collect();

    let mut all_works = HashMap::new();
    let mut errors = Vec::new();
    if unique.is_empty() {
        return (all_works, errors);
    }

    let http = agent(20);
    for (idx, chunk) in unique.chunks(40).enumerate() {
        let joined: String = chunk
            .iter()
            .map(|d| format!("https://doi.org/{}", d))
            .collect::<Vec<_>>()
            .join("|");
        let url = format!(
            "https://api.openalex.org/works?filter=doi:{}&per-page=50&mailto=lattesmanager@ufsc.br&select=doi,title,publication_year,cited_by_count,open_access,best_oa_location,primary_location,authorships,counts_by_year",
            joined
        );
        match http.get(&url).set("User-Agent", UA).call() {
            Ok(resp) => match resp.into_json::<Value>() {
                Ok(val) => {
                    all_works.extend(parse_openalex_works_json(&val));
                }
                Err(e) => errors.push(format!("Lote {}: resposta JSON inválida ({})", idx + 1, e)),
            },
            Err(ureq::Error::Status(code, _)) => {
                errors.push(format!(
                    "Lote {}: OpenAlex respondeu com HTTP {}",
                    idx + 1,
                    code
                ));
            }
            Err(ureq::Error::Transport(t)) => {
                errors.push(format!("Lote {}: erro de conexão ({})", idx + 1, t));
            }
        }
    }

    (all_works, errors)
}

/// Consolida o relatório OpenAlex, atualiza citações no SQLite se solicitado e grava cache em app_metadata.
pub fn build_and_apply_openalex_report(
    conn: &Connection,
    rows: &[DbProdDoiRow],
    parsed: &HashMap<String, OpenAlexParsedWork>,
    errors: Vec<String>,
    update_citations: bool,
) -> Result<OpenAlexSyncReport, String> {
    let mut oa_counts: HashMap<String, usize> = HashMap::new();
    for k in ["gold", "green", "hybrid", "bronze", "closed"] {
        oa_counts.insert(k.to_string(), 0);
    }

    let mut yearly_map: HashMap<i64, i64> = HashMap::new();
    let mut coauthor_counts: HashMap<String, (String, usize)> = HashMap::new();
    let mut inst_counts: HashMap<String, (String, usize)> = HashMap::new();
    let mut items = Vec::new();
    let mut cited_vec = Vec::new();
    let mut updated_citations_count = 0usize;

    for row in rows {
        let key = row.doi.to_ascii_lowercase();
        let Some(pw) = parsed.get(&key) else {
            continue;
        };

        let citations_after = pw.cited_by_count.max(0);
        cited_vec.push(citations_after);

        let oa_key = pw
            .oa_status
            .as_deref()
            .filter(|s| matches!(*s, "gold" | "green" | "hybrid" | "bronze" | "closed"))
            .unwrap_or("closed");
        *oa_counts.entry(oa_key.to_string()).or_insert(0) += 1;

        for (y, c) in &pw.counts_by_year {
            *yearly_map.entry(*y).or_insert(0) += *c;
        }

        let mut seen_a = HashSet::new();
        for a in &pw.authors {
            let norm = a.to_ascii_lowercase();
            if seen_a.insert(norm.clone()) {
                let entry = coauthor_counts
                    .entry(norm)
                    .or_insert_with(|| (a.clone(), 0));
                entry.1 += 1;
            }
        }

        let mut seen_i = HashSet::new();
        for i_name in &pw.institutions {
            let norm = i_name.to_ascii_lowercase();
            if seen_i.insert(norm.clone()) {
                let entry = inst_counts
                    .entry(norm)
                    .or_insert_with(|| (i_name.clone(), 0));
                entry.1 += 1;
            }
        }

        if update_citations && row.citations != Some(citations_after) {
            conn.execute(
                "UPDATE producoes SET citations = ?1 WHERE id = ?2",
                params![citations_after, row.id],
            )
            .map_err(|e| format!("Falha ao atualizar citações do registro {}: {}", row.id, e))?;
            updated_citations_count += 1;
        }

        items.push(OpenAlexWorkItem {
            id: row.id,
            titulo: row.titulo.clone(),
            ano: row.ano.or(pw.year),
            doi: row.doi.clone(),
            journal: pw.journal.clone().or_else(|| row.journal.clone()),
            issn: pw.issn.clone(),
            citations_before: row.citations,
            citations_after,
            oa_status: pw.oa_status.clone(),
            oa_pdf_url: pw.oa_pdf_url.clone(),
            authors: pw.authors.clone(),
            institutions: pw.institutions.clone(),
        });
    }

    if update_citations {
        crate::qualis::store_issn(conn, rows, parsed);
    }
    if update_citations && updated_citations_count > 0 {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);");
    }

    cited_vec.sort_by(|a, b| b.cmp(a));
    let total_citations: i64 = cited_vec.iter().sum();
    let mut h_index = 0i64;
    for (idx, c) in cited_vec.iter().enumerate() {
        if *c > (idx as i64) {
            h_index = (idx as i64) + 1;
        } else {
            break;
        }
    }
    let i10_index = cited_vec.iter().filter(|&&c| c >= 10).count() as i64;

    let mut yearly_citations: Vec<OpenAlexYearlyCitation> = yearly_map
        .into_iter()
        .map(|(year, citations)| OpenAlexYearlyCitation { year, citations })
        .collect();
    yearly_citations.sort_by_key(|y| y.year);

    let mut top_coauthors: Vec<OpenAlexCollaborator> = coauthor_counts
        .into_values()
        .map(|(name, count)| OpenAlexCollaborator { name, count })
        .collect();
    top_coauthors.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    top_coauthors.truncate(15);

    let mut top_institutions: Vec<OpenAlexCollaborator> = inst_counts
        .into_values()
        .map(|(name, count)| OpenAlexCollaborator { name, count })
        .collect();
    top_institutions.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    top_institutions.truncate(15);

    items.sort_by(|a, b| {
        b.citations_after
            .cmp(&a.citations_after)
            .then_with(|| b.ano.cmp(&a.ano))
            .then_with(|| a.titulo.cmp(&b.titulo))
    });

    let report = OpenAlexSyncReport {
        total_with_doi: rows.len(),
        matched_count: items.len(),
        updated_citations_count,
        total_citations,
        h_index,
        i10_index,
        oa_counts,
        yearly_citations,
        top_coauthors,
        top_institutions,
        items,
        errors,
        synced_at: chrono::Local::now().format("%d/%m/%Y %H:%M").to_string(),
    };

    if let Ok(serialized) = serde_json::to_string(&report) {
        let _ = conn.execute(
            "INSERT INTO app_metadata (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params!["settings.openalex_last_report", serialized],
        );
    }

    Ok(report)
}

// ==========================================
// SINCRONIZADOR ORCID (BD × ORCID)
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrcidRawWork {
    pub titulo: String,
    pub ano: Option<i64>,
    pub tipo: String,
    pub journal: Option<String>,
    pub doi: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrcidWork {
    /// "matched" | "only_orcid"
    pub status: String,
    pub titulo: String,
    pub ano: Option<i64>,
    pub tipo: String,
    pub journal: Option<String>,
    pub doi: Option<String>,
    pub url: Option<String>,
    pub db_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrcidDbOnlyItem {
    pub id: i64,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub titulo: String,
    pub journal: Option<String>,
    pub doi: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrcidSyncReport {
    pub orcid: String,
    pub total_orcid_works: usize,
    pub total_db_producoes: usize,
    pub matched_count: usize,
    pub only_in_orcid_count: usize,
    pub only_in_db_count: usize,
    pub works: Vec<OrcidWork>,
    pub only_in_db: Vec<OrcidDbOnlyItem>,
}

/// Normaliza e valida um identificador ORCID (aceita número puro ou URL `orcid.org/...`).
pub fn clean_orcid(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    let stripped = if let Some(rest) = lower.strip_prefix("https://orcid.org/") {
        rest
    } else if let Some(rest) = lower.strip_prefix("http://orcid.org/") {
        rest
    } else if let Some(rest) = lower.strip_prefix("orcid.org/") {
        rest
    } else {
        lower.as_str()
    };

    let seg = stripped
        .split(['/', '?', '#', ' '])
        .next()
        .unwrap_or(stripped)
        .trim();

    let mut upper = seg.to_string();
    if upper.ends_with('x') {
        upper.pop();
        upper.push('X');
    }

    let re = Regex::new(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$").ok()?;
    if re.is_match(&upper) {
        Some(upper)
    } else {
        None
    }
}

fn map_orcid_type(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "journal-article" => "Artigos completos",
        "book-chapter" => "Capítulos de livros",
        "book" | "edited-book" => "Livros publicados",
        "conference-paper" => "Trabalhos completos em anais",
        "conference-abstract" | "conference-poster" => "Resumos expandidos",
        "preprint" => "Preprint",
        _ => "Outras produções",
    }
}

fn extract_doi_from_ext_ids(ext_ids: Option<&Value>) -> Option<String> {
    let arr = ext_ids?.get("external-id")?.as_array()?;
    for item in arr {
        let kind = item
            .get("external-id-type")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if kind.eq_ignore_ascii_case("doi") {
            let val = item
                .get("external-id-value")
                .and_then(|v| v.as_str())
                .or_else(|| {
                    item.pointer("/external-id-url/value")
                        .and_then(|v| v.as_str())
                });
            if let Some(v) = val {
                if let Some(d) = parse_doi(v) {
                    return Some(d.to_ascii_lowercase());
                }
            }
        }
    }
    None
}

/// Faz parse da resposta JSON de `/v3.0/{orcid}/works` da API pública do ORCID.
pub fn parse_orcid_works_json(val: &Value) -> Vec<OrcidRawWork> {
    let Some(groups) = val.get("group").and_then(|v| v.as_array()) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for g in groups {
        let Some(summary) = g.pointer("/work-summary/0") else {
            continue;
        };
        let titulo = summary
            .pointer("/title/title/value")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        if titulo.is_empty() {
            continue;
        }

        let ano = summary
            .pointer("/publication-date/year/value")
            .and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_str().and_then(|s| s.trim().parse::<i64>().ok()))
            });

        let journal = summary
            .pointer("/journal-title/value")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let tipo =
            map_orcid_type(summary.get("type").and_then(|v| v.as_str()).unwrap_or("")).to_string();

        let url = summary
            .pointer("/url/value")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let doi = extract_doi_from_ext_ids(summary.get("external-ids"))
            .or_else(|| extract_doi_from_ext_ids(g.get("external-ids")));

        out.push(OrcidRawWork {
            titulo,
            ano,
            tipo,
            journal,
            doi,
            url,
        });
    }

    out
}

/// Busca produções públicas na API pública do ORCID (sem autenticação).
pub fn fetch_orcid_works(orcid: &str) -> Result<Vec<OrcidRawWork>, String> {
    let url = format!("https://pub.orcid.org/v3.0/{}/works", orcid);
    match agent(20)
        .get(&url)
        .set("Accept", "application/json")
        .set("User-Agent", UA)
        .call()
    {
        Ok(resp) => {
            let val: Value = resp
                .into_json()
                .map_err(|e| format!("Resposta inválida do ORCID: {}", e))?;
            Ok(parse_orcid_works_json(&val))
        }
        Err(ureq::Error::Status(404, _)) => {
            Err("ORCID não encontrado (verifique o número informado)".into())
        }
        Err(ureq::Error::Status(code, _)) => Err(format!("ORCID respondeu com erro HTTP {}", code)),
        Err(ureq::Error::Transport(t)) => Err(format!("Sem conexão com o ORCID: {}", t)),
    }
}

/// Faz checagem cruzada entre as obras do ORCID e a tabela `producoes` do SQLite.
pub fn compare_orcid_with_db(
    conn: &Connection,
    orcid: &str,
    raw_works: Vec<OrcidRawWork>,
) -> Result<OrcidSyncReport, String> {
    struct DbRow {
        id: i64,
        ano: Option<i64>,
        tipo: Option<String>,
        titulo: String,
        journal: Option<String>,
        doi: Option<String>,
        norm_title: String,
        tris: HashSet<String>,
    }

    let mut stmt = conn
        .prepare("SELECT id, ano, tipo, titulo, journal, identifier, url FROM producoes")
        .map_err(|e| e.to_string())?;
    let rows_iter = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut db_rows = Vec::new();
    for row in rows_iter.flatten() {
        let (id, ano, tipo, titulo_opt, journal, identifier, url) = row;
        let titulo = titulo_opt.unwrap_or_default();
        let doi = identifier
            .as_deref()
            .and_then(parse_doi)
            .or_else(|| url.as_deref().and_then(parse_doi))
            .map(|d| d.to_ascii_lowercase());
        let norm_title = normalize_title(&titulo);
        let tris = trigrams(&titulo);
        db_rows.push(DbRow {
            id,
            ano,
            tipo,
            titulo,
            journal,
            doi,
            norm_title,
            tris,
        });
    }

    let total_db_producoes = db_rows.len();
    let total_orcid_works = raw_works.len();
    let mut matched_db = vec![false; total_db_producoes];
    let mut works = Vec::with_capacity(total_orcid_works);
    let mut matched_count = 0usize;
    let mut only_in_orcid_count = 0usize;

    for ow in raw_works {
        let mut best_idx: Option<usize> = None;

        // 1. DOI exato
        if let Some(ref o_doi) = ow.doi {
            best_idx = db_rows
                .iter()
                .enumerate()
                .find(|(i, r)| !matched_db[*i] && r.doi.as_deref() == Some(o_doi.as_str()))
                .map(|(i, _)| i);
        }

        // 2. Título normalizado exato
        let o_norm = normalize_title(&ow.titulo);
        if best_idx.is_none() && !o_norm.is_empty() {
            best_idx = db_rows
                .iter()
                .enumerate()
                .find(|(i, r)| !matched_db[*i] && r.norm_title == o_norm)
                .map(|(i, _)| i);
        }

        // 3. Similaridade de trigramas (Dice >= 0.90 com razão de tamanho >= 0.80)
        if best_idx.is_none() {
            let o_tris = trigrams(&ow.titulo);
            if !o_tris.is_empty() {
                let lo = o_tris.len() as f64;
                let mut best_score = 0.0f64;
                for (i, r) in db_rows.iter().enumerate() {
                    if matched_db[i] || r.tris.is_empty() {
                        continue;
                    }
                    let ld = r.tris.len() as f64;
                    if lo.min(ld) / lo.max(ld).max(1.0) < 0.80 {
                        continue;
                    }
                    let score = dice(&o_tris, &r.tris);
                    if score >= 0.90 && score > best_score {
                        best_score = score;
                        best_idx = Some(i);
                    }
                }
            }
        }

        if let Some(idx) = best_idx {
            matched_db[idx] = true;
            matched_count += 1;
            works.push(OrcidWork {
                status: "matched".to_string(),
                titulo: ow.titulo,
                ano: ow.ano.or(db_rows[idx].ano),
                tipo: ow.tipo,
                journal: ow.journal.or_else(|| db_rows[idx].journal.clone()),
                doi: ow.doi.or_else(|| db_rows[idx].doi.clone()),
                url: ow.url,
                db_id: Some(db_rows[idx].id),
            });
        } else {
            only_in_orcid_count += 1;
            works.push(OrcidWork {
                status: "only_orcid".to_string(),
                titulo: ow.titulo,
                ano: ow.ano,
                tipo: ow.tipo,
                journal: ow.journal,
                doi: ow.doi,
                url: ow.url,
                db_id: None,
            });
        }
    }

    works.sort_by(|a, b| b.ano.cmp(&a.ano).then_with(|| a.titulo.cmp(&b.titulo)));

    let mut only_in_db: Vec<OrcidDbOnlyItem> = db_rows
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !matched_db[*i])
        .map(|(_, r)| OrcidDbOnlyItem {
            id: r.id,
            ano: r.ano,
            tipo: r.tipo,
            titulo: r.titulo,
            journal: r.journal,
            doi: r.doi,
        })
        .collect();
    only_in_db.sort_by(|a, b| b.ano.cmp(&a.ano).then_with(|| a.titulo.cmp(&b.titulo)));
    let only_in_db_count = only_in_db.len();

    let _ = conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params!["settings.orcid_id", orcid],
    );

    Ok(OrcidSyncReport {
        orcid: orcid.to_string(),
        total_orcid_works,
        total_db_producoes,
        matched_count,
        only_in_orcid_count,
        only_in_db_count,
        works,
        only_in_db,
    })
}

// ==========================================
// TESTES UNITÁRIOS OFFLINE
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::queries;
    use serde_json::json;

    #[test]
    fn test_clean_orcid_variants() {
        assert_eq!(
            clean_orcid("https://orcid.org/0000-0002-1825-0097"),
            Some("0000-0002-1825-0097".to_string())
        );
        assert_eq!(
            clean_orcid("http://orcid.org/0000-0001-5109-370x?lang=pt"),
            Some("0000-0001-5109-370X".to_string())
        );
        assert_eq!(
            clean_orcid("  orcid.org/0000-0003-1234-5678  "),
            Some("0000-0003-1234-5678".to_string())
        );
        assert_eq!(clean_orcid("invalido"), None);
        assert_eq!(clean_orcid("0000-0001-234-5678"), None);
    }

    #[test]
    fn test_parse_openalex_and_apply_report() {
        let conn = crate::db::open_in_memory().unwrap();
        let r1 = queries::insert_record(
            &conn,
            "producoes",
            &json!({ "ano": 2023, "tipo": "Artigos completos", "titulo": "Paper A", "identifier": "10.1000/a1" }),
            None,
            None,
        )
        .unwrap();
        let r2 = queries::insert_record(
            &conn,
            "producoes",
            &json!({ "ano": 2024, "tipo": "Artigos completos", "titulo": "Paper B", "identifier": "10.1000/b2" }),
            None,
            None,
        )
        .unwrap();

        let api_json = json!({
            "results": [
                {
                    "doi": "https://doi.org/10.1000/a1",
                    "title": "Paper A",
                    "publication_year": 2023,
                    "cited_by_count": 15,
                    "open_access": { "oa_status": "gold", "oa_url": "https://example.org/a1.pdf" },
                    "best_oa_location": { "pdf_url": "https://example.org/a1_best.pdf" },
                    "primary_location": {
                        "source": { "display_name": "Journal One", "issn_l": "1234-5678" }
                    },
                    "authorships": [
                        {
                            "author": { "display_name": "Alice" },
                            "institutions": [{ "display_name": "UFSC" }]
                        },
                        {
                            "author": { "display_name": "Bob" },
                            "institutions": [{ "display_name": "USP" }]
                        }
                    ],
                    "counts_by_year": [
                        { "year": 2024, "cited_by_count": 10 },
                        { "year": 2023, "cited_by_count": 5 }
                    ]
                },
                {
                    "doi": "https://doi.org/10.1000/b2",
                    "title": "Paper B",
                    "publication_year": 2024,
                    "cited_by_count": 2,
                    "open_access": { "oa_status": "closed" },
                    "authorships": [
                        {
                            "author": { "display_name": "Alice" },
                            "institutions": [{ "display_name": "UFSC" }]
                        }
                    ],
                    "counts_by_year": [
                        { "year": 2024, "cited_by_count": 2 }
                    ]
                }
            ]
        });

        let rows = load_producoes_with_doi(&conn).unwrap();
        assert_eq!(rows.len(), 2);

        let parsed = parse_openalex_works_json(&api_json);
        let report = build_and_apply_openalex_report(&conn, &rows, &parsed, vec![], true).unwrap();

        assert_eq!(report.total_with_doi, 2);
        assert_eq!(report.matched_count, 2);
        assert_eq!(report.updated_citations_count, 2);
        assert_eq!(report.total_citations, 17);
        assert_eq!(report.h_index, 2); // sorted [15, 2]: idx 0 (15>=1), idx 1 (2>=2)
        assert_eq!(report.i10_index, 1);
        assert_eq!(report.oa_counts.get("gold").copied(), Some(1));
        assert_eq!(report.oa_counts.get("closed").copied(), Some(1));
        assert_eq!(report.yearly_citations.len(), 2);
        assert_eq!(
            report.yearly_citations[1],
            OpenAlexYearlyCitation {
                year: 2024,
                citations: 12
            }
        );
        assert_eq!(
            report.top_coauthors[0],
            OpenAlexCollaborator {
                name: "Alice".into(),
                count: 2
            }
        );
        assert_eq!(
            report.top_institutions[0],
            OpenAlexCollaborator {
                name: "UFSC".into(),
                count: 2
            }
        );

        let updated1 = queries::get_record_by_id(&conn, "producoes", r1.id).unwrap();
        let updated2 = queries::get_record_by_id(&conn, "producoes", r2.id).unwrap();
        assert_eq!(updated1.citations, Some(15));
        assert_eq!(updated2.citations, Some(2));
    }

    #[test]
    fn test_parse_orcid_and_compare_with_db() {
        let conn = crate::db::open_in_memory().unwrap();
        let p_doi = queries::insert_record(
            &conn,
            "producoes",
            &json!({ "ano": 2023, "tipo": "Artigos completos", "titulo": "Artigo Match por DOI", "identifier": "10.1000/xyz" }),
            None,
            None,
        )
        .unwrap();
        let p_title = queries::insert_record(
            &conn,
            "producoes",
            &json!({ "ano": 2022, "tipo": "Capítulos de livros", "titulo": "Capitulo Match por Titulo Normalizado" }),
            None,
            None,
        )
        .unwrap();
        queries::insert_record(
            &conn,
            "producoes",
            &json!({ "ano": 2021, "tipo": "Artigos completos", "titulo": "Apenas no Banco Local" }),
            None,
            None,
        )
        .unwrap();

        let orcid_json = json!({
            "group": [
                {
                    "work-summary": [{
                        "title": { "title": { "value": "Artigo Diferente Mas Mesmo DOI" } },
                        "publication-date": { "year": { "value": "2023" } },
                        "type": "journal-article",
                        "journal-title": { "value": "Revista A" },
                        "external-ids": {
                            "external-id": [
                                { "external-id-type": "doi", "external-id-value": "10.1000/XYZ" }
                            ]
                        }
                    }]
                },
                {
                    "work-summary": [{
                        "title": { "title": { "value": "Capítulo Match por Título Normalizado" } },
                        "publication-date": { "year": { "value": "2022" } },
                        "type": "book-chapter",
                        "external-ids": { "external-id": [] }
                    }]
                },
                {
                    "work-summary": [{
                        "title": { "title": { "value": "Artigo Novo Apenas no ORCID" } },
                        "publication-date": { "year": { "value": "2025" } },
                        "type": "journal-article",
                        "journal-title": { "value": "Science" },
                        "url": { "value": "https://doi.org/10.1126/new" },
                        "external-ids": {
                            "external-id": [
                                { "external-id-type": "doi", "external-id-value": "10.1126/new" }
                            ]
                        }
                    }]
                }
            ]
        });

        let raw = parse_orcid_works_json(&orcid_json);
        assert_eq!(raw.len(), 3);
        let report = compare_orcid_with_db(&conn, "0000-0002-1825-0097", raw).unwrap();

        assert_eq!(report.total_orcid_works, 3);
        assert_eq!(report.total_db_producoes, 3);
        assert_eq!(report.matched_count, 2);
        assert_eq!(report.only_in_orcid_count, 1);
        assert_eq!(report.only_in_db_count, 1);
        assert!(report
            .works
            .iter()
            .any(|w| w.status == "matched" && w.db_id == Some(p_doi.id)));
        assert!(report
            .works
            .iter()
            .any(|w| w.status == "matched" && w.db_id == Some(p_title.id)));
        assert!(report
            .works
            .iter()
            .any(|w| w.status == "only_orcid" && w.doi.as_deref() == Some("10.1126/new")));
        assert_eq!(report.only_in_db[0].titulo, "Apenas no Banco Local");
    }
}
