import { notes } from './pitch.mjs';
export function alignNotes(target, played) {
  // Unit-cost insert, delete and substitute. Backtrack to show where the paths differ.
  const width = played.length+1;
  const trace = Array.from({length:target.length},()=>new Uint8Array(width));
  let row = Int32Array.from({length:width},(_,j)=>j);
  let next = new Int32Array(width);
  for (let i=1;i<=target.length;i++) {
    next[0]=i;
    for (let j=1;j<width;j++) {
      const pair=row[j-1]+Number(target[i-1]!==played[j-1]);
      const omit=row[j]+1, extra=next[j-1]+1;
      next[j]=Math.min(pair,omit,extra);
      trace[i-1][j]=pair===next[j]?0:omit===next[j]?1:2;
    }
    [row,next]=[next,row];
  }
  const columns=[];
  let i=target.length,j=played.length;
  while (i || j) {
    const move=!i?2:!j?1:trace[i-1][j];
    columns.push([move===2?null:target[--i],move===1?null:played[--j]]);
  }
  return {columns:columns.reverse(),accuracy:Math.round(100*(1-row[played.length]/Math.max(1,target.length,played.length)))};
}

export function takeNotes(frames) {
  const runs=[];
  for (const [time,pitch] of frames) {
    const step=Number.isFinite(pitch)?Math.round(pitch):null;
    const last=runs.at(-1);
    if (last && last.step===step && time-last.end<.07) last.end=time;
    else runs.push({start:time,end:time,step});
  }
  const notes=[];
  for (const run of runs) {
    if (run.step===null || run.end-run.start<.045) continue;
    const last=notes.at(-1);
    if (last && last.step===run.step && run.start-last.end<.065) last.end=run.end;
    else notes.push(run);
  }
  return notes;
}

