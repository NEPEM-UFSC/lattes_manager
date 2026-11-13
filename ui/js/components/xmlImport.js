// Importação de produções a partir do XML do Currículo Lattes

import { api } from "../api.js";
import { easyClose } from "../theme.js";
import { escapeHtml, showToast } from "../utils.js";

export class XmlImportModal {
  constructor({ onImported }) {
    this.onImported = onImported;
    this.items = [];
    this.selected = new Set();
    this.filter = "novos";
    this.search = "";
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
          <h2 class="modal-title">🧬 Importar produções do XML Lattes</h2>
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
      this.items.forEach((it, i) => (it._i = i));
      this.selected = new Set(this.items.filter((i) => !i.duplicate).map((i) => i._i));
      this.filter = "novos";
      this.render();
    } catch (err) {
      this.renderStart(err);
    }
  }

  close() {
    this.overlay.style.display = "none";
    this.overlay.innerHTML = "";
  }

  visible() {
    const q = this.search.toLowerCase();
    return this.items.filter((i) => {
      if (this.filter === "novos" && i.duplicate) return false;
      if (this.filter === "existentes" && !i.duplicate) return false;
      if (q && !`${i.titulo} ${i.journal || ""} ${i.tipo} ${i.ano || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  render() {
    const novos = this.items.filter((i) => !i.duplicate).length;
    const dup = this.items.length - novos;
    const byTipo = {};
    for (const i of this.items.filter((i) => !i.duplicate)) byTipo[i.tipo] = (byTipo[i.tipo] || 0) + 1;
    const rows = this.visible();

    this.overlay.innerHTML = `
      <div class="modal-dialog xml-dialog">
        <header class="modal-header">
          <div>
            <h2 class="modal-title">🧬 Importar produções do XML Lattes</h2>
            <span class="xml-sub">${this.items.length} produções no arquivo · <b class="ok">${novos} novas</b> · <span class="muted">${dup} já cadastradas</span></span>
          </div>
          <button type="button" class="btn-close-modal" data-x="close">&times;</button>
        </header>
        <div class="modal-body xml-body">
          <div class="xml-chips">
            ${Object.entries(byTipo)
              .sort((a, b) => b[1] - a[1])
              .map(([t, n]) => `<span class="xml-chip">${escapeHtml(t)} <b>${n}</b></span>`)
              .join("") || '<span class="muted">Nenhuma produção nova encontrada — tudo já está cadastrado.</span>'}
          </div>
          <div class="xml-toolbar">
            <div class="seg">
              ${["novos", "existentes", "todos"]
                .map((f) => `<button type="button" data-f="${f}" class="${this.filter === f ? "on" : ""}">${f[0].toUpperCase() + f.slice(1)}</button>`)
                .join("")}
            </div>
            <input type="search" class="form-input" data-x="search" placeholder="Filtrar..." value="${escapeHtml(this.search)}" />
            <button type="button" class="btn btn-secondary btn-sm" data-x="other">📂 Procurar arquivo...</button>
          </div>
          <div class="xml-table-wrap">
            <table class="data-table xml-table">
              <thead><tr>
                <th style="width:36px"><input type="checkbox" data-x="all" ${rows.length && rows.every((r) => this.selected.has(r._i)) ? "checked" : ""}/></th>
                <th style="width:60px">Ano</th><th style="width:170px">Tipo</th><th>Título</th><th style="width:220px">Periódico / Evento</th><th style="width:90px">Status</th>
              </tr></thead>
              <tbody>
                ${rows
                  .map(
                    (r) => `<tr class="${r.duplicate ? "dup" : ""}">
                  <td><input type="checkbox" data-i="${r._i}" ${this.selected.has(r._i) ? "checked" : ""} ${r.duplicate ? "disabled" : ""}/></td>
                  <td>${r.ano ?? "—"}</td>
                  <td>${escapeHtml(r.tipo)}</td>
                  <td class="t">${escapeHtml(r.titulo)}${r.doi ? `<div class="doi">DOI ${escapeHtml(r.doi)}</div>` : ""}</td>
                  <td class="muted">${escapeHtml(r.journal || "—")}</td>
                  <td>${r.duplicate ? '<span class="pill pill-muted">Existe</span>' : '<span class="pill pill-ok">Nova</span>'}</td>
                </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
        <footer class="modal-footer">
          <span class="muted" style="margin-right:auto">${this.selected.size} selecionada(s) para importar</span>
          <button type="button" class="btn btn-secondary" data-x="close">Cancelar</button>
          <button type="button" class="btn btn-primary" data-x="import" ${this.selected.size ? "" : "disabled"}>Importar ${this.selected.size} produções</button>
        </footer>
      </div>`;

    const $ = (s) => this.overlay.querySelector(s);
    this.overlay.querySelectorAll('[data-x="close"]').forEach((b) => b.addEventListener("click", () => this.close()));
    this.overlay.querySelectorAll("[data-f]").forEach((b) =>
      b.addEventListener("click", () => {
        this.filter = b.dataset.f;
        this.render();
      })
    );
    const s = $('[data-x="search"]');
    s.addEventListener("input", () => {
      this.search = s.value;
      clearTimeout(this._t);
      this._t = setTimeout(() => {
        this.render();
        const n = this.overlay.querySelector('[data-x="search"]');
        n.focus();
        n.setSelectionRange(n.value.length, n.value.length);
      }, 200);
    });
    $('[data-x="all"]').addEventListener("change", (e) => {
      for (const r of rows) if (!r.duplicate) e.target.checked ? this.selected.add(r._i) : this.selected.delete(r._i);
      this.render();
    });
    this.overlay.querySelectorAll("[data-i]").forEach((c) =>
      c.addEventListener("change", () => {
        const i = Number(c.dataset.i);
        c.checked ? this.selected.add(i) : this.selected.delete(i);
        this.render();
      })
    );
    $('[data-x="other"]').addEventListener("click", () => this.browse());
    $('[data-x="import"]').addEventListener("click", () => this.doImport());
  }

  async doImport() {
    const items = this.items
      .filter((i) => this.selected.has(i._i))
      .map(({ _i, ...rest }) => rest);
    try {
      const n = await api.importLattesXml(items);
      showToast(`${n} produções importadas do XML Lattes!`, "success", 5000);
      this.close();
      if (this.onImported) this.onImported(n);
    } catch (err) {
      showToast(`Falha na importação: ${err}`, "error", 6000);
    }
  }
}

