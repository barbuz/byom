/**
 * Pure viewport math for MapViewer. All functions are side-effect free
 * so they can be tested without mounting the full viewport.
 */
import { FLAG_HIT } from './flagMark.js';
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
 * Return a transform that pans (without zooming or rotating) so the image
 * point (imageX,imageY) sits at the screen point `center`.
 */
export function centerOnImagePoint(imageX, imageY, transform, imageWidth, imageHeight, center) {
  const offsetX = imageX - imageWidth / 2;
  const offsetY = imageY - imageHeight / 2;
  const cos_r = cos(transform.rotation);
  const sin_r = sin(transform.rotation);

  return {
    ...transform,
    translateX: center.x - (cos_r * offsetX - sin_r * offsetY) * transform.scale,
    translateY: center.y - (sin_r * offsetX + cos_r * offsetY) * transform.scale,
  };
}

/**
 * Return the index of the reference point a tap at (screenX,screenY) targets,
 * or -1 if none.
 *
 * A point's flag is drawn upright in screen space with its foot on the point,
 * so its body is a second hit target: the pole rises above the foot and the
 * pennant flies to the right. Without it a tap on the flag would start a new
 * point instead of editing the one it belongs to. An overlap resolves to the
 * first point in array order.
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
    if (!screen) continue;

    const dx = screenX - screen.x;
    const dy = screenY - screen.y;
    const onFlag = dx >= -FLAG_HIT.left && dx <= FLAG_HIT.right
      && dy >= -FLAG_HIT.up && dy <= FLAG_HIT.down;

    if (onFlag || Math.hypot(dx, dy) <= clickRadius) {
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