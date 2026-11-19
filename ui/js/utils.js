// Utilities, Category Schemas, Badges and Toast System

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function showToast(message, type = "info", duration = 3500) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icon = type === "success" ? "✓" : type === "error" ? "⚠️" : "ℹ️";
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/** Paleta curada de cores distintas para tipos de registro (legenda + pills + tabela). */
export const TIPO_PALETTE = [
  "#2563eb", // Azul royal
  "#059669", // Esmeralda
  "#7c3aed", // Violeta
  "#d97706", // Âmbar
  "#0891b2", // Ciano
  "#db2777", // Magenta
  "#dc2626", // Coral
  "#4f46e5", // Índigo
  "#ea580c", // Laranja
  "#0d9488", // Teal
  "#9333ea", // Roxo
  "#0284c7", // Azul celeste
  "#65a30d", // Oliva vivo
  "#e11d48", // Carmesim
];

const fold = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// Regras ordenadas da mais específica para a mais geral para evitar colisões dentro de uma mesma categoria.
const TIPO_COLOR_RULES = [
  [/^identificacao$|identificacao/, 0],
  [/^endereco$|endereco/, 4],
  [/licenca\b|maternidade|paternidade|adocao/, 5],
  [/idiomas?/, 9],
  [/premios?|titulos?/, 3],
  [/texto inicial|curriculo lattes/, 2],
  [/outras informacoes|informacoes relevantes/, 7],
  [/artigos? (completos?|publicados?)/, 0],
  [/artigos? aceitos?/, 13],
  [/^livros?\b|livros? (publicados?|organizados?)/, 2],
  [/capitulos?/, 1],
  [/textos? em jornais|jornais|revistas/, 4],
  [/trabalhos? completos?/, 6],
  [/resumos? expandidos?/, 3],
  [/resumos? completos?/, 7],
  [/resumos?/, 8],
  [/trabalhos?\s*\/\s*palestras?|apresenta|palestras?/, 5],
  [/\bcursos?\b/, 9],
  [/material didatico|didatico/, 10],
  [/midias?|blog/, 11],
  [/radio|tv|televis/, 12],
  [/pos-?doutorado/, 10],
  [/qualificacao de doutorado/, 11],
  [/doutorado|\btese\b/, 0],
  [/qualificacao de mestrado/, 9],
  [/mestrado|dissertacao/, 1],
  [/especializa|\bmba\b/, 2],
  [/pos-?graduacao|\bpos\b/, 2],
  [/graduacao|conclusao de curso|\btcc\b/, 3],
  [/iniciacao cientifica|\bic\b/, 5],
  [/aperfeicoamento/, 4],
  [/monitoria/, 8],
  [/estagio/, 12],
  [/concurso/, 6],
  [/outra natureza/, 7],
  [/pesquisa/, 0],
  [/extensao/, 9],
  [/ensino/, 3],
  [/desenvolvimento/, 2],
  [/patente/, 0],
  [/programas? de computador|software/, 2],
  [/cultivar protegida/, 1],
  [/cultivar/, 12],
  [/participacao/, 0],
  [/organizacao/, 2],
  [/direcao|diretor/, 6],
  [/chefia|chefe/, 8],
  [/coordenacao|coordenador/, 0],
  [/supervisao/, 2],
  [/comissao|comite|colegiado/, 1],
  [/curta duracao/, 13],
  [/formacao academica|titulacao/, 11],
];

/** Cor determinística de cada tipo (compartilhada entre pílulas de filtro e badges da tabela). */
export function tipoColor(tipo) {
  const f = fold(tipo);
  if (!f || f === "sem tipo" || f === "-") return "#64748b";
  for (const [re, idx] of TIPO_COLOR_RULES) {
    if (re.test(f)) return TIPO_PALETTE[idx];
  }
  let h = 2166136261;
  for (let i = 0; i < f.length; i++) {
    h ^= f.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return TIPO_PALETTE[(h >>> 0) % TIPO_PALETTE.length];
}

export function renderTipoBadge(tipo, fallback = "—") {
  const raw = String(tipo ?? "").trim();
  const label = raw || fallback;
  if (!raw && fallback === "—") {
    return `<span class="badge badge-tipo badge-tipo-empty">—</span>`;
  }
  const color = tipoColor(label);
  return `<span class="badge badge-tipo" style="--tc:${color}"><span class="badge-tipo-dot" aria-hidden="true"></span><span>${escapeHtml(label)}</span></span>`;
}

export function renderQualisBadge(qualis) {
  if (!qualis) {
    return `<span class="badge badge-qualis badge-qualis-none">—</span>`;
  }
  const clean = String(qualis).trim().toUpperCase();
  const valid = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "B5", "C", "SQ"];
  const clsKey = valid.includes(clean) ? clean.toLowerCase() : "sq";
  return `<span class="badge badge-qualis badge-qualis-${clsKey}">${escapeHtml(clean)}</span>`;
}

export function renderCitationsBadge(citations) {
  if (citations == null) {
    return `<span class="badge badge-qualis badge-qualis-none" title="Sem dados de citação">—</span>`;
  }
  return `<span class="badge badge-citations" title="${citations} citação(ões) no Google Scholar">💬 ${citations}</span>`;
}

/** Data da última atualização; registros importados do XML ganham a etiqueta "XML". */
export function renderLog(log) {
  const s = String(log || "");
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  const date = m ? `${m[3]}/${m[2]}/${m[1]}` : escapeHtml(s.substring(0, 10)) || "—";
  const xml = /^XML Lattes/i.test(s) ? ' <span class="log-tag" title="Importado do XML do Lattes">XML</span>' : "";
  return `<span class="log-cell">${date}${xml}</span>`;
}

