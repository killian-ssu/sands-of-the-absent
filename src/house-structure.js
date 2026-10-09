import {houseSupportData} from './house-support-data.js';

function instanceBox(p,shape,id,{cameraOnly=false,margin=.012}={}){
 const s=p.s,co=Math.cos(p.yaw||0),si=Math.sin(p.yaw||0),x=(shape.min[0]+shape.max[0])*.5*s,z=(shape.min[2]+shape.max[2])*.5*s;
 return{x:p.x+x*co+z*si,z:p.z-x*si+z*co,y:p.y+shape.min[1]*s-margin,w:(shape.max[0]-shape.min[0])*s+margin*2,h:(shape.max[1]-shape.min[1])*s+margin*2,d:(shape.max[2]-shape.min[2])*s+margin*2,yaw:p.yaw||0,id,...(cameraOnly?{cameraOnly:true}:{})};
}

/** Real template masonry envelopes. Five separate perimeter walls leave the
 * doorway open; the centre lintel and each arch stone remain separate pieces.
 * These boundaries apply independently of optional ground foundations. */
export function buildHouseStructurePlan(placements){
 const playerColliders=[],cameraColliders=[];
 for(const [index,p]of placements.entries()){
  const data=houseSupportData[p.type];if(!data)continue;
  for(const [name,shape]of Object.entries(data.walls)){
   const wall=instanceBox(p,shape,`house-wall-${index}-${name}`,{cameraOnly:!p.solid});
   // Ground walls already participate in the camera's navigation-collider
   // list. Upper storeys still need their actual masonry for camera-only use.
   (p.solid?playerColliders:cameraColliders).push(wall);
  }
  for(const [name,shape]of[
   ['roof',data.roof],['lintel',data.frontLintel],
   ...data.doorArch.map((s,i)=>['arch-'+i,s]),
   ...(data.cameraMasonry||[]).map((s,i)=>['roof-masonry-'+i,s]),
  ])cameraColliders.push(instanceBox(p,shape,`house-camera-${index}-${name}`,{cameraOnly:true}));
 }
 return{playerColliders,cameraColliders};
}
