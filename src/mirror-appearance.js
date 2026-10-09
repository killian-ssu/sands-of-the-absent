import * as T from 'three';

// A small, private environment scene is filtered once. It is never added to the
// game scene and never participates in the recurring water/scene render loop.
function bakeDesertEnvironment(renderer,skyTexture){
 const environment=new T.Scene(),geometry=new T.SphereGeometry(10,24,12);
 const material=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,toneMapped:false,
  uniforms:{skyMap:{value:skyTexture},groundColor:{value:new T.Color(0xab906e)}},
  vertexShader:'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`uniform sampler2D skyMap; uniform vec3 groundColor; varying vec3 direction;
   void main(){
    vec3 d=normalize(direction);
    // Identical cloud mapping to the visible sky dome; its image is not a
    // conventional full-sphere panorama, so fromEquirectangular would distort it.
    vec2 uv=vec2(atan(d.z,d.x)/6.28318530718+.5,.2+max(0.,d.y)*.68);
    vec3 sky=texture2D(skyMap,uv).rgb;
    sky=mix(vec3(.38,.46,.5),sky,smoothstep(-.06,.32,d.y));
    vec3 ground=groundColor*(.82+.18*max(0.,-d.y));
    vec3 radiance=mix(ground,sky,smoothstep(-.32,.08,d.y));
    gl_FragColor=vec4(radiance,1.);
   }`,
 });
 environment.add(new T.Mesh(geometry,material));
 const generator=new T.PMREMGenerator(renderer);
 // Three 0.184's fromScene allocates its output internally, unlike the texture
 // entry point, and dispose() only owns its scratch target. Track this one
 // instance's allocation so a failed optional bake cannot orphan its output.
 const allocate=generator._allocateTargets.bind(generator);let pendingOutput=null;
 generator._allocateTargets=(...args)=>(pendingOutput=allocate(...args));
 const previous={target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),
  autoClear:renderer.autoClear,toneMapping:renderer.toneMapping,xr:renderer.xr.enabled,
  viewport:renderer.getViewport(new T.Vector4()),scissor:renderer.getScissor(new T.Vector4()),scissorTest:renderer.getScissorTest()};
 try{const output=generator.fromScene(environment,0,.1,30,{size:128});pendingOutput=null;return output;}
 catch(error){pendingOutput?.dispose();throw error;}
 finally{
  generator.dispose();geometry.dispose();material.dispose();
  // The normal PMREM path already restores these. Explicit restoration also
  // covers exceptions while preparing an optional experiment.
  renderer.autoClear=previous.autoClear;
  renderer.toneMapping=previous.toneMapping;renderer.xr.enabled=previous.xr;
  renderer.setViewport(previous.viewport);renderer.setScissor(previous.scissor);renderer.setScissorTest(previous.scissorTest);
  // Restoring the target last reinstates its own physical viewport/scissor;
  // applying the canvas's logical viewport after this would corrupt active RTs.
  renderer.setRenderTarget(previous.target,previous.face,previous.mip);
 }
}

/** Materials-only mirror A/B. Baseline is the exact original material object.
 * prepare(renderer) reuses the visible skyMap already present in scene. Passing
 * {skyTexture} overrides that lookup; {environmentTexture} borrows an existing
 * prefiltered CubeUV map instead. No network access or per-frame render hook.
 */
export function createMirrorAppearance(scene,{mirrors,frontMaterial,backMaterial,bakeEnvironment=bakeDesertEnvironment}){
 const faces=[];
 for(const disc of mirrors)for(const child of disc.children){
  if(child.isMesh&&child.material===frontMaterial)faces.push({mesh:child,original:frontMaterial,side:'front'});
  else if(child.isMesh&&child.material===backMaterial)faces.push({mesh:child,original:backMaterial,side:'back'});
 }
 const front=frontMaterial.clone(),back=backMaterial.clone();
 front.name='mirror-polished-desert-experiment';front.color.setHex(0xd5d0bd);
 front.metalness=.86;front.roughness=.23;front.clearcoat=.65;front.clearcoatRoughness=.13;
 front.emissive.setHex(0);front.emissiveIntensity=0;front.envMapIntensity=1.08;
 back.name='mirror-aged-bronze-back-experiment';back.color.setHex(0xa28c68);
 back.metalness=.38;back.roughness=.58;back.envMapIntensity=.78;
 let enabled=false,disposed=false,target=null,prepared=false,source=null,rendererRef=null,bakes=0,lastError=null,kind=null;
 const apply=()=>{for(const face of faces)face.mesh.material=enabled?(face.side==='front'?front:back):face.original;};
 const findSky=()=>{let sky=null;scene.traverse(object=>{if(!sky&&object.material?.uniforms?.skyMap?.value?.isTexture)sky=object.material.uniforms.skyMap.value;});return sky;};
 function prepare(renderer,{skyTexture=null,environmentTexture=null}={}){
  if(disposed)return false;
  const nextSource=environmentTexture||skyTexture||findSky();
  if(!nextSource){lastError='No loaded skyMap found; supply skyTexture or a prefiltered environmentTexture.';return false;}
  if(prepared&&nextSource===source&&renderer===rendererRef)return true;
  let nextTarget=null;
  try{
   if(!environmentTexture){if(!renderer)throw new TypeError('Sky PMREM preparation requires the existing WebGLRenderer.');nextTarget=bakeEnvironment(renderer,nextSource);if(!nextTarget?.texture)throw new Error('PMREM preparation returned no environment texture.');}
   const texture=environmentTexture||nextTarget.texture;
   front.envMap=back.envMap=texture;front.needsUpdate=back.needsUpdate=true;
   target?.dispose();target=nextTarget;source=nextSource;rendererRef=renderer;prepared=true;lastError=null;
   if(nextTarget)bakes++;kind=environmentTexture?'borrowed-prefiltered-map':'one-time-desert-sky-pmrem';return true;
  }catch(error){nextTarget?.dispose();lastError=String(error?.message||error);return false;}
 }
 function setEnabled(value){if(disposed)return false;if(value&&!prepared)return false;enabled=!!value;apply();return enabled;}
 function snapshot(){return{enabled,prepared,disposed,frontFaces:faces.filter(f=>f.side==='front').length,backFaces:faces.filter(f=>f.side==='back').length,
  environment:kind,bakes,cubeFaceSize:target?128:null,lastError,extraPerFrameRenders:0,extraDrawCalls:0,
  front:{color:'#'+front.color.getHexString(),metalness:front.metalness,roughness:front.roughness,environmentIntensity:front.envMapIntensity},
  back:{color:'#'+back.color.getHexString(),metalness:back.metalness,roughness:back.roughness,environmentIntensity:back.envMapIntensity}};}
 function dispose(){if(disposed)return;enabled=false;apply();disposed=true;front.dispose();back.dispose();target?.dispose();target=null;source=null;rendererRef=null;}
 return{prepare,setEnabled,snapshot,dispose};
}
