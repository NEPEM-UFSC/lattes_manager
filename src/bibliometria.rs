//! Bibliometria das produções: identifica as pessoas por trás dos nomes de autor vindos do XML
//! do Lattes ("OLIVOTO, T.", "Tiago Olivoto", "OLIVOTO, TIAGO" são a mesma pessoa), grava as
//! tabelas `autores` e `producao_autores` e devolve os dados para a análise de coautoria e a
//! rede de colaboração (calculadas na interface, que filtra por período e tipo sem ida ao banco).
//!
//! Regras de identificação:
//! 1. sobrenome (último, sem "Junior/Filho/Neto") + primeiro prenome por extenso;
//! 2. nome abreviado ("SILVA, J. A.") vai para a única pessoa compatível com o mesmo sobrenome
//!    e as mesmas iniciais; se houver mais de uma (João e José Silva), fica separado;
//! 3. o ID Lattes do coautor junta variantes, exceto o ID mais frequente, que o Lattes costuma
//!    repetir por engano em coautores sem currículo vinculado (é o do próprio dono do currículo);
//! 4. mesclas manuais (`autor_mesclas`) juntam o que as regras não juntaram.

use crate::discentes::{match_author, tokens, Confianca};
use crate::migration::lattes_xml::XmlAutor;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap, HashSet};

const SUFIXOS: &[&str] = &[
    "junior", "jr", "filho", "neto", "sobrinho", "segundo", "terceiro",
];

#[derive(Debug, Clone, PartialEq)]
struct Pessoa {
    sobrenome: String,
    prenomes: Vec<String>,
}

impl Pessoa {
    fn primeiro(&self) -> Option<&str> {
        self.prenomes
            .first()
            .map(String::as_str)
            .filter(|p| p.chars().count() > 1)
    }

    fn iniciais(&self) -> Vec<char> {
        self.prenomes
            .iter()
            .filter_map(|p| p.chars().next())
            .collect()
    }
}

fn eh_sufixo(t: &str) -> bool {
    SUFIXOS.contains(&t)
}

/// Grafia simplificada para comparar nomes: Souza/Sousa, Luiz/Luis, Matheus/Mateus,
/// Thiago/Tiago, Kelly/Keli caem na mesma forma.
fn fon(t: &str) -> String {
    let s = t
        .replace("th", "t")
        .replace("ph", "f")
        .replace('y', "i")
        .replace('z', "s")
        .replace('w', "v")
        .replace('k', "c");
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if !out.ends_with(c) {
            out.push(c);
        }
    }
    out
}

/// Sobrenome e prenomes de um nome de autor, em qualquer das formas do Lattes:
/// "SOBRENOME, Prenomes", "Prenomes Sobrenome" ou "Sobrenome I. N.".
fn parse(nome: &str, citacao: Option<&str>) -> Option<Pessoa> {
    let src = if nome.trim().is_empty() {
        citacao?.split(';').next()?
    } else {
        nome
    };
    let (mut sur, given) = match src.split_once(',') {
        Some((s, g)) => (tokens(s), tokens(g)),
        None => {
            let mut t = tokens(src);
            if t.is_empty() {
                return None;
            }
            // "Olivoto T" / "Silva JA": iniciais no fim
            let i = t.iter().rposition(|w| w.chars().count() > 1).unwrap_or(0);
            if i + 1 < t.len() && t[0].chars().count() > 1 {
                let given = t.split_off(i + 1);
                (t, given)
            } else {
                while t.len() > 2 && t.last().is_some_and(|w| eh_sufixo(w)) {
                    t.pop();
                }
                let last = t.pop()?;
                (vec![last], t)
            }
        }
    };
    while sur.len() > 1 && sur.last().is_some_and(|w| eh_sufixo(w)) {
        sur.pop();
    }
    let sobrenome = fon(&sur.pop()?);
    Some(Pessoa {
        sobrenome,
        prenomes: given.iter().map(|g| fon(g)).collect(),
    })
}

/// Iniciais compatíveis: mesma primeira e nenhuma diferença onde as duas têm letra.
fn compativeis(a: &[char], b: &[char]) -> bool {
    !a.is_empty()
        && !b.is_empty()
        && a[0] == b[0]
        && a[1..].iter().zip(&b[1..]).all(|(x, y)| x == y)
}

