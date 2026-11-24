// Ferramentas: utilidades ligadas aos registros e aos arquivos do app.

import { api } from "../api.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast, renderTipoBadge } from "../utils.js";
import { ProofPickerModal } from "./proofPicker.js";
import { renderOpenAlexTool, renderOrcidSyncTool } from "./tools/academicTools.js";
import { renderScoreCalculatorTool, renderBibExporterTool } from "./tools/scoreAndBibTools.js";
import { renderPendenciasTool } from "./tools/pendenciasTool.js";
import { renderQualisTool } from "./tools/qualisTool.js";
import { renderDiscentesTool } from "./tools/discentesTool.js";
import { renderBiblioTool } from "./tools/biblioTool.js";
import { renderCitescoreTool } from "./tools/citescoreTool.js";
import { renderDiagnosticoTool } from "./tools/diagnosticoTool.js";

// ---------- formatação de textos ----------
const LOWER_PT = new Set(["a", "à", "ao", "aos", "as", "às", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "o", "os", "ou", "para", "pela", "pelas", "pelo", "pelos", "por", "sem", "sob", "sobre", "um", "uma", "entre", "após", "contra", "y", "del", "la", "van", "von", "der", "di", "du", "le"]);
const LOWER_EN = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "over", "the", "to", "via", "with", "vs"]);
const ROMAN = /^(?:xl|x{1,3}(?:ix|iv|v?i{0,3})?|(?:ix|iv|v?i{1,3}|v))$/i;

const ACRONYMS = {
  ufsc: "UFSC", ufsm: "UFSM", udesc: "UDESC", unesp: "UNESP", usp: "USP",
  ufrgs: "UFRGS", ufs: "UFS", utfpr: "UTFPR", ufv: "UFV", ufpel: "UFPel",
  ufg: "UFG", ufms: "UFMS", ufmt: "UFMT", ufpr: "UFPR", ufrpe: "UFRPE",
  unideau: "UNIDEAU", ideau: "IDEAU", cnpq: "CNPq", capes: "CAPES",
  fapesc: "FAPESC", fapergs: "FAPERGS", fapesp: "FAPESP", fapemig: "FAPEMIG",
  inpi: "INPI", ibge: "IBGE", embrapa: "Embrapa", epagri: "Epagri",
  rbras: "RBras", seagro: "SEAGRO", sepe: "SEPE", sepex: "SEPEX",
  sica: "SICA", combraf: "COMBRAF", cbmp: "CBMP", sbmp: "SBMP", rbmp: "RBMP",
  sbpc: "SBPC", sodebras: "SODEBRAS", rbas: "RBAS", geafip: "GEAFIP",
  ccr: "CCR", dcaa: "DCAA", gems: "GEMS", "gems-r": "GEMS-R", sigpex: "SIGPEX",
  pdse: "PDSE", rgv: "RGV", moop: "MOOP", tbm: "TBM", gamlss: "GAMLSS",
  anova: "ANOVA", reml: "REML", blup: "BLUP", ammi: "AMMI", mgidi: "MGIDI",
  waasb: "WAASB", waas: "WAAS", "fai-blup": "FAI-BLUP", mtsi: "MTSI",
  mgdii: "MGDII", spad: "SPAD", dgci: "DGCI", rgb: "RGB", vant: "VANT",
  uav: "UAV", qtl: "QTL", gwas: "GWAS", dna: "DNA", rna: "RNA", pcr: "PCR",
  ieee: "IEEE", acm: "ACM", plos: "PLOS", bmc: "BMC", csa: "CSA",
  tcc: "TCC", ic: "IC", ppg: "PPG", app: "APP", ai: "AI", ia: "IA",
  ml: "ML", iot: "IoT",
};

const KEEP_PROPER = new Set([
  "Brasil", "Brazil", "Southern", "Santa", "Catarina", "Rio", "Grande", "Sul", "Paraná", "São", "Paulo",
  "Minas", "Gerais", "Goiás", "Bahia", "Sergipe", "Luís", "Eduardo", "Magalhães", "Florianópolis",
  "Frederico", "Westphalen", "Jacutinga", "Getúlio", "Vargas", "Barra", "Azul", "Cacique", "Doble",
  "Oeste", "Paulista", "Sicredi", "Sucupira", "Tiago", "Olivoto", "Poatã", "Estrada", "Secretaria", "Municipal",
  "Encontro", "Nacional", "ImageR", "Pliman", "Metan", "McGLM", "Rotella", "Benefarm", "Ativa", "Gaussian",
  "Pearson's", "Gower's",
  "Linum", "Glycine", "Avena", "Triticum", "Zea", "Phaseolus", "Sclerotinia", "Azospirillum", "Trichoderma",
  "Thricoderma", "Spodoptera", "Humulus", "Allium", "Cucurbita", "Capsicum", "Fragaria", "Medicago",
  "Cymopsis", "Brachiaria", "Urochloa", "Brassica", "Hordeum", "Secale", "Oryza", "Solanum", "Ipomoea",
]);

const ABBREV_DOT_RE = /(?:\b(?:L|sp|spp|var|cv|subsp|Jr|Sr|Dr|Prof|Inc|Ltd|Co|et al|etc|org|ed|vol|fig|tab|cap|art|no|n|p|pp)|(?:^|[(\s])[A-Z])\.$/i;
const CAMEL_RE = /^(?:[A-Z]+[a-z]+[A-Z]|[a-z]+[A-Z])[A-Za-z0-9À-ÿ]*$/;
const CAP_PREP_WORDS = new Set(["De", "Da", "Do", "Dos", "Das", "Pelo", "Pela", "Para", "Com", "Em"]);

function capFirst(w) {
  return w ? w[0].toLocaleUpperCase("pt-BR") + w.slice(1) : w;
}

function splitToken(w) {
  const m = w.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
  return m ? [m[1], m[2], m[3]] : ["", w, ""];
}

function capWord(w) {
  if (!w) return w;
  // palavras com hífen: Mato-Grossense
  return w
    .split("-")
    .map((p) => capFirst(p))
    .join("-");
}

/** "JOÃO DA SILVA" → "João da Silva" (partículas em minúsculo, siglas preservadas). */
export function titleCaseName(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w, i) => {
      if (ROMAN.test(w) && i > 0) return w.toUpperCase();
      const l = w.toLocaleLowerCase("pt-BR");
      if (i > 0 && LOWER_PT.has(l)) return l;
      return capWord(l);
    })
    .join(" ");
}

function fixJournalToken(w, i, forceCap, allUpper) {
  if (!allUpper && /^\(online\)$/.test(w)) return w;
  const [pre, core, post] = splitToken(w);
  if (!core) return w;
  const low = core.toLocaleLowerCase("pt-BR");
  if (core.includes("/")) {
    const sub = core.split("/").map((p) => {
      const lp = p.toLocaleLowerCase("pt-BR");
      if (ACRONYMS[lp]) return ACRONYMS[lp];
      if (!allUpper && p.length >= 2 && p === p.toLocaleUpperCase("pt-BR") && /\p{L}/u.test(p)) return p;
      if (forceCap || (!allUpper && p[0] && p[0] === p[0].toLocaleUpperCase("pt-BR") && p[0] !== p[0].toLocaleLowerCase("pt-BR"))) {
        return capFirst(lp);
      }
      if (LOWER_PT.has(lp) || LOWER_EN.has(lp)) return lp;
      return capFirst(lp);
    });
    return pre + sub.join("/") + post;
  }
  if (ACRONYMS[low]) return pre + ACRONYMS[low] + post;
  if (ROMAN.test(core) && (core.length >= 2 || i === 0 || allUpper)) return pre + core.toUpperCase() + post;
  if (!allUpper && core.length >= 2 && core === core.toLocaleUpperCase("pt-BR") && /^\p{L}+$/u.test(core)) return w;
  if (i > 0 && !forceCap && (LOWER_PT.has(low) || LOWER_EN.has(low))) return pre + low + post;
  if (core.includes("-")) {
    const hy = core.split("-").map((hp, hi) => {
      const hl = hp.toLocaleLowerCase("pt-BR");
      if (ACRONYMS[hl]) return ACRONYMS[hl];
      if (!allUpper && hp.length >= 2 && hp === hp.toLocaleUpperCase("pt-BR") && /^\p{L}+$/u.test(hp)) return hp;
      if (hi > 0 && (LOWER_PT.has(hl) || LOWER_EN.has(hl))) return hl;
      return capFirst(hl);
    });
    return pre + hy.join("-") + post;
  }
  return pre + capFirst(low) + post;
}

/** Títulos de periódico: "JOURNAL OF PHYTOPATHOLOGY" → "Journal of Phytopathology" (siglas preservadas). */
export function titleCaseJournal(s) {
  const t = String(s || "").trim().replace(/\s+/g, " ");
  if (!t) return t;
  const words = t.split(" ");
  if (words.length === 1 && t === t.toLocaleUpperCase("pt-BR") && t.split("-").every((p) => ACRONYMS[p.toLocaleLowerCase("pt-BR")] || p.length <= 6)) {
    return t;
  }
  const letters = [...t].filter((ch) => /\p{L}/u.test(ch));
  const allUpper = letters.length > 0 && letters.every((ch) => ch === ch.toLocaleUpperCase("pt-BR"));
  return words
    .map((w, i) => {
      const prev = i > 0 ? words[i - 1] : "";
      const forceCap = i === 0 || prev.endsWith(":") || ["-", "–", "—"].includes(prev);
      return fixJournalToken(w, i, forceCap, allUpper);
    })
    .join(" ");
}

/** Normaliza siglas, algarismos romanos e preposições capitalizadas sem forçar Title Case em descrições em frase. */
function normalizeAcronymsAndPreps(s) {
  const t = String(s || "").trim().replace(/\s+/g, " ");
  if (!t || isUpperText(t)) return s;
  const words = t.split(" ");
  if (words.length === 1 && t === t.toLocaleUpperCase("pt-BR")) return s;
  return words
    .map((w, i) => {
      const [pre, core, post] = splitToken(w);
      if (!core) return w;
      if (core.includes("/")) {
        const sub = core.split("/").map((p) => ACRONYMS[p.toLocaleLowerCase("pt-BR")] || p);
        return pre + sub.join("/") + post;
      }
      const low = core.toLocaleLowerCase("pt-BR");
      // Evita alterar termos ambíguos se já minúsculos como palavra comum no meio de frase (ex.: ia, ml)
      if (ACRONYMS[low] && !(core === low && ["ia", "ml", "ai"].includes(low))) {
        return pre + ACRONYMS[low] + post;
      }
      if (ROMAN.test(core) && core.length >= 2 && /[A-Z]/.test(core)) {
        return pre + core.toUpperCase() + post;
      }
      const prev = i > 0 ? words[i - 1] : "";
      const afterBreak = i === 0 || /[:.!?]$/.test(prev) || ["-", "–", "—"].includes(prev);
      if (!afterBreak && CAP_PREP_WORDS.has(core)) {
        return pre + low + post;
      }
      return w;
    })
    .join(" ");
}

/** Sentence case: só a 1ª letra (e siglas/nomes científicos preservados se misto). */
export function sentenceCase(s) {
  const t = String(s || "").trim().replace(/\s+/g, " ");
  if (!t) return t;
  const isUpper = t === t.toUpperCase();
  const body = isUpper ? t.toLocaleLowerCase("pt-BR") : t;
  return body[0].toLocaleUpperCase("pt-BR") + body.slice(1);
}

function isUpperSegment(seg) {
  const s = String(seg || "").trim();
  if (!s || s !== s.toLocaleUpperCase("pt-BR")) return false;
  const alphaWords = s
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter((w) => w.length >= 2);
  if (alphaWords.length < 2) return false;
  const nonAcroLong = alphaWords.filter((w) => w.length >= 4 && !ACRONYMS[w.toLocaleLowerCase("pt-BR")]);
  return nonAcroLong.length >= 1;
}

/** Detecta textos inteiramente em MAIÚSCULAS ou com segmento relevante em MAIÚSCULAS. */
export function isUpperText(s) {
  const t = String(s || "").trim();
  if (!t) return false;
  if (isUpperSegment(t)) return true;
  return t.split(/[:–—]|\s-\s/).some((seg) => isUpperSegment(seg));
}

function smartSentenceSegment(seg) {
  const s = String(seg || "").trim().replace(/\s+/g, " ");
  if (!s) return s;
  const words = s.split(" ");
  const res = words
    .map((w, i) => {
      const [pre, core, post] = splitToken(w);
      if (!core) return w;
      const low = core.toLocaleLowerCase("pt-BR");
      let tok;
      if (ACRONYMS[low]) {
        tok = ACRONYMS[low];
      } else if (core.includes("-") && core.split("-").every((p) => !p || ACRONYMS[p.toLocaleLowerCase("pt-BR")])) {
        tok = core
          .split("-")
          .map((p) => (p ? ACRONYMS[p.toLocaleLowerCase("pt-BR")] : p))
          .join("-");
      } else if (ROMAN.test(core) && (i === 0 || core.length >= 2)) {
        tok = core.toUpperCase();
      } else if (core.length === 1 && core.toUpperCase() === "R" && i > 0) {
        tok = "R";
      } else {
        tok = i === 0 ? capFirst(low) : low;
      }
      return pre + tok + post;
    })
    .join(" ");
  return res ? res[0].toLocaleUpperCase("pt-BR") + res.slice(1) : res;
}

/** Formata textos em MAIÚSCULAS preservando siglas, algarismos romanos e nomes de eventos. */
export function formatUpperText(s, cat = "") {
  if (!isUpperText(s)) return s;
  const t = String(s).trim().replace(/\s+/g, " ");
  if (cat === "eventos" && isUpperSegment(t)) return titleCaseJournal(t);
  if (t.includes(": ")) {
    const parts = t.split(": ");
    const wholeUpper = isUpperSegment(t);
    return parts
      .map((p, idx) => (wholeUpper || isUpperSegment(p) || idx > 0 ? smartSentenceSegment(p) : p))
      .join(": ");
  }
  return smartSentenceSegment(t);
}

/** Converte títulos em Title Case (Iniciais Maiúsculas) para Sentence case com preservação contextual. */
export function titleCaseToSentence(s) {
  const t = String(s || "").trim().replace(/\s+/g, " ");
  if (!t || t === t.toLocaleUpperCase("pt-BR")) return s;
  const words = t.split(" ");
  if (words.length < 5) return s;
  if (/^(Defesa de|Qualificação de|Monitoria\s|Banca\s|Estágio Supervisionado|Comissão\s|Seleção\s|Supervisão\s|Programa Poatã|Site pessoal)/i.test(t)) {
    return s;
  }
  const contentAfter = [];
  const capAfter = [];
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    if (/[:!?]$/.test(prev) || ["-", "–", "—"].includes(prev) || (prev.endsWith(".") && !ABBREV_DOT_RE.test(prev))) continue;
    const bare = words[i].replace(/[^\p{L}\p{N}']/gu, "");
    const low = bare.toLocaleLowerCase("pt-BR");
    if (bare.length < 4 || LOWER_PT.has(low) || LOWER_EN.has(low) || bare === bare.toLocaleUpperCase("pt-BR")) continue;
    if (KEEP_PROPER.has(bare) || CAMEL_RE.test(bare) || /^[A-Z]+\d+/.test(bare)) continue;
    contentAfter.push(bare);
    if (bare[0] && bare[0] === bare[0].toLocaleUpperCase("pt-BR") && bare[0] !== bare[0].toLocaleLowerCase("pt-BR")) {
      capAfter.push(bare);
    }
  }
  if (contentAfter.length < 3 || capAfter.length / contentAfter.length < 0.55) return s;

  return words
    .map((w, i) => {
      const prev = i > 0 ? words[i - 1] : "";
      const startClause = i === 0 || /[:!?]$/.test(prev) || ["-", "–", "—"].includes(prev) || (prev.endsWith(".") && !ABBREV_DOT_RE.test(prev));
      const [pre, core, post] = splitToken(w);
      if (!core) return w;
      const low = core.toLocaleLowerCase("pt-BR");
      let tok;
      if (core.length >= 2 && core === core.toLocaleUpperCase("pt-BR") && /\p{L}/u.test(core)) {
        tok = core;
      } else if (ACRONYMS[low] && !(core === low && ["ia", "ml", "ai"].includes(low))) {
        tok = ACRONYMS[low];
      } else if (KEEP_PROPER.has(core) || CAMEL_RE.test(core) || /^[A-Z]+\d+/.test(core)) {
        tok = core;
      } else if (core.length === 1 && (core === "R" || core === "I" || (core === "L" && post.startsWith(".")))) {
        tok = core;
      } else if (ROMAN.test(core) && core.length >= 2) {
        tok = core.toUpperCase();
      } else if (core.includes("-")) {
        tok = core
          .split("-")
          .map((p, pi) => {
            if (!p) return p;
            const pl = p.toLocaleLowerCase("pt-BR");
            if (p.length >= 2 && p === p.toLocaleUpperCase("pt-BR") && /\p{L}/u.test(p)) return p;
            if (ACRONYMS[pl] && !(p === pl && ["ia", "ml", "ai"].includes(pl))) return ACRONYMS[pl];
            if (KEEP_PROPER.has(p) || CAMEL_RE.test(p)) return p;
            return pi === 0 && startClause ? capFirst(pl) : pl;
          })
          .join("-");
      } else {
        tok = startClause ? capFirst(low) : low;
      }
      return pre + tok + post;
    })
    .join(" ");
}

/** Limpa espaços, pontuação sobrando, traços assimétricos e siglas minúsculas comuns. */
export function cleanSpacesAndPunct(s) {
  let t = String(s || "");
  if (!t.trim()) return s;
  t = t
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+([,.;:?!)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/([,;])([\p{L}])/gu, "$1 $2")
    .replace(/\s+-([\p{L}]{2,})/gu, " - $1")
    .replace(/\b(de|em|para|por):\s+/gi, "$1 ");
  if (t.endsWith("'") && (t.match(/'/g) || []).length === 1) {
    t = t.slice(0, -1).trim();
  }
  if (/[,;:]\s*$/.test(t)) {
    t = t.replace(/[,;:]+\s*$/, "").trim();
  } else if (t.endsWith(".") && !ABBREV_DOT_RE.test(t)) {
    t = t.slice(0, -1).trim();
  }
  t = t
    .replace(/\bai-based\b/gi, "AI-based")
    .replace(/\bimagens aéreas rgb\b/gi, "imagens aéreas RGB")
    .replace(/\(app\)/gi, "(APP)");
  return t;
}

/** "Tiago Olivoto" → "OLIVOTO, T." (ABNT) */
export function abntName(s) {
  const parts = titleCaseName(s).split(" ").filter(Boolean);
  if (parts.length < 2) return parts.join(" ").toUpperCase();
  let last = parts.pop();
  if (/^(Filho|Júnior|Junior|Neto|Sobrinho|Jr\.?)$/i.test(last) && parts.length > 1) last = `${parts.pop()} ${last}`;
  const ini = parts.filter((p) => !LOWER_PT.has(p.toLowerCase())).map((p) => `${p[0].toUpperCase()}.`).join(" ");
  return `${last.toUpperCase()}, ${ini}`;
}

/** "Tiago Olivoto" → "Olivoto T" (Vancouver) */
export function vancouverName(s) {
  const parts = titleCaseName(s).split(" ").filter(Boolean);
  if (parts.length < 2) return parts.join(" ");
  const last = parts.pop();
  return `${last} ${parts.filter((p) => !LOWER_PT.has(p.toLowerCase())).map((p) => p[0].toUpperCase()).join("")}`;
}

export function fileSafe(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MES_ABBR = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };

/** Entende 13/11/2026, 2026-11-13, 13.11.26, "13 de novembro de 2026", "Nov 13, 2026", 20261113. */
export function parseDate(s) {
  const t = String(s || "").trim().toLowerCase();
  let m;
  const y2 = (y) => (y < 100 ? (y > 50 ? 1900 + y : 2000 + y) : y);
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return [+m[1], +m[2], +m[3]];
  if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) return [y2(+m[3]), +m[2], +m[1]];
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) return [+m[1], +m[2], +m[3]];
  if ((m = t.match(/^(\d{1,2})\s*(?:de\s+)?([a-zç]+)\.?\s*(?:de\s+)?(\d{4})/))) {
    const mi = MESES.indexOf(m[2]) + 1 || MES_ABBR[m[2].slice(0, 3)];
    if (mi) return [+m[3], mi, +m[1]];
  }
  if ((m = t.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/))) {
    const mi = MES_ABBR[m[1].slice(0, 3)];
    if (mi) return [+m[3], mi, +m[2]];
  }
  return null;
}

function fmtDate([y, mo, d], kind) {
  const p = (n) => String(n).padStart(2, "0");
  switch (kind) {
    case "br": return `${p(d)}/${p(mo)}/${y}`;
    case "iso": return `${y}-${p(mo)}-${p(d)}`;
    case "ext": return `${d} de ${MESES[mo - 1]} de ${y}`;
    case "abnt": return `${d} ${MESES[mo - 1].slice(0, 3)}${MESES[mo - 1].length > 4 ? "." : ""} ${y}`;
    case "ano": return String(y);
    default: return "";
  }
}

// ---------- catálogo por classes ----------
const TOOL_CLASSES = [
  {
    id: "sync",
    icon: "🔄",
    title: "Sincronização, Comparação & Auditoria de Dados",
    subtitle: "Compare o banco de dados com o XML do Lattes, histórico de versões, Google Scholar e possíveis duplicatas.",
  },
  {
    id: "producoes",
    icon: "📚",
    title: "Produções, DOI, Qualis & Métricas",
    subtitle: "Enriqueça produções com citações do Google Scholar, extração de DOI, download de PDFs e classificação Qualis.",
  },
  {
    id: "arquivos",
    icon: "📂",
    title: "Comprovantes, Pastas & Integridade de Arquivos",
    subtitle: "Localize, vincule, audite, verifique e renomeie comprovantes e pastas do currículo no disco.",
  },
  {
    id: "utilitarios",
    icon: "✨",
    title: "Padronização, Utilitários & Backup",
    subtitle: "Padronize textos, formate nomes/datas e exporte ou restaure backups portáteis completos.",
  },
];

/**
 * Processa `items` com até `concurrency` tarefas ao mesmo tempo (fila compartilhada),
 * parando de pegar novos itens quando `stop()` fica verdadeiro.
 */
async function runPool(items, concurrency, fn, stop = () => false) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length && !stop()) {
      const item = items[cursor++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker()));
}

/** Busca na Crossref com uma nova tentativa quando ela pede para diminuir o ritmo (429) ou cai a conexão. */
async function comRetentativa(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!/429|too many|timed out|timeout|tempo esgotado|conex/i.test(String(e))) throw e;
    await new Promise((r) => setTimeout(r, 2500));
    return fn();
  }
}

/** A Crossref limita requisições simultâneas: a busca pelo título usa no máximo isto. */
const CROSSREF_MAX = 5;

// [id, icon, title, description, classId]
const TOOLS = [
  // Sincronização & Comparação
  ["pendencias", "📋", "Painel de pendências", "Veja os registros sem comprovante, com arquivo ausente, artigos sem DOI ou Qualis e campos vazios, com atalho para corrigir cada um.", "sync"],
  ["cross_check", "🔀", "Checagem Cruzada (BD × XML)", "Compare o banco de dados do software com o XML do Lattes por categoria: interseção (BD ∩ XML), união (BD ∪ XML), faltando no banco e sobrando no banco.", "sync"],
  ["orcid_sync", "🆔", "Sincronizador ORCID (BD × ORCID)", "Consulte a API pública do ORCID, compare com suas produções locais e importe artigos faltantes com 1 clique.", "sync"],
  ["timemachine", "🕰️", "Lattes Time Machine (Comparador)", "Compare o cadastro atual com um novo XML do Lattes (ou compare dois XMLs) e veja todas as novidades, alterações e exclusões.", "sync"],
  ["scholar_unmatched", "🔎", "Artigos do Scholar ausentes no Lattes", "Compare suas publicações do Google Scholar com as do Lattes Manager e cadastre artigos faltantes com 1 clique.", "sync"],
  ["duplicatas", "👯", "Duplicatas e vínculos", "Abre o assistente que liga arquivos soltos aos registros e mostra possíveis registros duplicados.", "sync"],

  // Produções & Métricas
  ["openalex_metrics", "📈", "Métricas OpenAlex (Gratuitas)", "Consulte citações, índice h, acesso aberto, ISSN e coautores diretamente pela API aberta da OpenAlex (sem chave paga).", "producoes"],
  ["score_calculator", "🧮", "Simulador de Pontuação (Progressão / PQ)", "Calcule sua pontuação por interstício com baremas editáveis (CPPD/UFSC, PQ CNPq, Concursos) e exporte a planilha em Excel.", "producoes"],
  ["scholar", "🎓", "Citações Google Scholar (SerpApi)", "Extraia métricas (índice H, i10 e citações) e atualize os artigos publicados no banco de dados automaticamente.", "producoes"],
  ["dois", "🔗", "Extrair DOI dos artigos", "Varre as produções sem DOI: lê o DOI de dentro do PDF anexado e, se não houver, procura pelo título na Crossref.", "producoes"],
  ["pdfs", "⚡", "Baixar PDFs pelos DOIs (lote)", "Itera sobre as produções sem comprovante (ex.: após importar XML), resolve os DOIs de acesso aberto e salva os PDFs na pasta de Produções.", "producoes"],
  ["discentes", "🎓", "Produção com discentes", "Veja quais produções têm seus orientados como coautores, por ano e nível, a partir dos autores do XML do Lattes, e exporte para Excel.", "producoes"],
  ["bibliometria", "🕸️", "Bibliometria e rede de coautoria", "Importe os autores de todas as produções do XML do Lattes e analise coautores, posição de autoria, evolução da colaboração e a rede de colaboração, com exportação para Excel, Gephi e VOSviewer.", "producoes"],
  ["qualis_oficial", "🏛️", "Qualis oficial da CAPES", "Importe a planilha oficial do Qualis (Plataforma Sucupira) para o banco, consulte o estrato de qualquer revista e padronize o Qualis dos artigos pelo ISSN ou pelo nome da revista, conferindo cada mudança.", "producoes"],
  ["citescore", "📊", "CiteScore e percentil (Scopus)", "Consulte pela API da Elsevier o CiteScore, o percentil e o quartil das revistas dos seus artigos, com gráficos, ranking das revistas e exportação para Excel.", "producoes"],
  ["qualis", "🏆", "Completar Qualis", "Preenche o Qualis das produções sem estrato usando o que você já atribuiu à mesma revista.", "producoes"],

  // Comprovantes & Arquivos
  ["diagnostico", "🎯", "Diagnóstico da classificação", "Veja quanto o app acerta a categoria e o tipo dos seus comprovantes (cada um testado como se fosse novo) e quais documentos confundem a classificação.", "arquivos"],
  ["vassoura", "🧹", "Vassoura de Comprovantes", "Varra qualquer pasta externa (Downloads, Documentos) para localizar e vincular comprovantes em PDF automaticamente aos registros sem anexo.", "arquivos"],
  ["folders_audit", "🗂️", "Auditoria e Limpeza de Pastas", "Varre a pasta raiz recursivamente para identificar pastas em branco, pastas sem vínculo com subpastas e arquivos soltos, com opções para remover, criar ou vincular.", "arquivos"],
  ["invalid_proofs", "⚠️", "Procurar comprovantes inválidos", "Localize registros com links para PDFs ou imagens que não existem mais no disco e vincule comprovantes válidos com 1 clique.", "arquivos"],
  ["verificar", "🩺", "Verificar arquivos", "Encontra registros cujo arquivo sumiu da pasta e arquivos nas pastas que não estão ligados a nenhum registro.", "arquivos"],
  ["renomear", "🏷️", "Renomear comprovantes", "Renomeia os arquivos pelo título do registro: 001_titulo_do_trabalho.pdf (sem acentos, com _), atualizando os vínculos.", "arquivos"],

  // Padronização, Utilitários & Backup
  ["bib_exporter", "📖", "Exportador Bibliográfico (BibTeX / RIS / ABNT)", "Exporte suas produções filtradas em BibTeX (.bib), RIS (.ris), ABNT ou Vancouver prontos para Zotero, Overleaf e relatórios.", "utilitarios"],
  ["padronizar", "✨", "Padronizar textos dos registros", "Corrige MAIÚSCULAS, espaços duplos e capitalização de nomes de alunos, títulos e periódicos — com prévia antes de aplicar.", "utilitarios"],
  ["formatar", "🔤", "Formatador de nomes e datas", "Cole nomes ou datas e converta: Nome Próprio, ABNT (OLIVOTO, T.), Vancouver, nome de arquivo, dd/mm/aaaa, ISO, por extenso.", "utilitarios"],
  ["backup", "🗄️", "Cofre Portátil de Comprovantes", "Exporte ou restaure um cofre único (.lattespack / .zip) com todos os registros, fotos e comprovantes em PDF, com validação SHA-256.", "utilitarios"],
];

