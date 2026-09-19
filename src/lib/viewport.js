/**
 * Pure viewport math for MapViewer. All functions are side-effect free
 * so they can be tested without mounting the full viewport.
 */
const cos = (r) => Math.cos(r);
const sin = (r) => Math.sin(r);

/**
 * Convert a screen coordinate to an image coordinate by inverting the
 * transform stack (translate,rotate,scale,translate(-w/2,-h/2).).)
 * returns null if the point falls outside the image bounds.
 */
export function screenToImage(screenX, screenY, transform, imageWidth, imageHeight) {
  if (!imageWidth || !imageHeight) return null;

  const cos_r = cos(-transform.rotation);
  const sin_r = sin(-transform.rotation);

  const x = screenX - transform.translateX;
  const y = screenY - transform.translateY;

  const rotatedX = cos_r * x - sin_r * y;
  const rotatedY = sin_r * x + cos_r * y;

  const imageX = rotatedX / transform.scale + imageWidth / 2;
  const imageY = rotatedY / transform.scale + imageHeight / 2;

  if (imageX >= 0 && imageX <= imageWidth && imageY >= 0 && imageY <= imageHeight) {
    return { x: imageX, y: imageY };
  }
  return null;
}

/**
 * Convert an image coordinate to a screen coordinate by applying the
 * transform stack (translate,rotate,scale,translate(-w/2,-h/2).).)
 */
export function imageToScreen(imageX, imageY, transform, imageWidth, imageHeight) {
  const cos_r = cos(transform.rotation);
  const sin_r = sin(transform.rotation);

  const offsetX = imageX - imageWidth / 2;
  const offsetY = imageY - imageHeight / 2;

  const scaledX = offsetX * transform.scale;
  const scaledY = offsetY * transform.scale;

  const rotatedX = cos_r * scaledX - sin_r * scaledY;
  const rotatedY = sin_r * scaledX + cos_r * scaledY;

  return {
    x: rotatedX + transform.translateX,
    y: rotatedY + transform.translateY,
  };
}

/**
 * Return the index of the reference point whose screen position is within
 * `clickRadius` of (screenX,screenY.), or -1 if none.
 */
export function getPointAtScreen(
  screenX,
  screenY,
  referencePoints,
  transform,
  imageWidth,
  imageHeight,
  clickRadius = 20,
)
{
  for (let i =  0; i < referencePoints.length; i++) {
    const point = referencePoints[i];
    const screen = imageToScreen(point.imageX, point.imageY, transform, imageWidth, imageHeight);
    if (screen && Math.hypot(screenX - screen.x, screenY - screen.y) <= clickRadius) {
      return i;
    }
  }
  return -1;
}

/**
 * Compute the transform for a two-finger gesture that zooms to `newScale`
 * and pans so the image point that started under `startCenter` ends up under
 * `center`. Both screen points are measured against `startTransform`, the
 * transform captured when the gesture began.
 *
 * `startCenter` (the pinch center at gesture start) must stay fixed for the
 * gesture's duration. Deriving the anchored offset from the moving `center`
 * instead would fold the pan delta into the zoom and drive the map the wrong
 * way. Note the anchor's screen offset scales uniformly with the zoom, so the
 * (unused) rotation term cancels and rotation stays untouched.
 */
export function pinchZoomTransform(center, startTransform, newScale, startCenter = center) {
  const scaleChange = newScale / startTransform.scale;
  const offsetX = startCenter.x - startTransform.translateX;
  const offsetY = startCenter.y - startTransform.translateY;

  return {
    scale: newScale,
    translateX: center.x - offsetX * scaleChange,
    translateY: center.y - offsetY * scaleChange,
  };
}