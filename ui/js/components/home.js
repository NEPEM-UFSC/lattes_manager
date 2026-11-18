// Tela inicial (Home) em 5 abas: Visão Geral, Estatísticas, Atalhos Rápidos, Categorias e Atividade Recente

import { api } from "../api.js";
import { CATEGORY_SCHEMAS, escapeHtml, showToast } from "../utils.js";
import { PALETTE } from "./charts.js";

const CAT_ICONS = {
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

const EXTERNAL_LINKS = [
  {
    icon: "🌐",
    title: "Plataforma Lattes",
    sub: "lattes.cnpq.br",
    url: "https://lattes.cnpq.br/",
    primary: true,
  },
  {
    icon: "🔎",
    title: "Busca Textual Lattes",
    sub: "buscatextual.cnpq.br",
    url: "https://buscatextual.cnpq.br/buscatextual/busca.do",
  },
  {
    icon: "🆔",
    title: "ORCID",
    sub: "orcid.org",
    url: "https://orcid.org/",
  },
  {
    icon: "📖",
    title: "Periódicos CAPES",
    sub: "periodicos.capes.gov.br",
    url: "https://www.periodicos.capes.gov.br/",
  },
  {
    icon: "🧪",
    title: "Diretório de Grupos (DGP)",
    sub: "lattes.cnpq.br/web/dgp",
    url: "https://lattes.cnpq.br/web/dgp",
  },
  {
    icon: "🏛️",
    title: "Plataforma Sucupira",
    sub: "sucupira.capes.gov.br",
    url: "https://sucupira.capes.gov.br/",
  },
  {
    icon: "🎓",
    title: "Google Scholar",
    sub: "scholar.google.com",
    url: "https://scholar.google.com/",
  },
  {
    icon: "📎",
    title: "Crossref Search",
    sub: "search.crossref.org",
    url: "https://search.crossref.org/",
  },
];

const MAINTENANCE_TOOLS = [
  {
    tool: "padronizar",
    icon: "✨",
    title: "Padronizar Textos",
    desc: "Corrige maiúsculas, espaços e nomes nos registros com prévia.",
  },
  {
    tool: "renomear",
    icon: "🏷️",
    title: "Renomear Comprovantes",
    desc: "Padroniza arquivos como 001_titulo_do_trabalho.pdf.",
  },
  {
    tool: "verificar",
    icon: "🩺",
    title: "Verificar Integridade",
    desc: "Detecta arquivos ausentes e comprovantes órfãos nas pastas.",
  },
  {
    tool: "qualis",
    icon: "🏆",
    title: "Completar Qualis",
    desc: "Preenche estratos vazios com base nos periódicos já classificados.",
  },
  {
    tool: "dois",
    icon: "🔗",
    title: "Extrair DOIs",
    desc: "Lê DOIs dentro dos PDFs ou busca automaticamente na Crossref.",
  },
  {
    tool: "pdfs",
    icon: "⚡",
    title: "Baixar PDFs por DOI",
    desc: "Obtém PDFs em acesso aberto para produções sem anexo.",
  },
  {
    tool: "formatar",
    icon: "🔤",
    title: "Formatador ABNT / Datas",
    desc: "Converte nomes (ABNT/Vancouver), títulos e datas instantaneamente.",
  },
];

const QUICK_TIPS = [
  {
    key: "Ctrl + K",
    title: "Busca instantânea",
    desc: "Foca o campo de pesquisa na categoria aberta para localizar qualquer título ou autor.",
  },
  {
    key: "Ctrl + N",
    title: "Novo registro rápido",
    desc: "Abre diretamente o formulário de cadastro na categoria em visualização.",
  },
  {
    key: "Arrastar PDF",
    title: "Anexo por drag-and-drop",
    desc: "Solte um PDF sobre qualquer linha da tabela para vinculá-lo ou no topo para classificar.",
  },
  {
    key: "Seleção em Lote",
    title: "Edição múltipla",
    desc: "Marque vários registros na tabela para atualizar ano, tipo ou Qualis simultaneamente.",
  },
];

const QUALIS_GROUPS = [
  { key: "A1", label: "A1", color: "#10b981" },
  { key: "A2", label: "A2", color: "#22c55e" },
  { key: "A3", label: "A3", color: "#06b6d4" },
  { key: "A4", label: "A4", color: "#3b82f6" },
  { key: "B", label: "B1–B4", color: "#8b5cf6" },
  { key: "C", label: "B5/C", color: "#f59e0b" },
  { key: "SQ", label: "SQ / Sem", color: "#94a3b8" },
];

function openExternal(url) {
  if (!url) return;
  if (api.hasTauri()) {
    api.openUrl(url).catch((e) => showToast(`Não foi possível abrir o link: ${e}`, "error"));
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString("pt-BR");
}

function recordHeadline(r) {
  return r.titulo || r.descricao || r.disciplina || r.curso || r.aluno || `Registro #${r.id}`;
}

function recordSecondary(r) {
  const parts = [r.journal, r.curso, r.aluno].filter((v) => v && String(v).trim());
  return parts.join(" · ");
}

function formatDateTime(log) {
  const s = String(log || "");
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/);
  if (!m) return "";
  return m[4] ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : `${m[3]}/${m[2]}/${m[1]}`;
}

function parseLogSortKey(log) {
  const s = String(log || "");
  const m = s.match(/\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?/);
  return m ? m[0].replace("T", " ") : "";
}

function qualisBucket(raw) {
  const q = String(raw || "").trim().toUpperCase();
  if (q === "A1" || q === "A2" || q === "A3" || q === "A4") return q;
  if (q === "B1" || q === "B2" || q === "B3" || q === "B4") return "B";
  if (q === "B5" || q === "C") return "C";
  return "SQ";
}

function hasAttachment(r) {
  return Boolean(r?.path && String(r.path).trim());
}

export class HomeView {
  constructor(callbacks = {}) {
    this.el = callbacks.container;
    this.cb = callbacks;
    this.activeTab = "overview";
    this.recentFilter = "all";
    this.recentMap = new Map();
    this._allRecent = [];
    this._bound = false;
  }

  setTab(tabId, { focusTab = false } = {}) {
    const valid = new Set(["overview", "stats", "shortcuts", "categories", "recent"]);
    if (!valid.has(tabId)) return;
    this.activeTab = tabId;
    if (!this.el) return;

    this.el.querySelectorAll("[data-home-tab]").forEach((btn) => {
      const isOn = btn.dataset.homeTab === tabId;
      btn.classList.toggle("active", isOn);
      btn.setAttribute("aria-selected", isOn ? "true" : "false");
      btn.tabIndex = isOn ? 0 : -1;
      if (isOn && focusTab) btn.focus();
    });

    this.el.querySelectorAll("[data-tab-panel]").forEach((panel) => {
      const isOn = panel.dataset.tabPanel === tabId;
      panel.hidden = !isOn;
      panel.classList.toggle("active", isOn);
    });
  }

  setRecentFilter(filterKey) {
    this.recentFilter = filterKey;
    if (!this.el) return;
    this.el.querySelectorAll("[data-recent-filter]").forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.recentFilter === filterKey);
    });
    const host = this.el.querySelector("#hm-recent-host");
    if (host) {
      host.innerHTML = this.renderRecentItems();
    }
  }

  renderRecentItems() {
    const filtered = this._allRecent.filter((r) => {
      if (this.recentFilter === "with_file") return hasAttachment(r);
      if (this.recentFilter === "pending") return !hasAttachment(r);
      return true;
    });
    const list = filtered.slice(0, 16);

    if (!this._allRecent.length) {
      return `
        <div class="hm-recent-empty">
          <span>✨</span>
          <p>Seus registros mais recentes aparecerão aqui. Comece importando seu XML do Lattes ou adicionando uma produção.</p>
          <button type="button" class="btn btn-primary btn-sm" data-home-action="xml">🧬 Importar XML do Lattes</button>
        </div>`;
    }

    if (!list.length) {
      return `
        <div class="hm-recent-empty">
          <span>🔍</span>
          <p>Nenhum registro recente corresponde ao filtro selecionado.</p>
        </div>`;
    }

    return `
      <div class="hm-recent-list">
        ${list
        .map((r) => {
          const cat = r.category || "producoes";
          const color = PALETTE[cat] || CATEGORY_SCHEMAS[cat]?.color || "#6366f1";
          const label = CATEGORY_SCHEMAS[cat]?.group || cat;
          const dt = formatDateTime(r.log);
          const hasFile = hasAttachment(r);
          const key = `${cat}:${r.id}`;
          const secondary = recordSecondary(r);
          const subLine = [r.tipo, secondary].filter(Boolean).join(" · ");
          return `
            <div class="hm-recent-item" data-recent-key="${escapeHtml(key)}" role="button" tabindex="0">
              <div class="hm-recent-bar" style="background:${escapeHtml(color)}"></div>
              <div class="hm-recent-body">
                <div class="hm-recent-top">
                  <span class="hm-recent-cat" style="--c:${escapeHtml(color)}">${escapeHtml(label)}</span>
                  ${r.ano ? `<span class="hm-recent-year">${escapeHtml(String(r.ano))}</span>` : ""}
                  ${r.qualis ? `<span class="hm-recent-qualis">${escapeHtml(String(r.qualis))}</span>` : ""}
                  <span class="hm-recent-file ${hasFile ? "ok" : "pend"}">${hasFile ? "📎 PDF" : "Sem anexo"}</span>
                  ${dt ? `<span class="hm-recent-date">${escapeHtml(dt)}</span>` : ""}
                </div>
                <b class="hm-recent-title" title="${escapeHtml(recordHeadline(r))}">${escapeHtml(recordHeadline(r))}</b>
                ${subLine ? `<small class="hm-recent-sub" title="${escapeHtml(subLine)}">${escapeHtml(subLine)}</small>` : ""}
              </div>
              ${hasFile
              ? `<button type="button" class="ibtn" data-home-peek="${escapeHtml(key)}" title="Visualizar comprovante">👁</button>`
              : `<span class="hm-recent-arrow" aria-hidden="true">→</span>`
            }
            </div>`;
        })
        .join("")}
      </div>`;
  }

  bindDelegatedEvents() {
    if (this._bound || !this.el) return;
    this._bound = true;

    this.el.addEventListener("keydown", (e) => {
      const tabBtn = e.target.closest("[data-home-tab]");
      if (tabBtn && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        const order = ["overview", "stats", "shortcuts", "categories", "recent"];
        const idx = order.indexOf(tabBtn.dataset.homeTab);
        const nextIdx = e.key === "ArrowRight" ? (idx + 1) % order.length : (idx - 1 + order.length) % order.length;
        this.setTab(order[nextIdx], { focusTab: true });
        return;
      }

      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest("button")) return;

      const recentBtn = e.target.closest("[data-recent-key]");
      if (recentBtn) {
        e.preventDefault();
        const rec = this.recentMap.get(recentBtn.dataset.recentKey);
        if (rec) this.cb.onOpenRecentRecord?.(rec);
        return;
      }

      const catCard = e.target.closest("[data-home-cat]");
      if (catCard) {
        e.preventDefault();
        this.cb.onNavigateCategory?.(catCard.dataset.homeCat);
      }
    });

    this.el.addEventListener("click", async (e) => {
      const tabBtn = e.target.closest("[data-home-tab]");
      if (tabBtn) {
        this.setTab(tabBtn.dataset.homeTab);
        return;
      }

      const goTab = e.target.closest("[data-go-tab]");
      if (goTab) {
        this.setTab(goTab.dataset.goTab);
        this.el.scrollTop = 0;
        return;
      }

      const filterBtn = e.target.closest("[data-recent-filter]");
      if (filterBtn) {
        this.setRecentFilter(filterBtn.dataset.recentFilter);
        return;
      }

      const ext = e.target.closest("[data-open-url]");
      if (ext) {
        e.preventDefault();
        openExternal(ext.dataset.openUrl);
        return;
      }

      const newCatBtn = e.target.closest("[data-home-new-cat]");
      if (newCatBtn) {
        e.stopPropagation();
        this.cb.onCreateInCategory?.(newCatBtn.dataset.homeNewCat);
        return;
      }

      const toolBtn = e.target.closest("[data-home-tool]");
      if (toolBtn) {
        this.cb.onOpenTool?.(toolBtn.dataset.homeTool);
        return;
      }

      const peek = e.target.closest("[data-home-peek]");
      if (peek) {
        e.stopPropagation();
        const rec = this.recentMap.get(peek.dataset.homePeek);
        if (rec) this.cb.onPreviewRecord?.(rec);
        return;
      }

      const recentBtn = e.target.closest("[data-recent-key]");
      if (recentBtn) {
        const rec = this.recentMap.get(recentBtn.dataset.recentKey);
        if (rec) this.cb.onOpenRecentRecord?.(rec);
        return;
      }

      const catBtn = e.target.closest("[data-home-cat]");
      if (catBtn) {
        this.cb.onNavigateCategory?.(catBtn.dataset.homeCat);
        return;
      }

      const act = e.target.closest("[data-home-action]")?.dataset.homeAction;
      if (!act) return;

      switch (act) {
        case "xml":
          this.cb.onOpenXmlImport?.();
          break;
        case "doi":
          this.cb.onOpenNewFromDoi?.();
          break;
        case "pdf":
          this.cb.onOpenNewFromPdf?.();
          break;
        case "batch":
          this.cb.onOpenBatchImport?.();
          break;
        case "report":
          this.cb.onOpenReport?.();
          break;
        case "linker":
          this.cb.onOpenLinker?.();
          break;
        case "charts":
          this.cb.onOpenCharts?.();
          break;
        case "backup":
          this.cb.onOpenBackup?.();
          break;
        case "tools":
          this.cb.onOpenTools?.();
          break;
        case "subfolders":
          this.cb.onOpenSubfolders?.();
          break;
        case "settings":
          this.cb.onOpenSettings?.();
          break;
        case "about":
          this.cb.onOpenAbout?.();
          break;
        case "tab-categories":
          this.setTab("categories");
          break;
        case "folder":
          api.openFolder("").catch((err) => showToast(`Não foi possível abrir a pasta: ${err}`, "error"));
          break;
        default:
          break;
      }
    });
  }

  async show() {
    if (!this.el) return;
    this.bindDelegatedEvents();

    const [versionRaw, stats, xmlProfile, savedProfile, dataDirInfo, allRecordsMap] = await Promise.all([
      api.getAppVersion().catch(() => null),
      api.getAppStats().catch(() => null),
      api.getLattesProfile().catch(() => null),
      api.getSetting("profile").catch(() => null),
      api.getDataDirInfo().catch(() => null),
      api.getAllRecords().catch(() => null),
    ]);

    const profile =
      xmlProfile || savedProfile?.values
        ? { ...(xmlProfile || {}), ...(savedProfile?.values || {}) }
        : null;
    const version = versionRaw || "1.0.0";
    const counts = stats?.counts_by_category || {};
    const withFileMap = stats?.with_file_by_category || {};
    const catKeys = Object.keys(CATEGORY_SCHEMAS);
    const recordCatKeys = catKeys.filter((k) => k !== "dadosgerais");

    let totalRecords = Number(stats?.total_records ?? 0);
    if (!stats) {
      totalRecords = recordCatKeys.reduce((acc, k) => acc + (allRecordsMap?.[k]?.length || 0), 0);
    }

    let totalWithFile = 0;
    let hasCoverageData = false;
    let fullCovCats = 0;
      for (const k of recordCatKeys) {
        const catCount = Number(counts[k] ?? allRecordsMap?.[k]?.length ?? 0);
        let catWf = 0;
        let catHasCov = false;
        if (withFileMap[k] != null) {
          catWf = Number(withFileMap[k]) || 0;
          catHasCov = true;
        } else if (Array.isArray(allRecordsMap?.[k])) {
          catWf = allRecordsMap[k].filter(hasAttachment).length;
          catHasCov = true;
        }
        if (catHasCov) {
          totalWithFile += catWf;
          hasCoverageData = true;
          if (catCount > 0 && catWf >= catCount) fullCovCats += 1;
        }
      }

      const covPct = totalRecords > 0 && hasCoverageData ? Math.round((totalWithFile / totalRecords) * 100) : 0;
      const pendingFiles = Math.max(0, totalRecords - totalWithFile);
      const ringCirc = 2 * Math.PI * 19;
      const ringOffset = ringCirc * (1 - covPct / 100);

      const prods = Array.isArray(allRecordsMap?.producoes) ? allRecordsMap.producoes : null;
      const prodsCount = Number(counts.producoes ?? prods?.length ?? 0);
      const prodsWithDoiOrUrl = prods
        ? prods.filter((r) => String(r.identifier || "").includes("10.") || String(r.url || "").trim()).length
        : null;
      const prodsMissingDoi = prods ? Math.max(0, prods.length - prodsWithDoiOrUrl) : null;
      const prodsTopQualis = prods
        ? prods.filter((r) => ["A1", "A2"].includes(String(r.qualis || "").trim().toUpperCase())).length
        : null;

      // Distribuição Qualis
      const qualisCounts = Object.fromEntries(QUALIS_GROUPS.map((g) => [g.key, 0]));
      if (prods) {
        for (const r of prods) {
          qualisCounts[qualisBucket(r.qualis)] += 1;
        }
      }
      const prodsMissingQualis = prods ? qualisCounts.SQ : null;

      // Consolidação por categoria, evolução anual e atividade recente
      const currentYear = new Date().getFullYear();
      const yearTotals = new Map();
      const yearCatBreakdown = new Map();
      const flatRecent = [];
      this.recentMap.clear();

      if (allRecordsMap && typeof allRecordsMap === "object") {
        for (const [cat, list] of Object.entries(allRecordsMap)) {
          if (!Array.isArray(list)) continue;
          for (const r of list) {
            const norm = { ...r, category: r.category || cat };
            flatRecent.push(norm);
            const y = Number(r.ano);
            if (Number.isInteger(y) && y >= 1950 && y <= currentYear + 2) {
              yearTotals.set(y, (yearTotals.get(y) || 0) + 1);
              if (!yearCatBreakdown.has(y)) yearCatBreakdown.set(y, new Map());
              const m = yearCatBreakdown.get(y);
              m.set(cat, (m.get(cat) || 0) + 1);
            }
          }
        }
        flatRecent.sort((a, b) => {
          const da = parseLogSortKey(a.log);
          const db = parseLogSortKey(b.log);
          if (db !== da) return db.localeCompare(da);
          return Number(b.id || 0) - Number(a.id || 0);
        });
      }

      this._allRecent = flatRecent;
      for (const r of flatRecent) {
        this.recentMap.set(`${r.category}:${r.id}`, r);
      }

      const yearsSorted = [...yearTotals.keys()].sort((a, b) => a - b);
      const minYear = yearsSorted.length ? yearsSorted[0] : null;
      const maxYear = yearsSorted.length ? yearsSorted[yearsSorted.length - 1] : null;
      const recentYears = yearsSorted.slice(-8);
      const maxYearCount = recentYears.reduce((mx, y) => Math.max(mx, yearTotals.get(y) || 0), 0);

      let peakYear = null;
      let peakCount = 0;
      let totalYearRecords = 0;
      for (const y of yearsSorted) {
        const c = yearTotals.get(y) || 0;
        totalYearRecords += c;
        if (c >= peakCount) {
          peakCount = c;
          peakYear = y;
        }
      }
      const avgPerYear = yearsSorted.length ? (totalYearRecords / yearsSorted.length).toFixed(1) : "0";
      const recent4End = maxYear || currentYear;
      const recent4Start = recent4End - 3;
      let recent4Sum = 0;
      for (let y = recent4Start; y <= recent4End; y += 1) {
        recent4Sum += yearTotals.get(y) || 0;
      }

      // Indicadores acadêmicos consolidados
      const discList = Array.isArray(allRecordsMap?.disciplinas) ? allRecordsMap.disciplinas : null;
      const discCount = Number(counts.disciplinas ?? discList?.length ?? 0);
      const totalHoras = discList ? discList.reduce((s, r) => s + (Number(r.horas) || 0), 0) : null;
      const totalAlunos = discList ? discList.reduce((s, r) => s + (Number(r.alunos) || 0), 0) : null;

      const formCount = Number(counts.formacao ?? allRecordsMap?.formacao?.length ?? 0);
      const orientCount = Number(counts.orientacoes ?? allRecordsMap?.orientacoes?.length ?? 0);
      const bancasCount = Number(counts.bancas ?? allRecordsMap?.bancas?.length ?? 0);
      const projCount = Number(counts.projetos ?? allRecordsMap?.projetos?.length ?? 0);
      const patCount = Number(counts.patentes ?? allRecordsMap?.patentes?.length ?? 0);
      const evCount = Number(counts.eventos ?? allRecordsMap?.eventos?.length ?? 0);
      const encCount = Number(counts.encargos ?? allRecordsMap?.encargos?.length ?? 0);

      const activeCatsCount = recordCatKeys.filter((k) => Number(counts[k] ?? allRecordsMap?.[k]?.length ?? 0) > 0).length;
      const firstName = profile?.nome ? String(profile.nome).trim().split(/\s+/)[0] : "";
      const greeting = firstName ? `Olá, ${firstName}` : "Bem-vindo ao Lattes Manager";
      const profileOrg = [profile?.cargo, profile?.instituicao].filter(Boolean).join(" · ");
      const dataDir = dataDirInfo?.data_dir || stats?.db_path || "Pasta padrão local";
      const dataDirShort = dataDir.length > 42 ? `…${dataDir.slice(-41)}` : dataDir;
      const orcidUrl = profile?.orcid
        ? profile.orcid.startsWith("http")
          ? profile.orcid
          : `https://orcid.org/${profile.orcid}`
        : null;

      const shortcuts = [
        {
          action: "xml",
          icon: "🧬",
          tone: "#6366f1",
          title: "Importar XML do Lattes",
          desc: "Importe produções, formação, bancas, orientações e projetos direto do arquivo XML do CNPq.",
          tag: `${recordCatKeys.length} categorias`,
        },
        {
          action: "doi",
          icon: "⚡",
          tone: "#f59e0b",
          title: "Nova Produção por DOI",
          desc: "Informe um DOI para preencher título, periódico, ano e baixar automaticamente o PDF aberto.",
          tag: "Crossref + OpenAlex",
        },
        {
          action: "pdf",
          icon: "✨",
          tone: "#06b6d4",
          title: "Cadastrar a partir de PDF",
          desc: "Selecione um certificado ou artigo e deixe o app classificar a categoria e sugerir campos.",
          tag: "Classificador local",
        },
        {
          action: "batch",
          icon: "🗂️",
          tone: "#8b5cf6",
          title: "Importação em Lote",
          desc: "Processe uma pasta com dezenas de comprovantes, revise as sugestões e salve tudo de uma vez.",
          tag: "Alta produtividade",
        },
        {
          action: "report",
          icon: "📑",
          tone: "#10b981",
          title: "Gerar Caderno PDF",
          desc: "Monte um PDF único com capa, sumário clicável, listas numeradas e todos os anexos carimbados.",
          tag: "Progressão / Relatório",
        },
        {
          action: "linker",
          icon: "🔗",
          tone: "#3b82f6",
          title: "Vincular Comprovantes",
          desc: "Encontre PDFs soltos nas subpastas compatíveis com registros sem anexo e revise duplicatas.",
          tag: pendingFiles > 0 && hasCoverageData ? `${fmtNum(pendingFiles)} pendentes` : "Manutenção",
        },
        {
          action: "charts",
          icon: "📈",
          tone: "#ec4899",
          title: "Painel de Indicadores",
          desc: "Explore séries anuais, estratos Qualis, nuvem de periódicos e exporte para Excel ou HTML.",
          tag: "Análise visual",
        },
        {
          action: "backup",
          icon: "🛟",
          tone: "#14b8a6",
          title: "Backup & Restauração",
          desc: "Gere um pacote .zip seguro com seu banco SQLite e comprovantes ou restaure versões anteriores.",
          tag: "Segurança local",
        },
      ];

      const yearBarsHtml = recentYears.length
        ? `
        <div class="hm-year-summary">
          <div class="hm-ys-item">
            <span>Ano pico</span>
            <b>${peakYear} <small>(${fmtNum(peakCount)} reg.)</small></b>
          </div>
          <div class="hm-ys-item">
            <span>Média / ano ativo</span>
            <b>${escapeHtml(String(avgPerYear).replace(".", ","))} <small>(${yearsSorted.length} anos)</small></b>
          </div>
          <div class="hm-ys-item">
            <span>Último quadriênio</span>
            <b>${recent4Start}–${recent4End} <small>(${fmtNum(recent4Sum)} reg.)</small></b>
          </div>
        </div>
        <div class="hm-year-chart" role="img" aria-label="Evolução anual dos registros">
          ${recentYears
          .map((y) => {
            const cnt = yearTotals.get(y) || 0;
            const hPct = maxYearCount > 0 ? Math.max(8, Math.round((cnt / maxYearCount) * 100)) : 8;
            const breakdown = [...(yearCatBreakdown.get(y)?.entries() || [])]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([c, n]) => `${CATEGORY_SCHEMAS[c]?.group || c}: ${n}`)
              .join(" · ");
            const tip = `${y}: ${cnt} registros${breakdown ? ` (${breakdown})` : ""}`;
            return `
              <div class="hm-year-col ${y === peakYear ? "peak" : ""}" title="${escapeHtml(tip)}">
                <span class="hm-year-cnt">${fmtNum(cnt)}</span>
                <div class="hm-year-track">
                  <div class="hm-year-bar" style="height:${hPct}%"></div>
                </div>
                <span class="hm-year-lbl">${y}</span>
              </div>`;
          })
          .join("")}
        </div>`
        : `<div class="hm-empty-mini">Importe seu XML ou cadastre registros com ano para visualizar a série histórica.</div>`;

      const qualisTotal = prods ? prods.length : 0;
      const qualisHtml = qualisTotal > 0
        ? `
        <div class="hm-qualis-wrap">
          <div class="hm-qualis-head">
            <span>Distribuição Qualis das Produções</span>
            <small>${fmtNum(qualisTotal)} produções analisadas</small>
          </div>
          <div class="hm-qualis-bar">
            ${QUALIS_GROUPS.map((g) => {
          const c = qualisCounts[g.key] || 0;
          if (!c) return "";
          const pct = (c / qualisTotal) * 100;
          return `<span class="hm-q-seg" style="width:${pct.toFixed(2)}%;--qc:${g.color}" title="${g.label}: ${c} (${Math.round(pct)}%)"></span>`;
        }).join("")}
          </div>
          <div class="hm-qualis-legend">
            ${QUALIS_GROUPS.map((g) => {
          const c = qualisCounts[g.key] || 0;
          if (!c) return "";
          return `<span class="hm-q-chip" style="--qc:${g.color}"><i></i>${g.label}: <b>${fmtNum(c)}</b></span>`;
        }).join("")}
          </div>
        </div>`
        : `<div class="hm-empty-mini">Cadastre produções para visualizar o perfil de estratos Qualis.</div>`;

      const miniMetrics = [
        {
          cat: "formacao",
          icon: "🎓",
          label: "Formação & Pós",
          val: fmtNum(formCount),
          sub: "Títulos e aperfeiçoamentos",
        },
        {
          cat: "disciplinas",
          icon: "📚",
          label: "Ensino (Disciplinas)",
          val: fmtNum(discCount),
          sub:
            totalHoras != null
              ? `${fmtNum(totalHoras)}h aula${totalAlunos ? ` · ${fmtNum(totalAlunos)} alunos` : ""}`
              : "Turmas de graduação/pós",
        },
        {
          cat: "orientacoes",
          icon: "👥",
          label: "Orientações",
          val: fmtNum(orientCount),
          sub: "IC, TCC, mestrado e doutorado",
        },
        {
          cat: "bancas",
          icon: "⚖️",
          label: "Bancas Examinadoras",
          val: fmtNum(bancasCount),
          sub: "Defesas e qualificações",
        },
        {
          cat: "projetos",
          icon: "🔬",
          label: "Projetos & Patentes",
          val: fmtNum(projCount + patCount),
          sub: `${fmtNum(projCount)} projetos · ${fmtNum(patCount)} patentes`,
        },
        {
          cat: "eventos",
          icon: "🎙️",
          label: "Eventos & Encargos",
          val: fmtNum(evCount + encCount),
          sub: `${fmtNum(evCount)} eventos · ${fmtNum(encCount)} encargos`,
        },
      ];

      const totalShortcutsBadge = shortcuts.length + MAINTENANCE_TOOLS.length;
      const isTab = (id) => this.activeTab === id;

      this.el.innerHTML = `
      <div class="hm-wrap">
        <!-- BARRA DE ABAS -->
        <div class="hm-tabs-bar">
          <div class="hm-tabs" role="tablist" aria-label="Seções da tela inicial">
            <button
              type="button"
              role="tab"
              id="hm-tab-overview"
              aria-controls="hm-panel-overview"
              aria-selected="${isTab("overview")}"
              tabindex="${isTab("overview") ? 0 : -1}"
              class="hm-tab ${isTab("overview") ? "active" : ""}"
              data-home-tab="overview"
            >
              <span>🏠</span>
              <span>Visão Geral</span>
              <span class="hm-tab-badge">v${escapeHtml(version)}</span>
            </button>

            <button
              type="button"
              role="tab"
              id="hm-tab-stats"
              aria-controls="hm-panel-stats"
              aria-selected="${isTab("stats")}"
              tabindex="${isTab("stats") ? 0 : -1}"
              class="hm-tab ${isTab("stats") ? "active" : ""}"
              data-home-tab="stats"
            >
              <span>📊</span>
              <span>Estatísticas</span>
              <span class="hm-tab-badge">${fmtNum(totalRecords)}</span>
            </button>

            <button
              type="button"
              role="tab"
              id="hm-tab-shortcuts"
              aria-controls="hm-panel-shortcuts"
              aria-selected="${isTab("shortcuts")}"
              tabindex="${isTab("shortcuts") ? 0 : -1}"
              class="hm-tab ${isTab("shortcuts") ? "active" : ""}"
              data-home-tab="shortcuts"
            >
              <span>⚡</span>
              <span>Atalhos Rápidos</span>
              <span class="hm-tab-badge">${totalShortcutsBadge}</span>
            </button>

            <button
              type="button"
              role="tab"
              id="hm-tab-categories"
              aria-controls="hm-panel-categories"
              aria-selected="${isTab("categories")}"
              tabindex="${isTab("categories") ? 0 : -1}"
              class="hm-tab ${isTab("categories") ? "active" : ""}"
              data-home-tab="categories"
            >
              <span>🗂️</span>
              <span>Categorias do Currículo</span>
              <span class="hm-tab-badge">${activeCatsCount}/${recordCatKeys.length}</span>
            </button>

            <button
              type="button"
              role="tab"
              id="hm-tab-recent"
              aria-controls="hm-panel-recent"
              aria-selected="${isTab("recent")}"
              tabindex="${isTab("recent") ? 0 : -1}"
              class="hm-tab ${isTab("recent") ? "active" : ""}"
              data-home-tab="recent"
            >
              <span>🕒</span>
              <span>Atividade Recente</span>
              <span class="hm-tab-badge">${fmtNum(Math.min(flatRecent.length, 16))}</span>
            </button>
          </div>
        </div>

        <!-- ABA 1: VISÃO GERAL -->
        <div
          id="hm-panel-overview"
          role="tabpanel"
          aria-labelledby="hm-tab-overview"
          data-tab-panel="overview"
          class="hm-tab-panel ${isTab("overview") ? "active" : ""}"
          ${isTab("overview") ? "" : "hidden"}
        >
          <section class="hm-hero">
            <div class="hm-orb a" aria-hidden="true"></div>
            <div class="hm-orb b" aria-hidden="true"></div>

            <div class="hm-hero-main">
              <div class="hm-logo-card">
                <img src="icons/home.png" alt="Logo Lattes Manager" class="hm-logo" />
              </div>

              <div class="hm-hero-copy">
                <div class="hm-badges">
                  <span class="hm-ver-pill">Versão ${escapeHtml(version)}</span>
                  <span class="hm-meta-pill">🔒 100% Local · SQLite</span>
                  ${profile?.atualizacao ? `<span class="hm-meta-pill">🧬 XML de ${escapeHtml(profile.atualizacao)}</span>` : ""}
                  ${profile?.lattes_id ? `<span class="hm-meta-pill">🪪 ID ${escapeHtml(profile.lattes_id)}</span>` : ""}
                  ${orcidUrl ? `<span class="hm-meta-pill">🆔 ORCID vinculado</span>` : ""}
                </div>
                <h2>${escapeHtml(greeting)}</h2>
                ${profileOrg ? `<p class="hm-profile-line">${escapeHtml(profileOrg)}</p>` : ""}
                <p class="hm-desc">
                  Plataforma desktop para organizar todas as categorias do seu Currículo Lattes, vincular comprovantes
                  em PDF com classificação inteligente e gerar cadernos completos de progressão — tudo armazenado
                  localmente com privacidade total.
                </p>

                <div class="hm-hero-actions">
                  <button type="button" class="hm-btn-lattes" data-open-url="https://lattes.cnpq.br/">
                    <span>🌐</span> Plataforma Lattes (CNPq) <i aria-hidden="true">↗</i>
                  </button>
                  ${profile?.lattes_url
          ? `<button type="button" class="hm-btn-ghost" data-open-url="${escapeHtml(profile.lattes_url)}">
                          <span>🪪</span> Meu Currículo no CNPq <i>↗</i>
                        </button>`
          : ""
        }
                  <button type="button" class="hm-btn-ghost" data-home-action="xml">
                    <span>🧬</span> Importar XML
                  </button>
                  <button type="button" class="hm-btn-ghost" data-home-action="report">
                    <span>📑</span> Gerar Comprovantes
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section class="hm-kpis">
            <div class="hm-kpi">
              <div class="hm-kpi-top">
                <span class="hm-kpi-lbl">Total no Currículo</span>
                <span class="hm-kpi-ic" style="--c:#6366f1">🗂️</span>
              </div>
              <div class="hm-kpi-val">${fmtNum(totalRecords)}</div>
              <div class="hm-kpi-sub">
                ${activeCatsCount} categorias ativas · ${fmtNum(stats?.total_mappings ?? 0)} subpastas
                ${minYear && maxYear ? ` · ${minYear}–${maxYear}` : ""}
              </div>
            </div>

            <div class="hm-kpi hm-kpi-ring">
              <div class="hm-kpi-ring-body">
                <div>
                  <span class="hm-kpi-lbl">Cobertura de Comprovantes</span>
                  <div class="hm-kpi-val">${hasCoverageData ? `${covPct}%` : "—"}</div>
                  <div class="hm-kpi-sub">
                    ${hasCoverageData
          ? `${fmtNum(totalWithFile)} de ${fmtNum(totalRecords)} anexados`
          : "Estatística disponível no app desktop"
        }
                  </div>
                </div>
                <div class="hm-ring" aria-hidden="true">
                  <svg viewBox="0 0 48 48">
                    <circle class="hm-ring-track" cx="24" cy="24" r="19"></circle>
                    <circle
                      class="hm-ring-fill"
                      cx="24"
                      cy="24"
                      r="19"
                      stroke-dasharray="${ringCirc.toFixed(2)}"
                      stroke-dashoffset="${ringOffset.toFixed(2)}"
                    ></circle>
                  </svg>
                  <span>${hasCoverageData ? `${covPct}%` : "PDF"}</span>
                </div>
              </div>
              ${hasCoverageData && pendingFiles > 0
          ? `<button type="button" class="hm-kpi-link" data-home-action="linker">🔗 Vincular ${fmtNum(pendingFiles)} sem comprovante →</button>`
          : ""
        }
            </div>

            <div class="hm-kpi">
              <div class="hm-kpi-top">
                <span class="hm-kpi-lbl">Produções Intelectuais</span>
                <span class="hm-kpi-ic" style="--c:#3b82f6">📄</span>
              </div>
              <div class="hm-kpi-val">${fmtNum(prodsCount)}</div>
              <div class="hm-kpi-sub">
                ${prodsWithDoiOrUrl != null
          ? `${fmtNum(prodsWithDoiOrUrl)} com DOI/URL${prodsTopQualis ? ` · ${fmtNum(prodsTopQualis)} A1/A2` : ""}`
          : "Artigos, livros, capítulos e trabalhos"
        }
              </div>
              <div class="hm-kpi-actions">
                <button type="button" class="hm-kpi-link" data-home-action="charts">📈 Abrir Indicadores →</button>
              </div>
            </div>

            <div class="hm-kpi">
              <div class="hm-kpi-top">
                <span class="hm-kpi-lbl">Base de Dados Local</span>
                <span class="hm-kpi-ic" style="--c:#10b981">💾</span>
              </div>
              <div class="hm-kpi-path mono" title="${escapeHtml(dataDir)}">${escapeHtml(dataDirShort)}</div>
              <div class="hm-kpi-sub">${dataDirInfo?.is_custom ? "Pasta personalizada ativa" : "Pasta padrão local"}</div>
              <div class="hm-kpi-actions">
                <button type="button" class="hm-kpi-link" data-home-action="folder">📂 Abrir pasta →</button>
                <button type="button" class="hm-kpi-link" data-home-action="settings">⚙️ Configurar</button>
              </div>
            </div>
          </section>

          <section class="hm-overview-nav" aria-label="Explorar painéis da tela inicial">
            <button type="button" class="hm-ov-card" data-go-tab="stats" style="--c:#6366f1">
              <div class="hm-ov-head">
                <span class="hm-ov-ic">📊</span>
                <span class="hm-ov-arrow" aria-hidden="true">→</span>
              </div>
              <b>Estatísticas do Currículo</b>
              <p>${yearsSorted.length ? `${yearsSorted.length} anos ativos · pico em ${peakYear} (${fmtNum(peakCount)} reg.)` : "Evolução anual, Qualis e saúde documental"}</p>
            </button>

            <button type="button" class="hm-ov-card" data-go-tab="shortcuts" style="--c:#f59e0b">
              <div class="hm-ov-head">
                <span class="hm-ov-ic">⚡</span>
                <span class="hm-ov-arrow" aria-hidden="true">→</span>
              </div>
              <b>Atalhos Rápidos</b>
              <p>${shortcuts.length} fluxos principais, ${MAINTENANCE_TOOLS.length} utilitários e portais</p>
            </button>

            <button type="button" class="hm-ov-card" data-go-tab="categories" style="--c:#10b981">
              <div class="hm-ov-head">
                <span class="hm-ov-ic">🗂️</span>
                <span class="hm-ov-arrow" aria-hidden="true">→</span>
              </div>
              <b>Categorias do Currículo</b>
              <p>${activeCatsCount} de ${recordCatKeys.length} com registros e acesso rápido para cadastro</p>
            </button>

            <button type="button" class="hm-ov-card" data-go-tab="recent" style="--c:#3b82f6">
              <div class="hm-ov-head">
                <span class="hm-ov-ic">🕒</span>
                <span class="hm-ov-arrow" aria-hidden="true">→</span>
              </div>
              <b>Atividade Recente</b>
              <p>${flatRecent.length ? `Últimos ${fmtNum(Math.min(flatRecent.length, 16))} registros e comprovantes` : "Últimas edições e anexos recentes"}</p>
            </button>
          </section>
        </div>

        <!-- ABA 2: ESTATÍSTICAS -->
        <div
          id="hm-panel-stats"
          role="tabpanel"
          aria-labelledby="hm-tab-stats"
          data-tab-panel="stats"
          class="hm-tab-panel ${isTab("stats") ? "active" : ""}"
          ${isTab("stats") ? "" : "hidden"}
        >
          <section class="hm-stats-grid">
            <div class="hm-panel">
              <div class="hm-panel-head">
                <h3>Evolução Anual do Currículo</h3>
                <span>${yearsSorted.length ? `Últimos ${recentYears.length} anos com registros` : "Sem histórico anual"}</span>
              </div>
              ${yearBarsHtml}
            </div>

            <div class="hm-panel">
              <div class="hm-panel-head">
                <h3>Raio-X de Produções, Ensino e Orientação</h3>
                <span>Estratos Qualis e dimensões do currículo</span>
              </div>
              ${qualisHtml}
              <div class="hm-mini-metrics">
                ${miniMetrics
          .map(
            (m) => `
                  <button type="button" class="hm-mini-metric" data-home-cat="${escapeHtml(m.cat)}">
                    <div class="hm-mm-top">
                      <span>${m.icon}</span>
                      <b>${m.val}</b>
                    </div>
                    <div class="hm-mm-lbl">${escapeHtml(m.label)}</div>
                    <small>${escapeHtml(m.sub)}</small>
                  </button>`
          )
          .join("")}
              </div>
            </div>

            <div class="hm-panel hm-panel-wide">
              <div class="hm-panel-head">
                <h3>Diagnóstico &amp; Saúde do Currículo</h3>
                <span>Pontos rápidos para deixar seu acervo e comprovantes 100% em dia</span>
              </div>
              <div class="hm-health-strip">
                <div class="hm-health-item ${fullCovCats === activeCatsCount && activeCatsCount > 0 ? "ok" : ""}">
                  <div>
                    <small>Categorias 100% documentadas</small>
                    <b>${fullCovCats} de ${activeCatsCount} ativas</b>
                  </div>
                  <button type="button" class="btn btn-secondary btn-sm" data-home-action="tab-categories">Ver categorias</button>
                </div>

                <div class="hm-health-item ${pendingFiles === 0 && hasCoverageData ? "ok" : "warn"}">
                  <div>
                    <small>Comprovantes pendentes</small>
                    <b>${hasCoverageData ? fmtNum(pendingFiles) : "—"} sem PDF</b>
                  </div>
                  <button type="button" class="btn btn-secondary btn-sm" data-home-action="linker">Vincular PDFs</button>
                </div>

                <div class="hm-health-item ${prodsMissingDoi === 0 ? "ok" : ""}">
                  <div>
                    <small>Produções sem DOI / URL</small>
                    <b>${prodsMissingDoi != null ? `${fmtNum(prodsMissingDoi)} de ${fmtNum(prods.length)}` : "—"}</b>
                  </div>
                  <button type="button" class="btn btn-secondary btn-sm" data-home-tool="dois">Extrair DOIs</button>
                </div>

                <div class="hm-health-item ${prodsMissingQualis === 0 ? "ok" : ""}">
                  <div>
                    <small>Produções sem Qualis</small>
                    <b>${prodsMissingQualis != null ? `${fmtNum(prodsMissingQualis)} registros` : "—"}</b>
                  </div>
                  <div class="hm-health-btns">
                    <button type="button" class="btn btn-secondary btn-sm" data-home-tool="qualis">Completar Qualis</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-home-cat="dadosgerais">Dados Gerais</button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- ABA 3: ATALHOS RÁPIDOS -->
        <div
          id="hm-panel-shortcuts"
          role="tabpanel"
          aria-labelledby="hm-tab-shortcuts"
          data-tab-panel="shortcuts"
          class="hm-tab-panel ${isTab("shortcuts") ? "active" : ""}"
          ${isTab("shortcuts") ? "" : "hidden"}
        >
          <section class="hm-section">
            <div class="hm-sec-head">
              <div>
                <h3>Fluxos Principais</h3>
                <p>Ações rápidas para importar do XML, cadastrar por DOI/PDF, vincular comprovantes e exportar cadernos</p>
              </div>
              <div class="hm-sec-links">
                <button type="button" class="btn-icon-subtle" data-home-action="subfolders">📁 Subpastas</button>
                <button type="button" class="btn-icon-subtle" data-home-action="tools">🧰 Ferramentas</button>
                <button type="button" class="btn-icon-subtle" data-home-action="settings">⚙️ Configurações</button>
                <button type="button" class="btn-icon-subtle" data-home-action="about">ℹ️ Sobre v${escapeHtml(version)}</button>
              </div>
            </div>

            <div class="hm-shortcuts-grid">
              ${shortcuts
          .map(
            (sc, idx) => `
                <button type="button" class="hm-sc-card" data-home-action="${sc.action}" style="--c:${sc.tone};--i:${idx}">
                  <div class="hm-sc-top">
                    <span class="hm-sc-ic">${sc.icon}</span>
                    <span class="hm-sc-tag">${escapeHtml(sc.tag)}</span>
                    <i class="hm-sc-go" aria-hidden="true">→</i>
                  </div>
                  <b>${escapeHtml(sc.title)}</b>
                  <p>${escapeHtml(sc.desc)}</p>
                </button>`
          )
          .join("")}
            </div>
          </section>

          <section class="hm-panel">
            <div class="hm-panel-head">
              <h3>Utilitários &amp; Automação do Currículo</h3>
              <span>Abra diretamente cada ferramenta de manutenção e higienização</span>
            </div>
            <div class="hm-tools-grid">
              ${MAINTENANCE_TOOLS.map(
            (t) => `
                <button type="button" class="hm-tool-chip" data-home-tool="${t.tool}">
                  <span class="hm-tool-ic">${t.icon}</span>
                  <div>
                    <b>${escapeHtml(t.title)}</b>
                    <small>${escapeHtml(t.desc)}</small>
                  </div>
                  <i aria-hidden="true">→</i>
                </button>`
          ).join("")}
            </div>
          </section>

          <section class="hm-ext-strip">
            <span class="hm-ext-label">Portais acadêmicos</span>
            <div class="hm-ext-pills">
              ${EXTERNAL_LINKS.map((lk) => {
            const url = lk.title === "ORCID" && orcidUrl ? orcidUrl : lk.url;
            return `<button type="button" class="hm-ext-pill ${lk.primary ? "primary" : ""}" data-open-url="${escapeHtml(url)}" title="${escapeHtml(url)}">
                  <span>${lk.icon}</span>
                  <span><b>${escapeHtml(lk.title)}</b><small>${escapeHtml(lk.sub)}</small></span>
                  <i aria-hidden="true">↗</i>
                </button>`;
          }).join("")}
              ${profile?.lattes_url && profile.lattes_url !== "https://lattes.cnpq.br/"
          ? `<button type="button" class="hm-ext-pill" data-open-url="${escapeHtml(profile.lattes_url)}" title="${escapeHtml(profile.lattes_url)}">
                      <span>🪪</span>
                      <span><b>Meu Currículo Lattes</b><small>${escapeHtml(profile.lattes_id || "Abrir perfil")}</small></span>
                      <i aria-hidden="true">↗</i>
                    </button>`
          : ""
        }
            </div>
          </section>

          <section class="hm-panel">
            <div class="hm-panel-head">
              <h3>Dicas Rápidas &amp; Atalhos de Teclado</h3>
              <span>Recursos para acelerar o dia a dia no gerenciamento</span>
            </div>
            <div class="hm-tips-grid">
              ${QUICK_TIPS.map(
          (tip) => `
                <div class="hm-tip-card">
                  <kbd>${escapeHtml(tip.key)}</kbd>
                  <div>
                    <b>${escapeHtml(tip.title)}</b>
                    <p>${escapeHtml(tip.desc)}</p>
                  </div>
                </div>`
        ).join("")}
            </div>
          </section>
        </div>

        <!-- ABA 4: CATEGORIAS DO CURRÍCULO -->
        <div
          id="hm-panel-categories"
          role="tabpanel"
          aria-labelledby="hm-tab-categories"
          data-tab-panel="categories"
          class="hm-tab-panel ${isTab("categories") ? "active" : ""}"
          ${isTab("categories") ? "" : "hidden"}
        >
          <section class="hm-panel hm-panel-fill">
            <div class="hm-panel-head">
              <div>
                <h3>Categorias do Currículo</h3>
                <span>${activeCatsCount} de ${recordCatKeys.length} categorias de registros · ${fmtNum(totalWithFile)} de ${fmtNum(totalRecords)} comprovantes anexados</span>
              </div>
              <div class="hm-sec-links">
                <button type="button" class="btn-icon-subtle" data-home-action="subfolders">📁 Subpastas</button>
                <button type="button" class="btn-icon-subtle" data-home-action="settings">⚙️ Categorias Personalizadas</button>
              </div>
            </div>

            <div class="hm-cats-grid">
              ${catKeys
          .map((cat) => {
            const schema = CATEGORY_SCHEMAS[cat];
            const icon = schema?.icon || CAT_ICONS[cat] || "🗂️";
            const color = PALETTE[cat] || schema?.color || "#6366f1";

            if (cat === "dadosgerais") {
              const profileLine = [profile?.nome, profile?.instituicao].filter(Boolean).join(" · ");
              return `
                    <article class="hm-cat-card" data-home-cat="dadosgerais" role="button" tabindex="0" style="--c:${escapeHtml(color)}">
                      <div class="hm-cat-top">
                        <span class="hm-cat-ic">${escapeHtml(icon)}</span>
                        <span class="hm-cat-status ok">${profile?.nome ? "Perfil ativo" : "Perfil"}</span>
                      </div>
                      <b class="hm-cat-name">Perfil do Pesquisador</b>
                      <p class="hm-cat-sub" title="${escapeHtml(profileLine || schema?.subtitle || "")}">${escapeHtml(profileLine || schema?.subtitle || "Dados gerais do pesquisador")}</p>
                      <div class="hm-cat-tags">
                        ${profile?.cargo ? `<span class="hm-cat-tag">${escapeHtml(profile.cargo)}</span>` : ""}
                        ${profile?.lattes_id ? `<span class="hm-cat-tag">Lattes ID</span>` : `<span class="hm-cat-tag">Dados Gerais</span>`}
                      </div>
                      <div class="hm-cat-foot">
                        <div class="hm-cat-meta"><span>Editar dados do pesquisador →</span></div>
                      </div>
                    </article>`;
            }

            const catList = Array.isArray(allRecordsMap?.[cat]) ? allRecordsMap[cat] : null;
            const count = Number(counts[cat] ?? catList?.length ?? 0);
            const hasCatCov = withFileMap[cat] != null || Array.isArray(catList);
            const wf =
              withFileMap[cat] != null
                ? Number(withFileMap[cat]) || 0
                : catList
                  ? catList.filter(hasAttachment).length
                  : 0;
            const pct = count > 0 && hasCatCov ? Math.round((wf / count) * 100) : 0;
            const missing = Math.max(0, count - wf);

            let catYearRange = "";
            const typeFreq = new Map();
            if (catList && catList.length) {
              let lo = Infinity;
              let hi = -Infinity;
              for (const r of catList) {
                const y = Number(r.ano);
                if (Number.isInteger(y) && y >= 1950 && y <= currentYear + 2) {
                  if (y < lo) lo = y;
                  if (y > hi) hi = y;
                }
                const tp = String(r.tipo || "").trim();
                if (tp) typeFreq.set(tp, (typeFreq.get(tp) || 0) + 1);
              }
              if (lo <= hi) {
                catYearRange = lo === hi ? String(lo) : `${lo}–${hi}`;
              }
            }

            const topTypes = [...typeFreq.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 2)
              .map(([tp, n]) => `${tp} (${n})`);

            const statusBadge =
              count === 0
                ? `<span class="hm-cat-status empty">Vazia</span>`
                : hasCatCov && missing === 0
                  ? `<span class="hm-cat-status ok">✓ 100%</span>`
                  : hasCatCov
                    ? `<span class="hm-cat-status pend">${fmtNum(missing)} sem PDF</span>`
                    : "";

            return `
                  <article class="hm-cat-card" data-home-cat="${escapeHtml(cat)}" role="button" tabindex="0" style="--c:${escapeHtml(color)}">
                    <div class="hm-cat-top">
                      <span class="hm-cat-ic">${escapeHtml(icon)}</span>
                      <span class="hm-cat-count">${fmtNum(count)}</span>
                      ${statusBadge}
                    </div>
                    <b class="hm-cat-name">${escapeHtml(schema?.group || schema?.name || cat)}</b>
                    ${schema?.subtitle ? `<p class="hm-cat-sub" title="${escapeHtml(schema.subtitle)}">${escapeHtml(schema.subtitle)}</p>` : ""}
                    ${catYearRange || topTypes.length
                ? `<div class="hm-cat-tags">
                            ${catYearRange ? `<span class="hm-cat-tag">${escapeHtml(catYearRange)}</span>` : ""}
                            ${topTypes.map((t) => `<span class="hm-cat-tag">${escapeHtml(t)}</span>`).join("")}
                          </div>`
                : ""
              }
                    <div class="hm-cat-foot">
                      <div class="hm-cat-meta">
                        ${hasCatCov && count > 0
                ? `<span>${fmtNum(wf)}/${fmtNum(count)} anexos (${pct}%)</span>`
                : `<span>${count === 0 ? "Sem registros" : "Abrir categoria"}</span>`
              }
                      </div>
                      <button type="button" class="hm-cat-new" data-home-new-cat="${escapeHtml(cat)}" title="Novo registro nesta categoria">+ Novo</button>
                    </div>
                    <div class="hm-cat-bar"><i style="width:${pct}%"></i></div>
                  </article>`;
          })
          .join("")}
            </div>
          </section>
        </div>

        <!-- ABA 5: ATIVIDADE RECENTE -->
        <div
          id="hm-panel-recent"
          role="tabpanel"
          aria-labelledby="hm-tab-recent"
          data-tab-panel="recent"
          class="hm-tab-panel ${isTab("recent") ? "active" : ""}"
          ${isTab("recent") ? "" : "hidden"}
        >
          <section class="hm-panel hm-recent-panel hm-panel-fill">
            <div class="hm-panel-head">
              <div>
                <h3>Atividade Recente</h3>
                <span>Últimas alterações e cadastros no acervo · ${fmtNum(flatRecent.filter(hasAttachment).length)} com PDF · ${fmtNum(flatRecent.filter((r) => !hasAttachment(r)).length)} sem anexo</span>
              </div>
              <div class="hm-recent-filters" role="group" aria-label="Filtrar atividade recente">
                <button type="button" class="${this.recentFilter === "all" ? "on" : ""}" data-recent-filter="all">Todos</button>
                <button type="button" class="${this.recentFilter === "with_file" ? "on" : ""}" data-recent-filter="with_file">Com PDF</button>
                <button type="button" class="${this.recentFilter === "pending" ? "on" : ""}" data-recent-filter="pending">Sem PDF</button>
              </div>
            </div>
            <div id="hm-recent-host">
              ${this.renderRecentItems()}
            </div>
          </section>
        </div>

        <footer class="hm-foot">
          <span>Lattes Manager v${escapeHtml(version)} · Gestão do Currículo Lattes</span>
          <span>Ctrl+K busca registros · Ctrl+N cria novo registro</span>
        </footer>
      </div>`;
    }
  }
