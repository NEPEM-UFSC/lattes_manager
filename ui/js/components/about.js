// Sobre o aplicativo

import { api } from "../api.js";
import { escapeHtml } from "../utils.js";
import { updater } from "./updater.js";

const FEATURES = [
  ["🗂️", "Cadastro organizado", "10 categorias do currículo + categorias suas, com comprovantes salvos em subpastas numeradas e nomes padronizados."],
  ["⚡", "Cadastro por DOI e por PDF", "Cole um DOI ou arraste o artigo: título, revista, ano, autores e Qualis são preenchidos, e o PDF de acesso aberto é baixado."],
  ["📥", "Importação em lote", "Aponte uma pasta com dezenas de comprovantes: cada arquivo é classificado, preenchido e revisado antes de salvar."],
  ["🧬", "Importação do Lattes", "Lê o XML exportado do CNPq e evita duplicatas por similaridade de títulos."],
  ["📑", "Comprovantes em PDF único", "Capa com seus dados, sumário clicável, listas numeradas e todos os comprovantes anexados e carimbados."],
  ["📊", "Indicadores", "Painel com evolução anual, Qualis, periódicos e mapa de calor; exportação em Excel e HTML."],
  ["🧰", "Ferramentas", "Formatador de nomes e datas, padronização de textos, renomeação de arquivos e verificação de vínculos."],
  ["🛟", "Backup e restauração", "Backup .zip com os registros e, se quiser, todos os comprovantes; restauração com cópia de segurança automática."],
];

export class AboutView {
  constructor({ container }) {
    this.el = container;
  }

  async show() {
    const [version, stats, dd, autoUpd] = await Promise.all([
      api.getAppVersion().catch(() => "—"),
      api.getAppStats().catch(() => null),
      api.getDataDirInfo().catch(() => null),
      updater.getAuto().catch(() => true),
    ]);
    const year = new Date().getFullYear();
    this.el.innerHTML = `
      <div class="ab-wrap">
        <section class="ab-hero">
          <div class="ab-orb a"></div><div class="ab-orb b"></div>
          <div class="ab-hero-main">
            <img src="img/logo.png" alt="" class="ab-logo"/>
            <div class="ab-title">
              <span class="ab-kicker">Versão ${escapeHtml(version)}</span>
              <h2>Lattes Manager</h2>
              <p>Gestão do currículo Lattes e dos seus comprovantes — do cadastro ao PDF de progressão, num só lugar e funcionando offline.</p>
              <div class="ab-update">
                <button type="button" class="btn btn-primary btn-sm" id="ab-check-update">🔄 Verificar atualizações</button>
                <label class="ab-update-auto"><input type="checkbox" id="ab-update-auto" ${autoUpd ? "checked" : ""}/> Verificar ao abrir o app</label>
              </div>
            </div>
          </div>
          <aside class="ab-hero-disclaimer" aria-label="Aviso legal e institucional">
            <div class="ab-disc-head">⚖️ Aviso Institucional &amp; Propriedade Intelectual</div>
            <p>O <b>Lattes Manager</b> é um software livre, gratuito e independente desenvolvido no âmbito da <b>UFSC</b> para organização local de documentos comprobatórios a partir do arquivo XML exportado pelo próprio pesquisador.</p>
            <p><b>Sem vínculo oficial com o CNPq:</b> este aplicativo <b>não é</b> um produto oficial nem possui afiliação, endosso ou integração direta com os servidores do <b>CNPq/MCTI</b> ou da <b>CAPES</b>. As menções a <i>Currículo Lattes</i>, <i>Plataforma Lattes</i> e <i>Qualis</i> têm finalidade estritamente descritiva de compatibilidade (art. 132, II, Lei nº 9.279/1996).</p>
          </aside>
        </section>

        <section class="ab-cols">
          <div class="ab-card ab-dev">
            <div class="rb-label">Desenvolvimento</div>
            <h3>Prof. Dr. Tiago Olivoto</h3>
            <p>LEMGAD · NEPEM · Universidade Federal de Santa Catarina (UFSC)</p>
            <div class="ab-tags"><span>LEMGAD</span><span>NEPEM</span><span>UFSC</span></div>
            <div class="ab-links">
              <a href="#" class="ab-link" data-url="https://olivoto.com.br/">🌐 olivoto.com.br</a>
              <a href="#" class="ab-link" data-url="https://nepemufsc.com/">🌱 nepemufsc.com</a>
            </div>
          </div>
          <div class="ab-card">
            <div class="rb-label">Seus dados</div>
            <ul class="ab-list">
              <li><span>Registros</span><b>${stats ? Number(stats.total_records).toLocaleString("pt-BR") : "—"}</b></li>
              <li><span>Subcategorias</span><b>${stats ? stats.total_mappings : "—"}</b></li>
              <li><span>Pasta de dados</span><b class="mono" title="${escapeHtml(dd?.data_dir || "")}">${escapeHtml(dd?.data_dir || "—")}</b></li>
              <li><span>Armazenamento</span><b>100% local (SQLite)</b></li>
            </ul>
          </div>
          <div class="ab-card">
            <div class="rb-label">Tecnologia</div>
            <ul class="ab-list">
              <li><span>Aplicativo</span><b>Tauri 2 · Rust</b></li>
              <li><span>Interface</span><b>HTML · CSS · JavaScript</b></li>
              <li><span>PDF</span><b>pdf-lib · pdf-extract</b></li>
              <li><span>Metadados</span><b>Crossref · OpenAlex</b></li>
            </ul>
          </div>
        </section>

        <section class="ab-grid">
          ${FEATURES.map(([i, t, d], k) => `<div class="ab-feat" style="--i:${k}"><span>${i}</span><b>${escapeHtml(t)}</b><p>${escapeHtml(d)}</p></div>`).join("")}
        </section>

        <section class="ab-card ab-privacy">
          <b>🔒 Privacidade</b>
          <p>Os registros e comprovantes ficam apenas no seu computador. A internet só é usada quando você resolve um DOI ou lê metadados de um PDF — e nesses casos apenas o DOI ou o título do trabalho é enviado à Crossref/OpenAlex. Ao abrir, o app consulta o GitHub para saber se há versão nova (nenhum dado seu é enviado); isso pode ser desligado acima.</p>
        </section>

        <footer class="ab-foot">© ${year} Prof. Dr. Tiago Olivoto — LEMGAD/NEPEM/UFSC · Lattes Manager v${escapeHtml(version)}</footer>
      </div>`;
    const btn = this.el.querySelector("#ab-check-update");
    btn?.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Verificando…";
      await updater.checkNow();
      btn.disabled = false;
      btn.textContent = "🔄 Verificar atualizações";
    });
    this.el.querySelectorAll(".ab-link").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        api.openUrl(a.dataset.url).catch(() => {});
      })
    );
    this.el.querySelector("#ab-update-auto")?.addEventListener("change", (e) => updater.setAuto(e.target.checked));
  }
}
