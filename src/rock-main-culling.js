import * as T from 'three';

// A conservative bound for affine transforms, including nonuniform/negative
// scale and shear. For the scene's ordinary TRS matrices this is the exact
// largest scale; the rare sheared case uses the larger Frobenius bound.
function sphereScale(matrix) {
  const e=matrix.elements;
  const a=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],b=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],c=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];
  const ab=e[0]*e[4]+e[1]*e[5]+e[2]*e[6],ac=e[0]*e[8]+e[1]*e[9]+e[2]*e[10],bc=e[4]*e[8]+e[5]*e[9]+e[6]*e[10];
  const epsilon=1e-10*Math.max(1,a,b,c);
  return Math.sqrt(Math.abs(ab)>epsilon||Math.abs(ac)>epsilon||Math.abs(bc)>epsilon?a+b+c:Math.max(a,b,c))*(1+1e-9);
}

/** Experimental, disabled by default. Only the known main camera (and its AO
 * pass) uses compact instance buffers. Full original banks remain present in
 * the SAME layers with their original shadow callbacks and shadow flags.
 * Reflection cameras always draw the full banks. No main-camera visibility
 * flag or compact buffer is used to decide which rocks can cast a shadow.
 *
 * Call beginFrame() before changing the source LOD, then update(mainCamera)
 * after the source LOD has updated and before composer.render(). Data upload
 * is prepared here, never in draw callbacks: Three uploads instance attributes
 * before onBeforeRender / onBeforeShadow and caches that upload per frame.
 */
