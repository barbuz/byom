/**
 * Latitude/longitude graticule: a real coordinate grid drawn over the map.
 *
 * One fine grid is built once per georeference, at a base step derived from the
 * map's ground extent. The step is a "nice" number from the ladder
 * `{1, 2, 5} x 10^k`, so every displayed line value carries the fewest decimals
 * that still give a usable grid (45.63, not 45.634636774). Because the ladder is
 * multiplicative, a coarser level is exactly a subset of the fine grid, so the
 * renderer can show or hide lines purely by selecting a level - it never
 * re-projects coordinates.
 *
 * The base cells are sized to be roughly square *on the ground* rather than to
 * inherit the image's aspect ratio: both steps come from one metre-based target
 * cell, and the longitude step is divided by `cos(lat0)` because a degree of
 * longitude spans only that fraction of the ground a degree of latitude does.
 * Round-degree values and exact squareness cannot both hold, so this is a
 * best-fit within the nice ladder.
 *
 * Everything here is pure: no canvas, no DOM. The geometry is computed once and
 * cached on the caller's side; only `pickGridStepForScale` runs per frame.
 */

import { metersPerDegreeLon } from './transforms.js';
import { imageCornersToMetricBounds } from './mapMatch.js';

// One metre-based target cell per axis; keeps each axis to ~maxDivisions lines.
export const DEFAULT_MAX_DIVISIONS = 64;
// Samples per generated line; enough to render an MLS curve without kinks.
export const DEFAULT_SAMPLES = 16;
// Minimum on-screen spacing between shown lines, in CSS pixels.
export const MIN_SPACING_PX = 64;
// Mean metres per degree of latitude, matching transforms.js.
export const METERS_PER_DEG_LAT = 111320;

const DEG_TO_RAD = Math.PI / 180;
const LADDER = [1, 2, 5];

/**
 * Smallest `{1, 2, 5} x 10^k` value that is >= `value`.
 * @param {number} value
 * @returns {number|null} The nice step, or null for non-finite/non-positive input.
 */
export function niceStepAtLeast(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const exponent = Math.floor(Math.log10(value));
  for (const mantissa of LADDER) {
    const candidate = mantissa * Math.pow(10, exponent);
    if (candidate >= value * (1 - 1e-9)) return candidate;
  }
  return Math.pow(10, exponent + 1);
}

/**
 * Nearest `{1, 2, 5} x 10^k` value to `value`.
 * @param {number} value
 * @returns {number|null} The nice step, or null for non-finite/non-positive input.
 */
