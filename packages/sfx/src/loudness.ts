/**
 * Loudness (ITU-R BS.1770-4, mono): K-weighting for any sample rate, 400 ms blocks with 75 % overlap, absolute
 * (−70 LUFS) and relative (−10 LU) gates. Sounds shorter than a block are measured as one block over their length.
 */

interface Biquad {
  b: [number, number, number];
  a: [number, number, number];
}

/** The two K-weighting stages (high shelf, then the RLB high-pass), coefficients as in libebur128. */
export function kWeighting(fs: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const hp: Biquad = { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, hp];
}

function filter(x: Float32Array, f: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const o = f.b[0] * v + f.b[1] * x1 + f.b[2] * x2 - f.a[1] * y1 - f.a[2] * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = o;
    y[i] = o;
  }
  return y;
}

/** Integrated loudness in LUFS (−Infinity for silence). */
export function measureLufs(samples: Float32Array, fs: number): number {
  const [shelf, hp] = kWeighting(fs);
  const k = filter(Float32Array.from(filter(samples, shelf)), hp);
  const block = Math.round(0.4 * fs);
  const step = Math.round(0.1 * fs);
  const powers: number[] = [];
  if (k.length < block) {
    let s = 0;
    for (const v of k) s += v * v;
    powers.push(k.length ? s / k.length : 0);
  } else {
    for (let start = 0; start + block <= k.length; start += step) {
      let s = 0;
      for (let i = start; i < start + block; i++) s += k[i]! * k[i]!;
      powers.push(s / block);
    }
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
  const abs = powers.filter((p) => p > 0 && lufs(p) > -70);
  if (!abs.length) return -Infinity;
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter((p) => lufs(p) > rel);
  return lufs(mean(gated.length ? gated : abs));
}

export const dbfs = (linear: number): number => (linear > 0 ? 20 * Math.log10(linear) : -Infinity);

export function peak(samples: Float32Array): number {
  let p = 0;
  for (const v of samples) p = Math.max(p, Math.abs(v));
  return p;
}