/// Nome para exibir: "SOBRENOME, Prenomes" vira "Prenomes Sobrenome" e TUDO MAIÚSCULO vira
/// Nome Próprio (partículas em minúsculas, iniciais em maiúsculas).
fn pretty(nome: &str, citacao: Option<&str>) -> String {
    let src = if nome.trim().is_empty() {
        citacao
            .and_then(|c| c.split(';').next())
            .unwrap_or("")
            .trim()
    } else {
        nome.trim()
    };
    let ordered = match src.split_once(',') {
        Some((s, g)) if !g.trim().is_empty() => format!("{} {}", g.trim(), s.trim()),
        _ => src.to_string(),
    };
    let letters: Vec<char> = ordered.chars().filter(|c| c.is_alphabetic()).collect();
    let all_caps = !letters.is_empty() && letters.iter().all(|c| !c.is_lowercase());
    let words: Vec<String> = ordered
        .split_whitespace()
        .map(|w| {
            if !all_caps {
                return w.to_string();
            }
            let lower = w.to_lowercase();
            if crate::discentes::PARTICLES.contains(&lower.as_str()) {
                return lower;
            }
            if w.contains('.') || w.chars().filter(|c| c.is_alphabetic()).count() == 1 {
                return w.to_uppercase();
            }
            let mut cs = lower.chars();
            cs.next()
                .map(|f| f.to_uppercase().chain(cs).collect())
                .unwrap_or_default()
        })
        .collect();
    words.join(" ")
}

// ---------------- Dados devolvidos à interface ----------------

#[derive(Debug, Clone, Serialize)]
pub struct Orientado {
    pub aluno: String,
    /// Níveis das orientações desse aluno (Iniciação Científica, Mestrado...).
    pub niveis: Vec<String>,
    pub confianca: Confianca,
}

#[derive(Debug, Clone, Serialize)]
pub struct BiblioAutor {
    pub id: i64,
    pub chave: String,
    pub nome: String,
    /// O dono do currículo.
    pub eu: bool,
    pub lattes_id: Option<String>,
    /// Formas distintas em que o nome aparece nas produções.
    pub formas: Vec<String>,
    pub orientado: Option<Orientado>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BiblioProducao {
    pub id: i64,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub titulo: String,
    pub journal: Option<String>,
    pub qualis: Option<String>,
    /// Autores (ids de `autores`) na ordem de autoria, sem repetição.
    pub autores: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Mescla {
    pub chave: String,
    pub destino: String,
    pub nome: String,
    pub nome_destino: String,
}

#[derive(Debug, Default, Serialize)]
pub struct BiblioData {
    pub autores: Vec<BiblioAutor>,
    pub producoes: Vec<BiblioProducao>,
    pub mesclas: Vec<Mescla>,
    pub total_producoes: usize,
    /// Produções sem a lista de autores (não entram na análise).
    pub sem_autores: usize,
}

// ---------------- Identificação e gravação ----------------

struct Forma {
    nome: String,
    citacao: Option<String>,
    pessoa: Option<Pessoa>,
    ids: BTreeSet<String>,
    ocorrencias: usize,
    chave: String,
}

struct Prod {
    id: i64,
    ano: Option<i64>,
    tipo: Option<String>,
    titulo: String,
    journal: Option<String>,
    qualis: Option<String>,
    /// índices em `formas`, na ordem de autoria
    autores: Vec<usize>,
}

struct UnionFind(HashMap<String, String>);

impl UnionFind {
    fn find(&mut self, k: &str) -> String {
        let mut cur = k.to_string();
        let mut path = Vec::new();
        while let Some(p) = self.0.get(&cur) {
            if *p == cur {
                break;
            }
            path.push(cur.clone());
            cur = p.clone();
        }
        for p in path {
            self.0.insert(p, cur.clone());
        }
        cur
    }

    fn union(&mut self, a: &str, b: &str) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.0.insert(ra, rb);
        }
    }
}

