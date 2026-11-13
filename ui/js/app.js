// Main Application Controller: Lattes Desktop Manager

import { api } from "./api.js";
import { CATEGORY_SCHEMAS, showToast, escapeHtml, registerCustomCategory, unregisterCustomCategories } from "./utils.js";
import { ProfilePanel } from "./components/profile.js";
import { ToolsView } from "./components/tools.js";
import { AboutView } from "./components/about.js";
import { PALETTE } from "./components/charts.js";
import { DocAnalyzer } from "./components/docAnalyzer.js";
import { BatchImport } from "./components/batchImport.js";
import { TableView } from "./components/table.js";
import { RecordModal } from "./components/modal.js";
import { Previewer } from "./components/previewer.js";
import { SubfoldersView } from "./components/subfolders.js";
import { ChartsView } from "./components/charts.js";
import { SettingsView, DEFAULT_QUALIS } from "./components/settings.js";
import { XmlImportModal } from "./components/xmlImport.js";
import { ReportBuilder } from "./components/reportBuilder.js";
import { LinkerModal } from "./components/linker.js";
import { FilterBar } from "./components/filterBar.js";
import { applyTheme, easyClose } from "./theme.js";

class App {
  constructor() {
    this.currentCategory = "producoes";
    this.isSubpastasView = false;
    this.view = "records"; // records | subpastas | graficos | configuracoes
    this.qualis = DEFAULT_QUALIS.slice();
    this.records = [];
    this.mappings = [];
    this.stats = null;


    this.searchDebounceTimer = null;

    // DOM Elements
    this.viewTitle = document.getElementById("view-title");
    this.viewSubtitle = document.getElementById("view-subtitle");
    this.inputSearch = document.getElementById("input-search");
    this.btnClearSearch = document.getElementById("btn-clear-search");
    this.allRecords = [];
    this.filterBar = new FilterBar({ container: document.getElementById("filter-bar"), onChange: () => this.renderTable() });
    this.segComp = document.getElementById("seg-comprovante");
    this.btnNewRecord = document.getElementById("btn-new-record");
    this.btnRefresh = document.getElementById("btn-refresh");
    this.btnEmptyNewRecord = document.getElementById("btn-empty-new-record");
    this.tableContainer = document.getElementById("table-container");
    this.subfoldersContainer = document.getElementById("subfolders-container");
    this.dbStatusText = document.getElementById("db-status-text");

    // Delete Modal Elements
    this.deleteModalOverlay = document.getElementById("delete-modal-overlay");
    this.deleteModalMessage = document.getElementById("delete-modal-message");
    this.deleteFileOption = document.getElementById("delete-file-option");
    this.chkDeletePhysicalFile = document.getElementById("chk-delete-physical-file");
    this.btnCloseDeleteModal = document.getElementById("btn-close-delete-modal");
    this.btnCancelDelete = document.getElementById("btn-cancel-delete");
    this.btnConfirmDelete = document.getElementById("btn-confirm-delete");
    this.pendingDeleteRecord = null;

    // Components
    this.previewer = new Previewer();

    this.tableView = new TableView({
      onEdit: (rec) => this.recordModal.openEdit(this.currentCategory, rec, this.mappings),
      onDelete: (rec) => this.openDeleteConfirm(rec),
      onPreview: (rec) => this.previewer.open(rec, this.tableView.records),
      onReveal: async (rec) => {
        try {
          await api.revealInExplorer(rec.path);
          showToast("Localizando arquivo no Windows Explorer...", "info", 2000);
        } catch (err) {
          showToast(`Erro ao localizar arquivo: ${err}`, "error");
        }
      },
      onFetchPdf: (rec) => this.fetchPdfFor(rec),
      onOpenDoi: (rec) => api.openDoi(rec.identifier).catch((e) => showToast(String(e), "error")),
    });

    this.recordModal = new RecordModal({
      onSaved: () => {
        this.loadRecords();
        this.loadStats();
      },
    });

    this.subfoldersView = new SubfoldersView({
      onMappingAdded: () => {
        this.loadMappings();
        this.loadStats();
      },
    });

    this.chartsContainer = document.getElementById("charts-container");
    this.settingsContainer = document.getElementById("settings-container");
    this.topbarCenter = document.querySelector(".topbar-center");
    this.chartsView = new ChartsView({ container: this.chartsContainer });
    this.settingsView = new SettingsView({
      container: this.settingsContainer,
      onTheme: (t) => applyTheme(t),
      onBackup: () => {
        this.showTools();
        this.toolsView.open("backup");
      },
      onCategories: async () => {
        await this.loadCustomCategories();
        await Promise.all([this.loadMappings(), this.loadStats()]);
        this.settingsView.setData(this.mappings, this.qualis);
      },
      onChanged: async () => {
        await Promise.all([this.loadMappings(), this.loadQualis(), this.loadStats()]);
        this.settingsView.setData(this.mappings, this.qualis);
        this.settingsView.render();
      },
    });
    this.xmlImport = new XmlImportModal({
      onImported: async () => {
        await Promise.all([this.loadStats(), this.loadMappings()]);
        if (this.view === "graficos") this.chartsView.show();
        else if (this.view === "records") this.switchCategory("producoes");
      },
    });

    this.linker = new LinkerModal({
      previewer: this.previewer,
      onChanged: async () => {
        await Promise.all([this.loadStats(), this.loadMappings()]);
        if (this.view === "records") await this.loadRecords();
      },
    });
    this.reportBuilder = new ReportBuilder({
      previewer: this.previewer,
      onLink: () => this.linker.open(),
      onEditProfile: async () => {
        this.profilePanel.collapsed = false;
        await this.switchCategory("dadosgerais");
      },
    });
    this.profilePanel = new ProfilePanel({ container: document.getElementById("profile-panel") });
    this.toolsContainer = document.getElementById("tools-container");
    this.aboutContainer = document.getElementById("about-container");
    this.toolsView = new ToolsView({
      container: this.toolsContainer,
      openLinker: () => this.linker.open(),
      onChanged: () => this.loadStats(),
    });
    this.aboutView = new AboutView({ container: this.aboutContainer });
    this.docAnalyzer = new DocAnalyzer({
      getMappings: () => this.mappings,
      onCreate: async (cat, tipo, campos, path) => {
        if (this.view !== "records" || cat !== this.currentCategory) await this.switchCategory(cat);
        // produções continuam com a leitura de DOI/Crossref; as demais já vêm classificadas
        this.recordModal.openCreateWithFile(cat, path, this.mappings, cat === "producoes");
        const f = this.recordModal.prefill(tipo, campos);
        if (f.length > 1) showToast(`Preenchido a partir do documento: ${f.join(", ")} — revise antes de salvar`, "info", 4500);
      },
      onAttached: async (cat) => {
        await this.loadStats();
        if (this.view === "records") {
          if (cat !== this.currentCategory) await this.switchCategory(cat);
          else await this.loadRecords();
        }
      },
    });

    this.batchImport = new BatchImport({
      getMappings: () => this.mappings,
      previewer: this.previewer,
      onDone: async (cats) => {
        await this.loadStats();
        if (this.view === "records") {
          if (cats.length === 1 && cats[0] !== this.currentCategory) await this.switchCategory(cats[0]);
          else await this.loadRecords();
        }
      },
    });

    this.bindEvents();
  }

