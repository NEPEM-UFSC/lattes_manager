// Catálogo da tabela qualis_capes: todas as revistas, com busca, filtros por estrato,
// "só onde publiquei", ordenação, exportação e gráficos de rosca por estrato.

import { api } from "../../api.js";
import { escapeHtml, renderQualisBadge, showToast } from "../../utils.js";
import { QUALIS_ORDER, QUALIS_COLOR, arc } from "../charts.js";
import { attachTip, hideTip } from "./chartTip.js";

const PAGE = 200;
const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
const pct = (n, t) => (t ? ((n / t) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "0");
const colorOf = (q) => QUALIS_COLOR[QUALIS_ORDER.indexOf(q)] || "#64748b";
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const digits = (s) => String(s || "").replace(/[^0-9xX]/g, "").toUpperCase();

export { hideTip as hideCatalogTip } from "./chartTip.js";

/** Estado do catálogo, guardado no estado da ferramenta. */
function state(st) {
  st.cat ||= { rows: null, loading: false, q: "", estratos: new Set(), mine: false, sort: "titulo", limit: PAGE };
  return st.cat;
}

/** Recarrega a lista (após importar ou aplicar Qualis). */
export function invalidateCatalog(st) {
  if (st.cat) st.cat.rows = null;
}

/** Filtros de texto e "só onde publiquei" (sem o filtro de estrato, que os gráficos controlam). */
function baseFilter(c) {
  const q = fold(c.q.trim());
  const qd = digits(c.q);
  return c.rows.filter((r) => {
    if (c.mine && !r.artigos) return false;
    if (!q) return true;
    return fold(r.titulo).includes(q) || (qd.length >= 4 && digits(r.issn).includes(qd));
  });
}

function countBy(rows, val) {
  const out = {};
  for (const r of rows) out[r.estrato] = (out[r.estrato] || 0) + val(r);
  return out;
}

function donut(id, title, sub, counts, unit, c) {
  const keys = [...QUALIS_ORDER.filter((k) => counts[k]), ...Object.keys(counts).filter((k) => counts[k] && !QUALIS_ORDER.includes(k))];
  const tot = keys.reduce((a, k) => a + counts[k], 0);
  let chart;
  if (!tot) {
    chart = `<div class="chart-empty">${unit === "artigos" ? "Nenhum artigo seu nestas revistas" : "Nenhuma revista com estes filtros"}</div>`;
  } else {
    const R = 90, r = 58, cx = 110, cy = 110;
    let a0 = -Math.PI / 2, s = "";
    const sel = c.estratos;
    keys.forEach((k, i) => {
      const a1 = a0 + (counts[k] / tot) * Math.PI * 2;
      const gap = keys.length > 1 ? 0.012 : 0;
      const dim = sel.size && !sel.has(k) ? " dim" : "";
      s += `<path class="slice ql-slice${dim}" style="--d:${i * 50}ms" d="${arc(cx, cy, R, r, a0, a1 - gap)}" fill="${colorOf(k)}" data-estrato="${escapeHtml(k)}"
        data-tip="<b>Qualis ${escapeHtml(k)}</b><br>${fmt(counts[k])} ${unit} · ${pct(counts[k], tot)}%<br><small>Clique para filtrar</small>"/>`;
      a0 = a1;
    });
    s += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-n">${fmt(tot)}</text><text x="${cx}" y="${cy + 16}" text-anchor="middle" class="ax">${unit}</text>`;
    const legend = keys
      .map((k) => `<button type="button" class="lg ql-lg ${sel.size && !sel.has(k) ? "off" : ""}" data-estrato="${escapeHtml(k)}" aria-pressed="${sel.has(k)}">
          <i style="background:${colorOf(k)}"></i><span>${escapeHtml(k)}</span><b>${fmt(counts[k])}</b><em>${pct(counts[k], tot)}%</em></button>`)
      .join("");
    chart = `<div class="donut-wrap ql-donut"><svg viewBox="0 0 220 220" class="svg donut" role="img" aria-label="${escapeHtml(title)}">${s}</svg><div class="legend ql-legend">${legend}</div></div>`;
  }
  return `<div class="card ql-chart" id="${id}"><div class="card-h"><h3>${escapeHtml(title)}</h3><span>${escapeHtml(sub)}</span></div>${chart}</div>`;
}

function renderBody(view, st, host) {
  const c = state(st);
  const base = baseFilter(c);
  const rows = c.estratos.size ? base.filter((r) => c.estratos.has(r.estrato)) : base;
  const ord = (q) => { const i = QUALIS_ORDER.indexOf(q); return i < 0 ? 99 : i; };
  const byName = (a, b) => a.titulo.localeCompare(b.titulo, "pt-BR");
  rows.sort(
    c.sort === "estrato" ? (a, b) => ord(a.estrato) - ord(b.estrato) || byName(a, b)
      : c.sort === "artigos" ? (a, b) => b.artigos - a.artigos || ord(a.estrato) - ord(b.estrato) || byName(a, b)
        : byName
  );

  const all = c.rows;
  const estratoA = all.filter((r) => /^A\d$/.test(r.estrato)).length;
  const minhas = all.filter((r) => r.artigos);
  const artigos = minhas.reduce((a, r) => a + r.artigos, 0);
  const artigosA = minhas.filter((r) => /^A\d$/.test(r.estrato)).reduce((a, r) => a + r.artigos, 0);
  const presentes = QUALIS_ORDER.filter((k) => all.some((r) => r.estrato === k));
  const shown = rows.slice(0, c.limit);
  const filtered = c.q.trim() || c.mine || c.estratos.size;

  host.innerHTML = `
    <div class="ql-tiles">
      <div class="pd-tile good"><b>${fmt(all.length)}</b><span>periódicos na tabela</span></div>
      <div class="pd-tile good"><b>${pct(estratoA, all.length)}%</b><span>no estrato A (${fmt(estratoA)})</span></div>
      <div class="pd-tile good"><b>${fmt(minhas.length)}</b><span>revistas onde publiquei</span></div>
      <div class="pd-tile good"><b>${pct(artigosA, artigos)}%</b><span>dos meus artigos no estrato A (${fmt(artigosA)} de ${fmt(artigos)})</span></div>
    </div>
    <div class="ql-charts">
      ${donut("ql-ch-rev", "Periódicos por estrato", filtered ? "com os filtros atuais" : "toda a tabela", countBy(base, () => 1), "periódicos", c)}
      ${donut("ql-ch-art", "Meus artigos por estrato oficial", "artigos do banco encontrados na tabela", countBy(base, (r) => r.artigos), "artigos", c)}
    </div>
    <div class="ql-chips" role="group" aria-label="Filtrar por estrato">
      <span class="ql-chips-l">Estrato:</span>
      ${presentes.map((k) => `<button type="button" class="ql-chip ${c.estratos.has(k) ? "on" : ""}" data-estrato="${k}" aria-pressed="${c.estratos.has(k)}"><i style="background:${colorOf(k)}"></i>${k}</button>`).join("")}
      ${filtered ? `<button type="button" class="btn btn-secondary btn-sm" id="ql-cat-clear">Limpar filtros</button>` : ""}
    </div>
    <div class="ql-cat-count">${fmt(rows.length)} periódico(s)${rows.length !== all.length ? ` de ${fmt(all.length)}` : ""}</div>
    ${shown.length
      ? `<div class="tl-table"><table class="data-table pd-table ql-cat-table">
        <thead><tr><th>Revista</th><th>ISSN</th><th>Estrato</th><th title="Artigos do banco publicados nesta revista">Meus artigos</th></tr></thead>
        <tbody>${shown.map((r) => `<tr class="${r.artigos ? "ql-mine" : ""}">
          <td>${escapeHtml(r.titulo)}</td>
          <td class="mono">${escapeHtml(r.issn || "—")}</td>
          <td>${renderQualisBadge(r.estrato)}</td>
          <td class="ql-n">${r.artigos ? `<b>${fmt(r.artigos)}</b>` : `<span class="muted">—</span>`}</td>
        </tr>`).join("")}</tbody></table></div>
        ${rows.length > shown.length ? `<div class="pd-more"><button type="button" class="btn btn-secondary btn-sm" id="ql-cat-more">Mostrar mais ${fmt(Math.min(PAGE, rows.length - shown.length))}</button> <span>Mostrando ${fmt(shown.length)} de ${fmt(rows.length)}.</span></div>` : ""}`
      : `<p class="pd-empty">Nenhum periódico com estes filtros.</p>`}`;

  const toggle = (k) => {
    c.estratos.has(k) ? c.estratos.delete(k) : c.estratos.add(k);
    c.limit = PAGE;
    hideTip();
    renderBody(view, st, host);
  };
  host.querySelectorAll("[data-estrato]").forEach((b) => b.addEventListener("click", () => toggle(b.dataset.estrato)));
  host.querySelector("#ql-cat-clear")?.addEventListener("click", () => {
    c.q = "";
    c.mine = false;
    c.estratos.clear();
    c.limit = PAGE;
    renderCatalog(view, st, host.parentElement);
  });
  host.querySelector("#ql-cat-more")?.addEventListener("click", () => {
    c.limit += PAGE;
    renderBody(view, st, host);
  });
  attachTip(host);
  c.lastRows = rows;
}

/** Desenha o catálogo dentro de `root` (carrega a lista na primeira vez). */
export function renderCatalog(view, st, root) {
  const c = state(st);
  if (!root) return;
  if (!c.rows) {
    root.innerHTML = `<div class="loading-state" style="display:flex; flex-direction:column; gap:12px; padding:32px 0;"><div class="spinner"></div><div>Carregando os periódicos…</div></div>`;
    if (!c.loading) {
      c.loading = true;
      api.qualisList()
        .then((rows) => { c.rows = rows || []; })
        .catch((e) => { c.rows = []; showToast(`Não foi possível carregar a tabela: ${e}`, "error"); })
        .finally(() => {
          c.loading = false;
          const again = view.el.querySelector("#ql-cat");
          if (again) renderCatalog(view, st, again);
        });
    }
    return;
  }

  root.innerHTML = `
    <div class="pd-toolbar ql-cat-bar">
      <div class="pd-search"><input type="search" id="ql-cat-q" class="form-input" placeholder="Buscar revista por nome ou ISSN…" value="${escapeHtml(c.q)}" aria-label="Buscar revista" /></div>
      <div class="pd-toolbar-actions">
        <label class="ql-check"><input type="checkbox" id="ql-cat-mine" ${c.mine ? "checked" : ""} /> Só onde publiquei</label>
        <select id="ql-cat-sort" class="form-select" aria-label="Ordenar">
          <option value="titulo" ${c.sort === "titulo" ? "selected" : ""}>Ordenar por nome</option>
          <option value="estrato" ${c.sort === "estrato" ? "selected" : ""}>Ordenar por estrato</option>
          <option value="artigos" ${c.sort === "artigos" ? "selected" : ""}>Ordenar por meus artigos</option>
        </select>
        <button type="button" class="btn btn-secondary btn-sm" id="ql-cat-export">⬇️ Exportar .xlsx</button>
      </div>
    </div>
    <div id="ql-cat-body"></div>`;
  const body = root.querySelector("#ql-cat-body");
  renderBody(view, st, body);

  const q = root.querySelector("#ql-cat-q");
  q.addEventListener("input", () => {
    c.q = q.value;
    c.limit = PAGE;
    clearTimeout(c.timer);
    c.timer = setTimeout(() => renderBody(view, st, body), 150);
  });
  root.querySelector("#ql-cat-mine").addEventListener("change", (e) => {
    c.mine = e.target.checked;
    c.limit = PAGE;
    renderBody(view, st, body);
  });
  root.querySelector("#ql-cat-sort").addEventListener("change", (e) => {
    c.sort = e.target.value;
    renderBody(view, st, body);
  });
  root.querySelector("#ql-cat-export").addEventListener("click", async () => {
    const rows = c.lastRows || [];
    const info = st.info;
    try {
      const target = await api.selectSavePath(`Qualis_CAPES_${new Date().toISOString().slice(0, 10)}.xlsx`, "xlsx");
      if (!target) return;
      const saved = await api.exportXlsx([{
        name: "Qualis",
        title: `Qualis CAPES${info?.area ? ` — ${info.area}` : ""}${info?.arquivo ? ` (${info.arquivo})` : ""}`,
        columns: ["Revista", "ISSN", "Estrato", "Meus artigos"],
        rows: rows.map((r) => [r.titulo, r.issn || "", r.estrato, r.artigos]),
      }]);
      showToast(`📊 ${fmt(rows.length)} periódico(s) exportados: ${saved.split(/[\\/]/).pop()}`, "success", 4500);
      api.revealInExplorer(saved).catch(() => { });
    } catch (e) {
      showToast(`Falha ao exportar: ${e}`, "error");
    }
  });
}
