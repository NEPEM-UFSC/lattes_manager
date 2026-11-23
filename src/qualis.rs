//! Qualis oficial da CAPES: lê a planilha publicada (xlsx, xls, ods ou csv), compara com os
//! artigos do banco pelo ISSN (ou, sem ISSN, pelo nome da revista) e grava o estrato confirmado.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::path::Path;

/// ISSN no formato `0000-0000` (o último dígito pode ser `X`). `None` se não tiver 8 caracteres válidos.
pub fn normalize_issn(raw: &str) -> Option<String> {
    let chars: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == 'x' || *c == 'X')
        .map(|c| c.to_ascii_uppercase())
        .collect();
    let valid = chars.len() == 8 && chars[..7].chars().all(|c| c.is_ascii_digit());
    valid.then(|| format!("{}-{}", &chars[..4], &chars[4..]))
}

/// Nome de revista comparável: sem acentos, minúsculas, só letras e números separados por um espaço.
pub fn normalize_journal(raw: &str) -> String {
    crate::db::fold(raw)
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Estrato no formato da CAPES (A1…A4, B1…B5, C), ou `None` para valores que não são estrato.
fn normalize_estrato(raw: &str) -> Option<String> {
    let s: String = raw.split_whitespace().collect::<String>().to_uppercase();
    let ok = matches!(s.as_str(), "C")
        || (s.len() == 2
            && matches!(s.as_bytes()[0], b'A' | b'B')
            && s.as_bytes()[1].is_ascii_digit());
    ok.then_some(s)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct QualisEntry {
    pub issn: Option<String>,
    pub titulo: String,
    pub estrato: String,
    pub area: Option<String>,
}

/// Cabeçalhos encontrados na planilha (como estão escritos nela).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Colunas {
    pub issn: String,
    pub titulo: Option<String>,
    pub estrato: String,
    pub area: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct QualisTable {
    pub entries: Vec<QualisEntry>,
    /// Áreas de avaliação, quando a planilha tem uma coluna de área (Qualis 2013–2016).
    pub areas: Vec<String>,
    pub colunas: Colunas,
    /// Linhas sem ISSN válido ou sem estrato reconhecível.
    pub ignoradas: usize,
}

/// Lê a planilha do Qualis. Procura, nas primeiras linhas de cada aba, um cabeçalho com
/// ISSN e Estrato (e, se houver, Título e Área de avaliação).
pub fn read_table(path: &Path) -> Result<QualisTable, String> {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let sheets: Vec<Vec<Vec<String>>> = if ext == "csv" || ext == "txt" {
        let bytes =
            std::fs::read(path).map_err(|e| format!("Não foi possível ler o arquivo: {e}"))?;
        vec![parse_csv(&decode_text(&bytes))]
    } else {
        use calamine::Reader;
        let mut wb = calamine::open_workbook_auto(path)
            .map_err(|e| format!("Não foi possível abrir a planilha: {e}"))?;
        wb.worksheets()
            .into_iter()
            .map(|(_, range)| {
                range
                    .rows()
                    .map(|r| r.iter().map(|c| c.to_string().trim().to_string()).collect())
                    .collect()
            })
            .collect()
    };
    for rows in &sheets {
        if let Some(t) = table_from_rows(rows) {
            return Ok(t);
        }
    }
    Err("Não encontrei as colunas ISSN e Estrato. Confira se é a planilha do Qualis exportada da Plataforma Sucupira.".into())
}

/// Texto do CSV: UTF-8 (com ou sem BOM) ou, se não for UTF-8 válido, Latin-1 (comum em exportações antigas).
fn decode_text(bytes: &[u8]) -> String {
    let b = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(b) {
        Ok(s) => s.to_string(),
        Err(_) => b.iter().map(|&c| c as char).collect(),
    }
}

/// CSV simples com aspas. O separador (`;`, `,` ou tab) é o mais frequente nas primeiras linhas,
/// que podem começar com um título sem separador; no empate, vale o `;`.
fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let head: String = text.lines().take(30).collect::<Vec<_>>().join("\n");
    let sep = ['\t', ',', ';']
        .into_iter()
        .max_by_key(|s| head.matches(*s).count())
        .unwrap_or(';');
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            c if c == sep && !quoted => row.push(std::mem::take(&mut field).trim().to_string()),
            '\n' if !quoted => {
                row.push(std::mem::take(&mut field).trim().to_string());
                rows.push(std::mem::take(&mut row));
            }
            '\r' if !quoted => {}
            c => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field.trim().to_string());
        rows.push(row);
    }
    rows
}

