// Dados Gerais › Perfil: todos os dados do docente, com a escolha do que vai na capa dos comprovantes.

import { api } from "../api.js";
import { escapeHtml, showToast } from "../utils.js";
import { parseDate } from "./tools.js";

/** Campos de data do perfil (sempre dd/mm/aaaa). */
export const DATE_FIELDS = new Set(["data_nascimento", "admissao", "atualizacao"]);

/** Qualquer data reconhecível → "dd/mm/aaaa"; texto não reconhecido fica como está. */
export function toBrDate(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  const d = parseDate(t);
  if (!d) return t;
  const [y, m, day] = d;
  if (m < 1 || m > 12 || day < 1 || day > 31) return t;
  return `${String(day).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** Máscara enquanto digita: 14071990 → 14/07/1990. */
function maskDate(v) {
  const digits = v.replace(/\D/g, "").slice(0, 8);
  if (/[a-zA-Z.-]/.test(v)) return v; // "14 de julho de 1990" ou 1990-07-14: normaliza ao sair do campo
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join("/");
}

/** Campos do perfil: [chave, rótulo, grupo, vai na capa por padrão, sensível] */
export const PROFILE_FIELDS = [
  ["nome", "Nome completo", "Identificação", true],
  ["nome_citacoes", "Nome em citações", "Identificação", true],
  ["nome_social", "Nome social", "Identificação", false],
  ["data_nascimento", "Data de nascimento", "Identificação", false, true],
  ["naturalidade", "Naturalidade", "Identificação", false],
  ["nacionalidade", "Nacionalidade", "Identificação", false],
  ["cpf", "CPF", "Identificação", false, true],
  ["rg", "RG / órgão emissor", "Identificação", false, true],
  ["cargo", "Cargo", "Vínculo institucional", true],
  ["classe", "Classe / nível da carreira", "Vínculo institucional", false],
  ["regime", "Regime de trabalho", "Vínculo institucional", false],
  ["siape", "Matrícula SIAPE", "Vínculo institucional", false],
  ["admissao", "Data de admissão", "Vínculo institucional", false],
  ["instituicao", "Instituição", "Vínculo institucional", true],
  ["unidade", "Centro / unidade", "Vínculo institucional", true],
  ["departamento", "Departamento", "Vínculo institucional", true],
  ["programa", "Programa de pós-graduação", "Vínculo institucional", false],
  ["laboratorio", "Laboratório / grupo de pesquisa", "Vínculo institucional", false],
  ["email", "E-mail institucional", "Contato", true],
  ["email_alt", "E-mail alternativo", "Contato", false],
  ["telefone", "Telefone", "Contato", false],
  ["endereco", "Endereço profissional", "Contato", false],
  ["website", "Página pessoal", "Contato", false],
  ["lattes_url", "Currículo Lattes", "Identificadores acadêmicos", true],
  ["orcid", "ORCID", "Identificadores acadêmicos", true],
  ["scholar", "Google Scholar", "Identificadores acadêmicos", false],
  ["researchgate", "ResearchGate", "Identificadores acadêmicos", false],
  ["scopus", "Scopus Author ID", "Identificadores acadêmicos", false],
  ["wos", "Web of Science ResearcherID", "Identificadores acadêmicos", false],
  ["area", "Área de atuação", "Atuação", true],
  ["bolsa_pq", "Bolsa de produtividade (CNPq)", "Atuação", false],
  ["atualizacao", "Última atualização do Lattes", "Atuação", true],
];

const KEY = "profile";

/** Perfil salvo; na primeira vez, preenchido com o XML do Lattes. */
export async function loadProfile() {
  const saved = await api.getSetting(KEY).catch(() => null);
  if (saved && saved.values) return normalize(saved);
  const xml = await api.getLattesProfile().catch(() => null);
  return normalize({ values: { ...(xml || {}) }, include: {}, extras: [], fromXml: Boolean(xml) });
}

function normalize(p) {
  const include = { ...(p.include || {}) };
  for (const [k, , , def] of PROFILE_FIELDS) if (!(k in include)) include[k] = def;
  if (!("resumo" in include)) include.resumo = true;
  if (!("foto" in include)) include.foto = true;
  const values = { ...(p.values || {}) };
  for (const k of DATE_FIELDS) if (values[k]) values[k] = toBrDate(values[k]);
  return { values, include, extras: Array.isArray(p.extras) ? p.extras : [], fromXml: p.fromXml };
}

export function saveProfile(p) {
  return api.setSetting(KEY, { values: p.values, include: p.include, extras: p.extras });
}

/** Enquadramento da foto 3:4: centralizada na horizontal e a 35% do topo (rostos ficam no alto). */
export const PHOTO_ASPECT = 3 / 4;
export const PHOTO_FOCUS_Y = 0.35;
/** Abaixo disso a foto pode ficar serrilhada na capa impressa. */
const PHOTO_MIN = [600, 800];

/** Foto de perfil salva: { rel, bytes, url, w, h } ou null. Quem recebe deve revogar `url`. */
export async function loadPhoto() {
  const rel = await api.getProfilePhoto().catch(() => null);
  if (!rel) return null;
  const bytes = await api.readFileBytes(rel);
  const url = URL.createObjectURL(new Blob([bytes], { type: rel.endsWith(".png") ? "image/png" : "image/jpeg" }));
  const img = new Image();
  img.src = url;
  await img.decode();
  return { rel, bytes, url, w: img.naturalWidth, h: img.naturalHeight };
}

/** Linhas [rótulo, valor] escolhidas para a capa (exceto nome e resumo, que têm lugar próprio). */
export function coverRows(p, include = p.include) {
  const rows = [];
  for (const [k, label] of PROFILE_FIELDS) {
    if (k === "nome") continue;
    const v = String(p.values[k] || "").trim();
    if (v && include[k]) rows.push([label, v]);
  }
  for (const x of p.extras || []) if (x.label && x.value && x.include) rows.push([x.label, x.value]);
  return rows;
}

export class ProfilePanel {
  constructor({ container, onSaved }) {
    this.el = container;
    this.onSaved = onSaved;
    this.p = null;
    this.photo = null;
    this.collapsed = (() => {
      try {
        return localStorage.getItem("lattes.profile.collapsed") === "1";
      } catch {
        return false;
      }
    })();
  }

  async show() {
    this.el.style.display = "block";
    if (!this.p) {
      this.el.innerHTML = `<div class="pf-card pf-loading"><div class="spinner"></div></div>`;
      [this.p, this.photo] = await Promise.all([loadProfile(), loadPhoto().catch(() => null)]);
    }
    this.render();
  }

  hide() {
    this.el.style.display = "none";
  }

  render() {
    const p = this.p;
    const v = p.values;
    const groups = [...new Set(PROFILE_FIELDS.map((f) => f[2]))];
    const filled = PROFILE_FIELDS.filter(([k]) => String(v[k] || "").trim()).length;
    const nCapa = coverRows(p).length;
    const initials = String(v.nome || "?").split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
    this.el.innerHTML = `
      <div class="pf-card ${this.collapsed ? "collapsed" : ""}">
        <div class="pf-head">
          <div class="pf-avatar">${this.photo ? `<img src="${this.photo.url}" alt="Foto de perfil"/>` : escapeHtml(initials)}</div>
          <div class="pf-id">
            <h2>${escapeHtml(v.nome || "Seu perfil")}</h2>
            <p>${escapeHtml([v.cargo, v.departamento || v.unidade, v.instituicao].filter(Boolean).join(" · ") || "Preencha seus dados — eles alimentam a capa dos comprovantes")}</p>
            <div class="pf-tags">
              <span>${filled}/${PROFILE_FIELDS.length} campos preenchidos</span>
              <span class="pf-tag-cover">📑 ${nCapa} na capa dos comprovantes</span>
              ${v.email ? `<span>✉️ ${escapeHtml(v.email)}</span>` : ""}
            </div>
          </div>
          <div class="pf-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-pf="xml" title="Preenche os campos vazios com os dados do XML do Lattes">🧬 Importar do XML</button>
            <button type="button" class="btn btn-primary btn-sm" data-pf="save">💾 Salvar perfil</button>
            <button type="button" class="pf-toggle" data-pf="toggle" title="${this.collapsed ? "Expandir" : "Recolher"}">${this.collapsed ? "⌄" : "⌃"}</button>
          </div>
        </div>
        ${this.collapsed ? "" : `
        <p class="pf-hint">Marque <b>📑</b> nos campos que devem aparecer na capa do PDF de comprovantes. Dados sensíveis (CPF, RG, nascimento) ficam desmarcados por padrão e só são guardados neste computador.</p>
        <div class="pf-groups">
          ${this.photoSection()}
          ${groups
            .map(
              (g) => `<section class="pf-group"><h3>${escapeHtml(g)}</h3><div class="pf-grid">
              ${PROFILE_FIELDS.filter((f) => f[2] === g)
                .map(
                  ([k, label, , , sens]) => `<label class="pf-field ${sens ? "sens" : ""}">
                    <span class="pf-lbl">${escapeHtml(label)}${sens ? ' <i title="Dado sensível">🔒</i>' : ""}</span>
                    <div class="pf-inp">
                      <input class="form-input ${DATE_FIELDS.has(k) ? "pf-date" : ""}" data-k="${k}" value="${escapeHtml(v[k] || "")}" ${DATE_FIELDS.has(k) ? 'placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="24" title="Data no formato dd/mm/aaaa"' : ""}/>
                      ${k === "nome" ? '<span class="pf-inc fixed" title="O nome sempre aparece na capa">📑</span>' : `<button type="button" class="pf-inc ${p.include[k] ? "on" : ""}" data-inc="${k}" title="Incluir na capa dos comprovantes">📑</button>`}
                    </div>
                  </label>`
                )
                .join("")}
            </div></section>`
            )
            .join("")}
          <section class="pf-group"><h3>Resumo do currículo</h3>
            <div class="pf-inp pf-resumo">
              <textarea class="form-textarea" data-k="resumo" rows="5">${escapeHtml(v.resumo || "")}</textarea>
              <button type="button" class="pf-inc ${p.include.resumo ? "on" : ""}" data-inc="resumo" title="Incluir página com o resumo">📑</button>
            </div>
          </section>
          <section class="pf-group"><h3>Campos extras <span class="muted">— qualquer informação adicional</span></h3>
            <div class="pf-extras">
              ${p.extras
                .map(
                  (x, i) => `<div class="pf-extra">
                  <input class="form-input" data-x="${i}" data-xk="label" placeholder="Rótulo, ex.: Portaria de nomeação" value="${escapeHtml(x.label || "")}"/>
                  <input class="form-input" data-x="${i}" data-xk="value" placeholder="Valor" value="${escapeHtml(x.value || "")}"/>
                  <button type="button" class="pf-inc ${x.include ? "on" : ""}" data-xinc="${i}" title="Incluir na capa">📑</button>
                  <button type="button" class="pf-rm" data-xrm="${i}" title="Remover">&times;</button></div>`
                )
                .join("")}
              <button type="button" class="btn btn-secondary btn-sm" data-pf="extra">+ Adicionar campo</button>
            </div>
          </section>
        </div>`}
      </div>`;
    this.bind();
  }

  photoSection() {
    const ph = this.photo;
    const low = ph && (Math.min(ph.w, ph.h) < PHOTO_MIN[0] || Math.max(ph.w, ph.h) < PHOTO_MIN[1]);
    return `<section class="pf-group"><h3>Foto de perfil</h3>
      <div class="pf-photo">
        <div class="pf-photo-prev">${ph ? `<img src="${ph.url}" alt="Foto de perfil"/>` : "<span>Sem foto</span>"}</div>
        <div class="pf-photo-info">
          <p>PNG ou JPG, de preferência em alta resolução (pelo menos ${PHOTO_MIN[0]} × ${PHOTO_MIN[1]} px). Na capa do relatório, a foto é enquadrada em 3 × 4 como nesta prévia.</p>
          ${ph ? `<small class="${low ? "pf-photo-low" : ""}">${ph.w} × ${ph.h} px${low ? " · resolução baixa, pode ficar serrilhada na impressão" : ""}</small>` : ""}
          <div class="pf-photo-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-pf="photo">📷 ${ph ? "Trocar foto" : "Enviar foto"}</button>
            ${ph ? '<button type="button" class="btn btn-secondary btn-sm" data-pf="photo-rm">Remover</button>' : ""}
            ${ph ? `<span class="pf-photo-inc"><button type="button" class="pf-inc ${this.p.include.foto ? "on" : ""}" data-inc="foto" title="Incluir a foto na capa dos comprovantes">📑</button> Na capa</span>` : ""}
          </div>
        </div>
      </div>
    </section>`;
  }

  async reloadPhoto() {
    if (this.photo) URL.revokeObjectURL(this.photo.url);
    this.photo = await loadPhoto().catch(() => null);
    this.render();
  }

  bind() {
    const $ = (s) => this.el.querySelector(s);
    $('[data-pf="photo"]')?.addEventListener("click", async () => {
      try {
        if (!(await api.pickProfilePhoto())) return;
        await this.reloadPhoto();
        showToast("Foto de perfil atualizada", "success", 1800);
      } catch (e) {
        showToast(`Erro ao enviar a foto: ${e}`, "error", 5000);
      }
    });
    $('[data-pf="photo-rm"]')?.addEventListener("click", async () => {
      try {
        await api.removeProfilePhoto();
        await this.reloadPhoto();
        showToast("Foto removida", "info", 1800);
      } catch (e) {
        showToast(`Erro ao remover a foto: ${e}`, "error");
      }
    });
    this.el.querySelectorAll("[data-k]").forEach((i) => {
      const isDate = DATE_FIELDS.has(i.dataset.k);
      i.addEventListener("input", (e) => {
        if (isDate && e.inputType !== "deleteContentBackward") {
          const m = maskDate(i.value);
          if (m !== i.value) i.value = m;
        }
        this.p.values[i.dataset.k] = i.value;
      });
      if (isDate)
        i.addEventListener("blur", () => {
          const v = toBrDate(i.value);
          const bad = i.value.trim() && !/^\d{2}\/\d{2}\/\d{4}$/.test(v);
          i.value = v;
          this.p.values[i.dataset.k] = v;
          i.classList.toggle("pf-invalid", Boolean(bad));
          i.title = bad ? "Data não reconhecida — use dd/mm/aaaa" : "Data no formato dd/mm/aaaa";
        });
    });
    this.el.querySelectorAll("[data-inc]").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.inc;
        this.p.include[k] = !this.p.include[k];
        b.classList.toggle("on", this.p.include[k]);
        this.el.querySelector(".pf-tag-cover").textContent = `📑 ${coverRows(this.p).length} na capa dos comprovantes`;
      })
    );
    this.el.querySelectorAll("[data-x]").forEach((i) => i.addEventListener("input", () => (this.p.extras[Number(i.dataset.x)][i.dataset.xk] = i.value)));
    this.el.querySelectorAll("[data-xinc]").forEach((b) =>
      b.addEventListener("click", () => {
        const x = this.p.extras[Number(b.dataset.xinc)];
        x.include = !x.include;
        b.classList.toggle("on", x.include);
      })
    );
    this.el.querySelectorAll("[data-xrm]").forEach((b) =>
      b.addEventListener("click", () => {
        this.p.extras.splice(Number(b.dataset.xrm), 1);
        this.render();
      })
    );
    $('[data-pf="extra"]')?.addEventListener("click", () => {
      this.p.extras.push({ label: "", value: "", include: true });
      this.render();
      this.el.querySelector(`[data-x="${this.p.extras.length - 1}"]`)?.focus();
    });
    $('[data-pf="toggle"]').addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      try {
        localStorage.setItem("lattes.profile.collapsed", this.collapsed ? "1" : "0");
      } catch {}
      this.render();
    });
    $('[data-pf="save"]').addEventListener("click", async () => {
      try {
        await saveProfile(this.p);
        showToast("Perfil salvo", "success", 1800);
        this.render();
        this.onSaved && this.onSaved(this.p);
      } catch (e) {
        showToast(`Erro ao salvar: ${e}`, "error");
      }
    });
    $('[data-pf="xml"]').addEventListener("click", async () => {
      try {
        const x = await api.getLattesProfile();
        let n = 0;
        for (const [k, val] of Object.entries(x || {})) {
          if (typeof val === "string" && val.trim() && !String(this.p.values[k] || "").trim()) {
            this.p.values[k] = DATE_FIELDS.has(k) ? toBrDate(val) : val;
            n++;
          }
        }
        if (this.collapsed) this.collapsed = false;
        this.render();
        showToast(n ? `${n} campo(s) preenchido(s) com o XML — revise e salve` : "Nada novo no XML (campos já preenchidos)", "info", 3500);
      } catch (e) {
        showToast(`XML do Lattes não encontrado: ${e}`, "error", 5000);
      }
    });
  }
}
