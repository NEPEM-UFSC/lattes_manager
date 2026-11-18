// Importação de registros a partir do XML do Currículo Lattes
// Suporte a árvore hierárquica indentada (Categoria -> Subcategoria -> Registros),
// seleção flexível com tudo selecionado por padrão e preenchimento automático
// dos dados de identificação e perfil do pesquisador.

import { api } from "../api.js";
import { easyClose } from "../theme.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../utils.js";
import { PALETTE } from "./charts.js";
import { loadProfile, saveProfile, PROFILE_FIELDS } from "./profile.js";

const CATEGORY_ORDER = [
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
  "disciplinas",
  "encargos",
];

const CATEGORY_FALLBACK = {
  dadosgerais: "Dados gerais",
  formacao: "Formação",
  atuacao: "Atuação",
  projetos: "Projetos",
  producoes: "Produções",
  patentes: "Patentes",
  inovacao: "Inovação",
  educacao_popularizacao: "Educação e Popularização de C&T",
  eventos: "Eventos",
  orientacoes: "Orientações",
  bancas: "Bancas",
  encargos: "Encargos",
  disciplinas: "Disciplinas",
};

const CATEGORY_ICONS = {
  dadosgerais: "👤",
  formacao: "🎓",
  atuacao: "💼",
  projetos: "📋",
  producoes: "📚",
  patentes: "💡",
  inovacao: "🚀",
  educacao_popularizacao: "🌐",
  eventos: "🗓️",
  orientacoes: "🧑‍🏫",
  bancas: "👥",
  disciplinas: "📖",
  encargos: "⚡",
};

function categoryLabel(cat) {
  return CATEGORY_SCHEMAS?.[cat]?.name || CATEGORY_FALLBACK[cat] || cat;
}

function categoryColor(cat) {
  return PALETTE?.[cat] || "#6366f1";
}

function categoryIcon(cat) {
  return CATEGORY_ICONS[cat] || "📄";
}