fn cell(r: &[String], i: usize) -> &str {
    r.get(i).map(String::as_str).unwrap_or("")
}

fn table_from_rows(rows: &[Vec<String>]) -> Option<QualisTable> {
    let find = |header: &[String], pred: &dyn Fn(&str) -> bool| {
        header.iter().position(|h| pred(&normalize_journal(h)))
    };
    for (hi, header) in rows.iter().enumerate().take(30) {
        let Some(c_issn) = find(header, &|h| h.contains("issn")) else {
            continue;
        };
        let Some(c_estrato) = find(header, &|h| {
            h.contains("estrato") || h == "qualis" || h.contains("classificacao")
        }) else {
            continue;
        };
        let c_titulo = header.iter().enumerate().position(|(i, h)| {
            let h = normalize_journal(h);
            i != c_issn
                && (h.contains("titulo") || h.contains("periodico") || h.contains("revista"))
        });
        let c_area = find(header, &|h| h.contains("area"));

        let mut table = QualisTable {
            colunas: Colunas {
                issn: header[c_issn].clone(),
                titulo: c_titulo.map(|i| header[i].clone()),
                estrato: header[c_estrato].clone(),
                area: c_area.map(|i| header[i].clone()),
            },
            ..Default::default()
        };
        let mut areas = BTreeSet::new();
        for r in &rows[hi + 1..] {
            if r.iter().all(|c| c.trim().is_empty()) {
                continue;
            }
            let estrato = normalize_estrato(cell(r, c_estrato));
            let issn = normalize_issn(cell(r, c_issn));
            let titulo = c_titulo.map(|i| cell(r, i).to_string()).unwrap_or_default();
            let Some(estrato) = estrato else {
                table.ignoradas += 1;
                continue;
            };
            if issn.is_none() && titulo.trim().is_empty() {
                table.ignoradas += 1;
                continue;
            }
            let area = c_area
                .map(|i| cell(r, i).trim().to_string())
                .filter(|a| !a.is_empty());
            if let Some(a) = &area {
                areas.insert(a.clone());
            }
            table.entries.push(QualisEntry {
                issn,
                titulo,
                estrato,
                area,
            });
        }
        table.areas = areas.into_iter().collect();
        return Some(table);
    }
    None
}

// ---------------- Tabela qualis_capes no banco ----------------

/// Chave para comparar nomes de revista: sem o que está entre parênteses ("(ONLINE)",
/// "(IMPRESSO)", "(1986)"…), sem "the" inicial e normalizada. Assim "Agronomy Journal" e
/// "AGRONOMY JOURNAL (ONLINE)" são a mesma revista.
pub fn journal_key(raw: &str) -> String {
    let mut depth = 0usize;
    let plain: String = raw
        .chars()
        .map(|c| match c {
            '(' | '[' => {
                depth += 1;
                ' '
            }
            ')' | ']' => {
                depth = depth.saturating_sub(1);
                ' '
            }
            _ if depth > 0 => ' ',
            c => c,
        })
        .collect();
    let n = normalize_journal(&plain);
    let n = n.strip_prefix("the ").map(str::to_string).unwrap_or(n);
    // suporte escrito sem parênteses ("... online", "... impresso")
    for suf in [
        " online",
        " impresso",
        " print",
        " eletronica",
        " electronic",
    ] {
        if let Some(base) = n.strip_suffix(suf) {
            if !base.is_empty() {
                return base.to_string();
            }
        }
    }
    n
}

/// Dados da última importação da planilha.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QualisInfo {
    pub arquivo: String,
    pub area: Option<String>,
    pub importado_em: String,
    pub entradas: usize,
    pub ignoradas: usize,
    #[serde(default)]
    pub colunas: Option<Colunas>,
}

const INFO_KEY: &str = "qualis_capes.info";

#[derive(Debug, Clone, Default, Serialize)]
pub struct ImportResult {
    /// Preenchido quando a planilha tem várias áreas e nenhuma foi escolhida (nada é gravado).
    pub areas: Vec<String>,
    pub info: Option<QualisInfo>,
}

