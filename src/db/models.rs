use rusqlite::Row;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ==========================================
// 1. Core Metadata & Mapping Models
// ==========================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct AppMetadata {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct SubfolderMapping {
    pub id: i64,
    pub category_group: String,
    pub description: String,
    pub folder: String,
    pub created_at: Option<String>,
}

impl SubfolderMapping {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            category_group: row.get("category_group")?,
            description: row.get("description")?,
            folder: row.get("folder")?,
            created_at: row.get("created_at")?,
        })
    }
}

// ==========================================
// 2. Entity Models (All 10 Tables)
// ==========================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct DadosGeraisRecord {
    pub id: i64,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub identifier: Option<String>,
    pub file: Option<String>,
    pub folder: Option<String>,
    pub descricao: Option<String>,
    pub log: Option<String>,
    pub path: Option<String>,
}

impl DadosGeraisRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            ano: row.get("ano")?,
            tipo: row.get("tipo")?,
            identifier: row.get("identifier")?,
            file: row.get("file")?,
            folder: row.get("folder")?,
            descricao: row.get("descricao")?,
            log: row.get("log")?,
            path: row.get("path")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct FormacaoRecord {
    pub id: i64,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub identifier: Option<String>,
    pub file: Option<String>,
    pub folder: Option<String>,
    pub descricao: Option<String>,
    pub horas: Option<i64>,
    pub log: Option<String>,
    pub path: Option<String>,
}

impl FormacaoRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            ano: row.get("ano")?,
            tipo: row.get("tipo")?,
            identifier: row.get("identifier")?,
            file: row.get("file")?,
            folder: row.get("folder")?,
            descricao: row.get("descricao")?,
            horas: row.get("horas")?,
            log: row.get("log")?,
            path: row.get("path")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct EncargosRecord {
    pub id: i64,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub identifier: Option<String>,
    pub file: Option<String>,
    pub folder: Option<String>,
    pub descricao: Option<String>,
    pub horas: Option<i64>,
    pub log: Option<String>,
    pub path: Option<String>,
}

impl EncargosRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            ano: row.get("ano")?,
            tipo: row.get("tipo")?,
            identifier: row.get("identifier")?,
            file: row.get("file")?,
            folder: row.get("folder")?,
            descricao: row.get("descricao")?,
            horas: row.get("horas")?,
            log: row.get("log")?,
            path: row.get("path")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct DisciplinasRecord {
    pub id: i64,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub curso: Option<String>,
    pub identifier: Option<String>,
    pub file: Option<String>,
    pub folder: Option<String>,
    pub disciplina: Option<String>,
    pub horas: Option<i64>,
    pub alunos: Option<i64>,
    pub log: Option<String>,
    pub path: Option<String>,
}

impl DisciplinasRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            ano: row.get("ano")?,
            tipo: row.get("tipo")?,
            curso: row.get("curso")?,
            identifier: row.get("identifier")?,
            file: row.get("file")?,
            folder: row.get("folder")?,
            disciplina: row.get("disciplina")?,
            horas: row.get("horas")?,
            alunos: row.get("alunos")?,
            log: row.get("log")?,
            path: row.get("path")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ProjetosRecord {
    pub id: i64,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub identifier: Option<String>,
    pub file: Option<String>,
    pub folder: Option<String>,
    pub descricao: Option<String>,
    pub log: Option<String>,
    pub path: Option<String>,
}

impl ProjetosRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            ano: row.get("ano")?,
            tipo: row.get("tipo")?,
            identifier: row.get("identifier")?,
            file: row.get("file")?,
            folder: row.get("folder")?,
            descricao: row.get("descricao")?,
            log: row.get("log")?,
            path: row.get("path")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ProducoesRecord {
    pub id: i64,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub identifier: Option<String>,
    pub file: Option<String>,
    pub folder: Option<String>,
    pub titulo: Option<String>,
    pub journal: Option<String>,
    pub qualis: Option<String>,
    pub log: Option<String>,
    pub path: Option<String>,
}

