use lattes_app::commands;
use lattes_app::db::schema;
use rusqlite::Connection;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

struct TempDir(PathBuf);
impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "lattes_cmd_test_{}_{}_{}",
            name,
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("failed to create temp test dir");
        Self(dir)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn setup_test_db() -> Mutex<Connection> {
    let conn = Connection::open_in_memory().expect("Failed to open in-memory SQLite");
    schema::create_tables(&conn).expect("Failed to create tables");
    Mutex::new(conn)
}

#[test]
fn test_ping_command() {
    assert_eq!(commands::ping(), "pong");
}

#[test]
fn test_get_records_and_filtering() {
    let db = setup_test_db();
    let root = TempDir::new("records_filter");

    // Insert test records across categories
    let rec1 = commands::create_record_impl(
        &db,
        root.path(),
        "producoes",
        &json!({
            "ano": 2024,
            "tipo": "Artigos completos",
            "titulo": "Artigo sobre Rust e SQLite",
            "journal": "IEEE Software",
            "qualis": "A1"
        }),
        None,
        None,
    )
    .expect("Failed to create record 1");

    assert_eq!(rec1.ano, Some(2024));
    assert_eq!(rec1.titulo.as_deref(), Some("Artigo sobre Rust e SQLite"));
    assert_eq!(rec1.qualis.as_deref(), Some("A1"));

    let _rec2 = commands::create_record_impl(
        &db,
        root.path(),
        "producoes",
        &json!({
            "ano": 2023,
            "tipo": "Livros publicados",
            "titulo": "Desenvolvimento com Tauri",
            "journal": "Editora UFSC",
            "qualis": "B1"
        }),
        None,
        None,
    )
    .expect("Failed to create record 2");

    // 1. Fetch all producoes
    let all = commands::get_records_impl(&db, "producoes", None, None, None).unwrap();
    assert_eq!(all.len(), 2);

    // 2. Filter by search term
    let filtered_search =
        commands::get_records_impl(&db, "producoes", Some("SQLite"), None, None).unwrap();
    assert_eq!(filtered_search.len(), 1);
    assert_eq!(filtered_search[0].id, rec1.id);

    // 3. Filter by year
    let filtered_year = commands::get_records_impl(&db, "producoes", None, Some(2023), None).unwrap();
    assert_eq!(filtered_year.len(), 1);
    assert_eq!(filtered_year[0].ano, Some(2023));

    // 4. Filter by tipo
    let filtered_tipo = commands::get_records_impl(
        &db,
        "producoes",
        None,
        None,
        Some("Artigos completos"),
    )
    .unwrap();
    assert_eq!(filtered_tipo.len(), 1);
    assert_eq!(filtered_tipo[0].tipo.as_deref(), Some("Artigos completos"));

    // 5. Unmatched filter
    let empty =
        commands::get_records_impl(&db, "producoes", Some("Inexistente"), None, None).unwrap();
    assert_eq!(empty.len(), 0);
}

#[test]
fn test_create_record_with_file_attachment_and_sequential_naming() {
    let db = setup_test_db();
    let temp_root = TempDir::new("create_attach");
    let root_path = temp_root.path();

    // Prepare a source document in an external folder
    let ext_dir = TempDir::new("ext_source");
    let proof_file = ext_dir.path().join("comprovante_tese.pdf");
    fs::write(&proof_file, b"%PDF-1.4 test document").unwrap();

    let data = json!({
        "ano": 2026,
        "tipo": "Doutorado",
        "aluno": "Maria Silva",
        "titulo": "Modelagem Computacional Avançada",
        "folder": r"11_bancas\doutorado"
    });

    let rec = commands::create_record_impl(
        &db,
        root_path,
        "bancas",
        &data,
        Some(proof_file.to_str().unwrap()),
        None,
    )
    .expect("Failed to create record with attachment");

    assert_eq!(rec.category, "bancas");
    assert_eq!(rec.ano, Some(2026));
    assert_eq!(rec.aluno.as_deref(), Some("Maria Silva"));
    assert_eq!(rec.file.as_deref(), Some("001_maria_silva_modelagem_computacional_avancada.pdf"));
    assert_eq!(
        rec.path.as_deref(),
        Some(r"11_bancas\doutorado\001_maria_silva_modelagem_computacional_avancada.pdf")
    );

    // Verify file actually exists at target location
    let target_file = root_path
        .join("11_bancas")
        .join("doutorado")
        .join("001_maria_silva_modelagem_computacional_avancada.pdf");
    assert!(target_file.exists(), "Target file must exist physically");

    // Segundo arquivo na mesma subpasta: prefixo 002_ e nome pelo registro
    let proof_file_2 = ext_dir.path().join("comprovante_tese.pdf");
    let data_2 = json!({
        "ano": 2026,
        "tipo": "Doutorado",
        "aluno": "João Santos",
        "titulo": "Segunda Tese",
        "folder": r"11_bancas\doutorado"
    });

    let rec2 = commands::create_record_impl(
        &db,
        root_path,
        "bancas",
        &data_2,
        Some(proof_file_2.to_str().unwrap()),
        None,
    )
    .expect("Failed to create second record");

    assert_eq!(rec2.file.as_deref(), Some("002_joao_santos_segunda_tese.pdf"));
    assert_eq!(
        rec2.path.as_deref(),
        Some(r"11_bancas\doutorado\002_joao_santos_segunda_tese.pdf")
    );
}

