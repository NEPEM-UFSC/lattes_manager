//! Importador do XML exportado pela Plataforma Lattes (CNPq).
//! Extrai registros das 10 categorias do currículo e os mapeia para suas respectivas tabelas.

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

fn default_category() -> String {
    "producoes".to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct XmlProduction {
    pub tipo: String,
    pub folder: String,
    pub ano: Option<i64>,
    pub titulo: String,
    pub journal: Option<String>,
    pub doi: Option<String>,
    pub origem: String,
    pub duplicate: bool,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub descricao: Option<String>,
    #[serde(default)]
    pub aluno: Option<String>,
    #[serde(default)]
    pub horas: Option<i64>,
    #[serde(default)]
    pub curso: Option<String>,
    #[serde(default)]
    pub disciplina: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    /// Autores da produção, na ordem de autoria do XML.
    #[serde(default)]
    pub autores: Vec<XmlAutor>,
}

/// Autor de uma produção no XML do Lattes.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct XmlAutor {
    pub nome: String,
    /// Nome para citação ("SILVA, M. A."); pode trazer várias formas separadas por ";".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub citacao: Option<String>,
}

impl XmlProduction {
    fn new(
        category: &str,
        tipo: &str,
        folder: &str,
        ano: Option<i64>,
        titulo: String,
        origem: &str,
    ) -> Self {
        Self {
            tipo: tipo.to_string(),
            folder: folder.to_string(),
            ano,
            titulo,
            journal: None,
            doi: None,
            origem: origem.to_string(),
            duplicate: false,
            category: category.to_string(),
            descricao: None,
            aluno: None,
            horas: None,
            curso: None,
            disciplina: None,
            url: None,
            autores: Vec::new(),
        }
    }
}

/// (elemento XML, tipo no app, pasta padrão) para a categoria `producoes`.
const PRODUC_KINDS: &[(&str, &str, &str)] = &[
    (
        "ARTIGO-PUBLICADO",
        "Artigos completos",
        "5_producoes\\artigos_completos\\",
    ),
    (
        "ARTIGO-ACEITO-PARA-PUBLICACAO",
        "Artigos aceitos",
        "5_producoes\\artigos_aceitos\\",
    ),
    (
        "TRABALHO-EM-EVENTOS",
        "Resumos simples",
        "5_producoes\\resumos_simples\\",
    ),
    (
        "LIVRO-PUBLICADO-OU-ORGANIZADO",
        "Livros",
        "5_producoes\\livros\\",
    ),
    (
        "CAPITULO-DE-LIVRO-PUBLICADO",
        "Capítulos de livros",
        "5_producoes\\capítulos\\",
    ),
    (
        "TEXTO-EM-JORNAL-OU-REVISTA",
        "Textos em jornais/revistas",
        "5_producoes\\textos_jornais\\",
    ),
    (
        "APRESENTACAO-DE-TRABALHO",
        "Trabalhos/palestras",
        "5_producoes\\trabalho_palestra\\",
    ),
    (
        "CURSO-DE-CURTA-DURACAO-MINISTRADO",
        "Cursos",
        "5_producoes\\cursos_ministrados\\",
    ),
    (
        "DESENVOLVIMENTO-DE-MATERIAL-DIDATICO-OU-INSTRUCIONAL",
        "Material didático",
        "5_producoes\\material_didatico\\",
    ),
    (
        "PROGRAMA-DE-RADIO-OU-TV",
        "Programas de rádio/TV",
        "5_producoes\\radio_tv\\",
    ),
    (
        "MIDIA-SOCIAL-WEBSITE-BLOG",
        "Mídias sociais/blog",
        "5_producoes\\midias_sociais\\",
    ),
    (
        "PROCESSOS-OU-TECNICAS",
        "Processos ou técnicas",
        "5_producoes\\processos_tecnicas\\",
    ),
    (
        "PRODUTO-TECNOLOGICO",
        "Produtos tecnológicos",
        "5_producoes\\produtos_tecnologicos\\",
    ),
    (
        "TRABALHO-TECNICO",
        "Trabalhos técnicos",
        "5_producoes\\trabalhos_tecnicos\\",
    ),
    (
        "RELATORIO-DE-PESQUISA",
        "Relatórios de pesquisa",
        "5_producoes\\relatorios_pesquisa\\",
    ),
    (
        "CARTA-MAPA-OU-SIMILAR",
        "Cartas, mapas ou similares",
        "5_producoes\\cartas_mapas\\",
    ),
    ("EDITORACAO", "Editoração", "5_producoes\\editoracao\\"),
    (
        "MANUTENCAO-DE-OBRA-ARTISTICA",
        "Manutenção de obra artística",
        "5_producoes\\manutencao_obra\\",
    ),
    ("MAQUETE", "Maquetes", "5_producoes\\maquetes\\"),
    (
        "PREFACIO-POSFACIO",
        "Prefácios e posfácios",
        "5_producoes\\prefacios\\",
    ),
    ("TRADUCAO", "Traduções", "5_producoes\\traducoes\\"),
    (
        "PARTITURA-MUSICAL",
        "Partituras musicais",
        "5_producoes\\partituras\\",
    ),
    (
        "OUTRA-PRODUCAO-BIBLIOGRAFICA",
        "Outras produções bibliográficas",
        "5_producoes\\outras_bibliograficas\\",
    ),
    (
        "OUTRA-PRODUCAO-TECNICA",
        "Outras produções técnicas",
        "5_producoes\\outras_tecnicas\\",
    ),
    (
        "APRESENTACAO-DE-OBRA-ARTISTICA",
        "Produção artística/cultural",
        "5_producoes\\artistica_cultural\\",
    ),
    (
        "MUSICA",
        "Produção artística/cultural",
        "5_producoes\\artistica_cultural\\",
    ),
    (
        "ARTES-CENICAS",
        "Produção artística/cultural",
        "5_producoes\\artistica_cultural\\",
    ),
    (
        "ARTES-VISUAIS",
        "Produção artística/cultural",
        "5_producoes\\artistica_cultural\\",
    ),
    (
        "OUTRA-PRODUCAO-ARTISTICA-CULTURAL",
        "Produção artística/cultural",
        "5_producoes\\artistica_cultural\\",
    ),
];

const ORIENT_KINDS: &[(&str, &str, &str)] = &[
    (
        "ORIENTACOES-CONCLUIDAS-PARA-MESTRADO",
        "Dissertação de mestrado",
        "10_orientacoes\\orientacoes_concluidas\\dissertação\\",
    ),
    (
        "ORIENTACOES-CONCLUIDAS-PARA-DOUTORADO",
        "Tese de doutorado",
        "10_orientacoes\\orientacoes_concluidas\\tese\\",
    ),
    (
        "ORIENTACOES-CONCLUIDAS-PARA-POS-DOUTORADO",
        "Supervisão de pós-doutorado",
        "10_orientacoes\\orientacoes_concluidas\\pos_doc\\",
    ),
    (
        "OUTRAS-ORIENTACOES-CONCLUIDAS",
        "Orientação de outra natureza",
        "10_orientacoes\\orientacoes_concluidas\\outras\\",
    ),
    (
        "ORIENTACAO-EM-ANDAMENTO-DE-MESTRADO",
        "Dissertação de mestrado",
        "10_orientacoes\\orientacoes_em_andamento\\dissertação\\",
    ),
    (
        "ORIENTACAO-EM-ANDAMENTO-DE-DOUTORADO",
        "Tese de doutorado",
        "10_orientacoes\\orientacoes_em_andamento\\tese\\",
    ),
    (
        "ORIENTACAO-EM-ANDAMENTO-DE-POS-DOUTORADO",
        "Supervisão de pós-doutorado",
        "10_orientacoes\\orientacoes_em_andamento\\pos_doc\\",
    ),
    (
        "ORIENTACAO-EM-ANDAMENTO-DE-GRADUACAO",
        "Trabalho de conclusão de curso",
        "10_orientacoes\\orientacoes_em_andamento\\graduação\\",
    ),
    (
        "ORIENTACAO-EM-ANDAMENTO-DE-INICIACAO-CIENTIFICA",
        "Iniciação Científica",
        "10_orientacoes\\orientacoes_em_andamento\\ic\\",
    ),
    (
        "ORIENTACAO-EM-ANDAMENTO-DE-APERFEICOAMENTO-ESPECIALIZACAO",
        "Especialização",
        "10_orientacoes\\orientacoes_em_andamento\\especializacao\\",
    ),
];

const BANCA_KINDS: &[(&str, &str, &str)] = &[
    (
        "PARTICIPACAO-EM-BANCA-DE-GRADUACAO",
        "Graduação",
        "11_bancas\\graduação\\",
    ),
    (
        "PARTICIPACAO-EM-BANCA-DE-MESTRADO",
        "Mestrado",
        "11_bancas\\mestrado\\",
    ),
    (
        "PARTICIPACAO-EM-BANCA-DE-DOUTORADO",
        "Doutorado",
        "11_bancas\\doutorado\\",
    ),
    (
        "PARTICIPACAO-EM-BANCA-DE-EXAME-QUALIFICACAO",
        "Qualificação de doutorado",
        "11_bancas\\quali_doutorado\\",
    ),
    (
        "PARTICIPACAO-EM-BANCA-DE-APERFEICOAMENTO-ESPECIALIZACAO",
        "Especialização",
        "11_bancas\\especializacao\\",
    ),
    (
        "BANCA-JULGADORA-PARA-CONCURSO-PUBLICO",
        "Concurso público",
        "11_bancas\\concurso\\",
    ),
    (
        "BANCA-JULGADORA-PARA-PROFESSOR-TITULAR",
        "Comissão julgadora",
        "11_bancas\\julgadora\\",
    ),
    (
        "BANCA-JULGADORA-PARA-LIVRE-DOCENCIA",
        "Comissão julgadora",
        "11_bancas\\julgadora\\",
    ),
    (
        "BANCA-JULGADORA-PARA-AVALIACAO-CURSOS",
        "Comissão julgadora",
        "11_bancas\\julgadora\\",
    ),
    (
        "OUTRAS-BANCAS-JULGADORAS",
        "Comissão julgadora",
        "11_bancas\\julgadora\\",
    ),
];

const EVENTO_KINDS: &[(&str, &str, &str)] = &[
    (
        "PARTICIPACAO-EM-CONGRESSO",
        "Participação em eventos",
        "9_eventos\\participacao_eventos\\",
    ),
    (
        "PARTICIPACAO-EM-SIMPOSIO",
        "Participação em eventos",
        "9_eventos\\participacao_eventos\\",
    ),
    (
        "PARTICIPACAO-EM-SEMINARIO",
        "Participação em eventos",
        "9_eventos\\participacao_eventos\\",
    ),
    (
        "PARTICIPACAO-EM-ENCONTRO",
        "Participação em eventos",
        "9_eventos\\participacao_eventos\\",
    ),
    (
        "PARTICIPACAO-EM-OFICINA",
        "Participação em eventos",
        "9_eventos\\participacao_eventos\\",
    ),
    (
        "PARTICIPACAO-EM-OLIMPIADA",
        "Participação em eventos",
        "9_eventos\\participacao_eventos\\",
    ),
    (
        "PARTICIPACAO-EM-EXPOSICAO",
        "Participação em eventos",
        "9_eventos\\participacao_eventos\\",
    ),
    (
        "OUTRAS-PARTICIPACOES-EM-EVENTOS-CONGRESSOS",
        "Participação em eventos",
        "9_eventos\\participacao_eventos\\",
    ),
    (
        "ORGANIZACAO-DE-EVENTO",
        "Organização de eventos",
        "9_eventos\\organizacao_eventos\\",
    ),
];

