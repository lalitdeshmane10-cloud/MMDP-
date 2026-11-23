import { notes } from './pitch.mjs';

const byId = (id) => document.getElementById(id);
const swara = byId('swara');
const preview = byId('preview');
const camera = byId('camera');
const stopDevices = byId('stop-devices');
const record = byId('record');
const next = byId('next');
const deviceStatus = byId('device-status');
const recordStatus = byId('record-status');
const takes = byId('takes');
let stream;
let recorder;
let chunks = [];
let label;
let counter = 0;
let hasTakes = false;

window.addEventListener('beforeunload', (event) => {
  if (hasTakes) {
    event.preventDefault();
    event.returnValue = '';
  }
});

for (const note of notes) swara.add(new Option(note, note));
for (let number = 1; number <= 6; number++) {
  const field = document.createElement('label');
  field.textContent = `Hole ${number}`;
  const select = document.createElement('select');
  select.setAttribute('aria-label', `Hole ${number}`);
  for (const state of ['unknown', 'open', 'closed', 'half-covered']) {
    select.add(new Option(state, state));
  }
  field.append(select);
  byId('holes').append(field);
}

function updatePrompt() {
  byId('prompt').textContent = swara.value;
}
swara.addEventListener('change', updatePrompt);
updatePrompt();

next.addEventListener('click', () => {
  swara.selectedIndex = (swara.selectedIndex + 1) % swara.options.length;
  for (const field of byId('holes').querySelectorAll('select')) field.value = 'unknown';
  updatePrompt();
});

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function addTake(blob, metadata) {
  hasTakes = true;
  if (takes.querySelector('.muted')) takes.replaceChildren();
  const row = document.createElement('div');
  row.className = 'take';
  const title = document.createElement('strong');
  title.textContent = `${metadata.swara} · ${metadata.id}`;
  const playback = document.createElement('video');
  playback.controls = true;
  playback.src = URL.createObjectURL(blob);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const videoButton = document.createElement('button');
  videoButton.textContent = 'Download video';
  videoButton.addEventListener('click', () => download(blob, metadata.video_file));
  const labelButton = document.createElement('button');
  labelButton.className = 'secondary';
  labelButton.textContent = 'Download label';
  labelButton.addEventListener('click', () => download(
    new Blob([JSON.stringify(metadata, null, 2) + '\n'], { type: 'application/json' }),
    `${metadata.id}.json`
  ));
  actions.append(videoButton, labelButton);
  row.append(title, playback, actions);
  takes.prepend(row);
}

camera.addEventListener('click', async () => {
  camera.disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error('This browser cannot record camera and microphone. Open the app on localhost or HTTPS.');
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    preview.srcObject = stream;
    await preview.play();
    preview.parentElement.classList.add('active');
    record.disabled = false;
    stopDevices.disabled = false;
    deviceStatus.textContent = 'Camera and microphone are ready.';
    recordStatus.textContent = 'Choose a swara and start recording.';
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    preview.srcObject = null;
    camera.disabled = false;
    deviceStatus.textContent = error.name === 'NotAllowedError' ? 'Allow camera and microphone access to continue.' : error.message;
  }
});

stopDevices.addEventListener('click', () => {
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
  preview.srcObject = null;
  preview.parentElement.classList.remove('active');
  camera.disabled = false;
  stopDevices.disabled = true;
  record.disabled = true;
  deviceStatus.textContent = 'Camera and microphone are off.';
});

record.addEventListener('click', () => {
  if (recorder?.state === 'recording') {
    record.disabled = true;
    recorder.stop();
    return;
  }
  try {
    chunks = [];
    recorder = new MediaRecorder(stream);
    const id = `take-${new Date().toISOString().replace(/[:.]/g, '-')}-${++counter}`;
    label = {
      id,
      swara: swara.value,
      player_id: byId('player').value.trim(),
      flute_sa: byId('flute').value.trim(),
      hole_states: Array.from(byId('holes').querySelectorAll('select'), (field) => field.value),
      notes: byId('notes').value.trim(),
      label_source: 'player-provided prompt and fingering; not verified',
      recorded_at: new Date().toISOString()
    };
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { recordStatus.textContent = 'Recording failed. Try again.'; };
    recorder.onstop = () => {
      const type = recorder.mimeType || chunks[0]?.type || 'video/webm';
      const blob = new Blob(chunks, { type });
      if (blob.size) {
        label.video_file = `${label.id}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
        label.mime_type = type;
        addTake(blob, label);
        recordStatus.textContent = 'Take ready. Review it and download both files.';
      } else {
        recordStatus.textContent = 'No video was captured. Try again.';
      }
      record.textContent = 'Start recording';
      record.disabled = !stream;
      stopDevices.disabled = !stream;
      for (const field of document.querySelectorAll('.record-fields input, .record-fields select, #holes select, #notes, #next')) field.disabled = false;
    };
    recorder.start();
    record.textContent = 'Stop recording';
    stopDevices.disabled = true;
    for (const field of document.querySelectorAll('.record-fields input, .record-fields select, #holes select, #notes, #next')) field.disabled = true;
    recordStatus.textContent = `Recording ${label.swara}. Hold the note, then stop.`;
  } catch (error) {
    recordStatus.textContent = `Could not start recording: ${error.message}`;
  }
});
