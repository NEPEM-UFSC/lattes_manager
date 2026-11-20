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

const UA: &str = concat!(
    "LattesManager/",
    env!("CARGO_PKG_VERSION"),
    " (gerenciador de curriculo; mailto:lattesmanager@ufsc.br)"
);
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
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
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(secs))
        .redirects(8)
        .build()
}

fn host_of(url: &str) -> String {
    url.split("://")
        .nth(1)
        .unwrap_or(url)
        .split(['/', '?'])
        .next()
        .unwrap_or("")
        .to_string()
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
        Ok(r) => r
            .into_json()
            .map_err(|e| format!("resposta inválida do OpenAlex ({})", e)),
        Err(ureq::Error::Status(404, _)) => Err("DOI não encontrado no OpenAlex".into()),
        Err(ureq::Error::Status(c, _)) => Err(format!("OpenAlex respondeu com erro {}", c)),
        Err(ureq::Error::Transport(_)) => Err("sem conexão com o OpenAlex".into()),
    }
}

/// Unpaywall API direta (principal fonte do Zotero para PDFs de acesso aberto).
pub fn unpaywall(doi: &str) -> Result<Value, String> {
    let url = format!(
        "https://api.unpaywall.org/v2/{}?email=lattesmanager@ufsc.br",
        doi
    );
    match agent(10).get(&url).set("User-Agent", UA).call() {
        Ok(r) => r
            .into_json()
            .map_err(|e| format!("resposta inválida do Unpaywall ({})", e)),
        Err(ureq::Error::Status(404, _)) => Err("DOI não encontrado no Unpaywall".into()),
        Err(ureq::Error::Status(c, _)) => Err(format!("Unpaywall respondeu com erro {}", c)),
        Err(ureq::Error::Transport(_)) => Err("sem conexão com o Unpaywall".into()),
    }
}

/// Semantic Scholar Graph API (openAccessPdf).
pub fn semanticscholar(doi: &str) -> Result<Value, String> {
    let url = format!(
        "https://api.semanticscholar.org/graph/v1/paper/DOI:{}?fields=openAccessPdf,title,year,venue",
        doi
    );
    match agent(10).get(&url).set("User-Agent", UA).call() {
        Ok(r) => r
            .into_json()
            .map_err(|e| format!("resposta inválida do Semantic Scholar ({})", e)),
        Err(ureq::Error::Status(404, _)) => Err("DOI não encontrado no Semantic Scholar".into()),
        Err(ureq::Error::Status(c, _)) => Err(format!("Semantic Scholar respondeu com erro {}", c)),
        Err(ureq::Error::Transport(_)) => Err("sem conexão com o Semantic Scholar".into()),
    }
}

/// Europe PMC API (ótima cobertura para ciências agrárias, biológicas e médicas).
pub fn europepmc(doi: &str) -> Result<Value, String> {
    let url = format!(
        "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:%22{}%22&format=json&resultType=core",
        doi
    );
    match agent(10).get(&url).set("User-Agent", UA).call() {
        Ok(r) => r
            .into_json()
            .map_err(|e| format!("resposta inválida do Europe PMC ({})", e)),
        Err(ureq::Error::Status(c, _)) => Err(format!("Europe PMC respondeu com erro {}", c)),
        Err(ureq::Error::Transport(_)) => Err("sem conexão com o Europe PMC".into()),
    }
}

/// PubMed Central ID Converter: DOI -> PMCID -> PDF gratuito no PMC.
pub fn pmc_idconv(doi: &str) -> Result<Value, String> {
    let url = format!(
        "https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids={}&format=json",
        doi
    );
    match agent(8).get(&url).set("User-Agent", UA).call() {
        Ok(r) => r
            .into_json()
            .map_err(|e| format!("resposta inválida do PMC ({})", e)),
        Err(ureq::Error::Status(c, _)) => Err(format!("PMC erro {}", c)),
        Err(ureq::Error::Transport(_)) => Err("sem conexão com o PMC".into()),
    }
}

