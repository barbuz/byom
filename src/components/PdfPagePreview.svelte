<script>
  import { PREVIEW_DIMENSION, renderPdfPageToCanvas } from '../lib/pdf.js';

  let { doc, page } = $props();

  // Wait for the page to hold still before rasterising it. Sliding the slider
  // fires an input event per position, and rasterising a page costs roughly
  // 0.1 s, so rendering every position would queue a run for each page the user
  // flies past. A short pause means only the page the user lands on is drawn.
  const DEBOUNCE_MS = 120;

  // The host owns the rendered canvas, but nothing Svelte manages lives inside
  // it, so replacing its children cannot disturb the {#if} below.
  let host = $state(null);
  let failed = $state(false);

  // The one effect this component needs: rasterising a canvas is an imperative
  // side effect, which is what $effect is for. It owns the whole lifecycle —
  // debounce, fresh canvas, cancellation — so there is no cross-effect coupling.
  $effect(() => {
    const target = page;
    const container = host;
    if (!container) return;

    let superseded = false;
    let task = null;

    const settle = setTimeout(() => {
      // A new page supersedes any error from the previous one.
      failed = false;

      // A fresh canvas per render. PDF.js forbids a canvas shared by two
      // renders, and a superseded render can still be starting when the next
      // one begins, but a new element shares no state with it, so that
      // collision cannot happen. Attaching it before the render starts is what
      // lets PDF.js paint in stages, so the preview fills in as it is drawn.
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-preview';
      container.replaceChildren(canvas);

      renderPdfPageToCanvas(doc, target, canvas, { maxEdge: PREVIEW_DIMENSION })
        .then((started) => {
          task = started;
          return started.promise;
        })
        .catch(() => {
          // A render we superseded is not a failure; only a genuine error is.
          if (!superseded) failed = true;
        });
    }, DEBOUNCE_MS);

    return () => {
      superseded = true;
      clearTimeout(settle);
      if (task) task.cancel();
    };
  });
</script>

<!-- One root, owned by this component, so it is a single flex item in the
     parent's preview frame and the error sits under the canvas instead of
     competing with it. -->
<div class="pdf-preview-stage">
  <div class="pdf-preview-host" bind:this={host}></div>

  {#if failed}
    <p class="pdf-preview-error">Could not preview this page.</p>
  {/if}
</div>
