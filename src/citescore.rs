//! CiteScore (Scopus/Elsevier): consulta a Serial Title API pelo ISSN das revistas dos artigos e
//! guarda, por revista, só as métricas do ano corrente do CiteScore (`citeScoreCurrentMetricYear`):
//! CiteScore, percentil e posição em cada área do Scopus, SJR e SNIP.
//!
//! A chave da API fica no config.json do usuário (fora do banco, que vai junto nos backups).
//! Uso: gratuito para fins não comerciais; ao exibir o CiteScore, ligar ao título da revista no
//! Scopus (https://www.scopus.com/sourceid/{id}) e indicar "Powered by Scopus".

use crate::qualis::{journal_key, normalize_issn};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::time::Duration;

const API: &str = "https://api.elsevier.com/content/serial/title/issn";

// ---------------- chave ----------------

#[derive(Debug, Clone, Serialize)]
pub struct KeyStatus {
    pub configurada: bool,
    /// Últimos 4 caracteres, para o usuário reconhecer a chave.
    pub final_chave: Option<String>,
}

pub fn key() -> Option<String> {
    crate::config::load()
        .elsevier_api_key
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
}

pub fn key_status() -> KeyStatus {
    let k = key();
    KeyStatus {
        configurada: k.is_some(),
        final_chave: k.map(|k| {
            k.chars()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect()
        }),
    }
}

/// Grava a chave (vazia apaga).
pub fn set_key(k: &str) -> Result<KeyStatus, String> {
    let k = k.trim();
    if !k.is_empty() && (k.len() < 16 || !k.chars().all(|c| c.is_ascii_alphanumeric())) {
        return Err(
            "A chave da Elsevier tem letras e números (32 caracteres). Confira se copiou inteira."
                .into(),
        );
    }
    let mut cfg = crate::config::load();
    cfg.elsevier_api_key = (!k.is_empty()).then(|| k.to_string());
    crate::config::save(&cfg)?;
    Ok(key_status())
}

// ---------------- leitura da resposta ----------------

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AreaRank {
    pub codigo: String,
    pub area: String,
    pub posicao: Option<i64>,
    pub percentil: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Metricas {
    pub source_id: Option<String>,
    pub titulo: Option<String>,
    pub editora: Option<String>,
    pub issn_impresso: Option<String>,
    pub issn_eletronico: Option<String>,
    /// Ano do CiteScore (o último ano completo).
    pub ano: Option<i64>,
    pub citescore: Option<f64>,
    /// Melhor percentil entre as áreas da revista.
    pub percentil: Option<i64>,
    pub area: Option<String>,
    pub areas: Vec<AreaRank>,
    pub sjr: Option<f64>,
    pub snip: Option<f64>,
}

/// A Elsevier devolve listas de um item como objeto: normaliza para lista.
fn list(v: Option<&Value>) -> Vec<&Value> {
    match v {
        Some(Value::Array(a)) => a.iter().collect(),
        Some(Value::Null) | None => Vec::new(),
        Some(o) => vec![o],
    }
}

fn num(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().replace(',', ".").parse().ok(),
        _ => None,
    }
}

