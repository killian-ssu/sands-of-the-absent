export const SOUND_LEVELS=Object.freeze({master:.38,wind:.3,stepBody:.04,stepSand:.15,muteFade:.065,unmuteFade:.18,startFade:.35});

/** All sounds are synthesized locally. Optional factory/random inputs let
 * offline checks inspect the same scheduling graph without using a browser. */
export function createSound({contextFactory,random=Math.random,document:page=globalThis.document}={}){
 let context,master,wind,sandBuffer,muted=false,lastStep=0,active=false,disposed=false,motionPaused=false;
 let hidden=!!page?.hidden,masterRamp={from:0,to:0,start:0,end:0};
 const voices=new Set(),windNodes=[];const counts={steps:0,cues:0,cancelled:0};
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 function masterAt(time){const f=masterRamp.end>masterRamp.start?clamp((time-masterRamp.start)/(masterRamp.end-masterRamp.start),0,1):1;return masterRamp.from+(masterRamp.to-masterRamp.from)*f;}
 function fadeMaster(value,duration){
  if(!context||!master)return;const t=context.currentTime,from=masterAt(t);
  master.gain.cancelScheduledValues(t);master.gain.setValueAtTime(from,t);master.gain.linearRampToValueAtTime(value,t+duration);
  masterRamp={from,to:value,start:t,end:t+duration};
 }
 function voiceAt(voice,time){
  const age=time-voice.start;if(age<=0)return 0;
  if(age<voice.attack)return voice.peak*age/voice.attack;
  if(age<voice.duration)return voice.peak*Math.pow(.0001/voice.peak,(age-voice.attack)/(voice.duration-voice.attack));
  return .0001*clamp(1-(age-voice.duration)/.008,0,1);
 }
 function cancelVoices(category,fade=.03){
  if(!context)return;const t=context.currentTime;
  for(const voice of voices){
   if(voice.cancelled||(category&&voice.category!==category))continue;
   voice.cancelled=true;counts.cancelled++;
   voice.gain.gain.cancelScheduledValues(t);voice.gain.gain.setValueAtTime(voiceAt(voice,t),t);voice.gain.gain.linearRampToValueAtTime(0,t+fade);
   voice.source.stop(t+fade+.005);
  }
 }
 function schedule(source,{duration,peak,attack=.014,delay=0,category='cue',filters=[],offset=0}){
  const t=context.currentTime+delay,gain=context.createGain(),nodes=[source,...filters,gain],voice={source,gain,nodes,start:t,duration,peak,attack,category,cancelled:false};
  gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(peak,t+attack);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);gain.gain.linearRampToValueAtTime(0,t+duration+.008);
  for(let i=0;i<nodes.length-1;i++)nodes[i].connect(nodes[i+1]);gain.connect(master);voices.add(voice);
  source.onended=()=>{voices.delete(voice);for(const node of nodes)node.disconnect();};
  if(source.buffer)source.start(t,offset);else source.start(t);source.stop(t+duration+.012);return voice;
 }
 function tone(frequency,duration=.25,peak=.05,type='sine',delay=0,category='cue'){
  if(!context||muted||hidden||disposed)return;
  const source=context.createOscillator();source.type=type;source.frequency.setValueAtTime(frequency,context.currentTime+delay);
  return schedule(source,{duration,peak,delay,category,attack:category==='step'?.006:.014});
 }
 async function start(){
  if(disposed)return false;
  if(!context){
   const AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext;
   if(!contextFactory&&!AudioContext)throw new Error('Web Audio is unavailable.');
   context=contextFactory?contextFactory():new AudioContext();master=context.createGain();master.gain.value=0;master.connect(context.destination);
   // Repeating the stable one-pole solve makes the loop seam statistically
   // identical to an ordinary neighbouring sample transition.
   const size=Math.ceil(context.sampleRate*12),buffer=context.createBuffer(1,size,context.sampleRate),data=buffer.getChannelData(0),white=new Float32Array(size);let prior=0;
   for(let i=0;i<size;i++){white[i]=random()*2-1;prior=(prior+white[i]*.025)/1.025;}
   for(let i=0;i<size;i++){prior=(prior+white[i]*.025)/1.025;data[i]=prior;}
   wind=context.createBufferSource();wind.buffer=buffer;wind.loop=true;
   const highpass=context.createBiquadFilter();highpass.type='highpass';highpass.frequency.value=40;highpass.Q.value=-3.0103;
   const lowpass=context.createBiquadFilter();lowpass.type='lowpass';lowpass.frequency.value=520;lowpass.Q.value=-3.0103;
   const gain=context.createGain();gain.gain.value=SOUND_LEVELS.wind;wind.connect(highpass);highpass.connect(lowpass);lowpass.connect(gain);gain.connect(master);windNodes.push(wind,highpass,lowpass,gain);wind.start();
   sandBuffer=context.createBuffer(1,Math.ceil(context.sampleRate*.3),context.sampleRate);const sand=sandBuffer.getChannelData(0);for(let i=0;i<sand.length;i++)sand[i]=random()*2-1;
   fadeMaster(muted||hidden?0:SOUND_LEVELS.master,SOUND_LEVELS.startFade);
  }
  if(context.resume)await context.resume();if(disposed)return false;active=true;return true;
 }
 function cue(type){
  if(!active||muted||hidden||disposed||context?.state!=='running')return;let score;
  if(type==='mirror-rotated')score=[[190,.2,.11,'triangle',0],[740,.3,.02,'sine',.05]];
  else if(type==='area-completed')score=[196,293.66,392,587.33].map((f,i)=>[f,1.7,.10,'sine',i*.15]);
  else if(type==='game-completed'){
   // The final area fires both events in one frame: keep one ending phrase.
   cancelVoices('area-completed');score=[196,246.94,293.66,392,493.88].map((f,i)=>[f,3,.07,'sine',i*.25]);
  }else if(type==='lamp-docked')score=[[220,.28,.13,'triangle',0],[880,.8,.03,'sine',.1]];
  else if(type==='lamp-picked-up')score=[[440,.4,.07,'sine',0],[660,.4,.035,'sine',.07]];
  if(!score)return;counts.cues++;for(const [frequency,duration,gain,wave,delay]of score)tone(frequency,duration,gain,wave,delay,type);
 }
 function update(elapsed,player,{paused=player?.paused,interactionBusy=false}={}){
  if(!Number.isFinite(elapsed))return;
  const stopped=!!paused||!!player?.paused||interactionBusy||hidden;
  if(stopped&&!motionPaused)cancelVoices('step',.02);motionPaused=stopped;
  if(!active||muted||disposed||stopped||!player?.grounded||!Number.isFinite(player.speed)||player.speed<.4||context?.state!=='running'){lastStep=elapsed;return;}
  // Controller speed is actual travel, so slow wall sliding also slows cadence.
  const run=player.locomotion==='run',interval=clamp((run?.29*6.6:.48*3.4)/player.speed,.23,1.8);
  if(elapsed<lastStep){lastStep=elapsed;return;}if(elapsed-lastStep<interval)return;lastStep=elapsed;counts.steps++;
  const intensity=run?1.16:1;
  tone(72+random()*22,.065,SOUND_LEVELS.stepBody*intensity,'sine',0,'step');
  const source=context.createBufferSource();source.buffer=sandBuffer;
  const filter=context.createBiquadFilter();filter.type='bandpass';filter.frequency.value=850+random()*400;filter.Q.value=.65;
  schedule(source,{duration:.095,peak:SOUND_LEVELS.stepSand*intensity,attack:.006,category:'step',filters:[filter],offset:random()*.16});
 }
 function setMuted(value){
  const next=!!value;if(next===muted)return muted;muted=next;
  if(muted)cancelVoices(null,.03);
  fadeMaster(muted||hidden?0:SOUND_LEVELS.master,muted?SOUND_LEVELS.muteFade:SOUND_LEVELS.unmuteFade);return muted;
 }
 function onVisibility(){hidden=!!page?.hidden;if(hidden)cancelVoices(null,.03);fadeMaster(muted||hidden?0:SOUND_LEVELS.master,hidden?SOUND_LEVELS.muteFade:SOUND_LEVELS.unmuteFade);}
 page?.addEventListener?.('visibilitychange',onVisibility);
 async function dispose(){
  if(disposed)return;disposed=true;active=false;page?.removeEventListener?.('visibilitychange',onVisibility);
  for(const voice of voices){try{voice.source.stop();}catch{}for(const node of voice.nodes)node.disconnect();}voices.clear();
  if(wind){try{wind.stop();}catch{}}for(const node of windNodes)node.disconnect();master?.disconnect();await context?.close?.();
 }
 async function connectRecording(){
  if(!await start())throw new Error('游戏声音尚未启动。');
  const destination=context.createMediaStreamDestination();master.connect(destination);let released=false;
  return{stream:destination.stream,dispose(){if(released)return;released=true;try{master.disconnect(destination);}catch{}for(const track of destination.stream.getTracks())track.stop();}};
 }
 return{start,cue,update,setMuted,dispose,connectRecording,get muted(){return muted;},snapshot:()=>({active,muted,hidden,motionPaused,contextState:context?.state??'unstarted',voices:voices.size,
  masterGain:context?masterAt(context.currentTime):0,masterTarget:masterRamp.to,...counts})};
}
