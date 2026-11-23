// CiteScore (Scopus/Elsevier): consulta pela API da Elsevier o CiteScore e o percentil das
// revistas dos artigos (só o ano corrente do CiteScore), com gráficos e tabela das revistas.
// Atribuição exigida pela Elsevier: cada CiteScore leva à página da revista no Scopus e a tela
// indica "Powered by Scopus".

import { api } from "../../api.js";
import { escapeHtml, showToast } from "../../utils.js";
import { arc } from "../charts.js";
import { attachTip, hideTip } from "./chartTip.js";
import { invalidateMetrics } from "../../journalMetrics.js";

const TOOL_ID = "citescore";
const PAGE = 200;
const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
const fmt1 = (n) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const fmt3 = (n) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
const pct = (n, t) => (t ? `${Number((n / t) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Quartil do Scopus pelo percentil: Q1 = 75–99, Q2 = 50–74, Q3 = 25–49, Q4 = 0–24. */
export function quartil(p) {
  if (p == null) return null;
  return p >= 75 ? "Q1" : p >= 50 ? "Q2" : p >= 25 ? "Q3" : "Q4";
}
const QS = ["Q1", "Q2", "Q3", "Q4"];
const qColor = (q) => `var(--cs-${q.toLowerCase()})`;

function qBadge(p) {
  const q = quartil(p);
  if (!q) return `<span class="cs-q none">—</span>`;
  return `<span class="cs-q ${q.toLowerCase()}" title="Percentil ${p} (${q})">${q} · ${p}</span>`;
}

// ---------------- gráficos ----------------

function donut(parts, centro, unidade) {
  const tot = parts.reduce((a, p) => a + p.value, 0);
  if (!tot) return `<div class="chart-empty">Sem artigos com CiteScore</div>`;
  const R = 90, r = 58, cx = 110, cy = 110;
  let a0 = -Math.PI / 2, s = "";
  const vis = parts.filter((p) => p.value);
  vis.forEach((p, i) => {
    const a1 = a0 + (p.value / tot) * Math.PI * 2;
    s += `<path class="slice" style="--d:${i * 60}ms" d="${arc(cx, cy, R, r, a0, a1 - (vis.length > 1 ? 0.012 : 0))}" fill="${p.color}" data-tip="<b>${escapeHtml(p.label)}</b><br>${fmt(p.value)} ${unidade} · ${pct(p.value, tot)}"/>`;
    a0 = a1;
  });
  s += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-n">${escapeHtml(centro)}</text><text x="${cx}" y="${cy + 16}" text-anchor="middle" class="ax">${escapeHtml(unidade)}</text>`;
  const legend = parts
    .map((p) => `<div class="lg"><i style="background:${p.color}"></i><span>${escapeHtml(p.label)}</span><b>${fmt(p.value)}</b><em>${pct(p.value, tot)}</em></div>`)
    .join("");
  return `<div class="donut-wrap bb-donut"><svg viewBox="0 0 220 220" class="svg donut" role="img">${s}</svg><div class="legend bb-legend">${legend}</div></div>`;
}

