// Renderiza páginas de PDF como imagem (PNG) com o pdf.js empacotado, para o OCR.
// Funciona com qualquer PDF digitalizado: JPEG, CCITT, JBIG2, Flate etc.

let lib = null;

async function pdfjs() {
  if (!lib) {
    lib = await import("../../vendor/pdfjs/pdf.min.js");
    lib.GlobalWorkerOptions.workerSrc = new URL("../../vendor/pdfjs/pdf.worker.min.js", import.meta.url).href;
  }
  return lib;
}

/**
 * Abre o PDF (bytes) e devolve { pages, render(n) }. `render(n)` desenha a página n (1-based)
 * com fundo branco e no máximo `maxSide` px no lado maior, já com a rotação da página aplicada.
 */
export async function openPdf(bytes, { maxSide = 2400 } = {}) {
  const pdf = await pdfjs();
  const doc = await pdf.getDocument({
    data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;
  return {
    pages: doc.numPages,
    async render(n) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, maxSide / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      return new Uint8Array(await blob.arrayBuffer());
    },
    close: () => doc.destroy(),
  };
}
