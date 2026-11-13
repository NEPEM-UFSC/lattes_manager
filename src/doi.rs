//! "Resolver DOI" (à la Zotero): DOI → metadados (Crossref, com OpenAlex de reserva)
//! → localiza versões em acesso aberto (OpenAlex/Unpaywall + links da Crossref)
//! → baixa o primeiro PDF válido para uma pasta temporária. O cadastro copia o
//! arquivo para a subpasta da produção, como qualquer comprovante anexado.
//!
//! Só baixa de endereços públicos de acesso aberto, com um User-Agent identificado;
//! quando a editora bloqueia downloads automáticos, devolve o link para o usuário
//! abrir no navegador.

use crate::metadata::{self, PdfMetadata};
use crate::migration::lattes_xml::normalize_title;
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;

const UA: &str = concat!("LattesManager/", env!("CARGO_PKG_VERSION"), " (gerenciador de curriculo; download de acesso aberto)");
const MAX_PDF: u64 = 120 * 1024 * 1024;

#[derive(Debug, Clone, Default, Serialize)]
pub struct PdfCandidate {
    pub url: String,
    /// domínio de origem (www.scielo.br, eprints…)
    pub host: String,
    /// "publicada" | "aceita" | "preprint" | "?"
    pub versao: String,
    pub licenca: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DoiResult {
    pub meta: PdfMetadata,
    /// gold/green/hybrid/bronze/closed (OpenAlex)
    pub oa_status: Option<String>,
    pub candidatos: Vec<PdfCandidate>,
    /// caminho absoluto do PDF baixado (pasta temporária)
    pub pdf_path: Option<String>,
    pub pdf_url: Option<String>,
    pub pdf_versao: Option<String>,
    pub pdf_bytes: u64,
    /// tentativas que falharam ("www.mdpi.com: bloqueado pela editora (403)")
    pub falhas: Vec<String>,
}

/// Aceita "10.x/...", "doi:10.x/...", "https://doi.org/10.x/..." (inclusive %2F).
pub fn parse_doi(input: &str) -> Option<String> {
    let s = input.trim().replace("%2F", "/").replace("%2f", "/");
    metadata::find_doi(&s)
}

fn agent(secs: u64) -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(secs)).redirects(8).build()
}

fn host_of(url: &str) -> String {
    url.split("://").nth(1).unwrap_or(url).split(['/', '?']).next().unwrap_or("").to_string()
}

fn versao(v: Option<&str>) -> String {
    match v {
        Some("publishedVersion") => "publicada",
        Some("acceptedVersion") => "aceita",
        Some("submittedVersion") => "preprint",
        _ => "?",
    }
    .into()
}

/// OpenAlex (dados de acesso aberto do Unpaywall). Sem chave, sem dados pessoais.
pub fn openalex(doi: &str) -> Result<Value, String> {
    let url = format!("https://api.openalex.org/works/doi:{}", doi);
    match agent(10).get(&url).set("User-Agent", UA).call() {
        Ok(r) => r.into_json().map_err(|e| format!("resposta inválida do OpenAlex ({})", e)),
        Err(ureq::Error::Status(404, _)) => Err("DOI não encontrado no OpenAlex".into()),
        Err(ureq::Error::Status(c, _)) => Err(format!("OpenAlex respondeu com erro {}", c)),
        Err(ureq::Error::Transport(_)) => Err("sem conexão com o OpenAlex".into()),
    }
}

/// Lista de PDFs candidatos, na ordem de preferência: versão publicada → aceita → preprint.
pub fn candidates(oa: Option<&Value>, crossref: Option<&Value>) -> Vec<PdfCandidate> {
    let mut out: Vec<(u8, PdfCandidate)> = Vec::new();
    let mut push = |url: &str, v: Option<&str>, lic: Option<&str>, bonus: u8| {
        let url = url.trim();
        if !url.starts_with("http") || out.iter().any(|(_, c)| c.url == url) {
            return;
        }
        let ver = versao(v);
        let rank = match ver.as_str() {
            "publicada" => 0,
            "aceita" => 10,
            "?" => 15,
            _ => 20,
        } + bonus;
        out.push((rank, PdfCandidate { url: url.into(), host: host_of(url), versao: ver, licenca: lic.map(String::from) }));
    };
    if let Some(oa) = oa {
        let b = &oa["best_oa_location"];
        if let Some(u) = b["pdf_url"].as_str() {
            push(u, b["version"].as_str(), b["license"].as_str(), 0);
        }
        for l in oa["locations"].as_array().into_iter().flatten() {
            if let Some(u) = l["pdf_url"].as_str() {
                push(u, l["version"].as_str(), l["license"].as_str(), 1);
            }
        }
        if let Some(u) = oa["open_access"]["oa_url"].as_str() {
            push(u, None, None, 2);
        }
    }
    if let Some(cr) = crossref {
        // links "text-mining"/"similarity-checking" que as editoras declaram na Crossref
        for l in cr["link"].as_array().into_iter().flatten() {
            if l["content-type"].as_str() == Some("application/pdf") {
                if let Some(u) = l["URL"].as_str() {
                    push(u, Some("publishedVersion"), None, 5);
                }
            }
        }
    }
    out.sort_by_key(|(r, _)| *r);
    out.into_iter().map(|(_, c)| c).collect()
}

