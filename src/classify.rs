//! "Que comprovante é este?" — classifica um PDF/imagem na categoria e no tipo mais
//! prováveis, aprendendo com os comprovantes que o próprio usuário já vinculou.
//!
//! - Índice: texto (1ª–2ª página) de cada comprovante vinculado, guardado em `doc_index`
//!   e atualizado só quando o arquivo muda.
//! - Modelo: Naive Bayes multinomial sobre palavras (sem acentos, sem stopwords),
//!   com classes "categoria|tipo" + pistas fortes (DOI, INPI, portaria, banca…).
//! - Extração: ano, carga horária, aluno, título, evento/curso, disciplina.
//! - Registros existentes sem comprovante que combinam com o texto.

use crate::db::queries;
use crate::files::naming::fold;
use pdf_extract::Document;
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;

pub const SCHEMA_SQL: &str = "CREATE TABLE IF NOT EXISTS doc_index (path TEXT PRIMARY KEY, size INTEGER, mtime INTEGER, tokens TEXT NOT NULL DEFAULT '', chars INTEGER DEFAULT 0);";

const STOP: &[&str] = &[
    "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "has", "have", "been", "its", "not", "but", "can", "which", "into", "between", "por", "para", "com", "que", "uma", "dos", "das", "nos", "nas", "pelo", "pela", "pelos", "pelas", "como", "mais", "foi", "sao", "ser", "seu", "sua", "seus", "suas", "este", "esta", "isso", "entre", "sobre", "sem", "tem", "ate", "apos", "nao", "sim", "ele", "ela", "eles", "elas", "aos", "num", "numa", "www", "http", "https", "html", "pdf",
];

/// Texto → palavras normalizadas (minúsculas, sem acento, ≥3 letras, sem números).
pub fn tokens(text: &str) -> Vec<String> {
    let stop: &HashSet<&str> = {
        static S: OnceLock<HashSet<&'static str>> = OnceLock::new();
        S.get_or_init(|| STOP.iter().copied().collect())
    };
    let mut flat = String::with_capacity(text.len());
    for c in text.chars() {
        if let Some(f) = fold(c) {
            flat.push_str(f);
        } else if c.is_ascii_alphanumeric() {
            flat.push(c.to_ascii_lowercase());
        } else {
            flat.push(' ');
        }
    }
    flat.split_whitespace()
        .filter(|w| w.len() >= 3 && w.len() <= 24 && !w.chars().any(|c| c.is_ascii_digit()) && !stop.contains(w))
        .map(String::from)
        .collect()
}

fn folded(text: &str) -> String {
    tokens(text).join(" ")
}

/// Texto das 2 primeiras páginas de um PDF (vazio se digitalizado/ilegível).
pub fn pdf_text(path: &Path) -> String {
    let Ok(bytes) = std::fs::read(path) else { return String::new() };
    let Ok(mut doc) = Document::load_mem(&bytes) else { return String::new() };
    if doc.is_encrypted() {
        let _ = doc.decrypt("");
    }
    crate::metadata::first_pages_text(&doc, 2).join("\n")
}

/// Maior imagem JPEG da 1ª página de um PDF digitalizado (para OCR na interface).
pub fn scan_image(path: &Path) -> Option<Vec<u8>> {
    let bytes = std::fs::read(path).ok()?;
    let doc = Document::load_mem(&bytes).ok()?;
    let (_, page_id) = doc.get_pages().into_iter().next()?;
    let mut best: Option<Vec<u8>> = None;
    fn jpeg(obj: &pdf_extract::Object) -> Option<&Vec<u8>> {
        let stream = obj.as_stream().ok()?;
        let is_img = stream.dict.get(b"Subtype").ok().and_then(|s| s.as_name().ok()) == Some(b"Image".as_slice());
        let filt = stream.dict.get(b"Filter").ok().map(|f| match f {
            pdf_extract::Object::Name(n) => n.clone(),
            pdf_extract::Object::Array(a) => a.last().and_then(|x| x.as_name().ok()).map(|n| n.to_vec()).unwrap_or_default(),
            _ => vec![],
        });
        (is_img && filt.as_deref() == Some(b"DCTDecode".as_slice())).then_some(&stream.content)
    }
    let visit = |obj: &pdf_extract::Object, best: &mut Option<Vec<u8>>| {
        if let Some(c) = jpeg(obj) {
            if best.as_ref().map(|b| b.len() < c.len()).unwrap_or(true) {
                *best = Some(c.clone());
            }
        }
    };
    // recursos da página (XObject), inclusive formulários aninhados
    if let Ok((Some(res), _)) = doc.get_page_resources(page_id) {
        if let Ok(xo) = res.get(b"XObject").and_then(|x| match x {
            pdf_extract::Object::Reference(r) => doc.get_dictionary(*r),
            pdf_extract::Object::Dictionary(d) => Ok(d),
            _ => Err(lopdf_err()),
        }) {
            for (_, v) in xo.iter() {
                if let Ok(r) = v.as_reference() {
                    if let Ok(o) = doc.get_object(r) {
                        visit(o, &mut best);
                    }
                }
            }
        }
    }
    if best.is_none() {
        // fallback: qualquer JPEG do arquivo (scanners costumam gerar 1 por página)
        for o in doc.objects.values() {
            visit(o, &mut best);
        }
    }
    best.filter(|b| b.len() > 10_000)
}