fn text(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => Some(s.trim().to_string()).filter(|s| !s.is_empty()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Valor do ano mais recente numa lista como SJRList.SJR = [{"@year": "2024", "$": "0.71"}].
fn ultimo(entry: &Value, lista: &str, item: &str) -> Option<f64> {
    list(entry.get(lista).and_then(|l| l.get(item)))
        .into_iter()
        .filter_map(|x| Some((num(x.get("@year"))? as i64, num(x.get("$"))?)))
        .max_by_key(|(y, _)| *y)
        .map(|(_, v)| v)
}

/// Lê a resposta da Serial Title API. `None` se a revista não está no Scopus.
pub fn parse(json: &Value) -> Option<Metricas> {
    let entry = *list(json.get("serial-metadata-response")?.get("entry")).first()?;
    if entry.get("error").is_some() {
        return None;
    }
    let nomes: HashMap<String, String> = list(entry.get("subject-area"))
        .into_iter()
        .filter_map(|s| Some((text(s.get("@code"))?, text(s.get("$")).unwrap_or_default())))
        .collect();
    let mut m = Metricas {
        source_id: text(entry.get("source-id")),
        titulo: text(entry.get("dc:title")),
        editora: text(entry.get("dc:publisher")),
        issn_impresso: text(entry.get("prism:issn")).and_then(|s| normalize_issn(&s)),
        issn_eletronico: text(entry.get("prism:eIssn")).and_then(|s| normalize_issn(&s)),
        sjr: ultimo(entry, "SJRList", "SJR"),
        snip: ultimo(entry, "SNIPList", "SNIP"),
        ..Default::default()
    };
    let cs = entry.get("citeScoreYearInfoList");
    m.ano = cs
        .and_then(|c| num(c.get("citeScoreCurrentMetricYear")))
        .map(|y| y as i64);
    m.citescore = cs.and_then(|c| num(c.get("citeScoreCurrentMetric")));

    // percentis: o ano do CiteScore corrente (ou o último completo, se não vier o ano)
    let anos = list(cs.and_then(|c| c.get("citeScoreYearInfo")));
    let do_ano = anos
        .iter()
        .find(|a| m.ano.is_some() && num(a.get("@year")).map(|y| y as i64) == m.ano)
        .or_else(|| {
            anos.iter()
                .filter(|a| text(a.get("@status")).as_deref() == Some("Complete"))
                .max_by_key(|a| num(a.get("@year")).map(|y| y as i64))
        });
    if let Some(a) = do_ano {
        if m.ano.is_none() {
            m.ano = num(a.get("@year")).map(|y| y as i64);
        }
        let info = list(a.get("citeScoreInformationList"))
            .into_iter()
            .flat_map(|l| list(l.get("citeScoreInfo")))
            // "all" = todos os tipos de documento; se não vier docType, usa o primeiro
            .min_by_key(|i| text(i.get("docType")).as_deref() != Some("all"));
        if let Some(info) = info {
            if m.citescore.is_none() {
                m.citescore = num(info.get("citeScore"));
            }
            m.areas = list(info.get("citeScoreSubjectRank"))
                .into_iter()
                .filter_map(|r| {
                    let codigo = text(r.get("subjectCode"))?;
                    Some(AreaRank {
                        area: nomes
                            .get(&codigo)
                            .cloned()
                            .unwrap_or_else(|| codigo.clone()),
                        codigo,
                        posicao: num(r.get("rank")).map(|x| x as i64),
                        percentil: num(r.get("percentile")).map(|x| x as i64),
                    })
                })
                .collect();
            m.areas.sort_by_key(|r| std::cmp::Reverse(r.percentil));
            if let Some(best) = m.areas.first() {
                m.percentil = best.percentil;
                m.area = Some(best.area.clone());
            }
        }
    }
    Some(m)
}

// ---------------- consulta ----------------

// vive só durante uma consulta: não vale encaixotar as métricas
#[allow(clippy::large_enum_variant)]
pub enum Consulta {
    Ok(Metricas),
    NaoEncontrada,
}

/// Visões tentadas, da mais completa para a mais básica. A CITESCORE traz os percentis; a
/// ENHANCED e a STANDARD trazem o CiteScore e, na consulta por ISSN, em geral também o detalhe
/// por ano (com os percentis). Se a chave não tiver acesso a uma visão, passa para a próxima.
pub const VIEWS: [&str; 3] = ["CITESCORE", "ENHANCED", "STANDARD"];

#[derive(Debug, PartialEq)]
pub enum Falha {
    /// 401: chave inválida ou ainda sem acesso liberado (com o motivo dado pela Elsevier).
    ChaveInvalida(String),
    /// 403 em todas as visões.
    SemAcesso(String),
    /// 429 com X-ELS-Status: QUOTA_EXCEEDED.
    Cota,
    Outra(String),
}

const ORIENTA_ACESSO: &str = "Chaves novas da Elsevier não trazem dados até a instituição ser reconhecida: use o app conectado à rede da UFSC (ou pela VPN da UFSC) e tente de novo. Se continuar, escreva ao suporte de API da Elsevier com a sua chave, \"Universidade Federal de Santa Catarina\" e o uso (consultar o CiteScore das revistas dos próprios artigos, uso acadêmico).";

impl Falha {
    pub fn mensagem(&self) -> String {
        let motivo = |m: &str| {
            if m.is_empty() {
                String::new()
            } else {
                format!(" (Elsevier: {m})")
            }
        };
        match self {
            Falha::ChaveInvalida(m) => format!(
                "A Elsevier recusou a chave{}. Confira se a chave está certa em dev.elsevier.com. {ORIENTA_ACESSO}",
                motivo(m)
            ),
            Falha::SemAcesso(m) => format!(
                "A chave foi aceita, mas ainda não tem acesso aos dados de revistas{}. {ORIENTA_ACESSO}",
                motivo(m)
            ),
            Falha::Cota => "Cota semanal da API da Elsevier esgotada (20.000 consultas por semana). Tente de novo em alguns dias.".into(),
            Falha::Outra(m) => m.clone(),
        }
    }
}

struct Erro {
    code: u16,
    /// 429 por cota esgotada (e não por excesso de consultas por segundo).
    cota: bool,
    body: String,
}

/// Texto do erro na resposta da Elsevier ({"service-error": {"status": {"statusText": ...}}}).
pub fn motivo_elsevier(body: &str) -> String {
    let v: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return body.trim().chars().take(160).collect(),
    };
    let st = v
        .pointer("/service-error/status")
        .or_else(|| v.pointer("/error-response"));
    let text = st
        .and_then(|s| s.get("statusText").or_else(|| s.get("error-message")))
        .and_then(Value::as_str)
        .unwrap_or("");
    let code = st
        .and_then(|s| s.get("statusCode").or_else(|| s.get("error-code")))
        .and_then(Value::as_str)
        .unwrap_or("");
    match (code.is_empty(), text.is_empty()) {
        (false, false) => format!("{code}: {text}"),
        (true, false) => text.to_string(),
        (false, true) => code.to_string(),
        (true, true) => String::new(),
    }
}

fn get(agent: &ureq::Agent, issn: &str, view: &str, key: &str) -> Result<Option<Value>, Erro> {
    let url = format!("{API}/{issn}?view={view}");
    match agent
        .get(&url)
        .set("X-ELS-APIKey", key)
        .set("Accept", "application/json")
        .call()
    {
        Ok(r) => r.into_json::<Value>().map(Some).map_err(|e| Erro {
            code: 0,
            cota: false,
            body: format!("Resposta inválida da Elsevier: {e}"),
        }),
        Err(ureq::Error::Status(404, _)) => Ok(None),
        Err(ureq::Error::Status(code, r)) => Err(Erro {
            code,
            cota: r
                .header("X-ELS-Status")
                .is_some_and(|s| s.to_ascii_uppercase().contains("QUOTA")),
            body: r.into_string().unwrap_or_default(),
        }),
        Err(e) => Err(Erro {
            code: 0,
            cota: false,
            body: format!("Falha de conexão com a Elsevier: {e}"),
        }),
    }
}

fn nao_encontrada(body: &str) -> bool {
    let b = body.to_ascii_uppercase();
    b.contains("RESOURCE_NOT_FOUND")
        || b.contains("NOT FOUND")
        || b.contains("RESULT SET WAS EMPTY")
}

/// Consulta uma revista. `view` é o índice em `VIEWS`: começa na mais completa e avança (para
/// as próximas revistas também) quando a chave não tem acesso a ela. Excesso de consultas por
/// segundo e erros temporários do servidor são repetidos algumas vezes, com espera.
pub fn consultar(
    agent: &ureq::Agent,
    issn: &str,
    key: &str,
    view: &mut usize,
) -> Result<Consulta, Falha> {
    let mut tentativas = 0u64;
    loop {
        let e = match get(agent, issn, VIEWS[*view], key) {
            Ok(Some(json)) => {
                return Ok(parse(&json)
                    .map(Consulta::Ok)
                    .unwrap_or(Consulta::NaoEncontrada))
            }
            Ok(None) => return Ok(Consulta::NaoEncontrada),
            Err(e) => e,
        };
        match e.code {
            400 if nao_encontrada(&e.body) => return Ok(Consulta::NaoEncontrada),
            // visão não permitida para esta chave: tenta a próxima
            400 | 403 if *view + 1 < VIEWS.len() => *view += 1,
            401 => return Err(Falha::ChaveInvalida(motivo_elsevier(&e.body))),
            403 => return Err(Falha::SemAcesso(motivo_elsevier(&e.body))),
            429 if e.cota => return Err(Falha::Cota),
            429 | 500 | 502 | 503 | 504 | 0 if tentativas < 3 => {
                tentativas += 1;
                std::thread::sleep(Duration::from_millis(1500 * tentativas));
            }
            429 => {
                return Err(Falha::Outra(
                    "A Elsevier pediu para diminuir o ritmo das consultas. Espere um minuto e tente de novo.".into(),
                ))
            }
            0 => return Err(Falha::Outra(e.body)),
            code => {
                let m = motivo_elsevier(&e.body);
                return Err(Falha::Outra(format!(
                    "A Elsevier respondeu com erro {code}{}. Tente de novo mais tarde; se repetir, confira a chave e a conexão com a rede da UFSC.",
                    if m.is_empty() { String::new() } else { format!(" ({m})") }
                )));
            }
        }
    }
}

pub fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(25))
        .user_agent("LattesManager/1.0")
        .build()
}

