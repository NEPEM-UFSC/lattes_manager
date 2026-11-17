use std::collections::HashSet;
use std::time::Duration;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::files::linker::{dice, trigrams};
use crate::migration::lattes_xml::normalize_title;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ScholarYearlyCitation {
    pub year: i64,
    pub citations: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ScholarConfig {
    pub author_id: String,
    pub serpapi_key: String,
    pub total_citations: Option<i64>,
    pub h_index: Option<i64>,
    pub i10_index: Option<i64>,
    pub author_name: Option<String>,
    pub last_sync: Option<String>,
    pub graph: Vec<ScholarYearlyCitation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ScholarAuthorInfo {
    pub name: String,
    pub total_citations: i64,
    pub h_index: i64,
    pub i10_index: i64,
    pub graph: Vec<ScholarYearlyCitation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ScholarArticle {
    pub title: String,
    pub year: Option<i64>,
    pub citations: i64,
    pub link: Option<String>,
    pub citation_id: Option<String>,
    pub authors: Option<String>,
    pub publication: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnmatchedScholarArticle {
    pub title: String,
    pub year: Option<i64>,
    pub citations: i64,
    pub journal: Option<String>,
    pub authors: Option<String>,
    pub doi: Option<String>,
    pub link: Option<String>,
    pub citation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnmatchedScholarReport {
    pub total_scholar: usize,
    pub total_matched: usize,
    pub unmatched: Vec<UnmatchedScholarArticle>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScholarMatchedItem {
    pub id: i64,
    pub titulo: String,
    pub ano: Option<i64>,
    pub citations_before: Option<i64>,
    pub citations_after: i64,
    pub scholar_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScholarSyncReport {
    pub author_name: String,
    pub total_citations: i64,
    pub h_index: i64,
    pub i10_index: i64,
    pub scholar_articles_found: usize,
    pub matched_count: usize,
    pub updated_items: Vec<ScholarMatchedItem>,
    pub graph: Vec<ScholarYearlyCitation>,
}

/// Extrai e limpa o ID do autor a partir de uma string pura ou URL completa do Google Scholar.
/// Trata parâmetros como "&hl=pt", query strings, URLs com user=...
/// Ex: "https://scholar.google.com/citations?user=X_12345AAAAJ&hl=pt-BR" -> "X_12345AAAAJ"
/// Ex: "QjxIJkcAAAAJ&hl" -> "QjxIJkcAAAAJ"
pub fn clean_author_id(input: &str) -> String {
    let s = input.trim();
    if s.is_empty() {
        return String::new();
    }
    let after_user = if let Some(pos) = s.find("user=") {
        &s[pos + 5..]
    } else if let Some(pos) = s.find("user%3D") {
        &s[pos + 7..]
    } else {
        s
    };
    let clean = after_user.split(['&', '?', '#', ' ', '/']).next().unwrap_or(after_user);
    clean.trim().to_string()
}

/// Carrega a configuração do Google Scholar e métricas do app_metadata.
pub fn get_scholar_config(conn: &Connection) -> Result<ScholarConfig, String> {
    let mut config = ScholarConfig::default();

    if let Ok(v) = get_meta_string(conn, "settings.scholar_author_id") {
        config.author_id = v;
    }
    if let Ok(v) = get_meta_string(conn, "settings.serpapi_key") {
        config.serpapi_key = v;
    }
    if let Ok(v) = get_meta_string(conn, "settings.scholar_metrics") {
        if let Ok(parsed) = serde_json::from_str::<Value>(&v) {
            config.total_citations = parsed.get("total_citations").and_then(|v| v.as_i64());
            config.h_index = parsed.get("h_index").and_then(|v| v.as_i64());
            config.i10_index = parsed.get("i10_index").and_then(|v| v.as_i64());
            config.author_name = parsed.get("author_name").and_then(|v| v.as_str()).map(|s| s.to_string());
            config.last_sync = parsed.get("last_sync").and_then(|v| v.as_str()).map(|s| s.to_string());
            if let Some(arr) = parsed.get("graph").and_then(|g| g.as_array()) {
                config.graph = arr.iter().filter_map(|it| {
                    let year = it.get("year").and_then(|y| y.as_i64().or_else(|| y.as_str().and_then(|s| s.parse().ok())))?;
                    let citations = it.get("citations").and_then(|c| c.as_i64().or_else(|| c.as_str().and_then(|s| s.parse().ok()))).unwrap_or(0);
                    Some(ScholarYearlyCitation { year, citations })
                }).collect();
            }
        }
    }

    // Se total_citations ainda for None ou 0, calcula fallback a partir dos registros de produções do banco local
    if config.total_citations.is_none() || config.total_citations == Some(0) {
        if let Ok(mut stmt) = conn.prepare("SELECT citations FROM producoes WHERE citations > 0 ORDER BY citations DESC") {
            let cites: Vec<i64> = stmt.query_map([], |r| r.get(0)).ok()
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default();
            if !cites.is_empty() {
                let sum: i64 = cites.iter().sum();
                config.total_citations = Some(sum);
                if config.h_index.is_none() || config.h_index == Some(0) {
                    let h = cites.iter().enumerate().take_while(|(i, &c)| c >= (*i as i64 + 1)).count() as i64;
                    config.h_index = Some(h);
                }
                if config.i10_index.is_none() || config.i10_index == Some(0) {
                    let i10 = cites.iter().filter(|&&c| c >= 10).count() as i64;
                    config.i10_index = Some(i10);
                }
            }
        }
    }

    Ok(config)
}

/// Salva ID do autor e SerpApi key no banco.
pub fn save_scholar_config(conn: &Connection, author_id: &str, serpapi_key: &str) -> Result<(), String> {
    let clean_id = clean_author_id(author_id);
    let key = serpapi_key.trim();

    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('settings.scholar_author_id', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [clean_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('settings.serpapi_key', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn get_meta_string(conn: &Connection, key: &str) -> Result<String, rusqlite::Error> {
    conn.query_row(
        "SELECT value FROM app_metadata WHERE key = ?1",
        [key],
        |r| r.get(0),
    )
}

/// Faz a requisição à API do SerpApi e extrai dados do perfil e artigos.
pub fn fetch_serpapi_scholar(author_id: &str, api_key: &str) -> Result<(ScholarAuthorInfo, Vec<ScholarArticle>), String> {
    let clean_id = clean_author_id(author_id);
    if clean_id.is_empty() {
        return Err("ID do Google Scholar não informado.".into());
    }
    let key = api_key.trim();
    if key.is_empty() {
        return Err("Chave SerpApi (SERPAPI_KEY) não informada.".into());
    }

    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(30))
        .build();

    let mut all_articles = Vec::new();
    let mut author_info: Option<ScholarAuthorInfo> = None;
    let mut current_start = 0;
    let max_pages = 3; // Limite de até 3 páginas (300 artigos) para resguardar cota SerpApi

    for _ in 0..max_pages {
        let url = format!(
            "https://serpapi.com/search.json?engine=google_scholar_author&author_id={}&api_key={}&hl=pt&num=100&start={}",
            clean_id, key, current_start
        );

        let response = match agent.get(&url).call() {
            Ok(res) => res,
            Err(ureq::Error::Status(401, _)) => {
                return Err("Chave SerpApi inválida ou não autorizada. Verifique sua chave no serpapi.com.".into());
            }
            Err(ureq::Error::Status(404, _)) => {
                return Err("Perfil de autor não encontrado no Google Scholar com o ID informado.".into());
            }
            Err(ureq::Error::Status(429, _)) => {
                return Err("Limite de requisições do SerpApi atingido para este mês.".into());
            }
            Err(ureq::Error::Status(code, _)) => {
                return Err(format!("SerpApi retornou código HTTP {}.", code));
            }
            Err(ureq::Error::Transport(e)) => {
                return Err(format!("Falha na conexão com SerpApi: {}", e));
            }
        };

        let json: Value = response.into_json().map_err(|e| format!("Resposta inválida do SerpApi: {}", e))?;

        if let Some(err_msg) = json.get("error").and_then(|v| v.as_str()) {
            return Err(format!("SerpApi erro: {}", err_msg));
        }

        if author_info.is_none() {
            author_info = Some(parse_author_info(&json));
        }

        let page_articles = parse_articles(&json);
        let count = page_articles.len();
        all_articles.extend(page_articles);

        // Se a página retornou menos de 100 ou não há paginação, não precisa buscar mais
        let has_next = json.get("serpapi_pagination")
            .and_then(|p| p.get("next"))
            .is_some();

        if count < 100 || !has_next {
            break;
        }

        current_start += 100;
    }

    let info = author_info.unwrap_or(ScholarAuthorInfo {
        name: String::new(),
        total_citations: 0,
        h_index: 0,
        i10_index: 0,
        graph: Vec::new(),
    });

    Ok((info, all_articles))
}

pub fn parse_author_info(json: &Value) -> ScholarAuthorInfo {
    let name = json.get("author")
        .and_then(|a| a.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let mut total_citations = 0;
    let mut h_index = 0;
    let mut i10_index = 0;

    let extract_metric = |obj: &Value| -> Option<i64> {
        if let Some(map) = obj.as_object() {
            // Tenta chaves conhecidas em inglês e português: 'all', 'todos', 'total', 'valor'
            for candidate in ["all", "todos", "total", "valor"] {
                if let Some(n) = map.get(candidate) {
                    if let Some(v) = n.as_i64() {
                        return Some(v);
                    }
                    if let Some(s) = n.as_str() {
                        let clean = s.replace([',', '.', ' '], "");
                        if let Ok(num) = clean.parse::<i64>() {
                            return Some(num);
                        }
                    }
                }
            }
            // Fallback: primeiro valor numérico do mapa
            if let Some((_, first_val)) = map.iter().next() {
                if let Some(v) = first_val.as_i64() {
                    return Some(v);
                }
                if let Some(s) = first_val.as_str() {
                    let clean = s.replace([',', '.', ' '], "");
                    if let Ok(num) = clean.parse::<i64>() {
                        return Some(num);
                    }
                }
            }
        }
        // Se o próprio obj for um número ou string numérica
        if let Some(v) = obj.as_i64() {
            return Some(v);
        }
        if let Some(s) = obj.as_str() {
            let clean = s.replace([',', '.', ' '], "");
            if let Ok(num) = clean.parse::<i64>() {
                return Some(num);
            }
        }
        None
    };

    let table_opt = json.get("cited_by")
        .and_then(|c| c.get("table"))
        .or_else(|| json.get("cited_by_table"))
        .and_then(|t| t.as_array());

    if let Some(table) = table_opt {
        for (idx, row) in table.iter().enumerate() {
            if let Some(map) = row.as_object() {
                for (k, v) in map {
                    let k_lower = k.to_lowercase();
                    // Suporta inglês ("citations"), português ("citações", "citacoes")
                    if k_lower.contains("cit") {
                        if let Some(c) = extract_metric(v) {
                            total_citations = c;
                        }
                    } else if k_lower.contains("i10") {
                        if let Some(i10) = extract_metric(v) {
                            i10_index = i10;
                        }
                    } else if k_lower.contains('h') {
                        if let Some(h) = extract_metric(v) {
                            h_index = h;
                        }
                    }
                }
            }

            // Fallback por índice posicional caso os nomes das chaves venham em outro formato
            if idx == 0 && total_citations == 0 {
                if let Some(map) = row.as_object() {
                    if let Some((_, v)) = map.iter().next() {
                        if let Some(c) = extract_metric(v) { total_citations = c; }
                    }
                }
            } else if idx == 1 && h_index == 0 {
                if let Some(map) = row.as_object() {
                    if let Some((_, v)) = map.iter().next() {
                        if let Some(h) = extract_metric(v) { h_index = h; }
                    }
                }
            } else if idx == 2 && i10_index == 0 {
                if let Some(map) = row.as_object() {
                    if let Some((_, v)) = map.iter().next() {
                        if let Some(i) = extract_metric(v) { i10_index = i; }
                    }
                }
            }
        }
    }

    // Extrair graph anual de citações do perfil
    let graph_arr_opt = json.get("cited_by")
        .and_then(|c| c.get("graph"))
        .or_else(|| json.get("graph"))
        .and_then(|g| g.as_array());

    let mut graph = Vec::new();
    if let Some(arr) = graph_arr_opt {
        for item in arr {
            let year = item.get("year").and_then(|y| {
                if let Some(s) = y.as_str() {
                    s.trim().parse::<i64>().ok()
                } else {
                    y.as_i64()
                }
            });
            let citations = item.get("citations").and_then(|c| {
                if let Some(s) = c.as_str() {
                    s.replace([',', '.', ' '], "").parse::<i64>().ok()
                } else {
                    c.as_i64()
                }
            }).unwrap_or(0);

            if let Some(y) = year {
                graph.push(ScholarYearlyCitation { year: y, citations });
            }
        }
    }

    // Se total_citations ainda for 0 mas houver graph, soma as citações do graph
    if total_citations == 0 && !graph.is_empty() {
        total_citations = graph.iter().map(|g| g.citations).sum();
    }

    ScholarAuthorInfo {
        name,
        total_citations,
        h_index,
        i10_index,
        graph,
    }
}

pub fn parse_articles(json: &Value) -> Vec<ScholarArticle> {
    let mut res = Vec::new();
    if let Some(arr) = json.get("articles").and_then(|a| a.as_array()) {
        for it in arr {
            let title = it.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            if title.is_empty() {
                continue;
            }

            let year = it.get("year").and_then(|y| {
                if let Some(s) = y.as_str() {
                    s.trim().parse::<i64>().ok()
                } else {
                    y.as_i64()
                }
            });

            let citations = it.get("cited_by")
                .and_then(|c| c.get("value"))
                .and_then(|v| {
                    if let Some(n) = v.as_i64() {
                        Some(n)
                    } else if let Some(s) = v.as_str() {
                        s.replace([',', '.', ' '], "").parse::<i64>().ok()
                    } else {
                        None
                    }
                })
                .unwrap_or(0);

            let link = it.get("link").and_then(|l| l.as_str()).map(|s| s.to_string());
            let citation_id = it.get("citation_id").and_then(|l| l.as_str()).map(|s| s.to_string());
            let authors = it.get("authors").and_then(|v| v.as_str()).map(|s| s.trim().to_string());
            let publication = it.get("publication")
                .or_else(|| it.get("journal"))
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string());

            res.push(ScholarArticle {
                title,
                year,
                citations,
                link,
                citation_id,
                authors,
                publication,
            });
        }
    }
    res
}

/// Sincroniza as citações: busca no SerpApi, combina com os artigos locais de `producoes`
/// e salva as métricas no banco de dados.
pub fn sync_scholar_citations(
    conn: &Connection,
    author_id_opt: Option<&str>,
    api_key_opt: Option<&str>,
) -> Result<ScholarSyncReport, String> {
    let cfg = get_scholar_config(conn)?;

    let author_id = author_id_opt
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(&cfg.author_id);

    let api_key = api_key_opt
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(&cfg.serpapi_key);

    if author_id.is_empty() {
        return Err("Configure o ID do Google Scholar antes de sincronizar.".into());
    }
    if api_key.is_empty() {
        return Err("Configure a chave SerpApi (SERPAPI_KEY) antes de sincronizar.".into());
    }

    // Salva a configuração atualizada caso tenha vindo como argumento
    let _ = save_scholar_config(conn, author_id, api_key);

    let (mut info, scholar_articles) = fetch_serpapi_scholar(author_id, api_key)?;

    // Buscar registros locais de `producoes`
    let mut stmt = conn
        .prepare("SELECT id, titulo, ano, citations FROM producoes")
        .map_err(|e| e.to_string())?;

    struct LocalProd {
        id: i64,
        titulo: String,
        norm_title: String,
        tri: HashSet<String>,
        ano: Option<i64>,
        citations: Option<i64>,
    }

    let local_records = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let titulo: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let ano: Option<i64> = row.get(2)?;
            let citations: Option<i64> = row.get(3)?;
            Ok((id, titulo, ano, citations))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|(id, titulo, ano, citations)| {
            let norm_title = normalize_title(&titulo);
            let tri = trigrams(&titulo);
            LocalProd {
                id,
                titulo,
                norm_title,
                tri,
                ano,
                citations,
            }
        })
        .collect::<Vec<_>>();

    let mut matched_items = Vec::new();
    let mut used_local_ids = HashSet::new();

    for sc in &scholar_articles {
        let sc_norm = normalize_title(&sc.title);
        if sc_norm.is_empty() {
            continue;
        }
        let sc_tri = trigrams(&sc.title);

        let mut best_match: Option<(&LocalProd, f64)> = None;

        for loc in &local_records {
            if used_local_ids.contains(&loc.id) {
                continue;
            }

            // 1. Igualdade exata após normalização
            if !loc.norm_title.is_empty() && loc.norm_title == sc_norm {
                best_match = Some((loc, 1.0));
                break;
            }

            // 2. Similaridade de trigramas com verificação de ano
            let sim = dice(&sc_tri, &loc.tri);
            let year_compat = match (sc.year, loc.ano) {
                (Some(y1), Some(y2)) => (y1 - y2).abs() <= 1,
                _ => true,
            };

            let threshold = if year_compat { 0.80 } else { 0.90 };
            if sim >= threshold {
                if let Some((_, prev_sim)) = best_match {
                    if sim > prev_sim {
                        best_match = Some((loc, sim));
                    }
                } else {
                    best_match = Some((loc, sim));
                }
            }
        }

        if let Some((loc, _)) = best_match {
            used_local_ids.insert(loc.id);

            // Atualiza citações no banco
            conn.execute(
                "UPDATE producoes SET citations = ?1 WHERE id = ?2",
                params![sc.citations, loc.id],
            )
            .map_err(|e| e.to_string())?;

            matched_items.push(ScholarMatchedItem {
                id: loc.id,
                titulo: loc.titulo.clone(),
                ano: loc.ano,
                citations_before: loc.citations,
                citations_after: sc.citations,
                scholar_title: sc.title.clone(),
            });
        }
    }

    // Se total_citations ainda for 0, soma das citações atribuídas
    if info.total_citations == 0 && !scholar_articles.is_empty() {
        info.total_citations = scholar_articles.iter().map(|a| a.citations).sum();
    }

    // Gravar métricas e timestamp da sincronização
    let now = chrono::Local::now().format("%d/%m/%Y %H:%M").to_string();
    let metrics_payload = serde_json::json!({
        "author_name": info.name,
        "total_citations": info.total_citations,
        "h_index": info.h_index,
        "i10_index": info.i10_index,
        "last_sync": now,
        "scholar_articles_count": scholar_articles.len(),
        "matched_count": matched_items.len(),
        "graph": info.graph,
    });

    let _ = conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('settings.scholar_metrics', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [metrics_payload.to_string()],
    );
    let _ = conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('settings.scholar_cached_articles', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [serde_json::to_string(&scholar_articles).unwrap_or_default()],
    );

    Ok(ScholarSyncReport {
        author_name: info.name,
        total_citations: info.total_citations,
        h_index: info.h_index,
        i10_index: info.i10_index,
        scholar_articles_found: scholar_articles.len(),
        matched_count: matched_items.len(),
        updated_items: matched_items,
        graph: info.graph,
    })
}

/// Identifica artigos presentes no perfil do Google Scholar que não constam nas `producoes` locais do Lattes.
pub fn get_unmatched_scholar_articles(
    conn: &Connection,
    force_refresh: bool,
) -> Result<UnmatchedScholarReport, String> {
    let cfg = get_scholar_config(conn)?;

    let scholar_articles: Vec<ScholarArticle> = if !force_refresh {
        let cached_opt: Option<String> = conn
            .query_row(
                "SELECT value FROM app_metadata WHERE key = 'settings.scholar_cached_articles'",
                [],
                |row| row.get(0),
            )
            .ok();

        if let Some(cached_str) = cached_opt {
            serde_json::from_str(&cached_str).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    let scholar_articles = if scholar_articles.is_empty() {
        if cfg.author_id.is_empty() {
            return Err("ID do Google Scholar não configurado. Acesse Configurações > Google Scholar & APIs.".into());
        }
        if cfg.serpapi_key.is_empty() {
            return Err("Chave SerpApi não configurada. Acesse Configurações > Google Scholar & APIs.".into());
        }

        let (_info, fetched) = fetch_serpapi_scholar(&cfg.author_id, &cfg.serpapi_key)?;
        let _ = conn.execute(
            "INSERT INTO app_metadata (key, value) VALUES ('settings.scholar_cached_articles', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [serde_json::to_string(&fetched).unwrap_or_default()],
        );
        fetched
    } else {
        scholar_articles
    };

    // Obter produções locais
    let mut stmt = conn
        .prepare("SELECT id, titulo, ano, citations FROM producoes")
        .map_err(|e| e.to_string())?;

    struct LocalProd {
        #[allow(dead_code)]
        id: i64,
        norm_title: String,
        tri: HashSet<String>,
        #[allow(dead_code)]
        ano: Option<i64>,
    }

    let local_records = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let titulo: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let ano: Option<i64> = row.get(2)?;
            Ok((id, titulo, ano))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|(id, titulo, ano)| {
            let norm_title = normalize_title(&titulo);
            let tri = trigrams(&titulo);
            LocalProd {
                id,
                norm_title,
                tri,
                ano,
            }
        })
        .collect::<Vec<_>>();

    let total_scholar = scholar_articles.len();
    let mut total_matched = 0;
    let mut unmatched = Vec::new();

    for sc in &scholar_articles {
        let sc_norm = normalize_title(&sc.title);
        if sc_norm.is_empty() {
            continue;
        }
        let sc_tri = trigrams(&sc.title);

        let mut is_matched = false;

        for loc in &local_records {
            if loc.norm_title == sc_norm {
                is_matched = true;
                break;
            }

            if (loc.norm_title.starts_with(&sc_norm) || sc_norm.starts_with(&loc.norm_title))
                && (sc_norm.len() >= 20 || loc.norm_title.len() >= 20)
            {
                is_matched = true;
                break;
            }

            let score = dice(&sc_tri, &loc.tri);
            if score >= 0.75 {
                is_matched = true;
                break;
            }
        }

        if is_matched {
            total_matched += 1;
        } else {
            // Tenta extrair DOI se presente no título ou link
            let doi = crate::doi::parse_doi(&sc.title)
                .or_else(|| sc.link.as_deref().and_then(crate::doi::parse_doi));

            unmatched.push(UnmatchedScholarArticle {
                title: sc.title.clone(),
                year: sc.year,
                citations: sc.citations,
                journal: sc.publication.clone(),
                authors: sc.authors.clone(),
                doi,
                link: sc.link.clone(),
                citation_id: sc.citation_id.clone(),
            });
        }
    }

    // Ordena os artigos ausentes: anos mais recentes primeiro, depois mais citados
    unmatched.sort_by(|a, b| {
        b.year.unwrap_or(0).cmp(&a.year.unwrap_or(0))
            .then_with(|| b.citations.cmp(&a.citations))
    });

    Ok(UnmatchedScholarReport {
        total_scholar,
        total_matched,
        unmatched,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_author_id_variants() {
        assert_eq!(clean_author_id("X_12345AAAAJ"), "X_12345AAAAJ");
        assert_eq!(clean_author_id("  X_12345AAAAJ  "), "X_12345AAAAJ");
        assert_eq!(clean_author_id("QjxIJkcAAAAJ&hl"), "QjxIJkcAAAAJ");
        assert_eq!(
            clean_author_id("https://scholar.google.com/citations?user=X_12345AAAAJ&hl=pt-BR"),
            "X_12345AAAAJ"
        );
        assert_eq!(
            clean_author_id("https://scholar.google.com.br/citations?hl=pt-BR&user=X_12345AAAAJ#top"),
            "X_12345AAAAJ"
        );
        assert_eq!(
            clean_author_id("scholar.google.com/citations?user=X_12345AAAAJ/sub"),
            "X_12345AAAAJ"
        );
        assert_eq!(clean_author_id(""), "");
    }

    #[test]
    fn test_parse_serpapi_scholar_json_pt_and_en() {
        // Teste com resposta em português e com gráfico anual
        let raw_pt = serde_json::json!({
            "author": {
                "name": "Prof. Tiago Olivoto",
                "affiliations": "Universidade Federal de Santa Catarina"
            },
            "cited_by": {
                "table": [
                    { "citações": { "all": 6118, "desde_2021": 5716 } },
                    { "Índice_h": { "all": 32, "desde_2021": 29 } },
                    { "Índice_i10": { "all": 63, "desde_2021": 53 } }
                ],
                "graph": [
                    { "year": 2021, "citations": 369 },
                    { "year": 2022, "citations": 440 },
                    { "year": 2023, "citations": 731 },
                    { "year": 2024, "citations": 1125 }
                ]
            },
            "articles": [
                {
                    "title": "metan: an R package for multi-environment trial analysis",
                    "year": "2020",
                    "cited_by": { "value": 1497 }
                }
            ]
        });

        let info = parse_author_info(&raw_pt);
        assert_eq!(info.name, "Prof. Tiago Olivoto");
        assert_eq!(info.total_citations, 6118);
        assert_eq!(info.h_index, 32);
        assert_eq!(info.i10_index, 63);
        assert_eq!(info.graph.len(), 4);
        assert_eq!(info.graph[0].year, 2021);
        assert_eq!(info.graph[0].citations, 369);

        let articles = parse_articles(&raw_pt);
        assert_eq!(articles.len(), 1);
        assert_eq!(articles[0].citations, 1497);
    }

    #[test]
    fn test_scholar_matching_and_db_update() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::create_tables(&conn).unwrap();

        // Insere produções locais para testar correspondência
        conn.execute(
            "INSERT INTO producoes (ano, tipo, titulo, journal) VALUES (2021, 'Artigos completos', 'Machine learning approaches in agronomic forecasting', 'Computers in Agriculture')",
            [],
        ).unwrap();
        let id1 = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO producoes (ano, tipo, titulo, journal) VALUES (2018, 'Artigos completos', 'DESEMPENHO AGRONÔMICO DE CULTURAS ANUAIS PRODUTORAS', 'Revista Agro')",
            [],
        ).unwrap();
        let id2 = conn.last_insert_rowid();

        // Salvar configs de teste
        save_scholar_config(&conn, "X_12345AAAAJ", "secret_key_123").unwrap();
        let cfg = get_scholar_config(&conn).unwrap();
        assert_eq!(cfg.author_id, "X_12345AAAAJ");
        assert_eq!(cfg.serpapi_key, "secret_key_123");

        // Simula atualização direta com dados que viriam do Scholar
        conn.execute("UPDATE producoes SET citations = ?1 WHERE id = ?2", params![78, id1]).unwrap();
        conn.execute("UPDATE producoes SET citations = ?1 WHERE id = ?2", params![15, id2]).unwrap();

        // Testa o fallback de cálculo automático a partir do banco de produções
        let cfg_after = get_scholar_config(&conn).unwrap();
        assert_eq!(cfg_after.total_citations, Some(93));
        assert_eq!(cfg_after.h_index, Some(2));
        assert_eq!(cfg_after.i10_index, Some(2));
    }
}
