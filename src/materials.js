import * as T from 'three';

export async function createMaterials(renderer,blockout){
 const gray=new T.MeshStandardMaterial({color:0xaca89f,roughness:1});
 if(blockout)return new Proxy({},{get:()=>gray});
 const loader=new T.TextureLoader(),anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 async function texture(path,color=false){
  const map=await loader.loadAsync(path);map.wrapS=map.wrapT=T.RepeatWrapping;
  map.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;map.anisotropy=anisotropy;return map;
 }
 const [stone,sand,cliff,ripple]=await Promise.all([
  Promise.all(['color','normalGL','roughness'].map(n=>texture(`assets/vendor/polyhaven/sandstone_cracks/${n}.jpg`,n==='color'))),
  Promise.all(['color','normalGL','roughness'].map(n=>texture(`assets/vendor/polyhaven/sand_01/${n}.jpg`,n==='color'))),
  texture('assets/textures/cliff.png',true),
  texture('assets/textures/sand.png',true),
 ]);
 function surface(maps,color,repeat=1,normal=.65){
  const copies=maps.map(map=>{const copy=map.clone();copy.repeat.setScalar(repeat);copy.needsUpdate=true;return copy;});
  return new T.MeshStandardMaterial({color,map:copies[0],normalMap:copies[1],roughnessMap:copies[2],normalScale:new T.Vector2(normal,normal),roughness:1});
 }
 const mats={
  stone:surface(stone,0xc5c7c1,1.25,.6),
  trim:surface(stone,0xdeddd3,1.25,.42),
  darkstone:surface(stone,0x7f8e91,1.25,.7),
  sand:surface([ripple,sand[1],sand[2]],0xd5d1c1,1,.13),
  rock:new T.MeshStandardMaterial({color:0xa8aaa3,map:cliff,bumpMap:cliff,bumpScale:.12,roughness:.96}),
  cliff:new T.MeshStandardMaterial({color:0xaca39a,map:cliff,bumpMap:cliff,bumpScale:.3,roughness:1}),
  wood:new T.MeshStandardMaterial({color:0x665346,map:cliff,roughness:.94}),
  bronze:new T.MeshStandardMaterial({color:0xa07d40,metalness:.82,roughness:.36}),
  cloth:surface(sand,0x935c3f,1,.06),
  leaf:new T.MeshStandardMaterial({color:0x556b4c,roughness:.86}),
  dryleaf:new T.MeshStandardMaterial({color:0x92946d,roughness:.92}),
  deep:new T.MeshStandardMaterial({color:0x303d3c,roughness:1}),
 };
 mats.leaf.side=mats.dryleaf.side=mats.cloth.side=T.DoubleSide;
 mats.wind=createWindSystem();
 for(const kind of['leaf','dryleaf','cloth'])mats.wind.applyMaterial(mats[kind],kind);
 const shoreUniforms={oasisShoreField:{value:null},oasisShoreRect:{value:new T.Vector4(0,0,1,1)},oasisWetStrength:{value:0}};
 let wetStrength=.72;
 mats.wetShore={
  setField(field){shoreUniforms.oasisShoreField.value=field.texture;shoreUniforms.oasisShoreRect.value.copy(field.bounds);shoreUniforms.oasisWetStrength.value=wetStrength;},
  configure({strength}={}){if(Number.isFinite(strength)){wetStrength=T.MathUtils.clamp(strength,0,1);if(shoreUniforms.oasisShoreField.value)shoreUniforms.oasisWetStrength.value=wetStrength;}},
  snapshot:()=>({strength:wetStrength,enabled:!!shoreUniforms.oasisShoreField.value}),
 };
 // Broad wind-scoured variation is larger than the scanned grains; normals stay physical.
 mats.sand.onBeforeCompile=shader=>{
  shader.uniforms.scouredBed={value:sand[0]};
  Object.assign(shader.uniforms,shoreUniforms);
  shader.vertexShader='varying vec3 vGround;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGround=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader='varying vec3 vGround;uniform sampler2D scouredBed;uniform sampler2D oasisShoreField;uniform vec4 oasisShoreRect;uniform float oasisWetStrength;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   vec3 bed=texture2D(scouredBed,vGround.xz/1.5).rgb;
   float luminance=dot(bed,vec3(.2126,.7152,.0722));
   bed=mix(vec3(luminance),bed,.14)*vec3(1.02,1.0,.96)*diffuse;
   float lane=(1.-smoothstep(1.6,4.4,abs(vGround.x+37.)))*smoothstep(11.,17.,vGround.z)*(1.-smoothstep(38.,48.,vGround.z));
   diffuseColor.rgb=mix(diffuseColor.rgb,bed,.46+lane*.45);
   float drift=sin(vGround.x*.052+sin(vGround.z*.061)*2.1)*.5+.5;
   float dune=sin(vGround.z*.028-vGround.x*.014)*.5+.5;
   diffuseColor.rgb*=mix(vec3(.80,.85,.91),vec3(1.08,1.02,.92),drift*.65+dune*.35);
   // This small local field is baked from the actual terrain triangles and
   // visible water boundary, rather than a global elevation or ellipse band.
   vec2 shoreUV=(vGround.xz-oasisShoreRect.xy)/oasisShoreRect.zw;
   float shoreWet=0.;
   if(oasisWetStrength>0.&&all(greaterThanEqual(shoreUV,vec2(0.)))&&all(lessThanEqual(shoreUV,vec2(1.))))shoreWet=texture2D(oasisShoreField,shoreUV).g*oasisWetStrength;
   diffuseColor.rgb*=mix(vec3(1.),vec3(.73,.79,.78),shoreWet);
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,min(roughnessFactor,.52),shoreWet);');
 };
 return mats;
}