/// `<meta name="citation_pdf_url" content="...">` de uma página HTML (padrão Google Scholar).
pub fn citation_pdf_url(html: &str, base: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let i = lower.find("citation_pdf_url")?;
    let tag_start = lower[..i].rfind('<')?;
    let tag_end = i + lower[i..].find('>')?;
    let tag = &html[tag_start..tag_end];
    let ci = tag.to_lowercase().find("content=")? + 8;
    let rest = &tag[ci..];
    let q = rest.chars().next()?;
    let val = if q == '"' || q == '\'' { rest[1..].split(q).next()? } else { rest.split(char::is_whitespace).next()? };
    let val = val.replace("&amp;", "&");
    if val.starts_with("http") {
        Some(val)
    } else if val.starts_with('/') {
        let scheme_host: String = base.splitn(4, '/').take(3).collect::<Vec<_>>().join("/");
        Some(format!("{}{}", scheme_host, val))
    } else {
        None
    }
}

/// Baixa um PDF; se vier uma página HTML, segue o `citation_pdf_url` uma vez.
pub fn fetch_pdf(url: &str, depth: u8) -> Result<Vec<u8>, String> {
    let h = host_of(url);
    let resp = match agent(40).get(url).set("User-Agent", UA).set("Accept", "application/pdf,text/html;q=0.8,*/*;q=0.5").call() {
        Ok(r) => r,
        Err(ureq::Error::Status(c @ (401 | 403 | 429), _)) => return Err(format!("{}: a editora bloqueia downloads automáticos ({})", h, c)),
        Err(ureq::Error::Status(c, _)) => return Err(format!("{}: erro {}", h, c)),
        Err(ureq::Error::Transport(t)) => return Err(format!("{}: falha de conexão ({})", h, t.kind())),
    };
    let final_url = resp.get_url().to_string();
    let ctype = resp.content_type().to_lowercase();
    let mut buf = Vec::new();
    resp.into_reader().take(MAX_PDF + 1).read_to_end(&mut buf).map_err(|e| format!("{}: download interrompido ({})", h, e))?;
    if buf.len() as u64 > MAX_PDF {
        return Err(format!("{}: arquivo grande demais", h));
    }
    // aceita lixo antes do cabeçalho (alguns servidores mandam BOM/espaços)
    if buf.len() > 1000 && buf[..buf.len().min(1024)].windows(5).any(|w| w == b"%PDF-") {
        return Ok(buf);
    }
    if depth == 0 && (ctype.contains("html") || buf.starts_with(b"<")) {
        let html = String::from_utf8_lossy(&buf);
        if let Some(next) = citation_pdf_url(&html, &final_url) {
            if next != url {
                return fetch_pdf(&next, 1);
            }
        }
        return Err(format!("{}: a página não oferece o PDF diretamente", h));
    }
    Err(format!("{}: o arquivo recebido não é um PDF", h))
}

fn sanitize(s: &str, max: usize) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' { c } else { ' ' })
        .collect();
    let mut out = String::new();
    for w in cleaned.split_whitespace() {
        if out.chars().count() + w.chars().count() + 1 > max {
            break;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(w);
    }
    out
}

/// Nome legível: "Olivoto 2021 - MGIDI toward an effective multivariate.pdf"
pub fn file_name(md: &PdfMetadata) -> String {
    let autor = md.autores.first().and_then(|a| a.split_whitespace().last()).map(|s| sanitize(s, 30)).unwrap_or_default();
    let ano = md.ano.map(|a| a.to_string()).unwrap_or_default();
    let titulo = sanitize(md.titulo.as_deref().unwrap_or("artigo"), 60);
    let head = [autor, ano].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ");
    if head.is_empty() {
        format!("{}.pdf", titulo)
    } else {
        format!("{} - {}.pdf", head, titulo)
    }
}

