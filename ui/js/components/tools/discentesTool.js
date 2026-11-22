// Produção com discentes: produções que têm orientados como coautores, por ano e nível.
// Os autores vêm do XML do Lattes; os casos duvidosos podem ser confirmados ou descartados.

import { api } from "../../api.js";
import { escapeHtml, showToast } from "../../utils.js";

const TOOL_ID = "discentes";
const DECISIONS_KEY = "discentes_decisoes";
const MAX_ROWS = 300;

const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const key = (prodId, orientId) => `${prodId}:${orientId}`;

async function load(view, st) {
  st.loading = true;
  try {
    const [rep, dec] = await Promise.all([
      api.discentesReport(),
      api.getSetting(DECISIONS_KEY).catch(() => null),
    ]);
    st.report = rep;
    st.decisions = dec && typeof dec === "object" ? dec : {};
  } catch (e) {
    showToast(`Erro ao montar o relatório: ${e}`, "error");
    st.report = { total_producoes: 0, com_autores: 0, orientados: 0, itens: [] };
  } finally {
    st.loading = false;
  }
  if (view.active === TOOL_ID) renderDiscentesTool(view);
}

function saveDecisions(st) {
  api.setSetting(DECISIONS_KEY, st.decisions).catch(() => { });
}

/** Produções com os discentes que valem (sem os descartados), e o que ainda precisa de revisão. */
function effective(st) {
  const out = [];
  for (const p of st.report?.itens || []) {
    const ds = [];
    for (const d of p.discentes) {
      const dec = st.decisions[key(p.id, d.orientacao_id)];
      if (dec === "no") continue;
      const revisar = !dec && (d.confianca !== "alta" || d.fora_periodo);
      ds.push({ ...d, dec, revisar });
    }
    if (ds.length) out.push({ ...p, discentes: ds, revisar: ds.some((d) => d.revisar) });
  }
  return out;
}

async function exportXlsx(rows, porAno) {
  const dest = await api.selectSavePath("producao_com_discentes.xlsx", "xlsx");
  if (!dest) return;
  await api.exportXlsx([
    {
      name: "Por ano",
      title: "Produção com discentes por ano",
      columns: ["Ano", "Produções com autores", "Com discentes", "%"],
      rows: porAno.map((r) => [r.ano ?? "Sem ano", r.total, r.com, r.total ? Number(((r.com / r.total) * 100).toFixed(1)) : null]),
    },
    {
      name: "Produções",
      title: `Produções com discentes (${rows.length})`,
      columns: ["ID", "Ano", "Tipo", "Título", "Periódico", "Qualis", "Discentes", "Níveis"],
      rows: rows.map((p) => [
        p.id,
        p.ano ?? "",
        p.tipo || "",
        p.titulo,
        p.journal || "",
        p.qualis || "",
        p.discentes.map((d) => d.aluno).join("; "),
        [...new Set(p.discentes.map((d) => d.nivel))].join("; "),
      ]),
    },
  ]);
  showToast("Planilha exportada.", "success");
}

