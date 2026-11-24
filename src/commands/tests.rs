use super::*;
use serde_json::json;

#[test]
fn batch_update_native_producoes_and_ignore_qualis_elsewhere() {
    let db = Mutex::new(crate::db::open_in_memory().unwrap());
    let (p1, p2, e1) = {
        let conn = db.lock().unwrap();
        let a = queries::insert_record(
            &conn,
            "producoes",
            &json!({ "ano": 2020, "tipo": "Artigo", "titulo": "Paper A", "qualis": "B1" }),
            None,
            None,
        )
        .unwrap();
        let b = queries::insert_record(
            &conn,
            "producoes",
            &json!({ "ano": 2021, "tipo": "Capítulo", "titulo": "Paper B", "qualis": "B2" }),
            None,
            None,
        )
        .unwrap();
        let c = queries::insert_record(
            &conn,
            "eventos",
            &json!({ "ano": 2019, "tipo": "Congresso", "descricao": "Ev 1" }),
            None,
            None,
        )
        .unwrap();
        (a.id, b.id, c.id)
    };

    // Empty ids returns 0 without error
    assert_eq!(
        batch_update_records_impl(&db, "producoes", &[], Some(2024), None, None, None).unwrap(),
        0
    );

    // Deduped ids: p1 listed twice counts once
    let count = batch_update_records_impl(
        &db,
        "producoes",
        &[p1, p2, p1],
        Some(2024),
        Some("  Artigo Completo ".into()),
        Some("A1".into()),
        None,
    )
    .unwrap();
    assert_eq!(count, 2);

    let conn = db.lock().unwrap();
    let r1 = queries::get_record_by_id(&conn, "producoes", p1).unwrap();
    let r2 = queries::get_record_by_id(&conn, "producoes", p2).unwrap();
    assert_eq!(r1.ano, Some(2024));
    assert_eq!(r1.tipo.as_deref(), Some("Artigo Completo"));
    assert_eq!(r1.qualis.as_deref(), Some("A1"));
    assert_eq!(r2.qualis.as_deref(), Some("A1"));
    drop(conn);

    // Blank string clears field to NULL
    let cleared = batch_update_records_impl(
        &db,
        "producoes",
        &[p1],
        None,
        None,
        Some("   ".into()),
        None,
    )
    .unwrap();
    assert_eq!(cleared, 1);
    let r1_after = queries::get_record_by_id(&db.lock().unwrap(), "producoes", p1).unwrap();
    assert_eq!(r1_after.qualis, None);

    // Batch update with generic data dictionary
    let upd_data = json!({
        "titulo": "Novo Título Coletivo",
        "journal": "Nature Communications"
    });
    assert_eq!(
        batch_update_records_impl(
            &db,
            "producoes",
            &[p1, p2],
            None,
            None,
            None,
            Some(&upd_data)
        )
        .unwrap(),
        2
    );
    let r1_upd = queries::get_record_by_id(&db.lock().unwrap(), "producoes", p1).unwrap();
    assert_eq!(r1_upd.titulo.as_deref(), Some("Novo Título Coletivo"));
    assert_eq!(r1_upd.journal.as_deref(), Some("Nature Communications"));

    // Only qualis on non-producoes is ignored and returns 0 cleanly
    assert_eq!(
        batch_update_records_impl(&db, "eventos", &[e1], None, None, Some("A1".into()), None)
            .unwrap(),
        0
    );
    // Updating ano + qualis on non-producoes updates ano and ignores qualis
    assert_eq!(
        batch_update_records_impl(
            &db,
            "eventos",
            &[e1],
            Some(2023),
            None,
            Some("A1".into()),
            None
        )
        .unwrap(),
        1
    );
    let ev_after = queries::get_record_by_id(&db.lock().unwrap(), "eventos", e1).unwrap();
    assert_eq!(ev_after.ano, Some(2023));

    // Invalid category errors
    assert!(
        batch_update_records_impl(&db, "nao_existe", &[1], Some(2024), None, None, None).is_err()
    );
    assert!(
        batch_update_records_impl(&db, "x_inexistente", &[1], Some(2024), None, None, None)
            .is_err()
    );
}