/// Metadados do DOI: Crossref; se falhar, OpenAlex.
fn metadata_for(doi: &str, oa: Option<&Value>, tipo_options: &[String]) -> Result<(PdfMetadata, Option<Value>), String> {
    let mut md = PdfMetadata { doi: Some(doi.to_string()), ..Default::default() };
    let cr = match metadata::crossref(doi) {
        Ok(m) => {
            metadata::merge_crossref(&mut md, &m);
            Some(m)
        }
        Err(e) => {
            let Some(w) = oa else { return Err(e) };
            md.titulo = w["title"].as_str().or(w["display_name"].as_str()).map(String::from);
            md.ano = w["publication_year"].as_i64();
            md.journal = w["primary_location"]["source"]["display_name"].as_str().map(String::from);
            md.autores = w["authorships"]
                .as_array()
                .map(|a| a.iter().filter_map(|x| x["author"]["display_name"].as_str().map(String::from)).collect())
                .unwrap_or_default();
            md.crossref_type = match w["type"].as_str() {
                Some("article") => Some("journal-article".into()),
                Some("book-chapter") => Some("book-chapter".into()),
                Some("book") => Some("book".into()),
                Some("preprint") => Some("posted-content".into()),
                _ => None,
            };
            md.fonte = "openalex".into();
            md.avisos.push(format!("{}; dados obtidos do OpenAlex.", e));
            None
        }
    };
    md.doi = Some(doi.to_string());
    md.tipo_sugerido = metadata::suggest_tipo(md.crossref_type.as_deref(), tipo_options);
    Ok((md, cr))
}

/// O PDF baixado parece ser do artigo? (DOI igual no arquivo ou título na 1ª página)
fn matches_article(bytes: &[u8], md: &PdfMetadata) -> bool {
    let Ok((local, p1)) = metadata::extract_local_with_text(bytes) else { return true };
    if let (Some(a), Some(b)) = (&local.doi, &md.doi) {
        if a == b {
            return true;
        }
    }
    let Some(t) = md.titulo.as_deref() else { return true };
    let tn = normalize_title(t);
    let p1n = normalize_title(&p1);
    if p1n.len() < 50 {
        return true; // sem texto (digitalizado): não dá para conferir
    }
    // primeiras palavras do título presentes na 1ª página
    let head: String = tn.split_whitespace().take(6).collect::<Vec<_>>().join(" ");
    p1n.contains(&head) || local.doi.is_none()
}

/// Fluxo completo. `download=false` só traz os metadados e os candidatos.
pub fn resolve(input: &str, tipo_options: &[String], download: bool) -> Result<DoiResult, String> {
    let doi = parse_doi(input).ok_or_else(|| "DOI inválido — use o formato 10.xxxx/…".to_string())?;
    let oa = openalex(&doi);
    let (mut meta, cr) = metadata_for(&doi, oa.as_ref().ok(), tipo_options)?;
    let mut res = DoiResult { oa_status: oa.as_ref().ok().and_then(|w| w["open_access"]["oa_status"].as_str().map(String::from)), ..Default::default() };
    if let Err(e) = &oa {
        res.falhas.push(e.clone());
    }
    res.candidatos = candidates(oa.as_ref().ok(), cr.as_ref());
    if download {
        for c in res.candidatos.clone() {
            match fetch_pdf(&c.url, 0) {
                Ok(bytes) => {
                    if !matches_article(&bytes, &meta) {
                        res.falhas.push(format!("{}: o PDF parece ser de outro documento", c.host));
                        continue;
                    }
                    let dir = std::env::temp_dir().join("LattesManager").join(chrono::Local::now().format("%Y%m%d%H%M%S%3f").to_string());
                    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                    let path: PathBuf = dir.join(file_name(&meta));
                    std::fs::write(&path, &bytes).map_err(|e| format!("Falha ao salvar o PDF: {}", e))?;
                    res.pdf_bytes = bytes.len() as u64;
                    res.pdf_path = Some(path.to_string_lossy().to_string());
                    res.pdf_url = Some(c.url.clone());
                    res.pdf_versao = Some(c.versao.clone());
                    if c.versao == "preprint" {
                        meta.avisos.push("O PDF baixado é um preprint (versão submetida), não a versão publicada.".into());
                    } else if c.versao == "aceita" {
                        meta.avisos.push("O PDF baixado é a versão aceita do autor (pode diferir da diagramação final).".into());
                    }
                    break;
                }
                Err(e) => {
                    if !res.falhas.contains(&e) {
                        res.falhas.push(e)
                    }
                }
            }
        }
        if res.pdf_path.is_some() && res.oa_status.as_deref() == Some("closed") {
            meta.avisos.push("Artigo sem acesso aberto: o PDF veio do link da editora (acesso pela sua rede/instituição).".into());
        }
    }
    res.meta = meta;
    Ok(res)
}

