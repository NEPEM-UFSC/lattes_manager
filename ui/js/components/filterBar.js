// Filtros em "pílulas" (tipo, ano) + comprovante, com contagens facetadas.
// Filtragem no cliente: cada categoria tem no máximo algumas centenas de registros.

import { escapeHtml } from "../utils.js";
import { PALETTE } from "./charts.js";

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export class FilterBar {
  constructor({ container, onChange }) {
    this.el = container;
    this.onChange = onChange;
    this.category = null;
    this.records = [];
    this.reset();
  }

  reset() {
    this.tipos = new Set();
    this.years = new Set();
    this.comp = "all"; // all | with | without
    this.link = "all"; // all | with | without — DOI ou URL
    this.search = "";
    this.showAllYears = false;
  }

  /** Novos registros da categoria; mantém filtros se a categoria for a mesma. */
  setRecords(category, records) {
    if (category !== this.category) {
      this.category = category;
      const keepSearch = this.search;
      this.reset();
      this.search = keepSearch;
    }
    this.records = records || [];
    // remove seleções que deixaram de existir
    const tiposNow = new Set(this.records.map((r) => r.tipo || "Sem tipo"));
    const yearsNow = new Set(this.records.map((r) => r.ano));
    this.tipos.forEach((t) => !tiposNow.has(t) && this.tipos.delete(t));
    this.years.forEach((y) => !yearsNow.has(y) && this.years.delete(y));
    this.render();
  }

  hasFile = (r) => Boolean(r.path && String(r.path).trim());
  /** Link do registro: URL preenchida ou DOI no identificador (que também guarda nome de arquivo). */
  hasLink = (r) => Boolean(String(r.url || "").trim()) || /^10\.\d{4,9}\//.test(String(r.identifier || "").trim());

  matches(r, { skipTipo = false, skipYear = false } = {}) {
    if (!skipTipo && this.tipos.size && !this.tipos.has(r.tipo || "Sem tipo")) return false;
    if (!skipYear && this.years.size && !this.years.has(r.ano)) return false;
    if (this.comp === "with" && !this.hasFile(r)) return false;
    if (this.comp === "without" && this.hasFile(r)) return false;
    if (this.link === "with" && !this.hasLink(r)) return false;
    if (this.link === "without" && this.hasLink(r)) return false;
    if (this.search) {
      const hay = norm(Object.values(r).filter((v) => typeof v === "string" || typeof v === "number").join(" "));
      if (!norm(this.search).split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  filtered() {
    return this.records.filter((r) => this.matches(r));
  }

  active() {
    return this.tipos.size || this.years.size || this.comp !== "all" || this.link !== "all" || this.search;
  }

  render() {
    const color = PALETTE[this.category] || "#6366f1";
    const forTipo = this.records.filter((r) => this.matches(r, { skipTipo: true }));
    const forYear = this.records.filter((r) => this.matches(r, { skipYear: true }));
    const count = (arr, key) => arr.reduce((m, r) => ((m[key(r)] = (m[key(r)] || 0) + 1), m), {});
    const allTipos = [...new Set(this.records.map((r) => r.tipo || "Sem tipo"))];
    const tipoN = count(forTipo, (r) => r.tipo || "Sem tipo");
    allTipos.sort((a, b) => (tipoN[b] || 0) - (tipoN[a] || 0) || a.localeCompare(b));
    const allYears = [...new Set(this.records.map((r) => r.ano).filter((y) => y != null && y > 0))].sort((a, b) => b - a);
    const yearN = count(forYear, (r) => r.ano);
    const YMAX = 12;
    const years = this.showAllYears ? allYears : allYears.slice(0, YMAX);
    const hidden = allYears.length - years.length;
    const curYear = new Date().getFullYear();

    const pill = (attr, val, label, n, on) =>
      `<button type="button" class="fpill ${on ? "on" : ""} ${n ? "" : "zero"}" ${attr}="${escapeHtml(String(val))}">${escapeHtml(label)}<b>${n}</b></button>`;

    this.el.style.setProperty("--c", color);
    this.el.innerHTML = `
      ${allTipos.length > 1 ? `<div class="frow">
        <span class="flabel">Tipo</span>
        <div class="fpills">
          ${pill("data-all-tipo", "", "Todos", forTipo.length, !this.tipos.size)}
          ${allTipos.map((t) => pill("data-tipo", t, t, tipoN[t] || 0, this.tipos.has(t))).join("")}
        </div>
      </div>` : ""}
      ${allYears.length > 1 ? `<div class="frow">
        <span class="flabel">Ano</span>
        <div class="fpills">
          ${pill("data-all-year", "", "Todos", forYear.length, !this.years.size)}
          <button type="button" class="fpill ghost" data-last="5" title="Últimos 5 anos">Últimos 5</button>
          ${years.map((y) => pill("data-year", y, String(y), yearN[y] || 0, this.years.has(y))).join("")}
          ${hidden > 0 ? `<button type="button" class="fpill ghost" data-more>+${hidden} anos</button>` : ""}
          ${this.showAllYears && allYears.length > YMAX ? `<button type="button" class="fpill ghost" data-less>menos</button>` : ""}
        </div>
      </div>` : ""}
      ${this.active() ? `<button type="button" class="fclear" data-clear>✕ Limpar filtros</button>` : ""}`;

    const fire = () => {
      this.render();
      this.onChange && this.onChange();
    };
    const toggle = (set, v, multi) => {
      if (multi) set.has(v) ? set.delete(v) : set.add(v);
      else if (set.size === 1 && set.has(v)) set.clear();
      else {
        set.clear();
        set.add(v);
      }
    };
    // clique simples seleciona só aquele; Ctrl/Shift+clique acumula
    this.el.querySelectorAll("[data-tipo]").forEach((b) =>
      b.addEventListener("click", (e) => {
        toggle(this.tipos, b.dataset.tipo, e.ctrlKey || e.metaKey || e.shiftKey);
        fire();
      })
    );
    this.el.querySelectorAll("[data-year]").forEach((b) =>
      b.addEventListener("click", (e) => {
        toggle(this.years, Number(b.dataset.year), e.ctrlKey || e.metaKey || e.shiftKey);
        fire();
      })
    );
    this.el.querySelector("[data-all-tipo]")?.addEventListener("click", () => (this.tipos.clear(), fire()));
    this.el.querySelector("[data-all-year]")?.addEventListener("click", () => (this.years.clear(), fire()));
    this.el.querySelector("[data-last]")?.addEventListener("click", () => {
      this.years = new Set(allYears.filter((y) => y > curYear - 5));
      fire();
    });
    this.el.querySelector("[data-more]")?.addEventListener("click", () => ((this.showAllYears = true), this.render()));
    this.el.querySelector("[data-less]")?.addEventListener("click", () => ((this.showAllYears = false), this.render()));
    this.el.querySelector("[data-clear]")?.addEventListener("click", () => {
      const s = document.getElementById("input-search");
      if (s) s.value = "";
      this.reset();
      fire();
    });
    this.el.title = "Dica: Ctrl+clique para selecionar vários";
  }
}