/// Rotação da 1ª página (/Rotate, herdada da árvore de páginas), em graus.
pub fn page_rotation(path: &Path) -> i64 {
    let Ok(bytes) = std::fs::read(path) else { return 0 };
    let Ok(doc) = Document::load_mem(&bytes) else { return 0 };
    let Some((_, mut id)) = doc.get_pages().into_iter().next() else { return 0 };
    for _ in 0..16 {
        let Ok(d) = doc.get_dictionary(id) else { break };
        if let Ok(r) = d.get(b"Rotate").and_then(|r| r.as_i64()) {
            return ((r % 360) + 360) % 360;
        }
        match d.get(b"Parent").and_then(|p| p.as_reference()) {
            Ok(p) => id = p,
            Err(_) => break,
        }
    }
    0
}

fn lopdf_err() -> pdf_extract::Error {
    pdf_extract::Error::DictKey("XObject".into())
}

// ---------------- índice ----------------

#[derive(Debug, Clone)]
pub struct TrainDoc {
    pub category: String,
    pub tipo: String,
    pub path: String,
    pub record_text: String,
}

/// Comprovantes vinculados (1 por arquivo) com categoria e tipo.
pub fn training_docs(conn: &Connection, root: &Path) -> Vec<TrainDoc> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for cat in crate::tools::all_categories(conn) {
        let Ok(recs) = queries::get_records(conn, &cat, None, None, None) else { continue };
        for r in recs {
            let Some(p) = r.path.clone().filter(|p| !p.trim().is_empty()) else { continue };
            if !seen.insert(p.to_lowercase()) || !crate::files::rel_join(root, &p).is_file() {
                continue;
            }
            let rt = [&r.titulo, &r.descricao, &r.disciplina, &r.curso, &r.journal].iter().filter_map(|x| x.as_deref()).collect::<Vec<_>>().join(" ");
            out.push(TrainDoc { category: cat.clone(), tipo: r.tipo.clone().unwrap_or_else(|| "Sem tipo".into()), path: p, record_text: rt });
        }
    }
    out
}

fn file_sig(p: &Path) -> Option<(i64, i64)> {
    let m = std::fs::metadata(p).ok()?;
    let mtime = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64;
    Some((m.len() as i64, mtime))
}

