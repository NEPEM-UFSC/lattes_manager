//! Vincula comprovantes que estão nas pastas mas não estão ligados a nenhum registro,
//! comparando o título do registro com o nome do arquivo (ex.: "001_mgidi towards an eff.pdf").
//! Também detecta registros quase duplicados (ex.: "toward" × "towards").

use crate::db::schema::{normalize_category, ENTITY_TABLES};
use crate::migration::lattes_xml::normalize_title;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LinkSuggestion {
    pub category: String,
    pub id: i64,
    pub titulo: String,
    pub tipo: Option<String>,
    pub ano: Option<i64>,
    pub path: String,
    pub score: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LinkApply {
    pub category: String,
    pub id: i64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DupItem {
    pub id: i64,
    pub titulo: String,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub has_file: bool,
    pub from_xml: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DupPair {
    pub category: String,
    /// sugerido para manter
    pub keep: DupItem,
    /// sugerido para excluir
    pub drop: DupItem,
    pub score: f64,
}

/// Coluna que funciona como "título" em cada tabela.
pub fn title_col(table: &str) -> &'static str {
    match table {
        "producoes" | "orientacoes" | "bancas" | "inovacao" | "educacao_popularizacao" => "titulo",
        "atuacao" => "instituicao",
        "disciplinas" => "disciplina",
        _ => "descricao",
    }
}

fn tokens(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric())
        .map(normalize_title)
        .filter(|t| t.chars().count() >= 3)
        .collect()
}

struct PreFile {
    path: String,
    dir: String,
    nf: String,
    lf: usize,
    ft: Vec<String>,
}

impl PreFile {
    fn from_rel(path: String) -> Self {
        let dir = norm_rel(&path)
            .rsplit_once('\\')
            .map(|(d, _)| d.to_string())
            .unwrap_or_default();
        let name = path.rsplit('\\').next().unwrap_or(&path).to_string();
        Self::from_parts(path, dir, &name)
    }

    fn from_filename(filename: &str) -> Self {
        Self::from_parts(String::new(), String::new(), filename)
    }

    fn from_parts(path: String, dir: String, filename: &str) -> Self {
        let stem = Path::new(filename)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        // remove prefixo sequencial "001_", "12 - "
        let trimmed = stem
            .trim_start_matches(|c: char| c.is_ascii_digit())
            .trim_start_matches(['_', ' ', '-']);
        let nf = normalize_title(trimmed);
        let lf = nf.chars().count();
        let ft = tokens(trimmed);
        Self { path, dir, nf, lf, ft }
    }
}

fn score_pre(nt: &str, tt_cache: &mut Option<HashSet<String>>, title_raw: &str, pf: &PreFile) -> f64 {
    if pf.lf >= 12 && nt.starts_with(&pf.nf) {
        return 1.0;
    }
    if pf.lf >= 18 && nt.contains(&pf.nf) {
        return 0.75; // trecho do meio do título: plausível, mas ambíguo
    }
    if pf.ft.len() < 3 {
        return 0.0;
    }
    let tt = tt_cache.get_or_insert_with(|| tokens(title_raw).into_iter().collect());
    let last = pf.ft.len() - 1;
    let hit = pf
        .ft
        .iter()
        .enumerate()
        .filter(|(i, w)| tt.contains(*w) || (*i == last && tt.iter().any(|t| t.starts_with(w.as_str()))))
        .count();
    0.9 * hit as f64 / pf.ft.len() as f64
}

/// Pontuação 0..1 de quanto o nome do arquivo corresponde ao título.
pub fn link_score(title: &str, filename: &str) -> f64 {
    let nt = normalize_title(title);
    let pf = PreFile::from_filename(filename);
    let mut tt = None;
    score_pre(&nt, &mut tt, title, &pf)
}

/// Conjunto de trigramas de um título normalizado.
pub fn trigrams(title: &str) -> HashSet<String> {
    let c: Vec<char> = normalize_title(title).chars().collect();
    c.windows(3).map(|w| w.iter().collect()).collect()
}

/// Coeficiente de Dice entre dois conjuntos de trigramas.
pub fn dice(a: &HashSet<String>, b: &HashSet<String>) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.iter().filter(|t| b.contains(*t)).count();
    2.0 * inter as f64 / (a.len() + b.len()) as f64
}

pub fn norm_rel(p: &str) -> String {
    p.trim().replace('/', "\\").trim_matches('\\').to_lowercase()
}

pub fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, root, out);
        } else if let Ok(rel) = p.strip_prefix(root) {
            out.push(rel.to_string_lossy().replace('/', "\\"));
        }
    }
}

