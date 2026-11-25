import { setupFlow } from './flow.mjs';
import { setupImport } from './import-song.mjs';
import krishna from './krishna-score.mjs';
import library from './practice-library.mjs';
import { notes, sargam } from './pitch.mjs';

const get = id => document.getElementById(id);
const songs = [krishna, ...library];
try { songs.push(...JSON.parse(localStorage.getItem('studio-songs') || '[]')); } catch {}
const song = get('song');
const key = get('key');
const seek = get('seek');
const play = get('play');
const checking = () => get('mode').value === 'check';
let credited = 0;
let cursor = 0, lastFrame, releaseStep, phraseKey;
const passed = new Set();
function resetGate() { credited = 0; lastFrame = releaseStep = undefined; }
const fingers = ['222000','221000','220000','210000','200000','100000','000000','222222','222221','222220','222210','222200'];
const name = step => notes[(step % 12 + 12) % 12];
const format = time => Math.floor(time/60) + ':' + String(Math.floor(time%60)).padStart(2,'0');
let score, position = 0, previous, running = false, active, sa = 440;
let sample, audio, output, tone, toneIndex, loopStart, loopEnd, beat;
const speed = () => Number(get('speed').value);

for (const [i, label] of 'C C♯ D D♯ E F F♯ G G♯ A A♯ B'.split(' ').entries()) key.add(new Option(label,i));
key.add(new Option('Custom · measured range','custom'));
key.value = '9';
function selectKey() {
  if(key.value==='custom'){
    if(!range){get('range-status').closest('details').open=true;rangeMessage('Capture both endpoints, then use this range. Low note must be all-holes-closed low Pa.');return;}
    sa=range.low*2**(5/12);
  } else sa = 440*2**((Number(key.value)-9)/12);
  document.dispatchEvent(new CustomEvent('set-flute-key',{detail:sa}));
  active = null;
  resetGate();
  sample = undefined;
  stopTone();
  if (range) selectSong(); else syncOriginal();
}
key.onchange = selectKey;
document.addEventListener('sa-ready',event => {
  if (event.detail) sa = event.detail;
  active = null;
  resetGate();
  stopTone();
  if (range) selectSong(); else syncOriginal();
});
document.addEventListener('mic-stopped',() => { sample = undefined; if (capture) {capture=undefined;rangeMessage('Capture stopped with the microphone.');} });