/** Barras verticais: artigos por faixa de percentil (0–9 … 90–99). */
function decis(valores) {
  const n = new Array(10).fill(0);
  valores.forEach((p) => n[Math.min(9, Math.floor(p / 10))]++);
  if (!valores.length) return `<div class="chart-empty">Sem artigos com percentil</div>`;
  const Wc = 560, Hc = 220, P = { l: 30, r: 8, t: 12, b: 26 };
  const max = Math.max(1, ...n);
  // 4 divisões inteiras (contagens de artigos)
  const top = Math.max(4, Math.ceil(max / 4) * 4);
  const iw = (Wc - P.l - P.r) / 10;
  const bw = iw - 4;
  const y = (v) => P.t + (Hc - P.t - P.b) * (1 - v / top);
  let s = "";
  for (let g = 0; g <= 4; g++) {
    const v = (top / 4) * g;
    s += `<line x1="${P.l}" x2="${Wc - P.r}" y1="${y(v)}" y2="${y(v)}" class="bb-grid"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`;
  }
  n.forEach((v, i) => {
    const x = P.l + iw * i + 2;
    const h = Hc - P.b - y(v);
    const q = quartil(i * 10 + 5);
    if (v) s += `<path d="M${x},${Hc - P.b}V${y(v) + Math.min(4, h)}Q${x},${y(v)} ${x + 4},${y(v)}H${x + bw - 4}Q${x + bw},${y(v)} ${x + bw},${y(v) + Math.min(4, h)}V${Hc - P.b}Z" fill="${qColor(q)}"/>`;
    s += `<rect x="${P.l + iw * i}" y="${P.t}" width="${iw}" height="${Hc - P.t - P.b}" fill="transparent" class="bb-hit" data-tip="<b>Percentil ${i * 10}–${i * 10 + 9}</b> (${q})<br>${fmt(v)} artigo(s)"/>`;
    s += `<text x="${x + bw / 2}" y="${Hc - 8}" text-anchor="middle" class="ax">${i * 10}</text>`;
  });
  return `<svg viewBox="0 0 ${Wc} ${Hc}" class="svg bb-chart" role="img" aria-label="Artigos por faixa de percentil">${s}</svg>`;
}

// ---------------- tela ----------------

function progText(p) {
  return `${fmt(p.done)} de ${fmt(p.total)} revista(s)${p.issn ? ` · consultando <span class="mono">${escapeHtml(p.issn)}</span>` : ""}`;
}

async function load(view, st) {
  st.loading = true;
  try {
    st.data = await api.citescoreData();
  } catch (e) {
    showToast(`Não foi possível carregar: ${e}`, "error", 7000);
  } finally {
    st.loading = false;
  }
  if (view.active === TOOL_ID) renderCitescoreTool(view);
}

function guiaChave() {
  return `
    <details class="cs-guide" open>
      <summary><b>Como obter a chave (gratuita, uso acadêmico)</b></summary>
      <ol>
        <li>Abra o <button type="button" class="cs-link" data-url="https://dev.elsevier.com/">Elsevier Developer Portal</button> e clique em <b>“I want an API Key”</b>.</li>
        <li>Entre com uma conta Elsevier (a mesma do ScienceDirect/Scopus). Se não tiver, clique em <b>criar conta</b>: de preferência com o <b>e-mail institucional (@ufsc.br)</b>.</li>
        <li>Clique em <b>“Create API Key”</b>, dê um nome (ex.: <i>Lattes Manager</i>), informe um site qualquer seu (ex.: a página do grupo ou do Lattes), aceite os termos e confirme.</li>
        <li>Copie a chave (32 letras e números) e cole abaixo. Clique em <b>Testar</b>.</li>
      </ol>
      <p>Uso: gratuito para fins não comerciais, até 20.000 consultas por semana (cada revista é uma consulta). A chave fica só neste computador, no arquivo de configuração do app, fora do banco e dos backups.</p>
      <p><b>Importante:</b> chaves novas <b>não trazem dados</b> até a Elsevier reconhecer a instituição assinante do Scopus (a UFSC, pelo Portal de Periódicos da CAPES). Esse reconhecimento é pelo endereço da rede: <b>teste e consulte conectado à rede da UFSC ou pela VPN da UFSC</b>. Fora dela, a Elsevier costuma recusar a chave ou responder “Error encountered while calling the API service”.</p>
      <p>Se mesmo na rede da UFSC o teste falhar ou vier <b>sem percentil</b>, escreva ao suporte de API da Elsevier (“Contact us” no portal) com: a sua chave, o nome completo da instituição (Universidade Federal de Santa Catarina), o uso (“consultar o CiteScore e o percentil das revistas dos meus próprios artigos, uso acadêmico, poucas dezenas de consultas por semana”) e a API: <i>Scopus Serial Title</i>.</p>
    </details>`;
}