  /**
   * Novo registro a partir de um arquivo. PDFs vão para Produções (com extração de metadados)
   * a menos que você já esteja em outra categoria de registros.
   */
  async newFromFile(path) {
    // modal já aberto: só troca o anexo
    if (this.recordModal.overlay.style.display === "flex") {
      this.recordModal.setSourceFile(path);
      return;
    }
    // classificação automática: propõe a atividade, extrai campos e procura o registro
    this.docAnalyzer.open(path);
  }

  /**
   * ⚡ na linha de uma produção sem comprovante: DOI (ou busca pelo título) → PDF de acesso aberto
   * → anexa direto ao registro. Se o PDF não puder ser baixado, abre o registro com as opções.
   */
  async fetchPdfFor(rec) {
    const tv = this.tableView;
    if (tv.busy.has(rec.id)) return;
    const rerender = () => tv.render(this.currentCategory, this.records, this.allRecords.length);
    tv.busy.add(rec.id);
    rerender();
    try {
      let doi = /^10\.\d{4,9}\//.test(String(rec.identifier || "").trim()) ? rec.identifier.trim() : null;
      if (!doi) {
        if (String(rec.titulo || "").trim().length < 15) throw "registro sem DOI e com título curto demais para buscar";
        doi = await api.findDoiByTitle(rec.titulo);
        if (!doi) throw "nenhum DOI com esse título na Crossref — abra o registro e cole o DOI";
      }
      const res = await api.resolveDoi(doi, true);
      if (res.pdf_path) {
        const data = { identifier: doi };
        if (!rec.folder) {
          const m = this.mappings.find((x) => x.category_group === "Produções" && x.description === rec.tipo);
          if (m) data.folder = m.folder;
        }
        await api.updateRecord("producoes", rec.id, data, res.pdf_path);
        const ver = { publicada: "versão publicada", aceita: "versão aceita", preprint: "preprint" }[res.pdf_versao] || "PDF";
        showToast(`📄 PDF anexado (${ver}) — #${rec.id} ${String(rec.titulo || "").slice(0, 50)}`, "success", 4500);
        tv.busy.delete(rec.id);
        await this.loadRecords();
      } else {
        tv.busy.delete(rec.id);
        rerender();
        // abre o registro mostrando os links para baixar pelo navegador
        this.recordModal.openEdit("producoes", rec, this.mappings);
        this.recordModal.showDoiResult(res);
      }
    } catch (err) {
      tv.busy.delete(rec.id);
      rerender();
      showToast(`Não foi possível buscar o PDF: ${err}`, "error", 5000);
    }
  }

