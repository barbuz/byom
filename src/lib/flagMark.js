/**
 * The byom mark: barbuz's "b" (public/barbuz-mark.svg) flipped upside down
 * and filled, so its stem reads as a flagpole and its bowl as a pennant. The
 * foot of the pole is the marked point, which makes the same shape a
 * reference-point marker and the app icon.
 *
 * Coordinates are the source mark's own; "filled" means the bowl's counter is
 * painted in, so the pennant is a solid sail rather than the b's outline.
 */
const POLE = { x: 0, base: 94, width: 14 };

/** The bowl's outline, kept exactly as the b has it. */
const PENNANT = {
  left: POLE.x - POLE.width / 2,
  top: -1,
  tipX: 46,
  bottom: 50,
  control: { x: 0.653, y: 0.3333 },
};

const pennantSpanX = PENNANT.tipX - PENNANT.left;
const pennantSpanY = PENNANT.bottom - PENNANT.top;
const controlX = PENNANT.left + PENNANT.control.x * pennantSpanX;
const controlY = PENNANT.top + PENNANT.control.y * pennantSpanY;

/** The bowl's height at x, by inverting the curve's monotonic x(t). */
function pennantEdgeY(x) {
  const a = PENNANT.left - 2 * controlX + PENNANT.tipX;
  const b = 2 * (controlX - PENNANT.left);
  const c = PENNANT.left - x;
  const t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return (1 - t) ** 2 * PENNANT.top + 2 * t * (1 - t) * controlY + t ** 2 * PENNANT.bottom;
}

/**
 * Where the pole's stroke ends. The stroke's round cap is a circle of the
 * pole's half-width, and ending it at the b's own stem top leaves that cap
 * standing proud of the flag's top edge — a nick at the top of the pole. So
 * the stroke stops where the cap sits just under the bowl's curve, which is
 * found by sampling the curve across the stem's width.
 */
const POLE_END = (() => {
  const radius = POLE.width / 2;
  let end = PENNANT.top;
  for (let i = -32; i <= 32; i += 1) {
    const x = (i / 32) * radius;
    end = Math.max(end, pennantEdgeY(x) + Math.sqrt(radius * radius - x * x));
  }
  return end;
})();

export const MARK = {
  pole: { ...POLE, end: POLE_END },
  pennant: PENNANT,
};

// Bounds include the pole's round caps; the bowl's top is the highest point.
export const MARK_BOUNDS = {
  minX: PENNANT.left,
  maxX: PENNANT.tipX,
  minY: PENNANT.top,
  maxY: POLE.base + POLE.width / 2,
};

const round = (value) => Number(value.toFixed(2));

export const MARK_POLE_WIDTH = POLE.width;
export const MARK_POLE_PATH = `M${POLE.x},${round(POLE_END)} L${POLE.x},${POLE.base}`;

/** The pennant's Bezier control point, normalised to the pennant's box. */
export const PENNANT_CONTROL = PENNANT.control;

export const MARK_PENNANT_PATH =
  `M${round(PENNANT.left)},${round(PENNANT.top)}`
  + ` Q${round(controlX)},${round(controlY)}`
  + ` ${PENNANT.tipX},${PENNANT.bottom}`
  + ` L${round(PENNANT.left)},${PENNANT.bottom} Z`;

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
 * Screen-space marker for a reference point, in CSS pixels: the mark at a
 * fixed height, so the marker keeps the mark's own proportions — stem length
 * and width, bowl curve and all. The foot sits exactly on the point and the
 * flag flies above it, so the marker never covers the location it marks.
 * `scale` converts mark units to marker pixels; `pennant` is the bowl's box,
 * which is where the number goes.
 */
export const POINT_FLAG = (() => {
  const height = 42;
  const scale = height / (MARK_BOUNDS.maxY - MARK_BOUNDS.minY);
  const y = (markY) => (markY - MARK_BOUNDS.maxY) * scale;
  return {
    height,
    scale,
    width: (MARK_BOUNDS.maxX - MARK_BOUNDS.minX) * scale,
    poleWidth: POLE.width * scale,
    pennant: {
      left: PENNANT.left * scale,
      top: y(PENNANT.top),
      width: (PENNANT.tipX - PENNANT.left) * scale,
      height: (PENNANT.bottom - PENNANT.top) * scale,
    },
    halo: 1.6,
    hoverScale: 1.12,
    // Number placement inside the bowl, as fractions of its box: its centroid
    // (0.37, 0.63), nudged down so the digits sit in the sail rather than
    // crowding the curve above them.
    labelX: 0.4,
    labelY: 0.7,
  };
})();

/**
 * Screen-space box, measured from the foot, that counts as tapping a flag. It
 * covers the largest (hovered) marker.
 */
export const FLAG_HIT = {
  left: POINT_FLAG.pennant.left * POINT_FLAG.hoverScale - 2,
  right: (POINT_FLAG.pennant.left + POINT_FLAG.pennant.width) * POINT_FLAG.hoverScale + 2,
  up: -POINT_FLAG.pennant.top * POINT_FLAG.hoverScale + 2,
  down: POINT_FLAG.poleWidth / 2 + 2,
};