const PATENTE_KINDS: &[(&str, &str, &str)] = &[
    (
        "SOFTWARE",
        "Programas de computador",
        "6_patentes\\programas_computador\\",
    ),
    ("PATENTE", "Patentes", "6_patentes\\patentes\\"),
    (
        "CULTIVAR-REGISTRADA",
        "Cultivar registrada",
        "6_patentes\\cultivar_registrada\\",
    ),
    (
        "CULTIVAR-PROTEGIDA",
        "Cultivar protegida",
        "6_patentes\\cultivar_protegida\\",
    ),
    (
        "DESENHO-INDUSTRIAL",
        "Desenho industrial",
        "6_patentes\\desenho_industrial\\",
    ),
    ("MARCA", "Marca", "6_patentes\\marcas\\"),
    (
        "TOPOGRAFIA-DE-CIRCUITO-INTEGRADO",
        "Topografia de circuito integrado",
        "6_patentes\\topografia\\",
    ),
];

const FORMACAO_ACAD_KINDS: &[(&str, &str, &str)] = &[
    ("GRADUACAO", "Graduação", "2_formacao\\graduacao\\"),
    (
        "ESPECIALIZACAO",
        "Especialização",
        "2_formacao\\especializacao\\",
    ),
    ("MESTRADO", "Mestrado", "2_formacao\\mestrado\\"),
    (
        "MESTRADO-PROFISSIONALIZANTE",
        "Mestrado profissionalizante",
        "2_formacao\\mestrado\\",
    ),
    ("DOUTORADO", "Doutorado", "2_formacao\\doutorado\\"),
    (
        "POS-DOUTORADO",
        "Pós-doutorado",
        "2_formacao\\pos_doutorado\\",
    ),
    (
        "LIVRE-DOCENCIA",
        "Livre-docência",
        "2_formacao\\livre_docencia\\",
    ),
    (
        "CURSO-TECNICO-PROFISSIONALIZANTE",
        "Curso técnico",
        "2_formacao\\tecnico\\",
    ),
];

const FORMACAO_COMP_KINDS: &[(&str, &str, &str)] = &[
    (
        "FORMACAO-COMPLEMENTAR-DE-EXTENSAO-UNIVERSITARIA",
        "Extensão universitária",
        "2_formacao\\formacao_complementar\\",
    ),
    (
        "FORMACAO-COMPLEMENTAR-CURSO-DE-CURTA-DURACAO",
        "Curso de curta duração",
        "2_formacao\\formacao_complementar\\",
    ),
    ("MBA", "MBA", "2_formacao\\formacao_complementar\\"),
    ("OUTROS", "Cursos e treinamentos", "2_formacao\\cursos\\"),
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
    "INSTITUICAO-FINANCIADORA",
];

const TITLE_KEYS: &[&str] = &[
    "TITULO-DO-ARTIGO",
    "TITULO-DO-TRABALHO",
    "TITULO-DO-CAPITULO-DO-LIVRO",
    "TITULO-DO-LIVRO",
    "TITULO-DO-TEXTO",
    "TITULO-DO-SOFTWARE",
    "TITULO-DO-PROCESSO",
    "TITULO-DO-PRODUTO",
    "TITULO-DA-PATENTE",
    "TITULO-PATENTE",
    "TITULO-DA-CULTIVAR",
    "NOME-DA-CULTIVAR",
    "TITULO-DO-DESENHO-INDUSTRIAL",
    "TITULO-DA-MARCA",
    "NOME-DA-MARCA",
    "TITULO-DO-REGISTRO",
    "TITULO",
    "NOME-DO-EVENTO",
    "NOME-DO-PROJETO",
    "NOME-DO-PREMIO-OU-TITULO",
    "TITULO-DO-TRABALHO-DE-CONCLUSAO-DE-CURSO",
    "TITULO-DA-DISSERTACAO-TESE",
];

const YEAR_KEYS: &[&str] = &[
    "ANO-DO-ARTIGO",
    "ANO-DO-TRABALHO",
    "ANO-DO-TEXTO",
    "ANO-DE-CONCLUSAO",
    "ANO",
    "ANO-SOLICITACAO",
    "ANO-DESENVOLVIMENTO",
    "ANO-DA-PREMIACAO",
    "ANO-FIM",
    "ANO-INICIO",
    "ANO-DE-INICIO",
];

const URL_KEYS: &[&str] = &["HOME-PAGE-DO-TRABALHO", "HOME-PAGE", "HOME-PAGE-DO-EVENTO"];

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
            .unwrap_or(rawv);
        m.insert(k, v.trim().to_string());
    }
    m
}

fn non_empty(v: Option<&String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn first_attr(map: &HashMap<String, String>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| non_empty(map.get(*k)))
}

fn clean_xml_url(raw: &str) -> Option<String> {
    let s = raw
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim();
    if s.is_empty() {
        return None;
    }
    // Lattes às vezes exporta "[http://https://...]"
    let s = s
        .strip_prefix("http://https://")
        .map(|r| format!("https://{}", r))
        .or_else(|| {
            s.strip_prefix("http://http://")
                .map(|r| format!("http://{}", r))
        })
        .unwrap_or_else(|| s.to_string());
    let lower = s.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return None;
    }
    let host = s
        .split_once("://")
        .map(|(_, r)| r)
        .unwrap_or("")
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("");
    if s.contains(char::is_whitespace)
        || host.is_empty()
        || !host.contains('.')
        || host.starts_with('.')
        || host.ends_with('.')
    {
        return None;
    }
    Some(s)
}

fn pick_url(basic: &HashMap<String, String>, detail: &HashMap<String, String>) -> Option<String> {
    URL_KEYS
        .iter()
        .filter_map(|k| basic.get(*k).or_else(|| detail.get(*k)))
        .find_map(|v| clean_xml_url(v))
}

fn pick_doi_fallback(basic: &HashMap<String, String>) -> Option<String> {
    if let Some(d) = non_empty(basic.get("DOI")) {
        return Some(d);
    }
    for k in URL_KEYS {
        if let Some(raw) = basic.get(*k) {
            let s = raw
                .trim()
                .trim_start_matches('[')
                .trim_end_matches(']')
                .trim();
            if let Some(rest) = s.strip_prefix("doi:").or_else(|| s.strip_prefix("DOI:")) {
                let d = rest.trim();
                if !d.is_empty() {
                    return Some(d.to_string());
                }
            }
        }
    }
    None
}

fn pick_title_in(map: &HashMap<String, String>, include_ingles: bool) -> Option<String> {
    if !include_ingles {
        if let Some(t) = first_attr(map, TITLE_KEYS) {
            return Some(t);
        }
    }
    let mut keys: Vec<&String> = map
        .keys()
        .filter(|k| {
            k.starts_with("TITULO")
                && !k.contains("PERIODICO")
                && !k.contains("JORNAL")
                && !k.contains("HOME-PAGE")
                && (include_ingles || !k.contains("INGLES"))
        })
        .collect();
    keys.sort();
    for k in keys {
        if let Some(v) = non_empty(map.get(k)) {
            return Some(v);
        }
    }
    if include_ingles {
        // Fallback em inglês para NOME-DO-EVENTO-INGLES / NOME-DO-PROJETO-INGLES etc.
        let mut extra_keys: Vec<&String> = map
            .keys()
            .filter(|k| k.contains("INGLES") && (k.starts_with("NOME-") || k.starts_with("TITULO")))
            .collect();
        extra_keys.sort();
        for k in extra_keys {
            if let Some(v) = non_empty(map.get(k)) {
                return Some(v);
            }
        }
    }
    None
}

fn pick_title(basic: &HashMap<String, String>, detail: &HashMap<String, String>) -> Option<String> {
    pick_title_in(basic, false)
        .or_else(|| pick_title_in(basic, true))
        .or_else(|| pick_title_in(detail, false))
        .or_else(|| pick_title_in(detail, true))
}

fn parse_year_str(s: &str) -> Option<i64> {
    let t = s.trim();
    if let Ok(y) = t.parse::<i64>() {
        if y > 1900 {
            return Some(y);
        }
    }
    None
}

fn pick_year_in(map: &HashMap<String, String>) -> Option<i64> {
    for k in YEAR_KEYS {
        if let Some(y) = map.get(*k).and_then(|v| parse_year_str(v)) {
            return Some(y);
        }
    }
    let mut keys: Vec<&String> = map.keys().filter(|k| k.starts_with("ANO")).collect();
    keys.sort();
    for k in keys {
        if let Some(y) = map.get(k).and_then(|v| parse_year_str(v)) {
            return Some(y);
        }
    }
    None
}

fn pick_year(basic: &HashMap<String, String>, detail: &HashMap<String, String>) -> Option<i64> {
    pick_year_in(basic).or_else(|| pick_year_in(detail))
}

fn join_non_empty(a: Option<String>, b: Option<String>) -> Option<String> {
    match (a, b) {
        (Some(x), Some(y)) => {
            if x.to_lowercase().contains(&y.to_lowercase()) {
                Some(x)
            } else {
                Some(format!("{} — {}", x, y))
            }
        }
        (Some(x), None) => Some(x),
        (None, Some(y)) => Some(y),
        (None, None) => None,
    }
}

/// Extrai carga horária simples como "(90 h)", "- 72 Horas" ou "- 30h".
fn extract_hours_hint(s: &str) -> Option<i64> {
    let bytes = s.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        if bytes[i].is_ascii_digit() && (i == 0 || !bytes[i - 1].is_ascii_alphanumeric()) {
            let start = i;
            while i < len && bytes[i].is_ascii_digit() {
                i += 1;
            }
            let num_str = &s[start..i];
            let mut j = i;
            while j < len && bytes[j] == b' ' {
                j += 1;
            }
            let rest = s[j..].to_ascii_lowercase();
            let unit_len = if rest.starts_with("horas") {
                Some(5)
            } else if rest.starts_with("hora") {
                Some(4)
            } else if rest.starts_with("hs") {
                Some(2)
            } else if rest.starts_with('h') {
                Some(1)
            } else {
                None
            };
            if let Some(ul) = unit_len {
                let after = j + ul;
                let boundary = after >= len || !bytes[after].is_ascii_alphanumeric();
                if boundary {
                    if let Ok(h) = num_str.parse::<i64>() {
                        if (1..=2000).contains(&h) {
                            return Some(h);
                        }
                    }
                }
            }
        } else {
            i += 1;
        }
    }
    None
}

fn effective_category(cat: &str) -> &'static str {
    match cat.trim().to_lowercase().as_str() {
        "dadosgerais" | "dados_gerais" | "dados gerais" => "dadosgerais",
        "formacao" | "formação" => "formacao",
        "encargos" => "encargos",
        "disciplinas" => "disciplinas",
        "projetos" => "projetos",
        "patentes" => "patentes",
        "eventos" => "eventos",
        "orientacoes" | "orientações" => "orientacoes",
        "bancas" => "bancas",
        _ => "producoes",
    }
}

pub fn category_group(cat: &str) -> &'static str {
    match effective_category(cat) {
        "dadosgerais" => "Dados gerais",
        "formacao" => "Formação",
        "encargos" | "disciplinas" => "Atuação",
        "projetos" => "Projetos",
        "patentes" => "Patentes",
        "eventos" => "Eventos",
        "orientacoes" => "Orientações",
        "bancas" => "Bancas",
        _ => "Produções",
    }
}