export function renderFileBadge(record) {
  if (!record.path || !record.path.trim()) {
    return `<button type="button" class="badge-file-missing badge-file-link" data-action="link-proof" data-id="${record.id}" title="Sem comprovante — clique para vincular a um existente">+ Vincular</button>`;
  }
  const count = record.attachments?.length || 1;
  const ext = record.path.split(".").pop()?.toUpperCase() || "DOC";
  if (count > 1) {
    return `<button type="button" class="badge-file-present badge-file-multi" data-action="preview" data-id="${record.id}" title="Visualizar comprovantes anexados (${count} arquivos)">
      📎 <span>${escapeHtml(ext)}</span><span class="badge-att-counter" style="margin-left:4px; font-size:10px; font-weight:700; background:rgba(255,255,255,0.22); border-radius:8px; padding:0 4px;">+${count - 1}</span>
    </button>`;
  }
  return `<button type="button" class="badge-file-present" data-action="preview" data-id="${record.id}" title="Visualizar comprovante (${escapeHtml(record.file || record.path)})">
    📎 <span>${escapeHtml(ext)}</span>
  </button>`;
}

/** Subcategorias padrão do menu "Dados gerais" do Lattes (garantidas no seed automático). */
export const DEFAULT_DADOS_GERAIS_MAPPINGS = [
  { description: "Identificação", folder: "1_dados_gerais\\identificacao\\" },
  { description: "Endereço", folder: "1_dados_gerais\\endereco\\" },
  { description: "Licença Maternidade, Paternidade e Adoção", folder: "1_dados_gerais\\licencas\\" },
  { description: "Idiomas", folder: "1_dados_gerais\\idiomas\\" },
  { description: "Prêmios e títulos", folder: "1_dados_gerais\\premios_titulos\\" },
  { description: "Texto inicial do Currículo Lattes", folder: "1_dados_gerais\\texto_inicial\\" },
  { description: "Outras informações relevantes", folder: "1_dados_gerais\\outras_informacoes\\" },
];

/** Subcategorias padrão do menu "Atuação" do Lattes (garantidas no seed automático). */
export const DEFAULT_ATUACAO_MAPPINGS = [
  { description: "Atuação profissional", folder: "3_atuacao\\atuacao_profissional\\" },
  { description: "Linhas de pesquisa", folder: "3_atuacao\\linhas_de_pesquisa\\" },
  { description: "Membro de corpo editorial", folder: "3_atuacao\\membro_de_corpo_editorial\\" },
  { description: "Membro de comitê de assessoramento", folder: "3_atuacao\\membro_de_comite_de_assessoramento\\" },
  { description: "Revisor de periódico", folder: "3_atuacao\\revisor_de_periodico\\" },
  { description: "Revisor de projeto de agência de fomento", folder: "3_atuacao\\revisor_de_projeto_de_agencia_de_fomento\\" },
  { description: "Áreas de atuação", folder: "3_atuacao\\areas_de_atuacao\\" },
  { description: "Comissão", folder: "3_atuacao\\atuacao_profissional\\comissão\\" },
  { description: "Supervisão", folder: "3_atuacao\\atuacao_profissional\\supervisão\\" },
  { description: "Coordenação", folder: "3_atuacao\\atuacao_profissional\\coordenação\\" },
  { description: "Chefia", folder: "3_atuacao\\atuacao_profissional\\chefia\\" },
  { description: "Direção", folder: "3_atuacao\\atuacao_profissional\\direção\\" },
  { description: "Encargos Graduação", folder: "3_atuacao\\atuacao_profissional\\encargos_graduação\\" },
  { description: "Encargos Pós-Graduação", folder: "3_atuacao\\atuacao_profissional\\encargos_pós\\" },
  { description: "Encargos Administrativos", folder: "3_atuacao\\atuacao_profissional\\encargos_adm\\" },
];

export const DEFAULT_INOVACAO_MAPPINGS = [
  { description: "Projetos de inovação", folder: "7_inovacao\\projetos_de_inovacao\\" },
  { description: "Produtos tecnológicos", folder: "7_inovacao\\produtos_tecnologicos\\" },
  { description: "Processos ou técnicas", folder: "7_inovacao\\processos_ou_tecnicas\\" },
  { description: "Transferência de tecnologia", folder: "7_inovacao\\transferencia_de_tecnologia\\" },
  { description: "Spin-offs e startups", folder: "7_inovacao\\spin_offs_e_startups\\" },
  { description: "Outras produções de inovação", folder: "7_inovacao\\outras_inovacoes\\" },
];

export const DEFAULT_EDUCACAO_MAPPINGS = [
  { description: "Artigos de divulgação científica", folder: "8_educacao\\divulgacao_cientifica\\" },
  { description: "Livros e capítulos de divulgação", folder: "8_educacao\\livros_divulgacao\\" },
  { description: "Material didático ou instrucional", folder: "8_educacao\\material_didatico\\" },
  { description: "Mídias sociais, websites e blogs", folder: "8_educacao\\midias_sociais_e_websites\\" },
  { description: "Cursos de curta duração ministrados", folder: "8_educacao\\cursos_de_extensao\\" },
  { description: "Eventos de popularização de C&T", folder: "8_educacao\\eventos_de_popularizacao\\" },
  { description: "Outras produções de divulgação", folder: "8_educacao\\outras_producoes\\" },
];

