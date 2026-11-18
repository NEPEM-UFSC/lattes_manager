// "Que documento é este?" — sobe um PDF ou imagem e o app propõe a atividade (categoria + tipo),
// extrai os campos e procura registros já cadastrados sem comprovante.

import { api } from "../api.js";
import { easyClose } from "../theme.js";
import { CATEGORY_SCHEMAS, escapeHtml, getCategoryMappings, showToast } from "../utils.js";
import { PALETTE } from "./charts.js";

const IMG = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;
const ICONS = {
  dadosgerais: "👤",
  formacao: "🎓",
  atuacao: "💼",
  projetos: "🔬",
  producoes: "📄",
  patentes: "💡",
  inovacao: "🚀",
  educacao_popularizacao: "📢",
  eventos: "🎙️",
  orientacoes: "👥",
  bancas: "⚖️",
  encargos: "🏛️",
  disciplinas: "📚",
};

// ---------- OCR (tesseract.js empacotado, offline) ----------
let ocrWorker = null;
let ocrProgress = null;
let ocrQueue = Promise.resolve();
function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error("Falha ao carregar o OCR"));
    document.head.appendChild(s);
  });
}

/** Imagem girada (graus, sentido horário) e reduzida a no máx. 2400 px, como PNG. */
async function rotated(bitmap, deg) {
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const swap = deg % 180 !== 0;
  const c = document.createElement("canvas");
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2);
  g.rotate((deg * Math.PI) / 180);
  g.drawImage(bitmap, -w / 2, -h / 2, w, h);
  return new Promise((res) => c.toBlob(res, "image/png"));
}

/**
 * Texto de uma imagem (bytes). Usa a rotação indicada (`hint`, ex.: /Rotate do PDF) e, se a
 * confiança for baixa, tenta as outras orientações e fica com a melhor. `onProgress(0..1, etapa)`.
 * Fila serializada para permitir chamadas concorrentes sem corrida no worker Tesseract.
 */
export function ocrImage(bytes, onProgress, hint = 0) {
  const run = async () => {
    ocrProgress = onProgress;
    await loadScript("vendor/tesseract/tesseract.min.js");
    if (!ocrWorker) {
      const base = new URL("vendor/tesseract/", location.href).href;
      ocrWorker = await window.Tesseract.createWorker(["por", "eng"], 1, {
        workerPath: base + "worker.min.js",
        corePath: base,
        langPath: base,
        workerBlobURL: false,
        cacheMethod: "none",
        logger: (m) => ocrProgress && ocrProgress(m.progress || 0, m.status || ""),
      });
    }
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const order = [...new Set([((hint % 360) + 360) % 360, 0, 90, 270, 180])];
    let best = { conf: -1, text: "" };
    for (const deg of order) {
      const { data } = await ocrWorker.recognize(await rotated(bitmap, deg));
      if (data.confidence > best.conf) best = { conf: data.confidence, text: data.text || "", deg };
      if (data.confidence >= 70) break; // boa leitura: não precisa testar outras orientações
    }
    return best.text;
  };
  const p = ocrQueue.then(run, run);
  ocrQueue = p.catch(() => {});
  return p;
}

export class DocAnalyzer {
  constructor({ getMappings, onCreate, onAttached }) {
    this.getMappings = getMappings;
    this.onCreate = onCreate;
    this.onAttached = onAttached;
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";
    this.overlay.style.display = "none";
    document.getElementById("app").appendChild(this.overlay);
    this.overlay.addEventListener("click", (e) => e.target === this.overlay && easyClose() && !this.busy && this.close());
  }

  close() {
    this.overlay.style.display = "none";
    this.overlay.innerHTML = "";
    this.token = (this.token || 0) + 1;
  }

  loading(title, sub, pct = null) {
    this.overlay.style.display = "flex";
    this.overlay.innerHTML = `<div class="modal-dialog da-dialog"><div class="da-loading">
      <div class="da-orb"></div><b>${escapeHtml(title)}</b><span>${escapeHtml(sub)}</span>
      ${pct != null ? `<div class="tl-progress"><i style="width:${Math.round(pct * 100)}%"></i></div>` : ""}
      <button type="button" class="btn btn-secondary btn-sm" data-x>Cancelar</button></div></div>`;
    this.overlay.querySelector("[data-x]").addEventListener("click", () => this.close());
  }