/// Caminhos cujo texto ainda não está no índice (ou mudou).
pub fn stale_paths(conn: &Connection, root: &Path, docs: &[TrainDoc]) -> Vec<String> {
    docs.iter()
        .filter(|d| {
            let Some((size, mtime)) = file_sig(&crate::files::rel_join(root, &d.path)) else { return false };
            let cached: Option<(i64, i64)> = conn
                .query_row("SELECT size, mtime FROM doc_index WHERE path = ?1", [&d.path], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()
                .ok()
                .flatten();
            cached != Some((size, mtime))
        })
        .map(|d| d.path.clone())
        .collect()
}

/// Extrai o texto (sem travar o banco) — retorna (path, size, mtime, tokens, chars).
pub fn extract_for_index(root: &Path, paths: &[String]) -> Vec<(String, i64, i64, String, i64)> {
    paths
        .iter()
        .filter_map(|p| {
            let full = crate::files::rel_join(root, p);
            let (size, mtime) = file_sig(&full)?;
            let is_pdf = full.extension().map(|e| e.eq_ignore_ascii_case("pdf")).unwrap_or(false);
            let text = if is_pdf { std::panic::catch_unwind(|| pdf_text(&full)).unwrap_or_default() } else { String::new() };
            let t = tokens(&text);
            Some((p.clone(), size, mtime, t.join(" "), text.chars().count() as i64))
        })
        .collect()
}

pub fn store_index(conn: &Connection, rows: &[(String, i64, i64, String, i64)]) {
    for (p, s, m, t, c) in rows {
        let _ = conn.execute(
            "INSERT INTO doc_index (path, size, mtime, tokens, chars) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, tokens=excluded.tokens, chars=excluded.chars",
            params![p, s, m, t, c],
        );
    }
}

// ---------------- modelo ----------------

#[derive(Default)]
pub struct Model {
    /// classe "cat|tipo" → (nº de documentos, contagem por palavra, total de palavras)
    classes: HashMap<String, (usize, HashMap<String, usize>, usize)>,
    vocab: HashSet<String>,
    pub ndocs: usize,
}

pub fn class_key(cat: &str, tipo: &str) -> String {
    format!("{}|{}", cat, tipo)
}

impl Model {
    pub fn add(&mut self, key: &str, toks: &HashSet<String>, sign: i64) {
        let e = self.classes.entry(key.to_string()).or_default();
        e.0 = (e.0 as i64 + sign).max(0) as usize;
        for t in toks {
            let c = e.1.entry(t.clone()).or_default();
            *c = (*c as i64 + sign).max(0) as usize;
            e.2 = (e.2 as i64 + sign).max(0) as usize;
            if sign > 0 {
                self.vocab.insert(t.clone());
            }
        }
        self.ndocs = (self.ndocs as i64 + sign).max(0) as usize;
    }

    /// log-verossimilhança por classe (prior suavizado: classes pequenas não somem).
    pub fn scores(&self, toks: &HashSet<String>) -> Vec<(String, f64)> {
        let v = self.vocab.len().max(1) as f64;
        let known: Vec<&String> = toks.iter().filter(|t| self.vocab.contains(*t)).collect();
        let mut out: Vec<(String, f64)> = self
            .classes
            .iter()
            .filter(|(_, (n, _, _))| *n > 0)
            .map(|(k, (n, counts, total))| {
                let prior = ((*n as f64).sqrt()).ln();
                let denom = (*total as f64 + v).ln();
                let ll: f64 = known.iter().map(|t| ((*counts.get(*t).unwrap_or(&0) as f64) + 1.0).ln() - denom).sum();
                (k.clone(), prior + ll)
            })
            .collect();
        out.sort_by(|a, b| b.1.total_cmp(&a.1));
        out
    }
}

/// Palavras de treino de um documento: texto do PDF + texto do registro.
pub fn doc_tokens(index_tokens: &str, record_text: &str) -> HashSet<String> {
    let words: Vec<String> = index_tokens.split_whitespace().map(String::from).collect();
    with_bigrams(&words).into_iter().chain(tokens(record_text)).collect()
}

/// Palavras + pares vizinhos ("participou_congresso") — separam certificados parecidos.
pub fn with_bigrams(words: &[String]) -> HashSet<String> {
    let mut s: HashSet<String> = words.iter().cloned().collect();
    for w in words.windows(2) {
        s.insert(format!("{}_{}", w[0], w[1]));
    }
    s
}

pub fn build_model(conn: &Connection, docs: &[TrainDoc]) -> (Model, Vec<HashSet<String>>) {
    let mut m = Model::default();
    let mut all = Vec::new();
    for d in docs {
        let it: String = conn.query_row("SELECT tokens FROM doc_index WHERE path = ?1", [&d.path], |r| r.get(0)).unwrap_or_default();
        let toks = doc_tokens(&it, &d.record_text);
        m.add(&class_key(&d.category, &d.tipo), &toks, 1);
        all.push(toks);
    }
    (m, all)
}

/// Pistas fortes por categoria (somadas ao log-escore).
fn cues(f: &str, raw: &str) -> HashMap<&'static str, f64> {
    let mut b: HashMap<&'static str, f64> = HashMap::new();
    let has = |w: &str| f.contains(w);
    let mut add = |c: &'static str, v: f64| *b.entry(c).or_default() += v;
    if crate::metadata::find_doi(raw).is_some() || has("issn") || has("abstract") || has("keywords") || has("palavras chave") {
        add("producoes", 6.0);
    }
    if has("inpi") || has("programa computador") || has("patente") || has("registro software") {
        add("patentes", 8.0);
    }
    if has("portaria") || has("designar") || has("resolve") {
        add("encargos", 4.0);
    }
    if has("banca") && (has("examinadora") || has("avaliadora") || has("defesa") || has("membro")) {
        add("bancas", 5.0);
    }
    if (has("orientador") || has("orientacao") || has("orientou") || has("coorientador")) && !has("banca") {
        add("orientacoes", 3.0);
    }
    if has("certificamos") || has("certifico") || has("certificado") {
        if has("congresso") || has("simposio") || has("seminario") || has("encontro") || has("jornada") || has("evento") || has("reuniao") {
            add("eventos", 2.5);
        }
        if has("curso") || has("minicurso") || has("carga horaria") || has("capacitacao") {
            add("formacao", 2.5);
        }
    }
    if has("projeto") && (has("pesquisa") || has("extensao")) && (has("coordenador") || has("registro") || has("edital") || has("sigpex")) {
        add("projetos", 3.5);
    }
    if has("disciplina") && (has("turma") || has("semestre") || has("encargo didatico") || has("plano ensino")) {
        add("disciplinas", 3.5);
    }
    if has("diploma") || has("conferimos grau") || has("confere grau") || has("historico escolar") || (has("grau") && (has("mestre") || has("doutor") || has("bacharel") || has("engenheiro"))) {
        add("formacao", 6.0);
    }
    if has("regencia") || has("encargos didaticos") || (has("ministrou") && has("disciplina")) {
        add("disciplinas", 6.0);
    }
    if has("premio") || has("mencao honrosa") || has("homenagem") {
        add("dadosgerais", 2.0);
    }
    b
}