export function renderDiscentesTool(view) {
  const st = view.state;
  st.filter ??= "todas";
  st.nivel ??= "";
  st.query ??= "";

  if (!st.report) {
    view.shell(
      "Produção com discentes",
      "Cruzando os autores das produções com os seus orientados…",
      `<div class="loading-state" style="display:flex; flex-direction:column; gap:16px; padding:40px 0;"><div class="spinner"></div></div>`
    );
    if (!st.loading) load(view, st);
    return;
  }

  const rep = st.report;
  const all = effective(st);
  const niveis = [...new Set(all.flatMap((p) => p.discentes.map((d) => d.nivel)).filter(Boolean))].sort();
  const alunosDistintos = new Set(all.flatMap((p) => p.discentes.map((d) => d.aluno))).size;
  const aRevisar = all.filter((p) => p.revisar).length;
  if (st.filter === "revisar" && !aRevisar) st.filter = "todas";

  // por ano (produções com autores × com discentes)
  const anos = new Map();
  for (const y of rep.anos_com_autores || []) anos.set(y.ano ?? null, { ano: y.ano ?? null, total: y.total, com: 0 });
  for (const p of all) {
    const k = p.ano ?? null;
    if (!anos.has(k)) anos.set(k, { ano: k, total: 0, com: 0 });
    anos.get(k).com += 1;
  }
  const porAno = [...anos.values()].sort((a, b) => (b.ano ?? -1) - (a.ano ?? -1));

  const q = st.query.trim().toLowerCase();
  const rows = all.filter((p) => {
    if (st.filter === "revisar" && !p.revisar) return false;
    if (st.nivel && !p.discentes.some((d) => d.nivel === st.nivel)) return false;
    if (!q) return true;
    return [p.titulo, p.journal, String(p.ano ?? ""), ...p.discentes.map((d) => d.aluno)].some((s) => String(s || "").toLowerCase().includes(q));
  });
  const shown = rows.slice(0, MAX_ROWS);
  const semAutores = rep.total_producoes - rep.com_autores;

  const chip = (p, d) => {
    const k = key(p.id, d.orientacao_id);
    const conf = d.dec === "ok" ? "confirmado" : d.confianca === "alta" ? "alta" : "média";
    const why = [
      d.autor && d.autor !== d.aluno ? `no artigo: ${d.autor}` : "",
      d.fora_periodo ? `orientação em ${d.ano_orientacao}` : "",
    ].filter(Boolean).join(" · ");
    return `<div class="ds-chip ${d.revisar ? "revisar" : ""}">
      <span><b>${escapeHtml(d.aluno)}</b> · ${escapeHtml(d.nivel || "Orientação")} <span class="ds-conf ${conf === "média" ? "media" : ""}">${conf}</span></span>
      ${why ? `<span class="ds-why">${escapeHtml(why)}</span>` : ""}
      <span class="ds-acts">
        ${d.revisar ? `<button type="button" class="btn btn-secondary btn-sm" data-ok="${k}" title="É o meu orientado">✓ É</button>` : ""}
        <button type="button" class="btn btn-secondary btn-sm" data-no="${k}" title="Não é o meu orientado (descarta esta ligação)">✕ Não é</button>
      </span>
    </div>`;
  };

  const body = `
    <div class="ql-wrap">
      <div class="ql-step">
        <div>
          <b>Autores das produções</b>
          <p>${fmt(rep.com_autores)} de ${fmt(rep.total_producoes)} produções têm a lista de autores. ${semAutores ? `Para as outras ${fmt(semAutores)}, atualize pelo XML do Lattes (as importadas antes desta versão não guardavam os autores).` : ""}</p>
        </div>
        <div class="ql-actions">
          <button type="button" class="btn ${semAutores ? "btn-primary" : "btn-secondary"} btn-sm" id="ds-sync" ${st.syncing ? "disabled" : ""}>${st.syncing ? "Lendo o XML…" : "🔄 Atualizar autores pelo XML"}</button>
        </div>
      </div>

      ${rep.orientados === 0
        ? `<p class="pd-empty">Nenhuma orientação com nome de aluno cadastrada. Importe as orientações do XML do Lattes.</p>`
        : `
      <div class="ql-tiles">
        <div class="pd-tile good"><b>${fmt(all.length)}</b><span>produções com discentes (${pct(all.length, rep.com_autores)})</span></div>
        <div class="pd-tile good"><b>${fmt(alunosDistintos)}</b><span>orientados coautores, de ${fmt(rep.orientados)}</span></div>
        <button type="button" class="pd-tile ${aRevisar ? "bad" : "good"} ${st.filter === "revisar" ? "active" : ""}" data-filter="revisar" ${aRevisar ? "" : "disabled"}><b>${fmt(aRevisar)}</b><span>para revisar</span></button>
      </div>

      <details class="ds-years" ${st.yearsOpen ? "open" : ""}>
        <summary>Por ano</summary>
        <div class="tl-table"><table class="data-table">
          <thead><tr><th>Ano</th><th>Produções com autores</th><th>Com discentes</th><th>%</th></tr></thead>
          <tbody>${porAno.map((r) => `<tr><td>${r.ano ?? "Sem ano"}</td><td>${fmt(r.total)}</td><td>${fmt(r.com)}</td><td>${pct(r.com, r.total)}</td></tr>`).join("")}</tbody>
        </table></div>
      </details>

      <div class="pd-toolbar">
        <div class="pd-search"><input type="search" id="ds-search" class="form-input" placeholder="Buscar por título, revista, aluno ou ano…" value="${escapeHtml(st.query)}" aria-label="Buscar produções" /></div>
        <div class="pd-toolbar-actions">
          <select id="ds-nivel" class="form-select" style="width:auto;" aria-label="Nível da orientação">
            <option value="">Todos os níveis</option>
            ${niveis.map((n) => `<option ${n === st.nivel ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
          </select>
          ${st.filter === "revisar" ? `<button type="button" class="btn btn-secondary btn-sm" data-filter="todas">✕ Limpar filtro</button>` : ""}
          <button type="button" class="btn btn-secondary btn-sm" id="ds-xlsx" ${all.length ? "" : "disabled"}>📊 Exportar Excel</button>
        </div>
      </div>

      ${shown.length
        ? `<div class="tl-table"><table class="data-table pd-table ds-table">
            <thead><tr><th>Produção</th><th>Discentes coautores</th></tr></thead>
            <tbody>${shown.map((p) => `<tr>
              <td><div class="pd-title">${escapeHtml(p.titulo)}</div>
                <div class="pd-meta">${[p.ano ?? "sem ano", p.tipo, p.journal, p.qualis ? `Qualis ${p.qualis}` : ""].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ")}</div></td>
              <td><div class="ds-chips">${p.discentes.map((d) => chip(p, d)).join("")}</div></td>
            </tr>`).join("")}</tbody></table></div>
          ${rows.length > shown.length ? `<p class="pd-more">Mostrando ${shown.length} de ${fmt(rows.length)}.</p>` : ""}`
        : `<p class="pd-empty">${rep.com_autores ? "Nenhuma produção com discentes nesses filtros." : "Atualize os autores pelo XML para começar."}</p>`}
      <p class="pd-more">A comparação de nomes é aproximada: "média" quer dizer que o nome bate só pela forma de citação ou em parte, e "orientação em…" avisa quando a produção está longe do período da orientação. Confirme ou descarte esses casos; a escolha fica salva.</p>`}
    </div>`;

  view.shell(
    "Produção com discentes",
    "Produções que têm seus orientados como coautores, por ano e nível — indicador usado por PPGs, CAPES e CNPq.",
    body
  );

  const el = view.el;
  el.querySelector("#ds-sync")?.addEventListener("click", async () => {
    st.syncing = true;
    renderDiscentesTool(view);
    let r = null;
    try {
      r = await api.syncAutoresXml(null);
    } catch (e) {
      // sem XML na pasta: pede o arquivo
      const path = await api.selectXmlFile().catch(() => null);
      if (path) r = await api.syncAutoresXml(path).catch((err) => showToast(`Erro: ${err}`, "error"));
      else showToast(String(e), "error", 6000);
    }
    st.syncing = false;
    if (r) {
      showToast(
        `Autores atualizados em ${fmt(r.atualizadas)} produção(ões)` + (r.sem_correspondencia ? `; ${fmt(r.sem_correspondencia)} do XML não estão no banco.` : "."),
        "success",
        6000
      );
      st.report = null;
    }
    renderDiscentesTool(view);
  });
  el.querySelectorAll("[data-filter]").forEach((b) =>
    b.addEventListener("click", () => {
      st.filter = st.filter === b.dataset.filter ? "todas" : b.dataset.filter;
      renderDiscentesTool(view);
    })
  );
  el.querySelector("#ds-nivel")?.addEventListener("change", (e) => {
    st.nivel = e.target.value;
    renderDiscentesTool(view);
  });
  el.querySelector(".ds-years")?.addEventListener("toggle", (e) => {
    st.yearsOpen = e.target.open;
  });
  const search = el.querySelector("#ds-search");
  search?.addEventListener("input", () => {
    st.query = search.value;
    const pos = search.selectionStart;
    renderDiscentesTool(view);
    const again = view.el.querySelector("#ds-search");
    again?.focus();
    again?.setSelectionRange(pos, pos);
  });
  el.querySelectorAll("[data-ok]").forEach((b) =>
    b.addEventListener("click", () => {
      st.decisions[b.dataset.ok] = "ok";
      saveDecisions(st);
      renderDiscentesTool(view);
    })
  );
  el.querySelectorAll("[data-no]").forEach((b) =>
    b.addEventListener("click", () => {
      st.decisions[b.dataset.no] = "no";
      saveDecisions(st);
      renderDiscentesTool(view);
    })
  );
  el.querySelector("#ds-xlsx")?.addEventListener("click", () =>
    exportXlsx(rows, porAno).catch((e) => showToast(`Erro ao exportar: ${e}`, "error"))
  );
}
