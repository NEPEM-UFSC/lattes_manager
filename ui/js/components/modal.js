// Record Create / Edit Modal Component

import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../utils.js";
import { api } from "../api.js";

export class RecordModal {
  constructor({ onSaved }) {
    this.overlay = document.getElementById("record-modal-overlay");
    this.form = document.getElementById("record-form");
    this.titleEl = document.getElementById("record-modal-title");
    this.dynamicFields = document.getElementById("dynamic-form-fields");
    this.btnClose = document.getElementById("btn-close-record-modal");
    this.btnCancel = document.getElementById("btn-cancel-record");
    this.btnSave = document.getElementById("btn-save-record");

    // File Dropzone Elements
    this.btnUnselected = document.getElementById("file-unselected");
    this.btnSelectedCard = document.getElementById("file-selected-card");
    this.btnSelectFile = document.getElementById("btn-select-file");
    this.btnRemoveAttachment = document.getElementById("btn-remove-attachment");
    this.selectedFileName = document.getElementById("selected-file-name");
    this.fileExtBadge = document.getElementById("file-ext-badge");
    this.targetSubfolderPath = document.getElementById("target-subfolder-path");

    this.onSaved = onSaved;

    this.mode = "create"; // "create" or "edit"
    this.category = null;
    this.currentRecord = null;
    this.selectedSourceFile = null;
    this.mappings = [];
    this.metaPanel = document.getElementById("meta-panel");
    this.meta = null;
    this.metaToken = 0;

    this.bindEvents();
  }

  bindEvents() {
    this.btnClose.addEventListener("click", () => this.close());
    this.btnCancel.addEventListener("click", () => this.close());

    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.btnSelectFile.addEventListener("click", () => this.handlePickFile());
    this.btnRemoveAttachment.addEventListener("click", () => this.clearSelectedFile());

    this.form.addEventListener("submit", (e) => this.handleSubmit(e));
  }

  setMappings(mappings) {
    this.mappings = mappings || [];
  }

  openCreate(category, mappings = []) {
    this.mode = "create";
    this.category = category;
    this.currentRecord = null;
    this.selectedSourceFile = null;
    if (mappings.length) this.mappings = mappings;

    const schema = CATEGORY_SCHEMAS[category];
    this.titleEl.textContent = `Novo Registro — ${schema?.name || category}`;
    this.btnSave.textContent = "Salvar Registro";

    this.renderFormFields(schema);
    this.clearSelectedFile();
    this.resetMeta();
    this.overlay.style.display = "flex";
  }

  /** Abre "Novo registro" já com o arquivo anexado (arrastar-e-soltar / menu). */
  openCreateWithFile(category, path, mappings = [], extract = true) {
    this.openCreate(category, mappings);
    this.setSourceFile(path, extract);
  }

  openEdit(category, record, mappings = []) {
    this.mode = "edit";
    this.category = category;
    this.currentRecord = record;
    this.selectedSourceFile = null;
    if (mappings.length) this.mappings = mappings;

    const schema = CATEGORY_SCHEMAS[category];
    this.titleEl.textContent = `Editar Registro #${record.id} — ${schema?.name || category}`;
    this.btnSave.textContent = "Salvar Alterações";

    this.renderFormFields(schema, record);
    this.resetMeta();

    if (record.file) {
      this.displayExistingFile(record.file, record.folder || record.path);
    } else {
      this.clearSelectedFile();
    }

    this.overlay.style.display = "flex";
  }

  close() {
    this.resetMeta();
    this.overlay.style.display = "none";
    this.currentRecord = null;
    this.selectedSourceFile = null;
  }

