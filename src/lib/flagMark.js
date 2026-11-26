/**
 * The byom mark: barbuz's "b" (public/barbuz-mark.svg) flipped upside down
 * and filled, so its stem reads as a flagpole and its bowl as a pennant. The
 * foot of the pole is the marked point, which makes the same shape a
 * reference-point marker and the app icon.
 *
 * Coordinates are the source mark's own; "filled" means the bowl's counter is
 * painted in, so the pennant is a solid sail rather than the b's outline.
 */
export const MARK = {
  pole: { x: 0, top: 6, base: 94, width: 14 },
  pennant: { left: 0, top: 6, controlX: 30.04, controlY: 20.64, tipX: 46, bottom: 50 },
};

// Bounds include the pole's round caps.
export const MARK_BOUNDS = {
  minX: MARK.pole.x - MARK.pole.width / 2,
  maxX: MARK.pennant.tipX,
  minY: MARK.pole.top - MARK.pole.width / 2,
  maxY: MARK.pole.base + MARK.pole.width / 2,
};

export const MARK_POLE_WIDTH = MARK.pole.width;
export const MARK_POLE_PATH = `M${MARK.pole.x},${MARK.pole.top} L${MARK.pole.x},${MARK.pole.base}`;
export const MARK_PENNANT_PATH =
  `M${MARK.pennant.left},${MARK.pennant.top}`
  + ` Q${MARK.pennant.controlX},${MARK.pennant.controlY} ${MARK.pennant.tipX},${MARK.pennant.bottom}`
  + ` L${MARK.pennant.left},${MARK.pennant.bottom} Z`;

/** The pennant's Bezier control point, normalised to the pennant's box. */
export const PENNANT_CONTROL = {
  x: (MARK.pennant.controlX - MARK.pennant.left) / (MARK.pennant.tipX - MARK.pennant.left),
  y: (MARK.pennant.controlY - MARK.pennant.top) / (MARK.pennant.bottom - MARK.pennant.top),
};

/**
 * Where the mark sits inside the square app icon. The content box is 44 of 64
 * units, which keeps it inside the maskable icon's safe circle (80%).
 */
export const MARK_ICON = (() => {
  const size = 64;
  const box = size - 2 * 10;
  const scale = Math.min(
    box / (MARK_BOUNDS.maxX - MARK_BOUNDS.minX),
    box / (MARK_BOUNDS.maxY - MARK_BOUNDS.minY),
  );
  return {
    size,
    radius: 14,
    scale,
    x: size / 2 - ((MARK_BOUNDS.minX + MARK_BOUNDS.maxX) / 2) * scale,
    y: size / 2 - ((MARK_BOUNDS.minY + MARK_BOUNDS.maxY) / 2) * scale,
  };
})();

/**
 * Screen-space marker for a reference point, in CSS pixels. The foot sits
 * exactly on the point and the flag flies above it, so the marker never covers
 * the location it marks. Proportions follow the mark, tuned for a legible
 * 30 px marker: a slightly wider pennant and a slimmer pole than the icon.
 */
export const POINT_FLAG = {
  poleHeight: 30,
  poleWidth: 3.2,
  width: 19,
  height: 15,
  halo: 1.6,
  footRadius: 2.3,
  hoverScale: 1.12,
  // The number badge straddles the pole's top and is centred this far above it.
  badgeHeight: 17,
  badgeCentreUp: 4,
};

/**
 * Screen-space box, measured from the foot, that counts as tapping a flag. It
 * covers the largest (hovered) marker and its number badge.
 */
export const FLAG_HIT = {
  left: POINT_FLAG.poleWidth + 3,
  right: POINT_FLAG.width * POINT_FLAG.hoverScale + 3,
  up: POINT_FLAG.poleHeight * POINT_FLAG.hoverScale
    + POINT_FLAG.badgeCentreUp
    + POINT_FLAG.badgeHeight / 2
    + 3,
  down: POINT_FLAG.footRadius + 3,
};