export function renderCitescoreTool(view) {
  const st = view.state;
  st.f ||= { q: "", qs: new Set(), sort: "percentil", tipo: "scopus", limit: PAGE };
  hideTip();
  if (!st.data && !st.loading) load(view, st);
  const d = st.data;
  const chave = d?.chave;

  let body = `<div class="ql-wrap cs-wrap">
    <div class="ql-step">
      <div>
        <b>1. Chave da API da Elsevier</b>
        <p>${chave?.configurada ? `✅ Chave configurada (termina em <span class="mono">${escapeHtml(chave.final_chave || "")}</span>).` : "Nenhuma chave configurada ainda."}</p>
        <div class="cs-key">
          <input type="password" id="cs-key" class="form-input" placeholder="${chave?.configurada ? "Colar uma nova chave para trocar" : "Cole aqui a sua API Key"}" autocomplete="off" spellcheck="false" aria-label="Chave da API da Elsevier" />
          <button type="button" class="btn btn-primary btn-sm" id="cs-save">Salvar</button>
          <button type="button" class="btn btn-secondary btn-sm" id="cs-test" ${st.testing ? "disabled" : ""}>${st.testing ? "Testando…" : "Testar"}</button>
          ${chave?.configurada ? `<button type="button" class="btn btn-secondary btn-sm" id="cs-del">Remover</button>` : ""}
        </div>
        ${st.teste ? `<p class="cs-test ${st.teste.ok ? (st.teste.sem_percentil ? "warn" : "ok") : "bad"}">${st.teste.ok ? (st.teste.sem_percentil ? "⚠️" : "✅") : "❌"} ${escapeHtml(st.teste.mensagem)}</p>` : ""}
        ${chave?.configurada && !st.showGuide ? `<button type="button" class="cs-link" id="cs-guide">Como obter a chave</button>` : guiaChave()}
      </div>
    </div>`;

  if (!d) {
    body += `<div class="loading-state" style="display:flex; flex-direction:column; gap:12px; padding:32px 0;"><div class="spinner"></div><div>Carregando…</div></div></div>`;
    return finish(view, st, body);
  }

  const semIssn = d.artigos.filter((a) => !a.issn).length;
  const prog = st.prog;
  body += `
    <div class="ql-step">
      <div>
        <b>2. Consultar as revistas dos seus artigos</b>
        <p>O app consulta o CiteScore de cada revista pelo ISSN e guarda só o <b>ano corrente do CiteScore</b> (consultar de novo substitui). ${fmt(d.revistas.length)} revista(s) já consultada(s); <b>${fmt(d.pendentes)}</b> ainda não.${semIssn ? ` ${fmt(semIssn)} artigo(s) estão sem ISSN e não entram.` : ""}</p>
        ${prog ? `<div class="cs-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${prog.total}" aria-valuenow="${prog.done}"><div style="width:${prog.total ? (prog.done / prog.total) * 100 : 0}%"></div></div><p class="pd-meta" id="cs-prog-txt">${progText(prog)}</p>` : ""}
      </div>
      <div class="ql-actions">
        <button type="button" class="btn btn-primary btn-sm" id="cs-fetch" ${!chave?.configurada || st.busy || !d.pendentes ? "disabled" : ""}>${st.busy ? "Consultando…" : `🔎 Consultar novas (${fmt(d.pendentes)})`}</button>
        <button type="button" class="btn btn-secondary btn-sm" id="cs-fetch-all" ${!chave?.configurada || st.busy || !d.revistas.length ? "disabled" : ""} title="Consulta de novo todas as revistas (atualiza para o CiteScore mais recente)">🔄 Atualizar todas</button>
        ${semIssn ? `<button type="button" class="btn btn-secondary btn-sm" id="cs-issn" ${st.busy ? "disabled" : ""}>Buscar ISSN pela OpenAlex</button>` : ""}
      </div>
    </div>`;

  if (d.revistas.length) body += renderResultados(st, d);
  body += `</div>`;
  finish(view, st, body);
}

