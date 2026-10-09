import {BufferAttribute,BufferGeometry,Color,DoubleSide,DynamicDrawUsage,Matrix4,Mesh,MeshStandardMaterial,Triangle,Vector3} from 'three';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=t=>t*t*(3-2*t);

/** Optional short mantle, expressed in the traveler's metre-scaled root space.
 * The shoulder line follows the actual neck/spine/upper-arm bone positions;
 * fixed folds and a small anchored breeze replace a cloth simulation. Geometry
 * itself moves, so colour and shadow passes always see the same surface.
 * Call update after avatar.update. Disabled until explicitly enabled.
 */
export function createTravelerCape({enabled=false,width=.66,length=.76,color=0x984e38}={}){
 const columns=10,rows=12,positions=new Float32Array((columns+1)*(rows+1)*3),colors=new Float32Array(positions.length),indices=[];
 const geometry=new BufferGeometry(),position=new BufferAttribute(positions,3).setUsage(DynamicDrawUsage);
 const material=new MeshStandardMaterial({color,vertexColors:true,roughness:.98,metalness:0,side:DoubleSide});
 const mesh=new Mesh(geometry,material);mesh.name='optional-traveler-short-cape';mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;
 const shade=new Color();
 for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++){
  const u=column/columns,t=row/rows,index=row*(columns+1)+column;
  // Worn edges remain cloth. No metallic trim or emissive material.
  const edge=Math.min(u,1-u),hem=t>.92,light=hem?.72:edge<.06?.77:.94+.06*Math.sin(u*17+t*9);
  shade.setRGB(light,light*.965,light*.925);shade.toArray(colors,index*3);
  if(row<rows&&column<columns){const a=index,b=a+1,c=a+columns+1,d=c+1;indices.push(a,c,b,b,c,d);}
 }
 geometry.setAttribute('position',position);geometry.setAttribute('color',new BufferAttribute(colors,3));geometry.setIndex(indices);
 let avatar=null,bones=null,disposed=false,time=0,motion=0,initialized=false,visible=!!enabled;
 const neck=new Vector3(),spine=new Vector3(),pelvis=new Vector3(),left=new Vector3(),right=new Vector3();
 const up=new Vector3(),side=new Vector3(),back=new Vector3(),top=new Vector3(),point=new Vector3(),delta=new Vector3(),nearest=new Vector3(),segment=new Vector3();
 const contacts=[],anchors=[],anchorOffsets=Array.from({length:columns+1},()=>new Vector3()),skinMatrices=new Set();
 const anchorPoint=new Vector3(),skinPoint=new Vector3(),rootInverse=new Matrix4(),toRoot=new Matrix4(),anchorVertices=[new Vector3(),new Vector3(),new Vector3()],anchorNormal=new Vector3(),anchorEdge=new Vector3();
 const widthMetres=clamp(width,.55,.72),lengthMetres=clamp(length,.62,.82);
 const read=(bone,out)=>{bone.getWorldPosition(out);avatar.root.worldToLocal(out);return out;};
 function attach(traveler){
  if(disposed)return false;
  mesh.removeFromParent();avatar=null;bones=null;contacts.length=0;anchors.length=0;skinMatrices.clear();initialized=false;
  if(!traveler?.root)return false;
  const required=['neck_01','spine_03','pelvis','upperarm_l','upperarm_r','lowerarm_l','lowerarm_r','hand_l','hand_r'];
  const found=Object.fromEntries(required.map(name=>[name,traveler.root.getObjectByName(name)]));
  if(required.some(name=>!found[name]?.isBone))return false;
  avatar=traveler;bones=found;avatar.root.add(mesh);mesh.visible=visible;
  // These are cosmetic body-contact envelopes, never navigation colliders.
  for(const [a,b,radius]of[['pelvis','spine_03',.165],['spine_03','neck_01',.165],['upperarm_l','lowerarm_l',.077],['lowerarm_l','hand_l',.062],['upperarm_r','lowerarm_r',.077],['lowerarm_r','hand_r',.062]])contacts.push({a:bones[a],b:bones[b],radius,start:new Vector3(),end:new Vector3()});
  update(0,0,{});
  // Bind eleven points to actual triangles of the shoulder cloth. The small
  // closest-surface search happens once on attachment; runtime only evaluates
  // 33 existing skinned vertices with their authored bone weights. This avoids
  // a floating rigid bar and does not alter the Ranger's bones or geometry.
  const surfaces=[],sample=new Vector3(),triangle=new Triangle(),nearestPoint=new Vector3();
  avatar.root.updateMatrixWorld(true);rootInverse.copy(avatar.root.matrixWorld).invert();
  avatar.root.traverse(object=>{
   if(!object.isSkinnedMesh||!object.name.startsWith('Traveler_Rust_Cloth'))return;
   object.skeleton.update();const points=[];toRoot.multiplyMatrices(rootInverse,object.matrixWorld);
   for(let i=0;i<object.geometry.attributes.position.count;i++){sample.fromBufferAttribute(object.geometry.attributes.position,i);object.applyBoneTransform(i,sample).applyMatrix4(toRoot);points.push(sample.clone());}
   surfaces.push({mesh:object,points});
  });
  for(let column=0;column<=columns;column++){
   const desired=new Vector3().fromBufferAttribute(position,column);let best=null,distance=Infinity;
   for(const surface of surfaces){const index=surface.mesh.geometry.index;
    for(let i=0;i<index.count;i+=3){const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];triangle.set(...ids.map(id=>surface.points[id]));triangle.closestPointToPoint(desired,nearestPoint);const d=desired.distanceToSquared(nearestPoint);
     if(d<distance){distance=d;best={mesh:surface.mesh,ids,barycentric:triangle.getBarycoord(nearestPoint,new Vector3())};}
    }
   }
   if(!best){mesh.removeFromParent();avatar=null;bones=null;contacts.length=0;return false;}
   anchors.push(best);skinMatrices.add(best.mesh.skeleton);
  }
  initialized=false;update(0,0,{});return true;
 }
 function update(dt=0,elapsed=0,{paused=false,speed=0}={}){
  if(disposed||!avatar||(!visible&&initialized))return;
  const step=clamp(Number(dt)||0,0,.1),target=clamp((Number(speed)||0)/6.6,0,1);
  if(!paused){time+=step;motion+=(target-motion)*(1-Math.exp(-step*7));}
  if(paused&&initialized)return;
  avatar.root.updateMatrixWorld(true);
  read(bones.neck_01,neck);read(bones.spine_03,spine);read(bones.pelvis,pelvis);read(bones.upperarm_l,left);read(bones.upperarm_r,right);
  up.copy(neck).sub(pelvis).normalize();side.copy(left).sub(right).addScaledVector(up,-delta.copy(left).sub(right).dot(up)).normalize();
  back.crossVectors(up,side).normalize();if(back.z>0)back.negate();
  const scale=(avatar.metadata?.height??1.75)/1.75;
  top.copy(neck).addScaledVector(up,-.075*scale).addScaledVector(back,.19*scale);
  for(const contact of contacts){read(contact.a,contact.start);read(contact.b,contact.end);}
  if(anchors.length){
   rootInverse.copy(avatar.root.matrixWorld).invert();for(const skeleton of skinMatrices)skeleton.update();
   for(let column=0;column<=columns;column++){
    const anchor=anchors[column];anchorPoint.set(0,0,0);toRoot.multiplyMatrices(rootInverse,anchor.mesh.matrixWorld);
    for(let i=0;i<3;i++){skinPoint.fromBufferAttribute(anchor.mesh.geometry.attributes.position,anchor.ids[i]);anchor.mesh.applyBoneTransform(anchor.ids[i],skinPoint).applyMatrix4(toRoot);anchorVertices[i].copy(skinPoint);anchorPoint.addScaledVector(skinPoint,anchor.barycentric.getComponent(i));}
    anchorNormal.subVectors(anchorVertices[1],anchorVertices[0]).cross(anchorEdge.subVectors(anchorVertices[2],anchorVertices[0])).normalize();if(anchorNormal.dot(back)<0)anchorNormal.negate();
    anchorOffsets[column].copy(anchorPoint).addScaledVector(anchorNormal,.012*scale).addScaledVector(back,.006*scale);
   }
  }
  for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++){
   const u=column/columns,t=row/rows,free=t*t,spread=.62+.38*smooth(Math.min(1,t*1.6));
   // Slightly shorter on the lantern side; the glass and legs stay exposed.
   const lanternSide=(1-smooth(Math.min(1,u/.85)))*.46*Math.pow(t,1.45);
   const hem=.008*Math.cos(u*Math.PI*6)*t*t*t;
   const shoulderDrop=.026*Math.pow(Math.abs(u*2-1),1.4)*(1-t);
   const down=(lengthMetres*t-lanternSide+hem+shoulderDrop)*scale;
   const lateral=((u-.5)*widthMetres*spread+.045*smooth(t)+Math.sin(time*1.1+t*3.4)*.014*free)*scale;
   const fold=Math.sin(u*Math.PI*5)*.021*Math.sin(t*Math.PI*.85);
   const breeze=(.014*Math.sin(time*1.7+u*3.2-t*4)+.009*Math.sin(time*.7+t*5))*free;
   const trail=(.035*free+motion*.10*free+fold+breeze)*scale;
   point.copy(top).addScaledVector(up,-down).addScaledVector(side,lateral).addScaledVector(back,trail);
   // Push a vertex backward only if a bent limb enters the drape. No velocity,
   // iterations, spring state, or integration instability is introduced.
   for(const contact of contacts){
    segment.subVectors(contact.end,contact.start);const q=clamp(delta.copy(point).sub(contact.start).dot(segment)/Math.max(1e-9,segment.lengthSq()),0,1);
    nearest.copy(contact.start).addScaledVector(segment,q);delta.subVectors(point,nearest);
    const radius=(contact.radius+.012)*scale,squared=delta.lengthSq();
    if(squared<radius*radius){const projection=delta.dot(back);point.addScaledVector(back,-projection+Math.sqrt(Math.max(0,projection*projection+radius*radius-squared)));}
   }
   if(anchors.length){
    if(row===0)anchorOffsets[column].sub(point);
    point.addScaledVector(anchorOffsets[column],1-smooth(Math.min(1,t/.29)));
   }
   position.setXYZ(row*(columns+1)+column,point.x,point.y,point.z);
  }
  position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();initialized=true;
 }
 function setEnabled(value){if(disposed)return false;visible=!!value;mesh.visible=visible;if(visible&&avatar)update(0,0,{});return true;}
 function snapshot(){return{enabled:visible,attached:!!avatar,disposed,time,motion,width:widthMetres,length:lengthMetres,vertices:position.count,triangles:indices.length/3,surfaceAnchors:anchors.length,bones:bones?Object.keys(bones):[],bounds:initialized?{min:geometry.boundingBox.min.toArray(),max:geometry.boundingBox.max.toArray()}:null};}
 function dispose(){if(disposed)return;disposed=true;mesh.removeFromParent();geometry.dispose();material.dispose();avatar=null;bones=null;contacts.length=0;anchors.length=0;skinMatrices.clear();}
 mesh.visible=visible;
 return{attach,update,setEnabled,snapshot,dispose,mesh};
}
