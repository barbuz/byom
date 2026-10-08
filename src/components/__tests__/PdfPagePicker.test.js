import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import PdfPagePicker from '../PdfPagePicker.svelte';

const pdfMocks = vi.hoisted(() => ({
  renderPdfPageToCanvas: vi.fn(),
}));

vi.mock('../../lib/pdf.js', () => ({
  SCROLL_PREVIEW_DIMENSION: 400,
  SETTLED_PREVIEW_DIMENSION: 1400,
  renderPdfPageToCanvas: pdfMocks.renderPdfPageToCanvas,
}));

function makeTask() {
  return { promise: Promise.resolve(), cancel: vi.fn() };
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
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('PdfPagePicker', () => {
  it('renders a detailed preview of the first page on open', async () => {
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

  it('uses the cheap preview while sliding, then the detailed one on release', async () => {
    vi.useFakeTimers();
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());

    setup();
    await vi.runOnlyPendingTimersAsync();

    const slider = screen.getByRole('slider');
    await fireEvent.input(slider, { target: { value: '4' } });

    await waitFor(() =>
      expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenLastCalledWith(
        expect.anything(),
        4,
        expect.anything(),
        { maxEdge: 400 }
      )
    );

    await vi.advanceTimersByTimeAsync(300);
    await waitFor(() =>
      expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenLastCalledWith(
        expect.anything(),
        4,
        expect.anything(),
        { maxEdge: 1400 }
      )
    );

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

  it('settles to the detailed preview on release without a pending timer', async () => {
    pdfMocks.renderPdfPageToCanvas.mockResolvedValue(makeTask());

    setup();
    await waitFor(() => expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenCalled());

    const slider = screen.getByRole('slider');
    await fireEvent.input(slider, { target: { value: '2' } });
    await fireEvent.change(slider);

    await waitFor(() =>
      expect(pdfMocks.renderPdfPageToCanvas).toHaveBeenLastCalledWith(
        expect.anything(),
        2,
        expect.anything(),
        { maxEdge: 1400 }
      )
    );
  });
});
