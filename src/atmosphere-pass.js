import * as T from 'three';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';

export const ATMOSPHERE_DEFAULTS=Object.freeze({
  density:.0048,baseHeight:2,heightFalloff:9,nearDistance:14,maxOpacity:.28,
  sunScatter:.2,anisotropy:.35,dustColor:0xc5b59c,sunColor:0xffddb6,
  playerClearRadius:3.2,playerClearFeather:5,selectionClearRadius:1.5,selectionClearFeather:3,
});

/** Attach BEFORE the composer's first render. Both ping-pong targets need
 * independent depth textures: RenderPass writes to whichever readBuffer is
 * current this frame. Never bind a fixed renderTarget1/2 depth in the pass.
 * Composer owns these textures and handles their resize/disposal. Re-run this
 * helper after composer.reset(customTarget) if that target has no depth texture.
 */
export function attachAtmosphereDepth(composer){
  const targets=[composer?.renderTarget1,composer?.renderTarget2];
  if(targets.some(target=>!target?.isWebGLRenderTarget))throw new TypeError('Atmosphere requires the two EffectComposer render targets.');
  if(targets[0]===targets[1])throw new Error('Composer ping-pong targets must be distinct.');
  for(let i=0;i<targets.length;i++){
    const target=targets[i];
    if(target.samples)throw new Error('Attach atmosphere to the normal non-MSAA composer targets.');
    if(!target.depthTexture){
      // Also handles a target that was allocated before this helper was called.
      target.dispose();
      const texture=new T.DepthTexture(target.width,target.height,T.UnsignedIntType);
      texture.name=`atmosphere-main-depth-${i+1}`;texture.format=T.DepthFormat;
      texture.minFilter=texture.magFilter=T.NearestFilter;texture.generateMipmaps=false;
      target.depthTexture=texture;
    }
    if(!target.depthTexture.isDepthTexture||target.depthTexture.compareFunction!==null)throw new TypeError('Atmosphere needs an ordinary sampled DepthTexture, not shadow comparison depth.');
    target.depthBuffer=true;
  }
  if(targets[0].depthTexture===targets[1].depthTexture)throw new Error('Each composer target must own a separate DepthTexture.');
  return targets.map(target=>target.depthTexture);
}

const vertexShader=`varying vec2 vUv;
void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

const fragmentShader=`
uniform sampler2D tDiffuse,tDepth;
uniform mat4 uInverseProjection,uCameraWorld;
uniform vec3 uCameraPosition,uSunDirection,uDustColor,uSunColor;
uniform vec4 uPlayer,uSelection;
uniform float uDensity,uBaseHeight,uHeightFalloff,uNearDistance,uMaxOpacity;
uniform float uSunScatter,uAnisotropy,uPlayerClearRadius,uPlayerClearFeather;
uniform float uSelectionClearRadius,uSelectionClearFeather;
varying vec2 vUv;

