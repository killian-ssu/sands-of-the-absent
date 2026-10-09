import * as T from 'three';
import {houseSupportData} from './house-support-data.js';
import {buildHouseStructurePlan} from './house-structure.js';
import {terrainSurfaceHeight,terrainGrid,walkHeight} from './layout.js';

const point=(p,x,z)=>({x:p.x+x*Math.cos(p.yaw||0)+z*Math.sin(p.yaw||0),z:p.z-x*Math.sin(p.yaw||0)+z*Math.cos(p.yaw||0)});
const local=(p,x,z)=>{const dx=x-p.x,dz=z-p.z,c=Math.cos(p.yaw||0),s=Math.sin(p.yaw||0);return{x:dx*c-dz*s,z:dx*s+dz*c};};
const boxPolygon=b=>[[-b.w/2,-b.d/2],[b.w/2,-b.d/2],[b.w/2,b.d/2],[-b.w/2,b.d/2]].map(([x,z])=>point(b,x,z));
const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
function clipPolygon(subject,boundary){
 let poly=subject;
 for(let i=0;i<boundary.length;i++){
  const a=boundary[i],b=boundary[(i+1)%boundary.length],out=[];
  for(let j=0;j<poly.length;j++){
   const c=poly[j],d=poly[(j+1)%poly.length],dc=cross(a,b,c),dd=cross(a,b,d),insideC=dc>=-1e-10,insideD=dd>=-1e-10;
   if(insideC)out.push(c);
   if(insideC!==insideD){const t=dc/(dc-dd);out.push({x:c.x+(d.x-c.x)*t,z:c.z+(d.z-c.z)*t});}
  }
  poly=out;if(!poly.length)break;
 }
 return poly;
}

/** Exact minimum of the visible piecewise-linear terrain within an oriented
 * rectangle: include clipped grid-triangle vertices and boundary crossings. */
export function minimumTerrainUnderBox(box,{heightAt=terrainSurfaceHeight}={}){
 const polygon=boxPolygon(box),cell=terrainGrid.extent/terrainGrid.segments,half=terrainGrid.extent/2;
 const minX=Math.min(...polygon.map(p=>p.x)),maxX=Math.max(...polygon.map(p=>p.x)),minZ=Math.min(...polygon.map(p=>p.z)),maxZ=Math.max(...polygon.map(p=>p.z));
 let minimum=Infinity,samples=0;
 for(let x=Math.floor((minX+half)/cell)*cell-half;x<=maxX+1e-9;x+=cell)for(let z=Math.floor((minZ+half)/cell)*cell-half;z<=maxZ+1e-9;z+=cell){
  const a={x,z},b={x:x+cell,z},c={x,z:z+cell},d={x:x+cell,z:z+cell};
  for(const triangle of[[a,b,c],[d,c,b]])for(const p of clipPolygon(triangle,polygon)){minimum=Math.min(minimum,heightAt(p.x,p.z));samples++;}
 }
 if(!Number.isFinite(minimum))throw new Error('Empty house foundation terrain footprint.');
 return{height:minimum,samples};
}
function floorAt(shape,x,z){
 let y=-Infinity;
 for(const tri of shape.topTriangles){const [ax,ay,az,bx,by,bz,cx,cy,cz]=tri,den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-10)continue;
  const a=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,b=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den,c=1-a-b;
  if(a>=-1e-8&&b>=-1e-8&&c>=-1e-8)y=Math.max(y,a*ay+b*by+c*cy);
 }
 return y;
}
function boxAt(p,x,z,w,d,bottom,top,id){const q=point(p,x,z);return{x:q.x,z:q.z,w,d,y:bottom,h:top-bottom,yaw:p.yaw||0,support:true,id};}

/** Stable JSON-only construction plan, shared by navigation and render/export.
 * Only ground-storey (solid) houses receive foundations; upper-storey assets
 * are not mistaken for free-standing buildings. Existing roofs stay unchanged. */
