// PDF com a tabela de pontuação de um barema: grupos, itens, critérios de seleção, pesos e tetos.
// Usa pdf-lib (global PDFLib) e as fontes do gerador de comprovantes.

import { loadFonts, makeSanitizer, wrapText } from "./buildReport.js";
import { BASE_LABEL, GROUP_COLORS, RN114_TABELA4, RN114_TABELAS } from "../scoring.js";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;
const CW = PAGE_W - 2 * M;
const C = {
  ink: "#0f172a",
  text: "#334155",
  muted: "#64748b",
  line: "#e2e8f0",
  zebra: "#f8fafc",
  white: "#ffffff",
  accent: "#4f46e5",
};
const PALETTE = ["#2563eb", "#059669", "#7c3aed", "#d97706", "#dc2626", "#0891b2", "#db2777", "#65a30d"];

// pdf-lib e fontkit são carregados sob demanda (como no gerador de comprovantes)
let libsPromise = null;
function loadLibs() {
  if (window.PDFLib && window.fontkit) return Promise.resolve();
  const load = (src) =>
    new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error(`Falha ao carregar ${src}`));
      document.head.appendChild(s);
    });
  libsPromise ||= Promise.all([
    window.PDFLib ? null : load("vendor/pdf-lib.min.js"),
    window.fontkit ? null : load("vendor/fontkit.umd.min.js"),
  ]).catch((e) => {
    libsPromise = null;
    throw e;
  });
  return libsPromise;
}

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const fmt = (n) => Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * Seções (grupos) do barema na ordem da tabela: tabelas da RN 114, grupos definidos ou categorias.
 * Cada seção: { name, color, notes[], rules[] }.
 */
function sectionsOf(b, catName) {
  const rn = b.mode === "rn114";
  const groups = !rn && Array.isArray(b.groups) ? b.groups : [];
  const out = [];
  if (rn) {
    for (const key of ["ensino", "pesquisa"]) {
      const rules = b.rules.filter((r) => (r.table === "ensino" ? "ensino" : "pesquisa") === key);
      if (rules.length) out.push({ name: RN114_TABELAS[key].name, color: RN114_TABELAS[key].color, notes: [], rules });
    }
  } else if (groups.length) {
    groups.forEach((g, i) => {
      const notes = [];
      if (g.pick === "max") notes.push("vale só o item de maior pontuação");
      if (g.cap != null && g.cap !== "") notes.push(`teto do grupo: ${fmt(g.cap)} pontos`);
      notes.push(g.before ? "atividades dos demais grupos anteriores ao período" : g.allYears ? "qualquer ano" : "somente o período do barema");
      out.push({ name: g.name, color: GROUP_COLORS[i % GROUP_COLORS.length], notes, rules: b.rules.filter((r) => r.group === g.id) });
    });
    const resto = b.rules.filter((r) => !groups.some((g) => g.id === r.group));
    if (resto.length) out.push({ name: "Outros", color: "#64748b", notes: [], rules: resto });
  } else {
    const cats = [...new Set(b.rules.map((r) => r.category))];
    cats.forEach((c, i) => out.push({ name: catName(c), color: PALETTE[i % PALETTE.length], notes: [], rules: b.rules.filter((r) => r.category === c) }));
  }
  return out;
}

/** Ordena por nº de item ("2.3.1" < "2.3.10"); critérios sem nº mantêm a ordem do barema. */
function byItem(rules) {
  const key = (s) => String(s || "").split(/[.\s]/).map((p) => (/^\d+$/.test(p) ? p.padStart(4, "0") : p)).join(".");
  return rules
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.item && b.r.item ? key(a.r.item).localeCompare(key(b.r.item)) || a.i - b.i : a.i - b.i))
    .map((x) => x.r);
}

/**
 * Monta o PDF. `opts`: { period, goal, onlyWithProof, semesters, regime, describe(rule), catName(cat), version }.
 * Devolve Uint8Array.
 */
