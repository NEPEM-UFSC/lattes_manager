// Qualis oficial da CAPES: lê a planilha da Plataforma Sucupira, compara com os artigos
// (pelo ISSN ou pelo nome da revista) e grava os estratos confirmados.

import { api } from "../../api.js";
import { escapeHtml, showToast } from "../../utils.js";

const TOOL_ID = "qualis_oficial";
const SETTING_KEY = "qualis_oficial";
const MAX_ROWS = 400;

const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");

async function runPreview(view, st) {
  st.loading = true;
  renderQualisTool(view);
  try {
    const p = await api.qualisPreview(st.path, st.area || null);
    st.preview = p;
    // pré-seleciona os artigos cujo estrato vai mudar
    st.sel = new Set((p.itens || []).filter((m) => (m.atual || "") !== m.oficial).map((m) => m.id));
    st.filter = st.sel.size ? "mudam" : "todos";
    api.setSetting(SETTING_KEY, { path: st.path, area: st.area || "" }).catch(() => { });
  } catch (e) {
    st.preview = null;
    showToast(`Não foi possível ler a planilha: ${e}`, "error", 7000);
  } finally {
    st.loading = false;
  }
  if (view.active === TOOL_ID) renderQualisTool(view);
}

export function renderQualisTool(view) {
  const st = view.state;
  st.filter ??= "mudam";
  st.query ??= "";
  st.sel ||= new Set();

  if (!st.restored) {
    st.restored = true;
    api.getSetting(SETTING_KEY).then((v) => {
      if (v?.path && !st.path) {
        st.path = v.path;
        st.area = v.area || "";
        if (view.active === TOOL_ID) renderQualisTool(view);
      }
    }).catch(() => { });
  }

  const p = st.preview;
  const needsArea = p && p.areas?.length && !st.area;
  const itens = p?.itens || [];
  const sem = p?.sem_correspondencia || [];
  const mudam = itens.filter((m) => (m.atual || "") !== m.oficial);
  const iguais = itens.filter((m) => (m.atual || "") === m.oficial);
  const viaNome = itens.filter((m) => m.via === "titulo").length;

  const q = st.query.trim().toLowerCase();
  const match = (m) => !q || [m.titulo, m.journal, m.issn, String(m.ano ?? "")].some((s) => String(s || "").toLowerCase().includes(q));
  const lista = (st.filter === "mudam" ? mudam : st.filter === "iguais" ? iguais : itens).filter(match);
  const semLista = sem.filter(match);
  const shown = lista.slice(0, MAX_ROWS);
  const selVisiveis = shown.filter((m) => st.sel.has(m.id)).length;

  const fileName = st.path ? st.path.split(/[\\/]/).pop() : "";

  let body = `
    <div class="ql-wrap">
      <div class="ql-step">
        <div>
          <b>Planilha do Qualis</b>
          <p>Exporte a classificação de periódicos na Plataforma Sucupira (Qualis Periódicos) e escolha o arquivo aqui. Aceita .xlsx, .xls, .ods e .csv; as colunas ISSN, Título e Estrato são encontradas sozinhas.</p>
          ${st.path ? `<div class="ql-file mono" title="${escapeHtml(st.path)}">📄 ${escapeHtml(fileName)}</div>` : ""}
        </div>
        <div class="ql-actions">
          <button type="button" class="btn btn-primary btn-sm" id="ql-pick">${st.path ? "Trocar planilha" : "Escolher planilha"}</button>
          ${st.path && !p && !st.loading ? `<button type="button" class="btn btn-secondary btn-sm" id="ql-run">Comparar com os artigos</button>` : ""}
        </div>
      </div>

      <div class="ql-step">
        <div>
          <b>ISSN dos artigos</b>
          <p>O ISSN é a forma mais segura de achar a revista na planilha. Para os artigos com DOI que ainda não têm ISSN, dá para buscá-lo na OpenAlex (gratuita, sem chave). Sem ISSN, a comparação usa o nome da revista.</p>
        </div>
        <div class="ql-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="ql-issn" ${st.issnBusy ? "disabled" : ""}>${st.issnBusy ? "Buscando…" : "🔎 Buscar ISSN pela OpenAlex"}</button>
        </div>
      </div>`;

  if (st.loading) {
    body += `<div class="loading-state" style="display:flex; flex-direction:column; gap:12px; padding:32px 0;"><div class="spinner"></div><div>Lendo a planilha e comparando com os artigos…</div></div>`;
  } else if (needsArea) {
    body += `
      <div class="ql-step">
        <div>
          <b>Área de avaliação</b>
          <p>Esta planilha tem estratos por área (${fmt(p.areas.length)} áreas). Escolha a área do seu programa.</p>
        </div>
        <div class="ql-actions">
          <select id="ql-area" class="form-select" aria-label="Área de avaliação">
            <option value="">Escolha a área…</option>
            ${p.areas.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("")}
          </select>
        </div>
      </div>`;
  } else if (p) {
    body += `
      <div class="ql-summary">
        <span>Planilha com <b>${fmt(p.entradas)}</b> periódicos${st.area ? ` na área <b>${escapeHtml(st.area)}</b>` : ""}${p.ignoradas ? ` · ${fmt(p.ignoradas)} linha(s) ignoradas (sem ISSN ou estrato)` : ""}.</span>
        ${st.area ? `<button type="button" class="btn btn-secondary btn-sm" id="ql-change-area">Trocar área</button>` : ""}
        <span class="ql-cols">Colunas usadas: ${[p.colunas?.issn, p.colunas?.titulo, p.colunas?.estrato, p.colunas?.area].filter(Boolean).map((c) => `<span class="mono">${escapeHtml(c)}</span>`).join(", ")}</span>
      </div>
      <div class="ql-tiles">
        <button type="button" class="pd-tile ${st.filter === "mudam" ? "active" : ""} ${mudam.length ? "bad" : "good"}" data-filter="mudam"><b>${fmt(mudam.length)}</b><span>vão mudar</span></button>
        <button type="button" class="pd-tile good ${st.filter === "iguais" ? "active" : ""}" data-filter="iguais"><b>${fmt(iguais.length)}</b><span>já iguais</span></button>
        <button type="button" class="pd-tile ${st.filter === "sem" ? "active" : ""} ${sem.length ? "bad" : "good"}" data-filter="sem"><b>${fmt(sem.length)}</b><span>sem correspondência</span></button>
        <div class="pd-tile good" aria-hidden="true"><b>${fmt(p.total_artigos)}</b><span>artigos no banco</span></div>
      </div>
      ${viaNome ? `<p class="ql-note">⚠️ ${fmt(viaNome)} artigo(s) foram encontrados pelo <b>nome da revista</b>, não pelo ISSN. Confira esses antes de aplicar.</p>` : ""}
      <div class="pd-toolbar">
        <div class="pd-search"><input type="search" id="ql-search" class="form-input" placeholder="Buscar por título, revista, ISSN ou ano…" value="${escapeHtml(st.query)}" aria-label="Buscar artigos" /></div>
        ${st.filter !== "sem" ? `<div class="pd-toolbar-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="ql-sel-all">${selVisiveis === shown.length && shown.length ? "Desmarcar todos" : "Marcar todos"}</button>
          <button type="button" class="btn btn-primary btn-sm" id="ql-apply" ${st.sel.size ? "" : "disabled"}>Aplicar Qualis em ${fmt(st.sel.size)} artigo(s)</button>
        </div>` : ""}
      </div>`;

    if (st.filter === "sem") {
      body += semLista.length
        ? `<div class="tl-table"><table class="data-table pd-table">
            <thead><tr><th>Artigo</th><th>Revista</th><th>ISSN</th></tr></thead>
            <tbody>${semLista.slice(0, MAX_ROWS).map((m) => `<tr>
              <td><div class="pd-title">${escapeHtml(m.titulo)}</div><div class="pd-meta">${m.ano ?? "sem ano"}</div></td>
              <td>${escapeHtml(m.journal || "—")}</td>
              <td class="mono">${escapeHtml(m.issn || "sem ISSN")}</td>
            </tr>`).join("")}</tbody></table></div>
          <p class="pd-more">Sem ISSN, tente "Buscar ISSN pela OpenAlex" e compare de novo. Revistas que não estão na planilha não têm Qualis nesta classificação.</p>`
        : `<p class="pd-empty">Todos os artigos foram encontrados na planilha.</p>`;
    } else {
      body += shown.length
        ? `<div class="tl-table"><table class="data-table pd-table ql-table">
            <thead><tr><th aria-label="Selecionar"></th><th>Artigo</th><th>Revista</th><th>Qualis</th></tr></thead>
            <tbody>${shown.map((m) => {
              const muda = (m.atual || "") !== m.oficial;
              return `<tr>
                <td><input type="checkbox" data-id="${m.id}" ${st.sel.has(m.id) ? "checked" : ""} aria-label="Aplicar em ${escapeHtml(m.titulo)}" /></td>
                <td><div class="pd-title">${escapeHtml(m.titulo)}</div><div class="pd-meta">${m.ano ?? "sem ano"}</div></td>
                <td>${escapeHtml(m.journal || "—")}<div class="pd-meta mono">${escapeHtml(m.issn || m.issn_tabela || "")}
                  ${m.via === "titulo" ? `<span class="ql-via" title="Encontrado pelo nome da revista">pelo nome</span>` : ""}</div></td>
                <td class="ql-q">${muda
                  ? `<span class="ql-old">${escapeHtml(m.atual || "vazio")}</span> → <b>${escapeHtml(m.oficial)}</b>`
                  : `<b>${escapeHtml(m.oficial)}</b>`}</td>
              </tr>`;
            }).join("")}</tbody></table></div>
            ${lista.length > shown.length ? `<p class="pd-more">Mostrando ${shown.length} de ${fmt(lista.length)}. Use a busca para ver os demais.</p>` : ""}`
        : `<p class="pd-empty">Nenhum artigo nesta lista.</p>`;
    }
  }
  body += `</div>`;

  view.shell(
    "Qualis oficial da CAPES",
    "Preencha o Qualis dos artigos a partir da planilha oficial, conferindo cada mudança antes de gravar.",
    body
  );

  const el = view.el;
  el.querySelector("#ql-pick")?.addEventListener("click", async () => {
    const path = await api.pickQualisFile().catch((e) => showToast(`Erro: ${e}`, "error"));
    if (!path) return;
    st.path = path;
    st.area = "";
    st.preview = null;
    runPreview(view, st);
  });
  el.querySelector("#ql-run")?.addEventListener("click", () => runPreview(view, st));
  el.querySelector("#ql-area")?.addEventListener("change", (e) => {
    if (!e.target.value) return;
    st.area = e.target.value;
    runPreview(view, st);
  });
  el.querySelector("#ql-change-area")?.addEventListener("click", () => {
    st.area = "";
    runPreview(view, st);
  });
  el.querySelector("#ql-issn")?.addEventListener("click", async () => {
    st.issnBusy = true;
    renderQualisTool(view);
    try {
      const r = await api.fillIssnOpenalex();
      const msg = r.consultados
        ? `ISSN encontrado para ${fmt(r.preenchidos)} de ${fmt(r.consultados)} artigo(s) com DOI.`
        : "Todos os artigos com DOI já têm ISSN.";
      showToast(r.erros?.length ? `${msg} Avisos: ${r.erros.join("; ")}` : msg, r.erros?.length ? "warning" : "success", 6000);
      if (st.path && r.preenchidos) await runPreview(view, st);
    } catch (e) {
      showToast(`Erro ao consultar a OpenAlex: ${e}`, "error");
    } finally {
      st.issnBusy = false;
      if (view.active === TOOL_ID) renderQualisTool(view);
    }
  });
  el.querySelectorAll("[data-filter]").forEach((b) =>
    b.addEventListener("click", () => {
      st.filter = b.dataset.filter;
      renderQualisTool(view);
    })
  );
  const search = el.querySelector("#ql-search");
  search?.addEventListener("input", () => {
    st.query = search.value;
    const pos = search.selectionStart;
    renderQualisTool(view);
    const again = view.el.querySelector("#ql-search");
    again?.focus();
    again?.setSelectionRange(pos, pos);
  });
  el.querySelectorAll("input[data-id]").forEach((c) =>
    c.addEventListener("change", () => {
      const id = Number(c.dataset.id);
      if (c.checked) st.sel.add(id);
      else st.sel.delete(id);
      renderQualisTool(view);
    })
  );
  el.querySelector("#ql-sel-all")?.addEventListener("click", () => {
    const all = selVisiveis === shown.length;
    for (const m of shown) all ? st.sel.delete(m.id) : st.sel.add(m.id);
    renderQualisTool(view);
  });
  el.querySelector("#ql-apply")?.addEventListener("click", async () => {
    const items = itens
      .filter((m) => st.sel.has(m.id))
      .map((m) => ({ id: m.id, qualis: m.oficial, issn: m.issn_tabela || null }));
    if (!items.length) return;
    if (!window.confirm(`Gravar o Qualis oficial em ${items.length} artigo(s)?`)) return;
    try {
      const r = await api.qualisApply(items);
      showToast(
        r.erros?.length ? `${r.ok} atualizado(s); ${r.erros.length} erro(s): ${r.erros.slice(0, 3).join("; ")}` : `Qualis atualizado em ${r.ok} artigo(s).`,
        r.erros?.length ? "warning" : "success",
        6000
      );
      view.onChanged?.();
      await runPreview(view, st);
    } catch (e) {
      showToast(`Erro ao gravar: ${e}`, "error");
    }
  });
}
