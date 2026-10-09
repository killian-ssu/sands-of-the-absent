import {Box3,Vector3} from 'three';

// Exported GLBs batch disconnected masonry by material. Welding coincident
// positions restores those authored pieces without treating an arch or a whole
// city as a single solid. This runs only once while loading the citadel.
export function masonryComponents(model,{precision=1e-5}={}){
 model.updateMatrixWorld(true);
 const result=[],point=new Vector3();
 model.traverse(node=>{
  if(!node.isMesh)return;
  const positions=node.geometry.attributes.position,index=node.geometry.index,count=(index?.count??positions.count)/3;
  const parent=new Int32Array(count),firstAtPosition=new Map();for(let i=0;i<count;i++)parent[i]=i;
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(let face=0;face<count;face++)for(let corner=0;corner<3;corner++){
   const vertex=index?index.getX(face*3+corner):face*3+corner;
   point.fromBufferAttribute(positions,vertex).applyMatrix4(node.matrixWorld);
   const key=`${Math.round(point.x/precision)},${Math.round(point.y/precision)},${Math.round(point.z/precision)}`;
   if(firstAtPosition.has(key))parent[root(face)]=root(firstAtPosition.get(key));else firstAtPosition.set(key,face);
  }
  const groups=new Map();
  for(let face=0;face<count;face++){
   const key=root(face);let group=groups.get(key);
   if(!group){group={material:node.material.name,firstFace:face,triangles:0,bounds:new Box3(),vertices:[]};groups.set(key,group);}
   group.triangles++;
   for(let corner=0;corner<3;corner++){
    const vertex=index?index.getX(face*3+corner):face*3+corner;
    point.fromBufferAttribute(positions,vertex).applyMatrix4(node.matrixWorld);
    group.bounds.expandByPoint(point);group.vertices.push(point.clone());
   }
  }
  result.push(...groups.values());
 });
 return result;
}

// A shallow blind arch is a real cavity, not a through-door. Recover its
// silhouette from the actual dark back plate. Conservative horizontal bands
// preserve the central opening while covering the solid shoulders above it.
function recessedFacade(component,backs){
 const b=component.bounds,holes=backs.filter(p=>p.bounds.min.x>b.min.x&&p.bounds.max.x<b.max.x&&p.bounds.max.z>b.min.z&&p.bounds.max.z<b.max.z);
 if(!holes.length)throw new Error('Citadel concave facade has no matching recess backing.');
 const boxes=[],add=(x0,y0,z0,x1,y1,z1)=>{if(x1-x0>1e-5&&y1-y0>1e-5&&z1-z0>1e-5)boxes.push(new Box3(new Vector3(x0,y0,z0),new Vector3(x1,y1,z1)));};
 const backZ=Math.min(...holes.map(p=>p.bounds.min.z));
 add(b.min.x,b.min.y,b.min.z,b.max.x,b.max.y,backZ);
 // Unique outline vertices are unordered in the GLB triangle buffer. The
// convex backing's horizontal cross-section follows its convex hull exactly.
 const polygon=hole=>{
  const points=[...new Map(hole.vertices.map(v=>[`${v.x.toFixed(5)},${v.y.toFixed(5)}`,{x:v.x,y:v.y}])).values()].sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),lower=[],upper=[];
  for(const p of points){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(const p of points.slice().reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
 };
 const outlines=holes.map(h=>({hole:h,polygon:polygon(h)}));
 const levels=[...new Set([b.min.y,b.max.y,...outlines.flatMap(h=>h.polygon.map(p=>p.y))])].sort((a,b)=>a-b);
 const span=(poly,y)=>{
  const xs=[];for(let i=0;i<poly.length;i++){const a=poly[i],c=poly[(i+1)%poly.length];if(y<Math.min(a.y,c.y)-1e-8||y>Math.max(a.y,c.y)+1e-8)continue;if(Math.abs(a.y-c.y)<1e-8){xs.push(a.x,c.x);continue;}xs.push(a.x+(c.x-a.x)*(y-a.y)/(c.y-a.y));}
  return xs.length?[Math.min(...xs),Math.max(...xs)]:null;
 };
 for(let i=1;i<levels.length;i++){
  const bottom=levels[i-1],top=levels[i];if(top-bottom<1e-6)continue;
  const openings=[];
  for(const {hole,polygon:poly}of outlines){
   if(bottom<hole.bounds.min.y-1e-6||top>hole.bounds.max.y+1e-6)continue;
   const low=span(poly,bottom),high=span(poly,top);
   if(low&&high)openings.push([Math.max(low[0],high[0]),Math.min(low[1],high[1])]);
  }
  openings.sort((a,c)=>a[0]-c[0]);let x=b.min.x;
  for(const [left,right]of openings){add(x,bottom,backZ,left,top,b.max.z);x=Math.max(x,right);}
  add(x,bottom,backZ,b.max.x,top,b.max.z);
 }
 // The builder bevels the Boolean cavity by 6 cm after cutting it. Concave
 // bevels add real stone inside the cutter outline: retain that lip, but never
 // grow the facade beyond its measured outer bounds. This is geometry padding,
 // not a reduction of the camera's collision radius.
 return boxes.map((box,i)=>i===0?box:box.expandByScalar(.061).intersect(b));
}

/** Camera-only conservative masonry proxies. No visual or navigation mutation. */
export function createCitadelCameraColliders(model,placements,{margin=.012}={}){
 const components=masonryComponents(model),backs=components.filter(c=>c.material==='deep'),pieces=[];
 for(const component of components){
  if(component.material==='deep')continue; // Back planes are represented by the facade's solid rear body.
  const size=component.bounds.getSize(new Vector3());
  if(Math.min(size.x,size.y,size.z)<1e-5)continue;
  const bounds=component.triangles===44?[component.bounds]:component.material==='stone'?recessedFacade(component,backs):null;
  if(!bounds)throw new Error(`Unclassified citadel component: ${component.material} / ${component.triangles} triangles`);
  for(const box of bounds)pieces.push({box,material:component.material,firstFace:component.firstFace});
 }
 // Most ashlar rectangles sit completely inside a retaining-wall body. Keep
// protruding blocks, all separate columns, and each individual arch voussoir.
 const retained=pieces.filter((p,i)=>!pieces.some((q,j)=>j!==i&&q.box.containsBox(p.box)&&(j<i||!p.box.containsBox(q.box))));
 const colliders=[];
 for(const [instance,p]of placements.entries()){
  const scale=Array.isArray(p.s)?p.s:[p.s,p.s,p.s],co=Math.cos(p.yaw||0),si=Math.sin(p.yaw||0);
  for(const piece of retained){
   const box=piece.box,center=box.getCenter(new Vector3()),size=box.getSize(new Vector3()),x=center.x*scale[0],z=center.z*scale[2];
   colliders.push({x:p.x+x*co+z*si,z:p.z-x*si+z*co,y:p.y+box.min.y*scale[1]-margin,w:size.x*scale[0]+margin*2,h:size.y*scale[1]+margin*2,d:size.z*scale[2]+margin*2,yaw:p.yaw||0,cameraOnly:true,source:`citadel:${instance}:${piece.material}:${piece.firstFace}`});
  }
 }
 return colliders;
}
