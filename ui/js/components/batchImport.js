// Importação em lote: uma pasta (ou vários arquivos) de comprovantes de uma vez.
// Cada arquivo é classificado (categoria + tipo), tem os campos extraídos e é comparado com os
// registros já cadastrados. Você revisa tudo numa tabela e importa de uma vez.

import { api } from "../api.js";
import { easyClose } from "../theme.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../utils.js";
import { PALETTE } from "./charts.js";
import { ocrImage } from "./docAnalyzer.js";

const IMG = /\.(png|jpe?g)$/i;
const MAIN_FIELDS = ["titulo", "disciplina", "descricao", "aluno"];
const EXTRA_FIELDS = ["journal", "identifier", "qualis", "horas", "aluno", "disciplina", "curso", "descricao"];

const mb = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const stem = (name) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/^\d{1,4}[_\-\s]+/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Campo principal (o "título") de uma categoria. */
function mainField(cat) {
  const names = (CATEGORY_SCHEMAS[cat]?.fields || []).map((f) => f.name);
  return MAIN_FIELDS.find((n) => names.includes(n)) || "descricao";
}
const hasField = (cat, name) => (CATEGORY_SCHEMAS[cat]?.fields || []).some((f) => f.name === name);

export class BatchImport {
  constructor({ getMappings, previewer, onDone }) {
    this.getMappings = getMappings;
    this.previewer = previewer;
    this.onDone = onDone;
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";
    this.overlay.style.display = "none";
    document.getElementById("app").appendChild(this.overlay);
    this.overlay.addEventListener("click", (e) => e.target === this.overlay && easyClose() && this.phase === "setup" && this.close());
  }

  /** Abre o assistente; `files` (opcional) vem do arrastar-e-soltar. */
  open(files = null) {
    this.phase = "setup";
    this.bulkCat = "";
    this.bulkTipo = "";
    this.files = [];
    this.folder = null;
    this.recursive = true;
    this.mode ??= "auto";
    this.tipoFixo ??= "";
    this.online ??= true;
    this.ocr ??= true;
    this.rows = [];
    this.result = null;
    this.overlay.style.display = "flex";
    if (files && files.length) {
      this.files = files.map((p) => (typeof p === "string" ? { path: p, name: p.split(/[\\/]/).pop(), size: 0 } : p));
    }
    this.render();
  }

  close() {
    this.cancel = true;
    this.overlay.style.display = "none";
    this.overlay.innerHTML = "";
    this.phase = null;
  }

  tiposOf(cat) {
    const g = (CATEGORY_SCHEMAS[cat]?.dbGroup || CATEGORY_SCHEMAS[cat]?.group)?.toLowerCase();
    return (this.getMappings() || []).filter((m) => m.category_group.toLowerCase() === g);
  }

  folderOf(cat, tipo) {
    const ms = this.tiposOf(cat);
    return (ms.find((m) => m.description === tipo) || ms[0])?.folder || null;
  }

  render() {
    const body = { setup: () => this.renderSetup(), analyze: () => this.renderAnalyze(), review: () => this.renderReview(), import: () => this.renderImport(), done: () => this.renderDone() }[this.phase];
    body && body();
  }