fn lookup_kind(elem: &str) -> Option<(&'static str, &'static str, &'static str, &'static str)> {
    for &(cat, slice) in &[
        ("producoes", PRODUC_KINDS),
        ("orientacoes", ORIENT_KINDS),
        ("bancas", BANCA_KINDS),
        ("eventos", EVENTO_KINDS),
        ("patentes", PATENTE_KINDS),
    ] {
        if let Some(&(k, t, f)) = slice.iter().find(|(k, _, _)| *k == elem) {
            return Some((cat, k, t, f));
        }
    }
    None
}

fn outras_orientacoes_tipo(natureza: &str) -> (&'static str, &'static str) {
    let n = natureza.to_ascii_uppercase();
    if n.contains("APERFEICOAMENTO") || n.contains("ESPECIALIZACAO") || n.contains("MONOGRAFIA") {
        (
            "Especialização",
            "10_orientacoes\\orientacoes_concluidas\\especializacao\\",
        )
    } else if n.contains("INICIACAO") {
        (
            "Iniciação Científica",
            "10_orientacoes\\orientacoes_concluidas\\ic\\",
        )
    } else if n.contains("GRADUACAO") || n.contains("TRABALHO_DE_CONCLUSAO_DE_CURSO") {
        (
            "Trabalho de conclusão de curso",
            "10_orientacoes\\orientacoes_concluidas\\graduação\\",
        )
    } else if n.contains("MONITORIA") {
        (
            "Monitoria",
            "10_orientacoes\\orientacoes_concluidas\\monitoria\\",
        )
    } else if n.contains("ESTAGIO") {
        (
            "Estágio",
            "10_orientacoes\\orientacoes_concluidas\\estágio\\",
        )
    } else {
        (
            "Orientação de outra natureza",
            "10_orientacoes\\orientacoes_concluidas\\outras\\",
        )
    }
}

struct Builder {
    category: &'static str,
    elem: &'static str,
    tipo: &'static str,
    folder: &'static str,
    depth: usize,
    basic: HashMap<String, String>,
    detail: HashMap<String, String>,
    registro: HashMap<String, String>,
    extra: HashMap<String, String>,
    /// (ordem de autoria, autor)
    autores: Vec<(i64, XmlAutor)>,
}

impl Builder {
    /// Guarda um elemento AUTORES (nome completo, nome para citação e ordem).
    fn push_autor(&mut self, a: &HashMap<String, String>) {
        let nome = a
            .get("NOME-COMPLETO-DO-AUTOR")
            .map(|s| clean_text(s))
            .unwrap_or_default();
        let citacao = a
            .get("NOME-PARA-CITACAO")
            .map(|s| clean_text(s))
            .filter(|s| !s.is_empty());
        if nome.is_empty() && citacao.is_none() {
            return;
        }
        let ordem = a
            .get("ORDEM-DE-AUTORIA")
            .and_then(|s| s.trim().parse::<i64>().ok())
            .unwrap_or(i64::MAX);
        self.autores.push((ordem, XmlAutor { nome, citacao }));
    }

