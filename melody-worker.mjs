import { takeNotes } from './flow.mjs';

const size=2048,rate=12000,hop=180;
const window=Float64Array.from({length:size},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(size-1)));
const offsets=Array.from({length:size},(_,i)=>parseInt(i.toString(2).padStart(11,'0').split('').reverse().join(''),2));
const cos=Float64Array.from({length:size/2},(_,i)=>Math.cos(-2*Math.PI*i/size));
const sin=Float64Array.from(cos,(_,i)=>Math.sin(-2*Math.PI*i/size));
function spectrum(signal,center,re,im,power) {
  for(let i=0;i<size;i++){re[offsets[i]]=(signal[center+i-size/2]||0)*window[i];im[offsets[i]]=0;}
  for(let length=2;length<=size;length*=2){
    const half=length/2;
    for(let base=0;base<size;base+=length)for(let j=0;j<half;j++){
      const a=base+j,b=a+half,k=j*size/length;
      const x=re[b]*cos[k]-im[b]*sin[k],y=re[b]*sin[k]+im[b]*cos[k];
      re[b]=re[a]-x;im[b]=im[a]-y;re[a]+=x;im[a]+=y;
    }
  }
  for(let i=0;i<power.length;i++)power[i]=Math.hypot(re[i],im[i]);
}

export function transcribe(signal,source,progress=()=>{},mixed=true,target="lead") {
  const re=new Float64Array(size),im=new Float64Array(size),power=new Float64Array(size/2);
  const frames=[],hist=new Float64Array(12);
  const bins=Array.from({length:61},(_,i)=>440*2**((i+42-69)/12)*size/rate);
  // Estimate persistent accompaniment per frequency bin from across the recording.
  const floor=new Float64Array(power.length);
  if(mixed){
    const count=Math.min(96,Math.max(1,Math.ceil(signal.length/size)));
    const samples=[];
    for(let i=0;i<count;i++){
      spectrum(signal,Math.floor((i+.5)*signal.length/count),re,im,power);
      samples.push(power.slice());
    }
    for(let k=0;k<floor.length;k++){
      const levels=samples.map(s=>s[k]).sort((a,b)=>a-b);
      floor[k]=levels[Math.floor(count*.3)];
    }
  }
  const path=[];
  let previous=[];

  for(let center=0;center<signal.length;center+=hop){
    spectrum(signal,center,re,im,power);
    const candidates=[];
    let noise=0;
    for(let k=1;k<power.length;k++){
      const magnitude=power[k];
      power[k]=Math.max(.08*magnitude,magnitude-floor[k]*1.25);
      noise+=power[k];
    }
    noise=noise/power.length;
    for(const [i,bin] of bins.entries()){
      let strength=0,fundamental=0,upper=0;
      for(let h=1;h<=5;h++){
        const position=bin*h,k=Math.floor(position);
        if(k+1>=power.length)break;
        const peak=power[k]+(position-k)*(power[k+1]-power[k]);
        if(h===1)fundamental=peak;else upper+=peak;
        strength+=Math.max(0,peak-2.5*noise)/h**1.5;
      }
      // Bass and kick fundamentals compete with the sung/instrumental lead in mixes.
      if(mixed && i+42<52)strength*=.28;
      const midi=i+42;
      if(target==='flute'){
        // A bansuri-like lead typically has a prominent fundamental and sparse overtones.
        const purity=fundamental/(fundamental+upper+.001);
        strength*=Math.max(0,(purity-.32)/.68)**2;
        if(midi<60)strength*=.12;
      }else if(target==='vocal'){
        const richness=upper/(fundamental+.001);
        strength*=Math.min(1,richness/.65)*Math.min(1,fundamental/(noise*4+.001));
        if(midi<45 || midi>81)strength*=.15;
      }
      candidates.push({step:midi,strength});
    }
    candidates.sort((a,b)=>b.strength-a.strength);
    candidates.length=6;
    candidates.push({step:null,strength:Math.max(.45,noise*(target==="lead"?6:18))});
    const peak=Math.max(...candidates.map(c=>c.strength));
    for(const c of candidates){
      let best=previous.length?-Infinity:0, parent=0;
      previous.forEach((p,j)=>{
        const jump=p.step===c.step?0:p.step===null||c.step===null?.65:.65+Math.min(12,Math.abs(p.step-c.step))*.1;
        if(p.score-jump>best){best=p.score-jump;parent=j;}
      });
      c.score=best+Math.log((c.strength+.001)/(peak+.001));c.parent=parent;
    }
    path.push(candidates);previous=candidates;
    if(center%(hop*160)===0)progress(center/signal.length);
  }
  let index=previous.reduce((best,c,i)=>c.score>previous[best].score?i:best,0);
  for(let i=path.length-1;i>=0;i--){
    const chosen=path[i][index];frames[i]=[i*hop/rate,chosen.step??undefined];index=chosen.parent;
  }
  if(target!=='lead'){
    const original=frames.map(f=>f[1]);
    for(let i=2;i<frames.length-2;i++){
      const nearby=original.slice(i-2,i+3).filter(Number.isFinite).sort((a,b)=>a-b);
      if(nearby.length>=4 && original[i]!==undefined)frames[i][1]=nearby[Math.floor(nearby.length/2)];
    }
  }
  const runs=takeNotes(frames);
  if(!runs.length)throw new Error('No sustained melody found.');
  for(const r of runs)hist[r.step%12]+=r.end-r.start;
  // Compare major and minor pitch-class profiles; the user can override the tonic.
  const profiles=[[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],
    [6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17]];
  let pc=Number(source),best=-Infinity;
  if(source==='auto')for(let k=0;k<12;k++)for(const profile of profiles){
    const mean=profile.reduce((a,b)=>a+b)/12;
    const norm=Math.sqrt(profile.reduce((a,b)=>a+(b-mean)**2,0));
    const score=hist.reduce((sum,v,i)=>sum+v*(profile[(i-k+12)%12]-mean)/norm,0);
    if(score>best){best=score;pc=k;}
  }
  const sorted=runs.map(r=>r.step).sort((a,b)=>a-b);
  const tonic=pc+12*Math.floor((sorted[Math.floor(sorted.length/2)]-pc)/12);
  return {pc,duration:signal.length/rate,notes:runs.map(r=>[r.start,Math.min(signal.length/rate,r.end+hop/rate),r.step-tonic])};
}
if(typeof self!=='undefined')self.onmessage=({data})=>{
  try{self.postMessage({item:transcribe(data.signal,data.source,progress=>self.postMessage({progress}),data.mixed,data.target)});}
  catch(error){self.postMessage({error:error.message});}
};
