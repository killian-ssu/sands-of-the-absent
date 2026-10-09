import {createPlaytestRoute} from './playtest-route.js';

/**
 * Local, opt-in QA controls. The returned input must go through the real player
 * controller, with the same dt and pause rules as normal keyboard input.
 *
 * getState() may return:
 * {player:{position,heading,speed,locomotion,paused}, game:{completed,currentArea,
 * lamp,chargeProgress}, objective:{text}, selected:{id,label}, fps,paused,cameraYaw,
 * drawCalls,triangles,uiModalActive,rockLOD:{enabled,tiers,triangleBudget,originalTriangles,batches}}
 * Position can be a Vector3 or [x,y,z]; cameraYaw is in radians.
 * uiModalActive hides/collapses QA while a game menu is open. Closing that menu
 * reveals only the collapsed summary; it never reopens the panel automatically.
 * Optional onToggleLOD() returns the actual enabled boolean (or its Promise).
 */
export function createPlaytestPanel({getState = () => ({}), onInteract, onRestart, onCapture, onToggleLOD, onToggleShadow, renderToggles = []} = {}) {
  const noop = {update: () => null, dispose() {}, enabled: false};
  if (typeof window === 'undefined' || typeof document === 'undefined') return noop;
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
  if (!local || document.documentElement.hasAttribute('data-static-site') || new URLSearchParams(window.location.search).get('qa') !== '1') return noop;
  if (document.getElementById('sands-playtest-panel')) throw new Error('Only one playtest panel can be active.');

  const host = document.createElement('div');
  host.id = 'sands-playtest-panel';
  const shadow = host.attachShadow({mode: 'open'});
  const style = document.createElement('style');
  style.textContent = `
    :host { position:fixed;right:14px;bottom:14px;z-index:20000;width:350px;
      max-width:calc(100vw - 28px);color:#eef2ef;font:12px/1.45 system-ui,sans-serif;
      text-align:left;letter-spacing:normal;pointer-events:auto; }
    :host([hidden]) { display:none; }
    * { box-sizing:border-box; }
    details { background:rgba(16,25,29,.96);border:1px solid #718588;border-radius:9px;
      box-shadow:0 8px 28px #0008; }
    summary { padding:10px 12px;cursor:pointer;font-weight:650;color:#f3d398; }
    .body { padding:0 12px 12px;max-height:71vh;overflow:auto;overscroll-behavior:contain; }
    p { margin:3px 0 8px;color:#c2ccce;font-size:11px; }
    .buttons { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:8px 0; }
    button, input, select, textarea { font:inherit;color:inherit; }
    button { min-height:32px;padding:5px 6px;border:1px solid #607476;border-radius:4px;
      background:#293c40;cursor:pointer;text-align:center;letter-spacing:normal; }
    button:hover { background:#395056; } button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible {
      outline:2px solid #f3d398;outline-offset:2px; }
    button:disabled { opacity:.45;cursor:wait; }
    .stop { background:#68413a;border-color:#ab7364; }
    .fields { display:grid;grid-template-columns:1fr 1fr;gap:7px; }
    label { display:flex;flex-direction:column;gap:3px;color:#d6dedf; }
    input[type=number], select { width:100%;min-height:30px;border:1px solid #607476;
      border-radius:4px;background:#17272c;padding:4px 6px; }
    textarea { width:100%;min-height:90px;resize:vertical;border:1px solid #607476;
      border-radius:4px;background:#17272c;padding:6px; }
    .checks { display:flex;gap:15px;margin:7px 0; } .checks label { display:flex;flex-direction:row;align-items:center; }
    input[type=checkbox] { margin:0 4px 0 0;accent-color:#e5bf80; }
    progress { width:100%;height:7px;accent-color:#e5bf80;display:block;margin:7px 0; }
    .status { color:#f2d7a2;margin:5px 0;min-height:18px;overflow-wrap:anywhere; }
    dl { display:grid;grid-template-columns:62px 1fr;gap:4px 6px;margin:8px 0;font-size:11px; }
    dt { color:#99b1b8; } dd { margin:0;overflow-wrap:anywhere; }
    .mono { font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums; }
    ol { margin:7px 0 0;padding:7px 0 0 16px;border-top:1px solid #415257;color:#b9c9ce;font-size:10px; }
    li { margin:3px 0;overflow-wrap:anywhere; }
    @media(max-height:540px) { .body { max-height:66vh; } }
  `;
  shadow.append(style);
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const panel = el('details'); panel.open = true;
  const summary = el('summary', 'QA 实机测试 · 待命');
  const body = el('div', undefined, 'body');
  panel.append(summary, body); shadow.append(panel); document.body.append(host);
  body.append(el('p', '仅发送真实控制器输入；碰撞、暂停、互动距离和关卡条件照常生效。'));

  const fields = el('div', undefined, 'fields');
  const yawLabel = el('label', '世界朝向（度）');
  const yawField = el('input'); yawField.type = 'number'; yawField.step = '1'; yawField.value = '0';
  yawField.id = 'qa-world-yaw'; yawLabel.append(yawField);
  const secondsLabel = el('label', '持续时间（0.05–60 秒）');
  const secondsField = el('input'); secondsField.type = 'number'; secondsField.min = '0.05';
  secondsField.max = '60'; secondsField.step = '0.1'; secondsField.value = '3';
  secondsField.id = 'qa-duration'; secondsLabel.append(secondsField);
  fields.append(yawLabel, secondsLabel); body.append(fields);
  body.append(el('p', '前进方向：0° 北（−Z） · 90° 西（−X） · −90° 东（+X） · 180° 南（+Z）'));

  let job = null, releaseSeconds = 0, disposed = false, busyAction = false;
  let uiSeconds = 0, measuredFPS = 0, measuredFrames = 0, fpsSince = performance.now();
  let lastState = {}, lastYaw = 0, statusText = '待命', lodButton = null, lastLodEnabled, shadowButton = null;
  let restartButton = null, restartArmedUntil = 0;
  let routeOwnsInput = false, routeLeadIn = 0, routeAnnouncement = '';
  const restartPrompt = '再次点击“确认重新开始”将清空本轮进度（4 秒内有效）。';
  const logLines = [];
  const presetButtons = el('div', undefined, 'buttons'); body.append(presetButtons);
  const customFields = el('div', undefined, 'fields');
  const directionLabel = el('label', '自定方向');
  const direction = el('select'); direction.id = 'qa-direction';
  for (const [value, name] of [['forward', '前进'], ['back', '后退'], ['left', '左移'], ['right', '右移']]) {
    const option = el('option', name); option.value = value; direction.append(option);
  }
  direction.value = 'forward'; directionLabel.append(direction); customFields.append(directionLabel);
  const cameraButtonSlot = el('div'); customFields.append(cameraButtonSlot); body.append(customFields);
  const checks = el('div', undefined, 'checks');
  const runLabel = el('label', '奔跑'); const runField = el('input'); runField.type = 'checkbox'; runLabel.prepend(runField);
  const jumpLabel = el('label', '开始时跳一次'); const jumpField = el('input'); jumpField.type = 'checkbox'; jumpLabel.prepend(jumpField);
  checks.append(runLabel, jumpLabel); body.append(checks);
  const actions = el('div', undefined, 'buttons'); body.append(actions);
  const routeLabel = el('label', '回归路线 JSON');
  const routeField = el('textarea'); routeField.id = 'qa-route-json'; routeField.rows = 5; routeField.spellcheck = false;
  routeField.placeholder = '[{"type":"move","x":-37,"z":30},{"type":"interact","id":"lantern"}]';
  routeLabel.append(routeField); body.append(routeLabel);
  const routeButtons = el('div', undefined, 'buttons'); body.append(routeButtons);
  const progress = el('progress'); progress.max = 1; progress.value = 0;
  progress.setAttribute('aria-label', '定时输入进度'); body.append(progress);
  const status = el('div', statusText, 'status'); status.setAttribute('role', 'status'); body.append(status);
  const monitor = el('dl'); const values = {};
  for (const [key, title] of [['position','角色坐标'], ['motion','运动状态'], ['target','当前目标'],
    ['awakened','已醒区域'], ['interaction','当前互动'], ['lamp','提灯状态'], ['fps','帧率'],
    ['renderStats','帧提交'], ['rockLod','岩石 LOD'], ['rockTiers','各档数量'], ['rockBudget','岩石预算'], ['command','定时输入'], ['route','回归路线']]) {
    const output = el('dd', '—', key === 'position' || key === 'fps' ? 'mono' : '');
    values[key] = output; monitor.append(el('dt', title), output);
  }
  body.append(monitor);
  const log = el('ol'); log.setAttribute('aria-label', '最近测试操作'); body.append(log);

  const vector = value => Array.isArray(value) ? value.slice(0, 3)
    : value && ['x','y','z'].every(key => Number.isFinite(value[key])) ? [value.x,value.y,value.z] : null;
  const positionOf = state => vector(state.player?.position || state.position || state.game?.playerPosition);
  const labelOf = value => typeof value === 'string' ? value
    : value?.text || value?.label || value?.name || value?.id || '—';
  const neutral = () => ({forward: 0, strafe: 0, run: false, jump: false, cameraYaw: lastYaw});
  const setStatus = text => { statusText = text; status.textContent = text; };
  const route = createPlaytestRoute({getState:() => {
    const state = readState(); return {...state, paused:!!(state.paused || document.hidden || busyAction)};
  }, onInteract});

  function addLog(text) {
    logLines.unshift(text); logLines.length = Math.min(logLines.length, 5);
    log.replaceChildren(...logLines.map(line => el('li', line)));
  }
  function readState() {
    try { return getState() || {}; }
    catch (error) { setStatus('读取游戏状态失败：' + (error?.message || String(error))); return {}; }
  }
  function cancelRestart() {
    restartArmedUntil = 0;
    if (restartButton) restartButton.textContent = '重新开始';
    if (statusText === restartPrompt) setStatus('待命');
  }
  function syncModal(state) {
    const active = !!state.uiModalActive;
    if (active) { panel.open = false; cancelRestart(); }
    host.hidden = active;
    host.inert = active;
    return active;
  }
  function cancelRoute(reason = '已取消回归路线') {
    if (routeOwnsInput || route.snapshot().status === 'running') route.cancel(reason);
    routeOwnsInput = false; routeLeadIn = 0; routeAnnouncement = '';
  }
  function stop(reason = '已停止全部测试输入') {
    cancelRoute(reason);
    job = null; releaseSeconds = 0.35; progress.value = 0;
    setStatus(reason); addLog(reason);
  }
  function start(name, forward, strafe, seconds, run = false, jump = false) {
    cancelRoute('手动定时输入已接管，回归路线取消。');
    const degrees = Number(yawField.value);
    if (!Number.isFinite(degrees) || !Number.isFinite(seconds) || seconds < 0.05 || seconds > 60) {
      stop('设置无效：朝向需为数字，时间需为 0.05–60 秒。'); return;
    }
    if (job) addLog(job.name + '已被新指令替换');
    const normalizedDegrees = ((degrees + 180) % 360 + 360) % 360 - 180;
    lastYaw = normalizedDegrees * Math.PI / 180;
    lastState = readState();
    job = {name, forward, strafe, run, jump, jumpSent: false, yaw: lastYaw,
      duration: seconds, elapsed: 0, startPosition: positionOf(lastState)};
    releaseSeconds = 0; progress.value = 0;
    setStatus(`${name} · ${seconds.toFixed(2)} 秒 · ${normalizedDegrees.toFixed(1)}°`);
    addLog(statusText); render(lastState);
  }
  function button(parent, text, callback, className) {
    const node = el('button', text, className); node.type = 'button';
    node.addEventListener('click', event => {
      if (disposed || syncModal(readState())) return;
      if (node !== restartButton) cancelRestart();
      return callback(event);
    }); parent.append(node); return node;
  }
  button(presetButtons, '前进 1 秒', () => start('前进', 1, 0, 1));
  button(presetButtons, '前进 3 秒', () => start('前进', 1, 0, 3));
  button(presetButtons, '后退 1 秒', () => start('后退', -1, 0, 1));
  button(presetButtons, '左移 1 秒', () => start('左移', 0, -1, 1));
  button(presetButtons, '右移 1 秒', () => start('右移', 0, 1, 1));
  button(presetButtons, '奔跑 3 秒', () => start('奔跑', 1, 0, 3, true));
  button(presetButtons, '跳跃一次', () => start('跳跃', 0, 0, 0.15, false, true));
  button(presetButtons, '停止', () => stop(), 'stop');
  button(presetButtons, '执行自定输入', () => {
    const directions = {forward: [1,0], back: [-1,0], left: [0,-1], right: [0,1]};
    const [forward, strafe] = directions[direction.value] || directions.forward;
    start('自定移动', forward, strafe, Number(secondsField.value), runField.checked, jumpField.checked);
  });
  button(routeButtons, '执行路线', () => {
    if (busyAction) { setStatus('上一项操作尚未结束。'); return; }
    try {
      const payload = JSON.parse(routeField.value), steps = Array.isArray(payload) ? payload : payload?.steps;
      const options = Array.isArray(payload) ? {} : {timeoutSeconds:payload?.timeoutSeconds ?? 600};
      cancelRoute('已替换为新回归路线。');
      route.start(steps, options);
      job = null; releaseSeconds = 0; routeOwnsInput = true; routeLeadIn = .35;
      setStatus(`已释放手动输入，准备执行 ${steps.length} 步回归路线。`); addLog(statusText); render(readState());
    } catch (error) {
      stop('路线未启动：' + (error?.message || String(error)));
    }
  });
  button(routeButtons, '停止路线', () => stop('回归路线已停止，输入已释放。'), 'stop');
  const loadRouteButton = button(routeButtons, '填入全程建议路线', async () => {
    if (loadRouteButton.disabled) return;
    loadRouteButton.disabled = true;
    try {
      const response = await fetch('/assets/qa/journey.json', {cache:'no-store'});
      if (!response.ok) throw new Error('本机路线读取失败：' + response.status);
      const payload = await response.json();
      if (!Array.isArray(payload.steps)) throw new TypeError('本机路线缺少 steps 数组。');
      if (disposed) return;
      routeField.value = JSON.stringify(payload, null, 2);
      setStatus(`已填入 ${payload.steps.length} 步建议路线；仅从出生点的初始谜题状态手动执行。`);
    } catch (error) {
      if (!disposed) setStatus('路线未填入：' + (error?.message || String(error)));
    } finally { if (!disposed) loadRouteButton.disabled = false; }
  });
  button(cameraButtonSlot, '采用当前镜头朝向', () => {
    const state = readState(); let yaw = state.cameraYaw ?? state.camera?.movementYaw;
    if (!Number.isFinite(yaw)) {
      const p = vector(state.camera?.position), target = vector(state.camera?.target);
      if (p && target) yaw = Math.atan2(p[0] - target[0], p[2] - target[2]);
      else yaw = state.camera?.yaw;
    }
    if (Number.isFinite(yaw)) { yawField.value = (yaw * 180 / Math.PI).toFixed(2); setStatus('已采用当前镜头朝向，下一条移动时使用。'); }
    else setStatus('getState 尚未提供镜头朝向；可直接填写世界角度。');
  });

  async function invoke(name, callback) {
    if (busyAction) { setStatus('上一项操作尚未结束。'); return; }
    // A screenshot may observe a running route without cancelling it. Its
    // async render pauses route input through busyAction until it is finished.
    if (name === '截图' && routeOwnsInput) setStatus('回归路线暂时停步，准备截图。');
    else stop('已释放移动输入，准备' + name);
    if (typeof callback !== 'function') { setStatus(name + '回调尚未接入。'); return; }
    busyAction = true;
    try {
      const result = await callback();
      if (disposed) return;
      const message = result?.ok === false ? `${name}未生效：${result.reason || result.error || '游戏规则拒绝'}` : name + '回调已完成';
      setStatus(message); addLog(message);
    } catch (error) {
      if (!disposed) { const message = name + '失败：' + (error?.message || String(error)); setStatus(message); addLog(message); }
    } finally { busyAction = false; }
  }
  button(actions, '互动', () => invoke('互动', onInteract));
  restartButton = button(actions, '重新开始', () => {
    if (busyAction) { setStatus('上一项操作尚未结束。'); return; }
    if (routeOwnsInput) { cancelRoute('准备重新开始，回归路线已取消。'); releaseSeconds = .35; }
    const now = performance.now();
    if (restartArmedUntil > now) {
      cancelRestart();
      return invoke('重新开始', onRestart);
    }
    restartArmedUntil = now + 4000;
    restartButton.textContent = '确认重新开始';
    setStatus(restartPrompt);
  });
  button(actions, '保存截图', () => invoke('截图', onCapture));
  if (typeof onToggleLOD === 'function') {
    // Deliberately do not use invoke(): an A/B toggle must not release movement
    // input, change camera/player state, or restart the current timed command.
    lodButton = button(actions, '岩石 LOD：—', async () => {
      if (lodButton.disabled) return;
      lodButton.disabled = true;
      try {
        const enabled = await onToggleLOD();
        if (disposed) return;
        if (typeof enabled !== 'boolean') throw new TypeError('LOD 回调需返回实际开关状态。');
        lastLodEnabled = enabled;
        const state = readState();
        render({...state, rockLOD: {...state.rockLOD, enabled}});
        const message = `岩石 LOD 已${enabled ? '开启' : '关闭'} · 同镜头对照`;
        setStatus(message); addLog(message);
      } catch (error) {
        if (!disposed) { const message = 'LOD 切换失败：' + (error?.message || String(error)); setStatus(message); addLog(message); }
      } finally { if (!disposed) lodButton.disabled = false; }
    });
    lodButton.id = 'qa-toggle-rock-lod';
  }

  if (typeof onToggleShadow === 'function') {
    shadowButton = button(actions, '阴影：—', async () => {
      if (shadowButton.disabled) return;
      shadowButton.disabled = true;
      try {
        const resolution = await onToggleShadow();
        if (!disposed) {
          render({...readState(), shadowResolution: resolution});
          const message = `阴影分辨率 ${resolution} · 同镜头对照`;
          setStatus(message); addLog(message);
        }
      } catch (error) {
        if (!disposed) setStatus('阴影切换失败：' + error.message);
      } finally { if (!disposed) shadowButton.disabled = false; }
    });
  }

  const renderControls=[];
  for (const toggle of renderToggles) {
    if (typeof toggle.read !== 'function' || typeof toggle.toggle !== 'function') continue;
    const label = () => `${toggle.label}：${toggle.read() ? '开' : '关'}`;
    const control = button(actions, label(), async () => {
      control.disabled = true;
      try {
        await toggle.toggle();
        if (!disposed) { control.textContent = label(); setStatus(label() + ' · 同镜头对照'); }
      } finally { if (!disposed) control.disabled = false; }
    });
    renderControls.push(()=>{control.textContent=label();});
  }

  function render(state) {
    syncModal(state);renderControls.forEach(refresh=>refresh());
    const p = positionOf(state), actor = state.player || {}, game = state.game || {};
    values.position.textContent = p?.every(Number.isFinite)
      ? `X ${p[0].toFixed(2)}  Y ${p[1].toFixed(2)}  Z ${p[2].toFixed(2)}` : '尚未取得坐标';
    const paused = !!(state.paused || actor.paused || state.interactionBusy || state.uiModalActive);
    values.motion.textContent = `${actor.locomotion || '—'} · ${Number.isFinite(actor.speed) ? actor.speed.toFixed(2) : '—'} m/s${paused ? ' · 游戏暂停中' : ''}`;
    values.target.textContent = labelOf(state.objective || state.target);
    const completed = game.completed ?? state.awakened ?? state.completed;
    const list = completed instanceof Set ? [...completed] : completed;
    values.awakened.textContent = Array.isArray(list) ? (list.length ? list.map(labelOf).join('、') : '暂无') : labelOf(list);
    values.interaction.textContent = labelOf(state.selected || state.interaction);
    const lamp = game.lamp || state.lamp;
    values.lamp.textContent = lamp ? [lamp.location, lamp.socketId].filter(Boolean).join(' · ') || labelOf(lamp) : '—';
    const fps = Number.isFinite(state.fps) ? state.fps : measuredFPS;
    values.fps.textContent = fps > 0 ? `${fps.toFixed(1)} FPS` : '采样中';
    const number = value => Number.isFinite(value) ? Math.round(value).toLocaleString('zh-CN') : '—';
    values.renderStats.textContent = `${number(state.drawCalls)} 批次 · ${number(state.triangles)} 三角形`;
    const lod = state.rockLOD || {}, lodEnabled = typeof lod.enabled === 'boolean' ? lod.enabled : lastLodEnabled;
    const lodLabel = typeof lodEnabled === 'boolean' ? lodEnabled ? '开' : '关' : '—';
    values.rockLod.textContent = `${lodLabel} · ${number(lod.batches)} 批次`;
    values.rockTiers.textContent = Array.isArray(lod.tiers)
      ? `近 ${number(lod.tiers[0])} / 中 ${number(lod.tiers[1])} / 远 ${number(lod.tiers[2])}` : '—';
    values.rockBudget.textContent = `${number(lod.triangleBudget)} / 原版 ${number(lod.originalTriangles)} 三角形`;
    if (lodButton) { lodButton.textContent = `岩石 LOD：${lodLabel}`; lodButton.setAttribute('aria-pressed', String(lodEnabled === true)); }
    if (shadowButton) shadowButton.textContent = `阴影：${state.shadowResolution || '—'}`;
    const routeState = route.snapshot(), routeRunning = routeState.status === 'running';
    values.command.textContent = routeOwnsInput ? '由回归路线提供真实输入' : job ? `${job.name} ${job.elapsed.toFixed(2)} / ${job.duration.toFixed(2)} 秒${paused ? '（计时暂停）' : ''}` : releaseSeconds > 0 ? '释放按键，等待控制器减速' : '无定时输入';
    values.route.textContent = routeState.status === 'idle' ? '尚未开始' : routeRunning
      ? `第 ${routeState.index+1} / ${routeState.totalSteps} 步 · ${routeState.elapsed.toFixed(1)} 秒${routeState.paused ? '（暂停）' : ''}`
      : routeState.message;
    progress.value = routeRunning ? routeState.index / routeState.totalSteps : job ? Math.min(1, job.elapsed / job.duration) : 0;
    summary.textContent = `QA 实机测试 · ${routeRunning ? paused ? '路线暂停' : `路线 ${routeState.index+1}/${routeState.totalSteps}` : job ? paused ? '暂停计时' : '执行中' : '待命'}`;
  }

  // Typing into a QA field must not trigger the game's WASD/M/E/C shortcuts.
  const preventGameKeys = event => { event.stopPropagation(); if (event.code === 'Escape') { cancelRestart(); stop(); } };
  shadow.addEventListener('keydown', preventGameKeys);
  // A menu can open between animation frames. Reject a stale QA hit before any
  // button handler runs, including the destructive restart callback.
  shadow.addEventListener('click', event => {
    if (!disposed && syncModal(readState())) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  panel.addEventListener('toggle', () => { if (!panel.open) cancelRestart(); });
  shadow.addEventListener('wheel', event => event.stopPropagation(), {passive: true});
  const onVisibility = () => { if (document.hidden && job) stop('页面已隐藏，定时输入已释放。'); };
  document.addEventListener('visibilitychange', onVisibility);

  function update(dt) {
    if (disposed) return null;
    const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
    lastState = readState();
    syncModal(lastState);
    const now = performance.now(); measuredFrames++;
    if (restartArmedUntil && now >= restartArmedUntil) cancelRestart();
    if (now - fpsSince >= 750) { measuredFPS = measuredFrames * 1000 / (now - fpsSince); measuredFrames = 0; fpsSince = now; }
    const paused = !!(lastState.paused || lastState.player?.paused || lastState.interactionBusy || lastState.uiModalActive);
    let output = null;
    if (routeOwnsInput) {
      // Exactly one input owner: neither a previous timed job nor its release
      // window is allowed to win over the driver's neutral or movement input.
      job = null; releaseSeconds = 0;
      if (routeLeadIn > 0) {
        output = neutral(); if (!paused) routeLeadIn = Math.max(0,routeLeadIn-delta);
      } else {
        output = route.update(delta);
        const state = route.snapshot(), key = `${state.status}:${state.index}:${state.reason}`;
        if (key !== routeAnnouncement) {
          routeAnnouncement = key; setStatus(state.status === 'running' ? `路线第 ${state.index+1} / ${state.totalSteps} 步：${state.step.type}` : state.message);
          if (state.status !== 'running') addLog(state.message);
        }
        if (output === null) routeOwnsInput = false;
      }
      uiSeconds += delta;
      if (uiSeconds >= .1 || !delta) { render(lastState); uiSeconds = 0; }
      return output;
    }
    if (job && job.elapsed >= job.duration - 1e-8) {
      const end = positionOf(lastState), startPosition = job.startPosition;
      const moved = end && startPosition ? Math.hypot(end[0] - startPosition[0], end[2] - startPosition[2]) : null;
      const message = `${job.name}结束 · 实际 ${job.elapsed.toFixed(2)} 秒${moved !== null ? ` · 水平位移 ${moved.toFixed(2)} 米` : ''}`;
      job = null; releaseSeconds = 0.35; setStatus(message); addLog(message);
    }
    if (job) {
      if (paused) output = neutral();
      else {
        output = {forward: job.forward, strafe: job.strafe, run: job.run,
          jump: job.jump && !job.jumpSent, cameraYaw: job.yaw};
        if (delta > 0) { job.elapsed += delta; job.jumpSent = true; }
      }
    } else if (releaseSeconds > 0) {
      output = neutral(); releaseSeconds = Math.max(0, releaseSeconds - delta);
    }
    uiSeconds += delta;
    if (uiSeconds >= 0.1 || !delta) { render(lastState); uiSeconds = 0; }
    return output;
  }

  render(readState());
  return {
    enabled: true, update,snapshot:()=>({route:route.snapshot(),timedInput:job?{name:job.name,elapsed:job.elapsed,duration:job.duration}:null}),
    dispose() {
      if (disposed) return;
      disposed = true; job = null; releaseSeconds = 0; cancelRestart(); route.dispose();
      document.removeEventListener('visibilitychange', onVisibility);
      host.remove();
    },
  };
}
