/**
 * Coordinate transformation utilities for BYOM.
 *
 * Similarity, affine and homography all map image pixels to local east/north
 * metres and share the same homogeneous 3x3 matrix representation, so callers
 * only ever hold one shape: the fitted matrix, its type label, and the metric
 * plane's origin. Ground distance per degree varies with latitude, so a fit is
 * only isotropic in that metric plane; every model is therefore fitted there.
 *
 * Matrix layout is row-major:
 *   [m0 m1 m2]
 *   [m3 m4 m5]
 *   [m6 m7 m8]
 * with m6/m7 zero for the similarity and affine cases.
 */

// Mean metres per degree of latitude, adequate for a local planar fit.
const METERS_PER_DEG_LAT = 111320;
const DEG_TO_RAD = Math.PI / 180;
const PIVOT_EPSILON = 1e-12;
const HALF_TURN = 180;
const FULL_TURN = 360;

/**
 * Metres spanned by one degree of longitude at the given latitude.
 * @param {number} lat
 * @returns {number}
 */
export function metersPerDegreeLon(lat) {
  return METERS_PER_DEG_LAT * Math.cos(lat * DEG_TO_RAD);
}

/**
 * Wrap a longitude (or a longitude difference) into [-180, 180). Longitudes
 * are cyclic, so a naive linearisation of a map crossing the antimeridian
 * spans ~20,000 km for neighbouring points.
 * @param {number} lon
 * @returns {number}
 */
export function wrapLongitude(lon) {
  // Short-circuit in-range values: the modulo below is exact for them but
  // rounds at a magnitude of 180, which would perturb every ordinary fit.
  if (lon >= -HALF_TURN && lon < HALF_TURN) {
    return lon;
  }
  return ((lon + HALF_TURN) % FULL_TURN + FULL_TURN) % FULL_TURN - HALF_TURN;
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
    east: wrapLongitude(lon - lon0) * metersPerDegreeLon(lat0),
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
    lon: wrapLongitude(lon0 + east / metersPerDegreeLon(lat0)),
    lat: lat0 + north / METERS_PER_DEG_LAT,
  };
}

/**
 * Invert a row-major 3x3 matrix via its adjugate.
 * @param {Array<number>} m
 * @returns {Array<number>|null} Inverse, or null when singular.
 */
function invertMatrix(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const c11 = e * i - f * h;
  const c12 = -(d * i - f * g);
  const c13 = d * h - e * g;
  const determinant = a * c11 + b * c12 + c * c13;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < PIVOT_EPSILON) {
    return null;
  }
  const adjugate = [
    c11, -(b * i - c * h), b * f - c * e,
    c12, a * i - c * g, -(a * f - c * d),
    c13, -(a * h - b * g), a * e - b * d,
  ];
  return adjugate.map(value => value / determinant);
}

/**
 * Apply a homogeneous matrix to a point.
 * @param {Array<number>} m
 * @param {number} x
 * @param {number} y
 * @returns {Object|null} {x, y}, or null when the point maps to infinity.
 */
function applyMatrix(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  const mappedX = (m[0] * x + m[1] * y + m[2]) / w;
  const mappedY = (m[3] * x + m[4] * y + m[5]) / w;
  if (!Number.isFinite(mappedX) || !Number.isFinite(mappedY)) {
    return null;
  }
  return { x: mappedX, y: mappedY };
}

/**
 * Solve a square linear system by Gauss-Jordan elimination with partial
 * pivoting, used to fit each model's coefficients.
 * @param {Array<Array<number>>} matrix
 * @param {Array<number>} vector
 * @returns {Array<number>|null} Solution, or null when the system is singular.
 */
function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);

  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let row = col + 1; row < size; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(rows[pivot][col]) < PIVOT_EPSILON) {
      return null;
    }
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let row = 0; row < size; row++) {
      if (row === col) continue;
      const factor = rows[row][col] / rows[col][col];
      for (let k = col; k <= size; k++) {
        rows[row][k] -= factor * rows[col][k];
      }
    }
  }

  return rows.map((row, index) => row[size] / row[index]);
}

