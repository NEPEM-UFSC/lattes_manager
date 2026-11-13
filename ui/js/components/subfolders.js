// Subfolders Management Component

import { escapeHtml, showToast } from "../utils.js";
import { api } from "../api.js";
import { easyClose } from "../theme.js";

export class SubfoldersView {
  constructor({ onMappingAdded }) {
    this.container = document.getElementById("subfolders-container");
    this.modalOverlay = document.getElementById("subfolder-modal-overlay");
    this.form = document.getElementById("subfolder-form");
    this.btnCloseModal = document.getElementById("btn-close-subfolder-modal");
    this.btnCancel = document.getElementById("btn-cancel-subfolder");

    this.onMappingAdded = onMappingAdded;
    this.mappings = [];
    this.selectedGroup = "";

    this.bindEvents();
  }

  bindEvents() {
    this.btnCloseModal.addEventListener("click", () => this.closeModal());
    this.btnCancel.addEventListener("click", () => this.closeModal());
    this.modalOverlay.addEventListener("click", (e) => {
      if (e.target === this.modalOverlay && easyClose()) this.closeModal();
    });

    this.form.addEventListener("submit", (e) => this.handleSubmitNewMapping(e));
  }

  setMappings(mappings) {
    this.mappings = mappings || [];
    this.render();
  }

  render() {
    let filtered = this.mappings;
    if (this.selectedGroup) {
      filtered = filtered.filter(
        (m) => m.category_group.toLowerCase() === this.selectedGroup.toLowerCase()
      );
    }

    const groups = Array.from(new Set(this.mappings.map((m) => m.category_group))).sort();

    let html = `
      <div class="table-toolbar">
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="font-size:14px; font-weight:700; color:var(--text-primary);">Mapeamentos de Subpastas</span>
          <span style="font-size:12px; color:var(--text-secondary);">${filtered.length} de ${this.mappings.length} pastas</span>
        </div>

        <div style="display:flex; align-items:center; gap:10px;">
          <select id="select-subfolder-group" class="select-filter">
            <option value="">Todos os Grupos (${this.mappings.length})</option>
            ${groups
              .map(
                (g) =>
                  `<option value="${escapeHtml(g)}" ${
                    this.selectedGroup.toLowerCase() === g.toLowerCase() ? "selected" : ""
                  }>${escapeHtml(g)}</option>`
              )
              .join("")}
          </select>

          <button type="button" id="btn-add-subfolder" class="btn btn-primary btn-sm">
            + Nova Subpasta
          </button>
        </div>
      </div>

      <div class="table-scroll-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 50px;">#</th>
              <th style="width: 160px;">Grupo / Categoria</th>
              <th style="width: 220px;">Tipo / Descrição</th>
              <th>Caminho Relativo da Pasta</th>
              <th style="width: 140px; text-align: right;">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${
              filtered.length === 0
                ? `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Nenhuma subpasta encontrada para o grupo selecionado.</td></tr>`
                : filtered
                    .map(
                      (m) => `
              <tr data-id="${m.id}">
                <td>${m.id}</td>
                <td><span class="badge badge-tipo">${escapeHtml(m.category_group)}</span></td>
                <td><strong>${escapeHtml(m.description)}</strong></td>
                <td><code style="font-family:var(--font-mono); color:#475569; font-size:12px;">${escapeHtml(m.folder)}</code></td>
                <td style="text-align: right;">
                  <button type="button" class="action-btn action-btn-primary" data-action="open-folder" data-folder="${escapeHtml(
                    m.folder
                  )}">
                    📂 Abrir Pasta
                  </button>
                </td>
              </tr>`
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>`;

    this.container.innerHTML = html;

    // Attach listeners
    const groupSelect = document.getElementById("select-subfolder-group");
    if (groupSelect) {
      groupSelect.addEventListener("change", (e) => {
        this.selectedGroup = e.target.value;
        this.render();
      });
    }

    const btnAdd = document.getElementById("btn-add-subfolder");
    if (btnAdd) {
      btnAdd.addEventListener("click", () => this.openModal());
    }

    this.container.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action='open-folder']");
      if (!btn) return;
      const folder = btn.dataset.folder;
      if (folder) {
        try {
          await api.openFolder(folder);
          showToast(`Abrindo pasta: ${folder}`, "info", 2000);
        } catch (err) {
          showToast(`Erro ao abrir pasta: ${err}`, "error");
        }
      }
    });
  }

  openModal() {
    this.form.reset();
    if (this.selectedGroup) {
      const groupSelect = document.getElementById("subfolder-group-select");
      if (groupSelect) groupSelect.value = this.selectedGroup;
    }
    this.modalOverlay.style.display = "flex";
  }

  closeModal() {
    this.modalOverlay.style.display = "none";
  }

  async handleSubmitNewMapping(e) {
    e.preventDefault();
    const group = document.getElementById("subfolder-group-select").value.trim();
    const desc = document.getElementById("subfolder-desc-input").value.trim();
    const folder = document.getElementById("subfolder-path-input").value.trim();

    if (!group || !desc || !folder) {
      showToast("Preencha todos os campos obrigatórios", "warning");
      return;
    }

    try {
      const created = await api.addSubfolderMapping(group, desc, folder);
      this.mappings.push(created);
      showToast("Mapeamento de subpasta criado com sucesso!", "success");
      this.closeModal();
      this.render();

      if (this.onMappingAdded) {
        this.onMappingAdded(created);
      }
    } catch (err) {
      console.error("Falha ao adicionar mapeamento:", err);
      showToast(`Erro ao criar mapeamento: ${err}`, "error");
    }
  }
}
