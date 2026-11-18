// Visualizador interno de comprovantes (PDF via visualizador do WebView2, imagens com zoom/arraste)

import { escapeHtml, showToast } from "../utils.js";
import { api } from "../api.js";

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const WIDTH_KEY = "lattes.viewer.width";

export class Previewer {
  constructor() {
    this.drawer = document.getElementById("preview-drawer");
    this.backdrop = document.getElementById("preview-backdrop");
    this.filenameEl = document.getElementById("preview-filename");
    this.filepathEl = document.getElementById("preview-filepath");
    this.contentEl = document.getElementById("preview-content");
    this.counterEl = document.getElementById("preview-counter");
    this.btnPrev = document.getElementById("btn-preview-prev");
    this.btnNext = document.getElementById("btn-preview-next");
    this.attTabsEl = document.getElementById("preview-att-tabs");

    this.list = [];
    this.index = -1;
    this.current = null; // { path, absPath?, name }
    this.zoom = { scale: 1, x: 0, y: 0, fit: true };

    try {
      const w = Number(localStorage.getItem(WIDTH_KEY));
      if (w > 360) this.drawer.style.width = `${w}px`;
    } catch {}

    this.bindEvents();
  }

  bindEvents() {
    document.getElementById("btn-close-drawer").addEventListener("click", () => this.close());
    this.backdrop.addEventListener("click", () => this.close());
    document.getElementById("btn-drawer-save")?.addEventListener("click", () => this.saveCurrentFile());
    document.getElementById("btn-drawer-open-system").addEventListener("click", () => this.openInSystem());
    document.getElementById("btn-drawer-reveal").addEventListener("click", () => this.revealInExplorer());
    document.getElementById("btn-drawer-expand").addEventListener("click", () => this.toggleExpanded());
    this.btnPrev.addEventListener("click", () => this.step(-1));
    this.btnNext.addEventListener("click", () => this.step(1));

    document.addEventListener("keydown", (e) => {
      if (!this.isOpen()) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
      if (e.key === "Escape") this.close();
      else if (typing) return;
      else if (e.key === "ArrowLeft") this.step(-1);
      else if (e.key === "ArrowRight") this.step(1);
      else if (e.key === "f" || e.key === "F") this.toggleExpanded();
    });

    window.addEventListener("resize", () => this.isOpen() && this.syncDock());
    // redimensionar arrastando a borda esquerda
    const resizer = document.getElementById("preview-resizer");
    resizer.addEventListener("pointerdown", (e) => {
      if (this.drawer.classList.contains("expanded")) return;
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      this.drawer.classList.add("resizing");
      const move = (ev) => {
        const w = Math.min(Math.round(window.innerWidth * 0.68), Math.max(380, window.innerWidth - ev.clientX));
        this.drawer.style.width = `${w}px`;
        this.syncDock();
      };
      const up = () => {
        resizer.removeEventListener("pointermove", move);
        this.drawer.classList.remove("resizing");
        try {
          localStorage.setItem(WIDTH_KEY, String(parseInt(this.drawer.style.width, 10)));
        } catch {}
      };
      resizer.addEventListener("pointermove", move);
      resizer.addEventListener("pointerup", up, { once: true });
    });
  }

  isOpen() {
    return this.drawer.classList.contains("open");
  }

  /**
   * Visualizador encaixado: a área principal encolhe para a largura que sobra,
   * mantendo a barra superior e as ações da tabela visíveis.
   */
  syncDock() {
    const docked = this.isOpen() && !this.drawer.classList.contains("expanded");
    const maxW = Math.round(window.innerWidth * 0.68);
    if (docked && this.drawer.offsetWidth > maxW) this.drawer.style.width = `${maxW}px`;
    const w = docked ? Math.min(this.drawer.offsetWidth || parseInt(this.drawer.style.width, 10) || 640, maxW) : 0;
    document.documentElement.style.setProperty("--viewer-w", `${w}px`);
    document.body.classList.toggle("viewer-docked", docked);
  }

  /** Abre o comprovante de um registro. `list` = registros visíveis na tabela (para ‹ ›). */
  open(record, list = null) {
    if (!record || !record.path) {
      showToast("Este registro não possui arquivo de comprovante associado", "info");
      return;
    }
    this.previewModeOptions = null;
    this.list = (list || [record]).filter((r) => r.path && r.path.trim());
    this.index = Math.max(0, this.list.findIndex((r) => r.id === record.id));
    if (!this.list.length) this.list = [record];
    this.show();
  }

