import {DEFAULT_LANTERN_DATA} from './lantern-game.js';
import {walkHeight} from './layout.js';

/**
 * Final world-space game configuration shared by production and integration
 * checks. Spawn/entry/NPC positions are feet; optics positions are light centres.
 * Relative aimAt links resolve only after these ground-height corrections.
 */
export function createGameData({groundHeight=walkHeight}={}){
 const data=structuredClone(DEFAULT_LANTERN_DATA);
 const ground=position=>{
  const y=groundHeight(position[0],position[2]);
  if(!Number.isFinite(y))throw new TypeError('Game object has no finite walk surface.');
  position[1]=y;return position;
 };
 ground(data.spawn);data.lamp.scale=.5;data.lamp.interactionDistance=1.75;ground(data.lamp.position);data.lamp.position[1]+=.35*data.lamp.scale;
 if(data.npc)ground(data.npc.position);
 for(const area of data.areas){
  ground(area.entry);
  for(const socket of area.sockets){ground(socket.position);socket.position[1]+=1.2;}
  for(const mirror of area.mirrors){ground(mirror.position);mirror.position[1]+=1.6;}
 }
 const temple=data.areas.find(area=>area.id==='temple');
 if(temple?.gate){
  const gate=temple.gate,yaw=gate.yaw||0,front=(gate.depth||.44)/2+.65;
  temple.terminal.position=[gate.position[0]+Math.sin(yaw)*front,gate.position[1]+(gate.height||6.9)+1.4,gate.position[2]+Math.cos(yaw)*front];
 }
 // The previous off-axis target sat six metres below the upper city platform.
 // Keep the crystal above the central stair landing, visible from its mirror.
 const city=data.areas.find(area=>area.id==='city');
 if(city){
  city.gate.kind='door';
  const gate=city.gate,yaw=gate.yaw||0,front=(gate.depth||.44)/2+.65;
  city.terminal.position=[gate.position[0]+Math.sin(yaw)*front,Math.max(21,groundHeight(gate.position[0],gate.position[2])+8),gate.position[2]+Math.cos(yaw)*front];
 }
 const oasis=data.areas.find(area=>area.id==='oasis');
 if(oasis){
  oasis.entry=[25,groundHeight(25,31),31];
  const east=oasis.mirrors.find(mirror=>mirror.id==='oasis-mirror-east');
  // Keep both operating positions on the southern shore, preserving a beam
  // across the water without requiring a near-half-lake detour between mirrors.
  if(east){east.position=[64,groundHeight(64,28)+1.6,28];east.directions[0]=[1,0,-.3];}
 }
 return data;
}
