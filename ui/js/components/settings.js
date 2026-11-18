// Configurações: cadastro das opções dos dropdowns de cada categoria

import { api } from "../api.js";
import {
  CATEGORY_SCHEMAS,
  DEFAULT_CATEGORY_META,
  escapeHtml,
  showToast,
  applyCategoryOrder,
  DEFAULT_CATEGORY_ORDER,
  writeSavedCategoryOrder,
  hasCategoryOverride,
  saveCategoryOverride,
  resetCategoryOverride,
  categoryColor,
} from "../utils.js";
import { PALETTE } from "./charts.js";
import { ACCENTS, MODES, DENSITIES, FONT_SIZES, MOTION, getTheme } from "../theme.js";

export const DEFAULT_QUALIS = ["", "A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "B5", "C", "SQ"];

const ICON_CATEGORIES = [
  {
    id: "ensino",
    label: "Ensino e Formação",
    icons: ["🎓", "📚", "📖", "🏫", "🧑‍🏫", "✏️", "🖊️", "📐", "📏", "🎒", "📓", "🗂️"],
  },
  {
    id: "pesquisa",
    label: "Pesquisa e Ciência",
    icons: ["🔬", "🧪", "🧬", "⚗️", "🔭", "🧫", "🧲", "⚛️", "📊", "📈", "📉", "🧮"],
  },
  {
    id: "agro",
    label: "Agrárias, Biologia e Ambiente",
    icons: ["🌱", "🌾", "🌿", "🌳", "🍃", "🌽", "🌻", "🚜", "🌍", "💧", "☀️", "🐝"],
  },
  {
    id: "producoes",
    label: "Produções, Escrita e Editorial",
    icons: ["📄", "📝", "📰", "📑", "📘", "📙", "📗", "📕", "🖋️", "📋", "🗃️", "🔖"],
  },
  {
    id: "gestao",
    label: "Gestão, Bancas e Institucional",
    icons: ["🏛️", "⚖️", "💼", "🗳️", "🤝", "🪪", "📌", "📎", "🏢", "🧭", "📜", "🔐"],
  },
  {
    id: "eventos",
    label: "Prêmios, Eventos e Extensão",
    icons: ["🏆", "🎖️", "🥇", "🏅", "🎤", "📣", "🎙️", "🎪", "🎭", "🌐", "🎯", "⭐"],
  },
  {
    id: "tecnologia",
    label: "Tecnologia, Patentes e Engenharia",
    icons: ["💡", "🛠️", "⚙️", "💻", "🖥️", "🤖", "📡", "🔋", "🧱", "🏗️", "🔧", "📦"],
  },
  {
    id: "geral",
    label: "Pessoas, Saúde e Geral",
    icons: ["👤", "👥", "🧠", "🩺", "💊", "🏥", "🗣️", "✈️", "🏳️", "📺", "📷", "🎨"],
  },
];

function renderIconPickerHtml(selectedIcon = "🗂️") {
  const totalIcons = ICON_CATEGORIES.reduce((acc, cat) => acc + cat.icons.length, 0);
  const current = selectedIcon || "🗂️";
  return `
    <div class="cc-icon-picker">
      <div class="cc-icon-head">
        <div class="cc-icon-head-left">
          <span class="rb-label" style="margin:0">Ícone</span>
          <span class="cc-icon-selected-preview" id="cc-icon-preview" title="Ícone selecionado">${escapeHtml(current)}</span>
          <span class="cc-icon-count">${totalIcons} opções em ${ICON_CATEGORIES.length} categorias</span>
        </div>
        <div class="cc-icon-cat-pills">
          <button type="button" class="cc-icon-cat-pill on" data-icon-cat="all">Todas</button>
          ${ICON_CATEGORIES.map((cat) => `<button type="button" class="cc-icon-cat-pill" data-icon-cat="${cat.id}">${escapeHtml(cat.label)}</button>`).join("")}
        </div>
      </div>
      <div class="cc-icon-groups" id="cc-icon-groups">
        ${ICON_CATEGORIES.map((cat) => `
          <div class="cc-icon-group" data-icon-group="${cat.id}">
            <div class="cc-icon-group-title">${escapeHtml(cat.label)}</div>
            <div class="cc-icons">
              ${cat.icons.map((i) => `<button type="button" class="cc-icon ${current === i ? "on" : ""}" data-icon="${i}" title="${escapeHtml(cat.label)}: ${i}">${i}</button>`).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    </div>`;
}

function bindIconPicker(rootEl, onPick) {
  const previewEl = rootEl.querySelector("#cc-icon-preview");
  const groupsWrap = rootEl.querySelector("#cc-icon-groups");
  rootEl.querySelectorAll("[data-icon]").forEach((b) =>
    b.addEventListener("click", () => {
      if (previewEl) previewEl.textContent = b.dataset.icon;
      rootEl.querySelectorAll("[data-icon]").forEach((x) => x.classList.toggle("on", x === b));
      onPick && onPick(b.dataset.icon);
    })
  );
  rootEl.querySelectorAll("[data-icon-cat]").forEach((pill) =>
    pill.addEventListener("click", () => {
      const catId = pill.dataset.iconCat;
      rootEl.querySelectorAll("[data-icon-cat]").forEach((p) => p.classList.toggle("on", p === pill));
      rootEl.querySelectorAll("[data-icon-group]").forEach((grp) => {
        grp.hidden = catId !== "all" && grp.dataset.iconGroup !== catId;
      });
      if (groupsWrap) groupsWrap.classList.toggle("is-filtered", catId !== "all");
    })
  );
}

export class SettingsView {
  constructor({ container, onChanged, onTheme, onCategories, onBackup }) {
    this.container = container;
    this.onBackup = onBackup;
    this.onCategories = onCategories;
    this.onChanged = onChanged;
    this.onTheme = onTheme;
    this.mappings = [];
    this.qualis = DEFAULT_QUALIS.slice();
    this.stats = null;
    this.active = "producoes";
    this._ccLoaded = false;
    this.optRenameOpen = false;
    this._optDraft = null;
    this._scholarConfig = null;
    this._scholarLoading = false;
    this._scholarSyncing = false;
    this._scholarSyncReport = null;
  }

  setData(mappings, qualis, stats = null) {
    this.mappings = mappings || [];
    if (qualis) this.qualis = qualis;
    if (stats) this.stats = stats;
  }

  async persistBuiltinCategory(key, { name, group, subtitle, icon }) {
    const cleanName = String(name || "").trim();
    const cleanGroup = String(group || "").trim();
    const finalName = cleanName || cleanGroup;
    const finalGroup = cleanGroup || cleanName;
    if (!finalName) throw new Error("Informe o nome da categoria");
    const savedOv = saveCategoryOverride(key, {
      name: finalName,
      group: finalGroup,
      subtitle: subtitle ?? "",
      icon: icon || "🗂️",
    });
    await api.setSetting("options.category_overrides", savedOv).catch(() => { });
    if (this.onCategories) await this.onCategories();
    return CATEGORY_SCHEMAS[key];
  }

  async resetBuiltinCategoryMeta(key) {
    const savedOv = resetCategoryOverride(key);
    await api.setSetting("options.category_overrides", savedOv).catch(() => { });
    if (this.onCategories) await this.onCategories();
    return CATEGORY_SCHEMAS[key];
  }

  render() {
    const cats = Object.entries(CATEGORY_SCHEMAS);
    const isQualis = this.active === "__qualis";
    const isApp = this.active === "__aparencia" || this.active === "__dados" || this.active === "__categorias" || this.active === "__scholar";
    const schema = CATEGORY_SCHEMAS[this.active];
    const opts = isQualis || isApp
      ? []
      : this.mappings.filter((m) => m.category_group.toLowerCase() === (schema.dbGroup || schema.group).toLowerCase());
    const ccReady = this.active === "__categorias" && this._ccLoaded && this.cc;

    this.container.innerHTML = `
      <div class="settings-layout">
        <aside class="settings-menu">
          <div class="settings-menu-title">Aplicativo</div>
          <button class="settings-tab ${this.active === "__aparencia" ? "on" : ""}" data-tab="__aparencia"><span>🎨 Aparência</span></button>
          <button class="settings-tab ${this.active === "__dados" ? "on" : ""}" data-tab="__dados"><span>💾 Pasta de dados</span></button>
          <button class="settings-tab ${this.active === "__categorias" ? "on" : ""}" data-tab="__categorias"><span>🗂️ Categorias</span></button>
          <button class="settings-tab ${this.active === "__scholar" ? "on" : ""}" data-tab="__scholar"><span>🎓 Google Scholar & APIs</span></button>
          <button class="settings-tab" data-tab="__backup" title="Criar backup (com ou sem os arquivos) e restaurar backups"><span>🛡️ Segurança e backup</span><span class="cnt">→</span></button>
          <div class="settings-menu-title" style="margin-top:14px">Listas de opções</div>
          ${cats
        .map(([k, s]) => {
          const dbGroup = (s.dbGroup || s.group).toLowerCase();
          const n = this.mappings.filter((m) => m.category_group.toLowerCase() === dbGroup).length;
          return `<button class="settings-tab ${this.active === k ? "on" : ""}" data-tab="${k}">
                <span>${escapeHtml(s.group)}</span><span class="cnt">${n}</span></button>`;
        })
        .join("")}
          <div class="settings-menu-title" style="margin-top:14px">Campos extras</div>
          <button class="settings-tab ${isQualis ? "on" : ""}" data-tab="__qualis"><span>Qualis (Produções)</span><span class="cnt">${this.qualis.filter(Boolean).length}</span></button>
        </aside>
        <section class="settings-panel">
          ${this.active === "__aparencia" ? this.renderAppearance() : this.active === "__scholar" ? this.renderScholar() : this.active === "__dados" || (this.active === "__categorias" && !ccReady) ? `<div class="loading-state" style="display:flex"><div class="spinner"></div></div>` : isQualis ? this.renderQualis() : ccReady ? "" : this.renderOptions(this.active, schema, opts)}
        </section>
      </div>`;

    this.container.querySelectorAll("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.tab === "__backup") return this.onBackup && this.onBackup();
        if (b.dataset.tab === "__categorias") this._ccLoaded = false;
        if (b.dataset.tab === "__scholar") {
          this.loadScholarConfig();
        }
        if (this.active !== b.dataset.tab) {
          this.optRenameOpen = false;
          this._optDraft = null;
        }
        this.active = b.dataset.tab;
        this.render();
      })
    );
    if (this.active === "__aparencia") this.bindAppearance();
    else if (this.active === "__scholar") this.bindScholar();
    else if (this.active === "__dados") this.loadDataDir();
    else if (this.active === "__categorias") {
      if (ccReady) this.renderCategories();
      else this.loadCategories();
    } else isQualis ? this.bindQualis() : this.bindOptions(this.active, schema);
  }

  // ---------------- Aparência ----------------
  renderAppearance() {
    const t = getTheme();
    return `
      <div class="settings-head"><div>
        <h2>Aparência</h2>
        <p>Tema, cor de destaque, tamanho da letra e densidade. As preferências ficam salvas neste computador.</p>
      </div></div>
      <div class="ap-section" style="margin-top:0">
        <h3>Tema</h3>
        <div class="ap-grid">
          ${Object.entries(MODES)
        .map(
          ([k, label]) => `<button type="button" class="ap-mode ${t.mode === k ? "on" : ""}" data-mode="${k}">
              <div class="ap-prev ${k}"><div class="sb"></div><div class="mn"><i></i><i></i><i style="width:80%"></i><i style="width:45%"></i></div></div>
              ${label}${k === "system" ? '<div class="muted" style="font-weight:500;font-size: calc(11.5px * var(--font-scale, 1))">segue o Windows</div>' : ""}</button>`
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
        <h3>Tamanho da letra</h3>
        <p class="hint">Ajusta a escala dos textos em todo o aplicativo.</p>
        <div class="seg">
          ${Object.entries(FONT_SIZES)
        .map(([k, l]) => `<button type="button" data-fontsize="${k}" class="${(t.fontSize || "md") === k ? "on" : ""}">${l}</button>`)
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
    this.container.querySelectorAll("[data-fontsize]").forEach((b) => b.addEventListener("click", () => set({ fontSize: b.dataset.fontsize })));
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
            ${insp.folders.length
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
    $('[data-dd="open"]').addEventListener("click", () => api.openFolder("").catch(() => { }));
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


  // ---------------- Categorias (padrão e personalizadas) ----------------
  async loadCategories() {
    try {
      const [list, stats] = await Promise.all([
        api.listCustomCategories(),
        this.stats ? Promise.resolve(this.stats) : api.getAppStats().catch(() => null),
      ]);
      if (stats) this.stats = stats;
      this.cc = { list: list || [], edit: this.cc?.edit || null };
    } catch (e) {
      this.cc = { list: [], edit: null };
    }
    this._ccLoaded = true;
    this.renderCategories();
  }

  async saveCategoryOrder(newKeys) {
    const valid = [...new Set(newKeys)].filter((k) => CATEGORY_SCHEMAS[k]);
    for (const k of Object.keys(CATEGORY_SCHEMAS)) {
      if (!valid.includes(k)) valid.push(k);
    }
    writeSavedCategoryOrder(valid);
    const ordered = applyCategoryOrder(valid);
    const customKeys = ordered.filter((k) => CATEGORY_SCHEMAS[k]?.custom);

    if (this.cc?.list) {
      const rank = new Map(ordered.map((k, i) => [k, i]));
      this.cc.list = [...this.cc.list].sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999));
    }

    await Promise.all([
      api.setDropdownOptions("category_order", ordered).catch(() => { }),
      customKeys.length ? api.reorderCustomCategories(customKeys).catch(() => { }) : Promise.resolve(),
    ]);

    const panelScroll = this.container.querySelector(".settings-panel")?.scrollTop || 0;
    const menuScroll = this.container.querySelector(".settings-menu")?.scrollTop || 0;
    this._ccLoaded = true;
    if (this.onCategories) await this.onCategories();
    this.render();
    const newPanel = this.container.querySelector(".settings-panel");
    const newMenu = this.container.querySelector(".settings-menu");
    if (newPanel) newPanel.scrollTop = panelScroll;
    if (newMenu) newMenu.scrollTop = menuScroll;
  }

  renderCategories() {
    const panel = this.container.querySelector(".settings-panel");
    if (!panel) return;
    const { list, edit } = this.cc || { list: [], edit: null };
    const customByKey = new Map(list.map((c) => [c.key, c]));
    const allCats = Object.entries(CATEGORY_SCHEMAS).filter(([, s]) => !s.legacy);
    const allKeys = allCats.map(([k]) => k);
    const defaultKeys = [
      ...DEFAULT_CATEGORY_ORDER.filter((k) => CATEGORY_SCHEMAS[k]),
      ...allKeys.filter((k) => !DEFAULT_CATEGORY_ORDER.includes(k)),
    ];
    const isDefaultOrder = allKeys.every((k, idx) => k === defaultKeys[idx]);
    const counts = this.stats?.counts_by_category || {};

    const e = edit || {};
    const form = edit
      ? e.builtin
        ? `<div class="cc-form">
            <div class="rb-label">Editar categoria padrão (${escapeHtml(DEFAULT_CATEGORY_META[e.key]?.name || e.key)})</div>
            <div class="cc-grid">
              <label class="rb-field">
                <span>Nome no menu lateral *</span>
                <input class="form-input" data-cc="group" value="${escapeHtml(e.group || "")}" placeholder="${escapeHtml(DEFAULT_CATEGORY_META[e.key]?.group || "")}"/>
                <small class="cc-field-hint">Exibido na barra lateral, em Listas de opções e nos gráficos</small>
              </label>
              <label class="rb-field">
                <span>Título completo da página *</span>
                <input class="form-input" data-cc="name" value="${escapeHtml(e.name || "")}" placeholder="${escapeHtml(DEFAULT_CATEGORY_META[e.key]?.name || "")}"/>
                <small class="cc-field-hint">Exibido no cabeçalho da categoria e nos relatórios PDF</small>
              </label>
              <label class="rb-field cc-field-span">
                <span>Descrição (subtítulo)</span>
                <input class="form-input" data-cc="subtitle" value="${escapeHtml(e.subtitle || "")}" placeholder="${escapeHtml(DEFAULT_CATEGORY_META[e.key]?.subtitle || "")}"/>
              </label>
            </div>
            ${renderIconPickerHtml(e.icon || DEFAULT_CATEGORY_META[e.key]?.icon || "🗂️")}
            <div class="dd-actions">
              <button type="button" class="btn btn-primary" data-cca="save">Salvar alterações</button>
              ${hasCategoryOverride(e.key) ? `<button type="button" class="btn btn-secondary" data-cca="reset-builtin">↺ Restaurar padrão</button>` : ""}
              <button type="button" class="btn btn-secondary" data-cca="cancel">Cancelar</button>
            </div>
            <p class="dd-note">O vínculo interno com os registros e com as subpastas (${escapeHtml(CATEGORY_SCHEMAS[e.key]?.folder || "")}) é preservado automaticamente.</p>
          </div>`
        : `<div class="cc-form">
            <div class="rb-label">${e.key ? "Editar categoria" : "Nova categoria"}</div>
            <div class="cc-grid">
              <label class="rb-field"><span>Nome *</span><input class="form-input" data-cc="name" value="${escapeHtml(e.name || "")}" placeholder="Ex.: Prêmios e Títulos"/></label>
              <label class="rb-field"><span>Descrição (subtítulo)</span><input class="form-input" data-cc="subtitle" value="${escapeHtml(e.subtitle || "")}" placeholder="Ex.: Premiações, homenagens e distinções"/></label>
              <label class="rb-field"><span>Rótulo do campo principal</span><input class="form-input" data-cc="title_label" value="${escapeHtml(e.title_label || "")}" placeholder="Título"/></label>
              <label class="rb-field"><span>Rótulo do campo de detalhes</span><input class="form-input" data-cc="desc_label" value="${escapeHtml(e.desc_label || "")}" placeholder="Descrição / detalhes"/></label>
              <label class="rb-field"><span>Pasta dos comprovantes</span><input class="form-input mono" data-cc="folder" value="${escapeHtml(e.folder || "")}" placeholder="automática (ex.: 12_premios)"/></label>
              <label class="rb-field"><span>${e.key ? "Acrescentar subcategorias" : "Subcategorias"} <small class="muted">(uma por linha)</small></span><textarea class="form-textarea" data-cc="tipos" rows="3" placeholder="Prêmio&#10;Menção honrosa&#10;Homenagem">${escapeHtml((e.tipos || []).join("\n"))}</textarea></label>
            </div>
            ${renderIconPickerHtml(e.icon || "🗂️")}
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
        <p>Renomeie qualquer categoria, crie categorias próprias e organize a ordem de exibição no menu lateral arrastando ou usando as setas.</p>
      </div>${edit
        ? ""
        : `<div class="cc-head-row">
              <button type="button" class="btn btn-secondary btn-sm" data-cca="reset-order" ${isDefaultOrder ? "disabled" : ""} title="Restaurar ordem padrão das categorias">↺ Restaurar ordem padrão</button>
              <button type="button" class="btn btn-primary btn-sm" data-cca="new">+ Nova categoria</button>
            </div>`
      }</div>
      ${form}
      <div class="rb-label" style="margin-top:14px">Ordem e categorias (${allCats.length})</div>
      <div class="cc-list">
        ${allCats
        .map(([k, s], i) => {
          const custom = customByKey.get(k);
          const isCustom = Boolean(s.custom || custom);
          const isRenamed = !isCustom && hasCategoryOverride(k);
          const icon = custom?.icon || s.icon || "🗂️";
          const name = custom?.name || s.name || s.group || k;
          const menuLabel = s.group && s.group !== name ? `Menu: ${s.group} · ` : "";
          const sub = custom?.subtitle || s.subtitle || "";
          const folder = custom?.folder || s.folder || "";
          const count = custom ? custom.count : (counts[k] ?? 0);
          const color = categoryColor(k, PALETTE);
          return `<div class="cc-item" data-cckey="${escapeHtml(k)}" data-ccidx="${i}" style="--c:${color}">
              <span class="cc-grip" title="Arraste para reordenar" aria-hidden="true">⠿</span>
              <span class="cc-pos">${i + 1}</span>
              <span class="cc-ic">${escapeHtml(icon)}</span>
              <div class="cc-txt">
                <div class="cc-name-line"><b>${escapeHtml(name)}</b><span class="cc-tag ${isCustom ? "custom" : ""}">${isCustom ? "Personalizada" : "Padrão"}</span>${isRenamed ? `<span class="cc-tag renamed">Renomeada</span>` : ""}</div>
                <small>${escapeHtml(menuLabel)}${escapeHtml(sub)}${folder ? ` <span class="mono">${escapeHtml(folder)}</span>` : ""}</small>
              </div>
              <span class="cnt">${count} registro(s)</span>
              <div class="opt-actions">
                <button class="icon-btn" title="Subir" data-ccmove="${i}" data-dir="-1" ${i ? "" : "disabled"}>↑</button>
                <button class="icon-btn" title="Descer" data-ccmove="${i}" data-dir="1" ${i < allCats.length - 1 ? "" : "disabled"}>↓</button>
                <button class="icon-btn" title="Subcategorias" data-ccopt="${escapeHtml(k)}">☰</button>
                <button class="icon-btn save" title="Editar nome, descrição e ícone" data-ccedit="${escapeHtml(k)}">✏️</button>
                ${isCustom
              ? `<button class="icon-btn del" title="Excluir" data-ccdel="${escapeHtml(k)}">🗑️</button>`
              : isRenamed
                ? `<button class="icon-btn" title="Restaurar padrão" data-ccreset="${escapeHtml(k)}">↺</button>`
                : ""
            }
              </div>
            </div>`;
        })
        .join("")}
      </div>`;

    const $ = (s) => panel.querySelector(s);
    $('[data-cca="new"]')?.addEventListener("click", () => {
      this.cc.edit = { icon: "🏆", tipos: [] };
      this.renderCategories();
      panel.querySelector('[data-cc="name"]')?.focus();
    });
    $('[data-cca="reset-order"]')?.addEventListener("click", async () => {
      await this.saveCategoryOrder(defaultKeys);
      showToast("Ordem padrão das categorias restaurada", "success", 2200);
    });
    $('[data-cca="cancel"]')?.addEventListener("click", () => {
      this.cc.edit = null;
      this.renderCategories();
    });
    $('[data-cca="reset-builtin"]')?.addEventListener("click", async () => {
      const key = this.cc.edit?.key;
      if (!key) return;
      try {
        await this.resetBuiltinCategoryMeta(key);
        showToast("Categoria restaurada para o padrão", "success");
        this.cc.edit = null;
        this.renderCategories();
      } catch (err) {
        showToast(`Erro: ${err}`, "error", 5000);
      }
    });
    bindIconPicker(panel, (icon) => {
      if (this.cc?.edit) this.cc.edit.icon = icon;
    });
    panel.querySelectorAll("[data-cc]").forEach((i) =>
      i.addEventListener("input", () => {
        const k = i.dataset.cc;
        this.cc.edit[k] = k === "tipos" ? i.value.split("\n") : i.value;
      })
    );
    $('[data-cca="save"]')?.addEventListener("click", async () => {
      if (this.cc.edit?.builtin) {
        try {
          const updated = await this.persistBuiltinCategory(this.cc.edit.key, this.cc.edit);
          showToast(`Categoria “${updated?.name || this.cc.edit.name}” atualizada`, "success");
          this.cc.edit = null;
          this.render();
        } catch (err) {
          showToast(typeof err === "string" ? err : err?.message || `Erro: ${err}`, "error", 5000);
        }
        return;
      }
      const c = { ...this.cc.edit, tipos: (this.cc.edit.tipos || []).map((t) => t.trim()).filter(Boolean) };
      if (!String(c.name || "").trim()) return showToast("Informe o nome da categoria", "error");
      try {
        const saved = await api.saveCustomCategory({ key: c.key || "", name: c.name, icon: c.icon, subtitle: c.subtitle || null, folder: c.folder || "", title_label: c.title_label || null, desc_label: c.desc_label || null, position: c.position || 0, tipos: c.tipos, count: 0 });
        showToast(`Categoria “${saved.name}” ${c.key ? "atualizada" : "criada"}`, "success");
        this.cc.edit = null;
        this._ccLoaded = false;
        this.onCategories && (await this.onCategories());
        this.render();
      } catch (e) {
        showToast(`Erro: ${e}`, "error", 5000);
      }
    });
    panel.querySelectorAll("[data-ccedit]").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.ccedit;
        const item = customByKey.get(k);
        if (item) {
          this.cc.edit = { ...item, tipos: [] };
        } else {
          const s = CATEGORY_SCHEMAS[k];
          if (!s) return;
          this.cc.edit = {
            key: k,
            builtin: true,
            group: s.group || s.name || "",
            name: s.name || "",
            subtitle: s.subtitle || "",
            icon: s.icon || "🗂️",
          };
        }
        this.renderCategories();
        panel.querySelector('[data-cc="group"], [data-cc="name"]')?.focus();
      })
    );
    panel.querySelectorAll("[data-ccreset]").forEach((b) =>
      b.addEventListener("click", async () => {
        const k = b.dataset.ccreset;
        try {
          await this.resetBuiltinCategoryMeta(k);
          if (this.cc?.edit?.key === k) this.cc.edit = null;
          showToast("Categoria restaurada para o padrão", "success");
          this.renderCategories();
        } catch (err) {
          showToast(`Erro: ${err}`, "error");
        }
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
        const i = Number(b.dataset.ccmove);
        const j = i + Number(b.dataset.dir);
        if (j < 0 || j >= allKeys.length) return;
        const next = [...allKeys];
        [next[i], next[j]] = [next[j], next[i]];
        await this.saveCategoryOrder(next);
      })
    );
    panel.querySelectorAll("[data-ccdel]").forEach((b) =>
      b.addEventListener("click", async () => {
        const c = customByKey.get(b.dataset.ccdel);
        if (!c) return;
        const msg = c.count
          ? `Excluir a categoria “${c.name}” e seus ${c.count} registro(s)?\n\nOs arquivos dos comprovantes continuam na pasta ${c.folder}.`
          : `Excluir a categoria “${c.name}”?`;
        if (!window.confirm(msg)) return;
        try {
          await api.deleteCustomCategory(c.key, true);
          showToast("Categoria excluída", "success");
          this._ccLoaded = false;
          this.onCategories && (await this.onCategories());
          this.render();
        } catch (e) {
          showToast(`Erro: ${e}`, "error");
        }
      })
    );

    // Reordenação por Pointer Events (evita bloqueio do IDropTarget/OLE no Tauri Windows)
    const ccList = panel.querySelector(".cc-list");
    const items = [...panel.querySelectorAll(".cc-item[data-cckey]")];
    const clearDragClasses = () => {
      ccList?.classList.remove("cc-list-dragging");
      items.forEach((el) => el.classList.remove("dragging", "drag-over", "drag-over-top", "drag-over-bottom"));
    };
    const computeInsertOrder = (dragKey, targetKey, dropAfter) => {
      const next = [...allKeys];
      const fromIdx = next.indexOf(dragKey);
      if (fromIdx < 0) return null;
      const [moved] = next.splice(fromIdx, 1);
      const targetIdx = next.indexOf(targetKey);
      if (targetIdx < 0) return null;
      next.splice(dropAfter ? targetIdx + 1 : targetIdx, 0, moved);
      return next.every((k, i) => k === allKeys[i]) ? null : next;
    };
    const findDropTarget = (sourceItem, clientX, clientY) => {
      const el = document.elementFromPoint(clientX, clientY);
      let targetRow = el?.closest?.(".cc-item[data-cckey]");
      if (!targetRow && ccList) {
        const listRect = ccList.getBoundingClientRect();
        if (
          clientX >= listRect.left - 32 &&
          clientX <= listRect.right + 32 &&
          clientY >= listRect.top - 24 &&
          clientY <= listRect.bottom + 24
        ) {
          let bestDist = Infinity;
          for (const candidate of items) {
            const r = candidate.getBoundingClientRect();
            const dist = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
            if (dist < bestDist) {
              bestDist = dist;
              targetRow = candidate;
            }
          }
        }
      }
      if (!targetRow || targetRow === sourceItem || !panel.contains(targetRow)) return null;
      const rect = targetRow.getBoundingClientRect();
      return {
        targetRow,
        targetKey: targetRow.dataset.cckey,
        dropAfter: clientY >= rect.top + rect.height / 2,
      };
    };

    items.forEach((item) => {
      item.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        if (ev.target.closest("button, a, input, select, textarea")) return;
        const dragKey = item.dataset.cckey;
        const startX = ev.clientX;
        const startY = ev.clientY;
        let dragging = false;
        let dropPlan = null;

        const autoScroll = (clientY) => {
          if (!panel || panel.scrollHeight <= panel.clientHeight) return;
          const pRect = panel.getBoundingClientRect();
          const edge = 48;
          if (clientY < pRect.top + edge) {
            panel.scrollTop -= Math.ceil(((pRect.top + edge - clientY) / edge) * 14);
          } else if (clientY > pRect.bottom - edge) {
            panel.scrollTop += Math.ceil(((clientY - (pRect.bottom - edge)) / edge) * 14);
          }
        };

        const onMove = (moveEv) => {
          if (!dragging) {
            if (Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) <= 4) return;
            dragging = true;
            window.getSelection?.()?.removeAllRanges?.();
            item.classList.add("dragging");
            ccList?.classList.add("cc-list-dragging");
          }
          moveEv.preventDefault();
          autoScroll(moveEv.clientY);

          items.forEach((el) => el.classList.remove("drag-over", "drag-over-top", "drag-over-bottom"));
          const hit = findDropTarget(item, moveEv.clientX, moveEv.clientY);
          if (!hit) {
            dropPlan = null;
            return;
          }
          const nextOrder = computeInsertOrder(dragKey, hit.targetKey, hit.dropAfter);
          if (!nextOrder) {
            dropPlan = null;
            return;
          }
          dropPlan = nextOrder;
          hit.targetRow.classList.add("drag-over", hit.dropAfter ? "drag-over-bottom" : "drag-over-top");
        };

        const cleanup = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onCancel);
          clearDragClasses();
        };

        const onUp = async () => {
          const orderToSave = dragging ? dropPlan : null;
          cleanup();
          if (orderToSave) {
            await this.saveCategoryOrder(orderToSave);
          }
        };

        const onCancel = () => {
          cleanup();
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
      });
    });
  }

  renderOptions(key, schema, opts) {
    const isBuiltin = !schema.custom && Boolean(DEFAULT_CATEGORY_META[key]);
    const isRenamed = isBuiltin && hasCategoryOverride(key);
    if (this.optRenameOpen && !this._optDraft) {
      this._optDraft = {
        group: schema.group || schema.name || "",
        name: schema.name || "",
        subtitle: schema.subtitle || "",
        icon: schema.icon || "🗂️",
      };
    }
    const d = this._optDraft;
    const renameCard =
      this.optRenameOpen && d
        ? `<div class="cc-form opt-cat-edit-card">
            <div class="rb-label">Nome e ícone da categoria${isBuiltin ? " padrão" : ""}</div>
            <div class="cc-grid">
              ${isBuiltin
                ? `<label class="rb-field">
                    <span>Nome no menu lateral *</span>
                    <input class="form-input" data-opt-cat="group" value="${escapeHtml(d.group)}" placeholder="${escapeHtml(DEFAULT_CATEGORY_META[key]?.group || "")}"/>
                    <small class="cc-field-hint">Exibido na barra lateral, em Listas de opções e nos gráficos</small>
                  </label>
                  <label class="rb-field">
                    <span>Título completo da página *</span>
                    <input class="form-input" data-opt-cat="name" value="${escapeHtml(d.name)}" placeholder="${escapeHtml(DEFAULT_CATEGORY_META[key]?.name || "")}"/>
                    <small class="cc-field-hint">Exibido no cabeçalho da categoria e nos relatórios PDF</small>
                  </label>
                  <label class="rb-field cc-field-span">
                    <span>Descrição (subtítulo)</span>
                    <input class="form-input" data-opt-cat="subtitle" value="${escapeHtml(d.subtitle)}" placeholder="${escapeHtml(DEFAULT_CATEGORY_META[key]?.subtitle || "")}"/>
                  </label>`
                : `<label class="rb-field">
                    <span>Nome da categoria *</span>
                    <input class="form-input" data-opt-cat="name" value="${escapeHtml(d.name)}" placeholder="Ex.: Prêmios e Títulos"/>
                  </label>
                  <label class="rb-field">
                    <span>Descrição (subtítulo)</span>
                    <input class="form-input" data-opt-cat="subtitle" value="${escapeHtml(d.subtitle)}" placeholder="Ex.: Premiações e homenagens"/>
                  </label>`
              }
            </div>
            ${renderIconPickerHtml(d.icon || "🗂️")}
            <div class="dd-actions">
              <button type="button" class="btn btn-primary" id="btn-opt-cat-save">Salvar nome e ícone</button>
              ${isRenamed ? `<button type="button" class="btn btn-secondary" id="btn-opt-cat-reset-inline">↺ Restaurar padrão</button>` : ""}
              <button type="button" class="btn btn-secondary" id="btn-opt-cat-cancel">Cancelar</button>
            </div>
          </div>`
        : "";

    return `
      <div class="settings-head">
        <div class="opt-cat-title-row">
          <span class="opt-cat-icon">${escapeHtml(schema.icon || "🗂️")}</span>
          <div>
            <div class="opt-cat-heading">
              <h2>${escapeHtml(schema.name)}</h2>
              ${schema.group && schema.group !== schema.name ? `<span class="cc-tag">${escapeHtml(schema.group)}</span>` : ""}
              ${isRenamed ? `<span class="cc-tag renamed">Renomeada</span>` : ""}
            </div>
            <p>Opções do campo <b>Tipo</b> exibidas no formulário. Cada opção define a subpasta onde o comprovante é salvo.</p>
          </div>
        </div>
        <div class="cc-head-row">
          ${isRenamed ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-opt-cat-reset" title="Restaurar nome, descrição e ícone padrão">↺ Restaurar padrão</button>` : ""}
          <button type="button" class="btn btn-secondary btn-sm" id="btn-opt-cat-edit">${this.optRenameOpen ? "Fechar edição" : "✏️ Renomear categoria"}</button>
        </div>
      </div>
      ${renameCard}
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
    const dbGroup = (schema.dbGroup || schema.group).toLowerCase();
    const any = this.mappings.find((m) => m.category_group.toLowerCase() === dbGroup);
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

  bindOptions(key, schema) {
    const panel = this.container.querySelector(".settings-panel");
    this.container.querySelector("#btn-opt-cat-edit")?.addEventListener("click", () => {
      this.optRenameOpen = !this.optRenameOpen;
      this._optDraft = this.optRenameOpen
        ? {
            group: schema.group || schema.name || "",
            name: schema.name || "",
            subtitle: schema.subtitle || "",
            icon: schema.icon || "🗂️",
          }
        : null;
      this.render();
      if (this.optRenameOpen) {
        this.container.querySelector('[data-opt-cat="group"], [data-opt-cat="name"]')?.focus();
      }
    });
    this.container.querySelector("#btn-opt-cat-cancel")?.addEventListener("click", () => {
      this.optRenameOpen = false;
      this._optDraft = null;
      this.render();
    });
    const doResetBuiltin = async () => {
      try {
        await this.resetBuiltinCategoryMeta(key);
        this.optRenameOpen = false;
        this._optDraft = null;
        showToast("Categoria restaurada para o padrão", "success");
        this.render();
      } catch (err) {
        showToast(`Erro: ${err}`, "error");
      }
    };
    this.container.querySelector("#btn-opt-cat-reset")?.addEventListener("click", doResetBuiltin);
    this.container.querySelector("#btn-opt-cat-reset-inline")?.addEventListener("click", doResetBuiltin);

    if (this.optRenameOpen && panel) {
      bindIconPicker(panel, (icon) => {
        if (this._optDraft) this._optDraft.icon = icon;
      });
      panel.querySelectorAll("[data-opt-cat]").forEach((inp) =>
        inp.addEventListener("input", () => {
          if (this._optDraft) this._optDraft[inp.dataset.optCat] = inp.value;
        })
      );
      this.container.querySelector("#btn-opt-cat-save")?.addEventListener("click", async () => {
        const d = this._optDraft || {};
        try {
          if (!schema.custom && DEFAULT_CATEGORY_META[key]) {
            const updated = await this.persistBuiltinCategory(key, d);
            showToast(`Categoria “${updated?.name || d.name}” atualizada`, "success");
          } else {
            const cleanName = String(d.name || "").trim();
            if (!cleanName) return showToast("Informe o nome da categoria", "error");
            const list = this.cc?.list?.length ? this.cc.list : (await api.listCustomCategories().catch(() => [])) || [];
            const existing = list.find((item) => item.key === key) || {};
            const saved = await api.saveCustomCategory({
              key,
              name: cleanName,
              icon: d.icon || existing.icon || schema.icon || "🗂️",
              subtitle: d.subtitle || null,
              folder: existing.folder || schema.folder || "",
              title_label: existing.title_label || null,
              desc_label: existing.desc_label || null,
              position: existing.position || 0,
              tipos: [],
              count: 0,
            });
            this._ccLoaded = false;
            if (this.onCategories) await this.onCategories();
            showToast(`Categoria “${saved.name}” atualizada`, "success");
          }
          this.optRenameOpen = false;
          this._optDraft = null;
          this.render();
        } catch (err) {
          showToast(typeof err === "string" ? err : err?.message || `Erro: ${err}`, "error", 5000);
        }
      });
    }

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
        await api.addSubfolderMapping(schema.dbGroup || schema.group, d, f);
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

  // ---------------- Google Scholar & APIs ----------------
  async loadScholarConfig() {
    try {
      this._scholarLoading = true;
      this._scholarConfig = await api.getScholarConfig();
    } catch (e) {
      console.error("Erro ao carregar configurações do Google Scholar:", e);
      showToast(`Erro ao carregar configurações: ${e}`, "error");
    } finally {
      this._scholarLoading = false;
      if (this.active === "__scholar") this.render();
    }
  }

  renderScholar() {
    if (this._scholarLoading && !this._scholarConfig) {
      return `<div class="loading-state" style="display:flex"><div class="spinner"></div></div>`;
    }
    const cfg = this._scholarConfig || {};
    const rep = this._scholarSyncReport;

    const renderMiniSparkline = (graph) => {
      if (!graph || graph.length < 2) return "";
      const values = graph.map((g) => g.citations);
      const max = Math.max(...values, 1);
      const min = Math.min(...values, 0);
      const w = 110;
      const h = 24;
      const pad = 2;
      const pts = values.map((v, i) => {
        const x = (i / (values.length - 1)) * (w - 2 * pad) + pad;
        const y = h - ((v - min) / (max - min || 1)) * (h - 2 * pad) - pad;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      return `
        <svg class="scholar-sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible; display:block; margin:6px auto 0 auto;">
          <polyline points="${pts.join(" ")}" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      `;
    };

    const renderScholarCitationChart = (graph, authorName) => {
      if (!graph || !graph.length) return "";
      const max = Math.max(...graph.map((g) => g.citations), 1);
      const total = graph.reduce((a, g) => a + g.citations, 0);
      const chartHeight = 150;
      const barWidth = 32;
      const gap = 16;
      const svgWidth = Math.max(graph.length * (barWidth + gap) + 40, 520);

      return `
        <div class="scholar-card" style="margin-top:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
            <div>
              <h3 style="font-size:15px; font-weight:600; margin:0; display:flex; align-items:center; gap:8px;">
                <span>📈 Citações por Ano (Google Scholar)</span>
              </h3>
              <p style="font-size:12.5px; color:var(--text-muted); margin:4px 0 0 0;">
                ${authorName ? `Perfil de <b>${escapeHtml(authorName)}</b> · ` : ""}Histórico anual de citações extraído via SerpApi
              </p>
            </div>
            <span class="badge" style="font-size:12px; font-weight:600; background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); padding:4px 10px; border-radius:12px;">
              ${Number(total).toLocaleString("pt-BR")} citações registradas
            </span>
          </div>
          <div style="width:100%; overflow-x:auto; padding-bottom:6px;">
            <svg width="100%" height="${chartHeight + 40}" viewBox="0 0 ${svgWidth} ${chartHeight + 40}" style="overflow:visible; min-width:${svgWidth}px;">
              <line x1="20" y1="${chartHeight}" x2="${svgWidth - 20}" y2="${chartHeight}" stroke="var(--border-color)" stroke-width="1" />
              <line x1="20" y1="${chartHeight / 2}" x2="${svgWidth - 20}" y2="${chartHeight / 2}" stroke="var(--border-color)" stroke-width="1" stroke-dasharray="3,3" opacity="0.4" />
              
              ${graph.map((g, i) => {
                const h = Math.max(4, Math.round((g.citations / max) * (chartHeight - 30)));
                const x = 30 + i * (barWidth + gap);
                const y = chartHeight - h;
                return `
                  <g class="scholar-bar-group" tabindex="0">
                    <title>${g.year}: ${g.citations} citações</title>
                    <text x="${x + barWidth / 2}" y="${y - 6}" font-size="10.5" font-weight="600" fill="var(--text-muted)" text-anchor="middle">${g.citations}</text>
                    <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="4" fill="url(#scholar-grad)" />
                    <text x="${x + barWidth / 2}" y="${chartHeight + 18}" font-size="11" font-weight="500" fill="var(--text-muted)" text-anchor="middle">${g.year}</text>
                  </g>
                `;
              }).join("")}

              <defs>
                <linearGradient id="scholar-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#38bdf8" />
                  <stop offset="100%" stop-color="#0284c7" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      `;
    };

    return `
      <div class="settings-head"><div>
        <h2>Google Scholar & Métricas de Citação</h2>
        <p>Conecte seu ID do Google Scholar e sua chave SerpApi para extrair automaticamente o número de citações, índice H e i10 dos seus artigos publicados.</p>
      </div></div>

      <div class="scholar-metrics-row">
        <div class="scholar-metric-card">
          <div class="scholar-metric-val">${cfg.total_citations != null ? Number(cfg.total_citations).toLocaleString("pt-BR") : "—"}</div>
          ${renderMiniSparkline(cfg.graph)}
          <div class="scholar-metric-lbl">Total de Citações</div>
        </div>
        <div class="scholar-metric-card">
          <div class="scholar-metric-val">${cfg.h_index != null ? cfg.h_index : "—"}</div>
          <div class="scholar-metric-lbl">Índice H</div>
        </div>
        <div class="scholar-metric-card">
          <div class="scholar-metric-val">${cfg.i10_index != null ? cfg.i10_index : "—"}</div>
          <div class="scholar-metric-lbl">Índice i10</div>
        </div>
        <div class="scholar-metric-card">
          <div class="scholar-metric-val" style="font-size:13.5px; font-weight:600; line-height:2.2;">${cfg.last_sync || "Nunca"}</div>
          <div class="scholar-metric-lbl">Última Sincronização</div>
        </div>
      </div>

      ${renderScholarCitationChart(cfg.graph, cfg.author_name)}

      <div class="scholar-card" style="margin-top:20px;">
        <h3 style="margin-bottom:14px; font-size:15px; font-weight:600; display:flex; align-items:center; gap:8px;">
          <span>🔑 Credenciais de Acesso</span>
          ${cfg.author_name ? `<span class="badge" style="font-size:11px; font-weight:normal; background:var(--surface-2); color:var(--text-muted);">Autor identificado: <b>${escapeHtml(cfg.author_name)}</b></span>` : ""}
        </h3>
        
        <div style="margin-bottom:16px;">
          <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px;">ID do Google Scholar ou Link do Perfil</label>
          <input type="text" id="scholar-author-id" class="form-input" style="width:100%;" placeholder="Ex: J_1kLk8AAAAJ ou https://scholar.google.com/citations?user=J_1kLk8AAAAJ" value="${escapeHtml(cfg.author_id || "")}" />
          <div class="scholar-help-text">Você pode colar a URL inteira do seu perfil do Google Scholar ou apenas o código no parâmetro <code>user=...</code>.</div>
        </div>

        <div style="margin-bottom:20px;">
          <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px;">Chave SerpApi (SERPAPI_KEY)</label>
          <div style="display:flex; gap:8px;">
            <input type="password" id="scholar-api-key" class="form-input" style="flex:1;" placeholder="Cole sua chave da SerpApi aqui..." value="${escapeHtml(cfg.serpapi_key || "")}" />
            <button type="button" class="btn btn-secondary btn-sm" id="btn-toggle-scholar-key" title="Mostrar/ocultar chave" style="padding:0 12px;">👁️</button>
          </div>
          <div class="scholar-help-text">
            A SerpApi consulta o Google Scholar em tempo real sem bloqueios. O plano gratuito oferece <b>100 buscas/mês</b>. Crie sua conta em <a href="#" id="link-open-serpapi" style="color:var(--primary); text-decoration:underline;">serpapi.com</a>.
          </div>
        </div>

        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" id="btn-save-scholar">💾 Salvar Credenciais</button>
          <button type="button" class="btn btn-accent" id="btn-sync-scholar" ${this._scholarSyncing ? "disabled" : ""}>
            ${this._scholarSyncing ? `<span class="spinner" style="width:14px; height:14px; display:inline-block; vertical-align:middle; margin-right:6px;"></span> Sincronizando...` : `⚡ Sincronizar Citações Agora`}
          </button>
        </div>
      </div>

      ${rep ? `
        <div class="scholar-card" style="margin-top:20px;">
          <h3 style="margin-bottom:8px; font-size:15px; font-weight:600; color:var(--success);">
            ✓ Sincronização Concluída: ${escapeHtml(rep.author_name || "Autor")}
          </h3>
          <p style="font-size:13px; color:var(--text-muted); margin-bottom:14px;">
            Foram encontrados <b>${rep.scholar_articles_found}</b> artigos no Google Scholar e <b>${rep.matched_count}</b> produções foram atualizadas no seu banco de dados local.
          </p>
          ${rep.updated_items && rep.updated_items.length > 0 ? `
            <div class="scholar-table-wrap">
              <table class="scholar-table">
                <thead>
                  <tr>
                    <th>Ano</th>
                    <th>Título no Lattes Manager</th>
                    <th style="text-align:center;">Citações</th>
                  </tr>
                </thead>
                <tbody>
                  ${rep.updated_items.map(it => `
                    <tr>
                      <td style="color:var(--text-muted);">${it.ano || "—"}</td>
                      <td style="font-weight:500;">
                        ${escapeHtml(it.titulo)}
                        ${it.scholar_title && it.scholar_title.toLowerCase() !== it.titulo.toLowerCase() ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Scholar: ${escapeHtml(it.scholar_title)}</div>` : ""}
                      </td>
                      <td style="text-align:center; white-space:nowrap;">
                        <span class="badge-citations">💬 ${it.citations_after}</span>
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `<p style="font-size:13px; color:var(--text-muted);">Nenhum artigo novo precisou de atualização.</p>`}
        </div>
      ` : ""}
    `;
  }

  bindScholar() {
    const toggleBtn = this.container.querySelector("#btn-toggle-scholar-key");
    const keyInput = this.container.querySelector("#scholar-api-key");
    if (toggleBtn && keyInput) {
      toggleBtn.addEventListener("click", () => {
        keyInput.type = keyInput.type === "password" ? "text" : "password";
      });
    }

    const serpLink = this.container.querySelector("#link-open-serpapi");
    if (serpLink) {
      serpLink.addEventListener("click", (e) => {
        e.preventDefault();
        api.openUrl("https://serpapi.com");
      });
    }

    const authorInput = this.container.querySelector("#scholar-author-id");
    const saveBtn = this.container.querySelector("#btn-save-scholar");
    if (saveBtn && authorInput && keyInput) {
      saveBtn.addEventListener("click", async () => {
        const authorId = authorInput.value.trim();
        const apiKey = keyInput.value.trim();
        try {
          saveBtn.disabled = true;
          await api.saveScholarConfig(authorId, apiKey);
          showToast("Credenciais do Google Scholar salvas com sucesso!", "success");
          await this.loadScholarConfig();
        } catch (e) {
          showToast(`Erro ao salvar: ${e}`, "error");
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    const syncBtn = this.container.querySelector("#btn-sync-scholar");
    if (syncBtn && authorInput && keyInput) {
      syncBtn.addEventListener("click", async () => {
        const authorId = authorInput.value.trim();
        const apiKey = keyInput.value.trim();
        if (!authorId) {
          showToast("Informe o ID ou URL do Google Scholar.", "warning");
          authorInput.focus();
          return;
        }
        if (!apiKey) {
          showToast("Informe sua chave SerpApi.", "warning");
          keyInput.focus();
          return;
        }

        try {
          this._scholarSyncing = true;
          this.render();
          showToast("Consultando Google Scholar via SerpApi...", "info", 4000);
          const report = await api.syncScholarCitations(authorId, apiKey);
          this._scholarSyncReport = report;
          showToast(`Sincronização concluída! ${report.matched_count} artigos atualizados.`, "success", 4000);
          await this.loadScholarConfig();
          this.onChanged && this.onChanged();
        } catch (e) {
          console.error("Erro na sincronização:", e);
          showToast(`Falha na sincronização: ${e}`, "error", 6000);
        } finally {
          this._scholarSyncing = false;
          if (this.active === "__scholar") this.render();
        }
      });
    }
  }
}