/// Espera entre consultas (limite da Elsevier: 6 por segundo).
pub const PAUSA: Duration = Duration::from_millis(220);

// ---------------- banco ----------------

/// Grava (substituindo) o resultado de uma revista.
pub fn store(conn: &Connection, issn: &str, r: &Consulta) -> Result<(), String> {
    let agora = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    match r {
        Consulta::Ok(m) => conn.execute(
            "INSERT OR REPLACE INTO citescore (issn, status, source_id, titulo, editora, issn_impresso, issn_eletronico, ano, citescore, percentil, area, areas, sjr, snip, consultado_em)
             VALUES (?1, 'ok', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                issn,
                m.source_id,
                m.titulo,
                m.editora,
                m.issn_impresso,
                m.issn_eletronico,
                m.ano,
                m.citescore,
                m.percentil,
                m.area,
                serde_json::to_string(&m.areas).unwrap_or_default(),
                m.sjr,
                m.snip,
                agora
            ],
        ),
        Consulta::NaoEncontrada => conn.execute(
            "INSERT OR REPLACE INTO citescore (issn, status, consultado_em) VALUES (?1, 'nao_encontrada', ?2)",
            params![issn, agora],
        ),
    }
    .map(|_| ())
    .map_err(|e| e.to_string())
}

struct Artigo {
    id: i64,
    titulo: String,
    ano: Option<i64>,
    journal: Option<String>,
    issn: Option<String>,
}