function loadSongs(index) {
  song.replaceChildren(...songs.map((item,i) => new Option(item.title,i)));
  song.value = index;
  selectSong();
}
const original = new Audio('/krishna.wav');
original.preload = 'metadata';
const voice = get('voice');
const recorded = () => voice.value !== 'generated' && enabled('reference-audio');
function syncOriginal() {
  original.pause();
  if (!running || checking() || !recorded()) return;
  const cents = Math.round(1200*(Math.log2(sa/318)+Number(get('octave').value)));
  const path = voice.value === 'shifted' ? '/transposed.wav?cents='+cents : '/krishna.wav';
  if (!original.src.endsWith(path)) original.src = path;
  original.currentTime = position + .15;
  original.playbackRate = speed();
  original.volume = Number(get('volume').value);
  original.play().catch(error => {
    if (error.name !== 'AbortError') {
      pause();
      get('status').textContent = 'Original recording unavailable. Select Generated flute to continue.';
    }
  });
}
voice.onchange = () => { stopTone(); syncOriginal(); };
let range, capture;
const rangeMessage = text => { get('range-status').textContent = text; };
function arrangeInRange(source, lowHz, highHz, tonic=sa) {
  const bottom = Math.ceil(12*Math.log2(lowHz/tonic)-1e-8);
  const top = Math.floor(12*Math.log2(highHz/tonic)+1e-8);
  const result = [];
  const boundaries = source.sections ?? [0];
  for (const [i,start] of boundaries.entries()) {
    const phrase = source.notes.slice(start,boundaries[i+1]);
    const pitches = phrase.map(n=>n[2]);
    const down = Math.ceil((bottom-Math.min(...pitches))/12);
    const up = Math.floor((top-Math.max(...pitches))/12);
    const common = down<=up ? Math.min(up,Math.max(down,0)) : 0;
    let previousPitch, previousTarget;
    for (const [a,b,pitch] of phrase) {
      const first = Math.ceil((bottom-pitch)/12), last = Math.floor((top-pitch)/12);
      if (first>last) throw new Error(name(pitch)+' has no playable octave within these limits.');
      const desired = previousPitch===undefined ? common : (previousTarget-previousPitch)/12;
      const target = pitch+12*Math.max(first,Math.min(last,desired));
      result.push([a,b,target]);
      previousPitch=pitch; previousTarget=target;
    }
  }
  return result;
}
function applyRange() {
  const low=Number(get('range-low').value), high=Number(get('range-high').value);
  if (!(low>=70 && high<=2200 && low<high)) {
    rangeMessage('Enter a low and a higher frequency between 70 and 2200 Hz.');return;
  }
  try { arrangeInRange(songs[Number(song.value)],low,high,key.value==="custom"?low*2**(5/12):sa); }
  catch (error) { rangeMessage(error.message);return; }
  range={low,high}; capture=undefined; voice.value="generated";
  if(key.value==='custom')selectKey();else selectSong();
}
get('apply-range').onclick=applyRange;
get('clear-range').onclick=()=>{
  capture=range=undefined;if(key.value==="custom"){key.value="9";selectKey();}selectSong();rangeMessage('Standard arrangement active.');
};
for (const end of ['low','high']) get('capture-'+end).onclick=()=>{
  if (get('calibrate').disabled) {rangeMessage('Start the microphone and finish Set Sa before capturing.');return;}
  pause();
  get('range-progress').value=0;
  capture={end, samples:[]};
  rangeMessage('Listening for your '+end+' note. Hold it steady when ready.');
};
function measureEndpoint(raw,at) {
  const {samples,end} = capture;
  if (!Number.isFinite(raw) || at-capture.last>60 || Math.abs(raw-samples[0])>.45) samples.length=0;
  capture.last=at;
  if (!Number.isFinite(raw)) {get('range-progress').value=0;return;}
  if (!samples.length) capture.start=at;
  samples.push(raw);
  get('range-progress').value=(at-capture.start)/2000;
  if (at-capture.start<2000) return;
  const median=samples.sort((a,b)=>a-b)[Math.floor(samples.length/2)];
  const hz=sa*2**(median/12);
  get('range-'+end).value=hz.toFixed(1);
  rangeMessage('Captured '+end+' note at '+hz.toFixed(1)+' Hz. Choose Use this range when both limits are ready.');
  capture=undefined;
}
function selectSong(keepTake=false) {
  const source = songs[Number(song.value)];
  const arranged = [];
  const boundaries = source.sections ?? [0];
  for (const [i,startIndex] of boundaries.entries()) {
    const phrase = source.notes.slice(startIndex,boundaries[i+1]);
    const high = Math.max(...phrase.map(n=>n[2]));
    const low = Math.min(...phrase.map(n=>n[2]));
    const shift = high>23 ? -12*Math.ceil((high-23)/12) : low<0 ? 12*Math.ceil(-low/12) : 0;
    for (const [start,end,step] of phrase) arranged.push([start,end,((step+shift)%24+24)%24]);
  }
  let targets = arranged;
  if (range) {
    try {
      targets = arrangeInRange(source,range.low,range.high);
      rangeMessage('Using '+range.low+'–'+range.high+' Hz. Generated flute follows these octaves.');
    } catch (error) {
      rangeMessage(error.message+' Using the standard arrangement.');
      range=undefined;
    }
  }
  score = {...source,notes:targets.map(([a,b,k])=>[a,b,k+12*Number(get('octave').value)])};
  active = null;
  pause();
  if(keepTake!==true)flow.reset();
  passed.clear();
  phraseKey = undefined;
  for (const option of voice.options) option.disabled = option.value !== "generated" && source !== krishna;
  if (source !== krishna) voice.value = "generated";
  jump(0);
  loopStart = loopEnd = undefined;
  get('loop').textContent = 'Set loop start';
  get('song-title').textContent = score.title;
  seek.max = score.duration;
  const counts = {};
  for (const [, , step] of score.notes) counts[name(step)] = (counts[name(step)] || 0) + 1;
  get('distribution').textContent = Object.entries(counts).map(([n,c]) => n + ' ' + c).join(' · ');
  const info = get('song-info');
  info.replaceChildren();
  for (const [label,value] of Object.entries(score.info || {})) {
    const line = document.createElement('p');
    line.textContent = label + ' · ' + (typeof value === 'object' ? JSON.stringify(value) : value);
    info.append(line);
  }
}
song.onchange = selectSong;
get('octave').onchange=()=>{const time=position;selectSong(true);jump(time);flow.repaint();};