function injectXmlImportStyles() {
  if (document.getElementById("xml-import-extra-styles")) return;
  const style = document.createElement("style");
  style.id = "xml-import-extra-styles";
  style.textContent = `
    .modal-dialog.xml-dialog {
      max-width: 1200px;
      width: 95%;
      height: 90vh;
      display: flex;
      flex-direction: column;
    }
    .xml-body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 16px 20px;
    }
    
    /* Card de Identificação e Perfil */
    .xml-profile-card {
      background: var(--surface-2, #1e293b);
      border: 1px solid var(--border-light, #334155);
      border-radius: var(--radius-lg, 12px);
      padding: 14px 18px;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .xml-profile-top {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
    }
    .xml-profile-avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, #0284c7, #6366f1);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: 700;
      flex-shrink: 0;
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3);
    }
    .xml-profile-info {
      flex: 1;
      min-width: 240px;
    }
    .xml-profile-name {
      font-size: calc(15px * var(--font-scale, 1));
      font-weight: 700;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .xml-profile-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-top: 4px;
      font-size: calc(12px * var(--font-scale, 1));
      color: var(--text-secondary);
    }
    .xml-profile-meta-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .xml-profile-meta-item strong {
      color: var(--text-primary);
    }
    .xml-profile-toggle {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      margin-top: 2px;
      padding: 6px 12px;
      background: rgba(2, 132, 199, 0.08);
      border: 1px solid rgba(2, 132, 199, 0.28);
      border-radius: var(--radius-md, 8px);
      cursor: pointer;
      font-size: calc(12px * var(--font-scale, 1));
      color: var(--text-primary);
      transition: background 0.15s, border-color 0.15s;
    }
    .xml-profile-toggle:hover {
      background: rgba(2, 132, 199, 0.14);
      border-color: rgba(2, 132, 199, 0.45);
    }
    .xml-profile-toggle input[type="checkbox"] {
      width: 16px;
      height: 16px;
      accent-color: var(--primary, #0284c7);
      cursor: pointer;
    }

    /* Barra de ferramentas da árvore */
    .xml-tree-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      background: var(--surface-bg);
      padding: 10px 14px;
      border: 1px solid var(--border-light, #334155);
      border-radius: var(--radius-md, 8px);
    }
    .xml-tree-toolbar .form-input {
      flex: 1;
      min-width: 220px;
    }
    .xml-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    /* Container da árvore indentada */
    .xml-tree-container {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* Nível 1: Categoria */
    .xml-cat-node {
      border: 1px solid var(--border-light, #334155);
      border-radius: var(--radius-lg, 10px);
      background: var(--surface-bg);
      overflow: hidden;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .xml-cat-node:hover {
      border-color: var(--border, #475569);
    }
    .xml-cat-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 14px;
      background: var(--surface-2, #1e293b);
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }
    .xml-cat-header:hover {
      background: var(--surface-3, #334155);
    }
    .xml-toggle-btn {
      background: none;
      border: none;
      padding: 0 4px;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      transition: color 0.15s, background 0.15s;
    }
    .xml-toggle-btn:hover {
      color: var(--text-primary);
      background: rgba(255, 255, 255, 0.08);
    }
    .xml-cb {
      width: 17px;
      height: 17px;
      cursor: pointer;
      accent-color: var(--primary, #0284c7);
      margin: 0;
    }
    .xml-cat-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: calc(12px * var(--font-scale, 1));
      font-weight: 700;
      white-space: nowrap;
    }
    .xml-cat-title {
      font-size: calc(13px * var(--font-scale, 1));
      font-weight: 600;
      color: var(--text-primary);
      flex: 1;
    }
    .xml-cat-counts {
      font-size: calc(11.5px * var(--font-scale, 1));
      color: var(--text-secondary);
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .xml-badge-new {
      background: rgba(16, 185, 129, 0.15);
      color: var(--success-text, #10b981);
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 1px 7px;
      border-radius: 999px;
      font-weight: 700;
      font-size: calc(10.5px * var(--font-scale, 1));
    }

    /* Nível 2: Subcategoria (recuo indentado nível 1) */
    .xml-subcat-list {
      display: flex;
      flex-direction: column;
      padding: 4px 0 6px 0;
    }
    .xml-subcat-node {
      margin-left: 26px;
      border-left: 2px solid var(--border-light, #334155);
      padding-left: 12px;
      margin-top: 4px;
      margin-bottom: 6px;
    }
    .xml-subcat-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: var(--radius-md, 6px);
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }
    .xml-subcat-header:hover {
      background: var(--surface-2, rgba(255, 255, 255, 0.04));
    }
    .xml-subcat-title {
      font-size: calc(12.5px * var(--font-scale, 1));
      font-weight: 600;
      color: var(--text-primary);
      flex: 1;
    }
    .xml-subcat-counts {
      font-size: calc(11px * var(--font-scale, 1));
      color: var(--text-muted);
    }

    /* Nível 3: Registros individuais (recuo indentado nível 2) */
    .xml-item-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 4px 0 6px 0;
      margin-left: 20px;
      border-left: 2px dashed rgba(148, 163, 184, 0.15);
      padding-left: 12px;
    }
    .xml-item-row {
      display: flex;
      align-items: flex-start;
      gap: 9px;
      padding: 7px 10px;
      border-radius: var(--radius-md, 6px);
      background: var(--surface-bg);
      border: 1px solid transparent;
      transition: all 0.12s ease;
    }
    .xml-item-row:hover {
      background: var(--surface-2, #1e293b);
      border-color: var(--border-light, #334155);
    }
    .xml-item-row.selected {
      background: rgba(2, 132, 199, 0.06);
    }
    .xml-item-row.duplicate {
      opacity: 0.85;
    }
    .xml-item-year {
      font-family: var(--font-mono, monospace);
      font-size: calc(11px * var(--font-scale, 1));
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--surface-3, #334155);
      color: var(--text-secondary);
      flex-shrink: 0;
      min-width: 42px;
      text-align: center;
    }
    .xml-item-content {
      flex: 1;
      min-width: 0;
    }
    .xml-item-title {
      font-size: calc(12.5px * var(--font-scale, 1));
      font-weight: 500;
      color: var(--text-primary);
      line-height: 1.4;
      word-break: break-word;
    }
    .xml-item-details {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 10px;
      margin-top: 3px;
      font-size: calc(11px * var(--font-scale, 1));
      color: var(--text-secondary);
    }
    .xml-tag-doi {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-family: var(--font-mono, monospace);
      font-size: calc(10.5px * var(--font-scale, 1));
      color: var(--primary, #0284c7);
      background: rgba(2, 132, 199, 0.1);
      padding: 1px 6px;
      border-radius: 4px;
      text-decoration: none;
    }
    .xml-tag-doi:hover {
      text-decoration: underline;
    }
    .xml-link-btn {
      background: none;
      border: none;
      padding: 0;
      color: var(--primary, #0284c7);
      cursor: pointer;
      font-size: calc(11px * var(--font-scale, 1));
      text-decoration: underline;
    }
    .xml-link-btn:hover {
      opacity: 0.8;
    }
    .xml-item-status {
      flex-shrink: 0;
      margin-top: 2px;
    }

    .xml-empty-hint {
      text-align: center;
      padding: 30px 16px;
      color: var(--text-muted);
      font-size: calc(13px * var(--font-scale, 1));
    }
  `;
  document.head.appendChild(style);
}

