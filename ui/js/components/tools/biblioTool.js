// Bibliometria e rede de coautoria: autores de todas as produções (do XML do Lattes, gravados
// nas tabelas autores/producao_autores), indicadores de colaboração, ranking de coautores,
// rede de colaboração e exportação (Excel, GraphML para Gephi/VOSviewer, SVG).

import { api } from "../../api.js";
import { escapeHtml, showToast } from "../../utils.js";
import { arc } from "../charts.js";
import { attachTip, hideTip } from "./chartTip.js";
import { buildGraph, layout, renderNetwork, graphml, palette, COMMUNITY_COLORS } from "./biblioNetwork.js";

const TOOL_ID = "bibliometria";
/** Produções com mais autores que isso não geram ligações na rede (hiperautoria). */
const MAX_PAIR = 25;
const PAGE = 200;

const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
const fmt1 = (n) => Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const pct = (n, t) => (t ? `${fmt1((n / t) * 100)}%` : "—");
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tipoDe = (p) => p.tipo || "Sem tipo";

// ---------------- análise ----------------

function analyze(data, f) {
  const byId = new Map(data.autores.map((a) => [a.id, a]));
  const eu = data.autores.find((a) => a.eu) || null;
  const prods = data.producoes.filter((p) => {
    if (f.de != null && (p.ano == null || p.ano < f.de)) return false;
    if (f.ate != null && (p.ano == null || p.ano > f.ate)) return false;
    return !f.tipos.size || f.tipos.has(tipoDe(p));
  });
  const stats = new Map();
  const get = (id) => {
    let s = stats.get(id);
    if (!s) {
      const a = byId.get(id) || { nome: `#${id}`, formas: [] };
      s = { id, nome: a.nome, chave: a.chave, eu: Boolean(a.eu), orientado: a.orientado || null, formas: a.formas || [], n: 0, primeiro: 0, ultimo: 0, anoMin: null, anoMax: null, prods: [], parceiros: new Set() };
      stats.set(id, s);
    }
    return s;
  };
  const pares = new Map();
  const posicao = { primeiro: 0, meio: 0, ultimo: 0, unico: 0 };
  const hist = new Map();
  const porAno = new Map();
  let hiper = 0;
  let somaAutores = 0;
  const tamanhos = [];
  for (const p of prods) {
    const ids = p.autores;
    const k = ids.length;
    somaAutores += k;
    tamanhos.push(k);
    hist.set(Math.min(k, 11), (hist.get(Math.min(k, 11)) || 0) + 1);
    ids.forEach((id, i) => {
      const s = get(id);
      s.n++;
      s.prods.push(p);
      if (i === 0 && k > 1) s.primeiro++;
      if (i === k - 1 && k > 1) s.ultimo++;
      if (p.ano != null) {
        s.anoMin = s.anoMin == null ? p.ano : Math.min(s.anoMin, p.ano);
        s.anoMax = s.anoMax == null ? p.ano : Math.max(s.anoMax, p.ano);
      }
    });
    if (eu) {
      const i = ids.indexOf(eu.id);
      if (i >= 0) {
        if (k === 1) posicao.unico++;
        else if (i === 0) posicao.primeiro++;
        else if (i === k - 1) posicao.ultimo++;
        else posicao.meio++;
      }
    }
    if (p.ano != null) {
      const a = porAno.get(p.ano) || { ano: p.ano, prods: 0, autores: 0, tamanhos: [] };
      a.prods++;
      a.autores += k;
      a.tamanhos.push(k);
      porAno.set(p.ano, a);
    }
    if (k > MAX_PAIR) {
      hiper++;
      continue;
    }
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const a = Math.min(ids[i], ids[j]);
        const b = Math.max(ids[i], ids[j]);
        const key = `${a}|${b}`;
        pares.set(key, (pares.get(key) || 0) + 1);
        get(a).parceiros.add(b);
        get(b).parceiros.add(a);
      }
    }
  }
  const lista = [...stats.values()];
  const coautores = lista.filter((s) => !s.eu);
  const novos = new Map();
  for (const s of coautores) if (s.anoMin != null) novos.set(s.anoMin, (novos.get(s.anoMin) || 0) + 1);
  const anos = [...porAno.keys()].sort((a, b) => a - b);
  const comOrientado = prods.filter((p) => p.autores.some((id) => byId.get(id)?.orientado)).length;
  tamanhos.sort((a, b) => a - b);
  const mediana = tamanhos.length ? tamanhos[Math.floor((tamanhos.length - 1) / 2)] : 0;
  return { eu, prods, lista, coautores, pares, posicao, hist, porAno, anos, novos, hiper, comOrientado, media: prods.length ? somaAutores / prods.length : 0, mediana, byStat: stats };
}

// ---------------- gráficos (SVG) ----------------

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** Barra com o topo arredondado (4px) e base reta na linha zero. */
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function vbars(items, { color = "var(--bb-1)", empty = "Sem dados no período" } = {}) {
  if (!items.length || items.every((i) => !i.value)) return `<div class="chart-empty">${empty}</div>`;
  const Wc = 560, Hc = 220, P = { l: 34, r: 8, t: 12, b: 26 };
  const max = niceMax(Math.max(...items.map((i) => i.value)));
  const iw = (Wc - P.l - P.r) / items.length;
  const bw = Math.max(2, Math.min(36, iw - 2));
  const y = (v) => P.t + (Hc - P.t - P.b) * (1 - v / max);
  let s = "";
  for (let g = 0; g <= 4; g++) {
    const v = (max / 4) * g;
    s += `<line x1="${P.l}" x2="${Wc - P.r}" y1="${y(v)}" y2="${y(v)}" class="bb-grid"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${fmt1(v)}</text>`;
  }
  const step = Math.ceil(items.length / 14);
  items.forEach((it, i) => {
    const x = P.l + iw * i + (iw - bw) / 2;
    const top = y(it.value);
    s += `<path d="${barPath(x, top, bw, Hc - P.b - top)}" fill="${it.color || color}"/>`;
    s += `<rect x="${P.l + iw * i}" y="${P.t}" width="${iw}" height="${Hc - P.t - P.b}" fill="transparent" class="bb-hit" data-tip="${escapeHtml(it.tip)}"/>`;
    if (i % step === 0) s += `<text x="${x + bw / 2}" y="${Hc - 8}" text-anchor="middle" class="ax">${escapeHtml(String(it.label))}</text>`;
  });
  return `<svg viewBox="0 0 ${Wc} ${Hc}" class="svg bb-chart" role="img">${s}</svg>`;
}

