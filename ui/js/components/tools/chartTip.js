// Tooltip dos gráficos das ferramentas (mesmo visual do painel de Gráficos: .chart-tip).
// Elementos com data-tip mostram o HTML do atributo ao passar o mouse.

let tipEl = null;

function tip() {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "chart-tip";
    tipEl.setAttribute("role", "tooltip");
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

/** Mostra o tooltip com `html` perto do ponteiro. */
export function showTip(html, e) {
  const t = tip();
  t.innerHTML = html;
  t.style.opacity = "1";
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  const x = e.clientX + 14 + w > window.innerWidth ? e.clientX - w - 14 : e.clientX + 14;
  const y = e.clientY + 14 + h > window.innerHeight ? e.clientY - h - 14 : e.clientY + 14;
  t.style.transform = `translate(${x}px, ${y}px)`;
}

export function hideTip() {
  if (tipEl) tipEl.style.opacity = "0";
}

/** Liga o tooltip a todos os elementos [data-tip] dentro de `root`. */
export function attachTip(root) {
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("mousemove", (e) => showTip(el.getAttribute("data-tip"), e));
    el.addEventListener("mouseleave", hideTip);
  });
}
