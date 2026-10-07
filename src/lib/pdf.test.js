import { describe, it, expect, vi } from 'vitest';
import {
  MAX_RENDER_DIMENSION,
  isPdfFile,
  loadPdf,
  pageRenderScale,
  renderPdfPageToBlob,
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
});

describe('loadPdf', () => {
  it('returns the resolved document', async () => {
    const doc = await loadPdf({ arrayBuffer: async () => new ArrayBuffer(4) });
    expect(doc.numPages).toBe(3);
  });
});
