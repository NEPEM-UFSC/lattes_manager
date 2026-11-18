//! "Lattes Time Machine" — Comparador de versões curriculares entre XMLs do Lattes
//! ou entre um novo XML e a base de dados atual.

use crate::db::{queries, schema};
use crate::migration::lattes_xml::{normalize_title, parse_lattes_xml, parse_profile, XmlProduction};
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
        let cat = schema::normalize_category(&x.category)
            .map(|s| s.to_string())
            .unwrap_or_else(|| x.category.clone());
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

        if self.tipo.trim() != other.tipo.trim() && !self.tipo.is_empty() && !other.tipo.is_empty() {
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
                old_val: self.ano.map(|y| y.to_string()).unwrap_or_else(|| "—".into()),
                new_val: other.ano.map(|y| y.to_string()).unwrap_or_else(|| "—".into()),
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
                old_val: self.horas.map(|h| format!("{}h", h)).unwrap_or_else(|| "—".into()),
                new_val: other.horas.map(|h| format!("{}h", h)).unwrap_or_else(|| "—".into()),
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
        return Err(format!("Arquivo XML novo '{}' não encontrado.", xml_path_new.display()));
    }

    // 1. Carrega o Novo XML (Target B)
    let prof_new = parse_profile(xml_path_new).ok();
    let items_new_raw = parse_lattes_xml(xml_path_new).map_err(|e| format!("Erro ao ler XML novo: {}", e))?;
    let items_new: Vec<GenericItem> = items_new_raw.iter().map(GenericItem::from_xml).collect();

    // 2. Carrega a Base Antiga (Base A) — do arquivo antigo ou do banco SQLite
    let (title_old, date_old, items_old): (String, Option<String>, Vec<GenericItem>) = match xml_path_old {
        Some(old_path) => {
            if !old_path.is_file() {
                return Err(format!("Arquivo XML anterior '{}' não encontrado.", old_path.display()));
            }
            let prof_old = parse_profile(old_path).ok();
            let items_old_raw = parse_lattes_xml(old_path).map_err(|e| format!("Erro ao ler XML anterior: {}", e))?;
            let items: Vec<GenericItem> = items_old_raw.iter().map(GenericItem::from_xml).collect();
            let t = prof_old.as_ref().map(|p| p.nome.clone()).unwrap_or_else(|| "Currículo Lattes (Versão Anterior)".into());
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

    let title_new = prof_new.as_ref().map(|p| p.nome.clone()).unwrap_or_else(|| "Novo XML Lattes".into());
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

        let stats = cat_stats.entry(it_new.category.clone()).or_insert((0, 0, 0, 0));

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
            let stats = cat_stats.entry(it_old.category.clone()).or_insert((0, 0, 0, 0));
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

    categories_summary.sort_by(|a, b| (b.added + b.modified + b.removed).cmp(&(a.added + a.modified + a.removed)));

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
