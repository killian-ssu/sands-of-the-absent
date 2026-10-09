import * as T from 'three';

const readVector = (value, out) => {
  const xyz = Array.isArray(value) ? value : [value?.x,value?.y,value?.z];
  if(xyz.length!==3 || !xyz.every(Number.isFinite))return false;
  out.set(...xyz);return true;
};

function textureAlpha(texture) {
  const image=texture?.image,width=image?.width,height=image?.height;
  if(!width||!height)return null;
  let data=image.data,channels=data?.length/(width*height);
  if(!data && typeof document!=='undefined'){
    try{
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
      data=context.getImageData(0,0,width,height).data;channels=4;
    }catch{return null;}
  }
  if(!data||![1,4].includes(channels))return null;
  const mask=new Uint8Array(width*height);
  for(let i=0;i<mask.length;i++)mask[i]=data[i*channels+(channels===4?3:0)];
  const pixel=(x,y)=>mask[T.MathUtils.clamp(y,0,height-1)*width+T.MathUtils.clamp(x,0,width-1)]/255;
  return uv=>{
    const x=uv.x*width-.5,y=uv.y*height-.5,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    return T.MathUtils.lerp(T.MathUtils.lerp(pixel(ix,iy),pixel(ix+1,iy),fx),T.MathUtils.lerp(pixel(ix,iy+1),pixel(ix+1,iy+1),fx),fy);
  };
}

// Three's derivative-filtered alpha hash is stable on geometry and only runs
// during the short transition. Full visibility keeps the original cutout;
// zero visibility discards directly, leaving no persistent stippled canopy.
const hashGLSL=T.ShaderChunk.alphahash_pars_fragment
  .replace('#ifdef USE_ALPHAHASH','').replace('#endif','')
  .replaceAll('ALPHA_HASH_SCALE','CANOPY_HASH_SCALE')
  .replaceAll('getAlphaHashThreshold','canopyHashThreshold')
  .replaceAll('hash2D','canopyHash2D').replaceAll('hash3D','canopyHash3D');

/** Camera-only canopy removal. Tree trunks, instances, collisions, wind,
 * reflection appearance, and custom shadow materials are never changed.
 * update(dt,camera,{playerPosition,feet?,chest?,head?,selectedPosition?}) must
 * run after camera/wind updates, before the scene is rendered.
 */
