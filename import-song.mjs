export function setupImport(addSong) {
  const get=id=>document.getElementById(id);
  const source=get('source-sa'),status=get('import-status');
  const keys='C C♯ D D♯ E F F♯ G G♯ A A♯ B'.split(' ');
  keys.forEach((k,i)=>source.add(new Option(k,i)));
  get('import-form').onsubmit=async event=>{
    event.preventDefault();
    const file=get('music-file').files[0];if(!file)return;
    get('convert').disabled=true;
    let context,worker;
    try {
      status.textContent='Decoding recording…';
      context=new AudioContext();
      const decoded=await context.decodeAudioData(await file.arrayBuffer());
      await context.close();context=undefined;
      const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*12000),12000);
      const player=offline.createBufferSource();player.buffer=decoded;player.connect(offline.destination);player.start();
      const buffer=await offline.startRendering();
      const signal=buffer.getChannelData(0).slice();
      worker=new Worker('./melody-worker.mjs',{type:'module'});
      const item=await new Promise((resolve,reject)=>{
        worker.onmessage=({data})=>{
          if(data.error)reject(new Error(data.error));
          else if(data.item)resolve(data.item);
          else status.textContent='Extracting melody · '+Math.round(data.progress*100)+'%';
        };
        worker.onerror=()=>reject(new Error('Transcription worker unavailable.'));
        worker.postMessage({signal,source:source.value},[signal.buffer]);
      });
      const title=file.name.replace(/\.[^.]+$/,'');
      addSong({title,notes:item.notes,duration:item.duration,info:{'Source Sa':keys[item.pc],Transcription:'Estimated lead melody'}});
      status.textContent=item.notes.length+' notes · source Sa '+keys[item.pc]+'. Selected for practice. If the swaras sound shifted, choose the recording’s Sa and transcribe again.';
    }catch(error){status.textContent=error.message;}
    finally{worker?.terminate();if(context)await context.close();get('convert').disabled=false;}
  };
}
