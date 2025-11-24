/**
 * Coordinate transformation utilities for BYOM
 */

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
 * Compute affine transform using least-squares (3+ points)
 * Transformation: lon = a*x + b*y + c
 *                 lat = d*x + e*y + f
 * @param {Array} referencePoints - [{imageX, imageY, lon, lat}, ...]
 * @returns {Object} Transform parameters {a, b, c, d, e, f}
 */
export function computeAffineTransform(referencePoints) {
  if (referencePoints.length < 3) {
    throw new Error('Need at least 3 reference points for affine transform');
  }

  const n = referencePoints.length;
  
  // Build matrices for least-squares solution
  // For lon: [x y 1] * [a b c]' = lon
  let sum_x = 0, sum_y = 0, sum_x2 = 0, sum_y2 = 0, sum_xy = 0;
  let sum_lon = 0, sum_lat = 0, sum_x_lon = 0, sum_y_lon = 0;
  let sum_x_lat = 0, sum_y_lat = 0;

  for (const p of referencePoints) {
    sum_x += p.imageX;
    sum_y += p.imageY;
    sum_x2 += p.imageX * p.imageX;
    sum_y2 += p.imageY * p.imageY;
    sum_xy += p.imageX * p.imageY;
    sum_lon += p.lon;
    sum_lat += p.lat;
    sum_x_lon += p.imageX * p.lon;
    sum_y_lon += p.imageY * p.lon;
    sum_x_lat += p.imageX * p.lat;
    sum_y_lat += p.imageY * p.lat;
  }

  // Solve for lon coefficients (a, b, c)
  const det = n * (sum_x2 * sum_y2 - sum_xy * sum_xy) 
            - sum_x * (sum_x * sum_y2 - sum_y * sum_xy)
            + sum_y * (sum_x * sum_xy - sum_y * sum_x2);

  if (Math.abs(det) < 1e-10) {
    throw new Error('Points are collinear, cannot compute affine transform');
  }

  const a = (n * (sum_x_lon * sum_y2 - sum_y_lon * sum_xy)
           - sum_x * (sum_lon * sum_y2 - sum_y * sum_y_lon)
           + sum_y * (sum_lon * sum_xy - sum_y * sum_x_lon)) / det;

  const b = (n * (sum_x2 * sum_y_lon - sum_xy * sum_x_lon)
           - sum_x * (sum_x * sum_y_lon - sum_y * sum_x_lon)
           + sum_y * (sum_x * sum_lon - sum_x2 * sum_lon)) / det;

  const c = (n * (sum_x2 * sum_y2 - sum_xy * sum_xy)
           - sum_x * (sum_x * sum_y2 - sum_y * sum_xy)
           + sum_y * (sum_x * sum_xy - sum_y * sum_x2)) / det;

  const c_val = (sum_lon - a * sum_x - b * sum_y) / n;

  // Solve for lat coefficients (d, e, f)
  const d = (n * (sum_x_lat * sum_y2 - sum_y_lat * sum_xy)
           - sum_x * (sum_lat * sum_y2 - sum_y * sum_y_lat)
           + sum_y * (sum_lat * sum_xy - sum_y * sum_x_lat)) / det;

  const e = (n * (sum_x2 * sum_y_lat - sum_xy * sum_x_lat)
           - sum_x * (sum_x * sum_y_lat - sum_y * sum_x_lat)
           + sum_y * (sum_x * sum_lat - sum_x2 * sum_lat)) / det;

  const f_val = (sum_lat - d * sum_x - e * sum_y) / n;

  return { a, b, c: c_val, d, e, f: f_val };
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
    
    // Inverse affine transformation
    const det = a * e - b * d;
    if (Math.abs(det) < 1e-10) {
      throw new Error('Transform is singular');
    }

    const lon_shifted = lon - c;
    const lat_shifted = lat - f;
    const imageX = (e * lon_shifted - b * lat_shifted) / det;
    const imageY = (-d * lon_shifted + a * lat_shifted) / det;
    return { imageX, imageY };
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