#[test]
fn batch_update_and_delete_custom_and_files() {
    let root = std::env::temp_dir().join(format!("lattes_batch_test_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("files")).unwrap();
    let f1 = root.join("files").join("doc1.pdf");
    let f2 = root.join("files").join("doc2.pdf");
    std::fs::write(&f1, b"pdf1").unwrap();
    std::fs::write(&f2, b"pdf2").unwrap();

    let outside = std::env::temp_dir().join(format!("lattes_outside_{}.txt", uuid::Uuid::new_v4()));
    std::fs::write(&outside, b"keep").unwrap();

    let db = Mutex::new(crate::db::open_in_memory().unwrap());
    let (p1, p2, p3, c1) = {
        let conn = db.lock().unwrap();
        let a = queries::insert_record(
            &conn,
            "producoes",
            &json!({ "ano": 2020, "titulo": "D1", "path": "files\\doc1.pdf" }),
            None,
            None,
        )
        .unwrap();
        let b = queries::insert_record(
            &conn,
            "producoes",
            &json!({ "ano": 2021, "titulo": "D2", "path": "files\\doc2.pdf" }),
            None,
            None,
        )
        .unwrap();
        let c = queries::insert_record(
            &conn,
            "producoes",
            &json!({ "ano": 2022, "titulo": "D3", "path": outside.to_string_lossy().to_string() }),
            None,
            None,
        )
        .unwrap();
        conn.execute(
            "INSERT INTO custom_categories (key, name, folder) VALUES ('x_premios', 'Prêmios', '12_premios')",
            [],
        )
        .unwrap();
        let d = queries::insert_record(
            &conn,
            "x_premios",
            &json!({ "ano": 2018, "tipo": "Prêmio", "titulo": "P1" }),
            None,
            None,
        )
        .unwrap();
        (a.id, b.id, c.id, d.id)
    };

    // Custom category batch update
    assert_eq!(
        batch_update_records_impl(
            &db,
            "x_premios",
            &[c1],
            Some(2025),
            Some("Honra".into()),
            Some("A1".into()),
            None
        )
        .unwrap(),
        1
    );
    let cust_after = queries::get_record_by_id(&db.lock().unwrap(), "x_premios", c1).unwrap();
    assert_eq!(cust_after.ano, Some(2025));
    assert_eq!(cust_after.tipo.as_deref(), Some("Honra"));

    // Batch delete without deleting files keeps f1 on disk
    assert_eq!(
        batch_delete_records_impl(&db, &root, "producoes", &[p1], false).unwrap(),
        1
    );
    assert!(f1.exists());

    // Batch delete with delete_files=true deletes f2 inside root, ignores path outside root, returns count
    assert_eq!(
        batch_delete_records_impl(&db, &root, "producoes", &[p2, p3, p2], true).unwrap(),
        2
    );
    assert!(!f2.exists());
    assert!(outside.exists());

    // Custom category batch delete
    assert_eq!(
        batch_delete_records_impl(&db, &root, "x_premios", &[c1], false).unwrap(),
        1
    );
    assert!(queries::get_record_by_id(&db.lock().unwrap(), "x_premios", c1).is_err());

    // Empty ids returns 0
    assert_eq!(
        batch_delete_records_impl(&db, &root, "producoes", &[], true).unwrap(),
        0
    );

    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_file(&outside);
}

#[test]
fn test_valid_subfolder_and_with_valid_folder() {
    assert!(valid_subfolder(r"11_bancas\doutorado\"));
    assert!(valid_subfolder(r"5_producoes\artigos_completos\"));
    assert!(!valid_subfolder("11_bancas"));
    assert!(!valid_subfolder(r"11_bancas\"));
    assert!(!valid_subfolder("folder"));
    assert!(!valid_subfolder(""));

    let db = Mutex::new(crate::db::open_in_memory().unwrap());
    {
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO subfolder_mappings (category_group, description, folder) VALUES (?1, ?2, ?3)",
            rusqlite::params!["Bancas", "Doutorado", r"11_bancas\doutorado\"],
        )
        .unwrap();
    }

    // When data has root folder "11_bancas\", with_valid_folder must resolve to the mapped subfolder "11_bancas\doutorado\"
    let raw = json!({
        "ano": 2021,
        "tipo": "Doutorado",
        "folder": r"11_bancas\"
    });
    let fixed = with_valid_folder(&db, "bancas", &raw, None).unwrap();
    assert_eq!(
        fixed.get("folder").unwrap().as_str().unwrap(),
        r"11_bancas\doutorado\"
    );
}

#[test]
fn test_atuacao_record_crud() {
    let db = Mutex::new(crate::db::open_in_memory().unwrap());
    crate::db::schema::create_tables(&db.lock().unwrap()).unwrap();
    let tmpdir = tempfile::tempdir().unwrap();
    let root = tmpdir.path().join("test_atuacao_root");
    let _ = std::fs::create_dir_all(&root);

    let data = json!({
        "tipo": "Atuação profissional",
        "instituicao": "Universidade Federal de Santa Catarina",
        "ano": 2021,
        "ano_fim": 2025,
        "vinculo": "Servidor Público",
        "enquadramento": "Professor Adjunto",
        "horas": 40,
        "dedicacao_exclusiva": "Sim",
        "vinculo_empregaticio": "Sim"
    });

    let rec = create_record_impl(&db, &root, "atuacao", &data, None, None).unwrap();
    assert_eq!(
        rec.instituicao.as_deref(),
        Some("Universidade Federal de Santa Catarina")
    );
    assert_eq!(
        rec.titulo.as_deref(),
        Some("Universidade Federal de Santa Catarina")
    );
    assert_eq!(rec.ano, Some(2021));
    assert_eq!(rec.ano_fim, Some(2025));
    assert_eq!(rec.vinculo.as_deref(), Some("Servidor Público"));
    assert_eq!(
        rec.folder.as_deref(),
        Some(r"3_atuacao\atuacao_profissional\")
    );

    let recs = queries::get_records(&db.lock().unwrap(), "atuacao", None, None, None).unwrap();
    assert_eq!(recs.len(), 1);
    assert_eq!(
        recs[0].instituicao.as_deref(),
        Some("Universidade Federal de Santa Catarina")
    );

    let update_data = json!({
        "enquadramento": "Professor Associado"
    });
    let updated =
        update_record_impl(&db, &root, "atuacao", rec.id, &update_data, None, None).unwrap();
    assert_eq!(
        updated.enquadramento.as_deref(),
        Some("Professor Associado")
    );
    assert_eq!(
        updated.instituicao.as_deref(),
        Some("Universidade Federal de Santa Catarina")
    );

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn test_inovacao_and_educacao_crud() {
    let db = Mutex::new(crate::db::open_in_memory().unwrap());
    crate::db::schema::create_tables(&db.lock().unwrap()).unwrap();
    let tmpdir = tempfile::tempdir().unwrap();
    let root = tmpdir.path().join("test_inovacao_and_educacao_crud");
    let _ = std::fs::create_dir_all(&root);

    let in_data = json!({
        "ano": 2025,
        "tipo": "Projetos de inovação",
        "titulo": "Plataforma IA para Fenotipagem Vegetal",
        "instituicao": "FAPESC / UFSC",
        "descricao": "Sistema de inteligência artificial embarcada para melhoramento genético"
    });
    let in_rec = create_record_impl(&db, &root, "inovacao", &in_data, None, None).unwrap();
    assert_eq!(
        in_rec.titulo.as_deref(),
        Some("Plataforma IA para Fenotipagem Vegetal")
    );
    assert_eq!(in_rec.ano, Some(2025));

    let ed_data = json!({
        "ano": 2024,
        "tipo": "Artigos de divulgação científica",
        "titulo": "Como a visão computacional revoluciona a agricultura",
        "instituicao": "Revista Ciência Hoje",
        "descricao": "Artigo para popularização da fenotipagem digital"
    });
    let ed_rec =
        create_record_impl(&db, &root, "educacao_popularizacao", &ed_data, None, None).unwrap();
    assert_eq!(
        ed_rec.titulo.as_deref(),
        Some("Como a visão computacional revoluciona a agricultura")
    );
    assert_eq!(ed_rec.ano, Some(2024));

    let list_in = queries::get_records(&db.lock().unwrap(), "inovacao", None, None, None).unwrap();
    assert_eq!(list_in.len(), 1);

    let list_ed = queries::get_records(
        &db.lock().unwrap(),
        "educacao_popularizacao",
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(list_ed.len(), 1);

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn test_create_tables_idempotent_subfolder_mappings() {
    let conn = crate::db::open_in_memory().unwrap();
    crate::db::schema::create_tables(&conn).unwrap();

    // Simulate legacy Encargos/Disciplinas/13_atuacao rows and duplicates
    let _ = conn.execute("DROP INDEX IF EXISTS idx_subfolder_unique_group_desc", []);
    conn.execute(
        "INSERT INTO subfolder_mappings (category_group, description, folder) VALUES ('Disciplinas', 'Encargos Extensão', '3_atuacao\\atuacao_profissional\\encargos_extensão\\')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO subfolder_mappings (category_group, description, folder) VALUES ('Encargos', 'Chefia', '3_atuacao\\atuacao_profissional\\chefia\\')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO subfolder_mappings (category_group, description, folder) VALUES ('Atuação', 'Chefia', '3_atuacao\\atuacao_profissional\\chefia\\')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO subfolder_mappings (category_group, description, folder) VALUES ('Atuação', 'Áreas extras', '13_atuacao\\areas_extras')",
        [],
    ).unwrap();

    crate::db::schema::create_tables(&conn).unwrap();
    let count1: i64 = conn
        .query_row("SELECT COUNT(*) FROM subfolder_mappings", [], |r| r.get(0))
        .unwrap();

    // Calling create_tables multiple times must never duplicate mappings
    crate::db::schema::create_tables(&conn).unwrap();
    crate::db::schema::create_tables(&conn).unwrap();
    let count2: i64 = conn
        .query_row("SELECT COUNT(*) FROM subfolder_mappings", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count1, count2);

    let legacy_cnt: i64 = conn.query_row(
        "SELECT COUNT(*) FROM subfolder_mappings WHERE fold(category_group) IN ('disciplinas', 'encargos') OR folder LIKE '13_atuacao\\%' OR folder LIKE '12_atuacao\\%'",
        [],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(legacy_cnt, 0);

    let migrated_folder: String = conn
        .query_row(
            "SELECT folder FROM subfolder_mappings WHERE description = 'Áreas extras'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(migrated_folder, r"3_atuacao\areas_extras\");

    // add_subfolder_mapping must also be idempotent
    let tmpdir = tempfile::tempdir().unwrap();
    let root = tmpdir.path().join("test_idempotent_subfolders_root");
    let _ = std::fs::create_dir_all(&root);
    let db = Mutex::new(conn);
    let first = add_subfolder_mapping_impl(
        &db,
        &root,
        "Atuação",
        "Chefia",
        r"3_atuacao\atuacao_profissional\chefia\",
    )
    .unwrap();
    let second = add_subfolder_mapping_impl(
        &db,
        &root,
        "atuação",
        "CHEFIA",
        r"3_atuacao\atuacao_profissional\chefia\",
    )
    .unwrap();
    assert_eq!(first.id, second.id);
    let count3: i64 = db
        .lock()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM subfolder_mappings", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count2, count3);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn batch_unlink_attachments_keeps_files() {
    let root = std::env::temp_dir().join(format!("lattes_unlink_test_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("files")).unwrap();
    let f1 = root.join("files").join("doc1.pdf");
    std::fs::write(&f1, b"pdf1").unwrap();
    let db = Mutex::new(crate::db::open_in_memory().unwrap());
    let (a, b) = {
        let conn = db.lock().unwrap();
        let a = queries::insert_record(&conn, "projetos", &json!({ "ano": 2020, "tipo": "Projetos de pesquisa", "descricao": "P1", "path": "files/doc1.pdf", "file": "doc1.pdf" }), None, None).unwrap();
        let b = queries::insert_record(
            &conn,
            "projetos",
            &json!({ "ano": 2021, "tipo": "Projetos de pesquisa", "descricao": "P2" }),
            None,
            None,
        )
        .unwrap();
        (a.id, b.id)
    };
    {
        let conn = db.lock().unwrap();
        let rec = queries::get_record_by_id(&conn, "projetos", a).unwrap();
        let mut atts = rec.attachments.clone();
        atts.push(crate::db::models::AttachmentDto {
            file: "doc2.pdf".into(),
            path: "files/doc2.pdf".into(),
            ..Default::default()
        });
        queries::sync_record_attachments(&conn, "projetos", a, &atts).unwrap();
    }
    // só o registro com comprovante conta; o arquivo continua no disco
    assert_eq!(
        batch_unlink_attachments_impl(&db, "projetos", &[a, b, a]).unwrap(),
        1
    );
    let conn = db.lock().unwrap();
    let rec = queries::get_record_by_id(&conn, "projetos", a).unwrap();
    assert!(rec.path.is_none() && rec.file.is_none());
    assert!(rec.attachments.is_empty());
    assert_eq!(rec.descricao.as_deref(), Some("P1"));
    assert!(f1.exists());
    drop(conn);
    assert!(batch_unlink_attachments_impl(&db, "inexistente", &[a]).is_err());
    let _ = std::fs::remove_dir_all(&root);
}