function stopTone() {
  if (tone) { try { tone.stop(); } catch {} }
  tone = toneIndex = undefined;
}
function jump(time) {
  position = Math.max(0,Math.min(score.duration,time));
  previous = undefined;
  resetGate();
  recent.length = 0;
  cursor = score.notes.findIndex(n => n[1] > position);
  if (cursor < 0) cursor = score.notes.length;
  if (checking() && cursor < score.notes.length) position = score.notes[cursor][0];
  for (const index of passed) if (index >= cursor) passed.delete(index);
  phraseKey = undefined;
  syncOriginal();
  beat = undefined;
  stopTone();
}
function pause() {
  running = false;
  original.pause();
  previous = undefined;
  stopTone();
  play.textContent = position >= score.duration ? 'Play again' : position ? 'Resume' : 'Start practice';
}
let fluteSample, echo;
async function audioReady() {
  if (!audio) {
    audio = new AudioContext();
    output = audio.createGain();
    output.gain.value = Number(get('volume').value) * .24;
    output.connect(audio.destination);
    echo=audio.createDelay();
    echo.delayTime.value=.125;
    const damping=audio.createBiquadFilter(), wet=audio.createGain();
    damping.type='lowpass';damping.frequency.value=2400;wet.gain.value=.17;
    echo.connect(damping).connect(wet).connect(output);
    wet.connect(echo);
  }
  await audio.resume();
  if (!fluteSample && voice.value==='generated' && enabled('reference-audio')) {
    try { fluteSample=await audio.decodeAudioData(await (await fetch('/flute-loop.wav')).arrayBuffer()); }
    catch { /* The synthesized voice also works offline without the sample. */ }
  }
}
const enabled = id => get(id).getAttribute('aria-pressed') === 'true';
for (const id of ['reference-audio','metronome']) get(id).onclick = async () => {
  const button=get(id);
  const next=!enabled(id);
  button.disabled=true;
  try {
    if(id==='reference-audio' && next && checking()){
      get('mode').value='listen';get('mode').onchange();
    }
    button.setAttribute('aria-pressed',String(next));
    if(next) await audioReady();
    if(id==='reference-audio'){
      stopTone();
      if(next && !running) await play.onclick();
      else syncOriginal();
    } else beat=undefined;
    button.textContent=(id==='metronome'?'Metronome':'Reference')+(next?' on':' off');
  } catch {
    button.setAttribute('aria-pressed','false');
    button.textContent=(id==='metronome'?'Metronome':'Reference')+' off';
    get('status').textContent='Audio output unavailable. Check the playback device and try again.';
  } finally {button.disabled=false;}
};
get('volume').oninput = () => { original.volume = Number(get('volume').value); if (output) output.gain.value = Number(get('volume').value)*.24; };
play.onclick = async () => {
  if (running) return pause();
  if (enabled('reference-audio') || enabled('metronome')) await audioReady();
  if (position >= score.duration) jump(0);
  resetGate();
  running = true;
  syncOriginal();
  play.textContent = 'Pause';
};
get('restart').onclick = () => { jump(0); if (!running) void play.onclick(); };
seek.oninput = () => jump(Number(seek.value));
get('speed').onchange = () => { phraseKey = undefined; stopTone(); syncOriginal(); };
get('loop').onclick = () => {
  if (loopEnd !== undefined) {
    loopStart = loopEnd = undefined;
    get('loop').textContent = 'Set loop start';
  } else if (loopStart === undefined) {
    loopStart = position;
    get('loop').textContent = 'Set loop end';
  } else if (position > loopStart + .1) {
    loopEnd = position;
    get('loop').textContent = 'Clear loop';
    jump(loopStart);
  }
};
let lastFluteEnd=-Infinity,lastFluteHz;
function sound(hz,duration,type) {
  const t = audio.currentTime;
  if(type==='flute' && fluteSample){
    const source=audio.createBufferSource(),gain=audio.createGain();
    source.buffer=fluteSample;source.loop=true;
    const connected=lastFluteHz && Math.abs(t-lastFluteEnd)<.04 && hz!==lastFluteHz;
    const bend=connected?Math.max(-90,Math.min(90,1200*Math.log2(lastFluteHz/hz))):-14;
    source.playbackRate.value=hz/1266.6015625;
    source.detune.setValueAtTime(bend,t);
    source.detune.linearRampToValueAtTime(0,t+Math.min(.045,duration*.32));
    lastFluteEnd=t+duration;lastFluteHz=hz;
    const attack=connected?.018:.055;
    gain.gain.setValueAtTime(.001,t);
    gain.gain.linearRampToValueAtTime(.78,t+Math.min(attack,duration/2));
    gain.gain.setTargetAtTime(.60,t+duration*.6,.08);
    gain.gain.setTargetAtTime(.001,t+duration,.016);
    source.connect(gain).connect(output);gain.connect(echo);source.start();source.stop(t+duration+.08);
    source.onended=()=>{source.disconnect();gain.disconnect();};return source;
  }
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();
  if (type === 'flute') {
    // Harmonic amplitudes measured from a sustained note in the original recording.
    const spectrum = Float32Array.of(0,1,.184,.049,.005,.002,.002);
    oscillator.setPeriodicWave(audio.createPeriodicWave(new Float32Array(spectrum.length),spectrum));
    oscillator.detune.setValueAtTime(-10,t);
    oscillator.detune.setTargetAtTime(0,t+.012,.025);
    for (let elapsed=.08; elapsed<duration; elapsed+=.02) {
      oscillator.detune.linearRampToValueAtTime(8*Math.min(1,elapsed/.3)*Math.sin(elapsed*31),t+elapsed);
    }
  } else oscillator.type = type;
  oscillator.frequency.value = hz;
  envelope.gain.setValueAtTime(0,t);
  envelope.gain.linearRampToValueAtTime(1,t+Math.min(duration/2,type === "flute" ? .035 : .012));
  envelope.gain.setTargetAtTime(0,t+Math.max(.012,duration-.025),.01);
  oscillator.connect(envelope).connect(output);
  if(type==='flute')envelope.connect(echo);
  oscillator.start(t);
  oscillator.stop(t+duration+.025);
  oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  return oscillator;
}
const recent = [];

