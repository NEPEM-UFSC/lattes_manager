// Atualizações: consulta a última release do GitHub e mostra um popup quando há versão nova.
// Instala sozinho (baixa, confere a assinatura, instala e reinicia) quando o sistema permite;
// senão, oferece o download do instalador certo para o sistema.

import { api } from "../api.js";
import { escapeHtml, showToast } from "../utils.js";

const KEY_AUTO = "update_check_auto"; // "0" desliga a verificação ao abrir o app
const KEY_SKIP = "update_skip_version"; // versão que o usuário escolheu pular
const KEY_LAST = "update_last_check"; // ISO da última verificação automática
const KEY_RUN = "last_run_version"; // versão da última abertura (detecta que o app foi atualizado)
const INTERVALO_MS = 12 * 60 * 60 * 1000; // no máximo duas consultas automáticas por dia

const SISTEMA = {
  windows: "Windows",
  macos: "macOS",
  "linux-appimage": "Linux (AppImage)",
  "linux-deb": "Linux (.deb)",
  "linux-rpm": "Linux (.rpm)",
};

/** "1.10.2" > "1.9.0"? */
function maior(a, b) {
  const p = (v) => String(v || "").replace(/^v/i, "").split(/[-+]/)[0].split(".").map((n) => parseInt(n, 10) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

/** Markdown simples das notas da release → HTML seguro (títulos, listas, negrito, código, links). */
function notasHtml(md) {
  const inline = (t) =>
    escapeHtml(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="#" data-url="$2">$1</a>');
  const out = [];
  let lista = false;
  for (const raw of String(md || "").replace(/\r/g, "").split("\n")) {
    const l = raw.trim();
    const item = l.match(/^[-*]\s+(.*)/);
    if (item) {
      if (!lista) out.push("<ul>"), (lista = true);
      out.push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    if (lista) out.push("</ul>"), (lista = false);
    if (!l) continue;
    const h = l.match(/^#{1,6}\s+(.*)/);
    out.push(h ? `<h4>${inline(h[1])}</h4>` : `<p>${inline(l)}</p>`);
  }
  if (lista) out.push("</ul>");
  return out.join("");
}

export class Updater {
  constructor() {
    this.busy = false;
    this.overlay = null;
  }

  async getAuto() {
    const v = await api.getSetting(KEY_AUTO).catch(() => null);
    return v !== "0";
  }

  async setAuto(on) {
    await api.setSetting(KEY_AUTO, on ? "1" : "0");
  }

  /**
   * Primeira abertura depois de uma atualização: traz a janela para a frente (o instalador às
   * vezes a reabre minimizada) e mostra a tela de sucesso com as novidades. Devolve true se mostrou.
   */
  async checkPostUpdate() {
    if (!api.hasTauri()) return false;
    try {
      const atual = await api.getAppVersion();
      const anterior = await api.getSetting(KEY_RUN).catch(() => null);
      if (anterior === atual) return false;
      await api.setSetting(KEY_RUN, atual).catch(() => {});
      if (anterior && !maior(atual, anterior)) return false;
      if (!anterior) {
        // versões até a 1.3.0 não gravavam a versão aberta: se já houve verificação de
        // atualização, o app veio de uma versão anterior; senão é a primeira instalação
        const jaVerificou = await api.getSetting(KEY_LAST).catch(() => null);
        if (!jaVerificou) return false;
      }
      api.focusMainWindow().catch(() => {});
      const notas = await api.getReleaseNotes(atual).catch(() => null);
      this.showSuccess(anterior, atual, notas);
      return true;
    } catch (e) {
      console.warn("Pós-atualização:", e);
      return false;
    }
  }

  showSuccess(anterior, atual, notas) {
    this.close();
    const html = notasHtml(notas);
    const ov = document.createElement("div");
    ov.className = "modal-overlay upd-overlay";
    ov.innerHTML = `
      <div class="modal-dialog upd-dialog upd-success" role="dialog" aria-modal="true" aria-labelledby="upd-ok-title">
        <div class="upd-ok-hero">
          <div class="upd-ok-icon">✓</div>
          <h2 id="upd-ok-title">Atualizado com sucesso!</h2>
          <p>O Lattes Manager foi atualizado ${anterior ? `da versão <b>${escapeHtml(anterior)}</b> ` : ""}para a <b>${escapeHtml(atual)}</b>. Seus dados e comprovantes foram mantidos.</p>
        </div>
        <div class="modal-body">
          ${html ? `<div class="upd-notes-title">O que há de novo</div><div class="upd-notes">${html}</div>` : ""}
        </div>
        <footer class="modal-footer">
          <button type="button" class="btn btn-primary" data-upd="ok">Começar a usar</button>
        </footer>
      </div>`;
    document.body.appendChild(ov);
    this.overlay = ov;
    const fechar = () => {
      this.close();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") fechar();
    };
    document.addEventListener("keydown", onKey);
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.closest('[data-upd="ok"]')) fechar();
    });
    ov.querySelector('[data-upd="ok"]')?.focus();
  }

  /** Verificação silenciosa ao abrir o app: só mostra algo se houver versão nova. */
  async checkOnStartup() {
    if (!api.hasTauri()) return;
    try {
      if (!(await this.getAuto())) return;
      const last = Date.parse((await api.getSetting(KEY_LAST).catch(() => null)) || "");
      if (Number.isFinite(last) && Date.now() - last < INTERVALO_MS) return;
      const info = await api.checkUpdate();
      await api.setSetting(KEY_LAST, new Date().toISOString()).catch(() => {});
      if (!info?.disponivel) return;
      const skip = await api.getSetting(KEY_SKIP).catch(() => null);
      if (skip && skip === info.versao) return;
      this.showDialog(info);
    } catch (e) {
      console.warn("Verificação de atualização:", e);
    }
  }

  /** Verificação pedida pelo usuário: sempre dá retorno. */
  async checkNow() {
    if (this.busy) return;
    this.busy = true;
    try {
      const info = await api.checkUpdate();
      if (info?.disponivel) this.showDialog(info);
      else showToast(`Você já está na versão mais recente (${info?.atual || "—"}).`, "success");
      return info;
    } catch (e) {
      showToast(`Não foi possível verificar atualizações: ${e}`, "error", 6000);
    } finally {
      this.busy = false;
    }
  }

  close() {
    this.overlay?.remove();
    this.overlay = null;
  }

  showDialog(info) {
    this.close();
    const data = info.data ? new Date(info.data).toLocaleDateString("pt-BR") : "";
    const sis = SISTEMA[info.sistema] || info.sistema;
    const notas = notasHtml(info.notas);
    const ov = document.createElement("div");
    ov.className = "modal-overlay upd-overlay";
    ov.innerHTML = `
      <div class="modal-dialog upd-dialog" role="dialog" aria-modal="true" aria-labelledby="upd-title">
        <header class="modal-header">
          <h2 class="modal-title" id="upd-title">🚀 Nova versão disponível</h2>
          <button type="button" class="btn-close-modal" data-upd="fechar" aria-label="Fechar">&times;</button>
        </header>
        <div class="modal-body">
          <div class="upd-versions">
            <div><span>Instalada</span><b>${escapeHtml(info.atual)}</b></div>
            <div class="upd-arrow">→</div>
            <div class="upd-new"><span>Nova${data ? ` · ${escapeHtml(data)}` : ""}</span><b>${escapeHtml(info.versao)}</b></div>
          </div>
          ${notas ? `<div class="upd-notes">${notas}</div>` : ""}
          <p class="upd-how">${
            info.automatica
              ? `A atualização para ${escapeHtml(sis)} é baixada, conferida pela assinatura digital e instalada; o app reinicia em seguida. Seus dados e comprovantes não são alterados.`
              : info.download
                ? `Baixe o instalador para ${escapeHtml(sis)} (<code>${escapeHtml(info.arquivo || "")}</code>) e execute-o; seus dados e comprovantes não são alterados.`
                : `Não há instalador para ${escapeHtml(sis)} nesta versão. Abra a página da versão para ver os arquivos.`
          }</p>
          <div class="upd-progress" hidden>
            <div class="upd-bar"><i></i></div>
            <small class="upd-status">Preparando…</small>
          </div>
        </div>
        <footer class="modal-footer upd-footer">
          <button type="button" class="btn btn-secondary btn-sm" data-upd="pular" title="Não avisar de novo sobre esta versão">Pular esta versão</button>
          <span class="upd-spacer"></span>
          <button type="button" class="btn btn-secondary" data-upd="pagina">Ver novidades</button>
          ${
            info.automatica
              ? `<button type="button" class="btn btn-primary" data-upd="instalar">⬇️ Atualizar agora</button>`
              : info.download
                ? `<button type="button" class="btn btn-primary" data-upd="baixar">⬇️ Baixar instalador</button>`
                : ""
          }
        </footer>
      </div>`;
    document.body.appendChild(ov);
    this.overlay = ov;

    ov.addEventListener("click", async (e) => {
      const link = e.target.closest("a[data-url]");
      if (link) {
        e.preventDefault();
        api.openUrl(link.dataset.url).catch(() => {});
        return;
      }
      if (e.target === ov && !this.installing) return this.close();
      const act = e.target.closest("[data-upd]")?.dataset.upd;
      if (!act || this.installing) return;
      if (act === "fechar") this.close();
      else if (act === "pular") {
        await api.setSetting(KEY_SKIP, info.versao).catch(() => {});
        showToast(`Você não será avisado sobre a versão ${info.versao}. Ela continua disponível em Sobre › Verificar atualizações.`, "info", 5000);
        this.close();
      } else if (act === "pagina") api.openUrl(info.pagina).catch((err) => showToast(String(err), "error"));
      else if (act === "baixar") {
        api.openUrl(info.download).catch((err) => showToast(String(err), "error"));
        this.close();
      } else if (act === "instalar") this.install(ov);
    });
    const onKey = (e) => {
      if (e.key === "Escape" && !this.installing && this.overlay === ov) {
        this.close();
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);
  }

  async install(ov) {
    this.installing = true;
    const prog = ov.querySelector(".upd-progress");
    const bar = ov.querySelector(".upd-bar i");
    const status = ov.querySelector(".upd-status");
    prog.hidden = false;
    ov.querySelectorAll("[data-upd]").forEach((b) => (b.disabled = true));
    const mb = (n) => (n / 1048576).toFixed(1).replace(".", ",");
    const unlisten = await api.onUpdateProgress((p) => {
      if (p.etapa === "instalando") {
        bar.style.width = "100%";
        status.textContent = "Instalando… o app vai reiniciar.";
      } else if (p.total) {
        bar.style.width = `${Math.min(100, (p.baixado / p.total) * 100).toFixed(1)}%`;
        status.textContent = `Baixando… ${mb(p.baixado)} de ${mb(p.total)} MB`;
      } else {
        bar.classList.add("indet");
        status.textContent = `Baixando… ${mb(p.baixado)} MB`;
      }
    });
    try {
      await api.installUpdate(); // reinicia o app ao terminar
    } catch (e) {
      this.installing = false;
      status.textContent = `Falhou: ${e}`;
      ov.querySelectorAll("[data-upd]").forEach((b) => (b.disabled = false));
      showToast(`Erro ao atualizar: ${e}`, "error", 8000);
    } finally {
      unlisten?.();
    }
  }
}

export const updater = new Updater();
