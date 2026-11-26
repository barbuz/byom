/**
 * The byom mark: barbuz's "b" (public/barbuz-mark.svg) flipped upside down
 * and filled, so its stem reads as a flagpole and its bowl as a pennant. The
 * foot of the pole is the marked point, which makes the same shape a
 * reference-point marker and the app icon.
 *
 * Coordinates are the source mark's own; "filled" means the bowl's counter is
 * painted in, so the pennant is a solid sail rather than the b's outline.
 */
const POLE = { x: 0, top: 6, base: 94, width: 14 };

export const MARK = {
  pole: POLE,
  // The pennant starts at the pole's outer edge and at the tip of its round
  // cap, so the pole end is buried in the flag instead of poking out above it.
  // Its top edge runs flat across that cap and then sweeps to the tip, and the
  // sweep's control point sits at the top so the join stays smooth.
  pennant: {
    left: POLE.x - POLE.width / 2,
    top: POLE.top - POLE.width / 2,
    flatTo: POLE.x + POLE.width / 2,
    tipX: 46,
    bottom: 50,
    control: { x: 0.653, y: 0.3333 },
  },
};

// Bounds include the pole's round caps.
export const MARK_BOUNDS = {
  minX: MARK.pole.x - MARK.pole.width / 2,
  maxX: MARK.pennant.tipX,
  minY: MARK.pole.top - MARK.pole.width / 2,
  maxY: MARK.pole.base + MARK.pole.width / 2,
};

const round = (value) => Number(value.toFixed(2));

export const MARK_POLE_WIDTH = MARK.pole.width;
export const MARK_POLE_PATH = `M${MARK.pole.x},${MARK.pole.top} L${MARK.pole.x},${MARK.pole.base}`;

/** The pennant's Bezier control point, normalised to the pennant's box. */
export const PENNANT_CONTROL = MARK.pennant.control;

const pennantSpanX = MARK.pennant.tipX - MARK.pennant.left;
const pennantSpanY = MARK.pennant.bottom - MARK.pennant.top;
export const MARK_PENNANT_PATH =
  `M${round(MARK.pennant.left)},${round(MARK.pennant.top)}`
  + ` L${round(MARK.pennant.flatTo)},${round(MARK.pennant.top)}`
  + ` Q${round(MARK.pennant.left + PENNANT_CONTROL.x * pennantSpanX)},`
  + `${round(MARK.pennant.top + PENNANT_CONTROL.y * pennantSpanY)}`
  + ` ${MARK.pennant.tipX},${MARK.pennant.bottom}`
  + ` L${round(MARK.pennant.left)},${MARK.pennant.bottom} Z`;

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
 * the location it marks. It is a squat version of the mark, sized so the
 * point's number fits inside the pennant instead of in a separate badge.
 */
export const POINT_FLAG = {
  poleHeight: 32,
  poleWidth: 3.2,
  width: 30,
  height: 22,
  halo: 1.6,
  footRadius: 2.3,
  hoverScale: 1.12,
  // Number placement inside the pennant, as fractions of its box.
  labelX: 0.38,
  labelY: 0.66,
};

/**
 * Screen-space box, measured from the foot, that counts as tapping a flag. It
 * covers the largest (hovered) marker.
 */
export const FLAG_HIT = {
  left: POINT_FLAG.poleWidth / 2 + 2,
  right: POINT_FLAG.width * POINT_FLAG.hoverScale + 2,
  up: POINT_FLAG.poleHeight * POINT_FLAG.hoverScale + 2,
  down: POINT_FLAG.footRadius + 2,
};
