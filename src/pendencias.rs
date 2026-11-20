//! Painel de pendências: registros que precisam de atenção (sem comprovante, arquivo ausente,
//! artigo sem DOI ou Qualis, campos essenciais vazios).

use crate::db::models::RecordDto;
use crate::db::queries;
use crate::files::linker;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::path::Path;

/// Tipo de pendência. Serializado em snake_case (`sem_comprovante`, `arquivo_ausente`...).
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    SemComprovante,
    ArquivoAusente,
    SemDoi,
    SemQualis,
    SemAno,
    SemTitulo,
}

impl Kind {
    fn key(self) -> &'static str {
        match self {
            Kind::SemComprovante => "sem_comprovante",
            Kind::ArquivoAusente => "arquivo_ausente",
            Kind::SemDoi => "sem_doi",
            Kind::SemQualis => "sem_qualis",
            Kind::SemAno => "sem_ano",
            Kind::SemTitulo => "sem_titulo",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Pendencia {
    pub category: String,
    pub id: i64,
    /// Rótulo do registro (título, descrição, disciplina, aluno ou tipo).
    pub titulo: String,
    pub ano: Option<i64>,
    /// Tipo do registro (ex.: "Artigos completos").
    pub tipo: Option<String>,
    pub kind: Kind,
    /// Detalhe da pendência: o caminho do arquivo ausente, por exemplo.
    pub detalhe: Option<String>,
}

#[derive(Debug, Default, Serialize)]
pub struct Relatorio {
    pub total_registros: usize,
    pub registros_com_pendencia: usize,
    /// Quantidade de itens por tipo de pendência (chave em snake_case).
    pub por_tipo: BTreeMap<String, usize>,
    pub itens: Vec<Pendencia>,
}

fn filled(s: &Option<String>) -> bool {
    s.as_deref().is_some_and(|x| !x.trim().is_empty())
}

/// Artigos em periódico: os tipos do app que começam com "Artigo" (completos, aceitos...).
fn is_artigo(r: &RecordDto) -> bool {
    r.tipo
        .as_deref()
        .is_some_and(|t| t.trim().to_lowercase().starts_with("artigo"))
}

fn has_doi(r: &RecordDto) -> bool {
    [&r.identifier, &r.url]
        .into_iter()
        .flatten()
        .any(|s| crate::doi::parse_doi(s).is_some())
}

/// Pendências de um registro. `root` é a pasta do currículo, para conferir os arquivos no disco.
fn of_record(cat: &str, r: &RecordDto, root: &Path) -> Vec<(Kind, Option<String>)> {
    let mut out = Vec::new();

    let mut paths: Vec<&str> = Vec::new();
    let mut seen = HashSet::new();
    let candidates = r
        .path
        .as_deref()
        .into_iter()
        .chain(r.attachments.iter().map(|a| a.path.as_str()));
    for p in candidates {
        if !p.trim().is_empty() && seen.insert(linker::norm_rel(p)) {
            paths.push(p);
        }
    }
    if paths.is_empty() {
        out.push((Kind::SemComprovante, None));
    }
    for p in paths {
        if !crate::files::rel_join(root, p).is_file() {
            out.push((Kind::ArquivoAusente, Some(p.to_string())));
        }
    }

    if cat == "producoes" && is_artigo(r) {
        if !has_doi(r) {
            out.push((Kind::SemDoi, None));
        }
        if !filled(&r.qualis) {
            out.push((Kind::SemQualis, None));
        }
    }
    if cat != "dadosgerais" && r.ano.is_none() {
        out.push((Kind::SemAno, None));
    }
    if ![&r.titulo, &r.descricao, &r.disciplina, &r.aluno]
        .into_iter()
        .any(filled)
    {
        out.push((Kind::SemTitulo, None));
    }
    out
}

/// Varre todas as categorias (padrão e personalizadas) e lista as pendências de cada registro.
pub fn scan(conn: &Connection, root: &Path) -> Result<Relatorio, String> {
    let mut rel = Relatorio::default();
    for cat in crate::tools::all_categories(conn) {
        let recs = queries::get_records(conn, &cat, None, None, None).map_err(|e| e.to_string())?;
        for r in recs {
            rel.total_registros += 1;
            let found = of_record(&cat, &r, root);
            if found.is_empty() {
                continue;
            }
            rel.registros_com_pendencia += 1;
            let titulo = crate::tools::label_of(&r);
            for (kind, detalhe) in found {
                *rel.por_tipo.entry(kind.key().to_string()).or_default() += 1;
                rel.itens.push(Pendencia {
                    category: cat.clone(),
                    id: r.id,
                    titulo: titulo.clone(),
                    ano: r.ano,
                    tipo: r.tipo.clone(),
                    kind,
                    detalhe,
                });
            }
        }
    }
    // Mais recentes primeiro; sem ano por último.
    rel.itens.sort_by(|a, b| {
        b.ano
            .cmp(&a.ano)
            .then(a.category.cmp(&b.category))
            .then(a.id.cmp(&b.id))
    });
    Ok(rel)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(rel: &Relatorio, cat: &str, id: i64) -> Vec<Kind> {
        let mut v: Vec<Kind> = rel
            .itens
            .iter()
            .filter(|p| p.category == cat && p.id == id)
            .map(|p| p.kind)
            .collect();
        v.sort();
        v
    }

    #[test]
    fn detects_each_kind_of_pendencia() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let ok_file = crate::files::rel_join(root, r"5_producoes\artigos\001_ok.pdf");
        std::fs::create_dir_all(ok_file.parent().unwrap()).unwrap();
        std::fs::write(&ok_file, b"%PDF").unwrap();

        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            -- 1: artigo completo, sem nenhuma pendência
            INSERT INTO producoes (id, ano, tipo, titulo, identifier, qualis, path)
              VALUES (1, 2024, 'Artigos completos', 'Artigo ok', '10.1000/ok', 'A1',
                      '5_producoes\artigos\001_ok.pdf');
            -- 2: artigo sem DOI, sem Qualis e sem comprovante
            INSERT INTO producoes (id, ano, tipo, titulo) VALUES (2, 2023, 'Artigos completos', 'Artigo B');
            -- 3: artigo com DOI só no link, arquivo vinculado que não existe
            INSERT INTO producoes (id, ano, tipo, titulo, url, qualis, path)
              VALUES (3, 2022, 'Artigos aceitos', 'Artigo C', 'https://doi.org/10.1000/c', 'B1',
                      '5_producoes\artigos\sumiu.pdf');
            -- 4: livro sem DOI nem Qualis (não é pendência), mas sem ano e sem comprovante
            INSERT INTO producoes (id, tipo, titulo) VALUES (4, 'Livros', 'Livro D');
            -- 5: banca sem título, sem ano e sem comprovante
            INSERT INTO bancas (id) VALUES (5);
            -- 6: dados gerais sem ano não é pendência de ano
            INSERT INTO dadosgerais (id, tipo, descricao, path)
              VALUES (6, 'RG', 'Identidade', '5_producoes\artigos\001_ok.pdf');
            "#,
        )
        .unwrap();

        let rel = scan(&conn, root).unwrap();
        assert_eq!(rel.total_registros, 6);
        assert!(kinds(&rel, "producoes", 1).is_empty());
        assert_eq!(
            kinds(&rel, "producoes", 2),
            vec![Kind::SemComprovante, Kind::SemDoi, Kind::SemQualis]
        );
        assert_eq!(kinds(&rel, "producoes", 3), vec![Kind::ArquivoAusente]);
        assert_eq!(
            kinds(&rel, "producoes", 4),
            vec![Kind::SemComprovante, Kind::SemAno]
        );
        assert_eq!(
            kinds(&rel, "bancas", 5),
            vec![Kind::SemComprovante, Kind::SemAno, Kind::SemTitulo]
        );
        assert!(kinds(&rel, "dadosgerais", 6).is_empty());
        assert_eq!(rel.registros_com_pendencia, 4);

        let missing = rel
            .itens
            .iter()
            .find(|p| p.kind == Kind::ArquivoAusente)
            .unwrap();
        assert_eq!(
            missing.detalhe.as_deref(),
            Some(r"5_producoes\artigos\sumiu.pdf")
        );
        assert_eq!(rel.por_tipo.get("sem_comprovante"), Some(&3));
        assert_eq!(rel.por_tipo.get("sem_doi"), Some(&1));

        // Mais recentes primeiro; sem ano por último.
        assert_eq!(rel.itens.first().unwrap().ano, Some(2023));
        assert_eq!(rel.itens.last().unwrap().ano, None);
    }

    #[test]
    fn attachment_counts_as_proof_and_is_checked_on_disk() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO producoes (id, ano, tipo, titulo) VALUES (1, 2024, 'Livros', 'Livro')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO record_attachments (category, record_id, file, path, ord)
             VALUES ('producoes', 1, 'x.pdf', '5_producoes\\livros\\x.pdf', 1)",
            [],
        )
        .unwrap();
        let rel = scan(&conn, tmp.path()).unwrap();
        assert_eq!(kinds(&rel, "producoes", 1), vec![Kind::ArquivoAusente]);
    }
}
