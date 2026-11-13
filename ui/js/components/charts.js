// Painel de Gráficos — SVG puro, animado, sem dependências externas

import { api } from "../api.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../utils.js";

export const PALETTE = {
  dadosgerais: "#94a3b8",
  formacao: "#8b5cf6",
  encargos: "#f59e0b",
  disciplinas: "#06b6d4",
  projetos: "#10b981",
  producoes: "#6366f1",
  patentes: "#ec4899",
  eventos: "#f97316",
  orientacoes: "#22c55e",
  bancas: "#3b82f6",
};
const SERIES = ["#6366f1", "#06b6d4", "#f59e0b", "#ec4899", "#10b981", "#8b5cf6", "#f97316", "#3b82f6", "#ef4444", "#14b8a6", "#a855f7", "#84cc16"];
const QUALIS_ORDER = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "B5", "C", "SQ"];
const QUALIS_COLOR = ["#059669", "#0d9488", "#16a34a", "#65a30d", "#2563eb", "#4f46e5", "#7c3aed", "#9333ea", "#a21caf", "#d97706", "#94a3b8"];

const label = (k) => CATEGORY_SCHEMAS[k]?.group || k;
const fmt = (n) => Number(n).toLocaleString("pt-BR");

export class ChartsView {
  constructor({ container }) {
    this.container = container;
    this.data = null;
    this.hidden = new Set(["dadosgerais"]);
    this.from = null;
    this.to = null;
    this.tip = document.createElement("div");
    this.tip.className = "chart-tip";
    document.body.appendChild(this.tip);
  }

  async show() {
    this.container.innerHTML = `<div class="loading-state" style="display:flex"><div class="spinner"></div><span>Calculando indicadores...</span></div>`;
    try {
      this.data = await api.getAllRecords();
    } catch (e) {
      showToast(`Erro ao carregar dados: ${e}`, "error");
      return;
    }
    const years = this.allYears();
    if (this.from == null) {
      this.from = years[0];
      this.to = years[years.length - 1];
    }
    this.render();
  }

  allYears() {
    const s = new Set();
    for (const recs of Object.values(this.data || {})) for (const r of recs) if (r.ano > 1950 && r.ano < 2100) s.add(r.ano);
    return [...s].sort((a, b) => a - b);
  }

  inRange(r) {
    return r.ano >= this.from && r.ano <= this.to;
  }

  cats() {
    return Object.keys(CATEGORY_SCHEMAS).filter((c) => !this.hidden.has(c));
  }

