<script>
  import PdfPagePreview from './PdfPagePreview.svelte';
  import '../styles/PdfPagePicker.css';

  let {
    doc,
    name,
    pageCount,
    onconfirm,
    oncancel,
  } = $props();

  let page = $state(1);

  function goToPage(next) {
    page = Math.min(pageCount, Math.max(1, next));
  }
</script>

<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby="pdf-page-title"
  tabindex="-1"
  onclick={(e) => { if (e.target === e.currentTarget) oncancel(); }}
  onkeydown={(e) => { if (e.key === 'Escape') oncancel(); }}
>
  <div class="modal pdf-modal">
    <h2 id="pdf-page-title">Choose a page</h2>
    <p class="modal-subtitle">{name} has {pageCount} pages.</p>

    <div class="pdf-preview-frame">
      <PdfPagePreview {doc} {page} />
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