export function createRockMainCulling(scene,sources,{enabled=false,padding=.02}={}) {
  if(!Array.isArray(sources)||!sources.length)throw new TypeError('Rock culling requires source instance banks.');
  if(!Number.isFinite(padding)||padding<0)throw new RangeError('Bounds padding must be finite and nonnegative.');
  const root=new T.Group();root.name='rock-main-compact-banks';root.visible=false;scene.add(root);
  const entries=[],frustum=new T.Frustum(),projectionView=new T.Matrix4(),instance=new T.Matrix4(),rootInverse=new T.Matrix4(),worldSphere=new T.Sphere();
  let active=false,disposed=false,mainCamera=null,updates=0,rebuilds=0,probes=0,lastMilliseconds=0;
  const visibleInTree=mesh=>{for(let p=mesh;p;p=p.parent)if(!p.visible)return false;return true;};
  for(const source of sources){
    if(!source?.isInstancedMesh||Array.isArray(source.material)||source.morphTexture)throw new TypeError('Rock culling supports non-morphed, single-material instance banks.');
    const capacity=source.instanceMatrix.count,proxy=new T.InstancedMesh(source.geometry,source.material,capacity);
    proxy.name=source.name+':main-compact';proxy.matrixAutoUpdate=false;proxy.castShadow=false;proxy.receiveShadow=source.receiveShadow;
    proxy.layers.mask=source.layers.mask;proxy.renderOrder=source.renderOrder;proxy.count=0;proxy.visible=false;
    // The selected spheres are tested against the exact current camera here.
    // Avoid a second, potentially stale aggregate bound. Other cameras receive
    // count zero, while the original full banks retain native frustum culling.
    proxy.frustumCulled=false;proxy.instanceMatrix.setUsage(T.DynamicDrawUsage);
    if(source.instanceColor){
      proxy.instanceColor=new T.InstancedBufferAttribute(new source.instanceColor.array.constructor(capacity*3),3,source.instanceColor.normalized);
      proxy.instanceColor.setUsage(T.DynamicDrawUsage);
    }
    proxy.userData={...source.userData,compactSource:source.name,sourceIndices:new Uint32Array(0)};
    root.add(proxy);
    const entry={source,proxy,capacity,indices:new Uint32Array(capacity),spheres:[],fullCount:source.count,kept:0,
      matrixVersion:-1,colorVersion:-1,positionVersion:-1,boundsKey:'',matrixWorld:new T.Matrix4(),selection:[],sourceStack:[],proxyStack:[],handlers:null};
    entry.before=function(renderer,renderScene,camera,...rest){
      entry.handlers.before.call(this,renderer,renderScene,camera,...rest);
      entry.sourceStack.push(this.count);
      // Use the saved full count even if a reflected render re-enters while an
      // outer main draw is temporarily zero. The after hook restores that zero.
      this.count=active&&camera===mainCamera?0:entry.fullCount;
    };
    entry.after=function(...args){
      if(entry.sourceStack.length)this.count=entry.sourceStack.pop();
      entry.handlers.after.apply(this,args);
    };
    proxy.onBeforeRender=function(renderer,renderScene,camera){
      entry.proxyStack.push(this.count);this.count=active&&camera===mainCamera?entry.kept:0;
    };
    proxy.onAfterRender=function(){if(entry.proxyStack.length)this.count=entry.proxyStack.pop();};
    entries.push(entry);
  }

  function beginFrame(){
    // Native callbacks balance synchronously. Recover counts if rendering was
    // interrupted by an exception, BEFORE the owner mutates any LOD counts.
    for(const e of entries){
      if(e.sourceStack.length){e.source.count=e.sourceStack[0];e.sourceStack.length=0;}
      if(e.proxyStack.length){e.proxy.count=e.proxyStack[0];e.proxyStack.length=0;}
    }
  }
  function update(camera){
    if(disposed||!camera?.isCamera)return;
    mainCamera=camera;if(!active)return;
    beginFrame();const started=globalThis.performance?.now?.()??0;updates++;
    camera.updateWorldMatrix(true,false);root.updateWorldMatrix(true,false);rootInverse.copy(root.matrixWorld).invert();
    projectionView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    if(!projectionView.elements.every(Number.isFinite)){setEnabled(false);return;}
    frustum.setFromProjectionMatrix(projectionView,camera.coordinateSystem,camera.reversedDepth);
    for(const e of entries){
      const {source,proxy}=e;source.updateWorldMatrix(true,false);
      const count=source.count;
      if(!Number.isInteger(count)||count<0||count>e.capacity){setEnabled(false);return;}
      e.fullCount=count;proxy.material=source.material;proxy.receiveShadow=source.receiveShadow;proxy.layers.mask=source.layers.mask;proxy.renderOrder=source.renderOrder;
      proxy.matrix.multiplyMatrices(rootInverse,source.matrixWorld);proxy.matrixWorldNeedsUpdate=true;
      // Match the original opaque sort key; this bound is not used for culling
      // the compact bank (the per-instance tests below already did that).
      proxy.boundingSphere=source.boundingSphere;proxy.boundingBox=source.boundingBox;
      const geometry=source.geometry;
      if(proxy.geometry!==geometry){proxy.geometry=geometry;e.matrixVersion=-1;}
      if(!geometry.boundingSphere)geometry.computeBoundingSphere();
      const bounds=geometry.boundingSphere,wind=Math.max(0,Number(source.userData.wind?.maxLocalDisplacement)||0);
      // Wind meshes already expand their geometry bounds. This extra padding is
      // intentionally conservative should such a mesh ever enter this module.
      const boundsKey=[...bounds.center.toArray(),bounds.radius,wind].join(',');
      const changed=e.matrixVersion!==source.instanceMatrix.version||e.positionVersion!==geometry.attributes.position.version||e.boundsKey!==boundsKey||e.spheres.length<count;
      if(changed){
        for(let i=0;i<count;i++){
          instance.fromArray(source.instanceMatrix.array,i*16);
          const sphere=e.spheres[i]||(e.spheres[i]=new T.Sphere());
          sphere.center.copy(bounds.center).applyMatrix4(instance);sphere.radius=(bounds.radius+wind)*sphereScale(instance);
        }
      }
      const worldScale=sphereScale(source.matrixWorld),selection=[];
      if(visibleInTree(source))for(let i=0;i<count;i++){
        const sphere=e.spheres[i];worldSphere.center.copy(sphere.center).applyMatrix4(source.matrixWorld);worldSphere.radius=sphere.radius*worldScale+padding;probes++;
        if(!source.frustumCulled||frustum.intersectsSphere(worldSphere))selection.push(i);
      }
      const colorChanged=e.colorVersion!==(source.instanceColor?.version??-1);
      const repack=changed||colorChanged||selection.length!==e.selection.length||selection.some((index,i)=>index!==e.selection[i]);
      if(repack){
        for(let i=0;i<selection.length;i++){
          const index=selection[i];e.indices[i]=index;
          proxy.instanceMatrix.array.set(source.instanceMatrix.array.subarray(index*16,index*16+16),i*16);
          if(proxy.instanceColor&&source.instanceColor)proxy.instanceColor.array.set(source.instanceColor.array.subarray(index*3,index*3+3),i*3);
        }
        proxy.instanceMatrix.needsUpdate=true;if(proxy.instanceColor)proxy.instanceColor.needsUpdate=true;
        e.selection=selection;proxy.userData.sourceIndices=e.indices.subarray(0,selection.length);rebuilds++;
      }
      e.kept=selection.length;proxy.count=e.kept;proxy.visible=e.kept>0;
      e.matrixVersion=source.instanceMatrix.version;e.colorVersion=source.instanceColor?.version??-1;e.positionVersion=geometry.attributes.position.version;e.boundsKey=boundsKey;e.matrixWorld.copy(source.matrixWorld);
    }
    lastMilliseconds=(globalThis.performance?.now?.()??started)-started;
  }
  function setEnabled(value){
    if(disposed)return false;
    const next=!!value;if(next===active)return active;
    beginFrame();active=next;root.visible=active;
    for(const e of entries){
      if(active){
        e.handlers={before:e.source.onBeforeRender,after:e.source.onAfterRender};e.source.onBeforeRender=e.before;e.source.onAfterRender=e.after;
      }else{
        if(e.source.onBeforeRender===e.before)e.source.onBeforeRender=e.handlers.before;
        if(e.source.onAfterRender===e.after)e.source.onAfterRender=e.handlers.after;
        e.proxy.visible=false;
      }
    }
    if(active&&mainCamera)update(mainCamera);
    return active;
  }
  function snapshot(){
    const banks=entries.map(e=>({name:e.source.name,fullInstances:e.source.count,mainInstances:active?e.kept:e.source.count,
      fullTriangles:e.source.count*(e.source.geometry.index?.count??e.source.geometry.attributes.position.count)/3,
      mainTriangles:(active?e.kept:e.source.count)*(e.source.geometry.index?.count??e.source.geometry.attributes.position.count)/3}));
    return{enabled:active,scope:'main-and-AO-only',fullBatches:entries.length,mainBatches:banks.filter(b=>b.mainInstances>0).length,
      fullInstances:banks.reduce((n,b)=>n+b.fullInstances,0),mainInstances:banks.reduce((n,b)=>n+b.mainInstances,0),
      fullTriangles:banks.reduce((n,b)=>n+b.fullTriangles,0),mainTriangles:banks.reduce((n,b)=>n+b.mainTriangles,0),
      updates,rebuilds,probes,lastMilliseconds,banks};
  }
  function dispose(){
    if(disposed)return;setEnabled(false);disposed=true;root.removeFromParent();
    for(const e of entries)e.proxy.dispose(); // Shared geometry/material belong to the source LOD.
  }
  setEnabled(enabled);
  return{root,beginFrame,update,setEnabled,snapshot,dispose};
}
