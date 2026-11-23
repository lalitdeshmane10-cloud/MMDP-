import { readFileSync } from 'node:fs';
import { createTracker } from '../pitch.mjs';

const wav = readFileSync(process.argv[2]);
let offset = 12;
while (wav.toString('ascii', offset, offset + 4) !== 'data') {
  const length = wav.readUInt32LE(offset + 4);
  offset += 8 + length + (length % 2);
}
const length = wav.readUInt32LE(offset + 4) / 2;
const rate = 16000;
const size = 768;
const samples = new Float32Array(size);
const track = createTracker(rate, size);
const output = [];
for (let center = 0; center < length; center += 160) {
  for (let i = 0; i < size; i++) {
    const index = center + i - size / 2;
    samples[i] = index >= 0 && index < length ? wav.readInt16LE(offset + 8 + 2 * index) / 32768 : 0;
  }
  output.push(track(samples));
}
console.log(JSON.stringify(output));
