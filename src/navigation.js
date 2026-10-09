import {walkHeight} from './layout.js';
import {buildHouseFoundationPlan,createHouseSurfaceQuery} from './house-foundations.js';
import {buildHouseStructurePlan} from './house-structure.js';
import {buildObeliskSupportPlan,createObeliskSurfaceQuery} from './obelisk-support.js';
import {createPalmCameraColliders} from './palm-camera-proxy.js';
import {architecturalLandings} from './architecture-support.js';
import {createSlabSurfaceQuery} from './slab-support.js';
export function createNavigation(placements,{foundationPlan=placements.some(p=>p.foundationSourceIndex!==undefined)?buildHouseFoundationPlan(placements):null,obeliskPlan=buildObeliskSupportPlan(placements)}={}){
 const extraSurface=foundationPlan?createHouseSurfaceQuery(foundationPlan):null;
 const houseStructure=foundationPlan?.structure??buildHouseStructurePlan(placements);
 const obeliskSurface=createObeliskSurfaceQuery(obeliskPlan);
 const slabSurface=createSlabSurfaceQuery(placements);
 const getSurfaceHeight=(x,z,base=walkHeight(x,z))=>slabSurface(x,z,obeliskSurface(x,z,extraSurface?extraSurface(x,z,base):base));
 const colliders=[...architecturalLandings,...obeliskPlan.colliders,...houseStructure.playerColliders,...(foundationPlan?[...foundationPlan.bases,...foundationPlan.steps,...foundationPlan.posts.map(p=>({x:p.x,z:p.z,y:p.y,h:p.h,w:p.radius*2,d:p.radius*2,id:p.id}))]:[])];
 const boxCollider=(x,z,w,d,y=0,h=20,yaw=0)=>colliders.push({x,z,w,d,y,h,yaw});
 // Temple doorway gaps remain open; closed walls sit behind and beside the porch.
 for(const x of[-56,-43,-31,-18])boxCollider(x,11,2.1,2.1,0,16);
 boxCollider(-37,-16.5,40,1.8,0,18);boxCollider(-57.7,-4,1.4,28,0,18);boxCollider(-16.3,-4,1.4,28,0,18);
 boxCollider(-47.35,-5.45,2.05,2.05,2.3,13);boxCollider(-26.65,-5.45,2.05,2.05,2.3,13);boxCollider(-37,-7.75,6.4,6.4,2.3,3.5);
 for(const p of placements){
  if(p.type==='ruinwall')boxCollider(p.x,p.z,9,1.8,p.y,6,p.yaw);
  if(p.type==='palm')boxCollider(p.x,p.z,.55*p.s,.55*p.s,p.y,12*p.s);
  if(p.type==='gate')for(const side of[-1,1]){const dx=side*5.8*p.s;boxCollider(p.x+dx*Math.cos(p.yaw),p.z-dx*Math.sin(p.yaw),2.7*p.s,2.8*p.s,p.y,13*p.s,p.yaw);}
  if(p.type.startsWith('rock')){const s=Array.isArray(p.s)?p.s:[p.s,p.s,p.s];if(s[1]>.65)boxCollider(p.x,p.z,1.65*s[0],1.4*s[2],p.y,1.1*s[1],p.yaw);}
 }
 function blocked(x,z,feet){if(x<-115||x>121||z<-164||z>105)return true;if(((x-45)/24)**2+((z-5)/34)**2<.86**2)return true;for(const c of colliders){if(feet>c.y+c.h||(c.support&&feet+.55>=c.y+c.h-.002)||feet+1.6<c.y)continue;const dx=x-c.x,dz=z-c.z,cos=Math.cos(c.yaw),sin=Math.sin(c.yaw),lx=dx*cos-dz*sin,lz=dx*sin+dz*cos;if(Math.abs(lx)<c.w/2+.32&&Math.abs(lz)<c.d/2+.32)return true;}return false;}
 function auditNavigation(){
  const minX=-110,minZ=-156,nx=230,nz=260,startX=3,startZ=82;
  const valid=new Uint8Array(nx*nz),height=new Float32Array(nx*nz),prev=new Int32Array(nx*nz).fill(-1);
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){const x=minX+ix,z=minZ+iz,id=iz*nx+ix,h=getSurfaceHeight(x,z);height[id]=h;valid[id]=blocked(x,z,h)?0:1;}
  const start=(startZ-minZ)*nx+startX-minX,queue=new Int32Array(nx*nz);let head=0,tail=1;queue[0]=start;prev[start]=start;
  // A metre-wide audit edge can cross three valid 25 cm treads. Check the
  // intervening surfaces before calling its total rise an impassable ledge.
  const canClimbEdge=(ix,iz,dx,dz,fromHeight)=>{
   let previousHeight=fromHeight;
   for(let i=1;i<=5;i++){
    const x=minX+ix+dx*i/5,z=minZ+iz+dz*i/5,h=getSurfaceHeight(x,z);
    if(Math.abs(h-previousHeight)>.55||blocked(x,z,h))return false;
    previousHeight=h;
   }
   return true;
  };
  while(head<tail){const id=queue[head++],ix=id%nx,iz=Math.floor(id/nx);for(const [dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){const xx=ix+dx,zz=iz+dz;if(xx<0||xx>=nx||zz<0||zz>=nz)continue;const next=zz*nx+xx;if(prev[next]!==-1||!valid[next]||!canClimbEdge(ix,iz,dx,dz,height[id]))continue;prev[next]=id;queue[tail++]=next;}}
  const routes=[['temple',-37,0],['city',14,-113],['oasis',25,25]].map(([id,x,z])=>{
   let cursor=(z-minZ)*nx+x-minX,steps=0,blockedSamples=0;const connected=prev[cursor]!==-1;
   if(connected)while(cursor!==start&&steps<nx*nz){
    const next=prev[cursor],ax=minX+cursor%nx,az=minZ+Math.floor(cursor/nx),bx=minX+next%nx,bz=minZ+Math.floor(next/nx);
    for(let s=0;s<=10;s++){const xx=ax+(bx-ax)*s/10,zz=az+(bz-az)*s/10;if(blocked(xx,zz,getSurfaceHeight(xx,zz)))blockedSamples++;}
    steps++;cursor=next;
   }
   return{id,connected,pathMeters:connected?steps:null,blockedSamples};
  });
  return{routes,reachableSquareMeters:tail,wallStops:blocked(-57.7,-4,2.3)&&blocked(30,-118,25),templeEntryOpen:!blocked(-37,11,2.3),waterStops:blocked(45,5,-.52),boundsStop:blocked(130,0,0)};
 }
 return {colliders,blocked,getSurfaceHeight,foundationPlan,obeliskPlan,cameraColliders:[...houseStructure.cameraColliders,...obeliskPlan.cameraColliders,...createPalmCameraColliders(placements)],navigation:auditNavigation()};
}
