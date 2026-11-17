// Modal para vincular comprovantes existentes sem duplicar arquivos no disco

import { api } from "../api.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../utils.js";
import { easyClose } from "../theme.js";

export class ProofPickerModal {
  constructor({ currentCategory = null, records = [], onSelect = null, previewer = null }) {
    this.currentCategory = currentCategory;
    this.targetRecords = records || []; // se passado, registros que receberão o vínculo
    this.onSelect = onSelect;
    this.previewer = previewer || window._previewer;

    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";
    this.overlay.style.display = "none";
    document.getElementById("app")?.appendChild(this.overlay);

    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay && easyClose()) this.close();
    });

    this.allProofItems = [];
    this.activeFilter = this.currentCategory ? "category" : "all";
    this.searchTerm = "";
  }

  async open() {
    this.overlay.style.display = "flex";
    this.overlay.innerHTML = `
      <div class="modal-dialog proof-picker-dialog">
        <div class="loading-state" style="display:flex; min-height: 240px;">
          <div class="spinner"></div>
          <span>Localizando comprovantes existentes...</span>
        </div>
      </div>
    `;

    try {
      const allData = await api.getAllRecords();
      this.processData(allData);
      this.render();
    } catch (e) {
      console.error("Erro ao carregar comprovantes:", e);
      showToast(`Erro ao carregar comprovantes: ${e}`, "error");
      this.close();
    }
  }

  close() {
    this.overlay.style.display = "none";
    this.overlay.remove();
  }

  processData(allData) {
    const map = new Map(); // normPath -> item
    for (const [cat, recs] of Object.entries(allData || {})) {
      const schema = CATEGORY_SCHEMAS[cat];
      const catName = schema?.name || schema?.group || cat;
      for (const r of recs || []) {
        if (!r.path || !String(r.path).trim()) continue;
        const norm = String(r.path).trim().toLowerCase().replace(/\//g, "\\");
        const title = r.disciplina || r.titulo || r.descricao || `Registro #${r.id}`;
        const meta = [r.curso, r.journal, r.tipo, r.ano].filter(Boolean).join(" · ");

        if (!map.has(norm)) {
          const file = r.file || r.path.split(/[\\/]/).pop();
          const folder = r.folder || r.path.replace(/[^\\/]+$/, "");
          map.set(norm, {
            path: r.path,
            norm,
            file,
            folder,
            category: cat,
            categoryName: catName,
            records: [{ id: r.id, cat, title, meta, ano: r.ano, tipo: r.tipo }],
          });
        } else {
          map.get(norm).records.push({ id: r.id, cat, title, meta, ano: r.ano, tipo: r.tipo });
        }
      }
    }

    this.allProofItems = Array.from(map.values()).sort((a, b) => {
      if (this.currentCategory) {
        if (a.category === this.currentCategory && b.category !== this.currentCategory) return -1;
        if (b.category === this.currentCategory && a.category !== this.currentCategory) return 1;
      }
      return a.file.localeCompare(b.file);
    });
  }

  getFilteredItems() {
    let list = this.allProofItems;
    if (this.activeFilter === "category" && this.currentCategory) {
      list = list.filter((it) => it.category === this.currentCategory);
    }
    const q = this.searchTerm.trim().toLowerCase();
    if (q) {
      list = list.filter((it) => {
        if (it.file.toLowerCase().includes(q)) return true;
        if (it.path.toLowerCase().includes(q)) return true;
        return it.records.some((r) =>
          r.title.toLowerCase().includes(q) ||
          r.meta.toLowerCase().includes(q) ||
          String(r.ano || "").includes(q)
        );
      });
    }
    return list;
  }

  render() {
    const isBulk = this.targetRecords.length > 1;
    const catSchema = this.currentCategory ? CATEGORY_SCHEMAS[this.currentCategory] : null;
    const catName = catSchema?.name || catSchema?.group || "Categoria Atual";

    const catCount = this.allProofItems.filter((i) => i.category === this.currentCategory).length;
    const totalCount = this.allProofItems.length;

    let title = "Vincular Comprovante Existente";
    let subtitle = "Selecione um arquivo já anexado para compartilhar o mesmo link sem duplicar o arquivo no disco.";
    if (isBulk) {
      title = `Vincular Mesmo Comprovante a ${this.targetRecords.length} Registros`;
      subtitle = `O mesmo arquivo será vinculado a todos os ${this.targetRecords.length} registros selecionados. No relatório, a página será impressa apenas uma vez.`;
    } else if (this.targetRecords.length === 1) {
      const r = this.targetRecords[0];
      const rTitle = r.disciplina || r.titulo || r.descricao || `Registro #${r.id}`;
      title = `Vincular Comprovante — ${escapeHtml(rTitle)}`;
    }

    const items = this.getFilteredItems();

    this.overlay.innerHTML = `
      <div class="modal-dialog proof-picker-dialog">
        <header class="modal-header">
          <div>
            <h2 style="font-size: 16px; font-weight: 700;">🔗 ${title}</h2>
            <p class="modal-subtitle" style="font-size: 12.5px; color: var(--text-muted); margin-top: 3px;">
              ${subtitle}
            </p>
          </div>
          <button type="button" class="btn-close" id="pp-close" aria-label="Fechar">&times;</button>
        </header>

        <div style="padding: 12px 20px 0; border-bottom: 1px solid var(--border-light); background: var(--surface-1);">
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 220px; position: relative;">
              <input type="text" id="pp-search-input" class="form-input" style="width: 100%; padding-left: 32px;"
                     placeholder="Buscar por arquivo, disciplina, título, ano..." value="${escapeHtml(this.searchTerm)}" />
              <span style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); opacity: 0.5;">🔍</span>
            </div>
            <button type="button" id="pp-btn-external-file" class="btn btn-secondary btn-sm"
                    title="Selecionar outro arquivo PDF/imagem do computador sem criar cópia">
              📁 Escolher outro arquivo...
            </button>
          </div>

          <div style="display: flex; gap: 6px; margin-top: 10px; padding-bottom: 8px;">
            ${this.currentCategory ? `
              <button type="button" class="btn btn-sm ${this.activeFilter === "category" ? "btn-primary" : "btn-secondary"}" id="pp-filter-cat">
                ${escapeHtml(catName)} (${catCount})
              </button>
            ` : ""}
            <button type="button" class="btn btn-sm ${this.activeFilter === "all" ? "btn-primary" : "btn-secondary"}" id="pp-filter-all">
              Todos os comprovantes (${totalCount})
            </button>
          </div>
        </div>

        <div class="pp-body">
          ${items.length === 0 ? `
            <div class="chart-empty" style="padding: 40px 20px; text-align: center;">
              Nenhum comprovante encontrado com os filtros atuais.
            </div>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${items.map((it, idx) => {
                const ext = it.file.split(".").pop()?.toUpperCase() || "DOC";
                return `
                  <div class="pp-item" data-idx="${idx}">
                    <div class="pp-icon">${escapeHtml(ext)}</div>
                    <div class="pp-info">
                      <div class="pp-file-name" title="${escapeHtml(it.file)}">${escapeHtml(it.file)}</div>
                      <div class="pp-file-path" title="${escapeHtml(it.path)}">${escapeHtml(it.path)}</div>
                      <div class="pp-used-by">
                        <span style="font-size: 11px; color: var(--text-muted); align-self: center;">Vinculado a:</span>
                        ${it.records.slice(0, 3).map(r => `
                          <span class="pp-pill" title="${escapeHtml(r.title)} · ${escapeHtml(r.meta)}">
                            ${escapeHtml(r.title)} (${r.ano || "—"})
                          </span>
                        `).join("")}
                        ${it.records.length > 3 ? `
                          <span class="pp-pill" style="background: var(--surface-2); font-weight: 600;">
                            +${it.records.length - 3} outros
                          </span>
                        ` : ""}
                      </div>
                    </div>
                    <div class="pp-actions">
                      <button type="button" class="btn btn-secondary btn-sm" data-action="preview" data-idx="${idx}" title="Visualizar este arquivo">
                        👁 Visualizar
                      </button>
                      <button type="button" class="btn btn-primary btn-sm" data-action="choose" data-idx="${idx}">
                        ✓ Vincular este
                      </button>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          `}
        </div>

        <footer class="modal-footer" style="padding: 10px 20px;">
          <div style="font-size: 12px; color: var(--text-muted); flex: 1;">
            💡 O link do arquivo será compartilhado e no relatório final (PDF) as páginas repetidas serão unificadas automaticamente.
          </div>
          <button type="button" class="btn btn-secondary" id="pp-btn-cancel">Fechar</button>
        </footer>
      </div>
    `;

    this.bindEvents(items);
  }

  bindEvents(items) {
    const d = this.overlay;

    d.querySelector("#pp-close")?.addEventListener("click", () => this.close());
    d.querySelector("#pp-btn-cancel")?.addEventListener("click", () => this.close());

    const searchInput = d.querySelector("#pp-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.searchTerm = e.target.value;
        this.render();
      });
      // Mantém foco se já estiver digitando
      if (this.searchTerm) {
        searchInput.focus();
        searchInput.setSelectionRange(this.searchTerm.length, this.searchTerm.length);
      }
    }

    d.querySelector("#pp-filter-cat")?.addEventListener("click", () => {
      this.activeFilter = "category";
      this.render();
    });

    d.querySelector("#pp-filter-all")?.addEventListener("click", () => {
      this.activeFilter = "all";
      this.render();
    });

    // Escolher outro arquivo do disco sem copiar
    d.querySelector("#pp-btn-external-file")?.addEventListener("click", async () => {
      try {
        const picked = await api.selectSourceFile();
        if (!picked) return;

        const file = picked.split(/[\\/]/).pop();
        const chosen = {
          path: picked,
          file,
          folder: "",
          isExternal: true,
        };
        await this.handleChoose(chosen);
      } catch (e) {
        showToast(`Erro ao selecionar arquivo: ${e}`, "error");
      }
    });

    d.querySelectorAll("[data-action='preview']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        const it = items[idx];
        if (!it) return;
        if (this.previewer) {
          this.previewer.open({
            path: it.path,
            file: it.file,
            titulo: it.records[0]?.title || it.file,
            ano: it.records[0]?.ano,
          });
        }
      });
    });

    d.querySelectorAll("[data-action='choose']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.dataset.idx);
        const it = items[idx];
        if (!it) return;
        await this.handleChoose(it);
      });
    });
  }

  async handleChoose(chosen) {
    // Se temos registros-alvo (vindo da tabela ou seleção em lote):
    if (this.targetRecords && this.targetRecords.length > 0) {
      try {
        const links = this.targetRecords.map((r) => ({
          category: r.category || this.currentCategory,
          id: Number(r.id),
          path: chosen.path,
        }));

        await api.applyFileLinks(links);
        showToast(
          this.targetRecords.length === 1
            ? `✓ Comprovante vinculado com sucesso!`
            : `✓ Mesmo comprovante vinculado a ${this.targetRecords.length} registros!`,
          "success",
          4000
        );

        if (this.onSelect) this.onSelect(chosen);
        this.close();
      } catch (err) {
        console.error("Erro ao vincular comprovante:", err);
        showToast(`Falha ao vincular comprovante: ${err}`, "error", 6000);
      }
    } else {
      // Vindo do formulário modal (novo registro / edição)
      if (this.onSelect) this.onSelect(chosen);
      this.close();
    }
  }
}