/// Substitui o conteúdo de `qualis_capes` pelas entradas da planilha (da área escolhida, se houver).
pub fn store_table(
    conn: &Connection,
    table: &QualisTable,
    area: Option<&str>,
    arquivo: &str,
) -> Result<ImportResult, String> {
    let area = area.map(str::trim).filter(|a| !a.is_empty());
    if !table.areas.is_empty() && area.is_none() {
        return Ok(ImportResult {
            areas: table.areas.clone(),
            info: None,
        });
    }
    let entries: Vec<&QualisEntry> = table
        .entries
        .iter()
        .filter(|e| area.is_none() || e.area.as_deref() == area)
        .collect();
    if entries.is_empty() {
        return Err("Nenhum periódico com estrato encontrado na planilha.".into());
    }
    let info = QualisInfo {
        arquivo: arquivo.to_string(),
        area: area.map(str::to_string),
        importado_em: chrono::Local::now().format("%Y-%m-%d %H:%M").to_string(),
        entradas: entries.len(),
        ignoradas: table.ignoradas,
        colunas: Some(table.colunas.clone()),
    };
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM qualis_capes", [])
        .map_err(|e| e.to_string())?;
    {
        let mut st = tx
            .prepare("INSERT INTO qualis_capes (issn, titulo, titulo_chave, estrato, area) VALUES (?1, ?2, ?3, ?4, ?5)")
            .map_err(|e| e.to_string())?;
        for e in &entries {
            st.execute(params![
                e.issn,
                e.titulo.trim(),
                journal_key(&e.titulo),
                e.estrato,
                e.area
            ])
            .map_err(|e| e.to_string())?;
        }
    }
    tx.execute(
        "INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?1, ?2)",
        params![INFO_KEY, serde_json::to_string(&info).unwrap_or_default()],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(ImportResult {
        areas: Vec::new(),
        info: Some(info),
    })
}

/// Informações da tabela importada, ou `None` se ainda não houve importação.
pub fn info(conn: &Connection) -> Option<QualisInfo> {
    let n: i64 = conn
        .query_row("SELECT count(*) FROM qualis_capes", [], |r| r.get(0))
        .ok()?;
    if n == 0 {
        return None;
    }
    let mut info: QualisInfo = conn
        .query_row(
            "SELECT value FROM app_metadata WHERE key = ?1",
            [INFO_KEY],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default();
    info.entradas = n as usize;
    Some(info)
}

pub fn load_entries(conn: &Connection) -> Result<Vec<QualisEntry>, String> {
    let mut st = conn
        .prepare("SELECT issn, titulo, estrato, area FROM qualis_capes ORDER BY titulo")
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |r| {
            Ok(QualisEntry {
                issn: r.get(0)?,
                titulo: r.get(1)?,
                estrato: r.get(2)?,
                area: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

/// Índice das entradas por ISSN e pelo nome da revista. Um nome que aponta para estratos
/// diferentes (revistas distintas com o mesmo nome) fica fora do índice por nome.
struct Index<'a> {
    by_issn: HashMap<&'a str, &'a QualisEntry>,
    by_key: HashMap<String, Option<&'a QualisEntry>>,
}

impl<'a> Index<'a> {
    fn new(entries: &'a [QualisEntry]) -> Self {
        let mut by_issn = HashMap::new();
        let mut by_key: HashMap<String, Option<&QualisEntry>> = HashMap::new();
        for e in entries {
            if let Some(i) = &e.issn {
                by_issn.entry(i.as_str()).or_insert(e);
            }
            let k = journal_key(&e.titulo);
            if k.is_empty() {
                continue;
            }
            by_key
                .entry(k)
                .and_modify(|cur| {
                    if cur.is_some_and(|c| c.estrato != e.estrato) {
                        *cur = None;
                    }
                })
                .or_insert(Some(e));
        }
        Self { by_issn, by_key }
    }

    /// Procura pelo ISSN; se não achar, pelo nome da revista.
    fn find(
        &self,
        issn: Option<&str>,
        journal: Option<&str>,
    ) -> Option<(&'a QualisEntry, &'static str)> {
        issn.and_then(normalize_issn)
            .and_then(|i| self.by_issn.get(i.as_str()).copied())
            .map(|e| (e, "issn"))
            .or_else(|| {
                let k = journal_key(journal?);
                if k.is_empty() {
                    return None;
                }
                self.by_key
                    .get(&k)
                    .copied()
                    .flatten()
                    .map(|e| (e, "titulo"))
            })
    }
}

/// Estrato oficial de várias produções de uma vez: (id, ISSN, revista) → estrato.
pub fn estratos(
    conn: &Connection,
    itens: &[(i64, Option<String>, Option<String>)],
) -> HashMap<i64, String> {
    let Ok(entries) = load_entries(conn) else {
        return HashMap::new();
    };
    let idx = Index::new(&entries);
    itens
        .iter()
        .filter_map(|(id, issn, journal)| {
            idx.find(issn.as_deref(), journal.as_deref())
                .map(|(e, _)| (*id, e.estrato.clone()))
        })
        .collect()
}

/// Estrato oficial de uma revista (por um dos ISSNs ou pelo nome), se a tabela foi importada.
pub fn lookup(conn: &Connection, issns: &[String], journal: Option<&str>) -> Option<QualisEntry> {
    let entries = load_entries(conn).ok()?;
    let idx = Index::new(&entries);
    issns
        .iter()
        .find_map(|i| idx.find(Some(i), None))
        .or_else(|| idx.find(None, journal))
        .map(|(e, _)| e.clone())
}

/// Busca na tabela importada por ISSN ou por palavras do nome da revista.
pub fn search(conn: &Connection, query: &str, limit: usize) -> Result<Vec<QualisEntry>, String> {
    let entries = load_entries(conn)?;
    if let Some(issn) = normalize_issn(query) {
        return Ok(entries
            .into_iter()
            .filter(|e| e.issn.as_deref() == Some(issn.as_str()))
            .collect());
    }
    let words: Vec<String> = normalize_journal(query)
        .split_whitespace()
        .map(str::to_string)
        .collect();
    if words.is_empty() {
        return Ok(Vec::new());
    }
    let key = journal_key(query);
    let mut hits: Vec<(u8, QualisEntry)> = entries
        .into_iter()
        .filter_map(|e| {
            let n = normalize_journal(&e.titulo);
            if !words.iter().all(|w| n.contains(w.as_str())) {
                return None;
            }
            let k = journal_key(&e.titulo);
            let rank = if k == key {
                0
            } else if k.starts_with(&key) {
                1
            } else {
                2
            };
            Some((rank, e))
        })
        .collect();
    hits.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.titulo.cmp(&b.1.titulo)));
    Ok(hits.into_iter().take(limit).map(|(_, e)| e).collect())
}

/// Periódico da tabela com o número de artigos do banco que caem nele.
#[derive(Debug, Clone, Serialize)]
pub struct QualisRow {
    pub issn: Option<String>,
    pub titulo: String,
    pub estrato: String,
    pub area: Option<String>,
    pub artigos: usize,
}

/// Todos os periódicos da tabela importada, com a contagem de artigos do banco em cada um.
pub fn list(conn: &Connection) -> Result<Vec<QualisRow>, String> {
    let entries = load_entries(conn)?;
    let idx = Index::new(&entries);
    let mut counts: HashMap<*const QualisEntry, usize> = HashMap::new();
    for a in load_artigos(conn)? {
        if let Some((e, _)) = idx.find(a.issn.as_deref(), a.journal.as_deref()) {
            *counts.entry(e as *const _).or_default() += 1;
        }
    }
    Ok(entries
        .iter()
        .map(|e| QualisRow {
            issn: e.issn.clone(),
            titulo: e.titulo.clone(),
            estrato: e.estrato.clone(),
            area: e.area.clone(),
            artigos: counts.get(&(e as *const _)).copied().unwrap_or(0),
        })
        .collect())
}

// ---------------- Comparação com o banco ----------------

#[derive(Debug, Clone, Serialize)]
pub struct QualisMatch {
    pub id: i64,
    pub titulo: String,
    pub ano: Option<i64>,
    pub journal: Option<String>,
    pub issn: Option<String>,
    pub atual: Option<String>,
    pub oficial: String,
    /// "issn" ou "titulo": como o artigo foi encontrado na tabela.
    pub via: String,
    /// ISSN da tabela, gravado no artigo se ele ainda não tiver um.
    pub issn_tabela: Option<String>,
    /// Nome da revista como está na tabela da CAPES.
    pub titulo_tabela: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SemCorrespondencia {
    pub id: i64,
    pub titulo: String,
    pub ano: Option<i64>,
    pub journal: Option<String>,
    pub issn: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct QualisPreview {
    pub total_artigos: usize,
    pub itens: Vec<QualisMatch>,
    pub sem_correspondencia: Vec<SemCorrespondencia>,
    pub info: Option<QualisInfo>,
}

struct Artigo {
    id: i64,
    titulo: String,
    ano: Option<i64>,
    journal: Option<String>,
    issn: Option<String>,
    qualis: Option<String>,
}

fn load_artigos(conn: &Connection) -> Result<Vec<Artigo>, String> {
    let mut st = conn
        .prepare("SELECT id, titulo, ano, journal, issn, qualis, tipo FROM producoes")
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
                    qualis: r
                        .get::<_, Option<String>>(5)?
                        .filter(|s| !s.trim().is_empty()),
                },
                r.get::<_, Option<String>>(6)?.unwrap_or_default(),
            ))
        })
        .map_err(|e| e.to_string())?;
    Ok(rows
        .flatten()
        .filter(|(_, tipo)| tipo.trim().to_lowercase().starts_with("artigo"))
        .map(|(a, _)| a)
        .collect())
}