/**
 * Hartley isotropic normalization for a set of 2D points: translate their
 * centroid to the origin and scale so their mean distance from it is sqrt(2).
 *
 * A DLT design matrix built from raw pixels and metres is badly conditioned
 * and the condition number grows with map size (measured cond ~2.5e7 at
 * 1,000 px and ~3.6e9 at 12,000 px for a 1,000 km map); normalizing both
 * planes collapses it to a constant ~3.1. The raw solve is still accurate at
 * these scales, so this is robustness rather than a user-visible fix, but it
 * removes the dependence on resolution and keeps precision for the planned
 * least-squares fit, whose normal equations would square the condition number.
 * @param {Array} points - [{x, y}, ...]
 * @returns {Object} {points, matrix, inverseMatrix} - Normalized points and
 *   the 3x3 transforms into and out of the normalized frame.
 */
function normalizePoints(points) {
  let cx = 0;
  let cy = 0;
  for (const point of points) {
    cx += point.x;
    cy += point.y;
  }
  cx /= points.length;
  cy /= points.length;

  let meanDistance = 0;
  for (const point of points) {
    meanDistance += Math.hypot(point.x - cx, point.y - cy);
  }
  meanDistance /= points.length;
  const scale = meanDistance > 0 ? Math.SQRT2 / meanDistance : 1;

  return {
    points: points.map(({ x, y }) => ({ x: (x - cx) * scale, y: (y - cy) * scale })),
    matrix: [scale, 0, -scale * cx, 0, scale, -scale * cy, 0, 0, 1],
    inverseMatrix: [1 / scale, 0, cx, 0, 1 / scale, cy, 0, 0, 1],
  };
}

/**
 * Multiply two row-major 3x3 matrices.
 * @param {Array<number>} a
 * @param {Array<number>} b
 * @returns {Array<number>}
 */
function multiplyMatrices(a, b) {
  const result = new Array(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      result[row * 3 + col] =
        a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }
  return result;
}

/**
 * Mean geographic position of the points a model is fitted from. Sharing one
 * origin keeps every model's coefficients in the same metric plane. There is
 * no fitting here: it is a plain mean, so the name says so.
 *
 * Longitudes are averaged as wrapped offsets from the first point, so a map
 * that crosses the antimeridian yields an origin next to the map rather than
 * on the opposite side of the planet. Callers must pass finite coordinates.
 * @param {Array} points
 * @returns {Object} {lon0, lat0}
 */
export function planeOrigin(points) {
  if (points.length === 0) {
    throw new Error('Cannot compute a plane origin from no points');
  }

  const referenceLon = points[0].lon;
  let lonOffset = 0;
  let lat = 0;
  for (const point of points) {
    lonOffset += wrapLongitude(point.lon - referenceLon);
    lat += point.lat;
  }
  return {
    lon0: wrapLongitude(referenceLon + lonOffset / points.length),
    lat0: lat / points.length,
  };
}

/**
 * Reject reference points whose image or geographic coordinates cannot be
 * projected. A null coordinate would otherwise coerce to a number and yield a
 * finite but wrong transform, and undefined would propagate NaN.
 * @param {Array} points
 */
function assertFinitePoints(points) {
  for (const point of points) {
    if (
      !Number.isFinite(point.imageX) || !Number.isFinite(point.imageY) ||
      !Number.isFinite(point.lon) || !Number.isFinite(point.lat)
    ) {
      throw new Error('Reference points must have finite coordinates');
    }
  }
}

/**
 * Compute similarity transform (2 points): uniform scale, rotation and
 * translation, fitted in the local metric plane about the midpoint.
 * @param {Array} referencePoints - [{imageX, imageY, lon, lat}, ...]
 * @returns {Object} Transform {m, type, lon0, lat0}
 */
