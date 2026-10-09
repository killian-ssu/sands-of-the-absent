import {AnimationMixer,Box3,Color,Group,LoopOnce,LoopRepeat,Quaternion,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';

const templates=new Map();
const canonical=name=>String(name||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const clipPreferences={
 idle:['Idle','Idle_A','Idle_B','Idle_Loop','Standing'],
 walk:['Walking_A','Walking','Walk','Walk_Forward','Walking_B'],
 run:['Running_A','Running','Run','Sprint','Running_B'],
 jump:['Jump_Idle','Jump_Loop','Jump_Start','Jump_Full_Short','Jump_Full_Long','Jump'],
 fall:['Jump_Idle','Falling','Fall','Jump_Loop','Jump_Full_Long'],
 interaction:['Interact','Interaction','Pick_Up','PickUp','Use_Item','Use','Spellcasting','Spellcast','Emote_Yes','Wave']
};

async function acquireTemplate(url){
 const key=String(url);let entry=templates.get(key);
 if(!entry){
  entry={key,refs:0,gltf:null,promise:null};
  entry.promise=new GLTFLoader().loadAsync(key).then(gltf=>(entry.gltf=gltf));templates.set(key,entry);
 }
 entry.refs++;
 try{await entry.promise;return entry;}catch(error){entry.refs--;if(templates.get(key)===entry)templates.delete(key);throw error;}
}
function releaseTemplate(entry){
 if(--entry.refs>0)return;
 if(templates.get(entry.key)===entry)templates.delete(entry.key);
 const geometries=new Set(),materials=new Set(),textures=new Set();
 entry.gltf?.scene.traverse(object=>{if(!object.isMesh)return;geometries.add(object.geometry);for(const material of(Array.isArray(object.material)?object.material:[object.material])){
  if(!material)continue;materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
 }});
 for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();for(const texture of textures)texture.dispose();
}
function chooseClip(clips,state,aliases){
 const requested=aliases?.[state];
 const names=[...(Array.isArray(requested)?requested:requested?[requested]:[]),...(clipPreferences[state]||[])];
 for(const wanted of names){const key=canonical(wanted),exact=clips.find(clip=>canonical(clip.name)===key);if(exact)return exact;}
 for(const wanted of names){const key=canonical(wanted),suffix=clips.find(clip=>canonical(clip.name).endsWith(key));if(suffix)return suffix;}
 const patterns={idle:/idle|standing/,walk:/walking|walk/,run:/running|sprint|run/,jump:/jump/,fall:/fall|jump/,interaction:/interact|pickup|pick_up|spellcast|emote_yes|wave/};
 return clips.find(clip=>patterns[state]?.test(clip.name.toLowerCase())&&!/backward|strafe|crouch|death|attack|hit|roll/i.test(clip.name))||null;
}
function chooseRightHand(bones,preferredName){
 if(preferredName){const preferred=bones.find(bone=>canonical(bone.name)===canonical(preferredName));if(preferred)return preferred;}
 const ranked=bones.map(bone=>{
  const name=canonical(bone.name),right=/right/.test(name)||/^r(hand|wrist)/.test(name)||/(hand|handslot|wrist)r$/.test(name);
  const hand=/hand|wrist/.test(name),finger=/thumb|index|middle|ring|pinky|finger/.test(name);
  return{bone,score:right&&hand?100+(name.endsWith('hand')||name.endsWith('handr')?50:name.includes('handslot')?10:0)-(finger?80:0):0};
 }).filter(item=>item.score>=100).sort((a,b)=>b.score-a.score);
 return ranked[0]?.bone||null;
}
function removeRootTravel(clip,bones,sourceHeight){
 const result=clip.clone(),roots=new Set(bones.filter(bone=>!bone.parent?.isBone||/^(root|rootmotion)$/i.test(bone.name)).map(bone=>bone.name));
 for(const track of result.tracks){
  if(!track.name.endsWith('.position')||track.getValueSize()!==3)continue;
  const name=track.name.slice(0,-9),leaf=name.split('/').at(-1),values=track.values;
  if(!values.length)continue;
  if(roots.has(name)||roots.has(leaf)||/^(root|rootmotion|armature)$/i.test(leaf)){
   // Global translation belongs to the player controller, including jumps.
   const x=values[0],y=values[1],z=values[2];for(let i=0;i<values.length;i+=3){values[i]=x;values[i+1]=y;values[i+2]=z;}
  }else if(/hips|pelvis/i.test(leaf)){
   // Keep the pelvis sway, but remove a locomotion clip's accumulated travel.
   const last=values.length-3,dx=values[last]-values[0],dz=values[last+2]-values[2],t0=track.times[0],duration=track.times.at(-1)-t0;
   if(duration>0&&Math.hypot(dx,dz)>sourceHeight*.1)for(let i=0;i<track.times.length;i++){
    const ratio=(track.times[i]-t0)/duration;values[i*3]-=dx*ratio;values[i*3+2]-=dz*ratio;
   }
  }
 }
 return result;
}
function applyClothPalette(material,npc,cape=false){
 if(!material.map)return;
 const cloth=new Color(npc?0x465565:cape?0xa45f3e:0xb0a18b),lining=new Color(npc?0x2b3945:cape?0x613424:0x8b4936);
 const previous=material.onBeforeCompile,cacheKey=material.customProgramCacheKey.bind(material);
 material.onBeforeCompile=(shader,renderer)=>{
  previous.call(material,shader,renderer);
  shader.uniforms.travelerCloth={value:cloth};shader.uniforms.travelerLining={value:lining};
  shader.fragmentShader='uniform vec3 travelerCloth;\nuniform vec3 travelerLining;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
  #ifdef USE_MAP
   // The KayKit atlas has separate forest-green cloak and teal undercloth
   // swatches. Remap only those hues, retaining the authored gradients, skin,
   // leather, metal and alpha. A whole-material tint cannot remove green cloth.
   vec3 clothSample=sampledDiffuseColor.rgb;
   float clothMask=smoothstep(.008,.045,clothSample.g-clothSample.r*1.12)*smoothstep(.006,.045,clothSample.g-clothSample.b*.9);
   float undercloth=smoothstep(.28,.72,clothSample.b/max(clothSample.g,.001));
   float clothShade=pow(clamp(dot(clothSample,vec3(.2126,.7152,.0722))/.24,.08,1.7),.85);
   vec3 clothAlbedo=mix(travelerCloth,travelerLining,undercloth)*clothShade;
   diffuseColor.rgb=mix(diffuseColor.rgb,diffuse*clothAlbedo,clothMask);
  #endif`);
 };
 material.customProgramCacheKey=()=>cacheKey()+':traveler-desert-cloth-v1';
 material.userData.travelerPalette=npc?'blue-grey':cape?'rust-cape':'sand-and-rust';material.needsUpdate=true;
}

/**
 * A real, independently animated skinned traveler. Position is in metres at the
 * feet; heading 0 faces -Z. KayKit's +Z-facing models use headingOffset=Math.PI.
 * Optional animationUrls can provide compatible KayKit animation-only GLBs.
 * The returned handAnchor is metre-scaled even if the source rig is not.
 * update(dt, {carryingLamp:true}) blends a restrained right-arm carrying pose;
 * omitted/false keeps the authored animation, and NPCs never receive the pose.
 */
export async function createTraveler({url,height=1.75,npc=false,headingOffset=Math.PI,animationUrls=[],clipAliases={},tint=0xffffff,palette='desert',handBoneName=null,followHandRotation=false,handOffset=[0,0,0],castShadow=true}={}){
 if(!url)throw new TypeError('Traveler needs a GLB asset URL.');
 if(!Number.isFinite(height)||height<=0)throw new RangeError('Traveler height must be positive.');
 const urls=[...new Set([url,...animationUrls])],settled=await Promise.allSettled(urls.map(acquireTemplate));
 const entries=settled.filter(value=>value.status==='fulfilled').map(value=>value.value),failure=settled.find(value=>value.status==='rejected');
 if(failure){entries.forEach(releaseTemplate);throw failure.reason;}
 const root=new Group();root.name=npc?'traveler-npc':'traveler-player';
 const scaleGroup=new Group(),offsetGroup=new Group(),model=cloneSkeleton(entries[0].gltf.scene);
 root.add(scaleGroup);scaleGroup.add(offsetGroup);offsetGroup.add(model);
 const ownMaterials=new Set(),materialClones=new Map(),capeMaterialClones=new Map(),bones=[],meshes=[],warnings=[];
 const tintColor=new Color(tint);
 let disposed=false;
 const freeModel=()=>{
  root.removeFromParent();for(const material of ownMaterials)material.dispose();
  const skeletons=new Set();model.traverse(object=>{if(object.isSkinnedMesh)skeletons.add(object.skeleton);});
  for(const skeleton of skeletons)skeleton.dispose();entries.forEach(releaseTemplate);
 };
 model.traverse(object=>{
  if(object.isBone)bones.push(object);
  if(!object.isMesh)return;
  object.castShadow=castShadow;object.receiveShadow=true;
  // Skinning bounds change with the animation; a rest-pose bound can cull a hand
  // or an entire character near the frame edge. Only a few travelers are drawn.
  if(object.isSkinnedMesh){meshes.push(object);object.frustumCulled=false;}
  // The shared rogue atlas also covers the hood, skin and metal. Only this
  // mesh gets a second material clone; hue masks still preserve non-cloth texels.
  const rustCape=palette==='desert'&&!npc&&canonical(object.name)==='roguehoodedcape';
  const clones=rustCape?capeMaterialClones:materialClones;
  const copyMaterial=material=>{
   if(!material)return material;
   if(!clones.has(material)){const copy=material.clone();if(copy.color)copy.color.multiply(tintColor);if(palette==='desert')applyClothPalette(copy,npc,rustCape);clones.set(material,copy);ownMaterials.add(copy);}
   return clones.get(material);
  };
  object.material=Array.isArray(object.material)?object.material.map(copyMaterial):copyMaterial(object.material);
 });
 if(!meshes.length){freeModel();throw new Error('Traveler asset contains no SkinnedMesh: '+url);}
 model.updateMatrixWorld(true);for(const mesh of meshes)mesh.skeleton.update();
 const bounds=new Box3(),piece=new Box3();
 for(const mesh of meshes)if(!/weapon|sword|bow|staff|shield|arrow/i.test(mesh.name)){piece.setFromObject(mesh,true);bounds.union(piece);}
 if(bounds.isEmpty())bounds.setFromObject(model,true);
 const dimensions=bounds.getSize(new Vector3()),sourceHeight=dimensions.y;
 if(!Number.isFinite(sourceHeight)||sourceHeight<.0001){freeModel();throw new Error('Traveler asset has invalid body bounds.');}
 const center=bounds.getCenter(new Vector3()),pelvis=bones.find(bone=>/hips|pelvis/i.test(bone.name));
 if(pelvis){const p=pelvis.getWorldPosition(new Vector3());center.x=p.x;center.z=p.z;}
 offsetGroup.position.set(-center.x,-bounds.min.y,-center.z);scaleGroup.scale.setScalar(height/sourceHeight);root.rotation.y=headingOffset;root.updateMatrixWorld(true);

 const rightHand=chooseRightHand(bones,handBoneName),handAnchor=new Group();handAnchor.name='traveler-right-hand-anchor';root.add(handAnchor);
 const handPosition=new Vector3(),worldQuaternion=new Quaternion(),rootQuaternion=new Quaternion(),attachmentOffset=new Vector3(...handOffset);
 const fallbackPosition=new Vector3(Math.cos(headingOffset)*height*.18+Math.sin(headingOffset)*height*.08,height*.61,Math.sin(headingOffset)*height*.18-Math.cos(headingOffset)*height*.08);
 if(!rightHand)warnings.push('No right-hand bone found; lantern anchor follows the upper torso.');
 function updateHand(){
  root.updateMatrixWorld(true);
  if(rightHand){
   rightHand.getWorldPosition(handPosition);root.worldToLocal(handPosition);handAnchor.position.copy(handPosition);
   rightHand.getWorldQuaternion(worldQuaternion);root.getWorldQuaternion(rootQuaternion);worldQuaternion.premultiply(rootQuaternion.invert());
   handAnchor.position.add(handPosition.copy(attachmentOffset).applyQuaternion(worldQuaternion));
   if(followHandRotation)handAnchor.quaternion.copy(worldQuaternion);else handAnchor.quaternion.identity();
  }else{handAnchor.position.copy(fallbackPosition).add(attachmentOffset);handAnchor.quaternion.identity();}
  handAnchor.updateMatrixWorld(true);
 }

 // A held lantern should not swing all the way down with an empty-handed run.
 // This small additive two-joint solve bends the real arm; the grip stays on
 // the hand bone. Keep the animation pose separately to avoid accumulating the
 // correction on paused frames or clips that omit an arm rotation track.
 const findArm=names=>bones.find(bone=>names.includes(canonical(bone.name)));
 const upperArm=findArm(['upperarmr','rightupperarm','rightarm']),forearm=findArm(['lowerarmr','rightlowerarm','rightforearm']);
 const carryJoints=!npc&&rightHand&&upperArm&&forearm?[
  {bone:forearm,maxAngle:1.1,base:new Quaternion(),solved:new Quaternion()},
  {bone:upperArm,maxAngle:.35,base:new Quaternion(),solved:new Quaternion()},
 ]:[];
 const carryTarget=new Vector3(),carryHand=new Vector3(),carryJoint=new Vector3(),carryFrom=new Vector3(),carryTo=new Vector3();
 const carryRotation=new Quaternion(),carryParent=new Quaternion(),carryInverse=new Quaternion();
 const localForward=new Vector3(Math.sin(headingOffset),0,-Math.cos(headingOffset));
 let carryWeight=0,carryPoseApplied=false,carryInitialized=false;
 function restoreAnimationArm(){
  if(!carryPoseApplied)return;
  for(const joint of carryJoints)joint.bone.quaternion.copy(joint.base);
  carryPoseApplied=false;
 }
 function applyCarryPose(delta,carrying){
  if(!carryJoints.length)return;
  if(!carryInitialized){carryInitialized=true;carryWeight=Number(!!carrying);}
  else carryWeight+=(Number(!!carrying)-carryWeight)*(1-Math.exp(-delta*10));
  if(!carrying&&carryWeight<.0001){carryWeight=0;return;}
  if(carryWeight===0)return;
  root.updateMatrixWorld(true);
  rightHand.getWorldPosition(carryTarget);root.worldToLocal(carryTarget);
  carryTarget.y=Math.max(carryTarget.y,height*.45);
  const forward=carryTarget.dot(localForward),maxForward=height*.13;
  if(forward>maxForward)carryTarget.addScaledVector(localForward,maxForward-forward);
  root.localToWorld(carryTarget);
  for(const joint of carryJoints)joint.base.copy(joint.bone.quaternion);
  for(let iteration=0;iteration<6;iteration++)for(const joint of carryJoints){
   joint.bone.getWorldPosition(carryJoint);rightHand.getWorldPosition(carryHand);
   carryFrom.copy(carryHand).sub(carryJoint);carryTo.copy(carryTarget).sub(carryJoint);
   if(carryFrom.lengthSq()<1e-10||carryTo.lengthSq()<1e-10)continue;
   carryRotation.setFromUnitVectors(carryFrom.normalize(),carryTo.normalize());
   joint.bone.parent.getWorldQuaternion(carryParent);carryInverse.copy(carryParent).invert();
   carryRotation.premultiply(carryInverse).multiply(carryParent);joint.bone.quaternion.premultiply(carryRotation);
   const angle=joint.base.angleTo(joint.bone.quaternion);
   if(angle>joint.maxAngle){joint.solved.copy(joint.bone.quaternion);joint.bone.quaternion.copy(joint.base).slerp(joint.solved,joint.maxAngle/angle);}
   joint.bone.updateWorldMatrix(false,true);
  }
  for(const joint of carryJoints){joint.solved.copy(joint.bone.quaternion);joint.bone.quaternion.copy(joint.base).slerp(joint.solved,carryWeight);}
  carryPoseApplied=true;
 }

 const namedClips=new Map();
 for(const entry of entries)for(const clip of entry.gltf.animations||[])if(!namedClips.has(clip.name))namedClips.set(clip.name,removeRootTravel(clip,bones,sourceHeight));
 const clips=[...namedClips.values()],selected={};
 for(const state of Object.keys(clipPreferences))selected[state]=chooseClip(clips,state,clipAliases);
 selected.idle||=clips.find(clip=>!/attack|death|hit|jump|roll/i.test(clip.name))||null;
 selected.walk||=selected.idle;selected.run||=selected.walk;selected.jump||=selected.idle;selected.fall||=selected.jump;
 if(!selected.idle)warnings.push('No compatible idle animation; character remains in its authored rest pose.');
 for(const state of ['walk','run'])if(selected[state]===selected.idle)warnings.push('No separate '+state+' animation was found.');
 const mixer=new AnimationMixer(model),actions=new Map();
 for(const clip of clips)actions.set(clip,mixer.clipAction(clip));
 let currentAction=null,currentState='idle',desiredState='idle',interacting=false,interactionAction=null,interactionPromise=null,resolveInteraction=null,fallbackTime=0,lastSpeed=0;
 function transition(state,oneShot=false){
  const clip=selected[state];currentState=state;if(!clip)return null;
  const action=actions.get(clip);
  if(action===currentAction&&!oneShot)return action;
  action.reset();action.enabled=true;action.setEffectiveTimeScale(1);action.setEffectiveWeight(1);action.setLoop(oneShot?LoopOnce:LoopRepeat,oneShot?1:Infinity);action.clampWhenFinished=oneShot;action.play();
  if(currentAction&&currentAction!==action)currentAction.crossFadeTo(action,.18,false);else action.fadeIn(.12);
  currentAction=action;return action;
 }
 function finishInteraction(completed=true){
  if(!interacting)return;interacting=false;interactionAction=null;fallbackTime=0;
  const resolve=resolveInteraction;resolveInteraction=null;interactionPromise=null;transition(desiredState);resolve?.(completed);
 }
 const onFinished=event=>{if(event.action===interactionAction)finishInteraction(true);};mixer.addEventListener('finished',onFinished);
 transition('idle');
 // The title screen pauses simulation. Apply a full-weight authored idle pose
 // now, before that pause, rather than freezing the initial bind/T-pose fade.
 if(currentAction){currentAction.stopFading();currentAction.setEffectiveWeight(1);}
 mixer.update(1/60);updateHand();
 root.userData.traveler={url,height,npc,animations:clips.map(clip=>clip.name),selectedClips:Object.fromEntries(Object.entries(selected).map(([name,clip])=>[name,clip?.name||null])),rightHandBone:rightHand?.name||null,warnings};

 function update(dt,playerState={}){
  if(disposed)return;
  if(playerState.position){const p=playerState.position;Array.isArray(p)?root.position.fromArray(p):root.position.copy(p);}
  if(Number.isFinite(playerState.heading))root.rotation.y=playerState.heading+headingOffset;
  desiredState=playerState.locomotion||(!playerState.grounded&&playerState.grounded!==undefined?'fall':Number(playerState.speed)>.1?'walk':'idle');
  if(!selected[desiredState])desiredState='idle';lastSpeed=Math.max(0,Number(playerState.speed)||0);
  if(!playerState.paused){
   restoreAnimationArm();
   if(!interacting)transition(desiredState);
   if(currentAction&&!interacting&&(desiredState==='walk'||desiredState==='run')&&lastSpeed>.1)currentAction.setEffectiveTimeScale(clamp(lastSpeed/(desiredState==='run'?6.6:3.4),.55,1.5));
   const delta=clamp(Number(dt)||0,0,.1);mixer.update(delta);
   if(interacting&&!interactionAction){fallbackTime-=delta;if(fallbackTime<=0)finishInteraction(true);}
   applyCarryPose(delta,playerState.carryingLamp);
  }
  updateHand();
 }
 function playInteraction(){
  if(disposed)return Promise.resolve(false);if(interacting)return interactionPromise;
  interacting=true;interactionPromise=new Promise(resolve=>{resolveInteraction=resolve;});
  interactionAction=selected.interaction?transition('interaction',true):null;
  if(!interactionAction)fallbackTime=.35;
  return interactionPromise;
 }
 function dispose(){
  if(disposed)return;disposed=true;if(interacting)finishInteraction(false);
  mixer.removeEventListener('finished',onFinished);mixer.stopAllAction();mixer.uncacheRoot(model);freeModel();
 }
 return{root,update,handAnchor,playInteraction,dispose,mixer,
  get isInteracting(){return interacting;},get animationState(){return currentState;},get metadata(){return root.userData.traveler;}};
}