/// Sem DOI: procura pelo título na Crossref (aceita só título ≥85% igual).
pub fn find_doi_by_title(titulo: &str) -> Result<Option<String>, String> {
    let hit = metadata::crossref_search(Some(titulo), "")?;
    Ok(hit.and_then(|m| m["DOI"].as_str().map(|d| d.to_lowercase())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_doi_inputs() {
        assert_eq!(parse_doi("https://doi.org/10.1093/bioinformatics/btaa981").as_deref(), Some("10.1093/bioinformatics/btaa981"));
        assert_eq!(parse_doi("doi: 10.1590/0103-8478CR20190123").as_deref(), Some("10.1590/0103-8478cr20190123"));
        assert_eq!(parse_doi("https://doi.org/10.1016%2Fj.cj.2026.05.010").as_deref(), Some("10.1016/j.cj.2026.05.010"));
        assert_eq!(parse_doi("abc"), None);
    }

    #[test]
    fn orders_candidates_and_reads_meta_tag() {
        let oa = serde_json::json!({
            "best_oa_location": {"pdf_url": "https://www.biorxiv.org/x.full.pdf", "version": "submittedVersion"},
            "locations": [
                {"pdf_url": "https://www.biorxiv.org/x.full.pdf", "version": "submittedVersion"},
                {"pdf_url": "https://repo.ufsc.br/a.pdf", "version": "publishedVersion", "license": "cc-by"},
                {"pdf_url": null}
            ],
            "open_access": {"oa_url": "https://www.biorxiv.org/x.full.pdf"}
        });
        let c = candidates(Some(&oa), None);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].host, "repo.ufsc.br");
        assert_eq!(c[0].versao, "publicada");
        assert_eq!(c[1].versao, "preprint");

        let html = r#"<head><meta name="citation_title" content="X"><meta content="/doi/pdf/10.1/abc?x=1&amp;y=2" name="citation_pdf_url"></head>"#;
        assert_eq!(citation_pdf_url(html, "https://www.site.org/doi/10.1/abc").as_deref(), Some("https://www.site.org/doi/pdf/10.1/abc?x=1&y=2"));
    }

    #[test]
    fn builds_readable_file_names() {
        let md = PdfMetadata { titulo: Some("MGIDI: toward an effective multivariate selection in biological experiments".into()), ano: Some(2021), autores: vec!["Tiago Olivoto".into()], ..Default::default() };
        assert_eq!(file_name(&md), "Olivoto 2021 - MGIDI toward an effective multivariate selection in.pdf");
    }

    /// Com rede: LATTES_ONLINE=1 cargo test --lib doi::tests::online -- --nocapture
    #[test]
    fn online_resolve_if_enabled() {
        if std::env::var("LATTES_ONLINE").is_err() {
            return;
        }
        let opts: Vec<String> = ["Artigos completos", "Capítulos de livros"].iter().map(|s| s.to_string()).collect();
        for d in ["10.1590/0103-8478cr20190123", "10.3390/agronomy12010042", "10.1093/bioinformatics/btaa981", "10.1016/j.heliyon.2024.e32763", "10.1007/s10681-025-03513-8"] {
            let t0 = std::time::Instant::now();
            match resolve(d, &opts, true) {
                Ok(r) => println!(
                    "{} ({} ms)\n  {:?} | {:?} {:?} | tipo={:?} oa={:?}\n  candidatos={} pdf={:?} ({} KB, {:?})\n  falhas={:?}\n  avisos={:?}",
                    d,
                    t0.elapsed().as_millis(),
                    r.meta.titulo,
                    r.meta.journal,
                    r.meta.ano,
                    r.meta.tipo_sugerido,
                    r.oa_status,
                    r.candidatos.len(),
                    r.pdf_path,
                    r.pdf_bytes / 1024,
                    r.pdf_versao,
                    r.falhas,
                    r.meta.avisos
                ),
                Err(e) => println!("{} ERRO {}", d, e),
            }
        }
        if let Ok(Some(d)) = find_doi_by_title("MGIDI: toward an effective multivariate selection in biological experiments") {
            println!("por título: {}", d);
        }
    }
}