export const DEFAULT_CATEGORY_SUBFOLDERS = {
  dadosgerais: DEFAULT_DADOS_GERAIS_MAPPINGS,
  formacao: [
    { description: "Formação Acadêmica", folder: "2_formacao\\formacao_academica\\" },
    { description: "Curso de curta duração", folder: "2_formacao\\formacao_complementar\\" },
    { description: "Extensão universitária", folder: "2_formacao\\formacao_complementar\\" },
    { description: "Mba", folder: "2_formacao\\formacao_complementar\\" },
  ],
  atuacao: DEFAULT_ATUACAO_MAPPINGS,
  projetos: [
    { description: "Projetos de pesquisa", folder: "4_projetos\\projetos_pesquisa\\" },
    { description: "Projetos de ensino", folder: "4_projetos\\projetos_ensino\\" },
    { description: "Projetos de extensão", folder: "4_projetos\\projetos_extensão\\" },
  ],
  producoes: [
    { description: "Artigos completos", folder: "5_producoes\\artigos_completos\\" },
    { description: "Artigos aceitos", folder: "5_producoes\\artigos_aceitos\\" },
    { description: "Livros", folder: "5_producoes\\livros\\" },
    { description: "Capítulos de livros", folder: "5_producoes\\capítulos\\" },
    { description: "Textos em jornais/revistas", folder: "5_producoes\\textos_jornais\\" },
    { description: "Resumos completos", folder: "5_producoes\\resumos_completos\\" },
    { description: "Resumos expandidos", folder: "5_producoes\\resumos_expandidos\\" },
    { description: "Resumos simples", folder: "5_producoes\\resumos_simples\\" },
    { description: "Trabalhos/palestras", folder: "5_producoes\\trabalho_palestra\\" },
    { description: "Cursos", folder: "5_producoes\\cursos_ministrados\\" },
    { description: "Material didático", folder: "5_producoes\\material_didatico\\" },
    { description: "Mídias sociais/blog", folder: "5_producoes\\midias_sociais\\" },
    { description: "Programas de rádio/TV", folder: "5_producoes\\radio_tv\\" },
  ],
  patentes: [
    { description: "Patentes", folder: "6_patentes\\patentes\\" },
    { description: "Programas de computador", folder: "6_patentes\\programas_computador\\" },
    { description: "Cultivar protegida", folder: "6_patentes\\cultivar_protegida\\" },
    { description: "Cultivar registrada", folder: "6_patentes\\cultivar_registrada\\" },
  ],
  inovacao: DEFAULT_INOVACAO_MAPPINGS,
  educacao_popularizacao: DEFAULT_EDUCACAO_MAPPINGS,
  eventos: [
    { description: "Participação em eventos", folder: "9_eventos\\participacao_eventos\\" },
    { description: "Organização de eventos", folder: "9_eventos\\organizacao_eventos\\" },
  ],
  orientacoes: [
    { description: "Supervisão de pós-doutorado", folder: "10_orientacoes\\orientacoes_concluidas\\pos_doc\\" },
    { description: "Tese de doutorado", folder: "10_orientacoes\\orientacoes_concluidas\\tese\\" },
    { description: "Dissertação de mestrado", folder: "10_orientacoes\\orientacoes_concluidas\\dissertação\\" },
    { description: "Trabalho de conclusão de curso", folder: "10_orientacoes\\orientacoes_concluidas\\graduação\\" },
    { description: "Iniciação Científica", folder: "10_orientacoes\\orientacoes_concluidas\\ic\\" },
    { description: "Orientação de outra natureza", folder: "10_orientacoes\\orientacoes_concluidas\\outras\\" },
    { description: "Monitoria", folder: "10_orientacoes\\orientacoes_concluidas\\monitoria\\" },
    { description: "Estágio", folder: "10_orientacoes\\orientacoes_concluidas\\estágio\\" },
  ],
  bancas: [
    { description: "Doutorado", folder: "11_bancas\\doutorado\\" },
    { description: "Qualificação de doutorado", folder: "11_bancas\\quali_doutorado\\" },
    { description: "Mestrado", folder: "11_bancas\\mestrado\\" },
    { description: "Qualificação de mestrado", folder: "11_bancas\\quali_mestrado\\" },
    { description: "Graduação", folder: "11_bancas\\graduação\\" },
    { description: "Estágio", folder: "11_bancas\\estágio\\" },
  ],
};

/** Retorna as subcategorias (mappings) de uma categoria combinando o banco com os padrões do Lattes. */
export function getCategoryMappings(cat, mappings = []) {
  const schema = CATEGORY_SCHEMAS[cat];
  const targets = new Set(
    [cat, schema?.dbGroup, schema?.group, schema?.name]
      .filter(Boolean)
      .map((s) => fold(s))
  );
  if (cat === "educacao_popularizacao") {
    targets.add("educacao");
    targets.add("educacao e popularizacao");
    targets.add("educacao e popularizacao de c&t");
  }
  const list = Array.isArray(mappings) ? mappings : [];
  const matched = list.filter((m) => targets.has(fold(m.category_group)));
  const defaults = DEFAULT_CATEGORY_SUBFOLDERS[cat] || [];
  if (!matched.length) {
    return defaults.map((d, i) => ({
      id: -(i + 1),
      category_group: schema?.dbGroup || schema?.group || cat,
      description: d.description,
      folder: d.folder,
    }));
  }
  const seen = new Set(matched.map((m) => fold(m.description)));
  const merged = [...matched];
  for (const d of defaults) {
    if (!seen.has(fold(d.description))) {
      seen.add(fold(d.description));
      merged.push({
        id: -(merged.length + 1),
        category_group: schema?.dbGroup || schema?.group || cat,
        description: d.description,
        folder: d.folder,
      });
    }
  }
  return merged;
}

