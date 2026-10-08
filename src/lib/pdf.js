// PDF import: rasterise one page to a PNG blob so every downstream path
// (thumbnail, georeferencing, IndexedDB storage, the viewer) can treat a PDF
// exactly like a photo. Nothing else in the app learns about PDFs.

// Long-edge cap for the rendered page. Maps need to stay legible when placing
// reference points, but rendering a full A0 sheet at 1:1 would exhaust canvas
// memory on phones.
export const MAX_RENDER_DIMENSION = 3000;

// Two preview tiers for the page picker: a cheap pass drawn while the slider
// moves, and a detailed pass once it settles. Rasterising a vector page is
// proportional to the pixel count, so the cheap tier is roughly an order of
// magnitude less work and keeps scrolling responsive.
export const SCROLL_PREVIEW_DIMENSION = 400;
export const SETTLED_PREVIEW_DIMENSION = 1400;

let pdfjsPromise = null;

export function isPdfFile(file) {
  const name = file?.name?.toLowerCase() ?? '';
  return file?.type === 'application/pdf' || name.endsWith('.pdf');
}

/**
 * Load PDF.js on demand and point it at the bundled worker. The dynamic import
 * keeps the parser out of the initial shell, and resolving the worker through
 * Vite emits and cache-busts it with the rest of the build.
 */
export function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export async function loadPdf(file) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

// Scale that keeps the page's long edge within `maxEdge`. Pages already smaller
// than the cap are left at 1 so a small map is not upscaled into a blurry mess.
export function pageRenderScale(viewport, maxEdge = MAX_RENDER_DIMENSION) {
  const longEdge = Math.max(viewport.width, viewport.height);
  if (!Number.isFinite(longEdge) || longEdge <= 0) return 1;
  return Math.min(1, maxEdge / longEdge);
}

/**
 * Rasterise `pageNumber` onto an existing canvas, sized to `maxEdge` on its long
 * edge. Returns the task object PDF.js exposes so a caller can `cancel()` a
 * render that a newer one has superseded; cancelling rejects with
 * `RenderingCancelledException`, which callers should treat as "ignore me".
 */
export async function renderPdfPageToCanvas(doc, pageNumber, canvas, {
  maxEdge = MAX_RENDER_DIMENSION,
} = {}) {
  const page = await doc.getPage(pageNumber);
  const scale = pageRenderScale(page.getViewport({ scale: 1 }), maxEdge);
  const viewport = page.getViewport({ scale });

  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));

  return page.render({ canvasContext: canvas.getContext('2d'), viewport });
}

export async function renderPdfPageToBlob(doc, pageNumber, {
  maxEdge = MAX_RENDER_DIMENSION,
  createCanvas = () => document.createElement('canvas'),
} = {}) {
  const canvas = createCanvas();
  await renderPdfPageToCanvas(doc, pageNumber, canvas, { maxEdge }).promise;

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to rasterise PDF page'));
    }, 'image/png');
  });
}
