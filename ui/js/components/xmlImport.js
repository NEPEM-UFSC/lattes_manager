// Importação de registros (10 categorias) a partir do XML do Currículo Lattes

import { api } from "../api.js";
import { easyClose } from "../theme.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../utils.js";
import { PALETTE } from "./charts.js";

const CATEGORY_ORDER = [
  "producoes",
  "orientacoes",
  "bancas",
  "eventos",
  "patentes",
  "projetos",
  "disciplinas",
  "formacao",
  "encargos",
  "dadosgerais",
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

function categoryLabel(cat) {
  return CATEGORY_SCHEMAS?.[cat]?.name || CATEGORY_FALLBACK[cat] || cat;
}

function categoryColor(cat) {
  return PALETTE?.[cat] || "#6366f1";
}

function injectXmlImportStyles() {
  if (document.getElementById("xml-import-extra-styles")) return;
  const style = document.createElement("style");
  style.id = "xml-import-extra-styles";
  style.textContent = `
    .xml-cat-chips { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 4px; }
    .xml-chips .xml-chip { cursor: pointer; border: 1px solid var(--border, #cbd5e1); transition: background .15s, border-color .15s, color .15s; }
    .xml-chips .xml-chip:hover { border-color: var(--primary); }
    .xml-chips .xml-chip.on { background: var(--primary); color: #fff; border-color: var(--primary); }
    .xml-chips .xml-chip.on b { color: #fff; opacity: .9; }
    .xml-badge-cat { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: calc(11px * var(--font-scale, 1)); font-weight: 600; white-space: nowrap; }
    .xml-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 3px; font-size: calc(11.5px * var(--font-scale, 1)); color: var(--text-muted); }
    .xml-url-btn { background: none; border: none; padding: 0; color: var(--primary); cursor: pointer; font: inherit; font-size: calc(11.5px * var(--font-scale, 1)); text-decoration: underline; }
    .xml-url-btn:hover { opacity: .82; }
    .xml-table tr.row-selected td { background: var(--primary-light); }
    .xml-empty-row { text-align: center; padding: 24px 12px !important; color: var(--text-muted); }
  `;
  document.head.appendChild(style);
}

export class XmlImportModal {
  constructor({ onImported }) {
    this.onImported = onImported;
    this.items = [];
    this.selected = new Set();
    this.filter = "novos";
    this.categoryFilter = "todas";
    this.tipoFilter = null;
    this.search = "";
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

  /** Sem caminho: pergunta a origem (pasta de dados ou procurar arquivo). Com caminho: lê direto. */
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
      <div class="modal-dialog" style="max-width:520px">
        <header class="modal-header">
          <h2 class="modal-title">🧬 Importar registros do XML Lattes</h2>
          <button type="button" class="btn-close-modal" data-x="close">&times;</button>
        </header>
        <div class="modal-body">
          ${error ? `<p style="color:var(--danger,#dc2626);margin:0 0 12px">Falha ao ler XML: ${escapeHtml(String(error))}</p>` : ""}
          <p style="margin:0 0 14px">De onde vem o XML do currículo?</p>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button type="button" class="btn btn-primary" data-x="browse">📂 Procurar arquivo...</button>
            <button type="button" class="btn btn-secondary" data-x="default">💾 Usar o XML da pasta de dados (lattes_xml.xml)</button>
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
    this.overlay.innerHTML = `<div class="modal-dialog xml-dialog"><div class="loading-state" style="display:flex"><div class="spinner"></div><span>Lendo XML do Lattes...</span></div></div>`;
    try {
      this.items = await api.previewLattesXml(xmlPath);
      this.items.forEach((it, i) => {
        it._i = i;
        if (!it.category) it.category = "producoes";
      });
      this.selected = new Set(this.items.filter((i) => !i.duplicate).map((i) => i._i));
      this.filter = "novos";
      this.categoryFilter = "todas";
      this.tipoFilter = null;
      this.search = "";
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

  visible() {
    return this.items.filter((i) => {
      if (!this.matchesBase(i)) return false;
      if (this.categoryFilter !== "todas" && i.category !== this.categoryFilter) return false;
      if (this.tipoFilter && i.tipo !== this.tipoFilter) return false;
      return true;
    });
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
    return parts.length ? parts.join(" · ") : "—";
  }

  render() {
    const novos = this.items.filter((i) => !i.duplicate).length;
    const dup = this.items.length - novos;
    const presentCats = new Set(this.items.map((i) => i.category));
    const catCount = presentCats.size;

    this.overlay.innerHTML = `
      <div class="modal-dialog xml-dialog">
        <header class="modal-header">
          <div>
            <h2 class="modal-title">🧬 Importar registros do XML Lattes</h2>
            <span class="xml-sub">${this.items.length} registros no arquivo (${catCount} categorias) · <b class="ok">${novos} novos</b> · <span class="muted">${dup} já cadastrados</span></span>
          </div>
          <button type="button" class="btn-close-modal" data-x="close">&times;</button>
        </header>
        <div class="modal-body xml-body">
          <div class="fpills xml-cat-chips" id="xmlCatChips"></div>
          <div class="xml-chips" id="xmlTipoChips"></div>
          <div class="xml-toolbar">
            <div class="seg">
              ${["novos", "existentes", "todos"]
        .map((f) => `<button type="button" data-f="${f}" class="${this.filter === f ? "on" : ""}">${f[0].toUpperCase() + f.slice(1)}</button>`)
        .join("")}
            </div>
            <input type="search" class="form-input" data-x="search" placeholder="Filtrar título, tipo, aluno, periódico..." value="${escapeHtml(this.search)}" />
            <button type="button" class="btn btn-secondary btn-sm" data-x="sel-new">Selecionar novas</button>
            <button type="button" class="btn btn-secondary btn-sm" data-x="sel-none">Limpar</button>
            <button type="button" class="btn btn-secondary btn-sm" data-x="other">📂 Procurar arquivo...</button>
          </div>
          <div class="xml-table-wrap">
            <table class="data-table xml-table">
              <thead><tr>
                <th style="width:34px"><input type="checkbox" data-x="all" /></th>
                <th style="width:56px">Ano</th>
                <th style="width:120px">Categoria</th>
                <th style="width:155px">Tipo</th>
                <th>Título / Descrição</th>
                <th style="width:210px">Detalhes</th>
                <th style="width:82px">Status</th>
              </tr></thead>
              <tbody id="xmlTableBody"></tbody>
            </table>
          </div>
        </div>
        <footer class="modal-footer">
          <span class="muted" id="xmlSelCount" style="margin-right:auto"></span>
          <button type="button" class="btn btn-secondary" data-x="close">Cancelar</button>
          <button type="button" class="btn btn-primary" data-x="import"></button>
        </footer>
      </div>`;

    this.drawChips();
    this.drawTable();
    this.updateCounts();

    const $ = (s) => this.overlay.querySelector(s);
    this.overlay.querySelectorAll('[data-x="close"]').forEach((b) => b.addEventListener("click", () => this.close()));

    this.overlay.querySelectorAll("[data-f]").forEach((b) =>
      b.addEventListener("click", () => {
        this.filter = b.dataset.f;
        this.overlay.querySelectorAll("[data-f]").forEach((btn) => btn.classList.toggle("on", btn.dataset.f === this.filter));
        this.drawChips();
        this.drawTable();
        this.updateCounts();
      })
    );

    $("#xmlCatChips").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat]");
      if (!btn) return;
      this.categoryFilter = btn.dataset.cat;
      this.tipoFilter = null;
      this.drawChips();
      this.drawTable();
      this.updateCounts();
    });

    $("#xmlTipoChips").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tipo]");
      if (!btn) return;
      const t = btn.dataset.tipo;
      this.tipoFilter = this.tipoFilter === t ? null : t;
      this.drawChips();
      this.drawTable();
      this.updateCounts();
    });

    const searchInput = $('[data-x="search"]');
    searchInput.addEventListener("input", () => {
      this.search = searchInput.value;
      clearTimeout(this._t);
      this._t = setTimeout(() => {
        this.drawChips();
        this.drawTable();
        this.updateCounts();
      }, 180);
    });

    $('[data-x="all"]').addEventListener("change", (e) => {
      const rows = this.visible();
      for (const r of rows) {
        if (!r.duplicate) {
          if (e.target.checked) this.selected.add(r._i);
          else this.selected.delete(r._i);
        }
      }
      this.drawTable();
      this.updateCounts();
    });

    $('[data-x="sel-new"]').addEventListener("click", () => {
      for (const r of this.visible()) {
        if (!r.duplicate) this.selected.add(r._i);
      }
      this.drawTable();
      this.updateCounts();
    });

    $('[data-x="sel-none"]').addEventListener("click", () => {
      this.selected.clear();
      this.drawTable();
      this.updateCounts();
    });

    const tbody = $("#xmlTableBody");
    tbody.addEventListener("change", (e) => {
      const cb = e.target.closest("input[data-check]");
      if (!cb) return;
      const idx = Number(cb.dataset.check);
      if (cb.checked) this.selected.add(idx);
      else this.selected.delete(idx);
      const tr = cb.closest("tr");
      if (tr) tr.classList.toggle("row-selected", cb.checked);
      this.updateCounts();
    });

    tbody.addEventListener("click", (e) => {
      const urlBtn = e.target.closest("[data-url]");
      if (!urlBtn) return;
      e.preventDefault();
      const url = urlBtn.dataset.url;
      if (url && /^https?:\/\//i.test(url)) api.openUrl(url);
    });

    $('[data-x="other"]').addEventListener("click", () => this.browse());
    $('[data-x="import"]').addEventListener("click", () => this.doImport());
  }

  drawChips() {
    const catEl = this.overlay.querySelector("#xmlCatChips");
    const tipoEl = this.overlay.querySelector("#xmlTipoChips");
    if (!catEl || !tipoEl) return;

    const base = this.items.filter((i) => this.matchesBase(i));
    const countsByCat = {};
    for (const i of base) countsByCat[i.category] = (countsByCat[i.category] || 0) + 1;

    const allInFile = new Set(this.items.map((i) => i.category));
    const orderedCats = CATEGORY_ORDER.filter((c) => allInFile.has(c));
    for (const c of allInFile) {
      if (!orderedCats.includes(c)) orderedCats.push(c);
    }

    const catPills = [
      `<button type="button" class="fpill ${this.categoryFilter === "todas" ? "on" : ""}" style="--c:#64748b" data-cat="todas">Todas <b>${base.length}</b></button>`,
      ...orderedCats
        .filter((cat) => (countsByCat[cat] || 0) > 0 || this.categoryFilter === cat)
        .map((cat) => {
          const count = countsByCat[cat] || 0;
          const color = categoryColor(cat);
          const on = this.categoryFilter === cat ? "on" : "";
          const zero = count === 0 ? "zero" : "";
          return `<button type="button" class="fpill ${on} ${zero}" style="--c:${color}" data-cat="${escapeHtml(cat)}">${escapeHtml(categoryLabel(cat))} <b>${count}</b></button>`;
        }),
    ];
    catEl.innerHTML = catPills.join("");

    const catRows =
      this.categoryFilter === "todas"
        ? base
        : base.filter((i) => i.category === this.categoryFilter);
    const byTipo = {};
    for (const i of catRows) byTipo[i.tipo] = (byTipo[i.tipo] || 0) + 1;
    if (this.tipoFilter && !byTipo[this.tipoFilter]) {
      this.tipoFilter = null;
    }

    const entries = Object.entries(byTipo).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
    tipoEl.innerHTML =
      entries
        .map(
          ([t, n]) =>
            `<button type="button" class="xml-chip ${this.tipoFilter === t ? "on" : ""}" data-tipo="${escapeHtml(t)}">${escapeHtml(t)} <b>${n}</b></button>`
        )
        .join("") || '<span class="muted">Nenhum registro encontrado para os filtros selecionados.</span>';
  }

  drawTable() {
    const tbody = this.overlay.querySelector("#xmlTableBody");
    if (!tbody) return;
    const rows = this.visible();
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="xml-empty-row">Nenhum registro encontrado com os filtros atuais.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map((r) => {
        const isSel = this.selected.has(r._i);
        const trClass = [r.duplicate ? "dup" : "", isSel ? "row-selected" : ""].filter(Boolean).join(" ");
        const color = categoryColor(r.category);
        const catLabel = categoryLabel(r.category);
        const metaParts = [];
        if (r.doi) {
          const prefix = r.category === "patentes" ? "Reg." : "DOI";
          metaParts.push(`<span class="doi">${prefix} ${escapeHtml(r.doi)}</span>`);
        }
        if (r.url) {
          metaParts.push(
            `<button type="button" class="xml-url-btn" data-url="${escapeHtml(r.url)}" title="${escapeHtml(r.url)}">🔗 Link</button>`
          );
        }
        if (r.horas != null && Number(r.horas) > 0) {
          metaParts.push(`<span class="badge badge-hours">${Number(r.horas)}h</span>`);
        }
        const metaHtml = metaParts.length ? `<div class="xml-meta">${metaParts.join("")}</div>` : "";
        return `<tr class="${trClass}">
          <td><input type="checkbox" data-check="${r._i}" ${isSel ? "checked" : ""} ${r.duplicate ? "disabled" : ""}/></td>
          <td>${r.ano != null ? escapeHtml(String(r.ano)) : "—"}</td>
          <td><span class="xml-badge-cat" style="background:${color}1f;color:${color};border:1px solid ${color}4d">${escapeHtml(catLabel)}</span></td>
          <td>${escapeHtml(r.tipo)}</td>
          <td class="t">${escapeHtml(r.titulo)}${metaHtml}</td>
          <td class="muted">${this.formatDetails(r)}</td>
          <td>${r.duplicate ? '<span class="pill pill-muted">Existe</span>' : '<span class="pill pill-ok">Nova</span>'}</td>
        </tr>`;
      })
      .join("");
  }

  updateCounts() {
    const selCount = this.selected.size;
    const selEl = this.overlay.querySelector("#xmlSelCount");
    if (selEl) {
      selEl.textContent = `${selCount} selecionado(s) para importar`;
    }
    const importBtn = this.overlay.querySelector('[data-x="import"]');
    if (importBtn) {
      importBtn.disabled = selCount === 0;
      importBtn.textContent = `Importar ${selCount} ${selCount === 1 ? "registro" : "registros"}`;
    }
    const allCb = this.overlay.querySelector('[data-x="all"]');
    if (allCb) {
      const selectable = this.visible().filter((r) => !r.duplicate);
      const checkedCount = selectable.filter((r) => this.selected.has(r._i)).length;
      allCb.disabled = selectable.length === 0;
      allCb.checked = selectable.length > 0 && checkedCount === selectable.length;
      allCb.indeterminate = checkedCount > 0 && checkedCount < selectable.length;
    }
  }

  async doImport() {
    const items = this.items
      .filter((i) => this.selected.has(i._i))
      .map(({ _i, ...rest }) => rest);
    if (!items.length) return;
    const importBtn = this.overlay.querySelector('[data-x="import"]');
    if (importBtn) {
      importBtn.disabled = true;
      importBtn.textContent = "Importando...";
    }
    try {
      const n = await api.importLattesXml(items);
      showToast(`${n} ${n === 1 ? "registro importado" : "registros importados"} do XML Lattes!`, "success", 5000);
      this.close();
      if (this.onImported) this.onImported(n);
    } catch (err) {
      showToast(`Falha na importação: ${err}`, "error", 6000);
      this.updateCounts();
    }
  }
}
