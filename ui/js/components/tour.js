// Interactive Guided Tour with smooth spotlight shading & step-by-step onboarding

import { escapeHtml } from "../utils.js";

const TOUR_STORAGE_KEY = "lattes_tour_seen_v1";

const TOUR_STEPS = [
  {
    id: "welcome",
    target: null,
    icon: "🚀",
    title: "Bem-vindo ao Lattes Manager!",
    body: `
      <p>Organize todo o seu currículo acadêmico, vincule comprovantes em PDF/imagem e gere relatórios completos em poucos cliques.</p>
      <div class="tour-checklist">
        <div><b>1.</b> Importe seu <b>XML do Lattes</b> ou <b>arquivos em lote</b> para popular o banco rapidamente.</div>
        <div><b>2.</b> Vincule comprovantes (você pode anexar <b>vários arquivos</b> por registro).</div>
        <div><b>3.</b> Use as <b>Ferramentas</b> para baixar PDFs por DOI, cruzar dados com o XML e conferir pendências.</div>
        <div><b>4.</b> Exporte o dossiê final em <b>Gerar comprovantes</b>.</div>
      </div>
    `,
    tip: "Use as setas do teclado (← / →) ou os botões abaixo para navegar. Você pode repetir este tour quando quiser pelo menu lateral.",
  },
  {
    id: "import",
    target: "#btn-import-menu",
    placement: "bottom",
    icon: "📥",
    title: "Comece por aqui: Importar Dados",
    body: `
      <p>Na primeira instalação, o caminho mais rápido é clicar em <b>Importar</b>:</p>
      <ul class="tour-list">
        <li><b>🧬 XML do Lattes:</b> carrega seu currículo do CNPq, preenche seu perfil e abre uma árvore indentada para você escolher exatamente o que importar.</li>
        <li><b>🗂️ Importação em lote:</b> arraste uma pasta ou vários PDFs/certificados de uma vez — o app classifica e sugere os campos.</li>
        <li><b>⚡ Novo por DOI:</b> cole um DOI para preencher metadados e baixar o PDF de acesso aberto.</li>
        <li><b>✨ Novo a partir de arquivo:</b> leia um único PDF ou imagem para preencher automaticamente.</li>
      </ul>
    `,
  },
  {
    id: "new-record",
    target: "#btn-new-record",
    placement: "bottom",
    icon: "➕",
    title: "Cadastro Manual e Múltiplos Comprovantes",
    body: `
      <p>Use <b>+ Novo Registro</b> (ou <kbd>Ctrl+N</kbd>) para adicionar qualquer atividade manualmente.</p>
      <p>Você pode <b>arrastar vários arquivos</b> para dentro do formulário (ou direto sobre uma linha da tabela): todos ficam vinculados ao mesmo registro e são renomeados de forma descritiva automaticamente.</p>
    `,
  },
  {
    id: "categories",
    target: ".sidebar-nav",
    placement: "right",
    icon: "📚",
    title: "Categorias do Currículo",
    body: `
      <p>Navegue entre todas as áreas do seu currículo: <b>Dados Gerais</b>, <b>Formação</b>, <b>Atuação Profissional</b>, <b>Projetos</b>, <b>Produções</b>, <b>Patentes</b>, <b>Inovação</b>, <b>Educação e C&amp;T</b>, <b>Eventos</b>, <b>Orientações</b> e <b>Bancas</b>.</p>
      <p>Em cada tabela você pode filtrar por ano/subcategoria, visualizar PDFs lado a lado e <b>alterar múltiplos registros em lote</b>.</p>
    `,
  },
  {
    id: "search",
    target: "#input-search",
    placement: "bottom",
    icon: "🔍",
    title: "Busca Rápida (Ctrl+K)",
    body: `
      <p>Pesquise por título, instituição, revista, aluno, ano ou DOI — a busca ignora acentos e maiúsculas.</p>
      <p>Pressione <kbd>Ctrl+K</kbd> de qualquer tela para ir direto para o campo de busca.</p>
    `,
  },
  {
    id: "charts",
    target: "#nav-graficos",
    placement: "right",
    icon: "📈",
    title: "Indicadores e Gráficos",
    body: `
      <p>Acompanhe sua produção ao longo dos anos, distribuição por <b>Qualis</b>, citações, taxa de cobertura de comprovantes e exporte painéis visuais.</p>
    `,
  },
  {
    id: "tools",
    target: "#nav-ferramentas",
    placement: "right",
    icon: "🧰",
    title: "Ferramentas Inteligentes",
    body: `
      <p>Organizadas em 4 classes para facilitar a manutenção do seu currículo:</p>
      <ul class="tour-list">
        <li><b>🔄 Sincronização &amp; Comparação:</b> Checagem Cruzada (BD × XML), Lattes Time Machine e artigos do Scholar ausentes.</li>
        <li><b>📚 Produções &amp; Métricas:</b> citações Google Scholar, extração de DOI, download em lote de PDFs e Qualis.</li>
        <li><b>📂 Comprovantes &amp; Pastas:</b> Vassoura de Comprovantes, Auditoria de Pastas e links inválidos.</li>
        <li><b>✨ Padronização &amp; Backup:</b> padronizar textos, formatador ABNT/Vancouver e Cofre Portátil (.zip).</li>
      </ul>
    `,
  },
  {
    id: "subfolders",
    target: "#nav-subpastas",
    placement: "right",
    icon: "📁",
    title: "Subpastas Organizadas no Disco",
    body: `
      <p>Cada tipo/subcategoria é mapeado para uma subpasta real no seu computador. Ao anexar um comprovante, o app copia e organiza tudo automaticamente no diretório correto.</p>
    `,
  },
  {
    id: "report",
    target: "#btn-report",
    placement: "bottom",
    icon: "📑",
    title: "Gerar Comprovantes em PDF",
    body: `
      <p>Precisa entregar um dossiê para progressão funcional, concurso ou relatório anual?</p>
      <p>Clique em <b>Gerar comprovantes</b> para montar um <b>PDF único</b> com capa, sumário clicável, índice numerado e todos os comprovantes filtrados pelo período desejado.</p>
    `,
  },
  {
    id: "settings-finish",
    target: "#nav-tour",
    placement: "right",
    icon: "🧭",
    title: "Tudo pronto! Recomece quando quiser",
    body: `
      <p>Em <b>⚙️ Configurações</b> você pode escolher a pasta de dados, criar categorias personalizadas e ajustar a aparência do app.</p>
      <p>Sempre que quiser rever este guia passo a passo, basta clicar no botão <b>🧭 Tour</b> aqui na barra lateral.</p>
    `,
    tip: "Dica: comece clicando em Importar › XML do Lattes no canto superior direito!",
  },
];

