import { describe, it, expect, vi } from 'vitest';
import {
  MAX_RENDER_DIMENSION,
  PREVIEW_DIMENSION,
  isPdfFile,
  loadPdf,
  pageRenderScale,
  renderPdfPageToBlob,
  renderPdfPageToCanvas,
} from './pdf.js';

vi.mock('pdfjs-dist', () => {
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({ numPages: 3, getPage: vi.fn() }),
  }));
  return { getDocument, GlobalWorkerOptions: { workerSrc: '' } };
});

describe('isPdfFile', () => {
  it('detects by MIME type', () => {
    expect(isPdfFile({ name: 'scan', type: 'application/pdf' })).toBe(true);
  });

  it('detects by extension regardless of case', () => {
    expect(isPdfFile({ name: 'MAP.PDF', type: '' })).toBe(true);
  });

  it('rejects images and missing files', () => {
    expect(isPdfFile({ name: 'map.png', type: 'image/png' })).toBe(false);
    expect(isPdfFile(null)).toBe(false);
  });
});

describe('pageRenderScale', () => {
  it('shrinks a page larger than the cap to fit the long edge', () => {
    expect(pageRenderScale({ width: 6000, height: 3000 }, 3000)).toBe(0.5);
  });

  it('never upscales a small page', () => {
    expect(pageRenderScale({ width: 800, height: 600 }, 3000)).toBe(1);
  });

  it('falls back to 1 for a degenerate viewport', () => {
    expect(pageRenderScale({ width: 0, height: 0 })).toBe(1);
  });

  it('defaults to the module cap', () => {
    expect(pageRenderScale({ width: MAX_RENDER_DIMENSION * 2, height: 100 })).toBe(0.5);
  });
});

describe('renderPdfPageToCanvas', () => {
  it('sizes the canvas and returns the cancellable render task', async () => {
    const task = { promise: Promise.resolve(), cancel: vi.fn() };
    const page = {
      getViewport: ({ scale }) => ({ width: 1000 * scale, height: 500 * scale }),
      render: vi.fn(() => task),
    };
    const doc = { getPage: vi.fn(async () => page) };
    const canvas = { width: 0, height: 0, getContext: () => ({}) };

    const started = await renderPdfPageToCanvas(doc, 2, canvas, { maxEdge: 500 });

    expect(doc.getPage).toHaveBeenCalledWith(2);
    expect(canvas.width).toBe(500);
    expect(canvas.height).toBe(250);
    expect(started).toBe(task);
  });
});

describe('preview dimension', () => {
  it('stays below the import cap so a drag stays responsive', () => {
    expect(PREVIEW_DIMENSION).toBeLessThan(MAX_RENDER_DIMENSION);
  });
});

describe('renderPdfPageToBlob', () => {
  function fakeCanvas(blob) {
    return {
      width: 0,
      height: 0,
      getContext: () => ({}),
      toBlob: (cb) => cb(blob),
    };
  }

  it('sizes the canvas from the scaled viewport and returns the blob', async () => {
    const page = {
      getViewport: ({ scale }) => ({ width: 1000 * scale, height: 500 * scale }),
      render: vi.fn(() => ({ promise: Promise.resolve() })),
    };
    const doc = { getPage: vi.fn(async () => page) };
    const canvas = fakeCanvas('png-blob');

    const blob = await renderPdfPageToBlob(doc, 2, {
      maxEdge: 500,
      createCanvas: () => canvas,
    });

    expect(doc.getPage).toHaveBeenCalledWith(2);
    expect(canvas.width).toBe(500);
    expect(canvas.height).toBe(250);
    expect(page.render).toHaveBeenCalled();
    expect(blob).toBe('png-blob');
  });

  it('rejects when the canvas cannot produce a blob', async () => {
    const page = {
      getViewport: () => ({ width: 10, height: 10 }),
      render: () => ({ promise: Promise.resolve() }),
    };
    const doc = { getPage: async () => page };

    await expect(
      renderPdfPageToBlob(doc, 1, { createCanvas: () => fakeCanvas(null) }),
    ).rejects.toThrow('Failed to rasterise PDF page');
  });

  // The page must be drawn before the canvas is snapshotted. Resolving the
  // render promise on a later tick (a real render is never synchronous) catches
  // the canvas being read while it is still blank.
  it('waits for the render before snapshotting the canvas', async () => {
    let finishRender;
    const page = {
      getViewport: () => ({ width: 10, height: 10 }),
      render: vi.fn(() => ({ promise: new Promise((r) => { finishRender = r; }) })),
    };
    const doc = { getPage: async () => page };

    let rendered = false;
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({}),
      toBlob: (cb) => { rendered = true; cb('png-blob'); },
    };

    const pending = renderPdfPageToBlob(doc, 1, { createCanvas: () => canvas });
    await Promise.resolve();
    await Promise.resolve();
    // Give the render a chance to complete; it has not been told to yet.
    expect(rendered).toBe(false);

    finishRender();
    await expect(pending).resolves.toBe('png-blob');
    expect(rendered).toBe(true);
  });
});

describe('loadPdf', () => {
  it('returns the resolved document', async () => {
    const doc = await loadPdf({ arrayBuffer: async () => new ArrayBuffer(4) });
    expect(doc.numPages).toBe(3);
  });
});
