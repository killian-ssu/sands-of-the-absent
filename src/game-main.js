import * as T from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {SSAOPass} from 'three/addons/postprocessing/SSAOPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createMaterials} from './materials.js';
import {createWorld} from './world.js';
import {views,zones,walkHeight,terrainSurfaceHeight} from './layout.js';
import {createPlayerController} from './player-controller.js';
import {createThirdPersonCamera,cameraSegmentFraction} from './third-person-camera.js';
import {createTraveler} from './avatar.js';
import {createRangerTraveler} from './ranger-avatar.js';
import {createTravelerCape} from './traveler-cape.js';
import {createLanternGame} from './lantern-game.js';
import {createGameData} from './game-data.js';
import {createEnvironmentDetails} from './environment-detail.js';
import {createLanternVisuals} from './lantern-visuals.js';
import {createSound} from './sound.js';
import {createPlaytestPanel} from './playtest-panel.js';
import {createAwakenings} from './awakenings.js';
import {createRouteGuidance} from './route-guidance.js';
import {createPlayerGuidance} from './player-guidance.js';
import {createGameRecorder} from './game-recorder.js';
import {createTempleAtmosphere} from './temple-atmosphere.js';
import {createFrameProfiler} from './frame-profiler.js';
import {attachAtmosphereDepth,createAtmospherePass} from './atmosphere-pass.js';

