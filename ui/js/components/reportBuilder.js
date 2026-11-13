// Gerador "Comprovantes Lattes": escolha do conteúdo + identificação → PDF único

import { api } from "../api.js";
import { easyClose } from "../theme.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast, compareActivity } from "../utils.js";
import { PALETTE } from "./charts.js";
import { loadProfile, PROFILE_FIELDS } from "./profile.js";

const PRESETS_KEY = "report_presets";
const LAST_KEY = "report_last";

/** Título e linha de detalhes de um registro, por categoria. */
function describe(cat, r) {
  const j = (...xs) => xs.filter((x) => x != null && String(x).trim() !== "").join(" · ");
  switch (cat) {
    case "producoes":
      return { title: r.titulo, meta: j(r.ano, r.tipo, r.journal, r.qualis ? `Qualis ${r.qualis}` : null, r.identifier && /^10\./.test(r.identifier) ? `DOI ${r.identifier}` : null) };
    case "orientacoes":
    case "bancas":
      return { title: r.titulo, meta: j(r.ano, r.tipo, r.aluno) };
    case "disciplinas":
      return { title: r.disciplina, meta: j(r.ano, r.tipo, r.curso, r.horas ? `${r.horas} h` : null, r.alunos ? `${r.alunos} alunos` : null) };
    case "formacao":
    case "encargos":
      return { title: r.descricao, meta: j(r.ano, r.tipo, r.horas ? `${r.horas} h` : null) };
    default:
      // categorias personalizadas têm título + descrição
      return r.titulo ? { title: r.titulo, meta: j(r.ano, r.tipo, r.descricao) } : { title: r.descricao, meta: j(r.ano, r.tipo) };
  }
}

let libsPromise = null;
function loadLibs() {
  if (window.PDFLib && window.fontkit) return Promise.resolve();
  const load = (src) =>
    new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error(`Falha ao carregar ${src}`));
      document.head.appendChild(s);
    });
  libsPromise ||= Promise.all([load("vendor/pdf-lib.min.js"), load("vendor/fontkit.umd.min.js")]);
  return libsPromise;
}

