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

export function renderQualisBadge(qualis) {
  if (!qualis) {
    return `<span class="badge badge-qualis badge-qualis-none">—</span>`;
  }
  const clean = String(qualis).trim().toUpperCase();
  const valid = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "B5", "C", "SQ"];
  const clsKey = valid.includes(clean) ? clean.toLowerCase() : "sq";
  return `<span class="badge badge-qualis badge-qualis-${clsKey}">${escapeHtml(clean)}</span>`;
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
  if (!record.path) {
    return `<span class="badge-file-missing" title="Sem comprovante anexo">—</span>`;
  }
  const ext = record.path.split(".").pop()?.toUpperCase() || "DOC";
  return `<button type="button" class="badge-file-present" data-action="preview" data-id="${record.id}" title="Visualizar comprovante (${escapeHtml(record.file || record.path)})">
    📎 <span>${escapeHtml(ext)}</span>
  </button>`;
}

export const CATEGORY_SCHEMAS = {
  dadosgerais: {
    name: "Dados Gerais",
    subtitle: "Informações pessoais, identificação e vínculos institucionais",
    group: "Dados gerais",
    columns: [
      { key: "id", label: "#", width: "50px", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "70px", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Tipo", width: "160px", render: (r) => `<span class="badge badge-tipo">${escapeHtml(r.tipo || "Geral")}</span>` },
      { key: "descricao", label: "Descrição", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "file", label: "Comprovante", width: "110px", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Atualização", width: "130px", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano de Referência", type: "number", required: true, placeholder: "2024", width: "half" },
      { name: "tipo", label: "Tipo de Registro", type: "tipo_select", required: true, width: "half" },
      { name: "descricao", label: "Descrição Detalhada", type: "textarea", required: true, placeholder: "Informe os detalhes do documento...", width: "full" },
    ],
  },

  formacao: {
    name: "Formação Acadêmica",
    subtitle: "Graduação, especialização, mestrado, doutorado e pós-doutorado",
    group: "Formação",
    columns: [
      { key: "id", label: "#", width: "50px", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "70px", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Nível / Grau", width: "160px", render: (r) => `<span class="badge badge-tipo">${escapeHtml(r.tipo || "—")}</span>` },
      { key: "descricao", label: "Curso / Instituição", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "horas", label: "Carga Horária", width: "100px", render: (r) => r.horas != null ? `<span class="badge badge-hours">${r.horas}h</span>` : "—" },
      { key: "file", label: "Comprovante", width: "110px", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "110px", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano de Conclusão / Início", type: "number", required: true, placeholder: "2020", width: "half" },
      { name: "tipo", label: "Nível de Formação", type: "tipo_select", required: true, width: "half" },
      { name: "descricao", label: "Curso / Instituição de Ensino", type: "text", required: true, placeholder: "Ex: Doutorado em Engenharia de Computação - UFSC", width: "full" },
      { name: "horas", label: "Carga Horária (horas)", type: "number", required: false, placeholder: "Ex: 360", width: "half" },
    ],
  },

  encargos: {
    name: "Encargos e Funções",
    subtitle: "Cargos de gestão, representações de colegiado e comissões institucionais",
    group: "Encargos",
    columns: [
      { key: "id", label: "#", width: "50px", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "70px", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Tipo de Encargo", width: "170px", render: (r) => `<span class="badge badge-tipo">${escapeHtml(r.tipo || "—")}</span>` },
      { key: "descricao", label: "Portaria / Função Exercida", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "horas", label: "Horas Semanais", width: "110px", render: (r) => r.horas != null ? `<span class="badge badge-hours">${r.horas}h/sem</span>` : "—" },
      { key: "file", label: "Comprovante", width: "110px", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "110px", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano de Vigência", type: "number", required: true, placeholder: "2024", width: "half" },
      { name: "tipo", label: "Tipo de Encargo", type: "tipo_select", required: true, width: "half" },
      { name: "descricao", label: "Descrição / Número da Portaria", type: "text", required: true, placeholder: "Ex: Membro do Colegiado Delegado - Portaria 123/2024", width: "full" },
      { name: "horas", label: "Carga Horária Semanal", type: "number", required: false, placeholder: "Ex: 4", width: "half" },
    ],
  },

  disciplinas: {
    name: "Disciplinas Ministradas",
    subtitle: "Cursos de graduação e pós-graduação, turmas e cargas horárias",
    group: "Disciplinas",
    columns: [
      { key: "id", label: "#", width: "50px", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "70px", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Nível", width: "120px", render: (r) => `<span class="badge badge-tipo">${escapeHtml(r.tipo || "—")}</span>` },
      { key: "curso", label: "Curso", width: "160px", render: (r) => escapeHtml(r.curso || "—") },
      { key: "disciplina", label: "Disciplina", render: (r) => `<strong>${escapeHtml(r.disciplina || "—")}</strong>` },
      { key: "horas", label: "Horas", width: "70px", render: (r) => r.horas != null ? `<span class="badge badge-hours">${r.horas}h</span>` : "—" },
      { key: "alunos", label: "Alunos", width: "70px", render: (r) => r.alunos != null ? `${r.alunos}` : "—" },
      { key: "file", label: "Comprovante", width: "100px", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "100px", render: (r) => renderLog(r.log) },
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
    columns: [
      { key: "id", label: "#", width: "50px", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "70px", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Tipo de Projeto", width: "170px", render: (r) => `<span class="badge badge-tipo">${escapeHtml(r.tipo || "—")}</span>` },
      { key: "descricao", label: "Título / Descrição do Projeto", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "file", label: "Comprovante", width: "110px", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "110px", render: (r) => renderLog(r.log) },
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
    columns: [
      { key: "id", label: "#", width: "50px", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "70px", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Tipo de Produção", width: "170px", render: (r) => `<span class="badge badge-tipo">${escapeHtml(r.tipo || "—")}</span>` },
      { key: "titulo", label: "Título da Obra", render: (r) => `<strong>${escapeHtml(r.titulo || "—")}</strong>` },
      { key: "journal", label: "Periódico / Editora / Evento", width: "200px", render: (r) => escapeHtml(r.journal || "—") },
      { key: "qualis", label: "Qualis", width: "70px", render: (r) => renderQualisBadge(r.qualis) },
      { key: "file", label: "Comprovante", width: "100px", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "100px", render: (r) => renderLog(r.log) },
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
    ],
  },

  patentes: {
    name: "Patentes e Registros",
    subtitle: "Propriedade intelectual, pedidos no INPI e registros computacionais",
    group: "Patentes",
    columns: [
      { key: "id", label: "#", width: "50px", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "70px", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Tipo", width: "160px", render: (r) => `<span class="badge badge-tipo">${escapeHtml(r.tipo || "—")}</span>` },
      { key: "descricao", label: "Título do Registro / Software", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "file", label: "Comprovante", width: "110px", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "110px", render: (r) => renderLog(r.log) },
    ],
    fields: [
      { name: "ano", label: "Ano do Registro", type: "number", required: true, placeholder: "2024", width: "half" },
      { name: "tipo", label: "Tipo de Registro", type: "tipo_select", required: true, width: "half" },
      { name: "descricao", label: "Título e Detalhes da Patente / Software", type: "textarea", required: true, placeholder: "Ex: Sistema Embarcado para Diagnóstico Remoto", width: "full" },
    ],
  },

  eventos: {
    name: "Participação em Eventos",
    subtitle: "Congressos, simpósios, conferências científicas e mesas-redondas",
    group: "Eventos",
    columns: [
      { key: "id", label: "#", width: "50px", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "70px", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Tipo de Participação", width: "160px", render: (r) => `<span class="badge badge-tipo">${escapeHtml(r.tipo || "—")}</span>` },
      { key: "descricao", label: "Nome do Evento / Cidade", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "file", label: "Comprovante", width: "110px", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "110px", render: (r) => renderLog(r.log) },
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
    columns: [
      { key: "id", label: "#", width: "50px", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "70px", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Nível", width: "150px", render: (r) => `<span class="badge badge-tipo">${escapeHtml(r.tipo || "—")}</span>` },
      { key: "aluno", label: "Orientando(a)", width: "180px", render: (r) => `<strong>${escapeHtml(r.aluno || "—")}</strong>` },
      { key: "titulo", label: "Título do Trabalho", render: (r) => escapeHtml(r.titulo || "—") },
      { key: "file", label: "Comprovante", width: "100px", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "100px", render: (r) => renderLog(r.log) },
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
    columns: [
      { key: "id", label: "#", width: "50px", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "70px", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Nível da Banca", width: "160px", render: (r) => `<span class="badge badge-tipo">${escapeHtml(r.tipo || "—")}</span>` },
      { key: "aluno", label: "Candidato(a)", width: "180px", render: (r) => `<strong>${escapeHtml(r.aluno || "—")}</strong>` },
      { key: "titulo", label: "Título da Defesa", render: (r) => escapeHtml(r.titulo || "—") },
      { key: "file", label: "Comprovante", width: "100px", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "100px", render: (r) => renderLog(r.log) },
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
      { key: "id", label: "#", width: "50px", render: (r) => r.id },
      { key: "ano", label: "Ano", width: "70px", render: (r) => r.ano || "—" },
      { key: "tipo", label: "Subcategoria", width: "170px", render: (r) => `<span class="badge badge-tipo">${escapeHtml(r.tipo || "—")}</span>` },
      { key: "titulo", label: tl, render: (r) => `<strong>${escapeHtml(r.titulo || "—")}</strong>` },
      { key: "descricao", label: dl, width: "240px", render: (r) => escapeHtml(r.descricao || "—") },
      { key: "file", label: "Comprovante", width: "100px", render: (r) => renderFileBadge(r) },
      { key: "log", label: "Data", width: "100px", render: (r) => renderLog(r.log) },
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

/** Cor de qualquer categoria. */
export function categoryColor(cat, palette = {}) {
  return palette[cat] || CATEGORY_SCHEMAS[cat]?.color || "#6366f1";
}

// ---------- Ordem das atividades (como no Currículo Lattes) ----------
const fold = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Sequência das atividades dentro de cada seção, na ordem em que aparecem no Lattes. */
const ACTIVITY_ORDER = {
  producoes: [/artigos? (completos?|publicados?)/, /artigos? aceitos?/, /^livros?\b|livros? (publicados?|organizados?)/, /capitulos?/, /textos? em jornais|jornais|revistas/, /trabalhos? completos?/, /resumos? completos?/, /resumos? expandidos?/, /resumos?/, /apresenta|trabalhos?\s*\/\s*palestras?|palestras?/, /cursos?/, /material didatico|didatico/, /midias?|blog/, /radio|tv|televis/, /artigo/],
  formacao: [/formacao academica|titulacao/, /pos-?doutorado/, /doutorado/, /mestrado/, /especializa|mba/, /graduacao/, /aperfeicoamento/, /extensao/, /curta duracao/],
  encargos: [/direcao|diretor/, /chefia|chefe/, /coordenacao|coordenador/, /supervisao/, /comissao|comite|colegiado/, /pesquisa/, /extensao/, /diversos/],
  disciplinas: [/^(?!.*pos).*graduacao/, /pos/],
  projetos: [/pesquisa/, /extensao/, /ensino/, /desenvolvimento/],
  patentes: [/patente/, /programas? de computador|software/, /cultivar protegida/, /cultivar registrada|cultivar/],
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
