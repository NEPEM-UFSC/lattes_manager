// Main Application Controller: Lattes Desktop Manager

import { api } from "./api.js";
import {
  CATEGORY_SCHEMAS,
  DEFAULT_DADOS_GERAIS_MAPPINGS,
  DEFAULT_ATUACAO_MAPPINGS,
  showToast,
  escapeHtml,
  registerCustomCategory,
  unregisterCustomCategories,
  applyCategoryOrder,
  readSavedCategoryOrder,
  writeSavedCategoryOrder,
  readSavedCategoryOverrides,
  writeSavedCategoryOverrides,
  applyCategoryOverrides,
} from "./utils.js";
import { ProfilePanel } from "./components/profile.js";
import { HomeView } from "./components/home.js";
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
import { ReportBuilder, buildCategoryPreview } from "./components/reportBuilder.js";
import { LinkerModal } from "./components/linker.js";
import { ProofPickerModal } from "./components/proofPicker.js";
import { FilterBar, matchesSearch } from "./components/filterBar.js";
import { applyTheme, easyClose } from "./theme.js";

const GROUP_BY_CATEGORY = {
  dadosgerais: "Dados gerais",
  formacao: "Formação",
  atuacao: "Atuação",
  encargos: "Encargos",
  disciplinas: "Disciplinas",
  projetos: "Projetos",
  producoes: "Produções",
  patentes: "Patentes",
  eventos: "Eventos",
  orientacoes: "Orientações",
  bancas: "Bancas",
};

class App {
  constructor() {
    this.currentCategory = "producoes";
    this.isSubpastasView = false;
    this.view = "home"; // home | records | subpastas | graficos | configuracoes | ferramentas | sobre
    this.qualis = DEFAULT_QUALIS.slice();
    this.records = [];
    this.mappings = [];
    this.stats = null;

    this.searchDebounceTimer = null;
    this.crossHintTimer = null;
    this.crossHintReqId = 0;

    // DOM Elements
    this.viewTitle = document.getElementById("view-title");
    this.viewSubtitle = document.getElementById("view-subtitle");
    this.inputSearch = document.getElementById("input-search");
    this.btnClearSearch = document.getElementById("btn-clear-search");
    this.allRecords = [];
    this.filterBar = new FilterBar({
      container: document.getElementById("filter-bar"),
      onChange: () => this.renderTable(),
      onSearchChange: (q) => this.scheduleCrossCategoryHints(q),
      onSelectCategory: (cat) => this.switchCategoryFromHint(cat),
    });
    this.segComp = document.getElementById("seg-comprovante");
    this.segLink = document.getElementById("seg-link");
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
    this.deleteFileOptionLabel = this.deleteFileOption?.querySelector("span") || null;
    this.chkDeletePhysicalFile = document.getElementById("chk-delete-physical-file");
    this.btnCloseDeleteModal = document.getElementById("btn-close-delete-modal");
    this.btnCancelDelete = document.getElementById("btn-cancel-delete");
    this.btnConfirmDelete = document.getElementById("btn-confirm-delete");
    this.pendingDeleteRecord = null;
    this.pendingDeleteRecords = null;
    this._batchEditModal = null;
    this._batchEditTargetRecords = [];

    // Components
    this.previewer = new Previewer();
    window._previewer = this.previewer;
    window._app = this;
    window.app = this;

    this.tableView = new TableView({
      onEdit: (rec) => this.recordModal.openEdit(this.currentCategory, rec, this.mappings),
      onDuplicate: (rec) => this.recordModal.openDuplicate(this.currentCategory, rec, this.mappings),
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
      onLinkProof: (recs) => this.openProofPickerFor(recs),
      onBulkLinkProof: (recs) => this.openProofPickerFor(recs),
      onBulkDuplicate: (recs) => this.bulkDuplicateRecords(recs),
      onBulkEdit: (recs) => this.openBatchEditModal(recs),
      onBulkDelete: (recs) => this.openBatchDeleteConfirm(recs),
      onBulkFetchPdfs: (recs) => this.batchFetchPdfs(recs),
      onFileDropOnRow: (rec, filePath) => this.attachDroppedFileToRecord(rec, filePath),
    });

    this.recordModal = new RecordModal({
      previewer: this.previewer,
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
        this.settingsView.setData(this.mappings, this.qualis, this.stats);
      },
      onChanged: async () => {
        await Promise.all([this.loadMappings(), this.loadQualis(), this.loadStats()]);
        this.settingsView.setData(this.mappings, this.qualis, this.stats);
        this.settingsView.render();
      },
    });
    this.xmlImport = new XmlImportModal({
      onImported: async () => {
        await Promise.all([this.loadStats(), this.loadMappings()]);
        if (this.view === "home") this.homeView.show();
        else if (this.view === "graficos") this.chartsView.show();
        else if (this.view === "records") this.switchCategory("producoes");
      },
    });

