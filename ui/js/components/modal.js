// Record Create / Edit Modal Component

import { CATEGORY_SCHEMAS, getCategoryMappings, escapeHtml, showToast } from "../utils.js";
import { api } from "../api.js";
import { easyClose } from "../theme.js";
import { FieldHistory } from "./fieldHistory.js";
import { ProofPickerModal } from "./proofPicker.js";

const foldKey = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const DADOS_GERAIS_PLACEHOLDERS = {
  identificacao: "Ex: RG, CPF, portaria de nomeação, alteração de nome ou documento de identificação...",
  endereco: "Ex: Endereço profissional/residencial atualizado, sala, ramal ou comprovante de lotação...",
  "licenca maternidade, paternidade e adocao": "Ex: Licença maternidade/paternidade/adoção — período (dd/mm/aaaa a dd/mm/aaaa), processo ou portaria...",
  idiomas: "Ex: Inglês (compreende bem, fala bem, lê bem, escreve bem) — Certificado de proficiência...",
  "premios e titulos": "Ex: Prêmio / Menção Honrosa — entidade promotora e premiação...",
  "texto inicial do curriculo lattes": "Cole ou descreva o texto inicial / resumo biográfico exibido no Currículo Lattes...",
  "outras informacoes relevantes": "Ex: Informações complementares relevantes para o Currículo Lattes ou progressão docente...",
};

export class RecordModal {
  constructor({ onSaved, previewer = null }) {
    this.previewer = previewer || window._previewer || window._app?.previewer || window.app?.previewer;
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
    this.btnLinkExistingFile = document.getElementById("btn-link-existing-file");
    this.btnRemoveAttachment = document.getElementById("btn-remove-attachment");
    this.selectedFileName = document.getElementById("selected-file-name");
    this.fileExtBadge = document.getElementById("file-ext-badge");
    this.targetSubfolderPath = document.getElementById("target-subfolder-path");
    this.attachmentsList = document.getElementById("attachments-list");
    this.attachmentsBadge = document.getElementById("attachments-count-badge");

    this.onSaved = onSaved;

    this.mode = "create"; // "create" or "edit"
    this.category = null;
    this.currentRecord = null;
    this.attachments = []; // [{ id, file, path, folder, description, ord, isNew, sourcePath, isLinked }]
    this.selectedSourceFile = null;
    this.selectedExistingProof = null;
    this.fileRemoved = false;
    this.mappings = [];
    this.metaPanel = document.getElementById("meta-panel");
    this.meta = null;
    this.metaToken = 0;

    // histórico de preenchimento: valores já usados no mesmo campo, na mesma categoria
    this.history = new FieldHistory(this.dynamicFields, () => ({
      category: this.category,
      tipo: document.getElementById("field-tipo")?.value || "",
      excludeId: this.currentRecord?.id ?? null,
    }));

    this.bindEvents();
  }