export const CATEGORY_SCHEMAS = {
  dadosgerais: {
    name: "Dados Gerais",
    subtitle: "Ficha cadastral, identificação, endereço, licenças, idiomas, prêmios e títulos e informações relevantes",
    group: "Dados gerais",
    icon: "👤",
    folder: "1_dados_gerais",
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "1%", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Tipo", width: "1%", render: (r) => renderTipoBadge(r.tipo, "Geral") },
      { key: "descricao", label: "Descrição", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano de Referência", type: "number", required: false, placeholder: "Ex: 2025 (opcional)", width: "half" },
      { name: "tipo", label: "Tipo / Subcategoria", type: "tipo_select", required: true, width: "half" },
      { name: "descricao", label: "Descrição / Conteúdo", type: "textarea", required: true, placeholder: "Informe os detalhes (ex.: idioma e nível, prêmio e entidade, período de licença, texto inicial ou outra informação relevante)...", width: "full" },
    ],
  },

  formacao: {
    name: "Formação Acadêmica",
    subtitle: "Graduação, especialização, mestrado, doutorado e pós-doutorado",
    group: "Formação",
    icon: "🎓",
    folder: "2_formacao",
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "1%", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Nível / Grau", width: "1%", render: (r) => renderTipoBadge(r.tipo) },
      { key: "descricao", label: "Curso / Instituição", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "horas", label: "Horas", width: "1%", render: (r) => r.horas != null ? `<span class="badge badge-hours">${r.horas}h</span>` : "—" },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano de Conclusão / Início", type: "number", required: true, placeholder: "2020", width: "half" },
      { name: "tipo", label: "Nível de Formação", type: "tipo_select", required: true, width: "half" },
      { name: "descricao", label: "Curso / Instituição de Ensino", type: "text", required: true, placeholder: "Ex: Doutorado em Engenharia de Computação - UFSC", width: "full" },
      { name: "horas", label: "Carga Horária (horas)", type: "number", required: false, placeholder: "Ex: 360", width: "half" },
    ],
  },

  atuacao: {
    name: "Atuação Profissional",
    subtitle: "Vínculos institucionais, linhas de pesquisa, corpo editorial, comitês, ensino e encargos",
    group: "Atuação",
    icon: "💼",
    folder: "3_atuacao",
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Período", width: "1%", render: (r) => r.ano_fim ? `${r.ano || "—"}–${r.ano_fim}` : (r.ano ? `${r.ano}–Atual` : "—") },
      { key: "tipo", label: "Subcategoria", width: "1%", render: (r) => renderTipoBadge(r.tipo) },
      { key: "instituicao", label: "Instituição / Revista / Empresa", render: (r) => `<strong>${escapeHtml(r.instituicao || r.titulo || "—")}</strong>` },
      { key: "enquadramento", label: "Vínculo / Cargo", width: "16%", render: (r) => escapeHtml([r.vinculo, r.enquadramento].filter(Boolean).join(" · ") || "—") },
      { key: "descricao", label: "Descrição", width: "18%", render: (r) => r.descricao ? `<span title="${escapeHtml(r.descricao)}">${escapeHtml(r.descricao)}</span>` : "—" },
      { key: "horas", label: "Horas", width: "1%", render: (r) => r.horas != null ? `<span class="badge badge-hours">${r.horas}h/sem</span>` : "—" },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "tipo", label: "Subcategoria / Tipo de Atuação", type: "tipo_select", required: true, width: "half" },
      { name: "instituicao", label: "Nome da Instituição / Revista / Empresa", type: "text", required: true, placeholder: "Ex: Universidade Federal de Santa Catarina (UFSC) ou Revista Ciência Rural", width: "half" },
      { name: "ano", label: "Ano de Início", type: "number", required: false, placeholder: "Ex: 2021", width: "half" },
      { name: "ano_fim", label: "Ano de Fim / Término", type: "number", required: false, placeholder: "Ex: 2025 (deixe em branco se atual)", width: "half" },
      { name: "vinculo", label: "Tipo do Vínculo", type: "text", required: false, placeholder: "Ex: Servidor Público, Celetista, Bolsista, Colaborador...", width: "half" },
      { name: "enquadramento", label: "Enquadramento Funcional / Cargo", type: "text", required: false, placeholder: "Ex: Professor Adjunto, Editor Associado, Revisor...", width: "half" },
      { name: "horas", label: "Carga Horária Semanal (horas)", type: "number", required: false, placeholder: "Ex: 40", width: "half" },
      { name: "dedicacao_exclusiva", label: "Dedicação Exclusiva", type: "select", options: ["", "Sim", "Não"], required: false, width: "half" },
      { name: "vinculo_empregaticio", label: "Possui Vínculo Empregatício", type: "select", options: ["", "Sim", "Não"], required: false, width: "half" },
      { name: "descricao", label: "Outras Informações / Descrição", type: "textarea", required: false, placeholder: "Linhas de pesquisa, projetos associados ou detalhes da atuação...", width: "full" },
    ],
  },

  encargos: {
    legacy: true,
    name: "Encargos e Funções",
    subtitle: "Cargos de gestão, representações de colegiado e comissões institucionais",
    group: "Encargos",
    icon: "🏛️",
    folder: "3_atuacao",
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "1%", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Tipo de Encargo", width: "1%", render: (r) => renderTipoBadge(r.tipo) },
      { key: "descricao", label: "Portaria / Função Exercida", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "horas", label: "Horas", width: "1%", render: (r) => r.horas != null ? `<span class="badge badge-hours">${r.horas}h/sem</span>` : "—" },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano de Vigência", type: "number", required: true, placeholder: "2024", width: "half" },
      { name: "tipo", label: "Tipo de Encargo", type: "tipo_select", required: true, width: "half" },
      { name: "descricao", label: "Descrição / Número da Portaria", type: "text", required: true, placeholder: "Ex: Membro do Colegiado Delegado - Portaria 123/2024", width: "full" },
      { name: "horas", label: "Carga Horária Semanal", type: "number", required: false, placeholder: "Ex: 4", width: "half" },
    ],
  },

  disciplinas: {
    legacy: true,
    name: "Disciplinas Ministradas",
    subtitle: "Cursos de graduação e pós-graduação, turmas e cargas horárias",
    group: "Disciplinas",
    icon: "📚",
    folder: "3_atuacao",
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "1%", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Nível", width: "1%", render: (r) => renderTipoBadge(r.tipo) },
      { key: "curso", label: "Curso", width: "14%", render: (r) => escapeHtml(r.curso || "—") },
      { key: "disciplina", label: "Disciplina", render: (r) => `<strong>${escapeHtml(r.disciplina || "—")}</strong>` },
      { key: "horas", label: "Horas", width: "1%", render: (r) => r.horas != null ? `<span class="badge badge-hours">${r.horas}h</span>` : "—" },
      { key: "alunos", label: "Alunos", width: "1%", render: (r) => r.alunos != null ? `${r.alunos}` : "—" },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano / Semestre", type: "number", required: true, placeholder: "2024", width: "half" },
      { name: "tipo", label: "Nível Acadêmico", type: "tipo_select", required: true, width: "half" },
      { name: "curso", label: "Curso / Programa", type: "text", required: true, placeholder: "Ex: Engenharia Eletrônica", width: "half" },
      { name: "disciplina", label: "Nome da Disciplina", type: "text", required: true, placeholder: "Ex: Sistemas Operacionais Embarcados", width: "half" },
      { name: "horas", label: "Carga Horária (horas)", type: "number", required: true, placeholder: "Ex: 72", width: "half" },
      { name: "alunos", label: "Quantidade de Alunos", type: "number", required: false, placeholder: "Ex: 35", width: "half" },
    ],
  },

  projetos: {
    name: "Projetos de Pesquisa e Extensão",
    subtitle: "Projetos cadastrados, fomentos e termos de cooperação técnico-científica",
    group: "Projetos",
    icon: "🔬",
    folder: "4_projetos",
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "1%", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Tipo de Projeto", width: "1%", render: (r) => renderTipoBadge(r.tipo) },
      { key: "descricao", label: "Título / Descrição do Projeto", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano de Início", type: "number", required: true, placeholder: "2024", width: "half" },
      { name: "tipo", label: "Tipo de Projeto", type: "tipo_select", required: true, width: "half" },
      { name: "descricao", label: "Título e Resumo do Projeto", type: "textarea", required: true, placeholder: "Ex: Desenvolvimento de Firmware Seguro para IoT", width: "full" },
    ],
  },

  producoes: {
    name: "Produções Intelectuais",
    subtitle: "Artigos em periódicos, livros, capítulos e trabalhos em anais com estratos Qualis",
    group: "Produções",
    icon: "📄",
    folder: "5_producoes",
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "1%", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Tipo de Produção", width: "1%", render: (r) => renderTipoBadge(r.tipo) },
      { key: "titulo", label: "Título da Obra", render: (r) => `<strong>${escapeHtml(r.titulo || "—")}</strong>` },
      { key: "journal", label: "Periódico / Editora / Evento", width: "14%", render: (r) => escapeHtml(r.journal || "—") },
      { key: "qualis", label: "Qualis", width: "1%", render: (r) => renderQualisBadge(r.qualis) },
      { key: "citations", label: "Citações", width: "1%", render: (r) => renderCitationsBadge(r.citations) },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano de Publicação", type: "number", required: true, placeholder: "2024", width: "half" },
      { name: "tipo", label: "Tipo de Produção", type: "tipo_select", required: true, width: "half" },
      { name: "titulo", label: "Título do Trabalho", type: "textarea", required: true, placeholder: "Ex: Safety-Critical Systems in Rust", width: "full" },
      { name: "journal", label: "Periódico / Livro / Evento", type: "text", required: false, placeholder: "Ex: IEEE Transactions on Software Engineering", width: "half" },
      { name: "identifier", label: "DOI", type: "doi", required: false, placeholder: "10.xxxx/…", width: "half" },
      {
        name: "qualis",
        label: "Estrato Qualis",
        type: "select",
        required: false,
        width: "half",
        options: ["", "A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "B5", "C", "SQ"],
      },
      { name: "citations", label: "Citações (Google Scholar)", type: "number", required: false, placeholder: "0", width: "half" },
    ],
  },

  patentes: {
    name: "Patentes e Registros",
    subtitle: "Propriedade intelectual, pedidos no INPI e registros computacionais",
    group: "Patentes",
    icon: "💡",
    folder: "6_patentes",
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "1%", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Tipo", width: "1%", render: (r) => renderTipoBadge(r.tipo) },
      { key: "descricao", label: "Título do Registro / Software", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano do Registro", type: "number", required: true, placeholder: "2024", width: "half" },
      { name: "tipo", label: "Tipo de Registro", type: "tipo_select", required: true, width: "half" },
      { name: "descricao", label: "Título e Detalhes da Patente / Software", type: "textarea", required: true, placeholder: "Ex: Sistema Embarcado para Diagnóstico Remoto", width: "full" },
    ],
  },

  inovacao: {
    name: "Inovação",
    subtitle: "Projetos de desenvolvimento tecnológico, produtos, processos inovadores, transferência de tecnologia e spin-offs",
    group: "Inovação",
    icon: "🚀",
    folder: "7_inovacao",
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "1%", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Tipo", width: "1%", render: (r) => renderTipoBadge(r.tipo) },
      { key: "titulo", label: "Título da Tecnologia / Projeto", render: (r) => `<strong>${escapeHtml(r.titulo || "—")}</strong>` },
      { key: "instituicao", label: "Parceiro / Entidade", width: "16%", render: (r) => escapeHtml(r.instituicao || "—") },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano de Concessão / Início", type: "number", required: true, placeholder: "2024", width: "half" },
      { name: "tipo", label: "Subcategoria de Inovação", type: "tipo_select", required: true, width: "half" },
      { name: "titulo", label: "Título do Projeto / Produto / Processo", type: "textarea", required: true, placeholder: "Ex: Plataforma Autônoma de Fenotipagem Digital", width: "full" },
      { name: "instituicao", label: "Instituição / Empresa Parceira / Financiador", type: "text", required: false, placeholder: "Ex: FAPESC / EMBRAPA", width: "full" },
      { name: "descricao", label: "Descrição / Impacto Tecnológico", type: "textarea", required: false, placeholder: "Resumo da solução inovadora, estágio de maturidade (TRL), patente associada ou transferência...", width: "full" },
    ],
  },

  educacao_popularizacao: {
    name: "Educação e Popularização de C&T",
    subtitle: "Divulgação científica, material didático e instrucional, mídias sociais, cursos de extensão e eventos",
    group: "Educação e Popularização de C&T",
    icon: "📢",
    folder: "8_educacao",
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "1%", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Subcategoria", width: "1%", render: (r) => renderTipoBadge(r.tipo) },
      { key: "titulo", label: "Título do Trabalho / Ação", render: (r) => `<strong>${escapeHtml(r.titulo || "—")}</strong>` },
      { key: "instituicao", label: "Veículo / Canal / Evento", width: "16%", render: (r) => escapeHtml(r.instituicao || "—") },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano de Publicação / Realização", type: "number", required: true, placeholder: "2024", width: "half" },
      { name: "tipo", label: "Tipo de Ação / Divulgação", type: "tipo_select", required: true, width: "half" },
      { name: "titulo", label: "Título do Trabalho / Material / Ação", type: "textarea", required: true, placeholder: "Ex: Inteligência Artificial na Agricultura para Estudantes", width: "full" },
      { name: "instituicao", label: "Veículo / Instituição / Canal de Divulgação", type: "text", required: false, placeholder: "Ex: Revista Ciência Hoje ou Canal YouTube NEPEM", width: "full" },
      { name: "descricao", label: "Descrição / Detalhes / Público-Alvo", type: "textarea", required: false, placeholder: "Detalhes da ação de divulgação, alcance ou público atendido...", width: "full" },
    ],
  },

  eventos: {
    name: "Participação em Eventos",
    subtitle: "Congressos, simpósios, conferências científicas e mesas-redondas",
    group: "Eventos",
    icon: "🎙️",
    folder: "9_eventos",
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "1%", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Tipo de Participação", width: "1%", render: (r) => renderTipoBadge(r.tipo) },
      { key: "descricao", label: "Nome do Evento / Cidade", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano do Evento", type: "number", required: true, placeholder: "2024", width: "half" },
      { name: "tipo", label: "Tipo de Participação", type: "tipo_select", required: true, width: "half" },
      { name: "descricao", label: "Nome do Evento, Local e Apresentação", type: "textarea", required: true, placeholder: "Ex: Congresso Brasileiro de Automática, Rio de Janeiro", width: "full" },
    ],
  },

  orientacoes: {
    name: "Orientações e Supervisões",
    subtitle: "Iniciação científica, TCC, dissertações de mestrado e teses de doutorado",
    group: "Orientações",
    icon: "👥",
    folder: "10_orientacoes",
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "1%", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Nível", width: "1%", render: (r) => renderTipoBadge(r.tipo) },
      { key: "aluno", label: "Orientando(a)", width: "15%", render: (r) => `<strong>${escapeHtml(r.aluno || "—")}</strong>` },
      { key: "titulo", label: "Título do Trabalho", render: (r) => escapeHtml(r.titulo || "—") },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano de Conclusão / Vigência", type: "number", required: true, placeholder: "2024", width: "half" },
      { name: "tipo", label: "Nível da Orientação", type: "tipo_select", required: true, width: "half" },
      { name: "aluno", label: "Nome do(a) Orientando(a)", type: "text", required: true, placeholder: "Ex: Carlos Eduardo de Oliveira", width: "half" },
      { name: "titulo", label: "Título do Trabalho ou Plano", type: "textarea", required: true, placeholder: "Ex: Otimização de Protocolos em Redes Sem Fio Industriais", width: "full" },
    ],
  },

  bancas: {
    name: "Bancas Examinadoras",
    subtitle: "Participações em bancas de mestrado, doutorado, qualificação e concursos",
    group: "Bancas",
    icon: "⚖️",
    folder: "11_bancas",
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "1%", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Nível da Banca", width: "1%", render: (r) => renderTipoBadge(r.tipo) },
      { key: "aluno", label: "Candidato(a)", width: "15%", render: (r) => `<strong>${escapeHtml(r.aluno || "—")}</strong>` },
      { key: "titulo", label: "Título da Defesa", render: (r) => escapeHtml(r.titulo || "—") },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano da Defesa", type: "number", required: true, placeholder: "2024", width: "half" },
      { name: "tipo", label: "Tipo / Grau da Banca", type: "tipo_select", required: true, width: "half" },
      { name: "aluno", label: "Nome do(a) Candidato(a)", type: "text", required: true, placeholder: "Ex: Ana Carolina Ferreira", width: "half" },
      { name: "titulo", label: "Título da Tese / Dissertação", type: "textarea", required: true, placeholder: "Ex: Análise Formal de Segurança em Microsserviços", width: "full" },
    ],
  },
};