impl ProducoesRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            ano: row.get("ano")?,
            tipo: row.get("tipo")?,
            identifier: row.get("identifier")?,
            file: row.get("file")?,
            folder: row.get("folder")?,
            titulo: row.get("titulo")?,
            journal: row.get("journal")?,
            qualis: row.get("qualis")?,
            log: row.get("log")?,
            path: row.get("path")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct PatentesRecord {
    pub id: i64,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub identifier: Option<String>,
    pub file: Option<String>,
    pub folder: Option<String>,
    pub descricao: Option<String>,
    pub log: Option<String>,
    pub path: Option<String>,
}

impl PatentesRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            ano: row.get("ano")?,
            tipo: row.get("tipo")?,
            identifier: row.get("identifier")?,
            file: row.get("file")?,
            folder: row.get("folder")?,
            descricao: row.get("descricao")?,
            log: row.get("log")?,
            path: row.get("path")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct EventosRecord {
    pub id: i64,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub identifier: Option<String>,
    pub file: Option<String>,
    pub folder: Option<String>,
    pub descricao: Option<String>,
    pub log: Option<String>,
    pub path: Option<String>,
}

impl EventosRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            ano: row.get("ano")?,
            tipo: row.get("tipo")?,
            identifier: row.get("identifier")?,
            file: row.get("file")?,
            folder: row.get("folder")?,
            descricao: row.get("descricao")?,
            log: row.get("log")?,
            path: row.get("path")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct OrientacoesRecord {
    pub id: i64,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub identifier: Option<String>,
    pub file: Option<String>,
    pub folder: Option<String>,
    pub aluno: Option<String>,
    pub titulo: Option<String>,
    pub log: Option<String>,
    pub path: Option<String>,
}

impl OrientacoesRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            ano: row.get("ano")?,
            tipo: row.get("tipo")?,
            identifier: row.get("identifier")?,
            file: row.get("file")?,
            folder: row.get("folder")?,
            aluno: row.get("aluno")?,
            titulo: row.get("titulo")?,
            log: row.get("log")?,
            path: row.get("path")?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct BancasRecord {
    pub id: i64,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub identifier: Option<String>,
    pub file: Option<String>,
    pub folder: Option<String>,
    pub aluno: Option<String>,
    pub titulo: Option<String>,
    pub log: Option<String>,
    pub path: Option<String>,
}

impl BancasRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            ano: row.get("ano")?,
            tipo: row.get("tipo")?,
            identifier: row.get("identifier")?,
            file: row.get("file")?,
            folder: row.get("folder")?,
            aluno: row.get("aluno")?,
            titulo: row.get("titulo")?,
            log: row.get("log")?,
            path: row.get("path")?,
        })
    }
}

// ==========================================
// 3. Unified RecordDto for UI & IPC Commands
// ==========================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct RecordDto {
    pub id: i64,
    pub category: String,
    pub ano: Option<i64>,
    pub tipo: Option<String>,
    pub identifier: Option<String>,
    pub file: Option<String>,
    pub folder: Option<String>,
    pub descricao: Option<String>,
    pub horas: Option<i64>,
    pub curso: Option<String>,
    pub disciplina: Option<String>,
    pub alunos: Option<i64>,
    pub titulo: Option<String>,
    pub journal: Option<String>,
    pub qualis: Option<String>,
    pub aluno: Option<String>,
    pub log: Option<String>,
    pub path: Option<String>,
    /// Link opcional do registro (coluna `url` de todas as tabelas, preenchida por `queries::fill_urls`).
    pub url: Option<String>,
}

impl From<DadosGeraisRecord> for RecordDto {
    fn from(r: DadosGeraisRecord) -> Self {
        Self {
            id: r.id,
            category: "dadosgerais".to_string(),
            ano: r.ano,
            tipo: r.tipo,
            identifier: r.identifier,
            file: r.file,
            folder: r.folder,
            descricao: r.descricao,
            log: r.log,
            path: r.path,
            ..Default::default()
        }
    }
}

impl From<FormacaoRecord> for RecordDto {
    fn from(r: FormacaoRecord) -> Self {
        Self {
            id: r.id,
            category: "formacao".to_string(),
            ano: r.ano,
            tipo: r.tipo,
            identifier: r.identifier,
            file: r.file,
            folder: r.folder,
            descricao: r.descricao,
            horas: r.horas,
            log: r.log,
            path: r.path,
            ..Default::default()
        }
    }
}