#[test]
fn test_update_record_and_file_replacement() {
    let db = setup_test_db();
    let temp_root = TempDir::new("update_replace");
    let root_path = temp_root.path();

    let ext_dir = TempDir::new("ext_replace");
    let doc_v1 = ext_dir.path().join("relatorio_v1.pdf");
    fs::write(&doc_v1, b"v1 content").unwrap();

    // 1. Initial creation
    let init_data = json!({
        "ano": 2025,
        "tipo": "Projetos de pesquisa",
        "descricao": "Projeto de Inovação 2025",
        "folder": r"4_projetos\pesquisa"
    });

    let rec = commands::create_record_impl(
        &db,
        root_path,
        "projetos",
        &init_data,
        Some(doc_v1.to_str().unwrap()),
        None,
    )
    .expect("Create initial project");

    let original_file = root_path.join(rec.path.as_ref().unwrap());
    assert!(original_file.exists());

    // 2. Update metadata and replace attached file
    let doc_v2 = ext_dir.path().join("relatorio_v2_final.pdf");
    fs::write(&doc_v2, b"v2 final content").unwrap();

    let update_data = json!({
        "descricao": "Projeto de Inovação 2025 - Fase 2",
        "folder": r"4_projetos\pesquisa"
    });

    let updated = commands::update_record_impl(
        &db,
        root_path,
        "projetos",
        rec.id,
        &update_data,
        Some(doc_v2.to_str().unwrap()),
        None,
    )
    .expect("Update project");

    assert_eq!(
        updated.descricao.as_deref(),
        Some("Projeto de Inovação 2025 - Fase 2")
    );
    assert_eq!(updated.attachments.len(), 2);
    assert_eq!(updated.attachments[1].file, "002_projeto_de_inovacao_2025_fase_2.pdf");
    assert_eq!(
        updated.attachments[1].path,
        r"4_projetos\pesquisa\002_projeto_de_inovacao_2025_fase_2.pdf"
    );

    // Verify v1 is retained (safety principle) and v2 is created
    assert!(original_file.exists(), "Original file must be retained");
    let new_file = root_path.join(&updated.attachments[1].path);
    assert!(new_file.exists(), "New file must exist");
}