let lastVoiced = -Infinity;
document.addEventListener('pitch-frame',event => {
  const {at, position: raw} = event.detail;
  if (capture) {measureEndpoint(raw,at);return;}
  if (at-lastVoiced > 75) recent.length = 0;
  if (Number.isFinite(raw)) {
    lastVoiced = at;
    recent.push(raw);
    if (recent.length > 5) recent.shift();
    const sorted = [...recent].sort((a,b)=>a-b);
    sample = {at, position:sorted[Math.floor(sorted.length/2)]};
  } else if (at-lastVoiced > 50) sample = {at};
  else return;
  if (!checking() || !running || cursor >= score.notes.length) return;
  const [start,end,step] = score.notes[cursor];
  const matches = Math.abs(sample.position-step) <= .60;
  const elapsed = at-lastFrame;
  lastFrame = at;
  if (!matches) {
    releaseStep = undefined;
    return;
  }
  if (releaseStep === step) return;
  if (elapsed>0 && elapsed<=35) credited += elapsed*speed();
  const required = Math.max(55,(end-start)*850);
  if (credited < required) return;
  credited = 0;
  passed.add(cursor++);
  position = score.notes[cursor]?.[0] ?? score.duration;
  releaseStep = step;


});
function updateFingering(step) {
  const fingering = get('fingering');
  fingering.replaceChildren();
  if (step === undefined) return;
  for (const state of fingers[(step%12+12)%12]) {
    const hole = document.createElement('span');
    hole.dataset.state = state;
    hole.setAttribute('aria-label',['Open','Half covered','Closed'][Number(state)]);
    fingering.append(hole);
  }
}

