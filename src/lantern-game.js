// Pure game rules. This module has no renderer, storage, network or browser API.
// Coordinates describe feet/interaction points; all distances are world metres.

export const LANTERN_SAVE_VERSION = 1;

export const DEFAULT_LANTERN_DATA = {
  id: 'sands-lantern-v1',
  interactionDistance: 3,
  chargeSeconds: 2,
  maxStepSeconds: 0.25,
  beamDistance: 85,
  spawn: [-37, 0, 35],
  lamp: { id: 'lantern', position: [-37, 0, 29] },
  npc: { id: 'keeper', position: [-31, 0, 31], name: '守灯人' },
  areas: [
    {
      id: 'temple', name: '风蚀神庙', entry: [-37, 1.5, 24],
      carryingObjective: '把提灯放进神庙前的聚光座。',
      sockets: [{ id: 'temple-socket', position: [-37, 1.5, 19], aimAt: 'temple-terminal' }],
      mirrors: [],
      terminal: { id: 'temple-terminal', position: [-37, 8, 10], radius: 0.8 },
      gate: { id: 'temple-gate', position: [-37, 2.3, 11] },
      blockers: [],
    },
    {
      id: 'city', name: '碑下旧城', entry: [18, 1.2, -66],
      carryingObjective: '沿神庙外的石板路，前往巨碑下的旧城。',
      sockets: [
        { id: 'city-socket-low', position: [18, 4.1, -72], aimAt: 'city-mirror' },
        { id: 'city-socket-high', position: [22, 7.6, -78], aimAt: 'city-mirror' },
      ],
      mirrors: [{
        id: 'city-mirror', position: [18, 9, -84], radius: 0.8, initialTurn: 0,
        directions: [[-1, 0.12, 0], { aimAt: 'city-terminal' }, [1, -0.2, 0]],
      }],
      terminal: { id: 'city-terminal', position: [30, 19, -94], radius: 0.95 },
      gate: { id: 'city-gate', position: [18, 12, -91] },
      blockers: [
        { id: 'city-fallen-column', min: [16.5, 3, -80], max: [19.5, 8, -77] },
        { id: 'city-left-wall', min: [-7, 5, -92], max: [-5, 17, -75] },
        { id: 'city-right-wall', min: [39, 0, -91], max: [41, 18, -72] },
      ],
    },
    {
      id: 'oasis', name: '峡谷绿洲', entry: [25, 0.2, 27],
      carryingObjective: '沿沙路前往峡谷绿洲。',
      sockets: [{ id: 'oasis-socket', position: [25, 1.7, 27], aimAt: 'oasis-mirror-west' }],
      mirrors: [
        { id: 'oasis-mirror-west', position: [22, 2, 15], radius: 0.8, initialTurn: 0,
          directions: [[-1, 0, 0], [0, 0.4, -1], { aimAt: 'oasis-mirror-east' }] },
        { id: 'oasis-mirror-east', position: [64, 3.5, 28], radius: 0.8, initialTurn: 0,
          directions: [[1, 0, -0.3], { aimAt: 'oasis-terminal' }, [0, 0.2, 1]] },
      ],
      terminal: { id: 'oasis-terminal', position: [50, 16, -32], radius: 1 },
      gate: { id: 'oasis-gate', position: [27, 1, 20] },
      blockers: [
        { id: 'oasis-west-rock', min: [15, 0, 10], max: [19, 8, 21] },
        { id: 'oasis-canyon-wall', min: [78, 0, -8], max: [85, 35, 25] },
        { id: 'oasis-north-rock', min: [27, 0, -6], max: [33, 15, 0] },
      ],
    },
  ],
};

const clone = value => JSON.parse(JSON.stringify(value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const finiteVector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const toVector = v => finiteVector(v) ? [...v]
  : v && ['x', 'y', 'z'].every(k => Number.isFinite(v[k])) ? [v.x, v.y, v.z] : null;
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, n) => a.map(v => v * n);
const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
const length = v => Math.hypot(...v);
const distance = (a, b) => length(sub(a, b));
const unit = v => scale(v, 1 / length(v));
const safeId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id)
  && !['__proto__', 'constructor', 'prototype'].includes(id);

