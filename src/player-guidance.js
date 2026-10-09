// A read-only presentation of the one current objective. No save, pathfinding,
// controller input or puzzle mutation belongs to this module.
const positionOf = value => Array.isArray(value) ? value : value && [value.x,value.y,value.z];
const names = {
 'temple-socket':'神庙前聚光座', 'city-socket-low':'台阶下层聚光座',
 'city-socket-high':'台阶东侧高座', 'city-mirror':'台阶上的光镜',
 'oasis-socket':'近岸聚光座', 'oasis-mirror-west':'近岸光镜', 'oasis-mirror-east':'对岸光镜',
};
const compass = (dx,dz) => ['北','东北','东','东南','南','西南','西','西北'][Math.round((Math.atan2(dx,-dz)+Math.PI*2)/(Math.PI/4))%8];

export function guidanceView({data,state,objective,selected,position,interactionBusy=false}={}) {
 const p=positionOf(position||state?.playerPosition);
 if(!data||!objective||!p?.every(Number.isFinite))return {text:'',actionReady:false};
 if(objective.kind==='complete')return {text:'可自由探索，也可从地图返回已苏醒的遗迹。',actionReady:false};
 if(objective.kind==='charging')return {text:'光已接通，稍候片刻。',actionReady:false};
 const objects=[data.lamp,data.npc,...data.areas.flatMap(a=>[...a.sockets,...a.mirrors,a.terminal])];
 const target=objects.find(o=>o?.id===objective.targetId);
 if(!target)return {text:'',actionReady:false};
 const d=Math.hypot(target.position[0]-p[0],target.position[2]-p[2]);
 const label=target.id===data.lamp.id?'地上的暖光':names[target.id]||'目标';
 const actionReady=!interactionBusy&&selected?.id===target.id&&selected.enabled&&selected.inRange;
 if(actionReady)return {text:`已到${label}旁 · 按 E ${selected.label}`,actionReady:true};
 if(interactionBusy)return {text:label,actionReady:false};
 const distance=`约 ${Math.max(1,Math.round(d))} 米`;
 let route='';
 if(objective.kind==='pickup')route='先用 WASD 靠近暖光';
 else if(objective.kind==='retrieve')route='把灯带上，再继续旅程';
 else if(objective.targetId==='oasis-mirror-east'&&d>5)route='沿水边南岸的铜纹绕行';
 else if(objective.kind==='carry'&&objective.areaId==='city'&&d>35)route=p[0]<4&&p[2]>-30?'出神庙向东，接上石板路':`沿石板路寻找${compass(target.position[0]-p[0],target.position[2]-p[2])}侧巨碑下的石阶`;
 else if(objective.kind==='carry'&&objective.areaId==='oasis'&&d>35)route=p[2]<-35&&Math.abs(p[0]-18)<30?'下旧城台阶，沿路向南到棕榈水边':'沿沙路寻找棕榈水边';
 else if(objective.targetId==='city-socket-high')route='沿台阶东侧向上';
 else if(d<3.5)route='再靠近一些，看到 E 提示再互动';
 else route=`${compass(target.position[0]-p[0],target.position[2]-p[2])}侧`;
 return {text:`${route} · ${label} ${distance}`,actionReady:false};
}

export function createPlayerGuidance({data,root=globalThis.document}={}) {
 const detail=root?.querySelector('#objective-detail'),controls=root?.querySelector('#controls');
 let previous=null,moved=0,activeSeconds=0,lastText='',disposed=false;
 const reset=()=>{previous=null;moved=0;activeSeconds=0;lastText='';controls?.classList.remove('taught');};
 const update=(dt,{state,objective,selected,position,started=true,paused=false,interactionBusy=false}={})=>{
  if(disposed)return;
  const p=positionOf(position||state?.playerPosition),visible=started&&!paused;
  if(visible&&p?.every(Number.isFinite)){
   activeSeconds+=Math.min(.25,Math.max(0,Number(dt)||0));
   if(previous){const step=Math.hypot(p[0]-previous[0],p[2]-previous[2]);if(step<2)moved+=step;}
  }
  previous=p?.every(Number.isFinite)?[...p]:null;
  // A restored journey has already learned the pickup. Initial reminders fade
  // after successful play; full controls remain available in the map.
  const taught=Boolean(state?.hasPickedUp)||(moved>2&&activeSeconds>12);
  controls?.classList.toggle('taught',taught);
  const view=guidanceView({data,state,objective,selected,position,interactionBusy});
  if(detail){detail.classList.toggle('hidden',!visible||!view.text);detail.classList.toggle('action-ready',view.actionReady);
   if(view.text!==lastText){detail.textContent=view.text;lastText=view.text;}
  }
  return {...view,taught};
 };
 const dispose=()=>{disposed=true;controls?.classList.remove('taught');if(detail){detail.textContent='';detail.classList.add('hidden');}};
 return {update,reset,dispose};
}
