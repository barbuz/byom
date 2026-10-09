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

/** A task whose render rejects. The promise is marked handled here because the
 *  component attaches its own handler only after the debounce; without this the
 *  rejection is reported as unhandled before then. */
function failingTask(message) {
  const promise = Promise.reject(new Error(message));
  promise.catch(() => {});
  return { promise, cancel: vi.fn() };
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

  it('skips the pages a fast drag flies past and renders only the final one', async () => {
    vi.useFakeTimers();
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());

    setup();
    await vi.runOnlyPendingTimersAsync();
    expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenCalledTimes(1);

    const slider = screen.getByRole('slider');
    // Every remaining position in quick succession, faster than the debounce.
    for (const value of ['2', '3', '4', '5']) {
      await fireEvent.input(slider, { target: { value } });
    }
    // Nothing has been rendered yet: the intermediate pages were never started.
    expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    await vi.runOnlyPendingTimersAsync();

    // Exactly one more render, for the page the user stopped on.
    expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenCalledTimes(2);
    expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenLastCalledWith(
      expect.anything(),
      5,
      expect.anything(),
      { maxEdge: 1400 }
    );

    vi.useRealTimers();
  });

  it('gives each render its own canvas so a fast drag cannot share one', async () => {
    vi.useFakeTimers();
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());

    setup();
    await vi.runOnlyPendingTimersAsync();

    const slider = screen.getByRole('slider');
    await fireEvent.input(slider, { target: { value: '2' } });
    await vi.advanceTimersByTimeAsync(200);
    await fireEvent.input(slider, { target: { value: '3' } });
    await vi.advanceTimersByTimeAsync(200);
    await fireEvent.input(slider, { target: { value: '4' } });
    await vi.advanceTimersByTimeAsync(200);

    // PDF.js rejects a canvas used by two renders at once; the picker never
    // reuses one, which is what caused spurious failures while sliding.
    const canvases = pdfMocks.renderPdfPageToCanvas.mock.calls.map((c) => c[2]);
    expect(canvases.length).toBeGreaterThan(1);
    expect(new Set(canvases).size).toBe(canvases.length);

    vi.useRealTimers();
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

  it('does not render if the page changes again before the render starts', async () => {
    vi.useFakeTimers();
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());

    setup();
    await vi.runOnlyPendingTimersAsync();
    const before = pdfMocks.renderPdfPageToCanvas.mock.calls.length;

    await fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await fireEvent.click(screen.getByRole('button', { name: /next page/i }));

    // Both opens are still inside the debounce, so neither has rendered yet.
    expect(pdfMocks.renderPdfPageToCanvas.mock.calls.length).toBe(before);

    await vi.advanceTimersByTimeAsync(200);
    await vi.runOnlyPendingTimersAsync();

    // Only the page landed on is rendered, exactly once.
    expect(pdfMocks.renderPdfPageToCanvas.mock.calls.length).toBe(before + 1);
    expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenLastCalledWith(
      expect.anything(),
      3,
      expect.anything(),
      { maxEdge: 1400 }
    );

    vi.useRealTimers();
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
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(failingTask('boom'));

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
    const cancelled = failingTask('Rendering cancelled');
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
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(failingTask('boom'));
    pdfMocks.renderPdfPageToCanvas.mockResolvedValueOnce(failingTask('boom'));

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

  it('renders straight onto the canvas shown in the preview frame', async () => {
    // Size whatever canvas the component provides, as the real rasteriser does.
    pdfMocks.renderPdfPageToCanvas.mockImplementationOnce(async (doc, page, canvas) =>
      taskOn(canvas)
    );

    const { container } = setup();
    const frame = container.querySelector('.pdf-preview-frame');

    await waitFor(() => expect(frame.querySelector('canvas')).not.toBeNull());
    const canvas = frame.querySelector('canvas');
    expect(canvas.classList.contains('pdf-preview')).toBe(true);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    // PDF.js paints the shown canvas itself; there is no later copy step.
    expect(pdfMocks.renderPdfPageToCanvas.mock.calls[0][2]).toBe(canvas);
  });

  it('swaps in a fresh canvas element for each page so renders never share one', async () => {
    vi.useFakeTimers();
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());

    const { container } = setup();
    await vi.runOnlyPendingTimersAsync();
    const frame = container.querySelector('.pdf-preview-frame');
    const first = frame.querySelector('canvas');

    const slider = screen.getByRole('slider');
    await fireEvent.input(slider, { target: { value: '2' } });
    await vi.advanceTimersByTimeAsync(200);
    await vi.runOnlyPendingTimersAsync();

    const second = frame.querySelector('canvas');
    expect(second).not.toBe(first);
    // Only the newest canvas stays mounted.
    expect(frame.querySelectorAll('canvas').length).toBe(1);

    vi.useRealTimers();
  });
});