fn load_artigos(conn: &Connection) -> Result<Vec<Artigo>, String> {
    let mut st = conn
        .prepare("SELECT id, titulo, ano, journal, issn, tipo FROM producoes")
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |r| {
            Ok((
                Artigo {
                    id: r.get(0)?,
                    titulo: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    ano: r.get(2)?,
                    journal: r.get(3)?,
                    issn: r
                        .get::<_, Option<String>>(4)?
                        .and_then(|s| normalize_issn(&s)),
                },
                r.get::<_, Option<String>>(5)?.unwrap_or_default(),
            ))
        })
        .map_err(|e| e.to_string())?;
    Ok(rows
        .flatten()
        .filter(|(_, t)| t.trim().to_lowercase().starts_with("artigo"))
        .map(|(a, _)| a)
        .collect())
}

/// ISSN de cada artigo: o dele ou, sem ISSN, o de outro artigo da mesma revista.
fn issn_por_artigo(artigos: &[Artigo]) -> HashMap<i64, String> {
    let mut por_revista: HashMap<String, String> = HashMap::new();
    for a in artigos {
        if let (Some(i), Some(j)) = (&a.issn, &a.journal) {
            let k = journal_key(j);
            if !k.is_empty() {
                por_revista.entry(k).or_insert_with(|| i.clone());
            }
        }
    }
    artigos
        .iter()
        .filter_map(|a| {
            let i = a.issn.clone().or_else(|| {
                a.journal
                    .as_deref()
                    .map(journal_key)
                    .and_then(|k| por_revista.get(&k).cloned())
            })?;
            Some((a.id, i))
        })
        .collect()
}

