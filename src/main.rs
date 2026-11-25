#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lattes_app::commands;
use lattes_app::db;
use lattes_app::AppState;
fn main() {
    // Pasta de dados: configurada em Configurações › Pasta de dados, ou detectada
    let (root_dir, _from_config) = lattes_app::config::resolve_data_dir();
    let canonical_root =
        lattes_app::strip_verbatim(&std::fs::canonicalize(&root_dir).unwrap_or(root_dir));
    let db_path = canonical_root.join("lattes.db");

    let conn = db::init_db(&db_path).expect("Failed to initialize SQLite database");
    let scope_root = lattes_app::strip_verbatim(&canonical_root);
    let app_state = AppState::new(conn, canonical_root);

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_state)
        .setup(move |app| {
            use tauri::Manager;
            // Visualizador interno: libera apenas a pasta do currículo no asset protocol
            app.asset_protocol_scope()
                .allow_directory(&scope_root, true)?;
            // índice de textos dos comprovantes em segundo plano (classificação de documentos)
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let st = handle.state::<AppState>();
                let _ = commands::update_doc_index(&st);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::get_records,
            commands::create_record,
            commands::update_record,
            commands::batch_update_records,
            commands::delete_record,
            commands::batch_delete_records,
            commands::batch_unlink_attachments,
            commands::get_subfolder_mappings,
            commands::add_subfolder_mapping,
            commands::select_source_file,
            commands::open_file,
            commands::reveal_in_explorer,
            commands::open_folder,
            commands::get_app_stats,
            commands::select_xml_file,
            commands::preview_lattes_xml,
            commands::import_lattes_xml,
            commands::update_subfolder_mapping,
            commands::delete_subfolder_mapping,
            commands::get_dropdown_options,
            commands::set_dropdown_options,
            commands::get_all_records,
            commands::resolve_file_path,
            commands::read_file_bytes,
            commands::read_system_font,
            commands::get_lattes_profile,
            commands::get_app_version,
            commands::check_update,
            commands::install_update,
            commands::get_profile_photo,
            commands::pick_profile_photo,
            commands::add_barema_documents,
            commands::remove_barema_document,
            commands::remove_profile_photo,
            commands::select_save_path,
            commands::write_report,
            commands::write_preview_temp,
            commands::compress_pdf,
            commands::get_setting,
            commands::set_setting,
            commands::suggest_file_links,
            commands::apply_file_links,
            commands::find_duplicate_records,
            commands::get_data_dir_info,
            commands::pick_folder,
            commands::inspect_data_dir,
            commands::set_data_dir,
            commands::reset_data_dir,
            commands::extract_pdf_metadata,
            commands::open_doi,
            commands::resolve_doi,
            commands::find_doi_by_title,
            commands::extract_record_doi,
            commands::open_url,
            commands::list_custom_categories,
            commands::save_custom_category,
            commands::delete_custom_category,
            commands::reorder_custom_categories,
            commands::preview_file_renames,
            commands::apply_file_renames,
            commands::repair_file_links,
            commands::check_files,
            commands::scan_pendencias,
            commands::pick_qualis_file,
            commands::qualis_import,
            commands::qualis_info,
            commands::qualis_list,
            commands::citescore_key_status,
            commands::citescore_set_key,
            commands::citescore_test_key,
            commands::citescore_data,
            commands::citescore_fetch,
            commands::journal_metrics,
            commands::qualis_preview,
            commands::qualis_apply,
            commands::fill_issn_openalex,
            commands::sync_autores_xml,
            commands::biblio_import,
            commands::biblio_data,
            commands::biblio_merge,
            commands::biblio_unmerge,
            commands::discentes_report,
            commands::read_pdf_file,
            commands::classify_diagnostics,
            commands::find_similar_records,
            commands::clear_missing_links,
            commands::scan_root_folders,
            commands::remove_audited_folders,
            commands::create_missing_mapped_folders,
            commands::remove_unlinked_mappings,
            commands::delete_orphan_files,
            commands::backup_database,
            commands::export_xlsx,
            commands::analyze_document,
            commands::pdf_scan_image,
            commands::read_image_file,
            commands::pdf_rotation,
            commands::pick_files,
            commands::list_folder_files,
            commands::backup_estimate,
            commands::pick_backup_target,
            commands::create_backup,
            commands::pick_backup_file,
            commands::inspect_backup,
            commands::restore_backup,
            commands::verify_backup_integrity,
            commands::scan_vassoura,
            commands::apply_vassoura,
            commands::diff_lattes_xml,
            commands::cross_check_lattes_xml,
            commands::sync_openalex_metrics,
            commands::sync_orcid_works,
            commands::get_scholar_config,
            commands::save_scholar_config,
            commands::sync_scholar_citations,
            commands::get_unmatched_scholar_articles,
            commands::add_record_attachment,
            commands::remove_record_attachment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
