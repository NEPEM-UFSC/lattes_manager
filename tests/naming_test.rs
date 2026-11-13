use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use lattes_app::files::naming::{
    calculate_next_filename, sanitize_windows_filename, strip_existing_prefix,
};
use lattes_app::files::shell::{format_reveal_arg, resolve_relative_path, reveal_in_explorer};
use lattes_app::files::storage::{compute_relative_path, save_attached_file};

fn setup_test_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("lattes_test_{}_{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("failed to create temp test dir");
    dir
}

#[test]
fn test_naming_empty_folder_produces_001() {
    let dir = setup_test_dir("empty_folder");
    let target = dir.join("empty");

    let next_name = calculate_next_filename(&target, "meu_documento.pdf")
        .expect("calculate_next_filename failed");
    assert_eq!(next_name, "001_meu_documento.pdf");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_naming_populated_folder_produces_max_plus_one() {
    let dir = setup_test_dir("populated_folder");
    let target = dir.join("populated");
    fs::create_dir_all(&target).unwrap();

    File::create(target.join("001_relatorio.pdf")).unwrap();
    File::create(target.join("005_artigo.pdf")).unwrap();
    File::create(target.join("008_comprovante.pdf")).unwrap();

    let next_name = calculate_next_filename(&target, "novo_trabalho.pdf")
        .expect("calculate_next_filename failed");
    assert_eq!(next_name, "009_novo_trabalho.pdf");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_naming_zero_padding_format() {
    let dir = setup_test_dir("pad_folder");
    let target = dir.join("pad");
    fs::create_dir_all(&target).unwrap();

    File::create(target.join("042_tese.pdf")).unwrap();

    let next_name = calculate_next_filename(&target, "defesa.pdf")
        .expect("calculate_next_filename failed");
    assert_eq!(next_name, "043_defesa.pdf");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_naming_existing_prefix_stripping() {
    let dir = setup_test_dir("prefix_stripping");
    let target = dir.join("subfolder");
    fs::create_dir_all(&target).unwrap();

    for i in 1..=12 {
        File::create(target.join(format!("{:03}_doc.pdf", i))).unwrap();
    }

    // Direct function test
    assert_eq!(strip_existing_prefix("001_relatorio.pdf"), "relatorio.pdf");
    assert_eq!(strip_existing_prefix("005_artigo.pdf"), "artigo.pdf");
    assert_eq!(strip_existing_prefix("relatorio.pdf"), "relatorio.pdf");

    // Integration test: file with prefix 005_ attached to folder with max 012_
    let next_name = calculate_next_filename(&target, "005_artigo.pdf")
        .expect("calculate_next_filename failed");
    assert_eq!(next_name, "013_artigo.pdf");
    assert!(!next_name.starts_with("013_005_"), "Detected double prefix!");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_naming_illegal_characters_sanitization() {
    let bad_name = "Relatório: Análise/Projeto *2025*?<test>|final.pdf";
    let sanitized = sanitize_windows_filename(bad_name);

    let invalid_chars = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
    for ch in &invalid_chars {
        assert!(!sanitized.contains(*ch), "Found illegal char: {}", ch);
    }
    assert_eq!(
        sanitized,
        "Relatório_ Análise_Projeto _2025___test__final.pdf"
    );

    // Control characters removal
    let with_ctrl = "documento\x00\x07\x1Fteste.pdf";
    assert_eq!(sanitize_windows_filename(with_ctrl), "documentoteste.pdf");

    // Empty/blank fallback
    assert_eq!(sanitize_windows_filename(""), "arquivo");
    assert_eq!(sanitize_windows_filename("   "), "arquivo");
    assert_eq!(sanitize_windows_filename("..."), "arquivo");
}

#[test]
fn test_naming_trailing_dots_and_spaces_stripping() {
    let name = "meu_arquivo . ...pdf";
    let sanitized = sanitize_windows_filename(name);
    assert_eq!(sanitized, "meu_arquivo.pdf");

    let space_only = "meu_documento   .pdf";
    assert_eq!(sanitize_windows_filename(space_only), "meu_documento.pdf");

    let dot_only = "meu_documento...pdf";
    assert_eq!(sanitize_windows_filename(dot_only), "meu_documento.pdf");
}

#[test]
fn test_naming_portuguese_unicode_diacritics() {
    let dir = setup_test_dir("unicode_diacritics");
    let target = dir.join("orientações_concluídas");
    fs::create_dir_all(&target).unwrap();

    let accented_filename = "001_dissertação_avaliação_produção.pdf";
    File::create(target.join(accented_filename)).unwrap();

    let next_name = calculate_next_filename(&target, "nova_extensão_acadêmica.pdf")
        .expect("calculate_next_filename failed");
    assert!(next_name.contains("extensão"));
    assert!(next_name.contains("acadêmica"));
    assert_eq!(next_name, "002_nova_extensão_acadêmica.pdf");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_storage_zero_byte_file_attachment() {
    let dir = setup_test_dir("zero_byte");
    let target = dir.join("zero_byte_folder");
    let source_file = dir.join("empty_doc.pdf");

    File::create(&source_file).unwrap();
    let meta = fs::metadata(&source_file).unwrap();
    assert_eq!(meta.len(), 0);

    let next_name = calculate_next_filename(&target, "empty_doc.pdf")
        .expect("calculate_next_filename failed");
    assert_eq!(next_name, "001_empty_doc.pdf");

    let attachment = save_attached_file(&source_file, &target, &dir)
        .expect("save_attached_file failed");
    assert_eq!(attachment.filename, "001_empty_doc.pdf");
    assert_eq!(attachment.file_size, 0);
    assert!(target.join("001_empty_doc.pdf").exists());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_storage_file_copying_and_relative_path_calculation() {
    let root_dir = setup_test_dir("storage_root");
    let target_subfolder = root_dir.join("11_bancas").join("graduação");

    let source_file = root_dir.join("tcc_aluno.pdf");
    {
        let mut f = File::create(&source_file).unwrap();
        f.write_all(b"Conteudo do TCC em PDF").unwrap();
    }

    let attachment = save_attached_file(&source_file, &target_subfolder, &root_dir)
        .expect("save_attached_file failed");

    assert_eq!(attachment.filename, "001_tcc_aluno.pdf");
    assert_eq!(attachment.file_size, 22);
    assert_eq!(
        attachment.relative_path,
        "11_bancas\\graduação\\001_tcc_aluno.pdf"
    );
    assert!(target_subfolder.join("001_tcc_aluno.pdf").exists());
    assert!(!attachment.created_at.is_empty());

    // Ingest a second file
    let source_file_2 = root_dir.join("outro_tcc.pdf");
    {
        let mut f = File::create(&source_file_2).unwrap();
        f.write_all(b"Outro relatorio").unwrap();
    }

    let attachment_2 = save_attached_file(&source_file_2, &target_subfolder, &root_dir)
        .expect("save_attached_file 2 failed");

    assert_eq!(attachment_2.filename, "002_outro_tcc.pdf");
    assert_eq!(
        attachment_2.relative_path,
        "11_bancas\\graduação\\002_outro_tcc.pdf"
    );
    assert!(target_subfolder.join("002_outro_tcc.pdf").exists());

    let _ = fs::remove_dir_all(&root_dir);
}

#[test]
fn test_storage_missing_source_returns_err() {
    let root_dir = setup_test_dir("missing_source");
    let target_subfolder = root_dir.join("subfolder");
    let fake_source = root_dir.join("nonexistent_file.pdf");

    let res = save_attached_file(&fake_source, &target_subfolder, &root_dir);
    assert!(res.is_err());
    let err_msg = res.unwrap_err();
    assert!(err_msg.contains("does not exist"));

    let _ = fs::remove_dir_all(&root_dir);
}

#[test]
fn test_shell_resolve_relative_path() {
    let root = PathBuf::from(r"d:\Desktop\UFSC\lattes");
    let rel = r"5_producoes\artigos_completos\001_paper.pdf";
    let resolved = resolve_relative_path(&root, rel);
    assert_eq!(
        resolved,
        root.join(r"5_producoes\artigos_completos\001_paper.pdf")
    );

    // Leading backslash
    let rel_slash = r"\11_bancas\doutorado\005_ata.pdf";
    let resolved_slash = resolve_relative_path(&root, rel_slash);
    assert_eq!(
        resolved_slash,
        root.join(r"11_bancas\doutorado\005_ata.pdf")
    );
}

#[test]
fn test_compute_relative_path() {
    let root = PathBuf::from(r"d:\Desktop\UFSC\lattes");
    let full = PathBuf::from(r"d:\Desktop\UFSC\lattes\11_bancas\graduação\082_doc.pdf");
    let rel = compute_relative_path(&full, &root);
    assert_eq!(rel, "11_bancas\\graduação\\082_doc.pdf");
}

#[test]
fn test_naming_prefix_overflow_past_999_and_1000() {
    let dir = setup_test_dir("overflow_999");
    let target = dir.join("overflow");
    fs::create_dir_all(&target).unwrap();

    // Populate with 999_final.pdf
    File::create(target.join("999_final.pdf")).unwrap();

    // Next should be 1000_novo.pdf
    let next_1000 = calculate_next_filename(&target, "novo.pdf")
        .expect("calculate next after 999 failed");
    assert_eq!(next_1000, "1000_novo.pdf");

    // Create 1000_novo.pdf on disk
    File::create(target.join(&next_1000)).unwrap();

    // Next should advance to 1001_outro.pdf
    let next_1001 = calculate_next_filename(&target, "outro.pdf")
        .expect("calculate next after 1000 failed");
    assert_eq!(next_1001, "1001_outro.pdf");

    // Also verify strip_existing_prefix on >= 1000 prefixes
    assert_eq!(strip_existing_prefix("1000_novo.pdf"), "novo.pdf");
    assert_eq!(strip_existing_prefix("1001_outro.pdf"), "outro.pdf");
    assert_eq!(strip_existing_prefix("10000_muitos.pdf"), "muitos.pdf");

    // Ingesting a file that already has a 1000_ prefix should strip it without double-prefix
    let next_from_prefixed = calculate_next_filename(&target, "1000_novo.pdf")
        .expect("calculate next failed");
    assert_eq!(next_from_prefixed, "1001_novo.pdf");
    assert!(!next_from_prefixed.starts_with("1001_1000_"), "Double prefix detected on >=1000");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_naming_extremely_long_filename_ntfs_safety() {
    let dir = setup_test_dir("long_filename");
    let target = dir.join("docs");
    fs::create_dir_all(&target).unwrap();

    // Extremely long base name (300 characters)
    let long_base = "a".repeat(300);
    let long_name = format!("{}.pdf", long_base);
    let sanitized = sanitize_windows_filename(&long_name);

    // Verify sanitized length keeps filename well within safe bounds
    assert!(
        sanitized.chars().count() <= 245,
        "Sanitized filename too long: {}",
        sanitized.chars().count()
    );
    assert!(sanitized.ends_with(".pdf"));

    // Next filename calculation with prefix
    let next_name = calculate_next_filename(&target, &long_name)
        .expect("calculate_next_filename failed on long name");
    assert!(
        next_name.chars().count() <= 255,
        "Next filename exceeds NTFS 255 limit: {}",
        next_name.chars().count()
    );
    assert!(next_name.starts_with("001_"));
    assert!(next_name.ends_with(".pdf"));

    // Verify actual file creation on NTFS does NOT fail with OS error 123
    let file_path = target.join(&next_name);
    let mut file = File::create(&file_path)
        .expect("Failed to create file on NTFS with long sanitized name (OS error 123?)");
    file.write_all(b"payload content").unwrap();
    assert!(file_path.exists());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_shell_reveal_in_explorer_arg_formatting_and_missing() {
    // 1. Argument formatting test on paths with spaces
    let tricky_path = Path::new(r"d:\Desktop\UFSC\lattes\1_dados_gerais\premios_titulos\001_FELIPE ZANANDREA.pdf");
    let arg = format_reveal_arg(tricky_path);
    assert_eq!(
        arg,
        r#"/select,"d:\Desktop\UFSC\lattes\1_dados_gerais\premios_titulos\001_FELIPE ZANANDREA.pdf""#
    );

    // 2. Argument formatting on verbatim paths \\?\
    let verbatim_path = Path::new(r"\\?\d:\Desktop\UFSC\lattes\Currículo Lattes.pdf");
    let arg_verbatim = format_reveal_arg(verbatim_path);
    assert_eq!(
        arg_verbatim,
        r#"/select,"d:\Desktop\UFSC\lattes\Currículo Lattes.pdf""#
    );

    // 3. Non-existent path returns error before calling explorer
    let fake_path = Path::new(r"d:\Desktop\UFSC\lattes\non_existent_folder_xyz\fake_file.pdf");
    let res = reveal_in_explorer(fake_path);
    assert!(res.is_err());
    assert!(res.unwrap_err().contains("does not exist"));
}

#[test]
fn test_storage_overwrite_resistance_on_existing_dest() {
    let dir = setup_test_dir("overwrite_resistance");
    let target = dir.join("storage");
    fs::create_dir_all(&target).unwrap();

    let source = dir.join("doc.pdf");
    {
        let mut f = File::create(&source).unwrap();
        f.write_all(b"source v1").unwrap();
    }

    // First save: creates 001_doc.pdf
    let att1 = save_attached_file(&source, &target, &dir).unwrap();
    assert_eq!(att1.filename, "001_doc.pdf");

    // Second save of same source: creates 002_doc.pdf, 001 remains intact
    let att2 = save_attached_file(&source, &target, &dir).unwrap();
    assert_eq!(att2.filename, "002_doc.pdf");
    assert!(target.join("001_doc.pdf").exists());
    assert!(target.join("002_doc.pdf").exists());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_storage_concurrent_ingestion_race_condition_free() {
    use std::sync::Arc;
    use std::thread;

    let dir = Arc::new(setup_test_dir("concurrency_race"));
    let target = Arc::new(dir.join("subfolder"));
    fs::create_dir_all(&*target).unwrap();

    let mut handles = Vec::new();
    for i in 0..5 {
        let dir_clone = Arc::clone(&dir);
        let target_clone = Arc::clone(&target);
        handles.push(thread::spawn(move || {
            let source = dir_clone.join(format!("thread_source_{}.pdf", i));
            {
                let mut f = File::create(&source).unwrap();
                write!(f, "thread {} payload", i).unwrap();
            }
            save_attached_file(&source, &target_clone, &dir_clone)
        }));
    }

    let mut results = Vec::new();
    for handle in handles {
        let att = handle.join().unwrap().expect("concurrent save_attached_file failed");
        results.push(att.filename);
    }

    // Verify all 5 threads generated distinct sequential filenames without overwriting
    assert_eq!(results.len(), 5);
    let mut unique_results = results.clone();
    unique_results.sort();
    unique_results.dedup();
    assert_eq!(
        unique_results.len(),
        5,
        "Detected filename collision among concurrent saves: {:?}",
        results
    );

    // Verify all 5 files exist on disk
    for fname in &results {
        assert!(target.join(fname).exists(), "File {} missing from disk!", fname);
    }

    let _ = fs::remove_dir_all(&*dir);
}
