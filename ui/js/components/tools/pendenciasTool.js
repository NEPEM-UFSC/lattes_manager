// Painel de pendências: registros sem comprovante, com arquivo ausente, artigos sem DOI/Qualis
// e registros com campos essenciais vazios. Cada item leva ao registro ou à ferramenta que resolve.

import { api } from "../../api.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../../utils.js";

const TOOL_ID = "pendencias";
const MAX_ROWS = 300;

// [chave, ícone, rótulo, ferramenta que resolve, texto do botão]
const KINDS = [
  ["sem_comprovante", "📎", "Sem comprovante", "linker", "🔗 Vincular arquivos"],
  ["arquivo_ausente", "⚠️", "Arquivo ausente no disco", "invalid_proofs", "⚠️ Comprovantes inválidos"],
  ["sem_doi", "🔗", "Artigo sem DOI", "dois", "🔗 Extrair DOI"],
  ["sem_qualis", "🏆", "Artigo sem Qualis", "qualis", "🏆 Completar Qualis"],
  ["sem_ano", "📅", "Sem ano", null, null],
  ["sem_titulo", "🏷️", "Sem título", null, null],
];
const KIND = Object.fromEntries(KINDS.map(([k, icon, label, tool, toolLabel]) => [k, { icon, label, tool, toolLabel }]));

const catName = (c) => CATEGORY_SCHEMAS[c]?.name || CATEGORY_SCHEMAS[c]?.group || c;
const catIcon = (c) => CATEGORY_SCHEMAS[c]?.icon || "📁";

async function load(view, st) {
  st.loading = true;
  try {
    st.report = await api.scanPendencias();
  } catch (e) {
    showToast(`Erro ao procurar pendências: ${e}`, "error");
    st.report = null;
  } finally {
    st.loading = false;
  }
  if (view.active === TOOL_ID) renderPendenciasTool(view);
}

/** Abre a ferramenta que resolve um tipo de pendência. */
function openFix(view, st, tool) {
  st.report = null; // ao voltar, a lista é refeita
  if (tool === "linker") return view.openLinker?.();
  view.open(tool);
}