fn load(conn: &Connection) -> Result<(Vec<Prod>, Vec<Forma>, usize), String> {
    let mut st = conn
        .prepare(
            "SELECT id, ano, tipo, titulo, journal, qualis, autores FROM producoes ORDER BY id",
        )
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut prods = Vec::new();
    let mut formas: Vec<Forma> = Vec::new();
    let mut idx: HashMap<(String, Option<String>), usize> = HashMap::new();
    let mut total = 0;
    for (id, ano, tipo, titulo, journal, qualis, autores) in rows.flatten() {
        total += 1;
        let lista: Vec<XmlAutor> = autores
            .as_deref()
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();
        if lista.is_empty() {
            continue;
        }
        let mut ids = Vec::new();
        for a in lista {
            if a.nome.trim().is_empty() && a.citacao.as_deref().unwrap_or("").trim().is_empty() {
                continue;
            }
            let k = (a.nome.trim().to_string(), a.citacao.clone());
            let i = *idx.entry(k).or_insert_with(|| {
                formas.push(Forma {
                    pessoa: parse(&a.nome, a.citacao.as_deref()),
                    nome: a.nome.trim().to_string(),
                    citacao: a.citacao.clone(),
                    ids: BTreeSet::new(),
                    ocorrencias: 0,
                    chave: String::new(),
                });
                formas.len() - 1
            });
            formas[i].ocorrencias += 1;
            if let Some(l) = a.lattes_id {
                formas[i].ids.insert(l);
            }
            ids.push(i);
        }
        prods.push(Prod {
            id,
            ano,
            tipo,
            titulo: titulo.unwrap_or_default(),
            journal,
            qualis,
            autores: ids,
        });
    }
    Ok((prods, formas, total))
}

/// Chave básica de cada forma (regras 1 e 2 do topo do arquivo). Com o mesmo sobrenome e o
/// mesmo primeiro prenome, segundos prenomes com iniciais diferentes ("José Eduardo" × "José
/// Antonio") separam as pessoas; quem não tem segundo prenome fica com a forma curta.
fn base_keys(formas: &mut [Forma]) {
    // iniciais do segundo prenome em cada (sobrenome, primeiro prenome)
    let mut segundos: HashMap<(String, String), BTreeSet<char>> = HashMap::new();
    for f in formas.iter() {
        if let Some(p) = &f.pessoa {
            if let Some(first) = p.primeiro() {
                let e = segundos
                    .entry((p.sobrenome.clone(), first.to_string()))
                    .or_default();
                if let Some(c) = p.prenomes.get(1).and_then(|w| w.chars().next()) {
                    e.insert(c);
                }
            }
        }
    }
    let chave_completa = |p: &Pessoa, first: &str| -> String {
        let base = format!("{}|{}", p.sobrenome, first);
        let ambiguo = segundos
            .get(&(p.sobrenome.clone(), first.to_string()))
            .is_some_and(|s| s.len() > 1);
        match p.prenomes.get(1).and_then(|w| w.chars().next()) {
            Some(c) if ambiguo => format!("{base}|{c}"),
            _ => base,
        }
    };
    // pessoas com prenome por extenso, por sobrenome: (chave, iniciais)
    let mut completos: HashMap<String, Vec<(String, Vec<char>)>> = HashMap::new();
    for f in formas.iter() {
        if let Some(p) = &f.pessoa {
            if let Some(first) = p.primeiro() {
                completos
                    .entry(p.sobrenome.clone())
                    .or_default()
                    .push((chave_completa(p, first), p.iniciais()));
            }
        }
    }
    for f in formas.iter_mut() {
        f.chave = match &f.pessoa {
            None => format!("?|{}", crate::db::fold(&f.nome)),
            Some(p) if p.prenomes.is_empty() => format!("{}|", p.sobrenome),
            Some(p) => match p.primeiro() {
                Some(first) => chave_completa(p, first),
                None => {
                    let ini = p.iniciais();
                    let cands: BTreeSet<&str> = completos
                        .get(&p.sobrenome)
                        .map(|v| {
                            v.iter()
                                .filter(|(_, i)| compativeis(&ini, i))
                                .map(|(k, _)| k.as_str())
                                .collect()
                        })
                        .unwrap_or_default();
                    if cands.len() == 1 {
                        cands.iter().next().unwrap().to_string()
                    } else {
                        let ini: Vec<String> = ini.iter().map(|c| format!("{c}.")).collect();
                        format!("{}|{}", p.sobrenome, ini.join(" "))
                    }
                }
            },
        };
    }
}