  render() {
    const years = this.allYears();
    const range = years.filter((y) => y >= this.from && y <= this.to);
    const cats = this.cats();
    const d = this.data;
    const recsOf = (c) => (d[c] || []).filter((r) => this.inRange(r));

    const total = cats.reduce((a, c) => a + recsOf(c).length, 0);
    const prods = recsOf("producoes");
    const artigos = prods.filter((r) => /artigo/i.test(r.tipo || ""));
    const allR = cats.flatMap(recsOf);
    const withFile = allR.filter((r) => r.path).length;
    const perYear = {};
    for (const r of allR) perYear[r.ano] = (perYear[r.ano] || 0) + 1;
    const best = Object.entries(perYear).sort((a, b) => b[1] - a[1])[0];
    const last5 = range.slice(-5);
    const art5 = artigos.filter((r) => last5.includes(r.ano)).length / Math.max(1, last5.length);
    const topQ = prods.filter((r) => ["A1", "A2"].includes((r.qualis || "").toUpperCase())).length;

    // spark de artigos
    const sparkArt = range.map((y) => artigos.filter((r) => r.ano === y).length);
    const sparkAll = range.map((y) => perYear[y] || 0);
    this.kpiRows = [
      ["Período", `${range[0] ?? "—"} – ${range[range.length - 1] ?? "—"}`],
      ["Registros no período", total],
      ["Produções", prods.length],
      ["Artigos publicados", artigos.length],
      [`Artigos por ano (últimos ${last5.length} anos)`, Number(art5.toFixed(2))],
      ["Produções Qualis A1 + A2", topQ],
      ["Ano mais produtivo", best ? `${best[0]} (${best[1]} registros)` : "—"],
      ["Registros com comprovante", withFile],
      ["% com comprovante", allR.length ? Math.round((withFile / allR.length) * 100) : 0],
    ];
    this.ctx = { range, cats, recsOf, prods };

    this.container.innerHTML = `
      <div class="dash">
        <section class="dash-hero">
          <div class="hero-text">
            <span class="hero-kicker">Indicadores</span>
            <h2>Sua trajetória acadêmica em números</h2>
            <p>${range[0] ?? "—"} – ${range[range.length - 1] ?? "—"} · ${cats.length} categorias selecionadas</p>
          </div>
          <div class="hero-controls">
            <label>De <select id="ch-from">${years.map((y) => `<option ${y === this.from ? "selected" : ""}>${y}</option>`).join("")}</select></label>
            <label>Até <select id="ch-to">${years.map((y) => `<option ${y === this.to ? "selected" : ""}>${y}</option>`).join("")}</select></label>
            <div class="seg seg-dark">
              ${[["Tudo", 0], ["10 anos", 10], ["5 anos", 5]].map(([t, n]) => `<button data-span="${n}">${t}</button>`).join("")}
            </div>
          </div>
          <div class="hero-export">
            <button type="button" data-exp="xlsx" title="Dados sumarizados do período em Excel (várias abas)">⬇ Excel</button>
            <button type="button" data-exp="html" title="Painel completo em uma página HTML que abre em qualquer navegador">⬇ Dashboard</button>
            <button type="button" data-exp="print" title="Imprimir ou salvar o painel como PDF">🖨 PDF</button>
          </div>
          <div class="cat-chips">
            ${Object.keys(CATEGORY_SCHEMAS)
              .map(
                (c) => `<button class="cat-chip ${this.hidden.has(c) ? "off" : ""}" data-cat="${c}" style="--c:${PALETTE[c]}">
                <i></i>${escapeHtml(label(c))}<b>${fmt(recsOf(c).length)}</b></button>`
              )
              .join("")}
          </div>
        </section>

        <section class="kpis">
          ${this.kpi("Registros no período", fmt(total), "📚", sparkAll, "#6366f1")}
          ${this.kpi("Produções", fmt(prods.length), "📄", range.map((y) => prods.filter((r) => r.ano === y).length), "#06b6d4")}
          ${this.kpi("Artigos publicados", fmt(artigos.length), "📰", sparkArt, "#10b981", `${art5.toFixed(1)}/ano nos últimos ${last5.length} anos`)}
          ${this.kpi("Qualis A1 + A2", fmt(topQ), "🏆", null, "#f59e0b", prods.length ? `${Math.round((topQ / Math.max(1, artigos.length)) * 100)}% dos artigos` : "")}
          ${this.kpi("Ano mais produtivo", best ? best[0] : "—", "🚀", null, "#ec4899", best ? `${fmt(best[1])} registros` : "")}
          ${this.kpi("Com comprovante", allR.length ? Math.round((withFile / allR.length) * 100) + "%" : "—", "📎", null, "#8b5cf6", `${fmt(withFile)} de ${fmt(allR.length)}`)}
        </section>

        <section class="grid-2">
          <div class="card card-wide"><div class="card-h"><h3>Evolução anual por categoria</h3><span>barras empilhadas · passe o mouse</span></div><div id="ch-stack" class="chart"></div></div>
          <div class="card"><div class="card-h"><h3>Distribuição por categoria</h3><span>período selecionado</span></div><div id="ch-donut" class="chart"></div></div>
        </section>

        <section class="grid-2">
          <div class="card card-wide"><div class="card-h"><h3>Produções por tipo ao longo dos anos</h3><span>áreas suavizadas</span></div><div id="ch-area" class="chart"></div></div>
          <div class="card"><div class="card-h"><h3>Estratos Qualis</h3><span>produções classificadas</span></div><div id="ch-qualis" class="chart"></div></div>
        </section>

        <section class="grid-2">
          <div class="card card-wide"><div class="card-h"><h3>Mapa de calor — ano × categoria</h3><span>intensidade = quantidade</span></div><div id="ch-heat" class="chart"></div></div>
          <div class="card"><div class="card-h"><h3>Crescimento acumulado</h3><span>total de registros</span></div><div id="ch-cum" class="chart"></div></div>
        </section>

        <section class="grid-2">
          <div class="card"><div class="card-h"><h3>Principais periódicos / eventos</h3><span>top 10 em produções</span></div><div id="ch-journals" class="chart"></div></div>
          <div class="card"><div class="card-h"><h3>Tipos por categoria</h3><span>escolha a categoria</span>
            <select id="ch-tipo-cat" class="select-filter">${Object.keys(CATEGORY_SCHEMAS).map((c) => `<option value="${c}" ${c === (this.tipoCat || "producoes") ? "selected" : ""}>${escapeHtml(label(c))}</option>`).join("")}</select></div>
            <div id="ch-tipos" class="chart"></div></div>
        </section>
      </div>`;

    this.bind(years);
    this.drawStack(range, cats, recsOf);
    this.drawDonut(cats, recsOf);
    this.drawArea(range, prods);
    this.drawQualis(prods);
    this.drawHeat(range, cats, recsOf);
    this.drawCum(range, allR);
    this.drawJournals(prods);
    this.drawTipos(recsOf(this.tipoCat || "producoes"));
  }