  /** Abre um arquivo arbitrário por caminho absoluto (ex.: PDF de comprovantes recém-gerado). */
  openAbsolute(absPath, title = null) {
    this.previewModeOptions = null;
    this.list = [{ id: "__abs", absPath, file: title || absPath.split(/[\\/]/).pop() }];
    this.index = 0;
    this.show();
  }

  /**
   * Abre o visualizador mostrando o progresso da montagem de um PDF em memória.
   * Devolve um token: `isActive(token)` fica falso se o usuário fechar ou abrir outra coisa.
   */
  openPending(title, subtitle = "") {
    this.releaseBlob();
    this.list = [];
    this.index = -1;
    this.current = null;
    this.pendingToken = Symbol("pending");
    this.filenameEl.textContent = title;
    this.filepathEl.textContent = subtitle;
    this.filepathEl.title = "";
    this.counterEl.textContent = "–";
    this.btnPrev.disabled = this.btnNext.disabled = true;
    this.setFileActions(false);
    this.drawer.classList.add("open");
    this.backdrop.classList.toggle("on", this.drawer.classList.contains("expanded"));
    this.syncDock();
    this.contentEl.innerHTML = `<div class="viewer-loading viewer-building">
        <div class="spinner"></div>
        <p class="viewer-building-step">Carregando bibliotecas…</p>
        <div class="viewer-building-bar"><div class="viewer-building-fill" style="width:0%"></div></div>
      </div>`;
    return this.pendingToken;
  }

  isActive(token) {
    return Boolean(token) && this.pendingToken === token && this.isOpen();
  }

