//! Extração de metadados de um PDF (artigo, capítulo…) para acelerar o cadastro.
//!
//! 1. Lê os metadados embutidos (Info/XMP) e o texto das 2 primeiras páginas.
//! 2. Procura o DOI (metadados → 1ª página → 2ª página).
//! 3. Com DOI, consulta a Crossref (título, revista, ano, autores, tipo).
//! 4. Sem DOI ou sem internet, usa o que o PDF informa (título, ano mais citado na 1ª página).
//! 5. Sugere Qualis pelo histórico da mesma revista no banco e detecta duplicatas.

use crate::files::linker::{dice, trigrams};
use crate::migration::lattes_xml::normalize_title;
use pdf_extract::{Document, Object, PlainTextOutput};
use regex::Regex;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Duplicate {
    pub id: i64,
    pub titulo: String,
    pub motivo: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PdfMetadata {
    pub doi: Option<String>,
    pub titulo: Option<String>,
    pub journal: Option<String>,
    pub ano: Option<i64>,
    pub autores: Vec<String>,
    pub volume: Option<String>,
    pub paginas: Option<String>,
    pub editora: Option<String>,
    pub issn: Vec<String>,
    /// tipo Crossref (journal-article, book-chapter…)
    pub crossref_type: Option<String>,
    /// tipo sugerido no vocabulário do app ("Artigos completos"…)
    pub tipo_sugerido: Option<String>,
    pub qualis_sugerido: Option<String>,
    /// "crossref" quando confirmado online; "pdf" quando só do arquivo
    pub fonte: String,
    pub duplicata: Option<Duplicate>,
    pub avisos: Vec<String>,
    pub paginas_pdf: usize,
}

fn doi_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r#"(?i)\b(10\.\d{4,9}/[^\s"<>{}|\\^`\[\]]+)"#).unwrap())
}

/// Limpa pontuação final e sufixos comuns grudados ao DOI no texto extraído.
pub fn clean_doi(raw: &str) -> String {
    let mut d = raw
        .trim()
        .trim_end_matches(['.', ',', ';', ':', ')', ']', '\'', '"'])
        .to_string();
    // parênteses desbalanceados no fim (ex.: "...(2020)" é válido, "...x)" não)
    while d.ends_with(')') && d.matches('(').count() < d.matches(')').count() {
        d.pop();
    }
    for suf in ["/abstract", "/full", "/pdf", "/epdf", "/meta"] {
        if d.to_lowercase().ends_with(suf) {
            d.truncate(d.len() - suf.len());
        }
    }
    d.to_lowercase()
}

/// Primeiro DOI de um texto (em ordem de aparição).
pub fn find_doi(text: &str) -> Option<String> {
    // junta quebras de linha dentro do DOI ("10.1016/j.cj.\n2026.05.010")
    let joined = text
        .replace("-\n", "-")
        .replace("/\n", "/")
        .replace(".\n", ".");
    doi_re()
        .captures_iter(&joined)
        .map(|c| clean_doi(&c[1]))
        .find(|d| d.len() > 8)
}

/// Ano mais frequente entre 1950 e o ano seguinte ao atual.
pub fn guess_year(text: &str) -> Option<i64> {
    static R: OnceLock<Regex> = OnceLock::new();
    let re = R.get_or_init(|| Regex::new(r"\b(19[5-9]\d|20\d\d)\b").unwrap());
    let max = chrono::Local::now()
        .format("%Y")
        .to_string()
        .parse::<i64>()
        .unwrap_or(2100)
        + 1;
    let mut c: HashMap<i64, usize> = HashMap::new();
    for m in re.captures_iter(text) {
        if let Ok(y) = m[1].parse::<i64>() {
            if y <= max {
                *c.entry(y).or_default() += 1;
            }
        }
    }
    // empate → ano mais recente (data de publicação costuma ser a mais recente da 1ª página)
    c.into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(&b.0)))
        .map(|(y, _)| y)
}

