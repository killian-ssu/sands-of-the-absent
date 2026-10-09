import {obeliskSupportData as data} from './obelisk-support-data.js';

const local=(p,x,z)=>{const dx=x-p.x,dz=z-p.z,c=Math.cos(p.yaw||0),s=Math.sin(p.yaw||0);return{x:(dx*c-dz*s)/p.s[0],z:(dx*s+dz*c)/p.s[2]};};
function box(p,shape,margin,id){
 const [sx,sy,sz]=p.s,c=Math.cos(p.yaw||0),s=Math.sin(p.yaw||0),x=(shape.min[0]+shape.max[0])*.5*sx,z=(shape.min[2]+shape.max[2])*.5*sz;
 return{x:p.x+x*c+z*s,z:p.z-x*s+z*c,y:p.y+shape.min[1]*sy-margin,w:(shape.max[0]-shape.min[0])*sx+margin*2,d:(shape.max[2]-shape.min[2])*sz+margin*2,h:(shape.max[1]-shape.min[1])*sy+margin*2,yaw:p.yaw||0,id};
}
function surfaceAt(shape,x,z){
 let height=-Infinity;
 for(const [ax,ay,az,bx,by,bz,cx,cy,cz]of shape.topTriangles){
  const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-10)continue;
  const a=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,b=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den,c=1-a-b;
  if(a>=-1e-9&&b>=-1e-9&&c>=-1e-9)height=Math.max(height,a*ay+b*by+c*cy);
 }
 return height;
}

/** Five measured plinth tiers: their real tops support feet; their sides stop
 * walking into the stone. This is independent of the optional house bases. */
export function buildObeliskSupportPlan(placements){
 const colliders=[],cameraColliders=[],instances=[];
 for(const [i,placement]of placements.filter(p=>p.type==='obelisk').entries()){
  const p={...placement,s:Array.isArray(placement.s)?placement.s:[placement.s,placement.s,placement.s]};instances.push(p);
  for(const [j,shape]of data.bases.entries()){
   const id=`obelisk-plinth-${i}-${j}`;
   colliders.push({...box(p,shape,0,id),support:true});
   cameraColliders.push({...box(p,shape,.012,id),cameraOnly:true});
  }
  // The old fixed 19 m box began below all five tiers. Starting the shaft at
  // its measured height leaves the actual pedestal ledges available to stand.
  colliders.push(box(p,data.shaft,0,`obelisk-shaft-${i}`));
 }
 return{version:1,sourceSha:data.sha256,instances,colliders,cameraColliders};
}

export function createObeliskSurfaceQuery(plan){
 return(x,z,base=-Infinity)=>{
  let height=base;
  for(const p of plan.instances){
   const q=local(p,x,z),outer=data.bases[0];
   if(q.x<outer.min[0]||q.x>outer.max[0]||q.z<outer.min[2]||q.z>outer.max[2])continue;
   for(const shape of data.bases){
    if(q.x<shape.min[0]||q.x>shape.max[0]||q.z<shape.min[2]||q.z>shape.max[2])continue;
    const y=surfaceAt(shape,q.x,q.z);if(Number.isFinite(y))height=Math.max(height,p.y+y*p.s[1]);
   }
  }
  return height;
 };
}
