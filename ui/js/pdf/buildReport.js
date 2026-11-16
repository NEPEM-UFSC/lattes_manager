// Montagem do PDF único "Comprovantes Lattes" com pdf-lib (global PDFLib) + fontkit (global fontkit).
//
// Estrutura: Capa → Resumo do CV (opcional) → Sumário → [Seção: lista numerada → anexos carimbados]…
// Todas as páginas recebem o rodapé "Gerado com Lattes Manager vX · data · Página N de M".

import { api } from "../api.js";
import { PHOTO_ASPECT, PHOTO_FOCUS_Y } from "../components/profile.js";

const A4 = [595.28, 841.89];
const M = 56; // margem lateral
const FOOT_H = 34; // área reservada ao rodapé
const STAMP_H = 30; // faixa superior nas páginas de comprovante

const C = {
  ink: "#0f172a",
  text: "#334155",
  muted: "#64748b",
  faint: "#94a3b8",
  line: "#e2e8f0",
  soft: "#f1f5f9",
  indigo: "#4f46e5",
  violet: "#7c3aed",
  cyan: "#06b6d4",
  warn: "#b45309",
  warnBg: "#fef3c7",
  white: "#ffffff",
};

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round((((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t));
  return PDFLib.rgb(ch(16) / 255, ch(8) / 255, ch(0) / 255);
};
const shade = (h, t) => {
  const n = parseInt(h.slice(1), 16), d = 0x0f172a;
  const ch = (sh) => Math.round(((n >> sh) & 255) * (1 - t) + ((d >> sh) & 255) * t);
  return "#" + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join("");
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const tick = () => new Promise((r) => setTimeout(r, 0));
const pad2 = (n) => String(n).padStart(2, "0");

/**
 * @param {object} cfg
 *  - profile: { nome, resumo, rows: [[rótulo, valor]], photo: bytes PNG/JPG ou null }
 *  - title, subtitle, includeResumo
 *  - sections: [{ name, color, items: [{ ano, tipo, title, meta, qualis, path }] }]
 *  - firstPageOnly: anexa só a 1ª página de cada comprovante
 *  - qr: adiciona no fim uma seção com QR codes dos itens que têm link (`item.url`); qrCols: colunas da grade
 *  - version, onProgress({ done, total, label })
 * @returns {Promise<{ bytes: Uint8Array, pages: number, attached: number, failed: string[] }>}
 */
export async function buildReport(cfg) {
  const { PDFDocument, StandardFonts, degrees } = PDFLib;
  const doc = await PDFDocument.create();
  const now = new Date();
  const today = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`;

  // ---------- fontes ----------
  const F = await loadFonts(doc, StandardFonts);
  const safe = makeSanitizer(F);

  // ---------- helpers de desenho ----------
  const text = (page, s, x, y, { font = F.reg, size = 10, color = C.text, opacity } = {}) =>
    page.drawText(safe(s, font), { x, y, font, size, color: hex(color), opacity });
  const width = (s, font, size) => font.widthOfTextAtSize(safe(s, font), size);
  const wrap = (s, font, size, maxW) => wrapText(safe(String(s || ""), font), font, size, maxW);
  const ellipsize = (s, font, size, maxW) => {
    s = safe(String(s || ""), font);
    if (font.widthOfTextAtSize(s, size) <= maxW) return s;
    while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > maxW) s = s.slice(0, -1);
    return s.trimEnd() + "…";
  };
  const rrect = (page, x, yTop, w, h, r, opts) => {
    r = Math.min(r, w / 2, h / 2);
    page.drawSvgPath(
      `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`,
      { x, y: yTop, ...opts }
    );
  };
  const gradient = (page, x, y, w, h, from, to, steps = 90) => {
    const sw = w / steps;
    for (let i = 0; i < steps; i++) page.drawRectangle({ x: x + i * sw, y, width: sw + 0.6, height: h, color: mix(from, to, i / (steps - 1)) });
  };

  // ---------- navegação: links internos e marcadores ----------
  const ctx = doc.context;
  const { PDFName, PDFArray, PDFHexString, PDFString } = PDFLib;
  const destOf = (num) => {
    const t = doc.getPage(Math.max(1, Math.min(num, doc.getPageCount())) - 1);
    return [t.ref, "XYZ", null, t.getHeight(), null];
  };
  const pushAnnot = (page, dict) => {
    const ref = ctx.register(ctx.obj(dict));
    const key = PDFName.of("Annots");
    let arr = page.node.lookupMaybe(key, PDFArray);
    if (!arr) {
      arr = ctx.obj([]);
      page.node.set(key, arr);
    }
    arr.push(ref);
  };
  /** Área clicável [x1,y1,x2,y2] em `page` que leva à página `num` (1-based). */
  const addLink = (page, rect, num) => {
    if (num) pushAnnot(page, { Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0], Dest: destOf(num) });
  };
  /** Área clicável que abre um endereço externo. */
  const addUri = (page, rect, url) =>
    pushAnnot(page, { Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } });
  const chipLinks = []; // chips da capa -> seção (destino conhecido só no fim)

  let logo = null;
  try {
    logo = await doc.embedPng(new Uint8Array(await (await fetch("img/logo.png")).arrayBuffer()));
  } catch { }

  let photo = null;
  if (cfg.profile.photo) {
    try {
      photo = await doc.embedJpg(await preparePhoto(cfg.profile.photo));
    } catch { }
  }

  const sections = cfg.sections.filter((s) => s.items.length);
  for (const s of sections) {
    const t = {};
    for (const it of s.items) t[it.tipo || "Sem tipo"] = (t[it.tipo || "Sem tipo"] || 0) + 1;
    // ordem de aparição na lista (por atividade, como no Lattes)
    s.tipos = Object.entries(t);
  }
  sections.forEach((s, i) => (s.num = i + 1));
  // QR codes: só seções com pelo menos um item que tenha link
  const qrSections = cfg.qr && window.qrcode ? sections.filter((s) => (s.links = s.items.filter((i) => i.url)).length) : [];
  const totalItems = sections.reduce((a, s) => a + s.items.length, 0);
  const totalFiles = sections.reduce((a, s) => a + s.items.filter((i) => i.path).length, 0);
  let done = 0;
  const progress = (label) => cfg.onProgress && cfg.onProgress({ done, total: Math.max(1, totalFiles), label });

  // =====================================================================
  // 1. CAPA
  // =====================================================================
  {
    const p = doc.addPage(A4);
    const [W, H] = A4;
    const bandH = 400;
    gradient(p, 0, H - bandH, W, bandH, C.indigo, C.cyan);
    // formas decorativas
    p.drawCircle({ x: W - 40, y: H - 60, size: 170, color: hex(C.white), opacity: 0.07 });
    p.drawCircle({ x: W - 120, y: H - 300, size: 90, color: hex(C.white), opacity: 0.06 });
    p.drawCircle({ x: 40, y: H - bandH + 140, size: 125, color: hex(C.violet), opacity: 0.22 });
    for (let i = 0; i < 9; i++) p.drawLine({ start: { x: W - 260 + i * 26, y: H - bandH }, end: { x: W + i * 26, y: H - bandH + 260 }, thickness: 0.6, color: hex(C.white), opacity: 0.08 });

    if (logo) {
      // logo com fundo transparente direto sobre a faixa da capa
      const d = logo.scaleToFit(64, 64);
      p.drawImage(logo, { x: M + (64 - d.width) / 2, y: H - 70 - 64 + (64 - d.height) / 2, width: d.width, height: d.height });
    }
    text(p, "LATTES MANAGER", M + 78, H - 98, { font: F.bold, size: 9, color: C.white, opacity: 0.85 });
    text(p, `Relatório de comprovantes · ${today}`, M + 78, H - 112, { size: 9, color: C.white, opacity: 0.75 });

    // foto 3×4 em moldura branca, à direita da faixa; o texto ocupa o espaço que sobra
    const PH_W = 132, PH_H = PH_W / PHOTO_ASPECT, PH_PAD = 5;
    let textW = W - 2 * M;
    if (photo) {
      const fx = W - M - PH_W, fTop = H - 150;
      rrect(p, fx + 3, fTop - 5, PH_W, PH_H, 12, { color: hex(C.ink), opacity: 0.22 });
      rrect(p, fx, fTop, PH_W, PH_H, 12, { color: hex(C.white) });
      p.drawImage(photo, { x: fx + PH_PAD, y: fTop - PH_H + PH_PAD, width: PH_W - 2 * PH_PAD, height: PH_H - 2 * PH_PAD });
      textW -= PH_W + 28;
    }

    let y = H - 210;
    text(p, "COMPROVANTES", M, y + 34, { font: F.bold, size: 11, color: C.white, opacity: 0.8 });
    const titleSize = photo ? 26 : 30;
    for (const line of wrap(cfg.title || "Comprovantes do Currículo Lattes", F.bold, titleSize, textW).slice(0, 3)) {
      text(p, line, M, y, { font: F.bold, size: titleSize, color: C.white });
      y -= titleSize + 6;
    }
    y -= 10;
    const nameLines = wrap(cfg.profile.nome || "", F.semi, 18, textW).slice(0, 2);
    nameLines.forEach((line, i) => text(p, line, M, y - i * 22, { font: F.semi, size: 18, color: C.white }));
    y -= Math.max(0, nameLines.length - 1) * 22;
    if (cfg.subtitle) text(p, ellipsize(cfg.subtitle, F.reg, 11, textW), M, y - 22, { size: 11, color: C.white, opacity: 0.85 });

    // cartão de identificação
    const totalWithoutFile = totalItems - totalFiles;
    const contentLabel = totalWithoutFile > 0
      ? `${plural(totalItems, "documento", "documentos")} · ${totalWithoutFile} sem comprovante`
      : plural(totalItems, "documento", "documentos");
    const rows = [
      ...(cfg.profile.rows || []),
      ["Período", cfg.periodLabel],
      ["Conteúdo", contentLabel],
    ].filter((r) => r[1]);
    // muitos campos: duas colunas (valores longos ocupam a linha toda)
    const fullW = W - 2 * M - 44;
    const colW = (fullW - 18) / 2;
    const twoCol = rows.length > 6;
    const fs = twoCol ? 10.5 : 11;
    const cells = [];
    let col = 0, line = 0;
    for (const [k, v] of rows) {
      const wide = !twoCol || width(v, F.reg, fs) > colW;
      if (wide && col === 1) { col = 0; line++; }
      cells.push({ k, v, x: M + 22 + (wide ? 0 : col * (colW + 18)), line, w: wide ? fullW : colW });
      if (wide || col === 1) { col = 0; line++; } else col = 1;
    }
    const nLines = col === 1 ? line + 1 : line;
    const rowH = twoCol ? 27 : 30;
    const cardTop = H - bandH - 36;
    const cardH = 26 + nLines * rowH;
    rrect(p, M, cardTop, W - 2 * M, cardH, 14, { color: hex(C.white), borderColor: hex(C.line), borderWidth: 1 });
    p.drawRectangle({ x: M, y: cardTop - cardH + 14, width: 4, height: cardH - 28, color: hex(C.indigo) });
    for (const c of cells) {
      const ry = cardTop - 32 - c.line * rowH;
      text(p, c.k.toUpperCase(), c.x, ry + 10, { font: F.semi, size: 7.5, color: C.faint });
      text(p, ellipsize(c.v, F.reg, fs, c.w), c.x, ry - 3, { size: fs, color: C.ink });
    }

    // chips das seções
    let cx = M, cy = cardTop - cardH - 30;
    text(p, "SEÇÕES INCLUÍDAS", M, cy + 8, { font: F.semi, size: 7.5, color: C.faint });
    cy -= 12;
    for (const s of sections) {
      const label = `${s.name}  ${s.items.length}`;
      const w = width(label, F.semi, 9) + 22;
      if (cx + w > W - M) { cx = M; cy -= 26; }
      if (cy < FOOT_H + 30) break;
      rrect(p, cx, cy, w, 20, 10, { color: hex(s.color), opacity: 0.12 });
      p.drawCircle({ x: cx + 9, y: cy - 10, size: 3, color: hex(s.color) });
      text(p, label, cx + 16, cy - 13.5, { font: F.semi, size: 9, color: C.ink });
      chipLinks.push({ page: p, rect: [cx, cy - 20, cx + w, cy], s });
      cx += w + 8;
    }
  }

  // =====================================================================
  // 2. RESUMO DO CV
  // =====================================================================
  let resumoPage = null;
  if (cfg.includeResumo && cfg.profile.resumo) {
    let p = doc.addPage(A4);
    resumoPage = doc.getPageCount();
    let y = pageHeader(p, "Resumo do currículo", "Texto informado pelo autor na Plataforma Lattes");
    for (const para of cfg.profile.resumo.split(/\n+/)) {
      for (const line of wrap(para, F.reg, 11, A4[0] - 2 * M)) {
        if (y < FOOT_H + 40) { p = doc.addPage(A4); y = A4[1] - 70; }
        text(p, line, M, y, { size: 11, color: C.text });
        y -= 17;
      }
      y -= 8;
    }
  }

  // =====================================================================
  // 3. SUMÁRIO (preenchido no final, quando as páginas são conhecidas)
  // =====================================================================
  const tocLines = sections.reduce((a, s) => a + 1 + s.tipos.length, 0) + (qrSections.length ? 1 + qrSections.length : 0);
  const tocPerPage = 34;
  const tocPages = [];
  const tocStart = doc.getPageCount() + 1;
  for (let i = 0; i < Math.max(1, Math.ceil(tocLines / tocPerPage)); i++) tocPages.push(doc.addPage(A4));

  // =====================================================================
  // 4. SEÇÕES: lista numerada + anexos
  // =====================================================================
  const failed = [];
  const refs = []; // marcações de página a desenhar no fim: { page, x, y, item }
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si];
    const num = si + 1;
    s.startPage = doc.getPageCount() + 1;

    // ----- página de lista -----
    let p = doc.addPage(A4);
    const [W, H] = A4;
    gradient(p, 0, H - 150, W, 150, s.color, shade(s.color, 0.55), 60);
    p.drawCircle({ x: W - 70, y: H - 40, size: 110, color: hex(C.white), opacity: 0.08 });
    text(p, pad2(num), M, H - 92, { font: F.bold, size: 54, color: C.white, opacity: 0.9 });
    const nx = M + width(pad2(num), F.bold, 54) + 18;
    text(p, `SEÇÃO ${num}`, nx, H - 62, { font: F.semi, size: 9, color: C.white, opacity: 0.8 });
    text(p, ellipsize(s.name, F.bold, 24, W - nx - M), nx, H - 90, { font: F.bold, size: 24, color: C.white });
    const withFile = s.items.filter((i) => i.path).length;
    const withoutFile = s.items.length - withFile;
    const countSummary = withoutFile > 0
      ? `${plural(s.items.length, "documento", "documentos")} · ${withoutFile} sem comprovante`
      : plural(s.items.length, "documento", "documentos");
    text(p, countSummary, nx, H - 110, { size: 10, color: C.white, opacity: 0.85 });

    let y = H - 180;
    const colX = M + 46;
    const statusW = 74;
    const colW = W - colX - M - statusW - 8;
    let lastTipo = null;
    s.items.forEach((it, ii) => {
      it.num = `${num}.${ii + 1}`;
      // cabeçalho da atividade (Artigos completos, Resumos…) quando a lista é por atividade
      const tipo = it.tipo || "Sem tipo";
      if (s.grouped && tipo !== lastTipo) {
        const n = s.tipos.find(([t]) => t === tipo)?.[1] || 0;
        if (y - 70 < FOOT_H + 24) {
          p = doc.addPage(A4);
          text(p, `${num}. ${s.name}`, M, H - 50, { font: F.bold, size: 11, color: C.ink });
          text(p, "continuação", M + width(`${num}. ${s.name}`, F.bold, 11) + 8, H - 50, { size: 9, color: C.faint });
          p.drawRectangle({ x: M, y: H - 60, width: 40, height: 2, color: hex(s.color) });
          y = H - 82;
        }
        if (lastTipo !== null) y -= 6;
        rrect(p, M, y + 4, W - 2 * M, 22, 6, { color: hex(s.color), opacity: 0.1 });
        p.drawRectangle({ x: M, y: y - 18, width: 3, height: 22, color: hex(s.color) });
        text(p, ellipsize(tipo, F.bold, 10.5, W - 2 * M - 120), M + 12, y - 11, { font: F.bold, size: 10.5, color: C.ink });
        const cnt = plural(n, "documento", "documentos");
        text(p, cnt, W - M - 10 - width(cnt, F.semi, 8.5), y - 10.5, { font: F.semi, size: 8.5, color: C.muted });
        it.tipoPage = doc.getPageCount();
        y -= 32;
        lastTipo = tipo;
      }
      let titleLines = wrap(it.title || "(sem título)", F.semi, 10, colW);
      if (titleLines.length > 4) titleLines = [...titleLines.slice(0, 3), ellipsize(titleLines.slice(3).join(" "), F.semi, 10, colW)];
      const metaLines = wrap(it.meta, F.reg, 8.5, colW).slice(0, 2);
      const rowH = titleLines.length * 13 + metaLines.length * 11 + 14;
      if (y - rowH < FOOT_H + 24) {
        p = doc.addPage(A4);
        text(p, `${num}. ${s.name}`, M, H - 50, { font: F.bold, size: 11, color: C.ink });
        const cont = s.grouped ? `continuação · ${tipo}` : "continuação";
        text(p, ellipsize(cont, F.reg, 9, W - 2 * M - width(`${num}. ${s.name}`, F.bold, 11) - 8), M + width(`${num}. ${s.name}`, F.bold, 11) + 8, H - 50, { size: 9, color: C.faint });
        p.drawRectangle({ x: M, y: H - 60, width: 40, height: 2, color: hex(s.color) });
        y = H - 82;
      }
      // número
      const nw = Math.max(34, width(it.num, F.bold, 8.5) + 12);
      rrect(p, M, y + 2, nw, 16, 8, { color: hex(s.color), opacity: 0.14 });
      text(p, it.num, M + (nw - width(it.num, F.bold, 8.5)) / 2, y - 9.5, { font: F.bold, size: 8.5, color: C.ink });
      // título + meta
      let ty = y - 9;
      for (const l of titleLines) { text(p, l, colX, ty, { font: F.semi, size: 10, color: C.ink }); ty -= 13; }
      for (const l of metaLines) { text(p, l, colX, ty + 1, { size: 8.5, color: C.muted }); ty -= 11; }
      it.listPage = doc.getPageCount();
      refs.push({ page: p, x: W - M, y: y - 9.5, item: it, rowTop: y + 4, rowBottom: y - rowH + 6 });
      y -= rowH;
      const nextTipo = s.items[ii + 1] && (s.items[ii + 1].tipo || "Sem tipo");
      if (ii < s.items.length - 1 && !(s.grouped && nextTipo !== tipo)) p.drawLine({ start: { x: colX, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.5, color: hex(C.line) });
    });

    // ----- anexos -----
    for (const it of s.items) {
      if (!it.path) continue;
      progress(`${it.num} · ${it.title || ""}`);
      it.page = doc.getPageCount() + 1;
      try {
        const bytes = await api.readFileBytes(it.path);
        const ext = it.path.split(".").pop().toLowerCase();
        if (ext === "pdf") {
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
          if (src.isEncrypted) throw new Error("PDF protegido por senha/criptografia");
          const srcPages = src.getPages();
          // Links/anotações apontam para outras páginas e criam cadeias enormes de
          // referências (estouro de pilha no copiador do pdf-lib). Uma página embutida
          // não preserva links de qualquer forma, então removemos esses vínculos.
          for (const sp of srcPages) {
            for (const k of ["Annots", "B", "PieceInfo", "Thumb", "StructParents", "Metadata"]) sp.node.delete(PDFLib.PDFName.of(k));
          }
          const total = srcPages.length;
          const use = cfg.firstPageOnly ? srcPages.slice(0, 1) : srcPages;
          let embedded = null;
          try {
            embedded = await doc.embedPages(use);
          } catch (e) {
            // alguns PDFs estouram a pilha no lote; página a página costuma funcionar
            console.warn(`embedPages em lote falhou para ${it.path}, tentando página a página:`, e);
            try {
              embedded = [];
              for (const sp of use) embedded.push(await doc.embedPage(sp));
            } catch (e2) {
              console.warn(`embedPage falhou para ${it.path}, usando copyPages:`, e2);
              embedded = null;
            }
          }
          if (embedded) {
            embedded.forEach((ep, k) => addAttachmentPage(ep, use[k].getRotation().angle, it, s, k + 1, total));
          } else {
            // Alternativa: copia as páginas originais e carimba por cima (sem reduzir)
            const copied = await doc.copyPages(src, cfg.firstPageOnly ? [0] : src.getPageIndices());
            copied.forEach((cp, k) => {
              doc.addPage(cp);
              stamp(cp, it, s, k + 1, total);
            });
          }
        } else if (["png", "jpg", "jpeg"].includes(ext)) {
          const img = ext === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
          addAttachmentPage(img, 0, it, s, 1, 1, true);
        } else {
          throw new Error(`formato .${ext} não suportado`);
        }
      } catch (err) {
        const msg = String(err?.message || err);
        failed.push(`${it.num} — ${it.path}: ${msg}`);
        if (/não encontrado/i.test(msg)) {
          // arquivo registrado mas apagado/renomeado no disco: só marca na lista
          it.absent = true;
          done++;
          continue;
        }
        it.missing = true;
        it.page = doc.getPageCount() + 1;
        const p2 = doc.addPage(A4);
        stamp(p2, it, s, 1, 1);
        rrect(p2, M, A4[1] / 2 + 60, A4[0] - 2 * M, 120, 16, { color: hex(C.warnBg) });
        text(p2, "Comprovante não pôde ser incorporado", M + 24, A4[1] / 2 + 20, { font: F.bold, size: 14, color: C.warn });
        text(p2, ellipsize(it.path, F.reg, 9, A4[0] - 2 * M - 48), M + 24, A4[1] / 2 - 2, { size: 9, color: C.text });
        text(p2, ellipsize(String(err.message || err), F.reg, 9, A4[0] - 2 * M - 48), M + 24, A4[1] / 2 - 18, { size: 9, color: C.muted });
      }
      done++;
      await tick();
    }
  }

  // =====================================================================
  // 4b. QR CODES dos itens com link (opcional, no fim do documento)
  // =====================================================================
  let qrStart = null;
  if (qrSections.length) {
    progress("Gerando QR codes…");
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    const [W, H] = A4;
    const cols = Math.max(2, Math.min(6, Number(cfg.qrCols) || 4));
    const gap = cols >= 5 ? 10 : 14;
    const cardW = (W - 2 * M - gap * (cols - 1)) / cols;
    const pad = cols >= 5 ? 8 : 11;
    const qrSize = cardW - 2 * pad;
    const tSize = cols >= 5 ? 6.8 : cols === 4 ? 7.4 : 8.2;
    const lineH = tSize + 2.4;
    const cardH = pad + qrSize + 6 + 15 + 3 * lineH + 4 + 9 + pad;
    const nLinks = qrSections.reduce((a, s) => a + s.links.length, 0);

    const contHeader = (sec) => {
      p = doc.addPage(A4);
      text(p, `QR codes · ${sec.num}. ${sec.name}`, M, H - 50, { font: F.bold, size: 11, color: C.ink });
      text(p, "continuação", M + width(`QR codes · ${sec.num}. ${sec.name}`, F.bold, 11) + 8, H - 50, { size: 9, color: C.faint });
      p.drawRectangle({ x: M, y: H - 60, width: 40, height: 2, color: hex(sec.color) });
      y = H - 80;
    };

    let p = doc.addPage(A4);
    qrStart = doc.getPageCount();
    let y = pageHeader(p, "QR codes dos links", `${plural(nLinks, "item com link", "itens com link")} · aponte a câmera do celular ou clique no cartão para abrir`);

    for (const sec of qrSections) {
      // cabeçalho da seção só se couber junto com a primeira linha de cartões
      if (y - 40 - cardH < FOOT_H + 16) {
        p = doc.addPage(A4);
        y = H - 60;
      }
      sec.qrPage = doc.getPageCount();
      rrect(p, M, y + 4, W - 2 * M, 24, 6, { color: hex(sec.color), opacity: 0.1 });
      p.drawRectangle({ x: M, y: y - 20, width: 3, height: 24, color: hex(sec.color) });
      const head = `${sec.num}. ${sec.name}`;
      text(p, ellipsize(head, F.bold, 11, W - 2 * M - 120), M + 12, y - 12, { font: F.bold, size: 11, color: C.ink });
      addLink(p, [M, y - 20, M + 12 + width(head, F.bold, 11), y + 4], sec.startPage);
      const cnt = plural(sec.links.length, "link", "links");
      text(p, cnt, W - M - 10 - width(cnt, F.semi, 8.5), y - 11.5, { font: F.semi, size: 8.5, color: C.muted });
      y -= 38;
      sec.links.forEach((it, i) => {
        const col = i % cols;
        if (col === 0 && i > 0) {
          y -= cardH + gap;
          if (y - cardH < FOOT_H + 16) contHeader(sec);
        }
        qrCard(p, M + col * (cardW + gap), y, it, sec);
      });
      y -= cardH + 30;
      await tick();
    }

    function qrCard(pg, x, top, it, sec) {
      rrect(pg, x, top, cardW, cardH, 10, { color: hex(C.white), borderColor: hex(C.line), borderWidth: 0.8 });
      drawQr(pg, it.url, x + pad, top - pad, qrSize);
      // número do item (cor da seção) e ano
      let ty = top - pad - qrSize - 6;
      const nw = width(it.num, F.bold, 7.5) + 12;
      rrect(pg, x + pad, ty, nw, 13, 6.5, { color: hex(sec.color), opacity: 0.16 });
      text(pg, it.num, x + pad + 6, ty - 9.4, { font: F.bold, size: 7.5, color: C.ink });
      if (it.ano) text(pg, String(it.ano), x + pad + nw + 6, ty - 9.4, { size: 7.5, color: C.muted });
      ty -= 15 + tSize;
      const tw = cardW - 2 * pad;
      let lines = wrap(it.title || "(sem título)", F.semi, tSize, tw);
      if (lines.length > 3) lines = [...lines.slice(0, 2), ellipsize(lines.slice(2).join(" "), F.semi, tSize, tw)];
      for (const l of lines) {
        text(pg, l, x + pad, ty, { font: F.semi, size: tSize, color: C.ink });
        ty -= lineH;
      }
      text(pg, ellipsize(shortUrl(it.url), F.reg, 6.3, tw), x + pad, top - cardH + pad, { size: 6.3, color: C.indigo });
      addUri(pg, [x, top - cardH, x + cardW, top], it.url);
    }

    /** QR em vetor: cada sequência de módulos escuros de uma linha vira um retângulo. */
    function drawQr(pg, url, x, top, size) {
      let q;
      try {
        q = qrcode(0, "M");
        q.addData(url, "Byte");
        q.make();
      } catch {
        return;
      }
      const n = q.getModuleCount();
      const cell = size / (n + 4); // 2 módulos de margem branca em cada lado
      let d = "";
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n;) {
          if (!q.isDark(r, c)) {
            c++;
            continue;
          }
          let e = c;
          while (e < n && q.isDark(r, e)) e++;
          // leve sobreposição entre linhas evita frestas claras em alguns leitores de PDF
          d += `M${c} ${r}H${e}V${r + 1.04}H${c}Z`;
          c = e;
        }
      }
      pg.drawSvgPath(d, { x: x + 2 * cell, y: top - 2 * cell, scale: cell, color: hex(C.ink) });
    }
  }

  function addAttachmentPage(embedded, rotation, it, s, k, n, isImage = false) {
    const w0 = embedded.width, h0 = embedded.height;
    const rot = ((rotation % 360) + 360) % 360;
    const dw0 = rot % 180 ? h0 : w0, dh0 = rot % 180 ? w0 : h0;
    const size = dw0 > dh0 ? [A4[1], A4[0]] : A4;
    const p = doc.addPage(size);
    const box = { x: 16, y: FOOT_H, w: size[0] - 32, h: size[1] - FOOT_H - STAMP_H - 6 };
    const sc = Math.min(box.w / dw0, box.h / dh0);
    const dw = dw0 * sc, dh = dh0 * sc;
    const ox = box.x + (box.w - dw) / 2, oy = box.y + (box.h - dh) / 2;
    // sombra/borda sutil
    p.drawRectangle({ x: ox, y: oy, width: dw, height: dh, borderColor: hex(C.line), borderWidth: 0.6 });
    if (isImage) {
      p.drawImage(embedded, { x: ox, y: oy, width: dw, height: dh });
    } else {
      const pos = { 0: [ox, oy], 90: [ox, oy + dh], 180: [ox + dw, oy + dh], 270: [ox + dw, oy] }[rot] || [ox, oy];
      p.drawPage(embedded, { x: pos[0], y: pos[1], xScale: sc, yScale: sc, rotate: degrees(-rot) });
    }
    stamp(p, it, s, k, n);
  }

  function stamp(p, it, s, k, n) {
    const { width: W, height: H } = p.getSize();
    p.drawRectangle({ x: 0, y: H - STAMP_H, width: W, height: STAMP_H, color: hex(C.soft) });
    p.drawRectangle({ x: 0, y: H - STAMP_H, width: 4, height: STAMP_H, color: hex(s.color) });
    const tag = `Item ${it.num}`;
    const tw = width(tag, F.bold, 8.5) + 14;
    rrect(p, 14, H - 7, tw, 16, 8, { color: hex(s.color) });
    text(p, tag, 21, H - 18.5, { font: F.bold, size: 8.5, color: C.white });
    addLink(p, [14, H - 23, 14 + tw, H - 7], it.listPage);
    const pg = n > 1 ? (cfg.firstPageOnly ? `  ·  1ª pág. de ${n}` : `  ·  pág. ${k}/${n}`) : "";
    const head = [s.name, it.tipo, it.ano].filter(Boolean).join(" · ");
    const right = `${head}${pg}`;
    const rw = width(right, F.reg, 8);
    text(p, right, W - 16 - rw, H - 18.5, { size: 8, color: C.muted });
    text(p, ellipsize(it.title || "", F.semi, 8.5, W - 16 - rw - (14 + tw + 10) - 12), 14 + tw + 10, H - 18.5, { font: F.semi, size: 8.5, color: C.ink });
  }

  function pageHeader(p, title, sub) {
    const [W, H] = A4;
    text(p, title, M, H - 76, { font: F.bold, size: 22, color: C.ink });
    if (sub) text(p, sub, M, H - 94, { size: 10, color: C.muted });
    gradient(p, M, H - 108, 80, 3, C.indigo, C.cyan, 20);
    return H - 136;
  }

  // =====================================================================
  // 5. Referências de página na lista + sumário
  // =====================================================================
  for (const r of refs) {
    const it = r.item;
    let label, fg, bg;
    if (!it.path) { label = "sem comprovante"; fg = C.warn; bg = C.warnBg; }
    else if (it.absent) { label = "arquivo ausente"; fg = "#b91c1c"; bg = "#fee2e2"; }
    else if (it.missing) { label = `falhou · p. ${it.page}`; fg = C.warn; bg = C.warnBg; }
    else { label = `p. ${it.page}`; fg = C.indigo; bg = "#eef2ff"; }
    const w = width(label, F.semi, 7.5) + 12;
    rrect(r.page, r.x - w, r.y + 11.5, w, 15, 7.5, { color: hex(bg) });
    text(r.page, label, r.x - w + 6, r.y + 0.5, { font: F.semi, size: 7.5, color: fg });
    if (it.page && !it.absent) addLink(r.page, [M - 4, r.rowBottom, r.x + 4, r.rowTop], it.page);
  }
  for (const c of chipLinks) addLink(c.page, c.rect, c.s.startPage);

  {
    let ti = 0;
    let p = tocPages[0];
    const totalWithoutFile = totalItems - totalFiles;
    const tocSub = totalWithoutFile > 0
      ? `${sections.length} seções · ${plural(totalItems, "documento", "documentos")} · ${totalWithoutFile} sem comprovante · clique para navegar`
      : `${sections.length} seções · ${plural(totalItems, "documento", "documentos")} · clique para navegar`;
    let y = pageHeader(p, "Sumário", tocSub);
    const [W] = A4;
    const line = (fn) => {
      if (y < FOOT_H + 40) { p = tocPages[++ti] || p; y = A4[1] - 70; }
      fn(p, y);
    };
    sections.forEach((s, si) => {
      line((pg, yy) => {
        rrect(pg, M, yy + 13, 26, 18, 6, { color: hex(s.color) });
        text(pg, pad2(si + 1), M + 13 - width(pad2(si + 1), F.bold, 9) / 2, yy - 0.5, { font: F.bold, size: 9, color: C.white });
        text(pg, s.name, M + 38, yy, { font: F.bold, size: 12, color: C.ink });
        const right = `${plural(s.items.length, "documento", "documentos")}    p. ${s.startPage}`;
        const rw = width(right, F.semi, 10);
        const lx = M + 38 + width(s.name, F.bold, 12) + 8;
        pg.drawLine({ start: { x: lx, y: yy + 3 }, end: { x: W - M - rw - 8, y: yy + 3 }, thickness: 0.7, color: hex(C.line), dashArray: [1.5, 3] });
        text(pg, right, W - M - rw, yy, { font: F.semi, size: 10, color: C.text });
        addLink(pg, [M, yy - 6, W - M, yy + 14], s.startPage);
      });
      y -= 22;
      for (const [tipo, n] of s.tipos) {
        line((pg, yy) => {
          text(pg, ellipsize(tipo, F.reg, 10, W - 2 * M - 120), M + 38, yy, { size: 10, color: C.muted });
          const t = `${n}`;
          text(pg, t, W - M - width(`p. ${s.startPage}`, F.semi, 10) - 22 - width(t, F.reg, 10), yy, { size: 10, color: C.muted });
          const first = s.items.find((i) => (i.tipo || "Sem tipo") === tipo);
          addLink(pg, [M + 34, yy - 4, W - M, yy + 11], first?.tipoPage || first?.listPage || s.startPage);
        });
        y -= 16;
      }
      y -= 10;
    });
    if (qrStart) {
      line((pg, yy) => {
        rrect(pg, M, yy + 13, 26, 18, 6, { color: hex(C.ink) });
        text(pg, "QR", M + 13 - width("QR", F.bold, 9) / 2, yy - 0.5, { font: F.bold, size: 9, color: C.white });
        text(pg, "QR codes dos links", M + 38, yy, { font: F.bold, size: 12, color: C.ink });
        const right = `${plural(qrSections.reduce((a, s) => a + s.links.length, 0), "link", "links")}    p. ${qrStart}`;
        const rw = width(right, F.semi, 10);
        const lx = M + 38 + width("QR codes dos links", F.bold, 12) + 8;
        pg.drawLine({ start: { x: lx, y: yy + 3 }, end: { x: W - M - rw - 8, y: yy + 3 }, thickness: 0.7, color: hex(C.line), dashArray: [1.5, 3] });
        text(pg, right, W - M - rw, yy, { font: F.semi, size: 10, color: C.text });
        addLink(pg, [M, yy - 6, W - M, yy + 14], qrStart);
      });
      y -= 22;
      for (const s of qrSections) {
        line((pg, yy) => {
          text(pg, ellipsize(`${s.num}. ${s.name}`, F.reg, 10, W - 2 * M - 120), M + 38, yy, { size: 10, color: C.muted });
          const t = `${s.links.length}`;
          text(pg, t, W - M - width(`p. ${qrStart}`, F.semi, 10) - 22 - width(t, F.reg, 10), yy, { size: 10, color: C.muted });
          addLink(pg, [M + 34, yy - 4, W - M, yy + 11], s.qrPage);
        });
        y -= 16;
      }
    }
  }

  // =====================================================================
  // 6. Rodapé em todas as páginas
  // =====================================================================
  const pages = doc.getPages();
  const sign = `Gerado com Lattes Manager v${cfg.version} · ${today}`;
  pages.forEach((p, i) => {
    const { width: W } = p.getSize();
    p.drawLine({ start: { x: 16, y: FOOT_H - 8 }, end: { x: W - 16, y: FOOT_H - 8 }, thickness: 0.5, color: hex(C.line) });
    if (logo) {
      const d = logo.scaleToFit(10, 10);
      p.drawImage(logo, { x: 16, y: 13, width: d.width, height: d.height });
    }
    text(p, sign, 30, 15, { size: 7.5, color: C.muted });
    const nm = ellipsize(cfg.profile.nome || "", F.reg, 7.5, 200);
    text(p, nm, W / 2 - width(nm, F.reg, 7.5) / 2, 15, { size: 7.5, color: C.faint });
    const pg = `Página ${i + 1} de ${pages.length}`;
    const pw = width(pg, F.semi, 7.5);
    text(p, pg, W - 16 - pw, 15, { font: F.semi, size: 7.5, color: C.text });
    if (i + 1 !== tocStart) {
      const sx = W - 16 - pw - 14 - width("Sumário", F.semi, 7.5);
      text(p, "Sumário", sx, 15, { font: F.semi, size: 7.5, color: C.indigo });
      text(p, "|", W - 16 - pw - 8, 15, { size: 7.5, color: C.faint });
      addLink(p, [sx - 2, 10, sx + width("Sumário", F.semi, 7.5) + 2, 25], tocStart);
    }
  });

  // marcadores (painel lateral do leitor de PDF)
  const outline = [{ title: "Capa", page: 1 }];
  if (resumoPage) outline.push({ title: "Resumo do currículo", page: resumoPage });
  outline.push({ title: "Sumário", page: tocStart });
  const itemMark = (it) => ({
    title: `${it.num}  ${(it.title || "").slice(0, 90)}${it.path ? "" : "  [sem comprovante]"}`,
    page: it.page && !it.absent ? it.page : it.listPage,
  });
  sections.forEach((s, si) =>
    outline.push({
      title: `${si + 1}. ${s.name} (${s.items.length})`,
      page: s.startPage,
      children: s.grouped && s.tipos.length > 1
        ? s.tipos.map(([tipo, n]) => {
          const its = s.items.filter((i) => (i.tipo || "Sem tipo") === tipo);
          return { title: `${tipo} (${n})`, page: its[0]?.tipoPage || its[0]?.listPage || s.startPage, children: its.map(itemMark) };
        })
        : s.items.map(itemMark),
    })
  );
  if (qrStart)
    outline.push({
      title: "QR codes dos links",
      page: qrStart,
      children: qrSections.map((s) => ({ title: `${s.num}. ${s.name} (${s.links.length})`, page: s.qrPage })),
    });
  buildOutline(outline);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));

  function buildOutline(entries) {
    const rootRef = ctx.nextRef();
    const level = (list, parentRef) => {
      const refs = list.map(() => ctx.nextRef());
      list.forEach((e, i) => {
        const d = ctx.obj({ Title: PDFHexString.fromText(e.title), Parent: parentRef, Dest: destOf(e.page) });
        if (i > 0) d.set(PDFName.of("Prev"), refs[i - 1]);
        if (i < list.length - 1) d.set(PDFName.of("Next"), refs[i + 1]);
        if (e.children && e.children.length) {
          const [f, l, n] = level(e.children, refs[i]);
          d.set(PDFName.of("First"), f);
          d.set(PDFName.of("Last"), l);
          d.set(PDFName.of("Count"), ctx.obj(-n)); // fechado por padrão
        }
        ctx.assign(refs[i], d);
      });
      return [refs[0], refs[refs.length - 1], list.length];
    };
    const [f, l, n] = level(entries, rootRef);
    ctx.assign(rootRef, ctx.obj({ Type: "Outlines", First: f, Last: l, Count: n }));
    doc.catalog.set(PDFName.of("Outlines"), rootRef);
  }

  doc.setTitle(cfg.title || "Comprovantes Lattes");
  doc.setAuthor(cfg.profile.nome || "");
  doc.setSubject(cfg.subtitle || "Comprovantes do Currículo Lattes");
  doc.setCreator(`Lattes Manager v${cfg.version}`);
  doc.setProducer(`Lattes Manager v${cfg.version} (pdf-lib)`);
  doc.setCreationDate(now);

  cfg.onProgress && cfg.onProgress({ done: totalFiles, total: Math.max(1, totalFiles), label: "Finalizando PDF…" });
  await tick();
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pages: pages.length, attached: totalFiles - failed.length, failed };
}

/** Endereço curto para o rodapé do cartão: sem protocolo; DOIs como "doi:10.…". */
function shortUrl(url) {
  return url.replace(/^https?:\/\//i, "").replace(/^(dx\.)?doi\.org\//i, "doi:").replace(/\/$/, "");
}

/** Foto recortada em 3×4 (mesmo enquadramento da prévia) e reduzida a 720×960 px, em JPEG. */
async function preparePhoto(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]));
  const outW = 720, outH = Math.round(outW / PHOTO_ASPECT);
  let sw = bmp.width, sh = bmp.height;
  if (sw / sh > PHOTO_ASPECT) sw = sh * PHOTO_ASPECT;
  else sh = sw / PHOTO_ASPECT;
  const sx = (bmp.width - sw) / 2;
  const sy = (bmp.height - sh) * PHOTO_FOCUS_Y;
  const c = document.createElement("canvas");
  c.width = outW;
  c.height = outH;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; // PNG com transparência
  g.fillRect(0, 0, outW, outH);
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, sx, sy, sw, sh, 0, 0, outW, outH);
  bmp.close();
  const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}

async function loadFonts(doc, StandardFonts) {
  try {
    doc.registerFontkit(window.fontkit);
    const [r, s, b] = await Promise.all(["segoeui.ttf", "seguisb.ttf", "segoeuib.ttf"].map((n) => api.readSystemFont(n)));
    return {
      reg: await doc.embedFont(r, { subset: true }),
      semi: await doc.embedFont(s, { subset: true }),
      bold: await doc.embedFont(b, { subset: true }),
      standard: false,
    };
  } catch (e) {
    console.warn("Segoe UI indisponível, usando Helvetica:", e);
    return {
      reg: await doc.embedFont(StandardFonts.Helvetica),
      semi: await doc.embedFont(StandardFonts.HelveticaBold),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      standard: true,
    };
  }
}

/** Normaliza espaços e, com fontes padrão (WinAnsi), troca caracteres sem glifo. */
function makeSanitizer(F) {
  const cache = new Map();
  return (s, font) => {
    s = String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ");
    if (!F.standard) return s;
    let out = "";
    for (const ch of s) {
      let ok = cache.get(ch);
      if (ok === undefined) {
        try {
          font.encodeText(ch);
          ok = true;
        } catch {
          ok = false;
        }
        cache.set(ch, ok);
      }
      out += ok ? ch : "?";
    }
    return out;
  };
}

function wrapText(s, font, size, maxW) {
  const words = s.split(" ").filter(Boolean);
  const lines = [];
  let cur = "";
  for (let w of words) {
    // quebra palavras maiores que a linha (ex.: URLs)
    while (font.widthOfTextAtSize(w, size) > maxW) {
      let k = w.length;
      while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > maxW) k--;
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, k));
      w = w.slice(k);
    }
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) <= maxW) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
