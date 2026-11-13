// Configurações: cadastro das opções dos dropdowns de cada categoria

import { api } from "../api.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../utils.js";
import { ACCENTS, MODES, DENSITIES, MOTION, getTheme } from "../theme.js";

export const DEFAULT_QUALIS = ["", "A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "B5", "C", "SQ"];

export class SettingsView {
  constructor({ container, onChanged, onTheme, onCategories, onBackup }) {
    this.container = container;
    this.onBackup = onBackup;
    this.onCategories = onCategories;
    this.onChanged = onChanged;
    this.onTheme = onTheme;
    this.mappings = [];
    this.qualis = DEFAULT_QUALIS.slice();
    this.active = "producoes";
  }

  setData(mappings, qualis) {
    this.mappings = mappings || [];
    if (qualis) this.qualis = qualis;
  }

  render() {
    const cats = Object.entries(CATEGORY_SCHEMAS);
    const isQualis = this.active === "__qualis";
    const isApp = this.active === "__aparencia" || this.active === "__dados" || this.active === "__categorias";
    const schema = CATEGORY_SCHEMAS[this.active];
    const opts = isQualis || isApp
      ? []
      : this.mappings.filter((m) => m.category_group.toLowerCase() === schema.group.toLowerCase());

    this.container.innerHTML = `
      <div class="settings-layout">
        <aside class="settings-menu">
          <div class="settings-menu-title">Aplicativo</div>
          <button class="settings-tab ${this.active === "__aparencia" ? "on" : ""}" data-tab="__aparencia"><span>🎨 Aparência</span></button>
          <button class="settings-tab ${this.active === "__dados" ? "on" : ""}" data-tab="__dados"><span>💾 Pasta de dados</span></button>
          <button class="settings-tab ${this.active === "__categorias" ? "on" : ""}" data-tab="__categorias"><span>🗂️ Categorias</span></button>
          <button class="settings-tab" data-tab="__backup" title="Criar backup (com ou sem os arquivos) e restaurar backups"><span>🛡️ Segurança e backup</span><span class="cnt">→</span></button>
          <div class="settings-menu-title" style="margin-top:14px">Listas de opções</div>
          ${cats
            .map(([k, s]) => {
              const n = this.mappings.filter((m) => m.category_group.toLowerCase() === s.group.toLowerCase()).length;
              return `<button class="settings-tab ${this.active === k ? "on" : ""}" data-tab="${k}">
                <span>${escapeHtml(s.group)}</span><span class="cnt">${n}</span></button>`;
            })
            .join("")}
          <div class="settings-menu-title" style="margin-top:14px">Campos extras</div>
          <button class="settings-tab ${isQualis ? "on" : ""}" data-tab="__qualis"><span>Qualis (Produções)</span><span class="cnt">${this.qualis.filter(Boolean).length}</span></button>
        </aside>
        <section class="settings-panel">
          ${this.active === "__aparencia" ? this.renderAppearance() : this.active === "__dados" || this.active === "__categorias" ? `<div class="loading-state" style="display:flex"><div class="spinner"></div></div>` : isQualis ? this.renderQualis() : this.renderOptions(schema, opts)}
        </section>
      </div>`;

    this.container.querySelectorAll("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.tab === "__backup") return this.onBackup && this.onBackup();
        this.active = b.dataset.tab;
        this.render();
      })
    );
    if (this.active === "__aparencia") this.bindAppearance();
    else if (this.active === "__dados") this.loadDataDir();
    else if (this.active === "__categorias") this.loadCategories();
    else isQualis ? this.bindQualis() : this.bindOptions(schema);
  }

  // ---------------- Aparência ----------------
  renderAppearance() {
    const t = getTheme();
    return `
      <div class="settings-head"><div>
        <h2>Aparência</h2>
        <p>Tema, cor de destaque e densidade. As preferências ficam salvas neste computador.</p>
      </div></div>
      <div class="ap-section" style="margin-top:0">
        <h3>Tema</h3>
        <div class="ap-grid">
          ${Object.entries(MODES)
            .map(
              ([k, label]) => `<button type="button" class="ap-mode ${t.mode === k ? "on" : ""}" data-mode="${k}">
              <div class="ap-prev ${k}"><div class="sb"></div><div class="mn"><i></i><i></i><i style="width:80%"></i><i style="width:45%"></i></div></div>
              ${label}${k === "system" ? '<div class="muted" style="font-weight:500;font-size:11.5px">segue o Windows</div>' : ""}</button>`
            )
            .join("")}
        </div>
      </div>
      <div class="ap-section">
        <h3>Cor de destaque</h3>
        <p class="hint">Usada em botões, seleções e realces.</p>
        <div class="ap-accents">
          ${Object.entries(ACCENTS)
            .map(([k, a]) => `<button type="button" class="ap-accent ${t.accent === k ? "on" : ""}" data-accent="${k}" style="--a:${a.c}"><i></i>${a.name}</button>`)
            .join("")}
        </div>
      </div>
      <div class="ap-section">
        <h3>Densidade</h3>
        <p class="hint">Compacta mostra mais linhas por tela nas tabelas.</p>
        <div class="seg">
          ${Object.entries(DENSITIES)
            .map(([k, l]) => `<button type="button" data-density="${k}" class="${t.density === k ? "on" : ""}">${l}</button>`)
            .join("")}
        </div>
      </div>
      <div class="ap-section">
        <h3>Animações</h3>
        <p class="hint">Fluido usa transições suaves entre telas; Reduzido deixa tudo instantâneo.</p>
        <div class="seg">
          ${Object.entries(MOTION)
            .map(([k, l]) => `<button type="button" data-motion="${k}" class="${(t.motion || "full") === k ? "on" : ""}">${l}</button>`)
            .join("")}
        </div>
      </div>
      <div class="ap-section">
        <h3>Fechamento facilitado</h3>
        <p class="hint">Quando ativado, clicar fora de uma janela (cadastro, importação etc.) a fecha. Desativado, ela só fecha em Cancelar ou no ×, evitando perder o que foi digitado.</p>
        <div class="seg">
          <button type="button" data-easyclose="0" class="${t.easyClose ? "" : "on"}">Desativado</button>
          <button type="button" data-easyclose="1" class="${t.easyClose ? "on" : ""}">Ativado</button>
        </div>
      </div>`;
  }

  bindAppearance() {
    const set = (patch) => {
      document.documentElement.classList.add("theme-anim");
      this.onTheme && this.onTheme(patch);
      setTimeout(() => document.documentElement.classList.remove("theme-anim"), 400);
      this.render();
    };
    this.container.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => set({ mode: b.dataset.mode })));
    this.container.querySelectorAll("[data-accent]").forEach((b) => b.addEventListener("click", () => set({ accent: b.dataset.accent })));
    this.container.querySelectorAll("[data-density]").forEach((b) => b.addEventListener("click", () => set({ density: b.dataset.density })));
    this.container.querySelectorAll("[data-motion]").forEach((b) => b.addEventListener("click", () => set({ motion: b.dataset.motion })));
    this.container.querySelectorAll("[data-easyclose]").forEach((b) => b.addEventListener("click", () => set({ easyClose: b.dataset.easyclose === "1" })));
  }

  // ---------------- Pasta de dados ----------------
  async loadDataDir() {
    const panel = this.container.querySelector(".settings-panel");
    let info = null;
    try {
      info = await api.getDataDirInfo();
    } catch (e) {
      info = null;
    }
    if (!info) {
      panel.innerHTML = `<div class="settings-head"><div><h2>Pasta de dados</h2><p>Disponível apenas no aplicativo desktop.</p></div></div>`;
      return;
    }
    this.dd = { info, pick: null, insp: null, mode: "copy" };
    this.renderDataDir();
  }

  renderDataDir() {
    const panel = this.container.querySelector(".settings-panel");
    const { info, pick, insp } = this.dd;
    const mb = (n) => (n / 1048576).toFixed(1) + " MB";
    const folders = info.folders.length
      ? `<span class="ok">✓ ${info.folders.length} pastas de comprovantes</span>`
      : `<span class="warn">⚠ nenhuma pasta de comprovantes (1_…, 5_producoes…) aqui</span>`;
    let choice = "";
    if (pick && insp) {
      const hasDb = insp.has_db;
      if (hasDb && this.dd.mode !== "use") this.dd.mode = "use";
      if (!hasDb && this.dd.mode === "use") this.dd.mode = "copy";
      const opt = (val, title, sub, enabled) =>
        `<label class="${enabled ? "" : "disabled"}"><input type="radio" name="dd-mode" value="${val}" ${this.dd.mode === val ? "checked" : ""} ${enabled ? "" : "disabled"}/>
          <div><b>${title}</b><small>${sub}</small></div></label>`;
      choice = `
        <div class="dd-new">
          <div class="rb-label">Nova pasta</div>
          <div class="dd-path">${escapeHtml(pick)}</div>
          <div class="dd-meta">
            ${hasDb ? '<span class="ok">✓ já contém um lattes.db</span>' : "<span>sem lattes.db</span>"}
            ${
              insp.folders.length
                ? `<span class="ok">✓ ${insp.folders.length} pastas de comprovantes: ${escapeHtml(insp.folders.slice(0, 4).join(", "))}${insp.folders.length > 4 ? "…" : ""}</span>`
                : '<span class="warn">sem pastas de comprovantes</span>'
            }
          </div>
          <div class="dd-choice">
            ${opt("copy", "Copiar o banco atual para a nova pasta", `Leva todos os registros (${mb(info.db_size)}). Use quando você moveu as pastas de comprovantes para lá.`, !hasDb)}
            ${opt("use", "Usar o banco que já está lá", "Abre os registros existentes nessa pasta.", hasDb)}
            ${opt("empty", "Começar um banco vazio", "Útil para outro currículo. O banco atual continua intacto onde está.", !hasDb)}
          </div>
          <div class="dd-actions">
            <button type="button" class="btn btn-primary" data-dd="apply">Usar esta pasta e reiniciar</button>
            <button type="button" class="btn btn-secondary" data-dd="cancel">Cancelar</button>
          </div>
          <p class="dd-note">Os arquivos não são movidos nem apagados — o app passa a ler e gravar nessa pasta. Os caminhos dos comprovantes são relativos à pasta de dados.</p>
        </div>`;
    }
    panel.innerHTML = `
      <div class="settings-head"><div>
        <h2>Pasta de dados</h2>
        <p>Local onde ficam o banco <b>lattes.db</b> e as subpastas de comprovantes (1_dados_gerais, 5_producoes…).</p>
      </div></div>
      <div class="dd-card">
        <div class="rb-label">Pasta atual ${info.from_config ? "(definida por você)" : "(detectada automaticamente)"}</div>
        <div class="dd-path">${escapeHtml(info.data_dir)}</div>
        <div class="dd-meta">
          <span>lattes.db · ${mb(info.db_size)}</span>
          ${folders}
        </div>
        <div class="dd-actions">
          <button type="button" class="btn btn-primary" data-dd="pick">📁 Escolher outra pasta…</button>
          <button type="button" class="btn btn-secondary" data-dd="open">Abrir no Explorer</button>
          ${info.from_config ? '<button type="button" class="btn btn-secondary" data-dd="reset">Voltar à detecção automática</button>' : ""}
        </div>
        ${choice}
      </div>
      <p class="dd-note">Configuração salva em <code>${escapeHtml(info.config_file)}</code>.</p>`;
    const $ = (sel) => panel.querySelector(sel);
    $('[data-dd="open"]').addEventListener("click", () => api.openFolder("").catch(() => {}));
    $('[data-dd="pick"]').addEventListener("click", async () => {
      const p = await api.pickFolder("Escolher pasta de dados do Lattes Manager");
      if (!p) return;
      this.dd.pick = p;
      this.dd.insp = await api.inspectDataDir(p);
      this.dd.mode = this.dd.insp.has_db ? "use" : "copy";
      this.renderDataDir();
    });
    $('[data-dd="reset"]')?.addEventListener("click", async () => {
      if (!window.confirm("Voltar à detecção automática da pasta de dados? O app será reiniciado.")) return;
      await api.resetDataDir().catch((e) => showToast(`Erro: ${e}`, "error"));
    });
    panel.querySelectorAll('input[name="dd-mode"]').forEach((r) => r.addEventListener("change", () => (this.dd.mode = r.value)));
    $('[data-dd="cancel"]')?.addEventListener("click", () => {
      this.dd.pick = null;
      this.dd.insp = null;
      this.renderDataDir();
    });
    $('[data-dd="apply"]')?.addEventListener("click", async () => {
      const copy = this.dd.mode === "copy";
      const what = copy ? "Copiar o banco atual para" : this.dd.mode === "use" ? "Usar o banco que está em" : "Começar com um banco vazio em";
      if (!window.confirm(`${what}:\n${pick}\n\nO app será reiniciado.`)) return;
      try {
        showToast("Aplicando e reiniciando…", "info", 4000);
        await api.setDataDir(pick, copy);
      } catch (e) {
        showToast(`Falha: ${e}`, "error", 7000);
      }
    });
  }


  // ---------------- Categorias personalizadas ----------------
  async loadCategories() {
    try {
      this.cc = { list: await api.listCustomCategories(), edit: this.cc?.edit || null };
    } catch (e) {
      this.cc = { list: [], edit: null };
    }
    this.renderCategories();
  }

  renderCategories() {
    const panel = this.container.querySelector(".settings-panel");
    const { list, edit } = this.cc;
    const ICONS = ["🏆", "🎖️", "🧪", "🌱", "🤝", "📣", "🗳️", "💼", "🧭", "🎤", "📝", "🛠️", "🌍", "🏅", "📺", "🗂️"];
    const builtin = Object.entries(CATEGORY_SCHEMAS).filter(([, s]) => !s.custom);
    const e = edit || {};
    const form = edit
      ? `<div class="cc-form">
          <div class="rb-label">${e.key ? "Editar categoria" : "Nova categoria"}</div>
          <div class="cc-grid">
            <label class="rb-field"><span>Nome *</span><input class="form-input" data-cc="name" value="${escapeHtml(e.name || "")}" placeholder="Ex.: Prêmios e Títulos"/></label>
            <label class="rb-field"><span>Descrição (subtítulo)</span><input class="form-input" data-cc="subtitle" value="${escapeHtml(e.subtitle || "")}" placeholder="Ex.: Premiações, homenagens e distinções"/></label>
            <label class="rb-field"><span>Rótulo do campo principal</span><input class="form-input" data-cc="title_label" value="${escapeHtml(e.title_label || "")}" placeholder="Título"/></label>
            <label class="rb-field"><span>Rótulo do campo de detalhes</span><input class="form-input" data-cc="desc_label" value="${escapeHtml(e.desc_label || "")}" placeholder="Descrição / detalhes"/></label>
            <label class="rb-field"><span>Pasta dos comprovantes</span><input class="form-input mono" data-cc="folder" value="${escapeHtml(e.folder || "")}" placeholder="automática (ex.: 12_premios)" ${e.key ? "" : ""}/></label>
            <label class="rb-field"><span>${e.key ? "Acrescentar subcategorias" : "Subcategorias"} <small class="muted">(uma por linha)</small></span><textarea class="form-textarea" data-cc="tipos" rows="3" placeholder="Prêmio&#10;Menção honrosa&#10;Homenagem">${escapeHtml((e.tipos || []).join("\n"))}</textarea></label>
          </div>
          <div class="rb-label" style="margin-top:6px">Ícone</div>
          <div class="cc-icons">${ICONS.map((i) => `<button type="button" class="cc-icon ${(e.icon || "🗂️") === i ? "on" : ""}" data-icon="${i}">${i}</button>`).join("")}</div>
          <div class="dd-actions">
            <button type="button" class="btn btn-primary" data-cca="save">${e.key ? "Salvar alterações" : "Criar categoria"}</button>
            <button type="button" class="btn btn-secondary" data-cca="cancel">Cancelar</button>
          </div>
          <p class="dd-note">A categoria aparece no menu lateral, nos Indicadores e no gerador de comprovantes. As subcategorias viram as opções de “Tipo”, cada uma com sua subpasta.</p>
        </div>`
      : "";
    panel.innerHTML = `
      <div class="settings-head"><div>
        <h2>Categorias</h2>
        <p>Crie categorias próprias (ex.: Prêmios, Consultorias, Revisões de periódicos) com subcategorias. As listas de subcategorias de todas as categorias ficam em <b>Listas de opções</b>.</p>
      </div>${edit ? "" : '<button type="button" class="btn btn-primary btn-sm" data-cca="new">+ Nova categoria</button>'}</div>
      ${form}
      <div class="rb-label" style="margin-top:14px">Suas categorias</div>
      <div class="cc-list">
        ${list.length
          ? list
              .map(
                (c, i) => `<div class="cc-item" style="--c:${CATEGORY_SCHEMAS[c.key]?.color || "#14b8a6"}">
              <span class="cc-ic">${escapeHtml(c.icon || "🗂️")}</span>
              <div class="cc-txt"><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.subtitle || "")} <span class="mono">${escapeHtml(c.folder)}</span></small></div>
              <span class="cnt">${c.count} registro(s)</span>
              <div class="opt-actions">
                <button class="icon-btn" title="Subir" data-ccmove="${i}" data-dir="-1" ${i ? "" : "disabled"}>↑</button>
                <button class="icon-btn" title="Descer" data-ccmove="${i}" data-dir="1" ${i < list.length - 1 ? "" : "disabled"}>↓</button>
                <button class="icon-btn" title="Subcategorias" data-ccopt="${escapeHtml(c.key)}">☰</button>
                <button class="icon-btn save" title="Editar" data-ccedit="${i}">✏️</button>
                <button class="icon-btn del" title="Excluir" data-ccdel="${i}">🗑️</button>
              </div></div>`
              )
              .join("")
          : '<div class="tl-empty">Nenhuma categoria personalizada ainda.</div>'}
      </div>
      <div class="rb-label" style="margin-top:14px">Categorias padrão</div>
      <div class="cc-builtin">${builtin.map(([k, s]) => `<span>${escapeHtml(s.group)}</span>`).join("")}</div>`;

    const $ = (s) => panel.querySelector(s);
    $('[data-cca="new"]')?.addEventListener("click", () => {
      this.cc.edit = { icon: "🏆", tipos: [] };
      this.renderCategories();
      panel.querySelector('[data-cc="name"]')?.focus();
    });
    $('[data-cca="cancel"]')?.addEventListener("click", () => {
      this.cc.edit = null;
      this.renderCategories();
    });
    panel.querySelectorAll("[data-icon]").forEach((b) =>
      b.addEventListener("click", () => {
        this.cc.edit.icon = b.dataset.icon;
        panel.querySelectorAll("[data-icon]").forEach((x) => x.classList.toggle("on", x === b));
      })
    );
    panel.querySelectorAll("[data-cc]").forEach((i) =>
      i.addEventListener("input", () => {
        const k = i.dataset.cc;
        this.cc.edit[k] = k === "tipos" ? i.value.split("\n") : i.value;
      })
    );
    $('[data-cca="save"]')?.addEventListener("click", async () => {
      const c = { ...this.cc.edit, tipos: (this.cc.edit.tipos || []).map((t) => t.trim()).filter(Boolean) };
      if (!String(c.name || "").trim()) return showToast("Informe o nome da categoria", "error");
      try {
        const saved = await api.saveCustomCategory({ key: c.key || "", name: c.name, icon: c.icon, subtitle: c.subtitle || null, folder: c.folder || "", title_label: c.title_label || null, desc_label: c.desc_label || null, position: c.position || 0, tipos: c.tipos, count: 0 });
        showToast(`Categoria “${saved.name}” ${c.key ? "atualizada" : "criada"}`, "success");
        this.cc.edit = null;
        this.onCategories && (await this.onCategories());
        this.render();
      } catch (e) {
        showToast(`Erro: ${e}`, "error", 5000);
      }
    });
    panel.querySelectorAll("[data-ccedit]").forEach((b) =>
      b.addEventListener("click", () => {
        this.cc.edit = { ...list[Number(b.dataset.ccedit)], tipos: [] };
        this.renderCategories();
      })
    );
    panel.querySelectorAll("[data-ccopt]").forEach((b) =>
      b.addEventListener("click", () => {
        this.active = b.dataset.ccopt;
        this.render();
      })
    );
    panel.querySelectorAll("[data-ccmove]").forEach((b) =>
      b.addEventListener("click", async () => {
        const i = Number(b.dataset.ccmove), j = i + Number(b.dataset.dir);
        const keys = list.map((c) => c.key);
        [keys[i], keys[j]] = [keys[j], keys[i]];
        await api.reorderCustomCategories(keys).catch(() => {});
        this.onCategories && (await this.onCategories());
        this.render();
      })
    );
    panel.querySelectorAll("[data-ccdel]").forEach((b) =>
      b.addEventListener("click", async () => {
        const c = list[Number(b.dataset.ccdel)];
        const msg = c.count
          ? `Excluir a categoria “${c.name}” e seus ${c.count} registro(s)?\n\nOs arquivos dos comprovantes continuam na pasta ${c.folder}.`
          : `Excluir a categoria “${c.name}”?`;
        if (!window.confirm(msg)) return;
        try {
          await api.deleteCustomCategory(c.key, true);
          showToast("Categoria excluída", "success");
          this.onCategories && (await this.onCategories());
          this.render();
        } catch (e) {
          showToast(`Erro: ${e}`, "error");
        }
      })
    );
  }

  renderOptions(schema, opts) {
    return `
      <div class="settings-head">
        <div>
          <h2>${escapeHtml(schema.name)}</h2>
          <p>Opções do campo <b>Tipo</b> exibidas no formulário. Cada opção define a subpasta onde o comprovante é salvo.</p>
        </div>
      </div>
      <div class="opt-list">
        <div class="opt-row opt-header"><span>Opção (Tipo)</span><span>Subpasta de destino</span><span></span></div>
        ${opts
          .map(
            (m) => `<div class="opt-row" data-id="${m.id}">
            <input class="form-input" data-k="description" value="${escapeHtml(m.description)}" />
            <input class="form-input mono" data-k="folder" value="${escapeHtml(m.folder)}" />
            <div class="opt-actions">
              <button class="icon-btn save" title="Salvar alterações" data-act="save">💾</button>
              <button class="icon-btn del" title="Excluir opção" data-act="del">🗑️</button>
            </div>
          </div>`
          )
          .join("") || '<div class="muted" style="padding:14px">Nenhuma opção cadastrada.</div>'}
        <div class="opt-row opt-new">
          <input class="form-input" id="new-opt-desc" placeholder="Nova opção, ex: Artigos internacionais" />
          <input class="form-input mono" id="new-opt-folder" placeholder="${escapeHtml(this.suggestRoot(schema))}nova_pasta\\" />
          <div class="opt-actions"><button class="btn btn-primary btn-sm" id="btn-add-opt">+ Adicionar</button></div>
        </div>
      </div>`;
  }

  suggestRoot(schema) {
    const any = this.mappings.find((m) => m.category_group.toLowerCase() === schema.group.toLowerCase());
    if (!any) return "";
    const parts = any.folder.replace(/\\+$/, "").split("\\");
    parts.pop();
    return parts.length ? parts.join("\\") + "\\" : "";
  }

  slug(s) {
    return s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  }

  bindOptions(schema) {
    this.container.querySelectorAll(".opt-row[data-id]").forEach((row) => {
      const id = row.dataset.id;
      row.querySelector('[data-act="save"]').addEventListener("click", async () => {
        const d = row.querySelector('[data-k="description"]').value.trim();
        const f = row.querySelector('[data-k="folder"]').value.trim();
        if (!d || !f) return showToast("Preencha opção e subpasta", "error");
        try {
          await api.updateSubfolderMapping(id, d, f);
          showToast("Opção atualizada", "success", 1800);
          this.onChanged && this.onChanged();
        } catch (e) {
          showToast(`Erro: ${e}`, "error");
        }
      });
      row.querySelector('[data-act="del"]').addEventListener("click", async () => {
        const d = row.querySelector('[data-k="description"]').value;
        if (!window.confirm(`Excluir a opção '${d}'?\n\nRegistros existentes e arquivos não serão alterados.`)) return;
        try {
          await api.deleteSubfolderMapping(id);
          showToast("Opção excluída", "success", 1800);
          this.onChanged && this.onChanged();
        } catch (e) {
          showToast(`Erro: ${e}`, "error");
        }
      });
    });
    const desc = this.container.querySelector("#new-opt-desc");
    const folder = this.container.querySelector("#new-opt-folder");
    desc.addEventListener("input", () => {
      if (!folder.dataset.touched) folder.value = desc.value.trim() ? `${this.suggestRoot(schema)}${this.slug(desc.value)}\\` : "";
    });
    folder.addEventListener("input", () => (folder.dataset.touched = "1"));
    this.container.querySelector("#btn-add-opt").addEventListener("click", async () => {
      const d = desc.value.trim();
      const f = folder.value.trim();
      if (!d || !f) return showToast("Preencha opção e subpasta", "error");
      try {
        await api.addSubfolderMapping(schema.group, d, f);
        showToast("Opção adicionada", "success", 1800);
        this.onChanged && this.onChanged();
      } catch (e) {
        showToast(`Erro: ${e}`, "error");
      }
    });
  }

  renderQualis() {
    return `
      <div class="settings-head"><div>
        <h2>Qualis</h2>
        <p>Estratos disponíveis no campo <b>Qualis</b> das produções.</p>
      </div></div>
      <div class="chip-editor">
        ${this.qualis
          .filter(Boolean)
          .map((q, i) => `<span class="chip-edit">${escapeHtml(q)}<button data-rm="${escapeHtml(q)}" title="Remover">&times;</button></span>`)
          .join("")}
      </div>
      <div class="opt-new-inline">
        <input class="form-input" id="new-qualis" placeholder="Novo estrato, ex: A5" style="max-width:220px" />
        <button class="btn btn-primary btn-sm" id="btn-add-qualis">+ Adicionar</button>
        <button class="btn btn-secondary btn-sm" id="btn-reset-qualis">Restaurar padrão</button>
      </div>`;
  }

  bindQualis() {
    const save = async (list) => {
      try {
        await api.setDropdownOptions("qualis", list);
        this.qualis = list;
        showToast("Lista de Qualis salva", "success", 1500);
        this.onChanged && this.onChanged();
      } catch (e) {
        showToast(`Erro: ${e}`, "error");
      }
    };
    this.container.querySelectorAll("[data-rm]").forEach((b) =>
      b.addEventListener("click", () => save(this.qualis.filter((q) => q !== b.dataset.rm)))
    );
    const inp = this.container.querySelector("#new-qualis");
    const add = () => {
      const v = inp.value.trim().toUpperCase();
      if (!v || this.qualis.includes(v)) return;
      save([...(this.qualis.includes("") ? [] : [""]), ...this.qualis, v]);
    };
    this.container.querySelector("#btn-add-qualis").addEventListener("click", add);
    inp.addEventListener("keydown", (e) => e.key === "Enter" && add());
    this.container.querySelector("#btn-reset-qualis").addEventListener("click", () => save(DEFAULT_QUALIS.slice()));
  }
}

