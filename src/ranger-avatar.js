import {createTraveler} from './avatar.js';
import {RepeatWrapping,SRGBColorSpace,TextureLoader,Vector3} from 'three';

export const RANGER_ASSET_URL='assets/vendor/quaternius-ranger/Ranger_Traveler.glb';
let keeperPalette=null;
async function acquireKeeperPalette(){
 let entry=keeperPalette;
 if(!entry){
  entry={refs:0,textures:null,promise:null};keeperPalette=entry;
  entry.promise=Promise.allSettled(['Cloth','Hood'].map(part=>new TextureLoader().loadAsync(`assets/vendor/quaternius-ranger/Keeper_${part}_Albedo.png`))).then(results=>{
   const textures=results.filter(result=>result.status==='fulfilled').map(result=>result.value),failure=results.find(result=>result.status==='rejected');
   if(failure){for(const texture of textures)texture.dispose();throw failure.reason;}
   for(const texture of textures){texture.colorSpace=SRGBColorSpace;texture.flipY=false;texture.wrapS=texture.wrapT=RepeatWrapping;texture.needsUpdate=true;}
   entry.textures={cloth:textures[0],hood:textures[1]};
  });
 }
 entry.refs++;
 try{await entry.promise;return entry;}catch(error){if(--entry.refs===0&&keeperPalette===entry)keeperPalette=null;throw error;}
}
function releaseKeeperPalette(entry){
 if(!entry||--entry.refs>0)return;
 if(keeperPalette===entry)keeperPalette=null;
 for(const texture of Object.values(entry.textures))texture.dispose();
}

/** Optional adult-proportion traveler. This module never changes the default
 * avatar or game state. It returns the exact createTraveler contract: root,
 * update, handAnchor, playInteraction, dispose, mixer and metadata getters.
 * The selected GLB contains target-rig baked actions and a head-only base mesh.
 */
export async function createRangerTraveler(options={}){
 const avatar=await createTraveler({
  ...options,url:options.url||RANGER_ASSET_URL,animationUrls:[],
  height:options.height??(options.npc?1.8:1.75),tint:options.npc?0xffffff:options.tint??0xffffff,
  palette:'source',headingOffset:Math.PI,handBoneName:'hand_r',
  followHandRotation:false,handOffset:options.handOffset??[0,0,0],
  clipAliases:{idle:['Idle_Loop_Runtime','Idle_Loop'],walk:['Walk_Loop_Runtime','Walk_Loop'],
   run:['Sprint_Loop_Runtime','Sprint_Loop'],jump:['Jump_Loop_Runtime','Jump_Loop'],
   fall:['Jump_Loop_Runtime','Jump_Loop'],interaction:['Interact_Runtime','Interact'],
   ...options.clipAliases},
 });
 const materials=new Set();avatar.root.traverse(object=>{
  if(!object.isMesh)return;
  for(const material of(Array.isArray(object.material)?object.material:[object.material]))materials.add(material);
 });
 let keeperEntry=null;
 if(options.npc){try{keeperEntry=await acquireKeeperPalette();}catch(error){avatar.dispose();throw error;}}
 for(const material of materials){
  // The source ORM remains in place. Only the shared metal response is quieter
  // in the desert; there is no whole-character tint or KayKit atlas remapping.
  if(/Traveler_(Sand_Hood|Rust_Cloth_Leather)/.test(material.name)){
   material.metalness=Math.min(material.metalness,.32);material.roughness=Math.max(material.roughness,.82);
  }
  if(material.name==='MI_Hair_1')material.color.setHex(0x534134);
  if(keeperEntry){
   if(material.name==='Traveler_Sand_Hood')material.map=keeperEntry.textures.hood;
   else if(material.name.startsWith('Traveler_Rust_Cloth_Leather'))material.map=keeperEntry.textures.cloth;
  }
  material.envMapIntensity=.7;
 }
 avatar.metadata.variant=options.npc?'ranger-keeper-experiment':'ranger-experiment';avatar.metadata.assetSource='Quaternius';
 avatar.metadata.palette=options.npc?'cool grey-blue hood and cloth; original skin, eyes and leather':'sand hood, dark rust cloth, original skin and leather';
 // Retargeted actions have grounded keyframes, but quaternion crossfades can
 // arc a planted sole a few centimetres below the floor between those keys.
 // Cache the actual heel/toe silhouette once, not a per-frame whole-body AABB.
 const sample=new Vector3(),cells=new Map(),skeletons=new Set();
 avatar.root.updateMatrixWorld(true);avatar.root.traverse(mesh=>{
  if(!mesh.isSkinnedMesh)return;skeletons.add(mesh.skeleton);mesh.skeleton.update();
  for(let index=0;index<mesh.geometry.attributes.position.count;index++){
   sample.fromBufferAttribute(mesh.geometry.attributes.position,index);mesh.applyBoneTransform(index,sample).applyMatrix4(mesh.matrixWorld);
   if(sample.y>avatar.root.position.y+.13)continue;
   const key=`${Math.floor(sample.x/.045)},${Math.floor(sample.z/.045)}`,previous=cells.get(key);
   if(!previous||sample.y<previous.y)cells.set(key,{mesh,index,y:sample.y});
  }
 });
 const probes=[...cells.values()],update=avatar.update,dispose=avatar.dispose;let lift=0,disposed=false;
 avatar.metadata.soleProbeCount=probes.length;
 avatar.update=(dt,state={})=>{
  if(disposed)return;
  avatar.root.position.y-=lift;lift=0;avatar.metadata.soleCorrection=0;update(dt,state);
  if(state.grounded===false)return;
  avatar.root.updateMatrixWorld(true);for(const skeleton of skeletons)skeleton.update();
  let sole=Infinity;
  for(const {mesh,index} of probes){sample.fromBufferAttribute(mesh.geometry.attributes.position,index);mesh.applyBoneTransform(index,sample).applyMatrix4(mesh.matrixWorld);sole=Math.min(sole,sample.y);}
  lift=Math.min(.06,Math.max(0,avatar.root.position.y+.002-sole));
  avatar.root.position.y+=lift;avatar.root.updateMatrixWorld(true);avatar.metadata.soleCorrection=lift;
 };
 avatar.dispose=()=>{if(disposed)return;disposed=true;probes.length=0;cells.clear();skeletons.clear();dispose();releaseKeeperPalette(keeperEntry);keeperEntry=null;};
 return avatar;
}

export const createAvatar=createRangerTraveler;
