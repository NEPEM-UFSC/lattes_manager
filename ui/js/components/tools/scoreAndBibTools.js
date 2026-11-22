// Simulador de Pontuação (Progressão / Promoção / PQ / Concursos)
// e Exportador Bibliográfico (BibTeX / RIS / ABNT / Vancouver).

import { api } from "../../api.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../../utils.js";

// ==========================================
// 1. SIMULADOR DE PONTUAÇÃO (BAREMA EDITÁVEL)
// ==========================================
const CUR_YEAR = new Date().getFullYear();

function cloneRules(rules) {
  return rules.map((r) => ({
    id: r.id,
    label: r.label,
    category: r.category,
    match: { ...(r.match || {}) },
    weight: Number(r.weight || 0),
    cap: r.cap != null && r.cap !== "" ? Number(r.cap) : null,
  }));
}

function baseRules(overrides = {}) {
  const defaults = [
    // Produções (ordem importa para evitar colisão com livros/anais/fallback)
    { id: "prod_a1", label: "Artigo Qualis A1", category: "producoes", match: { qualis: "A1", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 10, cap: null },
    { id: "prod_a2", label: "Artigo Qualis A2", category: "producoes", match: { qualis: "A2", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 8.5, cap: null },
    { id: "prod_a3", label: "Artigo Qualis A3", category: "producoes", match: { qualis: "A3", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 7, cap: null },
    { id: "prod_a4", label: "Artigo Qualis A4", category: "producoes", match: { qualis: "A4", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 5.5, cap: null },
    { id: "prod_b1", label: "Artigo Qualis B1", category: "producoes", match: { qualis: "B1", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 4, cap: null },
    { id: "prod_b2", label: "Artigo Qualis B2", category: "producoes", match: { qualis: "B2", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 3, cap: null },
    { id: "prod_b3", label: "Artigo Qualis B3", category: "producoes", match: { qualis: "B3", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 2, cap: null },
    { id: "prod_b4", label: "Artigo Qualis B4", category: "producoes", match: { qualis: "B4", tipoNotRegex: "livro|cap[íi]tulo|anais|resumo" }, weight: 1, cap: null },
    { id: "prod_livro", label: "Livros publicados / organizados", category: "producoes", match: { tipoRegex: "livro", tipoNotRegex: "cap[íi]tulo" }, weight: 10, cap: 20 },
    { id: "prod_cap", label: "Capítulos de livros", category: "producoes", match: { tipoRegex: "cap[íi]tulo" }, weight: 4, cap: 16 },
    { id: "prod_anais", label: "Trabalhos completos / resumos em anais", category: "producoes", match: { tipoRegex: "anais|congresso|resumo|evento" }, weight: 1.5, cap: 15 },
    { id: "prod_c_art", label: "Artigos C / Sem Qualis (SQ)", category: "producoes", match: { tipoRegex: "artigo" }, weight: 0.5, cap: 5 },
    { id: "prod_outros", label: "Outras produções bibliográficas/técnicas", category: "producoes", match: { fallback: true }, weight: 1, cap: 10 },
    // Orientações
    { id: "ori_doc", label: "Orientação de Doutorado", category: "orientacoes", match: { tipoRegex: "doutorado" }, weight: 8, cap: null },
    { id: "ori_mes", label: "Orientação de Mestrado", category: "orientacoes", match: { tipoRegex: "mestrado" }, weight: 5, cap: null },
    { id: "ori_outros", label: "Orientações Pós-Doc / Especialização / TCC / IC", category: "orientacoes", match: { fallback: true }, weight: 2, cap: 16 },
    // Projetos & Inovação
    { id: "proj", label: "Projetos de Pesquisa / Extensão", category: "projetos", match: { fallback: true }, weight: 5, cap: 20 },
    { id: "pat", label: "Patentes e Registros", category: "patentes", match: { fallback: true }, weight: 8, cap: null },
    { id: "inov", label: "Produções de Inovação / Software", category: "inovacao", match: { fallback: true }, weight: 4, cap: 16 },
    // Bancas
    { id: "ban_doc", label: "Bancas de Doutorado", category: "bancas", match: { tipoRegex: "doutorado" }, weight: 3, cap: 15 },
    { id: "ban_mes", label: "Bancas de Mestrado", category: "bancas", match: { tipoRegex: "mestrado" }, weight: 2, cap: 12 },
    { id: "ban_outros", label: "Outras Bancas (TCC / Qualificação / Concursos)", category: "bancas", match: { fallback: true }, weight: 1, cap: 10 },
    // Atuação & Ensino
    { id: "atu_gestao", label: "Direção / Chefia / Coordenação", category: "atuacao", match: { tipoRegex: "dire[cç][aã]o|chefia|coordena[cç][aã]o" }, weight: 6, cap: 18 },
    { id: "atu_ensino", label: "Encargos de Ensino (Graduação / Pós-Graduação)", category: "atuacao", match: { tipoRegex: "encargo|ensino|disciplina" }, weight: 3, cap: 24 },
    { id: "atu_outros", label: "Comissões / Corpo Editorial / Revisor / Supervisão", category: "atuacao", match: { fallback: true }, weight: 1.5, cap: 12 },
    // Eventos & Popularização
    { id: "evt", label: "Participação em Eventos", category: "eventos", match: { fallback: true }, weight: 1, cap: 8 },
    { id: "edu", label: "Educação e Popularização de C&T", category: "educacao_popularizacao", match: { fallback: true }, weight: 1.5, cap: 10 },
  ];

  return defaults.map((d) => {
    const ov = overrides[d.id];
    return ov ? { ...d, weight: ov.weight ?? d.weight, cap: "cap" in ov ? ov.cap : d.cap } : d;
  });
}

const DEFAULT_BAREMAS = {
  ufsc_prog: {
    id: "ufsc_prog",
    name: "Progressão / Promoção Docente (Modelo CPPD / UFSC)",
    yearFrom: CUR_YEAR - 2,
    yearTo: CUR_YEAR,
    goal: 60,
    onlyWithProof: true,
    rules: baseRules(),
  },
  cnpq_pq: {
    id: "cnpq_pq",
    name: "Bolsa Produtividade CNPq (PQ — 5 anos)",
    yearFrom: CUR_YEAR - 5,
    yearTo: CUR_YEAR,
    goal: 100,
    onlyWithProof: false,
    rules: baseRules({
      prod_a1: { weight: 15, cap: null },
      prod_a2: { weight: 12, cap: null },
      prod_a3: { weight: 9, cap: null },
      prod_a4: { weight: 7, cap: null },
      prod_b1: { weight: 4, cap: 20 },
      prod_b2: { weight: 2, cap: 10 },
      prod_b3: { weight: 1, cap: 5 },
      prod_b4: { weight: 0.5, cap: 3 },
      ori_doc: { weight: 12, cap: null },
      ori_mes: { weight: 6, cap: 30 },
      ori_outros: { weight: 2, cap: 10 },
      pat: { weight: 12, cap: null },
      atu_ensino: { weight: 1, cap: 10 },
      evt: { weight: 0.5, cap: 5 },
    }),
  },
  concurso_titular: {
    id: "concurso_titular",
    name: "Concurso / Promoção Titular (Carreira)",
    yearFrom: "",
    yearTo: "",
    goal: 150,
    onlyWithProof: false,
    rules: baseRules({
      prod_a1: { weight: 12, cap: null },
      prod_a2: { weight: 10, cap: null },
      prod_a3: { weight: 8, cap: null },
      prod_a4: { weight: 6, cap: null },
      ori_doc: { weight: 10, cap: null },
      ori_mes: { weight: 6, cap: null },
      proj: { weight: 6, cap: 30 },
      pat: { weight: 10, cap: null },
      atu_gestao: { weight: 8, cap: 24 },
      atu_ensino: { weight: 2, cap: 30 },
    }),
  },
};

function matchesRule(rec, rule) {
  const m = rule.match || {};
  if (m.fallback) return true;
  const qualis = String(rec.qualis || "").trim().toUpperCase();
  const tipo = String(rec.tipo || "").trim();

  if (m.qualis && qualis !== String(m.qualis).trim().toUpperCase()) {
    return false;
  }
  if (m.tipoNotRegex) {
    try {
      if (new RegExp(m.tipoNotRegex, "i").test(tipo)) return false;
    } catch {
      // ignore invalid user regex
    }
  }
  if (m.tipoRegex) {
    try {
      if (!new RegExp(m.tipoRegex, "i").test(tipo)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function recordHasProof(r) {
  return Boolean((r.path && String(r.path).trim()) || (Array.isArray(r.attachments) && r.attachments.length > 0));
}

function recordTitle(r) {
  return r.titulo || r.descricao || r.disciplina || r.instituicao || r.aluno || `Registro #${r.id}`;
}

function fmtPts(n) {
  return Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

export async function renderScoreCalculatorTool(view) {
  const st = view.state;
  st.presetId ??= "ufsc_prog";
  st.customBaremas ??= null;
  st.recordsByCat ??= null;
  st.loading ??= false;
  st.showEditor ??= false;
  st.ruleFilter ??= "all";
  st.query ??= "";

  if (!st.baremaLoaded) {
    st.baremaLoaded = true;
    const saved = await api.getSetting("score_baremas").catch(() => null);
    if (saved && typeof saved === "object") {
      st.customBaremas = saved;
    }
  }

  const getBarema = (id) => {
    const custom = st.customBaremas?.[id];
    if (custom && Array.isArray(custom.rules)) {
      return {
        ...DEFAULT_BAREMAS[id],
        ...custom,
        rules: cloneRules(custom.rules),
      };
    }
    const def = DEFAULT_BAREMAS[id] || DEFAULT_BAREMAS.ufsc_prog;
    return {
      ...def,
      rules: cloneRules(def.rules),
    };
  };

  if (!st.activeBarema || st.activeBarema.id !== st.presetId) {
    st.activeBarema = getBarema(st.presetId);
    st.yearFrom = st.activeBarema.yearFrom ?? "";
    st.yearTo = st.activeBarema.yearTo ?? "";
    st.goal = st.activeBarema.goal ?? 60;
    st.onlyWithProof = Boolean(st.activeBarema.onlyWithProof);
  }

  const loadAllRecords = async () => {
    st.loading = true;
    draw();
    try {
      const cats = Object.keys(CATEGORY_SCHEMAS).filter((k) => !CATEGORY_SCHEMAS[k].legacy);
      const entries = await Promise.all(
        cats.map(async (cat) => {
          const rows = await api.getRecords(cat).catch(() => []);
          return [cat, Array.isArray(rows) ? rows : []];
        })
      );
      st.recordsByCat = Object.fromEntries(entries);
    } catch (e) {
      showToast(`Erro ao carregar registros: ${e}`, "error");
    } finally {
      st.loading = false;
      if (view.active === "score_calculator") draw();
    }
  };

  const evaluateScore = () => {
    const barema = st.activeBarema;
    const yf = st.yearFrom !== "" && st.yearFrom != null ? Number(st.yearFrom) : null;
    const yt = st.yearTo !== "" && st.yearTo != null ? Number(st.yearTo) : null;
    const hasYearFilter = yf !== null || yt !== null;

    const byRule = new Map();
    for (const rule of barema.rules) {
      byRule.set(rule.id, { rule, items: [], rawPts: 0, cappedPts: 0 });
    }

    const detailed = [];
    const rulesByCat = {};
    for (const rule of barema.rules) {
      (rulesByCat[rule.category] ||= []).push(rule);
    }

    for (const [cat, rows] of Object.entries(st.recordsByCat || {})) {
      const catRules = rulesByCat[cat];
      if (!catRules || !rows?.length) continue;

      for (const rec of rows) {
        const hasProof = recordHasProof(rec);
        if (st.onlyWithProof && !hasProof) continue;

        if (hasYearFilter) {
          if (rec.ano == null) continue;
          const startY = Number(rec.ano);
          const endY = rec.ano_fim != null ? Number(rec.ano_fim) : startY;
          if (yf !== null && endY < yf) continue;
          if (yt !== null && startY > yt) continue;
        }

        const matchedRule = catRules.find((rule) => matchesRule(rec, rule));
        if (!matchedRule) continue;

        const pts = Number(matchedRule.weight || 0);
        const bucket = byRule.get(matchedRule.id);
        bucket.rawPts += pts;
        const item = {
          id: rec.id,
          category: cat,
          categoryLabel: CATEGORY_SCHEMAS[cat]?.name || cat,
          ruleId: matchedRule.id,
          ruleLabel: matchedRule.label,
          ano: rec.ano,
          anoFim: rec.ano_fim,
          titulo: recordTitle(rec),
          tipo: rec.tipo || "",
          qualis: rec.qualis || "",
          hasProof,
          pts,
        };
        bucket.items.push(item);
        detailed.push(item);
      }
    }

    let totalRaw = 0;
    let totalCapped = 0;
    const ruleSummary = [];
    for (const bucket of byRule.values()) {
      const cap = bucket.rule.cap != null && bucket.rule.cap !== "" ? Number(bucket.rule.cap) : null;
      bucket.cappedPts = cap !== null && cap >= 0 ? Math.min(bucket.rawPts, cap) : bucket.rawPts;
      totalRaw += bucket.rawPts;
      totalCapped += bucket.cappedPts;
      ruleSummary.push(bucket);
    }

    detailed.sort((a, b) => (b.ano || 0) - (a.ano || 0) || b.pts - a.pts || a.titulo.localeCompare(b.titulo, "pt-BR"));
    return { totalRaw, totalCapped, ruleSummary, detailed };
  };

  function draw() {
    if (!st.recordsByCat) {
      view.shell(
        "Simulador de Pontuação (Progressão / Promoção / PQ)",
        "Carregando registros de todas as categorias...",
        `<div class="tl-empty">⏳ Lendo registros do banco de dados...</div>`
      );
      return;
    }

    const { totalRaw, totalCapped, ruleSummary, detailed } = evaluateScore();
    const goal = Number(st.goal || 0);
    const pct = goal > 0 ? Math.min(100, Math.round((totalCapped / goal) * 100)) : 100;
    const goalReached = goal > 0 && totalCapped >= goal;

    const q = (st.query || "").trim().toLowerCase();
    const visibleDetails = detailed.filter((it) => {
      if (st.ruleFilter !== "all" && it.ruleId !== st.ruleFilter) return false;
      if (q) {
        const hay = `${it.titulo} ${it.ruleLabel} ${it.categoryLabel} ${it.tipo} ${it.qualis} ${it.ano || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const periodText = st.yearFrom || st.yearTo ? `${st.yearFrom || "Início"} – ${st.yearTo || "Atual"}` : "Todo o histórico";

    view.shell(
      "Simulador de Pontuação (Progressão / Promoção / PQ / Concursos)",
      "Configure os pesos e tetos por categoria/Qualis, filtre o interstício e exporte a planilha pronta em Excel.",
      `
      <div class="tl-bar" style="flex-wrap:wrap; gap:10px; align-items:flex-end;">
        <div style="display:flex; flex-direction:column; gap:4px; min-width:260px; flex:1;">
          <label for="sc-preset" style="font-size:11.5px; font-weight:700; color:var(--text-secondary);">Modelo de Barema</label>
          <select id="sc-preset" class="form-select" style="height:34px;">
            ${Object.values(DEFAULT_BAREMAS).map((b) =>
              `<option value="${b.id}" ${st.presetId === b.id ? "selected" : ""}>${escapeHtml(b.name)}</option>`
            ).join("")}
          </select>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px; width:92px;">
          <label for="sc-yfrom" style="font-size:11.5px; font-weight:700; color:var(--text-secondary);">De</label>
          <input type="number" id="sc-yfrom" class="form-input mono" value="${st.yearFrom === "" ? "" : escapeHtml(String(st.yearFrom))}" placeholder="Todos" style="height:34px;" />
        </div>
        <div style="display:flex; flex-direction:column; gap:4px; width:92px;">
          <label for="sc-yto" style="font-size:11.5px; font-weight:700; color:var(--text-secondary);">Até</label>
          <input type="number" id="sc-yto" class="form-input mono" value="${st.yearTo === "" ? "" : escapeHtml(String(st.yearTo))}" placeholder="Atual" style="height:34px;" />
        </div>
        <div style="display:flex; gap:4px;">
          <button type="button" class="btn btn-secondary btn-sm" data-sc-range="2">2 anos</button>
          <button type="button" class="btn btn-secondary btn-sm" data-sc-range="4">4 anos</button>
          <button type="button" class="btn btn-secondary btn-sm" data-sc-range="5">5 anos</button>
          <button type="button" class="btn btn-secondary btn-sm" data-sc-range="all">Tudo</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px; width:92px;">
          <label for="sc-goal" style="font-size:11.5px; font-weight:700; color:var(--text-secondary);">Meta (pts)</label>
          <input type="number" id="sc-goal" class="form-input mono" step="1" min="0" value="${escapeHtml(String(st.goal))}" style="height:34px;" />
        </div>
      </div>

      <div class="tl-bar" style="flex-wrap:wrap; gap:10px; margin-top:8px;">
        <label style="display:flex; align-items:center; gap:7px; font-size:13px; cursor:pointer;">
          <input type="checkbox" id="sc-only-proof" ${st.onlyWithProof ? "checked" : ""} />
          Contar apenas registros com comprovante anexado
        </label>
        <div style="flex:1"></div>
        <button type="button" class="btn btn-secondary btn-sm" id="sc-toggle-editor">
          ${st.showEditor ? "🔽 Ocultar editor de pesos" : "⚙️ Editar pesos e tetos"}
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="sc-reload">🔄 Recarregar dados</button>
      </div>

      <div style="margin:12px 0; padding:16px 18px; border-radius:12px; background:var(--surface-2); border:1px solid ${goalReached ? "rgba(16,185,129,0.45)" : "var(--border-light)"};">
        <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:14px;">
          <div>
            <div style="font-size:12px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.04em;">
              Pontuação Calculada · ${escapeHtml(periodText)} ${st.onlyWithProof ? "· Somente com comprovante" : ""}
            </div>
            <div style="display:flex; align-items:baseline; gap:12px; margin-top:4px; flex-wrap:wrap;">
              <span style="font-size:30px; font-weight:800; color:${goalReached ? "#10b981" : "var(--primary,#818cf8)"};" class="mono">${fmtPts(totalCapped)} pts</span>
              ${goal > 0 ? `<span style="font-size:13px; color:var(--text-secondary);">Meta: <b>${fmtPts(goal)} pts</b> (${pct}%${goalReached ? " — Meta atingida!" : ""})</span>` : ""}
              ${totalRaw > totalCapped ? `<span style="font-size:12px; color:var(--warning,#f59e0b);">Bruto sem tetos: ${fmtPts(totalRaw)} pts</span>` : ""}
            </div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn btn-primary btn-sm" id="sc-export-xlsx">📊 Exportar Planilha (.xlsx)</button>
            <button type="button" class="btn btn-primary btn-sm" id="sc-package" ${detailed.length ? "" : "disabled"} title="Exporta a planilha de pontuação e abre o gerador de PDF só com os registros que pontuam neste período">📦 Pacote do interstício</button>
            <button type="button" class="btn btn-secondary btn-sm" id="sc-copy">📋 Copiar Resumo</button>
          </div>
        </div>
        ${goal > 0 ? `<div class="sc-progress-track"><div class="sc-progress-fill ${goalReached ? "done" : ""}" style="width:${pct}%"></div></div>` : ""}
        <div style="font-size:12px; color:var(--text-secondary); margin-top:8px;">
          <b>${detailed.length}</b> registro(s) pontuado(s) em <b>${ruleSummary.filter((b) => b.items.length > 0).length}</b> critério(s) ativos.
        </div>
      </div>

      ${st.showEditor ? `
        <div style="border:1px solid var(--border-light); border-radius:10px; padding:12px 14px; margin-bottom:14px; background:var(--surface-2);">
          <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px;">
            <b style="font-size:13px;">⚙️ Pesos e Tetos do Barema (${escapeHtml(st.activeBarema.name)})</b>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="btn btn-primary btn-sm" id="sc-save-barema">💾 Salvar Barema</button>
              <button type="button" class="btn btn-secondary btn-sm" id="sc-reset-barema">↩️ Restaurar Padrão</button>
              <button type="button" class="btn btn-secondary btn-sm" id="sc-export-json">📤 Exportar JSON</button>
              <button type="button" class="btn btn-secondary btn-sm" id="sc-import-json">📥 Importar JSON</button>
              <input type="file" id="sc-json-file" accept=".json,application/json" style="display:none;" />
            </div>
          </div>
          <div class="tl-table sm" style="max-height:300px;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th>Critério</th>
                  <th style="width:110px;">Peso / item</th>
                  <th style="width:120px;">Teto (vazio = livre)</th>
                </tr>
              </thead>
              <tbody>
                ${st.activeBarema.rules.map((r, ri) => `<tr>
                  <td><span class="badge badge-tipo">${escapeHtml(CATEGORY_SCHEMAS[r.category]?.name || r.category)}</span></td>
                  <td>${escapeHtml(r.label)}</td>
                  <td><input type="number" step="0.5" min="0" class="form-input mono" data-sc-weight="${ri}" value="${r.weight}" style="height:28px; padding:0 8px;" /></td>
                  <td><input type="number" step="0.5" min="0" class="form-input mono" data-sc-cap="${ri}" value="${r.cap != null ? r.cap : ""}" placeholder="Sem teto" style="height:28px; padding:0 8px;" /></td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </div>
      ` : ""}

      <div style="margin-bottom:14px;">
        <b style="font-size:13px; color:var(--text-secondary); display:block; margin-bottom:6px;">Resumo por Critério (clique em uma linha para filtrar os itens abaixo)</b>
        <div class="tl-table sm" style="max-height:240px;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Critério</th>
                <th>Categoria</th>
                <th style="text-align:right; width:74px;">Qtd</th>
                <th style="text-align:right; width:82px;">Peso</th>
                <th style="text-align:right; width:96px;">Bruto</th>
                <th style="text-align:right; width:82px;">Teto</th>
                <th style="text-align:right; width:104px;">Pontos</th>
              </tr>
            </thead>
            <tbody>
              ${ruleSummary.filter((b) => b.items.length > 0).map((b) => `
                <tr data-sc-rule-jump="${b.rule.id}" style="cursor:pointer; ${st.ruleFilter === b.rule.id ? "background:rgba(99,102,241,0.14);" : ""}">
                  <td style="font-weight:600;">${escapeHtml(b.rule.label)}</td>
                  <td><span class="badge badge-tipo">${escapeHtml(CATEGORY_SCHEMAS[b.rule.category]?.name || b.rule.category)}</span></td>
                  <td style="text-align:right;" class="mono">${b.items.length}</td>
                  <td style="text-align:right;" class="mono">${fmtPts(b.rule.weight)}</td>
                  <td style="text-align:right;" class="mono">${fmtPts(b.rawPts)}</td>
                  <td style="text-align:right;" class="mono">${b.rule.cap != null ? fmtPts(b.rule.cap) : "—"}</td>
                  <td style="text-align:right; font-weight:700; color:var(--primary,#818cf8);" class="mono">${fmtPts(b.cappedPts)}</td>
                </tr>
              `).join("") || `<tr><td colspan="7" style="text-align:center; padding:16px; color:var(--text-secondary);">Nenhum registro pontuou com os filtros atuais.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="tl-bar" style="flex-wrap:wrap; gap:10px; margin-bottom:6px;">
        <select id="sc-rule-filter" class="form-select" style="width:auto; min-width:240px; height:32px;">
          <option value="all">Todos os critérios pontuados (${detailed.length})</option>
          ${ruleSummary.filter((b) => b.items.length > 0).map((b) =>
            `<option value="${b.rule.id}" ${st.ruleFilter === b.rule.id ? "selected" : ""}>${escapeHtml(b.rule.label)} (${b.items.length} · ${fmtPts(b.cappedPts)} pts)</option>`
          ).join("")}
        </select>
        <input type="text" id="sc-search" class="form-input" value="${escapeHtml(st.query)}" placeholder="Filtrar registros detalhados..." style="flex:1; min-width:180px; height:32px;" />
      </div>

      <div class="tl-table" style="max-height:360px;">
        ${visibleDetails.length ? `
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:68px;">Ano</th>
                <th style="width:160px;">Categoria</th>
                <th style="width:200px;">Critério</th>
                <th>Título / Descrição</th>
                <th style="width:94px;">Comprov.</th>
                <th style="width:82px; text-align:right;">Pontos</th>
              </tr>
            </thead>
            <tbody>
              ${visibleDetails.slice(0, 600).map((it) => `<tr>
                <td class="mono">${it.ano || "—"}</td>
                <td><span class="badge badge-tipo">${escapeHtml(it.categoryLabel)}</span></td>
                <td style="font-size:12px;">${escapeHtml(it.ruleLabel)}</td>
                <td>
                  <div style="font-weight:600;">${escapeHtml(it.titulo)}</div>
                  <div style="font-size:11px; color:var(--text-secondary);">
                    ${it.tipo ? escapeHtml(it.tipo) : ""} ${it.qualis ? `· Qualis <b>${escapeHtml(it.qualis)}</b>` : ""}
                  </div>
                </td>
                <td>${it.hasProof ? `<span class="badge" style="background:rgba(16,185,129,0.16);color:#10b981;">📎 Sim</span>` : `<span style="font-size:11.5px; color:var(--text-secondary);">Não</span>`}</td>
                <td style="text-align:right; font-weight:700;" class="mono">${fmtPts(it.pts)}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        ` : `<div class="tl-empty">Nenhum registro encontrado para o filtro selecionado.</div>`}
      </div>
      `
    );

    // Events
    view.el.querySelector("#sc-preset")?.addEventListener("change", (e) => {
      st.presetId = e.target.value;
      st.activeBarema = getBarema(st.presetId);
      st.yearFrom = st.activeBarema.yearFrom ?? "";
      st.yearTo = st.activeBarema.yearTo ?? "";
      st.goal = st.activeBarema.goal ?? 60;
      st.onlyWithProof = Boolean(st.activeBarema.onlyWithProof);
      st.ruleFilter = "all";
      draw();
    });

    const bindNum = (id, assign) => {
      view.el.querySelector(id)?.addEventListener("input", (e) => {
        const pos = e.target.selectionStart;
        assign(e.target.value);
        draw();
        const el = view.el.querySelector(id);
        if (el) {
          el.focus();
          try {
            if (pos != null) el.setSelectionRange(pos, pos);
          } catch {
            // number input doesn't allow setSelectionRange in some engines
          }
        }
      });
    };
    bindNum("#sc-yfrom", (v) => { st.yearFrom = v; });
    bindNum("#sc-yto", (v) => { st.yearTo = v; });
    bindNum("#sc-goal", (v) => { st.goal = v === "" ? 0 : Number(v); });

    view.el.querySelectorAll("[data-sc-range]").forEach((b) =>
      b.addEventListener("click", () => {
        const val = b.dataset.scRange;
        if (val === "all") {
          st.yearFrom = "";
          st.yearTo = "";
        } else {
          st.yearFrom = CUR_YEAR - Number(val);
          st.yearTo = CUR_YEAR;
        }
        draw();
      })
    );

    view.el.querySelector("#sc-only-proof")?.addEventListener("change", (e) => {
      st.onlyWithProof = e.target.checked;
      draw();
    });

    view.el.querySelector("#sc-toggle-editor")?.addEventListener("click", () => {
      st.showEditor = !st.showEditor;
      draw();
    });

    view.el.querySelector("#sc-reload")?.addEventListener("click", () => loadAllRecords());

    view.el.querySelectorAll("[data-sc-weight]").forEach((inp) =>
      inp.addEventListener("change", () => {
        const ri = Number(inp.dataset.scWeight);
        st.activeBarema.rules[ri].weight = Math.max(0, Number(inp.value || 0));
        draw();
      })
    );
    view.el.querySelectorAll("[data-sc-cap]").forEach((inp) =>
      inp.addEventListener("change", () => {
        const ri = Number(inp.dataset.scCap);
        st.activeBarema.rules[ri].cap = inp.value === "" ? null : Math.max(0, Number(inp.value));
        draw();
      })
    );

    view.el.querySelector("#sc-save-barema")?.addEventListener("click", async () => {
      st.customBaremas = { ...(st.customBaremas || {}) };
      st.customBaremas[st.presetId] = {
        ...st.activeBarema,
        yearFrom: st.yearFrom,
        yearTo: st.yearTo,
        goal: st.goal,
        onlyWithProof: st.onlyWithProof,
        rules: cloneRules(st.activeBarema.rules),
      };
      try {
        await api.setSetting("score_baremas", st.customBaremas);
        showToast("Barema personalizado salvo!", "success");
      } catch (e) {
        showToast(`Erro ao salvar barema: ${e}`, "error");
      }
    });

    view.el.querySelector("#sc-reset-barema")?.addEventListener("click", async () => {
      if (st.customBaremas && st.customBaremas[st.presetId]) {
        delete st.customBaremas[st.presetId];
        await api.setSetting("score_baremas", st.customBaremas).catch(() => {});
      }
      st.activeBarema = getBarema(st.presetId);
      st.yearFrom = st.activeBarema.yearFrom ?? "";
      st.yearTo = st.activeBarema.yearTo ?? "";
      st.goal = st.activeBarema.goal ?? 60;
      st.onlyWithProof = Boolean(st.activeBarema.onlyWithProof);
      showToast("Barema restaurado para o padrão!", "info");
      draw();
    });

    view.el.querySelector("#sc-export-json")?.addEventListener("click", async () => {
      try {
        const dest = await api.selectSavePath(`barema_${st.presetId}.json`, "json");
        if (!dest) return;
        const payload = JSON.stringify({
          ...st.activeBarema,
          yearFrom: st.yearFrom,
          yearTo: st.yearTo,
          goal: st.goal,
          onlyWithProof: st.onlyWithProof,
        }, null, 2);
        await api.writeReport(new TextEncoder().encode(payload));
        showToast("Barema exportado em JSON!", "success");
      } catch (e) {
        showToast(`Erro ao exportar JSON: ${e}`, "error");
      }
    });

    const jsonFileInput = view.el.querySelector("#sc-json-file");
    view.el.querySelector("#sc-import-json")?.addEventListener("click", () => jsonFileInput?.click());
    jsonFileInput?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const parsed = JSON.parse(await f.text());
        if (!Array.isArray(parsed.rules)) throw new Error("JSON inválido: campo 'rules' ausente.");
        st.activeBarema = {
          id: st.presetId,
          name: parsed.name || st.activeBarema.name,
          rules: cloneRules(parsed.rules),
        };
        if ("yearFrom" in parsed) st.yearFrom = parsed.yearFrom ?? "";
        if ("yearTo" in parsed) st.yearTo = parsed.yearTo ?? "";
        if ("goal" in parsed) st.goal = parsed.goal ?? 60;
        if ("onlyWithProof" in parsed) st.onlyWithProof = Boolean(parsed.onlyWithProof);
        showToast("Barema JSON carregado!", "success");
        draw();
      } catch (err) {
        showToast(`Erro ao importar barema JSON: ${err}`, "error");
      }
    });

    view.el.querySelectorAll("[data-sc-rule-jump]").forEach((tr) =>
      tr.addEventListener("click", () => {
        const rid = tr.dataset.scRuleJump;
        st.ruleFilter = st.ruleFilter === rid ? "all" : rid;
        draw();
      })
    );

    view.el.querySelector("#sc-rule-filter")?.addEventListener("change", (e) => {
      st.ruleFilter = e.target.value;
      draw();
    });

    view.el.querySelector("#sc-search")?.addEventListener("input", (e) => {
      st.query = e.target.value;
      const pos = e.target.selectionStart;
      draw();
      const inp = view.el.querySelector("#sc-search");
      if (inp) {
        inp.focus();
        if (pos != null) inp.setSelectionRange(pos, pos);
      }
    });

    view.el.querySelector("#sc-copy")?.addEventListener("click", async () => {
      const lines = [
        `=== SIMULADOR DE PONTUAÇÃO: ${st.activeBarema.name} ===`,
        `Período: ${periodText} | Somente com comprovante: ${st.onlyWithProof ? "Sim" : "Não"}`,
        `Pontuação Total (com tetos): ${fmtPts(totalCapped)} pts (Meta: ${fmtPts(goal)} pts · ${pct}%)`,
        "",
        "--- RESUMO POR CRITÉRIO ---",
        ...ruleSummary
          .filter((b) => b.items.length > 0)
          .map((b) => `${b.rule.label}: ${b.items.length}x ${fmtPts(b.rule.weight)} = ${fmtPts(b.cappedPts)} pts${b.rule.cap != null ? ` (teto ${fmtPts(b.rule.cap)})` : ""}`),
      ];
      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        showToast("Resumo de pontuação copiado!", "success", 3000);
      } catch {
        showToast("Erro ao copiar resumo", "error");
      }
    });

    // Exporta a planilha; devolve true se foi gravada.
    const exportXlsx = async () => {
      try {
        const dest = await api.selectSavePath("pontuacao_curriculo.xlsx", "xlsx");
        if (!dest) return false;
        const resumoSheet = {
          name: "Resumo Pontuação",
          title: `${st.activeBarema.name} (${periodText})`,
          columns: ["Critério", "Categoria", "Quantidade", "Peso Unitário", "Bruto", "Teto", "Pontos Considerados"],
          rows: [
            ...ruleSummary
              .filter((b) => b.items.length > 0)
              .map((b) => [
                b.rule.label,
                CATEGORY_SCHEMAS[b.rule.category]?.name || b.rule.category,
                b.items.length,
                b.rule.weight,
                Number(b.rawPts.toFixed(2)),
                b.rule.cap != null ? b.rule.cap : "Sem teto",
                Number(b.cappedPts.toFixed(2)),
              ]),
            ["TOTAL GERAL", "", detailed.length, "", Number(totalRaw.toFixed(2)), goal > 0 ? `Meta: ${goal}` : "", Number(totalCapped.toFixed(2))],
          ],
        };
        const detalhesSheet = {
          name: "Itens Pontuados",
          title: `Detalhamento (${detailed.length} registros)`,
          columns: ["ID", "Ano", "Categoria", "Critério", "Tipo", "Qualis", "Título / Descrição", "Comprovante", "Pontos"],
          rows: detailed.map((it) => [
            it.id,
            it.ano ?? "",
            it.categoryLabel,
            it.ruleLabel,
            it.tipo,
            it.qualis,
            it.titulo,
            it.hasProof ? "Sim" : "Não",
            it.pts,
          ]),
        };
        await api.exportXlsx([resumoSheet, detalhesSheet]);
        showToast("Planilha de pontuação exportada com sucesso!", "success");
        return true;
      } catch (e) {
        showToast(`Erro ao exportar Excel: ${e}`, "error");
        return false;
      }
    };
    view.el.querySelector("#sc-export-xlsx")?.addEventListener("click", exportXlsx);

    // Pacote: planilha + gerador de PDF restrito aos registros que pontuam no período.
    view.el.querySelector("#sc-package")?.addEventListener("click", async () => {
      await exportXlsx();
      if (!view.openReport) return;
      const withProof = detailed.filter((it) => it.hasProof).length;
      if (withProof < detailed.length) {
        showToast(`${detailed.length - withProof} registro(s) pontuados estão sem comprovante e aparecerão no PDF marcados como "sem comprovante".`, "info", 6000);
      }
      view.openReport({
        title: `Comprovantes · ${st.activeBarema.name}`,
        periodLabel: periodText,
        items: detailed.map((it) => ({ category: it.category, id: it.id })),
      });
    });
  }

  if (!st.recordsByCat && !st.loading) {
    loadAllRecords();
  } else {
    draw();
  }
}

// ==========================================
// 2. EXPORTADOR BIBLIOGRÁFICO (BibTeX / RIS / ABNT / Vancouver)
// ==========================================
const LOWER_PT_SET = new Set(["a", "ao", "aos", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "o", "os", "ou", "para", "pela", "pelas", "pelo", "pelos", "por", "sem", "sob", "sobre", "van", "von", "der", "di", "du", "le"]);

function stripAccents(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function formatAbntAuthor(raw) {
  const s = String(raw || "").trim().replace(/\s+/g, " ");
  if (!s) return "AUTOR, Desconhecido";
  if (s.includes(",")) {
    const [last, ...rest] = s.split(",");
    return `${last.trim().toLocaleUpperCase("pt-BR")}, ${rest.join(",").trim()}`;
  }
  const parts = s.split(" ").filter(Boolean);
  if (parts.length < 2) return s.toLocaleUpperCase("pt-BR");
  let last = parts.pop();
  if (/^(Filho|Júnior|Junior|Neto|Sobrinho|Jr\.?)$/i.test(last) && parts.length > 1) {
    last = `${parts.pop()} ${last}`;
  }
  const initials = parts.filter((p) => !LOWER_PT_SET.has(p.toLowerCase())).map((p) => `${p[0].toLocaleUpperCase("pt-BR")}.`).join(" ");
  return `${last.toLocaleUpperCase("pt-BR")}, ${initials}`;
}

function formatVancouverAuthor(raw) {
  const s = String(raw || "").trim().replace(/\s+/g, " ");
  if (!s) return "Author";
  if (s.includes(",")) {
    const [last, rest] = s.split(",");
    const ini = String(rest || "").trim().split(/[\s.]+/).filter(Boolean).map((p) => p[0].toUpperCase()).join("");
    return `${last.trim()} ${ini}`.trim();
  }
  const parts = s.split(" ").filter(Boolean);
  if (parts.length < 2) return s;
  let last = parts.pop();
  if (/^(Filho|Júnior|Junior|Neto|Sobrinho|Jr\.?)$/i.test(last) && parts.length > 1) {
    last = `${parts.pop()} ${last}`;
  }
  const ini = parts.filter((p) => !LOWER_PT_SET.has(p.toLowerCase())).map((p) => p[0].toUpperCase()).join("");
  return `${last} ${ini}`.trim();
}

function formatBibAuthor(raw) {
  const s = String(raw || "").trim().replace(/\s+/g, " ");
  if (!s) return "Autor Desconhecido";
  if (s.includes(",")) return s;
  const parts = s.split(" ").filter(Boolean);
  if (parts.length < 2) return s;
  const last = parts.pop();
  return `${last}, ${parts.join(" ")}`;
}

function extractDoi(rec) {
  for (const cand of [rec.identifier, rec.url]) {
    const t = String(cand || "").trim();
    const m = t.match(/10\.\d{4,9}\/[^\s"<>]+/i);
    if (m) return m[0].replace(/[.,;)]+$/, "");
  }
  return "";
}

function escapeLatex(s) {
  return String(s || "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1");
}

function makeBibKey(author, year, title, usedKeys) {
  const firstWordAuthor = stripAccents(formatBibAuthor(author).split(",")[0]).toLowerCase().replace(/[^a-z0-9]/g, "") || "autor";
  const stop = new Set(["the", "and", "for", "with", "sobre", "para", "uma", "dos", "das", "from", "into"]);
  const words = stripAccents(title).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !stop.has(w));
  const titleSlug = words[0] || "work";
  const base = `${firstWordAuthor}${year || "nd"}${titleSlug}`;
  let key = base;
  let n = 2;
  while (usedKeys.has(key)) {
    key = `${base}_${n++}`;
  }
  usedKeys.add(key);
  return key;
}

function detectBibType(tipo) {
  const t = String(tipo || "").toLowerCase();
  if (t.includes("capítulo") || t.includes("capitulo")) return "incollection";
  if (t.includes("livro")) return "book";
  if (t.includes("anais") || t.includes("congresso") || t.includes("resumo") || t.includes("evento")) return "inproceedings";
  if (t.includes("artigo")) return "article";
  return "misc";
}

function detectRisType(tipo) {
  const t = String(tipo || "").toLowerCase();
  if (t.includes("capítulo") || t.includes("capitulo")) return "CHAP";
  if (t.includes("livro")) return "BOOK";
  if (t.includes("anais") || t.includes("congresso") || t.includes("resumo") || t.includes("evento")) return "CONF";
  if (t.includes("artigo")) return "JOUR";
  return "GEN";
}

function toBibTeX(recs, opts) {
  const used = new Set();
  const bibAuthor = formatBibAuthor(opts.authorName);
  return recs.map((r) => {
    const entryType = detectBibType(r.tipo);
    const key = makeBibKey(opts.authorName, r.ano, r.titulo, used);
    const doi = extractDoi(r);
    const lines = [`@${entryType}{${key},`];
    lines.push(`  author = {${escapeLatex(bibAuthor)}},`);
    lines.push(`  title = {${escapeLatex(r.titulo || "Sem título")}},`);
    if (r.journal) {
      const venueField = entryType === "book" ? "publisher" : entryType === "inproceedings" || entryType === "incollection" ? "booktitle" : "journal";
      lines.push(`  ${venueField} = {${escapeLatex(r.journal)}},`);
    }
    if (r.ano) lines.push(`  year = {${r.ano}},`);
    if (doi) {
      lines.push(`  doi = {${doi}},`);
      lines.push(`  url = {https://doi.org/${doi}},`);
    } else if (r.url) {
      lines.push(`  url = {${r.url}},`);
    }
    if (opts.includeNotes) {
      const notes = [r.qualis ? `Qualis ${r.qualis}` : "", r.citations != null ? `${r.citations} citacoes` : ""].filter(Boolean);
      if (notes.length) lines.push(`  note = {${escapeLatex(notes.join("; "))}},`);
    }
    lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, "");
    lines.push("}");
    return lines.join("\n");
  }).join("\n\n");
}

function toRis(recs, opts) {
  const risAuthor = formatBibAuthor(opts.authorName);
  return recs.map((r) => {
    const doi = extractDoi(r);
    const lines = [
      `TY  - ${detectRisType(r.tipo)}`,
      `AU  - ${risAuthor}`,
      `TI  - ${r.titulo || "Sem título"}`,
    ];
    if (r.journal) lines.push(`JO  - ${r.journal}`);
    if (r.ano) lines.push(`PY  - ${r.ano}`);
    if (doi) lines.push(`DO  - ${doi}`);
    if (r.url || doi) lines.push(`UR  - ${r.url || `https://doi.org/${doi}`}`);
    if (opts.includeNotes) {
      const notes = [r.qualis ? `Qualis ${r.qualis}` : "", r.citations != null ? `${r.citations} citações` : ""].filter(Boolean);
      if (notes.length) lines.push(`N1  - ${notes.join(" | ")}`);
    }
    lines.push("ER  - ");
    return lines.join("\n");
  }).join("\n\n");
}

function toAbnt(recs, opts) {
  const au = formatAbntAuthor(opts.authorName);
  return recs.map((r) => {
    const doi = extractDoi(r);
    const parts = [`${au}. ${String(r.titulo || "Sem título").replace(/\.$/, "")}.`];
    if (r.journal) parts.push(`${String(r.journal).replace(/\.$/, "")},`);
    if (r.ano) parts.push(`${r.ano}.`);
    if (doi) parts.push(`DOI: https://doi.org/${doi}.`);
    else if (r.url) parts.push(`Disponível em: ${r.url}.`);
    if (opts.includeNotes) {
      const notes = [r.qualis ? `Qualis ${r.qualis}` : "", r.citations != null ? `${r.citations} citações` : ""].filter(Boolean);
      if (notes.length) parts.push(`[${notes.join(" · ")}]`);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }).join("\n\n");
}

function toVancouver(recs, opts) {
  const au = formatVancouverAuthor(opts.authorName);
  return recs.map((r, i) => {
    const doi = extractDoi(r);
    const parts = [`${i + 1}. ${au}. ${String(r.titulo || "Sem título").replace(/\.$/, "")}.`];
    if (r.journal) parts.push(`${String(r.journal).replace(/\.$/, "")}.`);
    if (r.ano) parts.push(`${r.ano};`);
    if (doi) parts.push(`doi:${doi}.`);
    else if (r.url) parts.push(`Available from: ${r.url}`);
    if (opts.includeNotes) {
      const notes = [r.qualis ? `Qualis ${r.qualis}` : "", r.citations != null ? `${r.citations} citations` : ""].filter(Boolean);
      if (notes.length) parts.push(`[${notes.join("; ")}]`);
    }
    return parts.join(" ").replace(/;\s*$/, ".").replace(/\s+/g, " ").trim();
  }).join("\n\n");
}

export function renderBibExporterTool(view) {
  const st = view.state;
  st.format ??= "bibtex"; // "bibtex" | "ris" | "abnt" | "vancouver"
  st.yearFrom ??= "";
  st.yearTo ??= "";
  st.tipoFilter ??= "all";
  st.qualisFilter ??= "all";
  st.query ??= "";
  st.onlyDoi ??= false;
  st.includeNotes ??= false;
  st.authorName ??= "";
  st.producoes ??= null;
  st.loading ??= false;

  if (!st.loadedInit) {
    st.loadedInit = true;
    st.loading = true;
    Promise.all([
      api.getRecords("producoes").catch(() => []),
      api.getSetting("profile").catch(() => null),
      api.getLattesProfile().catch(() => null),
    ]).then(([prods, savedProf, xmlProf]) => {
      st.producoes = Array.isArray(prods) ? prods : [];
      const pName = savedProf?.values?.nome_citacoes || savedProf?.values?.nome || xmlProf?.nome_citacoes || xmlProf?.nome || "";
      if (pName && !st.authorName) st.authorName = String(pName).trim();
      st.loading = false;
      if (view.active === "bib_exporter") renderBibExporterTool(view);
    });
  }

  const allProds = st.producoes || [];
  const tipos = [...new Set(allProds.map((r) => (r.tipo || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const qualisList = [...new Set(allProds.map((r) => (r.qualis || "").trim().toUpperCase()).filter(Boolean))].sort();

  const yf = st.yearFrom !== "" ? Number(st.yearFrom) : null;
  const yt = st.yearTo !== "" ? Number(st.yearTo) : null;
  const q = (st.query || "").trim().toLowerCase();

  const filtered = allProds
    .filter((r) => {
      if (yf !== null && (r.ano == null || Number(r.ano) < yf)) return false;
      if (yt !== null && (r.ano == null || Number(r.ano) > yt)) return false;
      if (st.tipoFilter !== "all" && (r.tipo || "").trim() !== st.tipoFilter) return false;
      if (st.qualisFilter === "A1_A4") {
        if (!["A1", "A2", "A3", "A4"].includes((r.qualis || "").trim().toUpperCase())) return false;
      } else if (st.qualisFilter !== "all") {
        if ((r.qualis || "").trim().toUpperCase() !== st.qualisFilter) return false;
      }
      if (st.onlyDoi && !extractDoi(r)) return false;
      if (q) {
        const hay = `${r.titulo || ""} ${r.journal || ""} ${r.tipo || ""} ${r.qualis || ""} ${r.identifier || ""} ${r.ano || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => (b.ano || 0) - (a.ano || 0) || String(a.titulo || "").localeCompare(String(b.titulo || ""), "pt-BR"));

  const opts = {
    authorName: st.authorName || "Autor",
    includeNotes: Boolean(st.includeNotes),
  };

  let output = "";
  if (filtered.length > 0) {
    if (st.format === "bibtex") output = toBibTeX(filtered, opts);
    else if (st.format === "ris") output = toRis(filtered, opts);
    else if (st.format === "abnt") output = toAbnt(filtered, opts);
    else output = toVancouver(filtered, opts);
  }

  view.shell(
    "Exportador Bibliográfico (BibTeX / RIS / ABNT / Vancouver)",
    "Filtre suas produções por período, tipo ou Qualis e exporte referências prontas para LaTeX, Zotero, Mendeley e relatórios.",
    st.loading && !st.producoes
      ? `<div class="tl-empty">⏳ Carregando produções...</div>`
      : `
        <div class="tl-bar" style="flex-wrap:wrap; gap:10px; align-items:flex-end;">
          <div class="seg tl-seg">
            <button type="button" data-bib-fmt="bibtex" class="${st.format === "bibtex" ? "on" : ""}">BibTeX (.bib)</button>
            <button type="button" data-bib-fmt="ris" class="${st.format === "ris" ? "on" : ""}">RIS (.ris)</button>
            <button type="button" data-bib-fmt="abnt" class="${st.format === "abnt" ? "on" : ""}">ABNT (NBR 6023)</button>
            <button type="button" data-bib-fmt="vancouver" class="${st.format === "vancouver" ? "on" : ""}">Vancouver</button>
          </div>
          <div style="flex:1"></div>
          <button type="button" class="btn btn-secondary btn-sm" id="bib-copy" ${output ? "" : "disabled"}>📋 Copiar tudo</button>
          <button type="button" class="btn btn-primary btn-sm" id="bib-save" ${output ? "" : "disabled"}>💾 Salvar arquivo</button>
        </div>

        <div class="tl-bar" style="flex-wrap:wrap; gap:8px; margin-top:10px;">
          <input type="number" id="bib-yfrom" class="form-input mono" value="${escapeHtml(String(st.yearFrom))}" placeholder="Ano de" style="width:92px; height:32px;" />
          <input type="number" id="bib-yto" class="form-input mono" value="${escapeHtml(String(st.yearTo))}" placeholder="Ano até" style="width:92px; height:32px;" />
          <button type="button" class="btn btn-secondary btn-sm" id="bib-5y">Últimos 5 anos</button>
          <button type="button" class="btn btn-secondary btn-sm" id="bib-all-y">Todos</button>
          <select id="bib-tipo" class="form-select" style="width:auto; min-width:170px; height:32px;">
            <option value="all">Todos os tipos (${allProds.length})</option>
            ${tipos.map((t) => `<option value="${escapeHtml(t)}" ${st.tipoFilter === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
          </select>
          <select id="bib-qualis" class="form-select" style="width:auto; min-width:140px; height:32px;">
            <option value="all" ${st.qualisFilter === "all" ? "selected" : ""}>Qualis: Todos</option>
            <option value="A1_A4" ${st.qualisFilter === "A1_A4" ? "selected" : ""}>Qualis: A1–A4</option>
            ${qualisList.map((qVal) => `<option value="${escapeHtml(qVal)}" ${st.qualisFilter === qVal ? "selected" : ""}>Qualis: ${escapeHtml(qVal)}</option>`).join("")}
          </select>
          <input type="text" id="bib-search" class="form-input" value="${escapeHtml(st.query)}" placeholder="Buscar título ou revista..." style="flex:1; min-width:160px; height:32px;" />
        </div>

        <div class="tl-bar" style="flex-wrap:wrap; gap:12px; margin-top:8px; align-items:center;">
          <div style="display:flex; align-items:center; gap:6px; flex:1; min-width:240px;">
            <label for="bib-author" style="font-size:12.5px; font-weight:600; white-space:nowrap;">Autor principal:</label>
            <input type="text" id="bib-author" class="form-input" value="${escapeHtml(st.authorName)}" placeholder="Nome do autor (preenchido do perfil)" style="height:30px; flex:1;" />
          </div>
          <label style="display:flex; align-items:center; gap:6px; font-size:12.5px; cursor:pointer;">
            <input type="checkbox" id="bib-only-doi" ${st.onlyDoi ? "checked" : ""} /> Apenas com DOI
          </label>
          <label style="display:flex; align-items:center; gap:6px; font-size:12.5px; cursor:pointer;">
            <input type="checkbox" id="bib-notes" ${st.includeNotes ? "checked" : ""} /> Incluir nota de Qualis / Citações
          </label>
          <span style="font-size:12px; color:var(--text-secondary);"><b>${filtered.length}</b> referência(s) gerada(s)</span>
        </div>

        <textarea id="bib-output" readonly class="form-textarea mono" style="width:100%; min-height:360px; margin-top:10px; font-size:12.5px; line-height:1.5; resize:vertical;">${escapeHtml(output || "Nenhuma produção encontrada com os filtros atuais.")}</textarea>
      `
  );

  view.el.querySelectorAll("[data-bib-fmt]").forEach((b) =>
    b.addEventListener("click", () => {
      st.format = b.dataset.bibFmt;
      renderBibExporterTool(view);
    })
  );

  const bindText = (id, key) => {
    view.el.querySelector(id)?.addEventListener("input", (e) => {
      st[key] = e.target.value;
      const pos = e.target.selectionStart;
      renderBibExporterTool(view);
      const el = view.el.querySelector(id);
      if (el) {
        el.focus();
        try {
          if (pos != null) el.setSelectionRange(pos, pos);
        } catch {
          // ignore for number inputs
        }
      }
    });
  };
  bindText("#bib-yfrom", "yearFrom");
  bindText("#bib-yto", "yearTo");
  bindText("#bib-search", "query");
  bindText("#bib-author", "authorName");

  view.el.querySelector("#bib-5y")?.addEventListener("click", () => {
    st.yearFrom = CUR_YEAR - 5;
    st.yearTo = CUR_YEAR;
    renderBibExporterTool(view);
  });
  view.el.querySelector("#bib-all-y")?.addEventListener("click", () => {
    st.yearFrom = "";
    st.yearTo = "";
    renderBibExporterTool(view);
  });

  view.el.querySelector("#bib-tipo")?.addEventListener("change", (e) => {
    st.tipoFilter = e.target.value;
    renderBibExporterTool(view);
  });
  view.el.querySelector("#bib-qualis")?.addEventListener("change", (e) => {
    st.qualisFilter = e.target.value;
    renderBibExporterTool(view);
  });
  view.el.querySelector("#bib-only-doi")?.addEventListener("change", (e) => {
    st.onlyDoi = e.target.checked;
    renderBibExporterTool(view);
  });
  view.el.querySelector("#bib-notes")?.addEventListener("change", (e) => {
    st.includeNotes = e.target.checked;
    renderBibExporterTool(view);
  });

  view.el.querySelector("#bib-copy")?.addEventListener("click", async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      showToast(`${filtered.length} referência(s) copiada(s)!`, "success", 3000);
    } catch {
      showToast("Erro ao copiar para a área de transferência", "error");
    }
  });

  view.el.querySelector("#bib-save")?.addEventListener("click", async () => {
    if (!output) return;
    const ext = st.format === "bibtex" ? "bib" : st.format === "ris" ? "ris" : "txt";
    const suggested = `producoes_${st.format}.${ext}`;
    try {
      const dest = await api.selectSavePath(suggested, ext);
      if (!dest) return;
      await api.writeReport(new TextEncoder().encode(output));
      showToast(`Arquivo salvo: ${dest}`, "success");
    } catch (e) {
      showToast(`Erro ao salvar arquivo: ${e}`, "error");
    }
  });
}