function renderResultados(st, d) {
  const porIssn = new Map(d.revistas.map((r) => [r.issn, r]));
  const scopus = d.revistas.filter((r) => r.status === "ok");
  const artigos = d.artigos.map((a) => ({ ...a, rev: a.issn ? porIssn.get(a.issn) : null }));
  const comCs = artigos.filter((a) => a.rev?.status === "ok" && a.rev.citescore != null);
  const comPct = comCs.filter((a) => a.rev.percentil != null);
  const pcts = comPct.map((a) => a.rev.percentil).sort((a, b) => a - b);
  const mediana = pcts.length ? pcts[Math.floor((pcts.length - 1) / 2)] : null;
  const porQ = Object.fromEntries(QS.map((q) => [q, comPct.filter((a) => quartil(a.rev.percentil) === q).length]));
  const foraScopus = artigos.filter((a) => a.rev?.status === "nao_encontrada").length;
  const naoConsultados = artigos.filter((a) => !a.rev).length;
  const ano = scopus.map((r) => r.ano).filter(Boolean).sort().pop();
  const semPercentil = scopus.length && !scopus.some((r) => r.percentil != null);

  // tabela de revistas
  const f = st.f;
  const q = fold(f.q.trim());
  let rows = f.tipo === "fora" ? d.revistas.filter((r) => r.status !== "ok") : scopus;
  if (f.qs.size) rows = rows.filter((r) => f.qs.has(quartil(r.percentil)));
  if (q) rows = rows.filter((r) => fold(r.titulo).includes(q) || r.issn.includes(f.q.trim()) || fold(r.area).includes(q));
  const sorters = {
    percentil: (a, b) => (b.percentil ?? -1) - (a.percentil ?? -1) || (b.citescore ?? 0) - (a.citescore ?? 0),
    citescore: (a, b) => (b.citescore ?? -1) - (a.citescore ?? -1),
    artigos: (a, b) => b.artigos - a.artigos || (b.percentil ?? -1) - (a.percentil ?? -1),
    nome: (a, b) => String(a.titulo || a.issn).localeCompare(String(b.titulo || b.issn), "pt-BR"),
  };
  rows = [...rows].sort(sorters[f.sort] || sorters.percentil);
  const shown = rows.slice(0, f.limit);
  const artigosDe = (issn) => artigos.filter((a) => a.issn === issn).sort((x, y) => (y.ano ?? 0) - (x.ano ?? 0));

  return `
    ${semPercentil ? `<p class="cs-test warn">⚠️ A sua chave trouxe o CiteScore, mas não os percentis (a Elsevier não liberou a visão completa). Veja as orientações no passo 1.</p>` : ""}
    <div class="ql-tiles bb-tiles">
      <div class="pd-tile good"><b>${fmt(scopus.length)}</b><span>revistas no Scopus</span><small class="bb-tile-x">de ${fmt(d.revistas.length)} consultadas</small></div>
      <div class="pd-tile good"><b>${fmt(comCs.length)}</b><span>artigos com CiteScore</span><small class="bb-tile-x">de ${fmt(artigos.length)} artigos</small></div>
      <div class="pd-tile good"><b>${pct(porQ.Q1, comPct.length)}</b><span>dos artigos em Q1</span><small class="bb-tile-x">${fmt(porQ.Q1)} artigo(s), percentil ≥ 75</small></div>
      <div class="pd-tile good"><b>${mediana ?? "—"}</b><span>percentil mediano</span><small class="bb-tile-x">melhor área de cada revista</small></div>
    </div>
    <div class="bb-grid2">
      <div class="card"><div class="card-h"><h3>Meus artigos por quartil</h3><span>CiteScore ${ano || ""}, melhor área da revista</span></div>
        ${donut([
          ...QS.map((qq) => ({ label: qq, value: porQ[qq], color: qColor(qq) })),
          { label: "Fora do Scopus", value: foraScopus, color: "var(--bb-other)" },
          { label: "Não consultados / sem ISSN", value: naoConsultados, color: "var(--surface-3, #e5e7eb)" },
        ], fmt(artigos.length), "artigos")}
      </div>
      <div class="card"><div class="card-h"><h3>Artigos por faixa de percentil</h3><span>0 = pior, 99 = melhor da área</span></div>${decis(pcts)}</div>
    </div>
    <div class="card">
      <div class="card-h"><h3>Revistas</h3><span>clique no CiteScore para abrir a revista no Scopus</span></div>
      <div class="pd-toolbar bb-bar">
        <div class="pd-search"><input type="search" id="cs-q" class="form-input" placeholder="Buscar revista, ISSN ou área…" value="${escapeHtml(f.q)}" aria-label="Buscar revista" /></div>
        <div class="pd-toolbar-actions">
          <select id="cs-tipo" class="form-select" aria-label="Quais revistas"><option value="scopus" ${f.tipo === "scopus" ? "selected" : ""}>No Scopus (${fmt(scopus.length)})</option><option value="fora" ${f.tipo === "fora" ? "selected" : ""}>Fora do Scopus (${fmt(d.revistas.length - scopus.length)})</option></select>
          <select id="cs-sort" class="form-select" aria-label="Ordenar"><option value="percentil" ${f.sort === "percentil" ? "selected" : ""}>Maior percentil</option><option value="citescore" ${f.sort === "citescore" ? "selected" : ""}>Maior CiteScore</option><option value="artigos" ${f.sort === "artigos" ? "selected" : ""}>Mais artigos meus</option><option value="nome" ${f.sort === "nome" ? "selected" : ""}>Nome</option></select>
          <button type="button" class="btn btn-secondary btn-sm" id="cs-xlsx">⬇️ Exportar .xlsx</button>
        </div>
      </div>
      ${f.tipo === "scopus" ? `<div class="ql-chips" role="group" aria-label="Filtrar por quartil"><span class="ql-chips-l">Quartil:</span>${QS.map((qq) => `<button type="button" class="ql-chip ${f.qs.has(qq) ? "on" : ""}" data-q="${qq}" aria-pressed="${f.qs.has(qq)}"><i style="background:${qColor(qq)}"></i>${qq}</button>`).join("")}</div>` : ""}
      ${shown.length ? `<div class="tl-table"><table class="data-table pd-table cs-table">
        <thead><tr><th>Revista</th><th>Melhor área</th><th>Percentil</th><th>CiteScore</th><th>SJR</th><th>SNIP</th><th title="Seus artigos nesta revista">Artigos</th></tr></thead>
        <tbody>${shown.map((r) => {
          const open = st.open === r.issn;
          const best = r.areas?.[0];
          return `<tr class="${open ? "open" : ""}">
            <td><button type="button" class="bb-name" data-open="${escapeHtml(r.issn)}" aria-expanded="${open}">${escapeHtml(r.titulo || "(fora do Scopus)")}</button><div class="pd-meta mono">${escapeHtml(r.issn)}${r.editora ? ` · ${escapeHtml(r.editora)}` : ""}</div></td>
            <td>${escapeHtml(r.area || "—")}${best?.posicao ? `<div class="pd-meta">posição ${fmt(best.posicao)}</div>` : ""}</td>
            <td>${qBadge(r.percentil)}</td>
            <td class="ql-n">${r.citescore != null && r.url ? `<button type="button" class="cs-link mono" data-url="${escapeHtml(r.url)}" title="Abrir no Scopus">${fmt1(r.citescore)}</button><div class="pd-meta">${r.ano ?? ""}</div>` : "—"}</td>
            <td class="ql-n mono">${fmt3(r.sjr)}</td>
            <td class="ql-n mono">${fmt3(r.snip)}</td>
            <td class="ql-n"><b>${fmt(r.artigos)}</b></td>
          </tr>${open ? `<tr class="bb-detail"><td colspan="7">
            ${r.areas?.length ? `<div class="pd-meta">Todas as áreas: ${r.areas.map((a) => `${escapeHtml(a.area)} ${qBadge(a.percentil)}${a.posicao ? ` (posição ${fmt(a.posicao)})` : ""}`).join(" · ")}</div>` : ""}
            <ul class="bb-prods">${artigosDe(r.issn).map((a) => `<li><span class="mono">${a.ano ?? "s/ano"}</span> ${escapeHtml(a.titulo)}</li>`).join("")}</ul>
            ${r.consultado_em ? `<div class="pd-meta">Consultado em ${escapeHtml(r.consultado_em)}</div>` : ""}
          </td></tr>` : ""}`;
        }).join("")}</tbody></table></div>
        ${rows.length > shown.length ? `<div class="pd-more"><button type="button" class="btn btn-secondary btn-sm" id="cs-more">Mostrar mais</button> <span>Mostrando ${fmt(shown.length)} de ${fmt(rows.length)}.</span></div>` : ""}`
        : `<p class="pd-empty">Nenhuma revista com estes filtros.</p>`}
    </div>
    <p class="cs-attr">Métricas de periódicos: <b>Powered by Scopus</b> (Elsevier) — CiteScore${ano ? ` ${ano}` : ""}, SJR e SNIP. Cada CiteScore leva à página da revista no Scopus.</p>`;
}