  setProgress(token, label, pct = null) {
    if (!this.isActive(token)) return;
    const step = this.contentEl.querySelector(".viewer-building-step");
    const fill = this.contentEl.querySelector(".viewer-building-fill");
    if (step) step.textContent = label;
    if (fill && pct != null) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  /** Mostra um PDF a partir dos bytes (usa blob URL para download limpo e armazena os bytes para salvar direto). */
  openPdfBytes(bytes, title, subtitle = "", options = null) {
    this.releaseBlob();
    this.pendingToken = null;
    this.previewModeOptions = options;
    this.currentBytes = bytes;
    // Usamos Blob URL para que o visualizador interno do WebView2
    // NÃO receba a URL "http://asset.localhost/C:/Users/..." que faz o navegador sugerir o nome
    // com caminho completo C_Users_tiago_AppData_...
    this.blobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    this.list = [{
      id: "__blob",
      blobUrl: this.blobUrl,
      absPath: options?.absPath || null,
      file: title,
      subtitle,
    }];
    this.index = 0;
    this.show();
  }

  releaseBlob() {
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
  }

  /** 📂 e ↗ só fazem sentido para arquivos em disco. 💾 funciona com bytes em memória ou arquivo. */
  setFileActions(on) {
    for (const id of ["btn-drawer-reveal", "btn-drawer-open-system"]) {
      const b = document.getElementById(id);
      if (b) b.disabled = !on;
    }
    const bSave = document.getElementById("btn-drawer-save");
    if (bSave) bSave.disabled = !on;
  }

  step(d) {
    if (this.list.length < 2) return;
    this.index = (this.index + d + this.list.length) % this.list.length;
    this.show();
  }

  async show() {
    const rec = this.list[this.index];
    if (rec.blobUrl) return this.showBlob(rec);
    this.pendingToken = null;
    if (this.blobUrl) this.releaseBlob();
    this.setFileActions(true);
    const rel = rec.path || null;
    const name = rec.file || (rel || rec.absPath || "").split(/[\\/]/).pop() || "comprovante";
    this.current = { path: rel, absPath: rec.absPath || null, name };

    this.filenameEl.textContent = name;
    const label = rec.titulo || rec.descricao || rec.disciplina || rec.aluno || "";
    this.filepathEl.textContent = [rec.ano, label].filter(Boolean).join(" · ") || rel || rec.absPath || "";
    this.filepathEl.title = rel || rec.absPath || "";
    this.counterEl.textContent = `${this.index + 1} / ${this.list.length}`;
    const many = this.list.length > 1;
    this.btnPrev.disabled = !many;
    this.btnNext.disabled = !many;

    if (this.attTabsEl) {
      if (rec.id === "__blob" && this.previewModeOptions) {
        const firstOnly = Boolean(this.previewModeOptions.firstPageOnly);
        const compress = Boolean(this.previewModeOptions.compress);
        this.attTabsEl.style.display = "flex";
        this.attTabsEl.innerHTML = `
          <span style="font-size:11px; font-weight:600; color:var(--text-muted); margin-right:4px;">Páginas:</span>
          <button type="button" class="btn btn-xs ${!firstOnly ? "btn-primary" : "btn-secondary"}" data-preview-mode="full" style="font-size:11px; padding:3px 9px; border-radius:12px;">📚 Inteiro</button>
          <button type="button" class="btn btn-xs ${firstOnly ? "btn-primary" : "btn-secondary"}" data-preview-mode="first" style="font-size:11px; padding:3px 9px; border-radius:12px;">📄 1ª pág.</button>
          <span style="width:1px; height:16px; background:var(--border-color); margin:0 4px;"></span>
          <span style="font-size:11px; font-weight:600; color:var(--text-muted); margin-right:4px;">Qualidade:</span>
          <button type="button" class="btn btn-xs ${!compress ? "btn-primary" : "btn-secondary"}" data-preview-qual="high" style="font-size:11px; padding:3px 9px; border-radius:12px;">💎 Máxima</button>
          <button type="button" class="btn btn-xs ${compress ? "btn-primary" : "btn-secondary"}" data-preview-qual="compact" style="font-size:11px; padding:3px 9px; border-radius:12px;">🗜️ Compactado</button>
        `;
        this.attTabsEl.querySelectorAll("[data-preview-mode]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const wantFirst = btn.dataset.previewMode === "first";
            if (wantFirst !== firstOnly && this.previewModeOptions?.onToggle) {
              this.previewModeOptions.onToggle({ firstPageOnly: wantFirst, compress });
            }
          });
        });
        this.attTabsEl.querySelectorAll("[data-preview-qual]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const wantCompress = btn.dataset.previewQual === "compact";
            if (wantCompress !== compress && this.previewModeOptions?.onToggle) {
              this.previewModeOptions.onToggle({ firstPageOnly: firstOnly, compress: wantCompress });
            }
          });
        });
      } else if (rec.attachments && rec.attachments.length > 1) {
        this.attTabsEl.style.display = "flex";
        this.attTabsEl.innerHTML = `
          <span style="font-size:11px; font-weight:600; color:var(--text-muted); margin-right:4px;">Comprovantes (${rec.attachments.length}):</span>
          ${rec.attachments
            .map((att, i) => {
              const active = (att.path === rec.path);
              const lbl = att.description || att.file || `Anexo ${i + 1}`;
              return `<button type="button" class="btn btn-xs ${active ? "btn-primary" : "btn-secondary"}" data-att-idx="${i}" style="font-size:11px; padding:3px 8px; border-radius:12px;">📎 ${escapeHtml(lbl)}</button>`;
            })
            .join("")}
        `;
        this.attTabsEl.querySelectorAll("[data-att-idx]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.attIdx);
            const targetAtt = rec.attachments[idx];
            if (targetAtt) {
              rec.path = targetAtt.path;
              rec.file = targetAtt.file;
              this.show();
            }
          });
        });
      } else {
        this.attTabsEl.style.display = "none";
        this.attTabsEl.innerHTML = "";
      }
    }

    this.drawer.classList.add("open");
    this.backdrop.classList.toggle("on", this.drawer.classList.contains("expanded"));
    this.syncDock();
    this.contentEl.innerHTML = `<div class="viewer-loading"><div class="spinner"></div></div>`;

    let abs = rec.absPath;
    try {
      if (!abs) abs = await api.resolveFilePath(rel);
    } catch (err) {
      return this.renderMissing(name, rel, String(err));
    }
    if (this.list[this.index] !== rec) return; // usuário navegou enquanto carregava

    const url = api.fileUrl(abs);
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (!url) {
      this.renderFallback(name, rel, "Visualização interna disponível apenas no aplicativo desktop.");
    } else if (ext === "pdf") {
      this.contentEl.innerHTML = `<iframe class="viewer-pdf" src="${escapeHtml(url)}#view=FitH" title="${escapeHtml(name)}"></iframe>`;
    } else if (IMAGE_EXT.includes(ext)) {
      this.renderImage(url, name);
    } else {
      this.renderFallback(name, rel, `Arquivos .${ext.toUpperCase()} não têm visualização interna.`);
    }
  }

  showBlob(rec) {
    this.current = { absPath: rec.absPath || null, name: rec.file };
    this.filenameEl.textContent = rec.file;
    this.filepathEl.textContent = rec.subtitle || "";
    this.filepathEl.title = rec.absPath || "";
    this.counterEl.textContent = "1 / 1";
    this.btnPrev.disabled = this.btnNext.disabled = true;
    this.setFileActions(true);

    if (this.attTabsEl) {
      if (this.previewModeOptions) {
        const firstOnly = Boolean(this.previewModeOptions.firstPageOnly);
        const compress = Boolean(this.previewModeOptions.compress);
        this.attTabsEl.style.display = "flex";
        this.attTabsEl.innerHTML = `
          <span style="font-size:11px; font-weight:600; color:var(--text-muted); margin-right:4px;">Páginas:</span>
          <button type="button" class="btn btn-xs ${!firstOnly ? "btn-primary" : "btn-secondary"}" data-preview-mode="full" style="font-size:11px; padding:3px 9px; border-radius:12px;">📚 Inteiro</button>
          <button type="button" class="btn btn-xs ${firstOnly ? "btn-primary" : "btn-secondary"}" data-preview-mode="first" style="font-size:11px; padding:3px 9px; border-radius:12px;">📄 1ª pág.</button>
          <span style="width:1px; height:16px; background:var(--border-color); margin:0 4px;"></span>
          <span style="font-size:11px; font-weight:600; color:var(--text-muted); margin-right:4px;">Qualidade:</span>
          <button type="button" class="btn btn-xs ${!compress ? "btn-primary" : "btn-secondary"}" data-preview-qual="high" style="font-size:11px; padding:3px 9px; border-radius:12px;">💎 Máxima</button>
          <button type="button" class="btn btn-xs ${compress ? "btn-primary" : "btn-secondary"}" data-preview-qual="compact" style="font-size:11px; padding:3px 9px; border-radius:12px;">🗜️ Compactado</button>
        `;
        this.attTabsEl.querySelectorAll("[data-preview-mode]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const wantFirst = btn.dataset.previewMode === "first";
            if (wantFirst !== firstOnly && this.previewModeOptions?.onToggle) {
              this.previewModeOptions.onToggle({ firstPageOnly: wantFirst, compress });
            }
          });
        });
        this.attTabsEl.querySelectorAll("[data-preview-qual]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const wantCompress = btn.dataset.previewQual === "compact";
            if (wantCompress !== compress && this.previewModeOptions?.onToggle) {
              this.previewModeOptions.onToggle({ firstPageOnly: firstOnly, compress: wantCompress });
            }
          });
        });
      } else {
        this.attTabsEl.style.display = "none";
        this.attTabsEl.innerHTML = "";
      }
    }

    if (this._origTitle == null) this._origTitle = document.title;
    document.title = rec.file.replace(/\.pdf$/i, "");

    this.drawer.classList.add("open");
    this.backdrop.classList.toggle("on", this.drawer.classList.contains("expanded"));
    this.syncDock();
    this.contentEl.innerHTML = `<iframe class="viewer-pdf" src="${escapeHtml(rec.blobUrl)}#view=FitH" title="${escapeHtml(rec.file)}"></iframe>`;
  }

  renderImage(url, name) {
    this.zoom = { scale: 1, x: 0, y: 0, fit: true };
    this.contentEl.innerHTML = `
      <div class="viewer-img-stage">
        <img class="viewer-img" src="${escapeHtml(url)}" alt="${escapeHtml(name)}" draggable="false" />
        <div class="viewer-img-tools">
          <button type="button" data-z="out" title="Diminuir">−</button>
          <span class="z-label">Ajustar</span>
          <button type="button" data-z="in" title="Aumentar">+</button>
          <button type="button" data-z="fit" title="Ajustar à tela">Ajustar</button>
          <button type="button" data-z="one" title="Tamanho real">100%</button>
        </div>
      </div>`;
    const stage = this.contentEl.querySelector(".viewer-img-stage");
    const img = stage.querySelector("img");
    const lbl = stage.querySelector(".z-label");
    const apply = () => {
      const z = this.zoom;
      img.classList.toggle("fit", z.fit);
      img.style.transform = z.fit ? "" : `translate(${z.x}px, ${z.y}px) scale(${z.scale})`;
      lbl.textContent = z.fit ? "Ajustar" : `${Math.round(z.scale * 100)}%`;
    };
    const fromFit = () => {
      if (!this.zoom.fit) return;
      const r = img.getBoundingClientRect();
      this.zoom = { scale: r.width / (img.naturalWidth || r.width), x: 0, y: 0, fit: false };
    };
    const zoomBy = (f) => {
      fromFit();
      this.zoom.scale = Math.min(8, Math.max(0.1, this.zoom.scale * f));
      apply();
    };
    stage.querySelectorAll("[data-z]").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.z;
        if (k === "in") zoomBy(1.25);
        else if (k === "out") zoomBy(0.8);
        else if (k === "fit") (this.zoom = { scale: 1, x: 0, y: 0, fit: true }), apply();
        else if (k === "one") (this.zoom = { scale: 1, x: 0, y: 0, fit: false }), apply();
      })
    );
    stage.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
      },
      { passive: false }
    );
    stage.addEventListener("pointerdown", (e) => {
      if (this.zoom.fit || e.target.closest(".viewer-img-tools")) return;
      stage.setPointerCapture(e.pointerId);
      const sx = e.clientX - this.zoom.x;
      const sy = e.clientY - this.zoom.y;
      stage.classList.add("grabbing");
      const move = (ev) => {
        this.zoom.x = ev.clientX - sx;
        this.zoom.y = ev.clientY - sy;
        apply();
      };
      stage.addEventListener("pointermove", move);
      stage.addEventListener(
        "pointerup",
        () => {
          stage.removeEventListener("pointermove", move);
          stage.classList.remove("grabbing");
        },
        { once: true }
      );
    });
    img.addEventListener("dblclick", () => {
      this.zoom.fit ? zoomBy(2) : ((this.zoom = { scale: 1, x: 0, y: 0, fit: true }), apply());
    });
    apply();
  }

  renderMissing(name, rel, err) {
    this.contentEl.innerHTML = `
      <div class="preview-fallback-card">
        <div class="preview-fallback-icon">⚠️</div>
        <h3 class="preview-fallback-title">Arquivo não encontrado</h3>
        <p class="preview-fallback-desc">O comprovante <b>${escapeHtml(name)}</b> está registrado, mas não existe mais no disco.<br><code>${escapeHtml(rel || "")}</code></p>
        <p class="preview-fallback-desc muted" style="font-size: calc(11px * var(--font-scale, 1))">${escapeHtml(err)}</p>
      </div>`;
  }

  renderFallback(name, rel, msg) {
    this.contentEl.innerHTML = `
      <div class="preview-fallback-card">
        <div class="preview-fallback-icon">📁</div>
        <h3 class="preview-fallback-title">${escapeHtml(name)}</h3>
        <p class="preview-fallback-desc">${escapeHtml(msg)}<br><code>${escapeHtml(rel || "")}</code></p>
        <button type="button" class="btn btn-primary" id="btn-preview-direct-open">Abrir em programa externo</button>
      </div>`;
    document.getElementById("btn-preview-direct-open")?.addEventListener("click", () => this.openInSystem());
  }

  toggleExpanded() {
    const on = this.drawer.classList.toggle("expanded");
    this.backdrop.classList.toggle("on", on && this.isOpen());
    this.syncDock();
  }

  close() {
    this.drawer.classList.remove("open", "expanded");
    this.backdrop.classList.remove("on");
    if (this._origTitle != null) {
      document.title = this._origTitle;
      this._origTitle = null;
    }
    this.currentBytes = null;
    if (this.attTabsEl) {
      this.attTabsEl.style.display = "none";
      this.attTabsEl.innerHTML = "";
    }
    this.syncDock();
    this.contentEl.innerHTML = "";
    this.current = null;
    this.pendingToken = null;
    this.releaseBlob();
    this.setFileActions(true);
  }

  async saveCurrentFile() {
    try {
      const suggestedName = (this.current?.name || this.filenameEl?.textContent || "preview_comprovantes.pdf").trim();
      const chosenPath = await api.selectSavePath(suggestedName, "pdf");
      if (!chosenPath) return;

      if (this.currentBytes) {
        await api.writeReport(this.currentBytes);
      } else if (this.current?.absPath) {
        const bytes = await api.readFileBytes(this.current.absPath);
        await api.writeReport(bytes);
      } else {
        throw new Error("Conteúdo do arquivo não disponível");
      }
      showToast(`PDF salvo com sucesso!`, "success", 4000);
    } catch (e) {
      showToast(`Erro ao salvar PDF: ${e?.message || e}`, "error", 5000);
    }
  }

  async openInSystem() {
    const c = this.current;
    if (!c) return;
    try {
      if (c.path) await api.openFile(c.path);
      else if (c.absPath) await api.openFile(c.absPath);
      showToast("Abrindo em programa externo...", "info", 2000);
    } catch (err) {
      showToast(`Erro ao abrir arquivo: ${err}`, "error");
    }
  }

  async revealInExplorer() {
    const c = this.current;
    if (!c) return;
    try {
      await api.revealInExplorer(c.path || c.absPath);
    } catch (err) {
      showToast(`Erro ao localizar no Explorer: ${err}`, "error");
    }
  }
}