fn load_mesclas(conn: &Connection) -> Vec<(String, String)> {
    let Ok(mut st) = conn.prepare("SELECT chave, destino FROM autor_mesclas ORDER BY chave") else {
        return Vec::new();
    };
    st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

/// Reconstrói `autores` e `producao_autores` a partir de `producoes.autores` e devolve os dados.
pub fn rebuild(conn: &Connection) -> Result<BiblioData, String> {
    let (prods, mut formas, total) = load(conn)?;
    base_keys(&mut formas);

    let mut uf = UnionFind(HashMap::new());
    for f in &formas {
        uf.0.entry(f.chave.clone())
            .or_insert_with(|| f.chave.clone());
    }
    // regra 3: ID Lattes, exceto o mais frequente
    let mut id_count: HashMap<&str, usize> = HashMap::new();
    for f in &formas {
        for i in &f.ids {
            *id_count.entry(i.as_str()).or_default() += f.ocorrencias;
        }
    }
    let id_dono = id_count
        .iter()
        .max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0)))
        .map(|(k, _)| k.to_string());
    let mut por_id: HashMap<String, String> = HashMap::new();
    for f in &formas {
        for i in &f.ids {
            if Some(i) == id_dono.as_ref() {
                continue;
            }
            match por_id.get(i) {
                Some(k) => {
                    let k = k.clone();
                    uf.union(&f.chave, &k);
                }
                None => {
                    por_id.insert(i.clone(), f.chave.clone());
                }
            }
        }
    }
    // regra 4: mesclas manuais
    let mesclas = load_mesclas(conn);
    for (c, d) in &mesclas {
        if uf.0.contains_key(c) && uf.0.contains_key(d) {
            uf.union(c, d);
        }
    }

    // ocorrências por chave básica, para escolher o representante do grupo
    let mut occ: HashMap<String, usize> = HashMap::new();
    for f in &formas {
        *occ.entry(f.chave.clone()).or_default() += f.ocorrencias;
    }
    let root_of: Vec<String> = formas.iter().map(|f| uf.find(&f.chave)).collect();
    let mut grupos: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, root) in root_of.iter().enumerate() {
        grupos.entry(root.clone()).or_default().push(i);
    }
    // representante: a chave básica com mais ocorrências no grupo
    let mut rep_of_root: HashMap<String, String> = HashMap::new();
    for (root, membros) in &grupos {
        let rep = membros
            .iter()
            .map(|&i| formas[i].chave.as_str())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .max_by(|a, b| occ[*a].cmp(&occ[*b]).then(b.cmp(a)))
            .unwrap_or(root)
            .to_string();
        rep_of_root.insert(root.clone(), rep);
    }

    // produções distintas por grupo (para achar o dono do currículo)
    let mut prods_do_grupo: HashMap<&str, HashSet<i64>> = HashMap::new();
    for p in &prods {
        for &i in &p.autores {
            prods_do_grupo
                .entry(root_of[i].as_str())
                .or_default()
                .insert(p.id);
        }
    }
    let raiz_dono = prods_do_grupo
        .iter()
        .max_by(|a, b| a.1.len().cmp(&b.1.len()).then(b.0.cmp(a.0)))
        .map(|(k, _)| k.to_string());

    let melhor_forma = |membros: &[usize]| -> usize {
        *membros
            .iter()
            .max_by_key(|&&i| {
                let f = &formas[i];
                let p = f.pessoa.as_ref();
                // prenome por extenso, a forma mais usada, a mais completa
                (
                    p.and_then(Pessoa::primeiro).is_some(),
                    f.ocorrencias,
                    p.map(|p| p.prenomes.iter().filter(|w| w.chars().count() > 1).count())
                        .unwrap_or(0),
                    std::cmp::Reverse(f.nome.clone()),
                )
            })
            .unwrap_or(&membros[0])
    };

    let alunos = crate::discentes::load_alunos(conn).unwrap_or_default();

    // grupos em ordem estável (pelo representante) e ids sequenciais
    let mut roots: Vec<&String> = grupos.keys().collect();
    roots.sort_by_key(|r| rep_of_root[*r].clone());
    let mut autor_id_da_raiz: HashMap<&str, i64> = HashMap::new();
    let mut autores = Vec::with_capacity(roots.len());
    for (n, root) in roots.iter().enumerate() {
        let id = n as i64 + 1;
        autor_id_da_raiz.insert(root.as_str(), id);
        let membros = &grupos[*root];
        let best = melhor_forma(membros);
        let eu = raiz_dono.as_deref() == Some(root.as_str());
        let mut formas_txt: Vec<String> = membros
            .iter()
            .map(|&i| {
                let f = &formas[i];
                if f.nome.is_empty() {
                    f.citacao.clone().unwrap_or_default()
                } else {
                    f.nome.clone()
                }
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        formas_txt.retain(|s| !s.is_empty());
        let lattes_id = membros
            .iter()
            .flat_map(|&i| formas[i].ids.iter())
            .find(|i| Some(*i) != id_dono.as_ref() || eu)
            .cloned();
        let orientado = if eu {
            None
        } else {
            let xs: Vec<XmlAutor> = membros
                .iter()
                .map(|&i| {
                    // "SOBRENOME, Prenomes" também vale como forma de citação
                    let f = &formas[i];
                    let virgula = f.nome.contains(',');
                    XmlAutor {
                        nome: if virgula {
                            pretty(&f.nome, None)
                        } else {
                            f.nome.clone()
                        },
                        citacao: f
                            .citacao
                            .clone()
                            .or_else(|| virgula.then(|| f.nome.clone())),
                        lattes_id: None,
                    }
                })
                .collect();
            alunos
                .iter()
                .filter_map(|(key, orients)| {
                    let c = xs.iter().filter_map(|a| match_author(key, a)).max()?;
                    Some((c, orients))
                })
                .max_by(|a, b| a.0.cmp(&b.0).then(b.1[0].aluno.cmp(&a.1[0].aluno)))
                .map(|(confianca, orients)| Orientado {
                    aluno: orients[0].aluno.clone(),
                    niveis: orients
                        .iter()
                        .map(|o| o.tipo.clone())
                        .filter(|t| !t.is_empty())
                        .collect::<BTreeSet<_>>()
                        .into_iter()
                        .collect(),
                    confianca,
                })
        };
        autores.push(BiblioAutor {
            id,
            chave: rep_of_root[*root].clone(),
            nome: pretty(&formas[best].nome, formas[best].citacao.as_deref()),
            eu,
            lattes_id,
            formas: formas_txt,
            orientado,
        });
    }

    let id_da_forma = |i: usize| -> i64 {
        autor_id_da_raiz
            .get(root_of[i].as_str())
            .copied()
            .unwrap_or(0)
    };
    let mut producoes = Vec::with_capacity(prods.len());
    let mut vinculos: Vec<(i64, i64, i64, &str, Option<&str>)> = Vec::new();
    for p in &prods {
        let mut ids: Vec<i64> = Vec::new();
        for (ordem, &i) in p.autores.iter().enumerate() {
            let aid = id_da_forma(i);
            vinculos.push((
                p.id,
                ordem as i64 + 1,
                aid,
                formas[i].nome.as_str(),
                formas[i].citacao.as_deref(),
            ));
            if !ids.contains(&aid) {
                ids.push(aid);
            }
        }
        producoes.push(BiblioProducao {
            id: p.id,
            ano: p.ano,
            tipo: p.tipo.clone(),
            titulo: p.titulo.clone(),
            journal: p.journal.clone(),
            qualis: p.qualis.clone().filter(|q| !q.trim().is_empty()),
            autores: ids,
        });
    }

    // nome de cada chave básica, para listar as mesclas
    let mut nome_da_chave: HashMap<&str, String> = HashMap::new();
    for f in &formas {
        nome_da_chave
            .entry(f.chave.as_str())
            .or_insert_with(|| pretty(&f.nome, f.citacao.as_deref()));
    }
    let mesclas = mesclas
        .into_iter()
        .map(|(c, d)| Mescla {
            nome: nome_da_chave
                .get(c.as_str())
                .cloned()
                .unwrap_or_else(|| c.clone()),
            nome_destino: nome_da_chave
                .get(d.as_str())
                .cloned()
                .unwrap_or_else(|| d.clone()),
            chave: c,
            destino: d,
        })
        .collect();

    // grava
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("DELETE FROM producao_autores; DELETE FROM autores;")
        .map_err(|e| e.to_string())?;
    {
        let mut ins = tx
            .prepare("INSERT INTO autores (id, chave, nome, eu, lattes_id, formas) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
            .map_err(|e| e.to_string())?;
        for a in &autores {
            ins.execute(params![
                a.id,
                a.chave,
                a.nome,
                a.eu as i64,
                a.lattes_id,
                serde_json::to_string(&a.formas).unwrap_or_default()
            ])
            .map_err(|e| e.to_string())?;
        }
        let mut ins = tx
            .prepare("INSERT OR IGNORE INTO producao_autores (producao_id, ordem, autor_id, nome, citacao) VALUES (?1, ?2, ?3, ?4, ?5)")
            .map_err(|e| e.to_string())?;
        for (pid, ordem, aid, nome, cit) in &vinculos {
            ins.execute(params![pid, ordem, aid, nome, cit])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(BiblioData {
        autores,
        sem_autores: total - producoes.len(),
        producoes,
        mesclas,
        total_producoes: total,
    })
}

/// Junta os autores `chaves` ao autor `destino` (mescla manual, guardada para as próximas
/// reconstruções).
pub fn merge(conn: &Connection, chaves: &[String], destino: &str) -> Result<usize, String> {
    let mut n = 0;
    for c in chaves.iter().filter(|c| c.as_str() != destino) {
        n += conn
            .execute(
                "INSERT OR REPLACE INTO autor_mesclas (chave, destino) VALUES (?1, ?2)",
                params![c, destino],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(n)
}

/// Desfaz uma mescla manual.
pub fn unmerge(conn: &Connection, chave: &str) -> Result<usize, String> {
    conn.execute("DELETE FROM autor_mesclas WHERE chave = ?1", [chave])
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(nome: &str, cit: Option<&str>, id: Option<&str>) -> XmlAutor {
        XmlAutor {
            nome: nome.into(),
            citacao: cit.map(Into::into),
            lattes_id: id.map(Into::into),
        }
    }

    fn insert(conn: &Connection, id: i64, ano: i64, tipo: &str, autores: Vec<XmlAutor>) {
        conn.execute(
            "INSERT INTO producoes (id, ano, tipo, titulo, autores) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id,
                ano,
                tipo,
                format!("P{id}"),
                crate::migration::lattes_xml::autores_json(&autores)
            ],
        )
        .unwrap();
    }

    #[test]
    fn parses_name_forms() {
        let p = |n: &str| parse(n, None).map(|p| (p.sobrenome, p.prenomes));
        let v = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(p("Tiago Olivoto"), Some(("olivoto".into(), v(&["tiago"]))));
        assert_eq!(p("OLIVOTO, T."), Some(("olivoto".into(), v(&["t"]))));
        assert_eq!(
            p("Rafael Tunes de Resende"),
            Some(("resende".into(), v(&["rafael", "tunes"])))
        );
        assert_eq!(
            p("MOREIRA, ALISSON N.H."),
            Some(("moreira".into(), v(&["alison", "n", "h"])))
        );
        assert_eq!(
            p("José da Silva Neto"),
            Some(("silva".into(), v(&["jose"])))
        );
        assert_eq!(p("SILVA NETO, J."), Some(("silva".into(), v(&["j"]))));
        assert_eq!(p("Olivoto T"), Some(("olivoto".into(), v(&["t"]))));
        assert_eq!(p("XU, YUNBI"), Some(("xu".into(), v(&["iunbi"]))));
        // grafias equivalentes
        assert_eq!(p("Paulo Souza"), p("Paulo Sousa"));
        assert_eq!(p("Matheus Luiz"), p("Mateus Luis"));
        assert_eq!(
            parse("", Some("SANTOS, M. A.; SANTOS, MARIA")).map(|p| p.sobrenome),
            Some("santos".into())
        );
        assert_eq!(pretty("RESENDE, RAFAEL T.", None), "Rafael T. Resende");
        assert_eq!(
            pretty("FLORÊNCIO, BRUNA DE M.", None),
            "Bruna de M. Florêncio"
        );
        assert_eq!(pretty("Tiago Olivoto", None), "Tiago Olivoto");
    }

    #[test]
    fn groups_variants_and_finds_owner() {
        let conn = crate::db::open_in_memory().unwrap();
        let dono = Some("2432360896340086");
        insert(
            &conn,
            1,
            2020,
            "Artigos completos",
            vec![
                a("Tiago Olivoto", Some("OLIVOTO, T."), dono),
                a("Tamara Pereira", Some("PEREIRA, T."), dono), // ID do dono por engano
                a("RESENDE, RAFAEL T.", None, Some("1111111111111111")),
            ],
        );
        insert(
            &conn,
            2,
            2021,
            "Artigos completos",
            vec![
                a("OLIVOTO, TIAGO", None, dono),
                a("Rafael Tunes de Resende", None, None),
                a("SILVA, J.", None, None), // João ou José: fica separado
                a("Maria Souza Lima", None, Some("2222222222222222")),
            ],
        );
        insert(
            &conn,
            3,
            2022,
            "Resumos simples",
            vec![
                a("OLIVOTO, T.", None, None),
                a("João Silva", None, None),
                a("José Silva", None, None),
                a("José Eduardo Pimentel e Silva", None, None),
                a("José Antonio Gonzalez da Silva", None, None),
                a("Maria Souza", None, Some("2222222222222222")), // mesmo ID: mesma pessoa
                a("R. T. RESENDE", None, None),
            ],
        );
        insert(&conn, 4, 2022, "Livros", vec![]);

        let d = rebuild(&conn).unwrap();
        assert_eq!(
            (d.total_producoes, d.sem_autores, d.producoes.len()),
            (4, 1, 3)
        );
        let by = |nome: &str| {
            d.autores
                .iter()
                .find(|x| x.nome == nome)
                .unwrap_or_else(|| {
                    panic!(
                        "{nome}: {:?}",
                        d.autores.iter().map(|x| &x.nome).collect::<Vec<_>>()
                    )
                })
        };
        let eu = by("Tiago Olivoto");
        assert!(eu.eu);
        assert_eq!(eu.formas.len(), 3);
        assert!(!by("Tamara Pereira").eu);
        assert_eq!(by("Rafael Tunes de Resende").formas.len(), 3);
        assert!(d.autores.iter().any(|x| x.nome == "J. Silva"));
        assert!(d.autores.iter().any(|x| x.nome == "João Silva"));
        let maria: Vec<_> = d
            .autores
            .iter()
            .filter(|x| x.nome.starts_with("Maria"))
            .collect();
        assert_eq!(maria.len(), 1, "unidas pelo ID Lattes");
        // o dono aparece uma vez em cada produção
        assert!(d.producoes.iter().all(|p| p.autores.contains(&eu.id)));
        let n: i64 = conn
            .query_row("SELECT count(*) FROM producao_autores", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 14);
        // mesmo sobrenome e prenome, segundos prenomes diferentes: pessoas diferentes
        assert!(d
            .autores
            .iter()
            .any(|x| x.nome == "José Eduardo Pimentel e Silva"));
        assert!(d
            .autores
            .iter()
            .any(|x| x.nome == "José Antonio Gonzalez da Silva"));

        // mescla manual de "J. Silva" com "João Silva", e desfazer
        let js = by("J. Silva").chave.clone();
        let joao = by("João Silva").chave.clone();
        let total = d.autores.len();
        assert_eq!(merge(&conn, std::slice::from_ref(&js), &joao).unwrap(), 1);
        let d2 = rebuild(&conn).unwrap();
        assert_eq!(d2.autores.len(), total - 1);
        assert_eq!(d2.mesclas.len(), 1);
        assert_eq!(d2.mesclas[0].nome_destino, "João Silva");
        unmerge(&conn, &js).unwrap();
        assert_eq!(rebuild(&conn).unwrap().autores.len(), total);
    }

    #[test]
    fn flags_students() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO orientacoes (id, ano, tipo, aluno) VALUES (1, 2021, 'Dissertação de mestrado', 'Bruna de Moura Florêncio')",
            [],
        )
        .unwrap();
        insert(
            &conn,
            1,
            2022,
            "Artigos completos",
            vec![
                a("Tiago Olivoto", None, None),
                a("FLORÊNCIO, BRUNA DE M.", None, None),
            ],
        );
        insert(
            &conn,
            2,
            2023,
            "Artigos completos",
            vec![a("Tiago Olivoto", None, None)],
        );
        let d = rebuild(&conn).unwrap();
        let b = d.autores.iter().find(|x| !x.eu).unwrap();
        let o = b.orientado.as_ref().unwrap();
        assert_eq!(o.niveis, vec!["Dissertação de mestrado"]);
        assert!(d.autores.iter().find(|x| x.eu).unwrap().orientado.is_none());
    }
}
