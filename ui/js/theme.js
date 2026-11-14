// Tema do app: modo (claro/escuro/automático), cor de destaque e densidade.
// Guardado no navegador do app (localStorage); aplicado também no <head> (theme-boot.js) antes da pintura.

const ACCENT_NAMES = {
  azul: "Azul",
  indigo: "Índigo",
  violeta: "Violeta",
  esmeralda: "Esmeralda",
  rosa: "Rosa",
  ambar: "Âmbar",
  ciano: "Ciano",
  coral: "Coral",
  grafite: "Grafite",
};
/** cores em js/theme-boot.js (window.LATTES_ACCENTS), carregado antes deste módulo */
export const ACCENTS = Object.fromEntries(
  Object.entries(window.LATTES_ACCENTS).map(([k, [c, h]]) => [k, { name: ACCENT_NAMES[k], c, h }])
);

export const MODES = { light: "Claro", dark: "Escuro", system: "Automático", papel: "Papel", grafite: "Grafite", oceano: "Oceano" };
/** variantes: tema-base claro/escuro + tonalidade própria */
const VARIANT_BASE = { papel: "light", grafite: "dark", oceano: "dark" };
export const DENSITIES = { normal: "Confortável", compact: "Compacta" };
export const MOTION = { full: "Fluido", reduced: "Reduzido" };

const KEY = "lattes.theme";
const DEFAULT = { mode: "system", accent: "azul", density: "normal", motion: "full", easyClose: false };
const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function getTheme() {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
  } catch {
    return { ...DEFAULT };
  }
}

/** "Fechamento facilitado": se true, clicar fora de um modal o fecha. Padrão: false (só Cancelar / ×). */
export function easyClose() {
  return getTheme().easyClose === true;
}

export function resolvedMode(t = getTheme()) {
  if (t.mode === "system") return media?.matches ? "dark" : "light";
  return VARIANT_BASE[t.mode] || t.mode;
}

export function applyTheme(next) {
  const t = { ...getTheme(), ...(next || {}) };
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {}
  const root = document.documentElement;
  root.dataset.theme = resolvedMode(t);
  root.dataset.density = t.density;
  root.dataset.variant = VARIANT_BASE[t.mode] ? t.mode : "";
  root.dataset.motion = t.motion || "full";
  const a = ACCENTS[t.accent] || ACCENTS.azul;
  root.style.setProperty("--primary", a.c);
  root.style.setProperty("--primary-hover", a.h);
  return t;
}

// acompanha a troca de tema do Windows no modo automático
media?.addEventListener?.("change", () => {
  if (getTheme().mode === "system") applyTheme();
});