export function buildHouseFoundationPlan(placements,{groundHeight=terrainSurfaceHeight,approachHeight=walkHeight}={}){
 const bases=[],steps=[],posts=[],floors=[],houses=[],structure=buildHouseStructurePlan(placements),cameraColliders=structure.cameraColliders;
 for(const [index,p]of placements.entries()){
  if(!houseSupportData[p.type])continue;
  if(!p.solid)continue;
  const data=houseSupportData[p.type],s=p.s,f=data.floor,id=`house-foundation-${index}`;
  // The shallow worn slab overhangs the support by 7 cm in asset space. This
  // stays inside its real footprint, including its worn/bevelled corners.
  const x0=(f.min[0]+.07)*s,x1=(f.max[0]-.07)*s,z0=(f.min[2]+.07)*s,z1=(f.max[2]-.07)*s;
  const base=boxAt(p,(x0+x1)/2,(z0+z1)/2,x1-x0,z1-z0,0,0,id),ground=minimumTerrainUnderBox(base,{heightAt:groundHeight});
  base.y=ground.height-.1;base.h=p.y+.10*s-base.y;if(p.y+f.min[1]*s-ground.height>.03)bases.push(base);
  const floor={...p,index,id,shape:p.type,minX:f.min[0]*s,maxX:f.max[0]*s,minZ:f.min[2]*s,maxZ:f.max[2]*s};floors.push(floor);
  // A real narrow threshold and descending treads connect the original front
  // doorway to its slope. Height transitions are normal 25 cm controller steps.
  const doorwayY=p.y+floorAt(f,0,3.35)*s,thresholdStart=3.30*s,depth=.38,width=2.04*s;
  const doorwaySteps=[];let connectedDoor=false;
  for(let i=0;i<16;i++){
   const back=thresholdStart+i*depth,front=back+depth,top=doorwayY-i*.25,centre=point(p,0,(back+front)/2),ahead=point(p,0,front);
   const shape={x:centre.x,z:centre.z,w:width,d:depth+.016,yaw:p.yaw||0};
   const terrain=minimumTerrainUnderBox(shape,{heightAt:groundHeight}).height;
   if(top>terrain+.015){doorwaySteps.push({...shape,y:terrain-.1,h:top-terrain+.1,id:id+'-step-'+i,support:true});}
   if(i>=1&&top<=approachHeight(ahead.x,ahead.z)+.25){connectedDoor=true;break;}
  }
  // Never leave a partial staircase suspended above the slope. Houses whose
  // entry would demand a long exterior stair remain supported scenery.
  if(connectedDoor)steps.push(...doorwaySteps);
  for(const [n,pole]of data.poles.entries()){
   const x=(pole.min[0]+pole.max[0])/2*s,z=(pole.min[2]+pole.max[2])/2*s,q=point(p,x,z),bottom=groundHeight(q.x,q.z)-.1,top=p.y+(pole.min[1]+.05)*s;
   if(top-bottom>.12)posts.push({id:id+'-pole-'+n,x:q.x,z:q.z,y:bottom,h:top-bottom,radius:Math.max(pole.max[0]-pole.min[0],pole.max[2]-pole.min[2])*.5*s});
  }
  houses.push({index,type:p.type,x:p.x,y:p.y,z:p.z,baseBottom:base.y,baseTop:base.y+base.h,sourceIndex:p.foundationSourceIndex??index,terrainSamples:ground.samples,doorwayY,steps:connectedDoor?doorwaySteps.length:0,connectedDoor});
 }
 return{version:1,bases,steps,posts,floors,houses,structure,cameraColliders,sourceSha:Object.fromEntries(Object.entries(houseSupportData).map(([name,s])=>[name,s.sha256]))};
}

/** Spatially indexed height support: actual GLB top triangles in each floor,
 * and the exact top plane of each added tread. No support outside these bounds. */
