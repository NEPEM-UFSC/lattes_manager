// Rede de coautoria: grafo, comunidades (propagação de rótulos), layout por forças
// (Fruchterman-Reingold) e desenho em SVG com zoom, arraste e destaque de vizinhos.
// Sem dependências externas.

import { escapeHtml } from "../../utils.js";
import { showTip, hideTip } from "./chartTip.js";

const W = 1000;
const H = 640;
/** Comunidades com cor própria: só 3 cores passam na checagem de daltonismo com todos os pares lado a lado. */
export const COMMUNITY_COLORS = 3;

const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Paleta resolvida (valores literais, para o SVG exportado funcionar fora do app). */
export function palette() {
  return {
    cat: [cssVar("--bb-1", "#2a78d6"), cssVar("--bb-2", "#eb6834"), cssVar("--bb-3", "#1baf7a")],
    other: cssVar("--bb-other", "#a3a3a3"),
    ego: cssVar("--text-primary", "#111827"),
    edge: cssVar("--bb-edge", "#94a3b8"),
    surface: cssVar("--card-bg", "#ffffff"),
    text: cssVar("--text-primary", "#111827"),
  };
}

/**
 * Monta o grafo a partir da análise (`an.lista` com estatísticas por autor e `an.pares`).
 * opts: { ego, minW, max }
 */
export function buildGraph(an, opts) {
  const minW = opts.minW || 1;
  let cand = an.lista.filter((s) => s.n > 0 && (opts.ego || !s.eu));
  cand.sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR"));
  if (opts.max) {
    const ego = cand.find((s) => s.eu);
    cand = cand.slice(0, opts.max);
    if (ego && !cand.includes(ego)) cand.push(ego);
  }
  const ids = new Set(cand.map((c) => c.id));
  const links = [];
  for (const [k, w] of an.pares) {
    if (w < minW) continue;
    const [a, b] = k.split("|").map(Number);
    if (ids.has(a) && ids.has(b)) links.push({ s: a, t: b, w });
  }
  const deg = new Map();
  const forca = new Map();
  for (const l of links) {
    deg.set(l.s, (deg.get(l.s) || 0) + 1);
    deg.set(l.t, (deg.get(l.t) || 0) + 1);
    forca.set(l.s, (forca.get(l.s) || 0) + l.w);
    forca.set(l.t, (forca.get(l.t) || 0) + l.w);
  }
  // sem o dono do currículo, quem só colaborou com ele fica isolado: some da rede
  const visiveis = cand.filter((s) => s.eu || deg.get(s.id));
  const nodes = visiveis.map((s) => ({
    id: s.id,
    nome: s.nome,
    n: s.n,
    eu: s.eu,
    orientado: s.orientado,
    deg: deg.get(s.id) || 0,
    forca: forca.get(s.id) || 0,
    x: 0,
    y: 0,
    com: -1,
  }));
  const comunidades = communities(nodes, links);
  return { nodes, links, comunidades, ocultos: cand.length - visiveis.length, candidatos: cand.length };
}

