<script>
  import {
    SCROLL_PREVIEW_DIMENSION,
    SETTLED_PREVIEW_DIMENSION,
    renderPdfPageToCanvas,
  } from '../lib/pdf.js';
  import '../styles/PdfPagePicker.css';

  let {
    doc,
    name,
    pageCount,
    onconfirm,
    oncancel,
  } = $props();

  // Delay after the last slider move before the detailed render starts. Long
  // enough to cover a flick, short enough to feel immediate on release.
  const SETTLE_DELAY_MS = 250;

  let page = $state(1);
  // 'scrolling' draws the cheap preview; 'settled' draws the detailed one.
  let phase = $state('settled');
  let previewFailed = $state(false);
  let canvasEl = $state(null);

  // Not $state: these are bookkeeping for the render effect, never rendered.
  let settleTimer = null;

  const maxEdge = $derived(
    phase === 'scrolling' ? SCROLL_PREVIEW_DIMENSION : SETTLED_PREVIEW_DIMENSION,
  );

  $effect(() => {
    const el = canvasEl;
    const target = page;
    const edge = maxEdge;
    if (!el) return;

    let cancelled = false;
    let task = null;

    // A previous page may have failed; give this one a clean slate.
    previewFailed = false;

    renderPdfPageToCanvas(doc, target, el, { maxEdge: edge })
      .then((started) => {
        task = started;
        return started.promise.catch(() => {
          if (!cancelled) previewFailed = true;
        });
      })
      .catch(() => {
        if (!cancelled) previewFailed = true;
      });

    return () => {
      // A newer page/phase supersedes this render; cancelling keeps only the
      // latest pass on the main thread.
      cancelled = true;
      if (task) task.cancel();
    };
  });

  $effect(() => () => clearTimeout(settleTimer));

  function goToPage(next, { settleNow = true } = {}) {
    page = Math.min(pageCount, Math.max(1, next));
    if (settleNow) {
      clearTimeout(settleTimer);
      phase = 'settled';
    }
  }

  function handleSlide(event) {
    goToPage(Number(event.target.value), { settleNow: false });
    phase = 'scrolling';
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      phase = 'settled';
    }, SETTLE_DELAY_MS);
  }

  function handleSettle() {
    clearTimeout(settleTimer);
    phase = 'settled';
  }
</script>

<div class="modal-backdrop">
  <div class="modal pdf-modal" role="dialog" aria-modal="true" aria-labelledby="pdf-page-title">
    <h2 id="pdf-page-title">Choose a page</h2>
    <p class="modal-subtitle">{name} has {pageCount} pages.</p>

    <div class="pdf-preview-frame">
      <canvas class="pdf-preview" bind:this={canvasEl}></canvas>
      {#if previewFailed}
        <p class="pdf-preview-error">Could not preview this page.</p>
      {/if}
    </div>

    <div class="pdf-controls">
      <button class="pdf-nav" onclick={() => goToPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
        ‹
      </button>
      <input
        class="pdf-scroll"
        type="range"
        min="1"
        max={pageCount}
        value={page}
        oninput={handleSlide}
        onchange={handleSettle}
        aria-label="Page"
      />
      <button class="pdf-nav" onclick={() => goToPage(page + 1)} disabled={page >= pageCount} aria-label="Next page">
        ›
      </button>
    </div>

    <label class="modal-field pdf-page-field">
      Page
      <input
        type="number"
        min="1"
        max={pageCount}
        value={page}
        oninput={(e) => goToPage(Number(e.target.value))}
      />
      of {pageCount}
    </label>

    <div class="modal-actions">
      <button class="menu-item" onclick={oncancel}>Cancel</button>
      <button class="menu-item primary" onclick={() => onconfirm(page)}>Import page</button>
    </div>
  </div>
</div>
