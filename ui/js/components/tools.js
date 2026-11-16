// Ferramentas: utilidades ligadas aos registros e aos arquivos do app.

import { api } from "../api.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../utils.js";

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

// ---------- catálogo ----------
const TOOLS = [
  ["formatar", "🔤", "Formatador de nomes e datas", "Cole nomes ou datas e converta: Nome Próprio, ABNT (OLIVOTO, T.), Vancouver, nome de arquivo, dd/mm/aaaa, ISO, por extenso."],
  ["padronizar", "✨", "Padronizar textos dos registros", "Corrige MAIÚSCULAS, espaços duplos e capitalização de nomes de alunos, títulos e periódicos — com prévia antes de aplicar."],
  ["renomear", "🏷️", "Renomear comprovantes", "Renomeia os arquivos pelo título do registro: 001_titulo_do_trabalho.pdf (sem acentos, com _), atualizando os vínculos."],
  ["verificar", "🩺", "Verificar arquivos", "Encontra registros cujo arquivo sumiu da pasta e arquivos nas pastas que não estão ligados a nenhum registro."],
  ["qualis", "🏆", "Completar Qualis", "Preenche o Qualis das produções sem estrato usando o que você já atribuiu à mesma revista."],
  ["dois", "🔗", "Extrair DOI dos artigos", "Varre as produções sem DOI: lê o DOI de dentro do PDF anexado e, se não houver, procura pelo título na Crossref."],
  ["pdfs", "⚡", "Buscar PDFs por DOI (lote)", "Para artigos sem comprovante: resolve o DOI (ou procura pelo título) e baixa o PDF de acesso aberto."],
  ["duplicatas", "👯", "Duplicatas e vínculos", "Abre o assistente que liga arquivos soltos aos registros e mostra possíveis registros duplicados."],
  ["backup", "🛟", "Backup e restauração", "Cria um backup .zip dos registros (com ou sem os arquivos dos comprovantes) e restaura um backup anterior."],
];

export class ToolsView {
  constructor({ container, onChanged, openLinker, fetchPdf }) {
    this.el = container;
    this.onChanged = onChanged;
    this.openLinker = openLinker;
    this.fetchPdf = fetchPdf;
    this.active = null;
  }

  show() {
    this.active = null;
    this.render();
  }