  /** Arrastar arquivos do Explorer para a janela (eventos nativos do Tauri). */
  async bindFileDrop() {
    const ev = window.__TAURI__?.event;
    if (!ev?.listen) return;
    const overlay = document.getElementById("drop-overlay");
    const ok = (paths) => (paths || []).filter((p) => /\.(pdf|png|jpe?g)$/i.test(p));
    try {
      await ev.listen("tauri://drag-enter", (e) => {
        if (ok(e.payload?.paths).length) overlay.classList.add("on");
      });
      await ev.listen("tauri://drag-leave", () => overlay.classList.remove("on"));
      await ev.listen("tauri://drag-drop", (e) => {
        overlay.classList.remove("on");
        const files = ok(e.payload?.paths);
        if (!files.length) return showToast("Arraste um PDF ou imagem", "info", 2500);
        // vários arquivos: importação em lote (com revisão antes de salvar)
        if (files.length > 1 && this.recordModal.overlay.style.display !== "flex") return this.batchImport.open(files);
        this.newFromFile(files[0]);
      });
    } catch (err) {
      console.warn("Arrastar-e-soltar indisponível:", err);
    }
  }

  /** Mostra apenas o container da view pedida e ajusta a topbar. */
  setView(view) {
    this.view = view;
    this.isSubpastasView = view === "subpastas";
    const isRecords = view === "records";
    this.tableContainer.style.display = isRecords ? "flex" : "none";
    this.subfoldersContainer.style.display = view === "subpastas" ? "flex" : "none";
    this.chartsContainer.style.display = view === "graficos" ? "block" : "none";
    this.settingsContainer.style.display = view === "configuracoes" ? "flex" : "none";
    this.toolsContainer.style.display = view === "ferramentas" ? "block" : "none";
    this.aboutContainer.style.display = view === "sobre" ? "block" : "none";
    // transição suave entre telas
    const shown = { records: this.tableContainer, subpastas: this.subfoldersContainer, graficos: this.chartsContainer, configuracoes: this.settingsContainer, ferramentas: this.toolsContainer, sobre: this.aboutContainer }[view];
    if (shown) {
      shown.classList.remove("view-enter");
      void shown.offsetWidth;
      shown.classList.add("view-enter");
    }
    if (this.topbarCenter) this.topbarCenter.style.visibility = isRecords ? "visible" : "hidden";
    this.btnNewRecord.style.display = isRecords || view === "subpastas" ? "" : "none";
    document.querySelectorAll(".nav-item").forEach((el) => {
      const c = el.dataset.category;
      el.classList.toggle("active", isRecords ? c === this.currentCategory : c === view);
    });
  }

  async loadQualis() {
    try {
      const saved = await api.getDropdownOptions("qualis");
      if (Array.isArray(saved) && saved.length) this.qualis = saved.includes("") ? saved : ["", ...saved];
    } catch (err) {
      console.error("Falha ao carregar opções de Qualis:", err);
    }
    const f = CATEGORY_SCHEMAS.producoes.fields.find((x) => x.name === "qualis");
    if (f) f.options = this.qualis.slice();
  }

  showCharts() {
    this.setView("graficos");
    this.viewTitle.textContent = "Indicadores";
    this.viewSubtitle.textContent = "Análise da produção por ano, categoria, tipo e estrato Qualis";
    this.chartsView.show();
  }