    fn finish(self) -> Option<XmlProduction> {
        let mut tipo = self.tipo;
        let mut folder = self.folder;
        let ano = pick_year(&self.basic, &self.detail).or_else(|| {
            first_attr(
                &self.registro,
                &["DATA-PEDIDO-DE-DEPOSITO", "DATA-DE-CONCESSAO"],
            )
            .filter(|s| s.len() >= 4)
            .and_then(|s| parse_year_str(&s[s.len() - 4..]))
        });
        let url = pick_url(&self.basic, &self.detail);

        match self.category {
            "producoes" => {
                let titulo = pick_title(&self.basic, &self.detail)?;
                if self.elem == "TRABALHO-EM-EVENTOS" {
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
                let mut item = XmlProduction::new(
                    "producoes",
                    tipo,
                    folder,
                    ano,
                    clean_text(&titulo),
                    self.elem,
                );
                item.journal = journal.map(|j| clean_text(&j));
                item.doi = pick_doi_fallback(&self.basic);
                item.url = url;
                let mut autores = self.autores;
                autores.sort_by_key(|(o, _)| *o);
                item.autores = autores.into_iter().map(|(_, a)| a).collect();
                Some(item)
            }
            "orientacoes" => {
                if self.elem == "OUTRAS-ORIENTACOES-CONCLUIDAS" {
                    let nat = self.basic.get("NATUREZA").map(|s| s.as_str()).unwrap_or("");
                    let (t, f) = outras_orientacoes_tipo(nat);
                    tipo = t;
                    folder = f;
                }
                let aluno = first_attr(&self.detail, &["NOME-DO-ORIENTADO", "NOME-DO-ORIENTANDO"])
                    .or_else(|| {
                        first_attr(&self.basic, &["NOME-DO-ORIENTADO", "NOME-DO-ORIENTANDO"])
                    })
                    .map(|a| clean_text(&a));
                let raw_titulo = pick_title(&self.basic, &self.detail)
                    .or_else(|| {
                        first_attr(
                            &self.extra,
                            &[
                                "DESCRICAO-INFORMACOES-ADICIONAIS",
                                "DESCRICAO-INFORMACOES-ADICIONAIS-INGLES",
                            ],
                        )
                    })
                    .or_else(|| aluno.as_ref().map(|a| format!("{} — {}", tipo, a)))?;
                let titulo = clean_text(&raw_titulo);
                if titulo.is_empty() {
                    return None;
                }
                let mut item =
                    XmlProduction::new("orientacoes", tipo, folder, ano, titulo, self.elem);
                item.aluno = aluno;
                item.curso = first_attr(&self.detail, &["NOME-DO-CURSO", "NOME-CURSO"])
                    .map(|c| clean_text(&c));
                item.journal =
                    first_attr(&self.detail, &["NOME-DA-INSTITUICAO", "NOME-INSTITUICAO"])
                        .map(|j| clean_text(&j));
                item.doi = pick_doi_fallback(&self.basic);
                item.url = url;
                Some(item)
            }
            "bancas" => {
                if self.elem == "PARTICIPACAO-EM-BANCA-DE-EXAME-QUALIFICACAO" {
                    let nat = self
                        .basic
                        .get("NATUREZA")
                        .map(|s| s.as_str())
                        .unwrap_or("")
                        .to_ascii_uppercase();
                    if nat.contains("MESTRADO") {
                        tipo = "Qualificação de mestrado";
                        folder = "11_bancas\\quali_mestrado\\";
                    } else {
                        tipo = "Qualificação de doutorado";
                        folder = "11_bancas\\quali_doutorado\\";
                    }
                }
                let titulo = clean_text(&pick_title(&self.basic, &self.detail)?);
                if titulo.is_empty() {
                    return None;
                }
                let candidato = first_attr(&self.detail, &["NOME-DO-CANDIDATO"])
                    .or_else(|| first_attr(&self.basic, &["NOME-DO-CANDIDATO"]));
                let inst = first_attr(&self.detail, &["NOME-INSTITUICAO", "NOME-DA-INSTITUICAO"]);
                let aluno = candidato
                    .clone()
                    .or_else(|| inst.clone())
                    .map(|a| clean_text(&a));
                let mut item = XmlProduction::new("bancas", tipo, folder, ano, titulo, self.elem);
                item.aluno = aluno;
                item.curso = first_attr(&self.detail, &["NOME-CURSO", "NOME-DO-CURSO"])
                    .map(|c| clean_text(&c));
                item.journal = if candidato.is_some() {
                    inst.map(|j| clean_text(&j))
                } else {
                    None
                };
                item.doi = pick_doi_fallback(&self.basic);
                item.url = url;
                Some(item)
            }
            "eventos" => {
                let text = clean_text(&pick_title(&self.basic, &self.detail)?);
                if text.is_empty() {
                    return None;
                }
                let evento = first_attr(&self.detail, &["NOME-DO-EVENTO", "NOME-DO-EVENTO-INGLES"])
                    .map(|e| clean_text(&e));
                let journal = evento
                    .filter(|e| !e.eq_ignore_ascii_case(&text))
                    .or_else(|| {
                        first_attr(
                            &self.detail,
                            &[
                                "INSTITUICAO-PROMOTORA",
                                "CIDADE-DO-EVENTO",
                                "CIDADE",
                                "NOME-INSTITUICAO",
                            ],
                        )
                        .map(|j| clean_text(&j))
                    });
                let mut item =
                    XmlProduction::new("eventos", tipo, folder, ano, text.clone(), self.elem);
                item.descricao = Some(text);
                item.journal = journal;
                item.doi = pick_doi_fallback(&self.basic);
                item.url = url;
                Some(item)
            }
            "patentes" => {
                let raw_text = pick_title(&self.basic, &self.detail)
                    .or_else(|| pick_title_in(&self.registro, false))
                    .or_else(|| pick_title_in(&self.registro, true))?;
                let text = clean_text(&raw_text);
                if text.is_empty() {
                    return None;
                }
                let reg_num = first_attr(
                    &self.registro,
                    &[
                        "CODIGO-DO-REGISTRO-OU-PATENTE",
                        "NUMERO-DO-REGISTRO",
                        "NUMERO-DEPOSITO-PCT",
                    ],
                );
                let doi = pick_doi_fallback(&self.basic).or(reg_num);
                let journal = first_attr(
                    &self.registro,
                    &["INSTITUICAO-DEPOSITO-REGISTRO", "NOME-DO-DEPOSITANTE"],
                )
                .or_else(|| first_attr(&self.detail, &["INSTITUICAO-FINANCIADORA", "FINALIDADE"]))
                .map(|j| clean_text(&j));
                let mut item =
                    XmlProduction::new("patentes", tipo, folder, ano, text.clone(), self.elem);
                item.descricao = Some(text);
                item.doi = doi;
                item.journal = journal;
                item.url = url;
                Some(item)
            }
            _ => None,
        }
    }
}

struct EnsinoCtx {
    tipo: &'static str,
    folder: &'static str,
    ano: Option<i64>,
    curso: Option<String>,
    instituicao: Option<String>,
}

fn ensino_tipo_folder(tipo_ensino: &str) -> (&'static str, &'static str) {
    let t = tipo_ensino.to_ascii_uppercase();
    if t.contains("POS")
        || t.contains("MESTRADO")
        || t.contains("DOUTORADO")
        || t.contains("ESPECIALIZACAO")
    {
        (
            "Encargos Pós-Graduação",
            "3_atuacao\\atuacao_profissional\\encargos_pós\\",
        )
    } else {
        (
            "Encargos Graduação",
            "3_atuacao\\atuacao_profissional\\encargos_graduação\\",
        )
    }
}

fn parse_formacao_elem(
    elem: &str,
    attrs: &HashMap<String, String>,
    in_comp: bool,
) -> Option<XmlProduction> {
    let (tipo, folder, is_comp) =
        if let Some(&(_, t, f)) = FORMACAO_ACAD_KINDS.iter().find(|(k, _, _)| *k == elem) {
            (t, f, false)
        } else if in_comp {
            let &(_, t, f) = FORMACAO_COMP_KINDS.iter().find(|(k, _, _)| *k == elem)?;
            (t, f, true)
        } else {
            return None;
        };

    let course = first_attr(
        attrs,
        &[
            "NOME-CURSO",
            "TITULO-DA-DISSERTACAO-TESE",
            "TITULO-DO-TRABALHO-DE-CONCLUSAO-DE-CURSO",
            "TITULO-DA-MONOGRAFIA",
            "TITULO-DO-TRABALHO",
            "NOME-CURSO-INGLES",
        ],
    );
    let inst = first_attr(attrs, &["NOME-INSTITUICAO"]);
    let raw_desc = join_non_empty(course.clone(), inst.clone())?;
    let desc = clean_text(&raw_desc);
    if desc.is_empty() {
        return None;
    }
    let ano = first_attr(
        attrs,
        &[
            "ANO-DE-CONCLUSAO",
            "ANO-DE-OBTENCAO-DO-TITULO",
            "ANO-DE-INICIO",
        ],
    )
    .and_then(|s| parse_year_str(&s));
    let horas = if is_comp {
        first_attr(attrs, &["CARGA-HORARIA"])
            .and_then(|s| s.parse::<i64>().ok())
            .filter(|&h| h > 0)
    } else {
        None
    };

    let mut item = XmlProduction::new("formacao", tipo, folder, ano, desc.clone(), elem);
    item.descricao = Some(desc);
    item.horas = horas;
    item.curso = course.map(|c| clean_text(&c));
    item.journal = inst.map(|i| clean_text(&i));
    Some(item)
}

fn parse_direcao_elem(
    attrs: &HashMap<String, String>,
    ap_inst: Option<&str>,
) -> Option<XmlProduction> {
    let cargo = first_attr(attrs, &["CARGO-OU-FUNCAO", "CARGO-OU-FUNCAO-INGLES"]);
    let orgao = first_attr(attrs, &["NOME-ORGAO"]);
    let desc = clean_text(&join_non_empty(cargo.clone(), orgao.clone())?);
    if desc.is_empty() {
        return None;
    }
    let lower = cargo.as_deref().unwrap_or(&desc).to_ascii_lowercase();
    let (tipo, folder) = if lower.contains("coorden") {
        (
            "Coordenação",
            "3_atuacao\\atuacao_profissional\\coordenação\\",
        )
    } else if lower.contains("chefe") || lower.contains("chefia") {
        ("Chefia", "3_atuacao\\atuacao_profissional\\chefia\\")
    } else if lower.contains("supervis") {
        (
            "Supervisão",
            "3_atuacao\\atuacao_profissional\\supervisão\\",
        )
    } else {
        ("Direção", "3_atuacao\\atuacao_profissional\\direção\\")
    };
    let ano = first_attr(attrs, &["ANO-INICIO", "ANO-FIM"]).and_then(|s| parse_year_str(&s));
    let mut item = XmlProduction::new(
        "encargos",
        tipo,
        folder,
        ano,
        desc.clone(),
        "DIRECAO-E-ADMINISTRACAO",
    );
    item.descricao = Some(desc.clone());
    item.horas = extract_hours_hint(&desc);
    item.journal = ap_inst
        .map(clean_text)
        .filter(|s| !s.is_empty())
        .or_else(|| first_attr(attrs, &["NOME-UNIDADE", "NOME-ORGAO"]).map(|j| clean_text(&j)));
    Some(item)
}

fn parse_conselho_elem(
    attrs: &HashMap<String, String>,
    ap_inst: Option<&str>,
) -> Option<XmlProduction> {
    let spec = first_attr(attrs, &["ESPECIFICACAO"]);
    let orgao = first_attr(attrs, &["NOME-ORGAO"]);
    let desc = clean_text(&join_non_empty(spec, orgao.clone())?);
    if desc.is_empty() {
        return None;
    }
    let ano = first_attr(attrs, &["ANO-INICIO", "ANO-FIM"]).and_then(|s| parse_year_str(&s));
    let mut item = XmlProduction::new(
        "encargos",
        "Comissão",
        "3_atuacao\\atuacao_profissional\\comissão\\",
        ano,
        desc.clone(),
        "CONSELHO-COMISSAO-E-CONSULTORIA",
    );
    item.descricao = Some(desc.clone());
    item.horas = extract_hours_hint(&desc);
    item.journal = ap_inst
        .map(clean_text)
        .filter(|s| !s.is_empty())
        .or_else(|| orgao.map(|o| clean_text(&o)));
    Some(item)
}

fn parse_projeto_elem(
    attrs: &HashMap<String, String>,
    proj_orgao: Option<&str>,
    ap_inst: Option<&str>,
) -> Option<XmlProduction> {
    let raw_nome = first_attr(attrs, &["NOME-DO-PROJETO", "NOME-DO-PROJETO-INGLES"])?;
    let nome = clean_text(&raw_nome);
    if nome.is_empty() {
        return None;
    }
    let nat = attrs
        .get("NATUREZA")
        .map(|s| s.as_str())
        .unwrap_or("")
        .to_ascii_uppercase();
    let (tipo, folder) = match nat.as_str() {
        "EXTENSAO" => ("Projetos de extensão", "4_projetos\\projetos_extensão\\"),
        "ENSINO" => ("Projetos de ensino", "4_projetos\\projetos_ensino\\"),
        _ => ("Projetos de pesquisa", "4_projetos\\projetos_pesquisa\\"),
    };
    let ano = first_attr(attrs, &["ANO-INICIO", "ANO-FIM"]).and_then(|s| parse_year_str(&s));
    let mut item = XmlProduction::new(
        "projetos",
        tipo,
        folder,
        ano,
        nome.clone(),
        "PROJETO-DE-PESQUISA",
    );
    item.descricao = Some(nome);
    item.journal = ap_inst
        .or(proj_orgao)
        .map(clean_text)
        .filter(|s| !s.is_empty());
    Some(item)
}

fn parse_premio_elem(attrs: &HashMap<String, String>) -> Option<XmlProduction> {
    let premio = first_attr(
        attrs,
        &[
            "NOME-DO-PREMIO-OU-TITULO",
            "NOME-DO-PREMIO-OU-TITULO-INGLES",
        ],
    )?;
    let ent = first_attr(attrs, &["NOME-DA-ENTIDADE-PROMOTORA"]);
    let desc = clean_text(&join_non_empty(Some(premio), ent.clone())?);
    if desc.is_empty() {
        return None;
    }
    let ano = first_attr(attrs, &["ANO-DA-PREMIACAO"]).and_then(|s| parse_year_str(&s));
    let mut item = XmlProduction::new(
        "dadosgerais",
        "Prêmios e títulos",
        "0_dados_gerais\\premios_titulos\\",
        ano,
        desc.clone(),
        "PREMIO-TITULO",
    );
    item.descricao = Some(desc);
    item.journal = ent.map(|e| clean_text(&e));
    Some(item)
}

fn emit_disciplina(ctx: &EnsinoCtx, raw_name: &str) -> Option<XmlProduction> {
    let disc = clean_text(raw_name);
    if disc.is_empty() {
        return None;
    }
    let mut item = XmlProduction::new(
        "disciplinas",
        ctx.tipo,
        ctx.folder,
        ctx.ano,
        disc.clone(),
        "ENSINO",
    );
    item.disciplina = Some(disc.clone());
    item.curso = ctx.curso.clone();
    item.horas = extract_hours_hint(&disc);
    item.journal = ctx.instituicao.clone();
    Some(item)
}

fn parse_dadosgerais_elem(
    name: &str,
    attrs: &HashMap<String, String>,
    lattes_year: Option<i64>,
) -> Vec<XmlProduction> {
    let mut res = Vec::new();
    match name {
        "DADOS-GERAIS" => {
            let nome = attrs.get("NOME-COMPLETO").cloned().unwrap_or_default();
            if !nome.is_empty() {
                let cpf = attrs.get("CPF").cloned().unwrap_or_default();
                let rg = attrs.get("NUMERO-IDENTIDADE").cloned().unwrap_or_default();
                let orcid = attrs.get("ORCID-ID").cloned().unwrap_or_default();
                let mut parts = vec![format!("Nome: {}", clean_text(&nome))];
                if !cpf.is_empty() {
                    let cpf_fmt = if cpf.len() == 11 && cpf.chars().all(|c| c.is_ascii_digit()) {
                        format!("{}.{}.{}-{}", &cpf[0..3], &cpf[3..6], &cpf[6..9], &cpf[9..])
                    } else {
                        cpf
                    };
                    parts.push(format!("CPF: {}", cpf_fmt));
                }
                if !rg.is_empty() {
                    parts.push(format!("RG: {}", rg));
                }
                if !orcid.is_empty() {
                    parts.push(format!("ORCID: {}", orcid));
                }
                let mut item = XmlProduction::new(
                    "dadosgerais",
                    "Identificação",
                    "1_dados_gerais\\identificacao\\",
                    lattes_year,
                    format!("Identificação: {}", clean_text(&nome)),
                    "DADOS-GERAIS",
                );
                item.descricao = Some(parts.join(" · "));
                res.push(item);
            }
        }
        "RESUMO-CV" => {
            if let Some(r) = attrs.get("TEXTO-RESUMO-CV-RH") {
                let cl = clean_text(r);
                if !cl.trim().is_empty() {
                    let mut item = XmlProduction::new(
                        "dadosgerais",
                        "Texto inicial do currículo Lattes",
                        "1_dados_gerais\\texto_inicial\\",
                        lattes_year,
                        "Texto inicial do currículo Lattes / Resumo".to_string(),
                        "RESUMO-CV",
                    );
                    item.descricao = Some(cl);
                    res.push(item);
                }
            }
        }
        "OUTRAS-INFORMACOES-RELEVANTES" => {
            if let Some(info) = attrs.get("OUTRAS-INFORMACOES-RELEVANTES") {
                let cl = clean_text(info);
                if !cl.trim().is_empty() {
                    let mut item = XmlProduction::new(
                        "dadosgerais",
                        "Outras informações relevantes",
                        "1_dados_gerais\\outras_informacoes\\",
                        lattes_year,
                        "Outras informações relevantes".to_string(),
                        "OUTRAS-INFORMACOES-RELEVANTES",
                    );
                    item.descricao = Some(cl);
                    res.push(item);
                }
            }
        }
        "ENDERECO-PROFISSIONAL" => {
            if let Some(inst) = attrs.get("NOME-INSTITUICAO-EMPRESA") {
                let cl_inst = clean_text(inst);
                if !cl_inst.trim().is_empty() {
                    let logr = attrs
                        .get("LOGRADOURO-COMPLEMENTO")
                        .cloned()
                        .unwrap_or_default();
                    let cid = attrs.get("CIDADE").cloned().unwrap_or_default();
                    let uf = attrs.get("UF").cloned().unwrap_or_default();
                    let email = attrs.get("E-MAIL").cloned().unwrap_or_default();
                    let mut parts = vec![format!("Instituição: {}", cl_inst)];
                    if !logr.is_empty() {
                        parts.push(clean_text(&logr));
                    }
                    if !cid.is_empty() || !uf.is_empty() {
                        parts.push(format!("{}/{}", cid, uf));
                    }
                    if !email.is_empty() {
                        parts.push(format!("E-mail: {}", email));
                    }
                    let mut item = XmlProduction::new(
                        "dadosgerais",
                        "Endereço",
                        "1_dados_gerais\\endereco\\",
                        lattes_year,
                        format!("Endereço profissional: {}", cl_inst),
                        "ENDERECO-PROFISSIONAL",
                    );
                    item.descricao = Some(parts.join(" · "));
                    res.push(item);
                }
            }
        }
        "IDIOMA" => {
            if let Some(d) = attrs.get("DESCRICAO-DO-IDIOMA") {
                let leitura = attrs
                    .get("PROFICIENCIA-DE-LEITURA")
                    .cloned()
                    .unwrap_or_default();
                let fala = attrs
                    .get("PROFICIENCIA-DE-FALA")
                    .cloned()
                    .unwrap_or_default();
                let escrita = attrs
                    .get("PROFICIENCIA-DE-ESCRITA")
                    .cloned()
                    .unwrap_or_default();
                let desc = format!("Leitura: {}, Fala: {}, Escrita: {}", leitura, fala, escrita);
                let mut item = XmlProduction::new(
                    "dadosgerais",
                    "Idiomas",
                    "1_dados_gerais\\idiomas\\",
                    lattes_year,
                    format!("Idioma: {}", clean_text(d)),
                    "IDIOMA",
                );
                item.descricao = Some(desc);
                res.push(item);
            }
        }
        _ => {}
    }
    res
}

/// Faz o parse do XML Lattes e retorna todos os itens encontrados (sem marcar duplicatas).
pub fn parse_lattes_xml(path: &Path) -> Result<Vec<XmlProduction>, String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("Falha ao ler '{}': {}", path.display(), e))?;
    let text = decode_bytes(&bytes);
    if !text.contains("CURRICULO-VITAE") {
        return Err(
            "O arquivo não parece ser um XML do Currículo Lattes (CURRICULO-VITAE ausente)".into(),
        );
    }
    let mut reader = Reader::from_str(&text);
    let mut stack: Vec<String> = Vec::new();
    let mut current: Option<Builder> = None;
    let mut ap_inst: Option<String> = None;
    let mut proj_orgao: Option<String> = None;
    let mut ensino: Option<EnsinoCtx> = None;
    let mut disc_buf: Option<(HashMap<String, String>, String)> = None;
    let mut lattes_year: Option<i64> = None;
    let mut out = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                stack.push(name.clone());
                let depth = stack.len();

                if let Some(b) = current.as_mut() {
                    if name.starts_with("DADOS-BASICOS") {
                        b.basic.extend(attrs_of(&e));
                    } else if name.starts_with("DETALHAMENTO") {
                        b.detail.extend(attrs_of(&e));
                    } else if name == "REGISTRO-OU-PATENTE" {
                        b.registro.extend(attrs_of(&e));
                    } else if name == "INFORMACOES-ADICIONAIS" {
                        b.extra.extend(attrs_of(&e));
                    } else if name == "AUTORES" {
                        b.push_autor(&attrs_of(&e));
                    }
                } else if let Some((cat, elem, tipo, folder)) = lookup_kind(&name) {
                    current = Some(Builder {
                        category: cat,
                        elem,
                        tipo,
                        folder,
                        depth,
                        basic: HashMap::new(),
                        detail: HashMap::new(),
                        registro: HashMap::new(),
                        extra: HashMap::new(),
                        autores: Vec::new(),
                    });
                } else {
                    let a = attrs_of(&e);
                    if name == "CURRICULO-VITAE" {
                        if let Some(d) = a.get("DATA-ATUALIZACAO") {
                            if d.len() >= 4 {
                                lattes_year = d[d.len() - 4..].parse::<i64>().ok();
                            }
                        }
                    }
                    out.extend(parse_dadosgerais_elem(&name, &a, lattes_year));
                    match name.as_str() {
                        "ATUACAO-PROFISSIONAL" => {
                            ap_inst = first_attr(&a, &["NOME-INSTITUICAO"]);
                        }
                        "PARTICIPACAO-EM-PROJETO" => {
                            proj_orgao = first_attr(&a, &["NOME-ORGAO"]);
                        }
                        "ENSINO" => {
                            let (tipo, folder) = ensino_tipo_folder(
                                a.get("TIPO-ENSINO").map(|s| s.as_str()).unwrap_or(""),
                            );
                            ensino = Some(EnsinoCtx {
                                tipo,
                                folder,
                                ano: first_attr(&a, &["ANO-INICIO", "ANO-FIM"])
                                    .and_then(|s| parse_year_str(&s)),
                                curso: first_attr(&a, &["NOME-CURSO"]).map(|c| clean_text(&c)),
                                instituicao: ap_inst
                                    .as_deref()
                                    .map(clean_text)
                                    .filter(|s| !s.is_empty()),
                            });
                        }
                        "DISCIPLINA" if ensino.is_some() => {
                            disc_buf = Some((a, String::new()));
                        }
                        "DIRECAO-E-ADMINISTRACAO" => {
                            if let Some(it) = parse_direcao_elem(&a, ap_inst.as_deref()) {
                                out.push(it);
                            }
                        }
                        "CONSELHO-COMISSAO-E-CONSULTORIA" => {
                            if let Some(it) = parse_conselho_elem(&a, ap_inst.as_deref()) {
                                out.push(it);
                            }
                        }
                        "PROJETO-DE-PESQUISA" => {
                            if let Some(it) =
                                parse_projeto_elem(&a, proj_orgao.as_deref(), ap_inst.as_deref())
                            {
                                out.push(it);
                            }
                        }
                        "PREMIO-TITULO" => {
                            if let Some(it) = parse_premio_elem(&a) {
                                out.push(it);
                            }
                        }
                        other => {
                            let in_comp = stack.iter().any(|s| s == "FORMACAO-COMPLEMENTAR");
                            if let Some(it) = parse_formacao_elem(other, &a, in_comp) {
                                out.push(it);
                            }
                        }
                    }
                }
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if let Some(b) = current.as_mut() {
                    if name.starts_with("DADOS-BASICOS") {
                        b.basic.extend(attrs_of(&e));
                    } else if name.starts_with("DETALHAMENTO") {
                        b.detail.extend(attrs_of(&e));
                    } else if name == "REGISTRO-OU-PATENTE" {
                        b.registro.extend(attrs_of(&e));
                    } else if name == "INFORMACOES-ADICIONAIS" {
                        b.extra.extend(attrs_of(&e));
                    } else if name == "AUTORES" {
                        b.push_autor(&attrs_of(&e));
                    }
                } else {
                    let a = attrs_of(&e);
                    if name == "CURRICULO-VITAE" {
                        if let Some(d) = a.get("DATA-ATUALIZACAO") {
                            if d.len() >= 4 {
                                lattes_year = d[d.len() - 4..].parse::<i64>().ok();
                            }
                        }
                    }
                    out.extend(parse_dadosgerais_elem(&name, &a, lattes_year));
                    match name.as_str() {
                        "DISCIPLINA" => {
                            if let Some(ctx) = ensino.as_ref() {
                                if let Some(d) = first_attr(&a, &["NOME-DISCIPLINA"]) {
                                    if let Some(it) = emit_disciplina(ctx, &d) {
                                        out.push(it);
                                    }
                                }
                            }
                        }
                        "DIRECAO-E-ADMINISTRACAO" => {
                            if let Some(it) = parse_direcao_elem(&a, ap_inst.as_deref()) {
                                out.push(it);
                            }
                        }
                        "CONSELHO-COMISSAO-E-CONSULTORIA" => {
                            if let Some(it) = parse_conselho_elem(&a, ap_inst.as_deref()) {
                                out.push(it);
                            }
                        }
                        "PROJETO-DE-PESQUISA" => {
                            if let Some(it) =
                                parse_projeto_elem(&a, proj_orgao.as_deref(), ap_inst.as_deref())
                            {
                                out.push(it);
                            }
                        }
                        "PREMIO-TITULO" => {
                            if let Some(it) = parse_premio_elem(&a) {
                                out.push(it);
                            }
                        }
                        other => {
                            let in_comp = stack.iter().any(|s| s == "FORMACAO-COMPLEMENTAR");
                            if let Some(it) = parse_formacao_elem(other, &a, in_comp) {
                                out.push(it);
                            }
                        }
                    }
                }
            }
            Ok(Event::Text(e)) => {
                if let Some((_, ref mut buf)) = disc_buf {
                    let raw = String::from_utf8_lossy(e.as_ref()).to_string();
                    let unesc = quick_xml::escape::unescape(&raw)
                        .map(|c| c.to_string())
                        .unwrap_or(raw);
                    buf.push_str(&unesc);
                }
            }
            Ok(Event::CData(e)) => {
                if let Some((_, ref mut buf)) = disc_buf {
                    buf.push_str(&String::from_utf8_lossy(e.as_ref()));
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let depth = stack.len();
                if let Some(b) = current.as_ref() {
                    if depth == b.depth && name == b.elem {
                        if let Some(p) = current.take().and_then(Builder::finish) {
                            out.push(p);
                        }
                    }
                }
                match name.as_str() {
                    "DISCIPLINA" => {
                        if let Some((attrs, buf)) = disc_buf.take() {
                            if let Some(ctx) = ensino.as_ref() {
                                let raw = if buf.trim().is_empty() {
                                    first_attr(&attrs, &["NOME-DISCIPLINA"]).unwrap_or_default()
                                } else {
                                    buf
                                };
                                if let Some(it) = emit_disciplina(ctx, &raw) {
                                    out.push(it);
                                }
                            }
                        }
                    }
                    "ENSINO" => {
                        ensino = None;
                        disc_buf = None;
                    }
                    "PARTICIPACAO-EM-PROJETO" => proj_orgao = None,
                    "ATUACAO-PROFISSIONAL" => ap_inst = None,
                    _ => {}
                }
                stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(format!(
                    "XML inválido na posição {}: {}",
                    reader.buffer_position(),
                    e
                ))
            }
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
    #[serde(default)]
    pub departamento: String,
    #[serde(default)]
    pub cargo: String,
    #[serde(default)]
    pub regime: String,
    #[serde(default)]
    pub admissao: String,
}