function finish(view, st, body) {
  view.shell("CiteScore e percentil (Scopus)", "CiteScore, percentil e quartil das revistas dos seus artigos, pela API da Elsevier (Scopus).", body);
  const el = view.el;
  const rerender = () => renderCitescoreTool(view);
  attachTip(el);

  el.querySelectorAll("[data-url]").forEach((b) => b.addEventListener("click", () => api.openUrl(b.dataset.url).catch((e) => showToast(`Erro: ${e}`, "error"))));
  el.querySelector("#cs-guide")?.addEventListener("click", () => { st.showGuide = true; rerender(); });
  const keyInput = el.querySelector("#cs-key");
  el.querySelector("#cs-save")?.addEventListener("click", async () => {
    const k = keyInput.value.trim();
    if (!k) return showToast("Cole a chave antes de salvar.", "warning");
    try {
      const s = await api.citescoreSetKey(k);
      if (st.data) st.data.chave = s;
      st.teste = null;
      showToast("Chave salva.", "success");
      rerender();
    } catch (e) {
      showToast(String(e), "error", 7000);
    }
  });
  el.querySelector("#cs-test")?.addEventListener("click", async () => {
    st.testing = true;
    const k = keyInput.value.trim() || null;
    rerender();
    try {
      st.teste = await api.citescoreTestKey(k);
    } catch (e) {
      st.teste = { ok: false, mensagem: String(e) };
    }
    st.testing = false;
    if (view.active === TOOL_ID) rerender();
  });
  el.querySelector("#cs-del")?.addEventListener("click", async () => {
    if (!window.confirm("Remover a chave da Elsevier deste computador? Os CiteScores já consultados continuam no banco.")) return;
    try {
      const s = await api.citescoreSetKey("");
      if (st.data) st.data.chave = s;
      st.teste = null;
      rerender();
    } catch (e) {
      showToast(String(e), "error");
    }
  });

  const fetch = async (todos) => {
    st.busy = true;
    st.prog = { done: 0, total: todos ? st.data.revistas.length + st.data.pendentes : st.data.pendentes, issn: "" };
    rerender();
    const unlisten = await api.onCitescoreProgress((p) => {
      st.prog = p;
      if (view.active !== TOOL_ID) return;
      const prog = view.el.querySelector(".cs-prog");
      if (prog) {
        prog.setAttribute("aria-valuemax", String(p.total));
        prog.setAttribute("aria-valuenow", String(p.done));
        prog.firstElementChild.style.width = `${p.total ? (p.done / p.total) * 100 : 0}%`;
      }
      const txt = view.el.querySelector("#cs-prog-txt");
      if (txt) txt.innerHTML = progText(p);
    });
    try {
      const r = await api.citescoreFetch(todos);
      const msg = `${fmt(r.consultadas)} revista(s) consultada(s): ${fmt(r.encontradas)} no Scopus, ${fmt(r.nao_encontradas)} fora.`;
      if (r.erro) showToast(`${msg} Parou: ${r.erro}`, "warning", 12000);
      else showToast(r.sem_percentil ? `${msg} Atenção: a chave não trouxe os percentis.` : msg, r.sem_percentil ? "warning" : "success", 7000);
    } catch (e) {
      showToast(String(e), "error", 8000);
    } finally {
      unlisten?.();
      st.busy = false;
      st.prog = null;
      st.data = null;
      invalidateMetrics();
      view.onChanged?.();
      load(view, st);
    }
  };
  el.querySelector("#cs-fetch")?.addEventListener("click", () => fetch(false));
  el.querySelector("#cs-fetch-all")?.addEventListener("click", () => {
    if (window.confirm(`Consultar de novo as ${fmt(st.data.revistas.length + st.data.pendentes)} revistas? Cada uma conta uma consulta na cota semanal da Elsevier (20.000).`)) fetch(true);
  });
  el.querySelector("#cs-issn")?.addEventListener("click", async () => {
    st.busy = true;
    rerender();
    try {
      const r = await api.fillIssnOpenalex();
      showToast(r.consultados ? `ISSN encontrado para ${fmt(r.preenchidos)} de ${fmt(r.consultados)} artigo(s) com DOI.` : "Todos os artigos com DOI já têm ISSN.", "success", 6000);
    } catch (e) {
      showToast(`Erro ao consultar a OpenAlex: ${e}`, "error");
    }
    st.busy = false;
    st.data = null;
    load(view, st);
  });

  const f = st.f;
  const q = el.querySelector("#cs-q");
  q?.addEventListener("input", () => {
    f.q = q.value;
    f.limit = PAGE;
    clearTimeout(st.qTimer);
    st.qTimer = setTimeout(() => {
      const pos = f.q.length;
      rerender();
      const again = view.el.querySelector("#cs-q");
      again?.focus();
      again?.setSelectionRange(pos, pos);
    }, 200);
  });
  el.querySelector("#cs-tipo")?.addEventListener("change", (e) => { f.tipo = e.target.value; f.qs.clear(); rerender(); });
  el.querySelector("#cs-sort")?.addEventListener("change", (e) => { f.sort = e.target.value; rerender(); });
  el.querySelector("#cs-more")?.addEventListener("click", () => { f.limit += PAGE; rerender(); });
  el.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.q;
    f.qs.has(k) ? f.qs.delete(k) : f.qs.add(k);
    rerender();
  }));
  el.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => {
    st.open = st.open === b.dataset.open ? null : b.dataset.open;
    rerender();
  }));
  el.querySelector("#cs-xlsx")?.addEventListener("click", () => exportXlsx(st).catch((e) => showToast(`Falha ao exportar: ${e}`, "error")));
}

