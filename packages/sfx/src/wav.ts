/** 16-bit PCM mono WAV (browser-safe: returns bytes). */
export function encodeWav(samples: Float32Array, fs: number): Uint8Array {
  const n = samples.length;
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const tag = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, fs, true);
  v.setUint32(28, fs * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return out;
}

/** Reads back what `encodeWav` wrote (tests and the demo mixer). */
export function decodeWav(bytes: Uint8Array): { fs: number; samples: Float32Array } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fs = v.getUint32(24, true);
  const n = v.getUint32(40, true) / 2;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = v.getInt16(44 + i * 2, true) / 32767;
  return { fs, samples };
}
