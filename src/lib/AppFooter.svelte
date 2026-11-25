<script>
  let { version = '' } = $props();
</script>

<footer class="app-footer">
  <p class="app-footer__links">
    <a href="https://barbuz.github.io">made by barbuz</a>
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