struct Rec {
    id: i64,
    titulo: String,
    tipo: Option<String>,
    ano: Option<i64>,
    folder: Option<String>,
    path: Option<String>,
    log: Option<String>,
}

fn load(conn: &Connection, table: &str) -> rusqlite::Result<Vec<Rec>> {
    let mut st = conn.prepare(&format!(
        "SELECT id, COALESCE({}, ''), tipo, ano, folder, path, log FROM {}",
        title_col(table),
        table
    ))?;
    let rows = st.query_map([], |r| {
        Ok(Rec {
            id: r.get(0)?,
            titulo: r.get(1)?,
            tipo: r.get(2)?,
            ano: r.get(3)?,
            folder: r.get(4)?,
            path: r.get(5)?,
            log: r.get(6)?,
        })
    })?;
    rows.collect()
}

/// Sugere vínculos registro ↔ arquivo para registros sem comprovante.
pub fn suggest_links(conn: &Connection, root: &Path) -> Result<Vec<LinkSuggestion>, String> {
    let all: HashMap<&str, Vec<Rec>> = ENTITY_TABLES
        .iter()
        .map(|t| Ok((*t, load(conn, t).map_err(|e| e.to_string())?)))
        .collect::<Result<_, String>>()?;
    let linked: HashSet<String> = all
        .values()
        .flatten()
        .filter_map(|r| r.path.as_deref())
        .filter(|p| !p.trim().is_empty())
        .map(norm_rel)
        .collect();

    // mapeamentos: tabela -> (tipo minúsculo -> pasta)
    let mut mapping: HashMap<&str, HashMap<String, String>> = HashMap::new();
    let mut roots: HashMap<&str, HashSet<String>> = HashMap::new();
    {
        let mut st = conn
            .prepare("SELECT category_group, description, folder FROM subfolder_mappings")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
            .map_err(|e| e.to_string())?;
        for (g, d, f) in rows.flatten() {
            if let Some(t) = normalize_category(&g) {
                if let Some(first) = norm_rel(&f).split('\\').next().filter(|s| !s.is_empty()) {
                    roots.entry(t).or_default().insert(first.to_string());
                }
                mapping.entry(t).or_default().insert(d.to_lowercase(), norm_rel(&f));
            }
        }
    }
    for (t, recs) in &all {
        for r in recs {
            if let Some(first) = r.path.as_deref().map(norm_rel).and_then(|p| p.split('\\').next().map(String::from)) {
                if !first.is_empty() && first.contains('_') {
                    roots.entry(t).or_default().insert(first);
                }
            }
        }
    }

    let mut out = Vec::new();
    for table in ENTITY_TABLES {
        let recs: Vec<(&Rec, String)> = all[table]
            .iter()
            .filter_map(|r| {
                if !r.path.as_deref().map(|p| p.trim().is_empty()).unwrap_or(true) {
                    return None;
                }
                let r_norm = normalize_title(&r.titulo);
                (r_norm.len() >= 8).then_some((r, r_norm))
            })
            .collect();
        if recs.is_empty() {
            continue;
        }
        let mut files = Vec::new();
        for rt in roots.get(table).into_iter().flatten() {
            walk(&root.join(rt), root, &mut files);
        }
        files.retain(|f| !linked.contains(&norm_rel(f)));
        files.sort();
        files.dedup();
        let files_pre: Vec<PreFile> = files.into_iter().map(PreFile::from_rel).collect();

        let mut pairs: Vec<(f64, usize, usize)> = Vec::new();
        for (ri, (r, r_norm)) in recs.iter().enumerate() {
            let expected = r
                .tipo
                .as_ref()
                .and_then(|t| mapping.get(table).and_then(|m| m.get(&t.to_lowercase())).cloned())
                .or_else(|| r.folder.as_deref().filter(|f| f.contains('\\')).map(norm_rel));
            let mut r_tokens: Option<HashSet<String>> = None;
            for (fi, pf) in files_pre.iter().enumerate() {
                let mut s = score_pre(r_norm, &mut r_tokens, &r.titulo, pf);
                if s < 0.5 {
                    continue;
                }
                if let Some(exp) = &expected {
                    s += if &pf.dir == exp { 0.05 } else { -0.1 };
                }
                if s >= 0.55 {
                    pairs.push((s.min(1.0), ri, fi));
                }
            }
        }
        pairs.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
        let (mut ur, mut uf) = (HashSet::new(), HashSet::new());
        for (s, ri, fi) in pairs {
            if ur.contains(&ri) || uf.contains(&fi) {
                continue;
            }
            ur.insert(ri);
            uf.insert(fi);
            let r = recs[ri].0;
            out.push(LinkSuggestion {
                category: table.to_string(),
                id: r.id,
                titulo: r.titulo.clone(),
                tipo: r.tipo.clone(),
                ano: r.ano,
                path: files_pre[fi].path.clone(),
                score: (s * 100.0).round() / 100.0,
            });
        }
    }
    out.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.category.cmp(&b.category)));
    Ok(out)
}