  kpi(title, value, icon, spark, color, sub = "") {
    let sp = "";
    if (spark && spark.length > 1) {
      const max = Math.max(1, ...spark);
      const pts = spark.map((v, i) => `${(i / (spark.length - 1)) * 100},${28 - (v / max) * 26}`).join(" ");
      sp = `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/><polygon points="0,30 ${pts} 100,30" fill="${color}" opacity=".12"/></svg>`;
    }
    return `<div class="kpi" style="--k:${color}"><div class="kpi-top"><span class="kpi-icon">${icon}</span><span class="kpi-title">${escapeHtml(title)}</span></div>
      <div class="kpi-value">${value}</div><div class="kpi-sub">${escapeHtml(sub)}</div>${sp}</div>`;
  }

  bind(years) {
    const c = this.container;
    c.querySelectorAll("[data-exp]").forEach((b) =>
      b.addEventListener("click", () => ({ xlsx: () => this.exportXlsx(), html: () => this.exportHtml(), print: () => this.printDash() })[b.dataset.exp]())
    );
    c.querySelector("#ch-from").addEventListener("change", (e) => {
      this.from = Number(e.target.value);
      if (this.from > this.to) this.to = this.from;
      this.render();
    });
    c.querySelector("#ch-to").addEventListener("change", (e) => {
      this.to = Number(e.target.value);
      if (this.to < this.from) this.from = this.to;
      this.render();
    });
    c.querySelectorAll("[data-span]").forEach((b) =>
      b.addEventListener("click", () => {
        const n = Number(b.dataset.span);
        this.to = years[years.length - 1];
        this.from = n ? Math.max(years[0], this.to - n + 1) : years[0];
        this.render();
      })
    );
    c.querySelectorAll("[data-cat]").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.cat;
        this.hidden.has(k) ? this.hidden.delete(k) : this.hidden.add(k);
        this.render();
      })
    );
    c.querySelector("#ch-tipo-cat").addEventListener("change", (e) => {
      this.tipoCat = e.target.value;
      const recs = (this.data[this.tipoCat] || []).filter((r) => this.inRange(r));
      this.drawTipos(recs);
    });
  }

  // ---------- exportação ----------
  stamp() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** Planilhas com os dados sumarizados do período/categorias selecionados. */
  buildSheets() {
    const { range, cats, recsOf, prods } = this.ctx;
    const all = cats.flatMap((c) => recsOf(c).map((r) => [c, r]));
    const period = `${this.from}–${this.to}`;
    const sheets = [];
    sheets.push({ name: "Resumo", title: `Indicadores do currículo · ${period}`, columns: ["Indicador", "Valor"], rows: this.kpiRows.map(([k, v]) => [k, v]) });
    sheets.push({
      name: "Ano x Categoria",
      title: `Registros por ano e categoria · ${period}`,
      columns: ["Ano", ...cats.map(label), "Total"],
      rows: [
        ...range.map((y) => {
          const v = cats.map((c) => recsOf(c).filter((r) => r.ano === y).length);
          return [y, ...v, v.reduce((a, b) => a + b, 0)];
        }),
        ["Total", ...cats.map((c) => recsOf(c).length), all.length],
      ],
    });
    const tipoRows = [];
    for (const c of cats) {
      const cnt = count(recsOf(c), (r) => r.tipo || "Sem tipo");
      for (const [t, n] of Object.entries(cnt).sort((a, b) => b[1] - a[1])) tipoRows.push([label(c), t, n, ...range.map((y) => recsOf(c).filter((r) => (r.tipo || "Sem tipo") === t && r.ano === y).length)]);
    }
    sheets.push({ name: "Tipos", title: "Registros por categoria e tipo", columns: ["Categoria", "Tipo", "Total", ...range.map(String)], rows: tipoRows });
    const q = count(prods.filter((r) => r.qualis && r.qualis.trim()), (r) => r.qualis.trim().toUpperCase());
    const qk = [...QUALIS_ORDER.filter((k) => q[k]), ...Object.keys(q).filter((k) => !QUALIS_ORDER.includes(k))];
    const qt = qk.reduce((a, k) => a + q[k], 0);
    sheets.push({ name: "Qualis", title: "Produções por estrato Qualis", columns: ["Estrato", "Produções", "%", ...range.map(String)], rows: qk.map((k) => [k, q[k], Number(((q[k] / qt) * 100).toFixed(1)), ...range.map((y) => prods.filter((r) => (r.qualis || "").trim().toUpperCase() === k && r.ano === y).length)]) });
    const js = {};
    for (const r of prods) {
      if (!r.journal || !r.journal.trim()) continue;
      const k = r.journal.trim();
      js[k] ||= { n: 0, q: "", ano: 0, anos: new Set() };
      js[k].n++;
      js[k].anos.add(r.ano);
      if ((r.ano || 0) >= js[k].ano && r.qualis) { js[k].q = r.qualis.toUpperCase(); js[k].ano = r.ano; }
    }
    sheets.push({ name: "Periódicos", title: "Periódicos, livros e eventos", columns: ["Periódico / evento", "Produções", "Qualis mais recente", "Anos"], rows: Object.entries(js).sort((a, b) => b[1].n - a[1].n).map(([j, o]) => [j, o.n, o.q, [...o.anos].filter(Boolean).sort().join(", ")]) });
    sheets.push({
      name: "Registros",
      title: `Todos os registros do período · ${period}`,
      columns: ["Categoria", "Ano", "Tipo", "Título / descrição", "Detalhe", "Periódico / evento", "Qualis", "DOI", "Comprovante", "Arquivo"],
      rows: all
        .sort((a, b) => (b[1].ano || 0) - (a[1].ano || 0))
        .map(([c, r]) => [
          label(c),
          r.ano ?? null,
          r.tipo || "",
          r.titulo || r.disciplina || r.descricao || "",
          [r.aluno, r.curso, r.titulo && r.descricao ? r.descricao : null, r.horas ? `${r.horas} h` : null].filter(Boolean).join(" · "),
          r.journal || "",
          r.qualis || "",
          /^10\./.test(r.identifier || "") ? r.identifier : "",
          r.path ? "sim" : "não",
          r.path || "",
        ]),
    });
    return sheets;
  }

  async exportXlsx() {
    try {
      const target = await api.selectSavePath(`Indicadores_Lattes_${this.from}-${this.to}_${this.stamp()}.xlsx`, "xlsx");
      if (!target) return;
      const saved = await api.exportXlsx(this.buildSheets());
      showToast(`📊 Planilha salva: ${saved.split(/[\\/]/).pop()}`, "success", 4500);
      api.revealInExplorer(saved).catch(() => {});
    } catch (e) {
      showToast(`Falha ao exportar: ${e}`, "error", 6000);
    }
  }

  /** Página HTML autônoma com o painel (estilos embutidos, abre em qualquer navegador). */
  async exportHtml() {
    try {
      const target = await api.selectSavePath(`Dashboard_Lattes_${this.from}-${this.to}_${this.stamp()}.html`, "html");
      if (!target) return;
      let css = "";
      for (const sh of document.styleSheets) {
        try {
          for (const r of sh.cssRules) css += r.cssText + "\n";
        } catch {}
      }
      const dash = this.container.querySelector(".dash").cloneNode(true);
      dash.querySelectorAll(".hero-controls, .hero-export").forEach((e) => e.remove());
      dash.querySelectorAll("select").forEach((s) => s.replaceWith(Object.assign(document.createElement("b"), { textContent: s.selectedOptions[0]?.textContent || "" })));
      const version = await api.getAppVersion().catch(() => "");
      const root = document.documentElement;
      const html = `<!doctype html><html lang="pt-BR" data-theme="${root.dataset.theme || "light"}" style="${escapeHtml(root.getAttribute("style") || "")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Indicadores do Currículo Lattes · ${this.from}–${this.to}</title><style>${css}
body{overflow:auto!important;height:auto!important;background:var(--bg-app,#f6f7fb)} .dash{max-width:1280px;margin:0 auto;padding:24px} .export-foot{max-width:1280px;margin:0 auto 32px;padding:0 24px;color:var(--text-muted);font:12px system-ui}
*{animation:none!important} .grow,.slice,.cell,.hb-fill,.line{opacity:1!important;transform:none!important;stroke-dashoffset:0!important;width:var(--w)}</style></head>
<body>${dash.outerHTML}<div class="export-foot">Gerado com Lattes Manager v${escapeHtml(version)} em ${new Date().toLocaleString("pt-BR")}</div></body></html>`;
      const saved = await api.writeReport(new TextEncoder().encode(html));
      showToast(`🌐 Dashboard salvo: ${saved.split(/[\\/]/).pop()}`, "success", 4500);
      api.revealInExplorer(saved).catch(() => {});
    } catch (e) {
      showToast(`Falha ao salvar o dashboard: ${e}`, "error", 6000);
    }
  }

  printDash() {
    document.body.classList.add("print-dash");
    const done = () => {
      document.body.classList.remove("print-dash");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    setTimeout(() => window.print(), 50);
  }

  // ---------- tooltip ----------
  attachTip(root) {
    root.querySelectorAll("[data-tip]").forEach((el) => {
      el.addEventListener("mousemove", (e) => {
        this.tip.innerHTML = el.getAttribute("data-tip");
        this.tip.style.opacity = "1";
        const w = this.tip.offsetWidth;
        const x = e.clientX + 14 + w > window.innerWidth ? e.clientX - w - 14 : e.clientX + 14;
        this.tip.style.transform = `translate(${x}px, ${e.clientY + 14}px)`;
      });
      el.addEventListener("mouseleave", () => (this.tip.style.opacity = "0"));
    });
  }

  empty(el) {
    el.innerHTML = `<div class="chart-empty">Sem dados no período</div>`;
  }

  // ---------- gráficos ----------
  drawStack(range, cats, recsOf) {
    const el = this.container.querySelector("#ch-stack");
    if (!range.length) return this.empty(el);
    const W = 760, H = 300, P = { l: 38, r: 10, t: 10, b: 28 };
    const rows = range.map((y) => {
      const o = { y, total: 0 };
      for (const c of cats) {
        o[c] = recsOf(c).filter((r) => r.ano === y).length;
        o.total += o[c];
      }
      return o;
    });
    const max = niceMax(Math.max(1, ...rows.map((r) => r.total)));
    const bw = (W - P.l - P.r) / rows.length;
    const sy = (v) => ((H - P.t - P.b) * v) / max;
    let s = gridY(W, H, P, max);
    rows.forEach((r, i) => {
      let acc = 0;
      const x = P.l + i * bw + bw * 0.15;
      const w = bw * 0.7;
      const tip = `<b>${r.y}</b> · ${r.total} registros<br>` + cats.filter((c) => r[c]).map((c) => `<i style="background:${PALETTE[c]}"></i>${escapeHtml(label(c))}: <b>${r[c]}</b>`).join("<br>");
      s += `<g class="bar-g" data-tip="${escapeHtml(tip)}" style="--d:${i * 25}ms">`;
      cats.forEach((c, ci) => {
        if (!r[c]) return;
        const h = sy(r[c]);
        const y = H - P.b - sy(acc) - h;
        s += `<rect class="grow" x="${x}" y="${y}" width="${w}" height="${Math.max(0, h - 1)}" rx="${ci === cats.length - 1 ? 3 : 1}" fill="${PALETTE[c]}"/>`;
        acc += r[c];
      });
      s += `<rect x="${P.l + i * bw}" y="${P.t}" width="${bw}" height="${H - P.t - P.b}" fill="transparent"/></g>`;
      const step = Math.ceil(rows.length / 16);
      if (i % step === 0) s += `<text class="ax" x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${r.y}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="svg">${s}</svg>`;
    this.attachTip(el);
  }

  drawDonut(cats, recsOf) {
    const el = this.container.querySelector("#ch-donut");
    const parts = cats.map((c) => ({ c, n: recsOf(c).length })).filter((p) => p.n).sort((a, b) => b.n - a.n);
    const tot = parts.reduce((a, p) => a + p.n, 0);
    if (!tot) return this.empty(el);
    const R = 90, r = 58, cx = 110, cy = 110;
    let a0 = -Math.PI / 2, s = "";
    parts.forEach((p, i) => {
      const a1 = a0 + (p.n / tot) * Math.PI * 2;
      s += `<path class="slice" style="--d:${i * 60}ms" d="${arc(cx, cy, R, r, a0, a1 - 0.012)}" fill="${PALETTE[p.c]}" data-tip="<b>${escapeHtml(label(p.c))}</b><br>${p.n} registros · ${((p.n / tot) * 100).toFixed(1)}%"/>`;
      a0 = a1;
    });
    s += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-n">${fmt(tot)}</text><text x="${cx}" y="${cy + 16}" text-anchor="middle" class="ax">registros</text>`;
    const legend = parts
      .map((p) => `<div class="lg"><i style="background:${PALETTE[p.c]}"></i><span>${escapeHtml(label(p.c))}</span><b>${((p.n / tot) * 100).toFixed(0)}%</b></div>`)
      .join("");
    el.innerHTML = `<div class="donut-wrap"><svg viewBox="0 0 220 220" class="svg donut">${s}</svg><div class="legend">${legend}</div></div>`;
    this.attachTip(el);
  }

  drawArea(range, prods) {
    const el = this.container.querySelector("#ch-area");
    if (!range.length || !prods.length) return this.empty(el);
    const tipos = Object.entries(count(prods, (r) => r.tipo || "Outros")).sort((a, b) => b[1] - a[1]);
    const top = tipos.slice(0, 6).map((t) => t[0]);
    const key = (r) => (top.includes(r.tipo) ? r.tipo : "Outros");
    const series = [...top, ...(tipos.length > 6 ? ["Outros"] : [])];
    const W = 760, H = 280, P = { l: 38, r: 12, t: 10, b: 28 };
    const vals = series.map((t) => range.map((y) => prods.filter((r) => r.ano === y && key(r) === t).length));
    const max = niceMax(Math.max(1, ...vals.flat()));
    const sx = (i) => P.l + (range.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (range.length - 1));
    const sy = (v) => H - P.b - ((H - P.t - P.b) * v) / max;
    let s = `<defs>${series.map((_, i) => `<linearGradient id="ga${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SERIES[i]}" stop-opacity=".35"/><stop offset="1" stop-color="${SERIES[i]}" stop-opacity="0"/></linearGradient>`).join("")}</defs>`;
    s += gridY(W, H, P, max);
    vals.forEach((v, i) => {
      const pts = v.map((n, j) => [sx(j), sy(n)]);
      const line = smooth(pts);
      s += `<path class="area" d="${line} L${sx(v.length - 1)},${H - P.b} L${sx(0)},${H - P.b} Z" fill="url(#ga${i})"/>`;
      s += `<path class="line" pathLength="1" d="${line}" stroke="${SERIES[i]}" />`;
    });
    range.forEach((y, j) => {
      const tip = `<b>${y}</b><br>` + series.map((t, i) => (vals[i][j] ? `<i style="background:${SERIES[i]}"></i>${escapeHtml(t)}: <b>${vals[i][j]}</b>` : "")).filter(Boolean).join("<br>");
      const w = (W - P.l - P.r) / Math.max(1, range.length - 1);
      s += `<rect class="hover-col" x="${sx(j) - w / 2}" y="${P.t}" width="${w}" height="${H - P.t - P.b}" data-tip="${escapeHtml(tip || `<b>${y}</b><br>sem produções`)}"/>`;
      const step = Math.ceil(range.length / 16);
      if (j % step === 0) s += `<text class="ax" x="${sx(j)}" y="${H - 8}" text-anchor="middle">${y}</text>`;
    });
    const legend = series.map((t, i) => `<div class="lg"><i style="background:${SERIES[i]}"></i><span>${escapeHtml(t)}</span></div>`).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="svg">${s}</svg><div class="legend legend-row">${legend}</div>`;
    this.attachTip(el);
  }

  drawQualis(prods) {
    const el = this.container.querySelector("#ch-qualis");
    const c = count(prods.filter((r) => r.qualis && r.qualis.trim()), (r) => r.qualis.trim().toUpperCase());
    const keys = [...QUALIS_ORDER.filter((q) => c[q]), ...Object.keys(c).filter((q) => !QUALIS_ORDER.includes(q))];
    if (!keys.length) return this.empty(el);
    const max = Math.max(...keys.map((k) => c[k]));
    const tot = keys.reduce((a, k) => a + c[k], 0);
    el.innerHTML = `<div class="hbars">${keys
      .map((k, i) => {
        const col = QUALIS_COLOR[QUALIS_ORDER.indexOf(k)] || "#64748b";
        return `<div class="hbar" data-tip="<b>Qualis ${escapeHtml(k)}</b><br>${c[k]} produções · ${((c[k] / tot) * 100).toFixed(1)}%">
          <span class="hb-l">${escapeHtml(k)}</span><div class="hb-track"><div class="hb-fill" style="--w:${(c[k] / max) * 100}%;--d:${i * 50}ms;background:${col}"></div></div><b>${c[k]}</b></div>`;
      })
      .join("")}</div>`;
    this.attachTip(el);
  }

  drawHeat(range, cats, recsOf) {
    const el = this.container.querySelector("#ch-heat");
    if (!range.length || !cats.length) return this.empty(el);
    const cw = Math.max(18, Math.min(38, 640 / range.length)), ch = 24, L = 110, T = 4;
    const W = L + cw * range.length + 4, H = T + ch * cats.length + 24;
    const m = cats.map((c) => range.map((y) => recsOf(c).filter((r) => r.ano === y).length));
    const max = Math.max(1, ...m.flat());
    let s = "";
    cats.forEach((c, i) => {
      s += `<text class="ax" x="${L - 8}" y="${T + i * ch + ch / 2 + 4}" text-anchor="end">${escapeHtml(label(c))}</text>`;
      range.forEach((y, j) => {
        const v = m[i][j];
        const op = v ? 0.15 + 0.85 * Math.sqrt(v / max) : 0.04;
        s += `<rect class="cell" style="--d:${(i + j) * 12}ms" x="${L + j * cw + 1}" y="${T + i * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="4" fill="${PALETTE[c]}" fill-opacity="${op}" data-tip="<b>${escapeHtml(label(c))}</b> · ${y}<br>${v} registro(s)"/>`;
      });
    });
    const step = Math.ceil(range.length / 16);
    range.forEach((y, j) => {
      if (j % step === 0) s += `<text class="ax" x="${L + j * cw + cw / 2}" y="${H - 6}" text-anchor="middle">${y}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="svg">${s}</svg>`;
    this.attachTip(el);
  }

  drawCum(range, allR) {
    const el = this.container.querySelector("#ch-cum");
    if (!range.length) return this.empty(el);
    let acc = 0;
    const v = range.map((y) => (acc += allR.filter((r) => r.ano === y).length));
    const W = 360, H = 240, P = { l: 36, r: 10, t: 12, b: 26 };
    const max = niceMax(Math.max(1, ...v));
    const sx = (i) => P.l + (range.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (range.length - 1));
    const sy = (n) => H - P.b - ((H - P.t - P.b) * n) / max;
    const pts = v.map((n, i) => [sx(i), sy(n)]);
    const line = smooth(pts);
    let s = `<defs><linearGradient id="gcum" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b5cf6" stop-opacity=".45"/><stop offset="1" stop-color="#06b6d4" stop-opacity="0"/></linearGradient>
      <linearGradient id="gcl" x1="0" x2="1"><stop offset="0" stop-color="#06b6d4"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>`;
    s += gridY(W, H, P, max);
    s += `<path class="area" d="${line} L${sx(v.length - 1)},${H - P.b} L${sx(0)},${H - P.b} Z" fill="url(#gcum)"/><path class="line thick" pathLength="1" d="${line}" stroke="url(#gcl)"/>`;
    pts.forEach(([x, y], i) => (s += `<circle class="dot" cx="${x}" cy="${y}" r="3.5" data-tip="<b>${range[i]}</b><br>${fmt(v[i])} acumulados"/>`));
    s += `<text class="ax" x="${sx(0)}" y="${H - 6}" text-anchor="start">${range[0]}</text><text class="ax" x="${sx(v.length - 1)}" y="${H - 6}" text-anchor="end">${range[range.length - 1]}</text>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="svg">${s}</svg>`;
    this.attachTip(el);
  }

  drawJournals(prods) {
    const el = this.container.querySelector("#ch-journals");
    const c = count(prods.filter((r) => r.journal && r.journal.trim()), (r) => r.journal.trim());
    const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!top.length) return this.empty(el);
    const max = top[0][1];
    el.innerHTML = `<div class="hbars">${top
      .map(
        ([j, n], i) => `<div class="hbar wide" data-tip="<b>${escapeHtml(j)}</b><br>${n} produções">
        <span class="hb-l" title="${escapeHtml(j)}">${escapeHtml(j)}</span><div class="hb-track"><div class="hb-fill" style="--w:${(n / max) * 100}%;--d:${i * 50}ms;background:linear-gradient(90deg,${SERIES[i % SERIES.length]},${SERIES[(i + 1) % SERIES.length]})"></div></div><b>${n}</b></div>`
      )
      .join("")}</div>`;
    this.attachTip(el);
  }

  drawTipos(recs) {
    const el = this.container.querySelector("#ch-tipos");
    const top = Object.entries(count(recs, (r) => r.tipo || "Sem tipo")).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!top.length) return this.empty(el);
    const max = top[0][1];
    el.innerHTML = `<div class="hbars">${top
      .map(
        ([t, n], i) => `<div class="hbar wide" data-tip="<b>${escapeHtml(t)}</b><br>${n} registros">
        <span class="hb-l" title="${escapeHtml(t)}">${escapeHtml(t)}</span><div class="hb-track"><div class="hb-fill" style="--w:${(n / max) * 100}%;--d:${i * 50}ms;background:${SERIES[i % SERIES.length]}"></div></div><b>${n}</b></div>`
      )
      .join("")}</div>`;
    this.attachTip(el);
  }
}

// ---------- helpers ----------
function count(arr, fn) {
  const o = {};
  for (const x of arr) {
    const k = fn(x);
    o[k] = (o[k] || 0) + 1;
  }
  return o;
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return v;
}

function gridY(W, H, P, max) {
  let s = "";
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    const y = H - P.b - ((H - P.t - P.b) * i) / 4;
    s += `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}"/><text class="ax" x="${P.l - 6}" y="${y + 4}" text-anchor="end">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`;
  }
  return s;
}

function smooth(pts) {
  if (pts.length < 2) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] || pts[i];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[i + 2] || pts[i + 1];
    const t = 0.18;
    d += ` C${x1 + (x2 - x0) * t},${y1 + (y2 - y0) * t} ${x2 - (x3 - x1) * t},${y2 - (y3 - y1) * t} ${x2},${y2}`;
  }
  return d;
}

function arc(cx, cy, R, r, a0, a1) {
  if (a1 - a0 >= Math.PI * 2 - 0.02) a1 = a0 + Math.PI * 2 - 0.02;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
  return `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z`;
}