const $=s=>document.querySelector(s),params=new URLSearchParams(location.search);
const localTools=['localhost','127.0.0.1','[::1]'].includes(location.hostname)&&!document.documentElement.hasAttribute('data-static-site');
if(!localTools)for(const key of ['qa','review','trailer','blockout'])params.delete(key);
const blockout=params.has('blockout'),review=params.get('review'),trailer=params.get('trailer')==='1',SAVE_KEY='sands-of-the-absent.lantern.v1';
const useRanger=params.get('traveler')!=='kaykit';
const QUALITY={flow:{label:'流畅',pixel:.8,shadow:2048,reflection:384,ao:false},balanced:{label:'均衡',pixel:1,shadow:4096,reflection:512,ao:true},fine:{label:'精致',pixel:1.5,shadow:4096,reflection:768,ao:true}};
let quality='balanced',pixelOverride=Number(params.get('pixel'))||null;try{const saved=localStorage.getItem('sands-of-the-absent.quality');if(QUALITY[saved])quality=saved;}catch{}
const errors=[],sound=createSound();window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const canvas=$('#scene'),scene=new T.Scene(),camera=new T.PerspectiveCamera(48,innerWidth/innerHeight,.08,1400);
const renderer=new T.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
renderer.info.autoReset=false;renderer.setPixelRatio(Math.min(devicePixelRatio,T.MathUtils.clamp(pixelOverride||QUALITY[quality].pixel,.75,1.5)));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.outputColorSpace=T.SRGBColorSpace;renderer.localClippingEnabled=true;
const profiler=(params.has('qa')||review)?createFrameProfiler(renderer):null;
window.addEventListener('pagehide',()=>profiler?.dispose());
renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{const message=gl.getProgramInfoLog(program)+' '+gl.getShaderInfoLog(fragment);errors.push(message);console.error(message);};
scene.background=new T.Color(0x899eaa);scene.fog=new T.FogExp2(0x91a7ad,params.get('fog')==='classic'?.0031:.0022);const hemisphere=new T.HemisphereLight(0x8faec4,0x45535f,.85);scene.add(hemisphere);
const sun=new T.DirectionalLight(0xffdca7,3.0);sun.position.set(-110,125,30);sun.target.position.set(-20,0,-40);sun.castShadow=true;sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-120,right:120,top:145,bottom:-130,near:5,far:380});sun.shadow.bias=-.00008;sun.shadow.normalBias=.028;scene.add(sun,sun.target);if(params.get('light')!=='day'){sun.position.set(-150,85,-130);sun.color.setHex(0xffe5c8);sun.intensity=2.8;}
const fill=new T.DirectionalLight(0x90b9d2,.5);fill.position.set(50,45,80);scene.add(fill);
const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04).texture;scene.environmentIntensity=.2;room.dispose();pmrem.dispose();
let cinematicLight=params.get('look')!=='classic',cinematicCamera=params.get('camera')!=='classic',southernSun=params.get('sun')!=='north',reproCanopy=false,lowOutdoorAngle=params.get('angle')!=='high';
const atmosphereSunDirection=new T.Vector3();
function applyLighting(){hemisphere.intensity=cinematicLight?.55:.85;fill.intensity=cinematicLight?.16:.5;scene.environmentIntensity=cinematicLight?.14:.2;if(cinematicLight&&params.get('fill')!=='classic'){hemisphere.intensity*=.6;fill.intensity*=.6;scene.environmentIntensity*=.6;}sun.intensity=params.get('light')==='day'?3:(cinematicLight?(southernSun?4:3):2.8);if(params.get('light')!=='day'){sun.position.set(-150,southernSun?95:85,southernSun?90:-130);sun.color.setHex(southernSun?0xffe2b9:0xffe5c8);}renderer.toneMappingExposure=cinematicLight?1:1.05;}
function setShadowResolution(size){if(sun.shadow.mapSize.x===size)return size;sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.mapSize.set(size,size);sun.shadow.needsUpdate=true;return size;}
function applyQuality(){const value=QUALITY[quality],ratio=Math.min(devicePixelRatio,pixelOverride||value.pixel);renderer.setPixelRatio(ratio);renderer.setSize(innerWidth,innerHeight);composer?.setPixelRatio(ratio);setShadowResolution(value.shadow);world?.waterReflection?.setResolution(value.reflection);if(aoPass)aoPass.enabled=value.ao;}
function cameraProfile(){const adult=useRanger,pitch=lowOutdoorAngle?.20:.30;return cinematicCamera?{distance:adult?16:19,pitch,targetHeight:adult?3.1:3.8,indoorScale:adult?9/16:10/19,indoorPitchOffset:.32-pitch}:{distance:25,pitch:.50,targetHeight:3.3,indoorScale:.4,indoorPitchOffset:-.18};}
applyLighting();
let world,composer,aoPass,atmosphere,player,rig,avatar,npc,cape,game,gameVisuals,environmentDetails,awakenings,guidance,templeAtmosphere,qa,ready=false,discoveryTimer,endingTimer,started=false,photo=!!review,dragging=false,interactionBusy=false,selected=null,last=performance.now(),elapsed=0,telemetryAt=0,saveAt=0,captureAt=0,uiAt=0,frames=0,frameTime=0,fps=0;
const keys=new Set(),fpsSamples=[];
let playerHints,recorder;
let endingPending=false,keeperHeading=.7;
function loadSave(){try{return JSON.parse(localStorage.getItem(SAVE_KEY)||'null');}catch{return null;}}
function save(){if(!game||review||trailer)return;try{localStorage.setItem(SAVE_KEY,JSON.stringify(game.snapshot()));}catch{toast('本机存档暂时不可用，仍可继续游玩。');}}
function toast(text){$('#toast').textContent=text;$('#toast').style.opacity=1;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.opacity=0,3200);}
function setPhoto(value){if(!ready)return;photo=value;document.body.classList.toggle('photo',photo);$('#photo-hint').classList.toggle('hidden',!photo||!!review);keys.clear();}
const mapOpen=()=>!$('#map').classList.contains('hidden'),dialogOpen=()=>!$('#dialog').classList.contains('hidden');
function closeMap(){$('#map').classList.add('hidden');keys.clear();}
function toggleMap(){if(!ready)return;if(document.pointerLockElement)document.exitPointerLock();$('#map').classList.toggle('hidden');keys.clear();}
function begin(){if(!ready)return;started=true;camera.fov=48;camera.updateProjectionMatrix();rig.snap(player);$('#intro').classList.add('hidden');document.body.classList.add('playing');sound.start().catch(()=>{});canvas.focus();}
function showDialog(text,{title='守灯人',button='记住了'}={}){$('#dialog-title').textContent=title;$('#dialog-close-label').textContent=button;$('#dialog-text').textContent=text;$('#dialog').classList.remove('hidden');keys.clear();}
function closeDialog(){$('#dialog').classList.add('hidden');keys.clear();}
function tryShowEnding(){
 if(!endingPending||!game?.state.complete||!started||photo||review||mapOpen()||dialogOpen()||interactionBusy||document.hidden)return;
 endingPending=false;showDialog('三处遗迹已苏醒。回头看看水面上的光，也可以继续探索。',{title:'沙海苏醒',button:'继续探索'});
}
function onGameEvent(event){
 if(trailer)return;
 recorder?.mark(event.type,{areaId:event.areaId});
 const type=event.type;sound.cue(type);if(type==='npc-spoke')showDialog(event.text);
 if(type==='area-completed'){const region=zones.find(z=>z.id===event.areaId);$('#discovery-name').textContent=region?.name||'遗迹';$('#discovery-desc').textContent='光，重新穿过了这里。';$('#discovery').classList.remove('hidden');clearTimeout(discoveryTimer);discoveryTimer=setTimeout(()=>$('#discovery').classList.add('hidden'),4800);save();}
 if(type==='game-completed'){clearTimeout(endingTimer);endingTimer=setTimeout(()=>{endingPending=true;tryShowEnding();},2600);}
 if(type==='charge-interrupted')toast('光路中断，重新送光即可。');
 if(['lamp-picked-up','lamp-docked','mirror-rotated'].includes(type))save();
}
async function interact(){
 if(!ready)return;if(dialogOpen()){closeDialog();return;}if(!started){begin();return;}if(interactionBusy||mapOpen()||photo||!selected)return;
 const item=selected;interactionBusy=true;keys.clear();player.heading=Math.atan2(player.position.x-item.position[0],player.position.z-item.position[2]);
 const result=game.interact(item.id);if(result.ok&&result.action!=='talk')await avatar.playInteraction();interactionBusy=false;save();
}
async function capture(name='journey-'+Date.now()){if(!ready)return;await new Promise(resolve=>requestAnimationFrame(resolve));composer.render();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('截图生成失败');if(!localTools){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name+'.png';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('画面已下载。');return;}const response=await fetch('/__capture?name='+encodeURIComponent(name),{method:'POST',body:blob});if(!response.ok)throw Error('截图保存失败：'+response.status);if(!review)toast('画面已保存。');}
$('#enter').onclick=begin;$('#map-button').onclick=toggleMap;$('#close-map').onclick=closeMap;$('#photo-button').onclick=()=>setPhoto(!photo);$('#interact-button').onclick=interact;$('#dialog-close').onclick=closeDialog;
const actions=document.createElement('div');actions.className='session-actions';actions.innerHTML='<button id="recover" aria-describedby="recover-help">回到当前目标入口</button><button id="sound-toggle">声音：开</button><button id="restart">重新开始</button><small id="recover-help" class="recovery-note">保留苏醒进度，找回已取得的提灯。</small>';$('#map').append(actions);
$('#recover').onclick=()=>{const state=game.recover();player.teleport(state.playerPosition,0);rig.setOrbit({yaw:0,pitch:cameraProfile().pitch,distance:cameraProfile().distance});rig.snap(player);closeMap();save();};
const qualityLabel=document.createElement('label');qualityLabel.className='quality-setting';qualityLabel.textContent='画面';const qualitySelect=document.createElement('select');qualitySelect.setAttribute('aria-label','画面品质');for(const [id,value]of Object.entries(QUALITY)){const option=document.createElement('option');option.value=id;option.textContent=value.label;qualitySelect.append(option);}qualitySelect.value=quality;qualityLabel.append(qualitySelect);$('#map').append(qualityLabel);qualitySelect.onchange=()=>{quality=qualitySelect.value;pixelOverride=null;applyQuality();try{localStorage.setItem('sands-of-the-absent.quality',quality);}catch{}};
$('#sound-toggle').onclick=()=>{$('#sound-toggle').textContent='声音：'+(sound.setMuted(!sound.muted)?'关':'开');};
$('#restart').onclick=()=>{clearTimeout(endingTimer);endingPending=false;clearTimeout(discoveryTimer);$('#discovery').classList.add('hidden');game.reset();playerHints?.reset();keeperHeading=.7;player.teleport(game.state.playerPosition,0);rig.setOrbit({yaw:0,pitch:cameraProfile().pitch,distance:cameraProfile().distance});rig.snap(player);closeMap();closeDialog();save();toast('旅途重新开始。');};
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{
 const name=button.dataset.view,index=zones.findIndex(z=>z.id===name),state=game.state,area=game.data.areas[index];
 if(index>state.completed.length)return;
 const lampAtDestination=state.lamp.location==='socket'&&area?.sockets.some(socket=>socket.id===state.lamp.socketId);
 if(index>0&&index===state.completed.length&&!state.complete&&state.lamp.location!=='player'&&!lampAtDestination){toast('先取回提灯，再前往下一处遗迹。');return;}
 const point=name==='hero'?game.data.spawn:area?.entry;
 if(point){begin();player.teleport(point,0);game.update(0,player.position);rig.setOrbit({yaw:0,pitch:cameraProfile().pitch,distance:cameraProfile().distance});rig.snap(player);closeMap();save();}
};
canvas.tabIndex=0;canvas.addEventListener('pointerdown',()=>{dragging=true;sound.start().catch(()=>{});canvas.focus();});window.addEventListener('pointerup',()=>dragging=false);
window.addEventListener('pointermove',e=>{if(dragging&&!mapOpen()&&!dialogOpen())rig?.rotate(e.movementX,e.movementY);});canvas.addEventListener('wheel',e=>{rig?.zoom(Math.sign(e.deltaY)*.8);},{passive:true});
window.addEventListener('keydown',e=>{const editing=e.target.closest?.('input,select,textarea,[contenteditable="true"]'),nativeControl=e.target.closest?.('button,a');if(e.code!=='Escape'&&(editing||(nativeControl&&['Space','Enter'].includes(e.code))))return;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.repeat)return;if(e.code==='KeyE')interact();if(e.code==='KeyM')toggleMap();if(e.code==='KeyP')setPhoto(!photo);if(e.code==='KeyC')capture();if(e.code==='Escape'){closeMap();closeDialog();dragging=false;keys.clear();}});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();dragging=false;save();});document.addEventListener('visibilitychange',()=>{keys.clear();last=performance.now();if(document.hidden)save();});
window.addEventListener('resize',()=>{if(trailer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer?.setSize(innerWidth,innerHeight);});
async function init(){try{
 const materials=await createMaterials(renderer,blockout);$('#load-text').textContent='风沙、石门，和一盏尚未熄灭的灯。';world=await createWorld(scene,materials,blockout);world.templePalette?.setEnabled(params.get('palette')!=='classic');world.rockMainCulling?.setEnabled(params.get('rockCull')!=='0');world.waterReflection?.setQuietReflection(params.get('water')!=='bright');world.waterReflection?.setSunDirection(new T.Vector3().subVectors(sun.position,sun.target.position));
 if(!blockout){environmentDetails=await createEnvironmentDetails(scene,{groundHeight:terrainSurfaceHeight});world.colliders.push(...environmentDetails.colliders);}
 if(!blockout){const sky=await new T.TextureLoader().loadAsync('assets/textures/sky.png');sky.colorSpace=T.SRGBColorSpace;sky.wrapS=T.RepeatWrapping;const material=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,uniforms:{skyMap:{value:sky}},vertexShader:'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`uniform sampler2D skyMap;varying vec3 vDirection;void main(){vec3 d=normalize(vDirection);vec2 uv=vec2(atan(d.z,d.x)/6.2831853+.5,.2+max(0.,d.y)*.68);vec3 c=texture2D(skyMap,uv).rgb;c=mix(vec3(.38,.46,.5),c,smoothstep(-.06,.32,d.y));gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});const skyDome=new T.Mesh(new T.SphereGeometry(1000,32,20),material);skyDome.renderOrder=-10;scene.add(skyDome);}
 composer=new EffectComposer(renderer);if(!blockout)attachAtmosphereDepth(composer);composer.addPass(new RenderPass(scene,camera));if(!blockout){atmosphere=createAtmospherePass(camera,{enabled:params.get('haze')!=='0'});atmosphere.setCoolDepth(params.get('air')!=='warm');composer.addPass(atmosphere);const ssao=aoPass=new SSAOPass(scene,camera,innerWidth,innerHeight,16);ssao.kernelRadius=.7;ssao.minDistance=.02/(camera.far-camera.near);ssao.maxDistance=1.4/(camera.far-camera.near);const resizeAO=ssao.setSize.bind(ssao);ssao.setSize=(w,h)=>resizeAO(Math.max(1,Math.round(w*.5)),Math.max(1,Math.round(h*.5)));const renderAO=ssao.render.bind(ssao);ssao.render=(...args)=>{const wasUpdating=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;const visible=[];scene.traverse(o=>{if(o.isMesh&&o.visible&&(o.isReflector||(Array.isArray(o.material)?o.material:[o.material]).some(m=>m?.transparent||m?.alphaTest>0)))visible.push(o);});visible.forEach(o=>o.visible=false);try{return renderAO(...args);}finally{visible.forEach(o=>o.visible=true);renderer.shadowMap.autoUpdate=wasUpdating;}};composer.addPass(ssao);composer.addPass(new UnrealBloomPass(new T.Vector2(innerWidth,innerHeight),.16,.4,1.35));}composer.addPass(new OutputPass());composer.addPass(new SMAAPass());
 const data=createGameData();
 game=createLanternGame({saved:(review||trailer)?null:loadSave(),data,onEvent:onGameEvent});
 playerHints=createPlayerGuidance({data:game.data});
 gameVisuals=createLanternVisuals(scene,game,{groundHeight:walkHeight,materials});if(!blockout){gameVisuals.mirrorAppearance.prepare(renderer);gameVisuals.mirrorAppearance.setEnabled(params.get('mirrors')!=='classic');}
 const physicalHeight=(x,z)=>gameVisuals.getSurfaceHeight(x,z,world.getSurfaceHeight(x,z,walkHeight(x,z)));
 const isBlocked=(x,z,feet)=>world.blocked(x,z,feet)||gameVisuals.colliders.some(c=>{
  if(c.h<=0||feet>=c.y+c.h||feet+1.6<=c.y)return false;
  const dx=x-c.x,dz=z-c.z,co=Math.cos(c.yaw||0),si=Math.sin(c.yaw||0);
  return Math.abs(dx*co-dz*si)<c.w/2+.32&&Math.abs(dx*si+dz*co)<c.d/2+.32;
 });
 let spawn=game.state.playerPosition;
 if(isBlocked(spawn[0],spawn[2],physicalHeight(spawn[0],spawn[2]))){game.recover();spawn=game.state.playerPosition;}
 player=createPlayerController({position:spawn,walkHeight:physicalHeight,blocked:isBlocked});
 const animationUrls=['assets/vendor/kaykit-adventurers-2.0/Rig_Medium_General.glb','assets/vendor/kaykit-adventurers-2.0/Rig_Medium_MovementBasic.glb'];
 [avatar,npc]=await Promise.all([useRanger?createRangerTraveler({height:1.75}):createTraveler({url:'assets/vendor/kaykit-adventurers-2.0/Rogue_Hooded.glb',animationUrls,height:1.75,tint:0xe2cba6}),useRanger?createRangerTraveler({height:1.8,npc:true}):createTraveler({url:'assets/vendor/kaykit-adventurers-2.0/Ranger.glb',animationUrls,height:1.76,npc:true,tint:0xb6c6bc})]);scene.add(avatar.root,npc.root);
 const templeCameraProxies=[...[-55.975,-43.325,-30.675,-18.025].map(x=>({x,z:11.5,w:3.8,d:4,y:2.3,h:16})),...[-57.7,-16.3].map(x=>({x,z:-4,w:2.8,d:31,y:2.3,h:16})),{x:-37,z:-16.5,w:42,d:4,y:2.3,h:16}];
 rig=createThirdPersonCamera(camera,{colliders:[...world.colliders,...world.cameraColliders,...gameVisuals.colliders,...templeCameraProxies],groundHeight:physicalHeight,distance:cameraProfile().distance,minDistance:4.5,maxDistance:34,pitch:cameraProfile().pitch,minPitch:params.get('upLook')==='0'?.08:-.08,maxPitch:1.08,shoulder:0,targetHeight:cameraProfile().targetHeight});rig.snap(player);
 avatar.update(0,{...player.snapshot(),position:player.position,carryingLamp:game.state.lamp.location==='player'});if(useRanger){cape=createTravelerCape();cape.attach(avatar);cape.setEnabled(params.get('cape')!=='0');}npc.update(0,{position:new T.Vector3(...data.npc.position),heading:.7,locomotion:'idle',grounded:true,speed:0});
 if(review&&views[review]){camera.fov=55;camera.updateProjectionMatrix();camera.position.set(...views[review].p);camera.lookAt(...views[review].t);}if(!trailer&&loadSave()&&!review){$('#enter').innerHTML='继续旅程 <span>↗</span>';if(game.state.hasPickedUp)$('#intro small').textContent='进度已保存在本机 · 进入后按左下方目标继续 · M 查看地图和操作';}
 awakenings=createAwakenings(scene,game,{groundHeight:walkHeight});guidance=createRouteGuidance(scene,game,{groundHeight:walkHeight});templeAtmosphere=createTempleAtmosphere(scene,game,{groundHeight:walkHeight,materials});
 if(trailer){
  renderer.setPixelRatio(1);renderer.setSize(1920,1080,false);composer.setPixelRatio(1);composer.setSize(1920,1080);camera.aspect=16/9;camera.updateProjectionMatrix();setShadowResolution(4096);world.waterReflection?.setResolution(768);
  document.body.classList.add('trailer-mode');$('#loading').classList.add('hidden');$('#hud').classList.add('hidden');$('#intro').classList.add('hidden');ready=true;
  const {createTrailerDirector}=await import('./trailer-director.js');
  createTrailerDirector({canvas,camera,renderer,composer,world,player,avatar,npc,cape,game,gameVisuals,awakenings,guidance,templeAtmosphere,atmosphere,sun,errors});return;
 }
 applyQuality();qa=createPlaytestPanel({getState:()=>({player:player.snapshot(),game:game.state,objective:game.getObjective(),selected,fps,uiModalActive:mapOpen()||dialogOpen()||!started,paused:mapOpen()||dialogOpen()||photo||!started||!!review,interactionBusy,cameraYaw:rig.movementYaw,shadowResolution:sun.shadow.mapSize.x,rockLOD:world.rockLOD.snapshot(),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles}),renderToggles:[{label:'冷色远处空气',read:()=>atmosphere?.snapshot().coolDepth,toggle:()=>atmosphere?.setCoolDepth(!atmosphere.snapshot().coolDepth)},{label:'安静水面',read:()=>world.waterReflection?.snapshot().quietReflection,toggle:()=>world.waterReflection?.setQuietReflection(!world.waterReflection.snapshot().quietReflection)},{label:'较低室外视线',read:()=>lowOutdoorAngle,toggle:()=>{lowOutdoorAngle=!lowOutdoorAngle;rig.setOrbit({pitch:cameraProfile().pitch});}},{label:'旅人短披布',read:()=>cape?.snapshot().enabled,toggle:()=>cape?.setEnabled(!cape.snapshot().enabled)},{label:'镜盘天空反射',read:()=>gameVisuals.mirrorAppearance?.snapshot().enabled,toggle:()=>gameVisuals.mirrorAppearance?.setEnabled(!gameVisuals.mirrorAppearance.snapshot().enabled)},{label:'岩石视锥筛选',read:()=>world.rockMainCulling?.snapshot().enabled,toggle:()=>world.rockMainCulling?.setEnabled(!world.rockMainCulling.snapshot().enabled)},{label:'神庙砂岩分区',read:()=>world.templePalette?.snapshot().enabled,toggle:()=>world.templePalette?.setEnabled(!world.templePalette.snapshot().enabled)},{label:'电影光影',read:()=>cinematicLight,toggle:()=>{cinematicLight=!cinematicLight;applyLighting();}},{label:'金色斜阳',read:()=>southernSun,toggle:()=>{southernSun=!southernSun;applyLighting();world.waterReflection?.setSunDirection(new T.Vector3().subVectors(sun.position,sun.target.position));}},{label:'室外远眺',read:()=>cinematicCamera,toggle:()=>{cinematicCamera=!cinematicCamera;const profile=cameraProfile();rig.setOrbit({yaw:0,pitch:profile.pitch,distance:profile.distance});}},{label:'精细倒影',read:()=>world.waterReflection?.snapshot().width===768,toggle:()=>world.waterReflection?.setResolution(world.waterReflection.snapshot().width===768?512:768)},{label:'环境遮蔽',read:()=>aoPass?.enabled,toggle:()=>{if(aoPass)aoPass.enabled=!aoPass.enabled;}},{label:'低处沙尘',read:()=>atmosphere?.enabled,toggle:()=>atmosphere?.setEnabled(!atmosphere.enabled)},{label:'遮挡复现机位',read:()=>reproCanopy,toggle:()=>{reproCanopy=!reproCanopy;cinematicCamera=!reproCanopy;const profile=cameraProfile();rig.setOrbit({yaw:reproCanopy?.65:0,pitch:reproCanopy?.68:profile.pitch,distance:reproCanopy?25:profile.distance});}},{label:'树冠避让',read:()=>world.canopyOcclusion?.snapshot().enabled,toggle:()=>world.canopyOcclusion?.setEnabled(!world.canopyOcclusion.snapshot().enabled)},{label:'地形分组',read:()=>world.terrainClusters?.snapshot().enabled,toggle:()=>world.terrainClusters?.setEnabled(!world.terrainClusters.snapshot().enabled)},{label:'房屋分组',read:()=>world.houseClusters?.snapshot().enabled,toggle:()=>world.houseClusters?.setEnabled(!world.houseClusters.snapshot().enabled)}],onToggleShadow:()=>{return setShadowResolution(sun.shadow.mapSize.x===4096?2048:4096);},onToggleLOD:()=>{world.setRockLODEnabled(!world.rockLOD.snapshot().enabled);return world.rockLOD.snapshot().enabled;},onInteract:interact,onRestart:()=>$('#restart').onclick(),onCapture:()=>capture()});
 if(params.get('qa')==='1'){
  const bar=document.createElement('div');bar.id='record-controls';bar.style.cssText='position:fixed;right:18px;top:95px;z-index:21000;font:11px system-ui;color:#ffe4b7;background:#172629cc;padding:7px;border:1px solid #a78e5966;border-radius:4px';
  const recordButton=document.createElement('button'),recordStatus=document.createElement('span');recordButton.textContent='开始实机录制';recordButton.style.cssText='background:transparent;border:0;padding:5px;color:inherit;font:inherit';recordStatus.style.marginLeft='10px';bar.append(recordButton,recordStatus);document.body.append(bar);
  recorder=createGameRecorder(canvas,{getAudioTap:()=>sound.connectRecording(),getState:()=>({player:player.snapshot(),completed:[...game.state.completed],complete:game.state.complete,lamp:{...game.state.lamp},objective:game.getObjective(),camera:rig.snapshot(),route:qa.snapshot?.(),fps,errors:[...errors]}),onStatus:s=>{recordButton.textContent=s.phase==='recording'?'结束并保存录制':'开始实机录制';recordButton.disabled=['starting','stopping'].includes(s.phase);recordStatus.textContent=s.phase==='recording'?`● ${Math.floor(s.seconds)} 秒`:s.phase==='saved'?'已保存到本机':s.error||'';}});
  recordButton.onclick=async()=>{try{if(recorder.snapshot().phase==='recording')await recorder.stop();else await recorder.start({label:game.state.complete?'exploration':'playthrough'});}catch(error){toast('录制未完成：'+error.message);}};
 }
 ready=true;$('#loading').classList.add('hidden');$('#hud').classList.remove('hidden');setPhoto(photo);if(review){started=true;$('#intro').classList.add('hidden');captureAt=3;}renderer.setAnimationLoop(loop);
 }catch(error){errors.push(error.stack||String(error));$('#load-text').textContent='加载未完成：'+error.message;console.error(error);sendTelemetry();}}
function sendTelemetry(){if(!localTools)return;const stats={time:new Date().toISOString(),version:'lantern-third-person',traveler:useRanger?'ranger':'kaykit',review,lighting:params.get('light')||'dusk',lightingRig:{sunIntensity:sun.intensity,hemisphereIntensity:hemisphere.intensity,fillIntensity:fill.intensity,environmentIntensity:scene.environmentIntensity,exposure:renderer.toneMappingExposure},cinematicLight,cinematicCamera,lowOutdoorAngle,southernSun,quality,viewport:[innerWidth,innerHeight],pixelRatio:renderer.getPixelRatio(),shadowResolution:sun.shadow.mapSize.x,aoEnabled:aoPass?.enabled,waterReflection:world?.waterReflection?.snapshot(),houseClusters:world?.houseClusters?.snapshot(camera),houseFoundations:world?.houseFoundations?.snapshot()||{enabled:false},terrainClusters:world?.terrainClusters?.snapshot(camera),atmosphere:atmosphere?.snapshot(),fps,medianFPS:fpsSamples.length?[...fpsSamples].sort((a,b)=>a-b)[Math.floor(fpsSamples.length/2)]:null,player:player?.snapshot(),camera:rig?.snapshot(),canopyOcclusion:world?.canopyOcclusion?.snapshot(),templePalette:world?.templePalette?.snapshot(),mirrorAppearance:gameVisuals?.mirrorAppearance?.snapshot(),keeperHeading,travelerCape:cape?.snapshot(),rockMainCulling:world?.rockMainCulling?.snapshot(),sound:sound.snapshot(),game:game?.snapshot(),objective:game?.getObjective(),selected:selected?.id,errors,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,models:world?.placements.length,profile:profiler?.snapshot(),rockLOD:world?.rockLOD?.snapshot(),colliders:world?.colliders.length,navigation:world?.navigation,loaded:!!gameVisuals};fetch('/__telemetry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(stats)}).catch(()=>{});}
function updateUI(){
 tryShowEnding();
 const state=game.state,objective=game.getObjective(),region=zones.find(z=>z.id===state.currentArea)||zones.at(-1);$('#objective-text').textContent=objective.text;$('#chapter').textContent=state.complete?'尾声 · 沙海苏醒':['第一章 · 风蚀神庙','第二章 · 碑下旧城','第三章 · 峡谷绿洲'][state.completed.length];$('#region').textContent=state.complete?'沙海苏醒':'下一处：'+region.name;$('#visited').textContent=state.completed.length+' / 3';const progress=state.chargeProgress[state.currentArea]||0;$('#charge-track').style.opacity=progress>0?1:0;$('#charge-fill').style.width=(progress*100)+'%';
 const degrees=((rig.movementYaw*180/Math.PI)%360+360)%360;$('#bearing').textContent=['北','西北','西','西南','南','东南','东','东北'][Math.round(degrees/45)%8];
 const eye=player.position.clone().add(new T.Vector3(0,1,0));selected=game.getInteractables().filter(item=>item.inRange&&item.enabled).filter(item=>{const p=new T.Vector3(...item.position);p.y=Math.max(p.y,eye.y);return cameraSegmentFraction(eye,p,[...world.colliders,...gameVisuals.colliders.filter(c=>c.id!==item.id&&c.h>0)],.04)>.96;}).sort((a,b)=>a.distance-b.distance)[0]||null;$('#interact').classList.toggle('hidden',!started||!selected||interactionBusy||mapOpen()||dialogOpen()||photo);if(selected)$('#interact-label').textContent=selected.label;
 for(const b of document.querySelectorAll('[data-view]')){const index=zones.findIndex(z=>z.id===b.dataset.view);b.disabled=index>state.completed.length;}
 playerHints.update(.08,{state,objective,selected,position:player.position,started,paused:mapOpen()||dialogOpen()||photo||!!review,interactionBusy});
}
function loop(now){
 if(document.hidden){last=now;return;}
 profiler?.beginFrame();
 const rawDt=(now-last)/1000,dt=Math.min(rawDt,.05);last=now;elapsed+=dt;frames++;frameTime+=rawDt;if(frameTime>.8){fps=Math.round(frames/frameTime);fpsSamples.push(fps);if(fpsSamples.length>90)fpsSamples.shift();frames=0;frameTime=0;}
 const globalPause=mapOpen()||dialogOpen()||photo||!started||!!review;if(!globalPause){if(keys.has('ArrowLeft'))rig.rotate(-dt*450,0);if(keys.has('ArrowRight'))rig.rotate(dt*450,0);if(keys.has('ArrowUp'))rig.rotate(0,-dt*280);if(keys.has('ArrowDown'))rig.rotate(0,dt*280);}
 const input=qa.update(dt)||{forward:Number(keys.has('KeyW'))-Number(keys.has('KeyS')),strafe:Number(keys.has('KeyD'))-Number(keys.has('KeyA')),run:keys.has('ShiftLeft')||keys.has('ShiftRight'),jump:keys.has('Space'),cameraYaw:rig.movementYaw};
 player.update(dt,{...input,paused:globalPause||interactionBusy});game.update(globalPause?0:dt,player.position);
 avatar.update(dt,{...player.snapshot(),position:player.position,paused:globalPause,carryingLamp:game.state.lamp.location==='player'});cape?.update(dt,elapsed,{paused:globalPause,speed:player.snapshot().speed});const keeperPosition=new T.Vector3(...game.data.npc.position);if(!globalPause){const dx=keeperPosition.x-player.position.x,dz=keeperPosition.z-player.position.z,desired=dx*dx+dz*dz<36?Math.atan2(dx,dz):.7;keeperHeading+=Math.atan2(Math.sin(desired-keeperHeading),Math.cos(desired-keeperHeading))*(1-Math.exp(-dt*3.5));}npc.update(dt,{position:keeperPosition,heading:keeperHeading,locomotion:'idle',grounded:true,speed:0,paused:globalPause});const chamber=T.MathUtils.smoothstep(player.position.x,-57,-51)*(1-T.MathUtils.smoothstep(player.position.x,-23,-17))*(1-T.MathUtils.smoothstep(player.position.z,7,17))*T.MathUtils.smoothstep(player.position.z,-23,-16);const profile=cameraProfile();rig.setFraming({distanceScale:1-(1-profile.indoorScale)*chamber,pitchOffset:profile.indoorPitchOffset*chamber,targetHeight:profile.targetHeight-(profile.targetHeight-1.35)*chamber,minDistance:4.5-1.3*chamber});if(!started&&!review){camera.fov=55;camera.updateProjectionMatrix();camera.position.set(...views.hero.p);camera.lookAt(...views.hero.t);}else if(!(review&&views[review]))rig.update(dt,player,{paused:mapOpen()||dialogOpen()});gameVisuals.update(dt,elapsed,{player,handAnchor:avatar.handAnchor,highlightId:selected?.id});awakenings.update(globalPause?0:dt,elapsed);world.update(elapsed,camera,innerHeight,{windPaused:globalPause});world.canopyOcclusion?.update(globalPause?0:dt,camera,{playerPosition:player.position,selectedPosition:selected?.position});guidance.update(elapsed);templeAtmosphere.update(globalPause?0:dt,elapsed);sound.update(elapsed,player);atmosphere?.update({playerPosition:player.position,selectedPosition:selected?.position,sunDirection:atmosphereSunDirection.subVectors(sun.position,sun.target.position)});renderer.info.reset();profiler?.beginRender();composer.render();profiler?.endRender();
 if(elapsed>uiAt){uiAt=elapsed+.08;updateUI();}if(elapsed>telemetryAt){telemetryAt=elapsed+5;sendTelemetry();}if(elapsed>saveAt){saveAt=elapsed+10;if(started)save();}if(captureAt&&elapsed>captureAt){captureAt=0;capture((blockout?'blockout-':'live-')+(review||'third-person')+(params.get('light')?'-'+params.get('light'):'' )).then(()=>{if(review&&!params.has('qa'))renderer.setAnimationLoop(null);});}
 profiler?.endFrame();
}
init();