/// ISSNs a consultar: os das revistas dos artigos; sem `todos`, só os que ainda não estão na tabela.
pub fn issns_pendentes(conn: &Connection, todos: bool) -> Result<Vec<String>, String> {
    let artigos = load_artigos(conn)?;
    let mut issns: BTreeSet<String> = issn_por_artigo(&artigos).into_values().collect();
    if !todos {
        let mut st = conn
            .prepare("SELECT issn FROM citescore")
            .map_err(|e| e.to_string())?;
        let feitos: BTreeSet<String> = st
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .flatten()
            .collect();
        issns.retain(|i| !feitos.contains(i));
    }
    Ok(issns.into_iter().collect())
}

#[derive(Debug, Clone, Serialize)]
pub struct Revista {
    pub issn: String,
    pub status: String,
    pub source_id: Option<String>,
    pub titulo: Option<String>,
    pub editora: Option<String>,
    pub ano: Option<i64>,
    pub citescore: Option<f64>,
    pub percentil: Option<i64>,
    pub area: Option<String>,
    pub areas: Vec<AreaRank>,
    pub sjr: Option<f64>,
    pub snip: Option<f64>,
    pub consultado_em: Option<String>,
    /// Página da revista no Scopus (exigida pela Elsevier ao mostrar o CiteScore).
    pub url: Option<String>,
    pub artigos: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ArtigoCs {
    pub id: i64,
    pub titulo: String,
    pub ano: Option<i64>,
    pub journal: Option<String>,
    /// ISSN usado para achar a revista (o do artigo ou o de outro artigo da mesma revista).
    pub issn: Option<String>,
}

#[derive(Debug, Default, Serialize)]
pub struct CiteScoreData {
    pub chave: Option<KeyStatus>,
    pub revistas: Vec<Revista>,
    pub artigos: Vec<ArtigoCs>,
    /// ISSNs das revistas dos artigos ainda não consultados.
    pub pendentes: usize,
}

pub fn data(conn: &Connection) -> Result<CiteScoreData, String> {
    let artigos = load_artigos(conn)?;
    let mapa = issn_por_artigo(&artigos);
    let mut n_por_issn: HashMap<&str, usize> = HashMap::new();
    for i in mapa.values() {
        *n_por_issn.entry(i.as_str()).or_default() += 1;
    }
    let mut st = conn
        .prepare("SELECT issn, status, source_id, titulo, editora, ano, citescore, percentil, area, areas, sjr, snip, consultado_em FROM citescore")
        .map_err(|e| e.to_string())?;
    let revistas: Vec<Revista> = st
        .query_map([], |r| {
            let issn: String = r.get(0)?;
            let source_id: Option<String> = r.get(2)?;
            Ok(Revista {
                status: r.get(1)?,
                url: source_id
                    .as_ref()
                    .map(|s| format!("https://www.scopus.com/sourceid/{s}")),
                source_id,
                titulo: r.get(3)?,
                editora: r.get(4)?,
                ano: r.get(5)?,
                citescore: r.get(6)?,
                percentil: r.get(7)?,
                area: r.get(8)?,
                areas: r
                    .get::<_, Option<String>>(9)?
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_default(),
                sjr: r.get(10)?,
                snip: r.get(11)?,
                consultado_em: r.get(12)?,
                artigos: 0,
                issn,
            })
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|mut v| {
            v.artigos = n_por_issn.get(v.issn.as_str()).copied().unwrap_or(0);
            v
        })
        .collect();
    let feitos: BTreeSet<&str> = revistas.iter().map(|r| r.issn.as_str()).collect();
    let pendentes = mapa
        .values()
        .map(String::as_str)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter(|i| !feitos.contains(i))
        .count();
    Ok(CiteScoreData {
        chave: None,
        artigos: artigos
            .into_iter()
            .map(|a| ArtigoCs {
                issn: mapa.get(&a.id).cloned(),
                id: a.id,
                titulo: a.titulo,
                ano: a.ano,
                journal: a.journal,
            })
            .collect(),
        revistas,
        pendentes,
    })
}

/// Métricas da revista de um artigo, para a coluna "Métricas" da tabela de produções.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct MetricasRevista {
    /// Estrato da tabela oficial do Qualis (importada), quando a revista está nela.
    pub qualis_capes: Option<String>,
    pub ano: Option<i64>,
    pub citescore: Option<f64>,
    pub percentil: Option<i64>,
    pub area: Option<String>,
    pub sjr: Option<f64>,
    pub snip: Option<f64>,
    /// Página da revista no Scopus.
    pub url: Option<String>,
    /// Revista consultada e não encontrada no Scopus.
    pub fora_scopus: bool,
}

/// Métricas de cada artigo (só os que têm alguma), pelo ISSN ou pelo nome da revista.
pub fn por_producao(conn: &Connection) -> Result<HashMap<i64, MetricasRevista>, String> {
    let artigos = load_artigos(conn)?;
    let mapa = issn_por_artigo(&artigos);
    let itens: Vec<(i64, Option<String>, Option<String>)> = artigos
        .iter()
        .map(|a| (a.id, mapa.get(&a.id).cloned(), a.journal.clone()))
        .collect();
    let estratos = crate::qualis::estratos(conn, &itens);
    type Linha = (
        String,
        Option<String>,
        Option<i64>,
        Option<f64>,
        Option<i64>,
        Option<String>,
        Option<f64>,
        Option<f64>,
        Option<String>,
    );
    let mut st = conn
        .prepare("SELECT issn, status, ano, citescore, percentil, area, sjr, snip, source_id FROM citescore")
        .map_err(|e| e.to_string())?;
    let cs: HashMap<String, Linha> = st
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|l| (l.0.clone(), l))
        .collect();
    let mut out = HashMap::new();
    for a in &artigos {
        let mut m = MetricasRevista {
            qualis_capes: estratos.get(&a.id).cloned(),
            ..Default::default()
        };
        if let Some((_, status, ano, citescore, percentil, area, sjr, snip, sid)) =
            mapa.get(&a.id).and_then(|i| cs.get(i))
        {
            if status.as_deref() == Some("ok") {
                m.ano = *ano;
                m.citescore = *citescore;
                m.percentil = *percentil;
                m.area = area.clone();
                m.sjr = *sjr;
                m.snip = *snip;
                m.url = sid
                    .as_ref()
                    .map(|s| format!("https://www.scopus.com/sourceid/{s}"));
            } else {
                m.fora_scopus = true;
            }
        }
        if m != MetricasRevista::default() {
            out.insert(a.id, m);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Resposta no formato da Serial Title API (view=CITESCORE), com listas de um item como objeto.
    fn exemplo() -> Value {
        json!({
          "serial-metadata-response": {
            "entry": [{
              "dc:title": "Agronomy Journal",
              "dc:publisher": "Wiley-Blackwell",
              "prism:issn": "00021962",
              "prism:eIssn": "14350645",
              "source-id": "15600",
              "subject-area": [
                {"@code": "1102", "@abbrev": "AGRI", "$": "Agronomy and Crop Science"},
                {"@code": "1111", "@abbrev": "AGRI", "$": "Soil Science"}
              ],
              "SJRList": {"SJR": [{"@year": "2023", "$": "0.70"}, {"@year": "2024", "$": "0.74"}]},
              "SNIPList": {"SNIP": {"@year": "2024", "$": "1.05"}},
              "citeScoreYearInfoList": {
                "citeScoreCurrentMetric": "4.8",
                "citeScoreCurrentMetricYear": "2024",
                "citeScoreTracker": "5.0",
                "citeScoreTrackerYear": "2025",
                "citeScoreYearInfo": [
                  {"@year": "2025", "@status": "In-Progress", "citeScoreInformationList": [{"citeScoreInfo": [{"docType": "all", "citeScore": "5.0", "citeScoreSubjectRank": [{"subjectCode": "1102", "rank": "1", "percentile": "99"}]}]}]},
                  {"@year": "2024", "@status": "Complete", "citeScoreInformationList": [{"citeScoreInfo": [{
                    "docType": "all", "scholarlyOutput": "1200", "citationCount": "5760", "citeScore": "4.8", "percentCited": "80",
                    "citeScoreSubjectRank": [
                      {"subjectCode": "1111", "rank": "40", "percentile": "70"},
                      {"subjectCode": "1102", "rank": "60", "percentile": "82"}
                    ]
                  }]}]}
                ]
              }
            }]
          }
        })
    }

    #[test]
    fn parses_current_year_and_best_percentile() {
        let m = parse(&exemplo()).unwrap();
        assert_eq!(m.titulo.as_deref(), Some("Agronomy Journal"));
        assert_eq!(m.source_id.as_deref(), Some("15600"));
        assert_eq!(m.issn_eletronico.as_deref(), Some("1435-0645"));
        assert_eq!((m.ano, m.citescore), (Some(2024), Some(4.8)));
        // só o ano corrente (completo), não o tracker de 2025
        assert_eq!(m.percentil, Some(82));
        assert_eq!(m.area.as_deref(), Some("Agronomy and Crop Science"));
        assert_eq!(m.areas.len(), 2);
        assert_eq!(m.areas[1].area, "Soil Science");
        assert_eq!((m.sjr, m.snip), (Some(0.74), Some(1.05)));
    }

    #[test]
    fn standard_view_and_missing_journal() {
        // visão STANDARD: CiteScore sem percentis
        let v = json!({"serial-metadata-response": {"entry": {
            "dc:title": "Revista X", "source-id": 123,
            "citeScoreYearInfoList": {"citeScoreCurrentMetric": "1.2", "citeScoreCurrentMetricYear": "2024"}
        }}});
        let m = parse(&v).unwrap();
        assert_eq!(
            (m.ano, m.citescore, m.percentil),
            (Some(2024), Some(1.2), None)
        );
        assert_eq!(m.source_id.as_deref(), Some("123"));
        let vazio =
            json!({"serial-metadata-response": {"entry": [{"error": "Result set was empty"}]}});
        assert!(parse(&vazio).is_none());
        assert!(parse(&json!({})).is_none());
    }

    #[test]
    fn stores_and_maps_articles_by_issn_or_journal() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO producoes (id, ano, tipo, titulo, journal, issn) VALUES
              (1, 2022, 'Artigos completos', 'A', 'Agronomy Journal', '0002-1962'),
              (2, 2021, 'Artigos completos', 'B', 'AGRONOMY JOURNAL', NULL),
              (3, 2020, 'Artigos completos', 'C', 'Revista Fora', '1111-2222'),
              (4, 2020, 'Resumos simples', 'D', 'Congresso', '3333-4444');
            "#,
        )
        .unwrap();
        assert_eq!(
            issns_pendentes(&conn, false).unwrap(),
            vec!["0002-1962", "1111-2222"]
        );
        store(
            &conn,
            "0002-1962",
            &Consulta::Ok(parse(&exemplo()).unwrap()),
        )
        .unwrap();
        store(&conn, "1111-2222", &Consulta::NaoEncontrada).unwrap();
        assert!(issns_pendentes(&conn, false).unwrap().is_empty());
        assert_eq!(issns_pendentes(&conn, true).unwrap().len(), 2);

        let d = data(&conn).unwrap();
        assert_eq!(d.pendentes, 0);
        let aj = d.revistas.iter().find(|r| r.issn == "0002-1962").unwrap();
        assert_eq!((aj.artigos, aj.percentil), (2, Some(82)));
        assert_eq!(
            aj.url.as_deref(),
            Some("https://www.scopus.com/sourceid/15600")
        );
        let fora = d.revistas.iter().find(|r| r.issn == "1111-2222").unwrap();
        assert_eq!(fora.status, "nao_encontrada");
        assert_eq!(d.artigos.len(), 3, "resumo não entra");
        // o artigo sem ISSN usa o da mesma revista
        assert_eq!(
            d.artigos
                .iter()
                .find(|a| a.id == 2)
                .unwrap()
                .issn
                .as_deref(),
            Some("0002-1962")
        );

        // consultar de novo substitui (só o ano corrente fica guardado)
        let mut m = parse(&exemplo()).unwrap();
        m.ano = Some(2025);
        m.percentil = Some(90);
        store(&conn, "0002-1962", &Consulta::Ok(m)).unwrap();
        let n: i64 = conn
            .query_row("SELECT count(*) FROM citescore", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2);
        let d = data(&conn).unwrap();
        assert_eq!(
            d.revistas
                .iter()
                .find(|r| r.issn == "0002-1962")
                .unwrap()
                .percentil,
            Some(90)
        );
    }

