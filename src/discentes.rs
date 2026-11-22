//! Produção com discentes: cruza os autores das produções (vindos do XML do Lattes) com os
//! alunos das orientações, para mostrar quais trabalhos têm orientado como coautor.

use crate::migration::lattes_xml::{normalize_title, XmlAutor, XmlProduction};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;

// ---------------- Autores vindos do XML ----------------

#[derive(Debug, Default, Serialize)]
pub struct AuthorSync {
    /// Produções do XML que trazem autores.
    pub no_xml: usize,
    /// Produções do banco que receberam (ou tiveram atualizados) os autores.
    pub atualizadas: usize,
    /// Produções do XML com autores que não foram encontradas no banco.
    pub sem_correspondencia: usize,
}

fn doi_key(identifier: Option<&str>, url: Option<&str>) -> Option<String> {
    identifier
        .and_then(crate::doi::parse_doi)
        .or_else(|| url.and_then(crate::doi::parse_doi))
        .map(|d| d.to_ascii_lowercase())
}

/// Grava os autores do XML nas produções que já estão no banco, encontradas pelo DOI ou,
/// sem DOI, pelo título normalizado e ano.
pub fn sync_authors(conn: &Connection, items: &[XmlProduction]) -> Result<AuthorSync, String> {
    let mut by_doi: HashMap<String, i64> = HashMap::new();
    let mut by_title: HashMap<(String, Option<i64>), i64> = HashMap::new();
    let mut current: HashMap<i64, Option<String>> = HashMap::new();
    {
        let mut st = conn
            .prepare("SELECT id, ano, titulo, identifier, url, autores FROM producoes")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for (id, ano, titulo, identifier, url, autores) in rows.flatten() {
            if let Some(d) = doi_key(identifier.as_deref(), url.as_deref()) {
                by_doi.entry(d).or_insert(id);
            }
            let t = normalize_title(titulo.as_deref().unwrap_or(""));
            if !t.is_empty() {
                by_title.entry((t, ano)).or_insert(id);
            }
            current.insert(id, autores);
        }
    }

    let mut out = AuthorSync::default();
    for it in items
        .iter()
        .filter(|i| i.category == "producoes" && !i.autores.is_empty())
    {
        out.no_xml += 1;
        let id = doi_key(it.doi.as_deref(), it.url.as_deref())
            .and_then(|d| by_doi.get(&d).copied())
            .or_else(|| {
                by_title
                    .get(&(normalize_title(&it.titulo), it.ano))
                    .copied()
            });
        let Some(id) = id else {
            out.sem_correspondencia += 1;
            continue;
        };
        let json = crate::migration::lattes_xml::autores_json(&it.autores);
        if current.get(&id).cloned().flatten() == json {
            continue;
        }
        conn.execute(
            "UPDATE producoes SET autores = ?1 WHERE id = ?2",
            params![json, id],
        )
        .map_err(|e| e.to_string())?;
        current.insert(id, json);
        out.atualizadas += 1;
    }
    Ok(out)
}

// ---------------- Comparação de nomes ----------------

const PARTICLES: &[&str] = &[
    "de", "da", "do", "das", "dos", "e", "del", "della", "di", "du", "van", "von", "der", "la",
    "le",
];

/// Palavras do nome sem acentos, pontuação e partículas ("de", "da"...).
fn tokens(name: &str) -> Vec<String> {
    crate::db::fold(name)
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .filter(|t| !PARTICLES.contains(t))
        .map(str::to_string)
        .collect()
}

fn initial(t: &str) -> Option<char> {
    t.chars().next()
}

