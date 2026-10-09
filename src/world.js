import * as T from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createNavigation} from './navigation.js';
import {createLayout,terrainHeight,terrainSurfaceHeight,terrainGrid,walkHeight,cityStairs,templeStairs,rng} from './layout.js';
import {architecturalLandings} from './architecture-support.js';
import {createRockLOD} from './rock-lod.js';
import {createRockMainCulling} from './rock-main-culling.js';
import {createSpatialInstances} from './spatial-instances.js';
import {createTerrainClusters} from './terrain-clusters.js';
import {createCanopyOcclusion} from './canopy-occlusion.js';
import {createTemplePalette} from './temple-palette.js';
import {createCitadelCameraColliders} from './camera-geometry.js';
import {buildHouseFoundationPlan,createHouseFoundations} from './house-foundations.js';
export async function createWorld(scene,mats,blockout){
 const foundationEnabled=new URLSearchParams(globalThis.location?.search||'').get('foundations')!=='0';
 const placements=createLayout({foundations:foundationEnabled,weatheredRoad:new URLSearchParams(globalThis.location?.search||'').get('road')!=='classic'}),r=rng(997),clockUniform={value:0};
 const originalColourPlacements=foundationEnabled?createLayout({foundations:false,weatheredRoad:new URLSearchParams(globalThis.location?.search||'').get('road')!=='classic'}):placements;
 const templePalette=createTemplePalette(mats),cameraColliders=[];
 let rockLOD=null,rockMainCulling=null,houseClusters=null,canopyOcclusion=null;
 const landGeo=new T.PlaneGeometry(terrainGrid.extent,terrainGrid.extent,terrainGrid.segments,terrainGrid.segments);landGeo.rotateX(-Math.PI/2);
 const pa=landGeo.attributes.position,uv=landGeo.attributes.uv;
 for(let i=0;i<pa.count;i++){const x=pa.getX(i),z=pa.getZ(i);pa.setY(i,terrainHeight(x,z));uv.setXY(i,x/3,z/3);}
 landGeo.computeVertexNormals();const land=new T.Mesh(landGeo,mats.sand);land.receiveShadow=true;scene.add(land);const terrainClusters=blockout||new URLSearchParams(globalThis.location?.search||'').get('qa')!=='1'?null:createTerrainClusters(land,{cellSize:128,enabled:false});
 const addBox=(x,y,z,w,h,d,mat=mats.stone)=>{const o=new T.Mesh(new T.BoxGeometry(w,h,d),mat);o.position.set(x,y+h/2,z);o.castShadow=o.receiveShadow=true;scene.add(o);return o;};
 // Keep every tread unchanged, but submit each contiguous flight as one draw.
 const stairGeometry=new T.BoxGeometry(1,1,1);
 const addStairs=(name,count,x,baseY,startZ,stepZ,width,rise,depth)=>{
  const mesh=new T.InstancedMesh(stairGeometry,mats.trim,count),step=new T.Object3D();
  mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;
  for(let i=0;i<count;i++){
   const height=(i+1)*rise;step.position.set(x,baseY+height/2,startZ+i*stepZ);
   step.scale.set(width,height,depth);step.updateMatrix();mesh.setMatrixAt(i,step.matrix);
  }
  mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();scene.add(mesh);return mesh;
 };
 for(const flight of [templeStairs,...cityStairs])addStairs(flight.name,flight.count,flight.x,flight.baseY,flight.startZ,flight.stepZ,flight.width,flight.rise,flight.depth);
 for(const p of architecturalLandings)addBox(p.x,p.y,p.z,p.w,p.h,p.d,mats.darkstone).name=p.id;
 const foundationPlan=foundationEnabled?buildHouseFoundationPlan(placements):null;
 const houseFoundations=foundationPlan?createHouseFoundations(scene,foundationPlan,mats):null;
 const {colliders,blocked,getSurfaceHeight,navigation,cameraColliders:structureCameraColliders}=createNavigation(placements,{foundationPlan});
 cameraColliders.push(...structureCameraColliders);
 if(blockout){
  for(const p of placements){
   if(['slab','bush'].includes(p.type)||p.type.startsWith('rock'))continue;
   const scale=Array.isArray(p.s)?p.s:[p.s,p.s,p.s];
   let w=7,h=7,d=6;if(p.type==='citadel'){w=65;h=14;d=65;}if(p.type==='temple'){w=36;h=38;d=28;}if(p.type==='obelisk'){w=7;h=78;d=7;}if(p.type==='gate'){w=14;h=12;d=2;}if(p.type.startsWith('cliff')){w=47;h=77;d=47;}if(p.type==='palm'){w=1;h=13;d=1;}
   const o=addBox(p.x,p.y,p.z,w*scale[0],h*scale[1],d*scale[2]);o.rotation.y=p.yaw;
  }
 }else{
  const types=[...new Set(placements.map(p=>p.type))];const loader=new GLTFLoader();
  const [models,rockModels]=await Promise.all([
   Promise.all(types.map(async type=>[type,(await loader.loadAsync(`assets/models/${type}.glb`)).scene])),
   Promise.all(['rock0','rock1','rock2'].map(async type=>[type,await Promise.all([1,2].map(async level=>(await loader.loadAsync(`assets/models/${type}-lod${level}.glb`)).scene))])),
  ]);
  const lodModels=new Map(rockModels),rockSources=[],houseSources=[];
  let assetTriangles=0;
  for(const [type,model]of models){
   model.updateMatrixWorld(true);const list=placements.filter(p=>p.type===type),matrix=new T.Matrix4(),dummy=new T.Object3D();
   if(type==='citadel')cameraColliders.push(...createCitadelCameraColliders(model,list));
   model.traverse(node=>{if(!node.isMesh)return;if(type==='palm'&&node.material.name!=='wood')return;const material=mats[node.material.name]||mats.stone;
    if(type.startsWith('cliff'))node.geometry.computeVertexNormals();
    const mesh=new T.InstancedMesh(node.geometry,material,list.length);mesh.castShadow=!type.startsWith('cliff')&&type!=='bush';mesh.receiveShadow=true;
    mesh.name=type+'_'+node.material.name;
    if(type==='temple')templePalette.attachMesh(mesh,node.material.name);
    // Reserve the original instance colour slots, including the three removed
    // candidate houses. Their omission must not reshuffle distant palms/dust.
    const colourList=originalColourPlacements.filter(p=>p.type===type),tints=colourList.map(()=>.89+r()*.18);
    for(let i=0;i<list.length;i++){const p=list[i];dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,p.yaw,0);Array.isArray(p.s)?dummy.scale.set(...p.s):dummy.scale.setScalar(p.s);dummy.updateMatrix();matrix.multiplyMatrices(dummy.matrix,node.matrixWorld);mesh.setMatrixAt(i,matrix);const sourceIndex=p.foundationSourceIndex===undefined?i:colourList.indexOf(originalColourPlacements[p.foundationSourceIndex]),tint=tints[sourceIndex];mesh.setColorAt(i,new T.Color(tint,tint*.99,tint*.96));}
    if(['leaf','dryleaf','cloth'].includes(node.material.name))mats.wind?.attachMesh?.(mesh,node.material.name,{assetType:type});
    mesh.computeBoundingSphere();mesh.instanceMatrix.needsUpdate=true;scene.add(mesh);assetTriangles+=(node.geometry.index?.count||node.geometry.attributes.position.count)/3*list.length;
    if(lodModels.has(type))rockSources.push({type,mesh,sourceNodeMatrix:node.matrixWorld.clone(),models:lodModels.get(type)});
    if(/^house\d+$/.test(type)&&(node.geometry.index?.count||node.geometry.attributes.position.count)/3>=1500)houseSources.push({type,mesh,positions:list});
   });
  }
  rockLOD=createRockLOD(scene,rockSources,{enabled:new URLSearchParams(globalThis.location?.search||'').get('lod')!=='0'});
  rockMainCulling=createRockMainCulling(scene,[...rockLOD.root.children],{enabled:false});
  houseClusters=createSpatialInstances(scene,houseSources,{cellSize:32,enabled:new URLSearchParams(globalThis.location?.search||'').get('clusters')!=='0'});
  scene.userData.assetTriangles=assetTriangles;
  const frondTexture=await new T.TextureLoader().loadAsync('assets/textures/palm-frond.png');frondTexture.colorSpace=T.SRGBColorSpace;frondTexture.anisotropy=8;
  const frondMat=new T.MeshStandardMaterial({map:frondTexture,color:0xd5dfb9,roughness:.86,side:T.DoubleSide,alphaTest:.38,emissive:0x203115,emissiveIntensity:.18});
  const frondGeo=new T.PlaneGeometry(6.2,3,16,4);const fpa=frondGeo.attributes.position;
  for(let i=0;i<fpa.count;i++){const u=(fpa.getX(i)+3.1)/6.2,v=fpa.getY(i);fpa.setXYZ(i,u*6.2,Math.sin(u*Math.PI)*1.4-2.1*u*u-.16*Math.abs(v),v);}
  frondGeo.computeVertexNormals();const palms=placements.filter(p=>p.type==='palm'),fronds=new T.InstancedMesh(frondGeo,frondMat,palms.length*13),fd=new T.Object3D();let fi=0;
  for(const p of palms){for(let k=0;k<13;k++){const co=Math.cos(p.yaw),si=Math.sin(p.yaw);fd.position.set(p.x+(.72*co-.28*si)*p.s,p.y+11*p.s,p.z+(-.72*si-.28*co)*p.s);fd.rotation.set((k%3-1)*.1,p.yaw+k*2.399,0);fd.scale.set(p.s*(.78+r()*.35),p.s,p.s*(.58+r()*.28));fd.updateMatrix();fronds.setMatrixAt(fi++,fd.matrix);}}
  fronds.castShadow=fronds.receiveShadow=true;fronds.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,map:frondTexture,alphaTest:.38,side:T.DoubleSide});
  mats.wind?.attachMesh?.(fronds,'palm',{assetType:'frond'});
  fronds.computeBoundingSphere();fronds.name='textured-palm-fronds';scene.add(fronds);
  canopyOcclusion=createCanopyOcclusion(fronds,{getWindState:()=>mats.wind?.snapshot?.(),enabled:new URLSearchParams(globalThis.location?.search||'').get('canopy')!=='0'});
 }
 const waterGeometry=new T.CircleGeometry(1,100);
 for(let i=1;i<waterGeometry.attributes.position.count;i++){let x=waterGeometry.attributes.position.getX(i),y=waterGeometry.attributes.position.getY(i);const a=Math.atan2(y,x);waterGeometry.attributes.position.setXY(i,x*24*(1+.045*Math.sin(a*5)),y*34*(1+.035*Math.cos(a*7)));}
 const waterTransform=new T.Matrix4().makeRotationX(-Math.PI/2).setPosition(45,-.45,5);
 const oasisField=blockout?null:createOasisField(waterGeometry,waterTransform);
 if(oasisField)mats.wetShore?.setField?.(oasisField);
 const waterShader={uniforms:{tDiffuse:{value:null},textureMatrix:{value:new T.Matrix4()},color:{value:new T.Color(0x285d55)},time:clockUniform,
  shoreField:{value:oasisField?.texture??null},shoreRect:{value:oasisField?.bounds??new T.Vector4()},maxDepth:{value:oasisField?.maxDepth??1},
  sunDirection:{value:new T.Vector3(-.68,.58,-.44).normalize()},reflectionBase:{value:.30},reflectionMax:{value:.88},waveStrength:{value:.019},reflectionDistortion:{value:.00042},
  shallowColor:{value:new T.Vector3(.085,.235,.195)},deepColor:{value:new T.Vector3(.022,.095,.078)},
 },vertexShader:`uniform mat4 textureMatrix;varying vec4 vRef;varying vec3 vW;void main(){vRef=textureMatrix*vec4(position,1.);vec4 wp=modelMatrix*vec4(position,1.);vW=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,fragmentShader:`
 uniform sampler2D tDiffuse;uniform sampler2D shoreField;uniform vec4 shoreRect;
 uniform float time;uniform float maxDepth;uniform float reflectionBase;uniform float reflectionMax;uniform float waveStrength;uniform float reflectionDistortion;
 uniform vec3 sunDirection;uniform vec3 shallowColor;uniform vec3 deepColor;
 varying vec4 vRef;varying vec3 vW;
 void main(){
  vec3 view=normalize(cameraPosition-vW);
  float w1=sin(vW.x*1.3+vW.z*1.8+time*.7),w2=sin(vW.x*2.7-vW.z*1.2-time*.5);
  vec4 uv=vRef;uv.xy+=vec2(w1,w2)*reflectionDistortion*uv.w;
  vec3 refl=texture2DProj(tDiffuse,uv).rgb;
  float depth=texture2D(shoreField,(vW.xz-shoreRect.xy)/shoreRect.zw).r*maxDepth;
  float deep=smoothstep(.06,1.45,depth);
  vec3 body=mix(shallowColor,deepColor,deep);
  // Broad, quiet bed variation; no screen-space foam or bright caustic grid.
  float bed=sin(vW.x*.19+sin(vW.z*.13))*sin(vW.z*.16-vW.x*.08);
  body*=1.+bed*.055*(1.-deep*.6);
  vec3 n=normalize(vec3(w1*waveStrength,1.,w2*waveStrength));
  float fres=pow(1.-clamp(dot(view,n),0.,1.),3.);
  vec3 col=mix(body,refl,mix(reflectionBase,reflectionMax,fres));
  float spec=pow(max(dot(reflect(-sunDirection,n),view),0.),160.);
  col+=vec3(1.,.9,.7)*spec*.65;
  gl_FragColor=vec4(col,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`};
 const water=blockout?new T.Mesh(waterGeometry,mats.stone):new Reflector(waterGeometry,{textureWidth:768,textureHeight:768,clipBias:.004,shader:waterShader,multisample:2});
 water.rotation.x=-Math.PI/2;water.position.set(45,-.45,5);water.name='oasis-water';scene.add(water);
 if(!blockout){
  // Share the same small data texture with the sand, rather than retain the
  // cloned texture created by Reflector's uniform-copy constructor.
  water.material.uniforms.shoreField.value=oasisField.texture;
  const reflect=water.onBeforeRender,waterInView=createWaterFrustumTest(waterGeometry);
  const preciseWaterCulling=new URLSearchParams(globalThis.location?.search||'').get('watercull')!=='0';
  water.onBeforeRender=function(renderer,scene,camera){
   if(scene.overrideMaterial)return;
   // Its broad bounding sphere can touch the view while every water triangle
   // is offscreen. Do not render the whole reflected scene for that empty view.
   if(preciseWaterCulling&&!this.forceUpdate&&!waterInView(this.matrixWorld,camera))return;
   reflect.call(this,renderer,scene,camera);
  };
 }
 let quietReflection=false,quietReflectionBaseline=null;
 const waterReflection={
  setResolution(size){
   if(![384,512,768].includes(size))return false;
   if(blockout)return false;
   const target=water.getRenderTarget();if(target.width!==size||target.height!==size)target.setSize(size,size);
   return true;
  },
  setSunDirection(value){
   const coordinates=Array.isArray(value)?value:[value?.x,value?.y,value?.z];
   if(blockout||coordinates.length!==3||!coordinates.every(Number.isFinite))return false;
   const v=new T.Vector3(...coordinates);if(v.lengthSq()<1e-10)return false;
   water.material.uniforms.sunDirection.value.copy(v).normalize();return true;
  },
  configure(values={}){
   if(blockout)return false;
   const uniforms=water.material.uniforms;
   for(const [key,min,max]of[['reflectionBase',0,.6],['reflectionMax',0,1],['waveStrength',0,.035],['reflectionDistortion',0,.001]])if(Number.isFinite(values[key]))uniforms[key].value=T.MathUtils.clamp(values[key],min,max);
   for(const key of['shallowColor','deepColor'])if(Array.isArray(values[key])&&values[key].length===3&&values[key].every(Number.isFinite))uniforms[key].value.fromArray(values[key].map(v=>T.MathUtils.clamp(v,0,1)));
   if(Number.isFinite(values.wetShoreStrength))mats.wetShore?.configure?.({strength:values.wetShoreStrength});
   return true;
  },
  setQuietReflection(value){
   if(blockout)return false;
   const next=!!value;if(next===quietReflection)return quietReflection;
   // Uniform-only preset: reuse the same reflection target, shader and callback.
   if(next){const u=water.material.uniforms;quietReflectionBaseline={reflectionBase:u.reflectionBase.value,reflectionMax:u.reflectionMax.value,reflectionDistortion:u.reflectionDistortion.value};waterReflection.configure({reflectionBase:.22,reflectionMax:.72,reflectionDistortion:.00060});}
   else{waterReflection.configure(quietReflectionBaseline);quietReflectionBaseline=null;}
   return quietReflection=next;
  },
  appearance(){
   if(blockout)return null;const u=water.material.uniforms;
   return{quietReflection,sunDirection:u.sunDirection.value.toArray(),reflectionBase:u.reflectionBase.value,reflectionMax:u.reflectionMax.value,waveStrength:u.waveStrength.value,reflectionDistortion:u.reflectionDistortion.value,
    shallowColor:u.shallowColor.value.toArray(),deepColor:u.deepColor.value.toArray(),wetShore:mats.wetShore?.snapshot?.()??null,shore:oasisField.report};
  },
  snapshot(){const target=blockout?null:water.getRenderTarget();return{enabled:!blockout,width:target?.width??0,height:target?.height??0,quietReflection,...waterReflection.appearance()};},
 };
 if(!blockout){
  const count=600,geo=new T.BufferGeometry(),pos=new Float32Array(count*3);
  for(let i=0;i<count;i++){pos[i*3]=-100+r()*235;pos[i*3+1]=.5+r()*21;pos[i*3+2]=-160+r()*250;}geo.setAttribute('position',new T.BufferAttribute(pos,3));
  const dust=new T.Points(geo,new T.PointsMaterial({color:0xffe4b5,size:.045,transparent:true,opacity:.35,depthWrite:false}));scene.add(dust);
 }
 return{update:(t,camera,viewportHeight,{windPaused=false}={})=>{clockUniform.value=t;if(!blockout)water.material.uniforms.time.value=t;mats.wind?.update?.(t,{paused:windPaused});rockMainCulling?.beginFrame();rockLOD?.update(camera,viewportHeight,t);rockMainCulling?.update(camera);},
  wind:typeof mats.wind?.snapshot==='function'?mats.wind:null,waterReflection,canopyOcclusion,terrainClusters,templePalette,
  rockLOD,rockMainCulling,setRockLODEnabled:value=>rockLOD?.setEnabled(value),houseClusters,houseFoundations,blocked,walkHeight,getSurfaceHeight,placements,colliders,cameraColliders,navigation};
}

/** Local colour/depth data only: the visible mesh, water level and navigation
 * are never changed. The shoreline is the nearer of the actual water polygon
 * and its intersection with the same terrain triangles used for walking.
 */
export function createOasisField(geometry,matrixWorld,{groundHeight=terrainSurfaceHeight,resolution=256,shoreWidth=1.35}={}){
 const positions=geometry.attributes.position,center=new T.Vector3().fromBufferAttribute(positions,0).applyMatrix4(matrixWorld);
 const perimeter=[];const bounds3=new T.Box3();
 for(let i=1;i<positions.count;i++){const p=new T.Vector3().fromBufferAttribute(positions,i).applyMatrix4(matrixWorld);perimeter.push({x:p.x-center.x,z:p.z-center.z});bounds3.expandByPoint(p);}
 const boundary=[],segments=256;let polygonLimited=0,maxHeightError=0;
 for(let i=0;i<segments;i++){
  const angle=i/segments*Math.PI*2,dx=Math.cos(angle),dz=Math.sin(angle);let edge=Infinity;
  for(let j=0;j<perimeter.length;j++){
   const a=perimeter[j],b=perimeter[(j+1)%perimeter.length],ex=b.x-a.x,ez=b.z-a.z,den=dx*ez-dz*ex;
   if(Math.abs(den)<1e-10)continue;
   const radius=(a.x*ez-a.z*ex)/den,along=(a.x*dz-a.z*dx)/den;
   if(radius>0&&along>=-1e-8&&along<=1+1e-8)edge=Math.min(edge,radius);
  }
  if(!Number.isFinite(edge))throw new Error('Oasis field requires a closed, centre-visible water polygon.');
  let last=0,crossing=null;
  for(let distance=Math.min(.25,edge);;distance=Math.min(distance+.25,edge)){
   if(groundHeight(center.x+dx*distance,center.z+dz*distance)>=center.y){
    let low=last,high=distance;
    for(let k=0;k<18;k++){const mid=(low+high)/2;if(groundHeight(center.x+dx*mid,center.z+dz*mid)>=center.y)high=mid;else low=mid;}
    crossing=(low+high)/2;break;
   }
   if(distance>=edge)break;last=distance;
  }
  const radius=crossing??edge,x=center.x+dx*radius,z=center.z+dz*radius;
  if(crossing===null)polygonLimited++;else maxHeightError=Math.max(maxHeightError,Math.abs(groundHeight(x,z)-center.y));
  boundary.push({x,z,polygonLimited:crossing===null});
 }
 const margin=shoreWidth+1,width=bounds3.max.x-bounds3.min.x+margin*2,height=bounds3.max.z-bounds3.min.z+margin*2;
 const bounds=new T.Vector4(bounds3.min.x-margin,bounds3.min.z-margin,width,height),heights=new Float32Array(resolution*resolution),data=new Uint8Array(resolution*resolution*4);
 let maxDepth=0,wetTexels=0;
 for(let row=0;row<resolution;row++)for(let col=0;col<resolution;col++){
  const x=bounds.x+(col+.5)/resolution*width,z=bounds.y+(row+.5)/resolution*height,h=groundHeight(x,z);
  heights[row*resolution+col]=h;maxDepth=Math.max(maxDepth,center.y-h);
 }
 maxDepth=Math.max(1,maxDepth);
 for(let row=0;row<resolution;row++)for(let col=0;col<resolution;col++){
  const index=row*resolution+col,x=bounds.x+(col+.5)/resolution*width,z=bounds.y+(row+.5)/resolution*height,h=heights[index];
  let square=Infinity;
  // Only exposed ground near water height needs the distance calculation. The
  // finite shoreline distance supplies the spatial limit, never height alone.
  if(h>center.y-.08&&h<center.y+.7)for(let j=0;j<boundary.length;j++){
   const a=boundary[j],b=boundary[(j+1)%boundary.length],ex=b.x-a.x,ez=b.z-a.z,den=ex*ex+ez*ez;
   const along=T.MathUtils.clamp(((x-a.x)*ex+(z-a.z)*ez)/Math.max(den,1e-10),0,1),px=x-a.x-along*ex,pz=z-a.z-along*ez;
   square=Math.min(square,px*px+pz*pz);
  }
  const dryExposure=T.MathUtils.smoothstep(h,center.y-.07,center.y+.025);
  const wet=(1-T.MathUtils.smoothstep(Math.sqrt(square),.1,shoreWidth))*dryExposure;
  data[index*4]=Math.round(T.MathUtils.clamp((center.y-h)/maxDepth,0,1)*255);data[index*4+1]=Math.round(wet*255);data[index*4+3]=255;
  if(data[index*4+1]>0)wetTexels++;
 }
 const texture=new T.DataTexture(data,resolution,resolution,T.RGBAFormat,T.UnsignedByteType);
 texture.name='oasis-terrain-depth-and-wet-shore';texture.minFilter=texture.magFilter=T.LinearFilter;texture.generateMipmaps=false;texture.flipY=false;texture.needsUpdate=true;
 return{texture,bounds,maxDepth,boundary,report:{resolution,shoreWidth,waterY:center.y,maxDepth,polygonLimited,maxHeightError,wetTexels,bounds:bounds.toArray()}};
}

/** Conservative triangle/frustum intersection for the actual water surface.
 * Runs in geometry-local space using the current model and camera matrices.
 * The six clipping planes also handle near-plane crossings and cameras on the
 * water plane; testing projected vertex bounds alone would miss those cases.
 * Returns true at numerical boundaries so a visible sliver is never culled.
 */
export function createWaterFrustumTest(geometry){
 const matrix=new T.Matrix4(),frustum=new T.Frustum(),point=new T.Vector3();
 let masks=new Uint8Array(geometry.attributes.position.count);
 const first=Array.from({length:12},()=>new T.Vector3()),second=Array.from({length:12},()=>new T.Vector3());
 const epsilon=.0001;
 return(matrixWorld,camera)=>{
  if(!camera?.projectionMatrix||!camera?.matrixWorldInverse||!matrixWorld)return true;
  matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(matrixWorld);
  if(!matrix.elements.every(Number.isFinite))return true;
  frustum.setFromProjectionMatrix(matrix,camera.coordinateSystem,camera.reversedDepth);
  const positions=geometry.attributes.position,index=geometry.index,planes=frustum.planes;
  if(masks.length!==positions.count)masks=new Uint8Array(positions.count);
  if(planes.some(plane=>!Number.isFinite(plane.constant)||!Number.isFinite(plane.normal.lengthSq())))return true;
  let commonOutside=63;
  for(let i=0;i<positions.count;i++){
   point.fromBufferAttribute(positions,i);let mask=0;
   for(let p=0;p<6;p++)if(planes[p].distanceToPoint(point)<-epsilon)mask|=1<<p;
   if(mask===0)return true;
   masks[i]=mask;commonOutside&=mask;
  }
  if(commonOutside!==0)return false;
  const start=Math.max(0,geometry.drawRange.start),end=Math.min(index?.count??positions.count,start+geometry.drawRange.count);
  for(let triangle=start;triangle+2<end;triangle+=3){
   const ia=index?index.getX(triangle):triangle,ib=index?index.getX(triangle+1):triangle+1,ic=index?index.getX(triangle+2):triangle+2;
   if((masks[ia]&masks[ib]&masks[ic])!==0)continue;
   let input=first,output=second,count=3;
   input[0].fromBufferAttribute(positions,ia);input[1].fromBufferAttribute(positions,ib);input[2].fromBufferAttribute(positions,ic);
   for(const plane of planes){
    let written=0,previous=input[count-1],previousDistance=plane.distanceToPoint(previous)+epsilon;
    for(let vertex=0;vertex<count;vertex++){
     const current=input[vertex],distance=plane.distanceToPoint(current)+epsilon;
     if((distance>=0)!==(previousDistance>=0))output[written++].lerpVectors(previous,current,previousDistance/(previousDistance-distance));
     if(distance>=0)output[written++].copy(current);
     previous=current;previousDistance=distance;
    }
    count=written;if(!count)break;
    const swap=input;input=output;output=swap;
   }
   if(count)return true;
  }
  return false;
 };
}
