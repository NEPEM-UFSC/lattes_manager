//! Importador do XML exportado pela Plataforma Lattes (CNPq).
//! Extrai produções (bibliográficas e técnicas) e as mapeia para a tabela `producoes`.

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct XmlProduction {
    pub tipo: String,
    pub folder: String,
    pub ano: Option<i64>,
    pub titulo: String,
    pub journal: Option<String>,
    pub doi: Option<String>,
    pub origem: String,
    pub duplicate: bool,
}

/// (elemento XML, tipo no app, pasta padrão)
const KINDS: &[(&str, &str, &str)] = &[
    ("ARTIGO-PUBLICADO", "Artigos completos", "5_producoes\\artigos_completos\\"),
    ("ARTIGO-ACEITO-PARA-PUBLICACAO", "Artigos aceitos", "5_producoes\\artigos_aceitos\\"),
    ("TRABALHO-EM-EVENTOS", "Resumos simples", "5_producoes\\resumos_simples\\"),
    ("LIVRO-PUBLICADO-OU-ORGANIZADO", "Livros", "5_producoes\\livros\\"),
    ("CAPITULO-DE-LIVRO-PUBLICADO", "Capítulos de livros", "5_producoes\\capítulos\\"),
    ("TEXTO-EM-JORNAL-OU-REVISTA", "Textos em jornais/revistas", "5_producoes\\textos_jornais\\"),
    ("APRESENTACAO-DE-TRABALHO", "Trabalhos/palestras", "5_producoes\\trabalho_palestra\\"),
    ("CURSO-DE-CURTA-DURACAO-MINISTRADO", "Cursos", "5_producoes\\cursos_ministrados\\"),
    ("DESENVOLVIMENTO-DE-MATERIAL-DIDATICO-OU-INSTRUCIONAL", "Material didático", "5_producoes\\material_didatico\\"),
    ("PROGRAMA-DE-RADIO-OU-TV", "Programas de rádio/TV", "5_producoes\\radio_tv\\"),
    ("MIDIA-SOCIAL-WEBSITE-BLOG", "Mídias sociais/blog", "5_producoes\\midias_sociais\\"),
];

const JOURNAL_KEYS: &[&str] = &[
    "TITULO-DO-PERIODICO-OU-REVISTA",
    "NOME-DO-EVENTO",
    "TITULO-DO-LIVRO",
    "TITULO-DO-JORNAL-OU-REVISTA",
    "NOME-DA-EDITORA",
    "INSTITUICAO-PROMOTORA",
    "INSTITUICAO-PROMOTORA-DO-CURSO",
    "EMISSORA",
    "NOME-DO-EVENTO-INGLES",
];

/// Normaliza título para comparação de duplicatas (minúsculo, apenas alfanuméricos sem acento).
pub fn normalize_title(s: &str) -> String {
    s.chars()
        .flat_map(|c| c.to_lowercase())
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            other => other,
        })
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// Remove marcação HTML (<i>, </sup>…) e entidades numéricas (&#146;) que o Lattes deixa nos títulos.
pub fn clean_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '<' => {
                // descarta a tag inteira
                for d in chars.by_ref() {
                    if d == '>' {
                        break;
                    }
                }
            }
            '&' if chars.peek() == Some(&'#') => {
                chars.next();
                let mut num = String::new();
                while let Some(&d) = chars.peek() {
                    if d.is_ascii_alphanumeric() && num.len() < 8 {
                        num.push(d);
                        chars.next();
                    } else {
                        break;
                    }
                }
                if chars.peek() == Some(&';') {
                    chars.next();
                }
                let code = match num.strip_prefix(['x', 'X']) {
                    Some(h) => u32::from_str_radix(h, 16).ok(),
                    None => num.parse().ok(),
                };
                // 128–159: faixa Windows-1252 usada por engano
                let ch = match code {
                    Some(145) | Some(146) => Some('\u{2019}'),
                    Some(147) | Some(148) => Some('"'),
                    Some(150) | Some(151) => Some('\u{2013}'),
                    Some(n) => char::from_u32(n),
                    None => None,
                };
                if let Some(ch) = ch {
                    out.push(ch);
                }
            }
            _ => out.push(c),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode_bytes(bytes: &[u8]) -> String {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(200)]).to_uppercase();
    if head.contains("UTF-8") {
        if let Ok(s) = std::str::from_utf8(bytes) {
            return s.trim_start_matches('\u{feff}').to_string();
        }
    }
    // ISO-8859-1: cada byte corresponde ao code point U+00XX
    bytes.iter().map(|&b| b as char).collect()
}