  render() {
    if (this.active) return this.renderTool();
    this.el.innerHTML = `
      <div class="tl-wrap">
        <div class="tl-grid">
          ${TOOLS.map(
            ([k, ic, t, d], i) => `<button type="button" class="tl-card" data-tool="${k}" style="--i:${i}">
              <span class="tl-ic">${ic}</span><b>${escapeHtml(t)}</b><span>${escapeHtml(d)}</span><i class="tl-go">→</i></button>`
          ).join("")}
        </div>
      </div>`;
    this.el.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => this.open(b.dataset.tool)));
  }

  open(k) {
    if (k === "duplicatas") return this.openLinker && this.openLinker();
    this.active = k;
    this.state = {};
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
    ({ formatar: () => this.toolFormat(), padronizar: () => this.toolTidy(), renomear: () => this.toolRename(), verificar: () => this.toolCheck(), qualis: () => this.toolQualis(), pdfs: () => this.toolPdfs(), dois: () => this.toolDois(), backup: () => this.toolBackup() })[this.active]();
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
      ${fc.ausentes.length ? `<h3 class="tl-h3">Arquivo ausente <button type="button" class="btn btn-secondary btn-sm" data-clear>Remover esses vínculos quebrados</button></h3>
        <div class="tl-table sm"><table class="data-table"><tbody>${fc.ausentes.map((x) => `<tr><td style="width:130px"><span class="badge badge-tipo">${escapeHtml(CATEGORY_SCHEMAS[x.category]?.group || x.category)}</span></td><td>#${x.id} ${escapeHtml(x.titulo)}</td><td class="mono tl-old">${escapeHtml(x.path)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${fc.orfaos.length ? `<h3 class="tl-h3">Arquivos sem registro <button type="button" class="btn btn-primary btn-sm" data-link>🔗 Vincular automaticamente</button></h3>
        <div class="tl-table sm"><table class="data-table"><tbody>${fc.orfaos.slice(0, 500).map((f) => `<tr><td class="mono">${escapeHtml(f)}</td><td style="width:90px;text-align:right"><button type="button" class="ibtn" data-reveal="${escapeHtml(f)}" title="Mostrar na pasta">📂</button></td></tr>`).join("")}</tbody></table></div>` : ""}
      ${!fc.ausentes.length && !fc.orfaos.length ? '<div class="tl-empty">✅ Tudo em ordem: todos os vínculos apontam para arquivos existentes e não há arquivos soltos.</div>' : ""}`
    );
    this.el.querySelector("[data-link]")?.addEventListener("click", () => this.openLinker && this.openLinker());
    this.el.querySelectorAll("[data-reveal]").forEach((b) => b.addEventListener("click", () => api.revealInExplorer(b.dataset.reveal).catch(() => {})));
    this.el.querySelector("[data-clear]")?.addEventListener("click", async () => {
      if (!window.confirm(`Remover o vínculo de ${fc.ausentes.length} registro(s) com arquivos que não existem mais?\nOs registros continuam; só ficam "sem comprovante".`)) return;
      const r = await api.clearMissingLinks(fc.ausentes).catch((e) => ({ ok: 0, erros: [String(e)] }));
      showToast(`${r.ok} vínculo(s) removido(s)`, r.erros.length ? "error" : "success");
      st.fc = null;
      this.onChanged && this.onChanged();
      this.toolCheck();
    });
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
        } catch {}
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
    if (!st.data) st.data = await api.getAllRecords();
    const isDoi = (s) => /^10\.\d{4,9}\//.test(String(s || "").trim());
    const cands = (st.data.producoes || [])
      .filter((r) => !(r.path && r.path.trim()) && (isDoi(r.identifier) || /artigo|cap[ií]tulo|livro|resumo|trabalhos completos/i.test(r.tipo || "")))
      .sort((a, b) => (b.ano || 0) - (a.ano || 0));
    st.log ||= {};
    const running = Boolean(st.running);
    const done = Object.values(st.log).filter((x) => x.s === "ok").length;
    this.shell(
      "Buscar PDFs por DOI (lote)",
      "Para cada produção sem comprovante: usa o DOI (ou procura pelo título na Crossref) e baixa o PDF de acesso aberto. Itens sem PDF disponível ficam como estão.",
      cands.length
        ? `<div class="tl-bar"><span><b>${cands.length}</b> produção(ões) sem comprovante · ${done} PDF(s) anexado(s) nesta sessão</span>
            ${running ? '<button type="button" class="btn btn-secondary btn-sm" data-stop>■ Parar</button>' : `<button type="button" class="btn btn-primary btn-sm" data-run>⚡ Buscar ${cands.length} PDF(s)</button>`}</div>
          ${running ? `<div class="tl-progress"><i style="width:${Math.round((st.i / cands.length) * 100)}%"></i></div>` : ""}
          <div class="tl-table"><table class="data-table"><thead><tr><th style="width:60px">Ano</th><th>Título</th><th style="width:240px">Situação</th></tr></thead><tbody>
          ${cands.map((r) => { const l = st.log[r.id]; return `<tr><td>${r.ano || "—"}</td><td>${escapeHtml(r.titulo || "")}</td><td class="tl-st ${l?.s || ""}">${l ? escapeHtml(l.m) : isDoi(r.identifier) ? "DOI cadastrado" : "procurar pelo título"}</td></tr>`; }).join("")}
          </tbody></table></div>
          <p class="dd-note">Editoras como Elsevier, Wiley e OUP costumam bloquear downloads automáticos; nesses casos use o botão ⚡ da linha para abrir o PDF no navegador.</p>`
        : `<div class="tl-empty">✅ Todas as produções com DOI provável já têm comprovante.</div>`
    );
    this.el.querySelector("[data-stop]")?.addEventListener("click", () => (st.stop = true));
    this.el.querySelector("[data-run]")?.addEventListener("click", async () => {
      st.running = true;
      st.stop = false;
      st.i = 0;
      for (const r of cands) {
        if (st.stop || this.active !== "pdfs") break;
        st.log[r.id] = { s: "run", m: "⏳ buscando…" };
        this.toolPdfs();
        try {
          let doi = isDoi(r.identifier) ? r.identifier.trim() : null;
          if (!doi && String(r.titulo || "").length >= 15) doi = await api.findDoiByTitle(r.titulo);
          if (!doi) {
            st.log[r.id] = { s: "skip", m: "DOI não encontrado" };
          } else {
            const res = await api.resolveDoi(doi, true);
            if (res.pdf_path) {
              await api.updateRecord("producoes", r.id, { identifier: doi }, res.pdf_path);
              st.log[r.id] = { s: "ok", m: `📄 anexado (${res.pdf_versao || "PDF"})` };
            } else {
              if (!isDoi(r.identifier)) await api.updateRecord("producoes", r.id, { identifier: doi }).catch(() => {});
              st.log[r.id] = { s: "skip", m: res.oa_status === "closed" ? "sem acesso aberto" : "PDF bloqueado pela editora" };
            }
          }
        } catch (e) {
          st.log[r.id] = { s: "err", m: String(e).slice(0, 60) };
        }
        st.i++;
      }
      st.running = false;
      st.data = null;
      this.onChanged && this.onChanged();
      if (this.active === "pdfs") this.toolPdfs();
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
            ${run
              ? '<button type="button" class="btn btn-secondary btn-sm" data-stop>■ Parar</button>'
              : '<button type="button" class="btn btn-secondary btn-sm" data-run>🔎 Procurar DOI</button>'}
            ${nAchados() && !run ? `<button type="button" class="btn btn-primary btn-sm" data-apply>Gravar ${st.sel.size} DOI(s)</button>` : ""}
          </div>
          ${run ? `<div class="tl-progress"><i style="width:${Math.round((st.i / Math.max(1, st.n || 1)) * 100)}%"></i></div>` : ""}
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
      const cel = this.el.querySelector(`[data-cell="${r.id}"]`);
      if (!cel) return;
      cel.className = `tl-st ${st.found[r.id]?.s || ""}`;
      cel.innerHTML = cellHtml(r);
      const chk = this.el.querySelector(`[data-chk="${r.id}"]`);
      if (chk) chk.innerHTML = chkHtml(r);
    };
    const pintarBarra = () => {
      const fill = this.el.querySelector(".tl-progress i");
      if (fill) fill.style.width = `${Math.round((st.i / Math.max(1, st.n || 1)) * 100)}%`;
      const lbl = this.el.querySelector("[data-count]");
      if (lbl) lbl.innerHTML = contador();
    };
    const refresh = () => this.active === "dois" && this.toolDois();

    this.el.querySelector("[data-online]")?.addEventListener("change", (e) => (st.online = e.target.checked));
    this.el.querySelector("[data-stop]")?.addEventListener("click", () => (st.stop = true));

    // delegação: os botões e caixas das linhas são recriados durante a varredura
    const tabela = this.el.querySelector(".tl-table");
    tabela?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-open]");
      if (b) api.openDoi(b.dataset.open).catch(() => {});
    });
    tabela?.addEventListener("change", (e) => {
      const c = e.target.closest("[data-id]");
      if (!c) return;
      c.checked ? st.sel.add(+c.dataset.id) : st.sel.delete(+c.dataset.id);
      const b = this.el.querySelector("[data-apply]");
      if (b) b.textContent = `Gravar ${st.sel.size} DOI(s)`;
    });

    this.el.querySelector("[data-run]")?.addEventListener("click", async () => {
      st.running = true;
      st.stop = false;
      st.i = 0;
      st.found = {};
      st.sel = new Set();
      const comPdfList = cands.filter(hasPdf);
      st.n = comPdfList.length + (st.online ? cands.length : 0);
      await refresh(); // mostra a barra de progresso e o botão Parar

      // 1) DOI declarado dentro do PDF — rápido e sem rede
      for (const r of comPdfList) {
        if (st.stop || this.active !== "dois") break;
        try {
          const doi = await api.extractRecordDoi("producoes", r.id);
          if (doi) {
            st.found[r.id] = { doi, fonte: "pdf", s: "ok" };
            st.sel.add(r.id);
          } else {
            st.found[r.id] = { m: "sem DOI no arquivo", s: "skip" };
          }
        } catch (e) {
          st.found[r.id] = { m: String(e).slice(0, 60), s: "err" };
        }
        st.i++;
        pintarLinha(r);
        pintarBarra();
      }
      // 2) o que sobrou: busca pelo título na Crossref
      if (st.online) {
        for (const r of cands.filter((x) => !st.found[x.id]?.doi && String(x.titulo || "").trim().length >= 15)) {
          if (st.stop || this.active !== "dois") break;
          st.found[r.id] = { m: "⏳ procurando na Crossref…", s: "run" };
          pintarLinha(r);
          try {
            const doi = await api.findDoiByTitle(r.titulo);
            if (doi) {
              st.found[r.id] = { doi, fonte: "crossref", s: "warn" };
              st.sel.add(r.id);
            } else {
              st.found[r.id] = { m: "não encontrado", s: "skip" };
            }
          } catch (e) {
            st.found[r.id] = { m: String(e).slice(0, 60), s: "err" };
          }
          st.i++;
          pintarLinha(r);
          pintarBarra();
        }
      }
      st.running = false;
      refresh(); // troca a barra pelo botão "Gravar"
    });

    this.el.querySelector("[data-apply]")?.addEventListener("click", async () => {
      const todo = cands.filter((r) => st.sel.has(r.id) && st.found[r.id]?.doi);
      if (!todo.length) return;
      let ok = 0;
      const erros = [];
      for (const r of todo) {
        try {
          await api.updateRecord("producoes", r.id, { identifier: st.found[r.id].doi });
          ok++;
        } catch (e) {
          erros.push(`#${r.id}: ${e}`);
        }
      }
      showToast(`${ok} DOI(s) gravado(s)${erros.length ? ` · ${erros.length} erro(s)` : ""}`, erros.length ? "error" : "success", 4000);
      st.data = null;
      st.found = {};
      st.sel = new Set();
      this.onChanged && this.onChanged();
      refresh();
    });
  }

  // ===== 8. backup e restauração =====
  async toolBackup() {
    const st = this.state;
    st.include ??= true;
    if (!st.est) {
      this.shell("Backup e restauração", "Calculando o tamanho dos seus dados…", `<div class="loading-state" style="display:flex"><div class="spinner"></div></div>`);
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
      restoreBody = `<p class="bk-p">Escolha um backup <b>.zip</b> criado aqui (ou um <b>lattes.db</b> antigo da pasta <code>backups</code>). Antes de substituir, o app guarda uma cópia do banco atual.</p>
        <button type="button" class="btn btn-secondary" data-bk="pick" ${busy ? "disabled" : ""}>📂 Escolher backup…</button>`;
    } else {
      const m = ins.manifest;
      const hasFiles = ins.kind === "zip" && ins.files > 0;
      restoreBody = `<div class="bk-file"><span class="bk-ic">${ins.kind === "zip" ? "🗜️" : "🗄️"}</span><div>
          <b>${escapeHtml(ins.path.split(/[\\/]/).pop())}</b>
          <small>${mb(ins.bytes)}${m ? ` · criado em ${escapeHtml(m.created)} · v${escapeHtml(m.version)}` : ins.kind === "db" ? " · banco avulso (só registros)" : ""}</small></div>
          <button type="button" class="btn-icon-subtle" data-bk="pick" ${busy ? "disabled" : ""}>Trocar</button></div>
        <div class="bk-counts"><b>${ins.records}</b> registros${hasFiles ? ` · <b>${ins.files}</b> arquivos de comprovantes` : ""}
          <span>${ins.counts.filter((c) => c[1]).map(([t, n]) => `${escapeHtml(catName(t))} ${n}`).join(" · ")}</span></div>
        <label class="bk-opt"><input type="checkbox" data-bko="restoreDb" ${st.restoreDb ? "checked" : ""}/><span><b>Restaurar os registros (banco de dados)</b><small>Substitui todos os registros atuais pelos do backup.</small></span></label>
        ${hasFiles ? `<label class="bk-opt"><input type="checkbox" data-bko="restoreFiles" ${st.restoreFiles ? "checked" : ""}/><span><b>Restaurar os arquivos dos comprovantes</b><small>Copia os arquivos do backup para a pasta de dados.</small></span></label>
        <label class="bk-opt sub ${st.restoreFiles ? "" : "off"}"><input type="checkbox" data-bko="overwrite" ${st.overwrite ? "checked" : ""} ${st.restoreFiles ? "" : "disabled"}/><span><b>Substituir arquivos que já existem</b><small>Desmarcado: mantém os arquivos atuais e só traz os que faltam.</small></span></label>` : ""}
        <button type="button" class="btn btn-danger" data-bk="restore" ${busy || !(st.restoreDb || (hasFiles && st.restoreFiles)) ? "disabled" : ""}>♻️ Restaurar backup</button>`;
    }

    this.shell(
      "Backup e restauração",
      "Proteja o seu currículo: um arquivo .zip com todos os registros — e, se quiser, todos os comprovantes.",
      `<div class="bk-grid">
        <section class="bk-card">
          <div class="bk-h"><span class="bk-ic">🛟</span><div><h3>Criar backup</h3><small>Funciona com o app aberto</small></div></div>
          <label class="bk-opt"><input type="radio" name="bk-inc" value="0" ${!st.include ? "checked" : ""}/><span><b>Só os registros</b><small>Banco de dados · ${mb(e.db_bytes)} (o .zip fica menor)</small></span></label>
          <label class="bk-opt"><input type="radio" name="bk-inc" value="1" ${st.include ? "checked" : ""}/><span><b>Registros + arquivos dos comprovantes</b><small>${e.files} arquivo(s) · ${mb(e.bytes + e.db_bytes)} — cópia completa para outro computador ou HD externo</small></span></label>
          <button type="button" class="btn btn-primary" data-bk="create" ${busy ? "disabled" : ""}>💾 Criar backup…</button>
          <button type="button" class="btn-icon-subtle" data-bk="quick" ${busy ? "disabled" : ""} title="Cópia datada do lattes.db na pasta backups">⚡ Cópia rápida do banco na pasta backups</button>
        </section>
        <section class="bk-card">
          <div class="bk-h"><span class="bk-ic">♻️</span><div><h3>Restaurar backup</h3><small>Recupera registros e/ou comprovantes</small></div></div>
          ${restoreBody}
        </section>
      </div>
      ${prog}
      ${st.result ? `<div class="bk-result ${st.result.ok ? "ok" : "err"}">${st.result.html}</div>` : ""}
      <p class="dd-note">💡 Dica: guarde o backup completo fora do computador (nuvem, pen drive ou HD externo). Pastas incluídas: ${e.folders.map((f) => `<code>${escapeHtml(f)}</code>`).join(" ") || "—"}</p>`
    );

    const o = this.el;
    o.querySelectorAll('input[name="bk-inc"]').forEach((r) => r.addEventListener("change", () => { st.include = r.value === "1"; this.toolBackup(); }));
    o.querySelectorAll("[data-bko]").forEach((c) => c.addEventListener("change", () => { st[c.dataset.bko] = c.checked; this.toolBackup(); }));
    const on = (k, fn) => o.querySelector(`[data-bk="${k}"]`)?.addEventListener("click", fn);

    on("quick", async () => {
      try {
        const b = await api.backupDatabase();
        st.result = { ok: true, html: `✓ Cópia do banco criada (${mb(b.bytes)}) — ${b.total} cópia(s) na pasta backups.` };
        api.revealInExplorer(b.path).catch(() => {});
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
      st.step = "Copiando o banco de dados…";
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
          html: `✓ <b>Backup criado</b> — ${mb(r.bytes)}${r.files ? ` · ${r.files} comprovantes` : " · só registros"}<br><code>${escapeHtml(r.path)}</code> <button type="button" class="btn-icon-subtle" data-bk="show">📂 Mostrar na pasta</button>`,
          path: r.path,
        };
        showToast("🛟 Backup criado", "success", 3500);
      } catch (err) {
        st.result = { ok: false, html: `Falha no backup: ${escapeHtml(String(err))}` };
      } finally {
        stop && stop();
        st.running = false;
        st.prog = null;
      }
      if (this.active === "backup") this.toolBackup();
    });
    on("show", () => st.result?.path && api.revealInExplorer(st.result.path).catch(() => {}));

    on("pick", async () => {
      let path;
      try {
        path = await api.pickBackupFile();
      } catch (err) {
        return showToast(String(err), "error");
      }
      if (!path) return;
      st.running = true;
      st.step = "Lendo o backup…";
      st.result = null;
      this.toolBackup();
      try {
        st.ins = await api.inspectBackup(path);
        st.restoreDb = st.ins.has_db;
        st.restoreFiles = st.ins.kind === "zip" && st.ins.files > 0;
        st.overwrite = false;
      } catch (err) {
        st.ins = null;
        st.result = { ok: false, html: `Não foi possível ler o backup: ${escapeHtml(String(err))}` };
      } finally {
        st.running = false;
      }
      if (this.active === "backup") this.toolBackup();
    });

    on("restore", async () => {
      const ins = st.ins;
      const what = [st.restoreDb && `substituir TODOS os registros atuais pelos ${ins.records} registros do backup`, st.restoreFiles && ins.files && `copiar ${ins.files} arquivo(s) de comprovantes${st.overwrite ? " (substituindo os existentes)" : ""}`].filter(Boolean);
      if (!window.confirm(`Restaurar o backup vai:\n\n• ${what.join("\n• ")}\n\nUma cópia do banco atual será guardada na pasta backups. Continuar?`)) return;
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
          html: `✓ <b>Backup restaurado</b> — ${parts.join(" · ")}${r.safety_copy ? `<br><small>Cópia do banco anterior: <code>${escapeHtml(r.safety_copy)}</code></small>` : ""}${r.errors.length ? `<details><summary>⚠️ ${r.errors.length} aviso(s)</summary><ul>${r.errors.slice(0, 50).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></details>` : ""}
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
