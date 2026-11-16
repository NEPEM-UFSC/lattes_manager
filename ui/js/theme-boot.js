// Aplica o tema antes da primeira pintura (evita "piscar" claro→escuro).
// Script clássico e síncrono no <head>; também é a fonte única da paleta usada por theme.js.
// Cada destaque é [cor, hover], ambos com contraste ≥ 4,5:1 para texto branco.
window.LATTES_ACCENTS = {
  azul: ["#2563eb", "#1d4ed8"],
  indigo: ["#4f46e5", "#4338ca"],
  violeta: ["#7c3aed", "#6d28d9"],
  esmeralda: ["#047857", "#065f46"],
  rosa: ["#db2777", "#be185d"],
  ambar: ["#b45309", "#92400e"],
  ciano: ["#0e7490", "#155e75"],
  coral: ["#c2410c", "#9a3412"],
  grafite: ["#475569", "#334155"],
};

(function () {
  try {
    var t = JSON.parse(localStorage.getItem("lattes.theme")) || {};
    var mode = t.mode || "system", V = { papel: "light", grafite: "dark", oceano: "dark" };
    var variant = V[mode] ? mode : "";
    if (mode === "system") mode = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    if (V[mode]) mode = V[mode];
    var A = window.LATTES_ACCENTS, a = A[t.accent] || A.azul, r = document.documentElement;
    r.dataset.theme = mode;
    r.dataset.variant = variant;
    r.dataset.motion = t.motion || "full";
    r.dataset.density = t.density || "normal";
    r.dataset.fontsize = t.fontSize || "md";
    r.style.setProperty("--primary", a[0]);
    r.style.setProperty("--primary-hover", a[1]);
  } catch (e) { }
})();
