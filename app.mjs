import { sargam } from './pitch.mjs';

const byId = (id) => document.getElementById(id);
const mic = byId('mic');
const calibrate = byId('calibrate');
const status = byId('status');
const reference = byId('reference');
const intervals = byId('intervals');
let intervalStart = 0;
let nextUpdate = 0;
let motionUntil = 0;
let session;
let sa;
let pendingCalibration;
let candidate;
let count = 0;
let heard;

function display(note, emptyState) {
  byId('note').textContent = note?.note ?? '—';
  byId('register').textContent = note?.register ?? emptyState;
  const needle = byId('needle');
  needle.hidden = !note;
  if (note) needle.style.left = (50 + note.cents) + '%';
  byId('tuning-label').textContent = !note ? 'Tuning' :
    Math.abs(note.cents) <= 5 ? 'Centered' : note.cents < 0 ? 'Flat' : 'Sharp';
}

function resetReading() {
  candidate = heard = undefined;
  count = 0;
  nextUpdate = 0;
}

function analyze({ hz, rms, time }) {
  byId('level').value = Math.min(1, rms * 5);
  if (pendingCalibration) {
    const calibration = pendingCalibration;
    calibration.start ??= time;
    if (hz) calibration.samples.push(hz);
    if (time - calibration.start < 2) return;

    const sorted = calibration.samples.sort((a, b) => a - b);
    const middle = sorted[Math.floor(sorted.length / 2)];
    const steady = sorted.filter((sample) => Math.abs(1200 * Math.log2(sample / middle)) < 35);
    if (steady.length >= 70 && steady.length >= sorted.length * 0.8) {
      sa = steady[Math.floor(steady.length / 2)];
      intervals.replaceChildren();
      resetReading();
      reference.textContent = 'Sa calibrated';
      status.textContent = 'Play any note to check its Sargam.';
    } else {
      status.textContent = 'Try again with one steady Sa held for two seconds.';
    }
    pendingCalibration = undefined;
    calibrate.disabled = false;
  }
  if (!sa) return;

  const reading = hz ? sargam(hz, sa) : undefined;
  const step = reading?.step;
  if (candidate !== step) {
    candidate = step;
    count = 0;
  }
  count++;
  const moving = performance.now() < motionUntil;
  const requiredFrames = reading ? (moving ? 14 : 20) : 24;
  if (count < requiredFrames) return;
  if (step !== heard?.step) {
    if (reading) {
      intervalStart = time - (count - 1) * 0.01;
      const item = document.createElement('span');
      intervals.append(item);
      if (intervals.children.length > 12) intervals.firstElementChild.remove();
    }
    heard = reading;
    nextUpdate = 0;
  } else if (reading) {
    heard.cents += 0.06 * (reading.cents - heard.cents);
  }
  if (time >= nextUpdate) {
    display(heard, 'Listening');
    if (heard) intervals.lastElementChild.textContent = heard.note + ' · ' + heard.register + ' · ' + (time - intervalStart).toFixed(1) + ' s';
    nextUpdate = time + 0.15;
  }
}

calibrate.addEventListener('click', () => {
  pendingCalibration = { samples: [] };
  calibrate.disabled = true;
  status.textContent = 'Hold your madhya Sa for two seconds.';
  resetReading();
  display(undefined, 'Calibrating Sa');
});

async function stop() {
  const active = session;
  session = undefined;
  active.stream?.getTracks().forEach((track) => track.stop());
  if (active.processor) {
    active.processor.port.onmessage = null;
    active.processor.disconnect();
  }
  if (active.audio.state !== 'closed') await active.audio.close();
  intervals.replaceChildren();
  pendingCalibration = undefined;
  resetReading();
  byId('level').value = 0;
  calibrate.disabled = true;
  mic.textContent = 'Start microphone';
  display(undefined, 'Waiting for input');
}

mic.addEventListener('click', async () => {
  mic.disabled = true;
  try {
    if (session) {
      await stop();
      status.textContent = 'Microphone stopped.';
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      status.textContent = 'Open this app on localhost or HTTPS in a browser with microphone support.';
      return;
    }
    const audio = new AudioContext();
    session = { audio };
    await audio.resume();
    session.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    await audio.audioWorklet.addModule('./pitch-worklet.mjs');
    const processor = new AudioWorkletNode(audio, 'pitch-processor');
    session.processor = processor;
    processor.port.onmessage = ({ data }) => analyze(data);
    audio.createMediaStreamSource(session.stream).connect(processor);
    processor.connect(audio.destination);
    mic.textContent = 'Stop microphone';
    calibrate.disabled = false;
    status.textContent = sa ? 'Play a note or recalibrate Sa.' : 'Select Set Sa, then hold your madhya Sa.';
  } catch (error) {
    if (session) await stop();
    status.textContent = error.name === 'NotAllowedError' ? 'Allow microphone access and try again.' :
      'Could not start the microphone. Check the audio device and try again.';
    console.error(error);
  } finally {
    mic.disabled = false;
  }
});


const camera = byId('camera');
const video = byId('hands');
const patch = document.createElement('canvas');
patch.width = 40;
patch.height = 24;
const pixels = patch.getContext('2d', { willReadFrequently: true });
let previous;
let sampler;

function sampleHands() {
  if (video.readyState < 2) return;
  const w = video.videoWidth;
  const h = video.videoHeight;
  pixels.drawImage(video, w / 4, h / 4, w / 2, h / 2, 0, 0, 40, 24);
  const frame = pixels.getImageData(0, 0, 40, 24).data;
  if (previous) {
    let changed = 0;
    for (let i = 0; i < frame.length; i += 4) {
      if (Math.abs(frame[i + 1] - previous[i + 1]) > 20) changed++;
    }
    if (changed > 12 && changed < 300) motionUntil = performance.now() + 220;
  }
  previous = frame;
}

function stopCamera() {
  clearInterval(sampler);
  video.srcObject?.getTracks().forEach(track => track.stop());
  video.srcObject = null;
  video.hidden = true;
  previous = undefined;
  motionUntil = 0;
  camera.textContent = 'Start camera';
}

camera.onclick = async () => {
  camera.disabled = true;
  try {
    if (video.srcObject) {
      stopCamera();
      byId('camera-status').textContent = 'Camera stopped.';
    } else {
      video.srcObject = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      await video.play();
      video.hidden = false;
      camera.textContent = 'Stop camera';
      byId('camera-status').textContent = 'Center your hands in the preview. Movement briefly speeds up confirmation of a new pitch.';
      sampler = setInterval(sampleHands, 80);
    }
  } catch {
    stopCamera();
    byId('camera-status').textContent = 'Camera unavailable. Check camera access or continue with audio.';
  } finally {
    camera.disabled = false;
  }
};
