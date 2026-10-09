import {Vector3,Box3,Triangle} from 'three';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/** Earliest hit for a camera sphere swept through oriented box colliders. */
export function cameraSegmentFraction(start,end,colliders,radius=.22){
 let nearest=1;
 const pathMinX=Math.min(start.x,end.x),pathMaxX=Math.max(start.x,end.x),pathMinY=Math.min(start.y,end.y),pathMaxY=Math.max(start.y,end.y),pathMinZ=Math.min(start.z,end.z),pathMaxZ=Math.max(start.z,end.z);
 for(const c of colliders){
  if(c.camera===false)continue;
  const cos=Math.cos(c.yaw||0),sin=Math.sin(c.yaw||0),sx=start.x-c.x,sz=start.z-c.z,ex=end.x-c.x,ez=end.z-c.z;
  const extentX=Math.abs(cos)*c.w/2+Math.abs(sin)*c.d/2+radius,extentZ=Math.abs(sin)*c.w/2+Math.abs(cos)*c.d/2+radius;
  if(pathMinX>c.x+extentX||pathMaxX<c.x-extentX||pathMinZ>c.z+extentZ||pathMaxZ<c.z-extentZ||pathMinY>c.y+c.h+radius||pathMaxY<c.y-radius)continue;
  const origins=[sx*cos-sz*sin,start.y, sx*sin+sz*cos];
  const destinations=[ex*cos-ez*sin,end.y,ex*sin+ez*cos];
  const mins=[-c.w/2-radius,c.y-radius,-c.d/2-radius],maxs=[c.w/2+radius,c.y+c.h+radius,c.d/2+radius];
  let near=0,far=1,hit=true;
  for(let axis=0;axis<3;axis++){
   const d=destinations[axis]-origins[axis];
   if(Math.abs(d)<1e-9){if(origins[axis]<mins[axis]||origins[axis]>maxs[axis]){hit=false;break;}continue;}
   let a=(mins[axis]-origins[axis])/d,b=(maxs[axis]-origins[axis])/d;if(a>b)[a,b]=[b,a];
   near=Math.max(near,a);far=Math.min(far,b);if(near>far){hit=false;break;}
  }
  if(hit&&near<nearest)nearest=Math.max(0,near);
 }
 return nearest;
}

/**
 * Orbit/follow camera. yaw 0 looks toward -Z; positive pitch lifts the camera.
 * Collider shape matches navigation.js: {x,z,w,d,y,h,yaw,camera?}.
 * Ground height should describe visible terrain / solid floors, not a camera eye.
 */
