// Table Component: Renders Dynamic Record Tables for all 10 Categories

import { CATEGORY_SCHEMAS, escapeHtml } from "../utils.js";

const QUALIS_ORDER = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "B5", "C", "SQ"];
const NUMERIC = new Set(["id", "ano", "horas", "alunos"]);
// direção inicial ao clicar: números/datas começam do maior; textos e Qualis do "melhor"/A→Z
const FIRST_DIR = { id: "desc", ano: "desc", horas: "desc", alunos: "desc", log: "desc", file: "desc" };
const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

function sortValue(key, r) {
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
      if (a.v != null && b.v != null) c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : collator.compare(String(a.v), String(b.v));
      if (c) return c * sign;
      return (b.r.ano || 0) - (a.r.ano || 0) || (b.r.id || 0) - (a.r.id || 0) || a.i - b.i;
    })
    .map((x) => x.r);
}

export class TableView {
  constructor({ onEdit, onDelete, onPreview, onReveal, onFetchPdf, onOpenDoi }) {
    this.onFetchPdf = onFetchPdf;
    this.onOpenDoi = onOpenDoi;
    this.busy = new Set();
    this.thead = document.getElementById("records-thead");
    this.tbody = document.getElementById("records-tbody");
    this.emptyState = document.getElementById("table-empty-state");
    this.loadingState = document.getElementById("table-loading-state");
    this.countDisplayed = document.getElementById("count-displayed");
    this.countTotal = document.getElementById("count-total");

    this.onEdit = onEdit;
    this.onDelete = onDelete;
    this.onPreview = onPreview;
    this.onReveal = onReveal;

    this.currentCategory = null;
    this.records = [];
    this.raw = [];
    this.lastTotal = null;

    // clique no cabeçalho ordena
    this.thead.addEventListener("click", (e) => {
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
      if (e.target.closest("button")) return;
      const tr = e.target.closest("tr[data-id]");
      const rec = tr && this.records.find((r) => String(r.id) === tr.dataset.id);
      if (rec && this.onEdit) this.onEdit(rec);
    });
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

  render(category, records, totalCategoryCount = null) {
    this.currentCategory = category;
    this.raw = records || [];
    this.lastTotal = totalCategoryCount;
    const sort = this.getSort(category);
    this.records = sortRecords(this.raw, sort);

    const schema = CATEGORY_SCHEMAS[category];
    if (!schema) {
      console.error(`Schema não encontrado para categoria: ${category}`);
      return;
    }

    // Render Headers
    let theadHtml = "<tr>";
    for (const col of schema.columns) {
      const style = col.width ? `style="width:${col.width};"` : "";
      const on = sort.key === col.key;
      const arrow = on ? (sort.dir === "asc" ? "▲" : "▼") : "↕";
      theadHtml += `<th ${style} data-sort="${col.key}" class="sortable ${on ? "sorted" : ""} col-${col.key} ${col.width ? "" : "col-main"}" title="Ordenar por ${escapeHtml(col.label)}">${escapeHtml(col.label)}<span class="sort-ind">${arrow}</span></th>`;
    }
    const isProd = category === "producoes";
    theadHtml += `<th style="width: ${isProd ? 186 : 150}px; text-align: right;">Ações</th></tr>`;
    this.thead.innerHTML = theadHtml;

    // Render Rows or Empty State
    if (this.records.length === 0) {
      this.tbody.innerHTML = "";
      this.emptyState.style.display = "flex";
      this.countDisplayed.textContent = "0";
      this.countTotal.textContent = totalCategoryCount != null ? String(totalCategoryCount) : "0";
      return;
    }

    this.emptyState.style.display = "none";

    let tbodyHtml = "";
    for (const rec of this.records) {
      tbodyHtml += `<tr data-id="${rec.id}">`;
      for (const col of schema.columns) {
        const val = col.render ? col.render(rec) : escapeHtml(rec[col.key] || "—");
        tbodyHtml += `<td class="col-${col.key} ${col.width ? "" : "col-main"}">${val}</td>`;
      }

      // Actions Cell
      const hasFile = Boolean(rec.path && rec.path.trim());
      const doi = /^10\.\d{4,9}\//.test(String(rec.identifier || "").trim()) ? String(rec.identifier).trim() : "";
      const busy = this.busy?.has(rec.id);
      // ⚡ só onde costuma haver DOI (artigos, capítulos, livros, resumos em anais)
      const doiLike = doi || /artigo|cap[ií]tulo|livro|resumo|trabalhos completos/i.test(String(rec.tipo || ""));
      const fetchBtn = isProd && !hasFile && doiLike
        ? `<button type="button" class="ibtn ibtn-accent ${busy ? "spin" : ""}" data-action="fetchpdf" data-id="${rec.id}" ${busy ? "disabled" : ""} title="${doi ? "Resolver o DOI e baixar o PDF de acesso aberto" : "Procurar o DOI pelo título e baixar o PDF de acesso aberto"}">${busy ? "⏳" : "⚡"}</button><span class="ibtn-gap"></span>`
        : "";
      const doiBtn = isProd
        ? doi
          ? `<button type="button" class="ibtn" data-action="opendoi" data-id="${rec.id}" title="Abrir ${escapeHtml(doi)} em doi.org">🌐</button>`
          : `<span class="ibtn-gap"></span>`
        : "";
      tbodyHtml += `
        <td style="text-align: right;">
          <div class="cell-actions" style="justify-content: flex-end;">
            ${
              fetchBtn ||
              (hasFile
                ? `<button type="button" class="ibtn ibtn-primary" data-action="preview" data-id="${rec.id}" title="Visualizar comprovante">👁</button>
                   <button type="button" class="ibtn" data-action="reveal" data-id="${rec.id}" title="Mostrar na pasta (Explorer)">📂</button>`
                : `<span class="ibtn-gap"></span><span class="ibtn-gap"></span>`)
            }
            ${doiBtn}
            <button type="button" class="ibtn" data-action="edit" data-id="${rec.id}" title="Editar registro (ou duplo clique na linha)">✏️</button>
            <button type="button" class="ibtn ibtn-danger" data-action="delete" data-id="${rec.id}" title="Excluir registro">🗑</button>
          </div>
        </td>
      </tr>`;
    }

    this.tbody.innerHTML = tbodyHtml;
    this.countDisplayed.textContent = String(this.records.length);
    this.countTotal.textContent = totalCategoryCount != null ? String(totalCategoryCount) : String(this.records.length);
  }

  handleRowClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    const record = this.records.find((r) => r.id === id);
    if (!record) return;

    switch (action) {
      case "preview":
        if (this.onPreview) this.onPreview(record);
        break;
      case "reveal":
        if (this.onReveal) this.onReveal(record);
        break;
      case "edit":
        if (this.onEdit) this.onEdit(record);
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
    }
  }
}
