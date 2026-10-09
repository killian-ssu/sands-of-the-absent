import {architectureSupportData} from './architecture-support-data.js';

// These are the same authored placements used by createLayout. The source data
// contains the actual exported bevelled floor triangles, not nominal deck boxes.
export const architecturePlacements=Object.freeze([
 Object.freeze({type:'temple',x:-37,y:0,z:-2,s:1.15,yaw:0}),
 Object.freeze({type:'citadel',x:18,y:.15,z:-105,s:Object.freeze([1,1.8,1]),yaw:0}),
]);

// The final stair previously ended in an invisible 25 m walking rectangle.
// This small landing physically joins its last tread to the existing top floor.
// The side buildings, stair and rear platform support its edges.
export const architecturalLandings=Object.freeze([
 Object.freeze({id:'city-upper-landing',x:18,y:24.7,z:-113.3,w:14.5,h:.4,d:2.9,yaw:0,support:true}),
]);

const pieces=[];
for(const p of architecturePlacements){
 const scale=Array.isArray(p.s)?p.s:[p.s,p.s,p.s],sx=Math.fround(scale[0]),sy=Math.fround(scale[1]),sz=Math.fround(scale[2]);
 // Authored architecture has no yaw. Match Float32 GPU instance translations
 // and scales, including the nonuniform height of the old city.
 const x=Math.fround(p.x),y=Math.fround(p.y),z=Math.fround(p.z);
 for(const surface of architectureSupportData[p.type].surfaces){
  const triangles=surface.topTriangles.map(v=>{
   const [ax,ay,az,bx,by,bz,cx,cy,cz]=v.map((n,i)=>n*[sx,sy,sz][i%3]+[x,y,z][i%3]);
   const abx=bx-ax,abz=bz-az,acx=cx-ax,acz=cz-az,den=abx*acz-abz*acx;
   if(Math.abs(den)<1e-12)return null;
   return {ax,az,ay,abx,abz,acx,acz,dyB:by-ay,dyC:cy-ay,inv:1/den,
    minX:Math.min(ax,bx,cx),maxX:Math.max(ax,bx,cx),minZ:Math.min(az,bz,cz),maxZ:Math.max(az,bz,cz)};
  }).filter(Boolean);
  pieces.push({minX:x+surface.min[0]*sx,maxX:x+surface.max[0]*sx,minZ:z+surface.min[2]*sz,maxZ:z+surface.max[2]*sz,maxY:y+surface.max[1]*sy,triangles});
 }
}
pieces.sort((a,b)=>b.maxY-a.maxY);

export function architectureSurfaceHeight(x,z,base=-Infinity){
 let height=base;
 for(const p of pieces){
  if(height>=p.maxY||x<p.minX||x>p.maxX||z<p.minZ||z>p.maxZ)continue;
  for(const t of p.triangles){
   if(x<t.minX-1e-7||x>t.maxX+1e-7||z<t.minZ-1e-7||z>t.maxZ+1e-7)continue;
   const dx=x-t.ax,dz=z-t.az,u=(dx*t.acz-dz*t.acx)*t.inv,v=(t.abx*dz-t.abz*dx)*t.inv;
   if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7)height=Math.max(height,t.ay+u*t.dyB+v*t.dyC);
  }
 }
 for(const p of architecturalLandings)if(Math.abs(x-p.x)<=p.w/2&&Math.abs(z-p.z)<=p.d/2)height=Math.max(height,p.y+p.h);
 return height;
}
