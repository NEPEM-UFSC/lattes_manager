// Table Component: Renders Dynamic Record Tables for all 10 Categories + Bulk Selection & Row Drop Target

import { api } from "../api.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../utils.js";
import { withMetricColumns, metricSortValue, loadMetrics, metricsLoaded, isExpanded, setExpanded } from "../journalMetrics.js";

const QUALIS_ORDER = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "B5", "C", "SQ"];
const NUMERIC = new Set(["id", "ano", "horas", "alunos", "citations"]);
// direção inicial ao clicar: números/datas começam do maior; textos e Qualis do "melhor"/A→Z
const FIRST_DIR = { id: "desc", ano: "desc", horas: "desc", alunos: "desc", log: "desc", file: "desc", citations: "desc", m_resumo: "desc", m_percentil: "desc", m_citescore: "desc", m_sjr: "desc", m_snip: "desc" };
const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
const DOI_RE = /^10\.\d{4,9}\//;

function sortValue(key, r) {
  if (key.startsWith("m_")) return metricSortValue(key, r);
  if (NUMERIC.has(key)) return r[key] == null || r[key] === "" ? null : Number(r[key]);
  if (key === "qualis") {
    const q = String(r.qualis || "").trim().toUpperCase();
    if (!q) return null;
    const i = QUALIS_ORDER.indexOf(q);
    return i < 0 ? 50 : i;
  }
  if (key === "file") return r.path && String(r.path).trim() ? 1 : 0;
  if (key === "log") {
    const m = String(r.log || "").match(/\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?/);
    return m ? m[0] : null;
  }
  const v = r[key];
  return v == null || String(v).trim() === "" ? null : String(v);
}

/** Ordena uma cópia; vazios sempre no fim; desempate por ano ↓ e id ↓. */
export function sortRecords(records, { key, dir }) {
  const sign = dir === "asc" ? 1 : -1;
  return records
    .map((r, i) => ({ r, i, v: sortValue(key, r) }))
    .sort((a, b) => {
      if (a.v == null && b.v != null) return 1;
      if (b.v == null && a.v != null) return -1;
      let c = 0;
      if (a.v != null && b.v != null) {
        c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      }
      if (c) return c * sign;
      return (b.r.ano || 0) - (a.r.ano || 0) || (b.r.id || 0) - (a.r.id || 0) || a.i - b.i;
    })
    .map((x) => x.r);
}

