import assert from 'node:assert/strict';
import {Scene,Vector3} from 'three';
import {createGameData} from '../src/game-data.js';
import {createLanternGame,validateLanternSnapshot} from '../src/lantern-game.js';
import {createLanternVisuals} from '../src/lantern-visuals.js';
import {createPlayerController} from '../src/player-controller.js';
import {cameraSegmentFraction} from '../src/third-person-camera.js';
import {createLayout,walkHeight,terrainSurfaceHeight} from '../src/layout.js';
import {createNavigation} from '../src/navigation.js';
import {buildHouseFoundationPlan} from '../src/house-foundations.js';

const reports=[],events=[],data=createGameData(),game=createLanternGame({data,onEvent:event=>events.push(event)});
const useFoundations=!process.argv.includes('--no-foundations'),placements=createLayout({foundations:useFoundations});
const world=createNavigation(placements,{foundationPlan:useFoundations?buildHouseFoundationPlan(placements):null}),visuals=createLanternVisuals(new Scene(),game,{groundHeight:walkHeight});
let elapsed=0;
const check=(name,run)=>{try{reports.push({name,passed:true,...run()});}catch(error){reports.push({name,passed:false,error:error.message});}};
const extraBlocked=(x,z,feet)=>visuals.colliders.some(c=>{
 if(c.h<=0||feet>=c.y+c.h||feet+1.6<=c.y)return false;
 const dx=x-c.x,dz=z-c.z,cos=Math.cos(c.yaw||0),sin=Math.sin(c.yaw||0);
 return Math.abs(dx*cos-dz*sin)<c.w/2+.32&&Math.abs(dx*sin+dz*cos)<c.d/2+.32;
});
const floor=(x,z)=>visuals.getSurfaceHeight(x,z,world.getSurfaceHeight(x,z,walkHeight(x,z)));
const blocked=(x,z,feet)=>world.blocked(x,z,feet)||extraBlocked(x,z,feet);
const player=createPlayerController({position:data.spawn,walkHeight:floor,blocked});
const tick=(seconds,{move=null}={})=>{
 for(let t=0;t<seconds-1e-8;t+=1/60){const dt=Math.min(1/60,seconds-t);if(move)player.update(dt,move);elapsed+=dt;game.update(dt,move?player.position:undefined);visuals.update(dt,elapsed,{player});}
};
function driveTo(x,z){
 const initial=Math.hypot(x-player.position.x,z-player.position.z),limit=Math.ceil((initial+6)*90);
 for(let i=0;i<limit;i++){
  const dx=x-player.position.x,dz=z-player.position.z,d=Math.hypot(dx,dz);
  if(d<.08){player.update(1/60,{paused:true});game.update(0,player.position);return;}
  tick(1/60,{move:{forward:Math.min(1,d*1.4),cameraYaw:Math.atan2(-dx,-dz)}});
 }
 throw new Error(`Controller cannot reach [${x},${z}]; stopped at ${JSON.stringify(player.position.toArray())}`);
}

