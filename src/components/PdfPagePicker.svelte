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

  // Wait for the page to hold still before rasterising it. Sliding the slider
  // fires an input event per position, and rasterising a page costs roughly
  // 0.1 s, so rendering every position would queue a run for each page the user
  // flies past. A short pause means intermediate pages are skipped entirely and
  // only the page the user lands on is ever drawn.
  const PREVIEW_DEBOUNCE_MS = 120;

  let page = $state(1);
  let previewFailed = $state(false);
  let previewStage = $state(null);

  $effect(() => {
    const stage = previewStage;
    const target = page;
    if (!stage) return;

    // A new page supersedes any error from the previous one straight away, even
    // while the render itself is still waiting out the debounce.
    previewFailed = false;

    let cancelled = false;
    let task = null;

    const timer = setTimeout(() => {
      if (cancelled) return;

      // Each render gets a brand-new canvas element, attached before it paints.
      // PDF.js tracks a canvas in a WeakSet and refuses a second render while
      // one is still in flight on it; a superseded render can still be starting
      // (getPage is async, so there is no task to cancel yet), but a new element
      // shares no state with it, so that collision cannot happen. Painting
      // directly into the attached canvas lets PDF.js draw the page in stages
      // (background, then text and images) so the preview fills in as it goes,
      // instead of staying blank until a finished copy is swapped in.
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-preview';
      stage.replaceChildren(canvas);

      renderPdfPageToCanvas(doc, target, canvas, { maxEdge: PREVIEW_DIMENSION })
        .then((started) => {
          task = started;
          return started.promise;
        })
        .catch(() => {
          // A render we cancelled is not a failure; only a genuine error is.
          if (!cancelled) previewFailed = true;
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
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
      <!-- Empty and untouched by Svelte, so each render can swap its canvas in. -->
      <div class="pdf-preview-stage" bind:this={previewStage}></div>
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
