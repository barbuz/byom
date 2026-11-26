import { geoToUV, geoDistanceToUV, imageDivisor } from './transforms.js';
import { pickGridStepForScale, visibleLines } from './grid.js';
import { PENNANT_CONTROL, POINT_FLAG } from './flagMark.js';

// The user marker is a screen-space overlay: its radius is in CSS pixels and
// must not grow with the map. The accuracy ring, however, is a ground distance
// and does scale with the map.
const USER_MARKER_RADIUS = 6;
const USER_MARKER_INNER_RADIUS = 2;

// Graticule styling. Widths are in CSS pixels and divided by the map scale so
// the grid keeps a constant screen weight while zooming.
const GRID_LINE_WIDTH = 1;
const GRID_LABEL_FONT = '11px sans-serif';
const GRID_LABEL_COLOR = 'rgba(255, 255, 255, 0.85)';
const GRID_LABEL_HALO = 'rgba(0, 0, 0, 0.7)';

// Reference-point flags: the accent marks a placed point, the warning orange
// one being edited or dropped.
const POINT_COLOR = '#1d4ed8';
const POINT_COLOR_HOVER = '#2563eb';
const POINT_COLOR_PENDING = '#ff9800';

// Scale the current transform about a fixed point, so a marker drawn afterwards
// stays centered while its radius changes in screen space. Expressed as one
// matrix so it does not perturb the transform stack's translate calls.
function scaleAbout(ctx, x, y, factor) {
  ctx.transform(factor, 0, 0, factor, x * (1 - factor), y * (1 - factor));
}

export function applyImageTransform(ctx, transform, imageWidth, imageHeight) {
  ctx.translate(transform.translateX, transform.translateY);
  ctx.rotate(transform.rotation);
  ctx.scale(transform.scale, transform.scale);
  ctx.translate(-imageWidth / 2, -imageHeight / 2);
}

// Stored points carry [0,1] fractions; canvas drawing is inherently
// pixel-space, so each draw entry point converts here at its edge.
function toPixels(u, v, imageWidth, imageHeight) {
  const divisor = imageDivisor(imageWidth, imageHeight);
  return { x: u * divisor, y: v * divisor };
}

function drawAccuracyRing(ctx, point, geoTransform, imageWidth, imageHeight) {
  const accuracyRadius = geoDistanceToUV(point.lon, point.lat, point.accuracy, geoTransform)
    * imageDivisor(imageWidth, imageHeight);
  const { x, y } = toPixels(point.u, point.v, imageWidth, imageHeight);
  ctx.fillStyle = 'rgba(29, 78, 216, 0.1)';
  ctx.strokeStyle = 'rgba(29, 78, 216, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, accuracyRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/**
 * Draw the mark with its foot at the current origin: a flagpole whose bowl is
 * the pennant. Callers have already translated to the point, cancelled the map
 * scale and counter-rotated, so the flag is upright and the same size at any
 * zoom. Returns the flag's top edge, where the number badge attaches.
 */
function drawFlag(ctx, color, scale = 1) {
  const poleHeight = POINT_FLAG.poleHeight * scale;
  const poleWidth = POINT_FLAG.poleWidth * scale;
  const flagWidth = POINT_FLAG.width * scale;
  const flagHeight = POINT_FLAG.height * scale;
  const top = -poleHeight;
  const mid = top + flagHeight;

  const pennant = () => {
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.quadraticCurveTo(
      flagWidth * PENNANT_CONTROL.x,
      top + flagHeight * PENNANT_CONTROL.y,
      flagWidth,
      mid,
    );
    ctx.lineTo(0, mid);
    ctx.closePath();
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Stroke a white halo first; the fills painted over it leave only the rim,
  // which keeps the flag readable over dark map features.
  ctx.strokeStyle = 'white';
  ctx.lineWidth = POINT_FLAG.halo * 2;
  pennant();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, top);
  ctx.lineWidth = poleWidth + POINT_FLAG.halo * 2;
  ctx.stroke();

  ctx.fillStyle = color;
  pennant();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = poleWidth;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, top);
  ctx.stroke();

  // A knob at the foot makes the planted location explicit.
  ctx.beginPath();
  ctx.arc(0, 0, POINT_FLAG.footRadius * scale, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.restore();
  return top;
}

function drawPointNumber(ctx, label, flagTop, color) {
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const width = ctx.measureText(label).width + 10;
  const height = POINT_FLAG.badgeHeight;
  // The badge straddles the pole's top so it reads as a plate on the pole.
  const centerY = flagTop - POINT_FLAG.badgeCentreUp;

  ctx.fillStyle = color;
  ctx.fillRect(-width / 2, centerY - height / 2, width, height);
  ctx.fillStyle = 'white';
  ctx.fillText(label, 0, centerY);
}

/** Translate to the point and undo the map transform, leaving screen pixels. */
function enterMarkerFrame(ctx, x, y, scale, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 / scale, 1 / scale);
  ctx.rotate(-rotation);
}

function markerScale(scale) {
  return Number.isFinite(scale) && scale !== 0 ? scale : 1;
}