function renderPhrase(index) {
  const last = score.notes.length-1;
  const current = Math.max(0,Math.min(last,index));
  const sections = score.sections ?? Array.from({length:Math.ceil(score.notes.length/8)},(_,i)=>i*8);
  const section = sections.findLastIndex(start => start<=current);
  const signature = [index,section,checking(),passed.size].join('/');
  if (phraseKey === signature) return;
  phraseKey = signature;
  get('section-count').textContent = 'Section '+(section+1)+' / '+sections.length;
  const tiles = score.notes.slice(sections[section],sections[section+1]).map((note,offset)=>{
    const i = sections[section]+offset;
    const tile = document.createElement('button');
    tile.type='button';tile.onclick=()=>jump(note[0]);
    const octave = Math.floor(note[2]/12);
    tile.textContent = name(note[2]) + (octave>0 ? '′'.repeat(octave) : '̣'.repeat(-octave));
    tile.style.width = Math.max(3,(note[1]-note[0])*9)+'rem';
    tile.title = ((note[1]-note[0])/speed()).toFixed(2)+' seconds';
    tile.className = i===index ? 'current' : checking() && passed.has(i) ? 'correct' : '';
    if (i===index) tile.setAttribute('aria-current','step');
    return tile;
  });
  get('phrase').replaceChildren(...tiles);
}
get('mode').onchange = () => {
  flow.modeChanged();
  pause();
  if (checking()) {
    get('reference-audio').setAttribute('aria-pressed','false');
    get('reference-audio').textContent = 'Reference off';
  }
  jump(position);
};
let animation;
function draw(time) {
  if (!checking() && running && previous !== undefined) position = recorded() ? Math.max(0,original.currentTime-.15) : Math.min(score.duration,position + (time-previous)*speed()/1000);
  previous = running ? time : undefined;
  if (running && loopEnd !== undefined && position>=loopEnd) jump(loopStart);
  if (running && position>=score.duration) pause();
  const index = checking() ? cursor : score.notes.findIndex(([a,b])=>position>=a && position<b);
  const note = score.notes[index];
  const step = note?.[2];
  if (active!==step) {
    active = step;
    get('target-note').textContent = note ? name(step) : 'Rest';
    get('target-register').textContent = note ? sargam(sa*2**(step/12),sa).register+' · '+Math.round(sa*2**(step/12))+' Hz' : '';
    updateFingering(step);
  }
  const current = time-sample?.at<180 ? sample.position : undefined;
  const cents = current===undefined || step===undefined ? undefined : Math.round((current-step)*100);
  const feedback = position>=score.duration ? 'Finished' : !running ? 'Ready' : step===undefined ? 'Rest' :
    releaseStep===step ? 'Articulate the note again' : cents===undefined ? 'Play '+name(step) :
    Math.abs(cents)<=60 ? 'Hold steady' : cents<0 ? 'Go higher' : 'Go lower';
  if (get('match').textContent!==feedback) get('match').textContent=feedback;
  if (running && !checking() && enabled('reference-audio') && !recorded() && index!==toneIndex) {
    toneIndex=index;
    if (note) tone=sound(sa*2**(step/12),(note[1]-position)/speed(),'flute');
  }
  const nextBeat=Math.floor(((!running || checking()) ? time/1000*speed() : position)*(score.bpm||72)/60);
  if(audio?.state==='running' && get('mode').value!=='flow' && enabled('metronome') && nextBeat!==beat) {beat=nextBeat;sound(880,.04,'triangle');}
  seek.value=position;
  get('elapsed').textContent=format(position)+' / '+format(score.duration);
  renderPhrase(index<0 ? (score.notes.findIndex(n=>n[0]>position)+score.notes.length)%score.notes.length : index);
  const currentTile = get('phrase').querySelector('.current');
  if (currentTile && note) {
    const fraction = checking() ? credited/Math.max(55,(note[1]-note[0])*850) : (position-note[0])/(note[1]-note[0]);
    currentTile.style.setProperty('--fill',Math.min(100,Math.max(0,fraction*100))+'%');
  }
  animation=requestAnimationFrame(draw);
}
get('creator').onsubmit = event => {
  event.preventDefault();
  const chromatic='SrRgGMmPdDnN';
  const bpm=Number(get('bpm').value);
  let cursor=0;
  const events=[];
  for (const token of get('notation').value.trim().split(/[\s|]+/)) {
    if (!token) continue;
    const duration=(token.includes('-')&&token!=='-'?2:1)*60/bpm;
    if (token!=='rest' && token!=='-') {
      const match=token.match(/^([SrRgGMmPdDnN])([.',]*)(-?)$/);
      if (!match) {get('creator-status').textContent='Check the notation at '+token;return;}
      const octave=[...match[2]].reduce((sum,c)=>sum+(c==="'"?1:-1),0);
      events.push([cursor,cursor+duration,chromatic.indexOf(match[1])+octave*12]);
    }
    cursor+=duration;
  }
  if (!events.length) return;
  songs.push({title:get('custom-title').value,bpm,duration:cursor,notes:events});
  try {localStorage.setItem('studio-songs',JSON.stringify(songs.slice(library.length+1)));} catch {}
  loadSongs(songs.length-1);
  get('creator-status').textContent='Song saved';
};
document.addEventListener('keydown',event=>{
  if (get('mode').value==='flow') return;
  if (event.target.closest('button,input,select,textarea,summary') || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code==='Space') { event.preventDefault(); void play.onclick(); }
  if (event.key==='ArrowLeft'||event.key==='ArrowRight') {event.preventDefault();jump(position+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?10:5));}
  if (event.key.toLowerCase()==='l') get('loop').click();
  if (event.key.toLowerCase()==='m') get('metronome').click();
});
addEventListener('pagehide',()=>{cancelAnimationFrame(animation);pause();if(audio) void audio.close();});
const flow = setupFlow(() => score);
setupImport(item => {
  songs.push(item);
  loadSongs(songs.length-1);
  localStorage.setItem('studio-songs',JSON.stringify(songs.slice(library.length+1)));
});
loadSongs(0);
animation=requestAnimationFrame(draw);