export class ToolsView {
  constructor({ container, onChanged, openLinker, fetchPdf, onCreateWithData, openRecord, openReport }) {
    this.el = container;
    this.onChanged = onChanged;
    this.openLinker = openLinker;
    this.fetchPdf = fetchPdf;
    this.onCreateWithData = onCreateWithData;
    this.openRecord = openRecord;
    this.openReport = openReport;
    this.active = null;
    this.activeClass = "all";
    this.states = {};
  }

  get state() {
    if (!this.active) return {};
    return (this.states[this.active] ||= {});
  }

  set state(v) {
    if (this.active) this.states[this.active] = v;
  }

  getState(k) {
    return (this.states[k] ||= {});
  }

  isRunning(k) {
    const s = this.states[k];
    return Boolean(
      s && (s.running || s.scholarSyncing || s.scanning || s.batchFindingDois || s.openalexSyncing || s.orcidSyncing)
    );
  }

  syncBackgroundBadge() {
    const runningKeys = Object.keys(this.states).filter((k) => this.isRunning(k));
    const navBtn = document.querySelector('.nav-item[data-view="ferramentas"]');
    if (!navBtn) return;
    let badge = navBtn.querySelector(".bg-run-badge");
    if (runningKeys.length > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "nav-count bg-run-badge";
        badge.style.cssText = "background:var(--primary);color:#fff;margin-left:auto;font-size:10px;padding:2px 6px;border-radius:10px;";
        navBtn.appendChild(badge);
      }
      badge.textContent = `⏳ ${runningKeys.length}`;
      badge.title = "Tarefa rodando em segundo plano";
    } else if (badge) {
      badge.remove();
    }
  }

  show() {
    this.active = null;
    this.render();
    this.syncBackgroundBadge();
  }

  render() {
    if (this.active) return this.renderTool();
    const visibleClasses = this.activeClass === "all"
      ? TOOL_CLASSES
      : TOOL_CLASSES.filter((c) => c.id === this.activeClass);

    let cardIndex = 0;
    const renderCard = ([k, ic, t, d]) => {
      const i = cardIndex++;
      const running = this.isRunning(k);
      const finished = !running && Boolean(this.states[k]?.finished);
      const pill = running
        ? `<span style="display:inline-block;margin-top:6px;padding:2px 8px;border-radius:12px;font-size:10.5px;font-weight:700;background:var(--primary-light);color:var(--primary);border:1px solid var(--primary-border);">⏳ Em execução (segundo plano)…</span>`
        : finished
          ? `<span style="display:inline-block;margin-top:6px;padding:2px 8px;border-radius:12px;font-size:10.5px;font-weight:700;background:var(--success-bg,rgba(34,197,94,0.12));color:var(--success-text);">✓ Concluído (ver resultados)</span>`
          : "";
      return `<button type="button" class="tl-card" data-tool="${k}" style="--i:${i}">
            <span class="tl-ic">${ic}</span>
            <div class="tl-card-body">
              <b>${escapeHtml(t)}</b>
              <span>${escapeHtml(d)}</span>
              ${pill}
            </div>
            <i class="tl-go">→</i></button>`;
    };

    this.el.innerHTML = `
      <div class="tl-wrap">
        <div class="tl-class-bar">
          <button type="button" class="tl-class-pill ${this.activeClass === "all" ? "on" : ""}" data-tool-class="all">
            🧰 Todas (${TOOLS.length})
          </button>
          ${TOOL_CLASSES.map((cls) => {
            const count = TOOLS.filter((t) => t[4] === cls.id).length;
            return `<button type="button" class="tl-class-pill ${this.activeClass === cls.id ? "on" : ""}" data-tool-class="${cls.id}">
              ${cls.icon} ${escapeHtml(cls.title)} (${count})
            </button>`;
          }).join("")}
        </div>
        <div class="tl-sections">
          ${visibleClasses.map((cls) => {
            const items = TOOLS.filter((t) => t[4] === cls.id);
            return `<section class="tl-section">
              <div class="tl-section-head">
                <span class="tl-section-ic">${cls.icon}</span>
                <div>
                  <h3 class="tl-section-title">${escapeHtml(cls.title)}</h3>
                  <p class="tl-section-sub">${escapeHtml(cls.subtitle)}</p>
                </div>
                <span class="tl-section-count">${items.length} ferramenta${items.length === 1 ? "" : "s"}</span>
              </div>
              <div class="tl-grid">
                ${items.map(renderCard).join("")}
              </div>
            </section>`;
          }).join("")}
        </div>
      </div>`;

    this.el.querySelectorAll("[data-tool-class]").forEach((b) =>
      b.addEventListener("click", () => {
        this.activeClass = b.dataset.toolClass;
        this.render();
      })
    );
    this.el.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => this.open(b.dataset.tool)));
  }

  open(k) {
    if (k === "duplicatas") return this.openLinker && this.openLinker();
    this.active = k;
    this.render();
  }

  shell(title, sub, body) {
    const t = TOOLS.find((x) => x[0] === this.active);
    this.el.innerHTML = `
      <div class="tl-wrap">
        <div class="tl-panel">
          <div class="tl-head">
            <button type="button" class="btn btn-secondary btn-sm" data-back>← Ferramentas</button>
            <span class="tl-ic sm">${t[1]}</span>
            <div><h2>${escapeHtml(title)}</h2><p>${sub}</p></div>
          </div>
          <div class="tl-body">${body}</div>
        </div>
      </div>`;
    this.el.querySelector("[data-back]").addEventListener("click", () => {
      this.active = null;
      this.render();
    });
  }

  renderTool() {
    ({
      pendencias: () => renderPendenciasTool(this),
      qualis_oficial: () => renderQualisTool(this),
      discentes: () => renderDiscentesTool(this),
      bibliometria: () => renderBiblioTool(this),
      citescore: () => renderCitescoreTool(this),
      diagnostico: () => renderDiagnosticoTool(this),
      scholar: () => this.toolScholar(),
      scholar_unmatched: () => this.toolScholarUnmatched(),
      vassoura: () => this.toolVassoura(),
      invalid_proofs: () => this.toolInvalidProofs(),
      timemachine: () => this.toolTimeMachine(),
      cross_check: () => this.toolCrossCheck(),
      orcid_sync: () => renderOrcidSyncTool(this),
      openalex_metrics: () => renderOpenAlexTool(this),
      score_calculator: () => renderScoreCalculatorTool(this),
      bib_exporter: () => renderBibExporterTool(this),
      backup: () => this.toolBackup(),
      formatar: () => this.toolFormat(),
      padronizar: () => this.toolTidy(),
      renomear: () => this.toolRename(),
      verificar: () => this.toolCheck(),
      folders_audit: () => this.toolFoldersAudit(),
      qualis: () => this.toolQualis(),
      pdfs: () => this.toolPdfs(),
      dois: () => this.toolDois(),
    })[this.active]?.();
  }

  // ===== GOOGLE SCHOLAR (SERPAPI) =====
  async toolScholar() {
    const st = this.state;
    st.scholarConfig ??= null;
    st.scholarLoading ??= false;
    st.scholarSyncing ??= false;
    st.scholarReport ??= null;

    if (!st.scholarConfig && !st.scholarLoading) {
      st.scholarLoading = true;
      try {
        st.scholarConfig = await api.getScholarConfig();
      } catch (e) {
        console.error(e);
      } finally {
        st.scholarLoading = false;
      }
    }

    const cfg = st.scholarConfig || {};
    const rep = st.scholarReport;

    let body = "";

    if (st.scholarSyncing) {
      body = `
        <div class="loading-state" style="display:flex; flex-direction:column; gap:16px; padding:40px 0;">
          <div class="spinner"></div>
          <div style="font-size:14px; font-weight:500;">Consultando Google Scholar via SerpApi e atualizando produções...</div>
          <div style="font-size:12px; color:var(--text-muted);">Normalizando títulos e calculando correspondência de artigos.</div>
        </div>
      `;
    } else {
      body = `
        <div class="scholar-tool-wrap">
          <div class="scholar-metrics-row">
            <div class="scholar-metric-card">
              <div class="scholar-metric-val">${cfg.total_citations != null ? Number(cfg.total_citations).toLocaleString("pt-BR") : "—"}</div>
              <div class="scholar-metric-lbl">Total de Citações</div>
            </div>
            <div class="scholar-metric-card">
              <div class="scholar-metric-val">${cfg.h_index != null ? cfg.h_index : "—"}</div>
              <div class="scholar-metric-lbl">Índice H</div>
            </div>
            <div class="scholar-metric-card">
              <div class="scholar-metric-val">${cfg.i10_index != null ? cfg.i10_index : "—"}</div>
              <div class="scholar-metric-lbl">Índice i10</div>
            </div>
            <div class="scholar-metric-card">
              <div class="scholar-metric-val" style="font-size:13.5px; font-weight:600; line-height:2.2;">${cfg.last_sync || "Nunca"}</div>
              <div class="scholar-metric-lbl">Última Sincronização</div>
            </div>
          </div>

          <div class="scholar-card" style="margin-top:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
              <h3 style="margin:0; font-size:15px; font-weight:600;">Configurações de Acesso</h3>
              ${cfg.author_name ? `<span class="badge" style="background:var(--surface-2); color:var(--text-muted); font-size:11px;">Autor: <b>${escapeHtml(cfg.author_name)}</b></span>` : ""}
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
              <div>
                <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px;">ID do Google Scholar ou Link do Perfil</label>
                <input type="text" id="tool-scholar-id" class="form-input" style="width:100%;" placeholder="Ex: J_1kLk8AAAAJ ou URL do perfil" value="${escapeHtml(cfg.author_id || "")}" />
              </div>
              <div>
                <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px;">Chave SerpApi (SERPAPI_KEY)</label>
                <div style="display:flex; gap:8px;">
                  <input type="password" id="tool-scholar-key" class="form-input" style="flex:1;" placeholder="Cole sua chave SerpApi..." value="${escapeHtml(cfg.serpapi_key || "")}" />
                  <button type="button" class="btn btn-secondary btn-sm" id="btn-toggle-tool-key" style="padding:0 12px;">👁️</button>
                </div>
              </div>
            </div>

            <div style="margin-top:14px; font-size:12px; color:var(--text-muted);">
              💡 100 buscas mensais gratuitas em <a href="#" id="tool-serpapi-link" style="color:var(--primary); text-decoration:underline;">serpapi.com</a>. O ID pode ser extraído diretamente da URL do seu perfil público.
            </div>

            <div style="margin-top:16px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
              <button type="button" class="btn btn-primary" id="btn-tool-save-scholar">💾 Salvar Credenciais</button>
              <button type="button" class="btn btn-accent" id="btn-tool-sync-scholar">⚡ Sincronizar Citações Agora</button>
              <button type="button" class="btn btn-secondary" id="btn-tool-goto-unmatched">🔎 Ver Artigos Ausentes no Lattes</button>
            </div>
          </div>

          ${rep ? `
            <div class="scholar-card" style="margin-top:20px;">
              <h3 style="margin-bottom:8px; font-size:15px; font-weight:600; color:var(--success);">
                ✓ Sincronização Concluída: ${escapeHtml(rep.author_name || "Autor")}
              </h3>
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:14px;">
                <b>${rep.scholar_articles_found}</b> artigos encontrados no Google Scholar e <b>${rep.matched_count}</b> produções atualizadas no seu banco de dados local.
              </p>
              ${rep.updated_items && rep.updated_items.length > 0 ? `
                <div class="scholar-table-wrap">
                  <table class="scholar-table">
                    <thead>
                      <tr>
                        <th>Ano</th>
                        <th>Título no Lattes Manager</th>
                        <th style="text-align:center;">Citações</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rep.updated_items.map(it => `
                        <tr>
                          <td style="color:var(--text-muted);">${it.ano || "—"}</td>
                          <td style="font-weight:500;">
                            ${escapeHtml(it.titulo)}
                            ${it.scholar_title && it.scholar_title.toLowerCase() !== it.titulo.toLowerCase() ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Scholar: ${escapeHtml(it.scholar_title)}</div>` : ""}
                          </td>
                          <td style="text-align:center; white-space:nowrap;">
                            <span class="badge-citations">💬 ${it.citations_after}</span>
                          </td>
                        </tr>
                      `).join("")}
                    </tbody>
                  </table>
                </div>
              ` : `<p style="font-size:13px; color:var(--text-muted);">Nenhum artigo novo precisou de atualização.</p>`}
            </div>
          ` : ""}
        </div>
      `;
    }

    this.shell(
      "Citações Google Scholar (SerpApi)",
      "Extraia métricas (índice H, i10 e citações) e atualize os artigos publicados automaticamente.",
      body
    );

    if (st.scholarSyncing) return;

    const toggleBtn = this.el.querySelector("#btn-toggle-tool-key");
    const keyInput = this.el.querySelector("#tool-scholar-key");
    if (toggleBtn && keyInput) {
      toggleBtn.addEventListener("click", () => {
        keyInput.type = keyInput.type === "password" ? "text" : "password";
      });
    }

    const serpLink = this.el.querySelector("#tool-serpapi-link");
    if (serpLink) {
      serpLink.addEventListener("click", (e) => {
        e.preventDefault();
        api.openUrl("https://serpapi.com");
      });
    }

    const idInput = this.el.querySelector("#tool-scholar-id");
    const saveBtn = this.el.querySelector("#btn-tool-save-scholar");
    if (saveBtn && idInput && keyInput) {
      saveBtn.addEventListener("click", async () => {
        const authorId = idInput.value.trim();
        const apiKey = keyInput.value.trim();
        try {
          saveBtn.disabled = true;
          await api.saveScholarConfig(authorId, apiKey);
          st.scholarConfig = await api.getScholarConfig();
          showToast("Credenciais do Google Scholar salvas!", "success");
          this.toolScholar();
        } catch (e) {
          showToast(`Erro ao salvar: ${e}`, "error");
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    const syncBtn = this.el.querySelector("#btn-tool-sync-scholar");
    if (syncBtn && idInput && keyInput) {
      syncBtn.addEventListener("click", async () => {
        const authorId = idInput.value.trim();
        const apiKey = keyInput.value.trim();
        if (!authorId) {
          showToast("Informe o ID ou URL do Google Scholar.", "warning");
          idInput.focus();
          return;
        }
        if (!apiKey) {
          showToast("Informe sua chave SerpApi.", "warning");
          keyInput.focus();
          return;
        }

        try {
          st.scholarSyncing = true;
          this.syncBackgroundBadge();
          this.toolScholar();
          showToast("Consultando Google Scholar via SerpApi...", "info", 4000);
          const rep = await api.syncScholarCitations(authorId, apiKey);
          st.scholarReport = rep;
          st.scholarConfig = await api.getScholarConfig();
          const unState = this.getState("scholar_unmatched");
          if (unState) {
            unState.data = null;
            unState.ignoredIds?.clear();
            unState.selectedScholarIds?.clear();
          }
          showToast(`Sincronização concluída! ${rep.matched_count} artigos atualizados.`, "success", 4000);
          this.onChanged && this.onChanged();
        } catch (e) {
          console.error(e);
          showToast(`Falha na sincronização: ${e}`, "error", 6000);
        } finally {
          st.scholarSyncing = false;
          this.syncBackgroundBadge();
          if (this.active === "scholar") this.toolScholar();
          else if (this.active === null && document.getElementById("view-ferramentas")?.classList.contains("active")) this.render();
        }
      });
    }

    this.el.querySelector("#btn-tool-goto-unmatched")?.addEventListener("click", () => {
      this.open("scholar_unmatched");
    });
  }

  // ===== ARTIGOS DO SCHOLAR AUSENTES NO LATTES =====
  async toolScholarUnmatched() {
    const st = this.state;
    st.filterQuery ??= "";
    st.registeredIds ??= new Set();
    st.ignoredIds ??= new Set();
    st.selectedScholarIds ??= new Set();

    if (!st.data && !st.loading) {
      st.loading = true;
      this.shell(
        "Artigos do Scholar ausentes no Lattes",
        "Comparando publicações com os registros de Produções...",
        `<div class="loading-state" style="display:flex; flex-direction:column; gap:16px; padding:40px 0;"><div class="spinner"></div><div>Carregando publicações do Google Scholar...</div></div>`
      );
      try {
        st.data = await api.getUnmatchedScholarArticles(Boolean(st.forceRefresh));
      } catch (e) {
        st.error = String(e);
      } finally {
        st.loading = false;
        st.forceRefresh = false;
      }
      if (this.active !== "scholar_unmatched") return;
    }

    if (st.error) {
      this.shell(
        "Artigos do Scholar ausentes no Lattes",
        "Configuração ou consulta ao Google Scholar",
        `<div class="scholar-card" style="text-align:center; padding:32px 16px;">
          <div style="font-size:32px; margin-bottom:12px;">⚠️</div>
          <div style="font-weight:600; margin-bottom:8px; color:var(--danger);">${escapeHtml(st.error)}</div>
          <p style="font-size:13px; color:var(--text-muted); max-width:500px; margin:0 auto 20px;">
            Certifique-se de que o ID do Google Scholar e a chave SerpApi estão configurados nas configurações de API.
          </p>
          <div style="display:flex; gap:10px; justify-content:center;">
            <button type="button" class="btn btn-primary" data-go-scholar>🎓 Configurações do Scholar</button>
            <button type="button" class="btn btn-secondary" data-retry-unmatched>🔄 Tentar novamente</button>
          </div>
        </div>`
      );
      this.el.querySelector("[data-go-scholar]")?.addEventListener("click", () => this.open("scholar"));
      this.el.querySelector("[data-retry-unmatched]")?.addEventListener("click", () => {
        st.error = null;
        st.data = null;
        this.toolScholarUnmatched();
      });
      return;
    }

    const rep = st.data || { author_name: "", total_scholar: 0, total_matched: 0, unmatched: [] };
    const allUnmatched = rep.unmatched || [];
    const remainingUnmatched = allUnmatched.filter((it, idx) => {
      const sId = it.scholar_id || String(idx);
      return !st.registeredIds.has(sId) && !st.ignoredIds.has(sId);
    });
    const q = (st.filterQuery || "").trim().toLowerCase();
    const visibleList = remainingUnmatched.filter((it) => {
      if (!q) return true;
      const t = (it.title || "").toLowerCase();
      const j = (it.journal || "").toLowerCase();
      const y = String(it.year || "");
      const a = (it.authors || "").toLowerCase();
      const d = (it.doi || "").toLowerCase();
      return t.includes(q) || j.includes(q) || y.includes(q) || a.includes(q) || d.includes(q);
    });

    const missingDoiCount = remainingUnmatched.filter((it) => !it.doi || !String(it.doi).trim()).length;
    const isBatchRunning = Boolean(st.batchFindingDois);
    const batchProg = st.batchProgress || { current: 0, total: 0, found: 0, currentTitle: "" };

    const renderDoiCell = (doi, sId) => {
      const hasDoi = Boolean(doi && String(doi).trim());
      const doiClean = hasDoi ? String(doi).trim() : "";
      if (hasDoi) {
        return `
          <div style="display:inline-flex; align-items:center; gap:5px;">
            <button type="button" class="btn-doi-link" data-open-doi="${escapeHtml(doiClean)}" style="background:none;border:none;padding:0;display:inline-flex;align-items:center;gap:4px;font-family:monospace;font-size:11.5px;color:var(--primary);text-decoration:underline;text-underline-offset:2px;cursor:pointer;" title="Abrir DOI ${escapeHtml(doiClean)} no navegador">
              <span>🌐</span><span style="max-width:115px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(doiClean)}</span>
            </button>
            <button type="button" class="btn-copy-doi ibtn" data-copy-doi="${escapeHtml(doiClean)}" style="padding:2px 5px; font-size:11px; line-height:1; border-radius:4px; opacity:0.85;" title="Copiar DOI (${escapeHtml(doiClean)})">
              📋
            </button>
          </div>
        `;
      }
      return `
        <button type="button" class="btn btn-secondary btn-xs" data-find-doi="${escapeHtml(sId)}" style="font-size:11px; padding:3px 8px;">
          🔍 Buscar DOI
        </button>
      `;
    };

    this.shell(
      "Artigos do Scholar ausentes no Lattes",
      "Identifique e cadastre com 1 clique os artigos indexados no Google Scholar que ainda não estão em Produções.",
      `<div class="scholar-tool-wrap">
        <div class="scholar-metrics-row">
          <div class="scholar-metric-card">
            <div class="scholar-metric-val">${rep.total_scholar}</div>
            <div class="scholar-metric-lbl">Total no Google Scholar</div>
          </div>
          <div class="scholar-metric-card">
            <div class="scholar-metric-val" style="color:var(--success);">${rep.total_matched + st.registeredIds.size}</div>
            <div class="scholar-metric-lbl">Cadastrados no Lattes</div>
          </div>
          <div class="scholar-metric-card">
            <div class="scholar-metric-val" style="color:${remainingUnmatched.length > 0 ? "var(--warning)" : "var(--success)"};">
              ${remainingUnmatched.length}
            </div>
            <div class="scholar-metric-lbl">Ausentes no Lattes</div>
          </div>
          <div class="scholar-metric-card">
            <div class="scholar-metric-val" style="font-size:14px; font-weight:600; line-height:2.2;">
              ${escapeHtml(rep.author_name || "Perfil Conectado")}
            </div>
            <div class="scholar-metric-lbl">Autor Google Scholar</div>
          </div>
        </div>

        <div style="margin-top:20px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; justify-content:space-between;">
          <div style="flex:1; min-width:260px; max-width:480px;">
            <input type="search" id="scholar-unmatched-search" class="form-input" placeholder="Filtrar por título, periódico, ano ou DOI..." value="${escapeHtml(st.filterQuery || "")}" style="width:100%;" />
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            ${st.selectedScholarIds.size > 0 ? `
              <button type="button" class="btn btn-secondary btn-sm" id="btn-scholar-ignore-selected" style="color:var(--danger, #ef4444); border-color:var(--danger-border, rgba(239,68,68,0.35)); font-weight:600;" title="Ocultar os artigos selecionados até a próxima sincronização com o Lattes">
                🚫 Ignorar selecionados (${st.selectedScholarIds.size})
              </button>
            ` : ""}
            ${isBatchRunning ? `
              <button type="button" class="btn btn-secondary btn-sm" id="btn-scholar-stop-batch-doi" style="color:var(--danger); border-color:var(--danger-border, rgba(239,68,68,0.35)); font-weight:600;" title="Interromper busca de DOIs">
                ■ Parar busca (${batchProg.current}/${batchProg.total})
              </button>
            ` : `
              <button type="button" class="btn btn-secondary btn-sm" id="btn-scholar-find-all-dois" ${missingDoiCount === 0 ? "disabled" : ""} title="Busca automaticamente o DOI de todos os artigos pendentes pela Crossref">
                ⚡ Buscar todos os DOIs ${missingDoiCount > 0 ? `(${missingDoiCount})` : ""}
              </button>
            `}
            <button type="button" class="btn btn-secondary btn-sm" id="btn-scholar-force-refresh" title="Recarrega os artigos diretamente da API do Google Scholar" ${isBatchRunning ? "disabled" : ""}>
              🔄 Atualizar do Scholar
            </button>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-scholar-view-metrics" title="Ver métricas completas do Google Scholar">
              🎓 Métricas e Citações
            </button>
          </div>
        </div>

        ${st.ignoredIds.size > 0 ? `
          <div style="margin-top:14px; padding:10px 16px; background:var(--surface-2); border-radius:10px; border:1px solid var(--border-light); display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <div style="font-size:12.5px; color:var(--text-secondary); display:flex; align-items:center; gap:8px;">
              <span style="font-size:16px;">🚫</span>
              <span><b>${st.ignoredIds.size}</b> artigo(s) ignorado(s) (ocultos até a próxima sincronização com o Lattes).</span>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-restore-ignored-scholar" style="font-size:11.5px; padding:4px 10px; white-space:nowrap;" title="Restaurar artigos ignorados nesta listagem">
              ↺ Restaurar ignorados (${st.ignoredIds.size})
            </button>
          </div>
        ` : ""}

        ${isBatchRunning ? `
          <div style="margin-top:12px; padding:10px 14px; background:var(--surface-2); border-radius:10px; border:1px solid var(--border-light);">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; margin-bottom:6px;">
              <span id="scholar-batch-progress-label"><b>Buscando DOIs…</b> ${batchProg.current} de ${batchProg.total} analisado(s) · <b style="color:var(--success);">${batchProg.found} encontrado(s)</b></span>
              <span style="color:var(--text-muted); font-size:11px; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" id="scholar-batch-cur-title">${escapeHtml(batchProg.currentTitle || "")}</span>
            </div>
            <div class="tl-progress" style="margin:0;"><i style="width:${batchProg.total ? Math.round((batchProg.current / batchProg.total) * 100) : 0}%"></i></div>
          </div>
        ` : ""}

        ${remainingUnmatched.length === 0 ? `
          <div class="tl-empty" style="margin-top:24px;">
            <div style="font-size:32px; margin-bottom:10px;">🎉</div>
            <b>Parabéns! Todas as publicações do seu Google Scholar estão cadastradas no Lattes Manager.</b>
            <p style="color:var(--text-muted); font-size:13px; margin-top:6px;">Nenhum artigo pendente encontrado (${rep.total_matched} de ${rep.total_scholar} correspondidos).</p>
          </div>
        ` : `
          <div class="tl-table" style="margin-top:16px;">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:38px; text-align:center;">
                    <input type="checkbox" id="scholar-select-all" title="Selecionar todos os artigos visíveis" />
                  </th>
                  <th style="width:40px; text-align:center;">#</th>
                  <th style="width:65px; text-align:center;">Ano</th>
                  <th>Título da Obra</th>
                  <th style="width:230px;">Revista / Periódico</th>
                  <th style="width:75px; text-align:center;">Citações</th>
                  <th style="width:185px;">DOI</th>
                  <th style="width:145px; text-align:center;">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${visibleList.length === 0 ? `
                  <tr><td colspan="8" style="text-align:center; padding:24px; color:var(--text-muted);">Nenhum artigo corresponde à busca informada.</td></tr>
                ` : visibleList.map((it, idx) => {
        const sId = it.scholar_id || String(allUnmatched.indexOf(it));
        const isRegistered = st.registeredIds.has(sId);
        const isSelected = st.selectedScholarIds.has(sId);
        return `
                    <tr data-row-id="${escapeHtml(sId)}" class="${isSelected ? "row-selected" : ""}">
                      <td style="text-align:center;">
                        <input type="checkbox" class="scholar-row-chk" data-scholar-id="${escapeHtml(sId)}" ${isSelected ? "checked" : ""} />
                      </td>
                      <td style="text-align:center; color:var(--text-muted); font-size:11px;">${idx + 1}</td>
                      <td style="text-align:center; font-weight:600;">${it.year || "—"}</td>
                      <td>
                        <div style="font-weight:600; line-height:1.35; margin-bottom:3px;">
                          ${it.link ? `<a href="${escapeHtml(it.link)}" target="_blank" rel="noopener" style="color:var(--text); text-decoration:none;" class="hover-underline" title="Abrir artigo no Google Scholar">${escapeHtml(it.title)}</a>` : escapeHtml(it.title)}
                        </div>
                        ${it.authors ? `<div style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(it.authors)}</div>` : ""}
                      </td>
                      <td style="font-size:12px; color:var(--text-secondary); line-height:1.3;">
                        ${it.journal ? escapeHtml(it.journal) : '<span style="color:var(--text-muted); font-style:italic;">Não informada</span>'}
                      </td>
                      <td style="text-align:center;">
                        <span class="badge" style="background:rgba(16,185,129,0.15); color:var(--success); font-weight:600; font-size:11.5px; padding:2px 7px; border-radius:12px;">
                          💬 ${it.citations != null ? it.citations : 0}
                        </span>
                      </td>
                      <td data-cell-doi="${escapeHtml(sId)}">
                        ${renderDoiCell(it.doi, sId)}
                      </td>
                      <td style="text-align:center;">
                        ${isRegistered ? `
                          <span class="badge" style="background:rgba(16,185,129,0.18); color:var(--success); font-weight:600; font-size:11.5px; padding:3px 8px; border-radius:6px;">
                            ✓ Cadastrado
                          </span>
                        ` : `
                          <div style="display:flex; gap:6px; justify-content:center; align-items:center;">
                            <button type="button" class="btn btn-primary btn-xs" data-create-art="${escapeHtml(sId)}" style="white-space:nowrap; padding:4px 10px; font-size:11.5px; font-weight:600; border-radius:6px;" title="Cadastrar em Produções">
                              ✨ Cadastrar
                            </button>
                            <button type="button" class="btn btn-secondary btn-xs" data-ignore-art="${escapeHtml(sId)}" style="padding:4px 8px; font-size:11.5px; border-radius:6px;" title="Ignorar este artigo até a próxima sincronização com o Lattes">
                              🚫
                            </button>
                          </div>
                        `}
                      </td>
                    </tr>
                  `;
      }).join("")}
              </tbody>
            </table>
          </div>
        `}
      </div>`
    );

    const searchInput = this.el.querySelector("#scholar-unmatched-search");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        st.filterQuery = e.target.value;
        this.toolScholarUnmatched();
      });
      if (document.activeElement !== searchInput && st.filterQuery) {
        searchInput.focus();
        searchInput.setSelectionRange(st.filterQuery.length, st.filterQuery.length);
      }
    }

    this.el.querySelector("#btn-scholar-force-refresh")?.addEventListener("click", () => {
      st.forceRefresh = true;
      st.data = null;
      st.ignoredIds?.clear();
      st.selectedScholarIds?.clear();
      this.toolScholarUnmatched();
    });

    this.el.querySelector("#btn-scholar-ignore-selected")?.addEventListener("click", () => {
      const count = st.selectedScholarIds.size;
      if (count === 0) return;
      st.selectedScholarIds.forEach((id) => st.ignoredIds.add(id));
      st.selectedScholarIds.clear();
      showToast(`${count} artigo(s) ignorado(s) até a próxima sincronização com o Lattes.`, "info", 3500);
      this.toolScholarUnmatched();
    });

    this.el.querySelector("#btn-restore-ignored-scholar")?.addEventListener("click", () => {
      const count = st.ignoredIds.size;
      st.ignoredIds.clear();
      showToast(`${count} artigo(s) ignorado(s) restaurado(s) na listagem.`, "success", 3000);
      this.toolScholarUnmatched();
    });

    const selectAllChk = this.el.querySelector("#scholar-select-all");
    if (selectAllChk && visibleList.length > 0) {
      const visibleIds = visibleList.map((it) => it.scholar_id || String(allUnmatched.indexOf(it)));
      const selectedCount = visibleIds.filter((id) => st.selectedScholarIds.has(id)).length;
      selectAllChk.checked = selectedCount === visibleIds.length;
      selectAllChk.indeterminate = selectedCount > 0 && selectedCount < visibleIds.length;
      selectAllChk.addEventListener("change", (e) => {
        const checked = e.target.checked;
        visibleIds.forEach((id) => {
          if (checked) st.selectedScholarIds.add(id);
          else st.selectedScholarIds.delete(id);
        });
        this.toolScholarUnmatched();
      });
    }

    this.el.querySelector("#btn-scholar-view-metrics")?.addEventListener("click", () => {
      this.open("scholar");
    });

    const tabela = this.el.querySelector(".tl-table");
    if (tabela) {
      tabela.addEventListener("change", (e) => {
        const chk = e.target.closest(".scholar-row-chk");
        if (chk) {
          const sId = chk.dataset.scholarId;
          if (chk.checked) st.selectedScholarIds.add(sId);
          else st.selectedScholarIds.delete(sId);
          this.toolScholarUnmatched();
        }
      });

      tabela.addEventListener("click", async (e) => {
        const ignoreBtn = e.target.closest("[data-ignore-art]");
        if (ignoreBtn) {
          const sId = ignoreBtn.dataset.ignoreArt;
          st.ignoredIds.add(sId);
          st.selectedScholarIds.delete(sId);
          showToast("Artigo ignorado (oculto até a próxima sincronização).", "info", 3000);
          this.toolScholarUnmatched();
          return;
        }
        const openDoiBtn = e.target.closest("[data-open-doi]");
        if (openDoiBtn) {
          e.preventDefault();
          const d = openDoiBtn.dataset.openDoi;
          if (d) api.openDoi(d).catch((err) => showToast(`Erro ao abrir DOI: ${err}`, "error"));
          return;
        }

        const copyDoiBtn = e.target.closest("[data-copy-doi]");
        if (copyDoiBtn) {
          e.preventDefault();
          e.stopPropagation();
          const d = copyDoiBtn.dataset.copyDoi;
          if (d) {
            let copied = false;
            try {
              if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(d);
                copied = true;
              }
            } catch {}
            if (!copied) {
              try {
                const ta = document.createElement("textarea");
                ta.value = d;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
                copied = true;
              } catch {}
            }
            if (copied) {
              const prevHtml = copyDoiBtn.innerHTML;
              copyDoiBtn.innerHTML = "✓";
              copyDoiBtn.style.color = "var(--success)";
              setTimeout(() => {
                if (copyDoiBtn) {
                  copyDoiBtn.innerHTML = prevHtml;
                  copyDoiBtn.style.color = "";
                }
              }, 1800);
              showToast(`DOI copiado: ${d}`, "success", 2500);
            } else {
              showToast("Não foi possível copiar para a área de transferência", "error");
            }
          }
          return;
        }

        const openUrlBtn = e.target.closest("[data-open-url]");
        if (openUrlBtn) {
          e.preventDefault();
          const u = openUrlBtn.dataset.openUrl;
          if (u) api.openUrl(u).catch((err) => showToast(`Erro ao abrir link: ${err}`, "error"));
          return;
        }

        const findBtn = e.target.closest("[data-find-doi]");
        if (findBtn) {
          const sId = findBtn.dataset.findDoi;
          const item = allUnmatched.find((x, i) => (x.scholar_id || String(i)) === sId);
          if (!item) return;
          findBtn.disabled = true;
          findBtn.innerHTML = "⏳ Buscando...";
          try {
            const doi = await api.findDoiByTitle(item.title);
            if (doi) {
              item.doi = doi;
              const cell = this.el.querySelector(`[data-cell-doi="${sId}"]`);
              if (cell) {
                cell.innerHTML = renderDoiCell(doi, sId);
              }
              showToast(`DOI encontrado: ${doi}`, "success", 3000);
            } else {
              findBtn.disabled = false;
              findBtn.innerHTML = "Não encontrado";
              setTimeout(() => { if (findBtn) findBtn.innerHTML = "🔍 Buscar DOI"; }, 2500);
            }
          } catch (err) {
            findBtn.disabled = false;
            findBtn.innerHTML = "Erro";
            showToast(String(err), "error");
          }
          return;
        }

        const createBtn = e.target.closest("[data-create-art]");
        if (createBtn) {
          const sId = createBtn.dataset.createArt;
          const item = allUnmatched.find((x, i) => (x.scholar_id || String(i)) === sId);
          if (!item) return;

          const initialData = {
            titulo: item.title,
            ano: item.year,
            journal: item.journal || "",
            identifier: item.doi || "",
            tipo: "Artigos completos",
            citations: item.citations != null ? item.citations : null,
          };

          const onSavedCallback = () => {
            st.registeredIds.add(sId);
            st.selectedScholarIds.delete(sId);
            showToast("Artigo cadastrado em Produções com sucesso!", "success", 3500);
            this.toolScholarUnmatched();
            this.onChanged && this.onChanged();
          };

          if (this.onCreateWithData) {
            this.onCreateWithData("producoes", initialData, onSavedCallback);
          } else if (window._app) {
            window._app.openCreateRecordWithData("producoes", initialData, onSavedCallback);
          }
        }
      });
    }

    this.el.querySelector("#btn-scholar-find-all-dois")?.addEventListener("click", async () => {
      const candidates = remainingUnmatched.filter((it) => !it.doi || !String(it.doi).trim());
      if (!candidates.length) {
        showToast("Todas as publicações visíveis já possuem DOI.", "info");
        return;
      }
      st.batchFindingDois = true;
      st.batchStop = false;
      st.batchProgress = { current: 0, total: candidates.length, found: 0, currentTitle: "" };
      this.syncBackgroundBadge();
      this.toolScholarUnmatched();

      const CONCURRENCY = 3;
      let cursor = 0;

      const worker = async () => {
        while (cursor < candidates.length && !st.batchStop) {
          const item = candidates[cursor++];
          const sId = item.scholar_id || String(allUnmatched.indexOf(item));
          st.batchProgress.currentTitle = item.title ? (item.title.length > 45 ? item.title.slice(0, 45) + "…" : item.title) : "";

          const cell = this.el.querySelector(`[data-cell-doi="${sId}"]`);
          if (cell) cell.innerHTML = `<span style="font-size:11px; color:var(--text-muted);">⏳ buscando…</span>`;

          try {
            const doi = await api.findDoiByTitle(item.title);
            if (doi) {
              item.doi = doi;
              st.batchProgress.found++;
              if (cell) cell.innerHTML = renderDoiCell(doi, sId);
            } else {
              if (cell) cell.innerHTML = renderDoiCell(null, sId);
            }
          } catch {
            if (cell) cell.innerHTML = renderDoiCell(null, sId);
          }

          st.batchProgress.current++;

          const bar = this.el.querySelector(".tl-progress i");
          if (bar) bar.style.width = `${Math.round((st.batchProgress.current / candidates.length) * 100)}%`;
          const lbl = this.el.querySelector("#scholar-batch-progress-label");
          if (lbl) {
            lbl.innerHTML = `<b>Buscando DOIs…</b> ${st.batchProgress.current} de ${candidates.length} analisado(s) · <b style="color:var(--success);">${st.batchProgress.found} encontrado(s)</b>`;
          }
          const curEl = this.el.querySelector("#scholar-batch-cur-title");
          if (curEl) curEl.textContent = st.batchProgress.currentTitle;
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, () => worker()));

      const foundTotal = st.batchProgress ? st.batchProgress.found : 0;
      st.batchFindingDois = false;
      st.batchProgress = null;
      this.syncBackgroundBadge();
      showToast(`Busca de DOIs concluída! ${foundTotal} DOI(s) encontrado(s).`, foundTotal > 0 ? "success" : "info", 4000);
      this.toolScholarUnmatched();
    });

    this.el.querySelector("#btn-scholar-stop-batch-doi")?.addEventListener("click", () => {
      st.batchStop = true;
      const btn = this.el.querySelector("#btn-scholar-stop-batch-doi");
      if (btn) btn.textContent = "Parando…";
    });
  }

  // ===== VASSOURA DE COMPROVANTES =====
  async toolVassoura() {
    const st = this.state;
    st.filter ??= "all";
    st.moveFiles ??= false;
    st.sel ??= new Set();

    if (!st.folder) {
      this.shell(
        "Vassoura de Comprovantes",
        "Localize e vincule comprovantes em lote a partir de qualquer pasta no computador.",
        `<div class="vs-welcome">
          <div class="vs-hero">
            <span class="vs-hero-ic">🧹</span>
            <h3>Varredura Inteligente por Reconhecimento de Documentos</h3>
            <p>Selecione uma pasta onde você costuma salvar certificados, declarações, portarias e artigos (ex.: <b>Downloads</b>, <b>Área de Trabalho</b> ou <b>Documentos</b>). O motor de inteligência do Lattes Manager extrai o texto dos PDFs e encontra os registros correspondentes que ainda estão sem comprovante.</p>
          </div>
          <div class="vs-actions">
            <button type="button" class="btn btn-primary" data-vs="pick">📂 Escolher pasta para varrer…</button>
          </div>
          <div class="dd-note">💡 Os arquivos originais podem ser <b>copiados</b> (padrão recomendado) ou <b>movidos</b> diretamente para a estrutura organizada de subpastas do Lattes.</div>
        </div>`
      );

      this.el.querySelector('[data-vs="pick"]')?.addEventListener("click", async () => {
        try {
          const folder = await api.pickFolder("Escolha a pasta com os comprovantes para varrer");
          if (!folder) return;
          st.folder = folder;
          st.scanning = true;
          this.toolVassoura();
          st.matches = await api.scanVassoura(folder);
          st.sel = new Set(st.matches.map((_, i) => i));
          st.scanning = false;
          this.toolVassoura();
        } catch (e) {
          st.scanning = false;
          showToast(`Erro ao varrer pasta: ${e}`, "error");
          this.toolVassoura();
        }
      });
      return;
    }

    if (st.scanning) {
      this.shell(
        "Vassoura de Comprovantes",
        `Analisando documentos em <code>${escapeHtml(st.folder)}</code>…`,
        `<div class="loading-state" style="display:flex; flex-direction:column; gap:16px;">
          <div class="spinner"></div>
          <div>Lendo e extraindo texto dos PDFs com inteligência semântica…</div>
        </div>`
      );
      return;
    }

    const matches = st.matches || [];
    const highMatches = matches.filter((m) => m.score >= 70);
    const medMatches = matches.filter((m) => m.score < 70);

    const filtered = st.filter === "high" ? highMatches : st.filter === "med" ? medMatches : matches;
    const mb = (b) => (b / 1048576).toFixed(1) + " MB";

    this.shell(
      "Vassoura de Comprovantes",
      `Pasta analisada: <code>${escapeHtml(st.folder)}</code> · <b>${matches.length}</b> correspondência(s) encontrada(s).`,
      `<div class="vs-container">
        <div class="tl-bar">
          <div class="seg tl-seg-sm">
            <button type="button" data-flt="all" class="${st.filter === "all" ? "on" : ""}">Todos (${matches.length})</button>
            <button type="button" data-flt="high" class="${st.filter === "high" ? "on" : ""}">Alta confiança ≥70% (${highMatches.length})</button>
            <button type="button" data-flt="med" class="${st.filter === "med" ? "on" : ""}">Média confiança (${medMatches.length})</button>
          </div>
          <div style="flex:1"></div>
          <button type="button" class="btn btn-secondary btn-sm" data-vs="pick-other">Trocar pasta</button>
        </div>

        ${matches.length ? `
          <div class="vs-opt-bar">
            <label class="vs-mode-opt">
              <input type="checkbox" data-vs="move" ${st.moveFiles ? "checked" : ""}/>
              <span>Mover arquivos originais (desmarcado: copia mantendo o original intacto)</span>
            </label>
            <div style="flex:1"></div>
            <button type="button" class="btn btn-secondary btn-sm" data-vs="all">Marcar / Desmarcar todos</button>
            <button type="button" class="btn btn-primary btn-sm" data-vs="apply" ${!st.sel.size ? "disabled" : ""}>
              🧹 Vincular ${st.sel.size} comprovante(s) selecionado(s)
            </button>
          </div>

          <div class="tl-table">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:36px"></th>
                  <th style="width:105px">Confiança</th>
                  <th>Arquivo Encontrado</th>
                  <th>Registro Lattes Correspondente</th>
                  <th>Subpasta de Destino</th>
                  <th style="width:60px">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map((m) => {
        const globalIdx = matches.indexOf(m);
        const isHigh = m.score >= 70;
        const scoreColor = isHigh ? "var(--success)" : "var(--warning)";
        const scoreBg = isHigh ? "rgba(16, 185, 129, 0.12)" : "rgba(245, 158, 11, 0.12)";
        return `
                    <tr>
                      <td>
                        <input type="checkbox" data-idx="${globalIdx}" ${st.sel.has(globalIdx) ? "checked" : ""}/>
                      </td>
                      <td>
                        <span class="badge" style="background:${scoreBg}; color:${scoreColor}; font-weight:700;">
                          ${m.score}%
                        </span>
                      </td>
                      <td>
                        <div class="vs-file-info">
                          <b title="${escapeHtml(m.file_path)}">${escapeHtml(m.file_name)}</b>
                          <small class="muted">${mb(m.file_size)} · ${escapeHtml(m.match_reason)}</small>
                        </div>
                      </td>
                      <td>
                        <div class="vs-rec-info">
                          <span class="badge badge-tipo">${escapeHtml(m.category_label)}</span>
                          ${m.record_year ? `<span class="badge" style="background:var(--surface-3);color:var(--text-secondary)">${m.record_year}</span>` : ""}
                          <div class="vs-rec-title">${escapeHtml(m.record_title)}</div>
                          ${m.record_extra ? `<small class="muted">${escapeHtml(m.record_extra)}</small>` : ""}
                        </div>
                      </td>
                      <td class="mono sm" title="${escapeHtml(m.suggested_folder + "\\" + m.suggested_filename)}">
                        <small style="color:var(--primary)">${escapeHtml(m.suggested_folder)}</small><br>
                        ${escapeHtml(m.suggested_filename)}
                      </td>
                      <td style="text-align:right">
                        <button type="button" class="ibtn" data-open="${escapeHtml(m.file_path)}" title="Abrir arquivo PDF">👁️</button>
                        <button type="button" class="ibtn" data-reveal="${escapeHtml(m.file_path)}" title="Mostrar na pasta">📂</button>
                      </td>
                    </tr>
                  `;
      }).join("")}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="tl-empty">
            ✅ Nenhum comprovante não vinculado encontrado para os registros sem arquivo nesta pasta.<br>
            <small class="muted">Tente selecionar outra pasta de downloads ou documentos.</small>
          </div>
        `}
      </div>`
    );

    this.el.querySelectorAll("[data-flt]").forEach((b) => b.addEventListener("click", () => {
      st.filter = b.dataset.flt;
      this.toolVassoura();
    }));

    this.el.querySelector('[data-vs="pick-other"]')?.addEventListener("click", async () => {
      st.folder = null;
      st.matches = null;
      this.toolVassoura();
    });

    this.el.querySelector('[data-vs="move"]')?.addEventListener("change", (e) => {
      st.moveFiles = e.target.checked;
    });

    this.el.querySelector('[data-vs="all"]')?.addEventListener("click", () => {
      if (st.sel.size === matches.length) {
        st.sel.clear();
      } else {
        st.sel = new Set(matches.map((_, i) => i));
      }
      this.toolVassoura();
    });

    this.el.querySelectorAll("[data-idx]").forEach((chk) => chk.addEventListener("change", () => {
      const idx = Number(chk.dataset.idx);
      if (chk.checked) st.sel.add(idx);
      else st.sel.delete(idx);
      const applyBtn = this.el.querySelector('[data-vs="apply"]');
      if (applyBtn) {
        applyBtn.textContent = `🧹 Vincular ${st.sel.size} comprovante(s) selecionado(s)`;
        applyBtn.disabled = !st.sel.size;
      }
    }));

    this.el.querySelectorAll("[data-open]").forEach((btn) => btn.addEventListener("click", () => {
      api.openFile(btn.dataset.open).catch((e) => showToast(`Erro ao abrir: ${e}`, "error"));
    }));

    this.el.querySelectorAll("[data-reveal]").forEach((btn) => btn.addEventListener("click", () => {
      api.revealInExplorer(btn.dataset.reveal).catch((e) => showToast(`Erro: ${e}`, "error"));
    }));

    this.el.querySelector('[data-vs="apply"]')?.addEventListener("click", async () => {
      const todo = [...st.sel].map((i) => matches[i]).filter(Boolean);
      if (!todo.length) return;
      const actionWord = st.moveFiles ? "mover e vincular" : "copiar e vincular";
      if (!window.confirm(`Deseja ${actionWord} ${todo.length} comprovante(s) para suas respectivas categorias?`)) return;

      const itemsToApply = todo.map((m) => ({
        file_path: m.file_path,
        category: m.category,
        record_id: m.record_id,
        suggested_folder: m.suggested_folder,
        suggested_filename: m.suggested_filename,
      }));

      try {
        const res = await api.applyVassoura(itemsToApply, st.moveFiles);
        showToast(`🧹 ${res.ok} comprovante(s) vinculado(s) com sucesso!${res.errors.length ? ` (${res.errors.length} erro(s))` : ""}`, res.errors.length ? "warning" : "success", 4000);
        st.matches = matches.filter((m) => !st.sel.has(matches.indexOf(m)));
        st.sel.clear();
        this.onChanged && this.onChanged();
        this.toolVassoura();
      } catch (e) {
        showToast(`Erro ao aplicar: ${e}`, "error");
      }
    });
  }

  // ===== PROCURAR COMPROVANTES INVÁLIDOS =====
  async toolInvalidProofs() {
    const st = this.state;
    st.searchQuery ??= "";
    st.categoryFilter ??= "all";
    st.selectedKeys ||= new Set();

    const itemKey = (it) => `${it.category}:${it.id}:${it.path}`;

    if (!st.fc && !st.fcLoading) {
      st.fcLoading = true;
      this.shell(
        "Procurar comprovantes inválidos",
        "Varrendo o banco de dados e verificando existência dos arquivos no disco…",
        `<div class="loading-state" style="display:flex; flex-direction:column; gap:16px; padding:40px 0;">
          <div class="spinner"></div>
          <div>Verificando integridade dos comprovantes vinculados...</div>
        </div>`
      );
      try {
        st.fc = await api.checkFiles();
      } catch (e) {
        showToast(`Erro ao verificar arquivos: ${e}`, "error");
        st.fc = { total_vinculados: 0, ausentes: [], orfaos: [], orfaos_bytes: 0 };
      } finally {
        st.fcLoading = false;
      }
      if (this.active !== "invalid_proofs") return;
    }

    const fc = st.fc || { total_vinculados: 0, ausentes: [], orfaos: [], orfaos_bytes: 0 };
    const allAusentes = fc.ausentes || [];
    const totalInvalid = allAusentes.length;
    const totalValid = Math.max(0, fc.total_vinculados - totalInvalid);

    // Contagem de inválidos por categoria para as pílulas de filtro
    const catCounts = {};
    for (const item of allAusentes) {
      catCounts[item.category] = (catCounts[item.category] || 0) + 1;
    }

    // Filtragem por busca e categoria
    const q = (st.searchQuery || "").trim().toLowerCase();
    const filtered = allAusentes.filter((item) => {
      if (st.categoryFilter !== "all" && item.category !== st.categoryFilter) {
        return false;
      }
      if (!q) return true;
      const t = (item.titulo || "").toLowerCase();
      const n = (item.nivel || "").toLowerCase();
      const p = (item.path || "").toLowerCase();
      const c = (item.category || "").toLowerCase();
      const catLabel = (CATEGORY_SCHEMAS[item.category]?.name || "").toLowerCase();
      const y = String(item.ano || "");
      const id = String(item.id);
      return t.includes(q) || n.includes(q) || p.includes(q) || c.includes(q) || catLabel.includes(q) || y.includes(q) || id.includes(q);
    });

    const activeCat = st.categoryFilter;
    const validKeys = new Set(allAusentes.map(itemKey));
    for (const k of [...st.selectedKeys]) {
      if (!validKeys.has(k)) st.selectedKeys.delete(k);
    }
    const selectedCount = st.selectedKeys.size;
    const filteredSelectedCount = filtered.filter((it) => st.selectedKeys.has(itemKey(it))).length;
    const allFilteredSelected = filtered.length > 0 && filteredSelectedCount === filtered.length;

    this.shell(
      "Procurar comprovantes inválidos",
      "Localize registros com links para PDFs ou imagens que não existem mais no disco e vincule comprovantes válidos com 1 clique.",
      `<div class="tl-invalid-wrap" style="display:flex; flex-direction:column; gap:18px;">
        <!-- Estatísticas do Scan -->
        <div class="tl-stats" style="grid-template-columns: repeat(3, 1fr);">
          <div class="${totalInvalid > 0 ? "bad" : "good"}">
            <b>${totalInvalid}</b>
            <span>comprovante(s) inválido(s) / ausente(s)</span>
          </div>
          <div class="good">
            <b>${totalValid}</b>
            <span>comprovante(s) íntegro(s) no disco</span>
          </div>
          <div>
            <b>${fc.total_vinculados}</b>
            <span>total de vínculos verificados</span>
          </div>
        </div>

        <!-- Barra de Busca e Ações Rápidas -->
        <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:12px; background:var(--surface-bg); padding:12px 16px; border:1px solid var(--border-light); border-radius:12px;">
          <div style="position:relative; flex:1; min-width:260px; max-width:420px;">
            <input type="text" id="inv-search-input" class="form-input" placeholder="Buscar por atividade, categoria, nível, arquivo..." value="${escapeHtml(st.searchQuery)}" style="width:100%; padding-left:32px; font-size:12.5px;" />
            <span style="position:absolute; left:10px; top:50%; transform:translateY(-50%); opacity:0.5; pointer-events:none; font-size:13px;">🔍</span>
          </div>

          <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-recheck-invalid" title="Verificar pastas e arquivos novamente">
              🔄 Reanalisar pastas
            </button>
            ${totalInvalid > 0 ? `
              <button type="button" class="btn btn-danger btn-sm" id="btn-clear-selected-invalid" ${selectedCount === 0 ? "disabled" : ""} title="Remove o vínculo dos registros selecionados (permanecerão sem comprovante)">
                🗑️ Desvincular selecionados (${selectedCount})
              </button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-clear-all-invalid" title="Remove os vínculos quebrados de todos os registros ausentes">
                🗑️ Desvincular todos (${totalInvalid})
              </button>
            ` : ""}
          </div>
        </div>

        <!-- Pílulas de Categoria -->
        ${totalInvalid > 0 ? `
          <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
            <button type="button" class="filter-pill ${activeCat === "all" ? "active" : ""}" data-cat-filter="all" style="font-size:12px; padding:4px 10px; border-radius:20px; cursor:pointer;">
              Todas as categorias <span class="badge" style="margin-left:4px; font-size:10px;">${totalInvalid}</span>
            </button>
            ${Object.keys(catCounts).map((catKey) => {
        const sc = CATEGORY_SCHEMAS[catKey];
        const name = sc?.name || sc?.group || catKey;
        const icon = sc?.icon || "📁";
        const count = catCounts[catKey];
        const isActive = activeCat === catKey;
        return `
                <button type="button" class="filter-pill ${isActive ? "active" : ""}" data-cat-filter="${escapeHtml(catKey)}" style="font-size:12px; padding:4px 10px; border-radius:20px; cursor:pointer;">
                  <span>${icon}</span> ${escapeHtml(name)} <span class="badge" style="margin-left:4px; font-size:10px;">${count}</span>
                </button>
              `;
      }).join("")}
          </div>
        ` : ""}

        <!-- Tabela ou Estado Vazio -->
        ${totalInvalid === 0 ? `
          <div class="tl-empty" style="padding:48px 24px; text-align:center; background:var(--surface-bg); border-radius:14px; border:1px solid var(--border-light);">
            <div style="font-size:42px; margin-bottom:12px;">🎉</div>
            <div style="font-size:18px; font-weight:700; color:var(--success-text); margin-bottom:6px;">Nenhum comprovante inválido encontrado!</div>
            <div style="color:var(--text-secondary); font-size:13px; max-width:520px; margin:0 auto; line-height:1.5;">
              Todos os ${fc.total_vinculados} links de comprovantes no seu currículo apontam para arquivos PDF ou imagens existentes no disco.
            </div>
          </div>
        ` : filtered.length === 0 ? `
          <div class="tl-empty" style="padding:32px 20px; text-align:center;">
            Nenhum comprovante inválido corresponde à busca atual.
          </div>
        ` : `
          <div class="tl-table" style="max-height: 58vh;">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 38px; text-align: center;">
                    <input type="checkbox" id="inv-select-all" title="Selecionar todos visíveis" ${allFilteredSelected ? "checked" : ""} />
                  </th>
                  <th style="width: 130px;">Categoria</th>
                  <th style="width: 140px;">Nível</th>
                  <th>Nome da Atividade</th>
                  <th style="min-width: 220px;">Link para comprovante inválido</th>
                  <th style="width: 210px; text-align: right;">Ação</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map((item, idx) => {
        const sc = CATEGORY_SCHEMAS[item.category];
        const catName = sc?.name || sc?.group || item.category;
        const icon = sc?.icon || "📁";
        const k = itemKey(item);
        const isChecked = st.selectedKeys.has(k);
        return `
                    <tr data-idx="${idx}">
                      <td style="text-align: center; vertical-align: middle;">
                        <input type="checkbox" class="inv-row-chk" data-key="${escapeHtml(k)}" ${isChecked ? "checked" : ""} />
                      </td>
                      <td>
                        <span class="badge badge-tipo" style="display:inline-flex; align-items:center; gap:5px; font-weight:600;">
                          <span>${icon}</span>
                          <span>${escapeHtml(catName)}</span>
                        </span>
                      </td>
                      <td>${renderTipoBadge(item.nivel)}</td>
                      <td>
                        <div style="font-weight:600; color:var(--text-primary); line-height:1.35; font-size:13px;">
                          ${escapeHtml(item.titulo)}
                        </div>
                        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                          Registro #${item.id} ${item.ano ? `· Ano ${item.ano}` : ""}
                        </div>
                      </td>
                      <td>
                        <div style="display:flex; flex-direction:column; gap:4px;">
                          <code class="mono" style="color:var(--danger); font-size:11.5px; word-break:break-all;" title="${escapeHtml(item.path)}">
                            ${escapeHtml(item.path)}
                          </code>
                          <div>
                            <span class="badge" style="background:var(--danger-bg); color:var(--danger); border:1px solid var(--danger-border); font-size:10px; font-weight:700; padding:2px 6px;">
                              ⚠️ Arquivo não existe no disco
                            </span>
                          </div>
                        </div>
                      </td>
                      <td style="text-align: right; white-space: nowrap;">
                        <div style="display:flex; gap:6px; justify-content:flex-end; align-items:center;">
                          <button type="button" class="btn btn-primary btn-sm" data-action="link-proof" data-idx="${idx}" title="Vincular um comprovante válido (existente ou escolher do computador)">
                            🔗 Vincular comprovante
                          </button>
                          <button type="button" class="btn btn-secondary btn-sm" data-action="clear-proof" data-idx="${idx}" title="Desvincular este arquivo (registro ficará sem comprovante)">
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  `;
      }).join("")}
              </tbody>
            </table>
          </div>
        `}
      </div>`
    );

    // Ajusta estado indeterminado do checkbox principal
    const selectAllEl = this.el.querySelector("#inv-select-all");
    if (selectAllEl) {
      selectAllEl.indeterminate = filteredSelectedCount > 0 && filteredSelectedCount < filtered.length;
    }

    const syncSelectionUi = () => {
      const btnSel = this.el.querySelector("#btn-clear-selected-invalid");
      if (btnSel) {
        btnSel.disabled = st.selectedKeys.size === 0;
        btnSel.textContent = `🗑️ Desvincular selecionados (${st.selectedKeys.size})`;
      }
      if (selectAllEl) {
        const visSel = filtered.filter((it) => st.selectedKeys.has(itemKey(it))).length;
        selectAllEl.checked = filtered.length > 0 && visSel === filtered.length;
        selectAllEl.indeterminate = visSel > 0 && visSel < filtered.length;
      }
    };

    // Bindings de Eventos
    const searchInput = this.el.querySelector("#inv-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        st.searchQuery = e.target.value;
        this.toolInvalidProofs();
      });
      if (document.activeElement !== searchInput && st.searchQuery) {
        searchInput.focus();
        searchInput.setSelectionRange(st.searchQuery.length, st.searchQuery.length);
      }
    }

    this.el.querySelectorAll("[data-cat-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        st.categoryFilter = btn.dataset.catFilter;
        this.toolInvalidProofs();
      });
    });

    this.el.querySelector("#btn-recheck-invalid")?.addEventListener("click", () => {
      st.fc = null;
      st.selectedKeys.clear();
      this.toolInvalidProofs();
    });

    selectAllEl?.addEventListener("change", () => {
      const checked = selectAllEl.checked;
      for (const it of filtered) {
        const k = itemKey(it);
        if (checked) st.selectedKeys.add(k);
        else st.selectedKeys.delete(k);
      }
      this.el.querySelectorAll(".inv-row-chk").forEach((chk) => { chk.checked = checked; });
      syncSelectionUi();
    });

    this.el.querySelectorAll(".inv-row-chk").forEach((chk) => {
      chk.addEventListener("change", () => {
        const k = chk.dataset.key;
        if (chk.checked) st.selectedKeys.add(k);
        else st.selectedKeys.delete(k);
        syncSelectionUi();
      });
    });

    this.el.querySelector("#btn-clear-selected-invalid")?.addEventListener("click", async () => {
      const selectedItems = allAusentes.filter((it) => st.selectedKeys.has(itemKey(it)));
      if (!selectedItems.length) return;
      if (!window.confirm(`Desvincular o arquivo inexistente de ${selectedItems.length} registro(s) selecionado(s)?\nOs registros continuarão no sistema como "sem comprovante".`)) return;
      const r = await api.clearMissingLinks(selectedItems).catch((e) => ({ ok: 0, erros: [String(e)] }));
      showToast(`${r.ok} vínculo(s) removido(s)`, r.erros.length ? "error" : "success");
      const clearedSet = new Set(selectedItems.map(itemKey));
      for (const k of clearedSet) st.selectedKeys.delete(k);
      st.fc = null;
      this.toolInvalidProofs();
      this.onChanged && this.onChanged();
    });

    this.el.querySelector("#btn-clear-all-invalid")?.addEventListener("click", async () => {
      if (!window.confirm(`Remover os links de comprovantes quebrados de todos os ${allAusentes.length} registro(s)?\nOs registros continuarão no sistema como "sem comprovante".`)) return;
      const r = await api.clearMissingLinks(allAusentes).catch((e) => ({ ok: 0, erros: [String(e)] }));
      showToast(`${r.ok} vínculo(s) inválido(s) removido(s)`, r.erros.length ? "error" : "success");
      st.fc = null;
      st.selectedKeys.clear();
      this.toolInvalidProofs();
      this.onChanged && this.onChanged();
    });

    // Ações na tabela
    const tableEl = this.el.querySelector(".tl-table");
    if (tableEl) {
      tableEl.addEventListener("click", async (e) => {
        const linkBtn = e.target.closest("[data-action='link-proof']");
        if (linkBtn) {
          const idx = Number(linkBtn.dataset.idx);
          const item = filtered[idx];
          if (!item) return;

          new ProofPickerModal({
            currentCategory: item.category,
            records: [{
              id: item.id,
              category: item.category,
              title: item.titulo,
              ano: item.ano,
              path: item.path,
              tipo: item.nivel,
            }],
            onSelect: (chosen) => {
              showToast(`✓ Comprovante "${chosen.file}" vinculado com sucesso ao registro #${item.id}!`, "success", 4000);
              // Remove este item da lista de ausentes
              fc.ausentes = fc.ausentes.filter((x) => !(x.id === item.id && x.category === item.category && x.path === item.path));
              this.toolInvalidProofs();
              this.onChanged && this.onChanged();
            },
          }).open();
          return;
        }

        const clearBtn = e.target.closest("[data-action='clear-proof']");
        if (clearBtn) {
          const idx = Number(clearBtn.dataset.idx);
          const item = filtered[idx];
          if (!item) return;

          if (!window.confirm(`Remover o link do comprovante ausente do registro #${item.id} ("${item.titulo}")?\nO registro continuará no sistema sem comprovante.`)) return;

          const r = await api.clearMissingLinks([item]).catch((e) => ({ ok: 0, erros: [String(e)] }));
          if (r.ok) {
            showToast(`Vínculo inválido removido do registro #${item.id}`, "success");
            st.selectedKeys.delete(itemKey(item));
            st.fc = null;
            this.toolInvalidProofs();
            this.onChanged && this.onChanged();
          } else {
            showToast(`Erro ao remover vínculo: ${r.erros.join(", ")}`, "error");
          }
        }
      });
    }
  }

  // ===== LATTES TIME MACHINE (COMPARADOR) =====
  async toolTimeMachine() {
    const st = this.state;
    st.mode ??= "db";
    st.statusFilter ??= "all";
    st.catFilter ??= "all";

    if (!st.diff) {
      this.shell(
        "Lattes Time Machine (Comparador de Versões)",
        "Compare versões curriculares e audite o que foi adicionado, alterado ou removido.",
        `<div class="tm-welcome">
          <div class="tm-hero">
            <span class="tm-hero-ic">🕰️</span>
            <h3>Histórico e Auditoria de Alterações Curriculares</h3>
            <p>Selecione um novo arquivo XML exportado da Plataforma Lattes para comparar com a base de dados atual ou compare diretamente dois arquivos XML distintos para extrair o relatório exato de novidades e modificações.</p>
          </div>

          <div class="seg tl-seg" style="max-width:440px; margin:0 auto 20px;">
            <button type="button" data-tm-mode="db" class="${st.mode === "db" ? "on" : ""}">Banco Atual × Novo XML</button>
            <button type="button" data-tm-mode="two_xmls" class="${st.mode === "two_xmls" ? "on" : ""}">Dois Arquivos XML (.xml)</button>
          </div>

          <div class="tm-pick-box">
            ${st.mode === "db" ? `
              <div class="tm-file-slot">
                <span class="muted">Versão Base:</span> <b>Banco de Dados Local Atual</b>
              </div>
              <div class="tm-file-slot" style="margin-top:12px">
                <span class="muted">Nova Versão:</span>
                <b>${st.newXml ? escapeHtml(st.newXml.split(/[\\/]/).pop()) : "Nenhum arquivo XML selecionado"}</b>
                <button type="button" class="btn btn-secondary btn-sm" data-tm="pick-new">📄 Escolher novo XML…</button>
              </div>
            ` : `
              <div class="tm-file-slot">
                <span class="muted">XML Anterior (Base):</span>
                <b>${st.oldXml ? escapeHtml(st.oldXml.split(/[\\/]/).pop()) : "Nenhum selecionado"}</b>
                <button type="button" class="btn btn-secondary btn-sm" data-tm="pick-old">📄 Escolher XML anterior…</button>
              </div>
              <div class="tm-file-slot" style="margin-top:12px">
                <span class="muted">XML Recente:</span>
                <b>${st.newXml ? escapeHtml(st.newXml.split(/[\\/]/).pop()) : "Nenhum selecionado"}</b>
                <button type="button" class="btn btn-secondary btn-sm" data-tm="pick-new">📄 Escolher XML recente…</button>
              </div>
            `}

            <div style="margin-top:20px; text-align:center;">
              <button type="button" class="btn btn-primary" data-tm="run" ${!st.newXml || (st.mode === "two_xmls" && !st.oldXml) ? "disabled" : ""}>
                ⚡ Comparar Versões
              </button>
            </div>
          </div>
        </div>`
      );

      this.el.querySelectorAll("[data-tm-mode]").forEach((b) => b.addEventListener("click", () => {
        st.mode = b.dataset.tmMode;
        this.toolTimeMachine();
      }));

      this.el.querySelector('[data-tm="pick-new"]')?.addEventListener("click", async () => {
        try {
          const path = await api.selectXmlFile();
          if (path) {
            st.newXml = path;
            this.toolTimeMachine();
          }
        } catch (e) {
          showToast(`Erro: ${e}`, "error");
        }
      });

      this.el.querySelector('[data-tm="pick-old"]')?.addEventListener("click", async () => {
        try {
          const path = await api.selectXmlFile();
          if (path) {
            st.oldXml = path;
            this.toolTimeMachine();
          }
        } catch (e) {
          showToast(`Erro: ${e}`, "error");
        }
      });

      this.el.querySelector('[data-tm="run"]')?.addEventListener("click", async () => {
        this.shell(
          "Lattes Time Machine",
          "Cruzando dados curriculares e calculando diferenças…",
          `<div class="loading-state" style="display:flex; flex-direction:column; gap:16px;">
            <div class="spinner"></div>
            <div>Processando comparação semântica entre as duas versões…</div>
          </div>`
        );
        try {
          st.diff = await api.diffLattesXml(st.newXml, st.mode === "two_xmls" ? st.oldXml : null);
          this.toolTimeMachine();
        } catch (e) {
          st.diff = null;
          showToast(`Falha na comparação: ${e}`, "error");
          this.toolTimeMachine();
        }
      });
      return;
    }

    const diff = st.diff;
    let list = [];
    if (st.statusFilter === "added" || st.statusFilter === "all") {
      list.push(...diff.added.map((x) => ({ ...x, _kind: "added" })));
    }
    if (st.statusFilter === "modified" || st.statusFilter === "all") {
      list.push(...diff.modified.map((x) => ({ ...x, _kind: "modified" })));
    }
    if (st.statusFilter === "removed" || st.statusFilter === "all") {
      list.push(...diff.removed.map((x) => ({ ...x, _kind: "removed" })));
    }

    if (st.catFilter !== "all") {
      list = list.filter((x) => x.category === st.catFilter);
    }

    this.shell(
      "Lattes Time Machine (Comparador de Versões)",
      `Comparação: <b>${escapeHtml(diff.title_old)}</b> (${escapeHtml(diff.date_old || "data anterior")}) ➔ <b>${escapeHtml(diff.title_new)}</b> (${escapeHtml(diff.date_new || "recente")})`,
      `<div class="tm-container">
        <div class="tm-stats-grid">
          <div class="tm-stat-card good">
            <b>+${diff.total_added}</b>
            <span>Novos Registros</span>
          </div>
          <div class="tm-stat-card warn">
            <b>Δ${diff.total_modified}</b>
            <span>Registros Alterados</span>
          </div>
          <div class="tm-stat-card bad">
            <b>-${diff.total_removed}</b>
            <span>Registros Ausentes</span>
          </div>
          <div class="tm-stat-card info">
            <b>=${diff.total_unchanged}</b>
            <span>Inalterados</span>
          </div>
        </div>

        <div class="tl-bar">
          <div class="seg tl-seg-sm">
            <button type="button" data-tm-st="all" class="${st.statusFilter === "all" ? "on" : ""}">Todos (${diff.total_added + diff.total_modified + diff.total_removed})</button>
            <button type="button" data-tm-st="added" class="${st.statusFilter === "added" ? "on" : ""}">🟢 Novos (+${diff.total_added})</button>
            <button type="button" data-tm-st="modified" class="${st.statusFilter === "modified" ? "on" : ""}">🟡 Alterados (Δ${diff.total_modified})</button>
            <button type="button" data-tm-st="removed" class="${st.statusFilter === "removed" ? "on" : ""}">🔴 Ausentes (-${diff.total_removed})</button>
          </div>
          <div style="flex:1"></div>
          <button type="button" class="btn btn-secondary btn-sm" data-tm="copy">📋 Copiar relatório das alterações</button>
          <button type="button" class="btn btn-secondary btn-sm" data-tm="reset">Nova comparação</button>
        </div>

        <div class="tm-cat-pills">
          <button type="button" class="tm-pill ${st.catFilter === "all" ? "on" : ""}" data-cat="all">Todas as categorias</button>
          ${diff.categories.filter((c) => (c.added + c.modified + c.removed) > 0).map((c) => `
            <button type="button" class="tm-pill ${st.catFilter === c.category ? "on" : ""}" data-cat="${escapeHtml(c.category)}">
              ${escapeHtml(c.category_label)} (${c.added + c.modified + c.removed})
            </button>
          `).join("")}
        </div>

        ${list.length ? `
          <div class="tl-table">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:100px">Status</th>
                  <th style="width:170px">Categoria</th>
                  <th style="width:60px">Ano</th>
                  <th>Título / Alterações Detectadas</th>
                </tr>
              </thead>
              <tbody>
                ${list.map((it) => {
        let badge = "";
        if (it._kind === "added") badge = '<span class="badge" style="background:rgba(16,185,129,0.12);color:var(--success);font-weight:700;">+ NOVO</span>';
        else if (it._kind === "modified") badge = '<span class="badge" style="background:rgba(245,158,11,0.12);color:var(--warning);font-weight:700;">Δ ALTERADO</span>';
        else badge = '<span class="badge" style="background:rgba(239,68,68,0.12);color:var(--danger);font-weight:700;">- AUSENTE</span>';

        return `
                    <tr>
                      <td>${badge}</td>
                      <td>
                        <span class="badge badge-tipo">${escapeHtml(it.category_label)}</span><br>
                        <small class="muted">${escapeHtml(it.tipo)}</small>
                      </td>
                      <td>${it.ano || "—"}</td>
                      <td>
                        <div style="font-weight:600; color:var(--text-primary); margin-bottom:4px;">
                          ${escapeHtml(it.titulo)}
                        </div>
                        ${it._kind === "modified" && it.changes ? `
                          <div class="tm-diff-block">
                            ${it.changes.map((c) => `
                              <div class="tm-diff-line">
                                <b style="color:var(--text-secondary)">${escapeHtml(c.field_label)}:</b>
                                <span class="tl-old">${escapeHtml(c.old_val)}</span>
                                <span style="color:var(--text-secondary)">➔</span>
                                <span class="tl-new">${escapeHtml(c.new_val)}</span>
                              </div>
                            `).join("")}
                          </div>
                        ` : it.extra ? `<small class="muted">${escapeHtml(it.extra)}</small>` : ""}
                      </td>
                    </tr>
                  `;
      }).join("")}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="tl-empty">
            Nenhum registro para o filtro selecionado.
          </div>
        `}
      </div>`
    );

    this.el.querySelectorAll("[data-tm-st]").forEach((b) => b.addEventListener("click", () => {
      st.statusFilter = b.dataset.tmSt;
      this.toolTimeMachine();
    }));

    this.el.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => {
      st.catFilter = b.dataset.cat;
      this.toolTimeMachine();
    }));

    this.el.querySelector('[data-tm="reset"]')?.addEventListener("click", () => {
      st.diff = null;
      st.newXml = null;
      st.oldXml = null;
      this.toolTimeMachine();
    });

    this.el.querySelector('[data-tm="copy"]')?.addEventListener("click", async () => {
      const lines = [];
      lines.push("=== RELATÓRIO DE ALTERAÇÕES CURRICULARES (LATTES TIME MACHINE) ===");
      lines.push(`Base: ${diff.title_old} (${diff.date_old || "data anterior"})`);
      lines.push(`Nova: ${diff.title_new} (${diff.date_new || "recente"})`);
      lines.push(`Data do relatório: ${new Date().toLocaleDateString("pt-BR")}`);
      lines.push("");
      lines.push(`RESUMO GERAL:`);
      lines.push(`• Novos registros: ${diff.total_added}`);
      lines.push(`• Registros alterados: ${diff.total_modified}`);
      lines.push(`• Registros ausentes: ${diff.total_removed}`);
      lines.push(`• Inalterados: ${diff.total_unchanged}`);
      lines.push("");

      if (diff.added.length) {
        lines.push("--- NOVOS REGISTROS ADICIONADOS ---");
        for (const it of diff.added) {
          lines.push(`+ [${it.category_label}] (${it.ano || "s/ ano"}) ${it.titulo}${it.extra ? ` — ${it.extra}` : ""}`);
        }
        lines.push("");
      }

      if (diff.modified.length) {
        lines.push("--- REGISTROS ALTERADOS ---");
        for (const it of diff.modified) {
          lines.push(`Δ [${it.category_label}] (${it.ano || "s/ ano"}) ${it.titulo}`);
          for (const c of it.changes) {
            lines.push(`    • ${c.field_label}: ${c.old_val} ➔ ${c.new_val}`);
          }
        }
        lines.push("");
      }

      const txt = lines.join("\n");
      try {
        await navigator.clipboard.writeText(txt);
        showToast("Relatório copiado para a área de transferência!", "success", 3000);
      } catch {
        showToast("Erro ao copiar para a área de transferência", "error");
      }
    });
  }

  // ===== CHECAGEM CRUZADA (BD × XML: INTERSEÇÃO, UNIÃO, DIFERENÇAS) =====
  async toolCrossCheck() {
    const st = this.state;
    st.xmlPath ??= localStorage.getItem("lattes_last_xcheck_xml") || null;
    st.result ??= null;
    st.loading ??= false;
    st.setFilter ??= "only_xml"; // "union" | "intersection" | "only_xml" | "only_db"
    st.catFilter ??= "all";
    st.query ??= "";
    st.selectedXmlIndices ??= new Set();
    st.importing ??= false;

    const runCheck = async (path) => {
      if (!path) return;
      st.loading = true;
      this.toolCrossCheck();
      try {
        st.result = await api.crossCheckLattesXml(path);
        st.selectedXmlIndices = new Set();
        localStorage.setItem("lattes_last_xcheck_xml", path);
      } catch (e) {
        st.result = null;
        showToast(`Falha na checagem cruzada: ${e}`, "error");
      } finally {
        st.loading = false;
        this.toolCrossCheck();
      }
    };

    if (!st.result) {
      this.shell(
        "Checagem Cruzada (Banco de Dados × XML do Lattes)",
        "Compare seu banco de dados atual com o arquivo XML do Lattes para visualizar interseção (BD ∩ XML), união (BD ∪ XML), itens faltando no banco (XML \\ BD) e itens sobrando no banco (BD \\ XML).",
        `<div class="tm-setup-box">
          <div class="tm-picker-grid">
            <div class="tm-picker-card" style="display:flex; flex-direction:column; align-items:flex-start; gap:8px;">
              <div class="tm-picker-lbl">📄 Arquivo XML do Currículo Lattes</div>
              <div class="tm-picker-val mono">${st.xmlPath ? escapeHtml(st.xmlPath) : "Nenhum arquivo selecionado"}</div>
              <button type="button" class="btn btn-secondary btn-sm" id="xc-pick-xml">Selecionar XML do Lattes...</button>
            </div>
          </div>
          <div style="margin-top: 16px; display: flex; justify-content: flex-end; gap: 10px;">
            <button type="button" class="btn btn-primary" id="xc-run" ${!st.xmlPath || st.loading ? "disabled" : ""}>
              ${st.loading ? "⏳ Analisando banco e XML..." : "🔀 Executar Checagem Cruzada"}
            </button>
          </div>
        </div>`
      );

      this.el.querySelector("#xc-pick-xml")?.addEventListener("click", async () => {
        try {
          const p = await api.selectXmlFile();
          if (p) {
            st.xmlPath = p;
            this.toolCrossCheck();
          }
        } catch (e) {
          showToast(String(e), "error");
        }
      });

      this.el.querySelector("#xc-run")?.addEventListener("click", () => runCheck(st.xmlPath));
      return;
    }

    const res = st.result;
    const covPct = res.total_union > 0 ? Math.round((res.total_intersection / res.total_union) * 100) : 100;

    // Indexed items so we can track selection of only_xml items reliably
    const indexedItems = res.items.map((it, idx) => ({ ...it, _idx: idx }));
    const q = (st.query || "").trim().toLowerCase();
    const filtered = indexedItems.filter((it) => {
      if (st.setFilter !== "union" && it.status !== st.setFilter) return false;
      if (st.catFilter !== "all" && it.category !== st.catFilter) return false;
      if (q) {
        const hay = `${it.titulo || ""} ${it.tipo || ""} ${it.extra || ""} ${it.ano || ""} ${it.category_label || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const visibleOnlyXml = filtered.filter((it) => it.status === "only_xml" && it.xml_item);
    const allVisibleXmlSelected = visibleOnlyXml.length > 0 && visibleOnlyXml.every((it) => st.selectedXmlIndices.has(it._idx));

    this.shell(
      "Checagem Cruzada (Banco de Dados × XML do Lattes)",
      `Banco de Dados Atual × <b>${escapeHtml(res.xml_name)}</b> ${res.xml_date ? `(${escapeHtml(res.xml_date)})` : ""} · Cobertura da interseção: <b>${covPct}%</b>`,
      `<div class="tm-container">
        <div class="tm-stats-grid">
          <div class="tm-stat-card tm-stat-unchanged" data-xc-set="union" style="cursor:pointer;" title="Clique para ver a União (BD ∪ XML)">
            <b>∪ ${res.total_union}</b>
            <span>União (BD ∪ XML)</span>
          </div>
          <div class="tm-stat-card tm-stat-added" data-xc-set="intersection" style="cursor:pointer;" title="Clique para ver a Interseção (BD ∩ XML)">
            <b>∩ ${res.total_intersection}</b>
            <span>Interseção (BD ∩ XML)</span>
          </div>
          <div class="tm-stat-card tm-stat-modified" data-xc-set="only_xml" style="cursor:pointer;" title="Clique para ver o que está faltando no Banco (XML \\ BD)">
            <b>+${res.total_only_xml}</b>
            <span>Só no XML (Faltando no BD)</span>
          </div>
          <div class="tm-stat-card tm-stat-removed" data-xc-set="only_db" style="cursor:pointer;" title="Clique para ver o que está sobrando no Banco (BD \\ XML)">
            <b>-${res.total_only_db}</b>
            <span>Só no Banco (Sobrando no BD)</span>
          </div>
        </div>

        <div style="margin: 14px 0;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
            <b style="font-size:13px; color:var(--text-secondary);">Resumo por Categoria (clique em uma linha ou valor para filtrar)</b>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm" id="xc-recheck" ${st.loading ? "disabled" : ""}>🔄 Reanalisar</button>
              <button type="button" class="btn btn-secondary btn-sm" id="xc-copy-report">📋 Copiar Relatório</button>
              <button type="button" class="btn btn-secondary btn-sm" id="xc-change-xml">📄 Trocar XML</button>
            </div>
          </div>
          <div class="tl-table sm" style="max-height:260px;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th style="text-align:right;">No Banco</th>
                  <th style="text-align:right;">No XML</th>
                  <th style="text-align:right;">Interseção (BD ∩ XML)</th>
                  <th style="text-align:right;">Faltando (XML \\ BD)</th>
                  <th style="text-align:right;">Sobrando (BD \\ XML)</th>
                  <th style="text-align:right;">União (BD ∪ XML)</th>
                  <th style="text-align:right;">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                ${res.categories.map((c) => {
                  const pct = c.union_count > 0 ? Math.round((c.intersection / c.union_count) * 100) : 100;
                  const activeRow = st.catFilter === c.category ? 'style="background:rgba(99,102,241,0.12);"' : "";
                  return `<tr ${activeRow}>
                    <td>
                      <button type="button" class="btn-link" data-xc-cat-jump="${escapeHtml(c.category)}" data-xc-set-jump="union" style="background:none;border:0;color:var(--text-primary);font-weight:600;cursor:pointer;padding:0;text-align:left;">
                        ${escapeHtml(c.category_label)}
                      </button>
                    </td>
                    <td style="text-align:right;" class="mono">${c.db_count}</td>
                    <td style="text-align:right;" class="mono">${c.xml_count}</td>
                    <td style="text-align:right;">
                      <button type="button" data-xc-cat-jump="${escapeHtml(c.category)}" data-xc-set-jump="intersection" style="background:none;border:0;color:var(--success,#10b981);font-weight:700;cursor:pointer;padding:2px 6px;" class="mono">${c.intersection}</button>
                    </td>
                    <td style="text-align:right;">
                      <button type="button" data-xc-cat-jump="${escapeHtml(c.category)}" data-xc-set-jump="only_xml" style="background:none;border:0;color:${c.only_in_xml ? "var(--warning,#f59e0b)" : "var(--text-muted)"};font-weight:700;cursor:pointer;padding:2px 6px;" class="mono">${c.only_in_xml}</button>
                    </td>
                    <td style="text-align:right;">
                      <button type="button" data-xc-cat-jump="${escapeHtml(c.category)}" data-xc-set-jump="only_db" style="background:none;border:0;color:${c.only_in_db ? "var(--danger,#ef4444)" : "var(--text-muted)"};font-weight:700;cursor:pointer;padding:2px 6px;" class="mono">${c.only_in_db}</button>
                    </td>
                    <td style="text-align:right;">
                      <button type="button" data-xc-cat-jump="${escapeHtml(c.category)}" data-xc-set-jump="union" style="background:none;border:0;color:var(--text-primary);font-weight:600;cursor:pointer;padding:2px 6px;" class="mono">${c.union_count}</button>
                    </td>
                    <td style="text-align:right;" class="mono">${pct}%</td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <div class="tl-bar" style="flex-wrap:wrap; gap:10px; align-items:center;">
          <div class="seg tl-seg">
            <button type="button" data-xc-set="union" class="${st.setFilter === "union" ? "on" : ""}">∪ União (${res.total_union})</button>
            <button type="button" data-xc-set="intersection" class="${st.setFilter === "intersection" ? "on" : ""}">∩ Interseção (${res.total_intersection})</button>
            <button type="button" data-xc-set="only_xml" class="${st.setFilter === "only_xml" ? "on" : ""}">🟡 Só no XML (${res.total_only_xml})</button>
            <button type="button" data-xc-set="only_db" class="${st.setFilter === "only_db" ? "on" : ""}">🔴 Só no Banco (${res.total_only_db})</button>
          </div>
          <select id="xc-cat-select" class="form-select" style="width:auto; min-width:190px; height:32px; padding:0 10px;">
            <option value="all" ${st.catFilter === "all" ? "selected" : ""}>Todas as categorias</option>
            ${res.categories.map((c) => `<option value="${escapeHtml(c.category)}" ${st.catFilter === c.category ? "selected" : ""}>${escapeHtml(c.category_label)} (∪ ${c.union_count})</option>`).join("")}
          </select>
          <input type="text" id="xc-search" class="form-input" value="${escapeHtml(st.query)}" placeholder="Filtrar por título, tipo, ano..." style="flex:1; min-width:180px; height:32px;" />
        </div>

        ${visibleOnlyXml.length > 0 ? `
          <div class="tl-bar" style="flex-wrap:wrap; gap:10px; margin-top:8px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); border-radius:8px; padding:8px 12px;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px;">
              <input type="checkbox" id="xc-select-all-xml" ${allVisibleXmlSelected ? "checked" : ""} />
              Selecionar todos os ${visibleOnlyXml.length} item(ns) faltantes visíveis
            </label>
            <div style="flex:1"></div>
            <button type="button" class="btn btn-primary btn-sm" id="xc-import-sel" ${st.selectedXmlIndices.size === 0 || st.importing ? "disabled" : ""}>
              ${st.importing ? "⏳ Importando..." : `📥 Importar ${st.selectedXmlIndices.size} selecionado(s) para o Banco`}
            </button>
          </div>
        ` : ""}

        <div style="font-size:12px; color:var(--text-secondary); margin:8px 0 4px;">
          Exibindo <b>${filtered.length}</b> registro(s)
        </div>

        <div class="tl-table" style="max-height: 460px;">
          ${filtered.length ? `
            <table class="data-table">
              <thead>
                <tr>
                  ${visibleOnlyXml.length > 0 ? '<th style="width:34px;"></th>' : ""}
                  <th style="width:128px;">Conjunto</th>
                  <th style="width:72px;">Ano</th>
                  <th style="width:165px;">Categoria</th>
                  <th>Título / Descrição</th>
                  <th style="width:92px; text-align:right;">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.slice(0, 600).map((it) => {
                  const badge = it.status === "intersection"
                    ? '<span class="badge" style="background:rgba(16,185,129,0.16);color:#10b981;">∩ Em ambos</span>'
                    : it.status === "only_xml"
                      ? '<span class="badge" style="background:rgba(245,158,11,0.16);color:#f59e0b;">XML \\ BD</span>'
                      : '<span class="badge" style="background:rgba(239,68,68,0.16);color:#ef4444;">BD \\ XML</span>';
                  const chkCell = visibleOnlyXml.length > 0
                    ? `<td>${it.status === "only_xml" && it.xml_item ? `<input type="checkbox" data-xc-xml-chk="${it._idx}" ${st.selectedXmlIndices.has(it._idx) ? "checked" : ""} />` : ""}</td>`
                    : "";
                  const diffsHtml = it.field_diffs?.length
                    ? `<div class="tm-diff-block" style="margin-top:6px;">
                        ${it.field_diffs.map((d) => `<div class="tm-diff-line"><b style="color:var(--text-secondary)">${escapeHtml(d.field_label)}:</b> <span class="tl-old">${escapeHtml(d.old_val)}</span> <span class="tl-arr">→</span> <span class="tl-new">${escapeHtml(d.new_val)}</span></div>`).join("")}
                      </div>`
                    : "";
                  const actionsHtml = it.status === "only_xml" && it.xml_item
                    ? `<button type="button" class="ibtn" data-xc-import-one="${it._idx}" title="Importar este registro do XML para o banco">📥</button>`
                    : it.status === "only_db" && it.db_id != null
                      ? `<button type="button" class="ibtn" data-xc-del-db="${it.db_id}" data-xc-del-cat="${escapeHtml(it.category)}" title="Excluir este registro do banco">🗑️</button>`
                      : "";
                  return `<tr>
                    ${chkCell}
                    <td>${badge}</td>
                    <td class="mono">${it.ano || "—"}</td>
                    <td>
                      <div style="font-weight:600; font-size:12px;">${escapeHtml(it.category_label)}</div>
                      ${it.tipo ? `<div style="font-size:11px; color:var(--text-secondary);">${escapeHtml(it.tipo)}</div>` : ""}
                    </td>
                    <td>
                      <div style="font-weight:600;">${escapeHtml(it.titulo || "—")}</div>
                      <div style="font-size:11.5px; color:var(--text-secondary); display:flex; gap:8px; flex-wrap:wrap; margin-top:2px;">
                        ${it.extra ? `<span>${escapeHtml(it.extra)}</span>` : ""}
                        ${it.db_id != null ? `<span class="mono">#${it.db_id}</span>` : ""}
                        ${it.has_proof ? `<span style="color:#10b981;">📎 Comprovante</span>` : ""}
                      </div>
                      ${diffsHtml}
                    </td>
                    <td style="text-align:right; white-space:nowrap;">${actionsHtml}</td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          ` : `<div class="tl-empty">Nenhum registro encontrado para este conjunto/filtro.</div>`}
        </div>
      </div>`
    );

    // Bind events
    this.el.querySelectorAll("[data-xc-set]").forEach((el) =>
      el.addEventListener("click", () => {
        st.setFilter = el.dataset.xcSet;
        this.toolCrossCheck();
      })
    );

    this.el.querySelectorAll("[data-xc-cat-jump]").forEach((el) =>
      el.addEventListener("click", () => {
        st.catFilter = el.dataset.xcCatJump;
        st.setFilter = el.dataset.xcSetJump || "union";
        this.toolCrossCheck();
      })
    );

    this.el.querySelector("#xc-cat-select")?.addEventListener("change", (e) => {
      st.catFilter = e.target.value;
      this.toolCrossCheck();
    });

    this.el.querySelector("#xc-search")?.addEventListener("input", (e) => {
      st.query = e.target.value;
      const pos = e.target.selectionStart;
      this.toolCrossCheck();
      const inp = this.el.querySelector("#xc-search");
      if (inp) {
        inp.focus();
        if (pos != null) inp.setSelectionRange(pos, pos);
      }
    });

    this.el.querySelector("#xc-recheck")?.addEventListener("click", () => runCheck(st.xmlPath));
    this.el.querySelector("#xc-change-xml")?.addEventListener("click", () => {
      st.result = null;
      st.selectedXmlIndices = new Set();
      this.toolCrossCheck();
    });

    const updateImportBtn = () => {
      const btn = this.el.querySelector("#xc-import-sel");
      if (btn) {
        btn.disabled = st.selectedXmlIndices.size === 0 || st.importing;
        btn.textContent = st.importing ? "⏳ Importando..." : `📥 Importar ${st.selectedXmlIndices.size} selecionado(s) para o Banco`;
      }
    };

    this.el.querySelector("#xc-select-all-xml")?.addEventListener("change", (e) => {
      for (const it of visibleOnlyXml) {
        if (e.target.checked) st.selectedXmlIndices.add(it._idx);
        else st.selectedXmlIndices.delete(it._idx);
      }
      this.el.querySelectorAll("[data-xc-xml-chk]").forEach((c) => {
        c.checked = e.target.checked;
      });
      updateImportBtn();
    });

    this.el.querySelectorAll("[data-xc-xml-chk]").forEach((c) =>
      c.addEventListener("change", () => {
        const idx = Number(c.dataset.xcXmlChk);
        if (c.checked) st.selectedXmlIndices.add(idx);
        else st.selectedXmlIndices.delete(idx);
        const selAll = this.el.querySelector("#xc-select-all-xml");
        if (selAll) selAll.checked = visibleOnlyXml.length > 0 && visibleOnlyXml.every((it) => st.selectedXmlIndices.has(it._idx));
        updateImportBtn();
      })
    );

    this.el.querySelector("#xc-import-sel")?.addEventListener("click", async () => {
      const chosen = [...st.selectedXmlIndices]
        .map((i) => res.items[i]?.xml_item)
        .filter(Boolean);
      if (!chosen.length) return;
      st.importing = true;
      updateImportBtn();
      try {
        const n = await api.importLattesXml(chosen);
        showToast(`${n} registro(s) importado(s) do XML para o banco!`, "success");
        if (this.onChanged) await this.onChanged();
        await runCheck(st.xmlPath);
      } catch (e) {
        showToast(`Erro ao importar: ${e}`, "error");
      } finally {
        st.importing = false;
      }
    });

    this.el.querySelectorAll("[data-xc-import-one]").forEach((b) =>
      b.addEventListener("click", async () => {
        const item = res.items[Number(b.dataset.xcImportOne)]?.xml_item;
        if (!item) return;
        try {
          await api.importLattesXml([item]);
          showToast("Registro importado para o banco!", "success");
          if (this.onChanged) await this.onChanged();
          await runCheck(st.xmlPath);
        } catch (e) {
          showToast(`Erro ao importar: ${e}`, "error");
        }
      })
    );

    this.el.querySelectorAll("[data-xc-del-db]").forEach((b) =>
      b.addEventListener("click", async () => {
        const id = Number(b.dataset.xcDelDb);
        const cat = b.dataset.xcDelCat;
        if (!window.confirm(`Excluir o registro #${id} de "${cat}" do banco de dados? (Arquivos em disco serão preservados)`)) return;
        try {
          await api.deleteRecord(cat, id, false);
          showToast("Registro excluído do banco!", "success");
          if (this.onChanged) await this.onChanged();
          await runCheck(st.xmlPath);
        } catch (e) {
          showToast(`Erro ao excluir: ${e}`, "error");
        }
      })
    );

    this.el.querySelector("#xc-copy-report")?.addEventListener("click", async () => {
      const lines = [
        "=== CHECAGEM CRUZADA: BANCO DE DADOS × XML DO LATTES ===",
        `XML: ${res.xml_name}${res.xml_date ? ` (${res.xml_date})` : ""}`,
        `Data: ${new Date().toLocaleDateString("pt-BR")}`,
        "",
        `• União (BD ∪ XML): ${res.total_union}`,
        `• Interseção (BD ∩ XML): ${res.total_intersection} (${covPct}%)`,
        `• Só no XML (XML \\ BD — faltando no banco): ${res.total_only_xml}`,
        `• Só no Banco (BD \\ XML — sobrando no banco): ${res.total_only_db}`,
        "",
        "--- RESUMO POR CATEGORIA ---",
        ...res.categories.map(
          (c) => `${c.category_label}: BD=${c.db_count} | XML=${c.xml_count} | ∩=${c.intersection} | XML\\BD=${c.only_in_xml} | BD\\XML=${c.only_in_db} | ∪=${c.union_count}`
        ),
      ];
      const onlyXml = res.items.filter((i) => i.status === "only_xml");
      if (onlyXml.length) {
        lines.push("", "--- FALTANDO NO BANCO (XML \\ BD) ---");
        for (const it of onlyXml) {
          lines.push(`+ [${it.category_label}] (${it.ano || "s/ ano"}) ${it.titulo}`);
        }
      }
      const onlyDb = res.items.filter((i) => i.status === "only_db");
      if (onlyDb.length) {
        lines.push("", "--- SOBRANDO NO BANCO (BD \\ XML) ---");
        for (const it of onlyDb) {
          lines.push(`- [${it.category_label}] #${it.db_id || "?"} (${it.ano || "s/ ano"}) ${it.titulo}`);
        }
      }
      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        showToast("Relatório de checagem cruzada copiado!", "success", 3000);
      } catch {
        showToast("Erro ao copiar para a área de transferência", "error");
      }
    });
  }

  // ===== 1. formatador =====
  toolFormat() {
    const st = this.state;
    st.mode ||= "nomes";
    st.input ??= "";
    const modes = st.mode === "nomes"
      ? [["proprio", "Nome Próprio", titleCaseName], ["abnt", "ABNT", abntName], ["vanc", "Vancouver", vancouverName], ["upper", "MAIÚSCULAS", (s) => s.trim().toLocaleUpperCase("pt-BR")], ["arquivo", "nome_de_arquivo", fileSafe]]
      : st.mode === "titulos"
        ? [["sent", "Frase (sentence case)", sentenceCase], ["title", "Título (Title Case)", titleCaseJournal], ["arquivo", "nome_de_arquivo", fileSafe]]
        : [["br", "dd/mm/aaaa", (s) => { const d = parseDate(s); return d ? fmtDate(d, "br") : "⚠ não reconhecida"; }], ["iso", "aaaa-mm-dd", (s) => { const d = parseDate(s); return d ? fmtDate(d, "iso") : "⚠"; }], ["ext", "Por extenso", (s) => { const d = parseDate(s); return d ? fmtDate(d, "ext") : "⚠"; }], ["abnt", "ABNT (13 nov. 2026)", (s) => { const d = parseDate(s); return d ? fmtDate(d, "abnt") : "⚠"; }]];
    st.out ||= modes[0][0];
    if (!modes.find((m) => m[0] === st.out)) st.out = modes[0][0];
    const fn = modes.find((m) => m[0] === st.out)[2];
    const lines = st.input.split(/\n/);
    const out = lines.map((l) => (l.trim() ? fn(l) : "")).join("\n");
    const sep = st.mode === "nomes" && st.out === "abnt" ? "; " : "\n";
    this.shell(
      "Formatador de nomes e datas",
      "Uma entrada por linha. Nomes separados por ponto e vírgula também são aceitos.",
      `<div class="seg tl-seg">${[["nomes", "👤 Nomes"], ["titulos", "📰 Títulos"], ["datas", "📅 Datas"]].map(([k, t]) => `<button type="button" data-mode="${k}" class="${st.mode === k ? "on" : ""}">${t}</button>`).join("")}</div>
      <div class="tl-fmt">
        <div><div class="rb-label">Entrada</div>
          <textarea id="fmt-in" class="form-textarea tl-area" placeholder="${st.mode === "nomes" ? "JOÃO DA SILVA\nmaria de souza santos" : st.mode === "titulos" ? "JOURNAL OF PLANT BREEDING\nSELEÇÃO GENÔMICA EM MILHO" : "13/11/2026\n2026-11-13\n13 de novembro de 2026"}">${escapeHtml(st.input)}</textarea></div>
        <div><div class="rb-label">Resultado</div>
          <div class="seg tl-seg-sm">${modes.map(([k, t]) => `<button type="button" data-out="${k}" class="${st.out === k ? "on" : ""}">${t}</button>`).join("")}</div>
          <textarea id="fmt-out" class="form-textarea tl-area out" readonly>${escapeHtml(sep === "; " ? out.split("\n").filter(Boolean).join("; ") : out)}</textarea>
          <button type="button" class="btn btn-primary btn-sm" data-copy>📋 Copiar resultado</button></div>
      </div>`
    );
    const inp = this.el.querySelector("#fmt-in");
    inp.addEventListener("input", () => {
      // aceita "Nome A; Nome B" e transforma em linhas
      st.input = st.mode === "nomes" ? inp.value.replace(/\s*;\s*/g, "\n") : inp.value;
      const pos = inp.selectionStart;
      this.toolFormat();
      const ni = this.el.querySelector("#fmt-in");
      ni.focus();
      ni.selectionStart = ni.selectionEnd = Math.min(pos, ni.value.length);
    });
    this.el.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { st.mode = b.dataset.mode; st.out = null; this.toolFormat(); }));
    this.el.querySelectorAll("[data-out]").forEach((b) => b.addEventListener("click", () => { st.out = b.dataset.out; this.toolFormat(); }));
    this.el.querySelector("[data-copy]").addEventListener("click", async () => {
      const v = this.el.querySelector("#fmt-out").value;
      try {
        await navigator.clipboard.writeText(v);
        showToast("Copiado", "success", 1500);
      } catch {
        this.el.querySelector("#fmt-out").select();
        document.execCommand("copy");
      }
    });
  }

  // ===== 2. padronizar registros =====
  async toolTidy() {
    const st = this.state;
    if (!st.data) {
      this.shell("Padronizar textos dos registros", "Carregando…", `<div class="loading-state" style="display:flex"><div class="spinner"></div></div>`);
      st.data = await api.getAllRecords();
      st.target ||= "todos";
    }
    const allCats = Array.from(new Set([...Object.keys(CATEGORY_SCHEMAS), ...Object.keys(st.data || {})]));
    const ALL_TEXT_FIELDS = ["titulo", "descricao", "aluno", "journal", "disciplina", "curso"];
    const UPPER_FIELDS = ["titulo", "descricao", "disciplina", "curso"];
    const INICIAIS_CATS = allCats.filter((c) => c !== "eventos" && c !== "disciplinas");
    const FIELD_LABELS = {
      titulo: "Título",
      descricao: "Descrição",
      journal: "Periódico / Evento",
      disciplina: "Disciplina",
      curso: "Curso",
      aluno: "Orientando / Candidato",
    };

    const transformField = (cat, field, val, mode) => {
      if (mode === "espacos") return cleanSpacesAndPunct(val);
      if (mode === "titulo_upper") return UPPER_FIELDS.includes(field) ? formatUpperText(val, cat) : val;
      if (mode === "iniciais") return INICIAIS_CATS.includes(cat) && (field === "titulo" || field === "descricao") ? titleCaseToSentence(val) : val;
      if (mode === "journal") {
        if (cat === "producoes" && field === "journal") return titleCaseJournal(val);
        if (
          (cat === "eventos" && field === "descricao") ||
          (cat === "formacao" && field === "descricao") ||
          (cat === "encargos" && field === "descricao") ||
          (cat === "disciplinas" && (field === "disciplina" || field === "curso"))
        ) {
          return normalizeAcronymsAndPreps(val);
        }
        return val;
      }
      if (mode === "aluno") return (cat === "orientacoes" || cat === "bancas") && field === "aluno" ? titleCaseName(val) : val;
      if (mode === "todos") {
        let cur = transformField(cat, field, val, "espacos");
        cur = transformField(cat, field, cur, "titulo_upper");
        cur = transformField(cat, field, cur, "journal");
        cur = transformField(cat, field, cur, "iniciais");
        cur = transformField(cat, field, cur, "aluno");
        return cur;
      }
      return val;
    };

    const TARGETS = [
      ["todos", "Todos"],
      ["titulo_upper", "Títulos em MAIÚSCULAS"],
      ["iniciais", "Iniciais Maiúsculas"],
      ["journal", "Periódicos, eventos e cursos"],
      ["espacos", "Espaços, pontuação e siglas"],
      ["aluno", "Nomes de orientandos e candidatos"],
    ];

    const collectChanges = (mode) => {
      const list = [];
      for (const c of allCats) {
        for (const r of st.data[c] || []) {
          for (const f of ALL_TEXT_FIELDS) {
            const v = r[f];
            if (typeof v !== "string" || !v.trim()) continue;
            const nv = transformField(c, f, v, mode);
            if (nv && nv !== v) list.push({ c, id: r.id, f, v, nv });
          }
        }
      }
      return list;
    };

    const changesByTarget = Object.fromEntries(TARGETS.map(([k]) => [k, collectChanges(k)]));
    if (!changesByTarget[st.target]) st.target = "todos";
    const label = TARGETS.find(([k]) => k === st.target)[1];
    const changes = changesByTarget[st.target];
    st.changes = changes;
    st.sel ||= new Set();
    if (st.lastTarget !== st.target) {
      st.sel = new Set(changes.map((_, i) => i));
      st.lastTarget = st.target;
    }
    this.shell(
      "Padronizar textos dos registros",
      "Escolha o que padronizar, revise a prévia e aplique. Só os itens marcados são alterados.",
      `<div class="seg tl-seg">${TARGETS.map(([k, t]) => `<button type="button" data-target="${k}" class="${st.target === k ? "on" : ""}">${escapeHtml(t)} <span class="tl-tab-cnt">${changesByTarget[k].length}</span></button>`).join("")}</div>
      ${changes.length
        ? `<div class="tl-bar"><span><b>${changes.length}</b> alteração(ões) sugerida(s) · ${escapeHtml(label)}</span>
            <button type="button" class="btn btn-secondary btn-sm" data-all>Marcar/desmarcar todas</button>
            <button type="button" class="btn btn-primary btn-sm" data-apply>Aplicar ${st.sel.size} alteração(ões)</button></div>
          <div class="tl-table"><table class="data-table"><thead><tr><th style="width:36px"></th><th style="width:170px">Categoria</th><th>Antes</th><th>Depois</th></tr></thead><tbody>
          ${changes.slice(0, 400).map((x, i) => `<tr><td><input type="checkbox" data-i="${i}" ${st.sel.has(i) ? "checked" : ""}/></td><td><span class="badge badge-tipo">${escapeHtml(CATEGORY_SCHEMAS[x.c]?.group || x.c)}</span><small class="tl-field-sub">${escapeHtml(FIELD_LABELS[x.f] || x.f)}</small></td><td class="tl-old">${escapeHtml(x.v)}</td><td class="tl-new">${escapeHtml(x.nv)}</td></tr>`).join("")}
          </tbody></table></div>`
        : `<div class="tl-empty">✅ Nada a padronizar em <b>${escapeHtml(label)}</b>.</div>`}`
    );
    this.el.querySelectorAll("[data-target]").forEach((b) => b.addEventListener("click", () => { st.target = b.dataset.target; this.toolTidy(); }));
    this.el.querySelectorAll("[data-i]").forEach((c) => c.addEventListener("change", () => { c.checked ? st.sel.add(+c.dataset.i) : st.sel.delete(+c.dataset.i); this.el.querySelector("[data-apply]").textContent = `Aplicar ${st.sel.size} alteração(ões)`; }));
    this.el.querySelector("[data-all]")?.addEventListener("click", () => { st.sel = st.sel.size ? new Set() : new Set(changes.map((_, i) => i)); this.toolTidy(); });
    this.el.querySelector("[data-apply]")?.addEventListener("click", async () => {
      const todo = [...st.sel].map((i) => changes[i]).filter(Boolean);
      if (!todo.length) return;
      // agrupa por registro
      const by = new Map();
      for (const x of todo) {
        const k = `${x.c}:${x.id}`;
        by.set(k, { ...(by.get(k) || { c: x.c, id: x.id, data: {} }) });
        by.get(k).data[x.f] = x.nv;
      }
      let ok = 0, err = 0;
      for (const { c, id, data } of by.values()) {
        try {
          await api.updateRecord(c, id, data);
          ok++;
        } catch {
          err++;
        }
      }
      showToast(`${ok} registro(s) atualizado(s)${err ? ` · ${err} erro(s)` : ""}`, err ? "error" : "success", 3500);
      st.data = null;
      st.lastTarget = null;
      this.onChanged && this.onChanged();
      this.toolTidy();
    });
  }

  // ===== 3. renomear =====
  async toolRename() {
    const st = this.state;
    if (!st.items) {
      this.shell("Renomear comprovantes", "Calculando os novos nomes…", `<div class="loading-state" style="display:flex"><div class="spinner"></div></div>`);
      try {
        st.items = await api.previewFileRenames();
      } catch (e) {
        st.items = [];
        showToast(`Erro: ${e}`, "error");
      }
      st.sel = new Set(st.items.map((_, i) => i));
    }
    const items = st.items;
    const base = (p) => p.split("\\").pop();
    this.shell(
      "Renomear comprovantes",
      "Padrão: <code>NNN_titulo_do_registro.pdf</code> — minúsculas, sem acentos, palavras unidas por <code>_</code>. O número da frente é mantido. Novos anexos já são salvos assim.",
      items.length
        ? `<div class="tl-bar"><span><b>${items.length}</b> arquivo(s) fora do padrão</span>
            <button type="button" class="btn btn-secondary btn-sm" data-all>Marcar/desmarcar todos</button>
            <button type="button" class="btn btn-primary btn-sm" data-apply>Renomear ${st.sel.size} arquivo(s)</button></div>
          <div class="tl-table"><table class="data-table"><thead><tr><th style="width:36px"></th><th style="width:130px">Categoria</th><th>Nome atual</th><th>Novo nome</th></tr></thead><tbody>
          ${items.map((x, i) => `<tr><td><input type="checkbox" data-i="${i}" ${st.sel.has(i) ? "checked" : ""}/></td><td><span class="badge badge-tipo">${escapeHtml(CATEGORY_SCHEMAS[x.category]?.group || x.category)}</span></td><td class="tl-old mono" title="${escapeHtml(x.old_path)}">${escapeHtml(base(x.old_path))}</td><td class="tl-new mono" title="${escapeHtml(x.titulo)}">${escapeHtml(base(x.new_path))}</td></tr>`).join("")}
          </tbody></table></div>
          <p class="dd-note">Feche os PDFs abertos em outros programas antes de renomear. Os arquivos continuam na mesma pasta.</p>`
        : `<div class="tl-empty">✅ Todos os comprovantes já seguem o padrão de nomes.</div>`
    );
    this.el.querySelectorAll("[data-i]").forEach((c) => c.addEventListener("change", () => { c.checked ? st.sel.add(+c.dataset.i) : st.sel.delete(+c.dataset.i); this.el.querySelector("[data-apply]").textContent = `Renomear ${st.sel.size} arquivo(s)`; }));
    this.el.querySelector("[data-all]")?.addEventListener("click", () => { st.sel = st.sel.size ? new Set() : new Set(items.map((_, i) => i)); this.toolRename(); });
    this.el.querySelector("[data-apply]")?.addEventListener("click", async () => {
      const todo = [...st.sel].map((i) => items[i]);
      if (!todo.length || !window.confirm(`Renomear ${todo.length} arquivo(s) no disco?`)) return;
      try {
        const r = await api.applyFileRenames(todo);
        showToast(`${r.ok} arquivo(s) renomeado(s)${r.erros.length ? ` · ${r.erros.length} erro(s)` : ""}`, r.erros.length ? "error" : "success", 4000);
        if (r.erros.length) console.warn(r.erros);
        st.errors = r.erros;
      } catch (e) {
        showToast(`Erro: ${e}`, "error");
      }
      st.items = null;
      this.onChanged && this.onChanged();
      this.toolRename();
    });
  }

  // ===== 4. verificar =====
  async toolCheck() {
    const st = this.state;
    if (!st.fc) {
      this.shell("Verificar arquivos", "Varrendo as pastas…", `<div class="loading-state" style="display:flex"><div class="spinner"></div></div>`);
      try {
        st.fc = await api.checkFiles();
      } catch (e) {
        showToast(`Erro: ${e}`, "error");
        st.fc = { total_vinculados: 0, ausentes: [], orfaos: [], orfaos_bytes: 0 };
      }
    }
    const fc = st.fc;
    const mb = (b) => (b / 1048576).toFixed(1) + " MB";
    this.shell(
      "Verificar arquivos",
      `${fc.total_vinculados} comprovantes vinculados verificados.`,
      `<div class="tl-stats">
        <div class="${fc.ausentes.length ? "bad" : "good"}"><b>${fc.ausentes.length}</b><span>registros com arquivo ausente</span></div>
        <div class="${fc.orfaos.length ? "warn" : "good"}"><b>${fc.orfaos.length}</b><span>arquivos sem registro (${mb(fc.orfaos_bytes)})</span></div>
        <div class="good"><b>${fc.total_vinculados - fc.ausentes.length}</b><span>vínculos OK</span></div>
      </div>
      <div class="tl-bar" style="margin-bottom:14px;">
        <span class="muted">Deseja inspecionar pastas em branco ou pastas no disco sem vínculo em Subpastas?</span>
        <div style="flex:1"></div>
        <button type="button" class="btn btn-secondary btn-sm" data-open-folders>🗂️ Auditar pastas em branco / sem vínculo</button>
      </div>
      ${fc.ausentes.length ? `<div class="tl-bar" style="margin-bottom:10px; border:1px solid var(--border-light); border-radius:10px; padding:10px 12px;">
        <span class="muted" style="flex:1; min-width:240px;">Arquivos renomeados ou movidos (inclusive pelo “Renomear comprovantes”)? O reparo procura o arquivo novo de cada vínculo — pelo nome já gravado no registro ou pelo mesmo número (ex.: <code>037_…</code>) na mesma pasta — e reaponta registro e anexos.</span>
        <button type="button" class="btn btn-primary btn-sm" data-repair>🔧 Reparar vínculos automaticamente</button>
      </div>
      <h3 class="tl-h3">Arquivo ausente
        <button type="button" class="btn btn-secondary btn-sm" data-clear>Remover esses vínculos quebrados</button>
        <button type="button" class="btn btn-primary btn-sm" data-open-invalid style="margin-left:8px;">⚠️ Corrigir na Tabela de Inválidos</button>
      </h3>
        <div class="tl-table sm"><table class="data-table"><tbody>${fc.ausentes.map((x) => `<tr><td style="width:130px"><span class="badge badge-tipo">${escapeHtml(CATEGORY_SCHEMAS[x.category]?.group || x.category)}</span></td><td>#${x.id} ${escapeHtml(x.titulo)}</td><td class="mono tl-old">${escapeHtml(x.path)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${fc.orfaos.length ? `<h3 class="tl-h3">Arquivos sem registro <button type="button" class="btn btn-primary btn-sm" data-link>🔗 Vincular automaticamente</button></h3>
        <div class="tl-table sm"><table class="data-table"><tbody>${fc.orfaos.slice(0, 500).map((f) => `<tr><td class="mono">${escapeHtml(f)}</td><td style="width:90px;text-align:right"><button type="button" class="ibtn" data-reveal="${escapeHtml(f)}" title="Mostrar na pasta">📂</button></td></tr>`).join("")}</tbody></table></div>` : ""}
      ${!fc.ausentes.length && !fc.orfaos.length ? '<div class="tl-empty">✅ Tudo em ordem: todos os vínculos apontam para arquivos existentes e não há arquivos soltos.</div>' : ""}`
    );
    this.el.querySelector("[data-open-folders]")?.addEventListener("click", () => this.open("folders_audit"));
    this.el.querySelector("[data-link]")?.addEventListener("click", () => this.openLinker && this.openLinker());
    this.el.querySelector("[data-open-invalid]")?.addEventListener("click", () => this.open("invalid_proofs"));
    this.el.querySelectorAll("[data-reveal]").forEach((b) => b.addEventListener("click", () => api.revealInExplorer(b.dataset.reveal).catch(() => { })));
    this.el.querySelector("[data-repair]")?.addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        const r = await api.repairFileLinks();
        const resto = r.sem_solucao?.length || 0;
        showToast(
          `🔧 ${r.corrigidos} vínculo(s) reapontado(s)${r.orfaos_removidos ? ` · ${r.orfaos_removidos} anexo(s) de registros excluídos removido(s)` : ""}${resto ? ` · ${resto} sem arquivo correspondente` : ""}`,
          resto ? "info" : "success",
          6000
        );
      } catch (err) {
        showToast(`Erro ao reparar: ${err}`, "error");
      }
      st.fc = null;
      this.onChanged && this.onChanged();
      this.toolCheck();
    });
    this.el.querySelector("[data-clear]")?.addEventListener("click", async () => {
      if (!window.confirm(`Remover o vínculo de ${fc.ausentes.length} registro(s) com arquivos que não existem mais?\nOs registros continuam; só ficam "sem comprovante".`)) return;
      const r = await api.clearMissingLinks(fc.ausentes).catch((e) => ({ ok: 0, erros: [String(e)] }));
      showToast(`${r.ok} vínculo(s) removido(s)`, r.erros.length ? "error" : "success");
      st.fc = null;
      this.onChanged && this.onChanged();
      this.toolCheck();
    });
  }

  // ===== 4b. auditoria e limpeza de pastas =====
  async toolFoldersAudit() {
    const st = this.state;
    st.tab ??= "empty";
    st.emptyFilter ??= "all";
    st.removeMappingsWithEmpty ??= false;

    if (!st.audit) {
      this.shell(
        "Auditoria e Limpeza de Pastas",
        "Varrendo a pasta raiz recursivamente e cruzando com Subpastas e Registros…",
        `<div class="loading-state" style="display:flex; flex-direction:column; gap:14px;"><div class="spinner"></div><div>Analisando diretórios e vínculos…</div></div>`
      );
      try {
        st.audit = await api.scanRootFolders();
        st.selEmpty = new Set(
          (st.audit.empty_folders || [])
            .filter((f) => !f.is_mapped && !f.is_parent_of_mapped)
            .map((f) => f.rel_path)
        );
        st.selOrphanFiles = new Set();
        st.selMissing = new Set();
      } catch (e) {
        showToast(`Erro ao auditar pastas: ${e}`, "error");
        st.audit = {
          root_path: "",
          total_disk_folders: 0,
          empty_folders: [],
          unmapped_folders: [],
          folders_with_unlinked_files: [],
          missing_disk_folders: [],
        };
      }
    }

    const audit = st.audit;
    const emptyAll = audit.empty_folders || [];
    const unmappedAll = audit.unmapped_folders || [];
    const orphanFolders = audit.folders_with_unlinked_files || [];
    const missingDisk = audit.missing_disk_folders || [];

    const emptyFiltered = emptyAll.filter((f) => {
      if (st.emptyFilter === "unmapped") return !f.is_mapped && !f.is_parent_of_mapped;
      if (st.emptyFilter === "mapped") return f.is_mapped;
      return true;
    });

    const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
    const joinAbs = (root, rel) => {
      const r = String(root || "").replace(/[\\/]+$/, "");
      const p = String(rel || "").replace(/^[\\/]+/, "").replace(/\//g, "\\");
      return `${r}\\${p}`;
    };

    const groupOptions = Array.from(
      new Set(
        Object.values(CATEGORY_SCHEMAS)
          .filter((s) => !s.legacy)
          .map((s) => s.dbGroup || s.group)
      )
    );

    const statusBadge = (f) => {
      if (f.is_mapped) {
        return `<span class="badge badge-tipo">${escapeHtml(f.category_group || "")}</span> <small class="muted">${escapeHtml(f.description)}</small>`;
      }
      if (f.is_parent_of_mapped) {
        return `<span class="badge" style="background:var(--surface-3);color:var(--text-secondary);">Pasta-pai de subpastas mapeadas</span>`;
      }
      return `<span class="badge" style="background:rgba(245,158,11,0.14);color:var(--warning);font-weight:600;">Sem vínculo com Subpastas</span>`;
    };

    let tabBody = "";

    if (st.tab === "empty") {
      const selCount = emptyFiltered.filter((f) => st.selEmpty.has(f.rel_path)).length;
      const allEmptyChecked = emptyFiltered.length > 0 && emptyFiltered.every((f) => st.selEmpty.has(f.rel_path));
      tabBody = `
        <div class="tl-bar" style="flex-wrap:wrap; gap:10px;">
          <div class="seg tl-seg-sm">
            <button type="button" data-eflt="all" class="${st.emptyFilter === "all" ? "on" : ""}">Todas vazias (${emptyAll.length})</button>
            <button type="button" data-eflt="unmapped" class="${st.emptyFilter === "unmapped" ? "on" : ""}">Órfãs / não mapeadas (${emptyAll.filter((f) => !f.is_mapped && !f.is_parent_of_mapped).length})</button>
            <button type="button" data-eflt="mapped" class="${st.emptyFilter === "mapped" ? "on" : ""}">Subpastas mapeadas (${emptyAll.filter((f) => f.is_mapped).length})</button>
          </div>
          <label class="tl-chk" style="margin-left:8px;">
            <input type="checkbox" data-rm-map ${st.removeMappingsWithEmpty ? "checked" : ""}/>
            Remover também o vínculo em Subpastas (se mapeada)
          </label>
          <div style="flex:1"></div>
          <button type="button" class="btn btn-primary btn-sm" data-del-empty-sel ${selCount ? "" : "disabled"}>
            🗑️ Remover ${selCount} pasta(s) em branco
          </button>
        </div>
        ${emptyFiltered.length ? `
          <div class="tl-table"><table class="data-table">
            <thead><tr>
              <th style="width:36px"><input type="checkbox" data-empty-all ${allEmptyChecked ? "checked" : ""}/></th>
              <th>Caminho relativo</th>
              <th style="width:320px">Vínculo em Subpastas</th>
              <th style="width:220px; text-align:right;">Ações</th>
            </tr></thead>
            <tbody>
              ${emptyFiltered.map((f, i) => `
                <tr>
                  <td><input type="checkbox" data-empty-chk="${escapeHtml(f.rel_path)}" ${st.selEmpty.has(f.rel_path) ? "checked" : ""}/></td>
                  <td class="mono">${escapeHtml(f.rel_path)}${f.subdirs_count ? ` <small class="muted">(${f.subdirs_count} subpasta(s) também vazia(s))</small>` : ""}</td>
                  <td>${statusBadge(f)}</td>
                  <td style="text-align:right; white-space:nowrap;">
                    ${!f.is_mapped && !f.is_parent_of_mapped ? `<button type="button" class="btn btn-secondary btn-sm" data-quick-link-empty="${i}" title="Vincular esta pasta como subpasta de uma categoria">🔗 Vincular</button>` : ""}
                    <button type="button" class="ibtn" data-open-rel="${escapeHtml(f.rel_path)}" title="Abrir pasta no Explorer">📂</button>
                    <button type="button" class="ibtn" data-del-empty-one="${escapeHtml(f.rel_path)}" title="Remover pasta do disco">🗑️</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table></div>
        ` : `<div class="tl-empty">✅ Nenhuma pasta em branco encontrada neste filtro.</div>`}
      `;
    } else if (st.tab === "unmapped") {
      tabBody = unmappedAll.length ? `
        <p class="dd-note" style="margin-bottom:10px;">Pastas encontradas no disco que não correspondem a nenhuma entrada em <b>Subpastas</b>. Vincule-as a uma categoria, importe seus arquivos em lote ou remova pastas residuais.</p>
        <div class="tl-table"><table class="data-table">
          <thead><tr>
            <th>Caminho no disco</th>
            <th style="width:120px">Arquivos</th>
            <th style="width:200px">Categoria / Grupo</th>
            <th style="width:210px">Tipo / Descrição</th>
            <th style="width:210px; text-align:right;">Ações</th>
          </tr></thead>
          <tbody>
            ${unmappedAll.map((f, i) => `
              <tr data-unmapped-row="${i}">
                <td>
                  <div class="mono" style="font-weight:600;">${escapeHtml(f.rel_path)}</div>
                  ${f.linked_files_count ? `<small style="color:var(--success)">${f.linked_files_count} vinculado(s) · </small>` : ""}
                  ${f.unlinked_files_count ? `<small style="color:var(--warning)">${f.unlinked_files_count} arquivo(s) sem vínculo</small>` : `<small class="muted">Pasta vazia</small>`}
                </td>
                <td><b>${f.total_tree_files}</b><small class="muted"> arq.</small></td>
                <td>
                  <select class="form-select" data-link-group="${i}" style="font-size:12px;">
                    ${groupOptions.map((g) => `<option value="${escapeHtml(g)}" ${g.toLowerCase() === String(f.suggested_group || "").toLowerCase() ? "selected" : ""}>${escapeHtml(g)}</option>`).join("")}
                  </select>
                </td>
                <td>
                  <input type="text" class="form-input" data-link-desc="${i}" value="${escapeHtml(f.description)}" style="font-size:12px; width:100%;"/>
                </td>
                <td style="text-align:right; white-space:nowrap;">
                  <button type="button" class="btn btn-primary btn-sm" data-bind-unmapped="${i}" title="Cadastrar em Subpastas">🔗 Vincular</button>
                  ${f.unlinked_files_count ? `<button type="button" class="ibtn" data-import-unmapped="${i}" title="Importar ${f.unlinked_files_count} arquivo(s) em lote">📥</button>` : ""}
                  <button type="button" class="ibtn" data-open-rel="${escapeHtml(f.rel_path)}" title="Abrir no Explorer">📂</button>
                  <button type="button" class="ibtn" data-del-unmapped="${i}" title="${f.linked_files_count ? "Contém arquivos vinculados a registros (protegida)" : "Excluir pasta"}">🗑️</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table></div>
      ` : `<div class="tl-empty">✅ Todas as pastas de comprovantes no disco estão devidamente vinculadas em Subpastas.</div>`;
    } else if (st.tab === "orphan_files") {
      const totalOrphanFiles = orphanFolders.reduce((acc, f) => acc + f.unlinked_files_count, 0);
      tabBody = orphanFolders.length ? `
        <div class="tl-bar" style="flex-wrap:wrap; gap:10px;">
          <span><b>${orphanFolders.length}</b> pasta(s) com <b>${totalOrphanFiles}</b> arquivo(s) não vinculados a nenhum registro</span>
          <div style="flex:1"></div>
          <button type="button" class="btn btn-secondary btn-sm" data-open-linker>🔗 Vincular automaticamente a registros</button>
          <button type="button" class="btn btn-primary btn-sm" data-del-orphan-sel ${st.selOrphanFiles.size ? "" : "disabled"}>
            🗑️ Excluir ${st.selOrphanFiles.size} arquivo(s) selecionado(s)
          </button>
        </div>
        <div style="display:flex; flex-direction:column; gap:12px;">
          ${orphanFolders.map((f, fi) => {
        const allFolderChecked = f.unlinked_files.length > 0 && f.unlinked_files.every((rf) => st.selOrphanFiles.has(rf));
        return `
            <div data-orphan-folder-card="${fi}" style="border:1px solid var(--border-light); border-radius:10px; background:var(--surface-2); overflow:hidden;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 14px; background:var(--surface-3); flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:10px;">
                  <input type="checkbox" data-orphan-folder-chk="${fi}" ${allFolderChecked ? "checked" : ""} title="Marcar ou desmarcar todos os arquivos desta pasta" style="cursor:pointer; width:16px; height:16px; flex-shrink:0;" />
                  <div>
                    <span class="mono" style="font-weight:700;">${escapeHtml(f.rel_path)}</span>
                    ${f.is_mapped ? ` · <span class="badge badge-tipo">${escapeHtml(f.category_group || "")}: ${escapeHtml(f.description)}</span>` : ` · <span class="badge" style="background:rgba(245,158,11,0.14);color:var(--warning);">Pasta não mapeada</span>`}
                    <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
                      <b>${f.unlinked_files_count}</b> arquivo(s) sem registro (${fmtSize(f.unlinked_bytes)}) · ${f.linked_files_count} arquivo(s) vinculado(s)
                    </div>
                  </div>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                  <button type="button" class="btn btn-primary btn-sm" data-import-folder="${fi}">📥 Importar ${f.unlinked_files_count} em lote</button>
                  <button type="button" class="btn btn-secondary btn-sm" data-open-rel="${escapeHtml(f.rel_path)}">📂 Abrir pasta</button>
                </div>
              </div>
              <div class="tl-table sm" style="border:0; border-radius:0; max-height:220px;">
                <table class="data-table"><tbody>
                  ${f.unlinked_files.map((rf) => {
          const fname = rf.split(/[\\/]/).pop();
          return `<tr>
                      <td style="width:36px"><input type="checkbox" data-orphan-chk="${escapeHtml(rf)}" data-orphan-chk-folder="${fi}" ${st.selOrphanFiles.has(rf) ? "checked" : ""}/></td>
                      <td class="mono">${escapeHtml(fname)}</td>
                      <td style="width:120px; text-align:right; white-space:nowrap;">
                        <button type="button" class="ibtn" data-open-file-rel="${escapeHtml(rf)}" title="Abrir arquivo">👁️</button>
                        <button type="button" class="ibtn" data-reveal-rel="${escapeHtml(rf)}" title="Mostrar na pasta">📂</button>
                        <button type="button" class="ibtn" data-del-orphan-one="${escapeHtml(rf)}" title="Excluir arquivo órfão do disco">🗑️</button>
                      </td>
                    </tr>`;
        }).join("")}
                </tbody></table>
              </div>
            </div>`;
      }).join("")}
        </div>
      ` : `<div class="tl-empty">✅ Nenhum arquivo solto sem vínculo foi encontrado nas pastas do currículo.</div>`;
    } else if (st.tab === "missing_disk") {
      const allMissingChecked = missingDisk.length > 0 && missingDisk.every((f) => st.selMissing.has(f.rel_path));
      const selIds = missingDisk.filter((f) => st.selMissing.has(f.rel_path) && f.mapping_id != null).map((f) => f.mapping_id);
      tabBody = missingDisk.length ? `
        <div class="tl-bar" style="flex-wrap:wrap; gap:10px;">
          <span><b>${missingDisk.length}</b> subpasta(s) cadastrada(s) sem diretório físico no disco</span>
          <div style="flex:1"></div>
          <button type="button" class="btn btn-primary btn-sm" data-create-missing-sel ${st.selMissing.size ? "" : "disabled"}>📁 Criar ${st.selMissing.size} pasta(s) no disco</button>
          <button type="button" class="btn btn-secondary btn-sm" data-del-missing-sel ${selIds.length ? "" : "disabled"}>🗑️ Remover ${selIds.length} vínculo(s)</button>
        </div>
        <div class="tl-table"><table class="data-table">
          <thead><tr>
            <th style="width:36px"><input type="checkbox" data-missing-all ${allMissingChecked ? "checked" : ""}/></th>
            <th style="width:200px">Categoria</th>
            <th style="width:220px">Subcategoria / Tipo</th>
            <th>Caminho relativo</th>
            <th style="width:110px">Registros</th>
            <th style="width:150px; text-align:right;">Ações</th>
          </tr></thead>
          <tbody>
            ${missingDisk.map((f) => `
              <tr>
                <td><input type="checkbox" data-missing-chk="${escapeHtml(f.rel_path)}" ${st.selMissing.has(f.rel_path) ? "checked" : ""}/></td>
                <td><span class="badge badge-tipo">${escapeHtml(f.category_group || "")}</span></td>
                <td><b>${escapeHtml(f.description)}</b></td>
                <td class="mono">${escapeHtml(f.rel_path)}</td>
                <td>${f.records_using_folder ? `<span class="badge" style="background:rgba(245,158,11,0.14);color:var(--warning);">${f.records_using_folder} reg.</span>` : `<span class="muted">0 reg.</span>`}</td>
                <td style="text-align:right; white-space:nowrap;">
                  <button type="button" class="btn btn-secondary btn-sm" data-create-one="${escapeHtml(f.rel_path)}" title="Criar diretório no disco">📁 Criar</button>
                  <button type="button" class="ibtn" data-del-map-one="${f.mapping_id}" data-rec-cnt="${f.records_using_folder}" title="Remover mapeamento de Subpasta">🗑️</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table></div>
      ` : `<div class="tl-empty">✅ Todas as subpastas mapeadas possuem diretório criado no disco.</div>`;
    }

    this.shell(
      "Auditoria e Limpeza de Pastas",
      `Pasta raiz: <code>${escapeHtml(audit.root_path)}</code> · <b>${audit.total_disk_folders}</b> pasta(s) analisada(s) recursivamente.`,
      `
        <div class="tl-stats" style="grid-template-columns: repeat(4, 1fr); margin-bottom:14px;">
          <div class="${emptyAll.length ? "warn" : "good"}"><b>${emptyAll.length}</b><span>pastas em branco</span></div>
          <div class="${unmappedAll.length ? "bad" : "good"}"><b>${unmappedAll.length}</b><span>sem vínculo de Subpasta</span></div>
          <div class="${orphanFolders.length ? "warn" : "good"}"><b>${orphanFolders.length}</b><span>com arquivos sem registro</span></div>
          <div class="${missingDisk.length ? "warn" : "good"}"><b>${missingDisk.length}</b><span>subpastas sem pasta no disco</span></div>
        </div>

        <div class="tl-bar" style="flex-wrap:wrap; gap:10px; margin-bottom:14px;">
          <div class="seg tl-seg-sm">
            <button type="button" data-ftab="empty" class="${st.tab === "empty" ? "on" : ""}">📭 Pastas em branco (${emptyAll.length})</button>
            <button type="button" data-ftab="unmapped" class="${st.tab === "unmapped" ? "on" : ""}">🧩 Sem vínculo (${unmappedAll.length})</button>
            <button type="button" data-ftab="orphan_files" class="${st.tab === "orphan_files" ? "on" : ""}">📄 Arquivos soltos (${orphanFolders.length})</button>
            <button type="button" data-ftab="missing_disk" class="${st.tab === "missing_disk" ? "on" : ""}">📁 Faltando no disco (${missingDisk.length})</button>
          </div>
          <div style="flex:1"></div>
          <button type="button" class="btn btn-secondary btn-sm" data-rescan>🔄 Revarrer pasta raiz</button>
        </div>

        ${tabBody}
      `
    );

    const rescan = async () => {
      st.audit = null;
      this.onChanged && (await this.onChanged());
      this.toolFoldersAudit();
    };

    this.el.querySelectorAll("[data-ftab]").forEach((b) =>
      b.addEventListener("click", () => {
        st.tab = b.dataset.ftab;
        this.toolFoldersAudit();
      })
    );
    this.el.querySelector("[data-rescan]")?.addEventListener("click", () => {
      st.audit = null;
      this.toolFoldersAudit();
    });
    this.el.querySelectorAll("[data-open-rel]").forEach((b) =>
      b.addEventListener("click", () => api.openFolder(b.dataset.openRel).catch((e) => showToast(String(e), "error")))
    );
    this.el.querySelectorAll("[data-reveal-rel]").forEach((b) =>
      b.addEventListener("click", () => api.revealInExplorer(b.dataset.revealRel).catch((e) => showToast(String(e), "error")))
    );
    this.el.querySelectorAll("[data-open-file-rel]").forEach((b) =>
      b.addEventListener("click", () => api.openFile(b.dataset.openFileRel).catch((e) => showToast(String(e), "error")))
    );

    // Tab 1 events (Pastas em branco)
    this.el.querySelectorAll("[data-eflt]").forEach((b) =>
      b.addEventListener("click", () => {
        st.emptyFilter = b.dataset.eflt;
        this.toolFoldersAudit();
      })
    );
    this.el.querySelector("[data-rm-map]")?.addEventListener("change", (e) => {
      st.removeMappingsWithEmpty = e.target.checked;
    });
    this.el.querySelector("[data-empty-all]")?.addEventListener("change", (e) => {
      for (const f of emptyFiltered) {
        e.target.checked ? st.selEmpty.add(f.rel_path) : st.selEmpty.delete(f.rel_path);
      }
      this.toolFoldersAudit();
    });
    this.el.querySelectorAll("[data-empty-chk]").forEach((c) =>
      c.addEventListener("change", () => {
        c.checked ? st.selEmpty.add(c.dataset.emptyChk) : st.selEmpty.delete(c.dataset.emptyChk);
        const btn = this.el.querySelector("[data-del-empty-sel]");
        const n = emptyFiltered.filter((f) => st.selEmpty.has(f.rel_path)).length;
        if (btn) {
          btn.disabled = n === 0;
          btn.textContent = `🗑️ Remover ${n} pasta(s) em branco`;
        }
      })
    );
    this.el.querySelector("[data-del-empty-sel]")?.addEventListener("click", async () => {
      const list = emptyFiltered.filter((f) => st.selEmpty.has(f.rel_path)).map((f) => f.rel_path);
      if (!list.length) return;
      const msg = st.removeMappingsWithEmpty
        ? `Remover ${list.length} pasta(s) em branco do disco e apagar seus vínculos na aba Subpastas?`
        : `Remover ${list.length} pasta(s) em branco do disco?\n(Os mapeamentos de Subpastas continuarão salvos, salvo os já desmarcados.)`;
      if (!window.confirm(msg)) return;
      try {
        const res = await api.removeAuditedFolders(list, st.removeMappingsWithEmpty, false);
        showToast(`${res.ok} pasta(s) removida(s)${res.erros.length ? ` · ${res.erros.length} aviso(s)` : ""}`, res.erros.length ? "warning" : "success", 4000);
        if (res.erros.length) console.warn(res.erros);
      } catch (e) {
        showToast(`Erro ao remover pastas: ${e}`, "error");
      }
      await rescan();
    });
    this.el.querySelectorAll("[data-del-empty-one]").forEach((b) =>
      b.addEventListener("click", async () => {
        const p = b.dataset.delEmptyOne;
        if (!window.confirm(`Remover a pasta em branco "${p}" do disco?`)) return;
        try {
          const res = await api.removeAuditedFolders([p], st.removeMappingsWithEmpty, false);
          if (res.ok) showToast(`Pasta "${p}" removida!`, "success");
          else showToast(res.erros.join("; ") || "Não foi possível remover", "error");
        } catch (e) {
          showToast(String(e), "error");
        }
        await rescan();
      })
    );
    this.el.querySelectorAll("[data-quick-link-empty]").forEach((b) =>
      b.addEventListener("click", async () => {
        const f = emptyFiltered[Number(b.dataset.quickLinkEmpty)];
        if (!f) return;
        try {
          const folderRel = `${f.rel_path.replace(/[\\/]+$/, "")}\\`;
          await api.addSubfolderMapping(f.suggested_group, f.description, folderRel);
          showToast(`Pasta "${f.rel_path}" vinculada em ${f.suggested_group} › ${f.description}`, "success", 3500);
        } catch (e) {
          showToast(`Erro ao vincular pasta: ${e}`, "error");
        }
        await rescan();
      })
    );

    // Tab 2 events (Pastas sem vínculo)
    this.el.querySelectorAll("[data-bind-unmapped]").forEach((b) =>
      b.addEventListener("click", async () => {
        const idx = Number(b.dataset.bindUnmapped);
        const f = unmappedAll[idx];
        const grp = this.el.querySelector(`[data-link-group="${idx}"]`)?.value?.trim();
        const desc = this.el.querySelector(`[data-link-desc="${idx}"]`)?.value?.trim();
        if (!f || !grp || !desc) return showToast("Informe categoria e descrição para vincular", "warning");
        try {
          const folderRel = `${f.rel_path.replace(/[\\/]+$/, "")}\\`;
          await api.addSubfolderMapping(grp, desc, folderRel);
          showToast(`Vinculada: ${grp} › ${desc}`, "success", 3500);
        } catch (e) {
          showToast(`Erro ao vincular: ${e}`, "error");
        }
        await rescan();
      })
    );
    this.el.querySelectorAll("[data-import-unmapped]").forEach((b) =>
      b.addEventListener("click", () => {
        const f = unmappedAll[Number(b.dataset.importUnmapped)];
        if (!f || !window._app?.batchImport) return;
        const files = (f.unlinked_files || []).map((rf) => ({ path: joinAbs(audit.root_path, rf), name: rf.split(/[\\/]/).pop(), size: 0 }));
        if (files.length) window._app.batchImport.open(files);
      })
    );
    this.el.querySelectorAll("[data-del-unmapped]").forEach((b) =>
      b.addEventListener("click", async () => {
        const f = unmappedAll[Number(b.dataset.delUnmapped)];
        if (!f) return;
        if (f.linked_files_count > 0) {
          return showToast("Esta pasta contém comprovantes vinculados a registros e não pode ser excluída.", "warning", 4500);
        }
        const delFiles = f.total_tree_files > 0;
        const msg = delFiles
          ? `A pasta "${f.rel_path}" contém ${f.total_tree_files} arquivo(s) NÃO vinculados.\nDeseja excluir permanentemente a pasta e todos esses arquivos soltos?`
          : `Excluir permanentemente a pasta "${f.rel_path}" do disco?`;
        if (!window.confirm(msg)) return;
        try {
          const res = await api.removeAuditedFolders([f.rel_path], false, delFiles);
          if (res.ok) showToast(`Pasta "${f.rel_path}" excluída!`, "success");
          else showToast(res.erros.join("; ") || "Erro ao excluir pasta", "error");
        } catch (e) {
          showToast(String(e), "error");
        }
        await rescan();
      })
    );

    // Tab 3 events (Arquivos soltos)
    this.el.querySelector("[data-open-linker]")?.addEventListener("click", () => this.openLinker && this.openLinker());
    this.el.querySelectorAll("[data-import-folder]").forEach((b) =>
      b.addEventListener("click", () => {
        const f = orphanFolders[Number(b.dataset.importFolder)];
        if (!f || !window._app?.batchImport) return;
        const files = (f.unlinked_files || []).map((rf) => ({ path: joinAbs(audit.root_path, rf), name: rf.split(/[\\/]/).pop(), size: 0 }));
        if (files.length) window._app.batchImport.open(files);
      })
    );
    const updateOrphanSelBtn = () => {
      const btn = this.el.querySelector("[data-del-orphan-sel]");
      if (btn) {
        btn.disabled = st.selOrphanFiles.size === 0;
        btn.textContent = `🗑️ Excluir ${st.selOrphanFiles.size} arquivo(s) selecionado(s)`;
      }
    };
    const syncFolderChk = (fi) => {
      const f = orphanFolders[Number(fi)];
      const folderChk = this.el.querySelector(`[data-orphan-folder-chk="${fi}"]`);
      if (!f || !folderChk) return;
      const files = f.unlinked_files || [];
      const selectedCount = files.filter((rf) => st.selOrphanFiles.has(rf)).length;
      folderChk.checked = files.length > 0 && selectedCount === files.length;
      folderChk.indeterminate = selectedCount > 0 && selectedCount < files.length;
    };
    orphanFolders.forEach((_, fi) => syncFolderChk(fi));

    this.el.querySelectorAll("[data-orphan-folder-chk]").forEach((fc) =>
      fc.addEventListener("change", () => {
        const fi = fc.dataset.orphanFolderChk;
        const f = orphanFolders[Number(fi)];
        if (!f) return;
        for (const rf of f.unlinked_files || []) {
          if (fc.checked) st.selOrphanFiles.add(rf);
          else st.selOrphanFiles.delete(rf);
        }
        this.el.querySelectorAll(`[data-orphan-chk-folder="${fi}"]`).forEach((c) => {
          c.checked = fc.checked;
        });
        fc.indeterminate = false;
        updateOrphanSelBtn();
      })
    );
    this.el.querySelectorAll("[data-orphan-chk]").forEach((c) =>
      c.addEventListener("change", () => {
        c.checked ? st.selOrphanFiles.add(c.dataset.orphanChk) : st.selOrphanFiles.delete(c.dataset.orphanChk);
        if (c.dataset.orphanChkFolder != null) syncFolderChk(c.dataset.orphanChkFolder);
        updateOrphanSelBtn();
      })
    );
    this.el.querySelector("[data-del-orphan-sel]")?.addEventListener("click", async () => {
      const files = [...st.selOrphanFiles];
      if (!files.length) return;
      if (!window.confirm(`Excluir permanentemente ${files.length} arquivo(s) sem registro do disco?`)) return;
      try {
        const res = await api.deleteOrphanFiles(files);
        showToast(`${res.ok} arquivo(s) excluído(s)${res.erros.length ? ` · ${res.erros.length} erro(s)` : ""}`, res.erros.length ? "warning" : "success");
      } catch (e) {
        showToast(String(e), "error");
      }
      await rescan();
    });
    this.el.querySelectorAll("[data-del-orphan-one]").forEach((b) =>
      b.addEventListener("click", async () => {
        const rf = b.dataset.delOrphanOne;
        if (!window.confirm(`Excluir o arquivo solto "${rf}" do disco?`)) return;
        try {
          const res = await api.deleteOrphanFiles([rf]);
          if (res.ok) showToast("Arquivo excluído do disco", "success");
          else showToast(res.erros.join("; ") || "Erro ao excluir", "error");
        } catch (e) {
          showToast(String(e), "error");
        }
        await rescan();
      })
    );

    // Tab 4 events (Subpastas faltando no disco)
    this.el.querySelector("[data-missing-all]")?.addEventListener("change", (e) => {
      for (const f of missingDisk) {
        e.target.checked ? st.selMissing.add(f.rel_path) : st.selMissing.delete(f.rel_path);
      }
      this.toolFoldersAudit();
    });
    this.el.querySelectorAll("[data-missing-chk]").forEach((c) =>
      c.addEventListener("change", () => {
        c.checked ? st.selMissing.add(c.dataset.missingChk) : st.selMissing.delete(c.dataset.missingChk);
        const btnC = this.el.querySelector("[data-create-missing-sel]");
        const btnD = this.el.querySelector("[data-del-missing-sel]");
        const selIds2 = missingDisk.filter((f) => st.selMissing.has(f.rel_path) && f.mapping_id != null).map((f) => f.mapping_id);
        if (btnC) {
          btnC.disabled = st.selMissing.size === 0;
          btnC.textContent = `📁 Criar ${st.selMissing.size} pasta(s) no disco`;
        }
        if (btnD) {
          btnD.disabled = selIds2.length === 0;
          btnD.textContent = `🗑️ Remover ${selIds2.length} vínculo(s)`;
        }
      })
    );
    this.el.querySelector("[data-create-missing-sel]")?.addEventListener("click", async () => {
      const paths = [...st.selMissing];
      if (!paths.length) return;
      try {
        const res = await api.createMissingMappedFolders(paths);
        showToast(`${res.ok} pasta(s) criada(s) no disco!`, res.erros.length ? "warning" : "success");
      } catch (e) {
        showToast(String(e), "error");
      }
      await rescan();
    });
    this.el.querySelector("[data-del-missing-sel]")?.addEventListener("click", async () => {
      const ids = missingDisk.filter((f) => st.selMissing.has(f.rel_path) && f.mapping_id != null).map((f) => f.mapping_id);
      if (!ids.length) return;
      if (!window.confirm(`Remover ${ids.length} mapeamento(s) da lista de Subpastas?`)) return;
      try {
        const res = await api.removeUnlinkedMappings(ids);
        showToast(`${res.ok} mapeamento(s) removido(s)`, res.erros.length ? "warning" : "success");
      } catch (e) {
        showToast(String(e), "error");
      }
      await rescan();
    });
    this.el.querySelectorAll("[data-create-one]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          const res = await api.createMissingMappedFolders([b.dataset.createOne]);
          if (res.ok) showToast("Pasta criada no disco!", "success");
          else showToast(res.erros.join("; ") || "Erro", "error");
        } catch (e) {
          showToast(String(e), "error");
        }
        await rescan();
      })
    );
    this.el.querySelectorAll("[data-del-map-one]").forEach((b) =>
      b.addEventListener("click", async () => {
        const id = Number(b.dataset.delMapOne);
        const recCnt = Number(b.dataset.recCnt || 0);
        const msg = recCnt > 0
          ? `Atenção: há ${recCnt} registro(s) apontando para esta pasta. Deseja remover o mapeamento de Subpastas?`
          : "Remover este mapeamento da lista de Subpastas?";
        if (!window.confirm(msg)) return;
        try {
          const res = await api.removeUnlinkedMappings([id]);
          if (res.ok) showToast("Mapeamento removido", "success");
          else showToast(res.erros.join("; ") || "Erro", "error");
        } catch (e) {
          showToast(String(e), "error");
        }
        await rescan();
      })
    );
  }

  // ===== 5. qualis =====
  async toolQualis() {
    const st = this.state;
    if (!st.data) st.data = await api.getAllRecords();
    const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const prods = (st.data.producoes || []).slice().sort((a, b) => (b.ano || 0) - (a.ano || 0));
    const known = new Map();
    for (const r of prods) if (r.qualis && r.qualis.trim() && r.journal && !known.has(norm(r.journal))) known.set(norm(r.journal), { q: r.qualis.trim().toUpperCase(), ano: r.ano });
    const cands = prods.filter((r) => !(r.qualis || "").trim() && r.journal && known.has(norm(r.journal))).map((r) => ({ r, ...known.get(norm(r.journal)) }));
    st.sel ||= new Set(cands.map((x) => x.r.id));
    this.shell(
      "Completar Qualis",
      "Usa o estrato mais recente que você atribuiu à mesma revista. Confira: o Qualis pode mudar entre quadriênios.",
      cands.length
        ? `<div class="tl-bar"><span><b>${cands.length}</b> produção(ões) sem Qualis com revista conhecida</span><button type="button" class="btn btn-primary btn-sm" data-apply>Aplicar ${st.sel.size}</button></div>
          <div class="tl-table"><table class="data-table"><thead><tr><th style="width:36px"></th><th style="width:60px">Ano</th><th>Título</th><th>Periódico</th><th style="width:110px">Qualis</th></tr></thead><tbody>
          ${cands.map((x) => `<tr><td><input type="checkbox" data-id="${x.r.id}" ${st.sel.has(x.r.id) ? "checked" : ""}/></td><td>${x.r.ano || "—"}</td><td>${escapeHtml(x.r.titulo || "")}</td><td>${escapeHtml(x.r.journal)}</td><td><b class="tl-new">${escapeHtml(x.q)}</b> <small class="muted">(de ${x.ano || "?"})</small></td></tr>`).join("")}
          </tbody></table></div>`
        : `<div class="tl-empty">✅ Nenhuma produção sem Qualis cuja revista já tenha estrato no seu cadastro.</div>`
    );
    this.el.querySelectorAll("[data-id]").forEach((c) => c.addEventListener("change", () => { c.checked ? st.sel.add(+c.dataset.id) : st.sel.delete(+c.dataset.id); this.el.querySelector("[data-apply]").textContent = `Aplicar ${st.sel.size}`; }));
    this.el.querySelector("[data-apply]")?.addEventListener("click", async () => {
      let ok = 0;
      for (const x of cands.filter((x) => st.sel.has(x.r.id))) {
        try {
          await api.updateRecord("producoes", x.r.id, { qualis: x.q });
          ok++;
        } catch { }
      }
      showToast(`Qualis preenchido em ${ok} produção(ões)`, "success");
      st.data = null;
      st.sel = null;
      this.onChanged && this.onChanged();
      this.toolQualis();
    });
  }

  // ===== 6. PDFs em lote =====
  async toolPdfs() {
    const st = this.state;
    if (!st.data) {
      this.shell("Baixar PDFs pelos DOIs (lote)", "Carregando produções…", `<div class="loading-state" style="display:flex"><div class="spinner"></div></div>`);
      st.data = await api.getAllRecords();
    }
    const isDoi = (s) => /^10\.\d{4,9}\//.test(String(s || "").trim());
    st.log ||= {};
    st.i ??= 0;
    st.concurrency ??= 8;

    // Apenas documentos sem comprovante QUE POSSUEM DOI cadastrado entram na fila
    if (!st.snapshot) {
      st.snapshot = (st.data.producoes || [])
        .filter((r) => !(r.path && r.path.trim()) && isDoi(r.identifier))
        .sort((a, b) => (b.ano || 0) - (a.ano || 0));
    }

    const cands = st.snapshot;
    const running = Boolean(st.running);
    const finished = Boolean(st.finished);
    const done = cands.filter((r) => st.log[r.id]?.s === "ok").length;
    const skipped = cands.filter((r) => st.log[r.id]?.s === "skip" || st.log[r.id]?.s === "err").length;

    const renderRowStatus = (r) => {
      const l = st.log[r.id];
      if (!l) return `<span style="color:var(--text-muted)">Aguardando</span>`;
      return escapeHtml(l.m);
    };

    this.shell(
      "Baixar PDFs pelos DOIs (lote)",
      "Itera sobre as produções sem comprovante que possuem DOI cadastrado, busca o PDF em múltiplas fontes (Unpaywall, OpenAlex, Semantic Scholar, Europe PMC e página do DOI) e salva automaticamente na pasta de Produções.",
      cands.length
        ? `<div class="tl-stats" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 14px;">
            <div><b data-kpi-total>${cands.length}</b><span>produção(ões) com DOI sem comprovante</span></div>
            <div class="good"><b data-kpi-done>${done}</b><span>PDF(s) encontrado(s) e salvo(s)</span></div>
            <div class="${skipped ? "warn" : ""}"><b data-kpi-skip>${skipped}</b><span>sem acesso aberto / bloqueado</span></div>
          </div>

          ${finished ? `
            <div style="padding:14px 18px; border-radius:12px; margin-bottom:14px; border:1px solid ${done > 0 ? "var(--success-border, rgba(34,197,94,0.35))" : "var(--border-light)"}; background:${done > 0 ? "var(--success-bg, rgba(34,197,94,0.08))" : "var(--surface-2)"}; display:flex; align-items:center; justify-content:space-between; gap:12px;">
              <div>
                <b style="font-size:14px; color:${done > 0 ? "var(--success-text)" : "var(--text-primary)"};">
                  ${done > 0 ? `✅ ${done} PDF(s) encontrado(s) e salvo(s) na pasta de Produções!` : "ℹ️ Nenhum PDF de acesso aberto disponível foi encontrado automaticamente."}
                </b>
                <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
                  ${done > 0 ? "Os arquivos já foram renomeados, vinculados aos registros e salvos em 5_producoes." : "Para artigos fechados ou protegidos por Cloudflare, clique em 🌐 na coluna DOI para baixar manualmente pelo navegador."}
                </div>
              </div>
              <button type="button" class="btn btn-secondary btn-sm" data-refresh-list>🔄 Atualizar lista</button>
            </div>
          ` : ""}

          <div class="tl-bar" style="flex-wrap:wrap; gap:10px;">
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
              <span style="font-size:12px; color:var(--text-secondary);">Simultâneos:</span>
              ${[5, 8, 10, 15].map((n) => `
                <button type="button" class="btn btn-sm ${st.concurrency === n ? "btn-primary" : "btn-secondary"}" data-conc="${n}" ${running ? "disabled" : ""} style="font-size:11.5px; padding:3px 10px; border-radius:14px; min-width:38px;" title="Buscar até ${n} DOIs ao mesmo tempo">${n}x</button>
              `).join("")}
            </div>
            <div style="display:flex; gap:8px; align-items:center; margin-left:auto;">
              <span data-progress-label style="font-size:12px; color:var(--text-secondary);">
                ${running ? `Processando ${st.i} de ${cands.length}…` : `${done} PDF(s) encontrado(s)`}
              </span>
              ${running
          ? '<button type="button" class="btn btn-secondary btn-sm" data-stop>■ Parar</button>'
          : `<button type="button" class="btn btn-primary btn-sm" data-run ${!cands.length ? "disabled" : ""}>⚡ Baixar PDFs (${cands.length})</button>`}
            </div>
          </div>

          <div class="tl-progress" style="display:${running ? "block" : "none"};"><i data-progress-bar style="width:${cands.length ? Math.round((st.i / cands.length) * 100) : 0}%"></i></div>

          <div class="tl-table"><table class="data-table"><thead><tr><th style="width:60px">Ano</th><th>Título</th><th style="width:210px">DOI</th><th style="width:250px">Situação</th></tr></thead><tbody>
          ${cands.map((r) => {
            const l = st.log[r.id];
            const cleanDoi = String(r.identifier || "").trim();
            return `<tr data-id="${r.id}">
              <td>${r.ano || "—"}</td>
              <td>${escapeHtml(r.titulo || "")}</td>
              <td class="mono" style="font-size:11.5px;">
                <button type="button" data-open-doi="${escapeHtml(cleanDoi)}" style="background:none;border:0;padding:0;font:inherit;color:var(--primary);cursor:pointer;text-align:left;text-decoration:underline;text-underline-offset:2px;" title="Abrir DOI no navegador">${escapeHtml(cleanDoi)} 🌐</button>
              </td>
              <td class="tl-st ${l?.s || ""}" data-status-id="${r.id}">${renderRowStatus(r)}</td>
            </tr>`;
          }).join("")}
          </tbody></table></div>
          <p class="dd-note">Dica: caso queira preencher DOIs que ainda não constam nos registros, use primeiro a ferramenta <b>Extrair DOI dos artigos</b>.</p>`
        : `<div class="tl-empty">✅ Todas as produções com DOI cadastrado já possuem comprovante na pasta de Produções.</div>`
    );

    this.el.querySelector(".tl-table")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-open-doi]");
      if (btn) api.openDoi(btn.dataset.openDoi).catch((err) => showToast(`Erro ao abrir DOI: ${err}`, "error"));
    });

    this.el.querySelectorAll("[data-conc]").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (st.running) return;
        st.concurrency = Number(btn.dataset.conc) || 8;
        this.toolPdfs();
      })
    );

    this.el.querySelector("[data-refresh-list]")?.addEventListener("click", () => {
      st.data = null;
      st.snapshot = null;
      st.log = {};
      st.finished = false;
      st.i = 0;
      this.toolPdfs();
    });

    this.el.querySelector("[data-stop]")?.addEventListener("click", () => (st.stop = true));

    this.el.querySelector("[data-run]")?.addEventListener("click", async () => {
      const stPdfs = this.getState("pdfs");
      stPdfs.running = true;
      stPdfs.finished = false;
      stPdfs.stop = false;
      stPdfs.i = 0;
      stPdfs.log = {};
      this.syncBackgroundBadge();
      this.toolPdfs();

      const updateInline = (id, stateObj) => {
        if (this.active !== "pdfs") return;
        const cell = this.el.querySelector(`[data-status-id="${id}"]`);
        if (cell) {
          cell.className = `tl-st ${stateObj.s || ""}`;
          cell.textContent = stateObj.m;
        }
        const okCount = cands.filter((x) => stPdfs.log[x.id]?.s === "ok").length;
        const skipCount = cands.filter((x) => stPdfs.log[x.id]?.s === "skip" || stPdfs.log[x.id]?.s === "err").length;
        const kpiDone = this.el.querySelector("[data-kpi-done]");
        const kpiSkip = this.el.querySelector("[data-kpi-skip]");
        const pLabel = this.el.querySelector("[data-progress-label]");
        const pBar = this.el.querySelector("[data-progress-bar]");
        if (kpiDone) kpiDone.textContent = String(okCount);
        if (kpiSkip) kpiSkip.textContent = String(skipCount);
        if (pLabel) pLabel.textContent = `Processando ${stPdfs.i} de ${cands.length}… (${okCount} PDFs encontrados)`;
        if (pBar) pBar.style.width = `${cands.length ? Math.round((stPdfs.i / cands.length) * 100) : 0}%`;
      };

      const CONCURRENCY = stPdfs.concurrency || 8;
      let cursor = 0;
      const worker = async () => {
        while (cursor < cands.length && !stPdfs.stop) {
          const r = cands[cursor++];
          stPdfs.log[r.id] = { s: "run", m: "⏳ buscando PDF…" };
          updateInline(r.id, stPdfs.log[r.id]);
          try {
            const doi = String(r.identifier || "").trim();
            const res = await api.resolveDoi(doi, true);
            if (res.pdf_path) {
              await api.updateRecord("producoes", r.id, { identifier: doi }, res.pdf_path);
              stPdfs.log[r.id] = { s: "ok", m: `📄 Salvo em Produções (${res.pdf_versao || "PDF"})` };
            } else {
              const reason = res.oa_status === "closed"
                ? "🔒 Acesso fechado pela editora"
                : (res.falhas?.[0] ? String(res.falhas[0]).slice(0, 55) : "PDF não disponível");
              stPdfs.log[r.id] = { s: "skip", m: reason };
            }
          } catch (e) {
            stPdfs.log[r.id] = { s: "err", m: String(e).slice(0, 60) };
          }
          stPdfs.i++;
          updateInline(r.id, stPdfs.log[r.id]);
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cands.length) }, () => worker()));

      const foundTotal = cands.filter((x) => stPdfs.log[x.id]?.s === "ok").length;
      stPdfs.running = false;
      stPdfs.finished = true;
      stPdfs.data = null;
      this.syncBackgroundBadge();
      this.onChanged && this.onChanged();
      showToast(
        `${foundTotal} PDF(s) encontrado(s) e salvo(s) na pasta de Produções!`,
        foundTotal > 0 ? "success" : "info",
        5000
      );
      if (this.active === "pdfs") this.toolPdfs();
      else if (this.active === null && document.getElementById("view-ferramentas")?.classList.contains("active")) this.render();
    });
  }


  // ===== 7. extrair DOI dos artigos =====
  async toolDois() {
    const st = this.state;
    if (!st.data) {
      this.shell("Extrair DOI dos artigos", "Carregando…", `<div class="loading-state" style="display:flex"><div class="spinner"></div></div>`);
      st.data = await api.getAllRecords();
    }
    const isDoi = (s) => /^10\.\d{4,9}\//.test(String(s || "").trim());
    const hasPdf = (r) => Boolean(r.path && r.path.trim().toLowerCase().endsWith(".pdf"));
    const cands = (st.data.producoes || []).filter((r) => !isDoi(r.identifier)).sort((a, b) => (b.ano || 0) - (a.ano || 0));
    st.found ||= {}; // id -> { doi, fonte } ou { m, s } quando não achou
    st.sel ||= new Set();
    st.online ??= true;
    st.concurrency ??= 8;
    const run = Boolean(st.running);
    const comPdf = cands.filter(hasPdf).length;
    const nAchados = () => cands.filter((r) => st.found[r.id]?.doi).length;

    // mesma marcação usada no desenho inicial e nas atualizações de uma linha só
    const chkHtml = (r) => (st.found[r.id]?.doi ? `<input type="checkbox" data-id="${r.id}" ${st.sel.has(r.id) ? "checked" : ""}/>` : "");
    const cellHtml = (r) => {
      const f = st.found[r.id];
      if (f?.doi)
        return `<span class="mono">${escapeHtml(f.doi)}</span>
          <button type="button" class="ibtn" data-open="${escapeHtml(f.doi)}" title="Abrir em doi.org para conferir">🌐</button>
          <small class="tl-src">${f.fonte === "pdf" ? "📄 do próprio PDF" : "🌐 Crossref pelo título — confira"}</small>`;
      if (f) return escapeHtml(f.m || "");
      return hasPdf(r) ? "" : "sem PDF anexado";
    };
    const contador = () => `<b>${cands.length}</b> produção(ões) sem DOI · ${comPdf} com PDF anexado${nAchados() ? ` · <b>${nAchados()}</b> encontrado(s)` : ""}`;

    this.shell(
      "Extrair DOI dos artigos",
      "Lê o DOI declarado dentro do PDF de cada produção e, se o arquivo não trouxer, procura pelo título na Crossref. Confira a prévia antes de gravar: o DOI vai para a coluna DOI e o botão 🌐 da linha passa a abrir o artigo.",
      cands.length
        ? `<div class="tl-bar">
            <span data-count>${contador()}</span>
            <label class="tl-chk"><input type="checkbox" data-online ${st.online ? "checked" : ""} ${run ? "disabled" : ""}/> procurar pelo título na Crossref (mais lento)</label>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
              <span style="font-size:12px; color:var(--text-secondary);">Simultâneos:</span>
              ${[2, 4, 8, 12].map((n) => `<button type="button" class="btn btn-sm ${st.concurrency === n ? "btn-primary" : "btn-secondary"}" data-conc="${n}" ${run ? "disabled" : ""} style="font-size:11.5px; padding:3px 10px; border-radius:14px; min-width:38px;" title="Ler até ${n} PDFs ao mesmo tempo (a busca na Crossref usa no máximo ${CROSSREF_MAX})">${n}x</button>`).join("")}
            </div>
            ${run
          ? '<button type="button" class="btn btn-secondary btn-sm" data-stop>■ Parar</button>'
          : '<button type="button" class="btn btn-secondary btn-sm" data-run>🔎 Procurar DOI</button>'}
            ${nAchados() && !run ? `<button type="button" class="btn btn-primary btn-sm" data-apply>Gravar ${st.sel.size} DOI(s)</button>` : ""}
          </div>
          ${run ? `<div class="tl-progress"><i style="width:${Math.round((st.i / Math.max(1, st.n || 1)) * 100)}%"></i></div><p class="dd-note" data-fase>${escapeHtml(st.fase || "")}</p>` : ""}
          <div class="tl-table"><table class="data-table"><thead><tr><th style="width:36px"></th><th style="width:60px">Ano</th><th>Título</th><th style="width:320px">DOI encontrado</th></tr></thead><tbody>
          ${cands
          .map(
            (r) => `<tr><td data-chk="${r.id}">${chkHtml(r)}</td>
                <td>${r.ano || "—"}</td>
                <td>${escapeHtml(r.titulo || "")}</td>
                <td class="tl-st ${st.found[r.id]?.s || ""}" data-cell="${r.id}">${cellHtml(r)}</td></tr>`
          )
          .join("")}
          </tbody></table></div>
          <p class="dd-note">O DOI lido de dentro do PDF é confiável. O encontrado na Crossref pelo título casa ≥85% do texto, mas vale conferir no 🌐 antes de gravar.</p>`
        : `<div class="tl-empty">✅ Todas as produções já têm DOI cadastrado.</div>`
    );

    // Durante a varredura só mudam a linha da vez e a barra: redesenhar o painel
    // inteiro a cada arquivo fazia a tela piscar e perder a rolagem.
    const pintarLinha = (r) => {
      if (this.active !== "dois") return;
      const cel = this.el.querySelector(`[data-cell="${r.id}"]`);
      if (!cel) return;
      cel.className = `tl-st ${st.found[r.id]?.s || ""}`;
      cel.innerHTML = cellHtml(r);
      const chk = this.el.querySelector(`[data-chk="${r.id}"]`);
      if (chk) chk.innerHTML = chkHtml(r);
    };
    const pintarBarra = () => {
      if (this.active !== "dois") return;
      const fill = this.el.querySelector(".tl-progress i");
      if (fill) fill.style.width = `${Math.round((st.i / Math.max(1, st.n || 1)) * 100)}%`;
      const lbl = this.el.querySelector("[data-count]");
      if (lbl) lbl.innerHTML = contador();
      const fase = this.el.querySelector("[data-fase]");
      if (fase) fase.textContent = `${st.fase || ""} · ${st.i} de ${st.n}`;
    };
    const refresh = () => {
      if (this.active === "dois") this.toolDois();
      else if (this.active === null && document.getElementById("view-ferramentas")?.classList.contains("active")) this.render();
    };

    this.el.querySelector("[data-online]")?.addEventListener("change", (e) => (st.online = e.target.checked));
    this.el.querySelector("[data-stop]")?.addEventListener("click", () => (st.stop = true));
    this.el.querySelectorAll("[data-conc]").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (st.running) return;
        st.concurrency = Number(btn.dataset.conc) || 8;
        this.toolDois();
      })
    );

    // delegação: os botões e caixas das linhas são recriados durante a varredura
    const tabela = this.el.querySelector(".tl-table");
    tabela?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-open]");
      if (b) api.openDoi(b.dataset.open).catch(() => { });
    });
    tabela?.addEventListener("change", (e) => {
      const c = e.target.closest("[data-id]");
      if (!c) return;
      c.checked ? st.sel.add(+c.dataset.id) : st.sel.delete(+c.dataset.id);
      const b = this.el.querySelector("[data-apply]");
      if (b) b.textContent = `Gravar ${st.sel.size} DOI(s)`;
    });

    this.el.querySelector("[data-run]")?.addEventListener("click", async () => {
      const stDois = this.getState("dois");
      stDois.running = true;
      stDois.finished = false;
      stDois.stop = false;
      stDois.i = 0;
      stDois.found = {};
      stDois.sel = new Set();
      const comPdfList = cands.filter(hasPdf);
      stDois.n = comPdfList.length + (stDois.online ? cands.length : 0);
      this.syncBackgroundBadge();
      await refresh(); // mostra a barra de progresso e o botão Parar

      const conc = stDois.concurrency || 8;
      const parar = () => stDois.stop;

      // 1) DOI declarado dentro do PDF — sem rede, vários arquivos ao mesmo tempo
      stDois.fase = `Lendo os PDFs (${Math.min(conc, comPdfList.length || 1)} ao mesmo tempo)`;
      pintarBarra();
      await runPool(comPdfList, conc, async (r) => {
        stDois.found[r.id] = { m: "⏳ lendo o PDF…", s: "run" };
        pintarLinha(r);
        try {
          const doi = await api.extractRecordDoi("producoes", r.id);
          if (doi) {
            stDois.found[r.id] = { doi, fonte: "pdf", s: "ok" };
            stDois.sel.add(r.id);
          } else {
            stDois.found[r.id] = { m: "sem DOI no arquivo", s: "skip" };
          }
        } catch (e) {
          stDois.found[r.id] = { m: String(e).slice(0, 60), s: "err" };
        }
        stDois.i++;
        pintarLinha(r);
        pintarBarra();
      }, parar);

      // 2) o que sobrou: busca pelo título na Crossref (limite de simultâneas da Crossref)
      if (stDois.online && !stDois.stop) {
        const resto = cands.filter((x) => !stDois.found[x.id]?.doi && String(x.titulo || "").trim().length >= 15);
        const concCr = Math.min(conc, CROSSREF_MAX);
        stDois.fase = `Procurando pelo título na Crossref (${Math.min(concCr, resto.length || 1)} ao mesmo tempo)`;
        pintarBarra();
        await runPool(resto, concCr, async (r) => {
          stDois.found[r.id] = { m: "⏳ procurando na Crossref…", s: "run" };
          pintarLinha(r);
          try {
            const doi = await comRetentativa(() => api.findDoiByTitle(r.titulo));
            if (doi) {
              stDois.found[r.id] = { doi, fonte: "crossref", s: "warn" };
              stDois.sel.add(r.id);
            } else {
              stDois.found[r.id] = { m: "não encontrado", s: "skip" };
            }
          } catch (e) {
            stDois.found[r.id] = { m: String(e).slice(0, 60), s: "err" };
          }
          stDois.i++;
          pintarLinha(r);
          pintarBarra();
        }, parar);
      }
      // itens que ficaram "em andamento" ao parar voltam a aguardar
      for (const r of cands) if (stDois.found[r.id]?.s === "run") delete stDois.found[r.id];
      stDois.fase = "";
      stDois.running = false;
      stDois.finished = true;
      this.syncBackgroundBadge();
      const foundCount = cands.filter((r) => stDois.found[r.id]?.doi).length;
      showToast(`Extração de DOIs concluída: ${foundCount} DOI(s) encontrado(s)!`, foundCount > 0 ? "success" : "info", 4000);
      refresh(); // troca a barra pelo botão "Gravar"
    });

    this.el.querySelector("[data-apply]")?.addEventListener("click", async () => {
      const todo = cands.filter((r) => st.sel.has(r.id) && st.found[r.id]?.doi);
      if (!todo.length) return;
      let ok = 0;
      const erros = [];
      await runPool(todo, st.concurrency || 8, async (r) => {
        try {
          await api.updateRecord("producoes", r.id, { identifier: st.found[r.id].doi });
          ok++;
        } catch (e) {
          erros.push(`#${r.id}: ${e}`);
        }
      });
      showToast(`${ok} DOI(s) gravado(s)${erros.length ? ` · ${erros.length} erro(s)` : ""}`, erros.length ? "error" : "success", 4000);
      st.data = null;
      st.found = {};
      st.sel = new Set();
      this.onChanged && this.onChanged();
      refresh();
    });
  }

  // ===== COFRE PORTÁTIL DE COMPROVANTES (BACKUP & RESTAURAÇÃO) =====
  async toolBackup() {
    const st = this.state;
    st.include ??= true;
    if (!st.est) {
      this.shell("Cofre Portátil de Comprovantes", "Calculando o tamanho dos seus dados…", `<div class="loading-state" style="display:flex"><div class="spinner"></div></div>`);
      try {
        st.est = await api.backupEstimate();
      } catch (e) {
        st.est = { files: 0, bytes: 0, db_bytes: 0, folders: [] };
        showToast(`Não foi possível calcular o tamanho: ${e}`, "error");
      }
      if (this.active !== "backup") return;
    }
    const mb = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : `${(b / 1048576).toFixed(1)} MB`);
    const e = st.est;
    const ins = st.ins;
    const catName = (t) => CATEGORY_SCHEMAS[t]?.group || (t === "custom_records" ? "Categorias personalizadas" : t);
    const busy = st.running;
    const prog = st.prog
      ? `<div class="bk-prog"><div class="tl-progress"><i style="width:${Math.round((st.prog.done / Math.max(1, st.prog.total)) * 100)}%"></i></div>
         <small>${st.prog.done}/${st.prog.total} · ${escapeHtml(String(st.prog.name || "").split("/").pop())}</small></div>`
      : busy ? `<div class="bk-prog"><div class="tl-progress"><i class="indet"></i></div><small>${escapeHtml(st.step || "Trabalhando…")}</small></div>` : "";

    let restoreBody;
    if (!ins) {
      restoreBody = `<p class="bk-p">Escolha um cofre <b>.lattespack</b> ou <b>.zip</b> criado aqui (ou um <b>lattes.db</b> antigo da pasta <code>backups</code>). Antes de substituir, o app guarda uma cópia de segurança do banco atual.</p>
        <button type="button" class="btn btn-secondary" data-bk="pick" ${busy ? "disabled" : ""}>📂 Escolher arquivo de cofre…</button>`;
    } else {
      const m = ins.manifest;
      const hasFiles = ins.kind === "zip" && ins.files > 0;
      const shaHtml = ins.sha256
        ? `<div class="bk-sha"><span><b>SHA-256:</b></span> <code>${escapeHtml(ins.sha256)}</code></div>`
        : "";

      restoreBody = `<div class="bk-file"><span class="bk-ic">${ins.kind === "zip" ? "🗄️" : "💾"}</span><div>
          <b>${escapeHtml(ins.path.split(/[\\/]/).pop())}</b>
          <small>${mb(ins.bytes)}${m ? ` · criado em ${escapeHtml(m.created)} · v${escapeHtml(m.version)}` : ins.kind === "db" ? " · banco avulso (só registros)" : ""}</small></div>
          <button type="button" class="btn-icon-subtle" data-bk="pick" ${busy ? "disabled" : ""}>Trocar</button></div>
        ${shaHtml}
        <div class="bk-counts"><b>${ins.records}</b> registros${hasFiles ? ` · <b>${ins.files}</b> arquivos de comprovantes` : ""}
          <span>${ins.counts.filter((c) => c[1]).map(([t, n]) => `${escapeHtml(catName(t))} ${n}`).join(" · ")}</span></div>
        <div style="margin: 10px 0;">
          <button type="button" class="btn btn-secondary btn-sm" data-bk="verify" ${busy ? "disabled" : ""}>🩺 Testar integridade do cofre</button>
        </div>
        <label class="bk-opt"><input type="checkbox" data-bko="restoreDb" ${st.restoreDb ? "checked" : ""}/><span><b>Restaurar os registros (banco de dados)</b><small>Substitui todos os registros atuais pelos do cofre.</small></span></label>
        ${hasFiles ? `<label class="bk-opt"><input type="checkbox" data-bko="restoreFiles" ${st.restoreFiles ? "checked" : ""}/><span><b>Restaurar os arquivos dos comprovantes</b><small>Copia os arquivos do cofre para a pasta de dados.</small></span></label>
        <label class="bk-opt sub ${st.restoreFiles ? "" : "off"}"><input type="checkbox" data-bko="overwrite" ${st.overwrite ? "checked" : ""} ${st.restoreFiles ? "" : "disabled"}/><span><b>Substituir arquivos que já existem</b><small>Desmarcado: mantém os arquivos atuais e só traz os que faltam.</small></span></label>` : ""}
        <button type="button" class="btn btn-danger" data-bk="restore" ${busy || !(st.restoreDb || (hasFiles && st.restoreFiles)) ? "disabled" : ""}>♻️ Restaurar dados do cofre</button>`;
    }

    this.shell(
      "Cofre Portátil de Comprovantes",
      "Consolide 100% dos seus registros e comprovantes em um arquivo único (.lattespack / .zip) portátil e verificável.",
      `<div class="bk-grid">
        <section class="bk-card">
          <div class="bk-h"><span class="bk-ic">🗄️</span><div><h3>Exportar cofre</h3><small>Arquivo único (.lattespack / .zip)</small></div></div>
          <label class="bk-opt"><input type="radio" name="bk-inc" value="0" ${!st.include ? "checked" : ""}/><span><b>Só os registros</b><small>Banco SQLite · ${mb(e.db_bytes)} (arquivo ultra compacto)</small></span></label>
          <label class="bk-opt"><input type="radio" name="bk-inc" value="1" ${st.include ? "checked" : ""}/><span><b>Registros + fotos + todos os comprovantes em PDF</b><small>${e.files} arquivo(s) · ${mb(e.bytes + e.db_bytes)} — cofre completo para backup, nuvem ou outro computador</small></span></label>
          <button type="button" class="btn btn-primary" data-bk="create" ${busy ? "disabled" : ""}>📦 Exportar cofre…</button>
          <button type="button" class="btn-icon-subtle" data-bk="quick" ${busy ? "disabled" : ""} title="Cópia datada do lattes.db na pasta backups">⚡ Cópia rápida do banco na pasta backups</button>
        </section>
        <section class="bk-card">
          <div class="bk-h"><span class="bk-ic">♻️</span><div><h3>Abrir / Restaurar cofre</h3><small>Recupera registros e comprovantes</small></div></div>
          ${restoreBody}
        </section>
      </div>
      ${prog}
      ${st.result ? `<div class="bk-result ${st.result.ok ? "ok" : "err"}">${st.result.html}</div>` : ""}
      <p class="dd-note">💡 Dica: guarde o cofre completo fora do computador (Google Drive, OneDrive, pen drive ou HD externo). Pastas incluídas: ${e.folders.map((f) => `<code>${escapeHtml(f)}</code>`).join(" ") || "—"}</p>`
    );

    const o = this.el;
    o.querySelectorAll('input[name="bk-inc"]').forEach((r) => r.addEventListener("change", () => { st.include = r.value === "1"; this.toolBackup(); }));
    o.querySelectorAll("[data-bko]").forEach((c) => c.addEventListener("change", () => { st[c.dataset.bko] = c.checked; this.toolBackup(); }));
    const on = (k, fn) => o.querySelector(`[data-bk="${k}"]`)?.addEventListener("click", fn);

    on("quick", async () => {
      try {
        const b = await api.backupDatabase();
        st.result = { ok: true, html: `✓ Cópia do banco criada (${mb(b.bytes)}) — ${b.total} cópia(s) na pasta backups.` };
        api.revealInExplorer(b.path).catch(() => { });
      } catch (err) {
        st.result = { ok: false, html: `Falha: ${escapeHtml(String(err))}` };
      }
      this.toolBackup();
    });

    on("create", async () => {
      let path;
      try {
        path = await api.pickBackupTarget(st.include);
      } catch (err) {
        return showToast(String(err), "error");
      }
      if (!path) return;
      st.running = true;
      st.step = "Compactando cofre e gerando manifesto…";
      st.prog = null;
      st.result = null;
      this.toolBackup();
      const stop = await api.onBackupProgress((p) => {
        st.prog = p;
        if (this.active === "backup") this.toolBackup();
      });
      try {
        const r = await api.createBackup(path, st.include);
        st.result = {
          ok: true,
          html: `✓ <b>Cofre exportado com sucesso</b> — ${mb(r.bytes)}${r.files ? ` · ${r.files} comprovantes` : " · só registros"}<br><code>${escapeHtml(r.path)}</code> <button type="button" class="btn-icon-subtle" data-bk="show">📂 Mostrar na pasta</button>`,
          path: r.path,
        };
        showToast("🗄️ Cofre exportado com sucesso!", "success", 3500);
      } catch (err) {
        st.result = { ok: false, html: `Falha na exportação: ${escapeHtml(String(err))}` };
      } finally {
        stop && stop();
        st.running = false;
        st.prog = null;
      }
      if (this.active === "backup") this.toolBackup();
    });
    on("show", () => st.result?.path && api.revealInExplorer(st.result.path).catch(() => { }));

    on("pick", async () => {
      let path;
      try {
        path = await api.pickBackupFile();
      } catch (err) {
        return showToast(String(err), "error");
      }
      if (!path) return;
      st.running = true;
      st.step = "Lendo cofre e calculando hash SHA-256…";
      st.result = null;
      this.toolBackup();
      try {
        st.ins = await api.inspectBackup(path);
        st.restoreDb = st.ins.has_db;
        st.restoreFiles = st.ins.kind === "zip" && st.ins.files > 0;
        st.overwrite = false;
      } catch (err) {
        st.ins = null;
        st.result = { ok: false, html: `Não foi possível ler o cofre: ${escapeHtml(String(err))}` };
      } finally {
        st.running = false;
      }
      if (this.active === "backup") this.toolBackup();
    });

    on("verify", async () => {
      if (!ins?.path) return;
      st.running = true;
      st.step = "Testando integridade do cofre (CRC32 e SQLite)…";
      st.result = null;
      this.toolBackup();
      try {
        const rep = await api.verifyBackupIntegrity(ins.path);
        st.result = {
          ok: rep.is_valid,
          html: `<b>${rep.is_valid ? "✓ Cofre Íntegro" : "⚠️ Inconsistências Detectadas"}</b>: ${escapeHtml(rep.message)}<br>
                 <small>Arquivos testados: ${rep.total_files_tested} · Registros no banco: ${rep.db_records}${rep.crc_errors.length ? `<br>Erros de CRC: ${rep.crc_errors.join(", ")}` : ""}</small>`,
        };
        showToast(rep.is_valid ? "✓ Cofre íntegro e validado" : "Atenção: problemas encontrados", rep.is_valid ? "success" : "warning", 3500);
      } catch (err) {
        st.result = { ok: false, html: `Falha na verificação: ${escapeHtml(String(err))}` };
      } finally {
        st.running = false;
      }
      if (this.active === "backup") this.toolBackup();
    });

    on("restore", async () => {
      const ins = st.ins;
      const what = [st.restoreDb && `substituir TODOS os registros atuais pelos ${ins.records} registros do cofre`, st.restoreFiles && ins.files && `copiar ${ins.files} arquivo(s) de comprovantes${st.overwrite ? " (substituindo os existentes)" : ""}`].filter(Boolean);
      if (!window.confirm(`Restaurar o cofre vai:\n\n• ${what.join("\n• ")}\n\nUma cópia de segurança do banco atual será guardada na pasta backups. Continuar?`)) return;
      st.running = true;
      st.step = "Restaurando…";
      st.prog = null;
      st.result = null;
      this.toolBackup();
      const stop = await api.onBackupProgress((p) => {
        st.prog = p;
        if (this.active === "backup") this.toolBackup();
      });
      try {
        const r = await api.restoreBackup(ins.path, Boolean(st.restoreDb), Boolean(st.restoreFiles && ins.files), Boolean(st.overwrite));
        const parts = [r.db_restored && "registros restaurados", (r.files_written || r.files_skipped) && `${r.files_written} arquivo(s) copiado(s)${r.files_skipped ? `, ${r.files_skipped} já existiam` : ""}`].filter(Boolean);
        st.result = {
          ok: !r.errors.length,
          html: `✓ <b>Cofre restaurado</b> — ${parts.join(" · ")}${r.safety_copy ? `<br><small>Cópia do banco anterior: <code>${escapeHtml(r.safety_copy)}</code></small>` : ""}${r.errors.length ? `<details><summary>⚠️ ${r.errors.length} aviso(s)</summary><ul>${r.errors.slice(0, 50).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></details>` : ""}
            ${r.db_restored ? `<br><button type="button" class="btn btn-primary btn-sm" data-bk="reload">Recarregar o app</button>` : ""}`,
        };
        st.ins = null;
        st.est = null;
        if (r.db_restored) setTimeout(() => location.reload(), 4000);
        this.onChanged && this.onChanged();
      } catch (err) {
        st.result = { ok: false, html: `Falha na restauração: ${escapeHtml(String(err))}` };
      } finally {
        stop && stop();
        st.running = false;
        st.prog = null;
      }
      if (this.active === "backup") this.toolBackup();
    });
    on("reload", () => location.reload());
  }
}