function prepareData(overrides = {}) {
  const data = clone({ ...DEFAULT_LANTERN_DATA, ...overrides });
  const fail = message => { throw new TypeError(`Invalid lantern data: ${message}`); };
  if (!safeId(data.id)) fail('id');
  if (!finiteVector(data.spawn)) fail('spawn');
  for (const key of ['interactionDistance', 'chargeSeconds', 'maxStepSeconds', 'beamDistance']) {
    if (!Number.isFinite(data[key]) || data[key] <= 0) fail(key);
  }
  if (!Array.isArray(data.areas) || data.areas.length === 0) fail('areas');
  const ids = new Set(), objects = new Map();
  const checkId = id => { if (!safeId(id) || ids.has(id)) fail(`duplicate/invalid id: ${id}`); ids.add(id); };
  const checkObject = (object, type) => {
    if (!object || !finiteVector(object.position)) fail(`${type} position`);
    checkId(object.id);
    objects.set(object.id, object);
    if (object.interactionDistance !== undefined && (!Number.isFinite(object.interactionDistance) || object.interactionDistance <= 0)) fail(`${object.id} interactionDistance`);
  };
  const checkDirection = (direction, id) => {
    if (!finiteVector(direction) || length(direction) < 1e-6) fail(`${id} direction`);
  };
  checkObject(data.lamp, 'lamp');
  if (data.npc) checkObject(data.npc, 'npc');
  for (const area of data.areas) {
    checkId(area.id);
    if (!finiteVector(area.entry)) fail(`${area.id} entry`);
    if (!Array.isArray(area.sockets) || !area.sockets.length || !Array.isArray(area.mirrors)) fail(`${area.id} sockets/mirrors`);
    for (const socket of area.sockets) {
      checkObject(socket, 'socket');
      if (!socket.aimAt) checkDirection(socket.direction, socket.id);
      if (socket.beamOrigin !== undefined && !finiteVector(socket.beamOrigin)) fail(`${socket.id} beamOrigin`);
    }
    for (const mirror of area.mirrors) {
      checkObject(mirror, 'mirror');
      if (!Array.isArray(mirror.directions) || mirror.directions.length !== 3) fail(`${mirror.id} needs three directions`);
      mirror.directions.forEach(d => { if (!d?.aimAt) checkDirection(d, mirror.id); });
      mirror.initialTurn ??= 0;
      if (![0, 1, 2].includes(mirror.initialTurn)) fail(`${mirror.id} initialTurn`);
      mirror.radius ??= 0.7;
      if (!Number.isFinite(mirror.radius) || mirror.radius <= 0) fail(`${mirror.id} radius`);
    }
    checkObject(area.terminal, 'terminal');
    area.terminal.radius ??= 0.8;
    if (!Number.isFinite(area.terminal.radius) || area.terminal.radius <= 0) fail(`${area.terminal.id} radius`);
    if (area.gate) checkObject(area.gate, 'gate');
    area.blockers ??= [];
    if (!Array.isArray(area.blockers)) fail(`${area.id} blockers`);
    for (const blocker of area.blockers) {
      checkId(blocker.id);
      if (!finiteVector(blocker.min) || !finiteVector(blocker.max) || blocker.min.some((v, i) => v >= blocker.max[i])) fail(`${blocker.id} bounds`);
    }
  }
  const resolveAim = (source, targetId) => {
    const target = objects.get(targetId);
    if (!target || target === source) fail(`${source.id} aimAt target`);
    const direction = sub(target.position, source.beamOrigin || source.position);
    checkDirection(direction, source.id);
    return direction;
  };
  for (const area of data.areas) {
    for (const socket of area.sockets) if (socket.aimAt) socket.direction = resolveAim(socket, socket.aimAt);
    for (const mirror of area.mirrors) mirror.directions = mirror.directions.map(d => d.aimAt ? resolveAim(mirror, d.aimAt) : d);
  }
  return data;
}

function initialState(data) {
  return {
    completed: [],
    lamp: { location: 'ground', socketId: null },
    hasPickedUp: false,
    mirrorTurns: Object.fromEntries(data.areas.flatMap(a => a.mirrors.map(m => [m.id, m.initialTurn]))),
    chargeSeconds: Object.fromEntries(data.areas.map(a => [a.id, 0])),
    playerPosition: [...data.spawn],
  };
}

function gateStates(data, completed) {
  return Object.fromEntries(data.areas.filter(a => a.gate).map(a => [a.gate.id, completed.includes(a.id) ? 'open' : 'closed']));
}

