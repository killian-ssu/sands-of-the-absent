import * as T from 'three';
// Film camera rails through the shipping game scene. Actions use the original
// lantern rules; presets and cuts are deliberately separate from player saves.
export const TRAILER_SHOTS=[
 {id:'01-arrival',name:'沙海 · 遗城全貌',seconds:6,p:[[6,7.3,91],[3,8.2,77]],t:[[-8,23,-75],[-8,25,-88]],fov:52,progress:0,actor:[-37,0,35],hide:true},
 {id:'02-lantern',name:'旅人 · 拾起提灯',seconds:5,p:[[-33.8,1.7,33.1],[-34.5,1.8,32.3]],t:[[-37,1.0,29.8],[-37,1.0,29.8]],fov:43,progress:0,actor:[-37,0,30.3],events:[[1.2,'lantern']]},
 {id:'03-temple',name:'风蚀神庙 · 抵达',seconds:5,p:[[-29,5.6,39],[-31,6.8,33]],t:[[-37,12,-1],[-37,12,-1]],fov:53,progress:0,carry:true,actor:[-37,0,31],walk:true},
 {id:'04-unseal',name:'神庙 · 光与石门',seconds:6,p:[[-43,4.8,26],[-41,5.3,23]],t:[[-37,7.3,11],[-37,7.7,10]],fov:53,progress:0,carry:true,actor:[-37,0,20.75],events:[[.8,'temple-socket']]},
 {id:'05-sanctuary',name:'内殿 · 砂岩与天光',seconds:5,p:[[-49,4.6,3],[-44.5,5.3,2]],t:[[-37,8.8,-8],[-36,8.5,-9]],fov:51,progress:1,actor:[-37,0,30.3],hide:true},
 {id:'06-altar',name:'祭坛 · 黑曜镜盘',seconds:3.5,p:[[-39.5,7.6,-3],[-38.1,7.2,-3.9]],t:[[-37,5.85,-7.75],[-37,5.85,-7.75]],fov:42,progress:1,actor:[-37,0,30.3],hide:true},
 {id:'07-city-road',name:'旧城 · 携灯前行',seconds:5,p:[[13,4,-26],[13,4,-42]],t:[[18,2.8,-42],[18,3,-58]],fov:48,progress:1,actor:[18,0,-38],walk:true},
 {id:'08-city-mirror',name:'旧城 · 转动光镜',seconds:4.5,p:[[12.2,11.8,-76.7],[13,12.4,-78.3]],t:[[18.6,11.2,-85],[18.6,11.8,-87]],fov:50,progress:1,socket:'city-socket-high',actor:[19.65,0,-83.3],heading:1.2,events:[[1,'city-mirror']]},
 {id:'09-ascent',name:'高台 · 向巨碑仰望',seconds:5,p:[[22,16,-84],[22,21,-91]],t:[[30,68,-118],[30,80,-118]],fov:58,progress:2,actor:[-37,0,30.3],hide:true},
 {id:'10-monument',name:'巨碑 · 城市天际线',seconds:5,p:[[121,65,-29],[109,72,-25]],t:[[28,66,-116],[28,66,-116]],fov:56,progress:2,actor:[-37,0,30.3],hide:true},
 {id:'11-oasis',name:'绿洲 · 水与棕榈',seconds:5,p:[[21,3.5,38],[26,3.1,32]],t:[[46,4,-2],[48,4,-6]],fov:52,progress:2,actor:[25,0,31],hide:true},
 {id:'12-water',name:'倒影 · 风穿过水面',seconds:4,p:[[37,.85,26],[41,1.1,20]],t:[[45,5,-25],[45,5,-28]],fov:50,progress:2,actor:[25,0,31],hide:true},
 {id:'13-west-mirror',name:'绿洲 · 连起光路',seconds:4,p:[[26,3.7,21],[27.6,3.4,19.2]],t:[[22,2,15],[24,2,14]],fov:49,progress:2,socket:'oasis-socket',westTurns:1,actor:[23,0,16.75],heading:2.0,events:[[1,'oasis-mirror-west']]},
 {id:'14-awaken',name:'绿洲 · 最后的光',seconds:5,p:[[67,4.3,38],[66.3,4.7,37]],t:[[62,3,22],[59,4,15]],fov:56,progress:2,socket:'oasis-socket',westTurns:2,actor:[64.5,0,29.75],heading:.35,events:[[1,'oasis-mirror-east']]},
 {id:'15-finale',name:'沙海苏醒 · 全景',seconds:7,p:[[94,33,90],[83,40,79]],t:[[3,28,-54],[1,31,-60]],fov:53,progress:3,actor:[25,0,31],hide:true},
];
export function createTrailerDirector(ctx){
 const {canvas,camera,renderer,composer,world,player,avatar,npc,cape,game,gameVisuals,awakenings,guidance,templeAtmosphere,atmosphere,sun,errors}=ctx;
 const data=game.data,position=new T.Vector3(),target=new T.Vector3(),sunDirection=new T.Vector3().subVectors(sun.position,sun.target.position);
 let busy=false,cancelled=false,current=TRAILER_SHOTS[0],shotTime=0,eventsDone=new Set(),manifest=[];
 const panel=document.createElement('section');panel.id='trailer-director';panel.setAttribute('aria-label','宣传片镜头台');
 panel.innerHTML='<span>宣传片 · 1080p / 30fps</span><select aria-label="拍摄镜头"></select><button data-action="preview">预览镜头</button><button data-action="oneproof">输出此镜头校样</button><button data-action="proof">输出全部分镜校样</button><button data-action="capture">导出此镜头</button><button data-action="all">导出所有镜头</button><button data-action="cancel">停止导出</button><output aria-live="polite">准备中</output>';
 document.body.append(panel);const select=panel.querySelector('select'),out=panel.querySelector('output');
 for(const shot of TRAILER_SHOTS){const option=document.createElement('option');option.value=shot.id;option.textContent=shot.name;select.append(option);}
 const status=text=>{out.textContent=text;};
 async function post(action,{id,frame,data:body}={}){const query=id?'?id='+encodeURIComponent(id)+(frame===undefined?'':'&frame='+frame):'';const response=await fetch('/__cinema/'+action+query,{method:'POST',body});const result=await response.json();if(!result.ok)throw Error(result.error);return result;}
 const find=id=>[data.lamp,...data.areas.flatMap(a=>[...a.sockets,...a.mirrors])].find(o=>o.id===id);
 function setupInteraction(id){const item=find(id);game.update(0,item.position);const result=game.interact(id);if(!result.ok)throw Error(id+': '+result.reason);}
 function prepare(shot){
  current=shot;shotTime=0;eventsDone=new Set();game.reset();
  // Let the old frame's gates and material feedback return to their initial
  // state before staging a new cut. This does not touch localStorage.
  for(let i=0;i<45;i++){gameVisuals.update(.1,0,{player,handAnchor:avatar.handAnchor});awakenings.update(.1,0);templeAtmosphere.update(.1,0);}
  if(shot.progress||shot.carry||shot.socket){setupInteraction('lantern');}
  for(let i=0;i<shot.progress;i++){
   const area=data.areas[i],socket=area.sockets.at(-1);setupInteraction(socket.id);
   for(const mirror of area.mirrors){const turns=mirror.id==='oasis-mirror-west'?2:1;for(let k=0;k<turns;k++)setupInteraction(mirror.id);}
   for(let k=0;k<10;k++)game.update(.25);
   if(!game.state.completed.includes(area.id))throw Error('Staging did not solve '+area.id);
   setupInteraction(socket.id);
  }
  if(shot.socket)setupInteraction(shot.socket);
  for(let i=0;i<(shot.westTurns||0);i++)setupInteraction('oasis-mirror-west');
  for(let i=0;i<65;i++){gameVisuals.update(.1,0,{player,handAnchor:avatar.handAnchor});awakenings.update(.1,0);templeAtmosphere.update(.1,0);}
  player.teleport(shot.actor,shot.heading||0);game.update(0,player.position);
  avatar.root.visible=!shot.hide;npc.root.visible=shot.id==='02-lantern'||shot.id==='03-temple';
  for(let i=0;i<30;i++)avatar.update(1/30,{...player.snapshot(),position:player.position,paused:false,carryingLamp:game.state.lamp.location==='player'});
  camera.fov=shot.fov;camera.updateProjectionMatrix();
  render(0,0,false);
 }
 function render(dt,time,move=true){
  shotTime=time;const u=T.MathUtils.clamp(time/current.seconds,0,1);
  // Near-constant gentle motion; no follow-camera spring, obstacle snap,
  // waypoint pauses, digital zoom or perspective jump within a shot.
  const q=u*.72+(u*u*(3-2*u))*.28;
  camera.position.lerpVectors(position.fromArray(current.p[0]),target.fromArray(current.p[1]),q);
  target.lerpVectors(position.fromArray(current.t[0]),target.fromArray(current.t[1]),q);camera.lookAt(target);
  if(move&&current.walk)player.update(dt,{forward:1,run:false,cameraYaw:0});
  game.update(dt,player.position);
  for(const [at,id]of current.events||[]){if(time>=at&&!eventsDone.has(id)){game.update(0,player.position);const result=game.interact(id);if(!result.ok)throw Error('Filmed interaction '+id+': '+result.reason);eventsDone.add(id);void avatar.playInteraction();}}
  const t=60+time;
  avatar.update(dt,{...player.snapshot(),position:player.position,paused:false,carryingLamp:game.state.lamp.location==='player'});
  cape?.update(dt,t,{paused:false,speed:player.speed});
  npc.update(dt,{position:new T.Vector3(...data.npc.position),heading:.7,locomotion:'idle',grounded:true,speed:0,paused:false});
  gameVisuals.update(dt,t,{player,handAnchor:avatar.handAnchor});gameVisuals.lantern.visible=!(current.hide&&game.state.lamp.location==='player');awakenings.update(dt,t);templeAtmosphere.update(dt,t);guidance.update(t);
  world.update(t,camera,1080,{windPaused:false});world.canopyOcclusion?.setEnabled(false);
  atmosphere?.update({playerPosition:player.position,sunDirection});renderer.info.reset();composer.render();
 }
 async function saveProof(label){const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const response=await fetch('/__capture?name=trailer-'+label,{method:'POST',body:png});if(!response.ok)throw Error('Proof save failed');}
 async function proof(shots=TRAILER_SHOTS){
  for(const shot of shots){if(cancelled)break;prepare(shot);
   for(const fraction of [0,.5,.999]){const targetTime=shot.seconds*fraction;while(shotTime+1/30<targetTime)render(1/30,shotTime+1/30);render(Math.max(0,targetTime-shotTime),targetTime);await saveProof(shot.id+'-'+Math.round(fraction*2));status('校样已保存：'+shot.name+' '+Math.round(fraction*100)+'%');await new Promise(resolve=>setTimeout(resolve,0));}
  }
 }
 async function exportShot(shot){
  prepare(shot);const frames=Math.round(shot.seconds*30);
  const session=await post('start',{data:JSON.stringify({label:shot.id,width:1920,height:1080,fps:30,frames,shot,staged:true,noSave:true})});
  try{
   for(let frame=0;frame<frames;frame++){
    if(cancelled)throw Error('已停止');
    render(frame===0?0:1/30,frame/30);
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    await post('frame',{id:session.id,frame,data:png});
    if(frame%15===0)status(shot.name+' · '+Math.round(100*frame/frames)+'% · 逐帧导出，无丢帧');
   }
   const result=await post('finish',{id:session.id});manifest.push({...result,shot:shot.id,errors:[...errors]});status('镜头已保存：'+shot.name);return result;
  }catch(error){await post('cancel',{id:session.id}).catch(()=>{});throw error;}
 }
 async function run(fn){if(busy)return;busy=true;cancelled=false;for(const b of panel.querySelectorAll('button:not([data-action="cancel"])'))b.disabled=true;
  try{await fn();status(cancelled?'已停止':'完成 · '+manifest.length+' 个镜头已导出 · 渲染错误 '+errors.length);}
  catch(error){status('未完成：'+error.message);console.error(error);}
  finally{busy=false;for(const b of panel.querySelectorAll('button'))b.disabled=false;}
 }
 panel.querySelector('[data-action="preview"]').onclick=()=>run(async()=>{const shot=TRAILER_SHOTS.find(s=>s.id===select.value);prepare(shot);const start=performance.now();while(!cancelled&&shotTime<shot.seconds){await new Promise(requestAnimationFrame);const next=Math.min(shot.seconds,(performance.now()-start)/1000);render(Math.min(.05,next-shotTime),next);}status('预览结束');});
 panel.querySelector('[data-action="proof"]').onclick=()=>run(()=>proof());
 panel.querySelector('[data-action="oneproof"]').onclick=()=>run(()=>proof([TRAILER_SHOTS.find(s=>s.id===select.value)]));
 panel.querySelector('[data-action="capture"]').onclick=()=>run(()=>exportShot(TRAILER_SHOTS.find(s=>s.id===select.value)));
 panel.querySelector('[data-action="all"]').onclick=()=>run(async()=>{for(const shot of TRAILER_SHOTS){if(cancelled)break;await exportShot(shot);}});
 panel.querySelector('[data-action="cancel"]').onclick=()=>{cancelled=true;};
 select.onchange=()=>{if(!busy){prepare(TRAILER_SHOTS.find(s=>s.id===select.value));status(current.name+' · 待拍摄');}};
 prepare(current);status('准备完成 · 独立拍摄状态，不读写玩家进度');
 return{dispose(){cancelled=true;panel.remove();}};
}