export async function buildBaremaPdf(barema, opts = {}) {
  await loadLibs();
  const { PDFDocument, StandardFonts } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`Barema – ${barema.name}`);
  doc.setCreator("Lattes Manager");
  const F = await loadFonts(doc, StandardFonts);
  const san = makeSanitizer(F);
  const catName = opts.catName || ((c) => c);
  const describe = opts.describe || (() => "");
  const rn = barema.mode === "rn114";
  const hasItem = barema.rules.some((r) => r.item);
  const hasCap = !rn && barema.rules.some((r) => r.cap != null && r.cap !== "");

  let p;
  let y;
  const text = (s, x, yy, { font = F.reg, size = 9, color = C.text } = {}) =>
    p.drawText(san(s, font), { x, y: yy, size, font, color: hex(color) });
  const width = (s, font, size) => font.widthOfTextAtSize(san(s, font), size);
  const right = (s, xr, yy, o = {}) => text(s, xr - width(s, o.font || F.reg, o.size || 9), yy, o);
  const lines = (s, font, size, w) => wrapText(san(s, font), font, size, w);

  // colunas da tabela (x inicial e largura)
  const col = {};
  {
    let x = M;
    const add = (k, w) => { col[k] = { x, w }; x += w; };
    if (hasItem) add("item", 40);
    const fixed = (hasItem ? 40 : 0) + 150 + 46 + 66 + (hasCap ? 46 : 0);
    add("crit", CW - fixed);
    add("sel", 150);
    add("peso", 46);
    add("base", 66);
    if (hasCap) add("teto", 46);
  }
  const heads = [
    ...(hasItem ? [["item", "Nº"]] : []),
    ["crit", rn ? "Atividade" : "Critério / item"],
    ["sel", "Registros considerados"],
    ["peso", rn ? "FM" : "Pontos"],
    ["base", "Base"],
    ...(hasCap ? [["teto", "Teto"]] : []),
  ];

  const newPage = () => {
    p = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - M;
  };
  const tableHead = () => {
    p.drawRectangle({ x: M, y: y - 18, width: CW, height: 18, color: hex(C.ink) });
    for (const [k, l] of heads) {
      const c = col[k];
      if (["peso", "teto"].includes(k)) right(l.toUpperCase(), c.x + c.w - 5, y - 12.5, { font: F.bold, size: 7, color: C.white });
      else text(l.toUpperCase(), c.x + 5, y - 12.5, { font: F.bold, size: 7, color: C.white });
    }
    y -= 18;
  };
  const ensure = (h, withHead = false) => {
    if (y - h < M + 24) {
      newPage();
      if (withHead) tableHead();
    }
  };

  // ---------- cabeçalho ----------
  newPage();
  const titleLines = lines(barema.name, F.bold, 17, CW - 36);
  const headH = 46 + titleLines.length * 21;
  p.drawRectangle({ x: M, y: y - headH, width: CW, height: headH, color: hex(C.ink) });
  p.drawRectangle({ x: M, y: y - headH, width: 5, height: headH, color: hex(C.accent) });
  text("TABELA DE PONTUAÇÃO DO BAREMA", M + 20, y - 22, { font: F.bold, size: 8, color: "#a5b4fc" });
  titleLines.forEach((l, i) => text(l, M + 20, y - 44 - i * 21, { font: F.bold, size: 17, color: C.white }));
  y -= headH + 14;

  // resumo das regras gerais
  const info = [];
  if (opts.period) info.push(["Período considerado", opts.period]);
  if (Number(opts.goal) > 0) info.push([rn ? "Pontuação mínima" : "Meta", `${fmt(opts.goal)} pontos`]);
  if (rn) {
    info.push(["Semestres avaliados", String(opts.semesters ?? barema.semesters ?? 4)]);
    info.push(["Regime", { DE: "Dedicação exclusiva", 40: "40 horas", 20: "20 horas" }[String(opts.regime ?? barema.regime)] || "—"]);
  }
  info.push(["Critérios", String(barema.rules.length)]);
  info.push(["Comprovante", opts.onlyWithProof ? "obrigatório" : "não exigido no cálculo"]);
  const cellW = CW / Math.min(info.length, 4);
  info.forEach(([k, v], i) => {
    const row = Math.floor(i / 4);
    const x = M + (i % 4) * cellW;
    const yy = y - row * 34;
    text(k.toUpperCase(), x, yy - 8, { font: F.bold, size: 6.8, color: C.muted });
    text(v, x, yy - 21, { font: F.semi, size: 10, color: C.ink });
  });
  y -= Math.ceil(info.length / 4) * 34 + 6;

  const regra = rn
    ? "Cada atividade gera unidades = quantidade × FM (× horas quando a base é horária). Em cada tabela, u = unidades ÷ semestres; os pontos saem da Tabela 4 (máximo de 40) × semestres ÷ 4. O ensino deve somar ao menos 50% da pontuação mínima (no regime de 20 horas, toda ela)."
    : "Cada registro conta uma única vez, no primeiro critério da sua categoria que ele atender. Pontos = quantidade × peso (× anos ou horas quando indicado na base); o teto limita o critério, e itens com o mesmo nº dividem o mesmo teto.";
  for (const l of lines(regra, F.reg, 8.5, CW)) {
    text(l, M, y - 8, { size: 8.5, color: C.text });
    y -= 12;
  }
  if (Array.isArray(barema.docs) && barema.docs.length) {
    y -= 2;
    for (const l of lines(`Documentos de referência: ${barema.docs.map((d) => d.name).join("; ")}`, F.semi, 8.5, CW)) {
      text(l, M, y - 8, { font: F.semi, size: 8.5, color: C.accent });
      y -= 12;
    }
  }
  y -= 10;

  // ---------- seções ----------
  for (const sec of sectionsOf(barema, catName)) {
    if (!sec.rules.length) continue;
    ensure(70);
    p.drawRectangle({ x: M, y: y - 24, width: CW, height: 24, color: hex(sec.color), opacity: 0.12 });
    p.drawRectangle({ x: M, y: y - 24, width: 4, height: 24, color: hex(sec.color) });
    text(sec.name, M + 12, y - 16, { font: F.bold, size: 11, color: C.ink });
    if (sec.notes.length) right(sec.notes.join("  ·  "), M + CW - 8, y - 15.5, { size: 7.8, color: C.muted });
    y -= 28;
    tableHead();
    byItem(sec.rules).forEach((r, ri) => {
      const sel = [catName(r.category), describe(r)].filter(Boolean).join(" · ");
      const crit = lines(r.label, F.semi, 8.8, col.crit.w - 10);
      const sl = lines(sel, F.reg, 7.6, col.sel.w - 10);
      const base = r.base && r.base !== "item" ? (BASE_LABEL[r.base] || r.base).replace(/ \(.*\)/, "") : "por item";
      const bl = lines(base, F.reg, 7.6, col.base.w - 10);
      const h = Math.max(crit.length * 11, sl.length * 9.5, bl.length * 9.5) + 9;
      ensure(h, true);
      if (ri % 2) p.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: hex(C.zebra) });
      const top = y - 12;
      if (hasItem && r.item) text(r.item, col.item.x + 5, top, { font: F.bold, size: 8.5, color: sec.color });
      crit.forEach((l, i) => text(l, col.crit.x + 5, top - i * 11, { font: F.semi, size: 8.8, color: C.ink }));
      sl.forEach((l, i) => text(l, col.sel.x + 5, top - i * 9.5, { size: 7.6, color: C.muted }));
      right(fmt(r.weight), col.peso.x + col.peso.w - 5, top, { font: F.bold, size: 9, color: C.ink });
      bl.forEach((l, i) => text(l, col.base.x + 5, top - i * 9.5, { size: 7.6, color: C.text }));
      if (hasCap) right(r.cap != null && r.cap !== "" ? fmt(r.cap) : "—", col.teto.x + col.teto.w - 5, top, { size: 8.8, color: C.text });
      y -= h;
      p.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.4, color: hex(C.line) });
    });
    y -= 16;
  }

  // ---------- Tabela 4 (RN 114) ----------
  if (rn) {
    ensure(200);
    text("Tabela 4 – conversão de unidades (u) em pontos", M, y - 12, { font: F.bold, size: 11, color: C.ink });
    y -= 22;
    const rows = [...RN114_TABELA4.filter(([, pt]) => pt > 0), [Infinity, 40]];
    const per = Math.ceil(rows.length / 4);
    const w = CW / 4;
    for (let i = 0; i < per; i++) {
      for (let c = 0; c < 4; c++) {
        const k = c * per + i;
        if (k >= rows.length) continue;
        const prev = k === 0 ? 0 : rows[k - 1][0];
        const [ate, pt] = rows[k];
        const faixa = ate === Infinity ? `acima de ${fmt(prev)}` : `${fmt(prev)} – ${fmt(ate)}`;
        text(faixa, M + c * w + 4, y - 9, { size: 7.8, color: C.text });
        right(`${pt} pts`, M + c * w + w - 10, y - 9, { font: F.semi, size: 7.8, color: C.ink });
      }
      y -= 12;
    }
  }

  // ---------- rodapé ----------
  const pages = doc.getPages();
  const data = new Date().toLocaleDateString("pt-BR");
  pages.forEach((pg, i) => {
    p = pg;
    p.drawLine({ start: { x: M, y: M - 6 }, end: { x: PAGE_W - M, y: M - 6 }, thickness: 0.5, color: hex(C.line) });
    const esq = `Lattes Manager${opts.version ? ` ${opts.version}` : ""} · gerado em ${data}`;
    text(esq.length > 110 ? esq.slice(0, 110) : esq, M, M - 18, { size: 7.5, color: C.muted });
    right(`página ${i + 1} de ${pages.length}`, PAGE_W - M, M - 18, { size: 7.5, color: C.muted });
  });
  return doc.save();
}
