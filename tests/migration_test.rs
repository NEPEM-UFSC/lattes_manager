use lattes_app::db::schema;
use lattes_app::migration::calamine_importer::migrate_workbook;
use regex::Regex;
use rusqlite::Connection;
use std::path::PathBuf;

/// Planilha real do autor; sem ela (ex.: no CI) os testes abaixo são pulados.
fn find_workspace_root() -> Option<PathBuf> {
    [".", "..", r"d:\Desktop\UFSC\lattes"]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.join("lattes.xlsm").exists())
}

#[test]
fn test_real_workbook_migration_census_in_memory() {
    let Some(root) = find_workspace_root() else {
        return;
    };
    let xlsm_path = root.join("lattes.xlsm");

    let mut conn = Connection::open_in_memory().expect("Failed opening in-memory SQLite");
    schema::create_tables(&conn).expect("Failed creating tables");

    let report = migrate_workbook(&mut conn, &xlsm_path, &root).expect("Migration failed");

    // Assert exact census counts per category
    assert_eq!(
        report
            .category_counts
            .get("dadosgerais")
            .copied()
            .unwrap_or(0),
        1
    );
    assert_eq!(
        report.category_counts.get("formacao").copied().unwrap_or(0),
        34
    );
    assert_eq!(
        report.category_counts.get("encargos").copied().unwrap_or(0),
        7
    );
    assert_eq!(
        report
            .category_counts
            .get("disciplinas")
            .copied()
            .unwrap_or(0),
        35
    );
    assert_eq!(
        report.category_counts.get("projetos").copied().unwrap_or(0),
        3
    );
    assert_eq!(
        report
            .category_counts
            .get("producoes")
            .copied()
            .unwrap_or(0),
        145
    );
    assert_eq!(
        report.category_counts.get("patentes").copied().unwrap_or(0),
        4
    );
    assert_eq!(
        report.category_counts.get("eventos").copied().unwrap_or(0),
        24
    );
    assert_eq!(
        report
            .category_counts
            .get("orientacoes")
            .copied()
            .unwrap_or(0),
        27
    );
    assert_eq!(
        report.category_counts.get("bancas").copied().unwrap_or(0),
        81
    );

    assert_eq!(report.total_records, 361);
    assert_eq!(report.total_mappings, 49);

    // Verify in SQLite directly (encargos 7 + disciplinas 35 -> atuacao 42)
    let tables = [
        ("dadosgerais", 1),
        ("formacao", 34),
        ("atuacao", 42),
        ("projetos", 3),
        ("producoes", 145),
        ("patentes", 4),
        ("eventos", 24),
        ("orientacoes", 27),
        ("bancas", 81),
    ];

    let mut total_db = 0;
    for (tbl, expected) in tables {
        let count: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {}", tbl), [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, expected, "Mismatch in table {}", tbl);
        total_db += count;
    }
    assert_eq!(total_db, 361);

    let map_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM subfolder_mappings", [], |r| r.get(0))
        .unwrap();
    assert!(map_count >= 49);
}

#[test]
fn test_path_relative_normalization_zero_drive_letters() {
    let Some(root) = find_workspace_root() else {
        return;
    };
    let xlsm_path = root.join("lattes.xlsm");

    let mut conn = Connection::open_in_memory().unwrap();
    schema::create_tables(&conn).unwrap();
    migrate_workbook(&mut conn, &xlsm_path, &root).unwrap();

    let drive_letter_re = Regex::new(r"^[a-zA-Z]:").unwrap();
    let tables = [
        "dadosgerais",
        "formacao",
        "atuacao",
        "projetos",
        "producoes",
        "patentes",
        "eventos",
        "orientacoes",
        "bancas",
    ];

    for tbl in tables {
        let mut stmt = conn
            .prepare(&format!("SELECT path FROM {} WHERE path IS NOT NULL", tbl))
            .unwrap();
        let paths = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();

        for p in paths {
            let path_val = p.unwrap();
            assert!(
                !drive_letter_re.is_match(&path_val),
                "Drive letter detected in table {}: {}",
                tbl,
                path_val
            );
            assert!(
                !path_val.starts_with('/'),
                "Leading forward slash in table {}: {}",
                tbl,
                path_val
            );
            assert!(
                !path_val.starts_with('\\'),
                "Leading backslash in table {}: {}",
                tbl,
                path_val
            );
        }
    }
}

#[test]
fn test_data_anomalies_and_edge_cases_preservation() {
    let Some(root) = find_workspace_root() else {
        return;
    };
    let xlsm_path = root.join("lattes.xlsm");

    let mut conn = Connection::open_in_memory().unwrap();
    schema::create_tables(&conn).unwrap();
    migrate_workbook(&mut conn, &xlsm_path, &root).unwrap();

    // 1. Encargos/Atuacao row with empty Horas is NULL
    let null_horas: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM atuacao WHERE horas IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        null_horas >= 1,
        "Expected at least 1 atuacao with NULL horas"
    );

    // 2. Produções Qualis contains 'SQ' and NULL
    let sq_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM producoes WHERE qualis = 'SQ'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(sq_count > 0, "Qualis SQ must be preserved");

    // 3. Produções legacy rows with NULL log and path
    let null_log_path: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM producoes WHERE log IS NULL AND path IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        null_log_path >= 78,
        "Legacy rows with NULL log and path must be preserved"
    );

    // 4. Bancas rows 74-82 have identifier extracted from path
    let empty_bancas_id: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM bancas WHERE identifier IS NULL OR TRIM(identifier) = ''",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        empty_bancas_id, 0,
        "All 81 bancas records must have an identifier"
    );
}
