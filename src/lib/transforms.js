/**
 * Coordinate transformation utilities for BYOM
 */
import { 
  fromTriangles,
  applyToPoint,
  inverse
} from 'transformation-matrix';

// Mean metres per degree of latitude, adequate for a local planar fit.
const METERS_PER_DEG_LAT = 111320;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Metres spanned by one degree of longitude at the given latitude.
 * @param {number} lat
 * @returns {number}
 */
export function metersPerDegreeLon(lat) {
  return METERS_PER_DEG_LAT * Math.cos(lat * DEG_TO_RAD);
}

/**
 * Project (lon, lat) into a local east/north metre plane about an origin.
 * One degree of longitude spans less ground than one degree of latitude, so
 * fitting in raw degree space is anisotropic and cannot be a similarity.
 * @param {number} lon
 * @param {number} lat
 * @param {number} lon0 - Origin longitude
 * @param {number} lat0 - Origin latitude
 * @returns {Object} {east, north} in metres
 */
export function lonLatToLocalMeters(lon, lat, lon0, lat0) {
  return {
    east: (lon - lon0) * metersPerDegreeLon(lat0),
    north: (lat - lat0) * METERS_PER_DEG_LAT,
  };
}

/**
 * Inverse of lonLatToLocalMeters.
 * @param {number} east
 * @param {number} north
 * @param {number} lon0 - Origin longitude
 * @param {number} lat0 - Origin latitude
 * @returns {Object} {lon, lat} in degrees
 */
export function localMetersToLonLat(east, north, lon0, lat0) {
  return {
    lon: lon0 + east / metersPerDegreeLon(lat0),
    lat: lat0 + north / METERS_PER_DEG_LAT,
  };
}

/**
 * Compute similarity transform (2 points)
 * Fitted in a local metric plane about the midpoint of the reference points:
 * east = s*cos(θ)*x - s*sin(θ)*y + tx
 * north = s*sin(θ)*x + s*cos(θ)*y + ty
 * @param {Array} referencePoints - [{imageX, imageY, lon, lat}, ...]
 * @returns {Object} Transform parameters {scale, rotation, tx, ty, lon0, lat0}
 *   where scale is metres per pixel and tx/ty are metres.
 */
export function computeSimilarityTransform(referencePoints) {
  if (referencePoints.length < 2) {
    throw new Error('Need at least 2 reference points');
  }

  const p1 = referencePoints[0];
  const p2 = referencePoints[1];

  // A similarity is isotropic, so it only has a solution in a plane where
  // ground distance is isotropic: local east/north metres, not degrees.
  const lon0 = (p1.lon + p2.lon) / 2;
  const lat0 = (p1.lat + p2.lat) / 2;

  const m1 = lonLatToLocalMeters(p1.lon, p1.lat, lon0, lat0);
  const m2 = lonLatToLocalMeters(p2.lon, p2.lat, lon0, lat0);

  // Image space vector
  const dx_img = p2.imageX - p1.imageX;
  const dy_img = p2.imageY - p1.imageY;

  // Metric space vector
  const dx_metric = m2.east - m1.east;
  const dy_metric = m2.north - m1.north;

  // Calculate scale (metres per pixel)
  const dist_img = Math.sqrt(dx_img * dx_img + dy_img * dy_img);
  const dist_metric = Math.sqrt(dx_metric * dx_metric + dy_metric * dy_metric);
  const scale = dist_metric / dist_img;

  // Calculate rotation
  const angle_img = Math.atan2(dy_img, dx_img);
  const angle_metric = Math.atan2(dy_metric, dx_metric);
  const rotation = angle_metric - angle_img;

  // Calculate translation using first point
  const cos_r = Math.cos(rotation);
  const sin_r = Math.sin(rotation);
  const tx = m1.east - (scale * cos_r * p1.imageX - scale * sin_r * p1.imageY);
  const ty = m1.north - (scale * sin_r * p1.imageX + scale * cos_r * p1.imageY);

  return { scale, rotation, tx, ty, lon0, lat0 };
}

/**
 * Compute affine transform using transformation-matrix library
 * Uses fromTriangles to compute transform from reference points
 * Transformation: lon = a*x + b*y + c
 *                 lat = d*x + e*y + f
 * @param {Array} referencePoints - [{imageX, imageY, lon, lat}, ...]
 * @returns {Object} Transform parameters {a, b, c, d, e, f}
 */
export function computeAffineTransform(referencePoints) {
  if (referencePoints.length < 3) {
    throw new Error('Need at least 3 reference points for affine transform');
  }

  // TODO: this is using just 3 arbitrary points, we want to switch to a mesh instead
  // Use the first 3 non-collinear points to compute the transform
  // fromTriangles expects triangles as arrays of points
  const imageTriangle = referencePoints.slice(0, 3).map(p => [p.imageX, p.imageY]);
  const geoTriangle = referencePoints.slice(0, 3).map(p => [p.lon, p.lat]);
  
  const matrix = fromTriangles(imageTriangle, geoTriangle);

  if ([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].some(value => !Number.isFinite(value))) {
    throw new Error('Points are collinear, cannot compute affine transform');
  }

  // Extract coefficients from the matrix
  // The matrix format is: [a, b,  0, c, d,  0, e, f,  1]
  // But transformation-matrix uses: [a, c, e, b, d, f,  0,  0,  1]
  return {
    a: matrix.a,
    b: matrix.c,
    c: matrix.e,
    d: matrix.b,
    e: matrix.d,
    f: matrix.f
  };
}

