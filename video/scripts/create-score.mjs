// Original deterministic electronic score, synthesized locally. No sampled music.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const rate = 48000,
  duration = 22,
  n = rate * duration;
const left = new Float32Array(n),
  right = new Float32Array(n);
let seed = 41;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2147483648 - 1;
};
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const add = (start, length, fn, pan = 0) => {
  const a = Math.floor(start * rate),
    l = Math.min(Math.floor(length * rate), n - a);
  for (let i = 0; i < l; i++) {
    if (a + i < 0) continue;
    const s = fn(i / rate, i);
    left[a + i] += s * (0.72 - pan * 0.25);
    right[a + i] += s * (0.72 + pan * 0.25);
  }
};
const chords = [
  [57, 60, 64, 71],
  [53, 57, 60, 67],
  [60, 64, 67, 74],
  [55, 59, 62, 69],
];
for (let bar = 0; bar < 13; bar++) {
  const start = bar * (24 / 13),
    chord = chords[Math.floor(bar / 2) % 4];
  for (const [v, m] of chord.entries()) {
    const f = hz(m);
    add(
      start,
      3.1,
      (t) =>
        0.022 *
        (1 - Math.exp(-t * 4)) *
        Math.exp(-t * 0.75) *
        (Math.sin(2 * Math.PI * f * t) +
          0.35 * Math.sin(2 * Math.PI * f * 1.0018 * t)),
      (v - 1.5) / 2,
    );
  }
  if (start >= 0.9 && start < 20.5) {
    for (let beat = 0; beat < 4; beat++) {
      add(
        start + beat * (6 / 13),
        0.35,
        (t) =>
          0.2 *
          Math.sin(2 * Math.PI * (49 * t + 5 * (1 - Math.exp(-t * 40)))) *
          Math.exp(-t * 15),
      );
      if (beat % 2)
        add(
          start + beat * (6 / 13),
          0.16,
          (t) =>
            0.048 *
            (noise() + 0.25 * Math.sin(2 * Math.PI * 185 * t)) *
            Math.exp(-t * 29),
          0.1,
        );
      add(
        start + beat * (6 / 13),
        0.26,
        (t) =>
          0.085 *
          Math.sin(2 * Math.PI * hz(chord[0] - 24) * t) *
          (1 - Math.exp(-t * 170)) *
          Math.exp(-t * 15),
      );
    }
    for (let step = 0; step < 8; step++) {
      add(
        start + step * (3 / 13),
        0.06,
        (t) => 0.017 * noise() * Math.exp(-t * 80),
        step % 2 ? 0.65 : -0.4,
      );
      const note = chord[[0, 2, 1, 3, 2, 0, 3, 1][step]] + 12;
      const at = start + step * (3 / 13);
      const pluck = (t) =>
        0.035 *
        (Math.sin(2 * Math.PI * hz(note) * t) +
          0.18 * Math.sin(2 * Math.PI * hz(note) * 2 * t)) *
        (1 - Math.exp(-t * 180)) *
        Math.exp(-t * 12);
      add(at, 0.5, pluck, ((step % 3) - 1) * 0.55);
      add(at + 4.5 / 13, 0.5, (t) => pluck(t) * 0.22, 0.7);
    }
  }
}
// Gentle transition sweeps and cursor clicks aligned to the edit.
for (const time of [1, 6.5, 11, 15, 20.5])
  add(
    time - 0.32,
    0.65,
    (t) => 0.027 * noise() * Math.pow(Math.sin((Math.PI * t) / 0.65), 3),
  );
for (const time of [4.2, 12.45, 13.45])
  add(
    time,
    0.09,
    (t) => 0.065 * Math.sin(2 * Math.PI * 1650 * t) * Math.exp(-t * 100),
  );
const wav = Buffer.alloc(44 + n * 4);
wav.write("RIFF");
wav.writeUInt32LE(36 + n * 4, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) {
  const t = i / rate,
    fade = Math.min(1, t / 0.5, (duration - t) / 0.7);
  wav.writeInt16LE(
    Math.round(Math.tanh(left[i] * 2) * fade * 28000),
    44 + i * 4,
  );
  wav.writeInt16LE(
    Math.round(Math.tanh(right[i] * 2) * fade * 28000),
    46 + i * 4,
  );
}
const dir = resolve(import.meta.dirname, "../public/audio");
await mkdir(dir, { recursive: true });
await writeFile(resolve(dir, "product-score-fast.wav"), wav);
console.log("Original 22-second stereo score written.");