export class ReportBuilder {
  constructor({ previewer, onLink, onEditProfile }) {
    this.previewer = previewer;
    this.onEditProfile = onEditProfile;
    this.onLink = onLink;
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";
    this.overlay.style.display = "none";
    document.getElementById("app").appendChild(this.overlay);
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay && easyClose() && !this.busy) this.close();
    });
    this.data = null;
    this.sel = {}; // cat -> Set(tipos)
    this.open_ = new Set(["producoes"]);
    this.order = "tipo"; // tipo = por atividade (ordem do Lattes)
    this.presets = [];
    this.busy = false;
  }

  async open() {
    this.overlay.style.display = "flex";
    this.overlay.innerHTML = `<div class="modal-dialog rb-dialog"><div class="loading-state" style="display:flex"><div class="spinner"></div><span>Carregando dados do currículo...</span></div></div>`;
    try {
      const [data, profile, version, presets, last] = await Promise.all([
        api.getAllRecords(),
        loadProfile().catch(() => null),
        api.getAppVersion().catch(() => "1.0.0"),
        api.getSetting(PRESETS_KEY).catch(() => null),
        api.getSetting(LAST_KEY).catch(() => null),
      ]);
      this.data = data || {};
      this.version = version;
      this.presets = Array.isArray(presets) ? presets : [];
      this.years = [...new Set(Object.values(this.data).flat().map((r) => r.ano).filter((y) => y > 1950 && y < 2100))].sort((a, b) => a - b);
      this.from = this.years[0];
      this.to = this.years[this.years.length - 1];
      this.prof = profile || { values: {}, include: {}, extras: [] };
      const p = this.prof.values;
      this.form = {
        title: last?.title || "Comprovantes do Currículo Lattes",
        nome: p.nome || "",
        resumo: p.resumo || "",
        include: { ...this.prof.include },
        includeResumo: last?.includeResumo ?? (Boolean(p.resumo) && this.prof.include.resumo !== false),
        pages: last?.pages === "first" ? "first" : "all",
      };
      // ordem salva antes da v1.7 era "Ano ↓" por padrão: passa a valer a ordem por atividade
      if (last?.sel) this.applySel(last.sel, last.from, last.to, last.orderV === 2 ? last.order : "tipo");
      else this.preset("artigos");
      this.render();
    } catch (err) {
      this.close();
      showToast(`Falha ao abrir o gerador: ${err}`, "error", 6000);
    }
  }

  close() {
    this.overlay.style.display = "none";
    this.overlay.innerHTML = "";
  }

  tiposOf(cat) {
    const c = {};
    for (const r of this.data[cat] || []) c[r.tipo || "Sem tipo"] = (c[r.tipo || "Sem tipo"] || 0) + 1;
    return Object.entries(c).sort((a, b) => compareActivity(cat, a[0], b[0]));
  }

  applySel(sel, from, to, order) {
    this.sel = {};
    for (const [k, v] of Object.entries(sel || {})) if (CATEGORY_SCHEMAS[k]) this.sel[k] = new Set(v);
    if (from && this.years.includes(from)) this.from = from;
    if (to && this.years.includes(to)) this.to = to;
    if (order) this.order = order;
  }

  preset(kind) {
    this.sel = {};
    const prod = this.tiposOf("producoes").map(([t]) => t);
    if (kind === "tudo") {
      for (const c of Object.keys(CATEGORY_SCHEMAS)) this.sel[c] = new Set(this.tiposOf(c).map(([t]) => t));
    } else if (kind === "artigos") {
      this.sel.producoes = new Set(prod.filter((t) => /artigo/i.test(t)));
    } else if (kind === "artres") {
      this.sel.producoes = new Set(prod.filter((t) => /artigo|resumo/i.test(t)));
    } else if (kind === "resumido") {
      // artigos, resumos, bancas, orientações e patentes
      this.sel.producoes = new Set(prod.filter((t) => /artigo|resumo/i.test(t)));
      for (const c of ["bancas", "orientacoes", "patentes"]) this.sel[c] = new Set(this.tiposOf(c).map(([t]) => t));
    }
    this.from = this.years[0];
    this.to = this.years[this.years.length - 1];
  }

  inRange(r) {
    const full = this.from === this.years[0] && this.to === this.years[this.years.length - 1];
    if (r.ano == null || !(r.ano > 1950)) return full;
    return r.ano >= this.from && r.ano <= this.to;
  }

  /** Seções finais, na ordem das categorias, já filtradas e ordenadas. */
  sections() {
    const out = [];
    for (const [cat, schema] of Object.entries(CATEGORY_SCHEMAS)) {
      const set = this.sel[cat];
      if (!set || !set.size) continue;
      const recs = (this.data[cat] || []).filter((r) => set.has(r.tipo || "Sem tipo") && this.inRange(r));
      if (!recs.length) continue;
      // atividade (ordem do Lattes) → ano mais recente → título; nunca a ordem de cadastro
      const act = (a, b) => compareActivity(cat, a.tipo || "Sem tipo", b.tipo || "Sem tipo");
      const desc = (a, b) => (b.ano || 0) - (a.ano || 0);
      const label = (r) => String(describe(cat, r).title || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const byTitle = (a, b) => label(a).localeCompare(label(b), "pt-BR");
      recs.sort((a, b) => {
        if (this.order === "tipo") return act(a, b) || desc(a, b) || byTitle(a, b);
        const y = this.order === "asc" ? -desc(a, b) : desc(a, b);
        return y || act(a, b) || byTitle(a, b);
      });
      out.push({
        cat,
        name: schema.group,
        color: PALETTE[cat] || "#6366f1",
        grouped: this.order === "tipo",
        items: recs.map((r) => ({ ...describe(cat, r), ano: r.ano, tipo: r.tipo, path: r.path && r.path.trim() ? r.path : null })),
      });
    }
    return out;
  }

  render() {
    const secs = this.sections();
    const nItems = secs.reduce((a, s) => a + s.items.length, 0);
    const nFiles = secs.reduce((a, s) => a + s.items.filter((i) => i.path).length, 0);
    const f = this.form;
    const yearOpts = (v) => this.years.map((y) => `<option ${y === v ? "selected" : ""}>${y}</option>`).join("");

    const cats = Object.entries(CATEGORY_SCHEMAS)
      .map(([cat, schema]) => {
        const tipos = this.tiposOf(cat);
        if (!tipos.length) return "";
        const set = this.sel[cat] || new Set();
        const all = tipos.every(([t]) => set.has(t));
        const some = !all && tipos.some(([t]) => set.has(t));
        const n = (this.data[cat] || []).filter((r) => set.has(r.tipo || "Sem tipo") && this.inRange(r)).length;
        const isOpen = this.open_.has(cat);
        return `<div class="rb-cat ${set.size ? "on" : ""}" style="--c:${PALETTE[cat]}">
          <div class="rb-cat-h">
            <label class="rb-check"><input type="checkbox" data-cat-all="${cat}" ${all ? "checked" : ""} ${some ? 'data-ind="1"' : ""}/><i></i></label>
            <button type="button" class="rb-cat-name" data-toggle="${cat}">
              <span class="dot"></span>${escapeHtml(schema.group)}
              <span class="rb-count">${n ? `${n} selecionado(s)` : ""}</span>
              <span class="chev ${isOpen ? "up" : ""}">⌄</span>
            </button>
          </div>
          ${isOpen ? `<div class="rb-tipos">${tipos
            .map(([t, c]) => `<button type="button" class="rb-tipo ${set.has(t) ? "on" : ""}" data-cat="${cat}" data-tipo="${escapeHtml(t)}">${escapeHtml(t)}<b>${c}</b></button>`)
            .join("")}</div>` : ""}
        </div>`;
      })
      .join("");

    this.overlay.innerHTML = `
      <div class="modal-dialog rb-dialog">
        <header class="rb-head">
          <div>
            <span class="rb-kicker">Lattes Manager</span>
            <h2>Gerar comprovantes em PDF</h2>
            <p>Escolha o que incluir. O resultado é um PDF único com capa, sumário, listas numeradas e os comprovantes anexados.</p>
          </div>
          <button type="button" class="btn-close-modal rb-x" data-x="close">&times;</button>
        </header>
        <div class="rb-body">
          <section class="rb-main">
            <div class="rb-block">
              <div class="rb-label">Modelos rápidos</div>
              <div class="rb-presets">
                <button type="button" class="rb-preset" data-preset="artigos">📰 Só artigos</button>
                <button type="button" class="rb-preset" data-preset="artres">📄 Artigos + resumos</button>
                <button type="button" class="rb-preset" data-preset="resumido" title="Artigos, resumos, bancas, orientações e patentes">🧾 Resumido</button>
                <button type="button" class="rb-preset" data-preset="tudo">📚 Tudo</button>
                <button type="button" class="rb-preset" data-preset="nada">✕ Limpar</button>
                ${this.presets
                  .map((p, i) => `<span class="rb-preset saved"><button type="button" data-saved="${i}">⭐ ${escapeHtml(p.name)}</button><button type="button" class="rm" data-rm-saved="${i}" title="Excluir modelo">&times;</button></span>`)
                  .join("")}
                <button type="button" class="rb-preset ghost" data-x="save-preset">+ Salvar seleção como modelo</button>
              </div>
            </div>
            <div class="rb-block rb-row">
              <div>
                <div class="rb-label">Período</div>
                <div class="rb-period">
                  <select id="rb-from" class="form-select">${yearOpts(this.from)}</select>
                  <span>até</span>
                  <select id="rb-to" class="form-select">${yearOpts(this.to)}</select>
                </div>
              </div>
              <div>
                <div class="rb-label">Ordenar itens por</div>
                <div class="seg">
                  ${[["tipo", "Atividade"], ["desc", "Ano ↓"], ["asc", "Ano ↑"]].map(([k, t]) => `<button type="button" data-order="${k}" class="${this.order === k ? "on" : ""}">${t}</button>`).join("")}
                </div>
              </div>
            </div>
            <div class="rb-block">
              <div class="rb-label">Seções e tipos <span class="muted">— clique na categoria para escolher os tipos</span></div>
              <div class="rb-cats">${cats}</div>
            </div>
          </section>
          <aside class="rb-side">
            <div class="rb-label">Capa e identificação</div>
            <label class="rb-field"><span>Título do documento</span><input class="form-input" data-f="title" value="${escapeHtml(f.title)}"/></label>
            <label class="rb-field"><span>Nome</span><input class="form-input" data-f="nome" value="${escapeHtml(f.nome)}"/></label>
            <div class="rb-fields-head"><span>Dados na capa</span><button type="button" class="rb-link" data-x="profile">✏️ Editar em Dados Gerais</button></div>
            <div class="rb-pfields">
              ${this.profileOptions()
                .map(
                  ([k, label, val]) => `<label class="rb-pf ${f.include[k] ? "on" : ""}" title="${escapeHtml(val)}"><input type="checkbox" data-inc="${escapeHtml(k)}" ${f.include[k] ? "checked" : ""}/>
                  <span><b>${escapeHtml(label)}</b><small>${escapeHtml(val)}</small></span></label>`
                )
                .join("") || '<div class="muted" style="font-size:12px">Nenhum dado no perfil. Preencha em Dados Gerais.</div>'}
            </div>
            <label class="rb-switch ${f.resumo ? "" : "disabled"}"><input type="checkbox" data-f="includeResumo" ${f.includeResumo && f.resumo ? "checked" : ""} ${f.resumo ? "" : "disabled"}/><i></i>
              <span>Incluir página com o resumo do CV${f.resumo ? "" : " (não encontrado no XML)"}</span></label>
            <div class="rb-label" style="margin-top:8px">Páginas de cada comprovante</div>
            <div class="seg rb-pages">
              <button type="button" data-pages="all" class="${f.pages === "all" ? "on" : ""}">Todas as páginas</button>
              <button type="button" data-pages="first" class="${f.pages === "first" ? "on" : ""}">Só a 1ª página</button>
            </div>
            <div class="rb-summary">
              <div><b>${secs.length}</b><span>seções</span></div>
              <div><b>${nItems}</b><span>itens</span></div>
              <div><b>${nFiles}</b><span>comprovantes</span></div>
            </div>
            ${nItems - nFiles > 0 ? `<div class="rb-note">⚠️ ${nItems - nFiles} item(ns) sem comprovante aparecerão na lista marcados como “sem comprovante”.
              <button type="button" class="rb-link" data-x="linker">🔎 Procurar os arquivos nas pastas</button></div>` : ""}
            <button type="button" class="btn btn-primary rb-go" data-x="generate" ${nItems ? "" : "disabled"}>📑 Gerar PDF</button>
            <div class="rb-sign">Rodapé: “Gerado com Lattes Manager v${escapeHtml(this.version)} · data · página”</div>
          </aside>
        </div>
      </div>`;
    this.bind();
  }

  bind() {
    const o = this.overlay;
    o.querySelectorAll('[data-x="close"]').forEach((b) => b.addEventListener("click", () => this.close()));
    o.querySelectorAll("[data-ind]").forEach((c) => (c.indeterminate = true));
    o.querySelectorAll("[data-preset]").forEach((b) =>
      b.addEventListener("click", () => {
        this.preset(b.dataset.preset);
        this.render();
      })
    );
    o.querySelectorAll("[data-saved]").forEach((b) =>
      b.addEventListener("click", () => {
        const p = this.presets[Number(b.dataset.saved)];
        this.applySel(p.sel, p.from, p.to, p.orderV === 2 ? p.order : "tipo");
        if (p.title) this.form.title = p.title;
        if (p.pages) this.form.pages = p.pages;
        this.render();
      })
    );
    o.querySelectorAll("[data-rm-saved]").forEach((b) =>
      b.addEventListener("click", async () => {
        this.presets.splice(Number(b.dataset.rmSaved), 1);
        await api.setSetting(PRESETS_KEY, this.presets).catch(() => {});
        this.render();
      })
    );
    o.querySelector('[data-x="save-preset"]').addEventListener("click", async () => {
      const name = window.prompt("Nome do modelo (ex.: Progressão docente 2026):");
      if (!name || !name.trim()) return;
      this.presets.push({ name: name.trim(), ...this.snapshot() });
      try {
        await api.setSetting(PRESETS_KEY, this.presets);
        showToast("Modelo salvo", "success", 1800);
      } catch (e) {
        showToast(`Erro ao salvar modelo: ${e}`, "error");
      }
      this.render();
    });
    o.querySelector("#rb-from").addEventListener("change", (e) => {
      this.from = Number(e.target.value);
      if (this.from > this.to) this.to = this.from;
      this.render();
    });
    o.querySelector("#rb-to").addEventListener("change", (e) => {
      this.to = Number(e.target.value);
      if (this.to < this.from) this.from = this.to;
      this.render();
    });
    o.querySelectorAll("[data-order]").forEach((b) =>
      b.addEventListener("click", () => {
        this.order = b.dataset.order;
        this.render();
      })
    );
    o.querySelectorAll("[data-toggle]").forEach((b) =>
      b.addEventListener("click", () => {
        const c = b.dataset.toggle;
        this.open_.has(c) ? this.open_.delete(c) : this.open_.add(c);
        this.render();
      })
    );
    o.querySelectorAll("[data-cat-all]").forEach((c) =>
      c.addEventListener("change", () => {
        const cat = c.dataset.catAll;
        this.sel[cat] = c.checked ? new Set(this.tiposOf(cat).map(([t]) => t)) : new Set();
        this.render();
      })
    );
    o.querySelectorAll("[data-tipo]").forEach((b) =>
      b.addEventListener("click", () => {
        const cat = b.dataset.cat;
        const set = (this.sel[cat] ||= new Set());
        set.has(b.dataset.tipo) ? set.delete(b.dataset.tipo) : set.add(b.dataset.tipo);
        this.render();
      })
    );
    o.querySelectorAll("[data-f]").forEach((i) =>
      i.addEventListener(i.type === "checkbox" ? "change" : "input", () => {
        this.form[i.dataset.f] = i.type === "checkbox" ? i.checked : i.value;
      })
    );
    o.querySelectorAll("[data-pages]").forEach((b) =>
      b.addEventListener("click", () => {
        this.form.pages = b.dataset.pages;
        this.render();
      })
    );
    o.querySelector('[data-x="linker"]')?.addEventListener("click", () => {
      this.close();
      this.onLink && this.onLink();
    });
    o.querySelectorAll("[data-inc]").forEach((c) =>
      c.addEventListener("change", () => {
        this.form.include[c.dataset.inc] = c.checked;
        c.closest(".rb-pf").classList.toggle("on", c.checked);
      })
    );
    o.querySelector('[data-x="profile"]')?.addEventListener("click", () => {
      this.close();
      this.onEditProfile && this.onEditProfile();
    });
    o.querySelector('[data-x="generate"]').addEventListener("click", () => this.generate());
  }

  /** [chave, rótulo, valor] dos campos preenchidos do perfil (exceto nome e resumo). */
  profileOptions() {
    const v = this.prof.values;
    const out = PROFILE_FIELDS.filter(([k]) => k !== "nome" && String(v[k] || "").trim()).map(([k, l]) => [k, l, String(v[k]).trim()]);
    (this.prof.extras || []).forEach((x, i) => {
      if (x.label && x.value) {
        const k = `extra:${i}`;
        if (!(k in this.form.include)) this.form.include[k] = Boolean(x.include);
        out.push([k, x.label, x.value]);
      }
    });
    return out;
  }

  snapshot() {
    const sel = {};
    for (const [k, v] of Object.entries(this.sel)) if (v.size) sel[k] = [...v];
    return { sel, from: this.from, to: this.to, order: this.order, orderV: 2, title: this.form.title, includeResumo: this.form.includeResumo, pages: this.form.pages };
  }

  async generate() {
    const secs = this.sections();
    if (!secs.length) return;
    const safeName = (this.form.nome || "Lattes").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_");
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let target;
    try {
      target = await api.selectSavePath(`Comprovantes_${safeName}_${stamp}.pdf`);
    } catch (e) {
      return showToast(`Erro: ${e}`, "error");
    }
    if (!target) return;
    api.setSetting(LAST_KEY, this.snapshot()).catch(() => {});

    this.busy = true;
    const dlg = this.overlay.querySelector(".rb-dialog");
    const prog = document.createElement("div");
    prog.className = "rb-progress";
    prog.innerHTML = `<div class="rb-progress-card">
        <div class="rb-orb"></div>
        <h3>Montando seu PDF…</h3>
        <p class="rb-step">Carregando bibliotecas</p>
        <div class="rb-bar"><div class="rb-bar-fill" style="width:0%"></div></div>
        <span class="rb-pct">0%</span>
      </div>`;
    dlg.appendChild(prog);
    const step = prog.querySelector(".rb-step");
    const fill = prog.querySelector(".rb-bar-fill");
    const pct = prog.querySelector(".rb-pct");

    try {
      await loadLibs();
      const first = this.years[0], last = this.years[this.years.length - 1];
      const periodLabel = this.from === first && this.to === last ? `${first} – ${last} (todo o período)` : `${this.from} – ${this.to}`;
      const rows = this.profileOptions().filter(([k]) => this.form.include[k]).map(([, l, v]) => [l, v]);
      const res = await (await import("../pdf/buildReport.js")).buildReport({
        profile: { nome: this.form.nome, resumo: this.form.resumo, rows },
        title: this.form.title,
        subtitle: secs.map((s) => s.name).join(" · "),
        periodLabel,
        includeResumo: this.form.includeResumo,
        firstPageOnly: this.form.pages === "first",
        sections: secs,
        version: this.version,
        onProgress: ({ done, total, label }) => {
          const v = Math.round((done / total) * 100);
          fill.style.width = `${v}%`;
          pct.textContent = `${v}% · ${done}/${total} comprovantes`;
          step.textContent = label;
        },
      });
      step.textContent = "Salvando arquivo…";
      const saved = await api.writeReport(res.bytes);
      const mb = (res.bytes.length / 1048576).toFixed(1);
      prog.innerHTML = `<div class="rb-progress-card done">
          <div class="rb-check-big">✓</div>
          <h3>PDF gerado!</h3>
          <p>${res.pages} páginas · ${res.attached} comprovantes · ${mb} MB</p>
          <p class="rb-path">${escapeHtml(saved)}</p>
          ${res.failed.length ? `<details class="rb-failed"><summary>⚠️ ${res.failed.length} comprovante(s) não incorporado(s)</summary><ul>${res.failed.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></details>` : ""}
          <div class="rb-done-actions">
            <button type="button" class="btn btn-primary" data-d="view">Abrir no visualizador</button>
            <button type="button" class="btn btn-secondary" data-d="folder">Mostrar na pasta</button>
            <button type="button" class="btn btn-secondary" data-d="close">Fechar</button>
          </div>
        </div>`;
      prog.querySelector('[data-d="view"]').addEventListener("click", () => {
        this.busy = false;
        this.close();
        this.previewer.openAbsolute(saved);
        this.previewer.drawer.classList.contains("expanded") || this.previewer.toggleExpanded();
      });
      prog.querySelector('[data-d="folder"]').addEventListener("click", () => api.revealInExplorer(saved).catch(() => {}));
      prog.querySelector('[data-d="close"]').addEventListener("click", () => {
        this.busy = false;
        this.close();
      });
    } catch (err) {
      console.error(err);
      prog.remove();
      this.busy = false;
      showToast(`Falha ao gerar PDF: ${err?.message || err}`, "error", 8000);
    }
  }
}