  showTools() {
    this.setView("ferramentas");
    this.viewTitle.textContent = "Ferramentas";
    this.viewSubtitle.textContent = "Utilidades para formatar, organizar e conferir seus registros e arquivos";
    this.toolsView.show();
  }

  showAbout() {
    this.setView("sobre");
    this.viewTitle.textContent = "Sobre";
    this.viewSubtitle.textContent = "Lattes Manager — gestão do currículo e dos comprovantes";
    this.aboutView.show();
  }

  /** Categorias criadas pelo usuário: esquema, cor, item no menu lateral e no modal de subpastas. */
  async loadCustomCategories() {
    let list = [];
    try {
      list = (await api.listCustomCategories()) || [];
    } catch (err) {
      console.warn("Categorias personalizadas indisponíveis:", err);
    }
    unregisterCustomCategories();
    list.forEach((c, i) => {
      registerCustomCategory(c, i);
      PALETTE[c.key] = CATEGORY_SCHEMAS[c.key].color;
    });
    const ul = document.getElementById("nav-category-list");
    ul.querySelectorAll("[data-custom]").forEach((li) => li.remove());
    for (const c of list) {
      const li = document.createElement("li");
      li.className = "nav-item";
      li.dataset.category = c.key;
      li.dataset.custom = "1";
      li.innerHTML = `<button class="nav-link"><span class="nav-icon">${escapeHtml(c.icon || "🗂️")}</span><span class="nav-label">${escapeHtml(c.name)}</span><span class="badge badge-count" id="badge-${escapeHtml(c.key)}">${c.count}</span></button>`;
      ul.appendChild(li);
    }
    const sel = document.getElementById("subfolder-group-select");
    if (sel) {
      sel.querySelectorAll("[data-custom]").forEach((o) => o.remove());
      for (const c of list) sel.insertAdjacentHTML("beforeend", `<option data-custom="1" value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`);
    }
    if (this.view === "records" && CATEGORY_SCHEMAS[this.currentCategory] == null) await this.switchCategory("producoes");
    this.setView(this.view);
  }

  showSettings() {
    this.setView("configuracoes");
    this.viewTitle.textContent = "Configurações";
    this.viewSubtitle.textContent = "Aparência, pasta de dados e opções dos campos de cada categoria";
    this.settingsView.setData(this.mappings, this.qualis);
    this.settingsView.render();
  }

  async init() {
    console.log("Inicializando Lattes Desktop Manager...");
    if (api.hasTauri()) {
      this.dbStatusText.textContent = "Tauri IPC Conectado";
    } else {
      this.dbStatusText.textContent = "Navegador Web (Mock Ativo)";
    }

    await this.loadCustomCategories();
    await Promise.all([this.loadStats(), this.loadMappings(), this.loadQualis()]);
    await this.switchCategory("producoes");
  }

