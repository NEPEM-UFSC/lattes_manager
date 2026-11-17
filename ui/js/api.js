// Tauri IPC Client Wrapper with Browser Mock Fallback

export function hasTauri() {
  return Boolean(
    window.__TAURI__?.core?.invoke ||
    window.__TAURI__?.invoke ||
    window.__TAURI_INTERNALS__?.invoke
  );
}

// In-memory mock database for testing outside Tauri
const mockState = {
  stats: {
    total_records: 361,
    counts_by_category: {
      dadosgerais: 1,
      formacao: 34,
      encargos: 7,
      disciplinas: 35,
      projetos: 3,
      producoes: 145,
      patentes: 4,
      eventos: 24,
      orientacoes: 27,
      bancas: 81,
    },
    with_file_by_category: {
      dadosgerais: 1,
      formacao: 30,
      encargos: 5,
      disciplinas: 28,
      projetos: 3,
      producoes: 120,
      patentes: 4,
      eventos: 20,
      orientacoes: 25,
      bancas: 70,
    },
    total_mappings: 49,
    db_path: "d:\\Desktop\\UFSC\\lattes\\lattes.db",
  },
  mappings: [
    { id: 1, category_group: "Produções", description: "Artigos completos", folder: "5_producoes\\artigos_completos" },
    { id: 2, category_group: "Produções", description: "Livros publicados", folder: "5_producoes\\livros" },
    { id: 3, category_group: "Bancas", description: "Doutorado", folder: "11_bancas\\doutorado" },
    { id: 4, category_group: "Bancas", description: "Mestrado", folder: "11_bancas\\mestrado" },
    { id: 5, category_group: "Disciplinas", description: "Graduação", folder: "3_atuacao\\disciplinas_graduacao" },
  ],
  records: {
    producoes: [
      {
        id: 1,
        category: "producoes",
        ano: 2024,
        tipo: "Artigos completos",
        titulo: "Model-Driven Engineering for Critical Desktop Systems",
        journal: "IEEE Software",
        qualis: "A1",
        identifier: "001_paper_ieee.pdf",
        file: "001_paper_ieee.pdf",
        folder: "5_producoes\\artigos_completos",
        path: "5_producoes\\artigos_completos\\001_paper_ieee.pdf",
        log: "2024-10-15 14:30:00",
      },
      {
        id: 2,
        category: "producoes",
        ano: 2023,
        tipo: "Artigos completos",
        titulo: "Performance Analysis of Rust in WebAssembly Runtime",
        journal: "ACM Transactions on Computer Systems",
        qualis: "A2",
        identifier: "002_acm_tocs.pdf",
        file: "002_acm_tocs.pdf",
        folder: "5_producoes\\artigos_completos",
        path: "5_producoes\\artigos_completos\\002_acm_tocs.pdf",
        log: "2023-08-20 10:15:00",
      },
      {
        id: 3,
        category: "producoes",
        ano: 2022,
        tipo: "Livros publicados",
        titulo: "Arquitetura de Software Moderna",
        journal: "Editora UFSC",
        qualis: "SQ",
        identifier: null,
        file: null,
        folder: "5_producoes\\livros",
        path: null,
        log: "2022-04-12 09:00:00",
      },
    ],
  },
  settings: {},
};