// A half-metre map includes the actual scene's doors, pedestals and puzzle
// blockers. It proves approach connectivity, not full browser playability.
const grid={minX:-110,minZ:-155,step:.5,nx:457,nz:517};
const count=grid.nx*grid.nz,valid=new Uint8Array(count),height=new Float32Array(count),previous=new Int32Array(count).fill(-1),pathLength=new Int32Array(count),queue=new Int32Array(count);
const coordinates=id=>[grid.minX+(id%grid.nx)*grid.step,grid.minZ+Math.floor(id/grid.nx)*grid.step];
const indexAt=(x,z)=>Math.round((z-grid.minZ)/grid.step)*grid.nx+Math.round((x-grid.minX)/grid.step);
for(let id=0;id<count;id++){const [x,z]=coordinates(id),y=floor(x,z);height[id]=y;valid[id]=blocked(x,z,y)?0:1;}
const start=indexAt(data.spawn[0],data.spawn[2]);let head=0,tail=1;queue[0]=start;previous[start]=start;
while(head<tail){
 const id=queue[head++],ix=id%grid.nx,iz=Math.floor(id/grid.nx);
 for(const [dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){
  const x=ix+dx,z=iz+dz;if(x<0||x>=grid.nx||z<0||z>=grid.nz)continue;const next=z*grid.nx+x;
  if(previous[next]!==-1||!valid[next]||Math.abs(height[next]-height[id])>.55)continue;
  previous[next]=id;pathLength[next]=pathLength[id]+1;queue[tail++]=next;
 }
}
function approach(item){
 let best=null;const radius=item.interactionDistance||data.interactionDistance;
 for(let x=Math.ceil((item.position[0]-radius)/grid.step)*grid.step;x<=item.position[0]+radius;x+=grid.step)for(let z=Math.ceil((item.position[2]-radius)/grid.step)*grid.step;z<=item.position[2]+radius;z+=grid.step){
  const id=indexAt(x,z);if(id<0||id>=count||previous[id]===-1||!valid[id])continue;
  const y=floor(x,z),distance=Math.hypot(x-item.position[0],y-item.position[1],z-item.position[2]);if(distance>radius-.08)continue;
  const eye=new Vector3(x,y+1,z),target=new Vector3(...item.position);target.y=Math.max(target.y,eye.y);
  const obstacles=[...world.colliders,...visuals.colliders.filter(c=>c.id!==item.id&&c.h>0)];
  if(cameraSegmentFraction(eye,target,obstacles,.04)<.999)continue;
  const cost=pathLength[id]*grid.step+distance*.01;
  if(!best||cost<best.cost)best={id,position:[x,y,z],distance,pathMeters:pathLength[id]*grid.step,cost};
 }
 return best;
}
const approaches=new Map();
check('Production positions are finite, grounded and have safe recovery entries',()=>{
 for(const p of[data.spawn,data.npc.position,...data.areas.map(area=>area.entry)]){assert.ok(p.every(Number.isFinite));assert.ok(Math.abs(p[1]-walkHeight(p[0],p[2]))<1e-6);assert.ok(!blocked(p[0],p[2],p[1]),`Spawn/recovery point ${JSON.stringify(p)} is obstructed`);}
 for(const area of data.areas)assert.ok(area.terminal.position[1]>walkHeight(area.terminal.position[0],area.terminal.position[2])+1,area.id+' terminal is buried');
 assert.notDeepEqual(data.areas[2].entry,data.areas[2].sockets[0].position);
 return{spawn:data.spawn,entries:data.areas.map(area=>({id:area.id,entry:area.entry})),terminals:data.areas.map(area=>({id:area.id,position:area.terminal.position}))};
});
check('Every interactable has a connected, unobstructed player approach',()=>{
 for(const item of game.getInteractables()){
  const found=approach(item);assert.ok(found,`${item.id} has no connected, visible approach to ${JSON.stringify(item.position)}`);approaches.set(item.id,found);
 }
 return{reachableSquareMeters:tail*grid.step**2,approaches:[...approaches].map(([id,value])=>({id,position:value.position,pathMeters:value.pathMeters}))};
});
function use(id){
 const item=game.getInteractables().find(value=>value.id===id),point=approaches.get(id)||approach(item);
 assert.ok(point,'No physical approach for '+id);assert.ok(!blocked(...[point.position[0],point.position[2],point.position[1]]));
 game.update(0,point.position);const result=game.interact(id);assert.equal(result.ok,true,id+': '+result.reason);visuals.update(0,elapsed);return result;
}
function assertVisibleBeam(requireTerminal=true){
 const path=game.getBeamPaths()[0];assert.ok(path,'No beam is emitted');if(requireTerminal)assert.ok(path.terminalLit,'Configured optics do not light the terminal');
 for(const segment of path.segments){
  const a=new Vector3(...segment.from),b=new Vector3(...segment.to),fraction=cameraSegmentFraction(a,b,[...world.colliders,...visuals.colliders.filter(c=>c.h>0)],0);
  assert.ok(fraction>.999,`Solved ${path.areaId} beam crosses an actual collider at ${fraction.toFixed(3)}: ${JSON.stringify(segment)}`);
  for(let i=0;i<=20;i++){const p=a.clone().lerp(b,i/20);assert.ok(p.y>terrainSurfaceHeight(p.x,p.z)+.02,`${path.areaId} beam is below the terrain`);}
 }
 return path.segments;
}
check('Actual player reaches and picks up the first lantern',()=>{
 assert.equal(game.getInteractables().find(item=>item.id==='lantern').interactionDistance,1.75);
 game.update(0,[data.lamp.position[0],floor(data.lamp.position[0],data.lamp.position[2]+2),data.lamp.position[2]+2]);
 assert.equal(game.interact('lantern').reason,'too-far','The ground lantern must not be collectible from two metres away');
 game.update(0,player.position);
 const point=approaches.get('lantern');assert.ok(point);driveTo(point.position[0],point.position[2]);
 const result=game.interact('lantern');assert.equal(result.ok,true);assert.equal(game.state.lamp.location,'player');return{position:player.position.toArray()};
});
check('Actual player reaches the temple socket; closed door blocks movement',()=>{
 const point=approaches.get('temple-socket');assert.ok(point);driveTo(point.position[0],point.position[2]);
 assert.ok(game.getInteractables().find(item=>item.id==='temple-socket').inRange);
 driveTo(-34,21);driveTo(-34,12);tick(1.2,{move:{forward:1,cameraYaw:0,run:true}});
 assert.ok(player.position.z>11.45,'Closed temple door did not block the character');assert.ok(player.position.z<12);
 driveTo(-34,21);driveTo(point.position[0],point.position[2]);assert.equal(game.interact('temple-socket').ok,true);
 const segments=assertVisibleBeam();tick(2);assert.deepEqual(game.state.completed,['temple']);tick(3.5);
 driveTo(-34,21);driveTo(-34,9.5);assert.ok(player.position.z<10,'Opened temple door remains impassable');
 return{position:player.position.toArray(),beamSegments:segments};
});
check('Production city puzzle rejects low pedestal and solves at high pedestal',()=>{
 use('temple-socket');use('city-socket-low');assert.equal(game.getBeamPaths()[0].segments[0].hitId,'city-fallen-column');tick(2.1);assert.deepEqual(game.state.completed,['temple']);
 use('city-socket-low');use('city-socket-high');assert.equal(game.getBeamPaths()[0].segments[0].hitId,'city-mirror');use('city-mirror');
 const segments=assertVisibleBeam();tick(2);assert.deepEqual(game.state.completed,['temple','city']);return{beamSegments:segments};
});
check('Production oasis two-mirror route reaches the final crystal',()=>{
 use('city-socket-high');use('oasis-socket');assert.equal(game.getBeamPaths()[0].terminalLit,false);
 assert.equal(game.getObjective().targetId,'oasis-mirror-west');
 use('oasis-mirror-west');use('oasis-mirror-west');assert.equal(game.getBeamPaths()[0].segments[1].hitId,'oasis-mirror-east');
 assert.equal(game.getBeamPaths()[0].segments.at(-1).hitId,'oasis-canyon-wall','Wrong east-mirror angle must visibly land on the canyon wall');
 assert.equal(game.getObjective().targetId,'oasis-mirror-east');assertVisibleBeam(false);use('oasis-mirror-east');
 const segments=assertVisibleBeam();tick(2);assert.equal(game.state.complete,true);assert.equal(events.filter(event=>event.type==='game-completed').length,1);return{beamSegments:segments};
});
check('Production save restores puzzle state and recovery produces a valid standing position',()=>{
 const snapshot=game.snapshot();assert.equal(validateLanternSnapshot(snapshot,data).valid,true);
 const restored=createLanternGame({data,saved:snapshot});assert.deepEqual(restored.state.completed,game.state.completed);assert.equal(restored.state.restoreStatus,'restored');
 const state=restored.recover(),p=state.playerPosition;assert.ok(!blocked(p[0],p[2],floor(p[0],p[2])),'Recovery position intersects a pedestal or gate');
 assert.equal(restored.state.lamp.location,'player');return{recoveryPosition:p};
});
check('Production reset restores closed doors, initial lamp and first objective',()=>{
 game.reset();tick(4);assert.equal(game.state.lamp.location,'ground');assert.deepEqual(game.state.completed,[]);assert.equal(game.getObjective().kind,'pickup');
 const door=visuals.colliders.find(c=>c.id==='temple-gate');assert.ok(door.h>6);assert.ok(blocked(-34,11,walkHeight(-34,11)));return{};
});
visuals.dispose();
const passed=reports.every(report=>report.passed);
console.log(JSON.stringify({passed,checks:reports.length,reports,scope:'Uses production game data, real geometry-derived puzzle colliders, actual player motion for opening interactions, and physical light-path occlusion. Does not replace rendered playtesting.'},null,2));
if(!passed)process.exitCode=1;
