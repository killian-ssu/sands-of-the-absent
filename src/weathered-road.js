// Broad sand drifts, authored in world metres. This pure appearance transform
// consumes no random numbers and keeps every instance in its original slot.
// Buried slabs create the gaps; retaining them also preserves the world's
// later seeded instance colours and palm-frond shapes.
export const ROAD_SAND_BANDS=Object.freeze([
 Object.freeze({z:83,halfWidth:2.4,slope:.8}),
 Object.freeze({z:61,halfWidth:3.5,slope:-.65}),
 Object.freeze({z:29,halfWidth:2.6,slope:.95}),
 Object.freeze({z:3,halfWidth:4.1,slope:.7}),
 Object.freeze({z:-30,halfWidth:2.8,slope:-.9}),
 Object.freeze({z:-53,halfWidth:2.1,slope:.75}),
]);
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

export function roadBurial(placement){
 if(placement.type!=='slab'||!Number.isInteger(placement.roadRow)||!Number.isInteger(placement.roadColumn))return 0;
 const lateral=(placement.roadColumn-2)*1.43,z=placement.z;
 // Two long waves alter the exposed margins as continuous shapes, rather
 // than throwing individual paving pieces into random missing-cell noise.
 const centre=.4*Math.sin(z*.062)+.22*Math.sin(z*.137+.6);
 const halfWidth=2.04+.46*Math.sin(z*.091+.4);
 const edge=smooth(halfWidth-.55,halfWidth+.68,Math.abs(lateral-centre));
 let band=0;
 for(const drift of ROAD_SAND_BANDS){
  const offset=(z-drift.z-drift.slope*lateral)/drift.halfWidth;
  band=Math.max(band,Math.exp(-Math.pow(offset,4)));
 }
 return .035+.37*band+.18*edge;
}

export function weatherMainRoad(placements){
 return placements.map(placement=>{
  const burial=roadBurial(placement);
  return burial>0?{...placement,y:placement.y-burial}:placement;
 });
}
