/** Local, continuous canvas recording. No microphone, display capture, frame
 * synthesis, external services or game control. HTML HUD is outside the canvas.
 * start/stop must be called by QA buttons; never reload before stop resolves. */
export function createGameRecorder(canvas,{
 getAudioTap=null,getState=()=>null,onStatus=()=>{},frameRate=30,
 videoBitsPerSecond=6_000_000,maxSeconds=1800,sampleSeconds=5,
}={}){
 const Recorder=globalThis.MediaRecorder;
 let phase='idle',recorder=null,stream=null,audioTap=null,id=null,chain=Promise.resolve(),stopPromise=null,resolveStop=null;
 let chunks=0,uploaded=0,bytes=0,pendingBytes=0,started=0,timer=null,disposed=false,lastResult=null,failure=null,stopping=false;
 let timeline=[],startState=null,lastSecond=-1,timelineBytes=0,timelineTruncated=false;
 const status=()=>({phase,seconds:started?(performance.now()-started)/1000:0,chunks,uploadedChunks:uploaded,bytes,pendingBytes,audio:!!audioTap,mimeType:recorder?.mimeType||null,error:failure?.message||null,lastResult});
 const notify=()=>{try{onStatus(status());}catch{}};
 const copy=value=>JSON.parse(JSON.stringify(value??null));
 const state=()=>{try{return copy(getState());}catch(error){return{stateError:error.message};}};
 const mark=(label,detail=null)=>{
  if(phase!=='recording'&&phase!=='stopping')return;
  const entry={seconds:(performance.now()-started)/1000,label:String(label).slice(0,100),detail:copy(detail)},size=JSON.stringify(entry).length*3;
  const limit=label==='state'?1_200_000:1_500_000;
  if(timelineBytes+size>limit){timelineTruncated=true;return;}timelineBytes+=size;timeline.push(entry);
 };
 async function post(action,{data,sequence}={}){
  const query=id?'?id='+encodeURIComponent(id)+(sequence===undefined?'':'&sequence='+sequence):'';
  const response=await fetch('/__recording/'+action+query,{method:'POST',body:data,credentials:'same-origin'});
  const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||`Local video save failed (${response.status})`);return result;
 }
 function cleanup(){
  clearInterval(timer);timer=null;
  // Only our canvas tracks belong to this module. Audio tap lifetime belongs
  // to its release method; never stop the game's original audio tracks.
  for(const track of stream?.getVideoTracks?.()||[])track.stop();
  try{audioTap?.dispose?.();}catch{}audioTap=null;stream=null;
 }
 async function finish(){
  if(stopping)return;stopping=true;phase='stopping';clearInterval(timer);notify();
  const duration=(performance.now()-started)/1000;await chain;
  let result;
  try{result=await post('finish',{data:JSON.stringify({complete:!failure,uploadedChunks:uploaded,durationSeconds:duration,frameRate,videoBitsPerSecond,canvas:{width:canvas.width,height:canvas.height},hasAudio:!!audioTap,startState,endState:state(),timeline,timelineTruncated,errors:failure?[failure.message]:[],continuous:true,htmlHUD:false})});}
  catch(error){failure??=error;await post('cancel').catch(()=>{});result={ok:false,complete:false,error:failure.message};}
  cleanup();lastResult=result;phase=failure?'error':'saved';notify();resolveStop?.(result);resolveStop=null;
 }
 function stop(){
  if(phase==='stopping')return stopPromise;
  if(phase!=='recording')return Promise.resolve(lastResult);
  mark('recording-stop');phase='stopping';notify();
  if(recorder.state!=='inactive')recorder.stop();else void finish();return stopPromise;
 }
 async function start({label='gameplay'}={}){
  if(disposed)throw Error('Recorder has been disposed');
  if(['starting','recording','stopping'].includes(phase))throw Error('A recording is already active');
  if(!canvas?.captureStream||!Recorder)throw Error('This browser cannot record canvas video');
  phase='starting';failure=null;lastResult=null;chunks=uploaded=bytes=pendingBytes=0;timeline=[];timelineBytes=0;timelineTruncated=false;chain=Promise.resolve();stopping=false;id=null;notify();
  try{
   if(getAudioTap)audioTap=await getAudioTap();if(disposed)throw Error('Recorder has been disposed');
   const mimeType=['video/webm;codecs=vp8,opus','video/webm;codecs=vp8','video/webm','video/mp4'].find(type=>Recorder.isTypeSupported(type));
   if(!mimeType)throw Error('No supported local video container');
   stream=canvas.captureStream(Math.max(1,Math.min(60,frameRate)));
   for(const track of audioTap?.stream?.getAudioTracks?.()||[])stream.addTrack(track);
   recorder=new Recorder(stream,{mimeType,videoBitsPerSecond,audioBitsPerSecond:128000});
   const session=await post('start',{data:JSON.stringify({label,mimeType:recorder.mimeType||mimeType,frameRate,canvas:{width:canvas.width,height:canvas.height},audio:!!audioTap})});id=session.id;if(disposed)throw Error('Recorder has been disposed');
   stopPromise=new Promise(resolve=>{resolveStop=resolve;});
   recorder.ondataavailable=event=>{
    if(!event.data?.size)return;const blob=event.data,sequence=chunks++;bytes+=blob.size;pendingBytes+=blob.size;
    chain=chain.then(async()=>{
     try{
      if(failure)return;
      // One retry is safe: the server deduplicates the last sequence by hash.
      try{await post('chunk',{data:blob,sequence});}catch{await post('chunk',{data:blob,sequence});}
      uploaded++;
     }catch(error){failure??=error;queueMicrotask(()=>{void stop();});}
     finally{pendingBytes-=blob.size;notify();}
    });
    if(pendingBytes>64*1024*1024&&!failure){failure=Error('Local save is too slow; recording stopped to bound memory');void stop();}
   };
   recorder.onerror=event=>{failure??=event.error||Error('MediaRecorder failed');void stop();};
   recorder.onstop=()=>{void finish();};
   started=performance.now();startState=state();lastSecond=-1;recorder.start(1000);phase='recording';mark('recording-start');
   timer=setInterval(()=>{
    const second=Math.floor((performance.now()-started)/1000);
    if(second!==lastSecond){lastSecond=second;if(second%Math.max(1,Math.floor(sampleSeconds))===0)mark('state',state());notify();}
    if(second>=maxSeconds){mark('duration-limit');void stop();}
   },1000);notify();return status();
  }catch(error){failure=error;cleanup();if(id)await post('cancel').catch(()=>{});phase='error';notify();throw error;}
 }
 async function dispose(){if(disposed)return;disposed=true;if(phase==='recording'||phase==='stopping')await stop();cleanup();}
 return{start,stop,mark,snapshot:status,dispose};
}
