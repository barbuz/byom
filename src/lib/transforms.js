/**
 * Coordinate transformation utilities for BYOM.
 *
 * Similarity, affine and homography all map image coordinates to local
 * east/north metres and share the same homogeneous 3x3 matrix representation,
 * so callers only ever hold one shape: the fitted matrix, its type label, and
 * the metric plane's origin. Ground distance per degree varies with latitude,
 * so a fit is only isotropic in that metric plane; every model is therefore
 * fitted there.
 *
 * Image coordinates are stored and fitted as fractions of a single divisor,
 * `u = imageX / D` and `v = imageY / D` with `D = max(imageWidth, imageHeight)`.
 * A single divisor makes the image-to-fraction change of coordinates a
 * similarity of the plane, so a similarity fitted on (u, v) is still a
 * similarity in metres; per-axis scaling would turn it into an ellipse unless
 * the image is square. It also keeps both coordinates within [0, 1] for any
 * aspect ratio, and separates metres-per-fraction from the image resolution.
 *
 * Fitting and projection both use one canonical image frame, `x = u`,
 * `y = -v`, so `y` grows upward like the metric `north` axis. Stored `v` is
 * still y-down (canvas/screen convention); the flip happens here, once, at the
 * transform boundary. This matters for orientation: the map image is an
 * orientation-reversing view of the ground (its y axis points the other way),
 * so fitting in the raw `(u, v)` frame would either mirror a similarity or push
 * the reflection into the affine/homography coefficients, leaving no uniform
 * way to tell a correct fit from a reflected one. In the canonical frame a
 * correctly georeferenced map always has a positive determinant, and a negative
 * one unambiguously means the correspondences are mirrored, which
 * `transformIsMirrored` reports (see the docs on it).
 *
 * Matrix layout is row-major, mapping canonical image coordinates `(x, y)` to
 * local east/north metres:
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

// Moving-least-squares (MLS) warp constants. The grid and step are fixed, not
// tuned, so the fold test stays a sign check rather than a threshold (D8).
const MLS_NEWTON_ITERATIONS = 20;
const MLS_NEWTON_TOLERANCE = 1e-9;
const FOLD_GRID_SIZE = 48;
const FOLD_GRID_PADDING = 0.1;
const FOLD_STEP = 1e-3;

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
 * Map a stored fractional image coordinate to the canonical fitting frame:
 * `x = u`, `y = -v`. Stored `v` grows downward (canvas convention), so
 * negating it makes `y` grow upward, the same way as metric north. Doing this
 * once at the transform boundary lets every model fit an orientation-preserving
 * map and makes a mirrored correspondence detectable as a sign flip (see
 * `transformIsMirrored`).
 * @param {number} u - Fractional image x
 * @param {number} v - Fractional image y (y-down)
 * @returns {Object} {x, y} in the canonical y-up frame
 */
export function imageFramePoint(u, v) {
  return { x: u, y: -v };
}

/**
 * Inverse of imageFramePoint: recover the stored y-down fractions from a point
 * in the canonical frame.
 * @param {number} x
 * @param {number} y
 * @returns {Object} {u, v} with v y-down
 */
function imageFrameToUV(x, y) {
  return { u: x, v: -y };
}

/**
 * Determinant of a row-major 3x3 matrix, used to check orientation. For an
 * affine or projective map of the plane it is the signed factor by which the
 * transform scales oriented area.
 * @param {Array<number>} m
 * @returns {number}
 */