export function createThirdPersonCamera(camera,{colliders=[],groundHeight=()=>-Infinity,yaw=0,pitch=.3,minPitch=-.08,maxPitch=1.18,distance=4.8,minDistance=2.1,maxDistance=7.5,targetHeight=1.15,shoulder=.35,radius=.22,sensitivity=.0025,followSpeed=12,framingSpeed=8}={}){
 const lookTarget=new Vector3(),anchor=new Vector3(),desired=new Vector3(),candidate=new Vector3(),previous=new Vector3(),result=new Vector3();
 const returnCandidate=new Vector3(),waypoint=new Vector3();
 let orbitYaw=yaw,orbitPitch=clamp(pitch,minPitch,maxPitch),orbitDistance=clamp(distance,minDistance,maxDistance),initialised=false,obstructed=false,actualDistance=orbitDistance,usedFallback=false;
 const nearbyBoxes=[];
 let collisionBoxes=colliders,selectedYaw=yaw,selectedPitch=pitch;
 const avoidance={active:false,yaw,pitch:orbitPitch,safeSeconds:0,restoring:false,pathBlocked:false,motionLimited:false,predictive:false,visibilityLimited:false,requestedAvailable:0};
 const returnDelay=.5,returnMargin=.55,motionSpeed=24;
 const sightAnchor=new Vector3(),bodyAnchor=new Vector3(),oldAnchor=new Vector3(),anchorVelocity=new Vector3(),futureAnchor=new Vector3(),localGoal=new Vector3(),localBest=new Vector3(),localProbe=new Vector3();
 const localDirections=[];for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)if(x||y||z)localDirections.push(new Vector3(x,y,z).normalize());
 let continuityBlocked=0;
 // Explicit orbit input can require a detour that initially moves away from
 // the requested view. Keep that route, rather than greedily selecting the
 // current safe point forever. Walking still uses the predictive follow path.
 let orbitRoutingRequested=false,routeCooldown=0;
 const orbitRoute={points:[],index:0,goal:new Vector3(),origin:new Vector3(),plans:0,failures:0};
 const followRoute={points:[],index:0,stallSeconds:0,cooldown:0,plans:0,failures:0};
 const viewTriangle=new Triangle(),viewBox=new Box3();
 // A continuous sight fan catches thin columns between prediction samples.
 // The extra vertical band anticipates the 25 cm city stair treads.
 function viewSweepBlocked(p){
  const margin=.08;
  for(const c of nearbyBoxes){
   const r=Math.hypot(c.w,c.d)/2+margin;
   if(Math.max(sightAnchor.x,futureAnchor.x,p.x)<c.x-r||Math.min(sightAnchor.x,futureAnchor.x,p.x)>c.x+r||Math.max(sightAnchor.z,futureAnchor.z,p.z)<c.z-r||Math.min(sightAnchor.z,futureAnchor.z,p.z)>c.z+r)continue;
   const cos=Math.cos(c.yaw||0),sin=Math.sin(c.yaw||0),convert=(v,out)=>{const x=v.x-c.x,z=v.z-c.z;out.set(x*cos-z*sin,v.y,x*sin+z*cos);};
   viewBox.min.set(-c.w/2-margin,c.y-margin,-c.d/2-margin);viewBox.max.set(c.w/2+margin,c.y+c.h+margin,c.d/2+margin);
   for(const h of[.25,0,-.75,-1]){convert(sightAnchor,viewTriangle.a);convert(futureAnchor,viewTriangle.b);convert(p,viewTriangle.c);viewTriangle.a.y+=h;viewTriangle.b.y+=h;if(viewBox.intersectsTriangle(viewTriangle))return true;}
  }
  return false;
 }

 // Sweeping the camera sphere alone does not guarantee the actor stays visible
 // between two endpoints. Test the entire head/hip sight triangle as well.
 function orbitSegmentClear(a,b){
  if(sweepFraction(a,b)<.999999)return false;
  const delta=localProbe.subVectors(b,a),denominator=delta.lengthSq();
  const t=denominator?clamp(candidate.subVectors(anchor,a).dot(delta)/denominator,0,1):0;
  if(candidate.copy(a).addScaledVector(delta,t).distanceTo(anchor)<effectiveMinDistance)return false;
  for(const c of nearbyBoxes){
   const r=Math.hypot(c.w,c.d)/2+.05;
   if(Math.max(sightAnchor.x,a.x,b.x)<c.x-r||Math.min(sightAnchor.x,a.x,b.x)>c.x+r||Math.max(sightAnchor.z,a.z,b.z)<c.z-r||Math.min(sightAnchor.z,a.z,b.z)>c.z+r)continue;
   const co=Math.cos(c.yaw||0),si=Math.sin(c.yaw||0),convert=(v,out)=>{const x=v.x-c.x,z=v.z-c.z;out.set(x*co-z*si,v.y,x*si+z*co);};
   viewBox.min.set(-c.w/2-.05,c.y-.05,-c.d/2-.05);viewBox.max.set(c.w/2+.05,c.y+c.h+.05,c.d/2+.05);
   for(const body of[sightAnchor,bodyAnchor]){convert(body,viewTriangle.a);convert(a,viewTriangle.b);convert(b,viewTriangle.c);if(viewBox.intersectsTriangle(viewTriangle))return false;}
  }
  return true;
 }
 function clearOrbitRoute(){orbitRoute.points.length=0;orbitRoute.index=0;routeCooldown=0;}
 function planOrbitRoute(){
  orbitRoute.plans++;
  const from=previous.clone().sub(anchor),to=desired.clone().sub(anchor);
  const startYaw=Math.atan2(from.x,from.z),endYaw=Math.atan2(to.x,to.z),shortAngle=angleDelta(endYaw,startYaw);
  const startPitch=Math.atan2(from.y,Math.hypot(from.x,from.z));
  const endPitch=Math.atan2(to.y,Math.hypot(to.x,to.z));
  const radii=[Math.max(from.length(),to.length()),from.length(),to.length()*.65,to.length()*.3,effectiveMinDistance+.4].filter((v,i,a)=>v>effectiveMinDistance+.1&&a.findIndex(n=>Math.abs(n-v)<.1)===i);
  const pitches=[startPitch,endPitch,.5,.7,.9,effectiveMaxPitch].map(v=>clamp(v,effectiveMinPitch,effectiveMaxPitch)).filter((v,i,a)=>a.findIndex(n=>Math.abs(n-v)<.02)===i);
  const angles=Math.abs(shortAngle)>.001?[shortAngle,shortAngle-Math.sign(shortAngle)*Math.PI*2]:[0];
  const paths=[];
  const point=(r,p,y)=>new Vector3(Math.sin(y)*Math.cos(p)*r,Math.sin(p)*r,Math.cos(y)*Math.cos(p)*r).add(anchor);
  // A small finite family of spherical arcs is sufficient for isolated rocks,
  // pillars and short walls. Sort by full path length so lifting over a rock
  // wins over a gratuitous full turn; never increase the motion speed to do it.
  for(const r of radii)for(const p of pitches)for(const angle of angles){
   const first=point(r,p,startYaw),last=point(r,p,startYaw+angle),steps=Math.max(1,Math.ceil(Math.abs(angle)/.12));
   const length=previous.distanceTo(first)+steps*2*r*Math.cos(p)*Math.sin(Math.abs(angle)/(2*steps))+last.distanceTo(desired);
   paths.push({r,p,angle,first,last,steps,length});
  }
  paths.sort((a,b)=>a.length-b.length);
  for(const path of paths){
   if(!orbitSegmentClear(previous,path.first)||!orbitSegmentClear(path.last,desired))continue;
   const points=[path.first];let clear=true;
   for(let i=1;i<=path.steps;i++){
    const next=point(path.r,path.p,startYaw+path.angle*i/path.steps);
    if(!orbitSegmentClear(points.at(-1),next)){clear=false;break;}points.push(next);
   }
   if(!clear)continue;
   points.push(desired.clone());orbitRoute.points=points;orbitRoute.index=0;orbitRoute.goal.copy(desired);orbitRoute.origin.copy(anchor);return true;
  }
  orbitRoute.failures++;return false;
 }
 function followOrbitRoute(dt){
  routeCooldown=Math.max(0,routeCooldown-dt);
  if(!orbitRoutingRequested)return false;
  // A stationary orbit is the only mode this planner owns. Predictive walking
  // and room framing keep their established collision behaviour.
  if(anchorVelocity.lengthSq()>.04){clearOrbitRoute();return false;}
  if(orbitRoute.points.length&&(orbitRoute.origin.distanceTo(anchor)>.08||orbitRoute.goal.distanceTo(desired)>.75))clearOrbitRoute();
  if(!orbitRoute.points.length){
   if(orbitSegmentClear(previous,desired)){
    // A stationary user's complete, swept and body-visible path is stronger
    // evidence than the walking predictor's extra lower-body band. Following
    // that predictor here can choose the current point forever after a small
    // stair clearance adjustment. Keep the requested view while stationary.
    const alpha=1-Math.exp(-followSpeed*dt),limit=motionSpeed*dt;
    result.copy(previous).lerp(desired,alpha);
    if(result.distanceTo(previous)>limit)result.sub(previous).setLength(limit).add(previous);
    return true;
   }
   if(routeCooldown>0)return false;
   const found=planOrbitRoute();routeCooldown=.2;if(!found)return false;
  }
  while(orbitRoute.index<orbitRoute.points.length&&previous.distanceTo(orbitRoute.points[orbitRoute.index])<.035)orbitRoute.index++;
  if(orbitRoute.index>=orbitRoute.points.length){clearOrbitRoute();return false;}
  const next=orbitRoute.points[orbitRoute.index];
  const distance=previous.distanceTo(next),step=Math.min(motionSpeed*dt,distance);
  result.copy(next).sub(previous).setLength(step).add(previous);
  if(!orbitSegmentClear(previous,result)){clearOrbitRoute();return false;}
  avoidance.predictive=true;
  return true;
 }

 function clearFollowRoute(){followRoute.points.length=0;followRoute.index=0;followRoute.stallSeconds=0;followRoute.cooldown=0;}
 function planFollowRoute(){
  followRoute.plans++;
  // A convex corner sometimes requires an initial step away from the target.
  // The ordinary follow scorer cannot take that step. Search only the nearest
  // blocking box, retaining a short, world-space detour while the actor walks.
  const blockers=nearbyBoxes.map(c=>({c,t:cameraSegmentFraction(previous,desired,[c],radius)}))
   .filter(v=>v.t<1&&previous.distanceTo(desired)*v.t<6).sort((a,b)=>a.t-b.t);
  const paths=[];
  for(const {c}of blockers.slice(0,2)){
   const co=Math.cos(c.yaw||0),si=Math.sin(c.yaw||0),pad=radius+.12;
   const heights=[previous.y];if(c.y+c.h+pad>previous.y&&c.y+c.h+pad<previous.y+4)heights.push(c.y+c.h+pad);
   for(const y of heights){
    const corners=[[-1,-1],[-1,1],[1,1],[1,-1]].map(([x,z])=>{x*=c.w/2+pad;z*=c.d/2+pad;return new Vector3(c.x+x*co+z*si,y,c.z-x*si+z*co);});
    for(let i=0;i<4;i++){
     paths.push([corners[i]]);
     for(const direction of[-1,1])for(const count of[2,3])paths.push(Array.from({length:count},(_,n)=>corners[(i+n*direction+4)%4]));
    }
   }
  }
  const length=path=>{let last=previous,total=0;for(const p of path){total+=last.distanceTo(p);last=p;}return total+last.distanceTo(desired);};
  paths.sort((a,b)=>length(a)-length(b));
  for(const path of paths){
   let from=previous,clear=true;
   for(const to of[...path,desired]){if(!orbitSegmentClear(from,to)){clear=false;break;}from=to;}
   if(clear){followRoute.points=path.map(p=>p.clone());followRoute.index=0;return true;}
  }
  followRoute.failures++;return false;
 }
 function followDetour(dt){
  if(!followRoute.points.length)return false;
  // Release as soon as the requested view has a safe continuous return. The
  // detour never takes ownership of mouse orbit, room framing, or teleport.
  if(orbitSegmentClear(previous,desired)){clearFollowRoute();return false;}
  while(followRoute.index<followRoute.points.length&&previous.distanceTo(followRoute.points[followRoute.index])<.025)followRoute.index++;
  if(followRoute.index>=followRoute.points.length){clearFollowRoute();return false;}
  const next=followRoute.points[followRoute.index],distance=previous.distanceTo(next);
  result.copy(next).sub(previous).setLength(Math.min(motionSpeed*dt,distance)).add(previous);
  if(!orbitSegmentClear(previous,result)){clearFollowRoute();return false;}
  avoidance.predictive=true;return true;
 }
 function recoverStalledFollow(dt){
  followRoute.cooldown=Math.max(0,followRoute.cooldown-dt);
  const stalled=result.distanceToSquared(previous)<1e-8&&previous.distanceTo(desired)>.5&&sweepFraction(previous,desired)<.999999;
  followRoute.stallSeconds=stalled?followRoute.stallSeconds+dt:0;
  if(followRoute.stallSeconds>=.12&&followRoute.cooldown===0){
   const found=planFollowRoute();followRoute.cooldown=.35;
   if(found)followDetour(dt);
  }
 }
 function continuousStep(dt){
  if(followOrbitRoute(dt))return;
  const limit=motionSpeed*dt,alpha=1-Math.exp(-followSpeed*dt);
  localGoal.copy(previous).lerp(desired,alpha);
  if(localGoal.distanceTo(previous)>limit)localGoal.sub(previous).setLength(limit).add(previous);
  // At the maximum 25 m boom, a safe retraction can need a full second.
  // Two seconds of forecast gives it time without snapping on the last frame.
  futureAnchor.copy(sightAnchor).addScaledVector(anchorVelocity,2);
  const futureFraction=cameraSegmentFraction(sightAnchor,futureAnchor,nearbyBoxes,.32);if(futureFraction<1){
   localProbe.copy(futureAnchor);returnCandidate.copy(sightAnchor);const dx=(localProbe.x-sightAnchor.x)/8,dz=(localProbe.z-sightAnchor.z)/8,dy=(localProbe.y-sightAnchor.y)/8;
   for(let i=0;i<8;i++){futureAnchor.copy(returnCandidate);futureAnchor.x+=dx;futureAnchor.y+=dy;futureAnchor.z+=dz;
    if(cameraSegmentFraction(returnCandidate,futureAnchor,nearbyBoxes,.32)<1){futureAnchor.copy(returnCandidate);futureAnchor.x+=dx;if(cameraSegmentFraction(returnCandidate,futureAnchor,nearbyBoxes,.32)<1)futureAnchor.x=returnCandidate.x;futureAnchor.z+=dz;if(cameraSegmentFraction(returnCandidate,futureAnchor,nearbyBoxes,.32)<1)futureAnchor.z=returnCandidate.z;futureAnchor.y+=dy;}
    returnCandidate.copy(futureAnchor);
   }
  }
  // The composition target may be metres above the actor. Visibility uses
  // actual head/hips instead; the camera itself still has a full swept sphere.
  // Sweep the future sight triangle, not just a few samples that miss trunks.
  const visible=p=>cameraSegmentFraction(sightAnchor,p,nearbyBoxes,.05)>.999999&&cameraSegmentFraction(bodyAnchor,p,nearbyBoxes,.05)>.999999;
  const risk=p=>viewSweepBlocked(p)?6:0;
  if(risk(localGoal)>0){
   avoidance.predictive=true;let waypointScore=Infinity;waypoint.copy(desired);
   const currentYaw=Math.atan2(previous.x-anchor.x,previous.z-anchor.z);
   for(const yawOffset of[0,-.2,.2,-.4,.4,-.7,.7,-1,1,-1.5,1.5,Math.PI])for(const elevation of[effectivePitch,.12,.3,.68,1.08])for(const distanceRatio of[1,.65,.3,.12]){
    endpoint(localProbe,currentYaw+yawOffset,elevation);localProbe.sub(anchor).multiplyScalar(distanceRatio).add(anchor);
    const score=localProbe.distanceTo(previous)+localProbe.distanceTo(desired)*.15;
    if(score>=waypointScore||localProbe.distanceTo(anchor)<effectiveMinDistance||risk(localProbe)>0||!visible(localProbe)||sweepFraction(previous,localProbe)<.999999)continue;
    waypointScore=score;waypoint.copy(localProbe);
   }
   if(waypointScore<Infinity)localGoal.copy(previous).lerp(waypoint,alpha);
   if(localGoal.distanceTo(previous)>limit)localGoal.sub(previous).setLength(limit).add(previous);
  }
  let best=Infinity,found=false;
  const consider=p=>{
   if(p.distanceTo(anchor)<effectiveMinDistance||sweepFraction(previous,p)<.999999||!visible(p))return;
   const score=p.distanceTo(localGoal)+risk(p);if(score<best){best=score;localBest.copy(p);found=true;}
  };
  consider(localGoal);
  if(found&&best<1e-8){result.copy(localGoal);return;}
  consider(previous);
  for(const direction of localDirections){localProbe.copy(previous).addScaledVector(direction,limit);consider(localProbe);}
  if(found)result.copy(localBest);else{
   // If a moving body or a stair changes visibility faster than the camera
   // can move, keep the velocity bound and recover the most visible view.
   best=Infinity;
   const recover=p=>{if(p.distanceTo(anchor)<effectiveMinDistance||sweepFraction(previous,p)<.999999)return;const h=cameraSegmentFraction(sightAnchor,p,nearbyBoxes,.05),b=cameraSegmentFraction(bodyAnchor,p,nearbyBoxes,.05),score=(h<1?20:0)+(b<1?10:0)+(1-h)*6+(1-b)*3+p.distanceTo(localGoal);if(score<best){best=score;localBest.copy(p);}};
   recover(localGoal);recover(previous);for(const direction of localDirections){localProbe.copy(previous).addScaledVector(direction,limit);recover(localProbe);}
   result.copy(best<Infinity?localBest:previous);continuityBlocked++;avoidance.visibilityLimited=true;
  }
 }

 const angleDelta=(to,from)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
 const approachAngle=(from,to,dt,rate)=>{const delta=angleDelta(to,from);return from+Math.sign(delta)*Math.min(Math.abs(delta)*(1-Math.exp(-5*dt)),rate*dt);};
 function clearAvoidance(){avoidance.active=false;avoidance.safeSeconds=0;avoidance.restoring=false;avoidance.pathBlocked=false;}
 // Framing belongs to the room; orbit belongs to the user's mouse and wheel.
 // Keep both states so entering/leaving a room never overwrites user controls.
 const framing={distanceScale:1,pitchOffset:0,targetHeight,minDistance},framingGoal={...framing};
 let effectiveDistance=orbitDistance,effectivePitch=orbitPitch,effectiveMinDistance=minDistance,effectiveMinPitch=minPitch,effectiveMaxPitch=maxPitch;
 function updateFraming(dt,snap){
  const alpha=snap?1:1-Math.exp(-framingSpeed*clamp(Number(dt)||0,0,.1));
  for(const key of Object.keys(framing))framing[key]+=(framingGoal[key]-framing[key])*alpha;
  effectiveMinDistance=Math.min(framing.minDistance,2.2);
  effectiveDistance=clamp(orbitDistance*framing.distanceScale,effectiveMinDistance,Math.max(maxDistance,effectiveMinDistance));
  effectiveMinPitch=clamp(minPitch+framing.pitchOffset,minPitch,maxPitch);
  effectiveMaxPitch=clamp(maxPitch+framing.pitchOffset,minPitch,maxPitch);
  effectivePitch=clamp(orbitPitch+framing.pitchOffset,minPitch,maxPitch);
 }

 // A point-height check misses the side of the sphere at a stair riser.
 // Corner probes reject far-away floors cheaply. Near a raised surface, find
 // its boundary inside the footprint and use the sphere's rounded underside;
 // treating the entire footprint as a tall box would push safe views inward.
 function floorIntersectsSphere(x,y,z){
  const centre=groundHeight(x,z);
  if(Number.isFinite(centre)&&y<centre+radius)return true;
  if(radius<=0)return false;
  for(const sx of[-1,1])for(const sz of[-1,1]){
   const edgeX=x+sx*radius,edgeZ=z+sz*radius,height=groundHeight(edgeX,edgeZ);
   if(!Number.isFinite(height)||height+radius<=y||height<=centre)continue;
   if(!Number.isFinite(centre))return true;
   const level=(centre+height)/2;
   const boundary=(alongX)=>{
    const sample=t=>alongX?groundHeight(x+sx*radius*t,edgeZ):groundHeight(edgeX,z+sz*radius*t);
    if(sample(0)>=level)return 0;
    let lo=0,hi=1;for(let i=0;i<10;i++){const mid=(lo+hi)/2;if(sample(mid)>=level)hi=mid;else lo=mid;}
    // Keep the boundary on its low side for a small conservative error (<.22 mm).
    return lo*radius;
   };
   const dx=boundary(true),dz=boundary(false),horizontalSquared=dx*dx+dz*dz;
   if(horizontalSquared>=radius*radius)continue;
   // For smooth slopes this uses the higher sampled height earlier than the
   // real surface, so it errs toward clearance; for flat treads it measures
   // the actual riser/corner rather than flattening the camera's sphere.
   if(y<height+Math.sqrt(radius*radius-horizontalSquared))return true;
  }
  return false;
 }
 function sweepFraction(a,b){
  let fraction=cameraSegmentFraction(a,b,nearbyBoxes,radius);
  const length=a.distanceTo(b),steps=Math.max(2,Math.ceil(length/.18));
  for(let i=1;i<=steps;i++){
   const t=i/steps;if(t>fraction)break;
   const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,y=a.y+(b.y-a.y)*t;
   if(floorIntersectsSphere(x,y,z)){
    // Locate the contact within this sample interval. Otherwise adding sphere
    // support would retract a whole 18 cm even when only its final millimetres
    // approach a riser, unnecessarily changing a previously safe composition.
    let lo=(i-1)/steps,hi=t;
    for(let n=0;n<9;n++){const mid=(lo+hi)/2;if(floorIntersectsSphere(a.x+(b.x-a.x)*mid,a.y+(b.y-a.y)*mid,a.z+(b.z-a.z)*mid))hi=mid;else lo=mid;}
    fraction=Math.min(fraction,lo);break;
   }
  }
  return fraction;
 }
 function endpoint(out,azimuth,elevation){
  const cp=Math.cos(elevation);
  out.set(anchor.x+Math.sin(azimuth)*cp*effectiveDistance+Math.cos(azimuth)*shoulder,
   anchor.y+Math.sin(elevation)*effectiveDistance,
   anchor.z+Math.cos(azimuth)*cp*effectiveDistance-Math.sin(azimuth)*shoulder);
  return out;
 }
 function safeDistance(azimuth,elevation){
  endpoint(candidate,azimuth,elevation);return Math.max(0,anchor.distanceTo(candidate)*sweepFraction(anchor,candidate)-.045);
 }
 function chooseBoom(dt){
  const requested=safeDistance(orbitYaw,effectivePitch);avoidance.requestedAvailable=requested;
  selectedYaw=orbitYaw;selectedPitch=effectivePitch;usedFallback=false;avoidance.pathBlocked=false;
  let available=requested;
  if(avoidance.active){
   selectedYaw=avoidance.yaw;selectedPitch=clamp(avoidance.pitch+framing.pitchOffset,effectiveMinPitch,effectiveMaxPitch);
   available=safeDistance(selectedYaw,selectedPitch);
   // Keep a good emergency angle until the original user view is continuously
   // clear. Hysteresis is measured in simulation time, including during room
   // framing changes; pausing never consumes the half-second waiting period.
   const required=Math.min(effectiveMinDistance+returnMargin,effectiveDistance-.05);
   avoidance.safeSeconds=requested>=required?Math.min(returnDelay,avoidance.safeSeconds+dt):0;
   avoidance.restoring=avoidance.safeSeconds>=returnDelay;
   if(avoidance.restoring){
    const nextYaw=approachAngle(avoidance.yaw,orbitYaw,dt,1.25),nextPitch=approachAngle(avoidance.pitch,orbitPitch,dt,.7);
    const elevation=clamp(nextPitch+framing.pitchOffset,effectiveMinPitch,effectiveMaxPitch),nextDistance=safeDistance(nextYaw,elevation);
    endpoint(returnCandidate,nextYaw,elevation);const returnLength=Math.min(nextDistance,anchor.distanceTo(returnCandidate));returnCandidate.sub(anchor).setLength(returnLength).add(anchor);
    // Two safe endpoints do not imply a safe path around a pillar. Returning
    // is optional: hold the good angle if this next arc step crosses anything.
    if(nextDistance>=Math.min(effectiveMinDistance,effectiveDistance-.05)&&sweepFraction(camera.position,returnCandidate)>.999999){
     avoidance.yaw=selectedYaw=nextYaw;avoidance.pitch=nextPitch;selectedPitch=elevation;available=nextDistance;
     if(Math.abs(angleDelta(orbitYaw,nextYaw))<.001&&Math.abs(nextPitch-orbitPitch)<.001){clearAvoidance();selectedYaw=orbitYaw;selectedPitch=effectivePitch;available=requested;}
    }else{avoidance.safeSeconds=0;avoidance.restoring=false;avoidance.pathBlocked=true;}
   }
  }
  if(available<effectiveMinDistance){
   // A close wall must not turn the camera into a first-person view. Try a
   // shoulder-side angle or an overhead view before accepting a tight space.
   const options=[[0,effectivePitch],[0,.68],[.12,effectivePitch],[-.12,effectivePitch],[.24,effectivePitch],[-.24,effectivePitch],[.4,effectivePitch],[-.4,effectivePitch],[.65,effectivePitch],[-.65,effectivePitch],[1.25,.5],[-1.25,.5],[0,1.16],[Math.PI,.5]];
   let best=available,bestScore=-Infinity;
   for(const [offset,rawElevation]of options){
    const elevation=clamp(rawElevation,effectiveMinPitch,effectiveMaxPitch);
    const d=safeDistance(orbitYaw+offset,elevation),score=Math.min(d,effectiveMinDistance+.55)-Math.abs(offset)*.1-Math.abs(elevation-effectivePitch)*.12;
    if(d>=effectiveMinDistance&&score>bestScore){best=d;bestScore=score;selectedYaw=orbitYaw+offset;selectedPitch=elevation;}
    else if(bestScore===-Infinity&&d>best){best=d;selectedYaw=orbitYaw+offset;selectedPitch=elevation;}
   }
   available=best;
   const changed=Math.abs(angleDelta(selectedYaw,orbitYaw))>.000001||Math.abs(selectedPitch-effectivePitch)>.000001;
   if(changed){avoidance.active=true;avoidance.yaw=selectedYaw;avoidance.pitch=clamp(selectedPitch-framing.pitchOffset,minPitch,maxPitch);avoidance.safeSeconds=0;avoidance.restoring=false;}
   else clearAvoidance();
  }
  usedFallback=avoidance.active;
  endpoint(desired,selectedYaw,selectedPitch);
  const wanted=anchor.distanceTo(desired),length=Math.min(available,wanted);
  desired.sub(anchor).setLength(length).add(anchor);
  obstructed=length<wanted-.1;return length;
 }
 function update(dt,player,{paused=false,snap=false}={}){
  if(paused&&!snap)return api;
  const p=player.position||player;
  const step=clamp(Number(dt)||0,0,.1);if(snap){clearAvoidance();clearOrbitRoute();clearFollowRoute();orbitRoutingRequested=false;}
  updateFraming(dt,snap||!initialised);
  oldAnchor.copy(sightAnchor);anchor.set(p.x,p.y+framing.targetHeight,p.z);sightAnchor.set(p.x,p.y+1.65,p.z);bodyAnchor.set(p.x,p.y+.9,p.z);
  if(initialised&&!snap&&step>0){candidate.subVectors(sightAnchor,oldAnchor).multiplyScalar(1/step);anchorVelocity.lerp(candidate,1-Math.exp(-8*step));}else anchorVelocity.set(0,0,0);
  const reach=effectiveDistance+3,minX=Math.min(anchor.x-reach,camera.position.x-1),maxX=Math.max(anchor.x+reach,camera.position.x+1),minZ=Math.min(anchor.z-reach,camera.position.z-1),maxZ=Math.max(anchor.z+reach,camera.position.z+1);
  nearbyBoxes.length=0;
  for(const c of collisionBoxes){const r=Math.hypot(c.w,c.d)/2;if(c.camera!==false&&c.x+r>=minX&&c.x-r<=maxX&&c.z+r>=minZ&&c.z-r<=maxZ)nearbyBoxes.push(c);}
  chooseBoom(step);
  avoidance.motionLimited=avoidance.predictive=avoidance.visibilityLimited=false;
  previous.copy(camera.position);
  if(!initialised||snap){result.copy(desired);initialised=true;}
  else{
   if(!followDetour(step)){continuousStep(step);recoverStalledFollow(step);}
   avoidance.motionLimited=avoidance.predictive||avoidance.visibilityLimited||result.distanceToSquared(desired)>.0001;
  }
  camera.position.copy(result);actualDistance=anchor.distanceTo(result);
  // A close third-person view must frame the person, not their distant skyline.
  lookTarget.copy(anchor);lookTarget.y=p.y+Math.min(framing.targetHeight,1.2+Math.max(0,actualDistance-3)*.3);
  camera.lookAt(lookTarget);
  return api;
 }
 function setOrbit({yaw:nextYaw=orbitYaw,pitch:nextPitch=orbitPitch,distance:nextDistance=orbitDistance}={}){
  if(Number.isFinite(nextYaw))orbitYaw=nextYaw;
  if(Number.isFinite(nextPitch))orbitPitch=clamp(nextPitch,minPitch,maxPitch);
  if(Number.isFinite(nextDistance))orbitDistance=clamp(nextDistance,minDistance,maxDistance);
  clearAvoidance();clearOrbitRoute();clearFollowRoute();orbitRoutingRequested=initialised;
  return api;
 }
 function rotate(dx,dy){
  const nextYaw=orbitYaw-(Number.isFinite(dx)?dx:0)*sensitivity,nextPitch=clamp(orbitPitch+(Number.isFinite(dy)?dy:0)*sensitivity,minPitch,maxPitch);
  if(avoidance.active){avoidance.yaw+=nextYaw-orbitYaw;avoidance.pitch=clamp(avoidance.pitch+nextPitch-orbitPitch,minPitch,maxPitch);avoidance.safeSeconds=0;avoidance.restoring=false;}
  if(nextYaw!==orbitYaw||nextPitch!==orbitPitch){clearFollowRoute();orbitRoutingRequested=initialised;}
  orbitYaw=nextYaw;orbitPitch=nextPitch;return api;
 }
 /** Smooth room framing; setFraming() restores the constructor framing. */
 function setFraming({distanceScale=1,pitchOffset=0,targetHeight:nextTargetHeight=targetHeight,minDistance:nextMinDistance=minDistance}={}){
  if(![distanceScale,pitchOffset,nextTargetHeight,nextMinDistance].every(Number.isFinite)||distanceScale<=0||nextMinDistance<=0)throw new TypeError('Camera framing requires finite values and positive distances.');
  Object.assign(framingGoal,{distanceScale,pitchOffset,targetHeight:nextTargetHeight,minDistance:nextMinDistance});
  return api;
 }
 const api={update,snap:player=>update(0,player,{snap:true}),setOrbit,setFraming,
  rotate,
  zoom:delta=>{if(Number.isFinite(delta)){orbitDistance=clamp(orbitDistance+delta,minDistance,maxDistance);clearFollowRoute();}avoidance.safeSeconds=0;avoidance.restoring=false;return api;},setColliders:boxes=>{collisionBoxes=boxes||[];clearFollowRoute();return api;},
  get yaw(){return orbitYaw;},get pitch(){return orbitPitch;},get distance(){return orbitDistance;},get actualDistance(){return actualDistance;},
  get movementYaw(){return Math.atan2(camera.position.x-anchor.x,camera.position.z-anchor.z);},
  get obstructed(){return obstructed;},get usedFallback(){return usedFallback;},
  snapshot:()=>({position:camera.position.toArray(),target:lookTarget.toArray(),framingTarget:anchor.toArray(),yaw:orbitYaw,pitch:orbitPitch,distance:orbitDistance,actualDistance,obstructed,usedFallback,selectedYaw,selectedPitch,
   orbitPath:{active:orbitRoute.index<orbitRoute.points.length,requested:orbitRoutingRequested,remainingPoints:Math.max(0,orbitRoute.points.length-orbitRoute.index),plans:orbitRoute.plans,failures:orbitRoute.failures},
   followPath:{active:followRoute.index<followRoute.points.length,remainingPoints:Math.max(0,followRoute.points.length-followRoute.index),stallSeconds:followRoute.stallSeconds,plans:followRoute.plans,failures:followRoute.failures},
   avoidance:{...avoidance,continuityBlocked,motionSpeed,requiredSafeSeconds:returnDelay,temporaryPitch:clamp(avoidance.pitch+framing.pitchOffset,effectiveMinPitch,effectiveMaxPitch)},
   framing:{...framing},framingGoal:{...framingGoal},effective:{distance:effectiveDistance,pitch:effectivePitch,targetHeight:framing.targetHeight,minDistance:effectiveMinDistance}})};
 return api;
}
