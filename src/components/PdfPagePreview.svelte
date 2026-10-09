<script>
  import { untrack } from 'svelte';
  import { renderPdfPageToCanvas } from '../lib/pdf.js';

  let { doc, page, maxEdge } = $props();

  // Wait for the page to hold still before rasterising it. Sliding the slider
  // fires an input event per position, and rasterising a page costs roughly
  // 0.1 s, so rendering every position would queue a run for each page the user
  // flies past. A short pause means only the page the user lands on is drawn.
  const DEBOUNCE_MS = 120;

  // The page the canvas is keyed to. It trails `page` by the debounce, so a fast
  // drag leaves the key unchanged and not a single intermediate page is drawn.
  let renderPage = $state(page);
  let failed = $state(false);
  let canvasEl = $state(null);

  $effect(() => {
    // Read `page` synchronously so the effect tracks it; the delayed write below
    // is what makes the canvas key change only once the page holds still.
    const target = page;
    const settle = setTimeout(() => {
      renderPage = target;
    }, DEBOUNCE_MS);
    return () => clearTimeout(settle);
  });

  $effect(() => {
    // Depend on the canvas element alone: `{#key}` hands us a new one per page,
    // so re-rendering is tied to the element swap and a page is never drawn
    // twice onto the same canvas.
    const canvas = canvasEl;
    const target = untrack(() => renderPage);
    if (!canvas) return;

    // A new page supersedes any error from the previous one.
    failed = false;

    let cancelled = false;
    let task = null;

    renderPdfPageToCanvas(doc, target, canvas, { maxEdge })
      .then((started) => {
        task = started;
        return started.promise;
      })
      .catch(() => {
        // A render we cancelled is not a failure; only a genuine error is.
        if (!cancelled) failed = true;
      });

    return () => {
      cancelled = true;
      if (task) task.cancel();
    };
  });
</script>

<!-- A fresh canvas per page. PDF.js forbids a canvas shared by two renders, and
     a superseded render can still be starting when the next one begins, but a
     recreated element shares no state with it, so that collision cannot happen.
     Painting straight onto the canvas also lets PDF.js draw in stages, so the
     preview fills in as it goes instead of waiting for a finished page. -->
{#key renderPage}
  <canvas class="pdf-preview" bind:this={canvasEl}></canvas>
{/key}

{#if failed}
  <p class="pdf-preview-error">Could not preview this page.</p>
{/if}