const WIND_KINDS={
 palm:{amplitude:.16,maxAmplitude:.32,axis:[0,.45,1]},
 cloth:{amplitude:.07,maxAmplitude:.14,axis:[0,.16,1]},
 leaf:{amplitude:.022,maxAmplitude:.04,axis:[1,.25,.55]},
 dryleaf:{amplitude:.016,maxAmplitude:.03,axis:[1,.25,.55]},
};
const WIND_VERTEX=`
attribute vec4 aDesertWind;
uniform float uDesertWindTime;
uniform float uDesertWindStrength;
uniform float uDesertWindAmplitude;
uniform vec3 uDesertWindAxis;
void desertWindField(vec3 p,out vec3 offset,out vec3 gradient){
 vec4 anchor=vec4(0.,0.,0.,1.);
 #ifdef USE_INSTANCING
  anchor=instanceMatrix*anchor;
 #endif
 anchor=modelMatrix*anchor;
 vec3 frequency=vec3(.31,.17,.23);
 float phase=dot(anchor.xz,vec2(.039,.031))+dot(p,frequency);
 float slow=uDesertWindTime*.85+phase;
 float ripple=uDesertWindTime*1.9+phase*1.37;
 float wave=.72*sin(slow)+.28*sin(ripple);
 float derivative=.72*cos(slow)+.3836*cos(ripple);
 float amplitude=uDesertWindAmplitude*uDesertWindStrength;
 offset=uDesertWindAxis*(aDesertWind.x*wave*amplitude);
 gradient=amplitude*(aDesertWind.yzw*wave+aDesertWind.x*derivative*frequency);
}
vec3 desertWindPosition(vec3 p){vec3 offset,gradient;desertWindField(p,offset,gradient);return p+offset;}
vec3 desertWindNormal(vec3 p,vec3 n){
 vec3 offset,gradient;desertWindField(p,offset,gradient);
 return normalize(n-gradient*dot(uDesertWindAxis,n)/max(.35,1.+dot(gradient,uDesertWindAxis)));
}
`;