/// OpenAIRE Graph API: encontra cópias em repositórios institucionais (UFSC, Embrapa, etc.).
pub fn openaire(doi: &str) -> Result<Value, String> {
    let url = format!(
        "https://api.openaire.eu/search/publications?doi={}&format=json",
        doi
    );
    match agent(8).get(&url).set("User-Agent", UA).call() {
        Ok(r) => r
            .into_json()
            .map_err(|e| format!("resposta inválida do OpenAIRE ({})", e)),
        Err(ureq::Error::Status(c, _)) => Err(format!("OpenAIRE erro {}", c)),
        Err(ureq::Error::Transport(_)) => Err("sem conexão com o OpenAIRE".into()),
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
        out.push((
            rank,
            PdfCandidate {
                url: url.into(),
                host: host_of(url),
                versao: ver,
                licenca: lic.map(String::from),
            },
        ));
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

fn append_extra_candidates(
    out: &mut Vec<PdfCandidate>,
    upw: Option<&Value>,
    s2: Option<&Value>,
    epmc: Option<&Value>,
    pmc: Option<&Value>,
    oaire: Option<&Value>,
    doi: &str,
) {
    let mut push = |url: &str, versao_str: &str, lic: Option<&str>| {
        let url = url.trim();
        if !url.starts_with("http") || out.iter().any(|c| c.url == url) {
            return;
        }
        out.push(PdfCandidate {
            url: url.into(),
            host: host_of(url),
            versao: versao_str.into(),
            licenca: lic.map(String::from),
        });
    };

    if let Some(u) = upw {
        let best = &u["best_oa_location"];
        if let Some(p) = best["url_for_pdf"].as_str() {
            push(
                p,
                &versao(best["version"].as_str()),
                best["license"].as_str(),
            );
        }
        for loc in u["oa_locations"].as_array().into_iter().flatten() {
            if let Some(p) = loc["url_for_pdf"].as_str() {
                push(p, &versao(loc["version"].as_str()), loc["license"].as_str());
            }
        }
        if let Some(lp) = best["url_for_landing_page"].as_str() {
            push(lp, "?", best["license"].as_str());
        }
    }

    if let Some(s) = s2 {
        if let Some(p) = s["openAccessPdf"]["url"].as_str() {
            push(p, "publicada", None);
        }
    }

    if let Some(e) = epmc {
        for rec in e["resultList"]["result"].as_array().into_iter().flatten() {
            for ft in rec["fullTextUrlList"]["fullTextUrl"]
                .as_array()
                .into_iter()
                .flatten()
            {
                if ft["documentStyle"].as_str() == Some("pdf") {
                    if let Some(p) = ft["url"].as_str() {
                        push(p, "publicada", None);
                    }
                }
            }
        }
    }

    if let Some(p) = pmc {
        for rec in p["records"].as_array().into_iter().flatten() {
            if let Some(pmcid) = rec["pmcid"].as_str() {
                push(
                    &format!("https://pmc.ncbi.nlm.nih.gov/articles/{}/pdf/", pmcid),
                    "publicada",
                    None,
                );
            }
        }
    }

    if let Some(oa) = oaire {
        let results = &oa["response"]["results"]["result"];
        for rec in results.as_array().into_iter().flatten() {
            let instance = &rec["metadata"]["oaf:entity"]["oaf:result"]["children"]["instance"];
            let arr = if instance.is_array() {
                instance.as_array().cloned().unwrap_or_default()
            } else if instance.is_object() {
                vec![instance.clone()]
            } else {
                vec![]
            };
            for inst in arr {
                let web = &inst["webresource"];
                let warr = if web.is_array() {
                    web.as_array().cloned().unwrap_or_default()
                } else if web.is_object() {
                    vec![web.clone()]
                } else {
                    vec![]
                };
                for w in warr {
                    if let Some(u) = w["url"]["$"].as_str().or_else(|| w["url"].as_str()) {
                        if u.to_lowercase().contains("pdf") {
                            push(u, "publicada", None);
                        }
                    }
                }
            }
        }
    }

    // Regras diretas por prefixo de DOI / editora (acesso aberto ou rede institucional)
    let low = doi.to_lowercase();
    if let Some(arx) = low.strip_prefix("10.48550/arxiv.") {
        push(
            &format!("https://arxiv.org/pdf/{}.pdf", arx),
            "preprint",
            None,
        );
    } else if low.starts_with("10.1101/") {
        push(
            &format!("https://www.biorxiv.org/content/{}.full.pdf", doi),
            "preprint",
            None,
        );
        push(
            &format!("https://www.medrxiv.org/content/{}.full.pdf", doi),
            "preprint",
            None,
        );
    } else if low.starts_with("10.1007/") || low.starts_with("10.1186/") {
        push(
            &format!("https://link.springer.com/content/pdf/{}.pdf", doi),
            "publicada",
            None,
        );
    } else if low.starts_with("10.3389/") {
        push(
            &format!("https://www.frontiersin.org/articles/{}/pdf", doi),
            "publicada",
            None,
        );
    } else if low.starts_with("10.1371/") {
        push(
            &format!(
                "https://journals.plos.org/plosone/article/file?id={}&type=printable",
                doi
            ),
            "publicada",
            None,
        );
    } else if low.starts_with("10.1155/")
        || low.starts_with("10.1002/")
        || low.starts_with("10.1111/")
    {
        push(
            &format!("https://onlinelibrary.wiley.com/doi/pdfdirect/{}", doi),
            "publicada",
            None,
        );
    }

    // Por último, tenta resolver diretamente a landing page do DOI (ex.: SciELO, OJS, MDPI, Wiley)
    push(&format!("https://doi.org/{}", doi), "publicada", None);
}

/// Resolve URL relativa contra uma URL base.
fn resolve_url(val: &str, base: &str) -> Option<String> {
    let val = val.replace("&amp;", "&").trim().to_string();
    if val.starts_with("http") {
        Some(val)
    } else if val.starts_with("//") {
        let scheme = base.split("://").next().unwrap_or("https");
        Some(format!("{}:{}", scheme, val))
    } else if val.starts_with('/') {
        let scheme_host: String = base.splitn(4, '/').take(3).collect::<Vec<_>>().join("/");
        Some(format!("{}{}", scheme_host, val))
    } else {
        None
    }
}

/// `<meta name="citation_pdf_url" content="...">` de uma página HTML (padrão Google Scholar).
pub fn citation_pdf_url(html: &str, base: &str) -> Option<String> {
    let lower = html.to_lowercase();
    if let Some(i) = lower.find("citation_pdf_url") {
        if let (Some(tag_start), Some(rel_end)) = (lower[..i].rfind('<'), lower[i..].find('>')) {
            let tag = &html[tag_start..i + rel_end];
            if let Some(ci) = tag.to_lowercase().find("content=") {
                let rest = &tag[ci + 8..];
                if let Some(q) = rest.chars().next() {
                    let val = if q == '"' || q == '\'' {
                        rest[1..].split(q).next()
                    } else {
                        rest.split(char::is_whitespace).next()
                    };
                    if let Some(v) = val.and_then(|s| resolve_url(s, base)) {
                        return Some(v);
                    }
                }
            }
        }
    }
    // Fallback: <link rel="alternate" type="application/pdf" href="...">
    if let Some(i) = lower.find("application/pdf") {
        if let (Some(tag_start), Some(rel_end)) = (lower[..i].rfind('<'), lower[i..].find('>')) {
            let tag = &html[tag_start..i + rel_end];
            if let Some(hi) = tag.to_lowercase().find("href=") {
                let rest = &tag[hi + 5..];
                if let Some(q) = rest.chars().next() {
                    let val = if q == '"' || q == '\'' {
                        rest[1..].split(q).next()
                    } else {
                        rest.split(char::is_whitespace).next()
                    };
                    if let Some(v) = val.and_then(|s| resolve_url(s, base)) {
                        return Some(v);
                    }
                }
            }
        }
    }
    // Fallback OJS (revistas brasileiras): <a class="obj_galley_link pdf" href="...">
    if let Some(i) = lower.find("obj_galley_link") {
        if let (Some(tag_start), Some(rel_end)) = (lower[..i].rfind('<'), lower[i..].find('>')) {
            let tag = &html[tag_start..i + rel_end];
            if let Some(hi) = tag.to_lowercase().find("href=") {
                let rest = &tag[hi + 5..];
                if let Some(q) = rest.chars().next() {
                    let val = if q == '"' || q == '\'' {
                        rest[1..].split(q).next()
                    } else {
                        rest.split(char::is_whitespace).next()
                    };
                    if let Some(v) = val.and_then(|s| resolve_url(s, base)) {
                        return Some(v.replace("/article/view/", "/article/download/"));
                    }
                }
            }
        }
    }
    // Fallback MDPI: URL da página do artigo + /pdf
    let base_low = base.to_lowercase();
    if base_low.contains("mdpi.com/") && !base_low.ends_with("/pdf") {
        return Some(format!("{}/pdf", base.trim_end_matches('/')));
    }
    None
}

/// Fallback usando curl.exe nativo do Windows (usa Schannel TLS do SO em vez de Rustls).
#[cfg(target_os = "windows")]
fn fetch_pdf_curl(url: &str) -> Option<Vec<u8>> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let out = std::process::Command::new("curl.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-s",
            "-L",
            "--max-time",
            "25",
            "-A",
            BROWSER_UA,
            "-H",
            "Accept: application/pdf,text/html,application/xhtml+xml,*/*;q=0.8",
            "-H",
            "Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
            url,
        ])
        .output()
        .ok()?;
    let buf = out.stdout;
    if buf.len() > 1000 && buf[..buf.len().min(1024)].windows(5).any(|w| w == b"%PDF-") {
        Some(buf)
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn fetch_pdf_curl(_url: &str) -> Option<Vec<u8>> {
    None
}

/// Baixa um PDF; se vier uma página HTML, segue o `citation_pdf_url` uma vez.
pub fn fetch_pdf(url: &str, depth: u8) -> Result<Vec<u8>, String> {
    let h = host_of(url);
    let resp = match agent(25)
        .get(url)
        .set("User-Agent", BROWSER_UA)
        .set(
            "Accept",
            "application/pdf,text/html,application/xhtml+xml,*/*;q=0.8",
        )
        .set("Accept-Language", "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7")
        .call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(c @ (401 | 403 | 429), _)) => {
            if let Some(buf) = fetch_pdf_curl(url) {
                return Ok(buf);
            }
            return Err(format!(
                "{}: a editora bloqueia downloads automáticos ({})",
                h, c
            ));
        }
        Err(ureq::Error::Status(c, _)) => return Err(format!("{}: erro {}", h, c)),
        Err(ureq::Error::Transport(t)) => {
            if let Some(buf) = fetch_pdf_curl(url) {
                return Ok(buf);
            }
            return Err(format!("{}: falha de conexão ({})", h, t.kind()));
        }
    };
    let final_url = resp.get_url().to_string();
    let ctype = resp.content_type().to_lowercase();
    let mut buf = Vec::new();
    resp.into_reader()
        .take(MAX_PDF + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("{}: download interrompido ({})", h, e))?;
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
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' {
                c
            } else {
                ' '
            }
        })
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
    let autor = md
        .autores
        .first()
        .and_then(|a| a.split_whitespace().last())
        .map(|s| sanitize(s, 30))
        .unwrap_or_default();
    let ano = md.ano.map(|a| a.to_string()).unwrap_or_default();
    let titulo = sanitize(md.titulo.as_deref().unwrap_or("artigo"), 60);
    let head = [autor, ano]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if head.is_empty() {
        format!("{}.pdf", titulo)
    } else {
        format!("{} - {}.pdf", head, titulo)
    }
}

