/**
 * Coordinate transformation utilities for BYOM
 */
import { 
  fromTriangles,
  applyToPoint,
  inverse
} from 'transformation-matrix';

/**
 * Compute similarity transform (2 points)
 * Transformation: x' = s*cos(θ)*x - s*sin(θ)*y + tx
 *                 y' = s*sin(θ)*x + s*cos(θ)*y + ty
 * @param {Array} referencePoints - [{imageX, imageY, lon, lat}, ...]
 * @returns {Object} Transform parameters {scale, rotation, tx, ty}
 */
export function computeSimilarityTransform(referencePoints) {
  if (referencePoints.length < 2) {
    throw new Error('Need at least 2 reference points');
  }

  const p1 = referencePoints[0];
  const p2 = referencePoints[1];

  // Image space vector
  const dx_img = p2.imageX - p1.imageX;
  const dy_img = p2.imageY - p1.imageY;
  
  // Geographic space vector (lon, lat)
  const dx_geo = p2.lon - p1.lon;
  const dy_geo = p2.lat - p1.lat;

  // Calculate scale
  const dist_img = Math.sqrt(dx_img * dx_img + dy_img * dy_img);
  const dist_geo = Math.sqrt(dx_geo * dx_geo + dy_geo * dy_geo);
  const scale = dist_geo / dist_img;

  // Calculate rotation
  const angle_img = Math.atan2(dy_img, dx_img);
  const angle_geo = Math.atan2(dy_geo, dx_geo);
  const rotation = angle_geo - angle_img;

  // Calculate translation using first point
  const cos_r = Math.cos(rotation);
  const sin_r = Math.sin(rotation);
  const tx = p1.lon - (scale * cos_r * p1.imageX - scale * sin_r * p1.imageY);
  const ty = p1.lat - (scale * sin_r * p1.imageX + scale * cos_r * p1.imageY);

  return { scale, rotation, tx, ty };
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
  
  try {
    // Compute the affine transformation matrix
    const matrix = fromTriangles(imageTriangle, geoTriangle);
    
    // Extract coefficients from the matrix
    // The matrix format is: [a, b, 0, c, d, 0, e, f, 1]
    // But transformation-matrix uses: [a, c, e, b, d, f, 0, 0, 1]
    return {
      a: matrix.a,
      b: matrix.c,
      c: matrix.e,
      d: matrix.b, 
      e: matrix.d,
      f: matrix.f
    };
  } catch (error) {
    throw new Error('Points are collinear, cannot compute affine transform');
  }
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
    const { scale, rotation, tx, ty } = transform;
    const cos_r = Math.cos(rotation);
    const sin_r = Math.sin(rotation);
    const lon = scale * cos_r * imageX - scale * sin_r * imageY + tx;
    const lat = scale * sin_r * imageX + scale * cos_r * imageY + ty;
    return { lon, lat };
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
    const { scale, rotation, tx, ty } = transform;
    const cos_r = Math.cos(rotation);
    const sin_r = Math.sin(rotation);
    
    // Inverse transformation
    const lon_shifted = lon - tx;
    const lat_shifted = lat - ty;
    const imageX = (cos_r * lon_shifted + sin_r * lat_shifted) / scale;
    const imageY = (-sin_r * lon_shifted + cos_r * lat_shifted) / scale;
    return { imageX, imageY };
  } else if (type === 'affine') {
    const { a, b, c, d, e, f } = transform;
    
    // Create transformation matrix and use library's inverse function
    const matrix = { a, b: d, c: b, d: e, e: c, f };
    const inverseMatrix = inverse(matrix);
    
    if (!inverseMatrix) {
      throw new Error('Transform is singular');
    }
    
    // Apply inverse transformation
    const result = applyToPoint(inverseMatrix, { x: lon, y: lat });
    return { imageX: result.x, imageY: result.y };
  }
  throw new Error('Unknown transform type');
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