function validateSnapshot(saved, data) {
  const errors = [];
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { valid: false, errors: ['snapshot is not an object'] };
  if (saved.version !== LANTERN_SAVE_VERSION || saved.dataId !== data.id) errors.push('incompatible version/dataId');
  if (!Array.isArray(saved.completed) || saved.completed.length > data.areas.length
    || saved.completed.some((id, index) => id !== data.areas[index]?.id)) errors.push('completed areas must be an ordered prefix');
  if (!finiteVector(saved.playerPosition)) errors.push('invalid player position');
  if (typeof saved.hasPickedUp !== 'boolean') errors.push('invalid pickup state');
  const mirrorIds = data.areas.flatMap(a => a.mirrors.map(m => m.id));
  if (!saved.mirrorTurns || typeof saved.mirrorTurns !== 'object' || Array.isArray(saved.mirrorTurns)
    || Object.keys(saved.mirrorTurns).length !== mirrorIds.length
    || mirrorIds.some(id => !own(saved.mirrorTurns, id) || ![0, 1, 2].includes(saved.mirrorTurns[id]))) errors.push('invalid mirror turns');
  const lamp = saved.lamp;
  if (!lamp || !['ground', 'player', 'socket'].includes(lamp.location)) errors.push('invalid lamp location');
  else if (lamp.location === 'socket') {
    const areaIndex = data.areas.findIndex(a => a.sockets.some(s => s.id === lamp.socketId));
    if (areaIndex < 0 || areaIndex > (Array.isArray(saved.completed) ? saved.completed.length : 0)) errors.push('lamp is in an unknown or locked socket');
    if (!saved.hasPickedUp) errors.push('docked lamp was never picked up');
  } else {
    if (lamp.socketId !== null) errors.push('undocked lamp has a socket');
    if (lamp.location === 'player' && !saved.hasPickedUp) errors.push('carried lamp was never picked up');
    if (lamp.location === 'ground' && (saved.hasPickedUp || saved.completed?.length)) errors.push('used lamp cannot return to its initial ground state');
  }
  if (Array.isArray(saved.completed)) {
    const expectedGates = gateStates(data, saved.completed);
    if (!saved.gates || typeof saved.gates !== 'object' || Array.isArray(saved.gates)
      || Object.keys(saved.gates).length !== Object.keys(expectedGates).length
      || Object.entries(expectedGates).some(([id, state]) => saved.gates[id] !== state)) errors.push('gate states disagree with completed areas');
    if (saved.completed.length && !saved.hasPickedUp) errors.push('completed areas require the lantern');
  }
  return { valid: errors.length === 0, errors };
}

/** Validate an untrusted, parsed local snapshot without mutating it. */
export function validateLanternSnapshot(saved, data = {}) {
  return validateSnapshot(saved, prepareData(data));
}

function hitSphere(origin, direction, center, radius) {
  const offset = sub(origin, center), b = dot(offset, direction), c = dot(offset, offset) - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const near = -b - Math.sqrt(discriminant), far = -b + Math.sqrt(discriminant);
  return near > 0.0001 ? near : far > 0.0001 ? far : null;
}

function hitBox(origin, direction, min, max) {
  let near = -Infinity, far = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(direction[i]) < 1e-8) {
      if (origin[i] < min[i] || origin[i] > max[i]) return null;
      continue;
    }
    const a = (min[i] - origin[i]) / direction[i], b = (max[i] - origin[i]) / direction[i];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return null;
  }
  return far < 0.0001 ? null : Math.max(0, near);
}

/** A ray is traced against real configured positions, never against an angle password. */
function traceBeam(data, state) {
  if (state.lamp.location !== 'socket') return [];
  const area = data.areas.find(a => a.sockets.some(s => s.id === state.lamp.socketId));
  if (!area) return [];
  const socket = area.sockets.find(s => s.id === state.lamp.socketId);
  let origin = [...(socket.beamOrigin || socket.position)], direction = unit(socket.direction), previous = null;
  const segments = [], visited = new Set();
  let terminalLit = false, cycle = false;
  for (let bounce = 0; bounce <= area.mirrors.length + 1; bounce++) {
    let closest = { distance: data.beamDistance, type: 'air', id: null, object: null };
    const consider = (d, type, object) => {
      if (d !== null && d <= closest.distance) closest = { distance: d, type, id: object.id, object };
    };
    for (const blocker of area.blockers) consider(hitBox(origin, direction, blocker.min, blocker.max), 'blocker', blocker);
    for (const mirror of area.mirrors) if (mirror.id !== previous) consider(hitSphere(origin, direction, mirror.position, mirror.radius), 'mirror', mirror);
    consider(hitSphere(origin, direction, area.terminal.position, area.terminal.radius), 'terminal', area.terminal);
    const end = closest.type === 'mirror' || closest.type === 'terminal'
      ? [...closest.object.position] : add(origin, scale(direction, closest.distance));
    segments.push({ from: [...origin], to: end, hitType: closest.type, hitId: closest.id });
    if (closest.type === 'terminal') { terminalLit = true; break; }
    if (closest.type !== 'mirror') break;
    if (visited.has(closest.id)) { cycle = true; break; }
    visited.add(closest.id);
    previous = closest.id;
    origin = [...closest.object.position];
    direction = unit(closest.object.directions[state.mirrorTurns[closest.id]]);
  }
  return [{ areaId: area.id, socketId: socket.id, segments, terminalLit, cycle }];
}

