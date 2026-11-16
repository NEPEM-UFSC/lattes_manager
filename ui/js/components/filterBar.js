// Barra de filtros compacta e retrátil + dicas de busca entre categorias.

import { escapeHtml, tipoColor } from "../utils.js";
import { PALETTE } from "./charts.js";

const COLLAPSE_STORAGE_KEY = "lattes_filters_collapsed_v2";
const QUALIS_ORDER = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "B5", "C", "SQ"];

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Verifica se o registro casa com o texto de busca (usado na categoria ativa e entre categorias). */
export function matchesSearch(r, search) {
  const words = norm(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const parts = [];
  for (const v of Object.values(r || {})) {
    if (typeof v === "string" || typeof v === "number") {
      parts.push(v);
    } else if (v && typeof v === "object") {
      for (const ev of Object.values(v)) {
        if (typeof ev === "string" || typeof ev === "number") parts.push(ev);
      }
    }
  }
  const hay = norm(parts.join(" "));
  return words.every((w) => hay.includes(w));
}

function readCollapsedPref() {
  try {
    const saved = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (saved === "false" || saved === "0") return false;
    if (saved === "true" || saved === "1") return true;
  } catch { }
  return false;
}

function writeCollapsedPref(collapsed) {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(Boolean(collapsed)));
  } catch { }
}

export class FilterBar {
  constructor({ container, onChange, onSearchChange = null, onSelectCategory = null }) {
    this.el = container;
    this.onChange = onChange;
    this.onSearchChange = onSearchChange;
    this.onSelectCategory = onSelectCategory;
    this.category = null;
    this.records = [];
    this.defaultTipos = [];
    this.crossHints = [];
    this.collapsed = readCollapsedPref();
    this._searchTimer = null;
    this._initialized = false;
    this.tipos = new Set();
    this.qualisSet = new Set();
    this.reset();
  }

  reset() {
    this.yearFrom = "";
    this.yearTo = "";
    this.tipos = new Set();
    this.qualisSet = new Set();
    this.comp = "all"; // all | with | without
    this.link = "all"; // all | with | without — DOI ou URL
    this.search = "";
  }

  /** Novos registros da categoria; mantém filtros se a categoria for a mesma. */
  setRecords(category, records, defaultTipos = []) {
    if (category !== this.category) {
      this.category = category;
      const keepSearch = this.search;
      this.reset();
      this.search = keepSearch;
      this.crossHints = [];
    }
    this.records = records || [];
    this.defaultTipos = Array.isArray(defaultTipos)
      ? defaultTipos.map((t) => String(t || "").trim()).filter(Boolean)
      : [];

    const tiposNow = new Set(this.records.map((r) => r.tipo || "Sem tipo"));
    for (const t of [...this.tipos]) {
      if (!tiposNow.has(t)) this.tipos.delete(t);
    }

    const qualisNow = new Set(
      this.records.map((r) => String(r.qualis || "").trim().toUpperCase() || "__NONE__")
    );
    for (const q of [...this.qualisSet]) {
      if (!qualisNow.has(q)) this.qualisSet.delete(q);
    }

    this.render();
  }

  hasFile = (r) => Boolean(r.path && String(r.path).trim());
  /** Link do registro: URL preenchida ou DOI no identificador (que também guarda nome de arquivo). */
  hasLink = (r) => Boolean(String(r.url || "").trim()) || /^10\.\d{4,9}\//.test(String(r.identifier || "").trim());

  matchesExcept(r, ignore = null) {
    if (ignore !== "tipo" && this.tipos.size > 0 && !this.tipos.has(r.tipo || "Sem tipo")) return false;
    if (this.yearFrom !== "") {
      const y = Number(r.ano);
      if (!Number.isFinite(y) || y <= 0 || y < Number(this.yearFrom)) return false;
    }
    if (this.yearTo !== "") {
      const y = Number(r.ano);
      if (!Number.isFinite(y) || y <= 0 || y > Number(this.yearTo)) return false;
    }
    if (ignore !== "qualis" && this.qualisSet.size > 0) {
      const q = String(r.qualis || "").trim().toUpperCase() || "__NONE__";
      if (!this.qualisSet.has(q)) return false;
    }
    if (this.comp === "with" && !this.hasFile(r)) return false;
    if (this.comp === "without" && this.hasFile(r)) return false;
    if (this.link === "with" && !this.hasLink(r)) return false;
    if (this.link === "without" && this.hasLink(r)) return false;
    if (this.search && !matchesSearch(r, this.search)) return false;
    return true;
  }