/** Comunidades por propagação de rótulos ponderada (ordem determinística). O dono fica de fora. */
function communities(nodes, links) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const l of links) {
    if (byId.get(l.s)?.eu || byId.get(l.t)?.eu) continue;
    adj.get(l.s)?.push([l.t, l.w]);
    adj.get(l.t)?.push([l.s, l.w]);
  }
  const label = new Map(nodes.map((n) => [n.id, n.id]));
  const order = nodes.filter((n) => !n.eu).sort((a, b) => b.forca - a.forca || a.id - b.id);
  for (let it = 0; it < 40; it++) {
    let changed = false;
    for (const n of order) {
      const score = new Map();
      for (const [m, w] of adj.get(n.id)) score.set(label.get(m), (score.get(label.get(m)) || 0) + w);
      if (!score.size) continue;
      let best = label.get(n.id);
      let bw = score.get(best) ?? -1;
      for (const [lab, w] of score) {
        if (w > bw || (w === bw && lab < best)) {
          best = lab;
          bw = w;
        }
      }
      if (best !== label.get(n.id)) {
        label.set(n.id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const groups = new Map();
  for (const n of order) {
    const l = label.get(n.id);
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l).push(n);
  }
  const lista = [...groups.values()]
    .filter((g) => g.length > 1)
    .sort((a, b) => b.length - a.length || b.reduce((s, n) => s + n.n, 0) - a.reduce((s, n) => s + n.n, 0));
  lista.forEach((g, i) => g.forEach((n) => (n.com = i)));
  return lista.map((g, i) => {
    const hub = [...g].sort((a, b) => b.forca - a.forca || b.n - a.n)[0];
    return { idx: i, size: g.length, hub: hub.nome, ids: g.map((n) => n.id) };
  });
}

/**
 * Fruchterman-Reingold num componente conexo (`list`: índices dos nós). Escreve em xs/ys e
 * devolve a caixa ocupada.
 */
function forceComponent(list, links, xs, ys, r, nodes) {
  const n = list.length;
  if (n === 1) {
    xs[list[0]] = 0;
    ys[list[0]] = 0;
    return { x0: 0, y0: 0, x1: 0, y1: 0 };
  }
  const side = 70 * Math.sqrt(n);
  list.forEach((i) => {
    if (nodes[i].eu) {
      xs[i] = 0;
      ys[i] = 0;
      return;
    }
    const a = r() * Math.PI * 2;
    const rad = (side / 2) * Math.sqrt(r());
    xs[i] = Math.cos(a) * rad;
    ys[i] = Math.sin(a) * rad;
  });
  const k = (side / Math.sqrt(n)) * 0.9;
  const k2 = k * k;
  const dx = new Map(list.map((i) => [i, 0]));
  const dy = new Map(list.map((i) => [i, 0]));
  let t = side / 8;
  const iters = n > 250 ? 220 : 320;
  for (let it = 0; it < iters; it++) {
    for (const i of list) {
      dx.set(i, 0);
      dy.set(i, 0);
    }
    for (let p = 0; p < n; p++) {
      const i = list[p];
      for (let q = p + 1; q < n; q++) {
        const j = list[q];
        let ex = xs[i] - xs[j];
        let ey = ys[i] - ys[j];
        let d2 = ex * ex + ey * ey;
        if (d2 < 0.01) {
          ex = r() - 0.5;
          ey = r() - 0.5;
          d2 = 0.01;
        }
        const f = k2 / d2;
        dx.set(i, dx.get(i) + ex * f);
        dy.set(i, dy.get(i) + ey * f);
        dx.set(j, dx.get(j) - ex * f);
        dy.set(j, dy.get(j) - ey * f);
      }
    }
    for (const [a, b, w] of links) {
      const ex = xs[a] - xs[b];
      const ey = ys[a] - ys[b];
      const d = Math.sqrt(ex * ex + ey * ey) || 0.01;
      const f = (d / k) * w;
      dx.set(a, dx.get(a) - ex * f);
      dy.set(a, dy.get(a) - ey * f);
      dx.set(b, dx.get(b) + ex * f);
      dy.set(b, dy.get(b) + ey * f);
    }
    for (const i of list) {
      // gravidade leve: segura folhas soltas perto do grupo
      const gx = dx.get(i) - xs[i] * 0.02;
      const gy = dy.get(i) - ys[i] * 0.02;
      const d = Math.sqrt(gx * gx + gy * gy) || 1;
      const m = Math.min(d, t);
      xs[i] += (gx / d) * m;
      ys[i] += (gy / d) * m;
    }
    t = Math.max(0.5, t * 0.975);
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const i of list) {
    x0 = Math.min(x0, xs[i]);
    x1 = Math.max(x1, xs[i]);
    y0 = Math.min(y0, ys[i]);
    y1 = Math.max(y1, ys[i]);
  }
  return { x0, y0, x1, y1 };
}

/**
 * Posições por forças, um componente conexo por vez, e componentes empacotados em linhas
 * (o maior primeiro). Assim um par solto não empurra a rede principal para o canto.
 */
export function layout(g, seed = 7) {
  const N = g.nodes.length;
  if (!N) return;
  const r = rng(seed);
  const idx = new Map(g.nodes.map((n, i) => [n.id, i]));
  const adj = g.nodes.map(() => []);
  for (const l of g.links) {
    const a = idx.get(l.s);
    const b = idx.get(l.t);
    adj[a].push(b);
    adj[b].push(a);
  }
  const comp = new Int32Array(N).fill(-1);
  const comps = [];
  for (let i = 0; i < N; i++) {
    if (comp[i] >= 0) continue;
    const list = [i];
    comp[i] = comps.length;
    for (let q = 0; q < list.length; q++) {
      for (const j of adj[list[q]]) {
        if (comp[j] < 0) {
          comp[j] = comps.length;
          list.push(j);
        }
      }
    }
    comps.push(list);
  }
  const linksOf = comps.map(() => []);
  for (const l of g.links) {
    const a = idx.get(l.s);
    linksOf[comp[a]].push([a, idx.get(l.t), 0.4 + 0.25 * Math.log2(1 + l.w)]);
  }
  const xs = new Float64Array(N);
  const ys = new Float64Array(N);
  const order = comps.map((_, c) => c).sort((a, b) => comps[b].length - comps[a].length);
  const boxes = comps.map((list, c) => forceComponent(list, linksOf[c], xs, ys, r, g.nodes));

  // empacotamento em linhas com a proporção da área de desenho
  const gap = 60;
  const MIN = 30;
  const dims = boxes.map((b) => ({ w: Math.max(MIN, b.x1 - b.x0), h: Math.max(MIN, b.y1 - b.y0) }));
  const area = dims.reduce((s, d) => s + (d.w + gap) * (d.h + gap), 0);
  const rowW = Math.max(dims[order[0]].w, Math.sqrt(area * (W / H)));
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const c of order) {
    const { w, h } = dims[c];
    if (x > 0 && x + w > rowW) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    const b = boxes[c];
    // centraliza componentes menores que a caixa mínima
    const ox = x - b.x0 + (w - (b.x1 - b.x0)) / 2;
    const oy = y - b.y0 + (h - (b.y1 - b.y0)) / 2;
    for (const i of comps[c]) {
      xs[i] += ox;
      ys[i] += oy;
    }
    x += w + gap;
    rowH = Math.max(rowH, h);
  }

  // encaixa na área com margem
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < N; i++) {
    x0 = Math.min(x0, xs[i]);
    x1 = Math.max(x1, xs[i]);
    y0 = Math.min(y0, ys[i]);
    y1 = Math.max(y1, ys[i]);
  }
  const pad = 40;
  const s = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, y1 - y0));
  const ox = (W - (x1 - x0) * s) / 2;
  const oy = (H - (y1 - y0) * s) / 2;
  g.nodes.forEach((n, i) => {
    n.x = ox + (xs[i] - x0) * s;
    n.y = oy + (ys[i] - y0) * s;
  });
}

