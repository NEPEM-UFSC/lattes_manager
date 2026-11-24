// Simulador de Pontuação (Progressão / Promoção / PQ / Concursos)
// e Exportador Bibliográfico (BibTeX / RIS / ABNT / Vancouver).

import { api } from "../../api.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../../utils.js";
import { BASE_LABEL, cloneGroups, cloneRules, DEFAULT_BAREMAS, isUserBarema, recordHasProof, resolveBaremas, RN114_TABELAS, scoreRecords } from "../../scoring.js";

// ==========================================
// 1. SIMULADOR DE PONTUAÇÃO (BAREMA EDITÁVEL)
// ==========================================
const CUR_YEAR = new Date().getFullYear();

const QUALIS_OPCOES = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "B5", "C"];

/** "livro, capítulo" -> regex "livro|capítulo" (termos literais, sem diferenciar maiúsculas). */
function termsToRegex(text) {
  return String(text || "")
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
}

// regex -> texto: "cap[íi]tulo|anais" -> "capítulo, anais"
const regexToText = (re) =>
  String(re || "")
    .replace(/\\b|\^|\$|\(\?!.*?\)/g, "")
    .replace(/\[([^\]])[^\]]*\]/g, "$1")
    .replace(/\(([^()]*)\)\?/g, "")
    .replace(/[()?]/g, "")
    .replace(/\\(.)/g, "$1")
    .split("|")
    .join(", ");

/** Descrição legível de quais registros um critério seleciona. */
function describeMatch(m = {}) {
  if (m.fallback) return "Demais registros da categoria";
  const p = [];
  if (m.qualis) p.push(`Qualis ${m.qualis}`);
  if (m.tipoRegex) p.push(`tipo contém ${regexToText(m.tipoRegex)}`);
  if (m.tipoNotRegex) p.push(`exceto ${regexToText(m.tipoNotRegex)}`);
  if (m.qualisRegex) p.push(`Qualis ${m.qualisRegex.replace(/^\^\[?|\]$/g, "")}`);
  if (m.textoRegex) p.push(`texto contém ${regexToText(m.textoRegex)}`);
  if (m.textoNotRegex) p.push(`texto sem ${regexToText(m.textoNotRegex)}`);
  if (m.campos) for (const [k, v] of Object.entries(m.campos)) p.push(/andamento/.test(v) ? "concluída" : `${k} contém ${regexToText(v)}`);
  if (m.horasMin != null && m.horasMin !== "") p.push(`≥ ${m.horasMin} h`);
  if (m.autoresMax != null && m.autoresMax !== "") p.push(`até ${m.autoresMax} autor(es)`);
  return p.length ? p.join(" · ") : "Todos da categoria";
}

/**
 * Insere o critério antes do "demais registros" da categoria (cada registro conta no primeiro
 * critério da categoria que atender); sem esse curinga, entra depois do último da categoria.
 */
function insertRule(rules, rule) {
  const fb = rules.findIndex((r) => r.category === rule.category && r.match?.fallback);
  if (fb >= 0) {
    rules.splice(fb, 0, rule);
    return;
  }
  let last = -1;
  rules.forEach((r, i) => {
    if (r.category === rule.category) last = i;
  });
  rules.splice(last >= 0 ? last + 1 : rules.length, 0, rule);
}

function recordTitle(r) {
  return r.titulo || r.descricao || r.disciplina || r.instituicao || r.aluno || `Registro #${r.id}`;
}

/** Tipo do documento pelo nome: pdf, word, excel. */
function docKind(name) {
  const e = String(name || "").toLowerCase().split(".").pop();
  if (e === "pdf") return "pdf";
  if (["doc", "docx", "odt", "rtf"].includes(e)) return "doc";
  if (["xls", "xlsx", "xlsm", "ods", "csv"].includes(e)) return "xls";
  return "arq";
}

function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