fn attrs_of(e: &BytesStart) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for a in e.attributes().flatten() {
        let k = String::from_utf8_lossy(a.key.as_ref()).to_string();
        let rawv = String::from_utf8_lossy(&a.value).to_string();
        let v = quick_xml::escape::unescape(&rawv)
            .map(|c| c.to_string())
            .unwrap_or(rawv.clone());
        m.insert(k, v.trim().to_string());
    }
    m
}

struct Builder {
    kind_idx: usize,
    basic: HashMap<String, String>,
    detail: HashMap<String, String>,
}

impl Builder {
    fn finish(self) -> Option<XmlProduction> {
        let (elem, mut tipo, mut folder) = KINDS[self.kind_idx];
        let titulo = self
            .basic
            .iter()
            .filter(|(k, v)| k.starts_with("TITULO") && !k.contains("INGLES") && !v.is_empty())
            .map(|(_, v)| v.clone())
            .next()?;
        let ano = self
            .basic
            .iter()
            .filter(|(k, _)| k.starts_with("ANO"))
            .filter_map(|(_, v)| v.parse::<i64>().ok())
            .next();
        if elem == "TRABALHO-EM-EVENTOS" {
            match self.basic.get("NATUREZA").map(|s| s.as_str()) {
                Some("COMPLETO") => {
                    tipo = "Resumos completos";
                    folder = "5_producoes\\resumos_completos\\";
                }
                Some("RESUMO_EXPANDIDO") => {
                    tipo = "Resumos expandidos";
                    folder = "5_producoes\\resumos_expandidos\\";
                }
                _ => {}
            }
        }
        let journal = JOURNAL_KEYS
            .iter()
            .filter_map(|k| self.detail.get(*k).or_else(|| self.basic.get(*k)))
            .find(|v| !v.is_empty())
            .cloned();
        let doi = self.basic.get("DOI").filter(|d| !d.is_empty()).cloned();
        Some(XmlProduction {
            tipo: tipo.to_string(),
            folder: folder.to_string(),
            ano,
            titulo: clean_text(&titulo),
            journal: journal.map(|j| clean_text(&j)),
            doi,
            origem: elem.to_string(),
            duplicate: false,
        })
    }
}

/// Faz o parse do XML Lattes e retorna as produções encontradas (sem marcar duplicatas).
pub fn parse_lattes_xml(path: &Path) -> Result<Vec<XmlProduction>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Falha ao ler '{}': {}", path.display(), e))?;
    let text = decode_bytes(&bytes);
    if !text.contains("CURRICULO-VITAE") {
        return Err("O arquivo não parece ser um XML do Currículo Lattes (CURRICULO-VITAE ausente)".into());
    }
    let mut reader = Reader::from_str(&text);
    let mut current: Option<Builder> = None;
    let mut out = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if let Some(b) = current.as_mut() {
                    if name.starts_with("DADOS-BASICOS") {
                        b.basic.extend(attrs_of(&e));
                    } else if name.starts_with("DETALHAMENTO") {
                        b.detail.extend(attrs_of(&e));
                    }
                } else if let Some(idx) = KINDS.iter().position(|(k, _, _)| *k == name) {
                    current = Some(Builder { kind_idx: idx, basic: HashMap::new(), detail: HashMap::new() });
                }
            }
            Ok(Event::End(e)) => {
                if let Some(b) = current.as_ref() {
                    if e.name().as_ref() == KINDS[b.kind_idx].0.as_bytes() {
                        if let Some(p) = current.take().and_then(Builder::finish) {
                            out.push(p);
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML inválido na posição {}: {}", reader.buffer_position(), e)),
            _ => {}
        }
    }
    Ok(out)
}

/// Dados de identificação do currículo (para capa do relatório de comprovantes).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct LattesProfile {
    pub nome: String,
    pub nome_citacoes: String,
    pub lattes_id: String,
    pub lattes_url: String,
    pub orcid: String,
    pub atualizacao: String,
    pub resumo: String,
    // dados pessoais e de contato (opcionais no comprovante)
    pub email: String,
    pub email_alt: String,
    pub telefone: String,
    pub website: String,
    pub instituicao: String,
    pub unidade: String,
    pub orgao: String,
    pub endereco: String,
    pub area: String,
    pub nacionalidade: String,
    pub naturalidade: String,
    pub data_nascimento: String,
    pub cpf: String,
    pub rg: String,
}

