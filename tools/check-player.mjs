import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3} from 'three';
import {createPlayerController} from '../src/player-controller.js';
import {createThirdPersonCamera,cameraSegmentFraction} from '../src/third-person-camera.js';
import {createLayout} from '../src/layout.js';
import {createNavigation} from '../src/navigation.js';

const reports=[];
function check(name,fn){try{const detail=fn();reports.push({name,passed:true,...detail});}catch(error){reports.push({name,passed:false,error:error.message});}}
function simulate(player,seconds,input,hz=60){for(let i=0;i<Math.round(seconds*hz);i++)player.update(1/hz,typeof input==='function'?input(i/hz):input);}
const flat=()=>0;
check('Camera-relative movement, diagonal speed and turning',()=>{
 const straight=createPlayerController({walkHeight:flat}),diagonal=createPlayerController({walkHeight:flat}),rotated=createPlayerController({walkHeight:flat});
 simulate(straight,3,{forward:1,cameraYaw:0});simulate(diagonal,3,{forward:1,strafe:1,cameraYaw:0});simulate(rotated,3,{forward:1,cameraYaw:Math.PI/2});
 assert.ok(Math.abs(straight.position.length()-diagonal.position.length())<.001,'Diagonal input increases travel speed.');
 assert.ok(rotated.position.x<-9&&Math.abs(rotated.position.z)<.001,'W is not camera-relative.');assert.ok(Math.abs(rotated.heading-Math.PI/2)<.01);
 return{distanceMeters:+straight.distance.toFixed(3)};
});
check('Walk/run transition, stop and frame-rate consistency',()=>{
 const positions=[];
 for(const hz of[30,60,120]){
  const player=createPlayerController({walkHeight:flat});simulate(player,3,{forward:1,run:true},hz);assert.equal(player.locomotion,'run');assert.ok(player.speed>6.4);
  positions.push(player.position.z);simulate(player,1,{},hz);assert.equal(player.locomotion,'idle');assert.ok(player.speed<.001);
 }
 assert.ok(Math.max(...positions)-Math.min(...positions)<.001,'Travel differs across render rates.');return{runPositions:positions};
});
check('Pause freezes position and ignores a jump held during pause',()=>{
 const player=createPlayerController({walkHeight:flat});simulate(player,1,{forward:1});const before=player.position.clone();
 simulate(player,2,{forward:1,run:true,jump:true,paused:true});assert.ok(before.equals(player.position));
 player.update(1/60,{jump:true});assert.ok(player.grounded,'Paused jump leaks into resumed controls.');
 return{};
});
check('Jump returns to floor; holding jump does not bounce',()=>{
 const player=createPlayerController({walkHeight:flat});let top=0,launches=0;
 for(let i=0;i<240;i++){player.update(1/60,{jump:true});top=Math.max(top,player.position.y);if(player.justJumped)launches++;}
 assert.equal(launches,1);assert.ok(top>.85&&top<1.1);assert.equal(player.position.y,0);assert.ok(player.grounded);return{jumpHeightMeters:+top.toFixed(3)};
});
check('Wall blocks fast motion and still allows sliding',()=>{
 const blocked=(x,z)=>x>1&&x<2&&z>-30&&z<30;
 const player=createPlayerController({walkHeight:flat,blocked});simulate(player,3,{forward:1,strafe:1,run:true});
 assert.ok(player.position.x<=1,'Player tunnels through wall.');assert.ok(player.position.z<-10,'Player cannot slide along a wall.');
 return{position:player.position.toArray()};
});
check('A tall ledge requires a jump rather than automatic ground snapping',()=>{
 const height=(_x,z)=>z<-2?.8:0,player=createPlayerController({walkHeight:height});
 simulate(player,2,{forward:1});assert.ok(player.position.z>=-2);assert.equal(player.position.y,0);
 simulate(player,.8,{forward:1,jump:true});simulate(player,.5,{});
 assert.ok(player.position.z<-2&&Math.abs(player.position.y-.8)<.001);assert.ok(player.grounded);return{position:player.position.toArray()};
});
const world=createNavigation(createLayout());
check('Actual city stairs: follow the open left treads around the solid obelisk base',()=>{
 const player=createPlayerController({position:[18,0,-65],walkHeight:world.getSurfaceHeight,blocked:world.blocked});
 const waypoints=[[18,-101],[14,-101],[14,-113.2]];
 for(const [x,z]of waypoints){let reached=false;for(let i=0;i<900;i++){const dx=x-player.position.x,dz=z-player.position.z,d=Math.hypot(dx,dz);if(d<.08){reached=true;break;}player.update(1/60,{forward:Math.min(1,d*1.8),cameraYaw:Math.atan2(-dx,-dz),run:true});}assert.ok(reached,'City approach blocked before '+[x,z]+' at '+player.position.toArray());simulate(player,.25,{});}
 assert.ok(player.position.z<-113,'Player cannot complete both city stair flights.');assert.ok(player.position.y>=24.9,'Player has not reached the high terrace.');
 assert.ok(!world.blocked(player.position.x,player.position.z,player.position.y));assert.ok(player.grounded);return{position:player.position.toArray()};
});
check('Actual temple: ascend entry and stop at altar',()=>{
 const player=createPlayerController({position:[-37,0,27],walkHeight:world.getSurfaceHeight,blocked:world.blocked});simulate(player,7,{forward:1,run:true});
 assert.ok(player.position.z<4&&player.position.z>-4.3,'Temple entry or altar collision failed.');
 // The worn GLB cap is around 2.39 m; 2.3 was the old nominal floor that
 // embedded the character's feet. Its actual triangles are checked separately.
 assert.ok(player.position.y>2.37&&player.position.y<2.41);assert.ok(player.grounded);
 return{position:player.position.toArray()};
});
check('Camera shortens before an obstacle and recovers in open space',()=>{
 const wall={x:0,z:4,w:20,d:.4,y:0,h:6,yaw:0},camera=new PerspectiveCamera(55,1.6,.08,100),rig=createThirdPersonCamera(camera,{colliders:[wall],groundHeight:flat});
 const player={position:new Vector3(0,0,0)};rig.snap(player);assert.ok(rig.actualDistance<4.1&&rig.actualDistance>=2.1);assert.ok(camera.position.z<3.6);
 assert.equal(cameraSegmentFraction(new Vector3(0,1.15,0),camera.position,[wall],.22),1);
 rig.setColliders([]);for(let i=0;i<120;i++)rig.update(1/60,player);assert.ok(rig.actualDistance>4.75);return{recoveredDistance:rig.actualDistance};
});
check('Camera avoids becoming first person at a close wall',()=>{
 const wall={x:0,z:.8,w:20,d:.4,y:0,h:5,yaw:0},camera=new PerspectiveCamera(55,1.6,.08,100),rig=createThirdPersonCamera(camera,{colliders:[wall],groundHeight:flat});
 const player={position:new Vector3(0,0,0)};rig.snap(player);
 assert.ok(rig.usedFallback);assert.ok(rig.actualDistance>=2.1,'Camera collapsed into character.');
 assert.equal(cameraSegmentFraction(new Vector3(0,1.15,0),camera.position,[wall],.22),1,'Fallback goes through wall.');
 const walker=createPlayerController({walkHeight:flat});walker.update(1/60,{forward:1,cameraYaw:rig.movementYaw});
 const visibleForward=new Vector3(-camera.position.x,0,-camera.position.z).normalize();
 assert.ok(visibleForward.dot(walker.velocity.clone().normalize())>.999,'Camera fallback reverses visible WASD direction.');
 const before=camera.position.clone();rig.rotate(300,40);rig.update(1/60,player,{paused:true});assert.ok(camera.position.equals(before),'Paused camera moved.');return{position:camera.position.toArray(),distance:rig.actualDistance};
});
check('Camera sphere respects rotated boxes and rising terrain',()=>{
 const box={x:0,z:3,w:6,d:.3,y:0,h:4,yaw:Math.PI/4},a=new Vector3(0,1.5,0),b=new Vector3(0,1.5,6);
 assert.ok(cameraSegmentFraction(a,b,[box],.22)<.6);
 const camera=new PerspectiveCamera(55,1.6,.08,100),rig=createThirdPersonCamera(camera,{colliders:world.colliders,groundHeight:world.getSurfaceHeight});
 const player={position:new Vector3(18,world.getSurfaceHeight(18,-82),-82)};rig.snap(player);
 assert.ok(camera.position.y>=world.getSurfaceHeight(camera.position.x,camera.position.z)+.2);assert.ok(rig.actualDistance>=2.1);
 return{position:camera.position.toArray()};
});
check('Room framing is smooth, preserves orbit controls and restores the outdoor view',()=>{
 const config={groundHeight:flat,distance:25,minDistance:4.5,maxDistance:34,pitch:.5,minPitch:.18,maxPitch:1.08,targetHeight:3.3,shoulder:0};
 const camera=new PerspectiveCamera(48,603/783,.08,1400),rig=createThirdPersonCamera(camera,config),player={position:new Vector3()};
 rig.snap(player);const start=camera.position.clone();
 const indoor={distanceScale:.4,pitchOffset:-.18,targetHeight:1.35,minDistance:3.2};
 rig.setFraming(indoor);rig.update(1/60,player);
 assert.ok(rig.snapshot().framing.distanceScale>.4&&rig.snapshot().framing.distanceScale<1,'Framing jumps directly to the room profile.');
 assert.ok(camera.position.distanceTo(start)<1,'The first room transition frame jumps the camera.');
 const paused=camera.position.clone(),frozen=rig.snapshot().framing;
 for(let i=0;i<60;i++)rig.update(1/60,player,{paused:true});
 assert.ok(camera.position.equals(paused));assert.deepEqual(rig.snapshot().framing,frozen);
 for(let i=0;i<240;i++)rig.update(1/60,player);
 assert.equal(rig.distance,25);assert.equal(rig.pitch,.5);
 assert.ok(Math.abs(rig.snapshot().effective.distance-10)<1e-8);assert.ok(Math.abs(rig.snapshot().effective.pitch-.32)<1e-8);
 rig.rotate(100,20);rig.zoom(3);const input={yaw:rig.yaw,pitch:rig.pitch,distance:rig.distance};
 for(let i=0;i<120;i++){rig.setFraming(indoor);rig.update(1/60,player);}
 assert.deepEqual({yaw:rig.yaw,pitch:rig.pitch,distance:rig.distance},input,'Per-frame room framing overwrites mouse or wheel input.');
 assert.ok(Math.abs(rig.snapshot().effective.distance-11.2)<1e-8);
 rig.setFraming();for(let i=0;i<240;i++)rig.update(1/60,player);
 const referenceCamera=new PerspectiveCamera(48,603/783,.08,1400),reference=createThirdPersonCamera(referenceCamera,config);
 reference.setOrbit(input);reference.snap(player);
 assert.ok(camera.position.distanceTo(referenceCamera.position)<1e-6,'Leaving the room does not recover the user-selected outdoor view.');
 assert.equal(rig.distance,28);assert.ok(Math.abs(rig.snapshot().target[1]-3.3)<1e-8);
 return{retainedOrbit:input,restoredDistance:rig.actualDistance};
});
check('Framing transitions remain outside walls and a low ceiling in both directions',()=>{
 const ceiling={x:0,z:0,w:30,d:30,y:7.5,h:.4,yaw:0},wall={x:0,z:8,w:12,d:.5,y:0,h:7.5,yaw:0},colliders=[ceiling,wall];
 const camera=new PerspectiveCamera(48,603/783,.08,1400),rig=createThirdPersonCamera(camera,{colliders,groundHeight:flat,distance:25,minDistance:4.5,maxDistance:34,pitch:.5,minPitch:.18,maxPitch:1.08,targetHeight:3.3,shoulder:0});
 const player={position:new Vector3()};rig.snap(player);let minimum=Infinity;
 for(const framing of[{distanceScale:.4,pitchOffset:-.18,targetHeight:1.35,minDistance:3.2},{}]){
  rig.setFraming(framing);
  for(let i=0;i<150;i++){
   rig.update(i%2?1/60:1/30,player);const target=new Vector3(...rig.snapshot().target);
   assert.ok(cameraSegmentFraction(target,camera.position,colliders,.22)>.999999,'A framing transition cuts through the room.');
   assert.ok(camera.position.y<7.5-.22,'The camera entered the ceiling.');
   minimum=Math.min(minimum,rig.actualDistance);assert.ok(rig.actualDistance>=3.2,'Framing collapsed to a first-person distance.');
  }
 }
 rig.setColliders([]);for(let i=0;i<240;i++)rig.update(1/60,player);
 assert.ok(rig.actualDistance>24.9,'The camera remains retracted after leaving the room.');
 const recovered=rig.actualDistance,closeWall={x:0,z:.8,w:20,d:.4,y:0,h:20,yaw:0};
 rig.setColliders([closeWall]);rig.setOrbit({yaw:0,pitch:.5});rig.setFraming({distanceScale:.4,pitchOffset:-.18,targetHeight:1.35,minDistance:3.2});
 // This replaces the whole room with a wall between the existing camera and
 // player. A scene/teleport snap is explicit; normal motion never teleports.
 rig.snap(player);
 for(let i=0;i<240;i++){
  rig.update(1/60,player);
  for(const height of[.9,1.65])assert.ok(cameraSegmentFraction(player.position.clone().add(new Vector3(0,height,0)),camera.position,[closeWall],.05)>.999999);
  assert.ok(rig.actualDistance>=2.2,'Framed collision fallback collapses onto the character.');
 }
 const settled=camera.position.clone();for(let i=0;i<120;i++)rig.update(1/60,player);
 assert.ok(camera.position.distanceTo(settled)<1e-6,'Framing offset repeatedly undoes the emergency orbit angle.');
 return{minimumDistance:minimum,recoveredDistance:recovered,framedFallbackDistance:rig.actualDistance};
});
const passed=reports.every(report=>report.passed);
console.log(JSON.stringify({checks:reports.length,passed,reports,scope:'Runs actual controller and camera logic at fixed steps; browser feel and rendered character still require playtesting.'},null,2));
if(!passed)process.exitCode=1;