#[test]
fn test_delete_record_retention_vs_removal() {
    let db = setup_test_db();
    let temp_root = TempDir::new("delete_retention");
    let root_path = temp_root.path();

    let ext_dir = TempDir::new("delete_ext");

    // Case 1: Soft delete (delete_file = false)
    let doc_soft = ext_dir.path().join("cert_soft.pdf");
    fs::write(&doc_soft, b"soft").unwrap();

    let rec_soft = commands::create_record_impl(
        &db,
        root_path,
        "dadosgerais",
        &json!({
            "ano": 2024,
            "tipo": "Identificação",
            "descricao": "Documento Pessoal",
            "folder": r"1_dados_gerais\pessoal"
        }),
        Some(doc_soft.to_str().unwrap()),
        None,
    )
    .unwrap();

    let soft_path = root_path.join(rec_soft.path.unwrap());
    assert!(soft_path.exists());

    commands::delete_record_impl(&db, root_path, "dadosgerais", rec_soft.id, false)
        .expect("Soft delete");
    assert!(soft_path.exists(), "File must be retained when delete_file=false");

    let list_soft = commands::get_records_impl(&db, "dadosgerais", None, None, None).unwrap();
    assert_eq!(list_soft.len(), 0, "Record must be deleted from DB");

    // Case 2: Hard delete (delete_file = true)
    let doc_hard = ext_dir.path().join("cert_hard.pdf");
    fs::write(&doc_hard, b"hard").unwrap();

    let rec_hard = commands::create_record_impl(
        &db,
        root_path,
        "dadosgerais",
        &json!({
            "ano": 2024,
            "tipo": "Identificação",
            "descricao": "Documento Provisório",
            "folder": r"1_dados_gerais\pessoal"
        }),
        Some(doc_hard.to_str().unwrap()),
        None,
    )
    .unwrap();

    let hard_path = root_path.join(rec_hard.path.unwrap());
    assert!(hard_path.exists());

    commands::delete_record_impl(&db, root_path, "dadosgerais", rec_hard.id, true)
        .expect("Hard delete");
    assert!(!hard_path.exists(), "File must be removed when delete_file=true");
}

#[test]
fn test_subfolder_mappings_and_stats() {
    let db = setup_test_db();
    let temp_root = TempDir::new("mappings_stats");
    let root_path = temp_root.path();

    // 1. Add mappings
    let map1 = commands::add_subfolder_mapping_impl(
        &db,
        root_path,
        "Produções",
        "Artigos Internacionais",
        r"5_producoes\artigos_internacionais",
    )
    .expect("Add mapping 1");

    assert_eq!(map1.category_group, "Produções");
    assert_eq!(map1.description, "Artigos Internacionais");
    assert!(root_path.join(r"5_producoes\artigos_internacionais").exists());

    let _map2 = commands::add_subfolder_mapping_impl(
        &db,
        root_path,
        "Bancas",
        "Mestrado",
        r"11_bancas\mestrado",
    )
    .expect("Add mapping 2");

    // 2. Get mappings
    let all_maps = commands::get_subfolder_mappings_impl(&db, None).unwrap();
    assert!(all_maps.len() >= 2);
    assert!(all_maps.iter().any(|m| m.description == "Artigos Internacionais"));
    assert!(all_maps.iter().any(|m| m.description == "Mestrado"));

    let producoes_maps =
        commands::get_subfolder_mappings_impl(&db, Some("Produções")).unwrap();
    assert_eq!(producoes_maps.len(), 1);
    assert_eq!(producoes_maps[0].description, "Artigos Internacionais");

    // 3. Stats verification
    let stats = commands::get_app_stats_impl(&db, root_path).unwrap();
    assert_eq!(stats.total_mappings, all_maps.len() as i64);
    assert_eq!(stats.total_records, 0);
}

#[test]
fn test_open_and_reveal_error_handling() {
    let temp_root = TempDir::new("open_reveal");
    let root_path = temp_root.path();

    // Non-existent file should return Err
    let res_open = commands::open_file_impl(root_path, r"arquivo_inexistente.pdf");
    assert!(res_open.is_err());
    assert!(res_open.unwrap_err().contains("não encontrado"));

    let res_reveal = commands::reveal_in_explorer_impl(root_path, r"arquivo_inexistente.pdf");
    assert!(res_reveal.is_err());
    assert!(res_reveal.unwrap_err().contains("não encontrado"));

    // open_folder creates folder if missing
    let target_sub = r"nova_pasta\subfolder";
    let _ = commands::open_folder_impl(root_path, target_sub);
    assert!(root_path.join(target_sub).exists());
}

#[test]
fn test_import_from_excel_error_on_missing_file() {
    let db = setup_test_db();
    let temp_root = TempDir::new("import_missing");

    let res = commands::import_from_excel_impl(
        &db,
        temp_root.path(),
        Some(r"caminho\inexistente\lattes.xlsm"),
    );
    assert!(res.is_err());
    assert!(res.unwrap_err().contains("não encontrado"));
}