fn default_cat_folder(cat: &str) -> String {
    match cat {
        "dados_gerais" | "dadosgerais" => "1_dados_gerais".to_string(),
        "formacao" => "2_formacao".to_string(),
        "atuacao" => "3_atuacao".to_string(),
        "encargos" | "disciplinas" => "3_atuacao".to_string(),
        "projetos" => "4_projetos".to_string(),
        "producoes" => "5_producoes".to_string(),
        "patentes" => "6_patentes".to_string(),
        "inovacao" => "7_inovacao".to_string(),
        "educacao_popularizacao" => "8_educacao".to_string(),
        "eventos" => "9_eventos".to_string(),
        "orientacoes" => "10_orientacoes".to_string(),
        "bancas" => "11_bancas".to_string(),
        other => format!("custom_{}", other),
    }
}

/// Grava os vínculos aceitos: path, file e folder do registro.
pub fn apply_links(conn: &Connection, root: &Path, links: &[LinkApply]) -> Result<usize, String> {
    let mut n = 0;
    let mut external_copy_cache: std::collections::HashMap<String, (String, String, String)> = std::collections::HashMap::new();

    for l in links {
        let table = normalize_category(&l.category).ok_or_else(|| format!("Categoria inválida: {}", l.category))?;
        let trimmed = l.path.trim().replace('/', "\\");
        let path_obj = Path::new(&trimmed);

        let (rel, file, folder) = if let Some(cached) = external_copy_cache.get(&trimmed) {
            cached.clone()
        } else {
            let root_canon = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
            let full_candidate = if path_obj.is_absolute() {
                path_obj.to_path_buf()
            } else {
                root.join(path_obj)
            };

            let path_canon = full_candidate.canonicalize().ok();

            if let Some(pc) = path_canon {
                if pc.starts_with(&root_canon) {
                    let stripped = pc.strip_prefix(&root_canon).unwrap();
                    let rel = stripped.to_string_lossy().replace('/', "\\");
                    let file = pc.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
                    let folder = rel.rsplit_once('\\').map(|(d, _)| format!("{}\\", d)).unwrap_or_default();
                    (rel, file, folder)
                } else {
                    // Arquivo externo: copia uma única vez para a pasta da categoria no root
                    let cat_folder = default_cat_folder(&l.category);
                    let target_subfolder = root.join(&cat_folder);
                    let saved = crate::files::storage::save_attached_file(&pc, &target_subfolder, root)?;
                    let folder = saved.relative_path.rsplit_once('\\').map(|(d, _)| format!("{}\\", d)).unwrap_or_default();
                    let res = (saved.relative_path, saved.filename, folder);
                    external_copy_cache.insert(trimmed.clone(), res.clone());
                    res
                }
            } else {
                // Tenta fallback com resolve_inside_root caso seja caminho relativo sem canonicalizar
                let full = crate::commands::resolve_inside_root(root, &trimmed)?;
                let file = full.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
                let folder = trimmed.rsplit_once('\\').map(|(d, _)| format!("{}\\", d)).unwrap_or_default();
                (trimmed.clone(), file, folder)
            }
        };

        n += conn
            .execute(
                &format!("UPDATE {} SET path = ?1, file = ?2, folder = ?3 WHERE id = ?4", table),
                params![rel, file, folder, l.id],
            )
            .map_err(|e| e.to_string())?;

        let att_dto = crate::db::models::AttachmentDto {
            id: None,
            file: file.clone(),
            path: rel.clone(),
            folder: Some(folder.clone()),
            description: None,
            ord: Some(1),
        };
        let _ = crate::db::queries::sync_record_attachments(
            conn,
            table,
            l.id,
            &[att_dto],
        );
    }
    Ok(n)
}