  matches(r) {
    return this.matchesExcept(r, null);
  }

  filtered() {
    return this.records.filter((r) => this.matches(r));
  }

  secondaryFilters() {
    const items = [];
    if (this.yearFrom !== "") items.push({ key: "yearFrom", label: `Ano ≥ ${this.yearFrom}` });
    if (this.yearTo !== "") items.push({ key: "yearTo", label: `Ano ≤ ${this.yearTo}` });
    for (const t of this.tipos) {
      items.push({ key: `tipo:${t}`, label: t, tipo: t });
    }
    for (const q of this.qualisSet) {
      items.push({
        key: `qualis:${q}`,
        label: `Qualis: ${q === "__NONE__" ? "Sem Qualis" : q}`,
      });
    }
    if (this.comp !== "all") {
      items.push({
        key: "comp",
        label: this.comp === "with" ? "Com comprovante" : "Sem comprovante",
      });
    }
    if (this.link !== "all") {
      items.push({
        key: "link",
        label: this.link === "with" ? "Com DOI/Link" : "Sem DOI/Link",
      });
    }
    return items;
  }

  active() {
    return Boolean(this.search.trim()) || this.secondaryFilters().length > 0;
  }

  setSearch(val, { triggerSearch = true } = {}) {
    const next = String(val || "").trim();
    this.search = next;
    this.ensureStructure();
    if (this._searchInput && document.activeElement !== this._searchInput) {
      this._searchInput.value = val || "";
    }
    this.updatePrimaryChrome();
    this.renderSecondary();
    if (triggerSearch) this.onSearchChange?.(this.search);
  }

  setCrossCategoryHints(hints) {
    this.crossHints = Array.isArray(hints) ? hints.filter((h) => h && h.count > 0) : [];
    this.ensureStructure();
    this.renderCrossHints();
  }