  /** Fluxo completo para um arquivo do disco. */
  async open(path) {
    const token = (this.token = (this.token || 0) + 1);
    const name = path.split(/[\\/]/).pop();
    this.path = path;
    this.name = name;
    this.ocr = false;
    try {
      let res;
      if (IMG.test(path)) {
        res = await this.withOcr(path, token, () => api.readImageFile(path));
      } else {
        this.loading("Lendo o documento…", "comparando com os seus comprovantes já cadastrados");
        res = await api.analyzeDocument(path);
        if (token !== this.token) return;
        if (res.needs_ocr) {
          // PDF digitalizado: OCR da imagem da 1ª página, endireitada pela rotação da página
          const rot = await api.pdfRotation(path).catch(() => 0);
          const viaOcr = await this.withOcr(path, token, () => api.pdfScanImage(path), rot).catch(() => null);
          if (token !== this.token) return;
          if (viaOcr) res = viaOcr;
        }
      }
      if (token !== this.token) return;
      this.res = res;
      this.pick = 0;
      this.render();
    } catch (e) {
      if (token !== this.token) return;
      this.close();
      showToast(`Não foi possível analisar o arquivo: ${e}`, "error", 6000);
    }
  }

  async withOcr(path, token, getBytes, hint = 0) {
    this.loading("Reconhecendo o texto (OCR)…", "imagem ou PDF digitalizado — pode levar alguns segundos", 0);
    const bytes = await getBytes();
    if (token !== this.token) return null;
    const text = await ocrImage(bytes, (p, st) => {
      if (token !== this.token) return;
      const bar = this.overlay.querySelector(".tl-progress i");
      if (bar && /recogniz/i.test(st)) bar.style.width = `${Math.round(p * 100)}%`;
    }, hint);
    if (token !== this.token) return null;
    this.ocr = true;
    this.loading("Classificando…", "comparando com os seus comprovantes já cadastrados");
    return api.analyzeDocument(path, text);
  }

  tiposOf(cat) {
    return getCategoryMappings(cat, this.getMappings() || []).map((m) => m.description);
  }

