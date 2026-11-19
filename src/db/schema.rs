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

-- 2.1 atuacao (Atuação Profissional)
CREATE TABLE IF NOT EXISTS atuacao (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    ano_fim INTEGER,
    tipo TEXT,
    instituicao TEXT,
    titulo TEXT,
    vinculo TEXT,
    enquadramento TEXT,
    horas INTEGER,
    dedicacao_exclusiva TEXT,
    vinculo_empregaticio TEXT,
    descricao TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    log TEXT,
    path TEXT,
    url TEXT
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
CREATE INDEX IF NOT EXISTS idx_atuacao_ano ON atuacao(ano);
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
    "atuacao",
    "projetos",
    "producoes",
    "patentes",
    "inovacao",
    "educacao_popularizacao",
    "eventos",
    "orientacoes",
    "bancas",
];

pub const DEFAULT_ATUACAO_MAPPINGS: &[(&str, &str)] = &[
    ("Atuação profissional", r"3_atuacao\atuacao_profissional\"),
    ("Linhas de pesquisa", r"3_atuacao\linhas_de_pesquisa\"),
    ("Membro de corpo editorial", r"3_atuacao\membro_de_corpo_editorial\"),
    ("Membro de comitê de assessoramento", r"3_atuacao\membro_de_comite_de_assessoramento\"),
    ("Revisor de periódico", r"3_atuacao\revisor_de_periodico\"),
    ("Revisor de projeto de agência de fomento", r"3_atuacao\revisor_de_projeto_de_agencia_de_fomento\"),
    ("Áreas de atuação", r"3_atuacao\areas_de_atuacao\"),
    ("Comissão", r"3_atuacao\atuacao_profissional\comissão\"),
    ("Supervisão", r"3_atuacao\atuacao_profissional\supervisão\"),
    ("Coordenação", r"3_atuacao\atuacao_profissional\coordenação\"),
    ("Chefia", r"3_atuacao\atuacao_profissional\chefia\"),
    ("Direção", r"3_atuacao\atuacao_profissional\direção\"),
    ("Encargos Graduação", r"3_atuacao\atuacao_profissional\encargos_graduação\"),
    ("Encargos Pós-Graduação", r"3_atuacao\atuacao_profissional\encargos_pós\"),
    ("Encargos Administrativos", r"3_atuacao\atuacao_profissional\encargos_adm\"),
];

pub const DEFAULT_INOVACAO_MAPPINGS: &[(&str, &str)] = &[
    ("Projetos de inovação", r"7_inovacao\projetos_de_inovacao\"),
    ("Produtos tecnológicos", r"7_inovacao\produtos_tecnologicos\"),
    ("Processos ou técnicas", r"7_inovacao\processos_ou_tecnicas\"),
    ("Transferência de tecnologia", r"7_inovacao\transferencia_de_tecnologia\"),
    ("Spin-offs e startups", r"7_inovacao\spin_offs_e_startups\"),
    ("Outras produções de inovação", r"7_inovacao\outras_inovacoes\"),
];

pub const DEFAULT_EDUCACAO_MAPPINGS: &[(&str, &str)] = &[
    ("Artigos de divulgação científica", r"8_educacao\divulgacao_cientifica\"),
    ("Livros e capítulos de divulgação", r"8_educacao\livros_divulgacao\"),
    ("Material didático ou instrucional", r"8_educacao\material_didatico\"),
    ("Mídias sociais, websites e blogs", r"8_educacao\midias_sociais_e_websites\"),
    ("Cursos de curta duração ministrados", r"8_educacao\cursos_de_extensao\"),
    ("Eventos de popularização de C&T", r"8_educacao\eventos_de_popularizacao\"),
    ("Outras produções de divulgação", r"8_educacao\outras_producoes\"),
];

pub fn normalize_category(category: &str) -> Option<&'static str> {
    let lower = category.trim().to_lowercase();
    match lower.as_str() {
        "dadosgerais" | "dados_gerais" | "dados gerais" => Some("dadosgerais"),
        "formacao" | "formação" => Some("formacao"),
        "atuacao" | "atuação" | "x_atuacao" => Some("atuacao"),
        "projetos" => Some("projetos"),
        "producoes" | "produções" => Some("producoes"),
        "patentes" => Some("patentes"),
        "inovacao" | "inovação" => Some("inovacao"),
        "educacao_popularizacao" | "educacao" | "educação" | "educação e popularização de c&t" | "educação e popularização" | "popularizacao" => Some("educacao_popularizacao"),
        "eventos" => Some("eventos"),
        "orientacoes" | "orientações" => Some("orientacoes"),
        "bancas" => Some("bancas"),
        "encargos" => Some("encargos"),
        "disciplinas" => Some("disciplinas"),
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
ALTER TABLE projetos ADD COLUMN url TEXT;
ALTER TABLE producoes ADD COLUMN url TEXT;
ALTER TABLE patentes ADD COLUMN url TEXT;
ALTER TABLE eventos ADD COLUMN url TEXT;
ALTER TABLE orientacoes ADD COLUMN url TEXT;
ALTER TABLE bancas ADD COLUMN url TEXT;
ALTER TABLE custom_records ADD COLUMN url TEXT;
"#,
    // 4: contagem de citações do Google Scholar para produções
    r#"
ALTER TABLE producoes ADD COLUMN citations INTEGER;
"#,
    // 5: suporte a múltiplos comprovantes por registro
    r#"
CREATE TABLE IF NOT EXISTS record_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    record_id INTEGER NOT NULL,
    file TEXT NOT NULL,
    path TEXT NOT NULL,
    folder TEXT,
    description TEXT,
    ord INTEGER DEFAULT 0,
    created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_record_attachments_lookup ON record_attachments(category, record_id, ord);
"#,
    // 6: tabela nativa atuacao
    r#"
CREATE TABLE IF NOT EXISTS atuacao (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    ano_fim INTEGER,
    tipo TEXT,
    instituicao TEXT,
    titulo TEXT,
    vinculo TEXT,
    enquadramento TEXT,
    horas INTEGER,
    dedicacao_exclusiva TEXT,
    vinculo_empregaticio TEXT,
    descricao TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    log TEXT,
    path TEXT,
    url TEXT
);
CREATE INDEX IF NOT EXISTS idx_atuacao_ano ON atuacao(ano);
CREATE INDEX IF NOT EXISTS idx_atuacao_ano_tipo ON atuacao(ano, tipo);
"#,
    // 7: tabelas nativas de Inovação e Educação e Popularização de C&T
    r#"
CREATE TABLE IF NOT EXISTS inovacao (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    tipo TEXT,
    titulo TEXT,
    instituicao TEXT,
    descricao TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    log TEXT,
    path TEXT,
    url TEXT
);
CREATE INDEX IF NOT EXISTS idx_inovacao_ano ON inovacao(ano);
CREATE INDEX IF NOT EXISTS idx_inovacao_ano_tipo ON inovacao(ano, tipo);

CREATE TABLE IF NOT EXISTS educacao_popularizacao (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER,
    tipo TEXT,
    titulo TEXT,
    instituicao TEXT,
    descricao TEXT,
    identifier TEXT,
    file TEXT,
    folder TEXT,
    log TEXT,
    path TEXT,
    url TEXT
);
CREATE INDEX IF NOT EXISTS idx_educacao_ano ON educacao_popularizacao(ano);
CREATE INDEX IF NOT EXISTS idx_educacao_ano_tipo ON educacao_popularizacao(ano, tipo);
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
    migrate(conn, existing > 0)?;

    // Migra registros legados de x_atuacao para a tabela nativa atuacao
    let _ = conn.execute(
        r#"
INSERT INTO atuacao (ano, tipo, instituicao, titulo, identifier, file, folder, descricao, log, path, url)
SELECT ano, tipo, COALESCE(titulo, descricao, 'Sem nome'), titulo, identifier, file, folder, descricao, log, path, url
FROM custom_records WHERE category = 'x_atuacao'
"#,
        [],
    );
    let _ = conn.execute("UPDATE record_attachments SET category = 'atuacao' WHERE category = 'x_atuacao'", []);
    let _ = conn.execute("DELETE FROM custom_records WHERE category = 'x_atuacao'", []);
    let _ = conn.execute("DELETE FROM custom_categories WHERE key = 'x_atuacao'", []);

    // Remove todas as tabelas legadas mantendo somente os dados atuais do app
    let _ = conn.execute_batch(
        "DROP TABLE IF EXISTS encargos;
         DROP TABLE IF EXISTS disciplinas;
         DELETE FROM record_attachments WHERE category IN ('encargos', 'disciplinas');",
    );

    // Remove prefixo legado "Ensino: " de atuacao e subfolder_mappings
    let _ = conn.execute(
        "UPDATE atuacao SET tipo = TRIM(SUBSTR(tipo, 9)) WHERE tipo LIKE 'Ensino: %'",
        [],
    );
    let _ = conn.execute(
        "DELETE FROM subfolder_mappings WHERE description LIKE 'Ensino: %' AND EXISTS (SELECT 1 FROM subfolder_mappings s2 WHERE fold(s2.category_group) = fold(subfolder_mappings.category_group) AND fold(s2.description) = fold(TRIM(SUBSTR(subfolder_mappings.description, 9))))",
        [],
    );
    let _ = conn.execute(
        "UPDATE subfolder_mappings SET description = TRIM(SUBSTR(description, 9)) WHERE description LIKE 'Ensino: %'",
        [],
    );

    // Normaliza caminhos legados 12_atuacao\ e 13_atuacao\ para 3_atuacao\ em subfolder_mappings, atuacao e record_attachments
    let _ = conn.execute(
        r#"UPDATE subfolder_mappings
           SET folder = '3_atuacao\' || SUBSTR(folder, 12)
           WHERE folder LIKE '13_atuacao\%' OR folder LIKE '12_atuacao\%'"#,
        [],
    );
    let _ = conn.execute(
        r#"UPDATE subfolder_mappings
           SET folder = folder || '\'
           WHERE fold(category_group) = 'atuacao' AND folder NOT LIKE '%\' AND folder NOT LIKE '%/'"#,
        [],
    );
    let _ = conn.execute(
        r#"UPDATE atuacao
           SET folder = CASE
                 WHEN (folder LIKE '13_atuacao\%' OR folder LIKE '12_atuacao\%')
                 THEN RTRIM('3_atuacao\' || SUBSTR(folder, 12), '\') || '\'
                 ELSE folder
               END,
               path = CASE
                 WHEN (path LIKE '13_atuacao\%' OR path LIKE '12_atuacao\%')
                 THEN '3_atuacao\' || SUBSTR(path, 12)
                 ELSE path
               END
           WHERE folder LIKE '13_atuacao\%' OR folder LIKE '12_atuacao\%'
              OR path LIKE '13_atuacao\%' OR path LIKE '12_atuacao\%'"#,
        [],
    );
    let _ = conn.execute(
        r#"UPDATE record_attachments
           SET folder = CASE
                 WHEN (folder LIKE '13_atuacao\%' OR folder LIKE '12_atuacao\%')
                 THEN RTRIM('3_atuacao\' || SUBSTR(folder, 12), '\') || '\'
                 ELSE folder
               END,
               path = CASE
                 WHEN (path LIKE '13_atuacao\%' OR path LIKE '12_atuacao\%')
                 THEN '3_atuacao\' || SUBSTR(path, 12)
                 ELSE path
               END
           WHERE folder LIKE '13_atuacao\%' OR folder LIKE '12_atuacao\%'
              OR path LIKE '13_atuacao\%' OR path LIKE '12_atuacao\%'"#,
        [],
    );

    // Migra subpastas legadas de Encargos e Disciplinas para Atuação sem duplicidade e remove os grupos legados
    let _ = conn.execute(
        "INSERT INTO subfolder_mappings (category_group, description, folder)
         SELECT 'Atuação', s.description, s.folder
         FROM subfolder_mappings s
         WHERE fold(s.category_group) IN ('disciplinas', 'encargos')
           AND NOT EXISTS (
               SELECT 1 FROM subfolder_mappings a
               WHERE fold(a.category_group) = 'atuacao'
                 AND fold(a.description) = fold(s.description)
           )",
        [],
    );
    let _ = conn.execute(
        "DELETE FROM subfolder_mappings WHERE fold(category_group) IN ('disciplinas', 'encargos')",
        [],
    );

    // Remove eventuais duplicatas em subfolder_mappings e impõe unicidade em (category_group, description)
    let _ = conn.execute(
        "DELETE FROM subfolder_mappings
         WHERE id NOT IN (
             SELECT MIN(id)
             FROM subfolder_mappings
             GROUP BY fold(category_group), fold(description)
         )",
        [],
    );
    let _ = conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_subfolder_unique_group_desc ON subfolder_mappings(category_group, description)",
        [],
    );

    // Garante subfolder_mappings padrão para Atuação
    for (desc, folder) in DEFAULT_ATUACAO_MAPPINGS {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM subfolder_mappings WHERE fold(category_group) = 'atuacao' AND fold(description) = fold(?1)",
                [desc],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if exists == 0 {
            let _ = conn.execute(
                "INSERT INTO subfolder_mappings (category_group, description, folder) VALUES ('Atuação', ?1, ?2)",
                [desc, folder],
            );
        }
    }

    // Garante subfolder_mappings padrão para Inovação
    for (desc, folder) in DEFAULT_INOVACAO_MAPPINGS {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM subfolder_mappings WHERE fold(category_group) = 'inovacao' AND fold(description) = fold(?1)",
                [desc],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if exists == 0 {
            let _ = conn.execute(
                "INSERT INTO subfolder_mappings (category_group, description, folder) VALUES ('Inovação', ?1, ?2)",
                [desc, folder],
            );
        }
    }

    // Garante subfolder_mappings padrão para Educação e Popularização de C&T
    for (desc, folder) in DEFAULT_EDUCACAO_MAPPINGS {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM subfolder_mappings WHERE fold(category_group) IN ('educacao e popularizacao de c&t', 'educacao e popularizacao', 'educacao') AND fold(description) = fold(?1)",
                [desc],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if exists == 0 {
            let _ = conn.execute(
                "INSERT INTO subfolder_mappings (category_group, description, folder) VALUES ('Educação e Popularização de C&T', ?1, ?2)",
                [desc, folder],
            );
        }
    }

    // Remove eventuais duplicatas em record_attachments
    let _ = conn.execute(
        "DELETE FROM record_attachments
         WHERE id NOT IN (
             SELECT MIN(id)
             FROM record_attachments
             GROUP BY category, record_id, path
         )",
        [],
    );

    // Preenche instituicao/titulo em atuacao quando vier apenas descricao (ex.: importação em lote antiga)
    let _ = conn.execute(
        "UPDATE atuacao
         SET instituicao = TRIM(REPLACE(descricao, char(160), ' ')),
             titulo = TRIM(REPLACE(descricao, char(160), ' '))
         WHERE (instituicao IS NULL OR TRIM(instituicao) = '')
           AND descricao IS NOT NULL AND TRIM(descricao) <> ''",
        [],
    );

    // Atualiza options.category_order para o padrão oficial do Lattes
    let _ = conn.execute(
        "UPDATE app_metadata SET value = '[\"dadosgerais\",\"formacao\",\"atuacao\",\"projetos\",\"producoes\",\"patentes\",\"inovacao\",\"educacao_popularizacao\",\"eventos\",\"orientacoes\",\"bancas\"]' WHERE key = 'options.category_order'",
        [],
    );

    let _ = crate::db::queries::cleanup_external_attachments(conn);
    Ok(())
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