  renderFormFields(schema, record = null) {
    if (!schema) return;
    let html = "";

    const groupMappings = this.mappings.filter(
      (m) => m.category_group.toLowerCase() === schema.group.toLowerCase()
    );

    for (const field of schema.fields) {
      const isFull = field.width === "full";
      const val = record ? (record[field.name] != null ? record[field.name] : "") : "";

      html += `<div class="form-group ${isFull ? "form-group-full" : ""}">`;
      html += `<label class="form-label" for="field-${field.name}">
        ${escapeHtml(field.label)} ${field.required ? '<span style="color:#ef4444;">*</span>' : ""}
      </label>`;

      if (field.type === "tipo_select") {
        html += `<select id="field-tipo" name="tipo" class="form-select" ${field.required ? "required" : ""}>`;
        html += `<option value="">Selecione um tipo...</option>`;

        let hasSelected = false;
        for (const m of groupMappings) {
          const selected = val && val.trim().toLowerCase() === m.description.trim().toLowerCase();
          if (selected) hasSelected = true;
          html += `<option value="${escapeHtml(m.description)}" data-folder="${escapeHtml(m.folder)}" ${selected ? "selected" : ""}>
            ${escapeHtml(m.description)}
          </option>`;
        }

        // If editing legacy record with a tipo not in current mappings
        if (val && !hasSelected) {
          html += `<option value="${escapeHtml(val)}" selected>${escapeHtml(val)} (Personalizado)</option>`;
        }
        html += `</select>`;
      } else if (field.type === "select") {
        html += `<select id="field-${field.name}" name="${field.name}" class="form-select" ${field.required ? "required" : ""}>`;
        for (const opt of field.options || []) {
          const selected = String(val) === String(opt);
          html += `<option value="${escapeHtml(opt)}" ${selected ? "selected" : ""}>${escapeHtml(opt || "Nenhum")}</option>`;
        }
        html += `</select>`;
      } else if (field.type === "doi") {
        // registros antigos guardam o nome do arquivo em "identifier": só mostramos se for um DOI
        const isDoi = /^10\.\d{4,9}\//.test(String(val || "").trim());
        html += `<div class="doi-line"><div class="doi-wrap"><input type="text" id="field-${field.name}" name="${field.name}" class="form-input mono-input" value="${escapeHtml(isDoi ? val : "")}" placeholder="${escapeHtml(field.placeholder || "")}" ${!isDoi && val ? 'data-legacy="1"' : ""} />
          <button type="button" class="doi-open" title="Abrir em doi.org" tabindex="-1">↗</button></div>
          <button type="button" class="btn btn-secondary btn-sm doi-resolve" title="Busca os dados do DOI (ou do título) e baixa o PDF de acesso aberto, se houver">⚡ Resolver</button></div>`;
      } else if (field.type === "textarea") {
        html += `<textarea id="field-${field.name}" name="${field.name}" class="form-textarea" placeholder="${escapeHtml(field.placeholder || "")}" ${field.required ? "required" : ""}>${escapeHtml(val)}</textarea>`;
      } else {
        html += `<input type="${field.type || "text"}" id="field-${field.name}" name="${field.name}" class="form-input" value="${escapeHtml(val)}" placeholder="${escapeHtml(field.placeholder || "")}" ${field.required ? "required" : ""} />`;
      }

      html += `</div>`;
    }

    // Hidden folder field to carry subfolder path
    const initialFolder = record?.folder || (groupMappings[0]?.folder || "");
    html += `<input type="hidden" id="field-folder" name="folder" value="${escapeHtml(initialFolder)}" />`;

    this.dynamicFields.innerHTML = html;
    this.dynamicFields.querySelector(".doi-open")?.addEventListener("click", () => {
      const d = document.getElementById("field-identifier")?.value.trim();
      if (d) api.openDoi(d).catch((e) => showToast(`Não foi possível abrir: ${e}`, "error"));
    });
    this.dynamicFields.querySelector(".doi-resolve")?.addEventListener("click", () => this.resolveDoi());
    document.getElementById("field-identifier")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.resolveDoi();
      }
    });
    // campos preenchidos automaticamente perdem o destaque quando editados
    if (!this._autofillBound) {
      this.dynamicFields.addEventListener("input", (e) => e.target.classList?.remove("autofill"));
      this._autofillBound = true;
    }

    // Attach change listener on tipo select to update folder destination
    const tipoSelect = document.getElementById("field-tipo");
    if (tipoSelect) {
      tipoSelect.addEventListener("change", () => {
        const selectedOption = tipoSelect.selectedOptions[0];
        const folder = selectedOption?.dataset?.folder;
        if (folder) {
          document.getElementById("field-folder").value = folder;
          this.targetSubfolderPath.textContent = `Destino: ${folder.replace(/[\\/]+$/, "")}\\`;
        }
      });
      // Trigger initial folder text
      const initialSelected = tipoSelect.selectedOptions[0];
      const folder = initialSelected?.dataset?.folder || initialFolder;
      if (folder) {
        this.targetSubfolderPath.textContent = `Destino: ${folder.replace(/[\\/]+$/, "")}\\`;
      }
    }
  }

  async handlePickFile() {
    try {
      const picked = await api.selectSourceFile();
      if (!picked) return; // User canceled dialog
      this.setSourceFile(picked);
    } catch (err) {
      console.error("Falha ao selecionar arquivo:", err);
      showToast(`Erro ao selecionar arquivo: ${err}`, "error");
    }
  }

  /** Anexa um arquivo do disco; se for PDF de produção, extrai os metadados. */
  setSourceFile(picked, extract = true) {
    this.selectedSourceFile = picked;
    const fileName = picked.split(/[\\/]/).pop() || "documento.pdf";
    const ext = fileName.split(".").pop()?.toUpperCase() || "DOC";
    this.selectedFileName.textContent = fileName;
    this.fileExtBadge.textContent = ext;
    const currentFolder = document.getElementById("field-folder")?.value || "subpasta";
    this.targetSubfolderPath.textContent = `Destino: ${currentFolder.replace(/[\\/]+$/, "")}\\`;
    this.btnUnselected.style.display = "none";
    this.btnSelectedCard.style.display = "flex";
    if (extract && this.category === "producoes" && ext === "PDF") this.extractMetadata(picked);
    else if (extract && ext === "PDF") this.analyzeForForm(picked);
  }

  /** Outras categorias: lê o PDF anexado, preenche campos vazios e avisa se parece ser de outra categoria. */
  async analyzeForForm(path) {
    const token = ++this.metaToken;
    let a;
    try {
      a = await api.analyzeDocument(path);
    } catch {
      return;
    }
    if (token !== this.metaToken || !a || a.needs_ocr) return;
    const top = a.sugestoes?.[0];
    const same = top && top.category === this.category;
    const filled = this.mode === "create" ? this.prefill(null, a.campos) : [];
    const other = top && !same && top.prob >= 0.5 ? CATEGORY_SCHEMAS[top.category] : null;
    if (!filled.length && !other) return;
    this.metaPanel.style.display = "block";
    this.metaPanel.innerHTML = `<div class="meta-card ${other ? "warn" : ""}"><div class="meta-head"><div class="meta-spark">${other ? "🤔" : "✨"}</div>
      <div class="meta-title"><b>${other ? `Este documento parece ser de “${escapeHtml(other.group)}”` : "Informações lidas do documento"}</b>
      <span>${other ? `${Math.round(top.prob * 100)}% de confiança (tipo: ${escapeHtml(top.tipo)}). Confira a categoria antes de salvar.` : ""}${filled.length ? ` Preenchido: ${filled.join(", ")} — revise.` : ""}</span></div></div></div>`;
  }

  // ================= Metadados do PDF =================
  resetMeta() {
    this.metaToken++;
    this.meta = null;
    this.doiRes = null;
    if (this.metaPanel) {
      this.metaPanel.style.display = "none";
      this.metaPanel.innerHTML = "";
    }
  }

  async extractMetadata(path) {
    const token = ++this.metaToken;
    this.metaPanel.style.display = "block";
    this.metaPanel.innerHTML = `<div class="meta-card loading"><div class="meta-spark">✨</div><div><b>Lendo o PDF…</b><span>procurando DOI e consultando a Crossref</span></div><div class="meta-bar"><i></i></div></div>`;
    let md;
    try {
      md = await api.extractPdfMetadata(path);
    } catch (err) {
      if (token !== this.metaToken) return;
      this.metaPanel.innerHTML = `<div class="meta-card warn"><div class="meta-spark">⚠️</div><div><b>Não foi possível ler este PDF</b><span>${escapeHtml(String(err))}</span></div></div>`;
      return;
    }
    if (token !== this.metaToken || !md) return; // modal fechado ou outro arquivo escolhido
    this.meta = md;
    this.doiRes = null;
    const filled = this.mode === "create" ? this.applyMeta(true) : [];
    this.renderMeta(filled);
  }

  /**
   * Preenche o formulário com o que a classificação automática extraiu do documento.
   * O tipo é sempre aplicado; os demais campos só se estiverem vazios.
   */
  prefill(tipo, c = {}) {
    const filled = [];
    const set = (name, v, force = false) => {
      const el = document.getElementById(`field-${name}`);
      if (!el || v == null || v === "") return;
      if (!force && String(el.value || "").trim()) return;
      if (el.tagName === "SELECT") {
        const o = [...el.options].find((x) => x.value.toLowerCase() === String(v).toLowerCase());
        if (!o) return;
        el.value = o.value;
        el.dispatchEvent(new Event("change"));
      } else el.value = v;
      el.classList.add("autofill");
      filled.push(name);
    };
    set("tipo", tipo, true);
    set("ano", c.ano);
    set("horas", c.horas);
    set("aluno", c.aluno);
    set("disciplina", c.disciplina);
    set("curso", c.curso);
    const has = (n) => Boolean(document.getElementById(`field-${n}`));
    if (has("titulo")) {
      set("titulo", c.titulo || (this.category.startsWith("x_") ? c.descricao : null));
      set("descricao", c.descricao);
    } else {
      set("descricao", c.descricao || c.titulo);
    }
    if (this.category === "producoes") set("identifier", c.doi);
    return filled;
  }

  /** ⚡ Resolver: DOI (ou título) → metadados + PDF de acesso aberto. */
  async resolveDoi() {
    const doiEl = document.getElementById("field-identifier");
    let doi = (doiEl?.value || "").trim();
    const titulo = (document.getElementById("field-titulo")?.value || "").trim();
    if (!doi && titulo.length < 15) {
      showToast("Digite (ou cole) o DOI — ou o título do trabalho — e clique em Resolver", "info", 3500);
      doiEl?.focus();
      return;
    }
    const token = ++this.metaToken;
    const btn = this.dynamicFields.querySelector(".doi-resolve");
    if (btn) btn.disabled = true;
    const loading = (b, t) => {
      this.metaPanel.style.display = "block";
      this.metaPanel.innerHTML = `<div class="meta-card loading"><div class="meta-spark">⚡</div><div><b>${b}</b><span>${t}</span></div><div class="meta-bar"><i></i></div></div>`;
    };
    try {
      if (!doi) {
        loading("Procurando o DOI pelo título…", "consultando a Crossref");
        doi = await api.findDoiByTitle(titulo);
        if (token !== this.metaToken) return;
        if (!doi) throw "nenhum DOI com esse título na Crossref. Confira o título ou cole o DOI.";
      }
      loading("Resolvendo o DOI…", "metadados na Crossref · procurando PDF em acesso aberto (OpenAlex)");
      const res = await api.resolveDoi(doi, true);
      if (token !== this.metaToken || !res) return;
      this.showDoiResult(res);
    } catch (err) {
      if (token !== this.metaToken) return;
      this.metaPanel.style.display = "block";
      this.metaPanel.innerHTML = `<div class="meta-card warn"><div class="meta-spark">⚠️</div><div><b>Não foi possível resolver</b><span>${escapeHtml(String(err))}</span></div></div>`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /** Aplica um resultado de resolve_doi ao formulário aberto (também usado pela tabela). */
  showDoiResult(res) {
    this.meta = res.meta;
    this.doiRes = res;
    const doiEl = document.getElementById("field-identifier");
    if (doiEl && res.meta?.doi && doiEl.value.trim()) {
      doiEl.value = res.meta.doi; // "https://doi.org/10.x/…" colado → "10.x/…"
      doiEl.removeAttribute("data-legacy");
    }
    const filled = this.applyMeta(true);
    // PDF baixado: anexa se ainda não há comprovante (se já houver, oferece o botão "Usar este PDF")
    const hasFile = Boolean(this.selectedSourceFile || (this.mode === "edit" && this.currentRecord?.path));
    if (res.pdf_path && !hasFile) {
      this.setSourceFile(res.pdf_path, false);
      res.anexado = true;
    }
    this.metaPanel.style.display = "block";
    this.renderMeta(filled);
  }

  /** "Adicionar por DOI": formulário novo com o campo DOI em foco. */
  openCreateDoi(category, mappings = []) {
    this.openCreate(category, mappings);
    setTimeout(() => document.getElementById("field-identifier")?.focus(), 50);
  }

  /** Bloco "PDF" do painel depois de resolver o DOI. */
  pdfBlock() {
    const r = this.doiRes;
    if (!r) return "";
    const mb = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
    const ver = { publicada: "versão publicada", aceita: "versão aceita do autor", preprint: "preprint", "?": "versão não informada" };
    const oa = { gold: "acesso aberto (gold)", green: "acesso aberto em repositório (green)", hybrid: "acesso aberto (hybrid)", bronze: "acesso livre na editora (bronze)", diamond: "acesso aberto (diamond)", closed: "sem acesso aberto" }[r.oa_status] || "";
    if (r.pdf_path) {
      const host = (r.pdf_url || "").split("/")[2] || "";
      const folder = document.getElementById("field-folder")?.value || "";
      return `<div class="meta-pdf ok">
          <div class="mp-ico">📄</div>
          <div class="mp-txt"><b>PDF baixado</b> · ${escapeHtml(ver[r.pdf_versao] || "")} · ${mb(r.pdf_bytes)} · ${escapeHtml(host)}
            <span>${r.anexado ? `Anexado — será copiado para <code>${escapeHtml(folder)}</code> ao salvar o registro.` : "Este registro já tem comprovante; use o botão para substituí-lo."}</span></div>
          ${r.anexado ? "" : '<button type="button" class="btn btn-secondary btn-sm" data-meta="usepdf">Usar este PDF</button>'}
        </div>`;
    }
    const first = r.candidatos?.[0];
    const motivo = r.candidatos?.length ? (r.falhas || []).slice(0, 2).join(" · ") : oa === "sem acesso aberto" || !oa ? "Nenhuma versão em acesso aberto foi encontrada." : "";
    return `<div class="meta-pdf">
        <div class="mp-ico">📭</div>
        <div class="mp-txt"><b>PDF não baixado</b>${oa ? ` · ${escapeHtml(oa)}` : ""}
          <span>${escapeHtml(motivo || "Não foi possível baixar automaticamente.")} Baixe pelo navegador e arraste o arquivo para cá.</span></div>
        <div class="meta-actions">
          ${first ? '<button type="button" class="btn btn-secondary btn-sm" data-meta="openpdf" title="' + escapeHtml(first.url) + '">Abrir PDF no navegador</button>' : ""}
          <button type="button" class="btn btn-secondary btn-sm" data-meta="opendoi">Página do DOI</button>
        </div>
      </div>`;
  }

  /** Preenche os campos com os metadados. onlyEmpty=true não sobrescreve o que já foi digitado. */
  applyMeta(onlyEmpty) {
    const md = this.meta;
    if (!md) return [];
    const filled = [];
    const put = (id, value, label) => {
      const el = document.getElementById(id);
      if (!el || value == null || value === "") return;
      if (onlyEmpty && String(el.value || "").trim() !== "") return;
      if (el.tagName === "SELECT") {
        const opt = [...el.options].find((o) => o.value.toLowerCase() === String(value).toLowerCase());
        if (!opt) return;
        el.value = opt.value;
        el.dispatchEvent(new Event("change"));
      } else {
        el.value = value;
        el.removeAttribute("data-legacy");
      }
      el.classList.add("autofill");
      filled.push(label);
    };
    put("field-titulo", md.titulo, "título");
    put("field-journal", md.journal, "revista");
    put("field-ano", md.ano, "ano");
    put("field-identifier", md.doi, "DOI");
    put("field-tipo", md.tipo_sugerido, "tipo");
    put("field-qualis", md.qualis_sugerido, "Qualis");
    return filled;
  }

  renderMeta(filled) {
    const md = this.meta;
    const src =
      md.fonte === "crossref"
        ? '<span class="meta-src ok" title="Dados confirmados na base Crossref pelo DOI">✓ Crossref</span>'
        : md.fonte === "openalex"
          ? '<span class="meta-src ok" title="Dados obtidos no OpenAlex pelo DOI">✓ OpenAlex</span>'
          : '<span class="meta-src" title="Dados lidos apenas do arquivo PDF">PDF</span>';
    const row = (k, v) => (v ? `<div class="meta-row"><span>${k}</span><b>${escapeHtml(String(v))}</b></div>` : "");
    const autores = md.autores || [];
    const autTxt = autores.length > 6 ? `${autores.slice(0, 6).join("; ")} … (+${autores.length - 6})` : autores.join("; ");
    const extras = [md.volume ? `v. ${md.volume}` : "", md.paginas ? `p. ${md.paginas}` : "", md.editora || ""].filter(Boolean).join(" · ");
    this.metaPanel.innerHTML = `
      <div class="meta-card">
        <div class="meta-head">
          <div class="meta-spark">✨</div>
          <div class="meta-title">
            <b>Metadados encontrados</b> ${src}
            <span>${filled.length ? `Preenchido automaticamente: ${filled.join(", ")} — revise antes de salvar.` : this.mode === "edit" ? "Use os botões para aplicar ao registro." : "Nenhum campo vazio para preencher."}</span>
          </div>
          <div class="meta-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-meta="empty" title="Preenche apenas campos vazios">Preencher vazios</button>
            <button type="button" class="btn btn-secondary btn-sm" data-meta="all" title="Substitui os campos pelos dados encontrados">Substituir todos</button>
          </div>
        </div>
        ${md.duplicata ? `<div class="meta-dup">⚠️ Possível duplicata: <b>#${md.duplicata.id}</b> ${escapeHtml(md.duplicata.titulo)} <i>(${escapeHtml(md.duplicata.motivo)})</i></div>` : ""}
        <div class="meta-grid">
          ${row("DOI", md.doi)}
          ${row("Ano", md.ano)}
          ${row("Revista", md.journal)}
          ${row("Tipo sugerido", md.tipo_sugerido)}
          ${row("Qualis sugerido", md.qualis_sugerido ? `${md.qualis_sugerido} (da mesma revista no seu cadastro)` : "")}
          ${row("Publicação", extras)}
          ${autores.length ? `<div class="meta-row full"><span>Autores (${autores.length})</span><b>${escapeHtml(autTxt)}</b></div>` : ""}
        </div>
        ${this.pdfBlock()}
        ${(md.avisos || []).map((a) => `<div class="meta-warn">ℹ️ ${escapeHtml(a)}</div>`).join("")}
      </div>`;
    const on = (k, fn) => this.metaPanel.querySelector(`[data-meta="${k}"]`)?.addEventListener("click", fn);
    on("usepdf", () => {
      this.setSourceFile(this.doiRes.pdf_path, false);
      this.doiRes.anexado = true;
      this.renderMeta(filled);
    });
    on("openpdf", () => api.openUrl(this.doiRes.candidatos[0].url).catch((e) => showToast(String(e), "error")));
    on("opendoi", () => md.doi && api.openDoi(md.doi).catch((e) => showToast(String(e), "error")));
    this.metaPanel.querySelector('[data-meta="empty"]').addEventListener("click", () => {
      const f = this.applyMeta(true);
      showToast(f.length ? `Preenchido: ${f.join(", ")}` : "Nenhum campo vazio para preencher", "info", 2500);
    });
    this.metaPanel.querySelector('[data-meta="all"]').addEventListener("click", () => {
      const f = this.applyMeta(false);
      showToast(f.length ? `Substituído: ${f.join(", ")}` : "Nada a substituir", "info", 2500);
    });
  }

  displayExistingFile(fileName, folderPath) {
    const ext = fileName.split(".").pop()?.toUpperCase() || "DOC";
    this.selectedFileName.textContent = fileName;
    this.fileExtBadge.textContent = ext;
    this.targetSubfolderPath.textContent = `Anexo Atual: ${folderPath || ""}`;

    this.btnUnselected.style.display = "none";
    this.btnSelectedCard.style.display = "flex";
  }

  clearSelectedFile() {
    this.selectedSourceFile = null;
    this.btnUnselected.style.display = "flex";
    this.btnSelectedCard.style.display = "none";
    this.selectedFileName.textContent = "";
  }

  async handleSubmit(e) {
    e.preventDefault();
    const formData = new FormData(this.form);
    const data = {};

    for (const [key, value] of formData.entries()) {
      const trimmed = value.trim();
      if (trimmed === "") {
        data[key] = null;
      } else if (key === "ano" || key === "horas" || key === "alunos") {
        data[key] = Number(trimmed);
      } else {
        data[key] = trimmed;
      }
    }

    const idEl = document.getElementById("field-identifier");
    if (idEl && !data.identifier && idEl.dataset.legacy) delete data.identifier;
    if (data.identifier) data.identifier = data.identifier.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");

    try {
      this.btnSave.disabled = true;
      this.btnSave.textContent = "Salvando...";

      let result;
      if (this.mode === "create") {
        result = await api.createRecord(this.category, data, this.selectedSourceFile);
        showToast("Registro criado com sucesso!", "success");
      } else {
        result = await api.updateRecord(this.category, this.currentRecord.id, data, this.selectedSourceFile);
        showToast("Registro atualizado com sucesso!", "success");
      }

      this.close();
      if (this.onSaved) this.onSaved(result);
    } catch (err) {
      console.error("Erro ao salvar registro:", err);
      showToast(`Erro ao salvar: ${err}`, "error");
    } finally {
      this.btnSave.disabled = false;
      this.btnSave.textContent = this.mode === "create" ? "Salvar Registro" : "Salvar Alterações";
    }
  }
}