    this.linker = new LinkerModal({
      previewer: this.previewer,
      onChanged: async () => {
        await Promise.all([this.loadStats(), this.loadMappings()]);
        if (this.view === "home") this.homeView.show();
        else if (this.view === "records") await this.loadRecords();
      },
    });
    this.reportBuilder = new ReportBuilder({
      previewer: this.previewer,
      onLink: () => this.linker.open(),
      onEditProfile: async () => {
        this.profilePanel.mode = "both";
        this.profilePanel.collapsed = false;
        await this.switchCategory("dadosgerais");
      },
    });
    this.profilePanel = new ProfilePanel({
      container: document.getElementById("profile-panel"),
      onSaved: () => {
        if (this.view === "home") this.homeView.show();
      },
      onNewRecord: () => this.recordModal.openCreate("dadosgerais", this.mappings),
      onModeChange: (mode) => this.syncProfileMode(mode),
    });
    this.homeContainer = document.getElementById("home-container");
    this.toolsContainer = document.getElementById("tools-container");
    this.aboutContainer = document.getElementById("about-container");
    this.homeView = new HomeView({
      container: this.homeContainer,
      onNavigateCategory: (cat) => this.switchCategory(cat),
      onOpenXmlImport: () => this.xmlImport.open(),
      onOpenNewFromDoi: async () => {
        if (this.view !== "records" || this.currentCategory !== "producoes") await this.switchCategory("producoes");
        this.recordModal.openCreateDoi("producoes", this.mappings);
      },
      onOpenNewFromPdf: async () => {
        const path = await api.selectPdfFile();
        if (path) this.newFromFile(path);
      },
      onOpenBatchImport: () => this.batchImport.open(),
      onOpenReport: () => this.reportBuilder.open(),
      onOpenLinker: () => this.linker.open(),
      onOpenCharts: () => this.showCharts(),
      onOpenBackup: () => {
        this.showTools();
        this.toolsView.open("backup");
      },
      onOpenTool: (toolKey) => {
        this.showTools();
        if (toolKey) this.toolsView.open(toolKey);
      },
      onOpenTools: () => this.showTools(),
      onOpenSubfolders: () => this.switchToSubpastasView(),
      onOpenSettings: () => this.showSettings(),
      onOpenAbout: () => this.showAbout(),
      onCreateInCategory: async (cat) => {
        await this.switchCategory(cat);
        this.recordModal.openCreate(cat, this.mappings);
      },
      onPreviewRecord: (rec) => this.previewer.open(rec),
      onOpenRecentRecord: async (rec) => {
        const cat = rec?.category || "producoes";
        await this.switchCategory(cat);
        if (rec?.id != null) {
          const loaded = this.allRecords.find((x) => Number(x.id) === Number(rec.id)) || rec;
          this.recordModal.openEdit(cat, loaded, this.mappings);
        }
      },
    });
    this.toolsView = new ToolsView({
      container: this.toolsContainer,
      openLinker: () => this.linker.open(),
      onCreateWithData: (cat, data, cb) => this.openCreateRecordWithData(cat, data, cb),
      onChanged: async () => {
        await this.loadStats();
        if (this.view === "home") this.homeView.show();
      },
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
        if (this.view === "home") {
          this.homeView.show();
        } else if (this.view === "records") {
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

  askPreviewMode(groupName, count, filtered) {
    return new Promise((resolve) => {
      // Padrão sempre alta resolução (compress = false)
      let compress = false;

      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.style.display = "flex";
      overlay.innerHTML = `
        <div class="modal-dialog modal-dialog-sm" style="max-width:460px;">
          <header class="modal-header">
            <h3 class="modal-title">👁️ Preview · ${groupName}</h3>
            <button type="button" class="btn-close-modal" data-cancel aria-label="Fechar">&times;</button>
          </header>
          <div class="modal-body" style="padding:18px 20px; display:flex; flex-direction:column; gap:14px;">
            <p style="margin:0; font-size:13px; color:var(--text-secondary);">
              Serão incluídos <b>${count}</b> comprovante(s)${filtered ? " (conforme os filtros atuais)" : ""}.
            </p>
            <div style="display:flex; flex-direction:column; gap:6px;">
              <span style="font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:var(--text-muted);">Qualidade / Tamanho</span>
              <div class="seg" style="width:100%; display:flex;">
                <button type="button" data-qual="high" class="${!compress ? "on" : ""}" style="flex:1; font-size:12px;">💎 Máxima resolução</button>
                <button type="button" data-qual="compact" class="${compress ? "on" : ""}" style="flex:1; font-size:12px;">🗜️ Compactado (leve)</button>
              </div>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              <span style="font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:var(--text-muted);">Páginas de cada comprovante</span>
              <button type="button" class="btn btn-primary" data-mode="first" style="justify-content:flex-start; text-align:left; padding:12px 14px; height:auto; display:flex; flex-direction:column; align-items:flex-start; gap:3px;">
                <span style="font-size:13.5px; font-weight:700;">📄 Somente a primeira página</span>
                <span style="font-size:11.5px; font-weight:400; opacity:0.9;">Mais rápido e leve — ideal para conferir capas e títulos de artigos.</span>
              </button>
              <button type="button" class="btn btn-secondary" data-mode="full" style="justify-content:flex-start; text-align:left; padding:12px 14px; height:auto; display:flex; flex-direction:column; align-items:flex-start; gap:3px;">
                <span style="font-size:13.5px; font-weight:700;">📚 Arquivo inteiro</span>
                <span style="font-size:11.5px; font-weight:400; color:var(--text-secondary);">Inclui todas as páginas completas de cada PDF anexado.</span>
              </button>
            </div>
          </div>
          <footer class="modal-footer" style="padding:10px 20px;">
            <button type="button" class="btn btn-secondary btn-sm" data-cancel>Cancelar</button>
          </footer>
        </div>
      `;
      document.getElementById("app")?.appendChild(overlay);

      overlay.querySelectorAll("[data-qual]").forEach((btn) => {
        btn.addEventListener("click", () => {
          compress = btn.dataset.qual === "compact";
          overlay.querySelectorAll("[data-qual]").forEach((b) => b.classList.toggle("on", b === btn));
        });
      });

      const finish = (firstPageOnly) => {
        overlay.remove();
        resolve(firstPageOnly === null ? null : { firstPageOnly, compress });
      };
      overlay.querySelector('[data-mode="first"]')?.addEventListener("click", () => finish(true));
      overlay.querySelector('[data-mode="full"]')?.addEventListener("click", () => finish(false));
      overlay.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => finish(null)));
      overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(null); });
    });
  }

  /**
   * 👁️ Preview comprovantes: monta em memória um PDF com os comprovantes dos registros
   * exibidos na categoria atual (respeita busca e filtros) e abre no visualizador interno.
   */
  async previewCategoryProofs(forceOpts = null) {
    if (this._buildingPreview) {
      showToast("Já há uma pré-visualização sendo montada — aguarde terminar", "info");
      return;
    }

    const cat = this.currentCategory;
    const schema = CATEGORY_SCHEMAS[cat];
    const recs = (this.tableView.records || []).filter((r) => r.path && String(r.path).trim());
    if (!schema || !recs.length) {
      showToast("Nenhum registro exibido possui comprovante para pré-visualizar", "info");
      return;
    }
    const filtered = recs.length < this.allRecords.filter((r) => r.path && String(r.path).trim()).length;

    let firstPageOnly = false;
    let compress = false;
    if (forceOpts !== null && typeof forceOpts === "object") {
      firstPageOnly = Boolean(forceOpts.firstPageOnly);
      compress = Boolean(forceOpts.compress);
    } else if (forceOpts !== null) {
      firstPageOnly = Boolean(forceOpts);
      compress = false;
    } else {
      const chosen = await this.askPreviewMode(schema.group, recs.length, filtered);
      if (chosen === null) return;
      firstPageOnly = chosen.firstPageOnly;
      compress = chosen.compress;
    }

    const title = `Comprovantes · ${schema.group}`;
    const modeTxt = `${firstPageOnly ? "1ª pág." : "inteiro"} · ${compress ? "compactado" : "máxima"}`;
    const sub = `Pré-visualização (${modeTxt}) · ${recs.length} comprovante(s)${filtered ? " (conforme filtros)" : ""}`;
    const token = this.previewer.openPending(title, sub);
    this._buildingPreview = true;
    try {
      const res = await buildCategoryPreview(cat, recs, {
        firstPageOnly,
        compress,
        onProgress: ({ done, total, label }) =>
          this.previewer.setProgress(token, `${done}/${total} · ${label}`, (done / total) * 100),
      });
      if (!this.previewer.isActive(token)) return; // fechado ou trocado durante a montagem
      if (!res) {
        this.previewer.close();
        return;
      }
      const slug = (s) =>
        String(s || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^A-Za-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");
      let authorName = this.profilePanel?.p?.values?.nome || "";
      if (!authorName) {
        try {
          const prof = await api.getSetting("profile");
          authorName = prof?.values?.nome || "";
        } catch {}
      }
      const catSlug = slug(schema.group || cat).toLowerCase() || "comprovantes";
      const authorSlug = slug(authorName) || "lattes";
      const previewFilename = `preview_${catSlug}_${authorSlug}.pdf`;
      let absPath = null;
      try {
        absPath = await api.writePreviewTemp(previewFilename, res.bytes);
      } catch {}

      const mb = (res.bytes.length / 1048576).toFixed(1);
      const extra = res.failed.length ? ` · ⚠️ ${res.failed.length} não incorporado(s)` : "";
      this.previewer.openPdfBytes(
        res.bytes,
        previewFilename,
        `Pré-visualização (${modeTxt}) · ${res.pages} páginas · ${mb} MB · ${res.attached} comprovante(s)${extra}`,
        {
          absPath,
          firstPageOnly,
          compress,
          onToggle: (next) => this.previewCategoryProofs(next),
        }
      );
      if (res.failed.length) {
        showToast(`${res.failed.length} comprovante(s) não puderam ser incorporados: ${res.failed.slice(0, 3).join("; ")}${res.failed.length > 3 ? "…" : ""}`, "error", 7000);
      }
    } catch (err) {
      console.error(err);
      if (this.previewer.isActive(token)) this.previewer.close();
      showToast(`Falha ao montar a pré-visualização: ${err?.message || err}`, "error", 7000);
    } finally {
      this._buildingPreview = false;
    }
  }

  /** Vincula um arquivo arrastado diretamente sobre a linha de um registro. */
  async attachDroppedFileToRecord(rec, filePath) {
    if (!rec || !filePath) return;
    const cat = this.currentCategory;
    const data = {};
    const idStr = String(rec.identifier || "").trim();
    if (/^10\.\d{4,9}\//.test(idStr)) {
      data.identifier = idStr;
    }
    if (!rec.folder) {
      const groupName = CATEGORY_SCHEMAS[cat]?.dbGroup || GROUP_BY_CATEGORY[cat] || CATEGORY_SCHEMAS[cat]?.name;
      const m = this.mappings.find(
        (x) => (!groupName || x.category_group === groupName) && x.description === rec.tipo
      );
      if (m) data.folder = m.folder;
    }

    const rawDesc = rec.titulo || rec.descricao || rec.disciplina || `Registro #${rec.id}`;
    const shortDesc = String(rawDesc).length > 52 ? `${String(rawDesc).slice(0, 49)}...` : String(rawDesc);

    try {
      await api.updateRecord(cat, rec.id, data, filePath);
      showToast(`Comprovante vinculado a "${shortDesc}"`, "success", 3500);
      await Promise.all([this.loadRecords(), this.loadStats()]);
    } catch (err) {
      console.error("Erro ao vincular comprovante:", err);
      showToast(`Erro ao vincular comprovante: ${err}`, "error");
    }
  }

  /** Arrastar arquivos do Explorer para a janela (eventos nativos do Tauri). */
  async bindFileDrop() {
    const ev = window.__TAURI__?.event;
    if (!ev?.listen) return;
    const overlay = document.getElementById("drop-overlay");
    const ok = (paths) => (paths || []).filter((p) => /\.(pdf|png|jpe?g)$/i.test(p));
    let draggingValidFiles = false;
    let draggingSingleFile = false;

    const findHoveredRowId = (pos) => {
      if (!pos || this.view !== "records" || this.recordModal.overlay.style.display === "flex") return null;
      const dpr = window.devicePixelRatio || 1;
      const attempts = dpr !== 1 ? [[pos.x / dpr, pos.y / dpr], [pos.x, pos.y]] : [[pos.x, pos.y]];
      for (const [cx, cy] of attempts) {
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
        const els = document.elementsFromPoint(cx, cy) || [];
        for (const el of els) {
          const tr = el?.closest?.("tr[data-id]");
          if (tr && this.tableView.tbody?.contains(tr)) return tr.dataset.id;
        }
      }
      return null;
    };

    try {
      await ev.listen("tauri://drag-enter", (e) => {
        const valid = ok(e.payload?.paths);
        draggingValidFiles = valid.length > 0;
        draggingSingleFile = valid.length === 1;
        if (window._activeProofPicker?.isOpen?.()) {
          window._activeProofPicker.setDragOver(draggingValidFiles);
          return;
        }
        const rowId = draggingSingleFile ? findHoveredRowId(e.payload?.position) : null;
        this.tableView.setDropTarget(rowId);
        overlay.classList.toggle("on", draggingValidFiles && !rowId);
      });
      await ev.listen("tauri://drag-over", (e) => {
        if (!draggingValidFiles) return;
        if (window._activeProofPicker?.isOpen?.()) {
          window._activeProofPicker.setDragOver(true);
          return;
        }
        const rowId = draggingSingleFile ? findHoveredRowId(e.payload?.position) : null;
        this.tableView.setDropTarget(rowId);
        overlay.classList.toggle("on", !rowId);
      });
      await ev.listen("tauri://drag-leave", () => {
        draggingValidFiles = false;
        draggingSingleFile = false;
        if (window._activeProofPicker?.isOpen?.()) {
          window._activeProofPicker.setDragOver(false);
          return;
        }
        overlay.classList.remove("on");
        this.tableView.setDropTarget(null);
      });
      await ev.listen("tauri://drag-drop", async (e) => {
        if (window._activeProofPicker?.isOpen?.()) {
          window._activeProofPicker.setDragOver(false);
          draggingValidFiles = false;
          draggingSingleFile = false;
          overlay.classList.remove("on");
          const files = ok(e.payload?.paths);
          if (files.length > 0) {
            await window._activeProofPicker.handleDroppedFiles(files);
          }
          return;
        }

        const droppedRowId =
          findHoveredRowId(e.payload?.position) ??
          (window._hoveredRecordId != null ? String(window._hoveredRecordId) : null);
        draggingValidFiles = false;
        draggingSingleFile = false;
        overlay.classList.remove("on");
        this.tableView.setDropTarget(null);

        const files = ok(e.payload?.paths);
        if (!files.length) return showToast("Arraste um PDF ou imagem", "info", 2500);

        if (
          files.length === 1 &&
          droppedRowId != null &&
          this.view === "records" &&
          this.recordModal.overlay.style.display !== "flex"
        ) {
          const rec =
            this.tableView.records.find((r) => String(r.id) === String(droppedRowId)) ||
            this.allRecords.find((r) => String(r.id) === String(droppedRowId));
          if (rec) {
            await this.attachDroppedFileToRecord(rec, files[0]);
            return;
          }
        }

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
    if (this.homeContainer) this.homeContainer.style.display = view === "home" ? "flex" : "none";
    this.tableContainer.style.display = isRecords ? "flex" : "none";
    this.subfoldersContainer.style.display = view === "subpastas" ? "flex" : "none";
    this.chartsContainer.style.display = view === "graficos" ? "block" : "none";
    this.settingsContainer.style.display = view === "configuracoes" ? "flex" : "none";
    this.toolsContainer.style.display = view === "ferramentas" ? "block" : "none";
    this.aboutContainer.style.display = view === "sobre" ? "block" : "none";
    // transição suave entre telas
    const shown = { home: this.homeContainer, records: this.tableContainer, subpastas: this.subfoldersContainer, graficos: this.chartsContainer, configuracoes: this.settingsContainer, ferramentas: this.toolsContainer, sobre: this.aboutContainer }[view];
    if (shown) {
      shown.classList.remove("view-enter");
      void shown.offsetWidth;
      shown.classList.add("view-enter");
    }
    const hasRecordsUI = isRecords;
    if (this.topbarCenter) this.topbarCenter.style.visibility = hasRecordsUI ? "visible" : "hidden";
    this.btnNewRecord.style.display = hasRecordsUI || view === "subpastas" ? "" : "none";
    document.querySelectorAll(".nav-item").forEach((el) => {
      const c = el.dataset.category;
      el.classList.toggle("active", isRecords ? c === this.currentCategory : c === view);
    });
  }

  async showHome() {
    this.setView("home");
    this.viewTitle.textContent = "Início";
    this.viewSubtitle.textContent = "Visão geral do currículo, atalhos rápidos e acesso à Plataforma Lattes";
    await this.homeView.show();
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
    let savedOverrides = readSavedCategoryOverrides();
    try {
      const remoteOv = await api.getSetting("options.category_overrides");
      if (remoteOv !== null && remoteOv !== undefined) {
        const parsed = typeof remoteOv === "string" ? JSON.parse(remoteOv) : remoteOv;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          savedOverrides = writeSavedCategoryOverrides(parsed);
        }
      }
    } catch {}
    applyCategoryOverrides(savedOverrides);

    let savedOrder = readSavedCategoryOrder();
    try {
      const remoteOrder = await api.getDropdownOptions("category_order");
      if (Array.isArray(remoteOrder) && remoteOrder.length) {
        const mapped = remoteOrder
          .map((k) => (k === "x_atuacao" ? "atuacao" : k))
          .filter((k) => typeof k === "string" && CATEGORY_SCHEMAS[k] && !CATEGORY_SCHEMAS[k]?.legacy);
        for (const def of DEFAULT_CATEGORY_ORDER) {
          if (!mapped.includes(def) && CATEGORY_SCHEMAS[def]) mapped.push(def);
        }
        savedOrder = mapped;
        writeSavedCategoryOrder(mapped);
      }
    } catch {}
    const orderedKeys = applyCategoryOrder(savedOrder);

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
    const itemsByCat = new Map([...ul.children].map((li) => [li.dataset.category, li]));
    for (const [key, li] of itemsByCat) {
      const s = CATEGORY_SCHEMAS[key];
      if (!s) continue;
      const ic = li.querySelector(".nav-icon");
      const lb = li.querySelector(".nav-label");
      if (ic) ic.textContent = s.icon || "🗂️";
      if (lb) lb.textContent = s.group || s.name || key;
    }
    for (const key of orderedKeys) {
      const li = itemsByCat.get(key);
      if (li) ul.appendChild(li);
    }
    for (const [key, li] of itemsByCat) {
      if (CATEGORY_SCHEMAS[key]?.legacy || !orderedKeys.includes(key)) {
        li.remove();
      }
    }
    const sel = document.getElementById("subfolder-group-select");
    if (sel) {
      sel.querySelectorAll("[data-custom]").forEach((o) => o.remove());
      for (const s of Object.values(CATEGORY_SCHEMAS)) {
        if (s.custom) continue;
        const dbG = (s.dbGroup || s.group || "").toLowerCase();
        const opt = [...sel.options].find((o) => !o.dataset.custom && o.value.toLowerCase() === dbG);
        if (opt) opt.textContent = s.group || s.name || opt.value;
      }
      for (const c of list) sel.insertAdjacentHTML("beforeend", `<option data-custom="1" value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`);
    }
    if (this.view === "records" && CATEGORY_SCHEMAS[this.currentCategory] == null) await this.switchCategory("producoes");
    else if (this.view === "records" && CATEGORY_SCHEMAS[this.currentCategory]) {
      const cur = CATEGORY_SCHEMAS[this.currentCategory];
      this.viewTitle.textContent = cur.name;
      this.viewSubtitle.textContent = cur.subtitle || "";
    }
    this.setView(this.view);
    if (this.stats) this.updateSidebarStats(this.stats);
  }

  showSettings() {
    this.setView("configuracoes");
    this.viewTitle.textContent = "Configurações";
    this.viewSubtitle.textContent = "Aparência, pasta de dados e opções dos campos de cada categoria";
    this.settingsView.setData(this.mappings, this.qualis, this.stats);
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
    await this.showHome();
  }

  bindEvents() {
    // Home (Sidebar + Marca)
    document.getElementById("nav-home")?.addEventListener("click", () => this.showHome());
    document.querySelector(".sidebar-header .brand")?.addEventListener("click", () => this.showHome());

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
    document.getElementById("btn-preview-comprovantes")?.addEventListener("click", () => this.previewCategoryProofs());
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
        this.filterBar.setSearch(val, { triggerSearch: true });
        this.filterBar.render();
        this.renderTable();
      }, 150);
    });

    this.btnClearSearch.addEventListener("click", () => {
      clearTimeout(this.searchDebounceTimer);
      this.inputSearch.value = "";
      this.btnClearSearch.style.display = "none";
      this.filterBar.setSearch("", { triggerSearch: true });
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

    // Filtro de link (DOI ou URL), independente do comprovante
    this.segLink.querySelectorAll("[data-link]").forEach((b) =>
      b.addEventListener("click", () => {
        this.filterBar.link = b.dataset.link;
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
      document.addEventListener("keydown", async (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === "k") {
          e.preventDefault();
          if (this.view !== "records") {
            await this.switchCategory(this.currentCategory || "producoes");
          }
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

  syncProfileMode(mode = this.profilePanel?.mode || "both") {
    const isDadosGerais = this.view === "records" && this.currentCategory === "dadosgerais";
    this.tableContainer.classList.remove("pf-mode-both", "pf-mode-records", "pf-mode-profile");
    if (isDadosGerais) {
      this.tableContainer.classList.add(`pf-mode-${mode}`);
    }
  }

  async switchCategory(category) {
    const isDadosGerais = category === "dadosgerais";
    this.currentCategory = category;
    this.setView("records");
    this.tableContainer.classList.remove("profile-only");
    this.tableContainer.classList.toggle("with-profile", isDadosGerais);
    this.btnNewRecord.innerHTML = `<span>+</span> Novo Registro`;
    const addDoi = document.getElementById("btn-add-doi");
    if (addDoi) addDoi.style.display = category === "producoes" ? "" : "none";

    const schema = CATEGORY_SCHEMAS[category];
    if (schema) {
      this.viewTitle.textContent = schema.name;
      this.viewSubtitle.textContent = schema.subtitle;
    }
    if (isDadosGerais) {
      await this.profilePanel.show();
      this.syncProfileMode(this.profilePanel.mode);
      this.tableContainer.scrollTop = 0;
    } else {
      this.profilePanel.hide();
      this.syncProfileMode("both");
    }
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
      const schema = CATEGORY_SCHEMAS[cat];
      const groupName = (schema?.dbGroup || GROUP_BY_CATEGORY[cat] || schema?.group || "").toLowerCase();
      const defaultTipos = [
        ...this.mappings
          .filter((m) => m.category_group?.toLowerCase() === groupName)
          .map((m) => m.description),
        ...(cat === "dadosgerais" ? DEFAULT_DADOS_GERAIS_MAPPINGS.map((d) => d.description) : []),
        ...(cat === "atuacao" ? DEFAULT_ATUACAO_MAPPINGS.map((d) => d.description) : []),
      ];
      this.filterBar.setRecords(cat, this.allRecords, defaultTipos);
      if (cat === "dadosgerais") {
        this.profilePanel.setRecordsCount(this.allRecords.length);
      }
      this.renderTable();
      if (String(this.filterBar.search || "").trim().length >= 3) {
        this.updateCrossCategoryHints(this.filterBar.search.trim());
      } else {
        this.filterBar.setCrossCategoryHints([]);
      }
    } catch (err) {
      console.error("Falha ao carregar registros:", err);
      showToast(`Erro ao carregar registros: ${err}`, "error");
      this.tableView.render(cat, []);
    } finally {
      this.tableView.setLoading(false);
    }
  }

  scheduleCrossCategoryHints(searchText = this.filterBar.search) {
    clearTimeout(this.crossHintTimer);
    const q = String(searchText || "").trim();
    if (q.length < 3 || this.view !== "records") {
      this.crossHintReqId++;
      this.filterBar.setCrossCategoryHints([]);
      return;
    }
    this.crossHintTimer = setTimeout(() => {
      this.updateCrossCategoryHints(q);
    }, 250);
  }

  async updateCrossCategoryHints(q) {
    const reqId = ++this.crossHintReqId;
    const current = String(this.filterBar.search || "").trim();
    if (current.length < 3 || current !== q || this.view !== "records") {
      this.filterBar.setCrossCategoryHints([]);
      return;
    }
    try {
      const allByCat = await api.getAllRecords();
      if (reqId !== this.crossHintReqId) return;
      if (!allByCat || typeof allByCat !== "object") {
        this.filterBar.setCrossCategoryHints([]);
        return;
      }
      const hints = [];
      for (const [cat, recs] of Object.entries(allByCat)) {
        if (cat === this.currentCategory || !Array.isArray(recs)) continue;
        let count = 0;
        for (const r of recs) {
          if (matchesSearch(r, q)) count++;
        }
        if (count > 0) {
          const label = GROUP_BY_CATEGORY[cat] || CATEGORY_SCHEMAS[cat]?.name || cat;
          hints.push({ category: cat, label, count });
        }
      }
      hints.sort((a, b) => b.count - a.count);
      this.filterBar.setCrossCategoryHints(hints);
    } catch (err) {
      if (reqId === this.crossHintReqId) {
        console.warn("Falha ao consultar busca entre categorias:", err);
        this.filterBar.setCrossCategoryHints([]);
      }
    }
  }

  async switchCategoryFromHint(category) {
    if (!category || category === this.currentCategory) return;
    await this.switchCategory(category);
  }

  /** Aplica busca + pílulas aos registros carregados e redesenha a tabela. */
  renderTable() {
    this.records = this.filterBar.filtered();
    this.segComp.querySelectorAll("[data-comp]").forEach((b) => b.classList.toggle("on", b.dataset.comp === this.filterBar.comp));
    this.segLink.querySelectorAll("[data-link]").forEach((b) => b.classList.toggle("on", b.dataset.link === this.filterBar.link));
    if (!this.filterBar.search && this.inputSearch.value) {
      this.inputSearch.value = "";
      this.btnClearSearch.style.display = "none";
    }
    this.tableView.render(this.currentCategory, this.records, this.allRecords.length);
  }

  async loadMappings() {
    try {
      this.mappings = await api.getSubfolderMappings();
      await this.seedDadosGeraisMappings();
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

  async seedDadosGeraisMappings() {
    const SEED_KEY = "lattes_seeded_default_mappings_v2";
    try {
      if (localStorage.getItem(SEED_KEY) === "1" || this._seedingDefaultMappings) return;
    } catch {
      if (this._seedingDefaultMappings) return;
    }
    this._seedingDefaultMappings = true;
    try {
      const fold = (s) =>
        String(s || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .toLowerCase();
      let added = false;

      // Seed Dados gerais
      const existingDG = new Set(
        this.mappings
          .filter((m) => fold(m.category_group) === "dados gerais")
          .map((m) => fold(m.description))
      );
      for (const item of DEFAULT_DADOS_GERAIS_MAPPINGS) {
        if (!existingDG.has(fold(item.description))) {
          await api.addSubfolderMapping("Dados gerais", item.description, item.folder);
          existingDG.add(fold(item.description));
          added = true;
        }
      }

      // Seed Atuação
      const existingAtu = new Set(
        this.mappings
          .filter((m) => fold(m.category_group) === "atuacao")
          .map((m) => fold(m.description))
      );
      for (const item of DEFAULT_ATUACAO_MAPPINGS) {
        if (!existingAtu.has(fold(item.description))) {
          await api.addSubfolderMapping("Atuação", item.description, item.folder);
          existingAtu.add(fold(item.description));
          added = true;
        }
      }

      if (added) {
        this.mappings = await api.getSubfolderMappings();
      }
      try {
        localStorage.setItem(SEED_KEY, "1");
      } catch {}
    } catch (err) {
      console.warn("Falha no seed de subcategorias padrão:", err);
    } finally {
      this._seedingDefaultMappings = false;
    }
  }

  async loadStats() {
    try {
      this.stats = await api.getAppStats();
      if (!this.stats) return;
      this.updateSidebarStats(this.stats);
    } catch (err) {
      console.error("Falha ao carregar estatísticas:", err);
    }
  }

  updateSidebarStats(stats) {
    if (!stats) return;
    const counts = stats.counts_by_category || {};
    const withFileMap = stats.with_file_by_category;
    const hasCoverageMap = Boolean(withFileMap && typeof withFileMap === "object");

    document.querySelectorAll("#nav-category-list .nav-item[data-category]").forEach((navItem) => {
      const cat = navItem.dataset.category;
      const badge = document.getElementById(`badge-${cat}`);
      if (!badge) return;

      const total = Number(counts[cat] ?? badge.textContent ?? 0);
      const rawWithFile = hasCoverageMap ? withFileMap[cat] : undefined;
      const hasCatCoverage = rawWithFile != null && Number.isFinite(Number(rawWithFile));
      const withFile = hasCatCoverage ? Math.max(0, Math.min(total, Number(rawWithFile))) : 0;

      badge.classList.remove("badge-complete", "badge-partial");
      badge.closest(".nav-link")?.querySelector(".nav-coverage")?.remove();
      badge.textContent = String(total);

      if (hasCatCoverage && total > 0) {
        const pct = Math.round((withFile / total) * 100);
        const tip = `${withFile} de ${total} com comprovante (${pct}%)`;
        badge.title = tip;
        navItem.title = tip;
      } else {
        badge.removeAttribute("title");
        navItem.removeAttribute("title");
      }
    });

    const badgeSubfolders = document.getElementById("badge-subfolders");
    if (badgeSubfolders && stats.total_mappings != null) {
      badgeSubfolders.textContent = String(stats.total_mappings);
    }
  }

  ensureBatchEditModal() {
    if (this._batchEditModal) return this._batchEditModal;
    const overlay = document.createElement("div");
    overlay.id = "batch-edit-modal-overlay";
    overlay.className = "modal-overlay";
    overlay.style.display = "none";
    overlay.innerHTML = `
      <div class="modal-dialog modal-dialog-sm">
        <header class="modal-header">
          <h3 class="modal-title">Alterar Registros em Lote</h3>
          <button type="button" class="btn-close-modal" data-batch-close>&times;</button>
        </header>
        <form id="batch-edit-form" class="modal-form">
          <div class="modal-body">
            <div class="batch-hint" id="batch-edit-hint"></div>
            <div class="batch-form-grid" id="batch-edit-fields"></div>
          </div>
          <footer class="modal-footer">
            <button type="button" class="btn btn-secondary" data-batch-close>Cancelar</button>
            <button type="submit" class="btn btn-primary" id="btn-confirm-batch-edit">Aplicar Alterações</button>
          </footer>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => {
      overlay.style.display = "none";
      this._batchEditTargetRecords = [];
    };
    overlay.querySelectorAll("[data-batch-close]").forEach((b) => b.addEventListener("click", close));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay && easyClose()) close();
    });
    overlay.querySelector("#batch-edit-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleConfirmBatchEdit();
    });

    this._batchEditModal = { overlay, close };
    return this._batchEditModal;
  }

  openProofPickerFor(records) {
    if (!records?.length) return;
    new ProofPickerModal({
      currentCategory: this.currentCategory,
      records,
      previewer: this.previewer,
      onSelect: () => {
        this.loadRecords();
        this.loadStats();
      },
    }).open();
  }

  openCreateRecordWithData(category, initialData = {}, onSaved = null) {
    if (onSaved) {
      const origOnSaved = this.recordModal.onSaved;
      this.recordModal.onSaved = async () => {
        this.recordModal.onSaved = origOnSaved;
        if (typeof origOnSaved === "function") await origOnSaved();
        onSaved();
      };
    }
    this.recordModal.openCreateWithData(category, initialData, this.mappings);
  }

  async bulkDuplicateRecords(records) {
    if (!records?.length) return;
    const cat = this.currentCategory;
    const count = records.length;
    if (!window.confirm(`Deseja duplicar ${count} registro(s) selecionado(s) em ${cat}?`)) return;
    try {
      this.tableView.setBulkBusy(true, `Duplicando ${count} registro(s)...`);
      for (const rec of records) {
        const copyData = { ...rec };
        delete copyData.id;
        delete copyData.log;
        await api.createRecord(cat, copyData, null);
      }
      showToast(`${count} registro(s) duplicado(s) com sucesso!`, "success", 3500);
      await Promise.all([this.loadRecords(), this.loadStats()]);
    } catch (err) {
      showToast(`Erro ao duplicar em lote: ${err}`, "error");
    } finally {
      this.tableView.setBulkBusy(false);
    }
  }

  openBatchEditModal(records) {
    if (!records?.length) return;
    const modal = this.ensureBatchEditModal();
    this._batchEditTargetRecords = records.slice();
    const cat = this.currentCategory;
    const schema = CATEGORY_SCHEMAS[cat];

    const hintEl = modal.overlay.querySelector("#batch-edit-hint");
    hintEl.textContent = `Aplicando alteração em ${records.length} registro(s). Deixe um campo sem alteração para manter os valores individuais.`;

    const tipoField = schema?.fields?.find((f) => f.name === "tipo");
    const tipoOptions = [
      ...new Set([
        ...(tipoField?.options || []),
        ...this.allRecords.map((r) => r.tipo).filter(Boolean),
      ].filter((v) => String(v).trim() !== "")),
    ].sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));

    const qualisOptions = [
      ...new Set([
        ...this.qualis.filter(Boolean),
        ...DEFAULT_QUALIS.filter(Boolean),
      ]),
    ];

    const fieldsEl = modal.overlay.querySelector("#batch-edit-fields");
    fieldsEl.innerHTML = `
      <div class="batch-field">
        <label for="batch-edit-ano">Ano</label>
        <input type="number" id="batch-edit-ano" min="1900" max="2100" placeholder="Manter atual" />
      </div>
      <div class="batch-field">
        <label for="batch-edit-tipo">Tipo</label>
        ${tipoOptions.length > 0
        ? `<select id="batch-edit-tipo">
                <option value="">(Manter atual)</option>
                ${tipoOptions.map((opt) => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join("")}
              </select>`
        : `<input type="text" id="batch-edit-tipo" placeholder="Manter atual" />`
      }
      </div>
      ${cat === "producoes"
        ? `<div class="batch-field">
              <label for="batch-edit-qualis">Qualis</label>
              <select id="batch-edit-qualis">
                <option value="">(Manter atual)</option>
                ${qualisOptions.map((q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`).join("")}
              </select>
            </div>`
        : ""
      }
    `;

    modal.overlay.style.display = "flex";
  }

  async handleConfirmBatchEdit() {
    const records = this._batchEditTargetRecords || [];
    if (!records.length || !this._batchEditModal) return;

    const anoRaw = String(this._batchEditModal.overlay.querySelector("#batch-edit-ano")?.value || "").trim();
    const tipoRaw = String(this._batchEditModal.overlay.querySelector("#batch-edit-tipo")?.value || "").trim();
    const qualisRaw = String(this._batchEditModal.overlay.querySelector("#batch-edit-qualis")?.value || "").trim();

    const data = {};
    if (anoRaw !== "") {
      const anoNum = Number(anoRaw);
      if (!Number.isInteger(anoNum) || anoNum < 1900 || anoNum > 2100) {
        showToast("Informe um ano válido entre 1900 e 2100", "error");
        return;
      }
      data.ano = anoNum;
    }
    if (tipoRaw !== "") data.tipo = tipoRaw;
    if (this.currentCategory === "producoes" && qualisRaw !== "") data.qualis = qualisRaw;

    if (!Object.keys(data).length) {
      showToast("Selecione ou preencha ao menos um campo para alterar em lote", "info");
      return;
    }

    const btn = this._batchEditModal.overlay.querySelector("#btn-confirm-batch-edit");
    const cat = this.currentCategory;
    const ids = records.map((r) => r.id);

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Aplicando...";
      }
      if (typeof api.batchUpdateRecords === "function") {
        await api.batchUpdateRecords(cat, ids, data);
      } else {
        for (const r of records) {
          await api.updateRecord(cat, r.id, { ...data });
        }
      }
      showToast(`${ids.length} registro(s) atualizado(s) com sucesso`, "success");
      this._batchEditModal.close();
      this.tableView.clearSelection();
      await Promise.all([this.loadRecords(), this.loadStats()]);
    } catch (err) {
      console.error("Erro na alteração em lote:", err);
      showToast(`Erro ao alterar registros em lote: ${err}`, "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Aplicar Alterações";
      }
    }
  }

  async batchFetchPdfs(records) {
    if (this.currentCategory !== "producoes" || !records?.length) return;
    const targets = records.filter(
      (r) => !(r.path && String(r.path).trim()) && /^10\.\d{4,9}\//.test(String(r.identifier || "").trim())
    );
    if (!targets.length) {
      showToast("Nenhum registro selecionado possui DOI sem comprovante", "info");
      return;
    }

    let downloaded = 0;
    let notFound = 0;
    let failed = 0;
    this.tableView.setBulkBusy(true, `Buscando PDFs 0/${targets.length}...`);

    try {
      for (let i = 0; i < targets.length; i++) {
        const rec = targets[i];
        this.tableView.setBulkBusy(true, `Buscando PDF ${i + 1}/${targets.length}...`);
        const doi = String(rec.identifier).trim();
        try {
          const res = await api.resolveDoi(doi, true);
          if (res?.pdf_path) {
            const data = { identifier: doi };
            if (!rec.folder) {
              const m = this.mappings.find(
                (x) => x.category_group === "Produções" && x.description === rec.tipo
              );
              if (m) data.folder = m.folder;
            }
            await api.updateRecord("producoes", rec.id, data, res.pdf_path);
            downloaded++;
          } else {
            notFound++;
          }
        } catch (err) {
          console.warn(`Falha ao baixar PDF do DOI ${doi}:`, err);
          failed++;
        }
      }
    } finally {
      this.tableView.setBulkBusy(false, "");
    }

    await Promise.all([this.loadRecords(), this.loadStats()]);
    const parts = [`${downloaded} PDF(s) baixado(s)`];
    if (notFound) parts.push(`${notFound} sem acesso aberto`);
    if (failed) parts.push(`${failed} erro(s)`);
    showToast(parts.join(" • "), downloaded > 0 ? "success" : "info", 4500);
  }

  openDeleteConfirm(record) {
    this.pendingDeleteRecord = record;
    this.pendingDeleteRecords = null;
    const desc = record.titulo || record.descricao || record.disciplina || `Registro #${record.id}`;
    this.deleteModalMessage.textContent = `Tem certeza que deseja excluir '${desc}' (ID: ${record.id})?`;
    this.btnConfirmDelete.textContent = "Excluir Registro";

    if (this.deleteFileOptionLabel) {
      this.deleteFileOptionLabel.textContent = "Excluir também o arquivo comprovante do disco";
    }
    if (record.path) {
      this.deleteFileOption.style.display = "block";
      this.chkDeletePhysicalFile.checked = false;
    } else {
      this.deleteFileOption.style.display = "none";
      this.chkDeletePhysicalFile.checked = false;
    }

    this.deleteModalOverlay.style.display = "flex";
  }

  openBatchDeleteConfirm(records) {
    if (!records?.length) return;
    this.pendingDeleteRecord = null;
    this.pendingDeleteRecords = records.slice();
    const withFiles = records.filter((r) => Boolean(r.path && String(r.path).trim())).length;

    this.deleteModalMessage.textContent = `Tem certeza que deseja excluir ${records.length} registro(s) selecionado(s)?`;
    this.btnConfirmDelete.textContent = `Excluir (${records.length})`;

    if (withFiles > 0) {
      if (this.deleteFileOptionLabel) {
        this.deleteFileOptionLabel.textContent = `Também apagar arquivos PDF vinculados? (${withFiles} arquivo(s))`;
      }
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
    this.pendingDeleteRecords = null;
  }

  async handleConfirmDelete() {
    const deleteFile = this.chkDeletePhysicalFile.checked;

    if (this.pendingDeleteRecords?.length) {
      const records = this.pendingDeleteRecords.slice();
      const ids = records.map((r) => r.id);
      const cat = this.currentCategory;
      try {
        this.btnConfirmDelete.disabled = true;
        this.btnConfirmDelete.textContent = "Excluindo...";

        if (typeof api.batchDeleteRecords === "function") {
          await api.batchDeleteRecords(cat, ids, deleteFile);
        } else {
          for (const r of records) {
            await api.deleteRecord(cat, r.id, deleteFile);
          }
        }
        showToast(
          deleteFile
            ? `${ids.length} registro(s) e arquivos vinculados excluídos`
            : `${ids.length} registro(s) excluído(s) do banco de dados`,
          "success"
        );
        this.closeDeleteModal();
        this.tableView.clearSelection();
        await Promise.all([this.loadRecords(), this.loadStats()]);
      } catch (err) {
        console.error("Erro na exclusão em lote:", err);
        showToast(`Erro ao excluir selecionados: ${err}`, "error");
      } finally {
        this.btnConfirmDelete.disabled = false;
        this.btnConfirmDelete.textContent = "Excluir Registro";
      }
      return;
    }

    if (!this.pendingDeleteRecord) return;

    const id = this.pendingDeleteRecord.id;

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