export class TableView {
  constructor({
    onEdit,
    onDuplicate = null,
    onDelete,
    onPreview,
    onReveal,
    onFetchPdf,
    onOpenDoi,
    onLinkProof = null,
    onBulkLinkProof = null,
    onBulkDuplicate = null,
    onBulkEdit = null,
    onBulkDelete = null,
    onBulkFetchPdfs = null,
    onFileDropOnRow = null,
  }) {
    this.onEdit = onEdit;
    this.onDuplicate = onDuplicate;
    this.onDelete = onDelete;
    this.onPreview = onPreview;
    this.onReveal = onReveal;
    this.onFetchPdf = onFetchPdf;
    this.onOpenDoi = onOpenDoi;
    this.onLinkProof = onLinkProof;
    this.onBulkLinkProof = onBulkLinkProof;
    this.onBulkDuplicate = onBulkDuplicate;
    this.onBulkEdit = onBulkEdit;
    this.onBulkDelete = onBulkDelete;
    this.onBulkFetchPdfs = onBulkFetchPdfs;
    this.onFileDropOnRow = onFileDropOnRow;

    this.busy = new Set();
    this.selectedIds = new Set();
    this.lastClickedId = null;
    this.bulkBusy = false;
    this.bulkStatus = "";
    this.dropTargetId = null;
    window._hoveredRecordId = null;

    this.thead = document.getElementById("records-thead");
    this.tbody = document.getElementById("records-tbody");
    this.emptyState = document.getElementById("table-empty-state");
    this.loadingState = document.getElementById("table-loading-state");
    this.countDisplayed = document.getElementById("count-displayed");
    this.countTotal = document.getElementById("count-total");
    this.bulkBar = null;

    this.onEdit = onEdit;
    this.onDelete = onDelete;
    this.onPreview = onPreview;
    this.onReveal = onReveal;

    this.currentCategory = null;
    this.records = [];
    this.raw = [];
    this.lastTotal = null;

    this.ensureBulkBar();

    // clique no cabeçalho ordena ou alterna seleção global
    this.thead.addEventListener("click", (e) => {
      const selAll = e.target.closest(".row-select-all");
      if (selAll) {
        this.toggleSelectAll(selAll.checked);
        return;
      }
      if (e.target.closest("th.col-select")) return;
      if (e.target.closest("[data-mt-toggle]")) {
        setExpanded(!isExpanded());
        this.render(this.currentCategory, this.raw, this.lastTotal);
        return;
      }

      const th = e.target.closest("th[data-sort]");
      if (!th) return;
      const key = th.dataset.sort;
      const cur = this.getSort(this.currentCategory);
      const dir = cur.key === key ? (cur.dir === "asc" ? "desc" : "asc") : FIRST_DIR[key] || "asc";
      this.setSort(this.currentCategory, { key, dir });
      this.render(this.currentCategory, this.raw, this.lastTotal);
    });

    this.tbody.addEventListener("click", (e) => this.handleRowClick(e));
    // duplo clique na linha abre a edição
    this.tbody.addEventListener("dblclick", (e) => {
      if (e.target.closest("button, input, label, .col-select")) return;
      const tr = e.target.closest("tr[data-id]");
      const rec = tr && this.records.find((r) => String(r.id) === tr.dataset.id);
      if (rec && this.onEdit) this.onEdit(rec);
    });

    // HTML5 drag-and-drop fallback para realce de linha (complementa eventos nativos do Tauri)
    this.tbody.addEventListener("dragover", (e) => {
      const hasFiles = Array.from(e.dataTransfer?.types || []).includes("Files");
      if (!hasFiles) return;
      e.preventDefault();
      const tr = e.target.closest("tr[data-id]");
      this.setDropTarget(tr ? tr.dataset.id : null);
    });

    this.tbody.addEventListener("dragleave", (e) => {
      if (!this.tbody.contains(e.relatedTarget)) {
        this.setDropTarget(null);
      }
    });

    this.tbody.addEventListener("drop", (e) => {
      const tr = e.target.closest("tr[data-id]");
      const file = e.dataTransfer?.files?.[0];
      const filePath = file && typeof file.path === "string" ? file.path : null;
      this.setDropTarget(null);
      if (tr && filePath && this.onFileDropOnRow) {
        const rec = this.records.find((r) => String(r.id) === tr.dataset.id);
        if (rec) {
          e.preventDefault();
          e.stopPropagation();
          this.onFileDropOnRow(rec, filePath);
        }
      }
    });
  }

