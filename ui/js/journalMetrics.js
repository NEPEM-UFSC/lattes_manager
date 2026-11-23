// Métricas da revista de cada artigo (CiteScore, percentil, SJR, SNIP) para a coluna "Métricas"
// da tabela de produções. A coluna começa recolhida (selo do quartil) e se expande em uma coluna
// por métrica; a escolha fica guardada no navegador. O Qualis oficial da CAPES não vira coluna:
// aparece na própria coluna Qualis só quando difere do estrato gravado no registro.

import { api } from "./api.js";
import { escapeHtml, renderQualisBadge } from "./utils.js";

let cache = null;
let pending = null;
const KEY = "lm.metricsExpanded";

export const metricsLoaded = () => cache !== null;
export const getMetrics = (id) => (cache ? cache[String(id)] || null : null);

/** Recarrega as métricas (devolve a promessa em andamento, se houver). */
export function loadMetrics() {
  if (pending) return pending;
  pending = api
    .journalMetrics()
    .then((m) => (cache = m || {}))
    .catch(() => (cache = {}))
    .finally(() => (pending = null));
  return pending;
}

/** Chamado depois de importar o Qualis ou consultar o CiteScore. */
export function invalidateMetrics() {
  cache = null;
}

export function isExpanded() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setExpanded(v) {
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    // sem armazenamento: a coluna só não lembra a escolha
  }
}

/** Quartil do Scopus pelo percentil: Q1 = 75–99, Q2 = 50–74, Q3 = 25–49, Q4 = 0–24. */
export function quartil(p) {
  if (p == null) return null;
  return p >= 75 ? "Q1" : p >= 50 ? "Q2" : p >= 25 ? "Q3" : "Q4";
}

