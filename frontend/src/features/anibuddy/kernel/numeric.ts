// Deterministic numeric primitives, and the precision policy behind them.
//
// Precision policy
// ----------------
// Storage is float32; arithmetic is float64; rounding to float32 happens once,
// at the output boundary.
//
// The alternative -- float32 arithmetic throughout -- sounds more faithful to
// the schema but is worse in practice. JavaScript has no float32 arithmetic:
// every intermediate would need an explicit Math.fround wrapper, and a single
// forgotten one produces a divergence that only shows up on some fixtures.
// float64 intermediates are the natural mode in both languages, so the two
// implementations agree by default instead of by vigilance, and the final
// float32 rounding absorbs sub-ULP differences in the underlying libm.
//
// Where the two languages can still legitimately differ
// -----------------------------------------------------
// 1. sin, cos, atan2. V8 uses a bundled fdlibm port; NumPy dispatches to its own
//    SIMD kernels or the platform libm. Neither is required to be correctly
//    rounded, so results may differ by ~1 ULP of float64. After propagation
//    through a couple of multiply-adds and rounding to float32 this is invisible
//    except on an exact float32 rounding boundary -- which is why the parity
//    tolerance is 4 float32 ULP rather than zero.
// 2. hypot. Deliberately NOT used. Math.hypot is explicitly
//    implementation-approximated in ECMA-262 and np.hypot uses a different
//    scaling strategy; the two disagree more often than sqrt does. Both kernels
//    compute sqrt(x*x + y*y) instead. This is a conscious deviation from the v3
//    browser code, which used Math.hypot in three places (rest length, singular
//    values, seam bleed).
// 3. Accumulation order. IEEE addition is not associative, so any reduction has
//    to run in the same order in both kernels. NumPy's sum and matmul use
//    pairwise or blocked summation and are therefore banned on parity-critical
//    paths; the skinning reduction loops over bones in ascending index order in
//    both kernels.
// 4. Denormals. Both run with denormals enabled; no path here produces values
//    near 1e-38 anyway.
// 5. Degree to radian conversion. Written as (degrees * PI) / 180 in both,
//    multiply first. degrees * (PI / 180) rounds differently and is a real,
//    reproducible source of last-ULP drift.

/**
 * Nearest float64 to pi, identical to Python's math.pi by definition (both are
 * the IEEE-754 double nearest the true value).
 */
const PI = Math.PI;

export const Numeric = {
  PI,

  /**
   * Degrees to radians as (d * PI) / 180.
   *
   * The operation order is load-bearing. `d * (PI / 180)` folds the constant
   * first and rounds differently in the last bit; the Python kernel uses this
   * same order for that reason.
   */
  radians(degrees: number): number {
    return (degrees * PI) / 180;
  },

  /**
   * Euclidean length via sqrt(dx*dx + dy*dy).
   *
   * Not Math.hypot: see the module header. Overflow is not a concern because
   * every input here is a pixel coordinate.
   */
  length(dx: number, dy: number): number {
    return Math.sqrt(dx * dx + dy * dy);
  },

  /**
   * Round a float64 working array down to the float32 storage type.
   *
   * This is the single boundary where precision is discarded, and it is what
   * makes the two kernels comparable at all. Float32Array assignment performs
   * the round-to-nearest-even that Math.fround would.
   */
  toStorage(values: Float64Array): Float32Array {
    return Float32Array.from(values);
  },

  /** Round one scalar to float32. */
  scalarToStorage(value: number): number {
    return Math.fround(value);
  },
} as const;