  ensureBulkBar() {
    if (this.bulkBar) return this.bulkBar;
    const bar = document.createElement("div");
    bar.id = "bulk-action-bar";
    bar.className = "bulk-action-bar hidden";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Ações em lote");
    const wrapper = this.tbody?.closest(".table-scroll-wrapper");
    if (wrapper && wrapper.parentElement) {
      wrapper.parentElement.insertBefore(bar, wrapper);
    } else {
      const table = this.thead?.closest("table");
      if (table && table.parentElement) table.parentElement.insertBefore(bar, table);
    }

    bar.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-bulk-action]");
      if (!btn || this.bulkBusy) return;
      const action = btn.dataset.bulkAction;
      const selected = this.getSelectedRecords();
      if (action === "clear") {
        this.clearSelection();
      } else if (action === "link-proof" && selected.length) {
        this.onBulkLinkProof?.(selected);
      } else if (action === "duplicate" && selected.length) {
        this.onBulkDuplicate?.(selected);
      } else if (action === "edit" && selected.length) {
        this.onBulkEdit?.(selected);
      } else if (action === "delete" && selected.length) {
        this.onBulkDelete?.(selected);
      } else if (action === "fetchpdfs" && selected.length) {
        this.onBulkFetchPdfs?.(selected);
      }
    });

    this.bulkBar = bar;
    return bar;
  }

  setLoading(isLoading) {
    if (isLoading) {
      this.loadingState.style.display = "flex";
      this.tbody.style.display = "none";
      this.emptyState.style.display = "none";
    } else {
      this.loadingState.style.display = "none";
      this.tbody.style.display = "";
    }
  }

  getSort(category) {
    try {
      const s = JSON.parse(localStorage.getItem(`lattes.sort.${category}`));
      if (s && s.key) return s;
    } catch {}
    return { key: "ano", dir: "desc" };
  }

  setSort(category, sort) {
    try {
      localStorage.setItem(`lattes.sort.${category}`, JSON.stringify(sort));
    } catch {}
  }

  getSelectedRecords() {
    if (!this.selectedIds.size) return [];
    return this.records.filter((r) => this.selectedIds.has(Number(r.id)));
  }

  clearSelection() {
    if (!this.selectedIds.size && this.lastClickedId == null) {
      this.renderBulkBar();
      return;
    }
    this.selectedIds.clear();
    this.lastClickedId = null;
    this.syncSelectionUI();
  }

  setBulkBusy(isBusy, statusText = "") {
    this.bulkBusy = Boolean(isBusy);
    this.bulkStatus = statusText || "";
    this.renderBulkBar();
  }

  setDropTarget(recordId) {
    const nextId = recordId != null && String(recordId) !== "" ? String(recordId) : null;
    if (this.dropTargetId === nextId) return;
    if (this.dropTargetId != null) {
      const prevRow = this.tbody?.querySelector(`tr[data-id="${CSS.escape(this.dropTargetId)}"]`);
      prevRow?.classList.remove("row-drop-target");
    }
    this.dropTargetId = nextId;
    window._hoveredRecordId = nextId != null ? Number(nextId) : null;
    if (nextId != null) {
      const nextRow = this.tbody?.querySelector(`tr[data-id="${CSS.escape(nextId)}"]`);
      nextRow?.classList.add("row-drop-target");
    }
  }

  toggleSelectAll(checked) {
    if (checked) {
      for (const rec of this.records) this.selectedIds.add(Number(rec.id));
    } else {
      for (const rec of this.records) this.selectedIds.delete(Number(rec.id));
    }
    this.lastClickedId = null;
    this.syncSelectionUI();
  }

  toggleRowSelection(id, checked, shiftKey = false) {
    const numId = Number(id);
    if (shiftKey && this.lastClickedId != null) {
      const fromIdx = this.records.findIndex((r) => Number(r.id) === this.lastClickedId);
      const toIdx = this.records.findIndex((r) => Number(r.id) === numId);
      if (fromIdx >= 0 && toIdx >= 0) {
        const start = Math.min(fromIdx, toIdx);
        const end = Math.max(fromIdx, toIdx);
        for (let i = start; i <= end; i++) {
          const rid = Number(this.records[i].id);
          if (checked) this.selectedIds.add(rid);
          else this.selectedIds.delete(rid);
        }
        this.lastClickedId = numId;
        this.syncSelectionUI();
        return;
      }
    }

    if (checked) this.selectedIds.add(numId);
    else this.selectedIds.delete(numId);
    this.lastClickedId = numId;
    this.syncSelectionUI();
  }

  syncSelectionUI() {
    this.tbody?.querySelectorAll("tr[data-id]").forEach((tr) => {
      const id = Number(tr.dataset.id);
      const selected = this.selectedIds.has(id);
      tr.classList.toggle("row-selected", selected);
      const chk = tr.querySelector(".row-select");
      if (chk && chk.checked !== selected) chk.checked = selected;
    });

    const headerChk = this.thead?.querySelector(".row-select-all");
    if (headerChk) {
      const total = this.records.length;
      const visibleSelected = this.records.reduce((n, r) => n + (this.selectedIds.has(Number(r.id)) ? 1 : 0), 0);
      headerChk.checked = total > 0 && visibleSelected === total;
      headerChk.indeterminate = visibleSelected > 0 && visibleSelected < total;
      headerChk.disabled = total === 0;
    }

    this.renderBulkBar();
  }

  renderBulkBar() {
    const bar = this.ensureBulkBar();
    const selected = this.getSelectedRecords();
    if (!selected.length) {
      bar.classList.add("hidden");
      bar.innerHTML = "";
      return;
    }

    const n = selected.length;
    const isProd = this.currentCategory === "producoes";
    const doiMissingCount = isProd
      ? selected.filter((r) => {
          const hasFile = Boolean(r.path && String(r.path).trim());
          const hasDoi = DOI_RE.test(String(r.identifier || "").trim());
          return !hasFile && hasDoi;
        }).length
      : 0;

    bar.classList.remove("hidden");
    bar.innerHTML = `
      <div class="bulk-summary">
        <span class="bulk-count">${n} ${n === 1 ? "selecionado" : "selecionados"}</span>
        ${this.bulkStatus ? `<span class="bulk-status">${escapeHtml(this.bulkStatus)}</span>` : ""}
      </div>
      <div class="bulk-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-bulk-action="duplicate" ${this.bulkBusy ? "disabled" : ""} title="Criar uma cópia dos registros selecionados">📋 Duplicar selecionados</button>
        <button type="button" class="btn btn-secondary btn-sm" data-bulk-action="link-proof" ${this.bulkBusy ? "disabled" : ""} title="Vincular o mesmo comprovante a todos os registros selecionados sem duplicar arquivo">🔗 Vincular mesmo comprovante...</button>
        <button type="button" class="btn btn-secondary btn-sm" data-bulk-action="edit" ${this.bulkBusy ? "disabled" : ""}>✏️ Alterar em lote</button>
        ${
          doiMissingCount > 0
            ? `<button type="button" class="btn btn-secondary btn-sm" data-bulk-action="fetchpdfs" ${this.bulkBusy ? "disabled" : ""}>⚡ Buscar PDFs por DOI (${doiMissingCount})</button>`
            : ""
        }
        <button type="button" class="btn btn-danger btn-sm" data-bulk-action="delete" ${this.bulkBusy ? "disabled" : ""}>🗑 Excluir selecionados</button>
        <button type="button" class="btn btn-secondary btn-sm" data-bulk-action="clear" ${this.bulkBusy ? "disabled" : ""}>✕ Limpar seleção</button>
      </div>
    `;
  }

  render(category, records, totalCategoryCount = null) {
    if (category !== this.currentCategory) {
      this.selectedIds.clear();
      this.lastClickedId = null;
      this.dropTargetId = null;
      window._hoveredRecordId = null;
    }

    this.currentCategory = category;
    this.raw = records || [];
    this.lastTotal = totalCategoryCount;
    const sort = this.getSort(category);
    this.records = sortRecords(this.raw, sort);

    const visibleIds = new Set(this.records.map((r) => Number(r.id)));
    for (const id of [...this.selectedIds]) {
      if (!visibleIds.has(id)) this.selectedIds.delete(id);
    }

    const schema = CATEGORY_SCHEMAS[category];
    if (!schema) {
      console.error(`Schema não encontrado para categoria: ${category}`);
      return;
    }

    const isProducoes = category === "producoes";
    const columns = isProducoes ? withMetricColumns(schema.columns) : schema.columns;
    // métricas da revista: recarrega quando os registros mudam (não ao só reordenar)
    if (isProducoes && (!metricsLoaded() || this._metricsRaw !== this.raw)) {
      this._metricsRaw = this.raw;
      loadMetrics().then(() => {
        if (this.currentCategory === "producoes" && this._metricsRaw === this.raw) {
          this.render(this.currentCategory, this.raw, this.lastTotal);
        }
      });
    }

    const visibleSelected = this.records.reduce((n, r) => n + (this.selectedIds.has(Number(r.id)) ? 1 : 0), 0);
    const allChecked = this.records.length > 0 && visibleSelected === this.records.length;

    // Render Headers
    let theadHtml = `<tr>
      <th class="col-select" title="Selecionar todos visíveis">
        <input type="checkbox" class="row-select-all" aria-label="Selecionar todos os registros visíveis" ${allChecked ? "checked" : ""} ${this.records.length ? "" : "disabled"} />
      </th>`;
    for (const col of columns) {
      const style = col.width ? `style="width:${col.width};"` : "";
      const on = sort.key === col.key;
      const arrow = on ? (sort.dir === "asc" ? "▲" : "▼") : "↕";
      const exp = isExpanded();
      const toggle = col.toggle
        ? `<button type="button" class="mt-toggle" data-mt-toggle aria-expanded="${exp}" title="${exp ? "Recolher as métricas da revista" : "Expandir as métricas da revista (Qualis, percentil, CiteScore, SJR, SNIP)"}">${exp ? "◂" : "▸"}</button>`
        : "";
      const title = col.hint ? `${col.hint}. Clique para ordenar.` : `Ordenar por ${col.label}`;
      theadHtml += `<th ${style} data-sort="${col.key}" class="sortable ${on ? "sorted" : ""} col-${col.key} ${col.width ? "" : "col-main"}${col.key.startsWith("m_") ? " col-metric" : ""}" title="${escapeHtml(title)}">${toggle}${escapeHtml(col.label)}<span class="sort-ind">${arrow}</span></th>`;
    }
    const isProd = category === "producoes";
    theadHtml += `<th class="col-actions" style="width: 1%; text-align: right;">Ações</th></tr>`;
    this.thead.innerHTML = theadHtml;

    const headerChk = this.thead.querySelector(".row-select-all");
    if (headerChk) {
      headerChk.indeterminate = visibleSelected > 0 && visibleSelected < this.records.length;
    }

    // Render Rows or Empty State
    if (this.records.length === 0) {
      this.tbody.innerHTML = "";
      this.emptyState.style.display = "flex";
      this.countDisplayed.textContent = "0";
      this.countTotal.textContent = totalCategoryCount != null ? String(totalCategoryCount) : "0";
      this.renderBulkBar();
      return;
    }

    this.emptyState.style.display = "none";

    const anyUrl = this.records.some((r) => Boolean(r.url));
    const anyDoi = isProd && this.records.some((r) => DOI_RE.test(String(r.identifier || "").trim()));
    const anyFileOrFetch = this.records.some((r) => {
      if (r.path && r.path.trim()) return true;
      if (!isProd) return false;
      const doi = DOI_RE.test(String(r.identifier || "").trim());
      return doi || /artigo|cap[ií]tulo|livro|resumo|trabalhos completos/i.test(String(r.tipo || ""));
    });

    let tbodyHtml = "";
    for (const rec of this.records) {
      const numId = Number(rec.id);
      const isSelected = this.selectedIds.has(numId);
      const isDropTarget = this.dropTargetId != null && String(rec.id) === this.dropTargetId;
      const rowClasses = [isSelected ? "row-selected" : "", isDropTarget ? "row-drop-target" : ""].filter(Boolean).join(" ");

      tbodyHtml += `<tr data-id="${rec.id}"${rowClasses ? ` class="${rowClasses}"` : ""}>`;
      tbodyHtml += `<td class="col-select"><input type="checkbox" class="row-select" data-id="${rec.id}" aria-label="Selecionar registro" ${isSelected ? "checked" : ""} /></td>`;
      for (const col of columns) {
        const val = col.render ? col.render(rec) : escapeHtml(rec[col.key] || "—");
        tbodyHtml += `<td class="col-${col.key} ${col.width ? "" : "col-main"}${col.key.startsWith("m_") ? " col-metric" : ""}">${val}</td>`;
      }

      // Actions Cell
      const hasFile = Boolean(rec.path && rec.path.trim());
      const doi = DOI_RE.test(String(rec.identifier || "").trim()) ? String(rec.identifier).trim() : "";
      const busy = this.busy?.has(rec.id);
      // ⚡ só onde costuma haver DOI (artigos, capítulos, livros, resumos em anais)
      const doiLike = doi || /artigo|cap[ií]tulo|livro|resumo|trabalhos completos/i.test(String(rec.tipo || ""));
      const fetchBtn = isProd && !hasFile && doiLike
        ? `<button type="button" class="ibtn ibtn-accent ${busy ? "spin" : ""}" data-action="fetchpdf" data-id="${rec.id}" ${busy ? "disabled" : ""} title="${doi ? "Resolver o DOI e baixar o PDF de acesso aberto" : "Procurar o DOI pelo título e baixar o PDF de acesso aberto"}">${busy ? "⏳" : "⚡"}</button>`
        : "";
      const fileCellHtml = fetchBtn
        ? fetchBtn
        : hasFile
          ? `<button type="button" class="ibtn ibtn-primary" data-action="preview" data-id="${rec.id}" title="Visualizar comprovante">👁</button>
             <button type="button" class="ibtn" data-action="reveal" data-id="${rec.id}" title="Mostrar na pasta (Explorer)">📂</button>`
          : `<button type="button" class="ibtn" data-action="link-proof" data-id="${rec.id}" title="Vincular a um comprovante existente (sem duplicar arquivo)">🔗</button>`;
      const doiBtn = anyDoi && doi
        ? `<button type="button" class="ibtn" data-action="opendoi" data-id="${rec.id}" title="Abrir ${escapeHtml(doi)} em doi.org">🌐</button>`
        : "";
      const urlBtn = anyUrl && rec.url
        ? `<button type="button" class="ibtn" data-action="openurl" data-id="${rec.id}" title="Abrir ${escapeHtml(rec.url)}">🔗</button>`
        : "";
      tbodyHtml += `
        <td class="col-actions" style="text-align: right;">
          <div class="cell-actions" style="justify-content: flex-end;">
            ${fileCellHtml}
            ${doiBtn}
            ${urlBtn}
            <button type="button" class="ibtn" data-action="duplicate" data-id="${rec.id}" title="Duplicar registro (criar cópia)">📋</button>
            <button type="button" class="ibtn" data-action="edit" data-id="${rec.id}" title="Editar registro (ou duplo clique na linha)">✏️</button>
            <button type="button" class="ibtn ibtn-danger" data-action="delete" data-id="${rec.id}" title="Excluir registro">🗑</button>
          </div>
        </td>
      </tr>`;
    }

    this.tbody.innerHTML = tbodyHtml;
    this.countDisplayed.textContent = String(this.records.length);
    this.countTotal.textContent = totalCategoryCount != null ? String(totalCategoryCount) : String(this.records.length);
    this.renderBulkBar();
  }

  handleRowClick(e) {
    const link = e.target.closest("[data-open-url]");
    if (link) {
      e.stopPropagation();
      api.openUrl(link.dataset.openUrl).catch((err) => showToast(`Erro ao abrir: ${err}`, "error"));
      return;
    }
    const chk = e.target.closest("input.row-select");
    if (chk) {
      this.toggleRowSelection(chk.dataset.id, chk.checked, e.shiftKey);
      return;
    }
    const selCell = e.target.closest("td.col-select");
    if (selCell) {
      const tr = selCell.closest("tr[data-id]");
      const rowChk = selCell.querySelector("input.row-select");
      if (tr && rowChk) {
        const nextChecked = !rowChk.checked;
        rowChk.checked = nextChecked;
        this.toggleRowSelection(tr.dataset.id, nextChecked, e.shiftKey);
      }
      return;
    }

    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    const record = this.records.find((r) => r.id === id);
    if (!record) return;

    switch (action) {
      case "link-proof":
        if (this.onLinkProof) this.onLinkProof([record]);
        break;
      case "preview":
        if (this.onPreview) this.onPreview(record);
        break;
      case "reveal":
        if (this.onReveal) this.onReveal(record);
        break;
      case "edit":
        if (this.onEdit) this.onEdit(record);
        break;
      case "duplicate":
        if (this.onDuplicate) this.onDuplicate(record);
        break;
      case "delete":
        if (this.onDelete) this.onDelete(record);
        break;
      case "fetchpdf":
        if (this.onFetchPdf) this.onFetchPdf(record);
        break;
      case "opendoi":
        if (this.onOpenDoi) this.onOpenDoi(record);
        break;
      case "openurl":
        api.openUrl(record.url).catch((err) => showToast(`Não foi possível abrir o link: ${err}`, "error"));
        break;
    }
  }
}