/** Anchored cosmetic wind shared by foliage/cloth and their shadow materials.
 * Amplitudes are local metres, before existing instance scale. Default palm
 * tips move at most ~0.20 world metres in this layout; roots remain immobile.
 * No new draws, textures, lights, or render passes. Pausing freezes the wind
 * clock and consumes elapsed input while paused, so resuming never catches up.
 */
export function createWindSystem(options={}){
 const time={value:0},strength={value:1},amplitudes={},axes={};
 const attached=new WeakSet(),prepared=new WeakMap(),depthMaterials=new Set();
 let speed=1,paused=false,lastTime=null;
 for(const [kind,config]of Object.entries(WIND_KINDS)){
  amplitudes[kind]={value:config.amplitude};axes[kind]={value:new T.Vector3(...config.axis)};
 }
 function configure(values={}){
  if(Number.isFinite(values.strength))strength.value=T.MathUtils.clamp(values.strength,0,1.5);
  if(Number.isFinite(values.speed))speed=T.MathUtils.clamp(values.speed,0,1.5);
  for(const [kind,config]of Object.entries(WIND_KINDS)){
   const value=values[kind+'Amplitude'];if(Number.isFinite(value))amplitudes[kind].value=T.MathUtils.clamp(value,0,config.maxAmplitude);
  }
 }
 function applyMaterial(material,kind){
  if(!material?.isMaterial||!WIND_KINDS[kind]||attached.has(material))return;
  const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
   previous.call(material,shader,renderer);
   Object.assign(shader.uniforms,{uDesertWindTime:time,uDesertWindStrength:strength,
    uDesertWindAmplitude:amplitudes[kind],uDesertWindAxis:axes[kind]});
   shader.vertexShader=WIND_VERTEX+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',
    '#include <beginnormal_vertex>\nobjectNormal=desertWindNormal(position,objectNormal);');
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
    '#include <begin_vertex>\ntransformed=desertWindPosition(transformed);');
  };
  material.customProgramCacheKey=()=>previousKey+'|desert-wind-v1:'+kind;
  material.needsUpdate=true;attached.add(material);
 }
 function prepareGeometry(geometry,kind,assetType){
  if(prepared.has(geometry))return prepared.get(geometry);
  const positions=geometry.attributes.position,index=geometry.index,count=positions.count;
  const weights=new Float32Array(count),data=new Float32Array(count*4),areas=new Float32Array(count);
  geometry.computeBoundingBox();const bounds=geometry.boundingBox;
  if(kind==='palm'){
   const length=Math.max(.01,bounds.max.x-bounds.min.x);
   for(let i=0;i<count;i++){const t=T.MathUtils.clamp((positions.getX(i)-bounds.min.x)/length,0,1);weights[i]=t*t;}
  }else if(kind==='cloth'&&(assetType==='temple'||assetType==='house1')){
   const height=Math.max(.01,bounds.max.y-bounds.min.y);
   for(let i=0;i<count;i++){const t=T.MathUtils.clamp((bounds.max.y-positions.getY(i))/height,0,1);weights[i]=t*t;}
  }else if(kind==='cloth'&&assetType==='house2'){
   // The authored awning has four supported corners and one hanging centre.
   for(let i=0;i<count;i++)weights[i]=Math.max(0,1-(positions.getX(i)/3)**2)*Math.max(0,1-((positions.getZ(i)-4.95)/1.15)**2);
  }else if((kind==='leaf'||kind==='dryleaf')&&assetType==='bush'){
   // Each authored leaf is a separate triangle. Its lowest vertex joins the
   // immobile woody branch; only the blade bends, never the branch attachment.
   const n=index?.count??count;
   for(let i=0;i<n;i+=3){
    const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k),ys=ids.map(id=>positions.getY(id));
    const low=Math.min(...ys),span=Math.max(.0001,Math.max(...ys)-low);
    for(let k=0;k<3;k++)weights[ids[k]]=Math.max(weights[ids[k]],T.MathUtils.clamp((ys[k]-low)/span,0,1));
   }
  }
  // Per-triangle weight gradients keep lighting normals consistent with the
  // same displacement. This also handles the awning's coarse centre triangles.
  const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),ab=new T.Vector3(),ac=new T.Vector3(),normal=new T.Vector3(),gradient=new T.Vector3(),part=new T.Vector3();
  for(let i=0,n=index?.count??count;i<n;i+=3){
   const ia=index?index.getX(i):i,ib=index?index.getX(i+1):i+1,ic=index?index.getX(i+2):i+2;
   a.fromBufferAttribute(positions,ia);b.fromBufferAttribute(positions,ib);c.fromBufferAttribute(positions,ic);
   ab.subVectors(b,a);ac.subVectors(c,a);normal.crossVectors(ab,ac);const square=normal.lengthSq();if(square<1e-12)continue;
   const area=Math.sqrt(square);
   gradient.crossVectors(ac,normal).multiplyScalar(weights[ib]-weights[ia]);
   part.crossVectors(normal,ab).multiplyScalar(weights[ic]-weights[ia]);gradient.add(part).multiplyScalar(area/square);
   for(const id of[ia,ib,ic]){data[id*4+1]+=gradient.x;data[id*4+2]+=gradient.y;data[id*4+3]+=gradient.z;areas[id]+=area;}
  }
  for(let i=0;i<count;i++){data[i*4]=weights[i];if(areas[i])for(let k=1;k<4;k++)data[i*4+k]/=areas[i];}
  geometry.setAttribute('aDesertWind',new T.BufferAttribute(data,4));
  // Inflate for the full configurable envelope, not just the current default.
  // InstancedMesh.computeBoundingSphere then includes every swaying tip.
  const maxAmplitude=WIND_KINDS[kind].maxAmplitude*1.5,maxOffset=new T.Vector3(...WIND_KINDS[kind].axis).multiplyScalar(maxAmplitude);
  geometry.boundingBox.min.sub(maxOffset);geometry.boundingBox.max.add(maxOffset);
  geometry.computeBoundingSphere();geometry.boundingSphere.radius+=maxOffset.length();
  const result={kind,anchoredVertices:weights.reduce((n,w)=>n+(w===0),0),vertices:count,maxLocalDisplacement:maxOffset.length()};
  prepared.set(geometry,result);return result;
 }
 function attachMesh(mesh,kind,{assetType=kind}={}){
  if(!mesh?.geometry||!WIND_KINDS[kind]||Array.isArray(mesh.material))return null;
  const report=prepareGeometry(mesh.geometry,kind,assetType);applyMaterial(mesh.material,kind);
  if(mesh.castShadow){
   if(!mesh.customDepthMaterial){mesh.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,
    map:mesh.material.map,alphaMap:mesh.material.alphaMap,alphaTest:mesh.material.alphaTest,side:mesh.material.side});depthMaterials.add(mesh.customDepthMaterial);}
   applyMaterial(mesh.customDepthMaterial,kind);
  }
  if(mesh.isInstancedMesh){mesh.computeBoundingBox();mesh.computeBoundingSphere();}
  mesh.userData.wind=report;return report;
 }
 function update(elapsed,{paused:framePaused=false}={}){
  if(!Number.isFinite(elapsed))return;
  if(lastTime!==null&&!paused&&!framePaused)time.value+=T.MathUtils.clamp(elapsed-lastTime,0,.1)*speed;
  lastTime=elapsed;
 }
 configure(options);
 return{applyMaterial,attachMesh,update,configure,setPaused:value=>{paused=!!value;},
  snapshot:()=>({time:time.value,paused,strength:strength.value,speed,...Object.fromEntries(Object.keys(WIND_KINDS).map(kind=>[kind+'Amplitude',amplitudes[kind].value]))}),
  dispose:()=>{for(const material of depthMaterials)material.dispose();depthMaterials.clear();},
 };
}