export class AppTour {
  constructor({ onBeforeStart = null } = {}) {
    this.onBeforeStart = onBeforeStart;
    this.active = false;
    this.index = 0;
    this.root = null;
    this.backdrop = null;
    this.spotlight = null;
    this.card = null;
    this._onKeyDown = (e) => this.handleKeyDown(e);
    this._onResize = () => this.positionCurrent();
  }

  hasSeen() {
    try {
      return localStorage.getItem(TOUR_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  markSeen() {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "1");
    } catch {
      // ignore storage errors
    }
  }

  maybeStartFirstRun() {
    if (this.hasSeen()) return false;
    setTimeout(() => {
      if (!this.active) this.start(0);
    }, 650);
    return true;
  }

  ensureDom() {
    if (this.root) return;
    const root = document.createElement("div");
    root.id = "app-tour-root";
    root.className = "tour-root";
    root.innerHTML = `
      <div class="tour-backdrop" id="tour-backdrop"></div>
      <div class="tour-spotlight" id="tour-spotlight"></div>
      <div class="tour-card" id="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <div class="tour-progress-track"><div class="tour-progress-fill" id="tour-progress-fill"></div></div>
        <div class="tour-card-head">
          <span class="tour-step-icon" id="tour-step-icon"></span>
          <div class="tour-head-meta">
            <span class="tour-step-counter" id="tour-step-counter"></span>
            <h3 class="tour-title" id="tour-title"></h3>
          </div>
          <button type="button" class="tour-close-btn" id="tour-close-btn" title="Fechar tour (Esc)">&times;</button>
        </div>
        <div class="tour-card-body" id="tour-card-body"></div>
        <div class="tour-tip" id="tour-tip" style="display:none;"></div>
        <div class="tour-card-foot">
          <button type="button" class="tour-skip-btn" id="tour-skip-btn">Pular tour</button>
          <div class="tour-dots" id="tour-dots"></div>
          <div class="tour-nav-btns">
            <button type="button" class="btn btn-secondary btn-sm" id="tour-prev-btn">← Anterior</button>
            <button type="button" class="btn btn-primary btn-sm" id="tour-next-btn">Próximo →</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    this.root = root;
    this.backdrop = root.querySelector("#tour-backdrop");
    this.spotlight = root.querySelector("#tour-spotlight");
    this.card = root.querySelector("#tour-card");

    root.querySelector("#tour-close-btn").addEventListener("click", () => this.finish());
    root.querySelector("#tour-skip-btn").addEventListener("click", () => this.finish());
    root.querySelector("#tour-prev-btn").addEventListener("click", () => this.prev());
    root.querySelector("#tour-next-btn").addEventListener("click", () => this.next());
    this.backdrop.addEventListener("click", () => this.finish());
  }

  async start(stepIndex = 0) {
    if (typeof this.onBeforeStart === "function") {
      try {
        await this.onBeforeStart();
      } catch {
        // ignore
      }
    }
    this.ensureDom();
    this.active = true;
    this.index = Math.max(0, Math.min(stepIndex, TOUR_STEPS.length - 1));
    this.root.classList.add("open");
    window.addEventListener("keydown", this._onKeyDown, true);
    window.addEventListener("resize", this._onResize);
    window.addEventListener("scroll", this._onResize, true);
    this.renderStep();
  }

  prev() {
    if (this.index > 0) {
      this.index -= 1;
      this.renderStep();
    }
  }

  next() {
    if (this.index < TOUR_STEPS.length - 1) {
      this.index += 1;
      this.renderStep();
    } else {
      this.finish();
    }
  }

  finish() {
    this.markSeen();
    this.active = false;
    window.removeEventListener("keydown", this._onKeyDown, true);
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("scroll", this._onResize, true);
    if (this.root) {
      this.root.classList.remove("open");
    }
  }

  handleKeyDown(e) {
    if (!this.active) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.finish();
    } else if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      this.next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      this.prev();
    }
  }

  resolveTarget(step) {
    if (!step?.target) return null;
    const el = document.querySelector(step.target);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return el;
  }

  renderStep() {
    const step = TOUR_STEPS[this.index];
    if (!step || !this.root) return;

    const total = TOUR_STEPS.length;
    const pct = Math.round(((this.index + 1) / total) * 100);
    this.root.querySelector("#tour-progress-fill").style.width = `${pct}%`;
    this.root.querySelector("#tour-step-icon").textContent = step.icon;
    this.root.querySelector("#tour-step-counter").textContent = `Passo ${this.index + 1} de ${total}`;
    this.root.querySelector("#tour-title").textContent = step.title;
    this.root.querySelector("#tour-card-body").innerHTML = step.body;

    const tipEl = this.root.querySelector("#tour-tip");
    if (step.tip) {
      tipEl.textContent = step.tip;
      tipEl.style.display = "block";
    } else {
      tipEl.style.display = "none";
    }

    const prevBtn = this.root.querySelector("#tour-prev-btn");
    const nextBtn = this.root.querySelector("#tour-next-btn");
    prevBtn.style.visibility = this.index === 0 ? "hidden" : "visible";
    nextBtn.textContent = this.index === total - 1 ? "Concluir Tour ✓" : "Próximo →";

    const dotsEl = this.root.querySelector("#tour-dots");
    dotsEl.innerHTML = TOUR_STEPS.map(
      (_, i) => `<button type="button" class="tour-dot ${i === this.index ? "active" : i < this.index ? "done" : ""}" data-tour-dot="${i}" title="Ir para o passo ${i + 1}"></button>`
    ).join("");
    dotsEl.querySelectorAll("[data-tour-dot]").forEach((d) =>
      d.addEventListener("click", () => {
        this.index = Number(d.dataset.tourDot);
        this.renderStep();
      })
    );

    // Subtle re-entrance animation on card content
    this.card.classList.remove("tour-card-enter");
    void this.card.offsetWidth;
    this.card.classList.add("tour-card-enter");

    const el = this.resolveTarget(step);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
    requestAnimationFrame(() => this.positionCurrent());
  }

  positionCurrent() {
    if (!this.active || !this.root) return;
    const step = TOUR_STEPS[this.index];
    const el = this.resolveTarget(step);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8;

    if (!el) {
      // Centered modal style (no spotlight cutout)
      this.backdrop.classList.add("solid");
      this.spotlight.classList.remove("visible");
      this.card.classList.add("centered");
      this.card.style.left = "";
      this.card.style.top = "";
      return;
    }

    this.backdrop.classList.remove("solid");
    this.card.classList.remove("centered");

    const rect = el.getBoundingClientRect();
    const sx = Math.max(4, rect.left - pad);
    const sy = Math.max(4, rect.top - pad);
    const sw = Math.min(vw - sx - 4, rect.width + pad * 2);
    const sh = Math.min(vh - sy - 4, rect.height + pad * 2);

    this.spotlight.style.left = `${sx}px`;
    this.spotlight.style.top = `${sy}px`;
    this.spotlight.style.width = `${sw}px`;
    this.spotlight.style.height = `${sh}px`;
    this.spotlight.classList.add("visible");

    // Measure card and position smartly without clipping viewport
    const cardRect = this.card.getBoundingClientRect();
    const cw = cardRect.width || 420;
    const ch = cardRect.height || 260;
    const gap = 16;

    let left = sx + sw + gap;
    let top = sy;

    if (step.placement === "bottom") {
      left = sx + sw / 2 - cw / 2;
      top = sy + sh + gap;
      if (top + ch > vh - 16) {
        top = sy - ch - gap;
      }
    } else if (step.placement === "right") {
      left = sx + sw + gap;
      top = sy + Math.min(sh / 2 - ch / 2, 40);
      if (left + cw > vw - 16) {
        left = sx - cw - gap;
      }
    } else if (step.placement === "left") {
      left = sx - cw - gap;
      top = sy;
    } else {
      left = sx + sw / 2 - cw / 2;
      top = sy - ch - gap;
    }

    // Clamp inside viewport
    left = Math.max(16, Math.min(left, vw - cw - 16));
    top = Math.max(16, Math.min(top, vh - ch - 16));

    this.card.style.left = `${Math.round(left)}px`;
    this.card.style.top = `${Math.round(top)}px`;
  }
}
