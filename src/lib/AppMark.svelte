<script>
  let { size = 30 } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="byom">
  <rect width="64" height="64" rx="14" fill="var(--bg)" />
  <rect x="12" y="14" width="40" height="36" rx="4" fill="none" stroke="var(--text)" stroke-width="4" />
  <path
    d="M18 42 L27 32 L34 38 L45 24"
    fill="none"
    stroke="var(--accent)"
    stroke-width="4"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
  <circle cx="45" cy="24" r="4" fill="var(--accent)" />
</svg>
