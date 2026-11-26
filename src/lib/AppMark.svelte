<script>
  import { MARK_ICON, MARK_PENNANT_PATH, MARK_POLE_PATH, MARK_POLE_WIDTH } from './flagMark.js';

  let { size = 30 } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 {MARK_ICON.size} {MARK_ICON.size}"
  role="img"
  aria-label="byom"
>
  <rect width={MARK_ICON.size} height={MARK_ICON.size} rx={MARK_ICON.radius} fill="var(--accent)" />
  <g transform="translate({MARK_ICON.x} {MARK_ICON.y}) scale({MARK_ICON.scale})">
    <path d={MARK_PENNANT_PATH} fill="var(--bg)" />
    <path
      d={MARK_POLE_PATH}
      fill="none"
      stroke="var(--bg)"
      stroke-width={MARK_POLE_WIDTH}
      stroke-linecap="round"
    />
  </g>
</svg>
