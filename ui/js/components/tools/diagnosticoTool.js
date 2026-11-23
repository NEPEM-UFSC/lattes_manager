// Diagnóstico da classificação: quanto o app acerta a categoria e o tipo dos seus próprios
// comprovantes (cada um classificado por um modelo treinado com os demais).

import { api } from "../../api.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../../utils.js";

const TOOL_ID = "diagnostico";

const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const catName = (c) => CATEGORY_SCHEMAS[c]?.group || CATEGORY_SCHEMAS[c]?.name || c;
const level = (a, b) => (!b ? "" : a / b >= 0.85 ? "good" : a / b >= 0.65 ? "warn" : "bad");

async function run(view, st) {
  st.loading = true;
  renderDiagnosticoTool(view);
  try {
    st.result = await api.classifyDiagnostics();
  } catch (e) {
    showToast(`Erro no diagnóstico: ${e}`, "error");
  } finally {
    st.loading = false;
  }
  if (view.active === TOOL_ID) renderDiagnosticoTool(view);
}

export function renderDiagnosticoTool(view) {
  const st = view.state;
  const d = st.result;
  let body;

  if (st.loading) {
    body = `<div class="loading-state" style="display:flex; flex-direction:column; gap:12px; padding:40px 0;">
      <div class="spinner"></div><div>Lendo os comprovantes e testando a classificação de cada um…</div>
      <small style="color:var(--text-muted)">Na primeira vez pode levar alguns minutos (o texto dos PDFs fica guardado para as próximas).</small></div>`;
  } else if (!d) {
    body = `<div class="ql-wrap">
      <div class="ql-step">
        <div>
          <b>Como funciona</b>
          <p>Cada comprovante já vinculado é classificado por um modelo treinado com todos os <i>outros</i>, como se fosse um arquivo novo. Assim dá para ver quanto o app acerta com os seus documentos, onde ele mais erra e quais comprovantes confundem a classificação.</p>
        </div>
        <div class="ql-actions"><button type="button" class="btn btn-primary btn-sm" id="dg-run">▶ Rodar diagnóstico</button></div>
      </div>
    </div>`;
  } else if (!d.avaliados) {
    body = `<div class="ql-wrap"><p class="pd-empty">Nenhum comprovante com texto para avaliar${d.sem_texto ? ` (${fmt(d.sem_texto)} digitalizados, sem texto)` : ""}. Vincule comprovantes aos registros e rode de novo.</p>
      <div><button type="button" class="btn btn-secondary btn-sm" id="dg-run">🔄 Rodar de novo</button></div></div>`;
  } else {
    body = `<div class="ql-wrap">
      <div class="ql-tiles">
        <div class="pd-tile ${level(d.acerto_categoria, d.avaliados)}"><b>${pct(d.acerto_categoria, d.avaliados)}</b><span>categoria certa</span></div>
        <div class="pd-tile ${level(d.acerto_top2, d.avaliados)}"><b>${pct(d.acerto_top2, d.avaliados)}</b><span>certa entre as 2 primeiras</span></div>
        <div class="pd-tile ${level(d.acerto_tipo, d.avaliados)}"><b>${pct(d.acerto_tipo, d.avaliados)}</b><span>categoria e tipo certos</span></div>
        <div class="pd-tile good"><b>${fmt(d.avaliados)}</b><span>comprovantes avaliados</span></div>
      </div>
      <p class="ql-summary">${d.sem_texto ? `${fmt(d.sem_texto)} comprovante(s) digitalizados ficaram de fora (sem texto no PDF; no uso normal passam por OCR). ` : ""}O ajuste fino do tipo pelo papel no certificado não entra nesta conta.</p>

      <div class="tl-table"><table class="data-table">
        <thead><tr><th>Categoria</th><th>Comprovantes</th><th>Categoria certa</th><th>Tipo certo</th></tr></thead>
        <tbody>${d.por_categoria.map((c) => `<tr>
          <td>${escapeHtml(catName(c.categoria))}</td><td>${fmt(c.n)}</td>
          <td><span class="dg-pct ${level(c.acertos, c.n)}">${pct(c.acertos, c.n)}</span></td>
          <td><span class="dg-pct ${level(c.acertos_tipo, c.n)}">${pct(c.acertos_tipo, c.n)}</span></td>
        </tr>`).join("")}</tbody>
      </table></div>

      ${d.confusoes.length ? `<div>
        <div class="rb-label">Confusões mais comuns</div>
        <div class="tl-table"><table class="data-table">
          <thead><tr><th>Era</th><th>O app sugeriu</th><th>Vezes</th></tr></thead>
          <tbody>${d.confusoes.map((c) => `<tr><td>${escapeHtml(catName(c.real))}</td><td>${escapeHtml(catName(c.previsto))}</td><td>${fmt(c.n)}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>` : ""}

      ${d.erros.length ? `<details class="ds-years">
        <summary>Comprovantes classificados errado (${fmt(d.erros.length)}${d.erros.length >= 30 ? "+" : ""})</summary>
        <p class="ql-summary">Se um deles está na categoria errada no cadastro, corrigir o registro melhora a classificação dos próximos.</p>
        <div class="tl-table"><table class="data-table pd-table">
          <thead><tr><th>Arquivo</th><th>Cadastrado como</th><th>Sugestão</th><th aria-label="Ações"></th></tr></thead>
          <tbody>${d.erros.map((e, i) => `<tr>
            <td class="mono pd-detail" title="${escapeHtml(e.path)}">${escapeHtml(e.path.split(/[\\/]/).pop())}</td>
            <td>${escapeHtml(catName(e.real))}<div class="pd-meta">${escapeHtml(e.real_tipo)}</div></td>
            <td>${escapeHtml(catName(e.previsto))}<div class="pd-meta">${escapeHtml(e.previsto_tipo)}</div></td>
            <td><button type="button" class="btn btn-secondary btn-sm" data-open="${i}" title="Abrir o comprovante">📄 Abrir</button></td>
          </tr>`).join("")}</tbody>
        </table></div>
      </details>` : ""}

      <div><button type="button" class="btn btn-secondary btn-sm" id="dg-run">🔄 Rodar de novo</button></div>
    </div>`;
  }

  view.shell(
    "Diagnóstico da classificação",
    "Quanto o app acerta a atividade dos seus comprovantes e onde ele mais erra.",
    body
  );
  view.el.querySelector("#dg-run")?.addEventListener("click", () => run(view, st));
  view.el.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => {
      const e = d.erros[Number(b.dataset.open)];
      api.openFile(e.path).catch((err) => showToast(`Não foi possível abrir: ${err}`, "error"));
    })
  );
}