  bindEvents() {
    this.btnClose.addEventListener("click", () => this.close());
    this.btnCancel.addEventListener("click", () => this.close());

    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay && easyClose()) this.close();
    });

    this.btnSelectFile?.addEventListener("click", () => this.handlePickFile());
    this.btnLinkExistingFile?.addEventListener("click", () => this.handlePickExistingProof());
    this.btnRemoveAttachment?.addEventListener("click", () => this.clearSelectedFile());

    const dropzone = document.getElementById("file-dropzone");
    if (dropzone) {
      dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("drag-over");
      });
      dropzone.addEventListener("dragleave", (e) => {
        e.preventDefault();
        dropzone.classList.remove("drag-over");
      });
      dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("drag-over");
        if (e.dataTransfer?.files?.length) {
          const paths = [...e.dataTransfer.files].map((f) => f.path || f.name).filter(Boolean);
          if (paths.length && paths.some((p) => /^[a-zA-Z]:[\\/]/.test(p))) {
            this.addSourceFiles(paths);
          }
        }
      });
    }

    this.form.addEventListener("submit", (e) => this.handleSubmit(e));
  }

  isOpen() {
    return this.overlay && this.overlay.style.display === "flex";
  }

  renderAttachmentsList() {
    if (!this.attachmentsList) return;
    this.attachmentsList.innerHTML = "";
    const total = this.attachments.length;

    if (this.attachmentsBadge) {
      if (total > 0) {
        this.attachmentsBadge.textContent = `${total} comprovante${total > 1 ? "s" : ""}`;
        this.attachmentsBadge.style.display = "inline-block";
      } else {
        this.attachmentsBadge.style.display = "none";
      }
    }

    if (total === 0) return;

    this.attachments.forEach((att, idx) => {
      const card = document.createElement("div");
      card.className = "attachment-item-card";
      card.style.cssText = "display:flex; align-items:center; gap:10px; background:var(--surface-1); border:1px solid var(--border-color); border-radius:8px; padding:8px 12px;";

      const ext = (att.file || att.path || "").split(".").pop()?.toUpperCase() || "PDF";
      const isNew = att.isNew;

      card.innerHTML = `
        <span class="file-type-badge" style="background:var(--surface-2); color:var(--primary); font-size:10px; font-weight:700; padding:3px 6px; border-radius:4px;">${escapeHtml(ext)}</span>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:6px;">
            <b style="font-size:12.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(att.file || att.path)}">${escapeHtml(att.file || att.path)}</b>
            ${isNew ? '<span class="badge" style="font-size:9.5px; background:rgba(16,185,129,0.15); color:#10b981;">Novo</span>' : ""}
            ${att.isLinked ? '<span class="badge" style="font-size:9.5px; background:rgba(99,102,241,0.15); color:#818cf8;">Vinculado</span>' : ""}
          </div>
          <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
            <input type="text" class="form-input form-input-xs att-desc-input" placeholder="Rótulo / Semestre (ex: 2023-1, Portaria, etc.)" value="${escapeHtml(att.description || "")}" style="height:24px; font-size:11.5px; padding:2px 8px; flex:1; max-width:280px;" data-idx="${idx}" />
            <small style="color:var(--text-muted); font-size:11px;">#${idx + 1}</small>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button type="button" class="btn btn-secondary btn-xs att-preview-btn" data-idx="${idx}" title="Visualizar comprovante" style="padding:4px 8px;">👁</button>
          <button type="button" class="btn-icon-danger att-remove-btn" data-idx="${idx}" title="Remover este comprovante" style="padding:4px 8px;">&times;</button>
        </div>
      `;

      card.querySelector(".att-desc-input")?.addEventListener("input", (e) => {
        att.description = e.target.value;
      });

      card.querySelector(".att-preview-btn")?.addEventListener("click", () => {
        const prev = this.previewer || window._previewer || window._app?.previewer || window.app?.previewer;
        if (!prev) {
          showToast("Visualizador de arquivos não disponível", "warning");
          return;
        }
        if (att.sourcePath) {
          prev.openAbsolute(att.sourcePath, att.file || att.sourcePath.split(/[\\/]/).pop());
        } else if (att.path) {
          const isAbs = /^[a-zA-Z]:[\\/]/.test(att.path);
          if (isAbs) {
            prev.openAbsolute(att.path, att.file || att.path.split(/[\\/]/).pop());
          } else {
            prev.open({
              id: att.id || -1,
              path: att.path,
              file: att.file || att.path.split(/[\\/]/).pop(),
              titulo: this.currentRecord?.titulo || this.currentRecord?.descricao || this.currentRecord?.disciplina || att.file,
              ano: this.currentRecord?.ano,
            });
          }
        } else {
          showToast("Nenhum arquivo associado a este comprovante", "info");
        }
      });

      card.querySelector(".att-remove-btn")?.addEventListener("click", () => {
        this.attachments.splice(idx, 1);
        this.renderAttachmentsList();
      });

      this.attachmentsList.appendChild(card);
    });
  }

  handlePickExistingProof() {
    new ProofPickerModal({
      currentCategory: this.category,
      onSelect: (chosen) => {
        this.attachments.push({
          id: null,
          file: chosen.file,
          path: chosen.path,
          folder: chosen.folder,
          isLinked: true,
          description: "",
          ord: this.attachments.length,
        });
        this.renderAttachmentsList();
        showToast(`Comprovante vinculado: ${chosen.file}`, "success", 2500);
      },
    }).open();
  }

  setMappings(mappings) {
    this.mappings = mappings || [];
  }

  openCreate(category, mappings = []) {
    this.mode = "create";
    this.category = category;
    this.currentRecord = null;
    this.attachments = [];
    this.selectedSourceFile = null;
    this.selectedExistingProof = null;
    this.fileRemoved = false;
    if (mappings.length) this.mappings = mappings;

    const schema = CATEGORY_SCHEMAS[category];
    this.titleEl.textContent = `Novo Registro — ${schema?.name || category}`;
    this.btnSave.textContent = "Salvar Registro";

    this.renderFormFields(schema);
    this.history.load(category);
    this.renderAttachmentsList();
    this.resetMeta();
    this.overlay.style.display = "flex";
  }

  /** Abre "Novo registro" já com o arquivo anexado (arrastar-e-soltar / menu). */
  openCreateWithFile(category, path, mappings = [], extract = true) {
    this.openCreate(category, mappings);
    this.setSourceFile(path, extract);
  }

  /** Abre "Novo registro" pré-preenchendo dados (ex: artigos importados do Scholar). */
  openCreateWithData(category, initialData = {}, mappings = []) {
    this.openCreate(category, mappings);
    if (initialData) {
      for (const [key, val] of Object.entries(initialData)) {
        const el = document.getElementById(`field-${key}`);
        if (el && val != null) {
          el.value = String(val);
        }
      }
      if (initialData.identifier) {
        const idEl = document.getElementById("field-identifier");
        if (idEl) {
          idEl.value = initialData.identifier;
          idEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      if (initialData.tipo) {
        const tipoEl = document.getElementById("field-tipo");
        if (tipoEl) {
          tipoEl.value = initialData.tipo;
          tipoEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    }
  }

  openEdit(category, record, mappings = []) {
    this.mode = "edit";
    this.category = category;
    this.currentRecord = record;
    this.selectedSourceFile = null;
    this.selectedExistingProof = null;
    this.fileRemoved = false;
    if (mappings.length) this.mappings = mappings;

    if (record.attachments && record.attachments.length > 0) {
      // Filtra caminhos externos absolutos (ex: Downloads) se já existir o comprovante relativo gerenciado na pasta
      let atts = record.attachments;
      const hasRelativeManaged = atts.some((a) => a.path && !/^[a-zA-Z]:[\\/]/.test(a.path));
      if (hasRelativeManaged) {
        atts = atts.filter((a) => a.path && !/^[a-zA-Z]:[\\/]/.test(a.path));
      }
      this.attachments = atts.map((a, i) => ({
        ...a,
        isNew: false,
        ord: a.ord ?? i,
      }));
    } else if (record.path) {
      this.attachments = [
        {
          id: null,
          file: record.file || record.path.split(/[\\/]/).pop(),
          path: record.path,
          folder: record.folder,
          description: null,
          ord: 0,
          isNew: false,
        },
      ];
    } else {
      this.attachments = [];
    }

    const schema = CATEGORY_SCHEMAS[category];
    this.titleEl.textContent = `Editar Registro #${record.id} — ${schema?.name || category}`;
    this.btnSave.textContent = "Salvar Alterações";

    this.renderFormFields(schema, record);
    this.history.load(category);
    this.resetMeta();
    this.renderAttachmentsList();

    this.overlay.style.display = "flex";
  }

  /** Abre modal duplicando os dados de um registro existente para criar um novo. */
  openDuplicate(category, record, mappings = []) {
    this.mode = "create";
    this.category = category;
    this.currentRecord = null;
    this.selectedSourceFile = null;
    this.fileRemoved = false;
    if (mappings.length) this.mappings = mappings;

    if (record.attachments && record.attachments.length > 0) {
      this.attachments = record.attachments.map((a, i) => ({
        ...a,
        id: null,
        isLinked: true,
        ord: i,
      }));
    } else if (record.path) {
      this.attachments = [
        {
          id: null,
          file: record.file || record.path.split(/[\\/]/).pop(),
          path: record.path,
          folder: record.folder,
          description: null,
          ord: 0,
          isLinked: true,
        },
      ];
    } else {
      this.attachments = [];
    }

    const schema = CATEGORY_SCHEMAS[category];
    this.titleEl.textContent = `Duplicar Registro — ${schema?.name || category} (Cópia do #${record.id})`;
    this.btnSave.textContent = "Salvar como Novo Registro";

    this.renderFormFields(schema, record);
    this.history.load(category);
    this.resetMeta();
    this.renderAttachmentsList();

    this.overlay.style.display = "flex";
  }

  close() {
    this.history.close();
    this.resetMeta();
    this.overlay.style.display = "none";
    this.currentRecord = null;
    this.selectedSourceFile = null;
  }

  /** Retorna a subpasta de destino atualmente resolvida para a categoria e tipo selecionados. */
  currentResolvedFolder() {
    const tipoSelect = document.getElementById("field-tipo");
    const optFolder = tipoSelect?.selectedOptions[0]?.dataset?.folder;
    if (optFolder) return optFolder;
    const inpFolder = document.getElementById("field-folder")?.value;
    if (inpFolder && inpFolder.replace(/[\\/]+$/, "").includes("\\")) return inpFolder;
    const tipoVal = (tipoSelect?.value || "").toLowerCase();
    const all = getCategoryMappings(this.category, this.mappings);
    const m = all.find(
      (x) => (tipoVal ? x.description.toLowerCase() === tipoVal : true)
    );
    return m?.folder || inpFolder || "";
  }

  renderFormFields(schema, record = null) {
    if (!schema) return;
    let html = "";

    const groupMappings = getCategoryMappings(this.category, this.mappings);

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
      } else if (field.type === "link") {
        html += `<input type="text" inputmode="url" spellcheck="false" autocomplete="off" id="field-${field.name}" name="${field.name}" class="form-input" value="${escapeHtml(val)}" placeholder="${escapeHtml(field.placeholder || "")}" title="Endereço http(s); sem o https:// ele é completado ao salvar" />`;
      } else if (field.type === "textarea") {
        html += `<textarea id="field-${field.name}" name="${field.name}" class="form-textarea" data-history="1" autocomplete="off" placeholder="${escapeHtml(field.placeholder || "")}" ${field.required ? "required" : ""}>${escapeHtml(val)}</textarea>`;
      } else {
        const hist = (field.type || "text") === "text" ? 'data-history="1" autocomplete="off"' : "";
        html += `<input type="${field.type || "text"}" id="field-${field.name}" name="${field.name}" class="form-input" ${hist} value="${escapeHtml(val)}" placeholder="${escapeHtml(field.placeholder || "")}" ${field.required ? "required" : ""} />`;
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
    const syncDadosGeraisPlaceholder = () => {
      if (this.category !== "dadosgerais") return;
      const descEl = document.getElementById("field-descricao");
      if (!descEl) return;
      const defaultPh = schema.fields.find((f) => f.name === "descricao")?.placeholder || "";
      descEl.placeholder = DADOS_GERAIS_PLACEHOLDERS[foldKey(tipoSelect?.value)] || defaultPh;
    };
    if (tipoSelect) {
      tipoSelect.addEventListener("change", () => {
        const selectedOption = tipoSelect.selectedOptions[0];
        const folder = selectedOption?.dataset?.folder;
        if (folder) {
          const folderInput = document.getElementById("field-folder");
          if (folderInput) folderInput.value = folder;
          this.targetSubfolderPath.textContent = `Destino: ${folder.replace(/[\\/]+$/, "")}\\`;
          // Atualiza anexos não consolidados para a nova pasta do tipo selecionado
          for (const att of this.attachments) {
            if (att.isNew || !att.folder || !att.folder.replace(/[\\/]+$/, "").includes("\\")) {
              att.folder = folder;
            }
          }
        }
        syncDadosGeraisPlaceholder();
      });
      // Trigger initial folder text
      const initialSelected = tipoSelect.selectedOptions[0];
      const folder = initialSelected?.dataset?.folder || initialFolder;
      if (folder) {
        this.targetSubfolderPath.textContent = `Destino: ${folder.replace(/[\\/]+$/, "")}\\`;
      }
      syncDadosGeraisPlaceholder();
    }
  }

  async handlePickFile() {
    try {
      const pickedFiles = await api.pickFiles({
        title: "Selecionar Comprovante(s)",
        multiple: true,
        extensions: ["pdf", "png", "jpg", "jpeg", "docx", "xlsx"],
      });
      if (!pickedFiles || !pickedFiles.length) return;
      this.addSourceFiles(pickedFiles);
    } catch (err) {
      console.error("Falha ao selecionar arquivos:", err);
      showToast(`Erro ao selecionar arquivos: ${err}`, "error");
    }
  }

  /** Adiciona um ou múltiplos arquivos aos comprovantes deste registro (preserva os comprovantes já vinculados). */
  addSourceFiles(files, extract = true) {
    if (!files) return;
    const list = Array.isArray(files) ? files : [files];
    if (!list.length) return;
    const folder = this.currentResolvedFolder();
    const added = [];

    for (const p of list) {
      if (!p) continue;
      const fileName = p.split(/[\\/]/).pop() || "documento.pdf";
      // Evita duplicar se o arquivo de origem ou nome já foi adicionado
      const alreadyPresent = this.attachments.some(
        (a) => (a.sourcePath && a.sourcePath === p) || (a.file === fileName && a.path === p)
      );
      if (alreadyPresent) continue;

      const newAtt = {
        id: null,
        file: fileName,
        path: p,
        sourcePath: p,
        isNew: true,
        folder,
        description: "",
        ord: this.attachments.length,
      };
      this.attachments.push(newAtt);
      added.push(newAtt);
    }

    this.renderAttachmentsList();

    if (added.length > 0) {
      showToast(
        `${added.length} comprovante${added.length > 1 ? "s adicionados" : " adicionado"}. Clique em "Salvar" para confirmar.`,
        "success",
        3000
      );
      const firstPdf = added.find((a) => (a.file || "").toLowerCase().endsWith(".pdf"));
      if (firstPdf && extract) {
        if (this.category === "producoes") this.extractMetadata(firstPdf.path);
        else this.analyzeForForm(firstPdf.path);
      }
    }
  }

  /** Anexa um arquivo do disco (compatibilidade retroativa, chama addSourceFiles). */
  setSourceFile(picked, extract = true) {
    this.addSourceFiles(picked, extract);
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
    this.selectedExistingProof = null;
    this.attachments = [];
    this.fileRemoved = true;
    this.renderAttachmentsList();
  }

  async handleSubmit(e) {
    e.preventDefault();
    const formData = new FormData(this.form);
    const data = {};

    for (const [key, value] of formData.entries()) {
      const trimmed = value.trim();
      if (trimmed === "") {
        data[key] = null;
      } else if (key === "ano" || key === "horas" || key === "alunos" || key === "ano_fim") {
        data[key] = Number(trimmed);
      } else {
        data[key] = trimmed;
      }
    }

    const idEl = document.getElementById("field-identifier");
    if (idEl && !data.identifier && idEl.dataset.legacy) delete data.identifier;
    if (data.identifier) data.identifier = data.identifier.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");

    // Garante que a subpasta de destino corresponda ao tipo selecionado
    const resolvedFolder = this.currentResolvedFolder();
    if (resolvedFolder) {
      data.folder = resolvedFolder;
      const folderInput = document.getElementById("field-folder");
      if (folderInput) folderInput.value = resolvedFolder;
    }

    for (const a of this.attachments) {
      if (a.isNew || !a.folder || !a.folder.replace(/[\\/]+$/, "").includes("\\")) {
        a.folder = data.folder || resolvedFolder;
      }
    }

    // Prepara os múltiplos comprovantes
    // Apenas comprovantes já gerenciados no disco são serializados em data.attachments.
    // Comprovantes novos (isNew) são enviados em newSourceFiles para o backend copiar para a pasta de destino!
    const newSourceFiles = this.attachments.filter((a) => a.isNew && a.sourcePath).map((a) => a.sourcePath);
    const serializedAttachments = this.attachments
      .filter((a) => !a.isNew)
      .map((a, idx) => ({
        id: a.id || null,
        file: a.file,
        path: a.path,
        folder: a.folder || data.folder,
        description: a.description || null,
        ord: idx,
      }));

    data.attachments = serializedAttachments;
    if (this.attachments.length > 0) {
      data.file = this.attachments[0].file;
      data.path = this.attachments[0].path;
      if (!data.folder || !data.folder.replace(/[\\/]+$/, "").includes("\\")) {
        data.folder = this.attachments[0].folder || data.folder;
      }
    } else {
      data.file = null;
      data.path = null;
    }

    try {
      this.btnSave.disabled = true;
      this.btnSave.textContent = "Salvando...";

      let result;
      if (this.mode === "create") {
        result = await api.createRecord(this.category, data, null, newSourceFiles);
        showToast("Registro criado com sucesso!", "success");
      } else {
        result = await api.updateRecord(this.category, this.currentRecord.id, data, null, newSourceFiles);
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