#[test]
fn test_paths_cannot_escape_root() {
    let base = TempDir::new("escape");
    let root = base.path().join("curriculo");
    fs::create_dir_all(&root).unwrap();
    fs::write(base.path().join("fora.txt"), b"x").unwrap();
    fs::write(root.join("dentro.txt"), b"x").unwrap();

    assert!(commands::resolve_inside_root(&root, "dentro.txt").is_ok());
    assert!(commands::resolve_inside_root(&root, "../fora.txt").is_err());
    assert!(commands::resolve_inside_root(&root, r"..\fora.txt").is_err());
    let abs = base.path().join("fora.txt").to_string_lossy().to_string();
    assert!(commands::resolve_inside_root(&root, &abs).is_err());
    assert!(commands::open_file_impl(&root, "../fora.txt").is_err());
    assert!(commands::reveal_in_explorer_impl(&root, "../fora.txt").is_err());

    // open_folder não cria pastas fora da raiz
    let _ = commands::open_folder_impl(&root, "../criada_fora");
    assert!(!base.path().join("criada_fora").exists());
    assert_eq!(lattes_app::files::rel_join(&root, r"..\..\a\..\b"), root.join("a").join("b"));
}

#[test]
fn test_search_ignores_accents_and_case() {
    let db = setup_test_db();
    let root = TempDir::new("accents");
    commands::create_record_impl(&db, root.path(), "formacao", &json!({ "ano": 2020, "tipo": "Curso", "descricao": "FORMAÇÃO EM AVALIAÇÃO" }), None, None).unwrap();
    for q in ["formacao", "FORMAÇÃO", "avaliação", "Avaliacao"] {
        let found = commands::get_records_impl(&db, "formacao", Some(q), None, None).unwrap();
        assert_eq!(found.len(), 1, "busca por '{}'", q);
    }
}

#[test]
fn test_schema_migrations_reach_latest_and_are_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    schema::create_tables(&conn).unwrap();
    assert_eq!(schema::schema_version(&conn).unwrap(), schema::MIGRATIONS.len());
    schema::create_tables(&conn).unwrap();
    assert_eq!(schema::schema_version(&conn).unwrap(), schema::MIGRATIONS.len());
    let idx: i64 = conn
        .query_row("SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_producoes_ano_tipo'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(idx, 1);
}

