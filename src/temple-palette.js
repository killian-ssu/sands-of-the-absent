/** A reversible colour-only study for the authored temple GLB. The GLB already
 * separates walls/towers (stone), columns/cornices/roof tiers (trim), and the
 * podium/altar footing (darkstone). Bronze, cloth and recesses stay untouched.
 * Textures, roughness, normal strength and the original mesh batches are kept.
 */
const PALETTE={stone:0xa98b82,trim:0xdcd5c5,darkstone:0x7e8081};

export function createTemplePalette(materials){
 const bindings=[],variants=new Map();
 let enabled=false,disposed=false;
 function attachMesh(mesh,kind){
  if(disposed||!Object.hasOwn(PALETTE,kind)||!mesh?.isMesh||mesh.material!==materials[kind]||bindings.some(item=>item.mesh===mesh))return false;
  const original=mesh.material;
  if(!original?.color)return false;
  let variant=variants.get(kind);
  if(!variant){
   variant=original.clone();variant.name='temple-palette-'+kind;
   variant.color.setHex(PALETTE[kind]);
   // Material.clone does not copy these callbacks. Preserve the source shader
   // if a later stone treatment is introduced; this study adds no shader work.
   variant.onBeforeCompile=original.onBeforeCompile;
   variant.customProgramCacheKey=original.customProgramCacheKey;
   variants.set(kind,variant);
  }
  bindings.push({mesh,kind,original,variant});
  if(enabled)mesh.material=variant;
  return true;
 }
 function setEnabled(value){
  if(disposed||bindings.length===0)return false;
  enabled=!!value;
  for(const item of bindings)item.mesh.material=enabled?item.variant:item.original;
  return true;
 }
 function snapshot(){
  return{enabled,available:!disposed&&bindings.length>0,disposed,meshes:bindings.length,materials:variants.size,
   triangles:bindings.reduce((sum,{mesh})=>sum+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3*(mesh.isInstancedMesh?mesh.count:1),0),
   palette:Object.fromEntries([...variants].map(([kind,variant])=>[kind,{
    baseline:'#'+materials[kind].color.getHexString(),experiment:'#'+variant.color.getHexString(),
    meshes:bindings.filter(item=>item.kind===kind).map(({mesh})=>mesh.name),
   }])),
  };
 }
 function dispose(){
  if(disposed)return;
  for(const item of bindings)item.mesh.material=item.original;
  // Clones share all original texture maps. Dispose materials, never maps.
  for(const variant of variants.values())variant.dispose();
  enabled=false;disposed=true;
 }
 return{attachMesh,setEnabled,snapshot,dispose};
}