  shell(sub, body, foot, wide = false) {
    this.overlay.innerHTML = `<div class="modal-dialog bi-dialog ${wide ? "wide" : ""}">
        <header class="da-head"><div><span class="rb-kicker">Importação em lote</span><h2>Importar vários comprovantes</h2><p>${sub}</p></div>
          ${this.phase === "setup" || this.phase === "review" || this.phase === "done" ? '<button type="button" class="btn-close-modal" data-x>&times;</button>' : ""}</header>
        <div class="bi-body">${body}</div>
        <footer class="modal-footer bi-foot">${foot}</footer>
      </div>`;
    this.overlay.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => this.close()));
  }

  // ---------------------------------------------------------------- 1. origem e opções
  renderSetup() {
    const total = this.files.reduce((a, f) => a + (f.size || 0), 0);
    const cats = Object.entries(CATEGORY_SCHEMAS);
    const tipos = this.mode !== "auto" ? this.tiposOf(this.mode) : [];
    const nPdf = this.files.filter((f) => /\.pdf$/i.test(f.path)).length;
    this.shell(
      "Escolha uma pasta ou vários arquivos (PDF ou imagem). O app identifica cada documento, preenche os campos e você revisa antes de salvar.",
      `<div class="bi-src">
          <button type="button" class="bi-pick" data-a="folder"><span>📁</span><b>Escolher pasta</b><small>todos os PDFs e imagens da pasta</small></button>
          <button type="button" class="bi-pick" data-a="files"><span>📄</span><b>Escolher arquivos</b><small>selecione vários com Ctrl ou Shift</small></button>
        </div>
        ${
          this.files.length
            ? `<div class="bi-sel"><div><b>${this.files.length} arquivo(s)</b>${total ? ` · ${mb(total)}` : ""} · ${nPdf} PDF, ${this.files.length - nPdf} imagem(ns)
                ${this.folder ? `<small>${escapeHtml(this.folder)}</small>` : ""}</div>
                ${this.folder ? `<label class="bi-chk"><input type="checkbox" data-o="recursive" ${this.recursive ? "checked" : ""}/> incluir subpastas</label>` : ""}
                <button type="button" class="btn-icon-subtle" data-a="clear">Limpar</button></div>
               <ul class="bi-names">${this.files.slice(0, 8).map((f) => `<li>${escapeHtml(f.name)}</li>`).join("")}${this.files.length > 8 ? `<li class="muted">… e mais ${this.files.length - 8}</li>` : ""}</ul>`
            : this.folder
              ? `<div class="tl-empty">Nenhum PDF ou imagem em <b>${escapeHtml(this.folder)}</b>${this.recursive ? "" : " (experimente incluir as subpastas)"}.
                 <br><label class="bi-chk"><input type="checkbox" data-o="recursive" ${this.recursive ? "checked" : ""}/> incluir subpastas</label></div>`
              : ""
        }
        <div class="bi-opts">
          <label class="rb-field"><span>Cadastrar em</span>
            <select class="form-select" data-o="mode">
              <option value="auto" ${this.mode === "auto" ? "selected" : ""}>✨ Automático — o app identifica a categoria de cada arquivo</option>
              ${cats.map(([k, s]) => `<option value="${k}" ${this.mode === k ? "selected" : ""}>${escapeHtml(s.group)}</option>`).join("")}
            </select></label>
          ${
            this.mode !== "auto"
              ? `<label class="rb-field"><span>Tipo</span><select class="form-select" data-o="tipoFixo">
                  <option value="">✨ Automático (sugerido para cada arquivo)</option>
                  ${tipos.map((m) => `<option ${m.description === this.tipoFixo ? "selected" : ""}>${escapeHtml(m.description)}</option>`).join("")}</select></label>`
              : ""
          }
          <label class="bi-chk"><input type="checkbox" data-o="online" ${this.online ? "checked" : ""}/> <span><b>Consultar a Crossref</b> para artigos com DOI (título, periódico, ano e Qualis) — requer internet</span></label>
          <label class="bi-chk"><input type="checkbox" data-o="ocr" ${this.ocr ? "checked" : ""}/> <span><b>Ler imagens e PDFs digitalizados (OCR)</b> — mais preciso, porém mais lento</span></label>
        </div>`,
      `<button type="button" class="btn btn-secondary" data-x>Cancelar</button><span style="flex:1"></span>
       <button type="button" class="btn btn-primary" data-a="go" ${this.files.length ? "" : "disabled"}>Analisar ${this.files.length || ""} arquivo(s) →</button>`
    );
    const o = this.overlay;
    const on = (k, fn) => o.querySelector(`[data-a="${k}"]`)?.addEventListener("click", fn);
    on("folder", async () => {
      const dir = await api.pickFolder("Pasta com os comprovantes").catch((e) => showToast(String(e), "error"));
      if (!dir) return;
      this.folder = dir;
      await this.listFolder();
    });
    on("files", async () => {
      try {
        const fs = (await api.pickFiles()) || [];
        if (!fs.length) return;
        this.folder = null;
        const seen = new Set(this.files.map((f) => f.path.toLowerCase()));
        this.files = [...this.files, ...fs.filter((f) => !seen.has(f.path.toLowerCase()))];
        this.render();
      } catch (e) {
        showToast(String(e), "error");
      }
    });
    on("clear", () => {
      this.files = [];
      this.folder = null;
      this.render();
    });
    on("go", () => this.analyzeAll());
    o.querySelectorAll("[data-o]").forEach((el) =>
      el.addEventListener("change", async () => {
        const k = el.dataset.o;
        this[k] = el.type === "checkbox" ? el.checked : el.value;
        if (k === "mode") this.tipoFixo = "";
        if (k === "recursive" && this.folder) return this.listFolder();
        this.render();
      })
    );
  }

  async listFolder() {
    try {
      this.files = (await api.listFolderFiles(this.folder, this.recursive)) || [];
    } catch (e) {
      this.files = [];
      showToast(String(e), "error");
    }
    this.render();
  }

  // ---------------------------------------------------------------- 2. análise
  async analyzeAll() {
    this.phase = "analyze";
    this.cancel = false;
    this.rows = [];
    this.done = 0;
    this.render();
    try {
      this.existing = (await api.getAllRecords()) || {};
    } catch {
      this.existing = {};
    }
    this.claimed = new Set();
    for (const f of this.files) {
      if (this.cancel) break;
      this.current = f.name;
      this.ocrPct = null;
      this.renderAnalyze();
      const row = await this.analyzeOne(f);
      this.rows.push(row);
      this.done++;
    }
    if (this.phase !== "analyze") return; // fechado
    this.phase = "review";
    this.render();
  }

  renderAnalyze() {
    if (this.phase !== "analyze") return;
    const n = this.files.length;
    const pct = Math.round((this.done / Math.max(1, n)) * 100);
    this.shell(
      "Lendo e classificando cada documento…",
      `<div class="da-loading bi-loading"><div class="da-orb"></div>
        <b>${this.done} de ${n} analisado(s)</b>
        <span class="bi-cur">${escapeHtml(this.current || "")}${this.ocrPct != null ? ` · OCR ${Math.round(this.ocrPct * 100)}%` : ""}</span>
        <div class="tl-progress"><i style="width:${pct}%"></i></div></div>`,
      `<span style="flex:1"></span><button type="button" class="btn btn-secondary" data-a="stop">${this.cancel ? "Parando…" : "Parar e revisar o que já foi lido"}</button>`
    );
    this.overlay.querySelector('[data-a="stop"]').addEventListener("click", () => {
      this.cancel = true;
      this.renderAnalyze();
    });
  }

  async ocrAnalyze(path, getBytes, hint = 0) {
    const bytes = await getBytes();
    const text = await ocrImage(bytes, (p, st) => {
      if (/recogniz/i.test(st)) {
        this.ocrPct = p;
        const el = this.overlay.querySelector(".bi-cur");
        if (el) el.textContent = `${this.current} · OCR ${Math.round(p * 100)}%`;
      }
    }, hint);
    return api.analyzeDocument(path, text);
  }

  /** Lê um arquivo e monta a linha da revisão. */
  async analyzeOne(f) {
    const row = { file: f, include: true, cat: null, tipo: null, ano: "", text: "", extra: {}, conf: 0, matches: [], action: "create", note: "", error: null };
    let res = null;
    try {
      if (IMG.test(f.path)) {
        res = this.ocr ? await this.ocrAnalyze(f.path, () => api.readImageFile(f.path)) : await api.analyzeDocument(f.path, "");
      } else {
        res = await api.analyzeDocument(f.path);
        if (res.needs_ocr && this.ocr) {
          const rot = await api.pdfRotation(f.path).catch(() => 0);
          res = (await this.ocrAnalyze(f.path, () => api.pdfScanImage(f.path), rot).catch(() => null)) || res;
        }
      }
    } catch (e) {
      row.error = String(e);
    }
    const c = res?.campos || {};
    const sug = (res?.sugestoes || []).filter((s) => CATEGORY_SCHEMAS[s.category]);
    row.sug = sug;
    // categoria e tipo
    if (this.mode !== "auto") {
      row.cat = this.mode;
      const s = sug.find((x) => x.category === row.cat);
      row.conf = s ? s.prob : 0;
      row.tipo = this.tipoFixo || s?.tipo || null;
    } else {
      row.cat = sug[0]?.category || "producoes";
      row.tipo = sug[0]?.tipo || null;
      row.conf = sug[0]?.prob || 0;
    }
    this.fixTipo(row);
    row.ano = c.ano || "";
    row.extra = { horas: c.horas, aluno: c.aluno, disciplina: c.disciplina, curso: c.curso, descricao: c.descricao, identifier: c.doi };
    const main = mainField(row.cat);
    row.text = (main === "titulo" ? c.titulo || (row.cat.startsWith("x_") ? c.descricao : null) : main === "descricao" ? c.descricao || c.titulo : c[main]) || "";

    // produções: DOI / Crossref
    if (row.cat === "producoes" && /\.pdf$/i.test(f.path)) {
      const md = await api.extractPdfMetadata(f.path, this.online).catch(() => null);
      if (md) {
        row.text = md.titulo || row.text;
        row.ano = md.ano || row.ano;
        row.extra.journal = md.journal || null;
        row.extra.identifier = md.doi || row.extra.identifier;
        row.extra.qualis = md.qualis_sugerido || null;
        if (!this.tipoFixo && md.tipo_sugerido && this.tiposOf("producoes").some((m) => m.description === md.tipo_sugerido)) row.tipo = md.tipo_sugerido;
        if (md.duplicata) {
          const rec = (this.existing.producoes || []).find((r) => r.id === md.duplicata.id);
          row.matches.push({ category: "producoes", id: md.duplicata.id, label: md.duplicata.titulo, score: 1, dup: true, hasFile: Boolean(rec?.path), motivo: md.duplicata.motivo });
        }
      }
    }
    if (!row.text) row.text = stem(f.name);

    // registros já cadastrados sem comprovante que batem com o documento
    for (const m of res?.registros || []) {
      if (this.mode !== "auto" && m.category !== this.mode) continue;
      if (row.matches.some((x) => x.category === m.category && x.id === m.id)) continue;
      const rec = (this.existing[m.category] || []).find((r) => r.id === m.id);
      row.matches.push({ ...m, hasFile: Boolean(rec?.path) });
    }
    // ação padrão: anexar ao registro existente (se ainda não tiver comprovante), pular duplicatas completas
    const best = row.matches.find((m) => !m.hasFile && (m.dup || m.score >= 0.5) && !this.claimed.has(`${m.category}:${m.id}`));
    const dupFull = row.matches.find((m) => m.dup && m.hasFile);
    if (best) {
      row.action = `attach:${best.category}:${best.id}`;
      this.claimed.add(`${best.category}:${best.id}`);
    } else if (dupFull) {
      row.action = "skip";
      row.note = `já cadastrado com comprovante (#${dupFull.id})`;
    }
    if (row.error) {
      row.note = row.error;
      if (!res) row.conf = 0;
    }
    return row;
  }

  /** Garante um tipo válido para a categoria da linha. */
  fixTipo(row) {
    const ms = this.tiposOf(row.cat);
    if (!ms.some((m) => m.description === row.tipo)) {
      const s = (row.sug || []).find((x) => x.category === row.cat);
      row.tipo = s && ms.some((m) => m.description === s.tipo) ? s.tipo : ms[0]?.description || row.tipo || "";
    }
  }

  // ---------------------------------------------------------------- 3. revisão
  counts() {
    const inc = this.rows.filter((r) => r.include && r.action !== "skip");
    return {
      novos: inc.filter((r) => r.action === "create").length,
      anexos: inc.filter((r) => r.action.startsWith("attach")).length,
      pular: this.rows.length - inc.length,
    };
  }

  renderReview() {
    const k = this.counts();
    const cats = Object.entries(CATEGORY_SCHEMAS);
    const color = (cat) => PALETTE[cat] || CATEGORY_SCHEMAS[cat]?.color || "#6366f1";
    const pct = (p) => `${Math.round(p * 100)}%`;
    const allOn = this.rows.every((r) => r.include);
    const label = (cat) => CATEGORY_SCHEMAS[cat]?.group || cat;
    const rowsHtml = this.rows
      .map((r, i) => {
        const tipos = this.tiposOf(r.cat);
        const lowConf = this.mode === "auto" && r.conf < 0.45;
        const isAttach = r.action.startsWith("attach");
        return `<tr class="${r.include && r.action !== "skip" ? "" : "off"} ${r.error ? "err" : ""}" data-i="${i}">
          <td><input type="checkbox" data-f="include" ${r.include ? "checked" : ""}/></td>
          <td class="bi-file"><button type="button" class="bi-fname" data-prev="${i}" title="${escapeHtml(r.file.path)}">${IMG.test(r.file.name) ? "🖼️" : "📄"} ${escapeHtml(r.file.name)}</button>
            ${this.mode === "auto" ? `<span class="bi-conf ${r.conf >= 0.7 ? "hi" : r.conf >= 0.45 ? "mid" : "lo"}" title="Confiança da classificação">${pct(r.conf)}</span>` : ""}
            ${r.note ? `<small class="bi-note">${escapeHtml(r.note)}</small>` : ""}</td>
          <td><select class="form-select bi-cat ${lowConf ? "warn" : ""}" data-f="cat" style="--c:${color(r.cat)}" ${isAttach ? "disabled" : ""}>${cats.map(([key, s]) => `<option value="${key}" ${key === r.cat ? "selected" : ""}>${escapeHtml(s.group)}</option>`).join("")}</select></td>
          <td><select class="form-select" data-f="tipo" ${isAttach ? "disabled" : ""}>${tipos.map((m) => `<option ${m.description === r.tipo ? "selected" : ""}>${escapeHtml(m.description)}</option>`).join("")}</select></td>
          <td><input class="form-input bi-ano" data-f="ano" inputmode="numeric" value="${escapeHtml(String(r.ano || ""))}" placeholder="ano" ${isAttach ? "disabled" : ""}/></td>
          <td><input class="form-input" data-f="text" value="${escapeHtml(r.text)}" placeholder="${escapeHtml(mainField(r.cat))}" ${isAttach ? "disabled" : ""}/>
            ${r.extra.journal || r.extra.identifier ? `<small class="bi-meta">${escapeHtml([r.extra.journal, r.extra.identifier && /^10\./.test(r.extra.identifier) ? `DOI ${r.extra.identifier}` : null, r.extra.qualis ? `Qualis ${r.extra.qualis}` : null].filter(Boolean).join(" · "))}</small>` : ""}</td>
          <td><select class="form-select bi-act" data-f="action">
              <option value="create" ${r.action === "create" ? "selected" : ""}>➕ Criar registro</option>
              ${r.matches
                .map((m) => {
                  const v = `attach:${m.category}:${m.id}`;
                  const t = `📎 Anexar a #${m.id} ${label(m.category)} — ${String(m.label || "").slice(0, 40)}${m.dup ? " (mesmo DOI/título)" : ` (${pct(m.score)})`}${m.hasFile ? " · substitui o atual" : ""}`;
                  return `<option value="${v}" ${r.action === v ? "selected" : ""}>${escapeHtml(t)}</option>`;
                })
                .join("")}
              <option value="skip" ${r.action === "skip" ? "selected" : ""}>⏭️ Ignorar</option>
            </select></td>
        </tr>`;
      })
      .join("");
    this.shell(
      `${this.rows.length} arquivo(s) analisado(s). Confira a categoria, o tipo e o título — você pode alterar qualquer linha antes de importar.`,
      `<div class="bi-bulk">
          <span class="bi-sum"><b>${k.novos}</b> novo(s) · <b>${k.anexos}</b> anexo(s) a registros existentes · <b>${k.pular}</b> ignorado(s)</span>
          <span style="flex:1"></span>
          <div class="bi-apply">
            <span class="muted">Aplicar às <b>${this.rows.filter((r) => r.include).length}</b> linha(s) marcada(s):</span>
            <select class="form-select" data-bulk="cat"><option value="">Categoria…</option>${cats.map(([key, s]) => `<option value="${key}" ${this.bulkCat === key ? "selected" : ""}>${escapeHtml(s.group)}</option>`).join("")}</select>
            <select class="form-select" data-bulk="tipo"><option value="">Tipo…</option>${this.bulkTipoOptions()}</select>
            <button type="button" class="btn btn-primary btn-sm" data-a="bulk" ${this.bulkCat || this.bulkTipo ? "" : "disabled"}>Aplicar</button>
          </div>
        </div>
        <div class="bi-table-wrap"><table class="bi-table">
          <colgroup><col class="c-chk"/><col class="c-file"/><col class="c-cat"/><col class="c-tipo"/><col class="c-ano"/><col class="c-text"/><col class="c-act"/></colgroup>
          <thead><tr><th><input type="checkbox" data-all ${allOn ? "checked" : ""}/></th><th>Arquivo</th><th>Categoria</th><th>Tipo</th><th>Ano</th><th>Título / descrição</th><th>Ação</th></tr></thead>
          <tbody>${rowsHtml}</tbody></table></div>`,
      `<button type="button" class="btn btn-secondary" data-a="back">← Voltar</button><span style="flex:1"></span>
       <button type="button" class="btn btn-primary" data-a="import" ${k.novos + k.anexos ? "" : "disabled"}>Importar ${k.novos + k.anexos} arquivo(s)</button>`,
      true
    );
    const o = this.overlay;
    o.querySelector('[data-a="back"]').addEventListener("click", () => {
      this.phase = "setup";
      this.render();
    });
    o.querySelector('[data-a="import"]').addEventListener("click", () => this.importAll());
    o.querySelector("[data-all]").addEventListener("change", (e) => {
      this.rows.forEach((r) => (r.include = e.target.checked));
      this.renderReview();
    });
    o.querySelectorAll("[data-prev]").forEach((b) =>
      b.addEventListener("click", () => {
        const r = this.rows[Number(b.dataset.prev)];
        this.previewer?.openAbsolute?.(r.file.path, r.file.name);
      })
    );
    o.querySelectorAll("tr[data-i] [data-f]").forEach((el) => {
      const r = this.rows[Number(el.closest("tr").dataset.i)];
      const f = el.dataset.f;
      if (f === "text" || f === "ano") {
        el.addEventListener("input", () => (r[f] = el.value));
        return;
      }
      el.addEventListener("change", () => {
        if (f === "include") r.include = el.checked;
        else if (f === "cat") {
          const oldMain = mainField(r.cat);
          r.cat = el.value;
          const s = (r.sug || []).find((x) => x.category === r.cat);
          r.conf = s ? s.prob : r.conf;
          r.tipo = s?.tipo || null;
          this.fixTipo(r);
          if (oldMain !== mainField(r.cat) && !r.text) r.text = stem(r.file.name);
        } else if (f === "tipo") r.tipo = el.value;
        else if (f === "action") {
          r.action = el.value;
          if (r.action !== "skip") r.include = true;
        }
        this.renderReview();
      });
    });
    o.querySelector('[data-bulk="cat"]').addEventListener("change", (e) => {
      this.bulkCat = e.target.value;
      // tipo escolhido que não pertence à nova categoria deixa de valer
      if (this.bulkTipo && this.bulkCat && !this.bulkTipo.startsWith(`${this.bulkCat}||`)) this.bulkTipo = "";
      this.renderReview();
    });
    o.querySelector('[data-bulk="tipo"]').addEventListener("change", (e) => {
      this.bulkTipo = e.target.value;
      this.renderReview();
    });
    o.querySelector('[data-a="bulk"]').addEventListener("click", () => this.applyBulk());
  }

  /** Opções de tipo para a ação em lote: da categoria escolhida ou de todas (agrupadas). Valor: "cat||tipo". */
  bulkTipoOptions() {
    const cats = this.bulkCat ? [this.bulkCat] : [...new Set(this.rows.map((r) => r.cat))];
    const opt = (c, t) => {
      const v = `${c}||${t}`;
      return `<option value="${escapeHtml(v)}" ${this.bulkTipo === v ? "selected" : ""}>${escapeHtml(t)}</option>`;
    };
    if (cats.length === 1) return this.tiposOf(cats[0]).map((m) => opt(cats[0], m.description)).join("");
    return cats
      .map((c) => `<optgroup label="${escapeHtml(CATEGORY_SCHEMAS[c]?.group || c)}">${this.tiposOf(c).map((m) => opt(c, m.description)).join("")}</optgroup>`)
      .join("");
  }

  /** Aplica categoria e/ou tipo às linhas marcadas (as que serão anexadas a registros existentes ficam como estão). */
  applyBulk() {
    let cat = this.bulkCat || null;
    let tipo = null;
    if (this.bulkTipo) {
      const [c, t] = this.bulkTipo.split("||");
      cat = c;
      tipo = t;
    }
    if (!cat) return;
    let n = 0, kept = 0;
    for (const r of this.rows) {
      if (!r.include) continue;
      if (r.action.startsWith("attach")) {
        kept++;
        continue;
      }
      if (r.cat !== cat) {
        const oldMain = mainField(r.cat);
        r.cat = cat;
        const s = (r.sug || []).find((x) => x.category === cat);
        r.conf = s ? s.prob : r.conf;
        r.tipo = s?.tipo || null;
        if (oldMain !== mainField(cat) && !r.text) r.text = stem(r.file.name);
      }
      if (tipo) r.tipo = tipo;
      this.fixTipo(r);
      n++;
    }
    this.bulkCat = "";
    this.bulkTipo = "";
    this.renderReview();
    const label = `${CATEGORY_SCHEMAS[cat]?.group || cat}${tipo ? ` › ${tipo}` : ""}`;
    showToast(n ? `${label} aplicado a ${n} linha(s)${kept ? ` · ${kept} anexo(s) a registros existentes mantido(s)` : ""}` : "Nenhuma linha marcada para alterar (as de anexo ficam como estão)", n ? "success" : "info", 3500);
  }

  // ---------------------------------------------------------------- 4. importação
  buildData(r) {
    const data = { tipo: r.tipo || null, folder: this.folderOf(r.cat, r.tipo) };
    const ano = parseInt(String(r.ano || "").trim(), 10);
    data.ano = Number.isFinite(ano) ? ano : null;
    const main = mainField(r.cat);
    data[main] = String(r.text || "").trim() || stem(r.file.name);
    for (const k of EXTRA_FIELDS) {
      if (k === main || !hasField(r.cat, k)) continue;
      const v = r.extra[k];
      if (v == null || v === "") continue;
      data[k] = k === "horas" ? Number(v) || null : v;
    }
    return data;
  }

  async importAll() {
    const todo = this.rows.filter((r) => r.include && r.action !== "skip");
    if (!todo.length) return;
    this.phase = "import";
    this.result = { created: 0, attached: 0, errors: [], cats: new Set() };
    this.done = 0;
    this.total = todo.length;
    for (const r of todo) {
      this.current = r.file.name;
      this.renderImport();
      try {
        if (r.action.startsWith("attach:")) {
          const [, cat, id] = r.action.split(":");
          await api.updateRecord(cat, Number(id), {}, r.file.path);
          this.result.attached++;
          this.result.cats.add(cat);
        } else {
          await api.createRecord(r.cat, this.buildData(r), r.file.path);
          this.result.created++;
          this.result.cats.add(r.cat);
        }
        r.imported = true;
      } catch (e) {
        this.result.errors.push(`${r.file.name}: ${e}`);
      }
      this.done++;
    }
    this.phase = "done";
    this.render();
    this.onDone && this.onDone([...this.result.cats]);
  }

  renderImport() {
    const pct = Math.round((this.done / Math.max(1, this.total)) * 100);
    this.shell(
      "Copiando os arquivos para as subpastas e criando os registros…",
      `<div class="da-loading bi-loading"><div class="da-orb"></div><b>${this.done} de ${this.total}</b>
        <span class="bi-cur">${escapeHtml(this.current || "")}</span><div class="tl-progress"><i style="width:${pct}%"></i></div></div>`,
      ""
    );
  }

  renderDone() {
    const r = this.result;
    const label = (cat) => CATEGORY_SCHEMAS[cat]?.group || cat;
    this.shell(
      "Importação concluída.",
      `<div class="bi-done"><div class="rb-check-big">✓</div>
        <h3>${r.created} registro(s) criado(s) · ${r.attached} comprovante(s) anexado(s)</h3>
        ${r.cats.size ? `<p class="muted">Em: ${[...r.cats].map((c) => escapeHtml(label(c))).join(", ")}</p>` : ""}
        <p class="dd-note">Os registros criados levam os dados lidos de cada documento — vale abrir e conferir os que tinham confiança baixa.</p>
        ${r.errors.length ? `<details class="rb-failed" open><summary>⚠️ ${r.errors.length} arquivo(s) com erro</summary><ul>${r.errors.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></details>` : ""}
      </div>`,
      `<span style="flex:1"></span><button type="button" class="btn btn-primary" data-x>Fechar</button>`
    );
  }
}
