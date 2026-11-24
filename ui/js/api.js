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
        issn: "0740-7459",
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

/** Dados fictícios da bibliometria (modo navegador, sem o app). */
function mockBiblio() {
  let s = 42;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const nomes = ["Tiago Olivoto", "Maicon Nardino", "Velci Queiróz de Souza", "Ivan Ricardo Carvalho", "Diego Nicolau Follmann", "Mauricio Ferrari", "Vinicius Jardel Szareski", "Alessandro Dal'Col Lúcio", "Alan Junior de Pelegrin", "Maria Inês Diel", "Daniela Meira", "Denise Schmidt", "Bruno Giacomini Sari", "Carine Meier", "José Eduardo Pimentel e Silva", "Matheus Lopes Machado", "Alice Maria Trois", "Rafael Tunes de Resende", "Gustavo Henrique Demari", "Volmir Sergio Marchioro", "Braulio Otomar Caron", "Luis Antonio Klein", "Keli Souza da Silva", "Paulo Romero Oliveira Sousa", "Kamilly Vitoria Siqueira Tonet", "Ana Paula Lima", "Carlos Eduardo Assoni", "Fernanda Costa", "Lucas Peixoto", "Yunbi Xu"];
  const autores = nomes.map((nome, i) => ({ id: i + 1, chave: `k${i + 1}`, nome, eu: i === 0, lattes_id: null, formas: i % 4 === 1 ? [nome, nome.toUpperCase()] : [nome], orientado: [14, 15, 16, 23, 24].includes(i) ? { aluno: nome, niveis: [i % 2 ? "Iniciação Científica" : "Dissertação de mestrado"], confianca: "alta" } : null }));
  const grupos = [[1, 2, 3, 4, 5, 6, 8, 9], [7, 10, 11, 12, 13, 19, 20], [14, 15, 16, 23, 24, 26], [17, 18, 25, 27, 28, 29]];
  const tipos = ["Artigos completos", "Artigos completos", "Resumos simples", "Resumos expandidos", "Capítulos de livros"];
  const producoes = [];
  for (let i = 0; i < 90; i++) {
    const g = grupos[Math.floor(r() * grupos.length)];
    const k = 1 + Math.floor(r() * 6);
    const ids = [1];
    while (ids.length < k) {
      const pick = r() < 0.85 ? g[Math.floor(r() * g.length)] : 2 + Math.floor(r() * 29);
      if (!ids.includes(pick)) ids.push(pick);
    }
    if (r() < 0.4) ids.push(ids.shift());
    producoes.push({ id: i + 1, ano: 2012 + Math.floor(r() * 14), tipo: tipos[Math.floor(r() * tipos.length)], titulo: `Produção de exemplo ${i + 1}`, journal: r() < 0.6 ? "Agronomy Journal" : null, qualis: null, autores: ids });
  }
  return { autores, producoes, mesclas: [{ chave: "silva|j.", destino: "silva|jose", nome: "J. Silva", nome_destino: "José Eduardo Pimentel e Silva" }], total_producoes: 98, sem_autores: 8 };
}

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

    case "batch_unlink_attachments": {
      const ids = new Set((args.ids || []).map(Number));
      let n = 0;
      for (const r of mockState.records[args.category] || []) {
        if (!ids.has(Number(r.id))) continue;
        if (r.path || r.file || r.attachments?.length) n++;
        r.path = null;
        r.file = null;
        r.attachments = [];
      }
      return n;
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

    case "add_barema_documents":
      return [{ name: "Portaria 154-2019.pdf", path: `baremas/${args.baremaId}/Portaria 154-2019.pdf`, size: 2_350_000 }];
    case "remove_barema_document":
      return null;
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

    case "pick_qualis_file":
      return "/mock/Qualis_Periodicos.xlsx";

    case "qualis_import": {
      if (!args.area) return { areas: ["AGRONOMIA", "BIODIVERSIDADE", "CIÊNCIAS AGRÁRIAS I"], info: null };
      mockState.qualisInfo = { arquivo: "Qualis_Periodicos.xlsx", area: args.area, importado_em: "2026-11-23 10:00", entradas: 1040, ignoradas: 4, colunas: { issn: "ISSN", titulo: "TÍTULO", estrato: "ESTRATO", area: "ÁREA DE AVALIAÇÃO" } };
      return { areas: [], info: mockState.qualisInfo };
    }

    case "journal_metrics":
      return {
        1: { qualis_capes: "A3", ano: 2025, citescore: 4.8, percentil: 82, area: "Agronomy and Crop Science", sjr: 0.741, snip: 1.05, url: "https://www.scopus.com/sourceid/15600", fora_scopus: false },
        2: { qualis_capes: "A1", ano: 2025, citescore: 4.2, percentil: 76, area: "Agronomy and Crop Science", sjr: 0.68, snip: 0.98, url: "https://www.scopus.com/sourceid/15601", fora_scopus: false },
        3: { qualis_capes: "B1", ano: null, citescore: null, percentil: null, area: null, sjr: null, snip: null, url: null, fora_scopus: true },
      };

    case "citescore_key_status":
      return mockState.csKey ?? { configurada: false, final_chave: null };

    case "citescore_set_key":
      mockState.csKey = args.key ? { configurada: true, final_chave: args.key.slice(-4) } : { configurada: false, final_chave: null };
      return mockState.csKey;

    case "citescore_test_key":
      return { ok: true, sem_percentil: false, mensagem: "Chave funcionando: Nature — CiteScore 2024 90.0, percentil 99." };

    case "citescore_fetch":
      mockState.csFetched = true;
      return { consultadas: 6, encontradas: 5, nao_encontradas: 1, sem_percentil: false, erro: null };

    case "citescore_data": {
      const chave = mockState.csKey ?? { configurada: false, final_chave: null };
      const rev = (issn, titulo, cs, p, area, n, sjr, snip, sid) => ({ issn, status: "ok", source_id: sid, titulo, editora: "Editora", ano: 2024, citescore: cs, percentil: p, area, areas: [{ codigo: "1102", area, posicao: Math.max(1, Math.round((100 - p) * 4)), percentil: p }, { codigo: "1111", area: "Soil Science", posicao: 80, percentil: Math.max(0, p - 15) }], sjr, snip, consultado_em: "2026-11-23 10:00", url: `https://www.scopus.com/sourceid/${sid}`, artigos: n });
      const revistas = mockState.csFetched === false ? [] : [
        rev("0002-1962", "Agronomy Journal", 4.8, 82, "Agronomy and Crop Science", 8, 0.741, 1.05, "15600"),
        rev("0011-183X", "Crop Science", 4.2, 76, "Agronomy and Crop Science", 5, 0.68, 0.98, "15601"),
        rev("0100-204X", "Pesquisa Agropecuária Brasileira", 1.6, 38, "Agronomy and Crop Science", 6, 0.31, 0.52, "15602"),
        rev("0014-2336", "Euphytica", 3.4, 61, "Plant Science", 3, 0.52, 0.81, "15603"),
        rev("1807-8621", "Acta Scientiarum. Agronomy", 1.1, 19, "Agronomy and Crop Science", 4, 0.22, 0.41, "15604"),
        { issn: "2594-8245", status: "nao_encontrada", source_id: null, titulo: null, editora: null, ano: null, citescore: null, percentil: null, area: null, areas: [], sjr: null, snip: null, consultado_em: "2026-11-23 10:00", url: null, artigos: 2 },
      ];
      const issns = ["0002-1962", "0011-183X", "0100-204X", "0014-2336", "1807-8621", "2594-8245", null];
      const artigos = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, titulo: `Artigo de exemplo ${i + 1}`, ano: 2014 + (i % 11), journal: "Revista", issn: issns[i % issns.length] }));
      return { chave, revistas, artigos, pendentes: revistas.length ? 0 : 6 };
    }

    case "qualis_info":
      return mockState.qualisInfo ?? null;

    case "qualis_list":
      return [
        { issn: "1435-0645", titulo: "AGRONOMY JOURNAL (ONLINE)", estrato: "A3", area: null, artigos: 8 },
        { issn: "2073-4395", titulo: "AGRONOMY", estrato: "A2", area: null, artigos: 0 },
        { issn: "0100-204X", titulo: "PESQUISA AGROPECUÁRIA BRASILEIRA", estrato: "A3", area: null, artigos: 3 },
        { issn: "0011-183X", titulo: "CROP SCIENCE", estrato: "A1", area: null, artigos: 2 },
        { issn: "1983-6430", titulo: "A FÍSICA NA ESCOLA (ONLINE)", estrato: "A4", area: null, artigos: 0 },
        { issn: "2594-8245", titulo: "A BRUXA", estrato: "C", area: null, artigos: 0 },
        { issn: "1406-894X", titulo: "AGRONOMY RESEARCH", estrato: "B1", area: null, artigos: 1 },
      ];

    case "qualis_preview": {
      if (!mockState.qualisInfo) throw "Importe a planilha do Qualis antes de comparar com os artigos.";
      return {
        info: mockState.qualisInfo,
        total_artigos: 5,
        itens: [
          { id: 101, titulo: "Seleção genômica em milho tropical", ano: 2024, journal: "Pesquisa Agropecuária Brasileira", issn: "0100-204X", atual: "B1", oficial: "A3", via: "issn", issn_tabela: "0100-204X", titulo_tabela: "PESQUISA AGROPECUÁRIA BRASILEIRA" },
          { id: 102, titulo: "Índices multivariados para seleção", ano: 2023, journal: "Crop Science", issn: null, atual: null, oficial: "A1", via: "titulo", issn_tabela: "0011-183X", titulo_tabela: "CROP SCIENCE" },
          { id: 103, titulo: "Interação genótipo × ambiente em soja", ano: 2022, journal: "Euphytica", issn: "0014-2336", atual: "A2", oficial: "A2", via: "issn", issn_tabela: "0014-2336", titulo_tabela: "EUPHYTICA" },
        ],
        sem_correspondencia: [
          { id: 104, titulo: "Artigo em revista local", ano: 2021, journal: "Revista Local de Agronomia", issn: null },
          { id: 105, titulo: "Artigo sem revista", ano: 2020, journal: null, issn: null },
        ],
      };
    }

    case "analyze_document":
      return {
        chars: 820,
        needs_ocr: false,
        treino: 214,
        nome_arquivo: String(args.path || "").split(/[\\/]/).pop(),
        cita_usuario: false,
        sugestoes: [
          { category: "eventos", tipo: "Apresentação de trabalho", prob: 0.78 },
          { category: "producoes", tipo: "Resumos expandidos", prob: 0.15 },
        ],
        campos: { ano: 2023, papel: "Apresentação de trabalho", horas: 20, titulo: "Seleção genômica em milho tropical", descricao: "13º Congresso Brasileiro de Melhoramento de Plantas", doi: "10.1000/xyz" },
        registros: [{ category: "producoes", id: 101, label: "Seleção genômica em milho tropical", ano: 2023, score: 1, via: "doi" }],
      };

    case "find_similar_records":
      return /milho/i.test(args.titulo || "")
        ? [{ id: 101, titulo: "Seleção genômica em milho tropical", ano: 2024, tipo: "Artigos completos", score: 0.93 }]
        : [];

    case "classify_diagnostics":
      return {
        avaliados: 214, sem_texto: 31, acerto_categoria: 187, acerto_top2: 205, acerto_tipo: 151,
        por_categoria: [
          { categoria: "producoes", n: 92, acertos: 89, acertos_tipo: 78 },
          { categoria: "eventos", n: 48, acertos: 39, acertos_tipo: 22 },
          { categoria: "bancas", n: 31, acertos: 29, acertos_tipo: 25 },
          { categoria: "formacao", n: 25, acertos: 17, acertos_tipo: 14 },
          { categoria: "orientacoes", n: 18, acertos: 13, acertos_tipo: 12 },
        ],
        confusoes: [
          { real: "eventos", previsto: "formacao", n: 7 },
          { real: "formacao", previsto: "eventos", n: 6 },
          { real: "orientacoes", previsto: "bancas", n: 4 },
        ],
        erros: [
          { path: "9_eventos\\participacao\\012_simposio.pdf", real: "eventos", real_tipo: "Participação em eventos", previsto: "formacao", previsto_tipo: "Cursos de curta duração" },
          { path: "2_formacao\\cursos\\004_minicurso_r.pdf", real: "formacao", real_tipo: "Cursos de curta duração", previsto: "eventos", previsto_tipo: "Participação em eventos" },
        ],
      };

    case "sync_autores_xml":
      return { no_xml: 140, atualizadas: 128, sem_correspondencia: 12 };

    case "biblio_import":
      return { no_xml: 230, atualizadas: 12, sem_correspondencia: 3 };

    case "biblio_data":
      return mockBiblio();

    case "biblio_merge":
    case "biblio_unmerge":
      return 1;

    case "discentes_report": {
      const d = (orientacao_id, aluno, nivel, ano_orientacao, confianca, autor = aluno, fora_periodo = false) => ({ orientacao_id, aluno, nivel, ano_orientacao, autor, confianca, fora_periodo });
      return {
        total_producoes: 145,
        com_autores: 128,
        orientados: 27,
        anos_com_autores: [{ ano: 2024, total: 18 }, { ano: 2023, total: 22 }, { ano: 2022, total: 15 }],
        itens: [
          { id: 101, titulo: "Seleção genômica em milho tropical", ano: 2024, tipo: "Artigos completos", journal: "Pesquisa Agropecuária Brasileira", qualis: "A3", discentes: [d(11, "Maria Alice Santos", "Dissertação de mestrado", 2024, "alta"), d(12, "João Pedro Lima", "Tese de doutorado", 2025, "media", "LIMA, J. P.")] },
          { id: 102, titulo: "Índices multivariados para seleção", ano: 2023, tipo: "Artigos completos", journal: "Crop Science", qualis: "A1", discentes: [d(11, "Maria Alice Santos", "Dissertação de mestrado", 2024, "alta")] },
          { id: 103, titulo: "Interação genótipo × ambiente em soja", ano: 2022, tipo: "Resumos expandidos", journal: "Congresso Brasileiro de Melhoramento", qualis: null, discentes: [d(13, "Carla Souza", "Iniciação Científica", 2010, "alta", "Carla Souza", true)] },
        ],
      };
    }

    case "qualis_apply":
      return { ok: (args.items || []).length, erros: [] };

    case "fill_issn_openalex":
      return { consultados: 4, preenchidos: 3, erros: [] };

    case "scan_pendencias": {
      const itens = [
        { category: "producoes", id: 101, titulo: "Seleção genômica em milho tropical", ano: 2024, tipo: "Artigos completos", kind: "sem_doi", detalhe: null },
        { category: "producoes", id: 101, titulo: "Seleção genômica em milho tropical", ano: 2024, tipo: "Artigos completos", kind: "sem_qualis", detalhe: null },
        { category: "producoes", id: 102, titulo: "Índices multivariados para seleção", ano: 2023, tipo: "Artigos completos", kind: "arquivo_ausente", detalhe: "5_producoes\\artigos_completos\\002_indices.pdf" },
        { category: "bancas", id: 7, titulo: "Banca de doutorado — Maria Silva", ano: 2022, tipo: "Doutorado", kind: "sem_comprovante", detalhe: null },
        { category: "orientacoes", id: 12, titulo: "Registro #12", ano: null, tipo: null, kind: "sem_titulo", detalhe: null },
        { category: "orientacoes", id: 12, titulo: "Registro #12", ano: null, tipo: null, kind: "sem_ano", detalhe: null },
      ];
      const por_tipo = {};
      for (const it of itens) por_tipo[it.kind] = (por_tipo[it.kind] || 0) + 1;
      return { total_registros: 48, registros_com_pendencia: 4, por_tipo, itens };
    }

    default:
      console.warn(`[Mock] Unhandled command: ${cmd}`);
      return null;
  }
}

