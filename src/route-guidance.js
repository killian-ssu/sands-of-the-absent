import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Sparse physical route cues, not navigation rules. Five draws, no collisions. */
export function createRouteGuidance(scene, game, { groundHeight = () => 0 } = {}) {
  const root = new T.Group(); root.name = 'copper-route-markers'; scene.add(root);
  const resources = [], keep = object => { resources.push(object); return object; };
  const stoneParts = [], patinaParts = [], copperParts = [[], [], []];
  const groups = [
    { anchor: [-37, 25], marker: [-39.2, 25.3], toward: [-23, 23.5], route: 0, height: 0.78 },
    { anchor: [-23, 23.5], marker: [-23, 25.3], toward: [13, 15], route: 0, height: 0.92 },
    { anchor: [13, 15], marker: [15, 15.2], toward: [18, -35], route: 0, height: 0.74 },
    { anchor: [18, -35], marker: [15.8, -35], toward: [30, -118], route: 0, height: 0.94 },
    { anchor: [25, 31], marker: [22.7, 32.4], toward: [25, 27], route: 1, height: 0.83 },
    { anchor: [27, 35], marker: [25.4, 36.2], toward: [25, 27], route: 1, height: 0.72 },
    // Five isolated turns follow the walkable southern shore, not the beam's
    // straight line across the lake. These are low inscriptions, without posts.
    { anchor: [26.3, 36.85], toward: [31.5, 39.5], route: 2, groundOnly: true },
    { anchor: [33.3, 40.3], toward: [45, 45.5], route: 2, groundOnly: true },
    { anchor: [45, 46], toward: [60.5, 39.5], route: 2, groundOnly: true },
    { anchor: [61.65, 38.8], toward: [64.5, 29.5], route: 2, groundOnly: true },
    { anchor: [64.7, 31.8], toward: [64, 28], route: 2, groundOnly: true },
  ];
  const noise = n => { const v = Math.sin(n * 73.19 + 2.81) * 43758.53; return v - Math.floor(v); };
  const transform = (center, yaw, x, z) => [center[0] + Math.cos(yaw) * x + Math.sin(yaw) * z,
    center[1] - Math.sin(yaw) * x + Math.cos(yaw) * z];
  const finishGeometry = (positions, indices) => {
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices);
    const flat = geometry.toNonIndexed(); geometry.dispose(); flat.computeVertexNormals(); return flat;
  };
  // Each bottom/top corner samples the actual walk surface independently.
  // These low paving fragments never bridge over an uneven floor as floating boxes.
  const groundedStone = (center, yaw, w, d, height, seed, post = false) => {
    const bevel = Math.min(w, d) * 0.16;
    const outline = [[-w/2+bevel,-d/2],[w/2-bevel,-d/2],[w/2,-d/2+bevel],[w/2,d/2-bevel],
      [w/2-bevel,d/2],[-w/2+bevel,d/2],[-w/2,d/2-bevel],[-w/2,-d/2+bevel]];
    const positions = [], indices = [];
    for (let ring = 0; ring < 2; ring++) for (let i = 0; i < outline.length; i++) {
      const [lx,lz] = outline[i], taper = ring && post ? 0.86 : 1;
      const [x,z] = transform(center,yaw,lx*taper,lz*taper), floor = groundHeight(x,z);
      const y = ring ? floor + height * (post ? 0.93 + noise(seed+i)*0.07 : 1) : floor - 0.035;
      positions.push(x,y,z);
    }
    for (let i = 0; i < 8; i++) { const next=(i+1)%8; indices.push(i,i+8,next,next,i+8,next+8); }
    for (let i = 1; i < 7; i++) indices.push(8,9+i,8+i);
    return finishGeometry(positions,indices);
  };
  const surfaceStrip = (center, yaw, x, z, w, d, collection) => {
    const corners=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]], positions=[];
    for(const [dx,dz]of corners){const [wx,wz]=transform(center,yaw,x+dx,z+dz);positions.push(wx,groundHeight(wx,wz)+(collection===patinaParts?.021:.024),wz);}
    collection.push(finishGeometry(positions,[0,2,1,0,3,2]));
  };
  const postStrip = (center,yaw,x,y,w,h,height,collection) => {
    const positions=[];
    for(const [dx,dy]of[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]]){
      const z=.12*(1-.14*(y+dy)/height)+(collection===patinaParts?.003:.006);
      const [wx,wz]=transform(center,yaw,x+dx,z);positions.push(wx,groundHeight(wx,wz)+y+dy,wz);
    }
    collection.push(finishGeometry(positions,[0,1,2,0,2,3]));
  };
  for(let i=0;i<groups.length;i++){
    const item=groups[i],yaw=Math.atan2(item.toward[0]-item.anchor[0],item.toward[1]-item.anchor[1]),copper=copperParts[item.route];
    for(const [offset,size]of[[-.55,.78],[.65,.67]]){
      const center=transform(item.anchor,yaw,.04,offset);
      stoneParts.push(groundedStone(center,yaw,size,.92,.014,i*17));
      for(const x of[-.14,.14]){
        surfaceStrip(center,yaw,x,0,.045,.65,patinaParts);
        surfaceStrip(center,yaw,x,0,.014,.53,copper);
      }
      surfaceStrip(center,yaw,0,-.19,.27,.014,copper);
      if(item.groundOnly){
        // A worn open chevron gives the existing paired-line motif a direction.
        for(const side of[-1,1]){
          const tip=transform(center,yaw,side*.1,.15),angle=yaw-side*Math.PI/4;
          surfaceStrip(tip,angle,0,0,.047,.29,patinaParts);
          surfaceStrip(tip,angle,0,0,.019,.245,copper);
        }
      }
    }
    if(item.groundOnly)continue;
    stoneParts.push(groundedStone(item.marker,yaw,.58,.46,.09,i*23));
    stoneParts.push(groundedStone(item.marker,yaw,.42,.24,item.height,i*43,true));
    postStrip(item.marker,yaw,0,item.height*.47,.19,item.height*.68,item.height,patinaParts);
    for(const x of[-.059,.059]) postStrip(item.marker,yaw,x,item.height*.47,.017,item.height*.6,item.height,copper);
    for(const y of[.25,.48,.69]) postStrip(item.marker,yaw,0,item.height*y,.15,.018,item.height,copper);
  }
  const stoneMaterial=keep(new T.MeshStandardMaterial({color:0x96876c,roughness:.95}));
  stoneMaterial.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vMarkerWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvMarkerWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader='varying vec3 vMarkerWorld;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 gritCell=floor(vMarkerWorld*64.);float grit=fract(sin(dot(gritCell,vec3(12.9898,78.233,39.425)))*43758.5453);
      diffuseColor.rgb*=.90+.14*grit;`);
  };
  const patina=keep(new T.MeshStandardMaterial({color:0x334b40,metalness:.46,roughness:.78,side:T.DoubleSide}));
  const copperMaterials=[0,1,2].map(()=>keep(new T.MeshStandardMaterial({color:0xa98952,metalness:.74,roughness:.5,
    emissive:0xe6a858,emissiveIntensity:0,side:T.DoubleSide})));
  const merge = (parts,material,name) => {
    const geometry=keep(mergeGeometries(parts,false));for(const part of parts)part.dispose();
    const mesh=new T.Mesh(geometry,material);mesh.name=name;mesh.castShadow=false;mesh.receiveShadow=true;root.add(mesh);return mesh;
  };
  merge(stoneParts,stoneMaterial,'grounded-waystones');merge(patinaParts,patina,'weathered-copper-recesses');
  copperParts.forEach((parts,index)=>merge(parts,copperMaterials[index],['obelisk-route-copper','oasis-route-copper','oasis-south-shore-copper'][index]));
  let previousTime=null,first=true,disposed=false,values=[0,0,0],beamKey='',shoreLinked=false;
  const update=(elapsed=0)=>{
    if(disposed)return;
    const t=Number.isFinite(elapsed)?elapsed:0,dt=previousTime===null?0:Math.min(.1,Math.max(0,t-previousTime));previousTime=t;
    const state=game.state,completed=state.completed,temple=completed.includes('temple'),city=completed.includes('city'),oasis=completed.includes('oasis');
    const key=[state.lamp.location,state.lamp.socketId,state.mirrorTurns['oasis-mirror-west'],state.mirrorTurns['oasis-mirror-east'],completed.length].join('|');
    if(key!==beamKey){
      beamKey=key;
      // Read the game's actual ray result: an angle index alone is not proof
      // that light has reached the other bank. No gameplay state is modified.
      shoreLinked=game.getBeamPaths().some(path=>path.areaId==='oasis'&&path.segments.some(segment=>segment.hitType==='mirror'&&segment.hitId==='oasis-mirror-east'));
    }
    const targets=[temple?(city?.07:.28):0,city?(oasis?.08:shoreLinked?.07:.3):0,oasis?.065:shoreLinked?.24:0];
    for(let i=0;i<3;i++){
      values[i]=first?targets[i]:values[i]+(targets[i]-values[i])*(1-Math.exp(-dt*1.5));
      copperMaterials[i].emissiveIntensity=values[i]*(.96+.04*Math.sin(t*.7+i));
    }
    first=false;
  };
  const dispose=()=>{if(disposed)return;disposed=true;root.removeFromParent();for(const resource of resources)resource.dispose();};
  update(0);
  return {root,update,dispose,drawCalls:5};
}