fn fmt_ddmmyyyy(s: &str) -> String {
    if s.len() == 8 && s.chars().all(|c| c.is_ascii_digit()) {
        format!("{}/{}/{}", &s[0..2], &s[2..4], &s[4..8])
    } else {
        s.to_string()
    }
}

struct VinculoCandidate {
    score: (bool, bool, bool, i64),
    cargo: String,
    regime: String,
    admissao: String,
}

/// Lê nome, ID, ORCID, vínculos, data de atualização e resumo do CV do XML Lattes.
pub fn parse_profile(path: &Path) -> Result<LattesProfile, String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("Falha ao ler '{}': {}", path.display(), e))?;
    let text = decode_bytes(&bytes);
    let mut reader = Reader::from_str(&text);
    let mut p = LattesProfile::default();
    let mut ap_inst = String::new();
    let mut best_vinculo: Option<VinculoCandidate> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let a = attrs_of(&e);
                if name == "ATUACAO-PROFISSIONAL" {
                    ap_inst = a.get("NOME-INSTITUICAO").cloned().unwrap_or_default();
                }
                if handle_profile_element(&name, &a, &ap_inst, &mut p, &mut best_vinculo) {
                    break;
                }
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let a = attrs_of(&e);
                if handle_profile_element(&name, &a, &ap_inst, &mut p, &mut best_vinculo) {
                    break;
                }
            }
            Ok(Event::End(e)) => {
                if e.name().as_ref() == b"ATUACAO-PROFISSIONAL" {
                    ap_inst.clear();
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML inválido: {}", e)),
            _ => {}
        }
    }
    if p.nome.is_empty() {
        return Err(
            "O arquivo não parece ser um XML do Currículo Lattes (DADOS-GERAIS ausente)".into(),
        );
    }
    if let Some(v) = best_vinculo {
        p.cargo = v.cargo;
        p.regime = v.regime;
        p.admissao = v.admissao;
    }
    if !p.lattes_id.is_empty() {
        p.lattes_url = format!("http://lattes.cnpq.br/{}", p.lattes_id);
    }
    Ok(p)
}