/// Decodifica string PDF (UTF-16BE com BOM ou PDFDocEncoding≈Latin-1).
fn pdf_string(o: &Object) -> Option<String> {
    let bytes = match o {
        Object::String(b, _) => b.as_slice(),
        Object::Name(b) => b.as_slice(),
        _ => return None,
    };
    let s = if bytes.starts_with(&[0xFE, 0xFF]) {
        let u: Vec<u16> = bytes[2..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&c| u16::from_be_bytes(c))
            .collect();
        String::from_utf16_lossy(&u)
    } else if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8_lossy(&bytes[3..]).to_string()
    } else {
        bytes.iter().map(|&b| b as char).collect()
    };
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    (!s.is_empty()).then_some(s)
}

fn info_dict(doc: &Document) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let info = doc.trailer.get(b"Info").ok().and_then(|o| match o {
        Object::Reference(id) => doc.get_dictionary(*id).ok(),
        Object::Dictionary(d) => Some(d),
        _ => None,
    });
    if let Some(d) = info {
        for (k, v) in d.iter() {
            if let Some(s) = pdf_string(v) {
                m.insert(String::from_utf8_lossy(k).to_lowercase(), s);
            }
        }
    }
    m
}

/// Títulos de metadados que não são o título real ("Microsoft Word - x.docx", nomes de arquivo…).
fn plausible_title(t: &str) -> bool {
    let l = t.to_lowercase();
    t.chars().filter(|c| c.is_alphabetic()).count() >= 15
        && t.split_whitespace().count() >= 3
        && !l.starts_with("microsoft word")
        && !l.contains(".doc")
        && !l.contains(".pdf")
        && !l.contains(".tex")
        && !l.starts_with("untitled")
        && !l.starts_with("doi:")
        && !doi_re().is_match(t)
}

/// Texto das primeiras `n` páginas (protegido contra pânicos do extrator).
pub fn first_pages_text(doc: &Document, n: u32) -> Vec<String> {
    let mut out = Vec::new();
    for page in 1..=n {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut s = String::new();
            {
                let mut o = PlainTextOutput::new(&mut s);
                pdf_extract::output_doc_page(doc, &mut o, page).map(|_| ())
            }
            .map(|_| s)
        }));
        match r {
            Ok(Ok(s)) => out.push(s),
            _ => break,
        }
    }
    out
}

/// Extração local (sem rede).
pub fn extract_local(bytes: &[u8]) -> Result<PdfMetadata, String> {
    extract_local_with_text(bytes).map(|(md, _)| md)
}

/// Extração local + texto da 1ª página (usado na busca bibliográfica).
pub fn extract_local_with_text(bytes: &[u8]) -> Result<(PdfMetadata, String), String> {
    let mut doc = Document::load_mem(bytes).map_err(|e| format!("PDF ilegível: {}", e))?;
    if doc.is_encrypted() {
        let _ = doc.decrypt("");
    }
    let mut md = PdfMetadata {
        fonte: "pdf".into(),
        paginas_pdf: doc.get_pages().len(),
        ..Default::default()
    };
    let info = info_dict(&doc);
    let pages = first_pages_text(&doc, 2);
    let p1 = pages.first().cloned().unwrap_or_default();

    // XMP: procura DOI declarado (prism:doi, dc:identifier, pdfx:doi) no fluxo de metadados, se não comprimido
    let raw = String::from_utf8_lossy(bytes);
    let xmp_doi = ["prism:doi", "pdfx:doi", "dc:identifier", "crossmark:doi"]
        .iter()
        .find_map(|tag| {
            raw.find(tag)
                .and_then(|i| find_doi(&raw[i..(i + 300).min(raw.len())]))
        });

    md.doi = info
        .get("doi")
        .and_then(|d| find_doi(d))
        .or(xmp_doi)
        .or_else(|| info.get("subject").and_then(|s| find_doi(s)))
        .or_else(|| find_doi(&p1))
        .or_else(|| pages.get(1).and_then(|p| find_doi(p)));

    md.titulo = info.get("title").filter(|t| plausible_title(t)).cloned();
    if let Some(a) = info.get("author").filter(|a| a.len() > 2) {
        md.autores = a
            .split([';', ','])
            .map(|s| s.trim().to_string())
            .filter(|s| s.chars().filter(|c| c.is_alphabetic()).count() >= 3)
            .collect();
    }
    // "Subject" de editoras costuma ser "Revista, vol, páginas. doi:..."
    if let Some(sub) = info.get("subject") {
        let j = sub.split([',', '.']).next().unwrap_or("").trim();
        if j.chars().filter(|c| c.is_alphabetic()).count() >= 4
            && !doi_re().is_match(j)
            && j.len() < 120
        {
            md.journal = Some(j.to_string());
        }
    }
    md.ano = guess_year(&p1);
    if p1.trim().is_empty() {
        md.avisos.push("O PDF não tem texto selecionável (pode ser digitalizado); só os metadados embutidos foram lidos.".into());
    }
    Ok((md, p1))
}