export function niceStepNear(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const exponent = Math.floor(Math.log10(value));
  let best = null;
  for (const mantissa of [...LADDER, 10]) {
    const candidate = mantissa * Math.pow(10, exponent);
    if (best === null || Math.abs(candidate - value) < Math.abs(best - value)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Decimal places needed to write a nice step exactly: 0.01 -> 2, 0.05 -> 2,
 * 0.2 -> 1, 2 -> 0. Used to round line values and format their labels.
 * @param {number} step
 * @returns {number}
 */
export function decimalPlacesFor(step) {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
}

/**
 * The nice steps at or above `baseStep`, up to `span`, that are integer
 * multiples of it. Restricting to multiples is what guarantees a coarser level
 * is exactly a subset of the generated grid on each axis.
 * @param {number} baseStep
 * @param {number} span
 * @returns {Array<number>} Ascending steps.
 */
function levelsFor(baseStep, span) {
  if (!baseStep || !(span > 0)) return [];
  const levels = [];
  const exponent = Math.floor(Math.log10(baseStep));
  for (let k = exponent - 1; k <= exponent + 6; k++) {
    for (const mantissa of LADDER) {
      const candidate = mantissa * Math.pow(10, k);
      if (candidate < baseStep * (1 - 1e-9)) continue;
      if (candidate > span * (1 + 1e-9)) continue;
      const ratio = candidate / baseStep;
      if (Math.abs(ratio - Math.round(ratio)) > 1e-6) continue;
      if (!levels.some((value) => Math.abs(value - candidate) < 1e-12)) {
        levels.push(candidate);
      }
    }
  }
  levels.sort((a, b) => a - b);
  return levels.length > 0 ? levels : [baseStep];
}

/**
 * Catmull-Rom through `points`, expressed as cubic Bezier segments. Each output
 * segment is `{c1, c2, to}`; the first point is the path's `moveTo` target.
 * Endpoints are clamped (a phantom point equal to the first/last), which keeps
 * the curve interpolating every sample.
 * @param {Array<{u: number, v: number}>} points
 * @returns {Array<{c1: {u: number, v: number}, c2: {u: number, v: number}, to: {u: number, v: number}}>}
 */
function catmullRomCurves(points) {
  const curves = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];
    curves.push({
      c1: { u: p1.u + (p2.u - p0.u) / 6, v: p1.v + (p2.v - p0.v) / 6 },
      c2: { u: p2.u - (p3.u - p1.u) / 6, v: p2.v - (p3.v - p1.v) / 6 },
      to: { u: p2.u, v: p2.v },
    });
  }
  return curves;
}

/**
 * Round a line value to kill floating-point noise from `index * step`.
 * @param {number} value
 * @param {number} step
 * @returns {number}
 */
function cleanValue(value, step) {
  const decimals = decimalPlacesFor(step) + 4;
  return Number(value.toFixed(Math.min(decimals, 12)));
}

/**
 * Build the fine graticule for a georeference. Returns null when there is no
 * usable georeference, a non-positive image dimension, or a degenerate span, so
 * callers can treat "no grid" as an empty result rather than an error.
 * @param {Object|null} georeference - From createGeoreference.
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {Object} [options]
 * @param {number} [options.maxDivisions]
 * @param {number} [options.samples]
 * @returns {Object|null} Grid, or null.
 */
export function buildGraticule(georeference, imageWidth, imageHeight, options = {}) {
  const { maxDivisions = DEFAULT_MAX_DIVISIONS, samples = DEFAULT_SAMPLES } = options;
  if (!georeference || !georeference.geoToUV) return null;
  if (!(imageWidth > 0) || !(imageHeight > 0)) return null;
  if (!(maxDivisions > 0) || !(samples >= 2)) return null;

  const bounds = imageCornersToMetricBounds(georeference, imageWidth, imageHeight);
  if (!bounds) return null;

  const northSpan = bounds.maxNorth - bounds.minNorth;
  const eastSpan = bounds.maxEast - bounds.minEast;
  if (!(northSpan > 0) || !(eastSpan > 0)) return null;

  const { lon0, lat0 } = georeference;
  const metresPerDegLon = metersPerDegreeLon(lat0);
  const latMin = lat0 + bounds.minNorth / METERS_PER_DEG_LAT;
  const latMax = lat0 + bounds.maxNorth / METERS_PER_DEG_LAT;
  const lonMin = lon0 + bounds.minEast / metresPerDegLon;
  const lonMax = lon0 + bounds.maxEast / metresPerDegLon;
  const latSpanDeg = latMax - latMin;
  const lonSpanDeg = lonMax - lonMin;
  if (!(latSpanDeg > 0) || !(lonSpanDeg > 0)) return null;

  // One metre-based target cell drives both steps, so the cells stay roughly
  // square on the ground whatever the image's proportions.
  const cell = Math.max(northSpan, eastSpan) / maxDivisions;
  let latStep = niceStepNear(cell / METERS_PER_DEG_LAT);
  if (!latStep) return null;
  let lonStep = niceStepNear(latStep / Math.cos(lat0 * DEG_TO_RAD));
  if (!lonStep) return null;

  // The nice rounding can make a step finer than the target; coarsen if that
  // pushes an axis past the line-count bound.
  if (latSpanDeg / latStep > maxDivisions) {
    latStep = niceStepAtLeast(latSpanDeg / maxDivisions) ?? latStep;
  }
  if (lonSpanDeg / lonStep > maxDivisions) {
    lonStep = niceStepAtLeast(lonSpanDeg / maxDivisions) ?? lonStep;
  }

  // Sample a little beyond the footprint's AABB so a line reaches the image
  // edges after projection; anything outside the image is clipped at draw time.
  const lonPad = lonSpanDeg * 0.2;
  const latPad = latSpanDeg * 0.2;

  const lines = [];
  const latDecimals = decimalPlacesFor(latStep);
  const lonDecimals = decimalPlacesFor(lonStep);

  const addLine = (kind, value, step, decimals) => {
    const points = [];
    for (let s = 0; s < samples; s++) {
      const t = samples === 1 ? 0 : s / (samples - 1);
      const lon = kind === 'lat'
        ? (lonMin - lonPad) + (lonSpanDeg + 2 * lonPad) * t
        : value;
      const lat = kind === 'lat'
        ? value
        : (latMin - latPad) + (latSpanDeg + 2 * latPad) * t;
      points.push(georeference.geoToUV(lon, lat));
    }
    lines.push({
      kind,
      value,
      level: step,
      label: value.toFixed(decimals),
      start: { u: points[0].u, v: points[0].v },
      curves: catmullRomCurves(points),
    });
  };

  const firstLatIndex = Math.ceil(latMin / latStep - 1e-9);
  const lastLatIndex = Math.floor(latMax / latStep + 1e-9);
  for (let i = firstLatIndex; i <= lastLatIndex; i++) {
    addLine('lat', cleanValue(i * latStep, latStep), latStep, latDecimals);
  }

  const firstLonIndex = Math.ceil(lonMin / lonStep - 1e-9);
  const lastLonIndex = Math.floor(lonMax / lonStep + 1e-9);
  for (let i = firstLonIndex; i <= lastLonIndex; i++) {
    addLine('lon', cleanValue(i * lonStep, lonStep), lonStep, lonDecimals);
  }

  return {
    latStep,
    lonStep,
    latLevels: levelsFor(latStep, latSpanDeg),
    lonLevels: levelsFor(lonStep, lonSpanDeg),
    latSpanDeg,
    lonSpanDeg,
    imageWidth,
    imageHeight,
    lines,
  };
}

/**
 * The subset of lines at one display level for one axis. Because levels are
 * multiples of the base step, this is a pure filter over the cached geometry -
 * no projection, safe to call per frame.
 * @param {Object|null} grid
 * @param {number} step
 * @param {'lat'|'lon'} kind
 * @returns {Array}
 */
export function visibleLines(grid, step, kind) {
  if (!grid || !grid.lines || !step) return [];
  return grid.lines.filter((line) =>
    line.kind === kind &&
    Math.abs(line.value / step - Math.round(line.value / step)) < 1e-6
  );
}

/**
 * Choose the finest level whose on-screen line spacing is at least
 * `MIN_SPACING_PX`, falling back to the coarsest level when even that is too
 * dense. Pure, so the zoom behaviour is unit-testable without a canvas.
 * @param {Object|null} grid
 * @param {{scale: number}} transform
 * @param {number} imageWidth
 * @returns {{latStep: number, lonStep: number}}
 */
export function pickGridStepForScale(grid, transform, imageWidth) {
  if (!grid) return { latStep: 0, lonStep: 0 };
  const scale = transform && Number.isFinite(transform.scale) ? transform.scale : 1;

  const pick = (levels, baseStep, spanDeg, onScreenPx) => {
    if (!levels || levels.length === 0) return baseStep;
    const pixelsPerDegree = spanDeg > 0 ? onScreenPx / spanDeg : 0;
    for (const level of levels) {
      if (level * pixelsPerDegree >= MIN_SPACING_PX) return level;
    }
    return levels[levels.length - 1];
  };

  return {
    latStep: pick(grid.latLevels, grid.latStep, grid.latSpanDeg, grid.imageHeight * scale),
    lonStep: pick(grid.lonLevels, grid.lonStep, grid.lonSpanDeg, (imageWidth || grid.imageWidth) * scale),
  };
}