fn handle_profile_element(
    name: &str,
    a: &HashMap<String, String>,
    ap_inst: &str,
    p: &mut LattesProfile,
    best_vinculo: &mut Option<VinculoCandidate>,
) -> bool {
    let g = |k: &str| a.get(k).cloned().unwrap_or_default();
    match name {
        "CURRICULO-VITAE" => {
            p.lattes_id = g("NUMERO-IDENTIFICADOR");
            p.atualizacao = fmt_ddmmyyyy(&g("DATA-ATUALIZACAO"));
        }
        "DADOS-GERAIS" => {
            p.nome = g("NOME-COMPLETO");
            p.nome_citacoes = g("NOME-EM-CITACOES-BIBLIOGRAFICAS");
            p.orcid = g("ORCID-ID");
            p.nacionalidade = g("PAIS-DE-NACIONALIDADE");
            let (cid, uf) = (g("CIDADE-NASCIMENTO"), g("UF-NASCIMENTO"));
            p.naturalidade = [cid, uf]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" – ");
            p.data_nascimento = fmt_ddmmyyyy(&g("DATA-NASCIMENTO"));
            let cpf = g("CPF");
            p.cpf = if cpf.len() == 11 && cpf.chars().all(|c| c.is_ascii_digit()) {
                format!("{}.{}.{}-{}", &cpf[0..3], &cpf[3..6], &cpf[6..9], &cpf[9..])
            } else {
                cpf
            };
            let rg = g("NUMERO-IDENTIDADE");
            let org = [g("ORGAO-EMISSOR"), g("UF-ORGAO-EMISSOR")]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("/");
            p.rg = if rg.is_empty() || org.is_empty() {
                rg
            } else {
                format!("{} {}", rg, org)
            };
        }
        "ENDERECO-PROFISSIONAL" if p.instituicao.is_empty() => {
            p.instituicao = g("NOME-INSTITUICAO-EMPRESA");
            p.orgao = g("NOME-ORGAO");
            p.departamento = p.orgao.clone();
            p.unidade = g("NOME-UNIDADE");
            p.email = g("E-MAIL");
            p.website = g("HOME-PAGE");
            let tel = g("TELEFONE");
            if !tel.is_empty() {
                let ddd = g("DDD");
                p.telefone = if ddd.is_empty() {
                    tel
                } else {
                    format!("({}) {}", ddd, tel)
                };
            }
            let cep = g("CEP");
            let cep = if cep.len() == 8 {
                format!("{}-{}", &cep[..5], &cep[5..])
            } else {
                cep
            };
            let cidade = [g("CIDADE"), g("UF")]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("/");
            p.endereco = [
                g("LOGRADOURO-COMPLEMENTO"),
                g("BAIRRO"),
                cidade,
                if cep.is_empty() {
                    cep
                } else {
                    format!("CEP {}", cep)
                },
            ]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(", ");
        }
        "ENDERECO" => {
            if let Some(el) = a.get("ELETRONICO") {
                let mails: Vec<String> = el
                    .split(';')
                    .filter_map(|x| {
                        x.split_once(':')
                            .map(|(_, m)| m.trim().to_string())
                            .or_else(|| Some(x.trim().to_string()))
                    })
                    .filter(|m| m.contains('@'))
                    .collect();
                if p.email.is_empty() {
                    p.email = mails.first().cloned().unwrap_or_default();
                }
                p.email_alt = mails
                    .into_iter()
                    .find(|m| *m != p.email)
                    .unwrap_or_default();
            }
        }
        "AREA-DE-ATUACAO" if p.area.is_empty() => {
            p.area = [
                g("NOME-DA-AREA-DO-CONHECIMENTO"),
                g("NOME-DA-SUB-AREA-DO-CONHECIMENTO"),
                g("NOME-DA-ESPECIALIDADE"),
            ]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" › ");
        }
        "RESUMO-CV" => {
            p.resumo = g("TEXTO-RESUMO-CV-RH");
        }
        "VINCULOS" => {
            let current = g("ANO-FIM").is_empty();
            let emp = g("FLAG-VINCULO-EMPREGATICIO") == "SIM";
            if current || emp {
                let outro = g("OUTRO-ENQUADRAMENTO-FUNCIONAL-INFORMADO");
                let enq = g("ENQUADRAMENTO-FUNCIONAL");
                let cargo = if !outro.is_empty() {
                    outro
                } else if !enq.is_empty() && enq != "LIVRE" {
                    enq
                } else {
                    String::new()
                };
                if !cargo.is_empty() {
                    let same_inst =
                        !p.instituicao.is_empty() && ap_inst.eq_ignore_ascii_case(&p.instituicao);
                    let ano_ini = g("ANO-INICIO").parse::<i64>().unwrap_or(0);
                    let score = (current, same_inst, emp, ano_ini);
                    let replace = best_vinculo.as_ref().is_none_or(|b| score > b.score);
                    if replace {
                        let regime = if g("FLAG-DEDICACAO-EXCLUSIVA") == "SIM" {
                            "Dedicação Exclusiva".to_string()
                        } else {
                            g("CARGA-HORARIA-SEMANAL")
                        };
                        let mes = g("MES-INICIO");
                        let ano = g("ANO-INICIO");
                        let admissao = match (mes.is_empty(), ano.is_empty()) {
                            (false, false) => format!("{}/{}", mes, ano),
                            (true, false) => ano,
                            _ => String::new(),
                        };
                        *best_vinculo = Some(VinculoCandidate {
                            score,
                            cargo,
                            regime,
                            admissao,
                        });
                    }
                }
            }
        }
        "PRODUCAO-BIBLIOGRAFICA" => return true,
        _ => {}
    }
    false
}

/// Índice de títulos já cadastrados: igualdade exata + similaridade por trigramas
/// (pega variações como "toward" × "towards").
#[derive(Default)]
struct TitleIndex {
    exact: HashSet<String>,
    tri: Vec<HashSet<String>>,
}

impl TitleIndex {
    fn insert(&mut self, title: &str) {
        let key = normalize_title(title);
        if key.is_empty() {
            return;
        }
        self.exact.insert(key);
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

struct MultiTitleIndex {
    by_cat: HashMap<&'static str, TitleIndex>,
    /// Para disciplinas, compara título normalizado + ano para evitar falso positivo entre anos distintos.
    disciplinas: HashSet<(String, Option<i64>)>,
}

impl MultiTitleIndex {
    fn from_db(conn: &Connection) -> Result<Self, String> {
        let mut by_cat: HashMap<&'static str, TitleIndex> = HashMap::new();
        for &(cat, sql) in &[
            ("producoes", "SELECT titulo FROM producoes WHERE titulo IS NOT NULL"),
            ("orientacoes", "SELECT titulo FROM orientacoes WHERE titulo IS NOT NULL"),
            ("bancas", "SELECT titulo FROM bancas WHERE titulo IS NOT NULL"),
            ("dadosgerais", "SELECT descricao FROM dadosgerais WHERE descricao IS NOT NULL"),
            ("formacao", "SELECT descricao FROM formacao WHERE descricao IS NOT NULL"),
            ("encargos", "SELECT COALESCE(titulo, descricao) FROM atuacao WHERE COALESCE(titulo, descricao) IS NOT NULL"),
            ("projetos", "SELECT descricao FROM projetos WHERE descricao IS NOT NULL"),
            ("patentes", "SELECT descricao FROM patentes WHERE descricao IS NOT NULL"),
            ("eventos", "SELECT descricao FROM eventos WHERE descricao IS NOT NULL"),
        ] {
            let mut idx = TitleIndex::default();
            let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
            for t in rows.flatten() {
                idx.insert(&t);
            }
            by_cat.insert(cat, idx);
        }

        let mut disciplinas = HashSet::new();
        let mut stmt = conn
            .prepare("SELECT COALESCE(titulo, descricao), ano FROM atuacao WHERE COALESCE(titulo, descricao) IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for (d, ano) in rows.flatten() {
            let key = normalize_title(&d);
            if !key.is_empty() {
                disciplinas.insert((key, ano));
            }
        }

        Ok(Self {
            by_cat,
            disciplinas,
        })
    }

    fn seen_or_insert(&mut self, it: &XmlProduction) -> bool {
        let cat = effective_category(&it.category);
        if cat == "disciplinas" {
            let raw = it.disciplina.as_deref().unwrap_or(&it.titulo);
            let key = normalize_title(raw);
            if key.is_empty() {
                return true;
            }
            return !self.disciplinas.insert((key, it.ano));
        }
        let text = match cat {
            "dadosgerais" | "formacao" | "encargos" | "projetos" | "patentes" | "eventos" => {
                it.descricao.as_deref().unwrap_or(&it.titulo)
            }
            _ => it.titulo.as_str(),
        };
        self.by_cat.entry(cat).or_default().seen_or_insert(text)
    }
}

/// Parse + marca duplicatas contra todas as 10 tabelas e dentro do próprio arquivo.
pub fn preview(conn: &Connection, path: &Path) -> Result<Vec<XmlProduction>, String> {
    let mut items = parse_lattes_xml(path)?;
    let mut existing = MultiTitleIndex::from_db(conn)?;
    let folders = mapping_folders(conn);
    for it in items.iter_mut() {
        it.duplicate = existing.seen_or_insert(it);
        let grp = category_group(&it.category).to_lowercase();
        if let Some(f) = folders.get(&(grp, it.tipo.to_lowercase())) {
            it.folder = f.clone();
        }
    }
    items.sort_by(|a, b| {
        b.ano
            .cmp(&a.ano)
            .then(a.category.cmp(&b.category))
            .then(a.tipo.cmp(&b.tipo))
    });
    Ok(items)
}

fn mapping_folders(conn: &Connection) -> HashMap<(String, String), String> {
    let mut m = HashMap::new();
    if let Ok(mut stmt) =
        conn.prepare("SELECT category_group, description, folder FROM subfolder_mappings")
    {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        }) {
            for (g, d, f) in rows.flatten() {
                m.insert((g.to_lowercase(), d.to_lowercase()), f);
            }
        }
    }
    m
}

/// Autores em JSON para a coluna `producoes.autores` (`None` se o XML não trouxe autores).
pub fn autores_json(autores: &[XmlAutor]) -> Option<String> {
    (!autores.is_empty()).then(|| serde_json::to_string(autores).unwrap_or_default())
}

