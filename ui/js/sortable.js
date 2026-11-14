// Ordenar por arrastar (ponteiro: mouse, caneta ou toque), com animação FLIP dos vizinhos.
// Só os filhos diretos de `list` que casam com `item` se movem, e só pela alça `handle`.

const DURATION = 220;
const EASE = "cubic-bezier(.2, .8, .2, 1)";

function reducedMotion() {
  return document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Anima `els` da posição antiga para a nova depois de `mutate()` mexer no DOM. */
function flip(els, mutate) {
  const before = new Map(els.map((el) => [el, el.getBoundingClientRect().top]));
  mutate();
  if (reducedMotion()) return;
  for (const el of els) {
    const dy = before.get(el) - el.getBoundingClientRect().top;
    if (!dy) continue;
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
    el.offsetHeight; // aplica a posição inicial antes de ligar a transição
    el.style.transition = `transform ${DURATION}ms ${EASE}`;
    el.style.transform = "";
  }
}

/**
 * @param {HTMLElement} list
 * @param {{ item: string, handle: string, scroller?: HTMLElement, onSort: (keys: string[]) => void, key?: (el: HTMLElement) => string }} opts
 */
export function makeSortable(list, { item, handle, scroller, onSort, key = (el) => el.dataset.key }) {
  const items = () => [...list.children].filter((c) => c.matches(item));

  list.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const grip = e.target.closest(handle);
    const el = grip?.closest(item);
    if (!el || el.parentElement !== list) return;
    e.preventDefault();

    const startOrder = items().map(key);
    const startY = e.clientY;
    const startScroll = scroller ? scroller.scrollTop : 0;
    const startOffset = el.offsetTop;
    let dragging = false;
    let lastY = e.clientY;

    const position = () => {
      const all = items();
      // topo "virtual" do item arrastado (coordenadas de offsetTop), preso aos limites da lista
      const lo = Math.min(...all.map((o) => o.offsetTop));
      const hi = Math.max(...all.map((o) => o.offsetTop + o.offsetHeight)) - el.offsetHeight;
      const top = Math.max(lo, Math.min(hi, startOffset + lastY - startY + (scroller ? scroller.scrollTop - startScroll : 0)));
      const center = top + el.offsetHeight / 2;
      const others = all.filter((o) => o !== el);
      const next = others.find((o) => center < o.offsetTop + o.offsetHeight / 2) || null;
      const current = all[all.indexOf(el) + 1] || null;
      if (next !== current) flip(others, () => list.insertBefore(el, next || others[others.length - 1].nextSibling));
      el.style.transform = `translateY(${top - el.offsetTop}px)`;
    };

    let raf = 0;
    const autoScroll = () => {
      raf = 0;
      if (!dragging || !scroller) return;
      const r = scroller.getBoundingClientRect();
      const edge = 48;
      const v = lastY < r.top + edge ? -(r.top + edge - lastY) : lastY > r.bottom - edge ? lastY - (r.bottom - edge) : 0;
      if (!v) return;
      scroller.scrollTop += Math.max(-18, Math.min(18, v / 2));
      position();
      raf = requestAnimationFrame(autoScroll);
    };

    const move = (ev) => {
      lastY = ev.clientY;
      if (!dragging) {
        if (Math.abs(lastY - startY) < 4) return;
        dragging = true;
        grip.setPointerCapture?.(ev.pointerId);
        // segue o ponteiro sem atraso, mas o "levantar" (escala e sombra) é animado
        el.style.transition = "scale 0.18s ease, box-shadow 0.18s ease";
        el.style.position = "relative";
        el.style.zIndex = "10"; // fica acima dos vizinhos até terminar de pousar
        el.classList.add("is-dragging");
        list.classList.add("is-sorting");
        document.body.classList.add("sorting-active");
      }
      position();
      if (!raf) raf = requestAnimationFrame(autoScroll);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      cancelAnimationFrame(raf);
      document.body.classList.remove("sorting-active");
      if (!dragging) return;
      const done = () => {
        el.classList.remove("is-dragging");
        list.classList.remove("is-sorting");
        el.style.transition = "";
        el.style.position = "";
        el.style.zIndex = "";
        const order = items().map(key);
        if (order.join("\u0000") !== startOrder.join("\u0000")) onSort(order);
      };
      if (reducedMotion()) {
        el.style.transform = "";
        return done();
      }
      // assenta no lugar novo e "pousa" (escala e sombra voltam juntas)
      el.style.transition = `transform ${DURATION}ms ${EASE}, scale ${DURATION}ms ${EASE}, box-shadow ${DURATION}ms ${EASE}`;
      el.style.transform = "";
      el.classList.remove("is-dragging");
      setTimeout(done, DURATION);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
}