export function createCanopyOcclusion(fronds,{
  frondsPerTree=13,getWindState=()=>null,enabled=true,probeInterval=.05,
  fadeOutSeconds=.18,fadeInSeconds=.45,releaseDelay=.35,playerHeight=1.75,
  screenProtection=true,screenHitsRequired=2,
}={}){
  if(!fronds?.isInstancedMesh||Array.isArray(fronds.material))throw new TypeError('Canopy occlusion requires the single-material frond instance bank.');
  const geometry=fronds.geometry,material=fronds.material,texture=material.map;
  const attributeName='aCanopyVisibility';
  if(geometry.hasAttribute(attributeName))throw new Error('Canopy occlusion is already attached.');
  const visibility=new T.InstancedBufferAttribute(new Float32Array(fronds.count).fill(1),1);visibility.setUsage(T.DynamicDrawUsage);
  geometry.setAttribute(attributeName,visibility);
  const count=Math.ceil(fronds.count/frondsPerTree),values=new Float32Array(count).fill(1),holds=new Float32Array(count);
  const uniforms={uCanopyMainCamera:{value:new T.Vector3(1e20,1e20,1e20)},uCanopyEnabled:{value:enabled?1:0}};
  const previousCompile=material.onBeforeCompile,previousKey=material.customProgramCacheKey;
  material.onBeforeCompile=function(shader,renderer){
    previousCompile.call(this,shader,renderer);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='attribute float aCanopyVisibility;varying float vCanopyVisibility;varying vec3 vCanopyHashPosition;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
      vCanopyVisibility=aCanopyVisibility;
      vCanopyHashPosition=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;
      #include <project_vertex>`);
    shader.fragmentShader='uniform vec3 uCanopyMainCamera;uniform float uCanopyEnabled;varying float vCanopyVisibility;varying vec3 vCanopyHashPosition;\n'+hashGLSL+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      // cameraPosition is the current pass camera. A reflected camera has a
      // different world position, so water continues to see the intact tree.
      if(uCanopyEnabled>.5 && distance(cameraPosition,uCanopyMainCamera)<.001){
        if(vCanopyVisibility<=.001)discard;
        if(vCanopyVisibility<.999 && vCanopyVisibility<canopyHashThreshold(vCanopyHashPosition))discard;
      }`);
  };
  material.customProgramCacheKey=function(){return previousKey.call(this)+'|camera-canopy-v1';};material.needsUpdate=true;

  const alpha=textureAlpha(texture),position=geometry.attributes.position,uvs=geometry.attributes.uv,index=geometry.index,windWeights=geometry.attributes.aDesertWind;
  const localBounds=geometry.boundingBox?.clone()||new T.Box3().setFromBufferAttribute(position);
  const trees=Array.from({length:count},()=>({leaves:[],box:new T.Box3(),sphere:new T.Sphere()}));
  const matrix=new T.Matrix4(),full=new T.Matrix4();fronds.updateWorldMatrix(true,false);texture?.updateMatrix();
  for(let i=0;i<fronds.count;i++){
    fronds.getMatrixAt(i,matrix);full.multiplyMatrices(fronds.matrixWorld,matrix);
    const box=localBounds.clone().applyMatrix4(full),tree=trees[Math.floor(i/frondsPerTree)];
    tree.box.union(box);tree.leaves.push({index:i,inverse:full.clone().invert(),anchor:new T.Vector3().setFromMatrixPosition(full),vertices:Array.from({length:position.count},()=>new T.Vector3())});
  }
  for(const tree of trees)tree.box.getBoundingSphere(tree.sphere);
  const cameraPoint=new T.Vector3(),feet=new T.Vector3(),chest=new T.Vector3(),head=new T.Vector3(),right=new T.Vector3(),selected=new T.Vector3();
  const projectedFocus=new T.Vector3(),forward=new T.Vector3(),direction=new T.Vector3();
  const targets=Array.from({length:34},()=>new T.Vector3()),worldRays=Array.from({length:34},()=>new T.Ray()),limits=new Float32Array(34),rayHits=new Uint8Array(34);
  const localOrigin=new T.Vector3(),localEnd=new T.Vector3(),localRay=new T.Ray(),hit=new T.Vector3(),barycentric=new T.Vector3(),sampleUV=new T.Vector2();
  let elapsed=0,nextProbe=0,disposed=false,lastCamera=null,occluded=new Set(),coreRays=0;
  const probeTimes=new Float32Array(120);let probeCursor=0,probeCount=0;
  const emptyStats=()=>({rays:0,coreRays:0,screenRays:0,candidateTrees:0,leafTests:0,triangleTests:0,triangleHits:0,alphaRejected:0,opaqueHits:0,bodyTriggeredTrees:[],screenTriggeredTrees:[],probeMilliseconds:0});
  let stats=emptyStats();
  function focus(camera,input){
    if(!readVector(input.feet||input.playerPosition,feet))return 0;
    camera.updateWorldMatrix(true,false);camera.getWorldPosition(cameraPoint);
    if(!readVector(input.chest,chest))chest.copy(feet).add(new T.Vector3(0,playerHeight*.56,0));
    if(!readVector(input.head,head))head.copy(feet).add(new T.Vector3(0,playerHeight*.96,0));
    right.setFromMatrixColumn(camera.matrixWorld,0).normalize();
    targets[0].copy(feet).y+=.18;targets[1].copy(chest);targets[2].copy(head);
    targets[3].copy(chest).addScaledVector(right,-.34);targets[4].copy(chest).addScaledVector(right,.34);
    targets[5].copy(head).addScaledVector(right,-.24);targets[6].copy(head).addScaledVector(right,.24);
    let n=7;
    if(readVector(input.selectedPosition,selected)&&selected.distanceTo(feet)<=6){
      targets[7].copy(selected);targets[8].copy(selected).y+=.35;n=9;
    }
    coreRays=n;
    if(screenProtection){
      // A body can sit in a small leaf gap while its entire approach and
      // interaction space remain covered. Sample that screen region too,
      // requiring multiple *opaque* hits from one tree, never just its bounds.
      // End on a plane in front of the player: background palms stay intact.
      projectedFocus.copy(chest).project(camera);camera.getWorldDirection(forward);
      const cx=T.MathUtils.clamp(projectedFocus.x,-.2,.2),cy=T.MathUtils.clamp(projectedFocus.y+.22,-.15,.15);
      const depth=Math.max(.1,direction.copy(chest).sub(cameraPoint).dot(forward)-.8);
      for(let row=0;row<5;row++)for(let column=0;column<5;column++){
        direction.set(cx+(column-2)*.3,cy+(row-2)*.3,.5).unproject(camera).sub(cameraPoint).normalize();
        targets[n++].copy(cameraPoint).addScaledVector(direction,depth/Math.max(.1,direction.dot(forward)));
      }
    }
    for(let i=0;i<n;i++){
      limits[i]=cameraPoint.distanceTo(targets[i])-.025;
      worldRays[i].set(cameraPoint,targets[i].clone().sub(cameraPoint).normalize());
    }
    return n;
  }
  function deform(leaf,wind){
    const time=Number(wind?.time)||0,amplitude=(Number(wind?.palmAmplitude)||0)*(Number(wind?.strength)||0);
    const phaseAnchor=leaf.anchor.x*.039+leaf.anchor.z*.031;
    for(let i=0;i<position.count;i++){
      const p=leaf.vertices[i].fromBufferAttribute(position,i),weight=windWeights?.getX(i)||0;
      if(amplitude&&weight){const phase=phaseAnchor+p.x*.31+p.y*.17+p.z*.23,wave=.72*Math.sin(time*.85+phase)+.28*Math.sin(time*1.9+phase*1.37),offset=amplitude*weight*wave;p.y+=offset*.45;p.z+=offset;}
    }
  }
  function leafBlocks(leaf,target){
    localOrigin.copy(cameraPoint).applyMatrix4(leaf.inverse);localEnd.copy(target).applyMatrix4(leaf.inverse);
    const distance=localOrigin.distanceTo(localEnd);if(distance<.025)return false;
    localRay.set(localOrigin,localEnd.sub(localOrigin).normalize());stats.leafTests++;
    if(!localBounds.containsPoint(localOrigin)){
      if(!localRay.intersectBox(localBounds,hit)||hit.distanceTo(localOrigin)>=distance)return false;
    }
    for(let i=0,n=index?.count??position.count;i<n;i+=3){
      const ia=index?index.getX(i):i,ib=index?index.getX(i+1):i+1,ic=index?index.getX(i+2):i+2;
      const a=leaf.vertices[ia],b=leaf.vertices[ib],c=leaf.vertices[ic];stats.triangleTests++;
      if(!localRay.intersectTriangle(a,b,c,false,hit)||hit.distanceTo(localOrigin)>=distance-.025)continue;
      stats.triangleHits++;
      if(alpha&&uvs){
        T.Triangle.getBarycoord(hit,a,b,c,barycentric);
        sampleUV.set(uvs.getX(ia)*barycentric.x+uvs.getX(ib)*barycentric.y+uvs.getX(ic)*barycentric.z,
          uvs.getY(ia)*barycentric.x+uvs.getY(ib)*barycentric.y+uvs.getY(ic)*barycentric.z);
        texture.transformUv(sampleUV);
        if(alpha(sampleUV)<material.alphaTest){stats.alphaRejected++;continue;}
      }
      stats.opaqueHits++;return true;
    }
    return false;
  }
  function probe(camera,input){
    const started=globalThis.performance?.now?.()??0,n=focus(camera,input),wind=getWindState();
    stats={...emptyStats(),rays:n,coreRays:n?coreRays:0,screenRays:n?n-coreRays:0};occluded=new Set();
    for(let i=0;i<trees.length&&n;i++){
      const tree=trees[i],rays=[];
      for(let j=0;j<n;j++)if(tree.sphere.containsPoint(cameraPoint)||(worldRays[j].intersectSphere(tree.sphere,hit)&&hit.distanceTo(cameraPoint)<limits[j]))rays.push(j);
      if(!rays.length)continue;stats.candidateTrees++;
      let blocked=false,screenHits=0;rayHits.fill(0);
      for(const leaf of tree.leaves){
        deform(leaf,wind);
        for(const j of rays){
          if(rayHits[j]||!leafBlocks(leaf,targets[j]))continue;
          rayHits[j]=1;
          if(j<coreRays){blocked=true;stats.bodyTriggeredTrees.push(i);break;}
          if(++screenHits>=screenHitsRequired){blocked=true;stats.screenTriggeredTrees.push(i);break;}
        }
        if(blocked)break;
      }
      if(blocked){occluded.add(i);holds[i]=elapsed+releaseDelay;}
    }
    stats.probeMilliseconds=(globalThis.performance?.now?.()??started)-started;
    probeTimes[probeCursor++%probeTimes.length]=stats.probeMilliseconds;probeCount=Math.min(probeCount+1,probeTimes.length);
  }
  function update(dt,camera,input={}){
    if(disposed||!camera?.isCamera)return;
    const delta=Number.isFinite(dt)?T.MathUtils.clamp(dt,0,.1):0;elapsed+=delta;
    camera.updateWorldMatrix(true,false);camera.getWorldPosition(uniforms.uCanopyMainCamera.value);
    if(enabled&&(elapsed>=nextProbe||camera!==lastCamera)){probe(camera,input);nextProbe=elapsed+probeInterval;lastCamera=camera;}
    let changed=false;
    for(let i=0;i<count;i++){
      const target=enabled&&(occluded.has(i)||elapsed<holds[i])?0:1,step=delta/(target===0?fadeOutSeconds:fadeInSeconds);
      const value=T.MathUtils.clamp(values[i]+Math.sign(target-values[i])*step,0,1);if(value===values[i])continue;
      values[i]=value;changed=true;
      for(let j=i*frondsPerTree;j<Math.min((i+1)*frondsPerTree,fronds.count);j++)visibility.setX(j,value);
    }
    if(changed)visibility.needsUpdate=true;
  }
  function setEnabled(value){enabled=!!value;uniforms.uCanopyEnabled.value=enabled?1:0;nextProbe=0;occluded.clear();holds.fill(0);return enabled;}
  function snapshot(){const times=Array.from(probeTimes.subarray(0,probeCount)).sort((a,b)=>a-b);return{enabled,mode:alpha?'triangle-alpha':'triangle-conservative',trees:count,fronds:fronds.count,
    probeWindow:{samples:probeCount,p50Ms:times[Math.floor((probeCount-1)*.5)]??0,p95Ms:times[Math.floor((probeCount-1)*.95)]??0,maxMs:times.at(-1)??0},
    ...stats,occludedTrees:[...occluded],hiddenTrees:Array.from(values,(v,i)=>v<.01?i:-1).filter(i=>i>=0),transitioningTrees:Array.from(values).filter(v=>v>.001&&v<.999).length,minimumVisibility:Math.min(...values)};}
  function dispose(){if(disposed)return;disposed=true;geometry.deleteAttribute(attributeName);material.onBeforeCompile=previousCompile;material.customProgramCacheKey=previousKey;material.needsUpdate=true;}
  return{update,setEnabled,snapshot,dispose};
}