const num = (v, d) => (v == null ? null : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const NADA = `<span class="mt-none">—</span>`;
const CARREGANDO = `<span class="mt-none" title="Carregando as métricas…">…</span>`;

function qBadge(p) {
  const q = quartil(p);
  return q ? `<span class="cs-q ${q.toLowerCase()}">${q} · ${p}</span>` : "";
}

/** Texto do tooltip com tudo o que se sabe da revista. */
function resumoTexto(m) {
  const l = [];
  if (m.citescore != null) l.push(`CiteScore ${m.ano ?? ""}: ${num(m.citescore, 1)}`);
  if (m.percentil != null) l.push(`Percentil: ${m.percentil} (${quartil(m.percentil)})${m.area ? ` em ${m.area}` : ""}`);
  if (m.sjr != null) l.push(`SJR: ${num(m.sjr, 3)}`);
  if (m.snip != null) l.push(`SNIP: ${num(m.snip, 3)}`);
  if (m.fora_scopus) l.push("Revista fora do Scopus");
  if (m.citescore != null) l.push("Fonte: Scopus (Elsevier)");
  return l.join("\n");
}

/** Coluna recolhida: selos do Qualis oficial e do quartil/percentil. */
export function renderResumo(r) {
  if (!metricsLoaded()) return CARREGANDO;
  const m = getMetrics(r.id);
  if (!m) return NADA;
  const partes = [];
  if (m.percentil != null) partes.push(qBadge(m.percentil));
  else if (m.citescore != null) partes.push(`<span class="mt-val">CS ${num(m.citescore, 1)}</span>`);
  else if (m.sjr != null) partes.push(`<span class="mt-val">SJR ${num(m.sjr, 2)}</span>`);
  if (!partes.length && m.fora_scopus) partes.push(`<span class="mt-none">fora do Scopus</span>`);
  return partes.length ? `<span class="mt-chips" title="${escapeHtml(resumoTexto(m))}">${partes.join("")}</span>` : NADA;
}

const campo = (fn) => (r) => {
  if (!metricsLoaded()) return CARREGANDO;
  const m = getMetrics(r.id);
  return m ? fn(m) : NADA;
};

/**
 * Coluna Qualis da tabela de produções: o estrato gravado no registro e, quando a tabela oficial
 * da CAPES traz outro (ou o registro está vazio), um aviso com o estrato oficial.
 */
export function renderQualisComOficial(r) {
  const gravado = String(r.qualis || "").trim().toUpperCase();
  const oficial = getMetrics(r.id)?.qualis_capes || null;
  const badge = renderQualisBadge(r.qualis);
  if (!oficial || oficial === gravado) return badge;
  const dica = gravado
    ? `Na tabela oficial do Qualis da CAPES esta revista é ${oficial} (o registro tem ${gravado}). Para padronizar: Ferramentas → Qualis oficial da CAPES → Comparar com meus artigos.`
    : `Na tabela oficial do Qualis da CAPES esta revista é ${oficial}, mas o registro está sem Qualis. Para gravar: Ferramentas → Qualis oficial da CAPES → Comparar com meus artigos.`;
  return `<span class="mt-qualis">${badge}<span class="mt-diff" title="${escapeHtml(dica)}">≠ ${escapeHtml(oficial)}</span></span>`;
}
export const renderPercentil = campo((m) =>
  m.percentil != null
    ? `${qBadge(m.percentil)}${m.area ? `<div class="mt-sub" title="${escapeHtml(m.area)}">${escapeHtml(m.area)}</div>` : ""}`
    : m.fora_scopus
      ? `<span class="mt-none">fora do Scopus</span>`
      : NADA
);
// CiteScore com link para a revista no Scopus (exigência da Elsevier ao exibir o valor)
export const renderCiteScore = campo((m) =>
  m.citescore != null
    ? `${m.url ? `<button type="button" class="mt-link" data-open-url="${escapeHtml(m.url)}" title="Abrir a revista no Scopus">${num(m.citescore, 1)}</button>` : num(m.citescore, 1)}<div class="mt-sub">${m.ano ?? ""}</div>`
    : NADA
);
export const renderSjr = campo((m) => (m.sjr != null ? `<span class="mt-val">${num(m.sjr, 3)}</span>` : NADA));
export const renderSnip = campo((m) => (m.snip != null ? `<span class="mt-val">${num(m.snip, 3)}</span>` : NADA));

/** Valor para ordenar as colunas de métricas (null = vazio, vai para o fim). */
export function metricSortValue(key, r) {
  const m = getMetrics(r.id);
  if (!m) return null;
  switch (key) {
    case "m_resumo":
    case "m_percentil":
      return m.percentil ?? null;
    case "m_citescore":
      return m.citescore ?? null;
    case "m_sjr":
      return m.sjr ?? null;
    case "m_snip":
      return m.snip ?? null;
    default:
      return null;
  }
}

/** Colunas da tabela de produções com as métricas (recolhidas ou expandidas) depois do Qualis. */
export function withMetricColumns(columns) {
  const exp = isExpanded();
  const cols = exp
    ? [
        { key: "m_percentil", label: "Percentil", width: "1%", render: renderPercentil, toggle: true, hint: "Percentil CiteScore (Scopus) na melhor área da revista" },
        { key: "m_citescore", label: "CiteScore", width: "1%", render: renderCiteScore, hint: "CiteScore (Scopus) do ano mais recente" },
        { key: "m_sjr", label: "SJR", width: "1%", render: renderSjr, hint: "SCImago Journal Rank" },
        { key: "m_snip", label: "SNIP", width: "1%", render: renderSnip, hint: "Source Normalized Impact per Paper" },
      ]
    : [{ key: "m_resumo", label: "Métricas", width: "1%", render: renderResumo, toggle: true, hint: "Quartil e percentil CiteScore (Scopus) da revista; passe o mouse para ver CiteScore, SJR e SNIP" }];
  const i = columns.findIndex((c) => c.key === "qualis");
  // a coluna Qualis passa a avisar quando o estrato oficial da CAPES é diferente do gravado
  const out = columns.map((c) => (c.key === "qualis" ? { ...c, render: renderQualisComOficial } : c));
  out.splice(i < 0 ? out.length : i + 1, 0, ...cols);
  return out;
}