/** Link opcional de qualquer registro (página, repositório, DOI…); vazio por padrão. */
const URL_FIELD = { name: "url", label: "URL (link do documento)", type: "link", required: false, placeholder: "https://… (opcional)", width: "full" };
for (const s of Object.values(CATEGORY_SCHEMAS)) s.fields.push({ ...URL_FIELD });

/** Cores das categorias personalizadas (as padrão ficam em charts.js PALETTE). */
export const CUSTOM_COLORS = ["#14b8a6", "#e11d48", "#a855f7", "#84cc16", "#0ea5e9", "#d946ef", "#f43f5e", "#22d3ee"];

/** Registra uma categoria criada pelo usuário com colunas/campos genéricos. */
export function registerCustomCategory(c, index = 0) {
  const tl = c.title_label || "Título";
  const dl = c.desc_label || "Descrição / detalhes";
  CATEGORY_SCHEMAS[c.key] = {
    name: c.name,
    subtitle: c.subtitle || "Categoria personalizada",
    group: c.name,
    icon: c.icon || "🗂️",
    custom: true,
    color: CUSTOM_COLORS[index % CUSTOM_COLORS.length],
    folder: c.folder,
    columns: [
      { key: "id", label: "#", width: "1%", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "1%", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Subcategoria", width: "1%", render: (r) => renderTipoBadge(r.tipo) },
      { key: "titulo", label: tl, render: (r) => `<strong>${escapeHtml(r.titulo || "—")}</strong>` },
      { key: "descricao", label: dl, width: "15%", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "file", label: "Comprovante", width: "1%", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "1%", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano", type: "number", required: true, placeholder: String(new Date().getFullYear()), width: "half" },
      { name: "tipo", label: "Subcategoria", type: "tipo_select", required: true, width: "half" },
      { name: "titulo", label: tl, type: "textarea", required: true, placeholder: "", width: "full" },
      { name: "descricao", label: dl, type: "text", required: false, placeholder: "", width: "full" },
      { ...URL_FIELD },
    ],
  };
}

export function unregisterCustomCategories() {
  for (const [k, s] of Object.entries(CATEGORY_SCHEMAS)) if (s.custom) delete CATEGORY_SCHEMAS[k];
}

export const DEFAULT_CATEGORY_META = {};
for (const [k, s] of Object.entries(CATEGORY_SCHEMAS)) {
  s.dbGroup = s.group;
  DEFAULT_CATEGORY_META[k] = {
    name: s.name,
    group: s.group,
    subtitle: s.subtitle || "",
    icon: s.icon || "🗂️",
  };
}

const CATEGORY_OVERRIDES_STORAGE_KEY = "lattes_category_overrides_v1";

function sanitizeOverrides(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, val] of Object.entries(raw)) {
    if (!DEFAULT_CATEGORY_META[k] || !val || typeof val !== "object") continue;
    const def = DEFAULT_CATEGORY_META[k];
    const clean = {};
    if (typeof val.name === "string" && val.name.trim() && val.name.trim() !== def.name) clean.name = val.name.trim();
    if (typeof val.group === "string" && val.group.trim() && val.group.trim() !== def.group) clean.group = val.group.trim();
    if (typeof val.subtitle === "string" && val.subtitle.trim() !== def.subtitle) clean.subtitle = val.subtitle.trim();
    if (typeof val.icon === "string" && val.icon.trim() && val.icon.trim() !== def.icon) clean.icon = val.icon.trim();
    if (Object.keys(clean).length) out[k] = clean;
  }
  return out;
}

