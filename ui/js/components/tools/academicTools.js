// Ferramentas acadêmicas baseadas em APIs abertas: Métricas OpenAlex e Sincronizador ORCID.

import { api } from "../../api.js";
import { escapeHtml, showToast } from "../../utils.js";

const OA_META = {
  gold: { label: "Gold OA", color: "#f59e0b", bg: "rgba(245,158,11,0.16)" },
  green: { label: "Green OA", color: "#10b981", bg: "rgba(16,185,129,0.16)" },
  hybrid: { label: "Hybrid OA", color: "#3b82f6", bg: "rgba(59,130,246,0.16)" },
  bronze: { label: "Bronze OA", color: "#d97706", bg: "rgba(217,119,6,0.16)" },
  closed: { label: "Fechado", color: "#94a3b8", bg: "rgba(148,163,184,0.16)" },
};

function oaBadge(status) {
  const key = (status || "closed").toLowerCase();
  const meta = OA_META[key] || OA_META.closed;
  return `<span class="badge" style="background:${meta.bg}; color:${meta.color};">${escapeHtml(meta.label)}</span>`;
}

// ==========================================
// 1. MÉTRICAS OPENALEX (API ABERTA / GRATUITA)
// ==========================================
export function renderOpenAlexTool(view) {
  const st = view.state;
  st.updateDb ??= true;
  st.openalexSyncing ??= false;
  st.query ??= "";
  st.oaFilter ??= "all"; // "all" | "oa" | "closed"
  st.report ??= null;

  if (!st.loadedCache) {
    st.loadedCache = true;
    api
      .getSetting("openalex_last_report")
      .then((cached) => {
        if (cached && !st.report) {
          st.report = cached;
          if (view.active === "openalex_metrics") renderOpenAlexTool(view);
        }
      })
      .catch(() => {});
  }

  const r = st.report;
  let bodyHtml = `
    <div class="tl-bar" style="flex-wrap:wrap; gap:12px; align-items:center;">
      <label style="display:flex; align-items:center; gap:7px; font-size:13px; cursor:pointer;">
        <input type="checkbox" id="oa-update-db" ${st.updateDb ? "checked" : ""} />
        Atualizar citações na tabela Produções
      </label>
      <div style="flex:1"></div>
      ${r?.synced_at ? `<span style="font-size:12px; color:var(--text-secondary);">Última sincronização: <b>${escapeHtml(r.synced_at)}</b></span>` : ""}
      <button type="button" class="btn btn-primary btn-sm" id="oa-sync-btn" ${st.openalexSyncing ? "disabled" : ""}>
        ${st.openalexSyncing ? "⏳ Consultando OpenAlex..." : "📈 Sincronizar com OpenAlex (Grátis)"}
      </button>
    </div>
  `;

  if (!r) {
    bodyHtml += `
      <div class="tl-empty">
        <p style="margin:0 0 8px;">Consulte a base aberta da <b>OpenAlex</b> usando os DOIs já cadastrados em <b>Produções</b> — sem precisar de chave paga da SerpApi.</p>
        <p style="margin:0; font-size:12.5px; color:var(--text-secondary);">Você obtém contagem de citações, Índice h, i10, evolução anual, status de Acesso Aberto (com link de PDF), ISSN dos periódicos e ranking de coautores/instituições.</p>
      </div>
    `;
  } else {
    const oaMap = r.oa_counts || {};
    const gold = oaMap.gold || 0;
    const green = oaMap.green || 0;
    const hybrid = oaMap.hybrid || 0;
    const bronze = oaMap.bronze || 0;
    const closed = oaMap.closed || 0;
    const oaTotal = gold + green + hybrid + bronze;
    const oaPct = r.matched_count > 0 ? Math.round((oaTotal / r.matched_count) * 100) : 0;

    const errsHtml = r.errors?.length
      ? `<div style="margin:8px 0; padding:8px 12px; border-radius:8px; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.35); font-size:12px; color:var(--warning,#f59e0b);">
          <b>Avisos:</b> ${escapeHtml(r.errors.slice(0, 3).join(" | "))}
        </div>`
      : "";

    const years = (r.yearly_citations || []).slice(-12);
    const maxYearCite = Math.max(1, ...years.map((y) => y.citations || 0));

    const q = (st.query || "").trim().toLowerCase();
    const filteredItems = (r.items || []).filter((it) => {
      const isClosed = !it.oa_status || it.oa_status.toLowerCase() === "closed";
      if (st.oaFilter === "oa" && isClosed) return false;
      if (st.oaFilter === "closed" && !isClosed) return false;
      if (q) {
        const hay = `${it.titulo || ""} ${it.journal || ""} ${it.issn || ""} ${it.doi || ""} ${it.ano || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    bodyHtml += `
      ${errsHtml}
      <div class="tm-stats-grid" style="margin-top:12px;">
        <div class="tm-stat-card tm-stat-unchanged">
          <b>${r.total_citations}</b>
          <span>Total de Citações (${r.matched_count}/${r.total_with_doi} DOIs)</span>
        </div>
        <div class="tm-stat-card tm-stat-added">
          <b>h = ${r.h_index}</b>
          <span>Índice h (OpenAlex)</span>
        </div>
        <div class="tm-stat-card tm-stat-modified">
          <b>i10 = ${r.i10_index}</b>
          <span>Artigos com ≥ 10 citações</span>
        </div>
        <div class="tm-stat-card" style="border-color:rgba(16,185,129,0.35);">
          <b>${oaPct}%</b>
          <span>Acesso Aberto (${oaTotal} OA / ${closed} fech.)</span>
        </div>
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:8px; margin:12px 0;">
        ${["gold", "green", "hybrid", "bronze", "closed"].map((k) => {
          const m = OA_META[k];
          return `<span class="oa-pill" style="background:${m.bg}; color:${m.color};">${m.label}: <b>${oaMap[k] || 0}</b></span>`;
        }).join("")}
      </div>

      <div class="xc-two-col">
        <div style="border:1px solid var(--border-light); border-radius:10px; padding:12px 14px; background:var(--surface-2);">
          <b style="font-size:13px; display:block; margin-bottom:10px;">📅 Evolução Anual de Citações</b>
          ${years.length ? years.map((y) => {
            const pct = Math.round(((y.citations || 0) / maxYearCite) * 100);
            return `<div class="oa-bar-row">
              <span class="mono" style="width:42px; font-size:12px;">${y.year}</span>
              <div class="oa-bar-track"><div class="oa-bar-fill" style="width:${pct}%"></div></div>
              <span class="mono" style="width:44px; text-align:right; font-size:12px; font-weight:700;">${y.citations}</span>
            </div>`;
          }).join("") : `<div style="font-size:12px; color:var(--text-secondary);">Sem histórico anual retornado para os DOIs.</div>`}
        </div>

        <div style="border:1px solid var(--border-light); border-radius:10px; padding:12px 14px; background:var(--surface-2); display:flex; flex-direction:column; gap:12px;">
          <div>
            <b style="font-size:13px; display:block; margin-bottom:6px;">👥 Principais Coautores</b>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              ${(r.top_coauthors || []).slice(0, 8).map((c) =>
                `<span class="badge" style="background:var(--surface-3); color:var(--text-primary); border:1px solid var(--border-light);">${escapeHtml(c.name)} <b class="mono">(${c.count})</b></span>`
              ).join("") || `<span style="font-size:12px; color:var(--text-secondary);">—</span>`}
            </div>
          </div>
          <div>
            <b style="font-size:13px; display:block; margin-bottom:6px;">🏛️ Principais Instituições Parceiras</b>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              ${(r.top_institutions || []).slice(0, 8).map((c) =>
                `<span class="badge" style="background:var(--surface-3); color:var(--text-primary); border:1px solid var(--border-light);">${escapeHtml(c.name)} <b class="mono">(${c.count})</b></span>`
              ).join("") || `<span style="font-size:12px; color:var(--text-secondary);">—</span>`}
            </div>
          </div>
        </div>
      </div>

      <div class="tl-bar" style="flex-wrap:wrap; gap:10px; margin-top:14px;">
        <div class="seg tl-seg">
          <button type="button" data-oa-filter="all" class="${st.oaFilter === "all" ? "on" : ""}">Todos (${(r.items || []).length})</button>
          <button type="button" data-oa-filter="oa" class="${st.oaFilter === "oa" ? "on" : ""}">🔓 Acesso Aberto (${oaTotal})</button>
          <button type="button" data-oa-filter="closed" class="${st.oaFilter === "closed" ? "on" : ""}">🔒 Fechado (${closed})</button>
        </div>
        <input type="text" id="oa-search" class="form-input" value="${escapeHtml(st.query)}" placeholder="Filtrar por título, revista, ISSN ou DOI..." style="flex:1; min-width:200px; height:32px;" />
      </div>

      <div class="tl-table" style="max-height:420px; margin-top:6px;">
        ${filteredItems.length ? `
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:64px;">Ano</th>
                <th>Título</th>
                <th style="width:220px;">Periódico / ISSN</th>
                <th style="width:110px;">Acesso</th>
                <th style="width:92px; text-align:right;">Citações</th>
                <th style="width:96px; text-align:right;">Links</th>
              </tr>
            </thead>
            <tbody>
              ${filteredItems.map((it) => {
                const delta = it.citations_before != null ? it.citations_after - it.citations_before : null;
                const deltaTag = delta && delta !== 0
                  ? `<span style="font-size:11px; color:${delta > 0 ? "#10b981" : "#f59e0b"};">(${delta > 0 ? `+${delta}` : delta})</span>`
                  : "";
                return `<tr>
                  <td class="mono">${it.ano || "—"}</td>
                  <td>
                    <div style="font-weight:600;">${escapeHtml(it.titulo)}</div>
                    <div class="mono" style="font-size:11px; color:var(--text-secondary);">${escapeHtml(it.doi)}</div>
                  </td>
                  <td>
                    <div style="font-size:12.5px;">${escapeHtml(it.journal || "—")}</div>
                    ${it.issn ? `<div class="mono" style="font-size:11px; color:var(--text-secondary);">ISSN ${escapeHtml(it.issn)}</div>` : ""}
                  </td>
                  <td>${oaBadge(it.oa_status)}</td>
                  <td style="text-align:right;" class="mono"><b>${it.citations_after}</b> ${deltaTag}</td>
                  <td style="text-align:right; white-space:nowrap;">
                    ${it.oa_pdf_url ? `<button type="button" class="ibtn" data-oa-pdf="${escapeHtml(it.oa_pdf_url)}" title="Abrir PDF em acesso aberto">📄</button>` : ""}
                    <button type="button" class="ibtn" data-oa-doi="${escapeHtml(it.doi)}" title="Abrir DOI no navegador">↗</button>
                  </td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        ` : `<div class="tl-empty">Nenhum artigo encontrado para este filtro.</div>`}
      </div>
    `;
  }

  view.shell(
    "Métricas OpenAlex (Gratuitas / Sem API Key)",
    "Citações, índice h, acesso aberto (OA), ISSN e colaboração científica via API aberta da OpenAlex.",
    bodyHtml
  );

  view.el.querySelector("#oa-update-db")?.addEventListener("change", (e) => {
    st.updateDb = e.target.checked;
  });

  view.el.querySelector("#oa-sync-btn")?.addEventListener("click", async () => {
    if (st.openalexSyncing) return;
    st.openalexSyncing = true;
    view.syncBackgroundBadge();
    renderOpenAlexTool(view);
    try {
      const rep = await api.syncOpenAlexMetrics(st.updateDb);
      st.report = rep;
      if (st.updateDb && rep.updated_citations_count > 0 && view.onChanged) {
        await view.onChanged();
      }
      showToast(
        `OpenAlex: ${rep.matched_count}/${rep.total_with_doi} DOIs localizados · ${rep.updated_citations_count} registro(s) atualizado(s)!`,
        "success",
        4000
      );
    } catch (e) {
      showToast(`Erro ao consultar OpenAlex: ${e}`, "error");
    } finally {
      st.openalexSyncing = false;
      view.syncBackgroundBadge();
      if (view.active === "openalex_metrics") renderOpenAlexTool(view);
    }
  });

  view.el.querySelectorAll("[data-oa-filter]").forEach((b) =>
    b.addEventListener("click", () => {
      st.oaFilter = b.dataset.oaFilter;
      renderOpenAlexTool(view);
    })
  );

  view.el.querySelector("#oa-search")?.addEventListener("input", (e) => {
    st.query = e.target.value;
    const pos = e.target.selectionStart;
    renderOpenAlexTool(view);
    const inp = view.el.querySelector("#oa-search");
    if (inp) {
      inp.focus();
      if (pos != null) inp.setSelectionRange(pos, pos);
    }
  });

  view.el.querySelectorAll("[data-oa-pdf]").forEach((b) =>
    b.addEventListener("click", () => api.openUrl(b.dataset.oaPdf).catch((err) => showToast(String(err), "error")))
  );

  view.el.querySelectorAll("[data-oa-doi]").forEach((b) =>
    b.addEventListener("click", () => api.openDoi(b.dataset.oaDoi).catch((err) => showToast(String(err), "error")))
  );
}

// ==========================================
// 2. SINCRONIZADOR ORCID (BD × ORCID)
// ==========================================
export function renderOrcidSyncTool(view) {
  const st = view.state;
  st.orcidInput ??= "";
  st.orcidSyncing ??= false;
  st.tab ??= "only_orcid"; // "only_orcid" | "only_db" | "matched"
  st.query ??= "";
  st.selectedIndices ??= new Set();
  st.importing ??= false;
  st.report ??= null;

  if (!st.loadedOrcid) {
    st.loadedOrcid = true;
    Promise.all([
      api.getSetting("profile").catch(() => null),
      api.getSetting("orcid_id").catch(() => null),
    ]).then(([prof, savedOrcid]) => {
      const found = prof?.values?.orcid || savedOrcid || "";
      if (found && !st.orcidInput) {
        st.orcidInput = String(found).trim();
        if (view.active === "orcid_sync") renderOrcidSyncTool(view);
      }
    });
  }

  const runSync = async (orcidStr) => {
    const clean = String(orcidStr || "").trim();
    if (!clean) {
      showToast("Informe seu ORCID (ex.: 0000-0002-1825-0097)", "warning");
      return;
    }
    st.orcidSyncing = true;
    view.syncBackgroundBadge();
    renderOrcidSyncTool(view);
    try {
      const rep = await api.syncOrcidWorks(clean);
      st.report = rep;
      st.orcidInput = rep.orcid;
      st.selectedIndices = new Set();
      showToast(
        `ORCID ${rep.orcid}: ${rep.matched_count} em comum, ${rep.only_in_orcid_count} só no ORCID, ${rep.only_in_db_count} só no banco.`,
        "success",
        4000
      );
    } catch (e) {
      showToast(`Erro ao consultar ORCID: ${e}`, "error");
    } finally {
      st.orcidSyncing = false;
      view.syncBackgroundBadge();
      if (view.active === "orcid_sync") renderOrcidSyncTool(view);
    }
  };

  const r = st.report;
  let bodyHtml = `
    <div class="tl-bar" style="flex-wrap:wrap; gap:10px; align-items:center;">
      <label for="or-input" style="font-size:13px; font-weight:600;">ORCID:</label>
      <input type="text" id="or-input" class="form-input mono" value="${escapeHtml(st.orcidInput)}" placeholder="0000-0000-0000-0000 ou https://orcid.org/..." style="flex:1; min-width:260px; max-width:420px; height:34px;" />
      <button type="button" class="btn btn-primary btn-sm" id="or-sync-btn" ${st.orcidSyncing ? "disabled" : ""}>
        ${st.orcidSyncing ? "⏳ Consultando ORCID..." : "🆔 Consultar e Cruzar com ORCID"}
      </button>
    </div>
  `;

  if (!r) {
    bodyHtml += `
      <div class="tl-empty">
        <p style="margin:0 0 6px;">Consulta diretamente a API pública do <b>ORCID</b> (sem senha ou chave paga) e compara com sua tabela de <b>Produções</b>.</p>
        <p style="margin:0; font-size:12.5px; color:var(--text-secondary);">Identifique rapidamente artigos que estão no ORCID e faltam no Lattes Manager (para importar em lote) e DOIs presentes apenas no banco local.</p>
      </div>
    `;
  } else {
    const q = (st.query || "").trim().toLowerCase();
    const indexedWorks = (r.works || []).map((w, i) => ({ ...w, _idx: i }));
    const visibleOnlyOrcid = indexedWorks.filter((w) => {
      if (w.status !== "only_orcid") return false;
      if (!q) return true;
      return `${w.titulo || ""} ${w.journal || ""} ${w.doi || ""} ${w.tipo || ""} ${w.ano || ""}`.toLowerCase().includes(q);
    });
    const visibleMatched = indexedWorks.filter((w) => {
      if (w.status !== "matched") return false;
      if (!q) return true;
      return `${w.titulo || ""} ${w.journal || ""} ${w.doi || ""} ${w.tipo || ""} ${w.ano || ""}`.toLowerCase().includes(q);
    });
    const visibleOnlyDb = (r.only_in_db || []).filter((it) => {
      if (!q) return true;
      return `${it.titulo || ""} ${it.journal || ""} ${it.doi || ""} ${it.tipo || ""} ${it.ano || ""}`.toLowerCase().includes(q);
    });

    const allVisSel = visibleOnlyOrcid.length > 0 && visibleOnlyOrcid.every((w) => st.selectedIndices.has(w._idx));
    const dbOnlyDois = visibleOnlyDb.filter((it) => it.doi).map((it) => it.doi);

    let tabBody = "";
    if (st.tab === "only_orcid") {
      tabBody = `
        ${visibleOnlyOrcid.length ? `
          <div class="tl-bar" style="flex-wrap:wrap; gap:10px; margin-bottom:8px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); border-radius:8px; padding:8px 12px;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px;">
              <input type="checkbox" id="or-sel-all" ${allVisSel ? "checked" : ""} />
              Selecionar todos os ${visibleOnlyOrcid.length} item(ns) visíveis
            </label>
            <div style="flex:1"></div>
            <button type="button" class="btn btn-primary btn-sm" id="or-import-sel" ${st.selectedIndices.size === 0 || st.importing ? "disabled" : ""}>
              ${st.importing ? "⏳ Importando..." : `📥 Importar ${st.selectedIndices.size} selecionado(s) para Produções`}
            </button>
          </div>
          <div class="tl-table" style="max-height:430px;">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:34px;"></th>
                  <th style="width:68px;">Ano</th>
                  <th style="width:165px;">Tipo</th>
                  <th>Título / Periódico / DOI</th>
                  <th style="width:92px; text-align:right;">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${visibleOnlyOrcid.map((w) => `<tr>
                  <td><input type="checkbox" data-or-chk="${w._idx}" ${st.selectedIndices.has(w._idx) ? "checked" : ""} /></td>
                  <td class="mono">${w.ano || "—"}</td>
                  <td><span class="badge badge-tipo">${escapeHtml(w.tipo)}</span></td>
                  <td>
                    <div style="font-weight:600;">${escapeHtml(w.titulo)}</div>
                    <div style="font-size:11.5px; color:var(--text-secondary); display:flex; gap:10px; flex-wrap:wrap; margin-top:2px;">
                      ${w.journal ? `<span>${escapeHtml(w.journal)}</span>` : ""}
                      ${w.doi ? `<span class="mono">DOI: ${escapeHtml(w.doi)}</span>` : ""}
                    </div>
                  </td>
                  <td style="text-align:right; white-space:nowrap;">
                    ${w.doi ? `<button type="button" class="ibtn" data-or-open-doi="${escapeHtml(w.doi)}" title="Abrir DOI">↗</button>` : ""}
                    <button type="button" class="ibtn" data-or-import-one="${w._idx}" title="Importar para Produções">📥</button>
                  </td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>
        ` : `<div class="tl-empty">✅ Nenhuma obra pendente no ORCID para este filtro!</div>`}
      `;
    } else if (st.tab === "only_db") {
      tabBody = `
        ${dbOnlyDois.length ? `
          <div class="tl-bar" style="margin-bottom:8px;">
            <span style="font-size:12.5px; color:var(--text-secondary);">${dbOnlyDois.length} registro(s) com DOI disponíveis para adicionar ao ORCID.</span>
            <div style="flex:1"></div>
            <button type="button" class="btn btn-secondary btn-sm" id="or-copy-dois">📋 Copiar DOIs ausentes no ORCID (${dbOnlyDois.length})</button>
          </div>
        ` : ""}
        <div class="tl-table" style="max-height:430px;">
          ${visibleOnlyDb.length ? `
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:68px;">Ano</th>
                  <th style="width:165px;">Tipo</th>
                  <th>Título / Periódico</th>
                  <th style="width:200px;">DOI</th>
                </tr>
              </thead>
              <tbody>
                ${visibleOnlyDb.slice(0, 500).map((it) => `<tr>
                  <td class="mono">${it.ano || "—"}</td>
                  <td><span class="badge badge-tipo">${escapeHtml(it.tipo || "Produção")}</span></td>
                  <td>
                    <div style="font-weight:600;">${escapeHtml(it.titulo)}</div>
                    ${it.journal ? `<div style="font-size:11.5px; color:var(--text-secondary);">${escapeHtml(it.journal)}</div>` : ""}
                  </td>
                  <td class="mono" style="font-size:11.5px;">
                    ${it.doi ? `<button type="button" class="ibtn" data-or-open-doi="${escapeHtml(it.doi)}" title="Abrir DOI">↗</button> ${escapeHtml(it.doi)}` : "—"}
                  </td>
                </tr>`).join("")}
              </tbody>
            </table>
          ` : `<div class="tl-empty">Nenhuma produção exclusiva do banco encontrada para este filtro.</div>`}
        </div>
      `;
    } else {
      tabBody = `
        <div class="tl-table" style="max-height:430px;">
          ${visibleMatched.length ? `
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:68px;">Ano</th>
                  <th style="width:165px;">Tipo</th>
                  <th>Título / Periódico / DOI</th>
                  <th style="width:84px; text-align:right;">Banco</th>
                </tr>
              </thead>
              <tbody>
                ${visibleMatched.map((w) => `<tr>
                  <td class="mono">${w.ano || "—"}</td>
                  <td><span class="badge badge-tipo">${escapeHtml(w.tipo)}</span></td>
                  <td>
                    <div style="font-weight:600;">${escapeHtml(w.titulo)}</div>
                    <div style="font-size:11.5px; color:var(--text-secondary); display:flex; gap:10px; flex-wrap:wrap; margin-top:2px;">
                      ${w.journal ? `<span>${escapeHtml(w.journal)}</span>` : ""}
                      ${w.doi ? `<span class="mono">${escapeHtml(w.doi)}</span>` : ""}
                    </div>
                  </td>
                  <td style="text-align:right;" class="mono">#${w.db_id}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          ` : `<div class="tl-empty">Nenhuma obra em comum para este filtro.</div>`}
        </div>
      `;
    }

    bodyHtml += `
      <div class="tm-stats-grid" style="margin-top:12px;">
        <div class="tm-stat-card tm-stat-unchanged">
          <b>${r.total_orcid_works}</b>
          <span>Obras no ORCID</span>
        </div>
        <div class="tm-stat-card tm-stat-added" data-or-tab="matched" style="cursor:pointer;">
          <b>∩ ${r.matched_count}</b>
          <span>Em Ambos (BD ∩ ORCID)</span>
        </div>
        <div class="tm-stat-card tm-stat-modified" data-or-tab="only_orcid" style="cursor:pointer;">
          <b>+${r.only_in_orcid_count}</b>
          <span>Só no ORCID (Faltando no BD)</span>
        </div>
        <div class="tm-stat-card tm-stat-removed" data-or-tab="only_db" style="cursor:pointer;">
          <b>-${r.only_in_db_count}</b>
          <span>Só no Banco (Ausentes no ORCID)</span>
        </div>
      </div>

      <div class="tl-bar" style="flex-wrap:wrap; gap:10px; margin:12px 0 8px;">
        <div class="seg tl-seg">
          <button type="button" data-or-tab="only_orcid" class="${st.tab === "only_orcid" ? "on" : ""}">🟡 Só no ORCID (${r.only_in_orcid_count})</button>
          <button type="button" data-or-tab="only_db" class="${st.tab === "only_db" ? "on" : ""}">🔴 Só no Banco (${r.only_in_db_count})</button>
          <button type="button" data-or-tab="matched" class="${st.tab === "matched" ? "on" : ""}">🟢 Em ambos (${r.matched_count})</button>
        </div>
        <input type="text" id="or-search" class="form-input" value="${escapeHtml(st.query)}" placeholder="Filtrar por título, revista ou DOI..." style="flex:1; min-width:200px; height:32px;" />
      </div>

      ${tabBody}
    `;
  }

  view.shell(
    "Sincronizador ORCID (Banco de Dados × ORCID)",
    "Compare suas produções do ORCID público com o banco de dados local e importe obras faltantes com 1 clique.",
    bodyHtml
  );

  view.el.querySelector("#or-input")?.addEventListener("input", (e) => {
    st.orcidInput = e.target.value;
  });
  view.el.querySelector("#or-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runSync(st.orcidInput);
    }
  });
  view.el.querySelector("#or-sync-btn")?.addEventListener("click", () => runSync(st.orcidInput));

  if (!r) return;

  view.el.querySelectorAll("[data-or-tab]").forEach((el) =>
    el.addEventListener("click", () => {
      st.tab = el.dataset.orTab;
      renderOrcidSyncTool(view);
    })
  );

  view.el.querySelector("#or-search")?.addEventListener("input", (e) => {
    st.query = e.target.value;
    const pos = e.target.selectionStart;
    renderOrcidSyncTool(view);
    const inp = view.el.querySelector("#or-search");
    if (inp) {
      inp.focus();
      if (pos != null) inp.setSelectionRange(pos, pos);
    }
  });

  const importOrcidItems = async (items) => {
    if (!items.length || st.importing) return;
    st.importing = true;
    renderOrcidSyncTool(view);
    try {
      const mappings = await api.getSubfolderMappings("Produções").catch(() => []);
      const resolveFolder = (tipo) => {
        const clean = String(tipo || "").trim().toLowerCase();
        const exact = mappings.find((m) => (m.description || "").trim().toLowerCase() === clean);
        if (exact?.folder) return exact.folder;
        const partial = mappings.find((m) => (m.description || "").trim().toLowerCase().includes(clean));
        if (partial?.folder) return partial.folder;
        return "5_producoes\\artigos_completos\\";
      };

      for (const it of items) {
        const tipo = it.tipo || "Artigos completos";
        await api.createRecord(
          "producoes",
          {
            ano: it.ano || null,
            tipo,
            titulo: it.titulo,
            journal: it.journal || null,
            identifier: it.doi || null,
            url: it.url || (it.doi ? `https://doi.org/${it.doi}` : null),
            qualis: "",
            folder: resolveFolder(tipo),
          },
          null
        );
      }
      showToast(`${items.length} produção(ões) importada(s) do ORCID!`, "success");
      if (view.onChanged) await view.onChanged();
      st.importing = false;
      await runSync(st.orcidInput);
    } catch (e) {
      st.importing = false;
      showToast(`Erro ao importar do ORCID: ${e}`, "error");
      if (view.active === "orcid_sync") renderOrcidSyncTool(view);
    }
  };

  const updateImportSelBtn = () => {
    const btn = view.el.querySelector("#or-import-sel");
    if (btn) {
      btn.disabled = st.selectedIndices.size === 0 || st.importing;
      btn.textContent = st.importing ? "⏳ Importando..." : `📥 Importar ${st.selectedIndices.size} selecionado(s) para Produções`;
    }
  };

  view.el.querySelector("#or-sel-all")?.addEventListener("change", (e) => {
    view.el.querySelectorAll("[data-or-chk]").forEach((c) => {
      const idx = Number(c.dataset.orChk);
      c.checked = e.target.checked;
      if (e.target.checked) st.selectedIndices.add(idx);
      else st.selectedIndices.delete(idx);
    });
    updateImportSelBtn();
  });

  view.el.querySelectorAll("[data-or-chk]").forEach((c) =>
    c.addEventListener("change", () => {
      const idx = Number(c.dataset.orChk);
      if (c.checked) st.selectedIndices.add(idx);
      else st.selectedIndices.delete(idx);
      const visibleChks = [...view.el.querySelectorAll("[data-or-chk]")];
      const selAll = view.el.querySelector("#or-sel-all");
      if (selAll) selAll.checked = visibleChks.length > 0 && visibleChks.every((x) => x.checked);
      updateImportSelBtn();
    })
  );

  view.el.querySelector("#or-import-sel")?.addEventListener("click", () => {
    const items = [...st.selectedIndices].map((i) => r.works[i]).filter(Boolean);
    importOrcidItems(items);
  });

  view.el.querySelectorAll("[data-or-import-one]").forEach((b) =>
    b.addEventListener("click", () => {
      const item = r.works[Number(b.dataset.orImportOne)];
      if (item) importOrcidItems([item]);
    })
  );

  view.el.querySelectorAll("[data-or-open-doi]").forEach((b) =>
    b.addEventListener("click", () => api.openDoi(b.dataset.orOpenDoi).catch((err) => showToast(String(err), "error")))
  );

  view.el.querySelector("#or-copy-dois")?.addEventListener("click", async () => {
    const dois = (r.only_in_db || []).filter((it) => it.doi).map((it) => it.doi);
    if (!dois.length) return;
    try {
      await navigator.clipboard.writeText(dois.join("\n"));
      showToast(`${dois.length} DOI(s) copiado(s) para a área de transferência!`, "success", 3000);
    } catch {
      showToast("Falha ao copiar para a área de transferência", "error");
    }
  });
}
