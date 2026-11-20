// Tauri IPC commands for Lattes Desktop Manager

use crate::config;
use crate::db::models::{
    AppStatsDto, AttachmentDto, MigrationReportDto, RecordDto, SubfolderMappingDto,
};
use crate::db::queries;
use crate::files::linker;
use crate::files::{shell, storage};
use crate::migration::calamine_importer;
use crate::migration::lattes_xml::{self, XmlProduction};
use crate::AppState;
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

mod files;
mod import;
mod profile;
mod records;
mod tools;
mod viewer;
mod xml;

pub use files::*;
pub use import::*;
pub use profile::*;
pub use records::*;
pub use tools::*;
pub use viewer::*;
pub use xml::*;

#[cfg(test)]
mod tests;