export class XmlImportModal {
  constructor({ onImported }) {
    this.onImported = onImported;
    this.items = [];
    this.profile = null;
    this.applyProfile = true;
    this.selected = new Set();
    this.filter = "todos"; // todos | novos | existentes
    this.categoryFilter = "todas";
    this.search = "";
    this.expandedCategories = new Set();
    this.expandedSubcategories = new Set();
    this._t = null;

    injectXmlImportStyles();

    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";
    this.overlay.style.display = "none";
    document.getElementById("app").appendChild(this.overlay);
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay && easyClose()) this.close();
    });
  }

  open(xmlPath = null) {
    this.overlay.style.display = "flex";
    if (xmlPath) return this.load(xmlPath);
    this.renderStart();
  }

  async browse() {
    const p = await api.selectXmlFile();
    if (p) this.load(p);
  }

  renderStart(error = null) {
    this.overlay.innerHTML = `
      <div class="modal-dialog" style="max-width:540px">
        <header class="modal-header">
          <h2 class="modal-title">🧬 Importar registros do XML Lattes</h2>
          <button type="button" class="btn-close-modal" data-x="close">&times;</button>
        </header>
        <div class="modal-body" style="padding:18px 22px">
          ${error ? `<p style="color:var(--danger,#dc2626);margin:0 0 14px;background:rgba(220,38,38,0.1);padding:8px 12px;border-radius:6px">⚠️ Falha ao ler XML: ${escapeHtml(String(error))}</p>` : ""}
          <p style="margin:0 0 14px;color:var(--text-secondary);font-size:13.5px">Escolha o arquivo XML do Currículo Lattes para importar comprovantes e dados de identificação:</p>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button type="button" class="btn btn-primary" data-x="browse" style="justify-content:center;padding:10px 16px">📂 Selecionar arquivo XML do computador...</button>
            <button type="button" class="btn btn-secondary" data-x="default" style="justify-content:center;padding:10px 16px">💾 Usar XML da pasta raiz (lattes_xml.xml ou ID 16 dígitos)</button>
          </div>
        </div>
        <footer class="modal-footer">
          <button type="button" class="btn btn-secondary" data-x="close">Cancelar</button>
        </footer>
      </div>`;
    this.overlay.querySelectorAll('[data-x="close"]').forEach((b) => b.addEventListener("click", () => this.close()));
    this.overlay.querySelector('[data-x="browse"]').addEventListener("click", () => this.browse());
    this.overlay.querySelector('[data-x="default"]').addEventListener("click", () => this.load(null));
  }

  async load(xmlPath) {
    this.overlay.innerHTML = `
      <div class="modal-dialog xml-dialog" style="justify-content:center;align-items:center">
        <div class="loading-state" style="display:flex;flex-direction:column;align-items:center;gap:12px">
          <div class="spinner"></div>
          <span style="font-size:14px;font-weight:600;color:var(--text-primary)">Lendo XML do Lattes e extraindo dados de identificação...</span>
        </div>
      </div>`;
    try {
      const [items, profile] = await Promise.all([
        api.previewLattesXml(xmlPath),
        api.getLattesProfile(xmlPath).catch(() => null),
      ]);

      this.profile = profile || null;
      this.applyProfile = Boolean(profile && profile.nome);

      this.items = items || [];
      this.items.forEach((it, i) => {
        it._i = i;
        if (!it.category) it.category = "producoes";
        if (!it.tipo) it.tipo = "Geral";
      });

      // POR PADRÃO: TUDO SELECIONADO PARA IMPORTAÇÃO
      this.selected = new Set(this.items.map((i) => i._i));

      this.filter = "todos";
      this.categoryFilter = "todas";
      this.search = "";

      // Por padrão, expande todas as categorias e subcategorias
      this.expandedCategories = new Set(this.items.map((i) => i.category));
      this.expandedSubcategories = new Set();
      this.items.forEach((it) => {
        this.expandedSubcategories.add(`${it.category}||${it.tipo}`);
      });

      this.render();
    } catch (err) {
      this.renderStart(err);
    }
  }

  close() {
    clearTimeout(this._t);
    this.overlay.style.display = "none";
    this.overlay.innerHTML = "";
  }

  matchesBase(i) {
    if (this.filter === "novos" && i.duplicate) return false;
    if (this.filter === "existentes" && !i.duplicate) return false;
    const q = this.search.trim().toLowerCase();
    if (q) {
      const hay = `${i.titulo || ""} ${i.descricao || ""} ${i.disciplina || ""} ${i.aluno || ""} ${i.curso || ""} ${i.journal || ""} ${i.doi || ""} ${i.tipo || ""} ${categoryLabel(i.category)} ${i.ano ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  formatDetails(r) {
    const parts = [];
    const seen = new Set();
    const titleLower = (r.titulo || "").toLowerCase();
    for (const val of [r.aluno, r.curso, r.journal]) {
      if (!val) continue;
      const trimmed = String(val).trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      if (r.category === "formacao" && titleLower.includes(key)) continue;
      seen.add(key);
      parts.push(escapeHtml(trimmed));
    }
    return parts.length ? parts.join(" · ") : "";
  }

  render() {
    const total = this.items.length;
    const novos = this.items.filter((i) => !i.duplicate).length;
    const dup = total - novos;
    const presentCats = new Set(this.items.map((i) => i.category));

    this.overlay.innerHTML = `
      <div class="modal-dialog xml-dialog">
        <header class="modal-header">
          <div>
            <h2 class="modal-title">🧬 Importar registros do XML Lattes</h2>
            <span class="xml-sub">${total} registros encontrados (${presentCats.size} categorias) · <b class="ok">${novos} novos</b> · <span class="muted">${dup} já cadastrados</span></span>
          </div>
          <button type="button" class="btn-close-modal" data-x="close">&times;</button>
        </header>

        <div class="modal-body xml-body">
          ${this.renderProfileCardHtml()}

          <!-- Barra de Ações Rápidas -->
          <div class="xml-tree-toolbar">
            <div class="seg">
              ${["todos", "novos", "existentes"]
                .map((f) => `<button type="button" data-f="${f}" class="${this.filter === f ? "on" : ""}">${f === "todos" ? `Todos (${total})` : f === "novos" ? `Novos (${novos})` : `Cadastrados (${dup})`}</button>`)
                .join("")}
            </div>

            <input type="search" class="form-input" data-x="search" placeholder="🔍 Filtrar registros por título, tipo, periódico, aluno, ano..." value="${escapeHtml(this.search)}" />

            <div class="xml-toolbar-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-x="sel-all" title="Selecionar todos os registros">✓ Marcar todos</button>
              <button type="button" class="btn btn-secondary btn-sm" data-x="sel-none" title="Desmarcar todos os registros">✕ Desmarcar todos</button>
              <button type="button" class="btn btn-secondary btn-sm" data-x="sel-new" title="Selecionar apenas registros não cadastrados">✨ Apenas novos</button>
              <button type="button" class="btn btn-secondary btn-sm" data-x="expand-all" title="Expandir todas as pastas">▼ Expandir tudo</button>
              <button type="button" class="btn btn-secondary btn-sm" data-x="collapse-all" title="Recolher todas as pastas">▶ Recolher tudo</button>
              <button type="button" class="btn btn-secondary btn-sm" data-x="browse-other" title="Trocar arquivo XML">📂 Outro arquivo</button>
            </div>
          </div>

          <!-- Árvore Hierárquica Indentada -->
          <div class="xml-tree-container" id="xmlTreeContainer"></div>
        </div>

        <footer class="modal-footer">
          <span class="muted" id="xmlSelCount" style="margin-right:auto;font-size:13px;font-weight:600"></span>
          <button type="button" class="btn btn-secondary" data-x="close">Cancelar</button>
          <button type="button" class="btn btn-primary" data-x="import"></button>
        </footer>
      </div>`;

    this.bindEvents();
    this.drawTree();
    this.updateSelectionCounts();
  }

  renderProfileCardHtml() {
    if (!this.profile || !this.profile.nome) return "";
    const p = this.profile;
    const initials = (p.nome || "L")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("");

    const metaParts = [];
    if (p.cpf) metaParts.push(`<div class="xml-profile-meta-item"><span>CPF:</span> <strong>${escapeHtml(p.cpf)}</strong></div>`);
    if (p.lattes_id) {
      metaParts.push(
        `<div class="xml-profile-meta-item"><span>Lattes ID:</span> <a href="http://lattes.cnpq.br/${encodeURIComponent(p.lattes_id)}" target="_blank" class="xml-link-btn">${escapeHtml(p.lattes_id)}</a></div>`
      );
    }
    if (p.orcid) {
      metaParts.push(
        `<div class="xml-profile-meta-item"><span>ORCID:</span> <a href="https://orcid.org/${encodeURIComponent(p.orcid)}" target="_blank" class="xml-link-btn">${escapeHtml(p.orcid)}</a></div>`
      );
    }
    if (p.instituicao) metaParts.push(`<div class="xml-profile-meta-item"><span>Instituição:</span> <strong>${escapeHtml(p.instituicao)}</strong></div>`);
    if (p.cargo) metaParts.push(`<div class="xml-profile-meta-item"><span>Cargo:</span> <strong>${escapeHtml(p.cargo)}</strong></div>`);
    if (p.atualizacao) metaParts.push(`<div class="xml-profile-meta-item"><span>Atualização:</span> <strong>${escapeHtml(p.atualizacao)}</strong></div>`);

    return `
      <div class="xml-profile-card">
        <div class="xml-profile-top">
          <div class="xml-profile-avatar">${escapeHtml(initials)}</div>
          <div class="xml-profile-info">
            <div class="xml-profile-name">
              <span>${escapeHtml(p.nome)}</span>
              ${p.nome_citacoes ? `<small class="muted" style="font-weight:normal">(${escapeHtml(p.nome_citacoes)})</small>` : ""}
            </div>
            <div class="xml-profile-meta">
              ${metaParts.join("")}
            </div>
          </div>
        </div>
        <label class="xml-profile-toggle">
          <input type="checkbox" id="xmlChkProfile" ${this.applyProfile ? "checked" : ""} />
          <span><b>Preencher e atualizar dados de identificação e perfil</b> — Atualiza automaticamente Nome, CPF, ORCID, Lattes ID, Vínculo institucional e Resumo</span>
        </label>
      </div>`;
  }

  bindEvents() {
    const $ = (s) => this.overlay.querySelector(s);

    this.overlay.querySelectorAll('[data-x="close"]').forEach((b) => b.addEventListener("click", () => this.close()));
    this.overlay.querySelector('[data-x="browse-other"]')?.addEventListener("click", () => this.browse());

    const chkProfile = this.overlay.querySelector("#xmlChkProfile");
    if (chkProfile) {
      chkProfile.addEventListener("change", (e) => {
        this.applyProfile = e.target.checked;
        this.updateSelectionCounts();
      });
    }

    this.overlay.querySelectorAll("[data-f]").forEach((b) =>
      b.addEventListener("click", () => {
        this.filter = b.dataset.f;
        this.overlay.querySelectorAll("[data-f]").forEach((btn) => btn.classList.toggle("on", btn.dataset.f === this.filter));
        this.drawTree();
        this.updateSelectionCounts();
      })
    );

    const searchInput = $('[data-x="search"]');
    searchInput?.addEventListener("input", () => {
      this.search = searchInput.value;
      clearTimeout(this._t);
      this._t = setTimeout(() => {
        if (this.search.trim()) {
          // Quando buscando, expande automaticamente os nós
          this.items.filter((i) => this.matchesBase(i)).forEach((it) => {
            this.expandedCategories.add(it.category);
            this.expandedSubcategories.add(`${it.category}||${it.tipo}`);
          });
        }
        this.drawTree();
        this.updateSelectionCounts();
      }, 160);
    });

    $('[data-x="sel-all"]')?.addEventListener("click", () => {
      const visible = this.items.filter((i) => this.matchesBase(i));
      visible.forEach((r) => this.selected.add(r._i));
      this.drawTree();
      this.updateSelectionCounts();
    });

    $('[data-x="sel-none"]')?.addEventListener("click", () => {
      const visible = this.items.filter((i) => this.matchesBase(i));
      visible.forEach((r) => this.selected.delete(r._i));
      this.drawTree();
      this.updateSelectionCounts();
    });

    $('[data-x="sel-new"]')?.addEventListener("click", () => {
      const visible = this.items.filter((i) => this.matchesBase(i));
      visible.forEach((r) => {
        if (!r.duplicate) this.selected.add(r._i);
        else this.selected.delete(r._i);
      });
      this.drawTree();
      this.updateSelectionCounts();
    });

    $('[data-x="expand-all"]')?.addEventListener("click", () => {
      this.items.forEach((it) => {
        this.expandedCategories.add(it.category);
        this.expandedSubcategories.add(`${it.category}||${it.tipo}`);
      });
      this.drawTree();
    });

    $('[data-x="collapse-all"]')?.addEventListener("click", () => {
      this.expandedCategories.clear();
      this.expandedSubcategories.clear();
      this.drawTree();
    });

    $('[data-x="import"]')?.addEventListener("click", () => this.doImport());

    // Interações delegadas na árvore (expandir/recolher, checkboxes, links de DOI/URL)
    const treeEl = $("#xmlTreeContainer");
    if (!treeEl) return;

    treeEl.addEventListener("click", (e) => {
      // Toggle Categoria
      const catHeader = e.target.closest("[data-toggle-cat]");
      if (catHeader && !e.target.closest("input") && !e.target.closest("button.xml-url-btn") && !e.target.closest("a")) {
        const cat = catHeader.dataset.toggleCat;
        if (this.expandedCategories.has(cat)) this.expandedCategories.delete(cat);
        else this.expandedCategories.add(cat);
        this.drawTree();
        return;
      }

      // Toggle Subcategoria
      const subcatHeader = e.target.closest("[data-toggle-subcat]");
      if (subcatHeader && !e.target.closest("input") && !e.target.closest("button.xml-url-btn") && !e.target.closest("a")) {
        const key = subcatHeader.dataset.toggleSubcat;
        if (this.expandedSubcategories.has(key)) this.expandedSubcategories.delete(key);
        else this.expandedSubcategories.add(key);
        this.drawTree();
        return;
      }

      // Abrir URL externo
      const urlBtn = e.target.closest("[data-url]");
      if (urlBtn) {
        e.preventDefault();
        const url = urlBtn.dataset.url;
        if (url && /^https?:\/\//i.test(url)) api.openUrl(url);
        return;
      }
    });

    treeEl.addEventListener("change", (e) => {
      // Checkbox Categoria
      const catCb = e.target.closest("input[data-cat-cb]");
      if (catCb) {
        const cat = catCb.dataset.catCb;
        const matching = this.items.filter((i) => i.category === cat && this.matchesBase(i));
        const shouldSelect = catCb.checked;
        matching.forEach((i) => {
          if (shouldSelect) this.selected.add(i._i);
          else this.selected.delete(i._i);
        });
        this.drawTree();
        this.updateSelectionCounts();
        return;
      }

      // Checkbox Subcategoria
      const subcatCb = e.target.closest("input[data-subcat-cb]");
      if (subcatCb) {
        const [cat, tipo] = subcatCb.dataset.subcatCb.split("||");
        const matching = this.items.filter((i) => i.category === cat && i.tipo === tipo && this.matchesBase(i));
        const shouldSelect = subcatCb.checked;
        matching.forEach((i) => {
          if (shouldSelect) this.selected.add(i._i);
          else this.selected.delete(i._i);
        });
        this.drawTree();
        this.updateSelectionCounts();
        return;
      }

      // Checkbox Registro Individual
      const itemCb = e.target.closest("input[data-item-cb]");
      if (itemCb) {
        const idx = Number(itemCb.dataset.itemCb);
        if (itemCb.checked) this.selected.add(idx);
        else this.selected.delete(idx);
        const row = itemCb.closest(".xml-item-row");
        if (row) row.classList.toggle("selected", itemCb.checked);
        this.syncParentCheckboxes(itemCb);
        this.updateSelectionCounts();
      }
    });
  }

  /** Atualiza o estado visual dos checkboxes pais (subcategoria e categoria) */
  syncParentCheckboxes(itemCb) {
    const subcatNode = itemCb.closest(".xml-subcat-node");
    if (subcatNode) {
      const subcatCb = subcatNode.querySelector("input[data-subcat-cb]");
      const itemCbs = [...subcatNode.querySelectorAll("input[data-item-cb]")];
      const checkedCount = itemCbs.filter((cb) => cb.checked).length;
      if (subcatCb) {
        subcatCb.checked = checkedCount === itemCbs.length && itemCbs.length > 0;
        subcatCb.indeterminate = checkedCount > 0 && checkedCount < itemCbs.length;
      }
    }
    const catNode = itemCb.closest(".xml-cat-node");
    if (catNode) {
      const catCb = catNode.querySelector("input[data-cat-cb]");
      const allItemCbs = [...catNode.querySelectorAll("input[data-item-cb]")];
      const allCheckedCount = allItemCbs.filter((cb) => cb.checked).length;
      if (catCb) {
        catCb.checked = allCheckedCount === allItemCbs.length && allItemCbs.length > 0;
        catCb.indeterminate = allCheckedCount > 0 && allCheckedCount < allItemCbs.length;
      }
    }
  }

  drawTree() {
    const container = this.overlay.querySelector("#xmlTreeContainer");
    if (!container) return;

    const visibleItems = this.items.filter((i) => this.matchesBase(i));
    if (!visibleItems.length) {
      container.innerHTML = `<div class="xml-empty-hint">Nenhum registro encontrado para os filtros e busca informados.</div>`;
      return;
    }

    // Agrupa por Categoria -> Subcategoria
    const grouped = {};
    for (const item of visibleItems) {
      if (!grouped[item.category]) grouped[item.category] = {};
      if (!grouped[item.category][item.tipo]) grouped[item.category][item.tipo] = [];
      grouped[item.category][item.tipo].push(item);
    }

    const allPresentCats = Object.keys(grouped);
    const sortedCats = CATEGORY_ORDER.filter((c) => allPresentCats.includes(c));
    for (const c of allPresentCats) {
      if (!sortedCats.includes(c)) sortedCats.push(c);
    }

    const htmlParts = sortedCats.map((catKey) => {
      const subcats = grouped[catKey];
      const catColor = categoryColor(catKey);
      const catName = categoryLabel(catKey);
      const catIco = categoryIcon(catKey);
      const isCatOpen = this.expandedCategories.has(catKey);

      let catTotal = 0;
      let catSel = 0;
      let catNew = 0;
      for (const t of Object.keys(subcats)) {
        for (const it of subcats[t]) {
          catTotal++;
          if (this.selected.has(it._i)) catSel++;
          if (!it.duplicate) catNew++;
        }
      }

      const isCatChecked = catTotal > 0 && catSel === catTotal;
      const isCatIndet = catSel > 0 && catSel < catTotal;

      const subcatKeys = Object.keys(subcats).sort((a, b) => subcats[b].length - subcats[a].length || a.localeCompare(b, "pt-BR"));

      const subcatsHtml = isCatOpen
        ? `
          <div class="xml-subcat-list">
            ${subcatKeys
              .map((tipoKey) => {
                const items = subcats[tipoKey];
                const subcatId = `${catKey}||${tipoKey}`;
                const isSubcatOpen = this.expandedSubcategories.has(subcatId);

                let subSel = 0;
                let subNew = 0;
                for (const it of items) {
                  if (this.selected.has(it._i)) subSel++;
                  if (!it.duplicate) subNew++;
                }

                const isSubChecked = items.length > 0 && subSel === items.length;
                const isSubIndet = subSel > 0 && subSel < items.length;

                const itemsHtml = isSubcatOpen
                  ? `
                    <div class="xml-item-list">
                      ${items
                        .map((r) => {
                          const isChecked = this.selected.has(r._i);
                          const metaDetails = this.formatDetails(r);
                          const metaLinks = [];

                          if (r.doi) {
                            const doiClean = r.doi.trim();
                            const doiUrl = /^https?:\/\//i.test(doiClean) ? doiClean : `https://doi.org/${doiClean}`;
                            metaLinks.push(
                              `<button type="button" class="xml-tag-doi" data-url="${escapeHtml(doiUrl)}" title="Abrir DOI no navegador">🔗 DOI ${escapeHtml(doiClean)}</button>`
                            );
                          }
                          if (r.url) {
                            metaLinks.push(
                              `<button type="button" class="xml-link-btn" data-url="${escapeHtml(r.url)}" title="${escapeHtml(r.url)}">🌐 Link externo</button>`
                            );
                          }
                          if (r.horas != null && Number(r.horas) > 0) {
                            metaLinks.push(`<span class="badge badge-hours">${Number(r.horas)}h</span>`);
                          }

                          const hasMeta = metaDetails || metaLinks.length;

                          return `
                            <div class="xml-item-row ${isChecked ? "selected" : ""} ${r.duplicate ? "duplicate" : ""}">
                              <input type="checkbox" class="xml-cb" data-item-cb="${r._i}" ${isChecked ? "checked" : ""} />
                              <div class="xml-item-year">${r.ano != null ? escapeHtml(String(r.ano)) : "—"}</div>
                              <div class="xml-item-content">
                                <div class="xml-item-title">${escapeHtml(r.titulo || r.descricao || "Sem título")}</div>
                                ${
                                  hasMeta
                                    ? `<div class="xml-item-details">
                                        ${metaDetails ? `<span>${metaDetails}</span>` : ""}
                                        ${metaLinks.join("")}
                                      </div>`
                                    : ""
                                }
                              </div>
                              <div class="xml-item-status">
                                ${r.duplicate ? '<span class="pill pill-muted">✓ Cadastrado</span>' : '<span class="pill pill-ok">✨ Novo</span>'}
                              </div>
                            </div>`;
                        })
                        .join("")}
                    </div>`
                  : "";

                return `
                  <div class="xml-subcat-node">
                    <div class="xml-subcat-header" data-toggle-subcat="${escapeHtml(subcatId)}">
                      <button type="button" class="xml-toggle-btn">${isSubcatOpen ? "▼" : "▶"}</button>
                      <input type="checkbox" class="xml-cb" data-subcat-cb="${escapeHtml(subcatId)}" ${isSubChecked ? "checked" : ""} ${isSubIndet ? "data-indet='1'" : ""} />
                      <span class="xml-subcat-title">${escapeHtml(tipoKey)}</span>
                      <span class="xml-subcat-counts">${subSel} de ${items.length} selecionados ${subNew > 0 ? `· <span class="ok">+${subNew} novos</span>` : ""}</span>
                    </div>
                    ${itemsHtml}
                  </div>`;
              })
              .join("")}
          </div>`
        : "";

      return `
        <div class="xml-cat-node">
          <div class="xml-cat-header" data-toggle-cat="${escapeHtml(catKey)}">
            <button type="button" class="xml-toggle-btn">${isCatOpen ? "▼" : "▶"}</button>
            <input type="checkbox" class="xml-cb" data-cat-cb="${escapeHtml(catKey)}" ${isCatChecked ? "checked" : ""} ${isCatIndet ? "data-indet='1'" : ""} />
            <span class="xml-cat-badge" style="background:${catColor}1c;color:${catColor};border:1px solid ${catColor}4d">
              <span>${catIco}</span>
              <span>${escapeHtml(catName)}</span>
            </span>
            <span class="xml-cat-title"></span>
            <div class="xml-cat-counts">
              <span><b>${catSel}</b> de <b>${catTotal}</b> selecionados</span>
              ${catNew > 0 ? `<span class="xml-badge-new">+${catNew} novos</span>` : ""}
            </div>
          </div>
          ${subcatsHtml}
        </div>`;
    });

    container.innerHTML = htmlParts.join("");

    // Aplica estado indeterminate nos checkboxes de categoria e subcategoria
    container.querySelectorAll("input[data-indet='1']").forEach((cb) => {
      cb.indeterminate = true;
    });
  }

  updateSelectionCounts() {
    const selCount = this.selected.size;
    const totalCount = this.items.length;
    const selEl = this.overlay.querySelector("#xmlSelCount");
    if (selEl) {
      selEl.innerHTML = `<b>${selCount}</b> de <b>${totalCount}</b> registro(s) selecionado(s) para importação`;
    }
    const importBtn = this.overlay.querySelector('[data-x="import"]');
    if (importBtn) {
      importBtn.disabled = selCount === 0 && !this.applyProfile;
      const text = [];
      if (selCount > 0) {
        text.push(`Importar ${selCount} ${selCount === 1 ? "registro" : "registros"}`);
      }
      if (this.applyProfile && this.profile && this.profile.nome) {
        text.push(selCount > 0 ? "+ Atualizar perfil" : "Atualizar identificação do perfil");
      }
      importBtn.textContent = text.join(" ") || "Selecione registros para importar";
    }
  }

  async doImport() {
    const selectedItems = this.items
      .filter((i) => this.selected.has(i._i))
      .map(({ _i, ...rest }) => rest);

    if (!selectedItems.length && !this.applyProfile) {
      showToast("Selecione ao menos um registro ou marque para atualizar o perfil.", "warning");
      return;
    }

    const importBtn = this.overlay.querySelector('[data-x="import"]');
    if (importBtn) {
      importBtn.disabled = true;
      importBtn.textContent = "Processando importação...";
    }

    try {
      let profileUpdated = false;
      // 1. Atualiza os dados de identificação e perfil caso marcado
      if (this.applyProfile && this.profile && this.profile.nome) {
        try {
          const curr = await loadProfile();
          const mergedValues = { ...(curr.values || {}) };
          for (const [k, v] of Object.entries(this.profile)) {
            if (v !== undefined && v !== null && String(v).trim() !== "") {
              mergedValues[k] = v;
            }
          }
          const updatedProfile = {
            values: mergedValues,
            include: curr.include || {},
            extras: curr.extras || [],
          };
          await saveProfile(updatedProfile);
          profileUpdated = true;
          window.dispatchEvent(new CustomEvent("profile-updated", { detail: updatedProfile }));
        } catch (profileErr) {
          console.warn("Aviso ao salvar perfil:", profileErr);
        }
      }

      // 2. Importa os registros selecionados
      let importedCount = 0;
      if (selectedItems.length) {
        importedCount = await api.importLattesXml(selectedItems);
      }

      const msgParts = [];
      if (importedCount > 0) {
        msgParts.push(`${importedCount} ${importedCount === 1 ? "registro importado" : "registros importados"}`);
      }
      if (profileUpdated) {
        msgParts.push("dados de identificação e perfil atualizados");
      }

      const finalMsg = msgParts.join(" e ") + " com sucesso!";
      showToast(finalMsg, "success", 6000);

      this.close();
      if (this.onImported) this.onImported(importedCount);
    } catch (err) {
      showToast(`Falha na importação: ${err}`, "error", 6000);
      this.updateSelectionCounts();
    }
  }
}
