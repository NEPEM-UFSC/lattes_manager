use rusqlite::{Connection, Result};

pub const SCHEMA_SQL: &str = r#"
-- Application metadata and settings
CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Subfolder mappings (from 'path' sheet)
CREATE TABLE IF NOT EXISTS subfolder_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_group TEXT NOT NULL,
    description TEXT NOT NULL,
    folder TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 1. dadosgerais (exact table name matching tests_e2e)
CREATE TABLE IF NOT EXISTS dadosgerais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    tipo TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    descricao TEXT,
    log TEXT,
    path TEXT
);

-- 2. formacao
CREATE TABLE IF NOT EXISTS formacao (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    tipo TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    descricao TEXT,
    horas INTEGER,
    log TEXT,
    path TEXT
);

-- 3. encargos
CREATE TABLE IF NOT EXISTS encargos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    tipo TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    descricao TEXT,
    horas INTEGER,
    log TEXT,
    path TEXT
);

-- 4. disciplinas
CREATE TABLE IF NOT EXISTS disciplinas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    tipo TEXT,
    curso TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    disciplina TEXT,
    horas INTEGER,
    alunos INTEGER,
    log TEXT,
    path TEXT
);

-- 5. projetos
CREATE TABLE IF NOT EXISTS projetos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    tipo TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    descricao TEXT,
    log TEXT,
    path TEXT
);

-- 6. producoes
CREATE TABLE IF NOT EXISTS producoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    tipo TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    titulo TEXT,
    journal TEXT,
    qualis TEXT,
    log TEXT,
    path TEXT
);

-- 7. patentes
CREATE TABLE IF NOT EXISTS patentes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    tipo TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    descricao TEXT,
    log TEXT,
    path TEXT
);

-- 8. eventos
CREATE TABLE IF NOT EXISTS eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    tipo TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    descricao TEXT,
    log TEXT,
    path TEXT
);

-- 9. orientacoes
CREATE TABLE IF NOT EXISTS orientacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    tipo TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    aluno TEXT,
    titulo TEXT,
    log TEXT,
    path TEXT
);

-- 10. bancas
CREATE TABLE IF NOT EXISTS bancas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    tipo TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    aluno TEXT,
    titulo TEXT,
    log TEXT,
    path TEXT
);

-- Performance Indices
CREATE INDEX IF NOT EXISTS idx_subfolder_group ON subfolder_mappings(category_group);
CREATE INDEX IF NOT EXISTS idx_dadosgerais_ano ON dadosgerais(ano);
CREATE INDEX IF NOT EXISTS idx_formacao_ano ON formacao(ano);
CREATE INDEX IF NOT EXISTS idx_encargos_ano ON encargos(ano);
CREATE INDEX IF NOT EXISTS idx_disciplinas_ano ON disciplinas(ano);
CREATE INDEX IF NOT EXISTS idx_projetos_ano ON projetos(ano);
CREATE INDEX IF NOT EXISTS idx_producoes_ano ON producoes(ano);
CREATE INDEX IF NOT EXISTS idx_patentes_ano ON patentes(ano);
CREATE INDEX IF NOT EXISTS idx_eventos_ano ON eventos(ano);
CREATE INDEX IF NOT EXISTS idx_orientacoes_ano ON orientacoes(ano);
CREATE INDEX IF NOT EXISTS idx_bancas_ano ON bancas(ano);
"#;

pub const CREATE_TABLES_SQL: &str = SCHEMA_SQL;

pub const ENTITY_TABLES: &[&str] = &[
    "dadosgerais",
    "formacao",
    "encargos",
    "disciplinas",
    "projetos",
    "producoes",
    "patentes",
    "eventos",
    "orientacoes",
    "bancas",
];

pub fn normalize_category(category: &str) -> Option<&'static str> {
    let lower = category.trim().to_lowercase();
    match lower.as_str() {
        "dadosgerais" | "dados_gerais" | "dados gerais" => Some("dadosgerais"),
        "formacao" | "formação" => Some("formacao"),
        "encargos" => Some("encargos"),
        "disciplinas" => Some("disciplinas"),
        "projetos" => Some("projetos"),
        "producoes" | "produções" => Some("producoes"),
        "patentes" => Some("patentes"),
        "eventos" => Some("eventos"),
        "orientacoes" | "orientações" => Some("orientacoes"),
        "bancas" => Some("bancas"),
        _ => None,
    }
}

pub fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA_SQL)?;
    conn.execute_batch(crate::custom::SCHEMA_SQL)?;
    conn.execute_batch(crate::classify::SCHEMA_SQL)?;
    conn.execute(
        "INSERT OR IGNORE INTO app_metadata (key, value) VALUES (?1, ?2)",
        rusqlite::params!["schema_version", "1"],
    )?;
    Ok(())
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    create_tables(conn)
}
