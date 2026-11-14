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
        "producoes" | "orientacoes" | "bancas" => "titulo",
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

/// Pontuação 0..1 de quanto o nome do arquivo corresponde ao título.
pub fn link_score(title: &str, filename: &str) -> f64 {
    let stem = Path::new(filename).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    // remove prefixo sequencial "001_", "12 - "
    let stem = stem.trim_start_matches(|c: char| c.is_ascii_digit()).trim_start_matches(['_', ' ', '-']);
    let nt = normalize_title(title);
    let nf = normalize_title(stem);
    let lf = nf.chars().count();
    if lf >= 12 && nt.starts_with(&nf) {
        return 1.0;
    }
    if lf >= 18 && nt.contains(&nf) {
        return 0.75; // trecho do meio do título: plausível, mas ambíguo
    }
    let ft = tokens(stem);
    if ft.len() < 3 {
        return 0.0;
    }
    let tt: HashSet<String> = tokens(title).into_iter().collect();
    let last = ft.len() - 1;
    let hit = ft
        .iter()
        .enumerate()
        .filter(|(i, w)| tt.contains(*w) || (*i == last && tt.iter().any(|t| t.starts_with(w.as_str()))))
        .count();
    0.9 * hit as f64 / ft.len() as f64
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
        let recs: Vec<&Rec> = all[table]
            .iter()
            .filter(|r| r.path.as_deref().map(|p| p.trim().is_empty()).unwrap_or(true) && normalize_title(&r.titulo).len() >= 8)
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

        let mut pairs: Vec<(f64, usize, usize)> = Vec::new();
        for (ri, r) in recs.iter().enumerate() {
            let expected = r
                .tipo
                .as_ref()
                .and_then(|t| mapping.get(table).and_then(|m| m.get(&t.to_lowercase())).cloned())
                .or_else(|| r.folder.as_deref().filter(|f| f.contains('\\')).map(norm_rel));
            for (fi, f) in files.iter().enumerate() {
                let name = f.rsplit('\\').next().unwrap_or(f);
                let mut s = link_score(&r.titulo, name);
                if s < 0.5 {
                    continue;
                }
                if let Some(exp) = &expected {
                    let dir = norm_rel(f).rsplit_once('\\').map(|(d, _)| d.to_string()).unwrap_or_default();
                    s += if &dir == exp { 0.05 } else { -0.1 };
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
            let r = recs[ri];
            out.push(LinkSuggestion {
                category: table.to_string(),
                id: r.id,
                titulo: r.titulo.clone(),
                tipo: r.tipo.clone(),
                ano: r.ano,
                path: files[fi].clone(),
                score: (s * 100.0).round() / 100.0,
            });
        }
    }
    out.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.category.cmp(&b.category)));
    Ok(out)
}

/// Grava os vínculos aceitos: path, file e folder do registro.
pub fn apply_links(conn: &Connection, root: &Path, links: &[LinkApply]) -> Result<usize, String> {
    let mut n = 0;
    for l in links {
        let table = normalize_category(&l.category).ok_or_else(|| format!("Categoria inválida: {}", l.category))?;
        let rel = l.path.trim().replace('/', "\\");
        let full = crate::commands::resolve_inside_root(root, &rel)?;
        let file = full.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        let folder = rel.rsplit_once('\\').map(|(d, _)| format!("{}\\", d)).unwrap_or_default();
        n += conn
            .execute(
                &format!("UPDATE {} SET path = ?1, file = ?2, folder = ?3 WHERE id = ?4", table),
                params![rel, file, folder, l.id],
            )
            .map_err(|e| e.to_string())?;
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
}
