pub mod models;
pub mod queries;
pub mod schema;

use rusqlite::{Connection, Result};
use std::path::Path;
use std::sync::Mutex;

/// Tauri managed state wrapper for the SQLite database connection.
pub struct DbState(pub Mutex<Connection>);

/// Opens an existing or new SQLite database connection with optimal PRAGMAs and schema initialization.
pub fn open_connection<P: AsRef<Path>>(path: P) -> Result<Connection> {
    let conn = Connection::open(path)?;
    configure_connection(&conn)?;
    schema::init_schema(&conn)?;
    Ok(conn)
}

/// Convenience alias matching PROJECT.md interface contract.
pub fn init_db<P: AsRef<Path>>(path: P) -> Result<Connection> {
    open_connection(path)
}

/// Opens an in-memory SQLite database connection with standard schema, ideal for unit and integration testing.
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    configure_connection(&conn)?;
    schema::init_schema(&conn)?;
    Ok(conn)
}

/// Minúsculas e sem acentos, para buscas que ignoram acentuação ("formacao" acha "FORMAÇÃO").
pub fn fold(s: &str) -> String {
    s.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            'ý' | 'ÿ' => 'y',
            c => c,
        })
        .collect()
}

/// Funções SQL próprias do app: `fold(texto)` (ver [`fold`]).
pub fn register_functions(conn: &Connection) -> Result<()> {
    use rusqlite::functions::FunctionFlags;
    use rusqlite::types::ValueRef;
    conn.create_scalar_function(
        "fold",
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            Ok(match ctx.get_raw(0) {
                ValueRef::Text(t) => Some(fold(&String::from_utf8_lossy(t))),
                ValueRef::Integer(i) => Some(i.to_string()),
                ValueRef::Real(f) => Some(f.to_string()),
                ValueRef::Null | ValueRef::Blob(_) => None,
            })
        },
    )
}

/// Configures essential performance, safety, and concurrency PRAGMAs.
fn configure_connection(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    conn.pragma_update(None, "encoding", "UTF-8")?;
    Ok(())
}
