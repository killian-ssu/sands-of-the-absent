/**
 * Opt-in regression driver. This module never writes player/game/save state.
 * Feed update(dt)'s non-null output into the ordinary player controller.
 *
 * getState(): {player:{position,speed,paused?},paused?,uiModalActive?,
 *   interactionBusy?,selected:{id,enabled,inRange,distance,interactionDistance,position?}}
 * onInteract(): the existing guarded interaction handler, including its animation
 * Promise. A busy animation freezes all route timers, just like the game menu.
 * Steps: {type:'move',x,z,run?}, {type:'interact',id}, {type:'wait',seconds}.
 */
export function createPlaytestRoute({getState, onInteract} = {}) {
  if (typeof getState !== 'function') throw new TypeError('Route driver needs getState().');
  let steps = [], index = 0, status = 'idle', reason = null, message = '尚未开始';
  let elapsed = 0, stepElapsed = 0, stillSeconds = 0, settling = 0, waitElapsed = 0;
  let timeoutSeconds = 600, lastYaw = 0, anchor = null, releaseSeconds = 0, generation = 0;
  let pending = null, paused = false, disposed = false;
  const neutral = () => ({forward:0,strafe:0,run:false,jump:false,cameraYaw:lastYaw});
  const vector = value => Array.isArray(value) ? value.length === 3 && value.every(Number.isFinite) ? value : null
    : value && [value.x,value.y,value.z].every(Number.isFinite) ? [value.x,value.y,value.z] : null;
  const snapshot = () => ({status,reason,message,index,totalSteps:steps.length,step:steps[index] ? {...steps[index]} : null,
    elapsed,stepElapsed,stillSeconds,timeoutSeconds,paused,interactionPending:!!pending,releaseSeconds});

  function finish(nextStatus, code, text) {
    status = nextStatus; reason = code; message = text; releaseSeconds = .35;
    generation++; pending = null; anchor = null;
  }
  function advance() {
    index++; stepElapsed = stillSeconds = settling = waitElapsed = 0; anchor = null; pending = null;
    if (index === steps.length) finish('completed','route-completed','所有路线步骤已执行；实机通关结果需检查游戏状态。');
    else message = `执行第 ${index + 1} / ${steps.length} 步`;
  }
  function start(input, options = {}) {
    if (disposed) throw new Error('Route driver has been disposed.');
    if (status === 'running') throw new Error('Cancel the current route before starting another.');
    if (!Array.isArray(input) || !input.length || input.length > 2048) throw new TypeError('Route must contain 1–2048 finite data steps.');
    const limit = options.timeoutSeconds ?? 600;
    if (!Number.isFinite(limit) || limit <= 0 || limit > 7200) throw new RangeError('Route timeout must be in (0,7200] seconds.');
    const validated = input.map((step, i) => {
      if (!step || Object.getPrototypeOf(step) !== Object.prototype) throw new TypeError(`Step ${i} must be plain data.`);
      const allowed = step.type === 'move' ? ['type','x','z','run'] : step.type === 'interact' ? ['type','id']
        : step.type === 'wait' ? ['type','seconds'] : [];
      if (!allowed.length || Object.keys(step).some(key => !allowed.includes(key))) throw new TypeError(`Step ${i} has an unsupported type or field.`);
      if (step.type === 'move') {
        if (![step.x,step.z].every(Number.isFinite) || (step.run !== undefined && typeof step.run !== 'boolean')) throw new TypeError(`Step ${i} has an invalid waypoint.`);
        return {type:'move',x:step.x,z:step.z,run:!!step.run};
      }
      if (step.type === 'interact') {
        if (typeof step.id !== 'string' || !step.id.trim() || step.id.length > 128) throw new TypeError(`Step ${i} needs a target id.`);
        return {type:'interact',id:step.id};
      }
      if (!Number.isFinite(step.seconds) || step.seconds < 0 || step.seconds > 120) throw new RangeError(`Step ${i} wait must be in [0,120] seconds.`);
      return {type:'wait',seconds:step.seconds};
    });
    generation++; steps = validated; index = 0; status = 'running'; reason = null;
    message = `执行第 1 / ${steps.length} 步`; timeoutSeconds = limit;
    elapsed = stepElapsed = stillSeconds = settling = waitElapsed = releaseSeconds = 0;
    pending = null; anchor = null; paused = false; return snapshot();
  }
  function cancel(text = '测试路线已取消。') {
    if (!disposed) finish('cancelled','cancelled',String(text));
    return snapshot();
  }
  function update(dt) {
    if (disposed) return null;
    const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (status !== 'running') {
      if (releaseSeconds <= 0) return null;
      releaseSeconds = Math.max(0,releaseSeconds-delta); return neutral();
    }
    let state;
    try { state = getState() || {}; }
    catch (error) { finish('failed','state-read-failed','读取实机状态失败：'+(error?.message||String(error))); return neutral(); }
    const position = vector(state.player?.position);
    if (!position) { finish('failed','invalid-position','角色位置不是有效的世界坐标。'); return neutral(); }
    paused = !!(state.paused || state.uiModalActive || state.player?.paused || state.interactionBusy);
    if (paused) { anchor = [...position]; return neutral(); }
    if (!delta) return neutral();
    elapsed += delta; stepElapsed += delta;
    if (elapsed >= timeoutSeconds) { finish('failed','route-timeout',`路线超过 ${timeoutSeconds} 秒有效执行时间，已停止。`); return neutral(); }
    const step = steps[index];
    if (step.type === 'move') {
      const dx = step.x-position[0], dz = step.z-position[2], distance = Math.hypot(dx,dz);
      if (distance <= .25) { advance(); return neutral(); }
      if (!anchor || Math.hypot(position[0]-anchor[0],position[2]-anchor[2]) >= .025) {
        anchor = [...position]; stillSeconds = 0;
      } else stillSeconds += delta;
      if (stillSeconds >= 2) {
        finish('failed','movement-stuck',`连续 2 秒未移动：第 ${index+1} 步 [${step.x}, ${step.z}]，当前 [${position[0].toFixed(2)}, ${position[2].toFixed(2)}]。`);
        return neutral();
      }
      lastYaw = Math.atan2(-dx,-dz);
      return {forward:Math.min(1,distance*.9),strafe:0,run:step.run && distance>1.5,jump:false,cameraYaw:lastYaw};
    }
    if (step.type === 'wait') {
      waitElapsed += delta;
      if (waitElapsed >= step.seconds) advance();
      return neutral();
    }
    // Let deceleration and the game's throttled selected-target UI settle after
    // reaching a waypoint. Never substitute a different nearby interaction.
    if (pending) {
      if (!pending.done) return neutral();
      if (pending.error) { finish('failed','interaction-failed','互动失败：'+pending.error); return neutral(); }
      if (pending.result?.ok === false) { finish('failed','interaction-rejected',`互动 ${step.id} 被规则拒绝：${pending.result.reason||pending.result.error||'unknown'}`); return neutral(); }
      advance(); return neutral();
    }
    if (Number.isFinite(state.player?.speed) && state.player.speed > .08) { settling = 0; return neutral(); }
    settling += delta;
    if (settling < .15) return neutral();
    const selected = state.selected;
    if (selected?.id !== step.id) {
      finish('failed','interaction-target-mismatch',`期待互动 ${step.id}，当前选中 ${selected?.id||'无'}；未触发任何互动。`); return neutral();
    }
    const reach = selected.interactionDistance, target = vector(selected.position);
    const actualDistance = target ? Math.hypot(position[0]-target[0],position[1]-target[1],position[2]-target[2]) : selected.distance;
    if (selected.enabled !== true || selected.inRange !== true || !Number.isFinite(selected.distance) || selected.distance < 0
      || !Number.isFinite(reach) || reach <= 0 || selected.distance > reach || !Number.isFinite(actualDistance) || actualDistance > reach) {
      finish('failed','interaction-out-of-range',`互动 ${step.id} 不在有效距离内或尚未启用；未触发任何互动。`); return neutral();
    }
    if (typeof onInteract !== 'function') { finish('failed','interaction-not-connected','原游戏互动处理器尚未接入。'); return neutral(); }
    const token = generation, interaction = pending = {done:false,result:null,error:null};
    try {
      const result = onInteract();
      Promise.resolve(result).then(value => {
        if (!disposed && generation === token) { interaction.result = value; interaction.done = true; }
      }, error => {
        if (!disposed && generation === token) { interaction.error = error?.message||String(error); interaction.done = true; }
      });
    } catch (error) { interaction.error = error?.message||String(error); interaction.done = true; }
    return neutral();
  }
  return {start,update,cancel,snapshot,dispose(){if(disposed)return;cancel('路线驱动已释放。');disposed=true;}};
}