/// O PDF baixado parece ser do artigo? (DOI igual no arquivo ou título na 1ª página)
fn matches_article(bytes: &[u8], md: &PdfMetadata) -> bool {
    let Ok((local, p1)) = metadata::extract_local_with_text(bytes) else {
        return true;
    };
    if let (Some(a), Some(b)) = (&local.doi, &md.doi) {
        if a == b {
            return true;
        }
    }
    let Some(t) = md.titulo.as_deref() else {
        return true;
    };
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
    let doi =
        parse_doi(input).ok_or_else(|| "DOI inválido — use o formato 10.xxxx/…".to_string())?;

    // Consulta todas as APIs em paralelo para velocidade máxima
    let (oa, upw, cr_res, s2, epmc, pmc, oaire) = std::thread::scope(|s| {
        let h_oa = s.spawn(|| openalex(&doi));
        let h_upw = s.spawn(|| unpaywall(&doi));
        let h_cr = s.spawn(|| metadata::crossref(&doi));
        let h_s2 = s.spawn(|| {
            if download {
                semanticscholar(&doi).ok()
            } else {
                None
            }
        });
        let h_epmc = s.spawn(|| if download { europepmc(&doi).ok() } else { None });
        let h_pmc = s.spawn(|| {
            if download {
                pmc_idconv(&doi).ok()
            } else {
                None
            }
        });
        let h_oaire = s.spawn(|| if download { openaire(&doi).ok() } else { None });
        (
            h_oa.join()
                .unwrap_or_else(|_| Err("OpenAlex falhou".into())),
            h_upw
                .join()
                .unwrap_or_else(|_| Err("Unpaywall falhou".into())),
            h_cr.join()
                .unwrap_or_else(|_| Err("Crossref falhou".into())),
            h_s2.join().unwrap_or(None),
            h_epmc.join().unwrap_or(None),
            h_pmc.join().unwrap_or(None),
            h_oaire.join().unwrap_or(None),
        )
    });

    let mut meta = PdfMetadata {
        doi: Some(doi.clone()),
        ..Default::default()
    };
    let cr = match cr_res {
        Ok(m) => {
            metadata::merge_crossref(&mut meta, &m);
            Some(m)
        }
        Err(e) => {
            if let Ok(w) = &oa {
                meta.titulo = w["title"]
                    .as_str()
                    .or(w["display_name"].as_str())
                    .map(String::from);
                meta.ano = w["publication_year"].as_i64();
                meta.journal = w["primary_location"]["source"]["display_name"]
                    .as_str()
                    .map(String::from);
                meta.autores = w["authorships"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x["author"]["display_name"].as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                meta.fonte = "openalex".into();
            } else if let Ok(u) = &upw {
                meta.titulo = u["title"].as_str().map(String::from);
                meta.ano = u["year"].as_i64();
                meta.journal = u["journal_name"].as_str().map(String::from);
                meta.fonte = "unpaywall".into();
            } else if !download {
                return Err(e);
            } else {
                meta.avisos.push(e);
            }
            None
        }
    };
    meta.doi = Some(doi.clone());
    meta.tipo_sugerido = metadata::suggest_tipo(meta.crossref_type.as_deref(), tipo_options);

    let oa_status = oa
        .as_ref()
        .ok()
        .and_then(|w| w["open_access"]["oa_status"].as_str().map(String::from))
        .or_else(|| {
            upw.as_ref()
                .ok()
                .and_then(|u| u["oa_status"].as_str().map(String::from))
        });

    let mut res = DoiResult {
        oa_status,
        ..Default::default()
    };
    if let Err(e) = &oa {
        res.falhas.push(e.clone());
    }
    res.candidatos = candidates(oa.as_ref().ok(), cr.as_ref());
    append_extra_candidates(
        &mut res.candidatos,
        upw.as_ref().ok(),
        s2.as_ref(),
        epmc.as_ref(),
        pmc.as_ref(),
        oaire.as_ref(),
        &doi,
    );

    if download {
        for c in res.candidatos.clone() {
            match fetch_pdf(&c.url, 0) {
                Ok(bytes) => {
                    if !matches_article(&bytes, &meta) {
                        res.falhas
                            .push(format!("{}: o PDF parece ser de outro documento", c.host));
                        continue;
                    }
                    let dir = std::env::temp_dir()
                        .join("LattesManager")
                        .join(chrono::Local::now().format("%Y%m%d%H%M%S%3f").to_string());
                    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                    let path: PathBuf = dir.join(file_name(&meta));
                    std::fs::write(&path, &bytes)
                        .map_err(|e| format!("Falha ao salvar o PDF: {}", e))?;
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
        assert_eq!(
            parse_doi("https://doi.org/10.1093/bioinformatics/btaa981").as_deref(),
            Some("10.1093/bioinformatics/btaa981")
        );
        assert_eq!(
            parse_doi("doi: 10.1590/0103-8478CR20190123").as_deref(),
            Some("10.1590/0103-8478cr20190123")
        );
        assert_eq!(
            parse_doi("https://doi.org/10.1016%2Fj.cj.2026.05.010").as_deref(),
            Some("10.1016/j.cj.2026.05.010")
        );
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
        assert_eq!(
            citation_pdf_url(html, "https://www.site.org/doi/10.1/abc").as_deref(),
            Some("https://www.site.org/doi/pdf/10.1/abc?x=1&y=2")
        );
    }

    #[test]
    fn builds_readable_file_names() {
        let md = PdfMetadata {
            titulo: Some(
                "MGIDI: toward an effective multivariate selection in biological experiments"
                    .into(),
            ),
            ano: Some(2021),
            autores: vec!["Tiago Olivoto".into()],
            ..Default::default()
        };
        assert_eq!(
            file_name(&md),
            "Olivoto 2021 - MGIDI toward an effective multivariate selection in.pdf"
        );
    }

    /// Com rede: LATTES_ONLINE=1 cargo test --lib doi::tests::online -- --nocapture
    #[test]
    fn online_resolve_if_enabled() {
        if std::env::var("LATTES_ONLINE").is_err() {
            return;
        }
        let opts: Vec<String> = ["Artigos completos", "Capítulos de livros"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        for d in [
            "10.1590/0103-8478cr20190123",
            "10.3390/agronomy12010042",
            "10.1093/bioinformatics/btaa981",
            "10.1016/j.heliyon.2024.e32763",
            "10.1007/s10681-025-03513-8",
        ] {
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
        if let Ok(Some(d)) = find_doi_by_title(
            "MGIDI: toward an effective multivariate selection in biological experiments",
        ) {
            println!("por título: {}", d);
        }
    }
}
