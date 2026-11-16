// Histórico de preenchimento: sugere, em cada campo de texto do formulário, os valores já
// usados nesse mesmo campo em registros da mesma categoria (mesmo tipo primeiro).

import { api } from "../api.js";
import { escapeHtml } from "../utils.js";

const fold = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const MAX_ITEMS = 8;

/** HTML de `text` com a 1ª ocorrência de cada palavra buscada em <mark> (ignora acentos e caixa). */
function highlight(text, words) {
  let folded = "";
  const pos = []; // caractere dobrado → índice no texto original
  for (let i = 0; i < text.length; i++) {
    for (const ch of text[i].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()) {
      folded += ch;
      pos.push(i);
    }
  }
  const ranges = [];
  for (const w of words) {
    const i = w.length > 1 ? folded.indexOf(w) : -1;
    if (i >= 0) ranges.push([pos[i], pos[i + w.length - 1] + 1]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  for (const [a, b] of ranges) {
    if (a < at) continue; // sobreposto a um destaque anterior
    out += `${escapeHtml(text.slice(at, a))}<mark>${escapeHtml(text.slice(a, b))}</mark>`;
    at = b;
  }
  return out + escapeHtml(text.slice(at));
}

export class FieldHistory {
  /**
   * @param {HTMLElement} container  onde os campos são renderizados (delegação de eventos)
   * @param {() => {category: string, tipo: string, excludeId: any}} getContext
   */
  constructor(container, getContext) {
    this.container = container;
    this.getContext = getContext;
    this.records = [];
    this.loading = null;
    this.loadedFor = null;
    this.field = null; // campo com o menu aberto
    this.items = [];
    this.active = -1;
    this.suppress = false;

    this.menu = document.createElement("div");
    this.menu.className = "fh-menu";
    this.menu.setAttribute("role", "listbox");
    this.menu.hidden = true;
    document.body.appendChild(this.menu);

    this.bind();
  }

  /** Carrega (de novo) os registros da categoria; chamado a cada abertura do formulário. */
  load(category) {
    this.close();
    this.records = [];
    this.loadedFor = category;
    this.loading = api
      .getRecords(category, {})
      .then((recs) => {
        if (this.loadedFor === category) this.records = Array.isArray(recs) ? recs : [];
      })
      .catch(() => {});
    return this.loading;
  }

  isTarget(el) {
    return el && el.dataset && el.dataset.history === "1" && this.container.contains(el);
  }

  bind() {
    const c = this.container;
    c.addEventListener("focusin", (e) => this.isTarget(e.target) && this.open(e.target));
    c.addEventListener("click", (e) => this.isTarget(e.target) && this.field !== e.target && this.open(e.target));
    c.addEventListener("input", (e) => {
      if (this.suppress || !this.isTarget(e.target)) return;
      this.open(e.target);
    });
    c.addEventListener("focusout", (e) => {
      if (e.target === this.field) this.close();
    });
    c.addEventListener("keydown", (e) => this.onKey(e));

    // o menu não rouba o foco do campo
    this.menu.addEventListener("mousedown", (e) => e.preventDefault());
    this.menu.addEventListener("click", (e) => {
      const li = e.target.closest("[data-i]");
      if (li) this.pick(Number(li.dataset.i));
    });

    const reposition = () => this.field && this.place();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
  }

  onKey(e) {
    if (!this.isTarget(e.target)) return;
    const isOpen = !this.menu.hidden;
    if (!isOpen) {
      // ↓ (ou Alt+↓ em textos longos) abre a lista
      if (e.key === "ArrowDown" && (e.target.tagName === "INPUT" || e.altKey)) {
        e.preventDefault();
        this.open(e.target, true);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = this.items.length;
      this.active = e.key === "ArrowDown" ? (this.active + 1) % n : (this.active - 1 + n) % n;
      this.highlight();
    } else if (e.key === "Enter" && this.active >= 0) {
      e.preventDefault();
      this.pick(this.active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    } else if (e.key === "Tab") {
      this.close();
    }
  }

  /** Valores anteriores do campo, ranqueados: mesmo tipo → mais usados → mais recentes. */
  suggestions(name, query) {
    const { tipo, excludeId } = this.getContext();
    const tipoKey = fold(tipo);
    const map = new Map();
    for (const r of this.records) {
      if (excludeId != null && String(r.id) === String(excludeId)) continue;
      const raw = r[name];
      if (raw == null) continue;
      const value = String(raw).trim();
      if (!value) continue;
      const k = fold(value);
      let s = map.get(k);
      if (!s) map.set(k, (s = { value, key: k, count: 0, same: 0, last: 0 }));
      s.count++;
      if (tipoKey && fold(r.tipo) === tipoKey) s.same++;
      const id = Number(r.id) || 0;
      if (id > s.last) {
        s.last = id;
        s.value = value; // grafia mais recente
      }
    }
    let list = [...map.values()];
    const q = fold(query);
    // campo vazio ou já igual a uma sugestão: mostra tudo (para trocar); senão filtra pelas palavras
    if (q && !map.has(q)) {
      const words = q.split(" ");
      list = list.filter((s) => words.every((w) => s.key.includes(w)));
    }
    list.sort((a, b) => (b.same > 0) - (a.same > 0) || b.same - a.same || b.count - a.count || b.last - a.last);
    return { list: list.slice(0, MAX_ITEMS), q, words: q ? q.split(" ") : [] };
  }

  async open(field, force = false) {
    if (this.loading) await this.loading;
    if (document.activeElement !== field && !force) return;
    const name = field.name;
    const { list, words } = this.suggestions(name, field.value);
    // não sugere quando o único resultado é exatamente o que já está escrito
    if (!list.length || (list.length === 1 && list[0].key === fold(field.value))) return this.close();

    this.field = field;
    this.items = list;
    this.active = -1;
    const mark = (text) => highlight(text, words);
    this.menu.innerHTML =
      `<div class="fh-head">Usados antes neste campo</div>` +
      list
        .map(
          (s, i) => `<div class="fh-item" role="option" data-i="${i}" title="${escapeHtml(s.value)}">
            <span class="fh-text">${mark(s.value)}</span>
            <span class="fh-meta">${s.same ? '<span class="fh-same">mesmo tipo</span>' : ""}${s.count > 1 ? `<span class="fh-count">×${s.count}</span>` : ""}</span>
          </div>`
        )
        .join("");
    this.menu.hidden = false;
    this.place();
  }

  place() {
    const f = this.field;
    if (!f || !f.isConnected) return this.close();
    const r = f.getBoundingClientRect();
    const m = this.menu;
    m.style.width = `${r.width}px`;
    m.style.left = `${r.left}px`;
    const below = window.innerHeight - r.bottom - 8;
    const h = Math.min(m.scrollHeight, 300);
    if (below < h && r.top > below) {
      m.style.top = "";
      m.style.bottom = `${window.innerHeight - r.top + 4}px`;
      m.style.maxHeight = `${Math.min(300, r.top - 8)}px`;
    } else {
      m.style.bottom = "";
      m.style.top = `${r.bottom + 4}px`;
      m.style.maxHeight = `${Math.max(120, Math.min(300, below))}px`;
    }
  }

  highlight() {
    this.menu.querySelectorAll(".fh-item").forEach((el, i) => {
      const on = i === this.active;
      el.classList.toggle("on", on);
      if (on) el.scrollIntoView({ block: "nearest" });
    });
  }

  pick(i) {
    const s = this.items[i];
    const f = this.field;
    if (!s || !f) return;
    f.value = s.value;
    this.suppress = true;
    f.dispatchEvent(new Event("input", { bubbles: true }));
    f.dispatchEvent(new Event("change", { bubbles: true }));
    this.suppress = false;
    this.close();
    f.focus();
    f.setSelectionRange?.(f.value.length, f.value.length);
  }

  close() {
    this.menu.hidden = true;
    this.menu.innerHTML = "";
    this.field = null;
    this.items = [];
    this.active = -1;
  }
}
