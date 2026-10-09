import {Vector3} from 'three';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
const defaults={walkSpeed:3.4,runSpeed:6.6,acceleration:26,deceleration:30,airAcceleration:9,turnSpeed:13,gravity:18,jumpSpeed:5.8,stepHeight:.55,groundSnap:.27,maxStep:1/120,maxFrame:.2};

/**
 * Metre-based character motion. position is the feet, heading 0 faces -Z.
 * blocked already includes the player's radius in the existing navigation module.
 * Input forward/strafe are camera-relative; holding jump never retriggers a jump.
 */
export function createPlayerController({position=[0,0,0],heading=0,walkHeight,blocked=()=>false,config={}}={}){
 if(typeof walkHeight!=='function')throw new TypeError('Player controller needs walkHeight(x,z).');
 const cfg={...defaults,...config};
 const feet=new Vector3(),velocity=new Vector3();
 let grounded=true,locomotion='idle',speed=0,lastJump=false,paused=false,landed=false,justJumped=false,distance=0;
 let facing=Number.isFinite(heading)?heading:0;

 function groundAt(x,z){const y=walkHeight(x,z);if(!Number.isFinite(y))throw new Error('Non-finite walk surface.');return y;}
 function teleport(value,nextHeading=facing,{snapToGround=true}={}){
  const p=Array.isArray(value)?value:[value.x,value.y,value.z];
  if(p.length!==3||!p.every(Number.isFinite))throw new TypeError('Player position must contain three finite coordinates.');
  const y=snapToGround?groundAt(p[0],p[2]):p[1];
  if(blocked(p[0],p[2],y))throw new RangeError('Player spawn is inside an obstacle.');
  feet.set(p[0],y,p[2]);velocity.set(0,0,0);facing=Number.isFinite(nextHeading)?nextHeading:facing;
  grounded=y<=groundAt(p[0],p[2])+.001;locomotion=grounded?'idle':'fall';speed=0;landed=justJumped=false;lastJump=false;distance=0;
  return api;
 }

 function step(dt,input,jumpPressed){
  const forward=clamp(Number(input.forward)||0,-1,1),strafe=clamp(Number(input.strafe)||0,-1,1),length=Math.hypot(forward,strafe);
  const yaw=Number.isFinite(input.cameraYaw)?input.cameraYaw:0;
  const amount=Math.min(length,1),normalizer=length>1?length:1,travelSpeed=input.run?cfg.runSpeed:cfg.walkSpeed;
  const dx=(-Math.sin(yaw)*forward+Math.cos(yaw)*strafe)/normalizer;
  const dz=(-Math.cos(yaw)*forward-Math.sin(yaw)*strafe)/normalizer;
  const targetX=dx*travelSpeed,targetZ=dz*travelSpeed;
  const acceleration=grounded?(amount?cfg.acceleration:cfg.deceleration):cfg.airAcceleration;
  const deltaX=targetX-velocity.x,deltaZ=targetZ-velocity.z,deltaLength=Math.hypot(deltaX,deltaZ),change=Math.min(1,acceleration*dt/(deltaLength||1));
  velocity.x+=deltaX*change;velocity.z+=deltaZ*change;
  if(jumpPressed&&grounded){velocity.y=cfg.jumpSpeed;grounded=false;justJumped=true;}
  const oldX=feet.x,oldZ=feet.z,oldY=feet.y,oldGround=groundAt(oldX,oldZ);
  const tryMove=(x,z)=>{
   const h=groundAt(x,z);
   if(h>feet.y+cfg.stepHeight)return false;
   if(blocked(x,z,Math.max(feet.y,h)))return false;
   feet.x=x;feet.z=z;return true;
  };
  const moveX=velocity.x*dt,moveZ=velocity.z*dt;
  if(!tryMove(feet.x+moveX,feet.z+moveZ)){
   // Resolve the longer axis first, then slide along the remaining free axis.
   if(Math.abs(moveX)>=Math.abs(moveZ)){
    if(!tryMove(feet.x+moveX,feet.z))velocity.x=0;
    if(!tryMove(feet.x,feet.z+moveZ))velocity.z=0;
   }else{
    if(!tryMove(feet.x,feet.z+moveZ))velocity.z=0;
    if(!tryMove(feet.x+moveX,feet.z))velocity.x=0;
   }
  }
  const ground=groundAt(feet.x,feet.z);
  if(grounded&&ground>=oldGround-cfg.groundSnap&&ground<=oldY+cfg.stepHeight){
   feet.y=ground;velocity.y=0;
  }else{
   grounded=false;velocity.y-=cfg.gravity*dt;feet.y+=velocity.y*dt;
   if(feet.y<=ground){feet.y=ground;velocity.y=0;grounded=true;landed=true;}
  }
  const moved=Math.hypot(feet.x-oldX,feet.z-oldZ);
  distance+=moved;speed=moved/dt;
  if(speed>.025){
   const desired=Math.atan2(-(feet.x-oldX),-(feet.z-oldZ));
   facing+=angleDelta(facing,desired)*(1-Math.exp(-cfg.turnSpeed*dt));
  }
  locomotion=!grounded?(velocity.y>0?'jump':'fall'):speed<.08?'idle':speed>cfg.walkSpeed+.45?'run':'walk';
 }

 function update(dt,input={}){
  landed=justJumped=false;paused=!!input.paused;
  const jump=!!input.jump,jumpPressed=jump&&!lastJump;lastJump=jump;
  if(paused){velocity.x=velocity.z=0;speed=0;if(grounded)locomotion='idle';return api;}
  if(!Number.isFinite(dt)||dt<=0)return api;
  let remaining=Math.min(dt,cfg.maxFrame),first=true;
  while(remaining>1e-8){const stepDt=Math.min(remaining,cfg.maxStep);step(stepDt,input,first&&jumpPressed);remaining-=stepDt;first=false;}
  return api;
 }

 const api={position:feet,velocity,update,teleport,config:Object.freeze({...cfg}),
  get heading(){return facing;},set heading(value){if(Number.isFinite(value))facing=value;},
  get grounded(){return grounded;},get locomotion(){return locomotion;},get speed(){return speed;},get paused(){return paused;},
  get landed(){return landed;},get justJumped(){return justJumped;},get distance(){return distance;},
  snapshot:()=>({position:feet.toArray(),velocity:velocity.toArray(),heading:facing,grounded,locomotion,speed,paused,distance})};
 teleport(position,facing);
 return api;
}