/// Pares de registros com títulos quase idênticos na mesma categoria.
pub fn find_duplicates(conn: &Connection) -> Result<Vec<DupPair>, String> {
    let mut out = Vec::new();
    // só obras com título próprio; disciplinas/encargos/eventos repetem nomes legitimamente
    for table in ["producoes", "orientacoes", "bancas", "projetos", "patentes"] {
        let recs = load(conn, table).map_err(|e| e.to_string())?;
        // orientações/bancas: títulos genéricos ("Estágio Supervisionado") — o aluno diferencia
        let mut aluno: HashMap<i64, String> = HashMap::new();
        if table == "orientacoes" || table == "bancas" {
            let mut st = conn
                .prepare(&format!("SELECT id, COALESCE(aluno, '') FROM {}", table))
                .map_err(|e| e.to_string())?;
            let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
            aluno = rows.flatten().collect();
        }
        let tri: Vec<HashSet<String>> = recs
            .iter()
            .map(|r| trigrams(&format!("{} {}", r.titulo, aluno.get(&r.id).map(String::as_str).unwrap_or(""))))
            .collect();
        for i in 0..recs.len() {
            if tri[i].len() < 12 {
                continue;
            }
            for j in (i + 1)..recs.len() {
                let (la, lb) = (tri[i].len() as f64, tri[j].len() as f64);
                if la.min(lb) / la.max(lb) < 0.8 {
                    continue;
                }
                if let (Some(x), Some(y)) = (recs[i].ano, recs[j].ano) {
                    if (x - y).abs() > 1 {
                        continue;
                    }
                }
                let s = dice(&tri[i], &tri[j]);
                if s < 0.9 {
                    continue;
                }
                let item = |r: &Rec| DupItem {
                    id: r.id,
                    titulo: r.titulo.clone(),
                    ano: r.ano,
                    tipo: r.tipo.clone(),
                    has_file: r.path.as_deref().map(|p| !p.trim().is_empty()).unwrap_or(false),
                    from_xml: r.log.as_deref().map(|l| l.starts_with("XML Lattes")).unwrap_or(false),
                };
                let (a, b) = (item(&recs[i]), item(&recs[j]));
                // mantém quem tem arquivo; depois quem não veio do XML; depois o mais antigo (id menor)
                let rank = |d: &DupItem| (d.has_file as u8, !d.from_xml as u8);
                let (keep, drop) = if rank(&b) > rank(&a) { (b, a) } else { (a, b) };
                out.push(DupPair { category: table.to_string(), keep, drop, score: (s * 100.0).round() / 100.0 });
            }
        }
    }
    out.sort_by(|a, b| b.score.total_cmp(&a.score));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scores_truncated_filenames() {
        let t = "MGIDI: towards an effective multivariate selection in biological experiments";
        assert_eq!(link_score(t, "001_mgidi towards an eff.pdf"), 1.0);
        assert!(link_score(t, "002_metan an r package f.pdf") < 0.5);
        assert!(link_score("Produção e qualidade fisiológica de sementes da Soja", "003_produção_qualidade_fisiológ.pdf") >= 0.6);
    }

    #[test]
    fn detects_near_duplicates() {
        let a = trigrams("MGIDI: towards an effective multivariate selection in biological experiments");
        let b = trigrams("MGIDI: toward an effective multivariate selection in biological experiments");
        let c = trigrams("metan: an R package for multi-environment trial analysis");
        assert!(dice(&a, &b) > 0.95);
        assert!(dice(&a, &c) < 0.4);
    }

    #[test]
    fn suggests_against_real_db_if_present() {
        let db = Path::new(r"d:\Desktop\UFSC\lattes\lattes.db");
        if !db.exists() {
            return;
        }
        let conn = Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let s = suggest_links(&conn, Path::new(r"d:\Desktop\UFSC\lattes")).unwrap();
        let d = find_duplicates(&conn).unwrap();
        println!("sugestões={} (>=0.9: {}) duplicatas={}", s.len(), s.iter().filter(|x| x.score >= 0.9).count(), d.len());
        for x in d.iter().take(10) {
            println!("  dup {:.2} keep#{} drop#{} {}", x.score, x.keep.id, x.drop.id, x.drop.titulo);
        }
        if let Some(m) = s.iter().find(|x| x.titulo.starts_with("MGIDI: towards")) {
            assert!(m.path.ends_with("001_mgidi towards an eff.pdf"));
        }
    }

    #[test]
    fn suggest_links_precomputes_and_matches() {
        let root = std::env::temp_dir().join(format!("lattes_linker_test_{}", uuid::Uuid::new_v4()));
        let sub = root.join("5_producoes").join("artigos_completos");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("001_mgidi towards an eff.pdf"), b"pdf").unwrap();

        let conn = crate::db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO subfolder_mappings (category_group, description, folder) VALUES ('Produções', 'Artigo Completo', '5_producoes\\artigos_completos\\')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO producoes (ano, tipo, titulo) VALUES (2024, 'Artigo Completo', 'MGIDI: towards an effective multivariate selection in biological experiments')",
            [],
        )
        .unwrap();

        let res = suggest_links(&conn, &root).unwrap();
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].score, 1.0);
        assert!(res[0].path.ends_with("001_mgidi towards an eff.pdf"));

        let _ = std::fs::remove_dir_all(&root);
    }
}
