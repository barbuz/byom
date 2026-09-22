import { geoToUV, geoDistanceToUV, imageDivisor } from './transforms.js';

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
  ctx.fillStyle = 'rgba(33, 150, 243, 0.1)';
  ctx.strokeStyle = 'rgba(33, 150, 243, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, accuracyRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export function drawReferencePoints(ctx, points, transform, imageWidth, imageHeight, options) {
  const { showingPoints = false, editingPointId = null, hoverPointIndex = -1, scale = transform.scale, geoTransform = null } = { ...options };

  points.forEach((point, index) => {
    const isHovered = hoverPointIndex === index;
    const isEditing = editingPointId === point.id;

    if (!showingPoints && !isEditing) return;

    if (point.accuracy && geoTransform) {
      drawAccuracyRing(ctx, point, geoTransform, imageWidth, imageHeight);
    }

    const { x, y } = toPixels(point.u, point.v, imageWidth, imageHeight);

    ctx.fillStyle = isEditing ? 'rgba(255, 152, 0, 0.9)' : isHovered ? 'rgba(33, 150, 243, 0.9)' : 'rgba(33, 150, 243, 0.7)';
    ctx.beginPath();
    ctx.arc(x, y, isHovered ||	isEditing ?	 12 :	 8,	0, Math.PI *	 2);
    ctx.fill();
    ctx.strokeStyle =	'white';
    ctx.lineWidth =	isEditing ?	 3 :	 2;
    ctx.stroke();

    // Draw number label (counter-rotated to screen space)
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 / scale,	1 / scale);
    ctx.rotate(-transform.rotation);

    ctx.font =	'bold 14px sans-serif';
    ctx.textAlign =	'center';
    ctx.textBaseline =	'middle';

    const labelY =	-25;
    const labelText =	(index +	1).toString();
    const textWidth = ctx.measureText(labelText).width;

    ctx.fillStyle =	isEditing ? '#FF9800' : '#2196F3';
    ctx.fillRect(-(textWidth /	 2 +	 6), labelY -	 10, textWidth +	 12,	 20);
    ctx.fillStyle =	'white';
    ctx.fillText(labelText, 0, labelY);

    ctx.restore();
  });
}

export function drawPendingPoint(ctx, pendingPoint, transform, imageWidth, imageHeight) {
  const { x, y } = toPixels(pendingPoint.u, pendingPoint.v, imageWidth, imageHeight);
  ctx.fillStyle =	'rgba(255, 152, 0, 0.9)';
  ctx.beginPath();
  ctx.arc(x, y,	 15,	0, Math.PI *	 2);
   ctx.fill();
   ctx.strokeStyle =	'white';
   ctx.lineWidth =	3;
   ctx.stroke();

   ctx.strokeStyle =	'rgba(255, 152, 0, 0.5)';
  ctx.lineWidth =	2;
  ctx.beginPath();
  ctx.arc(x, y,	 20,	0, Math.PI *	 2);
  ctx.stroke();
}

export function drawUserMarker(ctx, position, geoTransform, transform, imageWidth, imageHeight, stale = false) {
  if (!position || !geoTransform) return;

  try {
    const uv = geoToUV(position.longitude, position.latitude, geoTransform);
    const divisor = imageDivisor(imageWidth, imageHeight);
    const x = uv.u * divisor;
    const y = uv.v * divisor;

    ctx.save();
    applyImageTransform(ctx, transform, imageWidth, imageHeight);

    // A stale fix is a frozen coordinate whose reported accuracy has ceased to
    // mean anything; drawing its ballooning ring would imply a precision we do
    // not have. Show a hollow, dashed marker instead.
    if (stale) {
      ctx.strokeStyle = 'rgba(175, 76, 80, 0.8)';
      ctx.fillStyle =	'rgba(175, 76, 80, 0.15)';
      ctx.lineWidth =	3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    if (position.accuracy) {
      const accuracyInPixels =	geoDistanceToUV(position.longitude, position.latitude, position.accuracy, geoTransform) * divisor;

      ctx.strokeStyle =	'rgba(175, 76, 80, 0.4)';
      ctx.fillStyle =	'rgba(175, 76, 80, 0.15)';
      ctx.lineWidth =	2;
      ctx.beginPath();
      ctx.arc(x, y, accuracyInPixels,	0, Math.PI *	 2);
       ctx.fill();
       ctx.stroke();
    }

    ctx.fillStyle =	'#AF4C50';
    ctx.beginPath();
    ctx.arc(x, y,	 20,	0, Math.PI *	 2);
    ctx.fill();
    ctx.strokeStyle =	'white';
    ctx.lineWidth =	3;
    ctx.stroke();

    ctx.fillStyle =	'white';
    ctx.beginPath();
    ctx.arc(x, y,	 6,	0, Math.PI *	 2);
    ctx.fill();

    ctx.restore();
   } catch (error) {
    console.error('Error drawing user position:', error);
   }
}