// Integral of exp(-max(height,0)) with unit density below the layer base.
// This piecewise primitive handles rays crossing the layer and horizontal rays
// without raymarching, banded steps, or an infinitely dense underground layer.
float densityPrimitive(float h){return h<=0.?h:1.-exp(-h);}
float averageHeightDensity(float a,float b){
  if(abs(b-a)<.001)return exp(-max((a+b)*.5,0.));
  return clamp((densityPrimitive(b)-densityPrimitive(a))/(b-a),0.,1.);
}
void main(){
  vec4 source=texture2D(tDiffuse,vUv);
  float depth=texture2D(tDepth,vUv).r;
  // The sky dome has depthWrite=false; untouched depth is exactly the clear
  // value. Do not turn the sky into a fake surface at camera.far.
  if(depth>=1.||uDensity<=0.){gl_FragColor=source;return;}
  vec4 view=uInverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);
  view/=view.w;
  vec3 world=(uCameraWorld*view).xyz;
  vec3 ray=world-uCameraPosition;float distanceToSurface=length(ray);
  if(distanceToSurface<=uNearDistance){gl_FragColor=source;return;}
  vec3 direction=ray/max(distanceToSurface,.0001);
  float startHeight=uCameraPosition.y+direction.y*uNearDistance;
  float density=averageHeightDensity((startHeight-uBaseHeight)/uHeightFalloff,(world.y-uBaseHeight)/uHeightFalloff);
  float opticalDepth=uDensity*(distanceToSurface-uNearDistance)*density;
  float amount=min(uMaxOpacity,1.-exp(-min(opticalDepth,12.)));
  if(uPlayer.w>.5)amount*=smoothstep(uPlayerClearRadius,uPlayerClearRadius+uPlayerClearFeather,distance(world,uPlayer.xyz));
  if(uSelection.w>.5)amount*=smoothstep(uSelectionClearRadius,uSelectionClearRadius+uSelectionClearFeather,distance(world,uSelection.xyz));

  // Directional in-scattering, not occlusion-tested shafts: a broad warm veil
  // looking toward the sun. This intentionally adds no shadow-map sample.
  float g=uAnisotropy,mu=dot(direction,uSunDirection);
  float phase=(1.-g*g)/pow(max(1.+g*g-2.*g*mu,.01),1.5);
  float phaseMax=(1.+g)/((1.-g)*(1.-g));
  float forwardScatter=clamp((phase-1.)/max(phaseMax-1.,.001),0.,1.);
  vec3 fogColor=mix(uDustColor,uSunColor,forwardScatter*uSunScatter);
  // Additive lantern beams are already composited but do not write depth.
  // Keep their HDR highlights legible, even when their background is far away.
  float bright=max(source.r,max(source.g,source.b));
  amount*=mix(1.,.3,smoothstep(1.15,3.5,bright));
  gl_FragColor=vec4(mix(source.rgb,fogColor,amount),source.a);
}`;

const numericRanges={density:[0,.025],baseHeight:[-20,60],heightFalloff:[1,60],nearDistance:[0,80],maxOpacity:[0,.6],sunScatter:[0,.6],anisotropy:[.05,.7],
  playerClearRadius:[0,10],playerClearFeather:[.1,15],selectionClearRadius:[0,10],selectionClearFeather:[.1,15]};
const uniformName=key=>'u'+key[0].toUpperCase()+key.slice(1);
const setPoint=(value,out,raise=0)=>{
  const xyz=Array.isArray(value)?value:[value?.x,value?.y,value?.z];
  if(xyz.length!==3||!xyz.every(Number.isFinite)){out.w=0;return;}
  out.set(xyz[0],xyz[1]+raise,xyz[2],1);
};

/** Exactly one fullscreen pass, in linear HDR color space.
 * Integration contract:
 *   attachAtmosphereDepth(composer);
 *   composer.addPass(new RenderPass(scene,camera));
 *   const dust=createAtmospherePass(camera); composer.addPass(dust);
 *   // Add SSAO / bloom / OutputPass / SMAA after dust, in their usual order.
 * The atmosphere MUST immediately follow the main RenderPass. Other passes can
 * swap buffers or overwrite depth; SSAO's own half-resolution depth is not the
 * main scene depth and deliberately excludes cutout foliage and water.
 * Call update({playerPosition,selectedPosition,sunDirection}) before render.
 * sunDirection points from the world toward the sun, matching sun.position -
 * sun.target.position. Pass null selectedPosition when no item is selected.
 * scene.fog is left intact. This layer is extra low dust, not volumetric shafts.
 */
export function createAtmospherePass(camera,{enabled=true,...options}={}){
  if(!camera?.isPerspectiveCamera)throw new TypeError('Atmosphere currently supports the game perspective camera.');
  const uniforms={tDiffuse:{value:null},tDepth:{value:null},uInverseProjection:{value:new T.Matrix4()},uCameraWorld:{value:new T.Matrix4()},
    uCameraPosition:{value:new T.Vector3()},uSunDirection:{value:new T.Vector3(-130,95,130).normalize()},
    uDustColor:{value:new T.Color()},uSunColor:{value:new T.Color()},uPlayer:{value:new T.Vector4(0,0,0,0)},uSelection:{value:new T.Vector4(0,0,0,0)}};
  for(const key of Object.keys(numericRanges))uniforms[uniformName(key)]={value:0};
  const material=new T.ShaderMaterial({name:'Low desert atmosphere',uniforms,vertexShader,fragmentShader,depthTest:false,depthWrite:false,blending:T.NoBlending,toneMapped:false});
  const pass=new ShaderPass(material);pass.enabled=!!enabled;
  const configuration={...ATMOSPHERE_DEFAULTS};let renders=0,lastDepth=null,lastSize=[0,0],disposed=false,coolDepth=false,coolDepthBaseline=null;
  pass.configure=patch=>{
    for(const [key,range]of Object.entries(numericRanges))if(key in patch){
      if(!Number.isFinite(patch[key]))throw new TypeError(`Atmosphere ${key} must be finite.`);
      configuration[key]=T.MathUtils.clamp(patch[key],...range);
    }
    for(const key of['dustColor','sunColor'])if(key in patch)configuration[key]=new T.Color(patch[key]).getHex();
    for(const key of Object.keys(numericRanges))uniforms[uniformName(key)].value=configuration[key];
    uniforms.uDustColor.value.setHex(configuration.dustColor);uniforms.uSunColor.value.setHex(configuration.sunColor);
    return pass;
  };
  pass.configure({...configuration,...options});
  // A/B only changes the existing colour and distance uniforms. Capture the
  // caller's current baseline so toggling off also preserves custom profiles.
  pass.setCoolDepth=value=>{
    if(disposed)return false;
    const next=!!value;if(next===coolDepth)return coolDepth;
    if(next){coolDepthBaseline={dustColor:configuration.dustColor,nearDistance:configuration.nearDistance};pass.configure({dustColor:0xa9b7bd,nearDistance:20});}
    else{pass.configure(coolDepthBaseline);coolDepthBaseline=null;}
    return coolDepth=next;
  };
  pass.setEnabled=value=>(pass.enabled=!!value);
  pass.update=({playerPosition,selectedPosition,sunDirection}={})=>{
    setPoint(playerPosition,uniforms.uPlayer.value,1);setPoint(selectedPosition,uniforms.uSelection.value);
    if(sunDirection){const values=Array.isArray(sunDirection)?sunDirection:[sunDirection.x,sunDirection.y,sunDirection.z];
      if(values.length===3&&values.every(Number.isFinite)&&values.some(value=>value!==0))uniforms.uSunDirection.value.set(...values).normalize();}
    return pass;
  };
  const render=pass.render.bind(pass);
  pass.render=(renderer,writeBuffer,readBuffer,deltaTime,maskActive)=>{
    if(disposed)throw new Error('Atmosphere pass has been disposed.');
    if(renderer.capabilities?.logarithmicDepthBuffer||renderer.capabilities?.reversedDepthBuffer)throw new Error('Atmosphere requires standard perspective depth.');
    if(!readBuffer?.depthTexture?.isDepthTexture)throw new Error('Call attachAtmosphereDepth(composer), then place atmosphere immediately after RenderPass.');
    if(writeBuffer===readBuffer||writeBuffer?.depthTexture===readBuffer.depthTexture)throw new Error('Atmosphere cannot sample the depth attachment it is writing to.');
    camera.updateWorldMatrix(true,false);uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);uniforms.uCameraWorld.value.copy(camera.matrixWorld);
    camera.getWorldPosition(uniforms.uCameraPosition.value);uniforms.tDepth.value=readBuffer.depthTexture;
    lastDepth=readBuffer.depthTexture.uuid;lastSize=[readBuffer.width,readBuffer.height];renders++;
    render(renderer,writeBuffer,readBuffer,deltaTime,maskActive);
  };
  pass.snapshot=()=>({enabled:pass.enabled,coolDepth,...configuration,renders,depthTexture:lastDepth,size:[...lastSize],drawCalls:pass.enabled?1:0,extraSceneRenders:0,
    sunDirection:uniforms.uSunDirection.value.toArray(),playerProtected:uniforms.uPlayer.value.w===1,selectionProtected:uniforms.uSelection.value.w===1});
  const dispose=pass.dispose.bind(pass);pass.dispose=()=>{if(disposed)return;disposed=true;dispose();};
  return pass;
}