// Comandos que não alteram registros; qualquer outro invalida o cache de get_all_records.
const KEEPS_RECORDS = /^(ping|scan_pendencias|qualis_preview|qualis_import|qualis_info|qualis_list|citescore_data|citescore_key_status|citescore_test_key|journal_metrics|biblio_data|discentes_report|classify_diagnostics|get_|read_|select_|pick_|open_|reveal_|list_|preview_|inspect_|resolve_|find_|suggest_|extract_|analyze_|pdf_|check_|compress_|backup_|create_backup|write_report|export_xlsx|set_setting|set_dropdown_options)/;
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

async function rawInvoke(cmd, args, options = undefined) {
  if (window.__TAURI__?.core?.invoke) {
    return await window.__TAURI__.core.invoke(cmd, args, options);
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

  batchUpdateRecords: (category, ids, data = {}) => {
    const ano = data.ano !== null && data.ano !== undefined && data.ano !== "" ? Number(data.ano) : null;
    const tipo = data.tipo !== null && data.tipo !== undefined && data.tipo !== "" ? String(data.tipo).trim() : null;
    const qualis = data.qualis !== null && data.qualis !== undefined && data.qualis !== "" ? String(data.qualis).trim() : null;
    return invokeCommand("batch_update_records", {
      category,
      ids: (ids || []).map(Number),
      ano,
      tipo,
      qualis,
      data,
    });
  },

  /** Desvincula os comprovantes (anexos e caminho principal) sem apagar os arquivos. */
  batchUnlinkAttachments: (category, ids) =>
    invokeCommand("batch_unlink_attachments", { category, ids: (ids || []).map(Number) }),

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
  /** PDF escolhido pelo usuário (qualquer pasta), para renderizar páginas no OCR. */
  readPdfFile: async (path) => new Uint8Array(await invokeCommand("read_pdf_file", { path })),
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
  writePreviewTemp: (filename, bytes) =>
    hasTauri() ? rawInvoke("write_preview_temp", bytes, { headers: { "x-filename": filename } }) : Promise.resolve(null),
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
  /** Reaponta vínculos quebrados por arquivos renomeados/movidos e remove anexos de registros excluídos. */
  repairFileLinks: () => invokeCommand("repair_file_links"),
  checkFiles: () => invokeCommand("check_files"),
  scanPendencias: () => invokeCommand("scan_pendencias"),
  pickQualisFile: () => invokeCommand("pick_qualis_file"),
  qualisImport: (path, area = null) => invokeCommand("qualis_import", { path, area }),
  qualisInfo: () => invokeCommand("qualis_info"),
  qualisList: () => invokeCommand("qualis_list"),
  qualisPreview: () => invokeCommand("qualis_preview"),
  citescoreKeyStatus: () => invokeCommand("citescore_key_status"),
  citescoreSetKey: (key) => invokeCommand("citescore_set_key", { key }),
  citescoreTestKey: (key = null) => invokeCommand("citescore_test_key", { key }),
  citescoreData: () => invokeCommand("citescore_data"),
  journalMetrics: () => invokeCommand("journal_metrics"),
  citescoreFetch: (todos = false) => invokeCommand("citescore_fetch", { todos }),
  onCitescoreProgress: async (fn) => (window.__TAURI__?.event?.listen ? window.__TAURI__.event.listen("citescore-progress", (e) => fn(e.payload)) : () => { }),
  qualisApply: (items) => invokeCommand("qualis_apply", { items }),
  fillIssnOpenalex: () => invokeCommand("fill_issn_openalex"),
  syncAutoresXml: (xmlPath = null) => invokeCommand("sync_autores_xml", { xmlPath }),
  biblioImport: (xmlPath = null) => invokeCommand("biblio_import", { xmlPath }),
  biblioData: () => invokeCommand("biblio_data"),
  biblioMerge: (chaves, destino) => invokeCommand("biblio_merge", { chaves, destino }),
  biblioUnmerge: (chave) => invokeCommand("biblio_unmerge", { chave }),
  discentesReport: () => invokeCommand("discentes_report"),
  classifyDiagnostics: () => invokeCommand("classify_diagnostics"),
  findSimilarRecords: (category, titulo, ano = null, excludeId = null) => invokeCommand("find_similar_records", { category, titulo, ano, excludeId }),
  clearMissingLinks: (items) => invokeCommand("clear_missing_links", { items }),
  scanRootFolders: () => invokeCommand("scan_root_folders"),
  removeAuditedFolders: (relPaths, removeMappings = false, deleteUnlinkedFiles = false) =>
    invokeCommand("remove_audited_folders", { relPaths, removeMappings, deleteUnlinkedFiles }),
  createMissingMappedFolders: (relPaths) => invokeCommand("create_missing_mapped_folders", { relPaths }),
  removeUnlinkedMappings: (mappingIds) => invokeCommand("remove_unlinked_mappings", { mappingIds }),
  deleteOrphanFiles: (relFiles) => invokeCommand("delete_orphan_files", { relFiles }),
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
  // documentos anexados aos baremas (portarias, planilhas...), em baremas/<id>/
  addBaremaDocuments: (baremaId) => invokeCommand("add_barema_documents", { baremaId }),
  removeBaremaDocument: (path) => invokeCommand("remove_barema_document", { path }),
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
  crossCheckLattesXml: (xmlPath) =>
    invokeCommand("cross_check_lattes_xml", {
      xmlPath,
      xml_path: xmlPath,
    }),
  syncOpenAlexMetrics: (updateCitations = true) =>
    invokeCommand("sync_openalex_metrics", {
      updateCitations: Boolean(updateCitations),
      update_citations: Boolean(updateCitations),
    }),
  syncOrcidWorks: (orcid) =>
    invokeCommand("sync_orcid_works", { orcid }),
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
