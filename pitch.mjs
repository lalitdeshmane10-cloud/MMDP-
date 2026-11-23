export const notes = ['Sa', 'komal Re', 'Re', 'komal Ga', 'Ga', 'Ma', 'tivra Ma', 'Pa', 'komal Dha', 'Dha', 'komal Ni', 'Ni'];

export function sargam(hz, sa) {
  const position = 12 * Math.log2(hz / sa);
  const step = Math.round(position);
  const octave = Math.floor(step / 12);
  const note = notes[step - 12 * octave];
  const register = octave < 0 ? 'mandra' : octave > 0 ? 'taar' : 'madhya';
  return { position, step, note, register: Math.abs(octave) > 1 ? register + ' ×' + Math.abs(octave) : register,
    cents: Math.round(100 * (position - step)) };
}

export function createTracker(rate, size) {
  const maxLag = Math.ceil(rate / 70);
  const minLag = Math.floor(rate / 2200);
  const difference = new Float32Array(maxLag + 2);
  return (samples) => {
    let mean = 0;
    for (const sample of samples) mean += sample / size;
    let energy = 0;
    for (const sample of samples) energy += (sample - mean) ** 2;
    const rms = Math.sqrt(energy / size);
    if (rms < 0.003) return { rms };

    let total = 0;
    const width = size - maxLag - 1;
    for (let lag = 1; lag <= maxLag + 1; lag++) {
      let sum = 0;
      for (let i = 0; i < width; i++) {
        const delta = samples[i] - samples[i + lag];
        sum += delta * delta;
      }
      total += sum;
      difference[lag] = total ? sum * lag / total : 1;
    }
    for (let lag = minLag; lag <= maxLag; lag++) {
      const center = difference[lag];
      const left = difference[lag - 1];
      const right = difference[lag + 1];
      if (center >= 0.15 || center > left || center >= right) continue;
      const shift = (left - right) / (2 * (left - 2 * center + right));
      const hz = rate / (lag + shift);
      if (hz >= 70 && hz <= 2200) return { hz, rms, confidence: 1 - center };
    }
    return { rms };
  };
}
