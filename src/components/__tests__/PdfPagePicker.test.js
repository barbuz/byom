import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import PdfPagePicker from '../PdfPagePicker.svelte';

const pdfMocks = vi.hoisted(() => ({
  renderPdfPageToCanvas: vi.fn(),
}));

vi.mock('../../lib/pdf.js', () => ({
  PREVIEW_DIMENSION: 1400,
  renderPdfPageToCanvas: pdfMocks.renderPdfPageToCanvas,
}));

function makeTask() {
  return { promise: Promise.resolve(), cancel: vi.fn() };
}

/** A task whose render sizes the canvas, as the real rasteriser does, and
 *  records the canvas so tests can tell the render targets apart. */
function taskOn(canvas, { width = 800, height = 600 } = {}) {
  return {
    canvas,
    promise: Promise.resolve().then(() => {
      canvas.width = width;
      canvas.height = height;
    }),
    cancel: vi.fn(),
  };
}

function setup(props = {}) {
  const onconfirm = vi.fn();
  const oncancel = vi.fn();
  const utils = render(PdfPagePicker, {
    doc: { numPages: 5 },
    name: 'atlas.pdf',
    pageCount: 5,
    onconfirm,
    oncancel,
    ...props,
  });
  return { ...utils, onconfirm, oncancel };
}

afterEach(() => {
  // resetAllMocks (unlike clearAllMocks) also drops any queued `mock*Once`
  // implementations, so one test's canvas cannot leak into the next.
  vi.resetAllMocks();
});

describe('PdfPagePicker', () => {
  it('renders a preview of the first page on open', async () => {
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());

    setup();

    await waitFor(() => expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenCalled());
    expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.anything(),
      { maxEdge: 1400 }
    );
  });

  it('navigates with the next/prev buttons and disables them at the ends', async () => {
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());

    setup();

    const prev = screen.getByRole('button', { name: /previous page/i });
    expect(prev.disabled).toBe(true);

    await fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() =>
      expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenLastCalledWith(
        expect.anything(),
        2,
        expect.anything(),
        { maxEdge: 1400 }
      )
    );

    await fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByRole('button', { name: /next page/i }).disabled).toBe(true);
  });

  it('renders each page on its own canvas so a fast drag cannot share one', async () => {
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());

    setup();
    await waitFor(() => expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenCalled());

    const slider = screen.getByRole('slider');
    await fireEvent.input(slider, { target: { value: '2' } });
    await fireEvent.input(slider, { target: { value: '3' } });
    await fireEvent.input(slider, { target: { value: '4' } });

    await waitFor(() =>
      expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenLastCalledWith(
        expect.anything(),
        4,
        expect.anything(),
        { maxEdge: 1400 }
      )
    );

    // PDF.js rejects a canvas used by two renders at once; the picker never
    // reuses one, which is what caused spurious failures while sliding.
    const canvases = pdfMocks.renderPdfPageToCanvas.mock.calls.map((c) => c[2]);
    expect(new Set(canvases).size).toBe(canvases.length);
  });

  it('cancels the in-flight render when the page changes', async () => {
    const first = makeTask();
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());
    pdfMocks.renderPdfPageToCanvas.mockResolvedValueOnce(first);

    setup();
    await waitFor(() => expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenCalledTimes(1));

    await fireEvent.click(screen.getByRole('button', { name: /next page/i }));

    await waitFor(() => expect(first.cancel).toHaveBeenCalled());
  });

  it('confirms the current page and cancels cleanly', async () => {
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());

    const { onconfirm, oncancel } = setup();

    await fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await fireEvent.click(screen.getByRole('button', { name: /import page/i }));
    expect(onconfirm).toHaveBeenCalledWith(2);

    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(oncancel).toHaveBeenCalled();
  });

  it('shows an error when the preview render fails', async () => {
    const failing = { promise: Promise.reject(new Error('boom')), cancel: vi.fn() };
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(failing);

    setup();

    await screen.findByText(/could not preview this page/i);
  });

  it('shows an error when the page cannot even be loaded', async () => {
    pdfMocks.renderPdfPageToCanvas.mockRejectedValue(new Error('no page'));

    setup();

    await screen.findByText(/could not preview this page/i);
  });

  it('does not report an error when a superseded render is cancelled', async () => {
    // A render cancelled because the user moved on rejects with a cancellation
    // error; that is not a preview failure and must not surface as one.
    const cancelled = {
      promise: Promise.reject(new Error('Rendering cancelled')),
      cancel: vi.fn(),
    };
    pdfMocks.renderPdfPageToCanvas.mockResolvedValueOnce(cancelled);
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());

    setup();
    await waitFor(() => expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenCalledTimes(1));

    // Move to another page while the first render is still settling.
    await fireEvent.click(screen.getByRole('button', { name: /next page/i }));

    await waitFor(() =>
      expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenCalledTimes(2)
    );
    expect(screen.queryByText(/could not preview this page/i)).toBeNull();
  });

  it('recovers from a failed preview when another page is chosen', async () => {
    const failing = { promise: Promise.reject(new Error('boom')), cancel: vi.fn() };
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(failing);
    pdfMocks.renderPdfPageToCanvas.mockResolvedValueOnce(failing);

    setup();
    await screen.findByText(/could not preview this page/i);

    // The next page renders fine, so the error must clear.
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());
    await fireEvent.click(screen.getByRole('button', { name: /next page/i }));

    await waitFor(() =>
      expect(screen.queryByText(/could not preview this page/i)).toBeNull()
    );
  });

  it('redraws the page at the same resolution however the page is chosen', async () => {
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());

    setup();
    await waitFor(() => expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenCalled());

    const slider = screen.getByRole('slider');
    await fireEvent.input(slider, { target: { value: '2' } });

    await waitFor(() =>
      expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenLastCalledWith(
        expect.anything(),
        2,
        expect.anything(),
        { maxEdge: 1400 }
      )
    );
  });

  it('copies a finished page onto the visible canvas', async () => {
    // Size and "draw onto" whatever canvas the component provides, as the real
    // rasteriser does, so the copy step has something to move across.
    pdfMocks.renderPdfPageToCanvas.mockImplementationOnce(async (doc, page, canvas) =>
      taskOn(canvas)
    );

    const { container } = setup();
    const visible = container.querySelector('canvas');

    await waitFor(() => expect(visible.width).toBe(800));
    expect(visible.height).toBe(600);
    const scratch = pdfMocks.renderPdfPageToCanvas.mock.calls[0][2];
    expect(globalThis.__canvasTestUtil.getCtxCalls()).toEqual(
      expect.arrayContaining([['drawImage', [scratch, 0, 0]]])
    );
  });
});