impl From<EncargosRecord> for RecordDto {
    fn from(r: EncargosRecord) -> Self {
        Self {
            id: r.id,
            category: "encargos".to_string(),
            ano: r.ano,
            tipo: r.tipo,
            identifier: r.identifier,
            file: r.file,
            folder: r.folder,
            descricao: r.descricao,
            horas: r.horas,
            log: r.log,
            path: r.path,
            ..Default::default()
        }
    }
}

impl From<DisciplinasRecord> for RecordDto {
    fn from(r: DisciplinasRecord) -> Self {
        Self {
            id: r.id,
            category: "disciplinas".to_string(),
            ano: r.ano,
            tipo: r.tipo,
            curso: r.curso,
            identifier: r.identifier,
            file: r.file,
            folder: r.folder,
            disciplina: r.disciplina,
            horas: r.horas,
            alunos: r.alunos,
            log: r.log,
            path: r.path,
            ..Default::default()
        }
    }
}

impl From<ProjetosRecord> for RecordDto {
    fn from(r: ProjetosRecord) -> Self {
        Self {
            id: r.id,
            category: "projetos".to_string(),
            ano: r.ano,
            tipo: r.tipo,
            identifier: r.identifier,
            file: r.file,
            folder: r.folder,
            descricao: r.descricao,
            log: r.log,
            path: r.path,
            ..Default::default()
        }
    }
}

impl From<ProducoesRecord> for RecordDto {
    fn from(r: ProducoesRecord) -> Self {
        Self {
            id: r.id,
            category: "producoes".to_string(),
            ano: r.ano,
            tipo: r.tipo,
            identifier: r.identifier,
            file: r.file,
            folder: r.folder,
            titulo: r.titulo,
            journal: r.journal,
            qualis: r.qualis,
            log: r.log,
            path: r.path,
            ..Default::default()
        }
    }
}

impl From<PatentesRecord> for RecordDto {
    fn from(r: PatentesRecord) -> Self {
        Self {
            id: r.id,
            category: "patentes".to_string(),
            ano: r.ano,
            tipo: r.tipo,
            identifier: r.identifier,
            file: r.file,
            folder: r.folder,
            descricao: r.descricao,
            log: r.log,
            path: r.path,
            ..Default::default()
        }
    }
}

impl From<EventosRecord> for RecordDto {
    fn from(r: EventosRecord) -> Self {
        Self {
            id: r.id,
            category: "eventos".to_string(),
            ano: r.ano,
            tipo: r.tipo,
            identifier: r.identifier,
            file: r.file,
            folder: r.folder,
            descricao: r.descricao,
            log: r.log,
            path: r.path,
            ..Default::default()
        }
    }
}

impl From<OrientacoesRecord> for RecordDto {
    fn from(r: OrientacoesRecord) -> Self {
        Self {
            id: r.id,
            category: "orientacoes".to_string(),
            ano: r.ano,
            tipo: r.tipo,
            identifier: r.identifier,
            file: r.file,
            folder: r.folder,
            aluno: r.aluno,
            titulo: r.titulo,
            log: r.log,
            path: r.path,
            ..Default::default()
        }
    }
}

impl From<BancasRecord> for RecordDto {
    fn from(r: BancasRecord) -> Self {
        Self {
            id: r.id,
            category: "bancas".to_string(),
            ano: r.ano,
            tipo: r.tipo,
            identifier: r.identifier,
            file: r.file,
            folder: r.folder,
            aluno: r.aluno,
            titulo: r.titulo,
            log: r.log,
            path: r.path,
            ..Default::default()
        }
    }
}

// ==========================================
// 4. Auxiliary DTOs for Commands
// ==========================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubfolderMappingDto {
    pub id: i64,
    pub category_group: String,
    pub description: String,
    pub folder: String,
    pub created_at: Option<String>,
}

impl From<SubfolderMapping> for SubfolderMappingDto {
    fn from(m: SubfolderMapping) -> Self {
        Self {
            id: m.id,
            category_group: m.category_group,
            description: m.description,
            folder: m.folder,
            created_at: m.created_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppStatsDto {
    pub total_records: i64,
    pub counts_by_category: HashMap<String, i64>,
    pub total_mappings: i64,
    pub db_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MigrationReportDto {
    pub total_imported: usize,
    pub counts_by_category: HashMap<String, usize>,
    pub total_mappings: usize,
    pub warnings: Vec<String>,
}