  ensureStructure() {
    if (this._initialized || !this.el) return;
    this._initialized = true;
    this.el.innerHTML = `
      <div class="fb-primary">
        <div class="fb-search-wrap">
          <input type="search" class="fb-search-input" placeholder="Buscar nesta categoria..." aria-label="Buscar nesta categoria" />
          <button type="button" class="fb-search-clear" title="Limpar busca" hidden>&times;</button>
        </div>
        <button type="button" class="fb-toggle" aria-expanded="${String(!this.collapsed)}" title="Mostrar ou recolher filtros avançados">
          <span>Filtros</span>
          <span class="fb-badge" hidden>0</span>
          <span class="fb-chevron" aria-hidden="true">▾</span>
        </button>
        <div class="fb-chips"></div>
        <button type="button" class="fb-clear" hidden title="Limpar todos os filtros ativos">✕ Limpar</button>
      </div>
      <div class="fb-secondary ${this.collapsed ? "hidden" : ""}"></div>
      <div id="cross-category-hints" class="fb-cross-hints hidden" role="region" aria-label="Resultados em outras categorias"></div>
    `;

    this._searchInput = this.el.querySelector(".fb-search-input");
    this._searchClear = this.el.querySelector(".fb-search-clear");
    this._toggleBtn = this.el.querySelector(".fb-toggle");
    this._badgeEl = this.el.querySelector(".fb-badge");
    this._chipsEl = this.el.querySelector(".fb-chips");
    this._clearBtn = this.el.querySelector(".fb-clear");
    this._secondaryEl = this.el.querySelector(".fb-secondary");
    this._crossHintsEl = this.el.querySelector("#cross-category-hints");

    const syncTopSearch = (val) => {
      const topInput = document.getElementById("input-search");
      const topClear = document.getElementById("btn-clear-search");
      if (topInput && topInput.value !== val) topInput.value = val;
      if (topClear) topClear.style.display = val.length > 0 ? "block" : "none";
    };

    this._searchInput.addEventListener("input", () => {
      const raw = this._searchInput.value;
      syncTopSearch(raw);
      if (this._searchClear) this._searchClear.hidden = raw.length === 0;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this.search = raw.trim();
        this.updatePrimaryChrome();
        this.renderSecondary();
        this.onChange?.();
        this.onSearchChange?.(this.search);
      }, 150);
    });

    this._searchClear.addEventListener("click", () => {
      clearTimeout(this._searchTimer);
      this._searchInput.value = "";
      syncTopSearch("");
      this.search = "";
      this.updatePrimaryChrome();
      this.renderSecondary();
      this.onChange?.();
      this.onSearchChange?.("");
      this._searchInput.focus();
    });

    this._toggleBtn.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      writeCollapsedPref(this.collapsed);
      this.updatePrimaryChrome();
      this.renderSecondary();
    });

    this._clearBtn.addEventListener("click", () => {
      clearTimeout(this._searchTimer);
      this.reset();
      if (this._searchInput) this._searchInput.value = "";
      syncTopSearch("");
      this.render();
      this.onChange?.();
      this.onSearchChange?.("");
    });

    this._chipsEl.addEventListener("click", (e) => {
      const chip = e.target.closest("button[data-clear-key]");
      if (!chip) return;
      const key = chip.dataset.clearKey;
      if (key.startsWith("tipo:")) this.tipos.delete(key.slice(5));
      else if (key.startsWith("qualis:")) this.qualisSet.delete(key.slice(7));
      else if (key === "comp" || key === "link") this[key] = "all";
      else if (key in this) this[key] = "";
      this.render();
      this.onChange?.();
    });

    this._secondaryEl.addEventListener("change", (e) => {
      const sel = e.target.closest("select[data-filter]");
      if (!sel) return;
      const key = sel.dataset.filter;
      this[key] = sel.value;
      if (key === "yearFrom" && this.yearTo !== "" && this.yearFrom !== "" && Number(this.yearFrom) > Number(this.yearTo)) {
        this.yearTo = "";
      }
      if (key === "yearTo" && this.yearFrom !== "" && this.yearTo !== "" && Number(this.yearTo) < Number(this.yearFrom)) {
        this.yearFrom = "";
      }
      this.updatePrimaryChrome();
      this.renderSecondary();
      this.onChange?.();
    });

    this._secondaryEl.addEventListener("click", (e) => {
      const quickBtn = e.target.closest("button[data-fb-quick]");
      if (quickBtn) {
        const spanYears = Number(quickBtn.dataset.fbQuick);
        const curYear = new Date().getFullYear();
        const targetFrom = String(curYear - (spanYears - 1));
        if (this.yearFrom === targetFrom && this.yearTo === "") {
          this.yearFrom = "";
        } else {
          this.yearFrom = targetFrom;
          this.yearTo = "";
        }
        this.updatePrimaryChrome();
        this.renderSecondary();
        this.onChange?.();
        return;
      }

      const allBtn = e.target.closest("button[data-pill-all]");
      if (allBtn) {
        const kind = allBtn.dataset.pillAll;
        if (kind === "tipo") this.tipos.clear();
        else if (kind === "qualis") this.qualisSet.clear();
        this.updatePrimaryChrome();
        this.renderSecondary();
        this.onChange?.();
        return;
      }

      const tipoBtn = e.target.closest("button[data-pill-tipo]");
      if (tipoBtn) {
        const val = tipoBtn.dataset.pillTipo;
        if (this.tipos.has(val)) this.tipos.delete(val);
        else this.tipos.add(val);
        this.updatePrimaryChrome();
        this.renderSecondary();
        this.onChange?.();
        return;
      }

      const qualisBtn = e.target.closest("button[data-pill-qualis]");
      if (qualisBtn) {
        const val = qualisBtn.dataset.pillQualis;
        if (this.qualisSet.has(val)) this.qualisSet.delete(val);
        else this.qualisSet.add(val);
        this.updatePrimaryChrome();
        this.renderSecondary();
        this.onChange?.();
      }
    });

    this._crossHintsEl.addEventListener("click", (e) => {
      const pill = e.target.closest("button[data-cross-category]");
      if (!pill) return;
      const cat = pill.dataset.crossCategory;
      if (cat) this.onSelectCategory?.(cat);
    });
  }

  updatePrimaryChrome() {
    if (!this._initialized) return;
    const secondary = this.secondaryFilters();
    const count = secondary.length;
    const isExpanded = !this.collapsed;

    this._toggleBtn.setAttribute("aria-expanded", String(isExpanded));
    this._toggleBtn.classList.toggle("has-active", count > 0);
    this._badgeEl.textContent = String(count);
    this._badgeEl.hidden = !(this.collapsed && count > 0);

    if (this._searchClear && this._searchInput) {
      this._searchClear.hidden = this._searchInput.value.length === 0;
    }

    this._chipsEl.innerHTML = this.collapsed
      ? secondary
        .map((f) => {
          const dot = f.tipo ? `<span class="fb-chip-dot" aria-hidden="true"></span>` : "";
          const cls = f.tipo ? "fb-chip fb-chip-tipo" : "fb-chip";
          const style = f.tipo ? ` style="--tc:${tipoColor(f.tipo)}"` : "";
          return `<button type="button" class="${cls}"${style} data-clear-key="${escapeHtml(f.key)}" title="Remover filtro">${dot}${escapeHtml(f.label)} <span class="fb-chip-x" aria-hidden="true">&times;</span></button>`;
        })
        .join("")
      : "";

    this._clearBtn.hidden = !this.active();
    this._secondaryEl.classList.toggle("hidden", this.collapsed);
  }

  renderSecondary() {
    if (!this._initialized) return;
    if (this.collapsed) {
      this._secondaryEl.innerHTML = "";
      return;
    }

    const years = [...new Set(this.records.map((r) => r.ano).filter((y) => y != null && y > 0))].sort((a, b) => b - a);
    const tiposRaw = this.records.map((r) => r.tipo || "Sem tipo");
    const tipos = [...new Set(tiposRaw)].sort((a, b) => a.localeCompare(b, "pt-BR"));
    const qualisVals = [...new Set(this.records.map((r) => String(r.qualis || "").trim().toUpperCase()).filter(Boolean))].sort((a, b) => {
      const ia = QUALIS_ORDER.indexOf(a);
      const ib = QUALIS_ORDER.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    const hasQualis = this.category === "producoes" || qualisVals.length > 0;
    const hasEmptyQualis = hasQualis && this.records.some((r) => !String(r.qualis || "").trim());
    const curYear = new Date().getFullYear();
    const last5Active = this.yearFrom === String(curYear - 4) && this.yearTo === "";
    const last10Active = this.yearFrom === String(curYear - 9) && this.yearTo === "";

    const tipoCounts = new Map();
    let tipoTotal = 0;
    const qualisCounts = new Map();
    let qualisTotal = 0;

    for (const r of this.records) {
      if (this.matchesExcept(r, "tipo")) {
        tipoTotal++;
        const t = r.tipo || "Sem tipo";
        tipoCounts.set(t, (tipoCounts.get(t) || 0) + 1);
      }
      if (hasQualis && this.matchesExcept(r, "qualis")) {
        qualisTotal++;
        const q = String(r.qualis || "").trim().toUpperCase() || "__NONE__";
        qualisCounts.set(q, (qualisCounts.get(q) || 0) + 1);
      }
    }

    const opt = (val, label, current) =>
      `<option value="${escapeHtml(String(val))}" ${String(current) === String(val) ? "selected" : ""}>${escapeHtml(label)}</option>`;

    const renderPillRow = (label, kind, entries, selectedSet, totalCount, displayFn = (v) => v) => {
      // Mantém somente as pills que possuem registros (count > 0) ou que estão ativas pelo usuário
      const visibleEntries = entries.filter(({ value, count }) => count > 0 || selectedSet.has(value));
      if (visibleEntries.length === 0) return "";
      return `
      < div class="fb-row" >
        <span class="fb-row-label">${escapeHtml(label)}</span>
        <div class="fpills">
          <button type="button" class="fpill ${selectedSet.size === 0 ? "on" : ""}" data-pill-all="${kind}" aria-pressed="${selectedSet.size === 0}">
            Todos <b>${totalCount}</b>
          </button>
          ${
        visibleEntries
          .map(({ value, count }) => {
            const on = selectedSet.has(value);
            const isTipo = kind === "tipo";
            const style = isTipo ? ` style="--c:${tipoColor(value)}"` : "";
            const dot = isTipo ? `<span class="fpill-dot" aria-hidden="true"></span>` : "";
            return `<button type="button" class="fpill ${on ? "on" : ""} ${count === 0 ? "zero" : ""}" data-pill-${kind}="${escapeHtml(value)}"${style} aria-pressed="${on}">
                ${dot}${escapeHtml(displayFn(value))} <b>${count}</b>
              </button>`;
          })
        .join("")
      }
        </div >
      </div > `;
    };

    const tipoRow =
      tipos.length > 0
        ? renderPillRow(
            "Tipo",
            "tipo",
            tipos.map((t) => ({ value: t, count: tipoCounts.get(t) || 0 })),
            this.tipos,
            tipoTotal
          )
        : "";

    const qualisEntries = qualisVals.map((q) => ({ value: q, count: qualisCounts.get(q) || 0 }));
    if (hasEmptyQualis) {
      qualisEntries.push({ value: "__NONE__", count: qualisCounts.get("__NONE__") || 0 });
    }
    const qualisRow = hasQualis
      ? renderPillRow(
          "Qualis",
          "qualis",
          qualisEntries,
          this.qualisSet,
          qualisTotal,
          (q) => (q === "__NONE__" ? "Sem Qualis" : q)
        )
      : "";

    this._secondaryEl.innerHTML = `
        < div class="fb-row" >
        <span class="fb-row-label">Ano</span>
        <div class="fb-year-controls">
          <label class="fb-year-pair">
            <span>De</span>
            <select id="fb-year-from" class="fb-select" data-filter="yearFrom" aria-label="Ano inicial">
              ${opt("", "Todos", this.yearFrom)}
              ${years.map((y) => opt(String(y), String(y), this.yearFrom)).join("")}
            </select>
          </label>
          <label class="fb-year-pair">
            <span>Até</span>
            <select id="fb-year-to" class="fb-select" data-filter="yearTo" aria-label="Ano final">
              ${opt("", "Todos", this.yearTo)}
              ${years.map((y) => opt(String(y), String(y), this.yearTo)).join("")}
            </select>
          </label>
          <button type="button" class="fb-quick ${last5Active ? "active" : ""}" data-fb-quick="5" title="Filtrar últimos 5 anos (${curYear - 4}–${curYear})">Últimos 5 anos</button>
          <button type="button" class="fb-quick ${last10Active ? "active" : ""}" data - fb - quick="10" title = "Filtrar últimos 10 anos (${curYear - 9}–${curYear})" > Últimos 10 anos</button >
        </div >
      </div >
        ${ tipoRow }
      ${ qualisRow }
      `;
  }

  renderCrossHints() {
    if (!this._crossHintsEl) return;
    if (!this.crossHints.length) {
      this._crossHintsEl.classList.add("hidden");
      this._crossHintsEl.innerHTML = "";
      return;
    }
    this._crossHintsEl.classList.remove("hidden");
    this._crossHintsEl.innerHTML = `
        < span class="fb-cross-label" > Também encontrado em:</span >
          ${
            this.crossHints
            .map(
              (h) =>
                `<button type="button" class="fb-cross-pill" data-cross-category="${escapeHtml(h.category)}">${escapeHtml(h.label)} (${h.count})</button>`
            )
            .join("")
      }
      `;
  }

  render() {
    if (!this.el) return;
    this.ensureStructure();
    const color = PALETTE[this.category] || "#6366f1";
    this.el.style.setProperty("--c", color);

    if (this._searchInput && document.activeElement !== this._searchInput) {
      this._searchInput.value = this.search || "";
    }
    this.updatePrimaryChrome();
    this.renderSecondary();
    this.renderCrossHints();
  }
}
