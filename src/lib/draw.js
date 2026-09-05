import { geoToImage, geoDistanceToImagePixels } from './transforms.js';

export function applyImageTransform(ctx, transform, imageWidth, imageHeight) {
  ctx.translate(transform.translateX, transform.translateY);
  ctx.rotate(transform.rotation);
  ctx.scale(transform.scale, transform.scale);
  ctx.translate(-imageWidth / 2, -imageHeight / 2);
}

function drawAccuracyRing(ctx, point, geoTransform, geoTransformType) {
  const accuracyRadius = geoDistanceToImagePixels(point.lon, point.lat, point.accuracy, geoTransform, geoTransformType);
  ctx.fillStyle = 'rgba(33, 150, 0.1)';
  ctx.strokeStyle = 'rgba(33, 150, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.imageX, point.imageY, accuracyRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export function drawReferencePoints(ctx, points, transform, imageWidth, imageHeight, options) {
  const { showingPoints = false, editingPointId = null, hoverPointIndex = -1, scale = transform.scale, geoTransform = null, geoTransformType = null } = { ...options };

  points.forEach((point, index) => {
    const isHovered = hoverPointIndex === index;
    const isEditing = editingPointId === point.id;

    if (!showingPoints && !isEditing) return;

    if (point.accuracy && geoTransform) {
      drawAccuracyRing(ctx, point, geoTransform, geoTransformType);
    }

    ctx.fillStyle = isEditing ? 'rgba(255, 152,	0.9)' : isHovered ? 'rgba(33, 150,	0.9)' : 'rgba(33, 150,	0.7)';
    ctx.beginPath();
    ctx.arc(point.imageX, point.imageY, isHovered ||	isEditing ?	 12 :	 8,	0, Math.PI *	 2);
    ctx.fill();
    ctx.strokeStyle =	'white';
    ctx.lineWidth =	isEditing ?	 3 :	 2;
    ctx.stroke();

    // Draw number label (counter-rotated to screen space)
    ctx.save();
    ctx.translate(point.imageX, point.imageY);
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
  ctx.fillStyle =	'rgba(255,	 152,	 0.9)';
  ctx.beginPath();
  ctx.arc(pendingPoint.imageX, pendingPoint.imageY,	 15,	0, Math.PI *	 2);
   ctx.fill();
   ctx.strokeStyle =	'white';
   ctx.lineWidth =	3;
   ctx.stroke();

   ctx.strokeStyle =	'rgba(255,	 152,	 0.5)';
  ctx.lineWidth =	2;
  ctx.beginPath();
  ctx.arc(pendingPoint.imageX, pendingPoint.imageY,	 20,	0, Math.PI *	 2);
  ctx.stroke();
}

export function drawUserMarker(ctx, position, geoTransform, geoTransformType, transform, imageWidth, imageHeight) {
  if (!position || !geoTransform) return;

  try {
    const imgCoords =	geoToImage(position.longitude, position.latitude, geoTransform, geoTransformType);

    ctx.save();
    applyImageTransform(ctx, transform, imageWidth, imageHeight);

    if (position.accuracy) {
      const accuracyInPixels =	geoDistanceToImagePixels(position.longitude, position.latitude, position.accuracy, geoTransform, geoTransformType);

      ctx.strokeStyle =	'rgba(175,	 76,	 0.4)';
      ctx.fillStyle =	'rgba(175,	 76,	 0.15)';
      ctx.lineWidth =	2;
      ctx.beginPath();
      ctx.arc(imgCoords.imageX, imgCoords.imageY, accuracyInPixels,	0, Math.PI *	 2);
       ctx.fill();
       ctx.stroke();
    }

    ctx.fillStyle =	'#AF4C50';
    ctx.beginPath();
    ctx.arc(imgCoords.imageX, imgCoords.imageY,	 20,	0, Math.PI *	 2);
    ctx.fill();
    ctx.strokeStyle =	'white';
    ctx.lineWidth =	3;
    ctx.stroke();

    ctx.fillStyle =	'white';
    ctx.beginPath();
    ctx.arc(imgCoords.imageX, imgCoords.imageY,	 6,	0, Math.PI *	 2);
    ctx.fill();

    ctx.restore();
   } catch (error) {
    console.error('Error drawing user position:', error);
   }
}