export function computeSimilarityTransform(referencePoints) {
  if (referencePoints.length < 2) {
    throw new Error('Need at least 2 reference points');
  }

  const [p1, p2] = referencePoints;
  assertFinitePoints([p1, p2]);
  const { lon0, lat0 } = planeOrigin([p1, p2]);

  const m1 = lonLatToLocalMeters(p1.lon, p1.lat, lon0, lat0);
  const m2 = lonLatToLocalMeters(p2.lon, p2.lat, lon0, lat0);

  const dxImage = p2.imageX - p1.imageX;
  const dyImage = p2.imageY - p1.imageY;
  const dxMetric = m2.east - m1.east;
  const dyMetric = m2.north - m1.north;

  const distanceImage = Math.hypot(dxImage, dyImage);
  const distanceMetric = Math.hypot(dxMetric, dyMetric);
  if (!(distanceImage > 0) || !(distanceMetric > 0)) {
    throw new Error('Reference points must be distinct');
  }

  // Metres per pixel, and the rotation aligning the image to the metric plane.
  const scale = distanceMetric / distanceImage;
  const rotation = Math.atan2(dyMetric, dxMetric) - Math.atan2(dyImage, dxImage);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return {
    m: [
      scale * cos, -scale * sin, m1.east - (scale * cos * p1.imageX - scale * sin * p1.imageY),
      scale * sin, scale * cos, m1.north - (scale * sin * p1.imageX + scale * cos * p1.imageY),
      0, 0, 1,
    ],
    type: 'similarity',
    lon0,
    lat0,
  };
}

/**
 * Compute affine transform (3 points), fitted in the local metric plane.
 * @param {Array} referencePoints - [{imageX, imageY, lon, lat}, ...]
 * @returns {Object} Transform {m, type, lon0, lat0}
 */
export function computeAffineTransform(referencePoints) {
  if (referencePoints.length < 3) {
    throw new Error('Need at least 3 reference points for affine transform');
  }

  const used = referencePoints.slice(0, 3);
  assertFinitePoints(used);
  const { lon0, lat0 } = planeOrigin(used);
  const rows = [];
  const values = [];

  for (const point of used) {
    const { east, north } = lonLatToLocalMeters(point.lon, point.lat, lon0, lat0);
    rows.push([point.imageX, point.imageY, 1, 0, 0, 0]);
    values.push(east);
    rows.push([0, 0, 0, point.imageX, point.imageY, 1]);
    values.push(north);
  }

  // The system is singular exactly when the image points are collinear.
  const solution = solveLinearSystem(rows, values);
  if (!solution) {
    throw new Error('Points are collinear, cannot compute affine transform');
  }

  const [a, b, c, d, e, f] = solution;
  return { m: [a, b, c, d, e, f, 0, 0, 1], type: 'affine', lon0, lat0 };
}

/**
 * Compute a homography (4 points) by direct linear transform, fitted in the
 * local metric plane with the matrix normalized so m8 = 1.
 *
 * Both planes are Hartley-normalized before the solve and the result is
 * denormalized afterwards, which keeps the DLT design matrix well conditioned
 * regardless of map size and resolution.
 * @param {Array} referencePoints - [{imageX, imageY, lon, lat}, ...]
 * @returns {Object} Transform {m, type, lon0, lat0}
 */