/// Sem DOI: busca bibliográfica na Crossref com o título (ou o começo da 1ª página).
/// Só aceita um resultado cujo título esteja de fato no PDF — evita casar com o artigo errado.
pub fn crossref_search(titulo: Option<&str>, page1: &str) -> Result<Option<Value>, String> {
    let head: String = page1
        .split_whitespace()
        .take(60)
        .collect::<Vec<_>>()
        .join(" ");
    let query = titulo.map(String::from).unwrap_or(head);
    if query.chars().filter(|c| c.is_alphabetic()).count() < 15 {
        return Ok(None);
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(8))
        .build();
    let v = agent
        .get("https://api.crossref.org/works")
        .query("query.bibliographic", &query)
        .query("rows", "5")
        .query("select", "DOI,title,subtitle,container-title,issued,published-print,published-online,author,type,volume,page,publisher,ISSN")
        .set("User-Agent", concat!("LattesManager/", env!("CARGO_PKG_VERSION")));
    let v = call_json(v)?;
    let p1n = normalize_title(page1);
    let tt = titulo.map(trigrams);
    let hits: Vec<&Value> = v["message"]["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|it| {
            let Some(t) = first_str(&it["title"]) else {
                return false;
            };
            let tn = normalize_title(&t);
            tn.len() >= 20
                && (p1n.contains(&tn)
                    || tt
                        .as_ref()
                        .map(|x| dice(x, &trigrams(&t)) >= 0.85)
                        .unwrap_or(false))
        })
        .collect();
    // mesmo título como preprint e como artigo: fica com a versão publicada
    let hit = hits
        .iter()
        .find(|it| it["type"].as_str() != Some("posted-content"))
        .or(hits.first());
    Ok(hit.map(|v| (*v).clone()))
}

/// Consulta a Crossref para um DOI (timeout curto; sem dados pessoais na requisição).
pub fn crossref(doi: &str) -> Result<Value, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(8))
        .build();
    let url = format!("https://api.crossref.org/works/{}", urlencode(doi));
    let v = call_json(agent.get(&url).set(
        "User-Agent",
        concat!("LattesManager/", env!("CARGO_PKG_VERSION")),
    ))?;
    Ok(v["message"].clone())
}

/// Executa a requisição; repete uma vez se a Crossref pedir para esperar (429/503).
fn call_json(req: ureq::Request) -> Result<Value, String> {
    let mut tries = 0;
    loop {
        tries += 1;
        match req.clone().call() {
            Ok(r) => {
                return r
                    .into_json()
                    .map_err(|e| format!("Resposta inválida da Crossref ({})", e))
            }
            Err(ureq::Error::Status(code @ (429 | 503), _)) if tries < 3 => {
                let _ = code;
                std::thread::sleep(Duration::from_millis(1500 * tries));
            }
            Err(ureq::Error::Status(404, _)) => return Err("DOI não encontrado na Crossref".into()),
            Err(ureq::Error::Status(429, _)) => {
                return Err("Crossref ocupada no momento — tente de novo em instantes".into())
            }
            Err(ureq::Error::Status(code, _)) => {
                return Err(format!("Crossref respondeu com erro {}", code))
            }
            Err(ureq::Error::Transport(_)) => {
                return Err("sem conexão com a Crossref (internet indisponível?)".into())
            }
        }
    }
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'~'
            | b'/'
            | b'('
            | b')'
            | b';'
            | b':' => (b as char).to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect()
}