#[test]
fn test_profile_photo_validates_and_replaces() {
    let base = TempDir::new("photo");
    let root = base.path().join("dados");
    fs::create_dir_all(&root).unwrap();
    let fake = base.path().join("falsa.png");
    fs::write(&fake, b"<html>nao e imagem</html>").unwrap();
    assert!(commands::set_profile_photo_impl(&root, &fake).is_err());
    assert_eq!(commands::profile_photo_impl(&root), None);

    let png = base.path().join("a.png");
    fs::write(&png, b"\x89PNG\r\n\x1a\nresto").unwrap();
    assert_eq!(commands::set_profile_photo_impl(&root, &png).unwrap(), "perfil/foto_perfil.png");

    // JPEG com extensão errada: vale o conteúdo, e a foto anterior sai
    let jpg = base.path().join("b.png");
    fs::write(&jpg, [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).unwrap();
    assert_eq!(commands::set_profile_photo_impl(&root, &jpg).unwrap(), "perfil/foto_perfil.jpg");
    assert!(!root.join("perfil/foto_perfil.png").exists());
    assert_eq!(commands::profile_photo_impl(&root).as_deref(), Some("perfil/foto_perfil.jpg"));
    assert!(commands::resolve_inside_root(&root, "perfil/foto_perfil.jpg").is_ok());

    commands::remove_profile_photo_impl(&root).unwrap();
    assert_eq!(commands::profile_photo_impl(&root), None);
}

#[test]
fn test_record_url_roundtrip_and_validation() {
    let db = setup_test_db();
    let root = TempDir::new("url");

    let r = commands::create_record_impl(&db, root.path(), "eventos", &json!({ "ano": 2024, "tipo": "Congresso", "descricao": "Evento X" }), None, None).unwrap();
    assert_eq!(r.url, None, "URL é vazia por padrão");

    let r = commands::update_record_impl(&db, root.path(), "eventos", r.id, &json!({ "url": "www.evento.org/anais" }), None, None).unwrap();
    assert_eq!(r.url.as_deref(), Some("https://www.evento.org/anais"));
    assert_eq!(r.descricao.as_deref(), Some("Evento X"), "outros campos preservados");

    // atualização sem a chave "url" não apaga o link
    let r = commands::update_record_impl(&db, root.path(), "eventos", r.id, &json!({ "descricao": "Evento Y" }), None, None).unwrap();
    assert_eq!(r.url.as_deref(), Some("https://www.evento.org/anais"));
    let listed = commands::get_records_impl(&db, "eventos", None, None, None).unwrap();
    assert_eq!(listed[0].url.as_deref(), Some("https://www.evento.org/anais"));

    // vazio remove; esquemas perigosos são recusados
    let r = commands::update_record_impl(&db, root.path(), "eventos", r.id, &json!({ "url": "  " }), None, None).unwrap();
    assert_eq!(r.url, None);
    for bad in ["javascript:alert(1)", "file:///C:/x", "mailto:a@b.com", "http://semponto", "https://a b.com"] {
        assert!(commands::update_record_impl(&db, root.path(), "eventos", r.id, &json!({ "url": bad }), None, None).is_err(), "{}", bad);
    }

    let p = commands::create_record_impl(&db, root.path(), "producoes", &json!({ "ano": 2025, "titulo": "Artigo", "url": "10.1016/j.x.2025.1" }), None, None).unwrap();
    assert_eq!(p.url.as_deref(), Some("https://doi.org/10.1016/j.x.2025.1"));
}

#[test]
fn test_custom_category_record_url() {
    let db = setup_test_db();
    let root = TempDir::new("url_custom");
    let cat = {
        let conn = db.lock().unwrap();
        lattes_app::custom::save_category(&conn, root.path(), lattes_app::custom::CustomCategory { name: "Prêmios".into(), ..Default::default() }).unwrap()
    };
    let r = commands::create_record_impl(&db, root.path(), &cat.key, &json!({ "ano": 2023, "titulo": "Prêmio", "url": "https://premio.org" }), None, None).unwrap();
    assert_eq!(r.url.as_deref(), Some("https://premio.org"));
    let listed = commands::get_records_impl(&db, &cat.key, None, None, None).unwrap();
    assert_eq!(listed[0].url.as_deref(), Some("https://premio.org"));
}

#[test]
fn test_shell_paths_absolute_inside_root_and_saved_files() {
    let base = TempDir::new("reveal");
    let root = base.path().join("curriculo");
    fs::create_dir_all(&root).unwrap();
    let inside = root.join("nota.pdf");
    fs::write(&inside, b"%PDF-").unwrap();
    let outside = base.path().join("Comprovantes.pdf");
    fs::write(&outside, b"%PDF-").unwrap();
    let st = lattes_app::AppState::new(Connection::open_in_memory().unwrap(), root.clone());

    // relativo e absoluto dentro da pasta do currículo
    assert!(commands::resolve_for_shell(&st, "nota.pdf").is_ok());
    assert!(commands::resolve_for_shell(&st, &inside.to_string_lossy()).is_ok());
    assert!(commands::resolve_inside_root(&root, &inside.to_string_lossy()).is_ok());

    // fora da pasta: só depois que o app gravou o arquivo para o usuário
    let abs_out = outside.to_string_lossy().to_string();
    assert!(commands::resolve_for_shell(&st, &abs_out).is_err());
    st.remember_saved(&outside);
    assert_eq!(commands::resolve_for_shell(&st, &abs_out).unwrap(), lattes_app::real_path(&outside));

    // outro arquivo fora da pasta continua barrado
    let other = base.path().join("alheio.pdf");
    fs::write(&other, b"x").unwrap();
    assert!(commands::resolve_for_shell(&st, &other.to_string_lossy()).is_err());
    assert!(commands::resolve_inside_root(&root, &other.to_string_lossy()).is_err());
}

#[test]
fn test_doi_in_pdf_survives_bad_files() {
    // numa varredura em lote, um arquivo ilegível não pode derrubar o app
    assert_eq!(lattes_app::tools::doi_in_pdf(b"isto nao e um PDF"), None);
    assert_eq!(lattes_app::tools::doi_in_pdf(&[]), None);
    assert_eq!(lattes_app::tools::doi_in_pdf(b"%PDF-1.7\n truncado"), None);
}