function donut(parts, centro, unidade) {
  const tot = parts.reduce((a, p) => a + p.value, 0);
  if (!tot) return `<div class="chart-empty">Sem dados no período</div>`;
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

function hbars(items) {
  if (!items.length) return `<div class="chart-empty">Sem coautores no período</div>`;
  const max = Math.max(...items.map((i) => i.value));
  return `<div class="hbars">${items
    .map((it, i) => `<div class="hbar wide bb-hbar" data-autor="${it.id}" data-tip="${escapeHtml(it.tip)}">
        <span class="hb-l">${escapeHtml(it.label)}</span><div class="hb-track"><div class="hb-fill" style="--w:${(it.value / max) * 100}%;--d:${i * 30}ms;background:${it.color}"></div></div><b>${fmt(it.value)}</b></div>`)
    .join("")}</div>`;
}

/** Mapa de calor: principais coautores × anos (uma cor, mais escura = mais produções). */
function heatmap(rows, anos) {
  if (!rows.length || !anos.length) return `<div class="chart-empty">Sem dados no período</div>`;
  const L = 170, T = 4, cw = Math.max(14, Math.min(34, 620 / anos.length)), ch = 22;
  const Wc = L + cw * anos.length + 4, Hc = T + ch * rows.length + 22;
  const max = Math.max(1, ...rows.flatMap((r) => anos.map((a) => r.porAno.get(a) || 0)));
  let s = "";
  rows.forEach((r, i) => {
    const nome = r.nome.length > 26 ? `${r.nome.slice(0, 25)}…` : r.nome;
    s += `<text x="${L - 8}" y="${T + ch * i + ch / 2 + 4}" text-anchor="end" class="ax bb-hm-l">${escapeHtml(nome)}</text>`;
    anos.forEach((a, j) => {
      const v = r.porAno.get(a) || 0;
      const op = v ? 0.18 + 0.82 * (v / max) : 0;
      s += `<rect x="${L + cw * j + 1}" y="${T + ch * i + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="${v ? "var(--bb-1)" : "var(--surface-3, rgba(127,127,127,.12))"}" fill-opacity="${v ? op.toFixed(2) : 1}" data-tip="<b>${escapeHtml(r.nome)}</b><br>${a}: ${fmt(v)} produção(ões)"/>`;
    });
  });
  const step = Math.ceil(anos.length / 16);
  anos.forEach((a, j) => {
    if (j % step === 0) s += `<text x="${L + cw * j + cw / 2}" y="${Hc - 6}" text-anchor="middle" class="ax">${anos.length > 12 ? `'${String(a).slice(-2)}` : a}</text>`;
  });
  return `<div class="bb-hm-wrap"><svg viewBox="0 0 ${Wc} ${Hc}" class="svg bb-chart bb-hm" style="max-width:${Wc}px" role="img">${s}</svg></div>`;
}

// ---------------- abas ----------------

function tile(v, label, extra = "") {
  return `<div class="pd-tile good"><b>${v}</b><span>${label}</span>${extra ? `<small class="bb-tile-x">${extra}</small>` : ""}</div>`;
}

function card(title, sub, body, cls = "") {
  return `<div class="card ${cls}"><div class="card-h"><h3>${escapeHtml(title)}</h3>${sub ? `<span>${escapeHtml(sub)}</span>` : ""}</div>${body}</div>`;
}

function renderVisao(an) {
  const n = an.prods.length;
  const co = an.coautores.length;
  const pos = an.posicao;
  const comEu = pos.primeiro + pos.meio + pos.ultimo + pos.unico;
  const emCoautoria = an.prods.filter((p) => p.autores.length > 1).length;
  const orientados = an.coautores.filter((s) => s.orientado).length;
  const anos = an.anos;
  const mediaAno = anos.map((a) => {
    const r = an.porAno.get(a);
    return { label: a, value: r.autores / r.prods, tip: `<b>${a}</b><br>${fmt1(r.autores / r.prods)} autores por produção<br>${fmt(r.prods)} produção(ões)` };
  });
  let acum = 0;
  const novos = anos.map((a) => {
    const v = an.novos.get(a) || 0;
    acum += v;
    return { label: a, value: v, tip: `<b>${a}</b><br>${fmt(v)} novo(s) coautor(es)<br>${fmt(acum)} no total até ${a}` };
  });
  const hist = [];
  for (let k = 1; k <= 11; k++) {
    const v = an.hist.get(k) || 0;
    hist.push({ label: k === 11 ? "11+" : k, value: v, tip: `<b>${k === 11 ? "11 ou mais" : k} autor${k === 1 ? "" : "es"}</b><br>${fmt(v)} produção(ões) · ${pct(v, n)}` });
  }
  const top = [...an.coautores].sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR")).slice(0, 15);
  const topItems = top.map((s) => ({
    id: s.id,
    label: s.nome,
    value: s.n,
    color: s.orientado ? "var(--bb-2)" : "var(--bb-1)",
    tip: `<b>${escapeHtml(s.nome)}</b><br>${fmt(s.n)} produção(ões) juntos${s.anoMin != null ? `<br>${s.anoMin === s.anoMax ? s.anoMin : `${s.anoMin}–${s.anoMax}`}` : ""}${s.orientado ? `<br>🎓 ${escapeHtml(s.orientado.niveis.join(", "))}` : ""}<br><small>Clique para ver as produções</small>`,
  }));
  const heatRows = top.slice(0, 10).map((s) => {
    const m = new Map();
    for (const p of s.prods) if (p.ano != null) m.set(p.ano, (m.get(p.ano) || 0) + 1);
    return { nome: s.nome, porAno: m };
  });
  const anosHeat = anos.length ? Array.from({ length: anos[anos.length - 1] - anos[0] + 1 }, (_, i) => anos[0] + i) : [];

  return `
    <div class="ql-tiles bb-tiles">
      ${tile(fmt(n), "produções analisadas", an.hiper ? `${fmt(an.hiper)} com mais de ${MAX_PAIR} autores fora da rede` : "")}
      ${tile(fmt(co), "coautores distintos")}
      ${tile(fmt1(an.media), "autores por produção (média)", `mediana ${fmt(an.mediana)}`)}
      ${tile(pct(emCoautoria, n), "em coautoria")}
      ${tile(pct(pos.primeiro, comEu), "como primeiro autor", `${fmt(pos.primeiro)} produção(ões)`)}
      ${tile(pct(pos.ultimo, comEu), "como último autor", `${fmt(pos.ultimo)} produção(ões)`)}
      ${tile(fmt(orientados), "coautores que são orientados", `${pct(an.comOrientado, n)} das produções`)}
    </div>
    <div class="bb-grid2">
      ${card("Autores por produção", "média por ano", vbars(mediaAno))}
      ${card("Novos coautores por ano", "primeira produção em conjunto", vbars(novos))}
      ${card("Sua posição na autoria", "produções em que você é autor", donut([
        { label: "Primeiro autor", value: pos.primeiro, color: "var(--bb-1)" },
        { label: "Intermediário", value: pos.meio, color: "var(--bb-2)" },
        { label: "Último autor", value: pos.ultimo, color: "var(--bb-3)" },
        { label: "Autor único", value: pos.unico, color: "var(--bb-4)" },
      ], fmt(comEu), "produções"))}
      ${card("Número de autores por produção", "distribuição", vbars(hist))}
    </div>
    ${card("Principais coautores", "produções em conjunto", `
      <div class="legend legend-row bb-key"><div class="lg"><i style="background:var(--bb-1)"></i><span>Coautor</span></div><div class="lg"><i style="background:var(--bb-2)"></i><span>Orientado (aluno)</span></div></div>
      ${hbars(topItems)}`)}
    ${card("Colaboração ao longo do tempo", "10 principais coautores × ano (mais escuro = mais produções)", heatmap(heatRows, anosHeat))}`;
}

function renderCoautores(st, an) {
  const c = st.co;
  const q = fold(c.q.trim());
  let rows = an.lista.filter((s) => !s.eu || c.eu);
  if (c.tipo === "orientados") rows = rows.filter((s) => s.orientado);
  else if (c.tipo === "externos") rows = rows.filter((s) => !s.orientado && !s.eu);
  if (q) rows = rows.filter((s) => fold(s.nome).includes(q) || s.formas.some((f) => fold(f).includes(q)));
  const sorters = {
    n: (a, b) => b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR"),
    nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
    recente: (a, b) => (b.anoMax ?? 0) - (a.anoMax ?? 0) || b.n - a.n,
    primeiro: (a, b) => b.primeiro - a.primeiro || b.n - a.n,
    parceiros: (a, b) => b.parceiros.size - a.parceiros.size || b.n - a.n,
  };
  rows.sort(sorters[c.sort] || sorters.n);
  const shown = rows.slice(0, c.limit);
  const sel = st.sel;
  const mesclas = st.data.mesclas || [];

  return `
    <div class="pd-toolbar bb-bar">
      <div class="pd-search"><input type="search" id="bb-q" class="form-input" placeholder="Buscar autor (qualquer forma do nome)…" value="${escapeHtml(c.q)}" aria-label="Buscar autor" /></div>
      <div class="pd-toolbar-actions">
        <select id="bb-co-tipo" class="form-select" aria-label="Quem mostrar">
          <option value="todos" ${c.tipo === "todos" ? "selected" : ""}>Todos os coautores</option>
          <option value="orientados" ${c.tipo === "orientados" ? "selected" : ""}>Só orientados</option>
          <option value="externos" ${c.tipo === "externos" ? "selected" : ""}>Só não orientados</option>
        </select>
        <select id="bb-co-sort" class="form-select" aria-label="Ordenar">
          <option value="n" ${c.sort === "n" ? "selected" : ""}>Mais produções juntos</option>
          <option value="recente" ${c.sort === "recente" ? "selected" : ""}>Colaboração mais recente</option>
          <option value="primeiro" ${c.sort === "primeiro" ? "selected" : ""}>Mais vezes primeiro autor</option>
          <option value="parceiros" ${c.sort === "parceiros" ? "selected" : ""}>Mais coautores próprios</option>
          <option value="nome" ${c.sort === "nome" ? "selected" : ""}>Nome</option>
        </select>
        <button type="button" class="btn btn-primary btn-sm" id="bb-merge" ${sel.size >= 2 ? "" : "disabled"} title="Marque dois ou mais nomes que são a mesma pessoa">🔗 Mesclar ${sel.size >= 2 ? fmt(sel.size) : ""}</button>
      </div>
    </div>
    <p class="ql-note">Nomes diferentes da mesma pessoa ("SILVA, J. A." e "João Alberto Silva") são juntados automaticamente pelo sobrenome, prenomes e ID Lattes. Se sobrar alguma duplicata, marque os nomes e clique em <b>Mesclar</b>; a mescla fica gravada no banco.</p>
    ${mesclas.length ? `<details class="bb-mesclas"><summary>${fmt(mesclas.length)} mescla(s) manual(is)</summary><ul>${mesclas.map((m) => `<li>${escapeHtml(m.nome)} → <b>${escapeHtml(m.nome_destino)}</b> <button type="button" class="btn btn-secondary btn-sm" data-unmerge="${escapeHtml(m.chave)}">Desfazer</button></li>`).join("")}</ul></details>` : ""}
    <div class="ql-cat-count">${fmt(rows.length)} autor(es)</div>
    ${shown.length ? `<div class="tl-table"><table class="data-table pd-table bb-table">
      <thead><tr><th aria-label="Selecionar"></th><th>Autor</th><th title="Produções em conjunto no período">Produções</th><th>Período</th><th title="Vezes como primeiro autor">1º autor</th><th title="Coautores dessa pessoa nas suas produções">Coautores</th></tr></thead>
      <tbody>${shown.map((s) => {
        const open = st.open === s.id;
        const badges = [
          s.eu ? `<span class="bb-badge me">você</span>` : "",
          s.orientado ? `<span class="bb-badge or" title="${escapeHtml(`${s.orientado.aluno} — ${s.orientado.niveis.join(", ")}${s.orientado.confianca === "media" ? " (nome parecido: confira)" : ""}`)}">🎓 ${escapeHtml(s.orientado.niveis[0] || "orientado")}${s.orientado.confianca === "media" ? "?" : ""}</span>` : "",
          s.formas.length > 1 ? `<span class="bb-badge" title="${escapeHtml(s.formas.join("\n"))}">${s.formas.length} formas</span>` : "",
        ].join("");
        const prods = open ? [...s.prods].sort((a, b) => (b.ano ?? 0) - (a.ano ?? 0)) : [];
        return `<tr class="${open ? "open" : ""}">
          <td>${s.eu ? "" : `<input type="checkbox" data-sel="${s.id}" ${sel.has(s.id) ? "checked" : ""} aria-label="Selecionar ${escapeHtml(s.nome)}" />`}</td>
          <td><button type="button" class="bb-name" data-open="${s.id}" aria-expanded="${open}">${escapeHtml(s.nome)}</button> ${badges}</td>
          <td class="ql-n"><b>${fmt(s.n)}</b></td>
          <td class="mono">${s.anoMin == null ? "—" : s.anoMin === s.anoMax ? s.anoMin : `${s.anoMin}–${s.anoMax}`}</td>
          <td class="ql-n">${fmt(s.primeiro)}</td>
          <td class="ql-n">${fmt(Math.max(0, s.parceiros.size - (an.eu && s.parceiros.has(an.eu.id) ? 1 : 0)))}</td>
        </tr>${open ? `<tr class="bb-detail"><td></td><td colspan="5">
          ${s.formas.length ? `<div class="pd-meta">Formas do nome: ${s.formas.map((f) => `<span class="mono">${escapeHtml(f)}</span>`).join(" · ")}</div>` : ""}
          <ul class="bb-prods">${prods.map((p) => `<li><span class="mono">${p.ano ?? "s/ano"}</span> <span class="bb-tipo">${escapeHtml(tipoDe(p))}</span> ${escapeHtml(p.titulo)}${p.journal ? ` <i>— ${escapeHtml(p.journal)}</i>` : ""}</li>`).join("")}</ul>
        </td></tr>` : ""}`;
      }).join("")}</tbody></table></div>
      ${rows.length > shown.length ? `<div class="pd-more"><button type="button" class="btn btn-secondary btn-sm" id="bb-more">Mostrar mais</button> <span>Mostrando ${fmt(shown.length)} de ${fmt(rows.length)}.</span></div>` : ""}`
      : `<p class="pd-empty">Nenhum autor com estes filtros.</p>`}`;
}

function renderRedeShell(st, g) {
  const o = st.net;
  const pal = palette();
  const sel = st.netSel != null ? g.nodes.find((n) => n.id === st.netSel) : null;
  let lateral;
  if (sel) {
    const s = st.an.byStat.get(sel.id);
    const viz = g.links
      .filter((l) => l.s === sel.id || l.t === sel.id)
      .map((l) => ({ n: g.nodes.find((x) => x.id === (l.s === sel.id ? l.t : l.s)), w: l.w }))
      .sort((a, b) => b.w - a.w);
    lateral = `
      <div class="bb-side-h"><b>${escapeHtml(sel.nome)}</b><button type="button" class="btn btn-secondary btn-sm" id="bb-net-close" aria-label="Fechar">✕</button></div>
      <div class="pd-meta">${fmt(sel.n)} produção(ões) no período${sel.orientado ? ` · 🎓 ${escapeHtml(sel.orientado.niveis.join(", "))}` : ""}${sel.com >= 0 ? ` · grupo ${sel.com + 1}` : ""}</div>
      <h4>Coautores na rede</h4>
      <ul class="bb-side-list">${viz.slice(0, 25).map((v) => `<li><button type="button" class="bb-name" data-net="${v.n.id}">${escapeHtml(v.n.nome)}</button><b>${fmt(v.w)}</b></li>`).join("") || "<li>Nenhum</li>"}</ul>
      <h4>Produções</h4>
      <ul class="bb-side-list prods">${(s?.prods || []).slice().sort((a, b) => (b.ano ?? 0) - (a.ano ?? 0)).slice(0, 30).map((p) => `<li><span class="mono">${p.ano ?? "—"}</span> ${escapeHtml(p.titulo)}</li>`).join("")}</ul>`;
  } else {
    const legenda = o.cor === "orientados"
      ? `<div class="lg"><i style="background:${pal.cat[0]}"></i><span>Coautor</span></div><div class="lg"><i style="background:${pal.cat[1]}"></i><span>Orientado</span></div>${o.ego ? `<div class="lg"><i style="background:${pal.ego}"></i><span>Você</span></div>` : ""}`
      : `${g.comunidades.slice(0, COMMUNITY_COLORS).map((c, i) => `<button type="button" class="lg bb-com ${st.netFocus === i ? "on" : ""}" data-com="${i}"><i style="background:${pal.cat[i]}"></i><span>Grupo ${i + 1}: ${escapeHtml(c.hub)} e mais ${fmt(c.size - 1)}</span></button>`).join("")}
         ${g.comunidades.length > COMMUNITY_COLORS ? `<div class="lg"><i style="background:${pal.other}"></i><span>Demais grupos (${fmt(g.comunidades.length - COMMUNITY_COLORS)}) e autores soltos</span></div>` : ""}
         ${o.ego ? `<div class="lg"><i style="background:${pal.ego}"></i><span>Você</span></div>` : ""}`;
    lateral = `
      <div class="bb-side-h"><b>Como ler</b></div>
      <p>Cada círculo é um autor (tamanho = produções no período); cada linha liga dois autores que publicaram juntos (espessura = número de produções em conjunto).</p>
      <div class="legend bb-legend-net">${legenda}</div>
      <p class="pd-meta">${o.cor === "comunidade" ? "Grupos: autores que publicam mais entre si (detecção automática). Clique num grupo para destacá-lo. " : ""}Passe o mouse para ver os vizinhos, clique para ver detalhes, arraste para mover, use a roda do mouse para zoom e duplo clique para voltar.</p>
      ${!o.ego && g.ocultos ? `<p class="pd-meta">${fmt(g.ocultos)} coautor(es) que só publicaram com você não aparecem sem você na rede.</p>` : ""}`;
  }
  return `
    <div class="bb-net-bar">
      <label class="ql-check"><input type="checkbox" id="bb-ego" ${o.ego ? "checked" : ""}/> Incluir você</label>
      <label class="bb-ctl">Ligação mínima <select id="bb-minw" class="form-select">${[1, 2, 3, 5].map((v) => `<option value="${v}" ${o.minW === v ? "selected" : ""}>${v} produção${v > 1 ? "ões" : ""}</option>`).join("")}</select></label>
      <label class="bb-ctl">Autores <select id="bb-nautores" class="form-select">${[[50, "50 principais"], [100, "100 principais"], [200, "200 principais"], [0, "Todos"]].map(([v, l]) => `<option value="${v}" ${o.max === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="bb-ctl">Cor <select id="bb-cor" class="form-select"><option value="comunidade" ${o.cor === "comunidade" ? "selected" : ""}>Grupos</option><option value="orientados" ${o.cor === "orientados" ? "selected" : ""}>Orientados</option></select></label>
      <label class="bb-ctl">Nomes <select id="bb-rot" class="form-select"><option value="principais" ${o.rotulos === "principais" ? "selected" : ""}>Principais</option><option value="todos" ${o.rotulos === "todos" ? "selected" : ""}>Todos</option><option value="nenhum" ${o.rotulos === "nenhum" ? "selected" : ""}>Nenhum</option></select></label>
      <span class="bb-net-sp"></span>
      <button type="button" class="btn btn-secondary btn-sm" id="bb-relayout" title="Sorteia outra disposição">🔀 Reorganizar</button>
    </div>
    <div class="pd-meta bb-net-info">${fmt(g.nodes.length)} autores · ${fmt(g.links.length)} ligações${g.comunidades.length ? ` · ${fmt(g.comunidades.length)} grupos` : ""}</div>
    <div class="bb-net-wrap ${st.netMax ? "max" : ""}">
      <div class="bb-net-stage">
        <div class="bb-net-host" id="bb-net"></div>
        <div class="bb-net-ctl" role="toolbar" aria-label="Zoom da rede">
          <button type="button" class="btn btn-secondary btn-sm" id="bb-zoom-in" title="Aproximar (ou roda do mouse)" aria-label="Aproximar">＋</button>
          <button type="button" class="btn btn-secondary btn-sm" id="bb-zoom-out" title="Afastar" aria-label="Afastar">－</button>
          <button type="button" class="btn btn-secondary btn-sm" id="bb-fit" title="Enquadrar a rede inteira (ou duplo clique)" aria-label="Enquadrar">⤢</button>
          <button type="button" class="btn btn-secondary btn-sm" id="bb-fs" title="${st.netMax ? "Sair da tela cheia (Esc)" : "Tela cheia"}" aria-label="${st.netMax ? "Sair da tela cheia" : "Tela cheia"}" aria-pressed="${Boolean(st.netMax)}">${st.netMax ? "🗗" : "⛶"}</button>
        </div>
        ${st.netMax ? `<div class="bb-net-cap">${fmt(g.nodes.length)} autores · ${fmt(g.links.length)} ligações · Esc para sair</div>` : ""}
      </div>
      <aside class="bb-side">${lateral}</aside>
    </div>
    <div class="bb-net-exp">
      <button type="button" class="btn btn-secondary btn-sm" id="bb-exp-svg">🖼️ Imagem (SVG)</button>
      <button type="button" class="btn btn-secondary btn-sm" id="bb-exp-graphml">🕸️ GraphML (Gephi, Cytoscape, VOSviewer)</button>
    </div>`;
}

// ---------------- exportação ----------------

async function saveText(text, name, kind) {
  const target = await api.selectSavePath(name, kind);
  if (!target) return;
  const saved = await api.writeReport(new TextEncoder().encode(text));
  showToast(`Arquivo salvo: ${saved.split(/[\\/]/).pop()}`, "success", 4500);
  api.revealInExplorer(saved).catch(() => { });
}

async function exportXlsx(st, an) {
  const target = await api.selectSavePath(`Bibliometria_${new Date().toISOString().slice(0, 10)}.xlsx`, "xlsx");
  if (!target) return;
  const byId = new Map(st.data.autores.map((a) => [a.id, a]));
  const autores = [...an.lista].sort((a, b) => b.n - a.n);
  const pares = [...an.pares].map(([k, w]) => {
    const [a, b] = k.split("|").map(Number);
    return [byId.get(a)?.nome || a, byId.get(b)?.nome || b, w];
  }).sort((x, y) => y[2] - x[2]);
  const autoria = [];
  for (const p of an.prods) p.autores.forEach((id, i) => autoria.push([p.id, p.ano ?? "", tipoDe(p), p.titulo, i + 1, byId.get(id)?.nome || id]));
  const saved = await api.exportXlsx([
    { name: "Autores", title: "Autores das produções", columns: ["Autor", "Produções", "Primeiro ano", "Último ano", "1º autor", "Último autor", "Coautores", "Orientado", "Formas do nome"], rows: autores.map((s) => [s.nome + (s.eu ? " (você)" : ""), s.n, s.anoMin ?? "", s.anoMax ?? "", s.primeiro, s.ultimo, s.parceiros.size, s.orientado ? s.orientado.niveis.join("; ") : "", s.formas.join("; ")]) },
    { name: "Coautorias", title: "Pares de coautores (lista de arestas para Gephi/VOSviewer)", columns: ["Autor A", "Autor B", "Produções em conjunto"], rows: pares },
    { name: "Autoria", title: "Autores de cada produção, na ordem de autoria", columns: ["ID da produção", "Ano", "Tipo", "Título", "Ordem", "Autor"], rows: autoria },
  ]);
  showToast(`📊 Planilha salva: ${saved.split(/[\\/]/).pop()}`, "success", 4500);
  api.revealInExplorer(saved).catch(() => { });
}

// ---------------- tela cheia ----------------

function tauriWindow() {
  try {
    return window.__TAURI__?.window?.getCurrentWindow?.() || null;
  } catch {
    return null;
  }
}

/** Põe a janela do app (ou, no navegador, a página) em tela cheia. */
async function setWindowFullscreen(on) {
  try {
    const w = tauriWindow();
    if (w) return await w.setFullscreen(on);
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    else if (!on && document.fullscreenElement) await document.exitFullscreen?.();
  } catch (e) {
    console.warn("Tela cheia indisponível:", e);
  }
}

// ---------------- tela ----------------

async function load(view, st) {
  st.loading = true;
  try {
    st.data = await api.biblioData();
    st.an = null;
  } catch (e) {
    showToast(`Não foi possível carregar os autores: ${e}`, "error", 7000);
  } finally {
    st.loading = false;
  }
  if (view.active === TOOL_ID) renderBiblioTool(view);
}

export function renderBiblioTool(view) {
  const st = view.state;
  st.tab ??= "visao";
  st.f ||= { de: null, ate: null, tipos: new Set() };
  st.co ||= { q: "", tipo: "todos", sort: "n", limit: PAGE, eu: false };
  st.net ||= { ego: false, minW: 1, max: 100, cor: "comunidade", rotulos: "principais", seed: 7 };
  st.sel ||= new Set();
  hideTip();
  // a rede em tela cheia fica no <body>: some antes de redesenhar
  document.querySelectorAll("body > .bb-net-wrap").forEach((e) => e.remove());
  if (!st.netMax) document.body.classList.remove("bb-max-open");

  if (!st.data && !st.loading) load(view, st);
  const d = st.data;

  const temAutores = d && d.producoes.length;
  let body = `
    <div class="ql-wrap bb-wrap">
      <div class="ql-step">
        <div>
          <b>Autores das produções</b>
          <p>Lê os autores de todas as produções (artigos, livros, capítulos, trabalhos em eventos…) no XML do Lattes, grava no banco de Produções e identifica cada pessoa, juntando as variações do nome.</p>
          ${d ? `<div class="ql-file">${temAutores ? "✅" : "⚠️"} <b>${fmt(d.producoes.length)}</b> de ${fmt(d.total_producoes)} produções com autores · <b>${fmt(d.autores.length)}</b> autores identificados</div>` : ""}
        </div>
        <div class="ql-actions">
          <button type="button" class="btn btn-primary btn-sm" id="bb-import" ${st.importing ? "disabled" : ""}>${st.importing ? "Importando…" : "📥 Importar autores do XML"}</button>
          ${temAutores ? `<button type="button" class="btn btn-secondary btn-sm" id="bb-xlsx">⬇️ Exportar .xlsx</button>` : ""}
        </div>
      </div>`;

  if (!d) {
    body += `<div class="loading-state" style="display:flex; flex-direction:column; gap:12px; padding:32px 0;"><div class="spinner"></div><div>Identificando os autores…</div></div></div>`;
    view.shell("Bibliometria e rede de coautoria", "Análise de coautoria das suas produções a partir do XML do Lattes.", body);
    bindImport(view, st);
    return;
  }
  if (!temAutores) {
    body += `<p class="pd-empty">Nenhuma produção tem a lista de autores ainda. Clique em <b>Importar autores do XML</b>.</p></div>`;
    view.shell("Bibliometria e rede de coautoria", "Análise de coautoria das suas produções a partir do XML do Lattes.", body);
    bindImport(view, st);
    return;
  }

  // filtros globais
  const anosTodos = [...new Set(d.producoes.map((p) => p.ano).filter((a) => a != null))].sort((a, b) => a - b);
  const f = st.f;
  const noPeriodo = d.producoes.filter((p) => (f.de == null || (p.ano != null && p.ano >= f.de)) && (f.ate == null || (p.ano != null && p.ano <= f.ate)));
  const tiposCount = new Map();
  for (const p of noPeriodo) tiposCount.set(tipoDe(p), (tiposCount.get(tipoDe(p)) || 0) + 1);
  const tipos = [...tiposCount].sort((a, b) => b[1] - a[1]);
  const an = (st.an = analyze(d, f));

  body += `
      <div class="bb-filters">
        <label class="bb-ctl">De <select id="bb-de" class="form-select"><option value="">início</option>${anosTodos.map((a) => `<option value="${a}" ${f.de === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
        <label class="bb-ctl">até <select id="bb-ate" class="form-select"><option value="">hoje</option>${anosTodos.map((a) => `<option value="${a}" ${f.ate === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
        <div class="ql-chips" role="group" aria-label="Tipos de produção">
          ${tipos.map(([t, n]) => `<button type="button" class="ql-chip ${f.tipos.has(t) ? "on" : ""}" data-tipo="${escapeHtml(t)}" aria-pressed="${f.tipos.has(t)}">${escapeHtml(t)} <span class="muted">${fmt(n)}</span></button>`).join("")}
          ${f.de != null || f.ate != null || f.tipos.size ? `<button type="button" class="btn btn-secondary btn-sm" id="bb-clear">Limpar filtros</button>` : ""}
        </div>
      </div>
      <div class="ql-tabs" role="tablist">
        ${[["visao", "📊 Visão geral"], ["rede", "🕸️ Rede de colaboração"], ["coautores", "👥 Coautores"]].map(([k, l]) => `<button type="button" role="tab" class="ql-tab ${st.tab === k ? "on" : ""}" data-tab="${k}" aria-selected="${st.tab === k}">${l}</button>`).join("")}
      </div>`;

  let g = null;
  if (st.tab === "visao") body += renderVisao(an);
  else if (st.tab === "coautores") body += renderCoautores(st, an);
  else {
    const key = JSON.stringify([f.de, f.ate, [...f.tipos].sort(), st.net.ego, st.net.minW, st.net.max, st.net.seed, d.autores.length]);
    if (st.graphKey !== key) {
      g = buildGraph(an, st.net);
      layout(g, st.net.seed);
      st.graph = g;
      st.graphKey = key;
    }
    g = st.graph;
    body += renderRedeShell(st, g);
  }
  body += `</div>`;

  view.shell("Bibliometria e rede de coautoria", "Análise de coautoria das suas produções a partir do XML do Lattes.", body);
  const el = view.el;
  bindImport(view, st);
  attachTip(el);

  const rerender = () => renderBiblioTool(view);
  el.querySelector("#bb-xlsx")?.addEventListener("click", () => exportXlsx(st, an).catch((e) => showToast(`Falha ao exportar: ${e}`, "error")));
  el.querySelector("#bb-de")?.addEventListener("change", (e) => { f.de = e.target.value ? Number(e.target.value) : null; rerender(); });
  el.querySelector("#bb-ate")?.addEventListener("change", (e) => { f.ate = e.target.value ? Number(e.target.value) : null; rerender(); });
  el.querySelectorAll("[data-tipo]").forEach((b) => b.addEventListener("click", () => {
    const t = b.dataset.tipo;
    f.tipos.has(t) ? f.tipos.delete(t) : f.tipos.add(t);
    rerender();
  }));
  el.querySelector("#bb-clear")?.addEventListener("click", () => { st.f = { de: null, ate: null, tipos: new Set() }; rerender(); });
  el.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { st.tab = b.dataset.tab; rerender(); }));

  if (st.tab === "visao") {
    el.querySelectorAll("[data-autor]").forEach((b) => b.addEventListener("click", () => {
      st.tab = "coautores";
      st.open = Number(b.dataset.autor);
      st.co.q = "";
      rerender();
    }));
  } else if (st.tab === "coautores") {
    bindCoautores(view, st);
  } else {
    bindRede(view, st, g);
  }
}

function bindImport(view, st) {
  view.el.querySelector("#bb-import")?.addEventListener("click", async () => {
    st.importing = true;
    renderBiblioTool(view);
    let r = null;
    try {
      r = await api.biblioImport(null);
    } catch (e) {
      // sem XML na pasta do currículo: pede o arquivo
      const path = await api.selectXmlFile().catch(() => null);
      if (path) r = await api.biblioImport(path).catch((err) => showToast(`Erro: ${err}`, "error", 7000));
      else showToast(String(e), "error", 6000);
    }
    st.importing = false;
    if (r) {
      showToast(
        `Autores lidos de ${fmt(r.no_xml)} produção(ões) do XML; ${fmt(r.atualizadas)} atualizada(s) no banco` + (r.sem_correspondencia ? `; ${fmt(r.sem_correspondencia)} do XML não estão no banco.` : "."),
        "success",
        7000
      );
      st.data = null;
      st.graphKey = null;
      view.onChanged?.();
    }
    renderBiblioTool(view);
  });
}

function bindCoautores(view, st) {
  const el = view.el;
  const rerender = () => renderBiblioTool(view);
  const q = el.querySelector("#bb-q");
  q?.addEventListener("input", () => {
    st.co.q = q.value;
    st.co.limit = PAGE;
    clearTimeout(st.qTimer);
    st.qTimer = setTimeout(() => {
      const pos = st.co.q.length;
      rerender();
      const again = view.el.querySelector("#bb-q");
      again?.focus();
      again?.setSelectionRange(pos, pos);
    }, 200);
  });
  el.querySelector("#bb-co-tipo")?.addEventListener("change", (e) => { st.co.tipo = e.target.value; st.co.limit = PAGE; rerender(); });
  el.querySelector("#bb-co-sort")?.addEventListener("change", (e) => { st.co.sort = e.target.value; rerender(); });
  el.querySelector("#bb-more")?.addEventListener("click", () => { st.co.limit += PAGE; rerender(); });
  el.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => {
    const id = Number(b.dataset.open);
    st.open = st.open === id ? null : id;
    rerender();
  }));
  el.querySelectorAll("[data-sel]").forEach((c) => c.addEventListener("change", () => {
    const id = Number(c.dataset.sel);
    c.checked ? st.sel.add(id) : st.sel.delete(id);
    rerender();
  }));
  el.querySelector("#bb-merge")?.addEventListener("click", async () => {
    const byId = new Map(st.data.autores.map((a) => [a.id, a]));
    // destino: o nome com mais produções (em todo o banco)
    const total = new Map();
    for (const p of st.data.producoes) for (const id of p.autores) total.set(id, (total.get(id) || 0) + 1);
    const ids = [...st.sel].filter((id) => byId.has(id)).sort((a, b) => (total.get(b) || 0) - (total.get(a) || 0));
    if (ids.length < 2) return;
    const destino = byId.get(ids[0]);
    const outros = ids.slice(1).map((id) => byId.get(id));
    if (!window.confirm(`Juntar como a mesma pessoa?\n\n${outros.map((a) => `• ${a.nome}`).join("\n")}\n\n→ ${destino.nome}\n\nDá para desfazer depois.`)) return;
    try {
      await api.biblioMerge(outros.map((a) => a.chave), destino.chave);
      st.sel.clear();
      st.open = null;
      st.data = null;
      st.graphKey = null;
      showToast(`${fmt(outros.length + 1)} nomes juntados em ${destino.nome}.`, "success");
      await load(view, st);
    } catch (e) {
      showToast(`Erro ao mesclar: ${e}`, "error");
    }
  });
  el.querySelectorAll("[data-unmerge]").forEach((b) => b.addEventListener("click", async () => {
    try {
      await api.biblioUnmerge(b.dataset.unmerge);
      st.data = null;
      st.graphKey = null;
      await load(view, st);
    } catch (e) {
      showToast(`Erro: ${e}`, "error");
    }
  }));
}

function bindRede(view, st, g) {
  const el = view.el;
  const rerender = () => renderBiblioTool(view);
  const o = st.net;
  const focusIds = () => {
    if (st.netSel != null) {
      const ids = new Set([st.netSel]);
      g.links.forEach((l) => {
        if (l.s === st.netSel) ids.add(l.t);
        if (l.t === st.netSel) ids.add(l.s);
      });
      return ids;
    }
    if (st.netFocus != null && g.comunidades[st.netFocus]) return new Set(g.comunidades[st.netFocus].ids);
    return null;
  };
  const net = renderNetwork(el.querySelector("#bb-net"), g, { cor: o.cor, rotulos: o.rotulos, selected: st.netSel, focus: focusIds() }, {
    onSelect: (id) => {
      st.netSel = id;
      st.netFocus = null;
      rerender();
    },
  });
  el.querySelector("#bb-ego")?.addEventListener("change", (e) => { o.ego = e.target.checked; st.netSel = null; rerender(); });
  el.querySelector("#bb-minw")?.addEventListener("change", (e) => { o.minW = Number(e.target.value); rerender(); });
  el.querySelector("#bb-nautores")?.addEventListener("change", (e) => { o.max = Number(e.target.value); rerender(); });
  el.querySelector("#bb-cor")?.addEventListener("change", (e) => { o.cor = e.target.value; st.netFocus = null; rerender(); });
  el.querySelector("#bb-rot")?.addEventListener("change", (e) => { o.rotulos = e.target.value; rerender(); });
  el.querySelector("#bb-relayout")?.addEventListener("click", () => { o.seed = (o.seed * 7919 + 13) % 100003; rerender(); });
  el.querySelector("#bb-zoom-in")?.addEventListener("click", () => net.zoom(1.4));
  el.querySelector("#bb-zoom-out")?.addEventListener("click", () => net.zoom(1 / 1.4));
  el.querySelector("#bb-fit")?.addEventListener("click", () => net.reset());
  // tela cheia: a janela do app entra em tela cheia e a rede vai para o <body>, por cima de tudo
  // (dentro do painel, ancestrais com transform/overflow prenderiam o position: fixed)
  const setMax = (on) => {
    if (Boolean(st.netMax) === on) return;
    st.netMax = on;
    setWindowFullscreen(on);
    rerender();
  };
  el.querySelector("#bb-fs")?.addEventListener("click", () => setMax(!st.netMax));
  if (st.escHandler) document.removeEventListener("keydown", st.escHandler);
  st.escHandler = (e) => {
    if (e.key === "Escape" && st.netMax) setMax(false);
  };
  document.addEventListener("keydown", st.escHandler);
  if (!st.fsHandler) {
    // saiu da tela cheia do navegador por fora (F11, Esc do sistema): sai do modo maximizado
    st.fsHandler = () => {
      if (!document.fullscreenElement && st.netMax && !tauriWindow()) setMax(false);
    };
    document.addEventListener("fullscreenchange", st.fsHandler);
  }
  const wrap = el.querySelector(".bb-net-wrap");
  if (st.netMax && wrap) document.body.appendChild(wrap);
  document.body.classList.toggle("bb-max-open", Boolean(st.netMax));
  el.querySelector("#bb-net-close")?.addEventListener("click", () => { st.netSel = null; rerender(); });
  el.querySelectorAll("[data-net]").forEach((b) => b.addEventListener("click", () => { st.netSel = Number(b.dataset.net); rerender(); }));
  el.querySelectorAll("[data-com]").forEach((b) => b.addEventListener("click", () => {
    const i = Number(b.dataset.com);
    st.netFocus = st.netFocus === i ? null : i;
    rerender();
  }));
  const stamp = new Date().toISOString().slice(0, 10);
  el.querySelector("#bb-exp-svg")?.addEventListener("click", () => saveText(net.svgText(), `Rede_coautoria_${stamp}.svg`, "svg").catch((e) => showToast(`Falha ao salvar: ${e}`, "error")));
  el.querySelector("#bb-exp-graphml")?.addEventListener("click", () => saveText(graphml(g), `Rede_coautoria_${stamp}.graphml`, "graphml").catch((e) => showToast(`Falha ao salvar: ${e}`, "error")));
}
