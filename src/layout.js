export const zones=[{id:'temple',name:'风蚀神庙',desc:'光从断裂的穹顶落下，风穿过石柱之间。',x:-37,z:-2,r:28},{id:'city',name:'碑下旧城',desc:'抬头能看见巨碑，转身是无声的街巷。',x:15,z:-86,r:38},{id:'oasis',name:'峡谷绿洲',desc:'走到水边，沙海在这里暂时停下。',x:45,z:5,r:33}];
export const views={hero:{p:[3,6.1,82],t:[-8,23,-92]},temple:{p:[-34,4.1,20],t:[-37,13,-6]},city:{p:[18,9.5,-81],t:[30,48,-118]},oasis:{p:[25,3.4,33],t:[48,1.2,0]},interior:{p:[-49,4.2,3],t:[-37,8,-7]}};
import {weatherMainRoad} from './weathered-road.js';
import {architecturePlacements,architectureSurfaceHeight} from './architecture-support.js';
export function rng(seed=9127){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export const roadX=z=>Math.min(15,Math.max(3,3+(82-z)*.065));
export const terrainGrid={extent:900,segments:450};
export function terrainHeight(x,z){
 let h=1.0+1.25*Math.sin(x*.042+z*.023)+.65*Math.sin(z*.079-x*.024)+.35*Math.cos(x*.11+z*.057);
 const clearTemple=smooth(20,38,Math.hypot(x+37,(z+2)*1.1));
 const clearCity=smooth(45,69,Math.hypot(x-16,z+87));
 const mainPath=smooth(3,12,Math.abs(x-roadX(z)));
 h=.15+(h-.15)*Math.min(clearTemple,clearCity,mainPath);
 let hill=27*smooth(-25,-142,z)*(1-smooth(43,77,Math.abs(x-10)))*smooth(7,17,Math.abs(x-18));
 if(cityDeck(x,z)>.2)hill=Math.min(hill,cityDeck(x,z)-.25);
 h=Math.max(h,hill);
 h+=4.25*Math.exp(-((x-3)**2+(z-82)**2)/250);
 const lake=Math.sqrt(((x-45)/24)**2+((z-5)/34)**2);
 h=h*smooth(1.04,1.7,lake)-2.1*(1-smooth(.77,1.03,lake));
 return h;
}
// Movement and asset placement use the same triangles as the visible terrain.
// Sampling the continuous height function alone can put feet below steep mesh edges.
export function terrainSurfaceHeight(x,z){
 const step=terrainGrid.extent/terrainGrid.segments,half=terrainGrid.extent/2;
 const x0=Math.floor((x+half)/step)*step-half,z0=Math.floor((z+half)/step)*step-half,u=(x-x0)/step,v=(z-z0)/step;
 const a=terrainHeight(x0,z0),b=terrainHeight(x0,z0+step),c=terrainHeight(x0+step,z0+step),d=terrainHeight(x0+step,z0);
 return u+v<=1?a+(d-a)*u+(b-a)*v:c+(b-c)*(1-u)+(d-c)*(1-v);
}
// The rendered flight instances and walking surface share metre-based geometry.
// Adjacent treads overlap slightly; the highest overlapping top supports feet.
export const cityStairs=Object.freeze([
 Object.freeze({name:'city-lower-stairs',count:48,x:18,baseY:0,startZ:-66.25,stepZ:-.5,width:14,rise:.25,depth:.52}),
 Object.freeze({name:'city-upper-stairs',count:52,x:18,baseY:12,startZ:-90.212,stepZ:-.4231,width:14,rise:.25,depth:.45}),
]);
export const templeStairs=Object.freeze({name:'temple-approach-stairs',count:18,x:-37,baseY:0,startZ:23.8,stepZ:-.5,width:12,rise:.125,depth:.52});
// Instance matrices are Float32. Use those exact face positions too; a point
// exactly on a riser must not disagree with the rendered face by one full step.
const treadFront=(stairs,index)=>Math.fround(stairs.startZ+index*stairs.stepZ)+Math.fround(stairs.depth)/2;
const lastTreadFront=stairs=>treadFront(stairs,stairs.count-1);
function stairHeight(x,z,flights){
 let height=-Infinity;
 for(const stairs of flights){
  if(Math.abs(x-stairs.x)>stairs.width/2)continue;
  const front=treadFront(stairs,0),back=Math.fround(stairs.startZ+(stairs.count-1)*stairs.stepZ)-Math.fround(stairs.depth)/2;
  if(z>front||z<back)continue;
  let index=Math.min(stairs.count-1,Math.floor((front-z)/-stairs.stepZ));
  while(index>0&&z>treadFront(stairs,index))index--;
  while(index<stairs.count-1&&z<=treadFront(stairs,index+1))index++;
  height=Math.max(height,stairs.baseY+(index+1)*stairs.rise);
 }
 return height;
}
export const cityStairHeight=(x,z)=>stairHeight(x,z,cityStairs);
export const templeStairHeight=(x,z)=>stairHeight(x,z,[templeStairs]);
export function cityDeck(x,z){
 let h=.15;
 // The landing may begin only when the final tread actually reaches its top.
 // In particular, z<-89 used to lift feet to 12 m two treads prematurely.
 if(x>-16&&x<52&&z>-140&&z<-70&&(Math.abs(x-18)>7.1||z<=lastTreadFront(cityStairs[0])))h=12;
 if(x>-4&&x<40&&z>-128&&z<-82&&(Math.abs(x-18)>7.1||z<=lastTreadFront(cityStairs[1])))h=25;
 return h;
}
export function walkHeight(x,z){
 // cityDeck still controls the original terrain/house authoring. It is not a
 // physical surface: its broad rectangles extended into empty air and its
 // nominal heights disagreed with the exported stone caps by up to 0.5 m.
 return architectureSurfaceHeight(x,z,Math.max(terrainSurfaceHeight(x,z),cityStairHeight(x,z),templeStairHeight(x,z),-.52));
}
export function createLayout({weatheredRoad=true,foundations=true}={}){
 const r=rng(),p=[];const add=(type,x,y,z,s=1,yaw=0,extra={})=>{p.push({type,x,y,z,s,yaw,...extra});};
 for(const q of architecturePlacements)add(q.type,q.x,q.y,q.z,q.s,q.yaw);
 add('obelisk',30,25,-118,[2.4,1.2,2.4]);
 add('gate',-48,terrainSurfaceHeight(-48,36),36,.8,.25);
 add('gate',-2,.15,-69,1.2,0);
 for(const [x,z,s]of[[-10,-88,.34],[48,-102,.4],[-23,-131,.44],[55,-60,.24],[88,-135,.42]])add('obelisk',x,.15,z,s,(r()-.5)*.13);
 for(let row=0;row<5;row++)for(let col=0;col<8;col++){
  const x=-37+col*14+(r()-.5)*3,z=-49-row*16+(r()-.5)*3;
  if((x>1&&x<33)||(x<-18&&z>-64))continue;
  const s=.8+r()*.45;add('house'+((row+col)%3),x,Math.max(terrainSurfaceHeight(x,z),cityDeck(x,z)),z,s,(r()-.5)*.13,{solid:true});
  if(row>1&&r()>.45)add('house'+((row+col+1)%3),x,Math.max(terrainSurfaceHeight(x,z),cityDeck(x,z))+6*s,z,.62*s,(r()-.5)*.12);
 }
 for(let i=0;i<17;i++){
  const a=i/17*Math.PI*2,x=18+Math.cos(a)*28,z=-103+Math.sin(a)*22;
  if(z>-86&&Math.abs(x-18)<15)continue;
  add('house'+(i%3),x,Math.max(terrainSurfaceHeight(x,z),cityDeck(x,z)),z,.8+r()*.3,a+Math.PI/2,{solid:true});
 }
 for(const [x,z,s,yaw]of[[91,-37,1.3,.2],[93,-15,1,-.2],[86,12,.9,0],[55,-41,1.1,-.3],[36,-32,.7,.5],[-16,-23,.9,0]])add('house1',x,Math.max(.1,terrainSurfaceHeight(x,z)),z,s,yaw,{solid:true});
 for(let i=0;i<27;i++){
  const a=i/27*Math.PI*2,rad=1.03+r()*.42;let x=45+Math.cos(a)*24*rad,z=5+Math.sin(a)*34*rad;
  // Keep the camera-to-player corridor open at the south arrival and east
  // mirror. Move only these origins; keep the seeded size/yaw and leaf shapes.
  if(i===4){x=75;z=45;}
  if(i===9){x=35;z=44;}
  // This palm frames the west edge of the southern arrival.
  if(i===10){x=17.7;z=37;}
  add('palm',x,Math.max(.1,terrainSurfaceHeight(x,z)),z,(x<45?.52:.73)+r()*.43,r()*6.28);
 }
 for(const [x,z]of[[-14,-38],[-19,-74],[41,-70],[8,-128],[-9,-113]])add('palm',x,.1,z,.85+r()*.2,r()*6.28);
 for(let i=0;i<24;i++){
  const a=-Math.PI*.05+i/23*Math.PI*1.18,x=16+Math.cos(a)*320,z=-62-Math.sin(a)*240;
  add('cliff'+(i%3),x,-12,z,[1.5+r()*.8,.85+r()*.55+Math.max(0,Math.cos(a))*1.1,1.6+r()*.9],r()*6.28);
 }
 for(let i=0;i<32;i++){
  const a=r()*6.28,x=45+Math.cos(a)*(23+r()*5),z=5+Math.sin(a)*(33+r()*5);
  add('rock'+(i%3),x,terrainSurfaceHeight(x,z)-.3,z,.9+r()*2.5,r()*6.28);
 }
 for(let i=0;i<580;i++){
  let x=-98+r()*214,z=-155+r()*235;
  const lake=Math.sqrt(((x-45)/24)**2+((z-5)/34)**2);
  if(Math.hypot(x-3,z-82)<10||Math.abs(x-roadX(z))<2.4||lake<1.02||Math.hypot(x+37,z+2)<24||Math.abs(x-18)<8&&z<-65)continue;
  let size=.13+Math.pow(r(),3)*1.4;
  add('rock'+(i%3),x,terrainSurfaceHeight(x,z)-.1,z,[size*(1+r()),size*.5,size],r()*6.28);
 }
 for(let i=0;i<125;i++){
  const z=92-i*1.25,x=roadX(z);
  for(let j=0;j<5;j++)if(r()>.18){let px=x+(j-2)*1.43+(r()-.5)*.24,pz=z+(r()-.5)*.2;add('slab',px,terrainSurfaceHeight(px,pz)-.03,pz,[.75+r()*.2,.7+r()*.5,.68+r()*.2],(r()-.5)*.16,{roadRow:i,roadColumn:j});}
 }
 // Authored, mostly buried paving turns into the stair mouth. No random draws:
 // the existing vegetation/ruins keep their exact positions and silhouettes.
 for(const [x,z,yaw,sy]of[[13.15,-63.75,-.19,.56],[14.4,-63.65,-.25,.5],
  [14.35,-64.7,-.28,.6],[15.62,-64.5,-.32,.54],[15.9,-65.25,-.38,.5],
  [17.15,-65.12,-.2,.62],[18.4,-65.18,-.08,.54],[19.63,-65.12,.04,.58]])
  add('slab',x,terrainSurfaceHeight(x,z)-.08,z,[.84,sy,.76],yaw);
 for(let i=0;i<70;i++){
  const x=-58+r()*43,z=17+r()*14;if(x>-43&&x<-31)continue;
  add('slab',x,terrainSurfaceHeight(x,z),z,[.7+r(),.8+r(),.6+r()],r()*6.28,{walkableDebris:true});
 }
 for(let i=0;i<70;i++){
  const x=-80+r()*183,z=-140+r()*206;
  const lake=Math.sqrt(((x-45)/24)**2+((z-5)/34)**2);
  if(lake<1.01||Math.hypot(x+37,z+2)<23||Math.abs(x-roadX(z))<4)continue;
  add('bush',x,terrainSurfaceHeight(x,z),z,.3+r()*.85,r()*6.28);
 }
 for(let i=0;i<90;i++){
  const a=r()*6.28,x=45+Math.cos(a)*(25+r()*6),z=5+Math.sin(a)*(35+r()*5);
  add('bush',x,Math.max(0,terrainSurfaceHeight(x,z)),z,.5+r()*.65,r()*6.28);
 }
 for(let i=0;i<220;i++){
  const side=r()>.5?1:-1,z=-40+r()*86,x=side<0?-64+r()*16:28+r()*8;
  add('rock'+(i%3),x,terrainSurfaceHeight(x,z)-.12,z,[.3+r()*.9,.3+r()*.6,.3+r()*.8],r()*6.28);
 }
 for(const [x,z] of [[-14,-32],[29,-28],[45,-34],[-20,-48],[28,-44],[43,-51],[-40,-64],[-48,-86],[-31,-91],[-24,-117],[65,-97]]){
  let y=Math.max(terrainSurfaceHeight(x,z),cityDeck(x,z));add('house'+Math.floor(r()*3),x,y,z,1+r()*.25,(r()-.5)*.25,{solid:true});
  if(z<-65)add('house0',x+1,y+6.7,z-1,.75+r()*.15,(r()-.5)*.2);
 }
 for(const [x,z,yaw]of[[-17,49,-.2],[-25,28,.4],[-53,27,.3],[28,-31,.4],[-11,-55,0]]){
  add('ruinwall',x,terrainSurfaceHeight(x,z)-.6,z,1,yaw,{solid:true});
  for(let j=0;j<26;j++){const px=x+(r()-.5)*11,pz=z+(r()-.5)*7;add('rock'+(j%3),px,terrainSurfaceHeight(px,pz)-.3,pz,[.45+r(),.3+r()*.5,.35+r()],r()*6.28);}
 }
 let placements=p.filter(q=>!((q.type.startsWith('rock')||q.type==='bush')&&q.x>20&&q.x<30&&q.z>20&&q.z<48)).filter(q=>!(q.type.startsWith('house')&&q.y>=24&&Math.abs(q.x-30)<13&&Math.abs(q.z+118)<13));
 if(foundations){
  // These two houses straddle a 13 m terrace edge; one has an upper storey.
  // Remove this isolated overlap after all seeded generation, keeping every
  // other random draw, building height and landmark unchanged.
  const remove=new Set([24,25,48]);
  placements=placements.flatMap((q,index)=>{
   if(remove.has(index))return[];
   if(!q.type.startsWith('house'))return[q];
   const adjusted={...q,foundationSourceIndex:index};
   if(index===49){adjusted.x=2;adjusted.z=-88;}
   if(index===55)adjusted.z=-123.2;
   return[adjusted];
  });
 }
 return weatheredRoad?weatherMainRoad(placements):placements;
}