export function renderPendenciasTool(view) {
  const st = view.state;
  st.kindFilter ??= "all";
  st.catFilter ??= "all";
  st.query ??= "";

  if (!st.report) {
    view.shell(
      "Painel de pendências",
      "Procurando registros sem comprovante, arquivos ausentes e dados incompletos…",
      `<div class="loading-state" style="display:flex; flex-direction:column; gap:16px; padding:40px 0;">
        <div class="spinner"></div>
        <div>Conferindo registros e arquivos no disco...</div>
      </div>`
    );
    if (!st.loading) load(view, st);
    return;
  }

  const rep = st.report;
  const all = rep.itens || [];
  const porTipo = rep.por_tipo || {};

  // Uma linha por registro, com todas as pendências dele (a ordem do backend é mantida).
  const records = [];
  const byKey = new Map();
  for (const it of all) {
    const key = `${it.category}:${it.id}`;
    let r = byKey.get(key);
    if (!r) {
      r = { category: it.category, id: it.id, titulo: it.titulo, ano: it.ano, tipo: it.tipo, issues: [] };
      byKey.set(key, r);
      records.push(r);
    }
    r.issues.push({ kind: it.kind, detalhe: it.detalhe });
  }

  // Contagem por categoria considerando o filtro de tipo
  const byKind = st.kindFilter === "all"
    ? records
    : records.filter((r) => r.issues.some((i) => i.kind === st.kindFilter));
  const catCounts = {};
  for (const r of byKind) catCounts[r.category] = (catCounts[r.category] || 0) + 1;
  if (st.catFilter !== "all" && !catCounts[st.catFilter]) st.catFilter = "all";

  const q = st.query.trim().toLowerCase();
  const filtered = byKind.filter((r) => {
    if (st.catFilter !== "all" && r.category !== st.catFilter) return false;
    if (!q) return true;
    return [r.titulo, r.tipo, catName(r.category), String(r.ano ?? ""), String(r.id), ...r.issues.map((i) => i.detalhe)]
      .some((s) => String(s || "").toLowerCase().includes(q));
  });
  const shown = filtered.slice(0, MAX_ROWS);

  const tiles = KINDS.map(([k, icon, label]) => {
    const n = porTipo[k] || 0;
    const active = st.kindFilter === k;
    return `<button type="button" class="pd-tile ${n ? "bad" : "good"} ${active ? "active" : ""}" data-kind="${k}" ${n ? "" : "disabled"} aria-pressed="${active}">
      <b>${n.toLocaleString("pt-BR")}</b>
      <span>${icon} ${escapeHtml(label)}</span>
    </button>`;
  }).join("");

  const pills = Object.keys(catCounts).length > 1
    ? `<div class="pd-pills">
        <button type="button" class="filter-pill ${st.catFilter === "all" ? "active" : ""}" data-cat="all">
          Todas as categorias <span class="badge">${byKind.length}</span>
        </button>
        ${Object.entries(catCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([c, n]) => `<button type="button" class="filter-pill ${st.catFilter === c ? "active" : ""}" data-cat="${escapeHtml(c)}">
            <span>${catIcon(c)}</span> ${escapeHtml(catName(c))} <span class="badge">${n}</span>
          </button>`)
          .join("")}
      </div>`
    : "";

  const row = (r) => {
    const meta = [catIcon(r.category) + " " + catName(r.category), r.ano ?? "sem ano", r.tipo]
      .filter(Boolean)
      .map((x) => escapeHtml(String(x)))
      .join(" · ");
    const chips = r.issues.map((i) => {
      const k = KIND[i.kind] || { icon: "•", label: i.kind };
      return `<span class="pd-chip" ${i.detalhe ? `title="${escapeHtml(i.detalhe)}"` : ""}>${k.icon} ${escapeHtml(k.label)}</span>`;
    }).join("");
    const details = r.issues
      .filter((i) => i.detalhe)
      .map((i) => `<div class="pd-detail mono" title="${escapeHtml(i.detalhe)}">${escapeHtml(i.detalhe)}</div>`)
      .join("");
    const tools = [...new Set(r.issues.map((i) => KIND[i.kind]?.tool).filter(Boolean))];
    const fixBtns = tools
      .map((t) => {
        const k = Object.values(KIND).find((x) => x.tool === t);
        return `<button type="button" class="btn btn-secondary btn-sm" data-fix="${t}">${k.toolLabel}</button>`;
      })
      .join("");
    return `<tr>
      <td>
        <div class="pd-title">#${r.id} ${r.titulo === `Registro #${r.id}` ? `<em class="pd-untitled">(sem título)</em>` : escapeHtml(r.titulo)}</div>
        <div class="pd-meta">${meta}</div>
      </td>
      <td>
        <div class="pd-chips">${chips}</div>
        ${details}
      </td>
      <td class="pd-actions-cell">
        <div class="pd-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-open-record="${escapeHtml(r.category)}:${r.id}" title="Abrir o registro para editar">✏️ Abrir</button>
          ${fixBtns}
        </div>
      </td>
    </tr>`;
  };

  const activeKind = st.kindFilter !== "all" ? KIND[st.kindFilter] : null;
  const bulkFix = activeKind?.tool
    ? `<button type="button" class="btn btn-primary btn-sm" data-fix="${activeKind.tool}">${activeKind.toolLabel}</button>`
    : "";

  const body = all.length === 0
    ? `<div class="empty-state" style="padding:40px 0; text-align:center;">
        <div style="font-size:40px;">🎉</div>
        <h3>Nenhuma pendência</h3>
        <p style="color:var(--text-muted);">Todos os ${rep.total_registros.toLocaleString("pt-BR")} registros têm comprovante no disco e dados essenciais preenchidos.</p>
      </div>`
    : `<div class="pd-wrap">
        <p class="pd-summary">
          <b>${rep.registros_com_pendencia.toLocaleString("pt-BR")}</b> de ${rep.total_registros.toLocaleString("pt-BR")} registros têm alguma pendência.
          Clique em um tipo para filtrar.
        </p>
        <div class="pd-tiles">${tiles}</div>

        <div class="pd-toolbar">
          <div class="pd-search">
            <input type="search" id="pd-search" class="form-input" placeholder="Buscar por título, categoria, ano, arquivo…" value="${escapeHtml(st.query)}" aria-label="Buscar pendências" />
          </div>
          <div class="pd-toolbar-actions">
            ${st.kindFilter !== "all" ? `<button type="button" class="btn btn-secondary btn-sm" data-kind="all">✕ Limpar filtro</button>` : ""}
            ${bulkFix}
            <button type="button" class="btn btn-secondary btn-sm" id="pd-rescan" title="Procurar pendências novamente">🔄 Reanalisar</button>
          </div>
        </div>

        ${pills}

        ${filtered.length === 0
          ? `<p class="pd-empty">Nenhuma pendência com esses filtros.</p>`
          : `<div class="tl-table"><table class="data-table pd-table">
              <thead><tr><th>Registro</th><th>Pendências</th><th aria-label="Ações"></th></tr></thead>
              <tbody>${shown.map(row).join("")}</tbody>
            </table></div>
            ${filtered.length > shown.length
              ? `<p class="pd-more">Mostrando ${shown.length} de ${filtered.length.toLocaleString("pt-BR")}. Use os filtros ou a busca para ver as demais.</p>`
              : ""}`}
      </div>`;

  view.shell(
    "Painel de pendências",
    "Registros sem comprovante, com arquivo ausente, artigos sem DOI ou Qualis e campos essenciais vazios.",
    body
  );

  const el = view.el;
  el.querySelectorAll("[data-kind]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.kind;
      st.kindFilter = st.kindFilter === k ? "all" : k;
      renderPendenciasTool(view);
    })
  );
  el.querySelectorAll("[data-cat]").forEach((b) =>
    b.addEventListener("click", () => {
      st.catFilter = b.dataset.cat;
      renderPendenciasTool(view);
    })
  );
  const search = el.querySelector("#pd-search");
  search?.addEventListener("input", () => {
    st.query = search.value;
    const pos = search.selectionStart;
    renderPendenciasTool(view);
    const again = view.el.querySelector("#pd-search");
    again?.focus();
    again?.setSelectionRange(pos, pos);
  });
  el.querySelector("#pd-rescan")?.addEventListener("click", () => {
    st.report = null;
    renderPendenciasTool(view);
  });
  el.querySelectorAll("[data-fix]").forEach((b) =>
    b.addEventListener("click", () => openFix(view, st, b.dataset.fix))
  );
  el.querySelectorAll("[data-open-record]").forEach((b) =>
    b.addEventListener("click", () => {
      const [cat, id] = b.dataset.openRecord.split(":");
      st.report = null;
      view.openRecord?.(cat, Number(id));
    })
  );
}