function mockHandler(cmd, args = {}) {
  console.info(`[IPC Browser Mock] -> ${cmd}`, args);

  switch (cmd) {
    case "ping":
      return "pong";

    case "get_app_stats":
      return JSON.parse(JSON.stringify(mockState.stats));

    case "get_subfolder_mappings": {
      const group = args.categoryGroup || args.category_group;
      if (group) {
        return mockState.mappings.filter(
          (m) => m.category_group.toLowerCase() === group.toLowerCase()
        );
      }
      return [...mockState.mappings];
    }

    case "add_subfolder_mapping": {
      const group = args.categoryGroup || args.category_group;
      const newMapping = {
        id: Date.now(),
        category_group: group,
        description: args.description,
        folder: args.folder,
        created_at: new Date().toISOString(),
      };
      mockState.mappings.push(newMapping);
      mockState.stats.total_mappings += 1;
      return newMapping;
    }

    case "get_records": {
      const cat = args.category || "producoes";
      let list = mockState.records[cat] || [];
      const search = (args.search || "").toLowerCase().trim();
      const year = args.year ? Number(args.year) : null;
      const tipo = (args.tipo || "").trim();

      if (search) {
        list = list.filter((r) =>
          JSON.stringify(r).toLowerCase().includes(search)
        );
      }
      if (year) {
        list = list.filter((r) => r.ano === year);
      }
      if (tipo) {
        list = list.filter((r) => r.tipo === tipo);
      }
      return JSON.parse(JSON.stringify(list));
    }

    case "create_record": {
      const cat = args.category;
      if (!mockState.records[cat]) {
        mockState.records[cat] = [];
      }
      const newRec = {
        id: Date.now(),
        category: cat,
        ...args.data,
        log: new Date().toISOString().replace("T", " ").substring(0, 19),
      };
      const src = args.sourceFile || args.source_file;
      if (src) {
        const fname = src.split(/[\\/]/).pop() || "documento.pdf";
        newRec.file = `001_${fname}`;
        newRec.identifier = newRec.file;
        newRec.path = `${newRec.folder || cat}\\${newRec.file}`;
      }
      mockState.records[cat].push(newRec);
      mockState.stats.total_records += 1;
      mockState.stats.counts_by_category[cat] = (mockState.stats.counts_by_category[cat] || 0) + 1;
      return newRec;
    }

    case "update_record": {
      const cat = args.category;
      const id = Number(args.id);
      const list = mockState.records[cat] || [];
      const idx = list.findIndex((r) => r.id === id);
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...args.data };
        const src = args.newSourceFile || args.new_source_file;
        if (src) {
          const fname = src.split(/[\\/]/).pop() || "atualizado.pdf";
          list[idx].file = `002_${fname}`;
          list[idx].identifier = list[idx].file;
          list[idx].path = `${list[idx].folder || cat}\\${list[idx].file}`;
        }
        return list[idx];
      }
      throw new Error(`Registro ${id} não encontrado na categoria ${cat}`);
    }

    case "delete_record": {
      const cat = args.category;
      const id = Number(args.id);
      if (mockState.records[cat]) {
        mockState.records[cat] = mockState.records[cat].filter((r) => r.id !== id);
        mockState.stats.total_records = Math.max(0, mockState.stats.total_records - 1);
        if (mockState.stats.counts_by_category[cat]) {
          mockState.stats.counts_by_category[cat] = Math.max(0, mockState.stats.counts_by_category[cat] - 1);
        }
      }
      return null;
    }

    case "batch_update_records": {
      const cat = args.category;
      const ids = new Set((args.ids || []).map(Number));
      const list = mockState.records[cat] || [];
      let updated = 0;
      for (const r of list) {
        if (!ids.has(Number(r.id))) continue;
        if (args.ano != null) r.ano = Number(args.ano);
        if (args.tipo != null) r.tipo = args.tipo === "" ? null : args.tipo;
        if (args.qualis != null && cat === "producoes") r.qualis = args.qualis === "" ? null : args.qualis;
        updated += 1;
      }
      return updated;
    }

    case "batch_delete_records": {
      const cat = args.category;
      const ids = new Set((args.ids || []).map(Number));
      const list = mockState.records[cat] || [];
      const before = list.length;
      mockState.records[cat] = list.filter((r) => !ids.has(Number(r.id)));
      const deleted = before - mockState.records[cat].length;
      mockState.stats.total_records = Math.max(0, mockState.stats.total_records - deleted);
      if (mockState.stats.counts_by_category[cat]) {
        mockState.stats.counts_by_category[cat] = Math.max(0, mockState.stats.counts_by_category[cat] - deleted);
      }
      return deleted;
    }

    case "select_source_file":
      return "C:\\Users\\tiago\\Downloads\\comprovante_exemplo.pdf";

    case "open_file":
    case "reveal_in_explorer":
    case "open_folder":
      console.log(`[Mock Action] ${cmd}:`, args);
      return null;

    case "import_from_excel":
      return {
        total_imported: 361,
        counts_by_category: { ...mockState.stats.counts_by_category },
        total_mappings: 49,
        warnings: [],
      };

    case "get_all_records":
      return JSON.parse(JSON.stringify(mockState.records));

    case "get_app_version":
      return "1.0.0";

    case "get_lattes_profile":
      return {
        nome: "Pesquisador UFSC",
        instituicao: "Universidade Federal de Santa Catarina",
        cargo: "Professor Magistério Superior",
        lattes_id: "0000000000000000",
        lattes_url: "https://lattes.cnpq.br/",
        orcid: "0000-0002-0000-0000",
        atualizacao: "14/11/2026",
      };

    case "get_data_dir_info":
      return {
        data_dir: mockState.stats.db_path,
        is_custom: false,
      };

    case "get_setting":
      return mockState.settings[args.key] ?? null;

    case "set_setting":
      mockState.settings[args.key] = args.value;
      return null;

    default:
      console.warn(`[Mock] Unhandled command: ${cmd}`);
      return null;
  }
}