async function exportXlsx(st) {
  const d = st.data;
  const target = await api.selectSavePath(`CiteScore_${new Date().toISOString().slice(0, 10)}.xlsx`, "xlsx");
  if (!target) return;
  const porIssn = new Map(d.revistas.map((r) => [r.issn, r]));
  const saved = await api.exportXlsx([
    {
      name: "Revistas",
      title: "CiteScore das revistas (Powered by Scopus)",
      columns: ["Revista", "ISSN", "Editora", "Ano do CiteScore", "CiteScore", "Melhor percentil", "Quartil", "Melhor área", "SJR", "SNIP", "Meus artigos", "Scopus", "Todas as áreas"],
      rows: d.revistas.map((r) => [r.titulo || "(fora do Scopus)", r.issn, r.editora || "", r.ano ?? "", r.citescore ?? "", r.percentil ?? "", quartil(r.percentil) || "", r.area || "", r.sjr ?? "", r.snip ?? "", r.artigos, r.url || "", (r.areas || []).map((a) => `${a.area}: ${a.percentil ?? "—"}`).join("; ")]),
    },
    {
      name: "Artigos",
      title: "Meus artigos com o CiteScore da revista",
      columns: ["Título", "Ano", "Revista", "ISSN", "CiteScore", "Percentil", "Quartil", "Área"],
      rows: d.artigos.map((a) => {
        const r = a.issn ? porIssn.get(a.issn) : null;
        return [a.titulo, a.ano ?? "", a.journal || "", a.issn || "", r?.citescore ?? "", r?.percentil ?? "", quartil(r?.percentil) || "", r?.area || ""];
      }),
    },
  ]);
  showToast(`📊 Planilha salva: ${saved.split(/[\\/]/).pop()}`, "success", 4500);
  api.revealInExplorer(saved).catch(() => { });
}