function fmtPts(n) {
  return Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

export async function renderScoreCalculatorTool(view) {
  const st = view.state;
  st.presetId ??= "ufsc_rn114";
  st.customBaremas ??= null;
  st.recordsByCat ??= null;
  st.loading ??= false;
  st.showEditor ??= false;
  st.ruleFilter ??= "all";
  st.query ??= "";
  st.newRule ??= { category: "producoes", label: "", tipo: "", texto: "", qualis: "", weight: "1", cap: "", base: "item", table: "pesquisa", group: "", item: "" };
  st.dirty ??= false;

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
        groups: cloneGroups(custom.groups ?? DEFAULT_BAREMAS[id]?.groups),
        rules: cloneRules(custom.rules),
      };
    }
    const def = DEFAULT_BAREMAS[id] || DEFAULT_BAREMAS.ufsc_rn114;
    return {
      ...def,
      docs: Array.isArray(custom?.docs) ? custom.docs : [],
      groups: cloneGroups(def.groups),
      rules: cloneRules(def.rules),
    };
  };

  if (!st.activeBarema || st.activeBarema.id !== st.presetId) {
    st.activeBarema = getBarema(st.presetId);
    st.yearFrom = st.activeBarema.yearFrom ?? "";
    st.yearTo = st.activeBarema.yearTo ?? "";
    st.goal = st.activeBarema.goal ?? 60;
    st.onlyWithProof = Boolean(st.activeBarema.onlyWithProof);
    st.semesters = st.activeBarema.semesters ?? 4;
    st.regime = st.activeBarema.regime ?? "DE";
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

  // Pontua pelo módulo compartilhado (o mesmo do gerador de comprovantes), após o filtro de período
  const evaluateScore = () => {
    const yf = st.yearFrom !== "" && st.yearFrom != null ? Number(st.yearFrom) : null;
    const yt = st.yearTo !== "" && st.yearTo != null ? Number(st.yearTo) : null;
    const barema = { ...st.activeBarema, goal: st.goal, semesters: st.semesters, regime: st.regime };
    const sc = scoreRecords(barema, st.recordsByCat || {}, { onlyWithProof: st.onlyWithProof, period: { from: yf, to: yt } });
    const toDetail = (it) => ({
      id: it.id,
      category: it.category,
      categoryLabel: CATEGORY_SCHEMAS[it.category]?.name || it.category,
      ruleId: it.ruleId,
      ruleLabel: it.ruleLabel,
      ano: it.rec.ano,
      anoFim: it.rec.ano_fim,
      titulo: recordTitle(it.rec),
      tipo: it.rec.tipo || "",
      qualis: it.rec.qualis || "",
      hasProof: recordHasProof(it.rec),
      pts: it.pts,
      note: it.note || (it.anos != null ? `${it.anos} ano(s) novo(s) no período` : ""),
    });
    const ruleSummary = sc.byRule.map((b) => ({ rule: b.rule, items: b.items.map(toDetail), rawPts: b.raw, cappedPts: b.pts }));
    const detailed = ruleSummary.flatMap((b) => b.items);
    detailed.sort((a, b) => (b.ano || 0) - (a.ano || 0) || b.pts - a.pts || a.titulo.localeCompare(b.titulo, "pt-BR"));
    return { totalRaw: sc.totalRaw, totalCapped: sc.totalCapped, ruleSummary, detailed, sc };
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

    const { totalRaw, totalCapped, ruleSummary, detailed, sc } = evaluateScore();
    const rn = sc.mode === "rn114";
    const un = rn ? "un." : "pts";
    // barema organizado em grupos (Grupo I, II...): subtotais e tetos por grupo
    const grupos = rn ? [] : st.activeBarema.groups || [];
    const gm = sc.mode === "grupos";
    const grupoNome = (gid) => grupos.find((g) => g.id === gid)?.name || "Outros";
    /** Grupo do critério: tabela (RN 114), grupo da tabela do barema ou grupo da categoria. */
    const grupoDe = (rule) => {
      if (!rule) return "";
      if (rn) return RN114_TABELAS[rule.table === "ensino" ? "ensino" : "pesquisa"].name;
      if (grupos.length) return grupoNome(rule.group);
      const cs = CATEGORY_SCHEMAS[rule.category];
      return cs?.group || cs?.name || rule.category;
    };
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
    const scCats = Object.keys(CATEGORY_SCHEMAS).filter((k) => !CATEGORY_SCHEMAS[k].legacy);
    // índice do critério vizinho da mesma categoria (a ordem só importa dentro da categoria)
    const sameCatNeighbor = (ri, dir) => {
      const rules = st.activeBarema.rules;
      for (let j = ri + dir; j >= 0 && j < rules.length; j += dir) {
        if (rules[j].category === rules[ri].category) return j;
      }
      return -1;
    };

    view.shell(
      "Simulador de Pontuação (Progressão / Promoção / PQ / Concursos)",
      "Configure os pesos e tetos por categoria/Qualis, filtre o interstício e exporte a planilha pronta em Excel.",
      `
      <div class="tl-bar" style="flex-wrap:wrap; gap:10px; align-items:flex-end;">
        <div style="display:flex; flex-direction:column; gap:4px; min-width:260px; flex:1 1 100%;">
          <label for="sc-preset" style="font-size:11.5px; font-weight:700; color:var(--text-secondary);">Modelo de Barema</label>
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <select id="sc-preset" class="form-select" title="${escapeHtml(st.activeBarema?.name || "")}" style="min-height:34px; padding-top:4px; padding-bottom:4px; line-height:1.35; flex:1; min-width:220px;">
              <optgroup label="Modelos padrão">
                ${resolveBaremas(st.customBaremas).filter((b) => !b.custom).map((b) =>
                  `<option value="${escapeHtml(b.id)}" ${st.presetId === b.id ? "selected" : ""}>${escapeHtml(b.name)}</option>`
                ).join("")}
              </optgroup>
              ${resolveBaremas(st.customBaremas).some((b) => b.custom) ? `<optgroup label="Meus baremas">
                ${resolveBaremas(st.customBaremas).filter((b) => b.custom).map((b) =>
                  `<option value="${escapeHtml(b.id)}" ${st.presetId === b.id ? "selected" : ""}>${escapeHtml(b.name)}</option>`
                ).join("")}
              </optgroup>` : ""}
            </select>
            <button type="button" class="btn btn-secondary btn-sm" id="sc-new-barema" title="Criar um barema novo, vazio, para cadastrar os itens">➕ Novo</button>
            <button type="button" class="btn btn-secondary btn-sm" id="sc-dup-barema" title="Criar um barema novo a partir deste (itens, pesos, tetos, meta e período)">⧉ Duplicar</button>
            ${isUserBarema(st.presetId) ? `
              <button type="button" class="btn btn-secondary btn-sm" id="sc-ren-barema" title="Renomear este barema">✏️</button>
              <button type="button" class="btn btn-secondary btn-sm" id="sc-del-barema" title="Excluir este barema">🗑</button>` : ""}
          </div>
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
        ${rn ? `
        <div style="display:flex; flex-direction:column; gap:4px; width:100px;" title="Semestres efetivamente avaliados (RN 114: 4; mais 1 a cada semestre acrescido pelo art. 11)">
          <label for="sc-sem" style="font-size:11.5px; font-weight:700; color:var(--text-secondary);">Semestres</label>
          <input type="number" id="sc-sem" class="form-input mono" step="1" min="1" max="12" value="${escapeHtml(String(st.semesters))}" style="height:34px;" />
        </div>
        <div style="display:flex; flex-direction:column; gap:4px; width:150px;">
          <label for="sc-regime" style="font-size:11.5px; font-weight:700; color:var(--text-secondary);">Regime</label>
          <select id="sc-regime" class="form-select" style="min-height:34px; padding-top:4px; padding-bottom:4px; line-height:1.35;">
            ${[["DE", "Dedicação exclusiva"], ["40", "40 horas"], ["20", "20 horas"]].map(([v, l]) => `<option value="${v}" ${String(st.regime) === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>` : ""}
      </div>

      <div class="tl-bar" style="flex-wrap:wrap; gap:10px; margin-top:8px;">
        <label style="display:flex; align-items:center; gap:7px; font-size:13px; cursor:pointer;">
          <input type="checkbox" id="sc-only-proof" ${st.onlyWithProof ? "checked" : ""} />
          Contar apenas registros com comprovante anexado
        </label>
        <div style="flex:1"></div>
        <button type="button" class="btn btn-secondary btn-sm" id="sc-toggle-editor">
          ${st.showEditor ? "🔽 Ocultar editor do barema" : "⚙️ Editar itens, pesos e tetos"}
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="sc-toggle-docs" title="Portarias, resoluções, editais e planilhas deste barema">
          📎 Documentos${(st.activeBarema.docs || []).length ? ` (${st.activeBarema.docs.length})` : ""}
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="sc-reload">🔄 Recarregar dados</button>
      </div>

      ${st.showDocs ? `<div class="sc-docs">
        <div class="sc-docs-head">
          <b>📎 Documentos do barema</b>
          <span>Portarias, resoluções, editais e planilhas (PDF, Word ou Excel), guardados na pasta <code>baremas/</code> do currículo e incluídos no backup.</span>
          <button type="button" class="btn btn-primary btn-sm" id="sc-add-docs">➕ Anexar documentos</button>
        </div>
        ${(st.activeBarema.docs || []).map((d, di) => `<div class="sc-doc">
          <span class="sc-doc-ic sc-doc-${docKind(d.name)}">${docKind(d.name).toUpperCase()}</span>
          <a href="#" data-sc-doc-open="${di}" title="Abrir ${escapeHtml(d.name)}">${escapeHtml(d.name)}</a>
          <span class="sc-doc-meta">${fmtBytes(d.size)}${d.addedAt ? ` · ${escapeHtml(new Date(d.addedAt).toLocaleDateString("pt-BR"))}` : ""}</span>
          <button type="button" class="btn btn-secondary btn-sm" data-sc-doc-reveal="${di}" title="Mostrar na pasta">📂</button>
          <button type="button" class="btn btn-secondary btn-sm" data-sc-doc-del="${di}" title="Remover o documento (apaga o arquivo)">🗑</button>
        </div>`).join("") || `<div class="sc-doc-empty">Nenhum documento anexado a este barema.</div>`}
      </div>` : ""}

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
            <button type="button" class="btn btn-secondary btn-sm" id="sc-barema-pdf" title="PDF com a tabela de pontuação do barema: grupos, itens, critérios, pesos e tetos">🖨 PDF do barema</button>
            <button type="button" class="btn btn-primary btn-sm" id="sc-package" ${detailed.length ? "" : "disabled"} title="Exporta a planilha de pontuação e abre o gerador de PDF só com os registros que pontuam neste período">📦 Pacote do interstício</button>
            <button type="button" class="btn btn-secondary btn-sm" id="sc-copy">📋 Copiar Resumo</button>
          </div>
        </div>
        ${goal > 0 ? `<div class="sc-progress-track"><div class="sc-progress-fill ${goalReached ? "done" : ""}" style="width:${pct}%"></div></div>` : ""}
        <div style="font-size:12px; color:var(--text-secondary); margin-top:8px;">
          <b>${detailed.length}</b> registro(s) pontuado(s) em <b>${ruleSummary.filter((b) => b.items.length > 0).length}</b> critério(s) ativos.
        </div>
        ${rn ? `<div class="sc-rn">
          ${sc.groups.map((g) => `<div class="sc-rn-tab" style="--c:${g.color}">
            <b>${escapeHtml(g.name)}</b>
            <span class="mono">t = ${fmtPts(g.conv.t)} un. · u = t ÷ ${g.conv.sem} = ${g.conv.u.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} · p(u) = ${g.conv.pu} (Tabela 4) · × ${g.conv.sem}/4</span>
            <strong class="mono">${fmtPts(g.pts)} pts</strong>
          </div>`).join("") || `<div class="sc-rn-tab"><span>Nenhuma atividade pontuada.</span></div>`}
          <div class="sc-rn-check ${sc.rn114.ensinoOk ? "ok" : "no"}">
            ${sc.rn114.ensinoOk ? "✓" : "✗"} Ensino: <b>${fmtPts(sc.rn114.ensino)} pts</b> — mínimo de ${fmtPts(sc.rn114.ensinoMin)} pts ${String(sc.rn114.regime) === "20" ? "(regime de 20 h: toda a pontuação no ensino)" : `(50% de ${fmtPts(goal)}, art. 12 §2º)`}
          </div>
          <div class="sc-rn-note">RN 114/2017/CUn: unidades = quantidade × FM; em cada tabela, u = unidades ÷ semestres → pontos pela Tabela 4 (máx. 40) → × semestres ÷ 4. Aprovação: ${fmtPts(goal)} pts. Itens por semestre (funções, orientação × semestre) contam 1 semestre por registro.</div>
        </div>` : ""}
        ${gm ? `<div class="sc-rn">
          ${sc.groups.map((g) => `<div class="sc-rn-tab" style="--c:${g.color}">
            <b>${escapeHtml(g.name)}</b>
            <span>${g.qtd} registro(s)${g.groupCap != null ? ` · soma ${fmtPts(g.sum)} · teto do grupo ${fmtPts(g.groupCap)}` : ""}${g.pick === "max" ? " · vale só o de maior pontuação" : ""}${g.allYears ? " · qualquer ano" : ""}${g.before ? " · anteriores ao período" : ""}</span>
            <strong class="mono">${fmtPts(g.pts)} pts</strong>
          </div>`).join("") || `<div class="sc-rn-tab"><span>Nenhum item pontuado.</span></div>`}
        </div>` : ""}
      </div>

      ${st.showEditor ? `
        <div style="border:1px solid var(--border-light); border-radius:10px; padding:12px 14px; margin-bottom:14px; background:var(--surface-2);">
          <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px;">
            <b style="font-size:13px;">⚙️ Itens do Barema (${escapeHtml(st.activeBarema.name)}) · ${st.activeBarema.rules.length} critério(s)
              ${st.dirty ? `<span style="font-weight:600; color:var(--warning,#f59e0b); font-size:12px;"> · alterações não salvas</span>` : ""}</b>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="btn btn-primary btn-sm" id="sc-save-barema">💾 Salvar Barema</button>
              <button type="button" class="btn btn-secondary btn-sm" id="sc-reset-barema">${isUserBarema(st.presetId) ? "↩️ Descartar alterações" : "↩️ Restaurar Padrão"}</button>
              <button type="button" class="btn btn-secondary btn-sm" id="sc-clear-barema" title="Remove todos os itens para cadastrar o barema do zero">🧹 Começar do zero</button>
              <button type="button" class="btn btn-secondary btn-sm" id="sc-export-json">📤 Exportar JSON</button>
              <button type="button" class="btn btn-secondary btn-sm" id="sc-import-json">📥 Importar JSON</button>
              <input type="file" id="sc-json-file" accept=".json,application/json" style="display:none;" />
            </div>
          </div>
          ${!rn ? `<div class="sc-groups">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:${grupos.length ? "8px" : "0"};">
              <b style="font-size:12.5px;">📂 Grupos da tabela</b>
              <span style="font-size:11.5px; color:var(--text-secondary); flex:1; min-width:200px;">${grupos.length
                ? "Subtotais e tetos por grupo. Itens com o mesmo nº (ex.: 2.3.3) dividem o mesmo teto."
                : "Opcional: organize os itens em grupos/seções da tabela do edital (Grupo I, II...), com teto por grupo ou “vale só o maior”. Sem grupos, os subtotais são por categoria."}</span>
              <button type="button" class="btn btn-secondary btn-sm" id="sc-add-group">➕ Grupo</button>
            </div>
            ${grupos.map((g, gi) => `<div class="sc-grp-row">
              <input type="text" class="form-input" data-sc-gname="${gi}" value="${escapeHtml(g.name)}" title="Nome do grupo" />
              <label title="Pontuação máxima do grupo (vazio = sem teto)">Teto <input type="number" step="0.5" min="0" class="form-input mono" data-sc-gcap="${gi}" value="${g.cap != null ? g.cap : ""}" placeholder="—" /></label>
              <label title="Conta só o item de maior pontuação do grupo (ex.: o maior título acadêmico)"><input type="checkbox" data-sc-gmax="${gi}" ${g.pick === "max" ? "checked" : ""} /> vale só o maior</label>
              <label title="O grupo ignora o período De/Até (ex.: títulos obtidos em qualquer ano)"><input type="checkbox" data-sc-gall="${gi}" ${g.allYears ? "checked" : ""} /> qualquer ano</label>
              <label title="O grupo recebe as atividades dos demais grupos realizadas ANTES do período De/Até (ex.: Grupo V do concurso, anteriores aos últimos dez anos), com o teto do grupo"><input type="checkbox" data-sc-gbefore="${gi}" ${g.before ? "checked" : ""} /> anteriores ao período</label>
              <span class="sc-grp-n">${st.activeBarema.rules.filter((r) => r.group === g.id).length} critério(s)</span>
              <button type="button" class="btn btn-secondary btn-sm" data-sc-gdel="${gi}" title="Remover o grupo (os critérios dele vão para “Outros”)" style="padding:0 7px; height:26px;">🗑</button>
            </div>`).join("")}
          </div>` : ""}
          <div style="border:1px dashed var(--border-light); border-radius:8px; padding:10px 12px; margin-bottom:10px; background:var(--surface-1, transparent);">
            <b style="font-size:12.5px; display:block; margin-bottom:8px;">➕ Novo item</b>
            <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end;">
              <label class="sc-nf" style="min-width:170px;">Categoria
                <select class="form-select" data-sc-new="category">
                  ${scCats.map((k) => `<option value="${k}" ${st.newRule.category === k ? "selected" : ""}>${escapeHtml(CATEGORY_SCHEMAS[k].name || k)}</option>`).join("")}
                </select>
              </label>
              <label class="sc-nf" style="flex:1; min-width:200px;">Critério
                <input type="text" class="form-input" data-sc-new="label" value="${escapeHtml(st.newRule.label)}" placeholder="Ex.: Artigo em revista Q1" style="height:30px;" />
              </label>
              <label class="sc-nf" style="min-width:170px;" title="Só conta registros cujo tipo contenha um destes termos (separe por vírgula). Vazio = todos os registros da categoria.">Tipo contém (opcional)
                <input type="text" class="form-input" data-sc-new="tipo" value="${escapeHtml(st.newRule.tipo)}" placeholder="Ex.: livro, capítulo" style="height:30px;" />
              </label>
              <label class="sc-nf" style="min-width:170px;" title="Só conta registros cujo título/descrição contenha um destes termos (separe por vírgula).">Texto contém (opcional)
                <input type="text" class="form-input" data-sc-new="texto" value="${escapeHtml(st.newRule.texto || "")}" placeholder="Ex.: coordenador, internacional" style="height:30px;" />
              </label>
              ${st.newRule.category === "producoes" ? `<label class="sc-nf" style="width:110px;">Qualis
                <select class="form-select" data-sc-new="qualis">
                  <option value="">Qualquer</option>
                  ${QUALIS_OPCOES.map((qv) => `<option value="${qv}" ${st.newRule.qualis === qv ? "selected" : ""}>${qv}</option>`).join("")}
                </select>
              </label>` : ""}
              <label class="sc-nf" style="width:86px;">${rn ? "FM" : "Peso / item"}
                <input type="number" step="0.01" min="0" class="form-input mono" data-sc-new="weight" value="${escapeHtml(String(st.newRule.weight))}" style="height:30px;" />
              </label>
              <label class="sc-nf" style="width:170px;" title="Por item: cada registro vale o peso. Por hora: peso × horas do registro. Por hora semanal: peso × horas ÷ 18 (horas-aula semanais de um semestre).">Base de cálculo
                <select class="form-select" data-sc-new="base">
                  ${Object.entries(BASE_LABEL).map(([v, l]) => `<option value="${v}" ${(st.newRule.base || "item") === v ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}
                </select>
              </label>
              ${grupos.length ? `<label class="sc-nf" style="width:190px;">Grupo
                <select class="form-select" data-sc-new="group">
                  ${grupos.map((g) => `<option value="${escapeHtml(g.id)}" ${st.newRule.group === g.id ? "selected" : ""}>${escapeHtml(g.name)}</option>`).join("")}
                </select>
              </label>` : ""}
              ${!rn ? `<label class="sc-nf" style="width:78px;" title="Nº do item na tabela (ex.: 2.3.3). Itens com o mesmo nº dividem o mesmo teto.">Nº item
                <input type="text" class="form-input mono" data-sc-new="item" value="${escapeHtml(st.newRule.item || "")}" placeholder="2.3.3" style="height:30px;" />
              </label>` : ""}
              ${rn ? `<label class="sc-nf" style="width:170px;">Tabela
                <select class="form-select" data-sc-new="table">
                  <option value="ensino" ${st.newRule.table === "ensino" ? "selected" : ""}>Tabela 1 – Ensino</option>
                  <option value="pesquisa" ${st.newRule.table !== "ensino" ? "selected" : ""}>Tabela 2 – Pesquisa/Extensão</option>
                </select>
              </label>` : `<label class="sc-nf" style="width:110px;">Teto
                <input type="number" step="0.5" min="0" class="form-input mono" data-sc-new="cap" value="${escapeHtml(String(st.newRule.cap))}" placeholder="Sem teto" style="height:30px;" />
              </label>`}
              <button type="button" class="btn btn-primary btn-sm" id="sc-add-rule" style="height:30px;">Adicionar</button>
            </div>
          </div>
          <p style="font-size:11.5px; color:var(--text-secondary); margin:0 0 6px;">Cada registro conta no <b>primeiro</b> critério da sua categoria que ele atender; use ↑ ↓ para mudar a prioridade.</p>
          <div class="tl-table sm" style="max-height:360px;">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:58px;">Ordem</th>
                  <th>Categoria</th>
                  ${grupos.length ? `<th style="width:120px;">Grupo</th>` : ""}
                  <th style="width:30%;">Critério</th>
                  <th>Seleciona</th>
                  <th style="width:92px;">${rn ? "FM" : "Peso / item"}</th>
                  <th style="width:102px;">${rn ? "Tabela" : "Teto"}</th>
                  <th style="width:36px;"></th>
                </tr>
              </thead>
              <tbody>
                ${st.activeBarema.rules.map((r, ri) => `<tr>
                  <td style="white-space:nowrap;">
                    <button type="button" class="btn btn-secondary btn-sm" data-sc-move="${ri}:-1" ${sameCatNeighbor(ri, -1) < 0 ? "disabled" : ""} title="Subir (mais prioridade)" style="padding:0 6px; height:24px;">↑</button><button type="button" class="btn btn-secondary btn-sm" data-sc-move="${ri}:1" ${sameCatNeighbor(ri, 1) < 0 ? "disabled" : ""} title="Descer" style="padding:0 6px; height:24px; margin-left:2px;">↓</button>
                  </td>
                  <td><span class="badge badge-tipo">${escapeHtml(CATEGORY_SCHEMAS[r.category]?.name || r.category)}</span></td>
                  ${grupos.length ? `<td><select class="form-select" data-sc-group="${ri}" title="${escapeHtml(grupoNome(r.group))}" style="min-height:28px; padding:2px 6px; font-size:12px; width:112px;">
                    ${grupos.map((g) => `<option value="${escapeHtml(g.id)}" ${r.group === g.id ? "selected" : ""}>${escapeHtml(g.name.split(/\s[–-]\s/)[0])}</option>`).join("")}
                    <option value="" ${grupos.some((g) => g.id === r.group) ? "" : "selected"}>Outros</option>
                  </select></td>` : ""}
                  <td><input type="text" class="form-input" data-sc-label="${ri}" value="${escapeHtml(r.label)}" style="height:28px; padding:0 8px; width:100%; min-width:150px;" /></td>
                  <td style="font-size:11.5px; color:var(--text-secondary); line-height:1.3;">${escapeHtml(describeMatch(r.match))}${r.base && r.base !== "item" ? `<br><b>${escapeHtml(BASE_LABEL[r.base] || r.base)}</b>` : ""}</td>
                  <td><input type="number" step="0.01" min="0" class="form-input mono" data-sc-weight="${ri}" value="${r.weight}" style="height:28px; padding:0 8px; width:84px;" /></td>
                  <td>${rn
                    ? `<select class="form-select" data-sc-table="${ri}" style="min-height:28px; padding:2px 6px; font-size:12px; width:94px;"><option value="ensino" ${r.table === "ensino" ? "selected" : ""}>1 – Ensino</option><option value="pesquisa" ${r.table !== "ensino" ? "selected" : ""}>2 – Pesq./Ext.</option></select>`
                    : `<input type="number" step="0.5" min="0" class="form-input mono" data-sc-cap="${ri}" value="${r.cap != null ? r.cap : ""}" placeholder="Sem teto" style="height:28px; padding:0 8px; width:94px;" />`}</td>
                  <td><button type="button" class="btn btn-secondary btn-sm" data-sc-del="${ri}" title="Remover este item" style="padding:0 7px; height:24px;">🗑</button></td>
                </tr>`).join("") || `<tr><td colspan="${grupos.length ? 8 : 7}" style="text-align:center; padding:16px; color:var(--text-secondary);">Nenhum item. Cadastre o primeiro acima.</td></tr>`}
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
                <th>${gm ? "Grupo" : "Categoria"}</th>
                <th style="text-align:right; width:74px;">Qtd</th>
                <th style="text-align:right; width:82px;">${rn ? "FM" : "Peso"}</th>
                <th style="text-align:right; width:96px;">${rn ? "Base" : "Bruto"}</th>
                <th style="text-align:right; width:82px;">${rn ? "Tabela" : "Teto"}</th>
                <th style="text-align:right; width:104px;">${rn ? "Unidades" : "Pontos"}</th>
              </tr>
            </thead>
            <tbody>
              ${ruleSummary.filter((b) => b.items.length > 0).map((b) => `
                <tr data-sc-rule-jump="${b.rule.id}" style="cursor:pointer; ${st.ruleFilter === b.rule.id ? "background:rgba(99,102,241,0.14);" : ""}">
                  <td style="font-weight:600;">${escapeHtml(b.rule.label)}</td>
                  <td><span class="badge badge-tipo">${escapeHtml(gm ? grupoNome(b.rule.group) : CATEGORY_SCHEMAS[b.rule.category]?.name || b.rule.category)}</span></td>
                  <td style="text-align:right;" class="mono">${b.items.length}</td>
                  <td style="text-align:right;" class="mono">${b.rule.weight.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
                  <td style="text-align:right;" class="mono">${rn ? escapeHtml((BASE_LABEL[b.rule.base || "item"] || "").replace(/ \(.*\)/, "")) : fmtPts(b.rawPts)}</td>
                  <td style="text-align:right;" class="mono">${rn ? (b.rule.table === "ensino" ? "1" : "2") : b.rule.cap != null ? fmtPts(b.rule.cap) : "—"}</td>
                  <td style="text-align:right; font-weight:700; color:var(--primary,#818cf8);" class="mono">${fmtPts(b.cappedPts)}</td>
                </tr>
              `).join("") || `<tr><td colspan="7" style="text-align:center; padding:16px; color:var(--text-secondary);">Nenhum registro pontuou com os filtros atuais.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="tl-bar" style="flex-wrap:wrap; gap:10px; margin-bottom:6px;">
        <select id="sc-rule-filter" class="form-select" style="width:auto; min-width:240px; min-height:32px; padding-top:4px; padding-bottom:4px; line-height:1.35;">
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
                <th style="width:82px; text-align:right;">${rn ? "Unid." : "Pontos"}</th>
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
                    ${it.tipo ? escapeHtml(it.tipo) : ""} ${it.qualis ? `· Qualis <b>${escapeHtml(it.qualis)}</b>` : ""} ${it.note ? `· <i>${escapeHtml(it.note)}</i>` : ""}
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
    const selectBarema = (id) => {
      st.presetId = id;
      st.activeBarema = getBarema(id);
      st.yearFrom = st.activeBarema.yearFrom ?? "";
      st.yearTo = st.activeBarema.yearTo ?? "";
      st.goal = st.activeBarema.goal ?? 60;
      st.onlyWithProof = Boolean(st.activeBarema.onlyWithProof);
      st.semesters = st.activeBarema.semesters ?? 4;
      st.regime = st.activeBarema.regime ?? "DE";
      st.ruleFilter = "all";
      st.dirty = false;
      draw();
    };
    // troca de barema com alterações não salvas: confirma antes de descartar
    const podeTrocar = () => !st.dirty || window.confirm("Há alterações não salvas neste barema. Descartar e continuar?");

    view.el.querySelector("#sc-preset")?.addEventListener("change", (e) => {
      if (!podeTrocar()) {
        e.target.value = st.presetId;
        return;
      }
      selectBarema(e.target.value);
    });

    /** Cria um barema do usuário (vazio ou cópia do atual), grava e já abre o editor nele. */
    const criarBarema = async (copiar) => {
      const sugestao = copiar ? `${st.activeBarema.name} (cópia)` : "";
      const nome = window.prompt(copiar ? "Nome do novo barema (cópia deste):" : "Nome do novo barema (ex.: Edital PPG 2026):", sugestao);
      if (!nome || !nome.trim()) return;
      if (!copiar && !podeTrocar()) return;
      const id = `user_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const novo = copiar
        ? { ...st.activeBarema, id, name: nome.trim(), custom: true, yearFrom: st.yearFrom, yearTo: st.yearTo, goal: st.goal, onlyWithProof: st.onlyWithProof, semesters: st.semesters, regime: st.regime, groups: cloneGroups(st.activeBarema.groups), rules: cloneRules(st.activeBarema.rules), docs: [] }
        : { id, name: nome.trim(), custom: true, yearFrom: "", yearTo: "", goal: 0, onlyWithProof: false, groups: [], rules: [] };
      st.customBaremas = { ...(st.customBaremas || {}), [id]: novo };
      try {
        await api.setSetting("score_baremas", st.customBaremas);
      } catch (e) {
        showToast(`Erro ao salvar barema: ${e}`, "error");
        return;
      }
      st.showEditor = true;
      selectBarema(id);
      showToast(copiar ? "Barema duplicado. Ajuste os itens e salve." : "Barema criado. Cadastre os itens em “Novo item”.", "success", 4000);
      view.el.querySelector('[data-sc-new="label"]')?.focus();
    };
    view.el.querySelector("#sc-new-barema")?.addEventListener("click", () => criarBarema(false));
    view.el.querySelector("#sc-dup-barema")?.addEventListener("click", () => criarBarema(true));

    view.el.querySelector("#sc-ren-barema")?.addEventListener("click", async () => {
      const nome = window.prompt("Novo nome do barema:", st.activeBarema.name);
      if (!nome || !nome.trim() || nome.trim() === st.activeBarema.name) return;
      st.activeBarema.name = nome.trim();
      const salvo = st.customBaremas?.[st.presetId];
      if (salvo) {
        st.customBaremas = { ...st.customBaremas, [st.presetId]: { ...salvo, name: nome.trim() } };
        await api.setSetting("score_baremas", st.customBaremas).catch((e) => showToast(`Erro ao renomear: ${e}`, "error"));
      }
      draw();
    });

    view.el.querySelector("#sc-del-barema")?.addEventListener("click", async () => {
      const nDocs = (st.activeBarema.docs || []).length;
      if (!window.confirm(`Excluir o barema “${st.activeBarema.name}”${nDocs ? ` e os ${nDocs} documento(s) anexados a ele` : ""}? Esta ação não pode ser desfeita (exporte o JSON antes, se quiser guardar uma cópia).`)) return;
      for (const d of st.activeBarema.docs || []) await api.removeBaremaDocument(d.path).catch(() => {});
      const resto = { ...(st.customBaremas || {}) };
      delete resto[st.presetId];
      st.customBaremas = resto;
      await api.setSetting("score_baremas", st.customBaremas).catch((e) => showToast(`Erro ao excluir: ${e}`, "error"));
      selectBarema("ufsc_rn114");
      showToast("Barema excluído.", "info");
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
    bindNum("#sc-sem", (v) => { st.semesters = Math.max(1, Number(v) || 4); });
    view.el.querySelector("#sc-regime")?.addEventListener("change", (e) => {
      st.regime = e.target.value;
      st.goal = st.regime === "20" ? 20 : 40; // art. 12
      draw();
    });
    // grupos da tabela
    const grpAt = (el, key) => st.activeBarema.groups[Number(el.dataset[key])];
    view.el.querySelector("#sc-add-group")?.addEventListener("click", () => {
      st.activeBarema.groups = [...(st.activeBarema.groups || [])];
      const n = st.activeBarema.groups.length + 1;
      const romano = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n - 1] || String(n);
      const id = `g_${Date.now().toString(36)}`;
      st.activeBarema.groups.push({ id, name: `Grupo ${romano}`, cap: null });
      // primeiro grupo: os critérios existentes entram nele
      if (n === 1) st.activeBarema.rules.forEach((r) => { r.group = id; });
      st.newRule.group = id;
      st.dirty = true;
      draw();
      view.el.querySelector(`[data-sc-gname="${n - 1}"]`)?.select();
    });
    view.el.querySelectorAll("[data-sc-gname]").forEach((inp) =>
      inp.addEventListener("change", () => {
        const v = inp.value.trim();
        if (v) grpAt(inp, "scGname").name = v;
        st.dirty = true;
        draw();
      })
    );
    view.el.querySelectorAll("[data-sc-gcap]").forEach((inp) =>
      inp.addEventListener("change", () => {
        grpAt(inp, "scGcap").cap = inp.value === "" ? null : Math.max(0, Number(inp.value));
        st.dirty = true;
        draw();
      })
    );
    view.el.querySelectorAll("[data-sc-gmax]").forEach((inp) =>
      inp.addEventListener("change", () => {
        const g = grpAt(inp, "scGmax");
        if (inp.checked) g.pick = "max";
        else delete g.pick;
        st.dirty = true;
        draw();
      })
    );
    view.el.querySelectorAll("[data-sc-gall]").forEach((inp) =>
      inp.addEventListener("change", () => {
        const g = grpAt(inp, "scGall");
        if (inp.checked) g.allYears = true;
        else delete g.allYears;
        st.dirty = true;
        draw();
      })
    );
    view.el.querySelectorAll("[data-sc-gbefore]").forEach((inp) =>
      inp.addEventListener("change", () => {
        const g = grpAt(inp, "scGbefore");
        // só um grupo recebe as atividades anteriores
        if (inp.checked) {
          st.activeBarema.groups.forEach((x) => { delete x.before; });
          g.before = true;
          delete g.allYears;
        } else delete g.before;
        st.dirty = true;
        draw();
      })
    );
    view.el.querySelectorAll("[data-sc-gdel]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const gi = Number(btn.dataset.scGdel);
        const g = st.activeBarema.groups[gi];
        const n = st.activeBarema.rules.filter((r) => r.group === g.id).length;
        if (n && !window.confirm(`Remover “${g.name}”? Os ${n} critério(s) dele passam para “Outros”.`)) return;
        st.activeBarema.groups = st.activeBarema.groups.filter((_, i) => i !== gi);
        st.activeBarema.rules.forEach((r) => { if (r.group === g.id) delete r.group; });
        st.dirty = true;
        draw();
      })
    );
    view.el.querySelectorAll("[data-sc-group]").forEach((sel) =>
      sel.addEventListener("change", () => {
        const r = st.activeBarema.rules[Number(sel.dataset.scGroup)];
        if (sel.value) r.group = sel.value;
        else delete r.group;
        st.dirty = true;
        draw();
      })
    );
    view.el.querySelectorAll("[data-sc-table]").forEach((sel) =>
      sel.addEventListener("change", () => {
        st.activeBarema.rules[Number(sel.dataset.scTable)].table = sel.value;
        st.dirty = true;
        draw();
      })
    );

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

    // documentos do barema: gravados na hora (não dependem de "Salvar Barema")
    const salvarDocs = async (docs) => {
      st.activeBarema.docs = docs;
      const atual = st.customBaremas?.[st.presetId] || {};
      st.customBaremas = { ...(st.customBaremas || {}), [st.presetId]: { ...atual, docs } };
      await api.setSetting("score_baremas", st.customBaremas);
    };
    view.el.querySelector("#sc-toggle-docs")?.addEventListener("click", () => {
      st.showDocs = !st.showDocs;
      draw();
    });
    view.el.querySelector("#sc-add-docs")?.addEventListener("click", async () => {
      try {
        const novos = await api.addBaremaDocuments(st.presetId);
        if (!novos?.length) return;
        const agora = new Date().toISOString();
        await salvarDocs([...(st.activeBarema.docs || []), ...novos.map((d) => ({ ...d, addedAt: agora }))]);
        showToast(`${novos.length} documento(s) anexado(s).`, "success");
        draw();
      } catch (e) {
        showToast(`Erro ao anexar: ${e}`, "error");
      }
    });
    const docAt = (el, key) => (st.activeBarema.docs || [])[Number(el.dataset[key])];
    view.el.querySelectorAll("[data-sc-doc-open]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        api.openFile(docAt(a, "scDocOpen").path).catch((err) => showToast(`Não foi possível abrir: ${err}`, "error"));
      })
    );
    view.el.querySelectorAll("[data-sc-doc-reveal]").forEach((b) =>
      b.addEventListener("click", () => api.revealInExplorer(docAt(b, "scDocReveal").path).catch((err) => showToast(`${err}`, "error")))
    );
    view.el.querySelectorAll("[data-sc-doc-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        const d = docAt(b, "scDocDel");
        if (!window.confirm(`Remover “${d.name}” deste barema? O arquivo será apagado da pasta baremas/.`)) return;
        try {
          await api.removeBaremaDocument(d.path);
          await salvarDocs((st.activeBarema.docs || []).filter((x) => x !== d));
          draw();
        } catch (e) {
          showToast(`Erro ao remover: ${e}`, "error");
        }
      })
    );

    view.el.querySelectorAll("[data-sc-weight]").forEach((inp) =>
      inp.addEventListener("change", () => {
        const ri = Number(inp.dataset.scWeight);
        st.activeBarema.rules[ri].weight = Math.max(0, Number(inp.value || 0));
        st.dirty = true;
        draw();
      })
    );
    view.el.querySelectorAll("[data-sc-cap]").forEach((inp) =>
      inp.addEventListener("change", () => {
        const ri = Number(inp.dataset.scCap);
        st.activeBarema.rules[ri].cap = inp.value === "" ? null : Math.max(0, Number(inp.value));
        st.dirty = true;
        draw();
      })
    );
    view.el.querySelectorAll("[data-sc-label]").forEach((inp) =>
      inp.addEventListener("change", () => {
        const ri = Number(inp.dataset.scLabel);
        const v = inp.value.trim();
        if (!v) {
          inp.value = st.activeBarema.rules[ri].label;
          return;
        }
        st.activeBarema.rules[ri].label = v;
        st.dirty = true;
        draw();
      })
    );
    view.el.querySelectorAll("[data-sc-del]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const ri = Number(btn.dataset.scDel);
        const [removed] = st.activeBarema.rules.splice(ri, 1);
        if (removed && st.ruleFilter === removed.id) st.ruleFilter = "all";
        st.dirty = true;
        draw();
      })
    );
    view.el.querySelectorAll("[data-sc-move]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const [ri, dir] = btn.dataset.scMove.split(":").map(Number);
        const j = sameCatNeighbor(ri, dir);
        if (j < 0) return;
        const rules = st.activeBarema.rules;
        [rules[ri], rules[j]] = [rules[j], rules[ri]];
        st.dirty = true;
        draw();
      })
    );

    // formulário "Novo item": guarda o que foi digitado sem redesenhar (exceto a categoria,
    // que mostra/esconde o campo Qualis)
    view.el.querySelectorAll("[data-sc-new]").forEach((inp) => {
      const key = inp.dataset.scNew;
      inp.addEventListener(inp.tagName === "SELECT" ? "change" : "input", () => {
        st.newRule[key] = inp.value;
        if (key === "category") {
          if (inp.value !== "producoes") st.newRule.qualis = "";
          draw();
        }
      });
    });
    view.el.querySelector("#sc-add-rule")?.addEventListener("click", () => {
      const n = st.newRule;
      const label = String(n.label || "").trim();
      if (!label) {
        showToast("Informe o nome do critério.", "error");
        view.el.querySelector('[data-sc-new="label"]')?.focus();
        return;
      }
      const weight = Number(n.weight);
      if (!Number.isFinite(weight) || weight < 0) {
        showToast("Informe um peso válido (0 ou mais).", "error");
        return;
      }
      const cap = n.cap === "" || n.cap == null ? null : Math.max(0, Number(n.cap));
      const match = {};
      const extra = {};
      if (n.base && n.base !== "item") extra.base = n.base;
      if (rn) extra.table = n.table === "ensino" ? "ensino" : "pesquisa";
      if (grupos.length) extra.group = grupos.some((g) => g.id === n.group) ? n.group : grupos[0].id;
      if (!rn && String(n.item || "").trim()) extra.item = String(n.item).trim();
      const tipoRegex = termsToRegex(n.tipo);
      if (tipoRegex) match.tipoRegex = tipoRegex;
      const textoRegex = termsToRegex(n.texto);
      if (textoRegex) match.textoRegex = textoRegex;
      if (n.qualis && n.category === "producoes") match.qualis = n.qualis;
      if (!Object.keys(match).length) match.fallback = true;
      insertRule(st.activeBarema.rules, {
        id: `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        label,
        category: n.category,
        match,
        weight,
        cap: rn ? null : Number.isFinite(cap) ? cap : null,
        ...extra,
      });
      st.newRule = { category: n.category, label: "", tipo: "", texto: "", qualis: "", weight: "1", cap: "", base: n.base || "item", table: n.table || "pesquisa", group: extra.group || "", item: "" };
      st.dirty = true;
      showToast("Item adicionado. Clique em “Salvar Barema” para guardá-lo.", "success", 3500);
      draw();
      view.el.querySelector('[data-sc-new="label"]')?.focus();
    });

    view.el.querySelector("#sc-clear-barema")?.addEventListener("click", () => {
      if (st.activeBarema.rules.length && !window.confirm("Remover todos os itens deste barema para cadastrá-lo do zero? (Nada é gravado até você clicar em Salvar Barema.)")) return;
      st.activeBarema.rules = [];
      st.ruleFilter = "all";
      st.dirty = true;
      draw();
    });

    view.el.querySelector("#sc-save-barema")?.addEventListener("click", async () => {
      st.customBaremas = { ...(st.customBaremas || {}) };
      st.customBaremas[st.presetId] = {
        ...st.activeBarema,
        yearFrom: st.yearFrom,
        yearTo: st.yearTo,
        goal: st.goal,
        onlyWithProof: st.onlyWithProof,
        semesters: st.semesters,
        regime: st.regime,
        groups: cloneGroups(st.activeBarema.groups),
        rules: cloneRules(st.activeBarema.rules),
      };
      try {
        await api.setSetting("score_baremas", st.customBaremas);
        st.dirty = false;
        showToast("Barema personalizado salvo!", "success");
        draw();
      } catch (e) {
        showToast(`Erro ao salvar barema: ${e}`, "error");
      }
    });

    view.el.querySelector("#sc-reset-barema")?.addEventListener("click", async () => {
      // barema próprio: volta à última versão salva (não apaga o barema)
      if (isUserBarema(st.presetId)) {
        selectBarema(st.presetId);
        showToast("Alterações descartadas.", "info");
        return;
      }
      if (st.customBaremas && st.customBaremas[st.presetId]) {
        const docs = st.customBaremas[st.presetId].docs;
        if (Array.isArray(docs) && docs.length) st.customBaremas[st.presetId] = { docs };
        else delete st.customBaremas[st.presetId];
        await api.setSetting("score_baremas", st.customBaremas).catch(() => {});
      }
      st.activeBarema = getBarema(st.presetId);
      st.yearFrom = st.activeBarema.yearFrom ?? "";
      st.yearTo = st.activeBarema.yearTo ?? "";
      st.goal = st.activeBarema.goal ?? 60;
      st.onlyWithProof = Boolean(st.activeBarema.onlyWithProof);
      st.dirty = false;
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
          semesters: st.semesters,
          regime: st.regime,
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
        const nomeJson = parsed.name || f.name.replace(/\.json$/i, "");
        if (window.confirm(`Criar um barema NOVO com “${nomeJson}”?\n\nOK = novo barema em “Meus baremas”\nCancelar = substituir os itens do barema aberto (“${st.activeBarema.name}”)`)) {
          const id = `user_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
          st.customBaremas = {
            ...(st.customBaremas || {}),
            [id]: {
              id, name: nomeJson, custom: true, yearFrom: parsed.yearFrom ?? "", yearTo: parsed.yearTo ?? "", goal: parsed.goal ?? 0, onlyWithProof: Boolean(parsed.onlyWithProof),
              ...(parsed.mode ? { mode: parsed.mode, semesters: parsed.semesters, regime: parsed.regime } : {}),
              groups: cloneGroups(parsed.groups), rules: cloneRules(parsed.rules),
            },
          };
          await api.setSetting("score_baremas", st.customBaremas);
          st.showEditor = true;
          selectBarema(id);
          showToast(`Barema “${nomeJson}” importado.`, "success");
          return;
        }
        st.activeBarema = {
          ...st.activeBarema,
          id: st.presetId,
          name: isUserBarema(st.presetId) ? st.activeBarema.name : parsed.name || st.activeBarema.name,
          groups: cloneGroups(parsed.groups),
          rules: cloneRules(parsed.rules),
        };
        if ("yearFrom" in parsed) st.yearFrom = parsed.yearFrom ?? "";
        if ("yearTo" in parsed) st.yearTo = parsed.yearTo ?? "";
        if ("goal" in parsed) st.goal = parsed.goal ?? 60;
        if ("onlyWithProof" in parsed) st.onlyWithProof = Boolean(parsed.onlyWithProof);
        st.dirty = true;
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
        `Pontuação ${rn ? "final (RN 114, Tabela 4)" : "Total (com tetos)"}: ${fmtPts(totalCapped)} pts (Meta: ${fmtPts(goal)} pts · ${pct}%)`,
        ...(rn
          ? [
            ...sc.groups.map((g) => `${g.name}: t = ${fmtPts(g.conv.t)} un.; u = t/${g.conv.sem} = ${g.conv.u.toFixed(2)}; p(u) = ${g.conv.pu}; pontos = ${fmtPts(g.pts)}`),
            `Ensino: ${fmtPts(sc.rn114.ensino)} pts (mínimo ${fmtPts(sc.rn114.ensinoMin)}) ${sc.rn114.ensinoOk ? "OK" : "NÃO ATINGIDO"}`,
          ]
          : gm
            ? sc.groups.map((g) => `${g.name}: ${fmtPts(g.pts)} pts${g.groupCap != null ? ` (soma ${fmtPts(g.sum)}; teto ${fmtPts(g.groupCap)})` : ""}${g.pick === "max" ? " (vale só o maior)" : ""}`)
            : []),
        "",
        "--- RESUMO POR CRITÉRIO ---",
        ...ruleSummary
          .filter((b) => b.items.length > 0)
          .map((b) => `${b.rule.label}: ${b.items.length}x ${fmtPts(b.rule.weight)} = ${fmtPts(b.cappedPts)} ${un}${b.rule.cap != null && !rn ? ` (teto ${fmtPts(b.rule.cap)})` : ""}`),
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
          columns: rn
            ? ["Grupo", "Critério", "Categoria", "Quantidade", "FM", "Unidades", "Base", "Unidades consideradas"]
            : ["Grupo", "Critério", "Categoria", "Quantidade", "Peso Unitário", "Bruto", "Teto", "Pontos Considerados"],
          rows: [
            // critérios agrupados na ordem dos grupos
            ...(() => {
              const ativos = ruleSummary.filter((b) => b.items.length > 0);
              const ordem = [...new Set(ativos.map((b) => grupoDe(b.rule)))];
              return ordem.flatMap((gn) => ativos.filter((b) => grupoDe(b.rule) === gn));
            })().map((b) => [
              grupoDe(b.rule),
              b.rule.item ? `${b.rule.item} ${b.rule.label}` : b.rule.label,
              CATEGORY_SCHEMAS[b.rule.category]?.name || b.rule.category,
              b.items.length,
              b.rule.weight,
              Number(b.rawPts.toFixed(2)),
              rn ? (BASE_LABEL[b.rule.base || "item"] || "").replace(/ \(.*\)/, "") : b.rule.cap != null ? b.rule.cap : "Sem teto",
              Number(b.cappedPts.toFixed(2)),
            ]),
            ...(rn
              ? sc.groups.map((g) => [g.name, "Subtotal → Tabela 4", `u = ${g.conv.u.toFixed(2)} (t ÷ ${g.conv.sem})`, g.qtd, `p(u) = ${g.conv.pu}`, Number(g.conv.t.toFixed(2)), `× ${g.conv.sem}/4`, Number(g.pts.toFixed(2))])
              : sc.groups.map((g) => [g.name, "Subtotal", g.pick === "max" ? "vale só o maior" : "", g.qtd, "", Number(g.raw.toFixed(2)), g.groupCap != null ? `Teto do grupo: ${g.groupCap}` : "", Number(g.pts.toFixed(2))])),
            ["TOTAL GERAL", "", "", detailed.length, "", Number(totalRaw.toFixed(2)), goal > 0 ? `Meta: ${goal}` : "", Number(totalCapped.toFixed(2))],
            ...(rn ? [["Ensino (mínimo)", "", "", "", "", "", Number(sc.rn114.ensinoMin.toFixed(2)), Number(sc.rn114.ensino.toFixed(2))]] : []),
          ],
        };
        const detalhesSheet = {
          name: "Itens Pontuados",
          title: `Detalhamento (${detailed.length} registros)`,
          columns: ["Grupo", "ID", "Ano", "Categoria", "Critério", "Tipo", "Qualis", "Título / Descrição", "Comprovante", rn ? "Unidades" : "Pontos"],
          rows: detailed.map((it) => [
            grupoDe(st.activeBarema.rules.find((r) => r.id === it.ruleId)),
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

    view.el.querySelector("#sc-barema-pdf")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try {
        const nome = String(st.activeBarema.name || "barema").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
        const dest = await api.selectSavePath(`Barema - ${nome}.pdf`, "pdf");
        if (!dest) return;
        btn.disabled = true;
        const [{ buildBaremaPdf }, version] = await Promise.all([import("../../pdf/baremaPdf.js"), api.getAppVersion?.().catch(() => "")]);
        const bytes = await buildBaremaPdf(
          { ...st.activeBarema, goal: st.goal, semesters: st.semesters, regime: st.regime },
          {
            period: periodText,
            goal: st.goal,
            onlyWithProof: st.onlyWithProof,
            semesters: st.semesters,
            regime: st.regime,
            describe: (r) => describeMatch(r.match),
            catName: (c) => CATEGORY_SCHEMAS[c]?.name || c,
            version: version || "",
          }
        );
        const saved = await api.writeReport(bytes);
        showToast(`🖨 PDF do barema salvo: ${String(saved).split(/[\\/]/).pop()}`, "success", 4500);
        api.revealInExplorer(saved).catch(() => {});
      } catch (err) {
        showToast(`Erro ao gerar o PDF do barema: ${err}`, "error", 6000);
      } finally {
        btn.disabled = false;
      }
    });

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
        score: { ...sc, period: periodText, byRule: undefined, items: sc.items.map((x) => { const c = { ...x }; delete c.rec; return c; }) },
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
          <select id="bib-tipo" class="form-select" style="width:auto; min-width:170px; min-height:32px; padding-top:4px; padding-bottom:4px; line-height:1.35;">
            <option value="all">Todos os tipos (${allProds.length})</option>
            ${tipos.map((t) => `<option value="${escapeHtml(t)}" ${st.tipoFilter === t ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
          </select>
          <select id="bib-qualis" class="form-select" style="width:auto; min-width:140px; min-height:32px; padding-top:4px; padding-bottom:4px; line-height:1.35;">
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