fn fmt_ddmmyyyy(s: &str) -> String {
    if s.len() == 8 && s.chars().all(|c| c.is_ascii_digit()) {
        format!("{}/{}/{}", &s[0..2], &s[2..4], &s[4..8])
    } else {
        s.to_string()
    }
}

/// Lê nome, ID, ORCID, data de atualização e resumo do CV do XML Lattes.
pub fn parse_profile(path: &Path) -> Result<LattesProfile, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Falha ao ler '{}': {}", path.display(), e))?;
    let text = decode_bytes(&bytes);
    let mut reader = Reader::from_str(&text);
    let mut p = LattesProfile::default();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let a = attrs_of(&e);
                match name.as_str() {
                    "CURRICULO-VITAE" => {
                        p.lattes_id = a.get("NUMERO-IDENTIFICADOR").cloned().unwrap_or_default();
                        p.atualizacao = fmt_ddmmyyyy(a.get("DATA-ATUALIZACAO").map(|s| s.as_str()).unwrap_or(""));
                    }
                    "DADOS-GERAIS" => {
                        let g = |k: &str| a.get(k).cloned().unwrap_or_default();
                        p.nome = g("NOME-COMPLETO");
                        p.nome_citacoes = g("NOME-EM-CITACOES-BIBLIOGRAFICAS");
                        p.nacionalidade = g("PAIS-DE-NACIONALIDADE");
                        let (cid, uf) = (g("CIDADE-NASCIMENTO"), g("UF-NASCIMENTO"));
                        p.naturalidade = [cid, uf].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" – ");
                        p.data_nascimento = fmt_ddmmyyyy(&g("DATA-NASCIMENTO"));
                        let cpf = g("CPF");
                        p.cpf = if cpf.len() == 11 && cpf.chars().all(|c| c.is_ascii_digit()) {
                            format!("{}.{}.{}-{}", &cpf[0..3], &cpf[3..6], &cpf[6..9], &cpf[9..])
                        } else {
                            cpf
                        };
                        let rg = g("NUMERO-IDENTIDADE");
                        let org = [g("ORGAO-EMISSOR"), g("UF-ORGAO-EMISSOR")].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("/");
                        p.rg = if rg.is_empty() { rg } else if org.is_empty() { rg } else { format!("{} {}", rg, org) };
                    }
                    "ENDERECO-PROFISSIONAL" if p.instituicao.is_empty() => {
                        let g = |k: &str| a.get(k).cloned().unwrap_or_default();
                        p.instituicao = g("NOME-INSTITUICAO-EMPRESA");
                        p.orgao = g("NOME-ORGAO");
                        p.unidade = g("NOME-UNIDADE");
                        p.email = g("E-MAIL");
                        p.website = g("HOME-PAGE");
                        let tel = g("TELEFONE");
                        if !tel.is_empty() {
                            let ddd = g("DDD");
                            p.telefone = if ddd.is_empty() { tel } else { format!("({}) {}", ddd, tel) };
                        }
                        let cep = g("CEP");
                        let cep = if cep.len() == 8 { format!("{}-{}", &cep[..5], &cep[5..]) } else { cep };
                        let cidade = [g("CIDADE"), g("UF")].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("/");
                        p.endereco = [g("LOGRADOURO-COMPLEMENTO"), g("BAIRRO"), cidade, if cep.is_empty() { cep } else { format!("CEP {}", cep) }]
                            .into_iter()
                            .filter(|s| !s.is_empty())
                            .collect::<Vec<_>>()
                            .join(", ");
                    }
                    "ENDERECO" => {
                        // "I: inst@ufsc.br; R: pessoal@gmail.com"
                        if let Some(el) = a.get("ELETRONICO") {
                            let mails: Vec<String> = el
                                .split(';')
                                .filter_map(|x| x.split_once(':').map(|(_, m)| m.trim().to_string()).or_else(|| Some(x.trim().to_string())))
                                .filter(|m| m.contains('@'))
                                .collect();
                            if p.email.is_empty() {
                                p.email = mails.first().cloned().unwrap_or_default();
                            }
                            p.email_alt = mails.into_iter().find(|m| *m != p.email).unwrap_or_default();
                        }
                    }
                    "AREA-DE-ATUACAO" if p.area.is_empty() => {
                        let g = |k: &str| a.get(k).cloned().unwrap_or_default();
                        p.area = [g("NOME-DA-AREA-DO-CONHECIMENTO"), g("NOME-DA-SUB-AREA-DO-CONHECIMENTO"), g("NOME-DA-ESPECIALIDADE")]
                            .into_iter()
                            .filter(|s| !s.is_empty())
                            .collect::<Vec<_>>()
                            .join(" › ");
                    }
                    "RESUMO-CV" => {
                        p.resumo = a.get("TEXTO-RESUMO-CV-RH").cloned().unwrap_or_default();
                    }
                    _ => {}
                }
                if p.orcid.is_empty() {
                    if let Some(o) = a.get("ORCID-ID").filter(|o| !o.is_empty()) {
                        p.orcid = o.clone();
                    }
                }
                if name == "PRODUCAO-BIBLIOGRAFICA" && !p.orcid.is_empty() {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML inválido: {}", e)),
            _ => {}
        }
    }
    if p.nome.is_empty() {
        return Err("O arquivo não parece ser um XML do Currículo Lattes (DADOS-GERAIS ausente)".into());
    }
    if !p.lattes_id.is_empty() {
        p.lattes_url = format!("http://lattes.cnpq.br/{}", p.lattes_id);
    }
    Ok(p)
}