/** Raio do nó em pixels de tela (não cresce com o zoom). Redes grandes começam com nós menores. */
function radiusFn(N) {
  const f = Math.max(0.45, Math.min(1, Math.sqrt(120 / Math.max(1, N))));
  return (n) => (n.eu ? 12 : Math.min(18, 3 + 1.9 * Math.sqrt(n.n)) * f);
}

export function nodeColor(n, cor, pal) {
  if (n.eu) return pal.ego;
  if (cor === "orientados") return n.orientado ? pal.cat[1] : pal.cat[0];
  return n.com >= 0 && n.com < COMMUNITY_COLORS ? pal.cat[n.com] : pal.other;
}

/**
 * Desenha a rede em `host`. O zoom só afasta as posições: círculos, linhas e nomes mantêm o
 * tamanho na tela (zoom semântico); ao aproximar, os nomes dos demais autores aparecem.
 * opts: { cor: "comunidade"|"orientados", rotulos: "principais"|"todos"|"nenhum", selected, focus }
 * handlers: { onSelect(id|null) }
 * Devolve { highlight(ids|null), zoom(f), reset(), svgText() }.
 */
export function renderNetwork(host, g, opts, handlers = {}) {
  const pal = palette();
  const radius = radiusFn(g.nodes.length);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const vizinhos = new Map(g.nodes.map((n) => [n.id, new Set()]));
  for (const l of g.links) {
    vizinhos.get(l.s).add(l.t);
    vizinhos.get(l.t).add(l.s);
  }
  const maxW = Math.max(1, ...g.links.map((l) => l.w));
  // nomes sempre visíveis; os demais aparecem ao aproximar
  const principais = new Set();
  if (opts.rotulos === "todos") g.nodes.forEach((n) => principais.add(n.id));
  else if (opts.rotulos !== "nenhum") {
    [...g.nodes]
      .sort((a, b) => b.forca - a.forca || b.n - a.n)
      .slice(0, 14)
      .forEach((n) => principais.add(n.id));
  }
  g.nodes.filter((n) => n.eu || n.id === opts.selected).forEach((n) => principais.add(n.id));

  const lines = g.links
    .map((l, i) => `<line class="bb-link" data-i="${i}" stroke="${pal.edge}" stroke-width="${(0.6 + 2.2 * Math.sqrt(l.w / maxW)).toFixed(2)}"/>`)
    .join("");
  const circles = g.nodes
    .map((n) => `<circle class="bb-node${n.id === opts.selected ? " sel" : ""}" data-id="${n.id}" r="${radius(n).toFixed(1)}" fill="${nodeColor(n, opts.cor, pal)}" stroke="${pal.surface}" stroke-width="1.5"/>`)
    .join("");
  const comNome = opts.rotulos === "nenhum" ? g.nodes.filter((n) => principais.has(n.id)) : g.nodes;
  const labelsSvg = comNome
    .map((n) => `<text class="bb-lbl${n.eu ? " ego" : ""}${principais.has(n.id) ? "" : " extra"}" data-id="${n.id}" text-anchor="middle" fill="${pal.text}" stroke="${pal.surface}">${escapeHtml(n.nome)}</text>`)
    .join("");

  host.innerHTML = `<svg class="bb-net" role="img" aria-label="Rede de coautoria com ${g.nodes.length} autores e ${g.links.length} ligações">
      <rect class="bb-bg" x="0" y="0" width="100%" height="100%" fill="transparent"/>
      <g class="bb-links">${lines}</g><g class="bb-nodes">${circles}</g><g class="bb-labels">${labelsSvg}</g>
    </svg>`;
  const svg = host.querySelector("svg");
  const lineEls = [...svg.querySelectorAll(".bb-link")];
  const circleOf = new Map([...svg.querySelectorAll(".bb-node")].map((c) => [Number(c.dataset.id), c]));
  const labelOf = new Map([...svg.querySelectorAll(".bb-lbl")].map((t) => [Number(t.dataset.id), t]));

  const labelOrder = [...g.nodes].sort(
    (a, b) => Number(b.eu || b.id === opts.selected) - Number(a.eu || a.id === opts.selected) || b.forca - a.forca || b.n - a.n
  );

  // transformação layout → tela: x' = x*k + tx
  const view = { k: 1, tx: 0, ty: 0, k0: 1, cw: 1, ch: 1 };
  const fit = (cw, ch) => {
    view.cw = cw;
    view.ch = ch;
    view.k0 = view.k = Math.min(cw / W, ch / H);
    view.tx = (cw - W * view.k) / 2;
    view.ty = (ch - H * view.k) / 2;
  };
  const apply = (target = svg) => {
    const { k, tx, ty } = view;
    const sx = (n) => (n.x * k + tx).toFixed(1);
    const sy = (n) => (n.y * k + ty).toFixed(1);
    const els = target === svg
      ? { lines: lineEls, circles: circleOf, labels: labelOf }
      : {
          lines: [...target.querySelectorAll(".bb-link")],
          circles: new Map([...target.querySelectorAll(".bb-node")].map((c) => [Number(c.dataset.id), c])),
          labels: new Map([...target.querySelectorAll(".bb-lbl")].map((t) => [Number(t.dataset.id), t])),
        };
    g.links.forEach((l, i) => {
      const a = byId.get(l.s);
      const b = byId.get(l.t);
      const el = els.lines[i];
      el.setAttribute("x1", sx(a));
      el.setAttribute("y1", sy(a));
      el.setAttribute("x2", sx(b));
      el.setAttribute("y2", sy(b));
    });
    els.circles.forEach((c, id) => {
      const n = byId.get(id);
      c.setAttribute("cx", sx(n));
      c.setAttribute("cy", sy(n));
    });
    // a partir de 2,2× de aproximação, os demais nomes entram; nenhum nome cobre outro de
    // prioridade maior (você e o selecionado primeiro, depois os mais conectados)
    const showAll = k / view.k0 >= 2.2;
    const postos = [];
    const cabe = (b) => !postos.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
    for (const n of labelOrder) {
      const t = els.labels.get(n.id);
      if (!t) continue;
      const x = n.x * k + tx;
      const y = n.y * k + ty - radius(n) - 4;
      t.setAttribute("x", x.toFixed(1));
      t.setAttribute("y", y.toFixed(1));
      const extra = t.classList.contains("extra");
      const w = n.nome.length * (n.eu ? 7.4 : 6.2);
      const box = { x0: x - w / 2, x1: x + w / 2, y0: y - (n.eu ? 13 : 11), y1: y + 3 };
      const forte = n.eu || n.id === opts.selected;
      const show = (!extra || showAll) && (forte || cabe(box));
      t.style.display = show ? "" : "none";
      if (show) postos.push(box);
    }
  };
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      apply();
    });
  };
  const sizeNow = () => {
    const r = svg.getBoundingClientRect();
    return [Math.max(1, r.width), Math.max(1, r.height)];
  };
  fit(...sizeNow());
  apply();
  // refaz o encaixe quando o tamanho muda (maximizar, redimensionar a janela), mantendo o zoom
  const ro = new ResizeObserver(() => {
    if (!svg.isConnected) return ro.disconnect();
    const [cw, ch] = sizeNow();
    if (Math.abs(cw - view.cw) < 2 && Math.abs(ch - view.ch) < 2) return;
    const rel = view.k / view.k0;
    const cx = (view.cw / 2 - view.tx) / view.k;
    const cy = (view.ch / 2 - view.ty) / view.k;
    fit(cw, ch);
    view.k = view.k0 * rel;
    view.tx = cw / 2 - cx * view.k;
    view.ty = ch / 2 - cy * view.k;
    apply();
  });
  ro.observe(svg);

  const local = (e) => {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const zoomAt = (px, py, f) => {
    const nk = Math.min(view.k0 * 12, Math.max(view.k0 * 0.4, view.k * f));
    const s = nk / view.k;
    view.tx = px - (px - view.tx) * s;
    view.ty = py - (py - view.ty) * s;
    view.k = nk;
    schedule();
  };

  const highlight = (ids) => {
    svg.classList.toggle("focus", Boolean(ids));
    if (!ids) {
      svg.querySelectorAll(".hl").forEach((e) => e.classList.remove("hl"));
      return;
    }
    circleOf.forEach((c, id) => c.classList.toggle("hl", ids.has(id)));
    labelOf.forEach((t, id) => t.classList.toggle("hl", ids.has(id)));
    lineEls.forEach((el, i) => {
      const l = g.links[i];
      el.classList.toggle("hl", ids.has(l.s) && ids.has(l.t));
    });
  };

  const tipHtml = (n) => {
    const parts = [`<b>${escapeHtml(n.nome)}</b>`];
    if (n.eu) parts.push("Você (dono do currículo)");
    parts.push(`${fmt(n.n)} produção(ões) no período`);
    if (!n.eu) parts.push(`${fmt(n.deg)} coautor(es) nesta rede`);
    if (n.orientado) parts.push(`🎓 Orientado: ${escapeHtml(n.orientado.niveis.join(", ") || "orientação")}`);
    if (n.com >= 0 && opts.cor === "comunidade") parts.push(`Grupo ${n.com + 1}`);
    return parts.join("<br>");
  };

  // arrastar nós / mover o fundo
  let drag = null;
  svg.addEventListener("pointerdown", (e) => {
    const c = e.target.closest(".bb-node");
    const p = local(e);
    drag = c
      ? { kind: "node", id: Number(c.dataset.id), moved: false, x0: p.x, y0: p.y }
      : { kind: "pan", x0: p.x, y0: p.y, tx: view.tx, ty: view.ty, moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    const p = local(e);
    if (!drag) {
      const c = e.target.closest(".bb-node");
      if (c) {
        const n = byId.get(Number(c.dataset.id));
        showTip(tipHtml(n), e);
        highlight(new Set([n.id, ...vizinhos.get(n.id)]));
      } else {
        hideTip();
        highlight(opts.focus || null);
      }
      return;
    }
    if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) < 3) return;
    drag.moved = true;
    hideTip();
    if (drag.kind === "node") {
      const n = byId.get(drag.id);
      n.x = (p.x - view.tx) / view.k;
      n.y = (p.y - view.ty) / view.k;
    } else {
      view.tx = drag.tx + (p.x - drag.x0);
      view.ty = drag.ty + (p.y - drag.y0);
    }
    schedule();
  });
  svg.addEventListener("pointerup", (e) => {
    const d = drag;
    drag = null;
    if (!d || d.moved) return;
    if (d.kind === "node") handlers.onSelect?.(d.id);
    else if (e.target.classList.contains("bb-bg")) handlers.onSelect?.(null);
  });
  svg.addEventListener("pointerleave", () => {
    hideTip();
    if (!drag) highlight(opts.focus || null);
  });
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(p.x, p.y, e.deltaY > 0 ? 1 / 1.2 : 1.2);
    },
    { passive: false }
  );
  const reset = () => {
    fit(...sizeNow());
    schedule();
  };
  svg.addEventListener("dblclick", reset);

  if (opts.focus) highlight(opts.focus);

  return {
    highlight,
    zoom: (f) => zoomAt(view.cw / 2, view.ch / 2, f),
    reset,
    /** SVG autônomo (cores literais, fundo e fonte embutidos), com a rede inteira enquadrada. */
    svgText() {
      const saved = { ...view };
      const EW = 1500;
      const EH = 960;
      fit(EW, EH);
      const clone = svg.cloneNode(true);
      apply(clone);
      Object.assign(view, saved);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("viewBox", `0 0 ${EW} ${EH}`);
      clone.setAttribute("width", String(EW));
      clone.setAttribute("height", String(EH));
      clone.classList.remove("focus");
      clone.querySelectorAll(".hl").forEach((e) => e.classList.remove("hl"));
      clone.querySelectorAll('.bb-lbl[style*="none"]').forEach((e) => e.remove());
      clone.querySelector(".bb-bg")?.setAttribute("fill", pal.surface);
      const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
      style.textContent = `text{font:600 11px system-ui,-apple-system,"Segoe UI",sans-serif;paint-order:stroke;stroke-width:3px;stroke-linejoin:round}text.ego{font-size:13px;font-weight:800}line{stroke-opacity:.45}`;
      clone.insertBefore(style, clone.firstChild);
      return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
    },
  };
}