#[derive(Debug, Clone, Serialize)]
pub struct Suggestion {
    pub category: String,
    pub tipo: String,
    /// probabilidade relativa (0–1) entre as categorias
    pub prob: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Fields {
    pub ano: Option<i64>,
    pub horas: Option<i64>,
    pub aluno: Option<String>,
    pub titulo: Option<String>,
    pub descricao: Option<String>,
    pub disciplina: Option<String>,
    pub curso: Option<String>,
    pub doi: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecordMatch {
    pub category: String,
    pub id: i64,
    pub label: String,
    pub ano: Option<i64>,
    pub score: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Analysis {
    pub chars: usize,
    pub needs_ocr: bool,
    pub sugestoes: Vec<Suggestion>,
    pub campos: Fields,
    pub registros: Vec<RecordMatch>,
    pub treino: usize,
    pub nome_arquivo: String,
}

/// Classifica: categorias ordenadas, cada uma com o melhor tipo.
pub fn classify(model: &Model, text: &str, file_name: &str, valid: &HashSet<String>) -> Vec<Suggestion> {
    let f = folded(text);
    let mut toks: HashSet<String> = with_bigrams(&tokens(text));
    toks.extend(tokens(file_name));
    let scores = model.scores(&toks);
    let boosts = cues(&f, text);
    // melhor tipo por categoria + logsumexp da categoria
    let mut cats: HashMap<String, (f64, String, f64)> = HashMap::new(); // cat -> (best, tipo, lse)
    let lse_add = |a: f64, b: f64| if a == f64::NEG_INFINITY { b } else { a.max(b) + (1.0 + (-(a - b).abs()).exp()).ln() };
    for (k, s) in &scores {
        let (cat, tipo) = k.split_once('|').unwrap_or((k, ""));
        if !valid.contains(cat) {
            continue;
        }
        let e = cats.entry(cat.to_string()).or_insert((f64::NEG_INFINITY, String::new(), f64::NEG_INFINITY));
        if *s > e.0 {
            e.0 = *s;
            e.1 = tipo.to_string();
        }
        e.2 = lse_add(e.2, *s);
    }
    let mut v: Vec<(String, String, f64)> = cats.into_iter().map(|(c, (_, t, lse))| { let b = *boosts.get(c.as_str()).unwrap_or(&0.0); (c, t, lse + b) }).collect();
    v.sort_by(|a, b| b.2.total_cmp(&a.2));
    // probabilidades suavizadas (NB é confiante demais): temperatura proporcional ao nº de palavras
    let temp = (toks.len() as f64 / 25.0).clamp(1.0, 12.0);
    let max = v.first().map(|x| x.2).unwrap_or(0.0);
    let exps: Vec<f64> = v.iter().map(|x| ((x.2 - max) / temp).exp()).collect();
    let sum: f64 = exps.iter().sum::<f64>().max(1e-9);
    v.into_iter().zip(exps).map(|((c, t, _), e)| Suggestion { category: c, tipo: t, prob: e / sum }).collect()
}

// ---------------- vizinhos mais próximos (TF-IDF + cosseno) ----------------

/// Documentos de treino como vetores TF-IDF normalizados.
#[derive(Default)]
pub struct Knn {
    docs: Vec<(String, HashMap<String, f64>)>,
    idf: HashMap<String, f64>,
}

impl Knn {
    pub fn build(items: &[(String, HashSet<String>)]) -> Knn {
        let n = items.len().max(1) as f64;
        let mut df: HashMap<String, usize> = HashMap::new();
        for (_, t) in items {
            for w in t {
                *df.entry(w.clone()).or_default() += 1;
            }
        }
        let idf: HashMap<String, f64> = df.into_iter().map(|(w, d)| (w, ((n + 1.0) / (d as f64 + 1.0)).ln() + 1.0)).collect();
        let docs = items.iter().map(|(k, t)| (k.clone(), Self::vec(&idf, t))).collect();
        Knn { docs, idf }
    }

    fn vec(idf: &HashMap<String, f64>, t: &HashSet<String>) -> HashMap<String, f64> {
        let mut v: HashMap<String, f64> = t.iter().filter_map(|w| idf.get(w).map(|x| (w.clone(), *x))).collect();
        let norm = v.values().map(|x| x * x).sum::<f64>().sqrt().max(1e-9);
        v.values_mut().for_each(|x| *x /= norm);
        v
    }

    /// (classe, similaridade) dos k mais parecidos; `skip` ignora um índice (validação).
    pub fn neighbors(&self, t: &HashSet<String>, k: usize, skip: Option<usize>) -> Vec<(String, f64)> {
        let q = Self::vec(&self.idf, t);
        let mut sims: Vec<(usize, f64)> = self
            .docs
            .iter()
            .enumerate()
            .filter(|(i, _)| Some(*i) != skip)
            .map(|(i, (_, v))| {
                let (a, b) = if q.len() < v.len() { (&q, v) } else { (v, &q) };
                (i, a.iter().map(|(w, x)| x * b.get(w).unwrap_or(&0.0)).sum())
            })
            .collect();
        sims.sort_by(|a, b| b.1.total_cmp(&a.1));
        sims.into_iter().take(k).map(|(i, s)| (self.docs[i].0.clone(), s)).collect()
    }
}

/// Combina vizinhos (peso pela similaridade²) com as pistas fortes do texto.
pub fn classify_knn(knn: &Knn, text: &str, file_name: &str, valid: &HashSet<String>, skip: Option<usize>) -> Vec<Suggestion> {
    let mut toks = with_bigrams(&tokens(text));
    toks.extend(tokens(file_name));
    let boosts = cues(&folded(text), text);
    let nb = knn.neighbors(&toks, 9, skip);
    let mut cat: HashMap<String, f64> = HashMap::new();
    let mut tipo: HashMap<String, f64> = HashMap::new();
    for (k, s) in &nb {
        let (c, _) = k.split_once('|').unwrap_or((k, ""));
        if !valid.contains(c) {
            continue;
        }
        *cat.entry(c.to_string()).or_default() += s * s;
        *tipo.entry(k.clone()).or_default() += s * s;
    }
    for (c, b) in &boosts {
        if valid.contains(*c) {
            // pista forte vale como um vizinho "médio"
            *cat.entry(c.to_string()).or_default() += 0.03 * b;
        }
    }
    let total: f64 = cat.values().sum::<f64>().max(1e-9);
    let mut v: Vec<Suggestion> = cat
        .into_iter()
        .map(|(c, sc)| {
            let t = tipo
                .iter()
                .filter(|(k, _)| k.split_once('|').map(|x| x.0) == Some(c.as_str()))
                .max_by(|a, b| a.1.total_cmp(b.1))
                .and_then(|(k, _)| k.split_once('|').map(|x| x.1.to_string()))
                .unwrap_or_default();
            Suggestion { category: c, tipo: t, prob: sc / total }
        })
        .collect();
    v.sort_by(|a, b| b.prob.total_cmp(&a.prob));
    v
}

/// Sugestão final: 70% vizinhos mais próximos + 30% Naive Bayes (o tipo vem dos vizinhos).
pub fn suggest(model: &Model, knn: &Knn, text: &str, file_name: &str, valid: &HashSet<String>, skip: Option<usize>) -> Vec<Suggestion> {
    let r_nb = classify(model, text, file_name, valid);
    let r_knn = classify_knn(knn, text, file_name, valid, skip);
    let mut comb: HashMap<String, (f64, String)> = HashMap::new();
    for s in &r_nb {
        comb.entry(s.category.clone()).or_insert((0.0, s.tipo.clone())).0 += 0.3 * s.prob;
    }
    for s in &r_knn {
        let e = comb.entry(s.category.clone()).or_insert((0.0, s.tipo.clone()));
        e.0 += 0.7 * s.prob;
        e.1 = s.tipo.clone();
    }
    let mut v: Vec<Suggestion> = comb.into_iter().map(|(c, (p, t))| Suggestion { category: c, tipo: t, prob: p }).collect();
    v.sort_by(|a, b| b.prob.total_cmp(&a.prob));
    v
}

/// Modelo completo (NB + vizinhos) a partir do índice.
pub fn build_all(conn: &Connection, docs: &[TrainDoc]) -> (Model, Knn) {
    let (m, toks) = build_model(conn, docs);
    let items: Vec<(String, HashSet<String>)> = docs.iter().zip(toks).map(|(d, t)| (class_key(&d.category, &d.tipo), t)).collect();
    (m, Knn::build(&items))
}

// ---------------- extração de campos ----------------

fn re(p: &str) -> Regex {
    Regex::new(p).unwrap()
}

fn title_case(s: &str) -> String {
    let small = ["da", "de", "do", "das", "dos", "e"];
    s.split_whitespace()
        .enumerate()
        .map(|(i, w)| {
            let l = w.to_lowercase();
            if i > 0 && small.contains(&l.as_str()) {
                l
            } else {
                let mut c = l.chars();
                c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn clean_phrase(s: &str) -> String {
    let t = s.split_whitespace().collect::<Vec<_>>().join(" ");
    t.trim_matches(|c: char| c == ',' || c == '.' || c == ';' || c == ':' || c == '"' || c == '“' || c == '”' || c == '\'' || c == ' ').to_string()
}

pub fn extract_fields(text: &str) -> Fields {
    static R: OnceLock<Vec<Regex>> = OnceLock::new();
    let r = R.get_or_init(|| {
        vec![
            // 0 datas por extenso / numéricas
            re(r"(?i)\b\d{1,2}\s+de\s+(?:janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+((?:19|20)\d\d)\b|\b\d{1,2}/\d{1,2}/((?:19|20)\d\d)\b"),
            // 1 carga horária
            re(r"(?i)carga\s+hor[áa]ria[^0-9]{0,40}(\d{1,4})\s*(?:h\b|horas|hrs)|\b(\d{1,4})\s*(?:\(\s*[a-zçãéêíóú\s-]+\)\s*)?horas?\b"),
            // 2 aluno / candidato
            re(r"(?i)(?:\b(?:d[oa]s?|pel[oa])\s+)?(?:alun[oa]|discente|acad[êe]mic[oa]|estudante|candidat[oa]|mestrand[oa]|doutorand[oa]|bolsista|orientand[oa]|graduand[oa])\s*(?:\(a\))?\s*:?\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÀ-ÿ'´`-]+(?:\s+(?:d[aeo]s?\s+|e\s+)?[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÀ-ÿ'´`-]+){1,6})"),
            // 3 título entre aspas
            re(r#"[“"«]([^”"»\n]{12,300})[”"»]"#),
            // 4 título após "intitulado"
            re(r"(?i)(?:intitulad[oa]|com\s+o\s+t[íi]tulo|sob\s+o\s+t[íi]tulo|t[íi]tulo(?:\s+do\s+trabalho)?\s*:)\s*:?\s*([^\n]{12,250})"),
            // 5 eventos / cursos
            re(r"(?:\b\d{1,2}\s*[ºª°]?\s+|\b[IVXLC]{1,6}\s+)?(?:Congresso|CONGRESSO|Simp[óo]sio|SIMP[ÓO]SIO|Semin[áa]rio|SEMIN[ÁA]RIO|Workshop|WORKSHOP|Jornada|JORNADA|Encontro|ENCONTRO|Semana|SEMANA|Reuni[ãa]o|REUNI[ÃA]O|Minicurso|MINICURSO|Curso|CURSO|Confer[êe]ncia|CONFER[ÊE]NCIA|Mostra|MOSTRA|F[óo]rum|F[ÓO]RUM|Col[óo]quio|COL[ÓO]QUIO|Meeting|Symposium|Conference)\b[^\n.;]{4,140}"),
            // 6 disciplina
            re(r#"(?i)disciplina\s*(?:de\s+)?:?\s*[“"]?([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^\n“”"]{3,90})"#),
            // 7 curso de graduação/pós
            re(r"(?i)curso\s+de\s+((?:gradua[çc][ãa]o|p[óo]s-gradua[çc][ãa]o|mestrado|doutorado)\s+em\s+[A-ZÁÉÍÓÚ][\wÀ-ÿ ]{3,60}|[A-ZÁÉÍÓÚ][\wÀ-ÿ]+(?:\s+[A-ZÁÉÍÓÚ][\wÀ-ÿ]+){0,3})"),
        ]
    });
    let mut f = Fields { doi: crate::metadata::find_doi(text), ..Default::default() };
    let max_year = chrono::Local::now().format("%Y").to_string().parse::<i64>().unwrap_or(2100) + 1;
    let years: Vec<i64> = r[0].captures_iter(text).filter_map(|c| c.get(1).or(c.get(2))).filter_map(|m| m.as_str().parse().ok()).filter(|y| *y <= max_year).collect();
    // data do documento costuma ser a última citada (local e data, assinatura)
    f.ano = years.iter().max().copied().or_else(|| crate::metadata::guess_year(text));
    f.horas = r[1].captures_iter(text).filter_map(|c| c.get(1).or(c.get(2))).filter_map(|m| m.as_str().parse::<i64>().ok()).find(|h| (1..=2000).contains(h));
    f.aluno = r[2].captures(text).map(|c| {
        let n = clean_phrase(&c[1]);
        if n == n.to_uppercase() { title_case(&n) } else { n }
    });
    let titulo = r[3]
        .captures_iter(text)
        .map(|c| clean_phrase(&c[1]))
        .find(|t| t.split_whitespace().count() >= 3)
        .or_else(|| r[4].captures(text).map(|c| clean_phrase(c[1].split([',', '.']).next().unwrap_or(&c[1]))));
    f.titulo = titulo.filter(|t| t.len() >= 12);
    f.descricao = r[5].find(text).map(|m| clean_phrase(m.as_str())).filter(|s| s.len() >= 10);
    f.disciplina = r[6].captures(text).map(|c| clean_phrase(&c[1]));
    f.curso = r[7].captures(text).map(|c| clean_phrase(&c[1])).filter(|s| s.len() >= 4);
    f
}

// ---------------- registros existentes ----------------

/// Registros SEM comprovante cujo texto aparece no documento (título, aluno, descrição).
pub fn match_records(conn: &Connection, text: &str, cats: &[String]) -> Vec<RecordMatch> {
    let doc: HashSet<String> = tokens(text).into_iter().collect();
    if doc.len() < 5 {
        return vec![];
    }
    let mut out = Vec::new();
    for cat in cats {
        let Ok(recs) = queries::get_records(conn, cat, None, None, None) else { continue };
        for r in recs.into_iter().filter(|r| r.path.as_deref().map(|p| p.trim().is_empty()).unwrap_or(true)) {
            let main = [&r.titulo, &r.descricao, &r.disciplina].iter().filter_map(|x| x.as_deref()).collect::<Vec<_>>().join(" ");
            let mt: Vec<String> = tokens(&main).into_iter().filter(|t| t.len() >= 4).collect();
            if mt.len() < 2 {
                continue;
            }
            let hit = mt.iter().filter(|t| doc.contains(*t)).count() as f64 / mt.len() as f64;
            let aluno_ok = r.aluno.as_deref().map(|a| {
                let at: Vec<String> = tokens(a);
                !at.is_empty() && at.iter().all(|t| doc.contains(t))
            });
            let score = match aluno_ok {
                Some(true) => (hit * 0.7 + 0.3).min(1.0),
                Some(false) => hit * 0.7,
                None => hit,
            };
            if score >= 0.6 {
                let label = [r.aluno.clone(), r.titulo.clone().or(r.descricao.clone()).or(r.disciplina.clone())].into_iter().flatten().collect::<Vec<_>>().join(" — ");
                out.push(RecordMatch { category: cat.clone(), id: r.id, label, ano: r.ano, score });
            }
        }
    }
    out.sort_by(|a, b| b.score.total_cmp(&a.score));
    out.truncate(5);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Acurácia "deixa um de fora" nos comprovantes reais: LATTES_REAL=1 cargo test --lib loocv -- --nocapture
    #[test]
    fn loocv_on_real_data_if_enabled() {
        if std::env::var("LATTES_REAL").is_err() {
            return;
        }
        let root = Path::new(r"d:\Desktop\UFSC\lattes");
        let conn = rusqlite::Connection::open_with_flags(root.join("lattes.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let docs = training_docs(&conn, root);
        let paths: Vec<String> = docs.iter().map(|d| d.path.clone()).collect();
        let t0 = std::time::Instant::now();
        let rows = extract_for_index(root, &paths);
        println!("{} docs, texto extraído em {:?}", docs.len(), t0.elapsed());
        let idx: HashMap<String, (String, i64)> = rows.into_iter().map(|(p, _, _, t, c)| (p, (t, c))).collect();
        let mut m = Model::default();
        let toks: Vec<HashSet<String>> = docs.iter().map(|d| doc_tokens(&idx.get(&d.path).map(|x| x.0.clone()).unwrap_or_default(), &d.record_text)).collect();
        for (d, t) in docs.iter().zip(&toks) {
            m.add(&class_key(&d.category, &d.tipo), t, 1);
        }
        let valid: HashSet<String> = crate::tools::all_categories(&conn).into_iter().collect();
        let items: Vec<(String, HashSet<String>)> = docs.iter().zip(&toks).map(|(d, t)| (class_key(&d.category, &d.tipo), t.clone())).collect();
        let knn = Knn::build(&items);
        let mut stats: HashMap<&str, (usize, usize, usize)> = HashMap::new();
        let mut errs: HashMap<String, usize> = HashMap::new();
        let mut n = 0;
        for (i, (d, t)) in docs.iter().zip(&toks).enumerate() {
            let (text_toks, chars) = idx.get(&d.path).cloned().unwrap_or_default();
            if chars < 60 {
                continue; // digitalizado: na prática passa por OCR
            }
            n += 1;
            let key = class_key(&d.category, &d.tipo);
            m.add(&key, t, -1);
            let r_nb = classify(&m, &text_toks, "", &valid);
            m.add(&key, t, 1);
            let r_knn = classify_knn(&knn, &text_toks, "", &valid, Some(i));
            m.add(&key, t, -1);
            let r_comb = suggest(&m, &knn, &text_toks, "", &valid, Some(i));
            m.add(&key, t, 1);
            for (name, r) in [("nb", &r_nb), ("knn", &r_knn), ("comb", &r_comb)] {
                let e = stats.entry(name).or_default();
                if r.first().map(|s| s.category == d.category).unwrap_or(false) {
                    e.0 += 1;
                    if r[0].tipo == d.tipo { e.2 += 1; }
                } else if name == "knn" {
                    *errs.entry(format!("{} -> {}", d.category, r.first().map(|s| s.category.as_str()).unwrap_or("?"))).or_default() += 1;
                }
                if r.iter().take(2).any(|s| s.category == d.category) { e.1 += 1; }
            }
        }
        for (name, (c, t2, ct)) in &stats {
            println!("{:>5}: com texto {} | categoria {:.1}% | top2 {:.1}% | categoria+tipo {:.1}%", name, n, 100.0 * *c as f64 / n as f64, 100.0 * *t2 as f64 / n as f64, 100.0 * *ct as f64 / n as f64);
        }
        let mut e: Vec<_> = errs.into_iter().collect();
        e.sort_by(|a, b| b.1.cmp(&a.1));
        println!("erros mais comuns: {:?}", &e[..e.len().min(8)]);
    }

    #[test]
    fn extracts_fields_from_certificates() {
        let t = "CERTIFICADO\nCertificamos que Tiago Olivoto participou como membro da banca examinadora do Trabalho de Conclusão de Curso intitulado “Seleção genômica em milho tropical” do aluno JOÃO DA SILVA SANTOS, realizada em 12 de março de 2024. Florianópolis, 15 de março de 2024.";
        let f = extract_fields(t);
        assert_eq!(f.ano, Some(2024));
        assert_eq!(f.aluno.as_deref(), Some("João da Silva Santos"));
        assert_eq!(f.titulo.as_deref(), Some("Seleção genômica em milho tropical"));
        let t2 = "Certificamos que Tiago Olivoto participou do 13º Congresso Brasileiro de Melhoramento de Plantas, realizado em Gramado, com carga horária de 20 horas.";
        let f2 = extract_fields(t2);
        assert_eq!(f2.horas, Some(20));
        assert!(f2.descricao.unwrap().starts_with("13º Congresso Brasileiro de Melhoramento de Plantas"));
    }

    #[test]
    fn naive_bayes_learns() {
        let mut m = Model::default();
        let s = |x: &str| -> HashSet<String> { tokens(x).into_iter().collect() };
        m.add("bancas|Mestrado", &s("banca examinadora defesa dissertação mestrado membro"), 1);
        m.add("eventos|Participação", &s("certificamos participou congresso brasileiro ouvinte"), 1);
        m.add("formacao|Curso", &s("certificamos concluiu curso carga horária minicurso"), 1);
        let valid: HashSet<String> = ["bancas", "eventos", "formacao"].iter().map(|x| x.to_string()).collect();
        let r = classify(&m, "Certificamos que participou do congresso como ouvinte", "x.pdf", &valid);
        assert_eq!(r[0].category, "eventos");
        let r = classify(&m, "Participou da banca examinadora de defesa de dissertação", "", &valid);
        assert_eq!(r[0].category, "bancas");
    }
}

#[cfg(test)]
mod scan_real {
    /// LATTES_REAL=1 cargo test --lib scan_images -- --nocapture
    #[test]
    fn scan_images_if_enabled() {
        let Ok(out) = std::env::var("LATTES_SCAN_OUT") else { return };
        let root = std::path::Path::new("d:/Desktop/UFSC/lattes");
        let conn = rusqlite::Connection::open_with_flags(root.join("lattes.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let docs = super::training_docs(&conn, root);
        let (mut scanned, mut with_img, mut n) = (0, 0, 0);
        let mut list = String::new();
        for d in &docs {
            let full = crate::files::rel_join(root, &d.path);
            if !full.extension().map(|e| e.eq_ignore_ascii_case("pdf")).unwrap_or(false) { continue; }
            let t = std::panic::catch_unwind(|| super::pdf_text(&full)).unwrap_or_default();
            if t.chars().filter(|c| c.is_alphabetic()).count() >= 60 { continue; }
            scanned += 1;
            if let Some(img) = super::scan_image(&full) {
                with_img += 1;
                if n < 12 {
                    std::fs::write(format!("{}/scan_{}.jpg", out, n), &img).unwrap();
                    list.push_str(&format!("scan_{}.jpg\t{}\t{}\n", n, d.category, d.tipo));
                    n += 1;
                }
            }
        }
        std::fs::write(format!("{}/scan_list.tsv", out), list).unwrap();
        println!("digitalizados: {} | com imagem JPEG: {}", scanned, with_img);
    }
}

#[cfg(test)]
mod ocr_real {
    use super::*;
    /// Classifica os textos de OCR salvos em LATTES_SCAN_OUT/ocr.json
    #[test]
    fn classify_ocr_texts_if_enabled() {
        let Ok(dir) = std::env::var("LATTES_SCAN_OUT") else { return };
        let Ok(raw) = std::fs::read_to_string(format!("{}/ocr.json", dir)) else { return };
        let ocr: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let list = std::fs::read_to_string(format!("{}/scan_list.tsv", dir)).unwrap();
        let root = Path::new("d:/Desktop/UFSC/lattes");
        let conn = Connection::open_with_flags(root.join("lattes.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let docs = training_docs(&conn, root);
        let paths: Vec<String> = docs.iter().map(|d| d.path.clone()).collect();
        let idx: HashMap<String, String> = extract_for_index(root, &paths).into_iter().map(|(p, _, _, t, _)| (p, t)).collect();
        let mut m = Model::default();
        let mut items = Vec::new();
        for d in &docs {
            let t = doc_tokens(idx.get(&d.path).map(|s| s.as_str()).unwrap_or(""), &d.record_text);
            m.add(&class_key(&d.category, &d.tipo), &t, 1);
            items.push((class_key(&d.category, &d.tipo), t));
        }
        let knn = Knn::build(&items);
        let valid: HashSet<String> = crate::tools::all_categories(&conn).into_iter().collect();
        let mut ok = 0;
        let lines: Vec<&str> = list.lines().collect();
        for l in &lines {
            let c: Vec<&str> = l.split('\t').collect();
            let text = ocr[c[0]]["text"].as_str().unwrap_or("");
            let r = suggest(&m, &knn, text, "", &valid, None);
            let f = extract_fields(text);
            if r[0].category == c[1] { ok += 1; }
            println!("{} esperado {}/{} -> {}/{} ({:.0}%) | ano={:?} horas={:?} desc={:?}", c[0], c[1], c[2], r[0].category, r[0].tipo, r[0].prob * 100.0, f.ano, f.horas, f.descricao.map(|s| s.chars().take(50).collect::<String>()));
        }
        println!("OCR: {}/{} categorias certas", ok, lines.len());
    }
}