export function setupFlow(score,source,krishna) {
  const get=id=>document.getElementById(id);
  const panel=get('flow'), cut=get('flow-cut'), result=get('flow-result');
  const canvas=get('flow-chart');
  const takeCanvas=get('take-chart');
  function showCut() {
    const ctx=takeCanvas.getContext('2d');
    takeCanvas.width=Math.max(320,takeCanvas.clientWidth);takeCanvas.height=100;
    const voiced=frames.filter(f=>Number.isFinite(f[1]));
    const low=voiced.reduce((v,f)=>Math.min(v,f[1]),0)-1;
    const high=voiced.reduce((v,f)=>Math.max(v,f[1]),12)+1;
    const x=t=>takeCanvas.width*t/(duration||1);
    ctx.fillStyle="#86baff";
    for (const [t,p] of voiced) ctx.fillRect(x(t),95*(high-p)/(high-low),2,2);
    ctx.fillStyle="#27324c99";ctx.fillRect(x(+cut.value),0,takeCanvas.width,100);
    ctx.fillStyle="#ffffff";ctx.fillRect(Math.min(takeCanvas.width-2,x(+cut.value)),0,2,100);
  }
  let frames=[],start,offset=0,duration=0;
  const overlay=get('overlay'), reference=new Image();
  let spectra=[];
  const layer=document.createElement('canvas');layer.height=84;layer.width=1200;
  const ink=layer.getContext('2d');
  function plotColumn(t,rows){
    const x=Math.round(t*20);
    if(x>=layer.width){
      const copy=document.createElement('canvas');copy.width=layer.width;copy.height=84;
      copy.getContext('2d').drawImage(layer,0,0);layer.width=x+1200;ink.drawImage(copy,0,0);
    }
    const col=ink.createImageData(1,84);
    rows.forEach((v,i)=>col.data.set([45,238,155,255*(Math.max(0,v-75)/180)**2],4*i));
    ink.putImageData(col,x,0);
  }
  const hint=get('pitch-hint');
  function describePitch(step){
    const rounded=Math.round(step);
    return notes[(rounded%12+12)%12]+' ('+['mandra','madhya','taar'][Math.max(0,Math.min(2,1+Math.floor(rounded/12)))]+')';
  }
  function inspect(event){
    if(start!==undefined || !duration)return;
    const rect=overlay.getBoundingClientRect();
    const shift=Number(get('align-offset').value)||0;
    const scale=Math.max(.1,Number(get('align-scale').value)||1);
    const span=Math.max(score().duration,(spectra.at(-1)?.[0]||0)*scale+shift);
    const time=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width))*span;
    const sourceTime=(time-shift)/scale;
    const target=score().notes.find(([a,b])=>a<=time && time<b);
    const nearby=frames.filter(([t,p])=>Math.abs(t-sourceTime)<.05 && Number.isFinite(p)).map(f=>f[1]).sort((a,b)=>a-b);
    const pitch=nearby[Math.floor(nearby.length/2)];
    const delta=target && Number.isFinite(pitch)?Math.round(100*(pitch-target[2])):undefined;
    const advice=delta===undefined?'':Math.abs(delta)<=35?' · In tune':' · Go '+(delta>0?'lower':'higher')+' by '+Math.abs(delta)+' cents';
    hint.textContent=time.toFixed(2)+' s · Target '+(target?describePitch(target[2]):'rest')+' · Heard '+(Number.isFinite(pitch)?describePitch(pitch):'no stable pitch')+advice;
  }
  overlay.onpointermove=overlay.onpointerdown=inspect;
  function repaint(){
    if(panel.hidden || !score())return;
    const w=overlay.width=Math.max(400,overlay.clientWidth), h=overlay.height=252;
    const ctx=overlay.getContext('2d'), song=score();
    const shift=Number(get('align-offset').value)||0;
    const stretch=Math.max(.1,Number(get('align-scale').value)||1);
    const span=Math.max(song.duration,(spectra.at(-1)?.[0]||0)*stretch+shift);
    const px=w/span;
    if(source()===krishna && reference.naturalWidth){
      // Shift each section of the source spectrum to its arranged register.
      let from=0,delta=song.notes[0][2]-krishna.notes[0][2];
      function strip(end){
        if(end>from)ctx.drawImage(reference,from*20,0,(end-from)*20,84,from*px,-delta*h/84,(end-from)*px,h);
        from=end;
      }
      song.notes.forEach(([a,b,k],i)=>{const d=k-krishna.notes[i][2];if(d!==delta){strip(a);delta=d;}});
      strip(song.duration);
    }else{
      ctx.fillStyle='#559bff';
      for(const [a,b,k] of song.notes)ctx.fillRect(a*px,(59-k)*h/84,(b-a)*px,3);
    }
    ctx.globalCompositeOperation='lighter';
    ctx.drawImage(layer,shift*px,0,layer.width*.05*stretch*px,h);
    ctx.globalCompositeOperation='source-over';
  }
  reference.onload=repaint;reference.src='/reference-spectrum.png';
  get('align-offset').oninput=get('align-scale').oninput=repaint;
  document.addEventListener('spectrum-frame',({detail})=>{
    if(start===undefined)return;
    const t=offset+(performance.now()-start)/1000; spectra.push([t,detail]);plotColumn(t,detail);repaint();
  });
  function reset() {
    hint.textContent="";spectra=[];ink.clearRect(0,0,layer.width,84);repaint();
    start=undefined;frames=[];duration=offset=0;
    cut.value=cut.max=0;get('cut-time').textContent='0.0 s';
    get('flow-start').disabled=false;get('flow-finish').disabled=get('flow-retry').disabled=true;
    result.textContent='';showCut();
    canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
  }
  function begin(replace) {
    if (get('mic').textContent!=='Stop microphone') {result.textContent='Start the microphone below first.';return;}
    offset=replace?Number(cut.value):0;
    frames=replace?frames.filter(([t])=>t<offset):[];
    spectra=replace?spectra.filter(([t])=>t<offset):[];
    ink.clearRect(Math.round(offset*20),0,layer.width,84);
    start=performance.now();
    get('flow-start').disabled=get('flow-retry').disabled=true;
    get('flow-finish').disabled=false;
    result.textContent='Listening. Finish when you reach the end.';
  }
  function finish() {
    if(start===undefined)return;
    hint.textContent='Hover or tap the spectrum to check your pitch.';
    duration=offset+(performance.now()-start)/1000;start=undefined;
    cut.max=cut.value=duration;cut.oninput();
    get('flow-start').disabled=get('flow-retry').disabled=false;
    get('flow-finish').disabled=true;
    const expected=score().notes.map(n=>n[2]);
    const played=takeNotes(frames).map(n=>n.step);
    const {accuracy,columns}=alignNotes(expected,played);
    const missing=columns.filter(c=>c[1]===null).length;
    const extra=columns.filter(c=>c[0]===null).length;
    const wrong=columns.filter(([a,b])=>a!==null&&b!==null&&a!==b).length;
    result.textContent=accuracy+'% note sequence accuracy · '+missing+' missed · '+extra+' extra · '+wrong+' changed. Blue: target. Mint: played.';
    const scale=devicePixelRatio||1;
    canvas.width=Math.max(300,Math.round(canvas.clientWidth*scale));canvas.height=Math.round(160*scale);
    const ctx=canvas.getContext('2d');
    const pitches=expected.concat(played);
    const lo=pitches.reduce((a,b)=>Math.min(a,b),0)-1, hi=pitches.reduce((a,b)=>Math.max(a,b),12)+1;
    const dx=canvas.width/columns.length;
    columns.forEach((pair,i)=>pair.forEach((p,side)=>{
      if(p===null)return;
      ctx.fillStyle=side?'#79efbc':'#86baff';
      ctx.fillRect(i*dx,(hi-p)/(hi-lo)*canvas.height+(side?2:-2)*scale,Math.max(1,dx),2*scale);
    }));
  }
  document.addEventListener('pitch-frame',({detail})=>{
    if(start!==undefined && detail.at>=start) frames.push([offset+(detail.at-start)/1000,detail.position]);
  });
  document.addEventListener('mic-stopped',finish);
  get('flow-start').onclick=()=>begin(false);
  get('flow-retry').onclick=()=>begin(true);
  get('flow-finish').onclick=finish;
  cut.oninput=()=>{get('cut-time').textContent=Number(cut.value).toFixed(1)+' s';showCut();};
  return {reset,repaint,modeChanged(){
    finish();panel.hidden=get('mode').value!=='flow';repaint();
  }};
}