const xmlEsc = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

/** GraphML para Gephi, Cytoscape ou VOSviewer (com posições, produções, comunidade e orientado). */
export function graphml(g) {
  const nodes = g.nodes
    .map((n) => `    <node id="n${n.id}"><data key="label">${xmlEsc(n.nome)}</data><data key="producoes">${n.n}</data><data key="grupo">${n.com + 1}</data><data key="orientado">${n.orientado ? xmlEsc(n.orientado.niveis.join("; ") || "sim") : ""}</data><data key="voce">${n.eu}</data><data key="x">${n.x.toFixed(2)}</data><data key="y">${n.y.toFixed(2)}</data></node>`)
    .join("\n");
  const edges = g.links
    .map((l, i) => `    <edge id="e${i}" source="n${l.s}" target="n${l.t}"><data key="weight">${l.w}</data></edge>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="label" for="node" attr.name="label" attr.type="string"/>
  <key id="producoes" for="node" attr.name="producoes" attr.type="int"/>
  <key id="grupo" for="node" attr.name="grupo" attr.type="int"/>
  <key id="orientado" for="node" attr.name="orientado" attr.type="string"/>
  <key id="voce" for="node" attr.name="voce" attr.type="boolean"/>
  <key id="x" for="node" attr.name="x" attr.type="double"/>
  <key id="y" for="node" attr.name="y" attr.type="double"/>
  <key id="weight" for="edge" attr.name="weight" attr.type="double"/>
  <graph id="coautoria" edgedefault="undirected">
${nodes}
${edges}
  </graph>
</graphml>
`;
}
