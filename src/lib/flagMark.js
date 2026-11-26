/**
 * The byom mark: barbuz's "b" (public/barbuz-mark.svg) flipped upside down,
 * with its bowl as a pennant. The bowl's own curve forms the pennant's top
 * edge and is mirrored below the tip, so the flag points sideways at
 * mid-height instead of down — using the bowl as the whole sail read as a
 * scythe. The foot of the pole is the marked point, which makes the same
 * shape a reference-point marker and the app icon.
 *
 * Coordinates are the source mark's own; "filled" means the bowl's counter is
 * painted in, so the pennant is a solid sail rather than the b's outline.
 */
const POLE = { x: 0, base: 82, width: 14 };

const PENNANT = {
  left: POLE.x - POLE.width / 2,
  top: 0,
  tipX: 56,
  tipY: 28,
  bottom: 56,
  control: { x: 0.653, y: 0.3333 },
};

const pennantSpanX = PENNANT.tipX - PENNANT.left;
const controlX = PENNANT.left + PENNANT.control.x * pennantSpanX;
const controlTopY = PENNANT.top + (PENNANT.tipY - PENNANT.top) * PENNANT.control.y;
const controlBottomY = PENNANT.bottom - (PENNANT.bottom - PENNANT.tipY) * PENNANT.control.y;

/** The pennant's top edge height at x, by inverting its monotonic x(t). */
function pennantEdgeY(x) {
  const a = PENNANT.left - 2 * controlX + PENNANT.tipX;
  const b = 2 * (controlX - PENNANT.left);
  const c = PENNANT.left - x;
  const t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return (1 - t) ** 2 * PENNANT.top + 2 * t * (1 - t) * controlTopY + t ** 2 * PENNANT.tipY;
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
  + ` Q${round(controlX)},${round(controlTopY)} ${PENNANT.tipX},${PENNANT.tipY}`
  + ` Q${round(controlX)},${round(controlBottomY)} ${round(PENNANT.left)},${PENNANT.bottom} Z`;

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
  const height = 40;
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
    // Number placement inside the pennant, as fractions of its box: left of
    // the tip, on the tip's own height where the sail is widest.
    labelX: 0.42,
    labelY: 0.5,
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
