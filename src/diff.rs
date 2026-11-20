//! "Lattes Time Machine" — Comparador de versões curriculares entre XMLs do Lattes
//! ou entre um novo XML e a base de dados atual.

use crate::db::{queries, schema};
use crate::migration::lattes_xml::{
    normalize_title, parse_lattes_xml, parse_profile, XmlProduction,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffCategorySummary {
    pub category: String,
    pub category_label: String,
    pub added: usize,
    pub modified: usize,
    pub removed: usize,
    pub unchanged: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffItem {
    pub category: String,
    pub category_label: String,
    pub tipo: String,
    pub ano: Option<i64>,
    pub titulo: String,
    pub extra: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffFieldChange {
    pub field: String,
    pub field_label: String,
    pub old_val: String,
    pub new_val: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffItemModified {
    pub category: String,
    pub category_label: String,
    pub tipo: String,
    pub ano: Option<i64>,
    pub titulo: String,
    pub changes: Vec<DiffFieldChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LattesDiffResult {
    pub title_old: String,
    pub date_old: Option<String>,
    pub title_new: String,
    pub date_new: Option<String>,
    pub total_added: usize,
    pub total_modified: usize,
    pub total_removed: usize,
    pub total_unchanged: usize,
    pub categories: Vec<DiffCategorySummary>,
    pub added: Vec<DiffItem>,
    pub modified: Vec<DiffItemModified>,
    pub removed: Vec<DiffItem>,
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

/// Item intermediário uniforme para comparação entre XMLs ou banco de dados.
#[derive(Debug, Clone)]
struct GenericItem {
    category: String,
    tipo: String,
    ano: Option<i64>,
    titulo: String,
    journal: Option<String>,
    doi: Option<String>,
    aluno: Option<String>,
    disciplina: Option<String>,
    horas: Option<i64>,
    norm_key: String,
}

impl GenericItem {
    fn from_xml(x: &XmlProduction) -> Self {
        let raw_cat = schema::normalize_category(&x.category).unwrap_or(x.category.as_str());
        let cat = match raw_cat {
            "encargos" | "disciplinas" => "atuacao".to_string(),
            other => other.to_string(),
        };
        let nt = normalize_title(&x.titulo);
        let norm_key = format!("{}::{}::{}", cat, x.ano.unwrap_or(0), nt);
        Self {
            category: cat,
            tipo: x.tipo.clone(),
            ano: x.ano,
            titulo: x.titulo.clone(),
            journal: x.journal.clone(),
            doi: x.doi.clone(),
            aluno: x.aluno.clone(),
            disciplina: x.disciplina.clone(),
            horas: x.horas,
            norm_key,
        }
    }

    fn from_db_record(cat: &str, r: &crate::db::models::RecordDto) -> Self {
        let titulo = [&r.titulo, &r.descricao, &r.disciplina]
            .iter()
            .filter_map(|x| x.as_ref().filter(|s| !s.trim().is_empty()))
            .cloned()
            .next()
            .unwrap_or_default();
        let nt = normalize_title(&titulo);
        let norm_key = format!("{}::{}::{}", cat, r.ano.unwrap_or(0), nt);
        Self {
            category: cat.to_string(),
            tipo: r.tipo.clone().unwrap_or_default(),
            ano: r.ano,
            titulo,
            journal: r.journal.clone(),
            doi: r.identifier.clone().filter(|i| i.starts_with("10.")),
            aluno: r.aluno.clone(),
            disciplina: r.disciplina.clone(),
            horas: r.horas,
            norm_key,
        }
    }

    fn extra_summary(&self) -> Option<String> {
        self.journal
            .clone()
            .or_else(|| self.aluno.clone())
            .or_else(|| self.disciplina.clone())
            .or_else(|| self.doi.clone())
    }

    fn compare_fields(&self, other: &GenericItem) -> Vec<DiffFieldChange> {
        let mut changes = Vec::new();

        if self.tipo.trim() != other.tipo.trim() && !self.tipo.is_empty() && !other.tipo.is_empty()
        {
            changes.push(DiffFieldChange {
                field: "tipo".into(),
                field_label: "Tipo / Subcategoria".into(),
                old_val: self.tipo.clone(),
                new_val: other.tipo.clone(),
            });
        }

        if self.ano != other.ano && (self.ano.is_some() || other.ano.is_some()) {
            changes.push(DiffFieldChange {
                field: "ano".into(),
                field_label: "Ano".into(),
                old_val: self
                    .ano
                    .map(|y| y.to_string())
                    .unwrap_or_else(|| "—".into()),
                new_val: other
                    .ano
                    .map(|y| y.to_string())
                    .unwrap_or_else(|| "—".into()),
            });
        }

        if self.journal != other.journal && (self.journal.is_some() || other.journal.is_some()) {
            changes.push(DiffFieldChange {
                field: "journal".into(),
                field_label: "Periódico / Revista".into(),
                old_val: self.journal.clone().unwrap_or_else(|| "—".into()),
                new_val: other.journal.clone().unwrap_or_else(|| "—".into()),
            });
        }

        if self.doi != other.doi && (self.doi.is_some() || other.doi.is_some()) {
            changes.push(DiffFieldChange {
                field: "doi".into(),
                field_label: "DOI".into(),
                old_val: self.doi.clone().unwrap_or_else(|| "—".into()),
                new_val: other.doi.clone().unwrap_or_else(|| "—".into()),
            });
        }

        if self.aluno != other.aluno && (self.aluno.is_some() || other.aluno.is_some()) {
            changes.push(DiffFieldChange {
                field: "aluno".into(),
                field_label: "Aluno / Orientando / Candidato".into(),
                old_val: self.aluno.clone().unwrap_or_else(|| "—".into()),
                new_val: other.aluno.clone().unwrap_or_else(|| "—".into()),
            });
        }

        if self.horas != other.horas && (self.horas.is_some() || other.horas.is_some()) {
            changes.push(DiffFieldChange {
                field: "horas".into(),
                field_label: "Carga Horária".into(),
                old_val: self
                    .horas
                    .map(|h| format!("{}h", h))
                    .unwrap_or_else(|| "—".into()),
                new_val: other
                    .horas
                    .map(|h| format!("{}h", h))
                    .unwrap_or_else(|| "—".into()),
            });
        }

        changes
    }
}

/// Compara um novo XML contra um XML anterior (ou contra o banco de dados atual).
pub fn compare_lattes_versions(
    conn: &Connection,
    xml_path_new: &Path,
    xml_path_old: Option<&Path>,
) -> Result<LattesDiffResult, String> {
    if !xml_path_new.is_file() {
        return Err(format!(
            "Arquivo XML novo '{}' não encontrado.",
            xml_path_new.display()
        ));
    }

    // 1. Carrega o Novo XML (Target B)
    let prof_new = parse_profile(xml_path_new).ok();
    let items_new_raw =
        parse_lattes_xml(xml_path_new).map_err(|e| format!("Erro ao ler XML novo: {}", e))?;
    let items_new: Vec<GenericItem> = items_new_raw.iter().map(GenericItem::from_xml).collect();

    // 2. Carrega a Base Antiga (Base A) — do arquivo antigo ou do banco SQLite
    let (title_old, date_old, items_old): (String, Option<String>, Vec<GenericItem>) =
        match xml_path_old {
            Some(old_path) => {
                if !old_path.is_file() {
                    return Err(format!(
                        "Arquivo XML anterior '{}' não encontrado.",
                        old_path.display()
                    ));
                }
                let prof_old = parse_profile(old_path).ok();
                let items_old_raw = parse_lattes_xml(old_path)
                    .map_err(|e| format!("Erro ao ler XML anterior: {}", e))?;
                let items: Vec<GenericItem> =
                    items_old_raw.iter().map(GenericItem::from_xml).collect();
                let t = prof_old
                    .as_ref()
                    .map(|p| p.nome.clone())
                    .unwrap_or_else(|| "Currículo Lattes (Versão Anterior)".into());
                let d = prof_old.as_ref().map(|p| p.atualizacao.clone());
                (t, d, items)
            }
            None => {
                // Do banco atual
                let all_cats = crate::tools::all_categories(conn);
                let mut items = Vec::new();
                for cat in &all_cats {
                    if let Ok(recs) = queries::get_records(conn, cat, None, None, None) {
                        for r in recs {
                            items.push(GenericItem::from_db_record(cat, &r));
                        }
                    }
                }
                let d: Option<String> = conn
                .query_row(
                    "SELECT value FROM app_metadata WHERE key = 'lattes_atualizacao' OR key = 'settings.lattes_atualizacao'",
                    [],
                    |r| r.get(0),
                )
                .ok();
                let d = d.or_else(|| Some(chrono::Local::now().format("%d/%m/%Y").to_string()));
                ("Banco de Dados Atual".to_string(), d, items)
            }
        };

    let title_new = prof_new
        .as_ref()
        .map(|p| p.nome.clone())
        .unwrap_or_else(|| "Novo XML Lattes".into());
    let date_new = prof_new.as_ref().map(|p| p.atualizacao.clone());

    // 3. Monta índices por chave normalizada (categoria + ano + título)
    let mut old_by_key: HashMap<String, GenericItem> = HashMap::new();
    let mut old_by_title_cat: HashMap<(String, String), GenericItem> = HashMap::new();
    for it in items_old {
        old_by_key.insert(it.norm_key.clone(), it.clone());
        let nt = normalize_title(&it.titulo);
        old_by_title_cat.insert((it.category.clone(), nt), it);
    }

    let mut matched_old_keys: HashSet<String> = HashSet::new();

    let mut added: Vec<DiffItem> = Vec::new();
    let mut modified: Vec<DiffItemModified> = Vec::new();
    let mut unchanged_count = 0usize;

    // Estatísticas por categoria
    let mut cat_stats: HashMap<String, (usize, usize, usize, usize)> = HashMap::new(); // (add, mod, rem, unch)

    for it_new in &items_new {
        let nt = normalize_title(&it_new.titulo);
        let maybe_old = old_by_key
            .get(&it_new.norm_key)
            .or_else(|| old_by_title_cat.get(&(it_new.category.clone(), nt.clone())));

        let stats = cat_stats
            .entry(it_new.category.clone())
            .or_insert((0, 0, 0, 0));

        if let Some(it_old) = maybe_old {
            matched_old_keys.insert(it_old.norm_key.clone());
            let changes = it_old.compare_fields(it_new);
            if changes.is_empty() {
                unchanged_count += 1;
                stats.3 += 1;
            } else {
                modified.push(DiffItemModified {
                    category: it_new.category.clone(),
                    category_label: category_label(&it_new.category),
                    tipo: it_new.tipo.clone(),
                    ano: it_new.ano,
                    titulo: it_new.titulo.clone(),
                    changes,
                });
                stats.1 += 1;
            }
        } else {
            added.push(DiffItem {
                category: it_new.category.clone(),
                category_label: category_label(&it_new.category),
                tipo: it_new.tipo.clone(),
                ano: it_new.ano,
                titulo: it_new.titulo.clone(),
                extra: it_new.extra_summary(),
            });
            stats.0 += 1;
        }
    }

    // Identifica itens removidos (que estavam na versão antiga e não estão na nova)
    let mut removed: Vec<DiffItem> = Vec::new();
    for (k, it_old) in &old_by_key {
        if !matched_old_keys.contains(k) {
            let stats = cat_stats
                .entry(it_old.category.clone())
                .or_insert((0, 0, 0, 0));
            stats.2 += 1;
            removed.push(DiffItem {
                category: it_old.category.clone(),
                category_label: category_label(&it_old.category),
                tipo: it_old.tipo.clone(),
                ano: it_old.ano,
                titulo: it_old.titulo.clone(),
                extra: it_old.extra_summary(),
            });
        }
    }

    // Ordena listas: adicionados por ano decrescente
    added.sort_by(|a, b| b.ano.cmp(&a.ano));
    modified.sort_by(|a, b| b.ano.cmp(&a.ano));
    removed.sort_by(|a, b| b.ano.cmp(&a.ano));

    // Monta sumário das categorias
    let mut categories_summary: Vec<DiffCategorySummary> = cat_stats
        .into_iter()
        .map(|(cat, (add, m, rem, unch))| DiffCategorySummary {
            category: cat.clone(),
            category_label: category_label(&cat),
            added: add,
            modified: m,
            removed: rem,
            unchanged: unch,
        })
        .collect();

    categories_summary.sort_by(|a, b| {
        (b.added + b.modified + b.removed).cmp(&(a.added + a.modified + a.removed))
    });

    Ok(LattesDiffResult {
        title_old,
        date_old,
        title_new,
        date_new,
        total_added: added.len(),
        total_modified: modified.len(),
        total_removed: removed.len(),
        total_unchanged: unchanged_count,
        categories: categories_summary,
        added,
        modified,
        removed,
    })
}

// ==========================================
// CHECAGEM CRUZADA: BANCO DE DADOS × XML LATTES
// (Interseção, União, Diferenças por Categoria)
// ==========================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossCheckCategorySummary {
    pub category: String,
    pub category_label: String,
    pub db_count: usize,
    pub xml_count: usize,
    pub intersection: usize,
    pub only_in_xml: usize,
    pub only_in_db: usize,
    pub union_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossCheckItem {
    /// "intersection" (BD ∩ XML) | "only_xml" (XML \ BD) | "only_db" (BD \ XML)
    pub status: String,
    pub category: String,
    pub category_label: String,
    pub tipo: String,
    pub ano: Option<i64>,
    pub titulo: String,
    pub extra: Option<String>,
    pub db_id: Option<i64>,
    pub has_proof: bool,
    pub xml_item: Option<XmlProduction>,
    pub field_diffs: Vec<DiffFieldChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossCheckResult {
    pub xml_name: String,
    pub xml_date: Option<String>,
    pub total_db: usize,
    pub total_xml: usize,
    pub total_intersection: usize,
    pub total_only_xml: usize,
    pub total_only_db: usize,
    pub total_union: usize,
    pub categories: Vec<CrossCheckCategorySummary>,
    pub items: Vec<CrossCheckItem>,
}

fn norm_doi(raw: Option<&str>) -> Option<String> {
    let s = raw?.trim().to_ascii_lowercase();
    let s = s
        .strip_prefix("https://doi.org/")
        .or_else(|| s.strip_prefix("http://doi.org/"))
        .or_else(|| s.strip_prefix("doi:"))
        .unwrap_or(&s)
        .trim();
    if s.starts_with("10.") && s.contains('/') {
        Some(s.to_string())
    } else {
        None
    }
}

fn candidate_norm_titles_db(r: &crate::db::models::RecordDto) -> Vec<String> {
    let mut out = Vec::new();
    for opt in [&r.titulo, &r.descricao, &r.disciplina, &r.instituicao] {
        if let Some(s) = opt {
            let nt = normalize_title(s);
            if !nt.is_empty() && !out.contains(&nt) {
                out.push(nt);
            }
        }
    }
    out
}

fn candidate_norm_titles_xml(x: &XmlProduction) -> Vec<String> {
    let mut out = Vec::new();
    for s in [
        Some(x.titulo.as_str()),
        x.descricao.as_deref(),
        x.disciplina.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        let nt = normalize_title(s);
        if !nt.is_empty() && !out.contains(&nt) {
            out.push(nt);
        }
    }
    out
}

/// Realiza a checagem cruzada completa entre o banco SQLite atual e um arquivo XML do Lattes,
/// calculando Interseção (BD ∩ XML), Diferença XML \ BD, Diferença BD \ XML e União (BD ∪ XML) por categoria.
pub fn cross_check_db_vs_xml(
    conn: &Connection,
    xml_path: &Path,
) -> Result<CrossCheckResult, String> {
    if !xml_path.is_file() {
        return Err(format!(
            "Arquivo XML '{}' não encontrado.",
            xml_path.display()
        ));
    }

    let prof = parse_profile(xml_path).ok();
    let xml_name = prof
        .as_ref()
        .map(|p| p.nome.clone())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            xml_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("XML Lattes")
                .to_string()
        });
    let xml_date = prof.as_ref().map(|p| p.atualizacao.clone());

    let xml_raw =
        parse_lattes_xml(xml_path).map_err(|e| format!("Erro ao ler XML do Lattes: {}", e))?;

    // Agrupa itens do XML por categoria normalizada (encargos e disciplinas -> atuacao)
    let mut xml_by_cat: HashMap<
        String,
        Vec<(
            XmlProduction,
            GenericItem,
            Vec<String>,
            Option<String>,
            HashSet<String>,
        )>,
    > = HashMap::new();
    for x in xml_raw {
        let g = GenericItem::from_xml(&x);
        let cands = candidate_norm_titles_xml(&x);
        let doi = norm_doi(x.doi.as_deref());
        let tris = crate::files::linker::trigrams(&g.titulo);
        xml_by_cat
            .entry(g.category.clone())
            .or_default()
            .push((x, g, cands, doi, tris));
    }

    // Carrega registros do banco atual por categoria
    let db_cats = crate::tools::all_categories(conn);
    let mut db_by_cat: HashMap<
        String,
        Vec<(
            crate::db::models::RecordDto,
            GenericItem,
            Vec<String>,
            Option<String>,
            HashSet<String>,
        )>,
    > = HashMap::new();
    for cat in &db_cats {
        if let Ok(recs) = queries::get_records(conn, cat, None, None, None) {
            let entry = db_by_cat.entry(cat.clone()).or_default();
            for r in recs {
                let g = GenericItem::from_db_record(cat, &r);
                let cands = candidate_norm_titles_db(&r);
                let doi = norm_doi(r.identifier.as_deref()).or_else(|| norm_doi(r.url.as_deref()));
                let tris = crate::files::linker::trigrams(&g.titulo);
                entry.push((r, g, cands, doi, tris));
            }
        }
    }

    // Ordem canônica das categorias
    const ORDER: &[&str] = &[
        "dadosgerais",
        "formacao",
        "atuacao",
        "projetos",
        "producoes",
        "patentes",
        "inovacao",
        "educacao_popularizacao",
        "eventos",
        "orientacoes",
        "bancas",
    ];
    let mut all_cat_keys: Vec<String> = Vec::new();
    for &c in ORDER {
        if db_by_cat.get(c).map(|v| !v.is_empty()).unwrap_or(false)
            || xml_by_cat.get(c).map(|v| !v.is_empty()).unwrap_or(false)
        {
            all_cat_keys.push(c.to_string());
        }
    }
    for c in db_by_cat.keys().chain(xml_by_cat.keys()) {
        if !all_cat_keys.contains(c) {
            all_cat_keys.push(c.clone());
        }
    }

    let mut categories_summary = Vec::new();
    let mut items = Vec::new();
    let mut total_db = 0usize;
    let mut total_xml = 0usize;
    let mut total_intersection = 0usize;
    let mut total_only_xml = 0usize;
    let mut total_only_db = 0usize;

    for cat in all_cat_keys {
        let label = category_label(&cat);
        let db_list = db_by_cat.remove(&cat).unwrap_or_default();
        let xml_list = xml_by_cat.remove(&cat).unwrap_or_default();

        let db_count = db_list.len();
        let xml_count = xml_list.len();
        let mut matched_db = vec![false; db_count];

        let mut inter_count = 0usize;
        let mut only_xml_count = 0usize;

        for (x_raw, x_gen, x_cands, x_doi, x_tris) in xml_list {
            let mut best_idx: Option<usize> = None;

            // 1. Match por DOI exato
            if let Some(ref xd) = x_doi {
                best_idx = db_list
                    .iter()
                    .enumerate()
                    .find(|(i, (_, _, _, db_doi, _))| {
                        !matched_db[*i] && db_doi.as_deref() == Some(xd.as_str())
                    })
                    .map(|(i, _)| i);
            }

            // 2. Match exato por (ano, título normalizado)
            if best_idx.is_none() && !x_cands.is_empty() {
                best_idx = db_list
                    .iter()
                    .enumerate()
                    .find(|(i, (_, db_gen, db_cands, _, _))| {
                        !matched_db[*i]
                            && db_gen.ano == x_gen.ano
                            && x_cands.iter().any(|xc| db_cands.contains(xc))
                    })
                    .map(|(i, _)| i);
            }

            // 3. Match exato por título normalizado (para categorias fora de atuacao, onde mesmo título em anos diferentes pode ser só ano ajustado)
            if best_idx.is_none() && cat != "atuacao" && !x_cands.is_empty() {
                best_idx = db_list
                    .iter()
                    .enumerate()
                    .find(|(i, (_, _, db_cands, _, _))| {
                        !matched_db[*i] && x_cands.iter().any(|xc| db_cands.contains(xc))
                    })
                    .map(|(i, _)| i);
            }

            // 4. Match por alta similaridade de trigramas (Dice >= 0.90)
            if best_idx.is_none() && !x_tris.is_empty() {
                let lx = x_tris.len() as f64;
                let mut best_score = 0.0f64;
                for (i, (_, db_gen, _, _, db_tris)) in db_list.iter().enumerate() {
                    if matched_db[i] || db_tris.is_empty() {
                        continue;
                    }
                    if cat == "atuacao" && db_gen.ano != x_gen.ano {
                        continue;
                    }
                    let ld = db_tris.len() as f64;
                    if lx.min(ld) / lx.max(ld).max(1.0) < 0.80 {
                        continue;
                    }
                    let score = crate::files::linker::dice(&x_tris, db_tris);
                    if score >= 0.90 && score > best_score {
                        best_score = score;
                        best_idx = Some(i);
                    }
                }
            }

            if let Some(idx) = best_idx {
                matched_db[idx] = true;
                inter_count += 1;
                let (ref db_rec, ref db_gen, _, _, _) = db_list[idx];
                let has_proof = db_rec
                    .path
                    .as_deref()
                    .map(|p| !p.trim().is_empty())
                    .unwrap_or(false)
                    || !db_rec.attachments.is_empty();
                let diffs = db_gen.compare_fields(&x_gen);
                items.push(CrossCheckItem {
                    status: "intersection".to_string(),
                    category: cat.clone(),
                    category_label: label.clone(),
                    tipo: if !db_gen.tipo.is_empty() {
                        db_gen.tipo.clone()
                    } else {
                        x_gen.tipo.clone()
                    },
                    ano: db_gen.ano.or(x_gen.ano),
                    titulo: if !db_gen.titulo.is_empty() {
                        db_gen.titulo.clone()
                    } else {
                        x_gen.titulo.clone()
                    },
                    extra: db_gen.extra_summary().or_else(|| x_gen.extra_summary()),
                    db_id: Some(db_rec.id),
                    has_proof,
                    xml_item: None,
                    field_diffs: diffs,
                });
            } else {
                only_xml_count += 1;
                items.push(CrossCheckItem {
                    status: "only_xml".to_string(),
                    category: cat.clone(),
                    category_label: label.clone(),
                    tipo: x_gen.tipo.clone(),
                    ano: x_gen.ano,
                    titulo: x_gen.titulo.clone(),
                    extra: x_gen.extra_summary(),
                    db_id: None,
                    has_proof: false,
                    xml_item: Some(x_raw),
                    field_diffs: Vec::new(),
                });
            }
        }

        let mut only_db_count = 0usize;
        for (i, (db_rec, db_gen, _, _, _)) in db_list.into_iter().enumerate() {
            if !matched_db[i] {
                only_db_count += 1;
                let has_proof = db_rec
                    .path
                    .as_deref()
                    .map(|p| !p.trim().is_empty())
                    .unwrap_or(false)
                    || !db_rec.attachments.is_empty();
                items.push(CrossCheckItem {
                    status: "only_db".to_string(),
                    category: cat.clone(),
                    category_label: label.clone(),
                    tipo: db_gen.tipo.clone(),
                    ano: db_gen.ano,
                    titulo: db_gen.titulo.clone(),
                    extra: db_gen.extra_summary(),
                    db_id: Some(db_rec.id),
                    has_proof,
                    xml_item: None,
                    field_diffs: Vec::new(),
                });
            }
        }

        let union_count = inter_count + only_xml_count + only_db_count;
        total_db += db_count;
        total_xml += xml_count;
        total_intersection += inter_count;
        total_only_xml += only_xml_count;
        total_only_db += only_db_count;

        categories_summary.push(CrossCheckCategorySummary {
            category: cat,
            category_label: label,
            db_count,
            xml_count,
            intersection: inter_count,
            only_in_xml: only_xml_count,
            only_in_db: only_db_count,
            union_count,
        });
    }

    items.sort_by(|a, b| {
        b.ano
            .cmp(&a.ano)
            .then_with(|| a.category.cmp(&b.category))
            .then_with(|| a.titulo.cmp(&b.titulo))
    });

    let total_union = total_intersection + total_only_xml + total_only_db;

    Ok(CrossCheckResult {
        xml_name,
        xml_date,
        total_db,
        total_xml,
        total_intersection,
        total_only_xml,
        total_only_db,
        total_union,
        categories: categories_summary,
        items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cross_check_computes_intersection_union_and_differences() {
        let conn = crate::db::open_in_memory().unwrap();
        // 1 registro igual ao XML (interseção) + 1 registro só no banco (only_db)
        queries::insert_record(
            &conn,
            "producoes",
            &json!({ "ano": 2024, "tipo": "Artigos completos", "titulo": "Artigo Compartilhado", "journal": "Nature", "identifier": "10.1000/abc" }),
            None,
            None,
        )
        .unwrap();
        queries::insert_record(
            &conn,
            "producoes",
            &json!({ "ano": 2023, "tipo": "Artigos completos", "titulo": "Artigo Apenas No Banco" }),
            None,
            None,
        )
        .unwrap();

        let xml_body = r#"<?xml version="1.0" encoding="UTF-8"?>
<CURRICULO-VITAE DATA-ATUALIZACAO="18112026">
  <DADOS-GERAIS NOME-COMPLETO="Pesquisador Teste" />
  <PRODUCAO-BIBLIOGRAFICA>
    <ARTIGOS-PUBLICADOS>
      <ARTIGO-PUBLICADO>
        <DADOS-BASICOS-DO-ARTIGO TITULO-DO-ARTIGO="Artigo Compartilhado" ANO-DO-ARTIGO="2024" DOI="10.1000/abc" />
        <DETALHAMENTO-DO-ARTIGO TITULO-DO-PERIODICO-OU-REVISTA="Nature" />
      </ARTIGO-PUBLICADO>
      <ARTIGO-PUBLICADO>
        <DADOS-BASICOS-DO-ARTIGO TITULO-DO-ARTIGO="Artigo Novo Apenas No XML" ANO-DO-ARTIGO="2025" />
        <DETALHAMENTO-DO-ARTIGO TITULO-DO-PERIODICO-OU-REVISTA="Science" />
      </ARTIGO-PUBLICADO>
    </ARTIGOS-PUBLICADOS>
  </PRODUCAO-BIBLIOGRAFICA>
</CURRICULO-VITAE>"#;

        let xml_path =
            std::env::temp_dir().join(format!("lattes_xcheck_{}.xml", uuid::Uuid::new_v4()));
        std::fs::write(&xml_path, xml_body).unwrap();

        let res = cross_check_db_vs_xml(&conn, &xml_path).unwrap();
        let _ = std::fs::remove_file(&xml_path);

        let prod = res
            .categories
            .iter()
            .find(|c| c.category == "producoes")
            .unwrap();
        assert_eq!(prod.db_count, 2);
        assert_eq!(prod.xml_count, 2);
        assert_eq!(prod.intersection, 1);
        assert_eq!(prod.only_in_xml, 1);
        assert_eq!(prod.only_in_db, 1);
        assert_eq!(prod.union_count, 3);
    }
}