function matrixDeterminant(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/**
 * Whether a fitted transform mirrors the map. Fits are made in the canonical
 * y-up image frame (`x = u`, `y = -v`), where a correctly georeferenced map
 * preserves orientation, so its linear block has a positive determinant. A
 * negative determinant means the image-to-ground correspondence reverses
 * orientation — a reflection — which almost always means at least one reference
 * point has the wrong ground position (e.g. two points swapped, or a coordinate
 * typed into the wrong field). Maps are not generally mirrored, so this is worth
 * surfacing as a likely error rather than rendering silently.
 *
 * The projective denominator must keep a single sign over the map for
 * orientation to be defined; a homography that folds the plane is degenerate,
 * and `calculateTransform` does not produce one from well-separated points.
 * @param {Object|null} transform - Transform object {m, type, lon0, lat0}
 * @returns {boolean}
 */
export function transformIsMirrored(transform) {
  if (!transform || !transform.m) return false;
  const determinant = matrixDeterminant(transform.m);
  return Number.isFinite(determinant) && determinant < 0;
}

/**
 * Invert a row-major 3x3 matrix via its adjugate.
 * @param {Array<number>} m
 * @returns {Array<number>|null} Inverse, or null when singular.
 */
export function invertMatrix(m) {
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
 * @param {Array} points - [{u, v, lon, lat}, ...]
 */
function assertFinitePoints(points) {
  for (const point of points) {
    if (
      !Number.isFinite(point.u) || !Number.isFinite(point.v) ||
      !Number.isFinite(point.lon) || !Number.isFinite(point.lat)
    ) {
      throw new Error('Reference points must have finite coordinates');
    }
  }
}

/**
 * Compute similarity transform (2 points): uniform scale, rotation and
 * translation, fitted in the local metric plane about the midpoint.
 *
 * Fitted in the canonical y-up image frame (`x = u`, `y = -v`), so the map is
 * represented by an ordinary orientation-preserving similarity: a north-up map
 * has a positive determinant, and a reflected (mirrored) correspondence has a
 * negative one. Fitting in the raw y-down `(u, v)` frame instead would mirror
 * every point off the reference line, which is what
 * `transformIsMirrored` and the module doc warn about.
 * @param {Array} referencePoints - [{u, v, lon, lat}, ...]
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

  const q1 = imageFramePoint(p1.u, p1.v);
  const q2 = imageFramePoint(p2.u, p2.v);
  const dxImage = q2.x - q1.x;
  const dyImage = q2.y - q1.y;
  const dxMetric = m2.east - m1.east;
  const dyMetric = m2.north - m1.north;

  const distanceImage = Math.hypot(dxImage, dyImage);
  const distanceMetric = Math.hypot(dxMetric, dyMetric);
  if (!(distanceImage > 0) || !(distanceMetric > 0)) {
    throw new Error('Reference points must be distinct');
  }

  // Metres per fraction unit, and the rotation aligning the canonical image
  // frame (both axes up = north) with the metric plane.
  const scale = distanceMetric / distanceImage;
  const rotation = Math.atan2(dyMetric, dxMetric) - Math.atan2(dyImage, dxImage);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const a = scale * cos;
  const b = scale * sin;

  // east = a*x - b*y + tx, north = b*x + a*y + ty: an orientation-preserving
  // similarity in the canonical frame, so det = a^2 + b^2 > 0.
  return {
    m: [
      a, -b, m1.east - (a * q1.x - b * q1.y),
      b, a, m1.north - (b * q1.x + a * q1.y),
      0, 0, 1,
    ],
    type: 'similarity',
    lon0,
    lat0,
  };
}

/**
 * Compute affine transform (3 points), fitted in the local metric plane using
 * the canonical y-up image frame (`x = u`, `y = -v`), so a correct map has a
 * positive determinant and a mirrored correspondence a negative one.
 * @param {Array} referencePoints - [{u, v, lon, lat}, ...]
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
    const { x, y } = imageFramePoint(point.u, point.v);
    rows.push([x, y, 1, 0, 0, 0]);
    values.push(east);
    rows.push([0, 0, 0, x, y, 1]);
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
 * local metric plane with the matrix normalized so m8 = 1. Uses the canonical
 * y-up image frame (`x = u`, `y = -v`), so a correct map has a positive
 * determinant and a mirrored correspondence a negative one.
 *
 * Both planes are Hartley-normalized before the solve and the result is
 * denormalized afterwards, which keeps the DLT design matrix well conditioned
 * regardless of map size and resolution.
 * @param {Array} referencePoints - [{u, v, lon, lat}, ...]
 * @returns {Object} Transform {m, type, lon0, lat0}
 */
export function computeHomographyTransform(referencePoints) {
  if (referencePoints.length < 4) {
    throw new Error('Need at least 4 reference points for homography transform');
  }

  const used = referencePoints.slice(0, 4);
  assertFinitePoints(used);
  const { lon0, lat0 } = planeOrigin(used);

  const imagePoints = used.map(({ u, v }) => imageFramePoint(u, v));
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
 * Whether an object is a Georeference (see `createGeoreference`) rather than a
 * bare matrix transform. A local warp has no single matrix, so the two shapes
 * are told apart by the warp methods the georeference exposes.
 * @param {Object|null} transform
 * @returns {boolean}
 */
function isGeoreference(transform) {
  return Boolean(transform && typeof transform.geoToUV === 'function');
}

/**
 * Transform fractional image coordinates to geographic coordinates for a
 * matrix model. The stored y-down fractions are flipped into the canonical
 * frame before applying `m`.
 * @param {number} u - Fractional image x in [0, 1]
 * @param {number} v - Fractional image y in [0, 1] (y-down)
 * @param {Object} transform - Transform object {m, type, lon0, lat0}
 * @returns {Object} {lon, lat}
 */
function matrixUVToGeo(u, v, transform) {
  const { x, y } = imageFramePoint(u, v);
  const local = applyMatrix(transform.m, x, y);
  if (!local) {
    throw new Error('Transform is singular');
  }
  return localMetersToLonLat(local.x, local.y, transform.lon0, transform.lat0);
}

/**
 * Transform geographic coordinates to fractional image coordinates for a
 * matrix model. The result is converted from the canonical frame back to the
 * stored y-down fractions.
 * @param {number} lon
 * @param {number} lat
 * @param {Object} transform - Transform object {m, type, lon0, lat0}
 * @returns {Object} {u, v}
 */
function matrixGeoToUV(lon, lat, transform) {
  const inverseMatrix = invertMatrix(transform.m);
  if (!inverseMatrix) {
    throw new Error('Transform is singular');
  }
  const local = lonLatToLocalMeters(lon, lat, transform.lon0, transform.lat0);
  const image = applyMatrix(inverseMatrix, local.east, local.north);
  if (!image) {
    throw new Error('Transform is singular');
  }
  return imageFrameToUV(image.x, image.y);
}

/**
 * Transform fractional image coordinates to geographic coordinates. Accepts a
 * bare matrix transform or a Georeference; the latter routes through its own
 * `uvToGeo` so a local warp is evaluated by its closure rather than a matrix.
 * @param {number} u - Fractional image x in [0, 1]
 * @param {number} v - Fractional image y in [0, 1] (y-down)
 * @param {Object} transform - Transform {m, type, lon0, lat0} or Georeference
 * @returns {Object} {lon, lat}
 */
export function uvToGeo(u, v, transform) {
  if (isGeoreference(transform)) {
    return transform.uvToGeo(u, v);
  }
  return matrixUVToGeo(u, v, transform);
}

/**
 * Transform geographic coordinates to fractional image coordinates. Accepts a
 * bare matrix transform or a Georeference; the latter routes through its own
 * `geoToUV` so a local warp is evaluated by its closure rather than a matrix.
 * @param {number} lon
 * @param {number} lat
 * @param {Object} transform - Transform {m, type, lon0, lat0} or Georeference
 * @returns {Object} {u, v}
 */
export function geoToUV(lon, lat, transform) {
  if (isGeoreference(transform)) {
    return transform.geoToUV(lon, lat);
  }
  return matrixGeoToUV(lon, lat, transform);
}

/**
 * The divisor that maps image pixels to the [0, 1] fractional frame:
 * `u = imageX / D`, `v = imageY / D`. One divisor for both axes makes the
 * change of coordinates a similarity of the plane, so a similarity fitted on
 * (u, v) is still a similarity in metres; per-axis scaling would turn it into
 * a rotated ellipse unless the image is square. Using max instead of width
 * keeps both coordinates within [0, 1] for any aspect ratio.
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {number}
 */
export function imageDivisor(imageWidth, imageHeight) {
  return Math.max(imageWidth, imageHeight);
}

/**
 * Convert a ground distance in meters to a distance in fractional image
 * units (multiply by the divisor to get pixels). The offset is applied in the
 * local metric plane, where one degree of longitude is weighted by cos(lat)
 * and a ground distance is isotropic, and is split across both axes so no
 * single axis is privileged.
 * @param {number} lon
 * @param {number} lat
 * @param {number} meters
 * @param {Object} transform - Transform object {m, type, lon0, lat0}
 * @returns {number} Distance in fractional image units
 */
export function geoDistanceToUV(lon, lat, meters, transform) {
  const { lon0, lat0 } = transform;
  const component = meters / Math.SQRT2;
  const local = lonLatToLocalMeters(lon, lat, lon0, lat0);
  const offset = localMetersToLonLat(
    local.east + component,
    local.north + component,
    lon0,
    lat0
  );

  const start = geoToUV(lon, lat, transform);
  const end = geoToUV(offset.lon, offset.lat, transform);
  return Math.hypot(end.u - start.u, end.v - start.v);
}

/**
 * Fit the appropriate model for the number of reference points available:
 * two -> similarity, three -> affine, four -> homography. Extra points are
 * ignored by the matrix models; callers that want a local warp for 5+ points
 * use `createGeoreference`, which escalates to affine MLS. Kept exported and
 * matrix-only for the landing page and tests.
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

/**
 * Solve a 2x2 linear system `[[a, b], [c, d]] x = [e, f]` by Cramer's rule.
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @param {number} d
 * @param {number} e
 * @param {number} f
 * @returns {Object|null} {x, y}, or null when the matrix is singular.
 */
function solve2x2(a, b, c, d, e, f) {
  const determinant = a * d - b * c;
  // A NaN determinant also fails this test, so no separate isFinite guard.
  if (!(Math.abs(determinant) >= PIVOT_EPSILON)) {
    return null;
  }
  return {
    x: (e * d - b * f) / determinant,
    y: (a * f - e * c) / determinant,
  };
}

/**
 * Complex-number representation of a 2D similarity, fitted by least squares.
 *
 * Writing the similarity as `q = s·p + t` with `s = a + bi` turns it into a
 * linear least-squares problem in `(a, b, tx, ty)` with a closed-form solution
 * (the 2D Procrustes/Umeyama fit, here in complex form to avoid an SVD of a
 * 2x2 matrix). With `p̄`/`q̄` the centroids:
 *
 *   num = Σ (p_i − p̄) conj(q_i − q̄)          // complex
 *   den = Σ |p_i − p̄|²                        // real
 *   s   = num / den
 *   t   = q̄ − s·p̄
 *
 * It is used as the MLS map's `extentTransform` (D6): projecting the image
 * corners through a global similarity gives a plausible footprint where the
 * local warp would extrapolate badly. At least two points are required, which
 * is always true on the MLS path (5+).
 * @param {Array} points - [{u, v, lon, lat}, ...]
 * @param {number} lon0 - Origin longitude of the metric plane
 * @param {number} lat0 - Origin latitude of the metric plane
 * @returns {Object} Transform {m, type: 'similarity', lon0, lat0}
 */
export function computeLeastSquaresSimilarityTransform(points, lon0, lat0) {
  if (points.length < 2) {
    throw new Error('Need at least 2 reference points');
  }
  assertFinitePoints(points);

  // Ground points (metric plane) and canonical image points (x = u, y = -v),
  // represented as complex numbers p = east + i·north and q = x + i·y.
  const p = points.map((point) => {
    const { east, north } = lonLatToLocalMeters(point.lon, point.lat, lon0, lat0);
    return { re: east, im: north };
  });
  const q = points.map(({ u, v }) => {
    const { x, y } = imageFramePoint(u, v);
    return { re: x, im: y };
  });

  let pBarRe = 0;
  let pBarIm = 0;
  let qBarRe = 0;
  let qBarIm = 0;
  for (let i = 0; i < points.length; i++) {
    pBarRe += p[i].re;
    pBarIm += p[i].im;
    qBarRe += q[i].re;
    qBarIm += q[i].im;
  }
  pBarRe /= points.length;
  pBarIm /= points.length;
  qBarRe /= points.length;
  qBarIm /= points.length;

  // num = Σ (p_i − p̄) conj(q_i − q̄); den = Σ |p_i − p̄|².
  let numRe = 0;
  let numIm = 0;
  let den = 0;
  for (let i = 0; i < points.length; i++) {
    const dpRe = p[i].re - pBarRe;
    const dpIm = p[i].im - pBarIm;
    const dqRe = q[i].re - qBarRe;
    const dqIm = q[i].im - qBarIm;
    // (dpRe + i·dpIm)(dqRe − i·dqIm)
    numRe += dpRe * dqRe + dpIm * dqIm;
    numIm += dpIm * dqRe - dpRe * dqIm;
    den += dpRe * dpRe + dpIm * dpIm;
  }

  if (!(den > 0)) {
    throw new Error('Reference points must be distinct');
  }

  // s = num / den = a + bi.
  const a = numRe / den;
  const b = numIm / den;
  // t = q̄ − s·p̄.
  const tx = qBarRe - (a * pBarRe - b * pBarIm);
  const ty = qBarIm - (b * pBarRe + a * pBarIm);

  // q = s·p + t maps (east, north) -> (x, y). Invert: p = s⁻¹(q − t), with
  // s⁻¹ = conj(s)/|s|², giving the canonical-frame -> metric matrix
  //   east  = (a·qx + b·qy)/S
  //   north = (−b·qx + a·qy)/S,   qx = x − tx, qy = y − ty, S = a² + b².
  const scaleSquared = a * a + b * b;
  if (!(scaleSquared > 0)) {
    throw new Error('Reference points must be distinct');
  }
  const eastFromX = a / scaleSquared;
  const eastFromY = b / scaleSquared;
  const northFromX = -b / scaleSquared;
  const northFromY = a / scaleSquared;
  return {
    m: [
      eastFromX, eastFromY, -(eastFromX * tx + eastFromY * ty),
      northFromX, northFromY, -(northFromX * tx + northFromY * ty),
      0, 0, 1,
    ],
    type: 'similarity',
    lon0,
    lat0,
  };
}

/**
 * Affine moving-least-squares warp (Schaefer, McPhail & Warren, 2006).
 *
 * Control points `p_i` (ground, local metres) map to `q_i` (image, canonical
 * frame `x = u`, `y = -v`). For a query ground point `v`:
 *
 *   w_i = 1 / (sigma_i + d_i)²                 // sigma_i = accuracy in metres
 *   p* = Σ w_i p_i / Σ w_i,  q* = Σ w_i q_i / Σ w_i
 *   M  = (Σ w_i (q_i − q*)(p_i − p*)ᵀ)·(Σ w_i (p_i − p*)(p_i − p*)ᵀ)⁻¹
 *   f(v) = M (v − p*) + q*
 *
 * The warp is smooth, locally supported and interpolating, so a metro or ski
 * map's piecewise/non-projective warp is represented without a global model
 * (D1–D5). The second factor is a 2x2 inverse, singular exactly when the local
 * control points are collinear; `sigma_i = 0` (null accuracy) reproduces plain
 * 1/d² interpolating MLS and makes the warp exact at the control points.
 *
 * @param {Array} referencePoints - [{u, v, lon, lat, accuracy}, ...]
 * @param {Object} [options]
 * @param {number} [options.lon0] - Metric plane origin longitude.
 * @param {number} [options.lat0] - Metric plane origin latitude.
 * @returns {Object} { geoToUV, uvToGeo, lon0, lat0, points }
 */
export function computeMLSWarp(referencePoints, { lon0, lat0 } = {}) {
  if (referencePoints.length < 5) {
    throw new Error('Need at least 5 reference points for an MLS warp');
  }
  assertFinitePoints(referencePoints);

  const origin = lon0 === undefined || lat0 === undefined
    ? planeOrigin(referencePoints)
    : { lon0, lat0 };

  // Control points in the metric plane (p) and the canonical image frame (q).
  const ground = referencePoints.map((point) => {
    const { east, north } = lonLatToLocalMeters(point.lon, point.lat, origin.lon0, origin.lat0);
    return { x: east, y: north };
  });
  const image = referencePoints.map(({ u, v }) => imageFramePoint(u, v));
  const sigma = referencePoints.map((point) =>
    Number.isFinite(point.accuracy) ? Math.abs(point.accuracy) : 0
  );

  // The global similarity (D6): its inverse seeds the iterative `uvToGeo`, and
  // its forward map is the fallback where a local fit is singular. It is stable
  // everywhere the local warp is not.
  const extent = computeLeastSquaresSimilarityTransform(
    referencePoints, origin.lon0, origin.lat0
  );

  /** Weight of control point i at ground query (x, y): 1 / (sigma + d)². */
  function weightAt(i, x, y) {
    const d = Math.hypot(ground[i].x - x, ground[i].y - y);
    const denom = sigma[i] + d;
    return 1 / (denom * denom);
  }

  /** The affine MLS transform f at ground (x, y): {x, y} in the image frame. */
  function forward(x, y) {
    // An exact hit on a hand-placed control point (sigma = 0) interpolates
    // directly; the weighted fit is singular there because every weight but
    // this one is finite. A point with sigma > 0 has a finite weight at d = 0,
    // so it is deliberately softened rather than pinned (D4).
    for (let i = 0; i < ground.length; i++) {
      if (sigma[i] === 0 && ground[i].x === x && ground[i].y === y) {
        return { x: image[i].x, y: image[i].y };
      }
    }

    let sumW = 0;
    let pStarX = 0;
    let pStarY = 0;
    let qStarX = 0;
    let qStarY = 0;
    const w = new Array(ground.length);
    for (let i = 0; i < ground.length; i++) {
      const wi = weightAt(i, x, y);
      w[i] = wi;
      sumW += wi;
      pStarX += wi * ground[i].x;
      pStarY += wi * ground[i].y;
      qStarX += wi * image[i].x;
      qStarY += wi * image[i].y;
    }
    pStarX /= sumW;
    pStarY /= sumW;
    qStarX /= sumW;
    qStarY /= sumW;

    // Accumulate A = Σ w (q−q*)(p−p*)ᵀ (2x2) and B = Σ w (p−p*)(p−p*)ᵀ (2x2).
    let a00 = 0, a01 = 0, a10 = 0, a11 = 0;
    let b00 = 0, b01 = 0, b10 = 0, b11 = 0;
    for (let i = 0; i < ground.length; i++) {
      const dpX = ground[i].x - pStarX;
      const dpY = ground[i].y - pStarY;
      const dqX = image[i].x - qStarX;
      const dqY = image[i].y - qStarY;
      a00 += w[i] * dqX * dpX;
      a01 += w[i] * dqX * dpY;
      a10 += w[i] * dqY * dpX;
      a11 += w[i] * dqY * dpY;
      b00 += w[i] * dpX * dpX;
      b01 += w[i] * dpX * dpY;
      b10 += w[i] * dpY * dpX;
      b11 += w[i] * dpY * dpY;
    }

    // M = A · B⁻¹. Solving M·B = A by Cramer's rule per column avoids forming
    // B⁻¹ explicitly; B is singular when the local control points are collinear.
    const bx = solve2x2(b00, b01, b10, b11, a00, a10);
    const by = solve2x2(b00, b01, b10, b11, a01, a11);
    if (!bx || !by) {
      return null;
    }
    const dx = x - pStarX;
    const dy = y - pStarY;
    return {
      x: bx.x * dx + bx.y * dy + qStarX,
      y: by.x * dx + by.y * dy + qStarY,
    };
  }

  /**
   * Direct evaluation ground -> image, then back to stored y-down fractions.
   * Where the local fit is singular (collinear control points) it falls back to
   * the global similarity (D6), matching `uvToGeo`, so a singular configuration
   * is handled without throwing (Phase 2 exit).
   */
  function warpGeoToUV(lon, lat) {
    const local = lonLatToLocalMeters(lon, lat, origin.lon0, origin.lat0);
    const mapped = forward(local.east, local.north);
    if (mapped) {
      return imageFrameToUV(mapped.x, mapped.y);
    }
    return matrixGeoToUV(lon, lat, extent);
  }

  /**
   * Inverse image -> ground by Newton iteration: v ← v + M(v)⁻¹ (target − f(v)).
   * `M(v)` is the affine Jacobian at v, obtained from `forward` by finite
   * differences. Falls back to the global fit's inverse on non-convergence, so
   * a query outside the warp's support still returns a sane position.
   */
  function warpUVToGeo(u, v) {
    const target = imageFramePoint(u, v);
    const seed = matrixUVToGeo(u, v, extent);
    let local = lonLatToLocalMeters(seed.lon, seed.lat, origin.lon0, origin.lat0);
    let converged = false;
    // A small finite-difference step (metres) for the local Jacobian.
    const step = 1;

    for (let iteration = 0; iteration < MLS_NEWTON_ITERATIONS; iteration++) {
      const at = forward(local.east, local.north);
      const atX = forward(local.east + step, local.north);
      const atY = forward(local.east, local.north + step);
      // A singular local configuration (collinear control points) makes the
      // Jacobian undefined; fall back rather than diverge.
      if (!at || !atX || !atY) break;
      const residualX = target.x - at.x;
      const residualY = target.y - at.y;
      if (Math.hypot(residualX, residualY) < MLS_NEWTON_TOLERANCE) {
        converged = true;
        break;
      }
      const j00 = (atX.x - at.x) / step;
      const j10 = (atX.y - at.y) / step;
      const j01 = (atY.x - at.x) / step;
      const j11 = (atY.y - at.y) / step;
      const delta = solve2x2(j00, j01, j10, j11, residualX, residualY);
      if (!delta) break;
      local = { east: local.east + delta.x, north: local.north + delta.y };
    }
    return converged
      ? localMetersToLonLat(local.east, local.north, origin.lon0, origin.lat0)
      : seed;
  }

  return {
    geoToUV: warpGeoToUV,
    uvToGeo: warpUVToGeo,
    lon0: origin.lon0,
    lat0: origin.lat0,
    points: referencePoints,
  };
}

/**
 * Fold state of a warp over a fixed grid: the finite-difference Jacobian
 * determinant of the ground -> image map. A correctly georeferenced map has a
 * positive determinant everywhere; a misplaced control point folds the warp so
 * some sample has `det <= 0`. This is a sign test (D8), generalising the
 * single-matrix `transformIsMirrored` check to a local warp.
 *
 * 3 warp evaluations per sample over a 48x48 grid is O(N) each and computed
 * once per fit, cached on the georeference, never on the per-frame path.
 * @param {(lon: number, lat: number) => {u: number, v: number}} geoToUV
 * @param {Array} points - Control points [{lon, lat}, ...]
 * @param {number} lon0
 * @param {number} lat0
 * @param {number} [grid]
 * @returns {{folded: boolean, minDet: number}}
 */
export function computeFoldState(geoToUV, points, lon0, lat0, grid = FOLD_GRID_SIZE) {
  // Ground AABB of the control points, padded ~10%.
  const locals = points.map((point) =>
    lonLatToLocalMeters(point.lon, point.lat, lon0, lat0)
  );
  const minEast = Math.min(...locals.map((p) => p.east));
  const maxEast = Math.max(...locals.map((p) => p.east));
  const minNorth = Math.min(...locals.map((p) => p.north));
  const maxNorth = Math.max(...locals.map((p) => p.north));
  const padEast = (maxEast - minEast) * FOLD_GRID_PADDING || 1;
  const padNorth = (maxNorth - minNorth) * FOLD_GRID_PADDING || 1;
  const e0 = minEast - padEast;
  const e1 = maxEast + padEast;
  const n0 = minNorth - padNorth;
  const n1 = maxNorth + padNorth;
  const h = Math.max(e1 - e0, n1 - n0) * FOLD_STEP || FOLD_STEP;

  /** Evaluate the warp at a ground point given in the metric plane. */
  const warpAt = (east, north) => {
    const { lon, lat } = localMetersToLonLat(east, north, lon0, lat0);
    return geoToUV(lon, lat);
  };

  let minDet = Infinity;
  let folded = false;
  for (let iy = 0; iy < grid; iy++) {
    const north = n0 + ((n1 - n0) * iy) / (grid - 1);
    for (let ix = 0; ix < grid; ix++) {
      const east = e0 + ((e1 - e0) * ix) / (grid - 1);
      const base = warpAt(east, north);
      const eastPlus = warpAt(east + h, north);
      const northPlus = warpAt(east, north + h);
      // The warp is stored y-down; the canonical frame negates y, which flips
      // the determinant's sign. Work in the canonical frame so a correct map is
      // positive, matching transformIsMirrored.
      const j00 = (eastPlus.u - base.u) / h;
      const j10 = -((eastPlus.v - base.v) / h);
      const j01 = (northPlus.u - base.u) / h;
      const j11 = -((northPlus.v - base.v) / h);
      const det = j00 * j11 - j01 * j10;
      // A NaN sample fails `det > 0`, so it is conservatively treated as folded.
      if (det < minDet) {
        minDet = det;
      }
      if (!(det > 0)) {
        folded = true;
      }
    }
  }
  return { folded, minDet };
}

/**
 * Wrap a matrix transform as a Georeference: the warp methods delegate to the
 * matrix implementation and `extentTransform` is the model itself (D6). Kept
 * internal to `createGeoreference`, which is the public entry point.
 * @param {Object} transform - {m, type, lon0, lat0}
 * @returns {Object} Georeference
 */
function createMatrixGeoreference(transform) {
  return {
    type: transform.type,
    lon0: transform.lon0,
    lat0: transform.lat0,
    geoToUV: (lon, lat) => matrixGeoToUV(lon, lat, transform),
    uvToGeo: (u, v) => matrixUVToGeo(u, v, transform),
    extentTransform: transform,
    // A matrix warp has a constant determinant, so the fold test degenerates
    // to the existing mirrored check.
    isFolded: () => transformIsMirrored(transform),
  };
}

/**
 * Build the Georeference for a set of reference points: the single interface
 * every consumer holds, so a local warp (no single matrix) and the matrix
 * models share one shape. The model ladder is deterministic (D1):
 *
 *   2 -> similarity, 3 -> affine, 4 -> homography, 5+ -> affine MLS
 *
 * `extentTransform` is the model itself for 2–4 points (preserving today's
 * footprint), and a least-squares similarity fit for MLS maps (D6), so image
 * corners project to a plausible footprint rather than through the local warp.
 * @param {Array} referencePoints
 * @param {number} imageWidth - Image width in pixels; the fit is resolution-independent.
 * @param {number} imageHeight - Image height in pixels; the fit is resolution-independent.
 * @returns {Object|null} Georeference, or null with fewer than two points.
 */
export function createGeoreference(referencePoints, imageWidth, imageHeight) {
  if (!referencePoints || referencePoints.length < 2) {
    return null;
  }

  if (referencePoints.length < 5) {
    return createMatrixGeoreference(calculateTransform(referencePoints));
  }

  const origin = planeOrigin(referencePoints);
  const warp = computeMLSWarp(referencePoints, {
    lon0: origin.lon0,
    lat0: origin.lat0,
  });
  const extentTransform = computeLeastSquaresSimilarityTransform(
    referencePoints, origin.lon0, origin.lat0
  );
  const foldState = computeFoldState(
    warp.geoToUV, referencePoints, origin.lon0, origin.lat0
  );

  return {
    type: 'mls',
    lon0: origin.lon0,
    lat0: origin.lat0,
    geoToUV: warp.geoToUV,
    uvToGeo: warp.uvToGeo,
    extentTransform,
    isFolded: () => foldState.folded,
  };
}
