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

/// Migrações em ordem, controladas por `PRAGMA user_version`. A posição `i` leva o banco à versão `i + 1`.
/// `SCHEMA_SQL` é a versão 1 e não deve mudar: colunas, tabelas e índices novos entram aqui no fim.
pub const MIGRATIONS: &[&str] = &[
    // 1: esquema inicial (SCHEMA_SQL)
    "",
    // 2: filtros por ano + tipo
    r#"
CREATE INDEX IF NOT EXISTS idx_dadosgerais_ano_tipo ON dadosgerais(ano, tipo);
CREATE INDEX IF NOT EXISTS idx_formacao_ano_tipo ON formacao(ano, tipo);
CREATE INDEX IF NOT EXISTS idx_encargos_ano_tipo ON encargos(ano, tipo);
CREATE INDEX IF NOT EXISTS idx_disciplinas_ano_tipo ON disciplinas(ano, tipo);
CREATE INDEX IF NOT EXISTS idx_projetos_ano_tipo ON projetos(ano, tipo);
CREATE INDEX IF NOT EXISTS idx_producoes_ano_tipo ON producoes(ano, tipo);
CREATE INDEX IF NOT EXISTS idx_patentes_ano_tipo ON patentes(ano, tipo);
CREATE INDEX IF NOT EXISTS idx_eventos_ano_tipo ON eventos(ano, tipo);
CREATE INDEX IF NOT EXISTS idx_orientacoes_ano_tipo ON orientacoes(ano, tipo);
CREATE INDEX IF NOT EXISTS idx_bancas_ano_tipo ON bancas(ano, tipo);
"#,
    // 3: link opcional em todas as categorias
    r#"
ALTER TABLE dadosgerais ADD COLUMN url TEXT;
ALTER TABLE formacao ADD COLUMN url TEXT;
ALTER TABLE encargos ADD COLUMN url TEXT;
ALTER TABLE disciplinas ADD COLUMN url TEXT;
ALTER TABLE projetos ADD COLUMN url TEXT;
ALTER TABLE producoes ADD COLUMN url TEXT;
ALTER TABLE patentes ADD COLUMN url TEXT;
ALTER TABLE eventos ADD COLUMN url TEXT;
ALTER TABLE orientacoes ADD COLUMN url TEXT;
ALTER TABLE bancas ADD COLUMN url TEXT;
ALTER TABLE custom_records ADD COLUMN url TEXT;
"#,
];

pub fn create_tables(conn: &Connection) -> Result<()> {
    crate::db::register_functions(conn)?;
    let existing: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'app_metadata'",
        [],
        |r| r.get(0),
    )?;
    conn.execute_batch(SCHEMA_SQL)?;
    conn.execute_batch(crate::custom::SCHEMA_SQL)?;
    conn.execute_batch(crate::classify::SCHEMA_SQL)?;
    migrate(conn, existing > 0)
}

pub fn schema_version(conn: &Connection) -> Result<usize> {
    conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0)).map(|v| v.max(0) as usize)
}

fn migrate(conn: &Connection, existing: bool) -> Result<()> {
    let current = schema_version(conn)?;
    if current >= MIGRATIONS.len() {
        return Ok(());
    }
    if existing {
        snapshot_before_migration(conn, current);
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('schema_version', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [MIGRATIONS.len().to_string()],
    )?;
    Ok(())
}

/// Cópia do banco em `backups/` antes de alterar o esquema. Falhar aqui não impede a migração.
fn snapshot_before_migration(conn: &Connection, from: usize) {
    let Some(db) = conn.path().filter(|p| !p.is_empty()).map(std::path::PathBuf::from) else { return };
    let Some(dir) = db.parent().map(|d| d.join("backups")) else { return };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H%M%S");
    let _ = crate::backup::snapshot_db(conn, &dir.join(format!("lattes_antes_migracao_v{}_{}.db", from, stamp)));
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    create_tables(conn)
}