/// Formas de citação ("SILVA, M. A.; SILVA, MARIA A.") como (sobrenomes, iniciais dos prenomes).
fn citation_forms(cit: &str) -> Vec<(Vec<String>, Vec<char>)> {
    cit.split(';')
        .filter_map(|form| {
            let (sur, rest) = match form.split_once(',') {
                Some((s, r)) => (tokens(s), tokens(r)),
                None => {
                    // "M. A. Silva": a última palavra é o sobrenome
                    let mut t = tokens(form);
                    let last = t.pop()?;
                    (vec![last], t)
                }
            };
            let ini: Vec<char> = rest.iter().filter_map(|t| initial(t)).collect();
            (!sur.is_empty() && !ini.is_empty()).then_some((sur, ini))
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Confianca {
    Media,
    Alta,
}

/// O autor é o aluno? `aluno` já em palavras (ver `tokens`).
fn match_author(aluno: &[String], autor: &XmlAutor) -> Option<Confianca> {
    let (first, last) = (aluno.first()?, aluno.last()?);
    if aluno.len() < 2 {
        return None;
    }
    let a = tokens(&autor.nome);
    if a.len() >= 2 {
        if a == aluno || (&a[0] == first && a.last() == Some(last)) {
            return Some(Confianca::Alta);
        }
        let abreviado = a[0].len() == 1;
        // mesmo prenome e um dos sobrenomes em comum (nome de casada, sobrenome omitido)
        let sobrenome_comum = a[1..].iter().any(|t| t.len() > 1 && aluno[1..].contains(t));
        if &a[0] == first && sobrenome_comum {
            return Some(Confianca::Media);
        }
        // "M. A. Silva"
        if abreviado && a.last() == Some(last) && initial(&a[0]) == initial(first) {
            return Some(Confianca::Media);
        }
    }
    for (sur, ini) in citation_forms(autor.citacao.as_deref().unwrap_or("")) {
        let sobrenome_ok = sur.last() == Some(last) || sur.iter().all(|s| aluno[1..].contains(s));
        if sobrenome_ok && ini.first().copied() == initial(first) {
            return Some(Confianca::Media);
        }
    }
    None
}

// ---------------- Relatório ----------------

#[derive(Debug, Clone, Serialize)]
pub struct DiscenteMatch {
    pub orientacao_id: i64,
    pub aluno: String,
    /// Tipo da orientação (Iniciação Científica, Dissertação de mestrado...).
    pub nivel: String,
    pub ano_orientacao: Option<i64>,
    /// Como o autor aparece na produção.
    pub autor: String,
    pub confianca: Confianca,
    /// Produção muito antes ou muito depois da orientação: vale conferir.
    pub fora_periodo: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProducaoComDiscente {
    pub id: i64,
    pub titulo: String,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub journal: Option<String>,
    pub qualis: Option<String>,
    pub discentes: Vec<DiscenteMatch>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnoCount {
    pub ano: Option<i64>,
    /// Produções do ano com a lista de autores.
    pub total: usize,
}

#[derive(Debug, Default, Serialize)]
pub struct DiscentesReport {
    /// Produções com autores por ano (base para o percentual com discentes).
    pub anos_com_autores: Vec<AnoCount>,
    pub total_producoes: usize,
    /// Produções com a lista de autores (vinda do XML).
    pub com_autores: usize,
    /// Alunos distintos nas orientações.
    pub orientados: usize,
    pub itens: Vec<ProducaoComDiscente>,
}

struct Orientacao {
    id: i64,
    ano: Option<i64>,
    tipo: String,
    aluno: String,
}

fn fora_periodo(prod: Option<i64>, orient: Option<i64>) -> bool {
    match (prod, orient) {
        (Some(p), Some(o)) => p < o - 7 || p > o + 5,
        _ => false,
    }
}

pub fn report(conn: &Connection) -> Result<DiscentesReport, String> {
    // alunos agrupados pelo nome normalizado (o mesmo aluno pode ter IC, mestrado e doutorado)
    let mut alunos: HashMap<Vec<String>, Vec<Orientacao>> = HashMap::new();
    {
        let mut st = conn
            .prepare("SELECT id, ano, tipo, aluno FROM orientacoes WHERE aluno IS NOT NULL AND TRIM(aluno) <> ''")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| {
                Ok(Orientacao {
                    id: r.get(0)?,
                    ano: r.get(1)?,
                    tipo: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    aluno: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for o in rows.flatten() {
            let k = tokens(&o.aluno);
            if k.len() >= 2 {
                alunos.entry(k).or_default().push(o);
            }
        }
    }

    let mut out = DiscentesReport {
        orientados: alunos.len(),
        ..Default::default()
    };
    let mut st = conn
        .prepare("SELECT id, titulo, ano, tipo, journal, qualis, autores FROM producoes")
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut por_ano: HashMap<Option<i64>, usize> = HashMap::new();
    for (id, titulo, ano, tipo, journal, qualis, autores) in rows.flatten() {
        out.total_producoes += 1;
        let autores: Vec<XmlAutor> = autores
            .as_deref()
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();
        if autores.is_empty() {
            continue;
        }
        out.com_autores += 1;
        *por_ano.entry(ano).or_default() += 1;
        let mut discentes = Vec::new();
        for (key, orients) in &alunos {
            let best = autores
                .iter()
                .filter_map(|a| match_author(key, a).map(|c| (c, a)))
                .max_by_key(|(c, _)| *c);
            let Some((confianca, autor)) = best else {
                continue;
            };
            // a orientação mais próxima do ano da produção define o nível
            let o = orients
                .iter()
                .min_by_key(|o| match (ano, o.ano) {
                    (Some(p), Some(y)) => (p - y).abs(),
                    _ => i64::MAX,
                })
                .unwrap_or(&orients[0]);
            discentes.push(DiscenteMatch {
                orientacao_id: o.id,
                aluno: o.aluno.clone(),
                nivel: o.tipo.clone(),
                ano_orientacao: o.ano,
                autor: if autor.nome.is_empty() {
                    autor.citacao.clone().unwrap_or_default()
                } else {
                    autor.nome.clone()
                },
                confianca,
                fora_periodo: fora_periodo(ano, o.ano),
            });
        }
        if discentes.is_empty() {
            continue;
        }
        discentes.sort_by(|a, b| b.confianca.cmp(&a.confianca).then(a.aluno.cmp(&b.aluno)));
        out.itens.push(ProducaoComDiscente {
            id,
            titulo: titulo.unwrap_or_default(),
            ano,
            tipo,
            journal,
            qualis,
            discentes,
        });
    }
    out.itens
        .sort_by(|a, b| b.ano.cmp(&a.ano).then(a.titulo.cmp(&b.titulo)));
    out.anos_com_autores = por_ano
        .into_iter()
        .map(|(ano, total)| AnoCount { ano, total })
        .collect();
    out.anos_com_autores
        .sort_by_key(|a| std::cmp::Reverse(a.ano));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn autor(nome: &str, citacao: Option<&str>) -> XmlAutor {
        XmlAutor {
            nome: nome.into(),
            citacao: citacao.map(Into::into),
        }
    }

    #[test]
    fn matches_name_variants() {
        let aluno = tokens("Maria Alice da Silva Santos");
        assert_eq!(aluno, vec!["maria", "alice", "silva", "santos"]);
        let m = |a: XmlAutor| match_author(&aluno, &a);
        assert_eq!(
            m(autor("MARIA ALICE DA SILVA SANTOS", None)),
            Some(Confianca::Alta)
        );
        assert_eq!(m(autor("Maria Santos", None)), Some(Confianca::Alta));
        assert_eq!(m(autor("Maria Alice Silva", None)), Some(Confianca::Media));
        assert_eq!(m(autor("M. A. S. Santos", None)), Some(Confianca::Media));
        assert_eq!(
            m(autor("", Some("SANTOS, M. A. S.; SANTOS, MARIA"))),
            Some(Confianca::Media)
        );
        assert_eq!(m(autor("Ana Santos", Some("SANTOS, A."))), None);
        assert_eq!(m(autor("Mariana Souza", Some("SOUZA, M."))), None);
        // um nome só não é comparado
        assert_eq!(
            match_author(&tokens("Maria"), &autor("Maria Santos", None)),
            None
        );
    }

    #[test]
    fn sync_authors_by_doi_and_title() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO producoes (id, ano, tipo, titulo, identifier) VALUES
              (1, 2024, 'Artigos completos', 'Título qualquer', 'https://doi.org/10.1000/ABC'),
              (2, 2023, 'Artigos completos', 'Seleção Genômica em Milho', NULL);
            "#,
        )
        .unwrap();
        let a = XmlProduction {
            category: "producoes".into(),
            titulo: "Outro título".into(),
            ano: Some(2024),
            doi: Some("10.1000/abc".into()),
            autores: vec![autor("Fulano de Tal", Some("TAL, F."))],
            ..Default::default()
        };
        let mut b = a.clone();
        b.doi = None;
        b.titulo = "Seleção genômica em milho".into();
        b.ano = Some(2023);
        let mut c = b.clone();
        c.titulo = "Não existe no banco".into();
        let mut sem_autor = b.clone();
        sem_autor.autores.clear();

        let r = sync_authors(&conn, &[a.clone(), b, c, sem_autor]).unwrap();
        assert_eq!((r.no_xml, r.atualizadas, r.sem_correspondencia), (3, 2, 1));
        let json: String = conn
            .query_row("SELECT autores FROM producoes WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(json.contains("Fulano de Tal"));
        // rodar de novo não regrava o que já está igual
        assert_eq!(sync_authors(&conn, &[a]).unwrap().atualizadas, 0);
    }

    #[test]
    fn report_links_productions_to_students() {
        let conn = crate::db::open_in_memory().unwrap();
        let json = |v: Vec<XmlAutor>| crate::migration::lattes_xml::autores_json(&v).unwrap();
        conn.execute_batch(
            "INSERT INTO orientacoes (id, ano, tipo, aluno) VALUES
               (10, 2020, 'Iniciação Científica', 'Maria Alice Santos'),
               (11, 2024, 'Dissertação de mestrado', 'Maria Alice Santos'),
               (12, 2023, 'Tese de doutorado', 'João Pedro Lima'),
               (13, 2010, 'Iniciação Científica', 'Carla Souza');",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO producoes (id, ano, tipo, titulo, autores) VALUES (1, 2023, 'Artigos completos', 'Com discentes', ?1)",
            [json(vec![
                autor("Pesquisador Orientador", None),
                autor("Maria Alice Santos", None),
                autor("", Some("LIMA, J. P.")),
                autor("Carla Souza", None),
            ])],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO producoes (id, ano, tipo, titulo, autores) VALUES (2, 2022, 'Artigos completos', 'Sem discentes', ?1)",
            [json(vec![autor("Outra Pessoa", None)])],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO producoes (id, ano, tipo, titulo) VALUES (3, 2021, 'Livros', 'Sem autores')",
            [],
        )
        .unwrap();

        let r = report(&conn).unwrap();
        assert_eq!((r.total_producoes, r.com_autores, r.orientados), (3, 2, 3));
        let anos: Vec<(Option<i64>, usize)> = r
            .anos_com_autores
            .iter()
            .map(|a| (a.ano, a.total))
            .collect();
        assert_eq!(anos, vec![(Some(2023), 1), (Some(2022), 1)]);
        assert_eq!(r.itens.len(), 1);
        let d = &r.itens[0].discentes;
        assert_eq!(d.len(), 3);
        let maria = d.iter().find(|x| x.aluno.starts_with("Maria")).unwrap();
        // a orientação mais próxima de 2023 é o mestrado (2024)
        assert_eq!(
            (maria.orientacao_id, maria.confianca),
            (11, Confianca::Alta)
        );
        let joao = d.iter().find(|x| x.aluno.starts_with("João")).unwrap();
        assert_eq!(
            (joao.confianca, joao.autor.as_str()),
            (Confianca::Media, "LIMA, J. P.")
        );
        let carla = d.iter().find(|x| x.aluno.starts_with("Carla")).unwrap();
        assert!(carla.fora_periodo);
        assert!(!maria.fora_periodo);
    }
}