    #[test]
    fn reads_elsevier_error_text() {
        let body = r#"{"service-error":{"status":{"statusCode":"AUTHORIZATION_ERROR","statusText":"The requestor is not authorized to access the requested view or fields of the resource"}}}"#;
        assert_eq!(
            motivo_elsevier(body),
            "AUTHORIZATION_ERROR: The requestor is not authorized to access the requested view or fields of the resource"
        );
        assert_eq!(
            motivo_elsevier(
                "Error encountered while calling the API service, Please try again later"
            ),
            "Error encountered while calling the API service, Please try again later"
        );
        assert!(nao_encontrada(
            r#"{"service-error":{"status":{"statusCode":"RESOURCE_NOT_FOUND"}}}"#
        ));
        let m = Falha::ChaveInvalida("AUTHENTICATION_ERROR".into()).mensagem();
        assert!(m.contains("rede da UFSC") && m.contains("AUTHENTICATION_ERROR"));
    }

    #[test]
    fn metrics_per_production_join_qualis_and_citescore() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO producoes (id, ano, tipo, titulo, journal, issn) VALUES
              (1, 2022, 'Artigos completos', 'A', 'Agronomy Journal', '0002-1962'),
              (2, 2021, 'Artigos completos', 'B', 'AGRONOMY JOURNAL', NULL),
              (3, 2020, 'Artigos completos', 'C', 'Revista Fora', '1111-2222'),
              (4, 2020, 'Artigos completos', 'D', 'Sem nada', NULL);
            "#,
        )
        .unwrap();
        let t = crate::qualis::QualisTable {
            entries: vec![crate::qualis::QualisEntry {
                issn: Some("1435-0645".into()),
                titulo: "AGRONOMY JOURNAL (ONLINE)".into(),
                estrato: "A3".into(),
                area: None,
            }],
            ..Default::default()
        };
        crate::qualis::store_table(&conn, &t, None, "q.xlsx").unwrap();
        store(
            &conn,
            "0002-1962",
            &Consulta::Ok(parse(&exemplo()).unwrap()),
        )
        .unwrap();
        store(&conn, "1111-2222", &Consulta::NaoEncontrada).unwrap();
        let m = por_producao(&conn).unwrap();
        assert_eq!(m.len(), 3, "o artigo sem métrica nenhuma fica de fora");
        let a = &m[&1];
        assert_eq!(
            (a.qualis_capes.as_deref(), a.percentil, a.citescore),
            (Some("A3"), Some(82), Some(4.8))
        );
        assert_eq!(
            a.url.as_deref(),
            Some("https://www.scopus.com/sourceid/15600")
        );
        assert_eq!(m[&2].percentil, Some(82), "sem ISSN, pela mesma revista");
        assert!(m[&3].fora_scopus && m[&3].qualis_capes.is_none());
    }

    #[test]
    fn key_validation() {
        assert!(set_key("abc").is_err());
        assert!(set_key("chave com espaço 123456789").is_err());
    }
}