  bindEvents() {
    // Category Navigation (Sidebar)
    // delegação: vale também para categorias criadas depois
    document.getElementById("nav-category-list").addEventListener("click", (e) => {
      const item = e.target.closest(".nav-item");
      if (item?.dataset.category) this.switchCategory(item.dataset.category);
    });

    // Subpastas Nav Link
    const navSubpastas = document.getElementById("nav-subpastas");
    if (navSubpastas) {
      navSubpastas.addEventListener("click", () => this.switchToSubpastasView());
    }
    document.getElementById("nav-graficos")?.addEventListener("click", () => this.showCharts());
    document.getElementById("nav-configuracoes")?.addEventListener("click", () => this.showSettings());
    document.getElementById("nav-ferramentas")?.addEventListener("click", () => this.showTools());
    document.getElementById("nav-sobre")?.addEventListener("click", () => this.showAbout());
    document.getElementById("btn-import-xml")?.addEventListener("click", () => this.xmlImport.open());
    document.getElementById("btn-batch-import")?.addEventListener("click", () => this.batchImport.open());
    document.getElementById("btn-report")?.addEventListener("click", () => this.reportBuilder.open());
    document.getElementById("btn-linker")?.addEventListener("click", () => this.linker.open());
    const themeBtn = document.getElementById("btn-theme-toggle");
    const syncThemeBtn = () => {
      const dark = document.documentElement.dataset.theme === "dark";
      themeBtn.querySelector(".ti").textContent = dark ? "☀️" : "🌙";
      themeBtn.querySelector(".tl").textContent = dark ? "Tema claro" : "Tema escuro";
    };
    syncThemeBtn();
    themeBtn.addEventListener("click", () => {
      document.documentElement.classList.add("theme-anim");
      applyTheme({ mode: document.documentElement.dataset.theme === "dark" ? "light" : "dark" });
      setTimeout(() => document.documentElement.classList.remove("theme-anim"), 400);
      syncThemeBtn();
      if (this.view === "configuracoes") this.settingsView.render();
    });

    // Search Input
    this.inputSearch.addEventListener("input", (e) => {
      const val = e.target.value;
      this.btnClearSearch.style.display = val ? "block" : "none";
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        this.filterBar.search = val.trim();
        this.filterBar.render();
        this.renderTable();
      }, 150);
    });

    this.btnClearSearch.addEventListener("click", () => {
      this.inputSearch.value = "";
      this.btnClearSearch.style.display = "none";
      this.filterBar.search = "";
      this.filterBar.render();
      this.renderTable();
    });

    // Filtro de comprovante (com/sem)
    this.segComp.querySelectorAll("[data-comp]").forEach((b) =>
      b.addEventListener("click", () => {
        this.filterBar.comp = b.dataset.comp;
        this.filterBar.render();
        this.renderTable();
      })
    );

    // Menu Importar
    const menuBtn = document.getElementById("btn-import-menu");
    const menu = document.getElementById("import-menu");
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("open");
    });
    document.addEventListener("click", () => menu.classList.remove("open"));
    menu.addEventListener("click", () => menu.classList.remove("open"));

    // Novo a partir de PDF (menu Importar)
    document.getElementById("btn-new-from-pdf")?.addEventListener("click", async () => {
      const path = await api.selectPdfFile();
      if (path) this.newFromFile(path);
    });
    this.bindFileDrop();

    // Novo por DOI (menu Importar e barra da tabela de Produções)
    const newByDoi = async () => {
      if (this.view !== "records" || this.currentCategory !== "producoes") await this.switchCategory("producoes");
      this.recordModal.openCreateDoi("producoes", this.mappings);
    };
    document.getElementById("btn-new-from-doi")?.addEventListener("click", newByDoi);
    document.getElementById("btn-add-doi")?.addEventListener("click", newByDoi);

    // Atalhos
    document.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (this.view !== "records") this.switchCategory(this.currentCategory);
        this.inputSearch.focus();
        this.inputSearch.select();
      } else if (mod && e.key.toLowerCase() === "n" && this.view === "records") {
        e.preventDefault();
        this.recordModal.openCreate(this.currentCategory, this.mappings);
      }
    });

    // Action Buttons
    this.btnNewRecord.addEventListener("click", () => {
      if (this.isSubpastasView) {
        this.subfoldersView.openModal();
      } else {
        this.recordModal.openCreate(this.currentCategory, this.mappings);
      }
    });

    if (this.btnEmptyNewRecord) {
      this.btnEmptyNewRecord.addEventListener("click", () => {
        this.recordModal.openCreate(this.currentCategory, this.mappings);
      });
    }

    this.btnRefresh.addEventListener("click", () => {
      this.loadRecords();
      this.loadStats();
      showToast("Dados atualizados", "info", 1500);
    });


    // Delete Modal Events
    this.btnCloseDeleteModal.addEventListener("click", () => this.closeDeleteModal());
    this.btnCancelDelete.addEventListener("click", () => this.closeDeleteModal());
    this.deleteModalOverlay.addEventListener("click", (e) => {
      if (e.target === this.deleteModalOverlay && easyClose()) this.closeDeleteModal();
    });
    this.btnConfirmDelete.addEventListener("click", () => this.handleConfirmDelete());
  }

  async switchCategory(category) {
    this.currentCategory = category;
    this.setView("records");
    this.btnNewRecord.innerHTML = `<span>+</span> Novo Registro`;
    const addDoi = document.getElementById("btn-add-doi");
    if (addDoi) addDoi.style.display = category === "producoes" ? "" : "none";

    const schema = CATEGORY_SCHEMAS[category];
    if (schema) {
      this.viewTitle.textContent = schema.name;
      this.viewSubtitle.textContent = schema.subtitle;
    }
    if (category === "dadosgerais") this.profilePanel.show();
    else this.profilePanel.hide();

    await this.loadRecords();
  }

  switchToSubpastasView() {
    this.setView("subpastas");
    this.btnNewRecord.innerHTML = `<span>+</span> Nova Subpasta`;

    this.viewTitle.textContent = "Gerenciamento de Subpastas";
    this.viewSubtitle.textContent = "Visualize e configure as pastas de destino para armazenamento dos comprovantes";

    this.subfoldersView.setMappings(this.mappings);
  }

  async loadRecords() {
    if (this.view !== "records") return;
    const cat = this.currentCategory;
    this.tableView.setLoading(true);
    try {
      const records = await api.getRecords(cat, {});
      if (cat !== this.currentCategory) return; // usuário trocou de categoria durante o carregamento
      this.allRecords = records || [];
      this.filterBar.setRecords(cat, this.allRecords);
      this.renderTable();
    } catch (err) {
      console.error("Falha ao carregar registros:", err);
      showToast(`Erro ao carregar registros: ${err}`, "error");
      this.tableView.render(cat, []);
    } finally {
      this.tableView.setLoading(false);
    }
  }

  /** Aplica busca + pílulas aos registros carregados e redesenha a tabela. */
  renderTable() {
    this.records = this.filterBar.filtered();
    this.segComp.querySelectorAll("[data-comp]").forEach((b) => b.classList.toggle("on", b.dataset.comp === this.filterBar.comp));
    if (!this.filterBar.search && this.inputSearch.value) {
      this.inputSearch.value = "";
      this.btnClearSearch.style.display = "none";
    }
    this.tableView.render(this.currentCategory, this.records, this.allRecords.length);
  }

  async loadMappings() {
    try {
      this.mappings = await api.getSubfolderMappings();
      this.recordModal.setMappings(this.mappings);
      this.subfoldersView.setMappings(this.mappings);

      const badgeSubfolders = document.getElementById("badge-subfolders");
      if (badgeSubfolders) {
        badgeSubfolders.textContent = String(this.mappings.length);
      }
    } catch (err) {
      console.error("Falha ao carregar mapeamentos:", err);
    }
  }

  async loadStats() {
    try {
      this.stats = await api.getAppStats();
      if (!this.stats) return;

      // Update Category Badges
      const counts = this.stats.counts_by_category || {};
      for (const [cat, count] of Object.entries(counts)) {
        const badge = document.getElementById(`badge-${cat}`);
        if (badge) {
          badge.textContent = String(count);
        }
      }

      const badgeSubfolders = document.getElementById("badge-subfolders");
      if (badgeSubfolders && this.stats.total_mappings != null) {
        badgeSubfolders.textContent = String(this.stats.total_mappings);
      }
    } catch (err) {
      console.error("Falha ao carregar estatísticas:", err);
    }
  }

  openDeleteConfirm(record) {
    this.pendingDeleteRecord = record;
    const desc = record.titulo || record.descricao || record.disciplina || `Registro #${record.id}`;
    this.deleteModalMessage.textContent = `Tem certeza que deseja excluir '${desc}' (ID: ${record.id})?`;

    if (record.path) {
      this.deleteFileOption.style.display = "block";
      this.chkDeletePhysicalFile.checked = false;
    } else {
      this.deleteFileOption.style.display = "none";
      this.chkDeletePhysicalFile.checked = false;
    }

    this.deleteModalOverlay.style.display = "flex";
  }

  closeDeleteModal() {
    this.deleteModalOverlay.style.display = "none";
    this.pendingDeleteRecord = null;
  }

  async handleConfirmDelete() {
    if (!this.pendingDeleteRecord) return;

    const id = this.pendingDeleteRecord.id;
    const deleteFile = this.chkDeletePhysicalFile.checked;

    try {
      this.btnConfirmDelete.disabled = true;
      this.btnConfirmDelete.textContent = "Excluindo...";

      await api.deleteRecord(this.currentCategory, id, deleteFile);
      showToast(
        deleteFile
          ? "Registro e arquivo comprovante excluídos com sucesso"
          : "Registro excluído do banco de dados",
        "success"
      );

      this.closeDeleteModal();
      await Promise.all([this.loadRecords(), this.loadStats()]);
    } catch (err) {
      console.error("Erro ao excluir registro:", err);
      showToast(`Erro ao excluir: ${err}`, "error");
    } finally {
      this.btnConfirmDelete.disabled = false;
      this.btnConfirmDelete.textContent = "Excluir Registro";
    }
  }
}

// Bootstrap on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  const app = new App();
  app.init().catch(console.error);
});
