use lattes_app::db::schema;
use lattes_app::db::queries;
use rusqlite::Connection;

#[test]
fn test_sqlite_schema_creation_and_table_inventory() {
    let conn = Connection::open_in_memory().expect("Failed to open in-memory SQLite");
    schema::create_tables(&conn).expect("Failed creating tables");

    let expected_tables = [
        "app_metadata",
        "subfolder_mappings",
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

    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .unwrap();
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    for table in expected_tables {
        assert!(tables.contains(&table.to_string()), "Missing table '{}'", table);
    }
}

#[test]
fn test_subfolder_mappings_crud() {
    let conn = Connection::open_in_memory().unwrap();
    schema::create_tables(&conn).unwrap();

    // 1. Create
    conn.execute(
        "INSERT INTO subfolder_mappings (category_group, description, folder) VALUES (?1, ?2, ?3)",
        rusqlite::params!["Produções", "Artigos completos", r"5_producoes\artigos_completos"],
    )
    .unwrap();
    let id = conn.last_insert_rowid();

    // 2. Read
    let (group, desc, folder): (String, String, String) = conn
        .query_row(
            "SELECT category_group, description, folder FROM subfolder_mappings WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(group, "Produções");
    assert_eq!(desc, "Artigos completos");
    assert_eq!(folder, r"5_producoes\artigos_completos");

    // 3. Update
    conn.execute(
        "UPDATE subfolder_mappings SET folder = ?1 WHERE id = ?2",
        rusqlite::params![r"5_producoes\artigos_novos", id],
    )
    .unwrap();
    let updated_folder: String = conn
        .query_row(
            "SELECT folder FROM subfolder_mappings WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(updated_folder, r"5_producoes\artigos_novos");

    // 4. Delete
    conn.execute("DELETE FROM subfolder_mappings WHERE id = ?1", [id])
        .unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM subfolder_mappings WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn test_entity_tables_nullability_and_crud() {
    let conn = Connection::open_in_memory().unwrap();
    schema::create_tables(&conn).unwrap();

    // Test encargos with NULL Horas (matches Excel row 6)
    conn.execute(
        "INSERT INTO encargos (ano, tipo, descricao, horas) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![2026, "Comissão", "Membro de Comissão", Option::<i64>::None],
    )
    .unwrap();
    let horas: Option<i64> = conn
        .query_row("SELECT horas FROM encargos WHERE ano = 2026", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(horas, None);

    // Test producoes with Qualis = 'SQ' and NULL Log/Path (matches legacy rows 68-146)
    conn.execute(
        "INSERT INTO producoes (ano, tipo, titulo, qualis, log, path) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            2025,
            "Artigos completos",
            "Paper SQ",
            "SQ",
            Option::<String>::None,
            Option::<String>::None
        ],
    )
    .unwrap();
    let qualis: String = conn
        .query_row(
            "SELECT qualis FROM producoes WHERE titulo = 'Paper SQ'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(qualis, "SQ");

    // Test bancas with synthetic identifier
    conn.execute(
        "INSERT INTO bancas (ano, tipo, identifier, aluno, titulo) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![2024, "Graduação", "041_Mariano.pdf", "Mariano", "TCC"],
    )
    .unwrap();
    let ident: String = conn
        .query_row(
            "SELECT identifier FROM bancas WHERE aluno = 'Mariano'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(ident, "041_Mariano.pdf");
}

#[test]
fn test_queries_and_stats() {
    let conn = Connection::open_in_memory().unwrap();
    schema::create_tables(&conn).unwrap();

    queries::add_subfolder_mapping(&conn, "Projetos", "Pesquisa", r"4_projetos\pesquisa").unwrap();
    let maps = queries::get_subfolder_mappings(&conn, Some("Projetos")).unwrap();
    assert_eq!(maps.len(), 1);
    assert_eq!(maps[0].description, "Pesquisa");

    conn.execute(
        "INSERT INTO producoes (ano, tipo, identifier, titulo, journal, qualis) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![2024, "Artigos completos", "art_1.pdf", "Rust Microservices", "IEEE", "A1"],
    )
    .unwrap();

    let records = queries::get_records(&conn, "producoes", Some("Microservices"), Some(2024), None).unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].titulo.as_deref(), Some("Rust Microservices"));

    let stats = queries::get_app_stats(&conn, "memory").unwrap();
    assert_eq!(stats.total_records, 1);
    assert_eq!(stats.total_mappings, 1);
}
