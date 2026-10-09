import {slabSupportData} from './slab-support-data.js';

// Only the authored loose temple slabs opt in. Preserve road paving, all rock
// collision and the visible instances. Each worn top is sampled at feet X/Z,
// after its actual nonuniform scale and rotation, not at the instance centre.
export function createSlabSurfaceQuery(placements){
 const cells=new Map(),cellSize=4;
 for(const p of placements){
  if(p.type!=='slab'||!p.walkableDebris)continue;
  const s=Array.isArray(p.s)?p.s:[p.s,p.s,p.s],co=Math.cos(p.yaw||0),si=Math.sin(p.yaw||0);
  const a=Math.fround(co*s[0]),b=Math.fround(-si*s[0]),c=Math.fround(si*s[2]),d=Math.fround(co*s[2]),sy=Math.fround(s[1]);
  const px=Math.fround(p.x),py=Math.fround(p.y),pz=Math.fround(p.z);
  for(const source of slabSupportData.triangles){
   const v=[];for(let i=0;i<9;i+=3){const x=source[i],y=source[i+1],z=source[i+2];v.push(px+a*x+c*z,py+sy*y,pz+b*x+d*z);}
   const [ax,ay,az,bx,by,bz,cx,cy,cz]=v,abx=bx-ax,abz=bz-az,acx=cx-ax,acz=cz-az,den=abx*acz-abz*acx;
   if(Math.abs(den)<1e-12)continue;
   const t={ax,ay,az,abx,abz,acx,acz,dyB:by-ay,dyC:cy-ay,inv:1/den,minX:Math.min(ax,bx,cx),maxX:Math.max(ax,bx,cx),minZ:Math.min(az,bz,cz),maxZ:Math.max(az,bz,cz)};
   for(let x=Math.floor(t.minX/cellSize);x<=Math.floor(t.maxX/cellSize);x++)for(let z=Math.floor(t.minZ/cellSize);z<=Math.floor(t.maxZ/cellSize);z++){
    const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(t);
   }
  }
 }
 return(x,z,base=-Infinity)=>{
  let top=base;
  for(const t of cells.get(Math.floor(x/cellSize)+','+Math.floor(z/cellSize))||[]){
   if(x<t.minX-1e-7||x>t.maxX+1e-7||z<t.minZ-1e-7||z>t.maxZ+1e-7)continue;
   const dx=x-t.ax,dz=z-t.az,u=(dx*t.acz-dz*t.acx)*t.inv,v=(t.abx*dz-t.abz*dx)*t.inv;
   if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7)top=Math.max(top,t.ay+u*t.dyB+v*t.dyC);
  }
  return top;
 };
}