/**
 * Transform image coordinates to geographic coordinates
 * @param {number} imageX 
 * @param {number} imageY 
 * @param {Object} transform - Transform parameters
 * @param {string} type - 'similarity' or 'affine'
 * @returns {Object} {lon, lat}
 */
export function imageToGeo(imageX, imageY, transform, type) {
  if (type === 'similarity') {
    const { scale, rotation, tx, ty, lon0, lat0 } = transform;
    const cos_r = Math.cos(rotation);
    const sin_r = Math.sin(rotation);
    const east = scale * cos_r * imageX - scale * sin_r * imageY + tx;
    const north = scale * sin_r * imageX + scale * cos_r * imageY + ty;
    return localMetersToLonLat(east, north, lon0, lat0);
  } else if (type === 'affine') {
    const { a, b, c, d, e, f } = transform;
    const lon = a * imageX + b * imageY + c;
    const lat = d * imageX + e * imageY + f;
    return { lon, lat };
  }
  throw new Error('Unknown transform type');
}

/**
 * Transform geographic coordinates to image coordinates
 * @param {number} lon 
 * @param {number} lat 
 * @param {Object} transform - Transform parameters
 * @param {string} type - 'similarity' or 'affine'
 * @returns {Object} {imageX, imageY}
 */
export function geoToImage(lon, lat, transform, type) {
  if (type === 'similarity') {
    const { scale, rotation, tx, ty, lon0, lat0 } = transform;
    const cos_r = Math.cos(rotation);
    const sin_r = Math.sin(rotation);

    // Inverse transformation in the local metric plane
    const { east, north } = lonLatToLocalMeters(lon, lat, lon0, lat0);
    const east_shifted = east - tx;
    const north_shifted = north - ty;
    const imageX = (cos_r * east_shifted + sin_r * north_shifted) / scale;
    const imageY = (-sin_r * east_shifted + cos_r * north_shifted) / scale;
    return { imageX, imageY };
  } else if (type === 'affine') {
    const { a, b, c, d, e, f } = transform;
    
    // Create transformation matrix and use library's inverse function
    const matrix = { a, b: d, c: b, d: e, e: c, f };
    const inverseMatrix = inverse(matrix);
    
    if (!inverseMatrix || ![inverseMatrix.a, inverseMatrix.b, inverseMatrix.c, inverseMatrix.d, inverseMatrix.e, inverseMatrix.f].every(Number.isFinite)) {
      throw new Error('Transform is singular');
    }
    
    // Apply inverse transformation
    const result = applyToPoint(inverseMatrix, { x: lon, y: lat });
    return { imageX: result.x, imageY: result.y };
  }
  throw new Error('Unknown transform type');
}

/**
 * Local metric origin used to measure a ground offset: the fitted projection
 * origin for a similarity, otherwise the point being measured.
 * @param {Object} transform
 * @param {string} type - 'similarity' or 'affine'
 * @param {number} lon
 * @param {number} lat
 * @returns {Object} {lon0, lat0}
 */
function distanceOrigin(transform, type, lon, lat) {
  if (type === 'similarity') {
    return { lon0: transform.lon0, lat0: transform.lat0 };
  }
  return { lon0: lon, lat0: lat };
}

/**
 * Convert a ground distance in meters to an image-space distance in pixels.
 * The offset is applied in the local metric plane, where one degree of
 * longitude is weighted by cos(lat) and a ground distance is isotropic, and is
 * split across both axes so no single axis is privileged.
 * @param {number} lon
 * @param {number} lat
 * @param {number} meters
 * @param {Object} transform - Transform parameters
 * @param {string} type - 'similarity' or 'affine'
 * @returns {number} Distance in image pixels
 */
export function geoDistanceToImagePixels(lon, lat, meters, transform, type) {
  const component = meters / Math.SQRT2;
  const { lon0, lat0 } = distanceOrigin(transform, type, lon, lat);
  const local = lonLatToLocalMeters(lon, lat, lon0, lat0);
  const offset = localMetersToLonLat(
    local.east + component,
    local.north + component,
    lon0,
    lat0
  );

  const start = geoToImage(lon, lat, transform, type);
  const end = geoToImage(offset.lon, offset.lat, transform, type);
  return Math.hypot(end.imageX - start.imageX, end.imageY - start.imageY);
}

/**
 * Calculate the appropriate transform based on number of reference points
 * @param {Array} referencePoints 
 * @returns {Object} {transform, type} or null if insufficient points
 */
export function calculateTransform(referencePoints) {
  if (!referencePoints || referencePoints.length < 2) {
    return null;
  }

  if (referencePoints.length === 2) {
    return {
      transform: computeSimilarityTransform(referencePoints),
      type: 'similarity'
    };
  } else {
    return {
      transform: computeAffineTransform(referencePoints),
      type: 'affine'
    };
  }
}