export function readSavedCategoryOverrides() {
  try {
    const raw = localStorage.getItem(CATEGORY_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    return sanitizeOverrides(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeSavedCategoryOverrides(overrides) {
  const clean = sanitizeOverrides(overrides);
  try {
    if (!Object.keys(clean).length) localStorage.removeItem(CATEGORY_OVERRIDES_STORAGE_KEY);
    else localStorage.setItem(CATEGORY_OVERRIDES_STORAGE_KEY, JSON.stringify(clean));
  } catch { }
  return clean;
}

export function hasCategoryOverride(key) {
  const ov = readSavedCategoryOverrides();
  return Boolean(ov[key] && Object.keys(ov[key]).length);
}

/** Aplica personalizações de nome, título no menu, subtítulo e ícone às categorias padrão. */
export function applyCategoryOverrides(overridesObj = null) {
  const ov = overridesObj && typeof overridesObj === "object" ? sanitizeOverrides(overridesObj) : readSavedCategoryOverrides();
  for (const [k, def] of Object.entries(DEFAULT_CATEGORY_META)) {
    const s = CATEGORY_SCHEMAS[k];
    if (!s) continue;
    s.dbGroup = def.group;
    const item = ov[k] || {};
    s.name = item.name || def.name;
    s.group = item.group || def.group;
    s.subtitle = item.subtitle !== undefined ? item.subtitle : def.subtitle;
    s.icon = item.icon || def.icon;
  }
  return ov;
}

export function saveCategoryOverride(key, patch) {
  const def = DEFAULT_CATEGORY_META[key];
  if (!def) return readSavedCategoryOverrides();
  const current = readSavedCategoryOverrides();
  const next = { ...current };
  const merged = { ...(next[key] || {}), ...patch };
  const name = String(merged.name ?? def.name).trim() || def.name;
  const group = String(merged.group ?? def.group).trim() || name;
  const subtitle = merged.subtitle !== undefined ? String(merged.subtitle).trim() : def.subtitle;
  const icon = String(merged.icon ?? def.icon).trim() || def.icon;
  const entry = {};
  if (name !== def.name) entry.name = name;
  if (group !== def.group) entry.group = group;
  if (subtitle !== def.subtitle) entry.subtitle = subtitle;
  if (icon !== def.icon) entry.icon = icon;
  if (Object.keys(entry).length) next[key] = entry;
  else delete next[key];
  const saved = writeSavedCategoryOverrides(next);
  applyCategoryOverrides(saved);
  return saved;
}

export function resetCategoryOverride(key) {
  const current = readSavedCategoryOverrides();
  if (key) delete current[key];
  const saved = writeSavedCategoryOverrides(current);
  applyCategoryOverrides(saved);
  return saved;
}

/** Converte o category_group do SQLite para o rótulo atual (quando uma categoria padrão foi renomeada). */
export function displayGroupLabel(rawGroup) {
  const target = String(rawGroup || "").trim().toLowerCase();
  if (!target) return rawGroup || "";
  for (const s of Object.values(CATEGORY_SCHEMAS)) {
    const db = (s.dbGroup || s.group || "").toLowerCase();
    if (db === target) return s.group || s.name || rawGroup;
  }
  return rawGroup || "";
}

applyCategoryOverrides();

export const DEFAULT_CATEGORY_ORDER = [
  "dadosgerais",
  "formacao",
  "atuacao",
  "projetos",
  "producoes",
  "patentes",
  "inovacao",
  "educacao_popularizacao",
  "eventos",
  "orientacoes",
  "bancas",
];
const CATEGORY_ORDER_STORAGE_KEY = "lattes_category_order_v1";

export function readSavedCategoryOrder() {
  try {
    const raw = localStorage.getItem(CATEGORY_ORDER_STORAGE_KEY);
    if (!raw) return DEFAULT_CATEGORY_ORDER;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_CATEGORY_ORDER;
    const mapped = parsed
      .map((k) => (k === "x_atuacao" ? "atuacao" : k))
      .filter((k) => typeof k === "string" && CATEGORY_SCHEMAS[k] && !CATEGORY_SCHEMAS[k]?.legacy);
    for (const def of DEFAULT_CATEGORY_ORDER) {
      if (!mapped.includes(def) && CATEGORY_SCHEMAS[def]) mapped.push(def);
    }
    return mapped;
  } catch {
    return DEFAULT_CATEGORY_ORDER;
  }
}

export function writeSavedCategoryOrder(keys) {
  try {
    if (!Array.isArray(keys) || !keys.length) localStorage.removeItem(CATEGORY_ORDER_STORAGE_KEY);
    else localStorage.setItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(keys));
  } catch { }
}

/** Reordena CATEGORY_SCHEMAS in-place mantendo categorias padrão e personalizadas unificadas. */
export function applyCategoryOrder(orderKeys = null) {
  const saved = Array.isArray(orderKeys) ? orderKeys : readSavedCategoryOrder();
  const existing = Object.keys(CATEGORY_SCHEMAS);
  const seen = new Set();
  const finalOrder = [];
  if (Array.isArray(saved)) {
    for (const k of saved) {
      if (CATEGORY_SCHEMAS[k] && !seen.has(k)) {
        seen.add(k);
        finalOrder.push(k);
      }
    }
  }
  for (const k of existing) {
    if (!seen.has(k) && !CATEGORY_SCHEMAS[k]?.legacy) {
      seen.add(k);
      finalOrder.push(k);
    }
  }
  const snapshot = {};
  for (const k of finalOrder) snapshot[k] = CATEGORY_SCHEMAS[k];
  for (const k of existing) {
    if (!snapshot[k]) snapshot[k] = CATEGORY_SCHEMAS[k];
    delete CATEGORY_SCHEMAS[k];
  }
  Object.assign(CATEGORY_SCHEMAS, snapshot);
  return finalOrder;
}

/** Cor de qualquer categoria. */
export function categoryColor(cat, palette = {}) {
  return palette[cat] || CATEGORY_SCHEMAS[cat]?.color || "#6366f1";
}

// ---------- Ordem das atividades (como no Currículo Lattes) ----------

/** Sequência das atividades dentro de cada seção, na ordem em que aparecem no Lattes. */
const ACTIVITY_ORDER = {
  producoes: [/artigos? (completos?|publicados?)/, /artigos? aceitos?/, /^livros?\b|livros? (publicados?|organizados?)/, /capitulos?/, /textos? em jornais|jornais|revistas/, /trabalhos? completos?/, /resumos? completos?/, /resumos? expandidos?/, /resumos?/, /apresenta|trabalhos?\s*\/\s*palestras?|palestras?/, /cursos?/, /material didatico|didatico/, /midias?|blog/, /radio|tv|televis/, /artigo/],
  formacao: [/formacao academica|titulacao/, /pos-?doutorado/, /doutorado/, /mestrado/, /especializa|mba/, /graduacao/, /aperfeicoamento/, /extensao/, /curta duracao/],
  atuacao: [/atuacao profissional|vinculo/, /ensino|disciplina/, /direcao|diretor/, /chefia|chefe/, /coordenacao|coordenador/, /supervisao/, /comissao|comite/, /corpo editorial|editorial/, /linha de pesquisa/, /revisor/],
  encargos: [/direcao|diretor/, /chefia|chefe/, /coordenacao|coordenador/, /supervisao/, /comissao|comite|colegiado/, /pesquisa/, /extensao/, /diversos/],
  disciplinas: [/^(?!.*pos).*graduacao/, /pos/],
  projetos: [/pesquisa/, /extensao/, /ensino/, /desenvolvimento/],
  patentes: [/patente/, /programas? de computador|software/, /cultivar protegida/, /cultivar registrada|cultivar/],
  inovacao: [/projeto|inovacao/, /produto/, /processo|tecnica/, /transferencia/, /spin-off|startup/],
  educacao_popularizacao: [/artigo|divulgacao/, /livro|capitulo/, /material didatico|instrucional/, /midia|website|blog|rede social/, /curso|extensao/, /evento|feira/],
  eventos: [/participacao/, /organizacao/],
  orientacoes: [/pos-?doutorado/, /tese|doutorado/, /dissertacao|mestrado/, /especializa/, /conclusao de curso|tcc|graduacao/, /iniciacao cientifica|\bic\b/, /outra natureza/, /monitoria/, /estagio/],
  bancas: [/qualificacao de doutorado/, /doutorado/, /qualificacao de mestrado/, /mestrado/, /especializa/, /graduacao|conclusao de curso|tcc/, /estagio/, /concurso/],
};

/** Posição da atividade (tipo) na ordem do Lattes; tipos desconhecidos vão para o fim, em ordem alfabética. */
export function activityRank(cat, tipo) {
  const t = fold(tipo);
  const list = ACTIVITY_ORDER[cat] || [];
  const i = list.findIndex((re) => re.test(t));
  return i < 0 ? 1000 : i;
}

/** Compara dois tipos de uma categoria pela ordem das atividades. */
export function compareActivity(cat, a, b) {
  return activityRank(cat, a) - activityRank(cat, b) || fold(a).localeCompare(fold(b), "pt-BR");
}