/// Compara os artigos do banco com a tabela `qualis_capes` importada.
pub fn preview(conn: &Connection) -> Result<QualisPreview, String> {
    let info =
        info(conn).ok_or("Importe a planilha do Qualis antes de comparar com os artigos.")?;
    let entries = load_entries(conn)?;
    let idx = Index::new(&entries);
    let artigos = load_artigos(conn)?;
    let mut out = QualisPreview {
        total_artigos: artigos.len(),
        info: Some(info),
        ..Default::default()
    };
    for a in artigos {
        match idx.find(a.issn.as_deref(), a.journal.as_deref()) {
            Some((e, via)) => out.itens.push(QualisMatch {
                id: a.id,
                titulo: a.titulo,
                ano: a.ano,
                journal: a.journal,
                issn: a.issn,
                atual: a.qualis,
                oficial: e.estrato.clone(),
                via: via.to_string(),
                issn_tabela: e.issn.clone(),
                titulo_tabela: e.titulo.clone(),
            }),
            None => out.sem_correspondencia.push(SemCorrespondencia {
                id: a.id,
                titulo: a.titulo,
                ano: a.ano,
                journal: a.journal,
                issn: a.issn,
            }),
        }
    }
    let key = |ano: Option<i64>| std::cmp::Reverse(ano);
    out.itens.sort_by_key(|m| key(m.ano));
    out.sem_correspondencia.sort_by_key(|m| key(m.ano));
    Ok(out)
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApplyItem {
    pub id: i64,
    pub qualis: String,
    /// ISSN da planilha: gravado só se o artigo ainda não tiver ISSN.
    pub issn: Option<String>,
}

#[derive(Debug, Default, Serialize)]
pub struct ApplyResult {
    pub ok: usize,
    pub erros: Vec<String>,
}

/// Grava os estratos confirmados (e o ISSN da planilha onde o artigo não tinha um).
pub fn apply(conn: &Connection, items: &[ApplyItem]) -> ApplyResult {
    let mut res = ApplyResult::default();
    for it in items {
        let Some(q) = normalize_estrato(&it.qualis) else {
            res.erros
                .push(format!("#{}: estrato inválido ({})", it.id, it.qualis));
            continue;
        };
        let issn = it.issn.as_deref().and_then(normalize_issn);
        match conn.execute(
            "UPDATE producoes SET qualis = ?1,
                 issn = CASE WHEN issn IS NULL OR TRIM(issn) = '' THEN ?2 ELSE issn END
             WHERE id = ?3",
            params![q, issn, it.id],
        ) {
            Ok(n) if n > 0 => res.ok += 1,
            Ok(_) => res
                .erros
                .push(format!("#{}: produção não encontrada", it.id)),
            Err(e) => res.erros.push(format!("#{}: {}", it.id, e)),
        }
    }
    res
}

// ---------------- ISSN pela OpenAlex ----------------

#[derive(Debug, Default, Serialize)]
pub struct IssnFill {
    /// Artigos com DOI e sem ISSN consultados.
    pub consultados: usize,
    pub preenchidos: usize,
    pub erros: Vec<String>,
}

/// Grava o ISSN da OpenAlex nas produções que ainda não têm. Devolve quantas foram preenchidas.
pub fn store_issn(
    conn: &Connection,
    rows: &[crate::academic::DbProdDoiRow],
    parsed: &HashMap<String, crate::academic::OpenAlexParsedWork>,
) -> usize {
    let mut n = 0;
    for r in rows {
        let Some(issn) = parsed
            .get(&r.doi.to_ascii_lowercase())
            .and_then(|w| w.issn.as_deref())
            .and_then(normalize_issn)
        else {
            continue;
        };
        if let Ok(k) = conn.execute(
            "UPDATE producoes SET issn = ?1 WHERE id = ?2 AND (issn IS NULL OR TRIM(issn) = '')",
            params![issn, r.id],
        ) {
            n += k;
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_issn_journal_and_estrato() {
        assert_eq!(normalize_issn("1234-567x").as_deref(), Some("1234-567X"));
        assert_eq!(normalize_issn(" 12345678 ").as_deref(), Some("1234-5678"));
        assert_eq!(normalize_issn("1234-56"), None);
        assert_eq!(normalize_issn("X234-5678"), None);
        assert_eq!(
            normalize_journal("Pesquisa Agropecuária Brasileira (Online)"),
            "pesquisa agropecuaria brasileira online"
        );
        assert_eq!(normalize_estrato(" a1 ").as_deref(), Some("A1"));
        assert_eq!(normalize_estrato("B5").as_deref(), Some("B5"));
        assert_eq!(normalize_estrato("C").as_deref(), Some("C"));
        assert_eq!(normalize_estrato("NP"), None);
        assert_eq!(normalize_estrato("Estrato"), None);
    }

    #[test]
    fn reads_csv_with_title_row_and_latin1() {
        // Planilha com uma linha de título antes do cabeçalho, separador ";" e Latin-1.
        let text = "Qualis Periódicos 2017-2020\nISSN;Título;Estrato\n1234-5678;Revista A;A1\n\"8765-4321\";\"Revista \"\"B\"\"\";b2\n0000-000;Sem ISSN válido;A3\n1111-2222;Revista C;NP\n";
        let mut bytes: Vec<u8> = Vec::new();
        for ch in text.chars() {
            bytes.push(if ch == 'í' { 0xED } else { ch as u8 });
        }
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("qualis.csv");
        std::fs::write(&p, &bytes).unwrap();
        let t = read_table(&p).unwrap();
        assert_eq!(t.colunas.issn, "ISSN");
        assert_eq!(t.colunas.titulo.as_deref(), Some("Título"));
        assert_eq!(t.colunas.estrato, "Estrato");
        assert!(t.areas.is_empty());
        // "Sem ISSN válido" fica pelo título; "NP" não é estrato
        assert_eq!(t.entries.len(), 3);
        assert_eq!(t.ignoradas, 1);
        assert_eq!(t.entries[1].titulo, "Revista \"B\"");
        assert_eq!(t.entries[1].estrato, "B2");
        assert_eq!(t.entries[2].issn, None);
    }

    #[test]
    fn reads_xlsx_with_area_column() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("qualis.xlsx");
        let sheet = crate::tools::Sheet {
            name: "Qualis".into(),
            title: None,
            columns: vec![
                "ISSN".into(),
                "TÍTULO".into(),
                "ÁREA DE AVALIAÇÃO".into(),
                "ESTRATO".into(),
            ],
            rows: vec![
                vec![
                    "1234-5678".into(),
                    "Revista A".into(),
                    "AGRONOMIA".into(),
                    "A1".into(),
                ],
                vec![
                    "1234-5678".into(),
                    "Revista A".into(),
                    "BIODIVERSIDADE".into(),
                    "B1".into(),
                ],
            ],
        };
        crate::tools::write_xlsx(&p, &[sheet]).unwrap();
        let t = read_table(&p).unwrap();
        assert_eq!(t.areas, vec!["AGRONOMIA", "BIODIVERSIDADE"]);
        assert_eq!(t.colunas.area.as_deref(), Some("ÁREA DE AVALIAÇÃO"));
        assert_eq!(t.entries.len(), 2);
    }

    #[test]
    fn rejects_files_without_qualis_columns() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("outra.csv");
        std::fs::write(&p, "Nome;Ano\nFulano;2020\n").unwrap();
        assert!(read_table(&p).unwrap_err().contains("ISSN e Estrato"));
    }

    fn table(entries: Vec<(&str, &str, &str, Option<&str>)>) -> QualisTable {
        let mut areas = BTreeSet::new();
        let entries = entries
            .into_iter()
            .map(|(issn, titulo, estrato, area)| {
                if let Some(a) = area {
                    areas.insert(a.to_string());
                }
                QualisEntry {
                    issn: normalize_issn(issn),
                    titulo: titulo.into(),
                    estrato: estrato.into(),
                    area: area.map(Into::into),
                }
            })
            .collect();
        QualisTable {
            entries,
            areas: areas.into_iter().collect(),
            ..Default::default()
        }
    }

    #[test]
    fn preview_matches_by_issn_then_journal_and_apply_fills_issn() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO producoes (id, ano, tipo, titulo, journal, issn, qualis) VALUES
              (1, 2024, 'Artigos completos', 'Por ISSN', 'Nome diferente', '12345678', 'B1'),
              (2, 2023, 'Artigos completos', 'Por nome', 'Pesquisa Agropecuária Brasileira', NULL, NULL),
              (3, 2022, 'Artigos aceitos', 'Sem revista na tabela', 'Revista X', NULL, NULL),
              (4, 2021, 'Livros', 'Livro não entra', 'Pesquisa Agropecuária Brasileira', NULL, NULL);
            "#,
        )
        .unwrap();
        let t = table(vec![
            ("1234-5678", "Revista A", "A1", None),
            ("0100-204X", "PESQUISA AGROPECUARIA BRASILEIRA", "A2", None),
        ]);
        assert!(
            preview(&conn).is_err(),
            "sem importação não há o que comparar"
        );
        store_table(&conn, &t, None, "qualis.xlsx").unwrap();
        let p = preview(&conn).unwrap();
        assert_eq!(p.total_artigos, 3);
        assert_eq!(p.itens.len(), 2);
        assert_eq!(
            (
                p.itens[0].id,
                p.itens[0].via.as_str(),
                p.itens[0].oficial.as_str(),
                p.itens[0].atual.as_deref()
            ),
            (1, "issn", "A1", Some("B1"))
        );
        assert_eq!(
            (
                p.itens[1].id,
                p.itens[1].via.as_str(),
                p.itens[1].oficial.as_str()
            ),
            (2, "titulo", "A2")
        );
        assert_eq!(p.sem_correspondencia.len(), 1);
        assert_eq!(p.sem_correspondencia[0].id, 3);

        let items: Vec<ApplyItem> = p
            .itens
            .iter()
            .map(|m| ApplyItem {
                id: m.id,
                qualis: m.oficial.clone(),
                issn: m.issn_tabela.clone(),
            })
            .collect();
        let r = apply(&conn, &items);
        assert_eq!(r.ok, 2, "{:?}", r.erros);
        let get = |id: i64| -> (String, Option<String>) {
            conn.query_row(
                "SELECT qualis, issn FROM producoes WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        };
        // o ISSN existente não é trocado; o que faltava vem da planilha
        assert_eq!(get(1), ("A1".into(), Some("12345678".into())));
        assert_eq!(get(2), ("A2".into(), Some("0100-204X".into())));
        assert!(!apply(
            &conn,
            &[ApplyItem {
                id: 2,
                qualis: "Z9".into(),
                issn: None
            }]
        )
        .erros
        .is_empty());
    }

    #[test]
    fn record_crud_keeps_normalized_issn() {
        use crate::db::queries;
        use serde_json::json;
        let conn = crate::db::open_in_memory().unwrap();
        let rec = queries::insert_record(
            &conn,
            "producoes",
            &json!({ "ano": 2024, "tipo": "Artigos completos", "titulo": "A", "issn": "0100204x" }),
            None,
            None,
        )
        .unwrap();
        assert_eq!(rec.issn.as_deref(), Some("0100-204X"));
        // edição sem o campo issn mantém o valor; com issn vazio, apaga
        let rec = queries::update_record(
            &conn,
            "producoes",
            rec.id,
            &json!({ "titulo": "B" }),
            None,
            None,
        )
        .unwrap();
        assert_eq!(rec.issn.as_deref(), Some("0100-204X"));
        let rec = queries::update_record(
            &conn,
            "producoes",
            rec.id,
            &json!({ "issn": "" }),
            None,
            None,
        )
        .unwrap();
        assert_eq!(rec.issn, None);
    }

    #[test]
    fn preview_requires_and_filters_area() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO producoes (id, ano, tipo, titulo, issn) VALUES (1, 2024, 'Artigos completos', 'X', '1234-5678')",
            [],
        )
        .unwrap();
        let t = table(vec![
            ("1234-5678", "Revista A", "A1", Some("AGRONOMIA")),
            ("1234-5678", "Revista A", "B2", Some("BIODIVERSIDADE")),
        ]);
        // sem área escolhida, só devolve as áreas e não grava nada
        let r = store_table(&conn, &t, None, "q.xlsx").unwrap();
        assert_eq!(r.areas.len(), 2);
        assert!(info(&conn).is_none());
        let r = store_table(&conn, &t, Some("BIODIVERSIDADE"), "q.xlsx").unwrap();
        assert_eq!(r.info.unwrap().entradas, 1);
        let p = preview(&conn).unwrap();
        assert_eq!(p.itens[0].oficial, "B2");
        let i = info(&conn).unwrap();
        assert_eq!((i.entradas, i.area.as_deref()), (1, Some("BIODIVERSIDADE")));
    }

    #[test]
    fn same_journal_gets_one_estrato_even_with_other_issn() {
        // Caso real: a planilha só tem o ISSN online (1435-0645, "AGRONOMY JOURNAL (ONLINE)"),
        // e os artigos têm o ISSN impresso (0002-1962) e Qualis antigos diferentes.
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO producoes (id, ano, tipo, titulo, journal, issn, qualis) VALUES
              (1, 2022, 'Artigos completos', 'P1', 'Agronomy Journal', '0002-1962', 'B5'),
              (2, 2019, 'Artigos completos', 'P2', 'Agronomy Journal', '0002-1962', 'SQ'),
              (3, 2016, 'Artigos completos', 'P3', 'AGRONOMY JOURNAL', NULL, 'A1'),
              (4, 2020, 'Artigos completos', 'P4', 'Agronomy', NULL, NULL),
              (5, 2020, 'Artigos completos', 'P5', 'Revista Ambígua', NULL, NULL);
            "#,
        )
        .unwrap();
        let t = table(vec![
            ("1435-0645", "AGRONOMY JOURNAL (ONLINE)", "A3", None),
            ("2073-4395", "AGRONOMY", "A2", None),
            (
                "1679-9275",
                "ACTA SCIENTIARUM. AGRONOMY (IMPRESSO)",
                "A4",
                None,
            ),
            (
                "1807-8621",
                "ACTA SCIENTIARUM. AGRONOMY (ONLINE)",
                "A4",
                None,
            ),
            ("1111-1111", "REVISTA AMBIGUA", "A1", None),
            ("2222-2222", "REVISTA AMBIGUA (ONLINE)", "C", None),
        ]);
        store_table(&conn, &t, None, "q.xlsx").unwrap();
        let p = preview(&conn).unwrap();
        let est = |id: i64| {
            p.itens
                .iter()
                .find(|m| m.id == id)
                .map(|m| m.oficial.clone())
        };
        assert_eq!(est(1).as_deref(), Some("A3"));
        assert_eq!(est(2).as_deref(), Some("A3"));
        assert_eq!(est(3).as_deref(), Some("A3"));
        assert_eq!(est(4).as_deref(), Some("A2"));
        // nomes iguais com estratos diferentes não são adivinhados
        assert_eq!(est(5), None);
        assert_eq!(
            lookup(&conn, &["0002-1962".into()], Some("Agronomy Journal"))
                .map(|e| e.estrato)
                .as_deref(),
            Some("A3")
        );
        let rows = list(&conn).unwrap();
        assert_eq!(rows.len(), 6);
        let n = |t: &str| rows.iter().find(|r| r.titulo == t).unwrap().artigos;
        assert_eq!(n("AGRONOMY JOURNAL (ONLINE)"), 3);
        assert_eq!(n("AGRONOMY"), 1);
        assert_eq!(n("REVISTA AMBIGUA"), 0);
        let s = search(&conn, "agronomy", 10).unwrap();
        assert_eq!(s[0].titulo, "AGRONOMY");
        assert_eq!(search(&conn, "14350645", 10).unwrap()[0].estrato, "A3");
        assert_eq!(
            journal_key("The Agronomy Journal (Online)"),
            "agronomy journal"
        );
    }
}