/// Índice de títulos já cadastrados: igualdade exata + similaridade por trigramas
/// (pega variações como "toward" × "towards").
struct TitleIndex {
    exact: HashSet<String>,
    tri: Vec<HashSet<String>>,
}

impl TitleIndex {
    fn from_db(conn: &Connection) -> Result<Self, String> {
        let mut idx = TitleIndex { exact: HashSet::new(), tri: Vec::new() };
        let mut stmt = conn
            .prepare("SELECT titulo FROM producoes WHERE titulo IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        for t in rows.flatten() {
            idx.insert(&t);
        }
        Ok(idx)
    }
    fn insert(&mut self, title: &str) {
        self.exact.insert(normalize_title(title));
        self.tri.push(crate::files::linker::trigrams(title));
    }
    /// true se já existe (exato ou ≥ 0,92 de similaridade); senão registra e devolve false.
    fn seen_or_insert(&mut self, title: &str) -> bool {
        let key = normalize_title(title);
        if key.is_empty() || self.exact.contains(&key) {
            return true;
        }
        let t = crate::files::linker::trigrams(title);
        let lt = t.len() as f64;
        let similar = self.tri.iter().any(|o| {
            let lo = o.len() as f64;
            lt.min(lo) / lt.max(lo).max(1.0) >= 0.85 && crate::files::linker::dice(&t, o) >= 0.92
        });
        if similar {
            return true;
        }
        self.exact.insert(key);
        self.tri.push(t);
        false
    }
}

/// Parse + marca duplicatas contra a tabela `producoes` e dentro do próprio arquivo.
pub fn preview(conn: &Connection, path: &Path) -> Result<Vec<XmlProduction>, String> {
    let mut items = parse_lattes_xml(path)?;
    let mut existing = TitleIndex::from_db(conn)?;
    // Usa pastas cadastradas quando o tipo já existe nos mapeamentos
    let folders = mapping_folders(conn);
    for it in items.iter_mut() {
        it.duplicate = existing.seen_or_insert(&it.titulo);
        if let Some(f) = folders.get(&it.tipo.to_lowercase()) {
            it.folder = f.clone();
        }
    }
    items.sort_by(|a, b| b.ano.cmp(&a.ano).then(a.tipo.cmp(&b.tipo)));
    Ok(items)
}

fn mapping_folders(conn: &Connection) -> HashMap<String, String> {
    let mut m = HashMap::new();
    if let Ok(mut stmt) =
        conn.prepare("SELECT description, folder FROM subfolder_mappings WHERE category_group = 'Produções'")
    {
        if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
            for (d, f) in rows.flatten() {
                m.insert(d.to_lowercase(), f);
            }
        }
    }
    m
}