export function computeHomographyTransform(referencePoints) {
  if (referencePoints.length < 4) {
    throw new Error('Need at least 4 reference points for homography transform');
  }

  const used = referencePoints.slice(0, 4);
  assertFinitePoints(used);
  const { lon0, lat0 } = planeOrigin(used);

  const imagePoints = used.map(({ imageX, imageY }) => ({ x: imageX, y: imageY }));
  const metricPoints = used.map((point) =>
    lonLatToLocalMeters(point.lon, point.lat, lon0, lat0)
  );
  const image = normalizePoints(imagePoints);
  const metric = normalizePoints(metricPoints.map(({ east, north }) => ({ x: east, y: north })));

  const rows = [];
  const values = [];

  for (let i = 0; i < used.length; i++) {
    const { x: imageX, y: imageY } = image.points[i];
    const { x: east, y: north } = metric.points[i];
    rows.push([imageX, imageY, 1, 0, 0, 0, -imageX * east, -imageY * east]);
    values.push(east);
    rows.push([0, 0, 0, imageX, imageY, 1, -imageX * north, -imageY * north]);
    values.push(north);
  }

  // Singular when the four points are degenerate (e.g. three of them collinear).
  const solution = solveLinearSystem(rows, values);
  if (!solution) {
    throw new Error('Points are degenerate, cannot compute homography transform');
  }

  const normalized = [...solution, 1];
  const m = multiplyMatrices(
    metric.inverseMatrix,
    multiplyMatrices(normalized, image.matrix)
  );

  // The denormalized matrix is only defined up to scale; restore the m8 = 1
  // convention the rest of the code assumes.
  if (!m.every(Number.isFinite) || Math.abs(m[8]) < PIVOT_EPSILON) {
    throw new Error('Points are degenerate, cannot compute homography transform');
  }
  return { m: m.map(value => value / m[8]), type: 'homography', lon0, lat0 };
}

/**
 * Transform image coordinates to geographic coordinates.
 * @param {number} imageX
 * @param {number} imageY
 * @param {Object} transform - Transform object {m, type, lon0, lat0}
 * @returns {Object} {lon, lat}
 */
export function imageToGeo(imageX, imageY, transform) {
  const local = applyMatrix(transform.m, imageX, imageY);
  if (!local) {
    throw new Error('Transform is singular');
  }
  return localMetersToLonLat(local.x, local.y, transform.lon0, transform.lat0);
}

/**
 * Transform geographic coordinates to image coordinates.
 * @param {number} lon
 * @param {number} lat
 * @param {Object} transform - Transform object {m, type, lon0, lat0}
 * @returns {Object} {imageX, imageY}
 */
export function geoToImage(lon, lat, transform) {
  const inverseMatrix = invertMatrix(transform.m);
  if (!inverseMatrix) {
    throw new Error('Transform is singular');
  }
  const local = lonLatToLocalMeters(lon, lat, transform.lon0, transform.lat0);
  const image = applyMatrix(inverseMatrix, local.east, local.north);
  if (!image) {
    throw new Error('Transform is singular');
  }
  return { imageX: image.x, imageY: image.y };
}

/**
 * Convert a ground distance in meters to an image-space distance in pixels.
 * The offset is applied in the local metric plane, where one degree of
 * longitude is weighted by cos(lat) and a ground distance is isotropic, and is
 * split across both axes so no single axis is privileged.
 * @param {number} lon
 * @param {number} lat
 * @param {number} meters
 * @param {Object} transform - Transform object {m, type, lon0, lat0}
 * @returns {number} Distance in image pixels
 */
export function geoDistanceToImagePixels(lon, lat, meters, transform) {
  const { lon0, lat0 } = transform;
  const component = meters / Math.SQRT2;
  const local = lonLatToLocalMeters(lon, lat, lon0, lat0);
  const offset = localMetersToLonLat(
    local.east + component,
    local.north + component,
    lon0,
    lat0
  );

  const start = geoToImage(lon, lat, transform);
  const end = geoToImage(offset.lon, offset.lat, transform);
  return Math.hypot(end.imageX - start.imageX, end.imageY - start.imageY);
}

/**
 * Fit the appropriate model for the number of reference points available:
 * two -> similarity, three -> affine, four -> homography. Extra points are
 * not used yet; a least-squares fit is future work.
 * @param {Array} referencePoints
 * @returns {Object|null} Transform object, or null if fewer than two points.
 */
export function calculateTransform(referencePoints) {
  if (!referencePoints || referencePoints.length < 2) {
    return null;
  }
  if (referencePoints.length === 2) {
    return computeSimilarityTransform(referencePoints);
  }
  if (referencePoints.length === 3) {
    return computeAffineTransform(referencePoints);
  }
  return computeHomographyTransform(referencePoints);
}