// Comandos que não alteram registros; qualquer outro invalida o cache de get_all_records.
const KEEPS_RECORDS = /^(ping|get_|read_|select_|pick_|open_|reveal_|list_|preview_|inspect_|resolve_|find_|suggest_|extract_|analyze_|pdf_|check_|compress_|backup_|create_backup|write_report|export_xlsx|set_setting|set_dropdown_options)/;
let allRecordsCache = null;

async function getAllRecordsCached() {
  if (!allRecordsCache) {
    allRecordsCache = invokeCommand("get_all_records").catch((e) => {
      allRecordsCache = null;
      throw e;
    });
  }
  return structuredClone(await allRecordsCache);
}

export async function invokeCommand(cmd, args = {}) {
  if (KEEPS_RECORDS.test(cmd)) return rawInvoke(cmd, args);
  allRecordsCache = null;
  try {
    return await rawInvoke(cmd, args);
  } finally {
    allRecordsCache = null; // uma leitura feita durante a gravação pode ter guardado dados antigos
  }
}

async function rawInvoke(cmd, args) {
  if (window.__TAURI__?.core?.invoke) {
    return await window.__TAURI__.core.invoke(cmd, args);
  } else if (window.__TAURI__?.invoke) {
    return await window.__TAURI__.invoke(cmd, args);
  } else if (window.__TAURI_INTERNALS__?.invoke) {
    return await window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  return mockHandler(cmd, args);
}

export const api = {
  ping: () => invokeCommand("ping"),
  hasTauri,

  getRecords: (category, { search = null, year = null, tipo = null } = {}) =>
    invokeCommand("get_records", {
      category,
      search: search || null,
      year: year ? Number(year) : null,
      tipo: tipo || null,
    }),

  createRecord: (category, data, sourceFile = null, sourceFiles = null) =>
    invokeCommand("create_record", {
      category,
      data,
      sourceFile: sourceFile || null,
      source_file: sourceFile || null,
      sourceFiles: sourceFiles || null,
      source_files: sourceFiles || null,
    }),

  updateRecord: (category, id, data, newSourceFile = null, newSourceFiles = null) =>
    invokeCommand("update_record", {
      category,
      id: Number(id),
      data,
      newSourceFile: newSourceFile || null,
      new_source_file: newSourceFile || null,
      newSourceFiles: newSourceFiles || null,
      new_source_files: newSourceFiles || null,
    }),

  addRecordAttachment: (category, recordId, filePath, description = null) =>
    invokeCommand("add_record_attachment", {
      category,
      recordId: Number(recordId),
      record_id: Number(recordId),
      filePath,
      file_path: filePath,
      description: description || null,
    }),

  removeRecordAttachment: (category, recordId, path, deleteFile = false) =>
    invokeCommand("remove_record_attachment", {
      category,
      recordId: Number(recordId),
      record_id: Number(recordId),
      path,
      deleteFile: Boolean(deleteFile),
      delete_file: Boolean(deleteFile),
    }),

  deleteRecord: (category, id, deleteFile = false) =>
    invokeCommand("delete_record", {
      category,
      id: Number(id),
      deleteFile: Boolean(deleteFile),
      delete_file: Boolean(deleteFile),
    }),

  batchUpdateRecords: (category, ids, { ano = null, tipo = null, qualis = null } = {}) =>
    invokeCommand("batch_update_records", {
      category,
      ids: (ids || []).map(Number),
      ano: ano !== null && ano !== undefined && ano !== "" ? Number(ano) : null,
      tipo: tipo !== null && tipo !== undefined ? tipo : null,
      qualis: qualis !== null && qualis !== undefined ? qualis : null,
    }),

  batchDeleteRecords: (category, ids, deleteFiles = false) =>
    invokeCommand("batch_delete_records", {
      category,
      ids: (ids || []).map(Number),
      deleteFiles: Boolean(deleteFiles),
    }),

  getSubfolderMappings: (categoryGroup = null) =>
    invokeCommand("get_subfolder_mappings", {
      categoryGroup: categoryGroup || null,
      category_group: categoryGroup || null,
    }),

  addSubfolderMapping: (categoryGroup, description, folder) =>
    invokeCommand("add_subfolder_mapping", {
      categoryGroup,
      category_group: categoryGroup,
      description,
      folder,
    }),

  selectSourceFile: () => invokeCommand("select_source_file"),
  selectFile: () => invokeCommand("select_source_file"),

  openFile: (relativePath) =>
    invokeCommand("open_file", {
      relativePath,
      relative_path: relativePath,
    }),

  revealInExplorer: (relativePath) =>
    invokeCommand("reveal_in_explorer", {
      relativePath,
      relative_path: relativePath,
    }),

  openFolder: (relativePath = "") =>
    invokeCommand("open_folder", {
      relativePath,
      relative_path: relativePath,
    }),

  getAppStats: () => invokeCommand("get_app_stats"),

  selectXmlFile: () => invokeCommand("select_xml_file"),
  previewLattesXml: (xmlPath = null) =>
    invokeCommand("preview_lattes_xml", { xmlPath: xmlPath || null }),
  importLattesXml: (items) => invokeCommand("import_lattes_xml", { items }),
  updateSubfolderMapping: (id, description, folder) =>
    invokeCommand("update_subfolder_mapping", { id: Number(id), description, folder }),
  deleteSubfolderMapping: (id) => invokeCommand("delete_subfolder_mapping", { id: Number(id) }),
  getDropdownOptions: (field) => invokeCommand("get_dropdown_options", { field }),
  setDropdownOptions: (field, options) => invokeCommand("set_dropdown_options", { field, options }),
  getAllRecords: () => getAllRecordsCached(),

  // Visualizador interno
  resolveFilePath: (relativePath) => invokeCommand("resolve_file_path", { relativePath }),
  /** URL servível pelo asset protocol (null fora do Tauri). */
  fileUrl: (absPath) => window.__TAURI__?.core?.convertFileSrc?.(absPath) ?? null,

  // Relatório de comprovantes
  readFileBytes: async (relativePath) => new Uint8Array(await invokeCommand("read_file_bytes", { relativePath })),
  readSystemFont: async (name) => new Uint8Array(await invokeCommand("read_system_font", { name })),
  getLattesProfile: (xmlPath = null) => invokeCommand("get_lattes_profile", { xmlPath }),
  getAppVersion: () => invokeCommand("get_app_version"),
  getProfilePhoto: () => invokeCommand("get_profile_photo"),
  pickProfilePhoto: () => invokeCommand("pick_profile_photo"),
  removeProfilePhoto: () => invokeCommand("remove_profile_photo"),
  selectSavePath: (suggestedName, kind = "pdf") => invokeCommand("select_save_path", { suggestedName, kind }),
  /** Envia o PDF como corpo binário (sem JSON). */
  writeReport: (bytes) => invokeCommand("write_report", bytes),
  compressPdf: async (bytes) => new Uint8Array(await invokeCommand("compress_pdf", bytes)),
  extractPdfMetadata: (path, online = true) => invokeCommand("extract_pdf_metadata", { path, online }),
  selectPdfFile: () => invokeCommand("select_source_file"),
  openDoi: (doi) => invokeCommand("open_doi", { doi }),
  resolveDoi: (doi, download = true) => invokeCommand("resolve_doi", { doi, download }),
  findDoiByTitle: (titulo) => invokeCommand("find_doi_by_title", { titulo }),
  extractRecordDoi: (category, id) => invokeCommand("extract_record_doi", { category, id }),
  openUrl: (url) => invokeCommand("open_url", { url }),
  listCustomCategories: () => invokeCommand("list_custom_categories"),
  saveCustomCategory: (category) => invokeCommand("save_custom_category", { category }),
  deleteCustomCategory: (key, force = false) => invokeCommand("delete_custom_category", { key, force }),
  reorderCustomCategories: (keys) => invokeCommand("reorder_custom_categories", { keys }),
  previewFileRenames: () => invokeCommand("preview_file_renames"),
  applyFileRenames: (items) => invokeCommand("apply_file_renames", { items }),
  checkFiles: () => invokeCommand("check_files"),
  clearMissingLinks: (items) => invokeCommand("clear_missing_links", { items }),
  backupDatabase: () => invokeCommand("backup_database"),
  // backup completo / restauração
  backupEstimate: () => invokeCommand("backup_estimate"),
  pickBackupTarget: (includeFiles) => invokeCommand("pick_backup_target", { includeFiles }),
  createBackup: (path, includeFiles) => invokeCommand("create_backup", { path, includeFiles }),
  pickBackupFile: () => invokeCommand("pick_backup_file"),
  inspectBackup: (path) => invokeCommand("inspect_backup", { path }),
  restoreBackup: (path, restoreDb, restoreFiles, overwrite) => invokeCommand("restore_backup", { path, restoreDb, restoreFiles, overwrite }),
  /** Escuta o progresso do backup/restauração: fn({done,total,name}). Devolve a função para parar. */
  onBackupProgress: async (fn) => (window.__TAURI__?.event?.listen ? window.__TAURI__.event.listen("backup-progress", (e) => fn(e.payload)) : () => { }),
  // importação em lote
  pickFiles: () => invokeCommand("pick_files"),
  listFolderFiles: (path, recursive = true) => invokeCommand("list_folder_files", { path, recursive }),
  exportXlsx: (sheets) => invokeCommand("export_xlsx", { sheets }),
  analyzeDocument: (path, text = null) => invokeCommand("analyze_document", { path, text }),
  pdfScanImage: async (path) => new Uint8Array(await invokeCommand("pdf_scan_image", { path })),
  pdfRotation: (path) => invokeCommand("pdf_rotation", { path }),
  readImageFile: async (path) => new Uint8Array(await invokeCommand("read_image_file", { path })),
  getDataDirInfo: () => invokeCommand("get_data_dir_info"),
  pickFolder: (title) => invokeCommand("pick_folder", { title }),
  inspectDataDir: (path) => invokeCommand("inspect_data_dir", { path }),
  setDataDir: (path, copyDb) => invokeCommand("set_data_dir", { path, copyDb }),
  resetDataDir: () => invokeCommand("reset_data_dir"),
  suggestFileLinks: () => invokeCommand("suggest_file_links"),
  applyFileLinks: (links) => invokeCommand("apply_file_links", { links }),
  findDuplicateRecords: () => invokeCommand("find_duplicate_records"),
  // Vassoura de comprovantes & Time Machine
  scanVassoura: (externalDir) =>
    invokeCommand("scan_vassoura", { externalDir, external_dir: externalDir }),
  applyVassoura: (items, moveFiles = false) =>
    invokeCommand("apply_vassoura", { items, moveFiles: Boolean(moveFiles), move_files: Boolean(moveFiles) }),
  diffLattesXml: (xmlPathNew, xmlPathOld = null) =>
    invokeCommand("diff_lattes_xml", {
      xmlPathNew,
      xml_path_new: xmlPathNew,
      xmlPathOld: xmlPathOld || null,
      xml_path_old: xmlPathOld || null,
    }),
  verifyBackupIntegrity: (path) => invokeCommand("verify_backup_integrity", { path }),

  // Google Scholar (SerpApi)
  getScholarConfig: () => invokeCommand("get_scholar_config"),
  saveScholarConfig: (authorId, apiKey) =>
    invokeCommand("save_scholar_config", {
      authorId,
      author_id: authorId,
      apiKey,
      api_key: apiKey,
    }),
  syncScholarCitations: (authorId = null, apiKey = null) =>
    invokeCommand("sync_scholar_citations", {
      authorId: authorId || null,
      author_id: authorId || null,
      apiKey: apiKey || null,
      api_key: apiKey || null,
    }),
  getUnmatchedScholarArticles: (forceRefresh = false) =>
    invokeCommand("get_unmatched_scholar_articles", {
      forceRefresh,
      force_refresh: forceRefresh,
    }),

  getSetting: (key) => invokeCommand("get_setting", { key }),
  setSetting: (key, value) => invokeCommand("set_setting", { key, value }),
};