  render() {
    const r = this.res;
    const sug = (r.sugestoes || []).filter((s) => CATEGORY_SCHEMAS[s.category]);
    const cur = sug[this.pick] || sug[0];
    const c = r.campos || {};
    const pct = (p) => `${Math.round(p * 100)}%`;
    const label = (cat) => CATEGORY_SCHEMAS[cat]?.group || cat;
    const icon = (cat) => CATEGORY_SCHEMAS[cat]?.icon || ICONS[cat] || "🗂️";
    const color = (cat) => PALETTE[cat] || CATEGORY_SCHEMAS[cat]?.color || "#6366f1";
    this.tipo = this.tipo && this.tipoCat === cur?.category ? this.tipo : cur?.tipo;
    this.tipoCat = cur?.category;
    const tipos = cur ? this.tiposOf(cur.category) : [];
    const fields = [
      ["Ano", c.ano],
      ["Carga horária", c.horas ? `${c.horas} h` : null],
      ["Aluno(a)", c.aluno],
      ["Título", c.titulo],
      ["Evento / curso", c.descricao],
      ["Disciplina", c.disciplina],
      ["Curso", c.curso],
      ["DOI", c.doi],
    ].filter((x) => x[1]);
    const conf = cur ? cur.prob : 0;
    const confTxt = conf >= 0.7 ? "alta" : conf >= 0.45 ? "média" : "baixa";
    this.overlay.innerHTML = `
      <div class="modal-dialog da-dialog">
        <header class="da-head">
          <div><span class="rb-kicker">Classificação automática</span><h2>${escapeHtml(this.name)}</h2>
            <p>${r.chars ? `${r.chars.toLocaleString("pt-BR")} letras lidas${this.ocr ? " por OCR" : ""}` : "sem texto legível"} · aprendido com ${r.treino} comprovantes seus</p></div>
          <button type="button" class="btn-close-modal" data-x>&times;</button>
        </header>
        <div class="da-body">
          ${
            r.registros?.length
              ? `<section class="da-match"><div class="rb-label">📎 Parece ser o comprovante de um registro já cadastrado</div>
              ${r.registros
                .map(
                  (m, i) => `<div class="da-rec"><span class="da-dot" style="--c:${color(m.category)}"></span>
                  <div><b>${escapeHtml(m.label || `#${m.id}`)}</b><small>${escapeHtml(label(m.category))} · #${m.id}${m.ano ? ` · ${m.ano}` : ""} · ${pct(m.score)} do texto confere</small></div>
                  <button type="button" class="btn btn-primary btn-sm" data-attach="${i}">Anexar a este registro</button></div>`
                )
                .join("")}</section>`
              : ""
          }
          ${
            cur
              ? `<section class="da-main" style="--c:${color(cur.category)}">
              <div class="da-best">
                <span class="da-ic">${icon(cur.category)}</span>
                <div class="da-best-t"><small>Atividade sugerida</small><b>${escapeHtml(label(cur.category))}</b>
                  <div class="da-tipo">Tipo:
                    <select class="form-select" data-tipo>${(tipos.length ? tipos : [cur.tipo]).map((t) => `<option ${t === this.tipo ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select>
                  </div></div>
                <div class="da-conf ${confTxt}"><b>${pct(conf)}</b><small>confiança ${confTxt}</small></div>
              </div>
              ${sug.length > 1 ? `<div class="da-alts"><small>Outras possibilidades:</small>${sug
                .map((s, i) => (i === this.pick ? "" : `<button type="button" class="da-alt" data-pick="${i}" style="--c:${color(s.category)}"><i></i>${escapeHtml(label(s.category))} <b>${pct(s.prob)}</b></button>`))
                .join("")}</div>` : ""}
            </section>`
              : `<div class="tl-empty">Não foi possível sugerir uma categoria — escolha manualmente.</div>`
          }
          ${fields.length ? `<section><div class="rb-label">Informações encontradas no documento</div><div class="da-fields">${fields.map(([k, v]) => `<div><span>${k}</span><b>${escapeHtml(String(v))}</b></div>`).join("")}</div></section>` : ""}
          ${r.chars < 60 && !this.ocr ? '<p class="dd-note">⚠️ O arquivo não tem texto selecionável e o OCR não encontrou uma imagem legível. A sugestão usa só o nome do arquivo.</p>' : ""}
        </div>
        <footer class="modal-footer da-foot">
          <select class="form-select da-other" data-other><option value="">Cadastrar em outra categoria…</option>${Object.entries(CATEGORY_SCHEMAS).map(([k, s]) => `<option value="${k}">${escapeHtml(s.group)}</option>`).join("")}</select>
          <span style="flex:1"></span>
          <button type="button" class="btn btn-secondary" data-x>Cancelar</button>
          ${cur ? `<button type="button" class="btn btn-primary" data-create>Cadastrar em ${escapeHtml(label(cur.category))} →</button>` : ""}
        </footer>
      </div>`;
    const o = this.overlay;
    o.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => this.close()));
    o.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => { this.pick = Number(b.dataset.pick); this.tipo = null; this.render(); }));
    o.querySelector("[data-tipo]")?.addEventListener("change", (e) => (this.tipo = e.target.value));
    o.querySelector("[data-create]")?.addEventListener("click", () => this.create(cur.category, this.tipo));
    o.querySelector("[data-other]").addEventListener("change", (e) => e.target.value && this.create(e.target.value, null));
    o.querySelectorAll("[data-attach]").forEach((b) =>
      b.addEventListener("click", async () => {
        const m = r.registros[Number(b.dataset.attach)];
        b.disabled = true;
        try {
          await api.updateRecord(m.category, m.id, {}, this.path);
          showToast(`📎 Comprovante anexado a #${m.id} (${label(m.category)})`, "success", 4000);
          this.close();
          this.onAttached && this.onAttached(m.category);
        } catch (e) {
          b.disabled = false;
          showToast(`Erro ao anexar: ${e}`, "error");
        }
      })
    );
  }

  create(category, tipo) {
    const campos = { ...(this.res?.campos || {}) };
    const path = this.path;
    this.close();
    this.onCreate && this.onCreate(category, tipo, campos, path);
  }
}
