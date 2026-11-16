// "Vincular comprovantes": liga arquivos que estão nas pastas a registros sem comprovante,
// e revisa registros quase duplicados.

import { api } from "../api.js";
import { easyClose } from "../theme.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../utils.js";

const group = (c) => CATEGORY_SCHEMAS[c]?.group || c;

export class LinkerModal {
  constructor({ onChanged, previewer }) {
    this.onChanged = onChanged;
    this.previewer = previewer;
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";
    this.overlay.style.display = "none";
    document.getElementById("app").appendChild(this.overlay);
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay && easyClose()) this.close();
    });
    this.tab = "links";
  }

  async open(tab = "links") {
    this.tab = tab;
    this.overlay.style.display = "flex";
    this.overlay.innerHTML = `<div class="modal-dialog lk-dialog"><div class="loading-state" style="display:flex"><div class="spinner"></div><span>Procurando comprovantes nas pastas...</span></div></div>`;
    try {
      const [links, dups] = await Promise.all([api.suggestFileLinks(), api.findDuplicateRecords()]);
      this.links = (links || []).map((l, i) => ({ ...l, _i: i }));
      this.sel = new Set(this.links.filter((l) => l.score >= 0.9).map((l) => l._i));
      this.dups = (dups || []).map((d, i) => ({ ...d, _i: i }));
      this.dropSel = new Set(this.dups.filter((d) => d.score >= 0.95 && !d.drop.has_file).map((d) => d._i));
      this.render();
    } catch (err) {
      this.close();
      showToast(`Falha ao procurar comprovantes: ${err}`, "error", 6000);
    }
  }

  close() {
    this.overlay.style.display = "none";
    this.overlay.innerHTML = "";
  }

  render() {
    const L = this.links, D = this.dups;
    const conf = (s) => (s >= 0.9 ? "alta" : s >= 0.7 ? "média" : "baixa");
    const linksHtml = L.length
      ? `<table class="data-table lk-table"><thead><tr>
          <th style="width:34px"><input type="checkbox" data-all-links ${L.every((l) => this.sel.has(l._i)) ? "checked" : ""}/></th>
          <th style="width:110px">Categoria</th><th>Registro sem comprovante</th><th>Arquivo encontrado</th><th style="width:80px">Confiança</th><th style="width:44px"></th>
        </tr></thead><tbody>${L.map(
          (l) => `<tr class="${this.sel.has(l._i) ? "" : "off"}">
            <td><input type="checkbox" data-l="${l._i}" ${this.sel.has(l._i) ? "checked" : ""}/></td>
            <td><span class="lk-cat">${escapeHtml(group(l.category))}</span></td>
            <td class="t">${escapeHtml(l.titulo)}<div class="muted lk-sub">${escapeHtml([l.ano, l.tipo].filter(Boolean).join(" · "))}</div></td>
            <td class="lk-file"><span title="${escapeHtml(l.path)}">📎 ${escapeHtml(l.path.split("\\").pop())}</span><div class="muted lk-sub">${escapeHtml(l.path.split("\\").slice(0, -1).join("\\"))}</div></td>
            <td><span class="lk-conf ${conf(l.score)}">${conf(l.score)}</span></td>
            <td><button type="button" class="viewer-btn" data-peek="${l._i}" title="Ver arquivo">👁</button></td>
          </tr>`
        ).join("")}</tbody></table>`
      : `<div class="lk-empty">✅ Nenhum arquivo solto correspondente a registros sem comprovante.</div>`;

    const item = (d, tag) => `<div class="lk-dup-item ${tag}">
        <span class="lk-tag">${tag === "keep" ? "Manter" : "Excluir"}</span>
        <div><b>#${d.id}</b> ${escapeHtml(d.titulo)}
          <div class="muted lk-sub">${escapeHtml([d.ano, d.tipo].filter(Boolean).join(" · "))} · ${d.has_file ? "📎 com comprovante" : "sem comprovante"}${d.from_xml ? " · importado do XML" : ""}</div></div>
      </div>`;
    const dupsHtml = D.length
      ? D.map(
          (d) => `<label class="lk-dup ${this.dropSel.has(d._i) ? "on" : ""}">
            <input type="checkbox" data-d="${d._i}" ${this.dropSel.has(d._i) ? "checked" : ""}/>
            <div class="lk-dup-body"><div class="lk-dup-h">${escapeHtml(group(d.category))} · ${Math.round(d.score * 100)}% semelhantes</div>
              ${item(d.keep, "keep")}${item(d.drop, "drop")}</div>
          </label>`
        ).join("")
      : `<div class="lk-empty">✅ Nenhum registro duplicado encontrado.</div>`;

    this.overlay.innerHTML = `
      <div class="modal-dialog lk-dialog">
        <header class="rb-head">
          <div>
            <span class="rb-kicker">Manutenção</span>
            <h2>Vincular comprovantes</h2>
            <p>Arquivos que estão nas pastas mas não estão ligados a nenhum registro foram comparados com os títulos dos registros sem comprovante.</p>
          </div>
          <button type="button" class="btn-close-modal rb-x" data-x="close">&times;</button>
        </header>
        <div class="lk-tabs">
          <button type="button" data-tab="links" class="${this.tab === "links" ? "on" : ""}">🔗 Arquivos encontrados <b>${L.length}</b></button>
          <button type="button" data-tab="dups" class="${this.tab === "dups" ? "on" : ""}">♊ Possíveis duplicatas <b>${D.length}</b></button>
        </div>
        <div class="modal-body lk-body">${this.tab === "links" ? linksHtml : dupsHtml}</div>
        <footer class="modal-footer">
          ${
            this.tab === "links"
              ? `<span class="muted" style="margin-right:auto">${this.sel.size} vínculo(s) selecionado(s) · confiança alta vem marcada</span>
                 <button type="button" class="btn btn-secondary" data-x="close">Fechar</button>
                 <button type="button" class="btn btn-primary" data-x="apply" ${this.sel.size ? "" : "disabled"}>Vincular ${this.sel.size} comprovante(s)</button>`
              : `<span class="muted" style="margin-right:auto">${this.dropSel.size} registro(s) marcado(s) para exclusão · arquivos no disco não são apagados</span>
                 <button type="button" class="btn btn-secondary" data-x="close">Fechar</button>
                 <button type="button" class="btn btn-danger" data-x="drop" ${this.dropSel.size ? "" : "disabled"}>Excluir ${this.dropSel.size} duplicata(s)</button>`
          }
        </footer>
      </div>`;
    this.bind();
    this.syncSelectionUi();
  }

  syncSelectionUi() {
    const o = this.overlay;
    if (this.tab === "links") {
      const n = this.sel.size;
      const total = this.links.length;
      const all = o.querySelector("[data-all-links]");
      if (all) {
        all.checked = total > 0 && n === total;
        all.indeterminate = n > 0 && n < total;
      }
      const status = o.querySelector(".modal-footer .muted");
      if (status) {
        status.textContent = `${n} vínculo(s) selecionado(s) · confiança alta vem marcada`;
      }
      const btn = o.querySelector('[data-x="apply"]');
      if (btn) {
        btn.disabled = n === 0;
        btn.textContent = `Vincular ${n} comprovante(s)`;
      }
    } else {
      const n = this.dropSel.size;
      const status = o.querySelector(".modal-footer .muted");
      if (status) {
        status.textContent = `${n} registro(s) marcado(s) para exclusão · arquivos no disco não são apagados`;
      }
      const btn = o.querySelector('[data-x="drop"]');
      if (btn) {
        btn.disabled = n === 0;
        btn.textContent = `Excluir ${n} duplicata(s)`;
      }
    }
  }

  bind() {
    const o = this.overlay;
    o.querySelectorAll('[data-x="close"]').forEach((b) => b.addEventListener("click", () => this.close()));
    o.querySelectorAll("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => {
        this.tab = b.dataset.tab;
        this.render();
      })
    );
    o.querySelector("[data-all-links]")?.addEventListener("change", (e) => {
      this.sel = e.target.checked ? new Set(this.links.map((l) => l._i)) : new Set();
      this.render();
    });
    o.querySelector(".lk-body")?.addEventListener("change", (e) => {
      const c = e.target;
      if (!(c instanceof HTMLInputElement)) return;
      if (c.matches("[data-l]")) {
        const i = Number(c.dataset.l);
        c.checked ? this.sel.add(i) : this.sel.delete(i);
        c.closest("tr")?.classList.toggle("off", !c.checked);
        this.syncSelectionUi();
      } else if (c.matches("[data-d]")) {
        const i = Number(c.dataset.d);
        c.checked ? this.dropSel.add(i) : this.dropSel.delete(i);
        c.closest(".lk-dup")?.classList.toggle("on", c.checked);
        this.syncSelectionUi();
      }
    });
    o.querySelectorAll("[data-peek]").forEach((b) =>
      b.addEventListener("click", () => {
        const l = this.links[Number(b.dataset.peek)];
        this.previewer?.open({ id: `peek-${l._i}`, path: l.path, file: l.path.split("\\").pop(), titulo: l.titulo, ano: l.ano });
      })
    );
    o.querySelector('[data-x="apply"]')?.addEventListener("click", async () => {
      const links = this.links.filter((l) => this.sel.has(l._i)).map(({ category, id, path }) => ({ category, id, path }));
      try {
        const n = await api.applyFileLinks(links);
        showToast(`${n} comprovante(s) vinculado(s)!`, "success", 4000);
        this.onChanged && (await this.onChanged());
        await this.open("links");
      } catch (e) {
        showToast(`Falha ao vincular: ${e}`, "error", 6000);
      }
    });
    o.querySelector('[data-x="drop"]')?.addEventListener("click", async () => {
      const list = this.dups.filter((d) => this.dropSel.has(d._i));
      if (!window.confirm(`Excluir ${list.length} registro(s) duplicado(s) do banco?\n\nOs arquivos no disco não são apagados.`)) return;
      let n = 0;
      const done = new Set();
      for (const d of list) {
        const key = `${d.category}:${d.drop.id}`;
        if (done.has(key)) continue;
        done.add(key);
        try {
          await api.deleteRecord(d.category, d.drop.id, false);
          n++;
        } catch (e) {
          showToast(`Falha ao excluir #${d.drop.id}: ${e}`, "error");
        }
      }
      showToast(`${n} duplicata(s) excluída(s)`, "success", 3000);
      this.onChanged && (await this.onChanged());
      await this.open("dups");
    });
  }
}