export function drawReferencePoints(ctx, points, transform, imageWidth, imageHeight, options = {}) {
  const {
    showingPoints = false,
    editingPointId = null,
    hoverPointIndex = -1,
    scale = transform.scale,
    geoTransform = null,
  } = options;
  const mapScale = markerScale(scale);

  points.forEach((point, index) => {
    const isHovered = hoverPointIndex === index;
    const isEditing = editingPointId === point.id;

    if (!showingPoints && !isEditing) return;

    if (point.accuracy && geoTransform) {
      drawAccuracyRing(ctx, point, geoTransform, imageWidth, imageHeight);
    }

    const { x, y } = toPixels(point.u, point.v, imageWidth, imageHeight);
    const color = isEditing ? POINT_COLOR_PENDING : isHovered ? POINT_COLOR_HOVER : POINT_COLOR;
    const flagScale = isHovered || isEditing ? POINT_FLAG.hoverScale : 1;

    enterMarkerFrame(ctx, x, y, mapScale, transform.rotation);
    const top = drawFlag(ctx, color, flagScale);
    drawPointNumber(ctx, (index + 1).toString(), top, color);
    ctx.restore();
  });
}

export function drawPendingPoint(ctx, pendingPoint, transform, imageWidth, imageHeight) {
  const { x, y } = toPixels(pendingPoint.u, pendingPoint.v, imageWidth, imageHeight);
  const rotation = Number.isFinite(transform?.rotation) ? transform.rotation : 0;

  enterMarkerFrame(ctx, x, y, markerScale(transform?.scale), rotation);
  drawFlag(ctx, POINT_COLOR_PENDING);

  // Ring on the ground the new point will be planted in.
  ctx.strokeStyle = 'rgba(255, 152, 0, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, POINT_FLAG.width * 0.55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw the zoom-appropriate level of a precomputed graticule. The level is
 * selected from `transform.scale` so on-screen spacing stays in a comfortable
 * band; only that subset is stroked, and the line weight is divided by the
 * scale so it stays constant on screen. Assumes the caller has already applied
 * the image transform stack.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object|null} grid - From buildGraticule.
 * @param {Object} transform - View transform {scale, ...}.
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {Object} [options]
 * @param {boolean} [options.labels]
 */
export function drawGraticule(ctx, grid, transform, imageWidth, imageHeight, options = {}) {
  if (!grid || !grid.lines || grid.lines.length === 0) return;
  const { labels = false } = options;
  const scale = Number.isFinite(transform?.scale) && transform.scale !== 0 ? transform.scale : 1;
  const rotation = Number.isFinite(transform?.rotation) ? transform.rotation : 0;
  const divisor = imageDivisor(imageWidth, imageHeight);
  const { latStep, lonStep } = pickGridStepForScale(grid, { scale }, imageWidth);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, imageWidth, imageHeight);
  ctx.clip();

  ctx.lineWidth = GRID_LINE_WIDTH / scale;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';

  const drawLevel = (kind, step) => {
    for (const line of visibleLines(grid, step, kind)) {
      const start = { x: line.start.u * divisor, y: line.start.v * divisor };
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (const segment of line.curves) {
        ctx.bezierCurveTo(
          segment.c1.u * divisor, segment.c1.v * divisor,
          segment.c2.u * divisor, segment.c2.v * divisor,
          segment.to.u * divisor, segment.to.v * divisor,
        );
      }
      ctx.stroke();
    }
  };

  drawLevel('lat', latStep);
  drawLevel('lon', lonStep);

  if (labels) {
    ctx.font = GRID_LABEL_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const drawLabels = (kind, step) => {
      for (const line of visibleLines(grid, step, kind)) {
        const start = { x: line.start.u * divisor, y: line.start.v * divisor };
        // Counter-rotate and cancel the scale so the text stays upright and
        // readable at a constant size, like the reference-point labels.
        ctx.save();
        ctx.translate(start.x, start.y);
        ctx.scale(1 / transform.scale, 1 / transform.scale);
        ctx.rotate(-rotation);
        ctx.lineWidth = 3;
        ctx.strokeStyle = GRID_LABEL_HALO;
        ctx.strokeText(line.label, 4, 0);
        ctx.fillStyle = GRID_LABEL_COLOR;
        ctx.fillText(line.label, 4, 0);
        ctx.restore();
      }
    };
    drawLabels('lat', latStep);
    drawLabels('lon', lonStep);
  }

  ctx.restore();
}

export function drawUserMarker(ctx, position, geoTransform, transform, imageWidth, imageHeight) {
  if (!position || !geoTransform) return;

  try {
    const uv = geoToUV(position.longitude, position.latitude, geoTransform);
    const divisor = imageDivisor(imageWidth, imageHeight);
    const x = uv.u * divisor;
    const y = uv.v * divisor;

    ctx.save();
    // Place the marker in image space, then cancel the map scale about the
    // marker center so the dot itself keeps a constant screen size at any zoom.
    // The accuracy ring is drawn before that cancellation because it represents
    // real ground coverage and must shrink and grow with the map.
    applyImageTransform(ctx, transform, imageWidth, imageHeight);

    if (position.accuracy) {
      const accuracyInPixels = geoDistanceToUV(position.longitude, position.latitude, position.accuracy, geoTransform) * divisor;

      ctx.strokeStyle = 'rgba(175, 76, 80, 0.4)';
      ctx.fillStyle = 'rgba(175, 76, 80, 0.15)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, accuracyInPixels, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    scaleAbout(ctx, x, y, 1 / transform.scale);
    ctx.fillStyle = '#AF4C50';
    ctx.beginPath();
    ctx.arc(x, y, USER_MARKER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(x, y, USER_MARKER_INNER_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  } catch (error) {
    console.error('Error drawing user position:', error);
  }
}
