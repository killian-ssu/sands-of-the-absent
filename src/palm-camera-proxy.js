// Measured from the wood primitive only, after the GLTF node transform.
// Four exact horizontal triangle clips follow the bent trunk. Leaves and
// canopy are deliberately absent. Revalidate the asset hash when rebuilding.
export const PALM_TRUNK_SOURCE_SHA256='359b702f6dae93c521d77aaec329efa003d86e209a0be738f7711c7d13a3e7b3';
export const PALM_TRUNK_BANDS=Object.freeze([
 {min:[-.3179458975791931,0,-.41934725642204285],max:[.3411785066127777,2.75,.3169442415237427]},
 {min:[-.2271239310503006,2.75,-.4852450489997864],max:[.42796528339385986,5.5,.14888723194599152]},
 {min:[-.05269054137170315,5.5,-.5021809935569763],max:[.6188240106949419,8.25,.014315313659608364]},
 {min:[.2043116656808875,8.25,-.4942189157009125],max:[.897599995136261,11,-.06491434574127197]},
].map(b=>Object.freeze({min:Object.freeze(b.min),max:Object.freeze(b.max)})));

/** Camera-only OBBs. Margin is in world metres, not affected by tree scale. */
export function createPalmCameraColliders(placements,{margin=.002}={}){
 if(!Number.isFinite(margin)||margin<0||margin>.02)throw new RangeError('Palm camera margin must be between 0 and .02 metres.');
 const result=[];
 let instance=0;
 for(const p of placements){
  if(p.type!=='palm')continue;
  const scale=Array.isArray(p.s)?p.s:[p.s,p.s,p.s],yaw=p.yaw??0;
  if(scale.length!==3||scale.some(s=>!Number.isFinite(s)||s<=0)||![p.x,p.y,p.z,yaw].every(Number.isFinite))throw new TypeError('Palm camera proxy needs finite coordinates and positive scale.');
  const co=Math.cos(yaw),si=Math.sin(yaw);
  for(const [band,b]of PALM_TRUNK_BANDS.entries()){
   const x=(b.min[0]+b.max[0])*.5*scale[0],z=(b.min[2]+b.max[2])*.5*scale[2];
   result.push({x:p.x+x*co+z*si,z:p.z-x*si+z*co,y:p.y+b.min[1]*scale[1]-margin,
    w:(b.max[0]-b.min[0])*scale[0]+margin*2,h:(b.max[1]-b.min[1])*scale[1]+margin*2,d:(b.max[2]-b.min[2])*scale[2]+margin*2,
    yaw,cameraOnly:true,source:`palm-wood:${instance}:${band}`});
  }
  instance++;
 }
 return result;
}