export function createHouseSurfaceQuery(plan){
 const cells=new Map(),size=16,add=(item,box)=>{const vertices=boxPolygon(box),minX=Math.floor(Math.min(...vertices.map(p=>p.x))/size),maxX=Math.floor(Math.max(...vertices.map(p=>p.x))/size),minZ=Math.floor(Math.min(...vertices.map(p=>p.z))/size),maxZ=Math.floor(Math.max(...vertices.map(p=>p.z))/size);for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(item);}};
 for(const f of plan.floors){const q=point(f,(f.minX+f.maxX)/2,(f.minZ+f.maxZ)/2);add({floor:f},{...q,w:f.maxX-f.minX,d:f.maxZ-f.minZ,yaw:f.yaw});}
 for(const step of plan.steps)add({step},step);
 return(x,z,base=-Infinity)=>{
  let height=base;
  for(const item of cells.get(Math.floor(x/size)+','+Math.floor(z/size))||[]){
   if(item.floor){const f=item.floor,q=local(f,x,z);if(q.x<f.minX||q.x>f.maxX||q.z<f.minZ||q.z>f.maxZ)continue;const y=floorAt(houseSupportData[f.shape].floor,q.x/f.s,q.z/f.s);if(Number.isFinite(y))height=Math.max(height,f.y+y*f.s);}
   else{const b=item.step,q=local(b,x,z);if(Math.abs(q.x)<=b.w/2&&Math.abs(q.z)<=b.d/2)height=Math.max(height,b.y+b.h);}
  }
  return height;
 };
}

export function createHouseFoundations(scene,plan,materials){
 const root=new T.Group();root.name='house-foundations';scene.add(root);const resources=[],matrix=new T.Object3D();
 function boxes(name,items,material){
  if(!items.length)return;
  const unit=new T.BoxGeometry(1,1,1),positions=[],normals=[],uvs=[],indices=[],v=new T.Vector3(),n=new T.Vector3();
  for(const b of items){
   const offset=positions.length/3,co=Math.cos(b.yaw||0),si=Math.sin(b.yaw||0);
   for(let i=0;i<unit.attributes.position.count;i++){
    v.fromBufferAttribute(unit.attributes.position,i);n.fromBufferAttribute(unit.attributes.normal,i);
    const x=v.x*b.w,y=v.y*b.h,z=v.z*b.d;
    positions.push(b.x+x*co+z*si,b.y+b.h/2+y,b.z-x*si+z*co);normals.push(n.x*co+n.z*si,n.y,-n.x*si+n.z*co);
    // A shared mesh keeps all three material texture channels at metre scale;
    // enlarging a unit cube's 0..1 UV would stretch one stone across the facade.
    if(Math.abs(n.y)>.5)uvs.push(x/2.4,z/2.4);else if(Math.abs(n.x)>.5)uvs.push(z/2.4,(b.y+b.h/2+y)/2.4);else uvs.push(x/2.4,(b.y+b.h/2+y)/2.4);
   }
   for(const index of unit.index.array)indices.push(offset+index);
  }
  unit.dispose();const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeBoundingSphere();resources.push(geometry);
  const mesh=new T.Mesh(geometry,material);mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);
 }
 boxes('house-stone-foundations',plan.bases,materials.darkstone||materials.stone);
 boxes('house-doorway-steps',plan.steps,materials.stone);
 if(plan.posts.length){const geometry=new T.CylinderGeometry(1,1,1,8),mesh=new T.InstancedMesh(geometry,materials.wood||materials.darkstone||materials.stone,plan.posts.length);mesh.name='house-awning-post-extensions';mesh.castShadow=mesh.receiveShadow=true;resources.push(geometry);for(let i=0;i<plan.posts.length;i++){const p=plan.posts[i];matrix.position.set(p.x,p.y+p.h/2,p.z);matrix.rotation.set(0,0,0);matrix.scale.set(p.radius,p.h,p.radius);matrix.updateMatrix();mesh.setMatrixAt(i,matrix.matrix);}mesh.computeBoundingSphere();root.add(mesh);}
 return{root,plan,getSurfaceHeight:createHouseSurfaceQuery(plan),colliders:[...plan.bases,...plan.steps,...plan.posts.map(p=>({x:p.x,z:p.z,y:p.y,h:p.h,w:p.radius*2,d:p.radius*2,id:p.id}))],snapshot:()=>({enabled:true,houses:plan.houses.length,bases:plan.bases.length,steps:plan.steps.length,posts:plan.posts.length,drawCalls:root.children.length}),dispose(){root.removeFromParent();for(const geometry of resources)geometry.dispose();}};
}