/// Insere os itens selecionados nas suas respectivas categorias. Cria mapeamentos de subpasta para tipos novos.
/// Retorna a quantidade inserida.
pub fn import_items(
    conn: &mut Connection,
    root_dir: &Path,
    items: &[XmlProduction],
) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut folders = mapping_folders(&tx);
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let log = format!("XML Lattes {}", now);
    let mut existing = MultiTitleIndex::from_db(&tx)?;
    let mut n = 0;

    for it in items {
        if existing.seen_or_insert(it) {
            continue; // nunca duplica
        }
        let cat = effective_category(&it.category);
        let group = category_group(cat);
        let map_key = (group.to_lowercase(), it.tipo.to_lowercase());
        let folder = match folders.get(&map_key) {
            Some(f) => f.clone(),
            None => {
                tx.execute(
                    "INSERT INTO subfolder_mappings (category_group, description, folder) VALUES (?1, ?2, ?3)",
                    params![group, it.tipo, it.folder],
                )
                .map_err(|e| e.to_string())?;
                let _ = std::fs::create_dir_all(crate::files::rel_join(root_dir, &it.folder));
                folders.insert(map_key, it.folder.clone());
                it.folder.clone()
            }
        };

        let desc = it.descricao.as_deref().unwrap_or(&it.titulo);
        match cat {
            "dadosgerais" => {
                tx.execute(
                    "INSERT INTO dadosgerais (ano, tipo, identifier, file, folder, descricao, log, path, url) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, NULL, ?7)",
                    params![it.ano, it.tipo, it.doi, folder, desc, log, it.url],
                )
            }
            "formacao" => {
                tx.execute(
                    "INSERT INTO formacao (ano, tipo, identifier, file, folder, descricao, horas, log, path, url) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, NULL, ?8)",
                    params![it.ano, it.tipo, it.doi, folder, desc, it.horas, log, it.url],
                )
            }
            "encargos" => {
                let inst = it.journal.as_deref().unwrap_or("UFSC");
                tx.execute(
                    "INSERT INTO atuacao (ano, tipo, instituicao, titulo, descricao, horas, identifier, file, folder, log, path, url) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, NULL, ?10)",
                    params![it.ano, it.tipo, inst, desc, desc, it.horas, it.doi, folder, log, it.url],
                )
            }
            "disciplinas" => {
                let disc = it.disciplina.as_deref().unwrap_or(&it.titulo);
                let inst = it.journal.as_deref().or(it.curso.as_deref()).unwrap_or("");
                let full_desc = match it.curso.as_deref().filter(|c| !c.is_empty()) {
                    Some(c) if !inst.eq_ignore_ascii_case(c) => format!("{} ({})", disc, c),
                    _ => disc.to_string(),
                };
                tx.execute(
                    "INSERT INTO atuacao (ano, tipo, instituicao, titulo, enquadramento, horas, descricao, identifier, file, folder, log, path, url) VALUES (?1, ?2, ?3, ?4, 'Docente', ?5, ?6, ?7, NULL, ?8, ?9, NULL, ?10)",
                    params![it.ano, it.tipo, inst, disc, it.horas, full_desc, it.doi, folder, log, it.url],
                )
            }
            "projetos" => {
                tx.execute(
                    "INSERT INTO projetos (ano, tipo, identifier, file, folder, descricao, log, path, url) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, NULL, ?7)",
                    params![it.ano, it.tipo, it.doi, folder, desc, log, it.url],
                )
            }
            "patentes" => {
                tx.execute(
                    "INSERT INTO patentes (ano, tipo, identifier, file, folder, descricao, log, path, url) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, NULL, ?7)",
                    params![it.ano, it.tipo, it.doi, folder, desc, log, it.url],
                )
            }
            "eventos" => {
                tx.execute(
                    "INSERT INTO eventos (ano, tipo, identifier, file, folder, descricao, log, path, url) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, NULL, ?7)",
                    params![it.ano, it.tipo, it.doi, folder, desc, log, it.url],
                )
            }
            "orientacoes" => {
                tx.execute(
                    "INSERT INTO orientacoes (ano, tipo, identifier, file, folder, aluno, titulo, log, path, url) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, NULL, ?8)",
                    params![it.ano, it.tipo, it.doi, folder, it.aluno, it.titulo, log, it.url],
                )
            }
            "bancas" => {
                tx.execute(
                    "INSERT INTO bancas (ano, tipo, identifier, file, folder, aluno, titulo, log, path, url) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, NULL, ?8)",
                    params![it.ano, it.tipo, it.doi, folder, it.aluno, it.titulo, log, it.url],
                )
            }
            _ => {
                tx.execute(
                    "INSERT INTO producoes (ano, tipo, identifier, file, folder, titulo, journal, qualis, log, path, url, autores) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, '', ?7, NULL, ?8, ?9)",
                    params![it.ano, it.tipo, it.doi, folder, it.titulo, it.journal, log, it.url, autores_json(&it.autores)],
                )
            }
        }
        .map_err(|e| e.to_string())?;
        n += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);");
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_temp_xml(name: &str, body: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("lattes_xml_tests");
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join(name);
        std::fs::write(&p, body.as_bytes()).unwrap();
        p
    }

    #[test]
    fn normalizes_titles() {
        assert_eq!(
            normalize_title("Efeitos de Fungicidas, na Soja!"),
            normalize_title("efeitos de fungicidas na soja")
        );
        assert_eq!(normalize_title("Ação"), "acao");
    }

    #[test]
    fn parses_real_file_if_present() {
        let p = Path::new(r"d:\Desktop\UFSC\lattes\lattes_xml.xml");
        if !p.exists() {
            return;
        }
        let items = parse_lattes_xml(p).unwrap();
        assert!(
            items
                .iter()
                .filter(|i| i.tipo == "Artigos completos")
                .count()
                >= 100
        );
        assert!(items.iter().all(|i| !i.titulo.is_empty()));
        assert!(items.iter().any(|i| i.titulo.contains("Fungicidas")));
        let cats: HashSet<&str> = items.iter().map(|i| i.category.as_str()).collect();
        for expected in [
            "producoes",
            "formacao",
            "orientacoes",
            "bancas",
            "eventos",
            "disciplinas",
            "projetos",
            "patentes",
            "encargos",
            "dadosgerais",
        ] {
            assert!(cats.contains(expected), "categoria ausente: {}", expected);
        }
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
        assert!(
            prof.endereco.contains("Florianópolis/SC"),
            "{}",
            prof.endereco
        );
        assert!(prof.area.starts_with("Agronomia"), "{}", prof.area);
        assert!(prof.email_alt.contains('@') && prof.email_alt != prof.email);
        assert_eq!(prof.telefone, "(48) 37215327");
        assert_eq!(prof.departamento, "Reitoria");
        assert_eq!(prof.cargo, "Professor Adjunto");
        assert_eq!(prof.regime, "Dedicação Exclusiva");
        assert_eq!(prof.admissao, "01/2022");
    }

    #[test]
    fn cleans_html_from_titles() {
        assert_eq!(
            clean_text("strawberry (Fragaria x ananassa)</i> production"),
            "strawberry (Fragaria x ananassa) production"
        );
        assert_eq!(
            clean_text("Gower&#146;s algorithm"),
            "Gower\u{2019}s algorithm"
        );
        assert_eq!(
            clean_text("<i>Solanum  melongena</i> L."),
            "Solanum melongena L."
        );
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
        let conn =
            Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let items = preview(&conn, p).unwrap();
        let mut by: std::collections::BTreeMap<String, (usize, usize)> = Default::default();
        for i in &items {
            let e = by.entry(i.tipo.clone()).or_default();
            if i.duplicate {
                e.1 += 1
            } else {
                e.0 += 1
            }
        }
        println!("total={} -> {:?}", items.len(), by);
    }

    #[test]
    fn profile_ignores_coauthor_orcid_and_extracts_vinculo() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<CURRICULO-VITAE NUMERO-IDENTIFICADOR="1234567890123456" DATA-ATUALIZACAO="14112026">
  <DADOS-GERAIS NOME-COMPLETO="Docente Teste" ORCID-ID="">
    <ENDERECO>
      <ENDERECO-PROFISSIONAL NOME-INSTITUICAO-EMPRESA="UFSC" NOME-ORGAO="Depto Fitotecnia" NOME-UNIDADE="CCA" E-MAIL="d@ufsc.br"/>
    </ENDERECO>
    <ATUACOES-PROFISSIONAIS>
      <ATUACAO-PROFISSIONAL NOME-INSTITUICAO="UFSC">
        <VINCULOS ENQUADRAMENTO-FUNCIONAL="LIVRE" OUTRO-ENQUADRAMENTO-FUNCIONAL-INFORMADO="Professor Titular" FLAG-DEDICACAO-EXCLUSIVA="NAO" CARGA-HORARIA-SEMANAL="40" MES-INICIO="03" ANO-INICIO="2019" ANO-FIM="" FLAG-VINCULO-EMPREGATICIO="SIM"/>
      </ATUACAO-PROFISSIONAL>
    </ATUACOES-PROFISSIONAIS>
  </DADOS-GERAIS>
  <PRODUCAO-BIBLIOGRAFICA>
    <ARTIGOS-PUBLICADOS>
      <ARTIGO-PUBLICADO>
        <DADOS-BASICOS-DO-ARTIGO TITULO-DO-ARTIGO="Artigo" ANO-DO-ARTIGO="2024"/>
        <AUTORES NOME-COMPLETO-DO-AUTOR="Coautor" ORCID-ID="https://orcid.org/0000-0001-9999-8888"/>
      </ARTIGO-PUBLICADO>
    </ARTIGOS-PUBLICADOS>
  </PRODUCAO-BIBLIOGRAFICA>
</CURRICULO-VITAE>"#;
        let p = write_temp_xml("orcid_bug.xml", xml);
        let prof = parse_profile(&p).unwrap();
        assert_eq!(
            prof.orcid, "",
            "ORCID de coautor não deve vazar para o perfil"
        );
        assert_eq!(prof.departamento, "Depto Fitotecnia");
        assert_eq!(prof.cargo, "Professor Titular");
        assert_eq!(prof.regime, "40");
        assert_eq!(prof.admissao, "03/2019");
    }

    #[test]
    fn reads_authors_in_order_and_imports_them() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<CURRICULO-VITAE DATA-ATUALIZACAO="14112026">
  <PRODUCAO-BIBLIOGRAFICA>
    <ARTIGOS-PUBLICADOS>
      <ARTIGO-PUBLICADO SEQUENCIA-PRODUCAO="1">
        <DADOS-BASICOS-DO-ARTIGO TITULO-DO-ARTIGO="Artigo com alunos" ANO-DO-ARTIGO="2024" DOI="10.1000/al"/>
        <DETALHAMENTO-DO-ARTIGO TITULO-DO-PERIODICO-OU-REVISTA="Revista"/>
        <AUTORES NOME-COMPLETO-DO-AUTOR="Segundo Autor" NOME-PARA-CITACAO="AUTOR, S." ORDEM-DE-AUTORIA="2"/>
        <AUTORES NOME-COMPLETO-DO-AUTOR="Primeira Autora" NOME-PARA-CITACAO="AUTORA, P.;AUTORA, PRIMEIRA" ORDEM-DE-AUTORIA="1"/>
      </ARTIGO-PUBLICADO>
    </ARTIGOS-PUBLICADOS>
  </PRODUCAO-BIBLIOGRAFICA>