/**
 * onEvent receives {type, sequence, at, ...details}. No event contains live state.
 * update consumes simulation seconds, capped at maxStepSeconds to avoid charging
 * while a suspended tab was not actually running. Persist snapshot(), not state.
 * Changing spatial data is supported; use a new data.id after changing rule IDs.
 */
export function createLanternGame({ saved, onEvent = () => {}, now = Date.now, data: overrides = {} } = {}) {
  const data = prepareData(overrides);
  let state = initialState(data), sequence = 0, restoreStatus = saved == null ? 'new' : 'restored';
  const restoration = saved == null ? { valid: true, errors: [] } : validateSnapshot(saved, data);
  if (restoration.valid && saved != null) {
    state = { ...state, completed: [...saved.completed], lamp: { location: saved.lamp.location, socketId: saved.lamp.socketId },
      hasPickedUp: saved.hasPickedUp, mirrorTurns: { ...saved.mirrorTurns }, playerPosition: [...saved.playerPosition] };
    for (const id of state.completed) state.chargeSeconds[id] = data.chargeSeconds;
  } else if (!restoration.valid) restoreStatus = 'rejected';
  let restorationPending = restoreStatus === 'rejected';
  let lastObjective = null, suggestedSocketId = null;

  const emit = (type, details = {}) => onEvent({ type, sequence: ++sequence, at: now(), ...clone(details) });
  const currentIndex = () => state.completed.length;
  const currentArea = () => data.areas[currentIndex()] || null;
  const areaUnlocked = area => data.areas.indexOf(area) <= currentIndex();
  const findSocket = id => data.areas.flatMap(a => a.sockets).find(s => s.id === id);
  const lampPosition = () => state.lamp.location === 'ground' ? [...data.lamp.position]
    : state.lamp.location === 'socket' ? [...findSocket(state.lamp.socketId).position]
      : add(state.playerPosition, [0.32, 1.1, 0.15]);
  const getObjective = () => {
    const area = currentArea();
    if (!state.hasPickedUp) return { text: '提起地上的灯。', targetId: data.lamp.id, areaId: data.areas[0].id, kind: 'pickup' };
    if (!area) return { text: '沙海已苏醒，继续探索这座遗城。', targetId: null, areaId: null, kind: 'complete' };
    if (state.lamp.location === 'socket') {
      const path = traceBeam(data, state)[0];
      if (path.areaId !== area.id) return { text: area.id === 'oasis' && path.areaId === 'city'
        ? '取回提灯，再沿台阶下行前往绿洲。' : `取回提灯，前往${area.name}。`,
        targetId: state.lamp.socketId, areaId: area.id, kind: 'retrieve' };
      if (path.terminalLit) return { text: '保持光照，等待遗迹苏醒。', targetId: area.terminal.id, areaId: area.id, kind: 'charging' };
      const firstHit = path.segments[0];
      if (firstHit.hitType === 'blocker') return { text: '光被挡住了。取回提灯，试试另一座聚光座。', targetId: state.lamp.socketId, areaId: area.id, kind: 'blocked' };
      const mirrorHits = path.segments.filter(segment => segment.hitType === 'mirror');
      const lastMirror = area.mirrors.find(mirror => mirror.id === mirrorHits.at(-1)?.hitId);
      const acrossWater = area.id === 'oasis' && mirrorHits.length > 1 && lastMirror
        && distance(state.playerPosition, lastMirror.position) > (lastMirror.interactionDistance || data.interactionDistance);
      const firstOasisMirror = area.id === 'oasis' && mirrorHits.length === 1 && lastMirror?.id === 'oasis-mirror-west';
      return { text: acrossWater ? '光已越过水面。沿岸走到另一面光镜旁。'
        : firstOasisMirror ? '转动这面光镜，让光照到水边的另一面光镜。' : '转动光镜，将光送向晶体。',
        targetId: lastMirror?.id || state.lamp.socketId, areaId: area.id, kind: 'align' };
    }
    const nearby = distance(state.playerPosition, area.entry) < 35;
    const city = data.areas.find(candidate => candidate.id === 'city');
    const leavingCity = area.id === 'oasis' && city && distance(state.playerPosition, city.entry) < 65;
    const suggestedSocket = area.sockets.find(socket => socket.id === suggestedSocketId);
    const carryingText = suggestedSocket && nearby ? '沿台阶向上，把提灯放进另一座聚光座。'
      : area.id === 'city' && nearby ? '把提灯放进聚光座，观察光的去向。'
      : area.id === 'oasis' && nearby ? '把提灯放进水边的聚光座。'
        : leavingCity ? '沿旧城台阶下行，向南前往峡谷绿洲。' : area.carryingObjective;
    return { text: carryingText || `带着提灯，点亮${area.name}的聚光座。`, targetId: (suggestedSocket || area.sockets[0]).id, areaId: area.id, kind: 'carry' };
  };
  const publishObjective = () => {
    const objective = getObjective(), serialized = JSON.stringify(objective);
    if (serialized !== lastObjective) { lastObjective = serialized; emit('objective-changed', { objective }); }
  };
  const publicState = () => ({ ...clone(state), lamp: { ...state.lamp, position: lampPosition() },
    currentArea: currentArea()?.id || null, complete: currentIndex() === data.areas.length,
    gates: gateStates(data, state.completed), restoreStatus, restoreErrors: [...restoration.errors],
    chargeProgress: Object.fromEntries(data.areas.map(a => [a.id, state.chargeSeconds[a.id] / data.chargeSeconds])) });
  const snapshot = () => ({ version: LANTERN_SAVE_VERSION, dataId: data.id,
    completed: [...state.completed], lamp: { ...state.lamp }, hasPickedUp: state.hasPickedUp,
    mirrorTurns: { ...state.mirrorTurns }, playerPosition: [...state.playerPosition], gates: gateStates(data, state.completed) });
  const getInteractables = () => {
    const chargingSocketId = traceBeam(data, state).find(path => path.areaId === currentArea()?.id && path.terminalLit)?.socketId;
    const list = [], addItem = (object, kind, label, enabled, areaId = null) => {
      const d = distance(state.playerPosition, object.position), reach = object.interactionDistance || data.interactionDistance;
      list.push({ id: object.id, kind, areaId, position: [...object.position], label, enabled,
        distance: d, interactionDistance: reach, inRange: d <= reach });
    };
    if (state.lamp.location === 'ground') addItem(data.lamp, 'lamp', '提起提灯', true);
    if (data.npc) addItem(data.npc, 'npc', '听守灯人说话', true);
    for (const area of data.areas) {
      for (const socket of area.sockets) {
        const occupied = state.lamp.location === 'socket' && state.lamp.socketId === socket.id;
        addItem(socket, 'socket', occupied ? socket.id === chargingSocketId ? '取回并中断' : '取回提灯'
          : state.lamp.location === 'player' ? '放入提灯' : '需要提灯',
          areaUnlocked(area) && (occupied || state.lamp.location === 'player'), area.id);
      }
      const completed = state.completed.includes(area.id);
      for (const mirror of area.mirrors) addItem(mirror, 'mirror', completed ? '遗迹已苏醒' : '转动光镜', areaUnlocked(area) && !completed, area.id);
    }
    return list;
  };
  const interruptCharge = () => {
    const area = currentArea();
    if (area && state.chargeSeconds[area.id] > 0 && !traceBeam(data, state).some(p => p.areaId === area.id && p.terminalLit)) {
      const previousSeconds = state.chargeSeconds[area.id];
      state.chargeSeconds[area.id] = 0;
      emit('charge-interrupted', { areaId: area.id, previousSeconds });
    }
  };
  const reject = (id, reason) => { emit('interaction-rejected', { id, reason }); return { ok: false, reason }; };
  const interact = id => {
    const item = getInteractables().find(i => i.id === id);
    if (!item) return reject(id, 'unknown-target');
    if (!item.inRange) return reject(id, 'too-far');
    if (item.kind === 'mirror' && state.completed.includes(item.areaId)) return reject(id, 'area-completed');
    if (!item.enabled) return reject(id, item.areaId && !areaUnlocked(data.areas.find(a => a.id === item.areaId)) ? 'area-locked' : 'lantern-required');
    if (item.kind === 'npc') {
      emit('npc-spoke', { id, text: !currentArea() ? '石头又记起了光。你可以慢慢走。' : !state.hasPickedUp
        ? '带上这盏灯。把它放进神庙前的聚光座，沉睡的门就会醒来。'
        : '光会告诉你哪里被挡住了。看着它落下的地方。' });
      return { ok: true, action: 'talk' };
    }
    if (item.kind === 'lamp' || (item.kind === 'socket' && state.lamp.socketId === id)) {
      const previousSocketId = state.lamp.socketId;
      // Remember only an obstruction the player actually revealed. This is a
      // current-goal hint, not a new rule, saved puzzle flag, or automatic move.
      const previousBeam = previousSocketId ? traceBeam(data, state)[0] : null;
      const area = currentArea();
      if (previousBeam?.areaId === area?.id && previousBeam.segments[0]?.hitType === 'blocker') {
        suggestedSocketId = area.sockets.find(socket => socket.id !== previousSocketId)?.id || null;
      }
      state.lamp = { location: 'player', socketId: null };
      state.hasPickedUp = true;
      emit('lamp-picked-up', { id: data.lamp.id, previousSocketId, areaId: item.areaId });
    } else if (item.kind === 'socket') {
      state.lamp = { location: 'socket', socketId: id };
      emit('lamp-docked', { socketId: id, areaId: item.areaId });
    } else if (item.kind === 'mirror') {
      state.mirrorTurns[id] = (state.mirrorTurns[id] + 1) % 3;
      emit('mirror-rotated', { mirrorId: id, areaId: item.areaId, turn: state.mirrorTurns[id] });
    }
    interruptCharge();
    emit('beam-changed', { paths: traceBeam(data, state) });
    publishObjective();
    return { ok: true, action: item.kind === 'mirror' ? 'rotate' : state.lamp.location === 'socket' ? 'dock' : 'pickup' };
  };
  const update = (dt, position) => {
    if (restorationPending) { restorationPending = false; emit('save-rejected', { reasons: restoration.errors }); }
    if (position !== undefined) {
      const next = toVector(position);
      if (next) state.playerPosition = next;
      else emit('position-rejected', { reason: 'non-finite-position' });
    }
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, data.maxStepSeconds) : 0;
    const area = currentArea();
    if (area) {
      const lit = traceBeam(data, state).some(p => p.areaId === area.id && p.terminalLit);
      if (lit && step > 0) {
        state.chargeSeconds[area.id] = Math.min(data.chargeSeconds, state.chargeSeconds[area.id] + step);
        emit('charge-progress', { areaId: area.id, seconds: state.chargeSeconds[area.id], progress: state.chargeSeconds[area.id] / data.chargeSeconds });
        if (state.chargeSeconds[area.id] >= data.chargeSeconds - 1e-9) {
          state.chargeSeconds[area.id] = data.chargeSeconds;
          state.completed.push(area.id);
          emit('area-completed', { areaId: area.id, terminalId: area.terminal.id, gateId: area.gate?.id || null,
            nextAreaId: currentArea()?.id || null });
          if (!currentArea()) emit('game-completed', { completed: [...state.completed] });
        }
      } else if (!lit) interruptCharge();
    }
    publishObjective();
    return publicState();
  };
  const recover = () => {
    const area = currentArea() || data.areas.at(-1);
    state.playerPosition = state.hasPickedUp ? [...area.entry] : [...data.spawn];
    state.lamp = { location: state.hasPickedUp ? 'player' : 'ground', socketId: null };
    interruptCharge();
    emit('recovered', { areaId: area.id, position: state.playerPosition, lamp: state.lamp });
    emit('beam-changed', { paths: [] });
    publishObjective();
    return publicState();
  };
  const reset = () => {
    state = initialState(data); restoreStatus = 'new'; restorationPending = false; suggestedSocketId = null;
    emit('reset', { position: state.playerPosition });
    emit('beam-changed', { paths: [] });
    publishObjective();
    return publicState();
  };
  return { get state() { return publicState(); }, get data() { return clone(data); },
    getInteractables, getBeamPaths: () => traceBeam(data, state), getObjective,
    update, interact, snapshot, reset, recover };
}