/// Insere as produções selecionadas. Cria mapeamentos de subpasta para tipos novos.
/// Retorna a quantidade inserida.
pub fn import_items(conn: &mut Connection, root_dir: &Path, items: &[XmlProduction]) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut folders = mapping_folders(&tx);
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut existing = TitleIndex::from_db(&tx)?;
    let mut n = 0;
    for it in items {
        if existing.seen_or_insert(&it.titulo) {
            continue; // nunca duplica
        }
        let folder = match folders.get(&it.tipo.to_lowercase()) {
            Some(f) => f.clone(),
            None => {
                tx.execute(
                    "INSERT INTO subfolder_mappings (category_group, description, folder) VALUES ('Produções', ?1, ?2)",
                    params![it.tipo, it.folder],
                )
                .map_err(|e| e.to_string())?;
                let _ = std::fs::create_dir_all(crate::files::rel_join(root_dir, &it.folder));
                folders.insert(it.tipo.to_lowercase(), it.folder.clone());
                it.folder.clone()
            }
        };
        tx.execute(
            "INSERT INTO producoes (ano, tipo, identifier, file, folder, titulo, journal, qualis, log, path) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, '', ?7, NULL)",
            params![it.ano, it.tipo, it.doi, folder, it.titulo, it.journal, format!("XML Lattes {}", now)],
        )
        .map_err(|e| e.to_string())?;
        n += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_titles() {
        assert_eq!(normalize_title("Efeitos de Fungicidas, na Soja!"), normalize_title("efeitos de fungicidas na soja"));
        assert_eq!(normalize_title("Ação"), "acao");
    }

    #[test]
    fn parses_real_file_if_present() {
        let p = Path::new(r"d:\Desktop\UFSC\lattes\lattes_xml.xml");
        if !p.exists() {
            return;
        }
        let items = parse_lattes_xml(p).unwrap();
        assert!(items.iter().filter(|i| i.tipo == "Artigos completos").count() >= 100);
        assert!(items.iter().all(|i| !i.titulo.is_empty()));
        assert!(items.iter().any(|i| i.titulo.contains("Fungicidas")));
    }

    #[test]
    fn parses_profile_if_present() {
        let p = Path::new(r"d:\Desktop\UFSC\lattes\lattes_xml.xml");
        if !p.exists() {
            return;
        }
        let prof = parse_profile(p).unwrap();
        assert_eq!(prof.nome, "Tiago Olivoto");
        assert!(prof.orcid.contains("0000-0002-0241-9636"));
        assert!(prof.lattes_url.ends_with("2432360896340086"));
        assert!(prof.atualizacao.contains('/'));
        assert!(prof.resumo.len() > 100);
        assert_eq!(prof.email, "tiago.olivoto@ufsc.br");
        assert_eq!(prof.instituicao, "Universidade Federal de Santa Catarina");
        assert!(prof.unidade.contains("Agrárias"), "{}", prof.unidade);
        assert!(prof.endereco.contains("Florianópolis/SC"), "{}", prof.endereco);
        assert!(prof.area.starts_with("Agronomia"), "{}", prof.area);
        assert!(prof.email_alt.contains('@') && prof.email_alt != prof.email);
        assert_eq!(prof.telefone, "(48) 37215327");
    }

    #[test]
    fn cleans_html_from_titles() {
        assert_eq!(clean_text("strawberry (Fragaria x ananassa)</i> production"), "strawberry (Fragaria x ananassa) production");
        assert_eq!(clean_text("Gower&#146;s algorithm"), "Gower\u{2019}s algorithm");
        assert_eq!(clean_text("<i>Solanum  melongena</i> L."), "Solanum melongena L.");
    }

    #[test]
    fn formats_dates() {
        assert_eq!(fmt_ddmmyyyy("11112026"), "11/11/2026");
        assert_eq!(fmt_ddmmyyyy(""), "");
    }

    #[test]
    fn preview_against_real_db() {
        let p = Path::new(r"d:\Desktop\UFSC\lattes\lattes_xml.xml");
        let db = Path::new(r"d:\Desktop\UFSC\lattes\lattes.db");
        if !p.exists() || !db.exists() {
            return;
        }
        let conn = Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let items = preview(&conn, p).unwrap();
        let mut by: std::collections::BTreeMap<String, (usize, usize)> = Default::default();
        for i in &items {
            let e = by.entry(i.tipo.clone()).or_default();
            if i.duplicate { e.1 += 1 } else { e.0 += 1 }
        }
        println!("total={} -> {:?}", items.len(), by);
    }
}