</CURRICULO-VITAE>"#;
        let p = write_temp_xml("autores.xml", xml);
        let items = parse_lattes_xml(&p).unwrap();
        let art = items
            .iter()
            .find(|i| i.titulo == "Artigo com alunos")
            .unwrap();
        let nomes: Vec<&str> = art.autores.iter().map(|a| a.nome.as_str()).collect();
        assert_eq!(nomes, vec!["Primeira Autora", "Segundo Autor"]);
        assert_eq!(
            art.autores[0].citacao.as_deref(),
            Some("AUTORA, P.;AUTORA, PRIMEIRA")
        );

        let mut conn = crate::db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(
            import_items(&mut conn, tmp.path(), std::slice::from_ref(art)).unwrap(),
            1
        );
        let json: String = conn
            .query_row("SELECT autores FROM producoes", [], |r| r.get(0))
            .unwrap();
        let back: Vec<XmlAutor> = serde_json::from_str(&json).unwrap();
        assert_eq!(back, art.autores);
    }

    #[test]
    fn parses_all_10_categories_and_imports_to_db() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<CURRICULO-VITAE NUMERO-IDENTIFICADOR="9999999999999999" DATA-ATUALIZACAO="14112026">
  <DADOS-GERAIS NOME-COMPLETO="Pesquisador Exemplo">
    <FORMACAO-ACADEMICA-TITULACAO>
      <DOUTORADO NOME-CURSO="Ciência da Computação" NOME-INSTITUICAO="UFSC" ANO-DE-CONCLUSAO="2020"/>
      <ENSINO-FUNDAMENTAL-PRIMEIRO-GRAU NOME-INSTITUICAO="Escola Municipal" ANO-DE-CONCLUSAO="2005"/>
    </FORMACAO-ACADEMICA-TITULACAO>
    <ATUACOES-PROFISSIONAIS>
      <ATUACAO-PROFISSIONAL NOME-INSTITUICAO="UFSC">
        <ATIVIDADES-DE-DIRECAO-E-ADMINISTRACAO>
          <DIRECAO-E-ADMINISTRACAO CARGO-OU-FUNCAO="Coordenador de Graduação" NOME-ORGAO="CCA" ANO-INICIO="2023"/>
        </ATIVIDADES-DE-DIRECAO-E-ADMINISTRACAO>
        <ATIVIDADES-DE-CONSELHO-COMISSAO-E-CONSULTORIA>
          <CONSELHO-COMISSAO-E-CONSULTORIA ESPECIFICACAO="Comissão de Pesquisa" NOME-ORGAO="FIT" ANO-INICIO="2024"/>
        </ATIVIDADES-DE-CONSELHO-COMISSAO-E-CONSULTORIA>
        <ATIVIDADES-DE-ENSINO>
          <ENSINO TIPO-ENSINO="GRADUACAO" ANO-INICIO="2022" NOME-CURSO="Agronomia">
            <DISCIPLINA>FIT 5306 - Bioestatística &amp; Experimentação (60 h)</DISCIPLINA>
          </ENSINO>
          <ENSINO TIPO-ENSINO="GRADUACAO" ANO-INICIO="2023" NOME-CURSO="Agronomia">
            <DISCIPLINA>FIT 5306 - Bioestatística &amp; Experimentação (60 h)</DISCIPLINA>
          </ENSINO>
          <ENSINO TIPO-ENSINO="GRADUACAO" ANO-INICIO="2023" NOME-CURSO="Agronomia">
            <DISCIPLINA>FIT 5306 - Bioestatística &amp; Experimentação (60 h)</DISCIPLINA>
          </ENSINO>
        </ATIVIDADES-DE-ENSINO>
        <ATIVIDADES-DE-PARTICIPACAO-EM-PROJETO>
          <PARTICIPACAO-EM-PROJETO NOME-ORGAO="UFSC">
            <PROJETO-DE-PESQUISA NOME-DO-PROJETO="Projeto Genômica" NATUREZA="PESQUISA" ANO-INICIO="2023"/>
          </PARTICIPACAO-EM-PROJETO>
        </ATIVIDADES-DE-PARTICIPACAO-EM-PROJETO>
      </ATUACAO-PROFISSIONAL>
    </ATUACOES-PROFISSIONAIS>
    <PREMIOS-TITULOS>
      <PREMIO-TITULO NOME-DO-PREMIO-OU-TITULO="Prêmio Jovem Cientista" NOME-DA-ENTIDADE-PROMOTORA="CNPq" ANO-DA-PREMIACAO="2024"/>
    </PREMIOS-TITULOS>
  </DADOS-GERAIS>
  <PRODUCAO-BIBLIOGRAFICA>
    <ARTIGOS-PUBLICADOS>
      <ARTIGO-PUBLICADO>
        <DADOS-BASICOS-DO-ARTIGO TITULO-DO-ARTIGO="" TITULO-DO-ARTIGO-INGLES="English Only Title" ANO-DO-ARTIGO="2024" DOI="10.1000/xyz" HOME-PAGE-DO-TRABALHO="[http://https://example.org/paper]"/>
        <DETALHAMENTO-DO-ARTIGO TITULO-DO-PERIODICO-OU-REVISTA="Journal Test"/>
      </ARTIGO-PUBLICADO>
      <ARTIGO-PUBLICADO>
        <DADOS-BASICOS-DO-ARTIGO TITULO-DO-ARTIGO="Artigo com DOI no HomePage" ANO-DO-ARTIGO="2023" HOME-PAGE-DO-TRABALHO="[doi:10.1000/abc]"/>
        <DETALHAMENTO-DO-ARTIGO TITULO-DO-PERIODICO-OU-REVISTA="Revista Brasil"/>
      </ARTIGO-PUBLICADO>
    </ARTIGOS-PUBLICADOS>
  </PRODUCAO-BIBLIOGRAFICA>
  <PRODUCAO-TECNICA>
    <SOFTWARE>
      <DADOS-BASICOS-DO-SOFTWARE TITULO-DO-SOFTWARE="Pacote R Teste" ANO="2024"/>
      <DETALHAMENTO-DO-SOFTWARE FINALIDADE="Análise">
        <REGISTRO-OU-PATENTE CODIGO-DO-REGISTRO-OU-PATENTE="BR5120240001"/>
      </DETALHAMENTO-DO-SOFTWARE>
    </SOFTWARE>
    <PROCESSOS-OU-TECNICAS>
      <DADOS-BASICOS-DO-PROCESSOS-OU-TECNICAS TITULO-DO-PROCESSO="Processo Analítico" ANO="2022"/>
    </PROCESSOS-OU-TECNICAS>
    <DEMAIS-TIPOS-DE-PRODUCAO-TECNICA>
      <ORGANIZACAO-DE-EVENTO>
        <DADOS-BASICOS-DA-ORGANIZACAO-DE-EVENTO TITULO="Simpósio Sul" ANO="2023"/>
        <DETALHAMENTO-DA-ORGANIZACAO-DE-EVENTO INSTITUICAO-PROMOTORA="UFSC"/>
      </ORGANIZACAO-DE-EVENTO>
    </DEMAIS-TIPOS-DE-PRODUCAO-TECNICA>
  </PRODUCAO-TECNICA>
  <OUTRA-PRODUCAO>
    <ORIENTACOES-CONCLUIDAS>
      <OUTRAS-ORIENTACOES-CONCLUIDAS>
        <DADOS-BASICOS-DE-OUTRAS-ORIENTACOES-CONCLUIDAS NATUREZA="INICIACAO_CIENTIFICA" TITULO="Estudo de Fenotipagem" ANO="2024"/>
        <DETALHAMENTO-DE-OUTRAS-ORIENTACOES-CONCLUIDAS NOME-DO-ORIENTADO="Maria Silva" NOME-DA-INSTITUICAO="UFSC"/>
      </OUTRAS-ORIENTACOES-CONCLUIDAS>
    </ORIENTACOES-CONCLUIDAS>
  </OUTRA-PRODUCAO>
  <DADOS-COMPLEMENTARES>
    <FORMACAO-COMPLEMENTAR>
      <FORMACAO-COMPLEMENTAR-DE-EXTENSAO-UNIVERSITARIA NOME-CURSO="Curso R" NOME-INSTITUICAO="UFSC" ANO-DE-CONCLUSAO="2021" CARGA-HORARIA="40"/>
      <OUTROS NOME-CURSO="Oficina Extras" NOME-INSTITUICAO="UFSC" ANO-DE-CONCLUSAO="2022" CARGA-HORARIA="8"/>
    </FORMACAO-COMPLEMENTAR>
    <PARTICIPACAO-EM-BANCA-TRABALHOS-CONCLUSAO>
      <PARTICIPACAO-EM-BANCA-DE-EXAME-QUALIFICACAO>
        <DADOS-BASICOS-DA-PARTICIPACAO-EM-BANCA-DE-EXAME-QUALIFICACAO NATUREZA="Exame de qualificação de doutorado" TITULO="Tese Quali" ANO="2024"/>
        <DETALHAMENTO-DA-PARTICIPACAO-EM-BANCA-DE-EXAME-QUALIFICACAO NOME-DO-CANDIDATO="João Souza"/>
      </PARTICIPACAO-EM-BANCA-DE-EXAME-QUALIFICACAO>
    </PARTICIPACAO-EM-BANCA-TRABALHOS-CONCLUSAO>
    <PARTICIPACAO-EM-EVENTOS-CONGRESSOS>
      <OUTRAS-PARTICIPACOES-EM-EVENTOS-CONGRESSOS>
        <DADOS-BASICOS-DE-OUTRAS-PARTICIPACOES-EM-EVENTOS-CONGRESSOS TITULO="" ANO="2024"/>
        <DETALHAMENTO-DE-OUTRAS-PARTICIPACOES-EM-EVENTOS-CONGRESSOS NOME-DO-EVENTO="Congresso Brasileiro"/>
      </OUTRAS-PARTICIPACOES-EM-EVENTOS-CONGRESSOS>
    </PARTICIPACAO-EM-EVENTOS-CONGRESSOS>
  </DADOS-COMPLEMENTARES>
  <OUTROS NOME-CURSO="Ignorado Fora de Formacao Complementar" ANO-DE-CONCLUSAO="2022"/>
</CURRICULO-VITAE>"#;

        let p = write_temp_xml("all_10_cats.xml", xml);
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::schema::create_tables(&conn).unwrap();

        let items = preview(&conn, &p).unwrap();
        assert!(items.iter().all(|i| !i.titulo.is_empty()));
        assert!(
            !items.iter().any(|i| i.titulo.contains("Ignorado Fora")),
            "OUTROS fora de FORMACAO-COMPLEMENTAR não deve ser importado"
        );
        assert!(
            !items.iter().any(|i| i.titulo.contains("Escola Municipal")),
            "Ensino fundamental deve ser ignorado"
        );

        // Verificar URL e fallback de inglês e DOI
        let eng = items
            .iter()
            .find(|i| i.titulo == "English Only Title")
            .unwrap();
        assert_eq!(eng.url.as_deref(), Some("https://example.org/paper"));
        let doi_hp = items
            .iter()
            .find(|i| i.titulo == "Artigo com DOI no HomePage")
            .unwrap();
        assert_eq!(doi_hp.url, None);
        assert_eq!(doi_hp.doi.as_deref(), Some("10.1000/abc"));

        // Disciplinas em anos diferentes (2022 vs 2023) não são duplicatas; repetida em 2023 é duplicata
        let discs: Vec<&XmlProduction> = items
            .iter()
            .filter(|i| i.category == "disciplinas")
            .collect();
        assert_eq!(discs.len(), 3);
        assert_eq!(discs.iter().filter(|d| !d.duplicate).count(), 2);
        assert_eq!(discs.iter().filter(|d| d.duplicate).count(), 1);
        assert_eq!(discs[0].horas, Some(60));
        assert_eq!(discs[0].curso.as_deref(), Some("Agronomia"));

        // Software com código de registro
        let sw = items.iter().find(|i| i.category == "patentes").unwrap();
        assert_eq!(sw.doi.as_deref(), Some("BR5120240001"));

        // Evento sem TITULO usando NOME-DO-EVENTO
        assert!(items
            .iter()
            .any(|i| i.category == "eventos" && i.titulo == "Congresso Brasileiro"));

        // Importar não-duplicados
        let tmpdir = tempfile::tempdir().unwrap();
        let root_dir = tmpdir.path().join("lattes_xml_import_root");
        let _ = std::fs::create_dir_all(&root_dir);
        let to_import: Vec<XmlProduction> =
            items.iter().filter(|i| !i.duplicate).cloned().collect();
        let inserted = import_items(&mut conn, &root_dir, &to_import).unwrap();
        assert_eq!(inserted, to_import.len());

        // Verificar inserção nas tabelas de produções do XML (encargos e disciplinas vão para atuacao)
        for tbl in [
            "dadosgerais",
            "formacao",
            "atuacao",
            "projetos",
            "producoes",
            "patentes",
            "eventos",
            "orientacoes",
            "bancas",
        ] {
            let cnt: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {}", tbl), [], |r| r.get(0))
                .unwrap();
            assert!(cnt >= 1, "tabela {} deveria ter >= 1 registro", tbl);
        }

        // Re-preview deve marcar tudo como duplicata
        let items2 = preview(&conn, &p).unwrap();
        assert!(items2.iter().all(|i| i.duplicate));
    }
}
