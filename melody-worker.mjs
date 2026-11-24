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

export function transcribe(signal,source,progress=()=>{}) {
  const re=new Float64Array(size),im=new Float64Array(size),power=new Float64Array(size/2);
  const frames=[],hist=new Float64Array(12);
  const bins=Array.from({length:61},(_,i)=>440*2**((i+42-69)/12)*size/rate);
  let prev;
  for(let center=0;center<signal.length;center+=hop){
    spectrum(signal,center,re,im,power);
    let best=-Infinity,step;
    bins.forEach((bin,i)=>{
      const midi=i+42;
      let salience=0;
      for(let h=1;h<=4;h++){
        const k=Math.round(bin*h);
        if(k+1>=power.length)break;
        const fraction=bin*h-k;
        const peak=power[k]*(1-Math.abs(fraction))+power[k+Math.sign(fraction)]*Math.abs(fraction);
        salience+=peak/(h*h);
      }
      if(prev===midi)salience*=1.035;
      if(salience>best){best=salience;step=midi;}
    });
    prev=best>.65?step:undefined;
    frames.push([center/rate,prev]);
    if(center%(hop*160)===0)progress(center/signal.length);
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
  try{self.postMessage({item:transcribe(data.signal,data.source,progress=>self.postMessage({progress}))});}
  catch(error){self.postMessage({error:error.message});}
};
