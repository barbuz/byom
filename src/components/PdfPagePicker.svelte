<script>
  import { PREVIEW_DIMENSION, renderPdfPageToCanvas } from '../lib/pdf.js';
  import '../styles/PdfPagePicker.css';

  let {
    doc,
    name,
    pageCount,
    onconfirm,
    oncancel,
  } = $props();

  let page = $state(1);
  let previewFailed = $state(false);
  let canvasEl = $state(null);

  $effect(() => {
    const visible = canvasEl;
    const target = page;
    if (!visible) return;

    let cancelled = false;
    let task = null;

    // Render onto a private canvas and copy the finished page across. PDF.js
    // rejects a canvas shared by two renders, and when the slider moves quickly
    // a superseded render can still be starting — its task is created only after
    // `getPage` resolves, which may be after the next page's render has begun.
    // Giving each render its own canvas removes that shared state, so a fast
    // drag can never make PDF.js fail the current preview. The copy happens only
    // once a render succeeds, so the visible canvas keeps the last good page
    // until the next one is ready.
    const scratch = document.createElement('canvas');
    previewFailed = false;

    renderPdfPageToCanvas(doc, target, scratch, { maxEdge: PREVIEW_DIMENSION })
      .then((started) => {
        task = started;
        return started.promise;
      })
      .then(() => {
        if (cancelled) return;
        visible.width = scratch.width;
        visible.height = scratch.height;
        visible.getContext('2d').drawImage(scratch, 0, 0);
      })
      .catch(() => {
        // A render we cancelled is not a failure; only a genuine error is.
        if (!cancelled) previewFailed = true;
      });

    return () => {
      cancelled = true;
      if (task) task.cancel();
    };
  });

  function goToPage(next) {
    page = Math.min(pageCount, Math.max(1, next));
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
        oninput={(e) => goToPage(Number(e.target.value))}
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
