<script>
  let { version = '' } = $props();
  const barbuzMark = `${import.meta.env.BASE_URL}barbuz-mark.svg`;
</script>

<footer class="app-footer">
  <p class="app-footer__links">
    <a class="app-footer__brand" href="https://barbuz.github.io" aria-label="made by barbuz">
      <img class="app-footer__mark" src={barbuzMark} alt="" />
      <span>made by <strong>arbuz</strong></span>
    </a>
    <span class="app-footer__dot" aria-hidden="true">·</span>
    <a href="https://github.com/barbuz/byom">source <span aria-hidden="true">↗</span></a>
    <span class="app-footer__dot" aria-hidden="true">·</span>
    <a href="https://donate.stripe.com/9B6eVd1madcF8Dt8yp1gs00">leave a tip <span aria-hidden="true">↗</span></a>
  </p>
  {#if version}
    <p class="app-footer__version">v{version}</p>
  {/if}
</footer>

<style>
  .app-footer {
    margin: var(--space-16) 0 var(--space-6);
    text-align: center;
    font-family: var(--font-mono);
    font-size: 0.66rem;
    letter-spacing: 0.02em;
    color: var(--muted);
  }

  .app-footer__links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin: 0;
  }

  .app-footer a {
    color: var(--muted);
    text-decoration: none;
    transition: color var(--dur-fast) var(--ease);
  }

  .app-footer a:hover {
    color: var(--accent);
  }

  .app-footer__brand {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .app-footer__mark {
    height: 1.05em;
    width: auto;
    display: block;
  }

  .app-footer__brand strong {
    color: var(--text);
    font-weight: 600;
  }

  .app-footer__brand:hover strong {
    color: inherit;
  }

  .app-footer__dot {
    color: var(--line);
  }

  .app-footer__version {
    margin: 0.5rem 0 0;
    font-size: 0.62rem;
    color: var(--muted);
    opacity: 0.7;
  }
</style>
