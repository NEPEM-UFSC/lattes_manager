// Tema do app: modo (claro/escuro/automático), cor de destaque e densidade.
// Guardado no navegador do app (localStorage); aplicado também no <head> antes da pintura.

export const ACCENTS = {
  azul: { name: "Azul", c: "#2563eb", h: "#1d4ed8" },
  indigo: { name: "Índigo", c: "#4f46e5", h: "#4338ca" },
  violeta: { name: "Violeta", c: "#7c3aed", h: "#6d28d9" },
  esmeralda: { name: "Esmeralda", c: "#059669", h: "#047857" },
  rosa: { name: "Rosa", c: "#db2777", h: "#be185d" },
  ambar: { name: "Âmbar", c: "#d97706", h: "#b45309" },
  ciano: { name: "Ciano", c: "#0891b2", h: "#0e7490" },
  coral: { name: "Coral", c: "#e8590c", h: "#c2410c" },
  grafite: { name: "Grafite", c: "#475569", h: "#334155" },
};

export const MODES = { light: "Claro", dark: "Escuro", system: "Automático", papel: "Papel", grafite: "Grafite", oceano: "Oceano" };
/** variantes: tema-base claro/escuro + tonalidade própria */
const VARIANT_BASE = { papel: "light", grafite: "dark", oceano: "dark" };
export const DENSITIES = { normal: "Confortável", compact: "Compacta" };
export const MOTION = { full: "Fluido", reduced: "Reduzido" };

const KEY = "lattes.theme";
const DEFAULT = { mode: "system", accent: "azul", density: "normal", motion: "full" };
const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function getTheme() {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
  } catch {
    return { ...DEFAULT };
  }
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