fn first_str(v: &Value) -> Option<String> {
    let s = match v {
        Value::Array(a) => a.first()?.as_str()?.to_string(),
        Value::String(s) => s.clone(),
        _ => return None,
    };
    let s = crate::migration::lattes_xml::clean_text(&s);
    (!s.is_empty()).then_some(s)
}

/// Aplica a resposta da Crossref sobre os metadados locais.
pub fn merge_crossref(md: &mut PdfMetadata, m: &Value) {
    if let Some(t) = first_str(&m["title"]) {
        md.titulo = Some(match first_str(&m["subtitle"]) {
            Some(sub) if !t.contains(&sub) => format!("{}: {}", t, sub),
            _ => t,
        });
    }
    md.journal = first_str(&m["container-title"]).or(md.journal.take());
    for k in [
        "published-print",
        "published-online",
        "issued",
        "published",
        "created",
    ] {
        if let Some(y) = m[k]["date-parts"][0][0].as_i64() {
            md.ano = Some(y);
            break;
        }
    }
    if let Some(a) = m["author"].as_array() {
        let names: Vec<String> = a
            .iter()
            .filter_map(|p| {
                let fam = p["family"].as_str().or(p["name"].as_str())?;
                Some(match p["given"].as_str() {
                    Some(g) => format!("{} {}", g, fam),
                    None => fam.to_string(),
                })
            })
            .collect();
        if !names.is_empty() {
            md.autores = names;
        }
    }
    md.volume = m["volume"].as_str().map(String::from);
    md.paginas = m["page"].as_str().map(String::from);
    md.editora = m["publisher"].as_str().map(String::from);
    md.issn = m["ISSN"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    md.crossref_type = m["type"].as_str().map(String::from);
    md.fonte = "crossref".into();
}

/// Tipo do app a partir do tipo Crossref, escolhendo entre as opções cadastradas.
pub fn suggest_tipo(crossref_type: Option<&str>, options: &[String]) -> Option<String> {
    let pats: &[&str] = match crossref_type? {
        "journal-article" => &["artigos completos", "artigo"],
        "book-chapter" | "book-section" | "book-part" => &["capítulo", "capitulo"],
        "book" | "monograph" | "edited-book" | "reference-book" => &["livro"],
        "proceedings-article" => &["resumos completos", "trabalhos completos", "resumo"],
        "posted-content" => &["artigos aceitos", "artigo"],
        _ => return None,
    };
    pats.iter().find_map(|p| {
        options
            .iter()
            .find(|o| o.to_lowercase().contains(p))
            .cloned()
    })
}

/// Qualis mais recente já atribuído à mesma revista no banco.
pub fn suggest_qualis(conn: &Connection, journal: &str) -> Option<String> {
    let key = normalize_title(journal);
    if key.len() < 4 {
        return None;
    }
    let mut st = conn
        .prepare("SELECT journal, qualis FROM producoes WHERE qualis IS NOT NULL AND TRIM(qualis) <> '' AND journal IS NOT NULL ORDER BY ano DESC, id DESC")
        .ok()?;
    let rows = st
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .ok()?;
    let found = rows
        .flatten()
        .find(|(j, _)| normalize_title(j) == key)
        .map(|(_, q)| q.trim().to_uppercase());
    found
}

/// Produção já cadastrada com o mesmo DOI ou título quase idêntico.
pub fn find_duplicate(
    conn: &Connection,
    doi: Option<&str>,
    titulo: Option<&str>,
) -> Option<Duplicate> {
    let mut st = conn
        .prepare("SELECT id, COALESCE(titulo, ''), COALESCE(identifier, '') FROM producoes")
        .ok()?;
    let rows: Vec<(i64, String, String)> = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .ok()?
        .flatten()
        .collect();
    if let Some(d) = doi {
        if let Some((id, t, _)) = rows
            .iter()
            .find(|(_, _, ident)| ident.to_lowercase().contains(d))
        {
            return Some(Duplicate {
                id: *id,
                titulo: t.clone(),
                motivo: "mesmo DOI".into(),
            });
        }
    }
    let t = titulo?;
    let tt = trigrams(t);
    if tt.len() < 12 {
        return None;
    }
    rows.iter()
        .map(|(id, ti, _)| (id, ti, dice(&tt, &trigrams(ti))))
        .filter(|(_, _, s)| *s >= 0.9)
        .max_by(|a, b| a.2.total_cmp(&b.2))
        .map(|(id, ti, s)| Duplicate {
            id: *id,
            titulo: ti.clone(),
            motivo: format!("título {}% igual", (s * 100.0).round()),
        })
}

/// Fluxo completo: PDF → (Crossref) → sugestões do banco.
pub fn extract(
    bytes: &[u8],
    conn: &Connection,
    tipo_options: &[String],
    online: bool,
) -> Result<PdfMetadata, String> {
    let mut md = extract_remote(bytes, tipo_options, online)?;
    enrich_from_db(conn, &mut md);
    Ok(md)
}

/// Sugestões que dependem do banco (Qualis da revista, duplicatas). Rápido; feito com o banco travado.
pub fn enrich_from_db(conn: &Connection, md: &mut PdfMetadata) {
    // Qualis oficial da CAPES (tabela importada) tem prioridade sobre o histórico do banco
    md.qualis_sugerido = crate::qualis::lookup(conn, &md.issn, md.journal.as_deref())
        .map(|e| e.estrato)
        .or_else(|| md.journal.as_deref().and_then(|j| suggest_qualis(conn, j)));
    md.duplicata = find_duplicate(conn, md.doi.as_deref(), md.titulo.as_deref());
}

/// PDF + Crossref, sem tocar no banco (pode levar alguns segundos com rede).
pub fn extract_remote(
    bytes: &[u8],
    tipo_options: &[String],
    online: bool,
) -> Result<PdfMetadata, String> {
    let (mut md, p1) = extract_local_with_text(bytes)?;
    match (md.doi.clone(), online) {
        (Some(doi), true) => match crossref(&doi) {
            Ok(m) => merge_crossref(&mut md, &m),
            Err(e) => md
                .avisos
                .push(format!("{} — usando apenas os dados do PDF.", e)),
        },
        (None, true) => {
            match crossref_search(md.titulo.as_deref(), &p1) {
                Ok(Some(m)) => {
                    md.doi = m["DOI"].as_str().map(|d| d.to_lowercase());
                    merge_crossref(&mut md, &m);
                    md.avisos.push("O DOI não estava no PDF; foi encontrado na Crossref pelo título — confira.".into());
                }
                Ok(None) => md.avisos.push(
                    "DOI não encontrado no PDF nem na Crossref; preencha os campos que faltarem."
                        .into(),
                ),
                Err(e) => md.avisos.push(format!("DOI não encontrado no PDF; {}.", e)),
            }
        }
        (None, false) => md
            .avisos
            .push("DOI não encontrado no PDF; preencha os campos que faltarem.".into()),
        (Some(_), false) => {}
    }
    md.tipo_sugerido = suggest_tipo(md.crossref_type.as_deref(), tipo_options);
    Ok(md)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_and_cleans_dois() {
        assert_eq!(
            find_doi("Available: https://doi.org/10.1016/j.cj.2026.05.010."),
            Some("10.1016/j.cj.2026.05.010".into())
        );
        assert_eq!(
            find_doi("doi:10.1111/jph.70414)"),
            Some("10.1111/jph.70414".into())
        );
        assert_eq!(
            find_doi("DOI 10.1007/s10681-025-03513-8\nnext"),
            Some("10.1007/s10681-025-03513-8".into())
        );
        assert_eq!(
            find_doi("10.1590/0103-8478cr20190123/abstract"),
            Some("10.1590/0103-8478cr20190123".into())
        );
        assert_eq!(find_doi("sem doi aqui"), None);
    }

    #[test]
    fn guesses_year_and_titles() {
        assert_eq!(
            guess_year("Received 2025, accepted 2026, published 2026"),
            Some(2026)
        );
        assert!(plausible_title("Pixel size and spatial scale in phenomics"));
        assert!(!plausible_title("Microsoft Word - artigo_final.docx"));
        assert!(!plausible_title("10.1016/j.cj.2026.05.010"));
    }

    #[test]
    fn maps_crossref_types() {
        let opts: Vec<String> = [
            "Artigos completos",
            "Capítulos de livros",
            "Livros",
            "Resumos completos",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(
            suggest_tipo(Some("journal-article"), &opts).as_deref(),
            Some("Artigos completos")
        );
        assert_eq!(
            suggest_tipo(Some("book-chapter"), &opts).as_deref(),
            Some("Capítulos de livros")
        );
        assert_eq!(suggest_tipo(Some("dataset"), &opts), None);
    }

    #[test]
    fn merges_crossref_json() {
        let m: Value = serde_json::json!({
            "title": ["MGIDI: toward an effective multivariate selection in biological experiments"],
            "container-title": ["Bioinformatics"],
            "issued": {"date-parts": [[2021, 4]]},
            "author": [{"given": "Tiago", "family": "Olivoto"}, {"given": "Maicon", "family": "Nardino"}],
            "type": "journal-article", "volume": "37", "page": "1383-1389", "publisher": "Oxford University Press"
        });
        let mut md = PdfMetadata::default();
        merge_crossref(&mut md, &m);
        assert_eq!(md.journal.as_deref(), Some("Bioinformatics"));
        assert_eq!(md.ano, Some(2021));
        assert_eq!(md.autores, vec!["Tiago Olivoto", "Maicon Nardino"]);
        assert_eq!(md.fonte, "crossref");
    }

    /// Fluxo completo com rede (Crossref). Rode com: LATTES_ONLINE=1 cargo test online -- --nocapture
    #[test]
    fn online_full_flow_if_enabled() {
        if std::env::var("LATTES_ONLINE").is_err() {
            return;
        }
        let dir = std::path::Path::new(r"d:\Desktop\UFSC\lattes\5_producoes\artigos_completos");
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE producoes (id INTEGER, titulo TEXT, identifier TEXT, journal TEXT, qualis TEXT, ano INTEGER);").unwrap();
        let opts: Vec<String> = ["Artigos completos", "Capítulos de livros"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        for name in [
            "137_Artigo linho_Dose de N_Follmann_2024 (1).pdf",
            "117_Klein et al. - 2023 - Selection of superior black oat lines using the MG.pdf",
            "143_1-s2.0-S2214514126001510-main.pdf",
            "101_UFSMFW 2101.pdf",
        ] {
            let f = dir.join(name);
            if !f.exists() {
                continue;
            }
            let md = extract(&std::fs::read(&f).unwrap(), &conn, &opts, true).unwrap();
            println!(
                "{}\n  fonte={} doi={:?} ano={:?} tipo={:?}\n  titulo={:?}\n  revista={:?} autores={}\n  avisos={:?}",
                name, md.fonte, md.doi, md.ano, md.tipo_sugerido, md.titulo, md.journal, md.autores.len(), md.avisos
            );
        }
    }

    /// Lê PDFs reais da pasta do usuário (sem rede) e imprime o que foi extraído.
    #[test]
    fn extracts_from_real_pdfs_if_present() {
        let dir = [
            r"d:\Desktop\UFSC\lattes\tt\5_producoes\artigos_completos",
            r"d:\Desktop\UFSC\lattes\5_producoes\artigos_completos",
        ]
        .into_iter()
        .map(std::path::Path::new)
        .find(|p| p.is_dir());
        let Some(dir) = dir else { return };
        let mut files: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().map(|e| e == "pdf").unwrap_or(false))
            .collect();
        files.sort();
        let (mut n, mut with_doi) = (0, 0);
        for f in files.iter().rev().take(25) {
            let bytes = std::fs::read(f).unwrap();
            let t0 = std::time::Instant::now();
            match extract_local(&bytes) {
                Ok(md) => {
                    n += 1;
                    if md.doi.is_some() {
                        with_doi += 1;
                    }
                    println!(
                        "{:>5}ms {:?} | doi={:?} ano={:?} | {}",
                        t0.elapsed().as_millis(),
                        f.file_name().unwrap(),
                        md.doi,
                        md.ano,
                        md.titulo
                            .unwrap_or_default()
                            .chars()
                            .take(50)
                            .collect::<String>()
                    );
                }
                Err(e) => println!("ERRO {:?}: {}", f.file_name().unwrap(), e),
            }
        }
        println!("{} lidos, {} com DOI", n, with_doi);
        assert!(n > 0);
    }
}
