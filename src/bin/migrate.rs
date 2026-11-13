use std::path::{Path, PathBuf};
use lattes_app::db;
use lattes_app::migration;

fn resolve_paths() -> (PathBuf, PathBuf, PathBuf) {
    let root = if Path::new("lattes.xlsm").exists() {
        PathBuf::from(".")
    } else if Path::new("../lattes.xlsm").exists() {
        PathBuf::from("..")
    } else if Path::new(r"d:\Desktop\UFSC\lattes\lattes.xlsm").exists() {
        PathBuf::from(r"d:\Desktop\UFSC\lattes")
    } else {
        panic!("Cannot locate lattes.xlsm in root or parent directory");
    };

    let canonical_root = std::fs::canonicalize(&root).unwrap_or(root);
    let xlsm_path = canonical_root.join("lattes.xlsm");
    let db_path = canonical_root.join("lattes.db");
    (canonical_root, xlsm_path, db_path)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (root_dir, xlsm_path, db_path) = resolve_paths();

    println!("============================================================");
    println!("  Lattes Desktop Manager — Native Migration Engine");
    println!("============================================================");
    println!("Root Directory : {}", root_dir.display());
    println!("Workbook Path  : {}", xlsm_path.display());
    println!("Target SQLite  : {}", db_path.display());

    let start = std::time::Instant::now();

    println!("\n[1/3] Initializing SQLite database schema...");
    let mut conn = db::init_db(&db_path)?;

    println!("[2/3] Extracting records via Calamine and migrating...");
    let report = migration::calamine_importer::migrate_workbook(&mut conn, &xlsm_path, &root_dir)?;

    let elapsed = start.elapsed();

    println!("[3/3] Migration completed successfully in {:.2?}!", elapsed);
    println!("------------------------------------------------------------");
    println!("Entity Table Census:");
    for (sheet, count) in &report.category_counts {
        println!("  - {:<15} : {:>4} records", sheet, count);
    }
    println!("------------------------------------------------------------");
    println!("Total Entity Records   : {:>4}", report.total_records);
    println!("Subfolder Mappings     : {:>4}", report.total_mappings);
    println!("Database File Size     : {} bytes", std::fs::metadata(&db_path)?.len());
    println!("============================================================");

    assert_eq!(report.total_records, 361, "Total entity records must equal 361");
    assert_eq!(report.total_mappings, 49, "Total subfolder mappings must equal 49");

    Ok(())
}
