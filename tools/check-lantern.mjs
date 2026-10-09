import assert from 'node:assert/strict';
import { createLanternGame, DEFAULT_LANTERN_DATA, validateLanternSnapshot } from '../src/lantern-game.js';

const copy = value => JSON.parse(JSON.stringify(value));
let checks = 0;
const check = (name, run) => {
  run(); checks++;
  console.log(`PASS ${name}`);
};
const moveTo = (game, id) => {
  const item = game.getInteractables().find(i => i.id === id);
  assert.ok(item, `missing interactable ${id}`);
  game.update(0, item.position);
};
const use = (game, id) => {
  moveTo(game, id);
  assert.equal(game.interact(id).ok, true, `cannot use ${id}`);
};
const tick = (game, seconds) => {
  for (let remaining = seconds; remaining > 1e-8; remaining -= 0.05) game.update(Math.min(0.05, remaining));
};
const templeComplete = game => {
  use(game, 'lantern');
  use(game, 'temple-socket');
  tick(game, 2);
  assert.deepEqual(game.state.completed, ['temple']);
};

check('opening objective, unique lamp and copied state', () => {
  const game = createLanternGame();
  assert.equal(game.getObjective().text, '提起地上的灯。');
  assert.deepEqual(game.state.playerPosition, [-37, 0, 35]);
  assert.equal(game.state.lamp.location, 'ground');
  const outsider = game.state;
  outsider.lamp.location = 'socket';
  outsider.completed.push('oasis');
  assert.equal(game.state.lamp.location, 'ground');
  assert.deepEqual(game.state.completed, []);
  use(game, 'lantern');
  assert.equal(game.getInteractables().filter(i => i.kind === 'lamp').length, 0);
  assert.equal(game.interact('lantern').reason, 'unknown-target');
  assert.equal(game.state.lamp.location, 'player');
});

check('distance and stage gates are enforced by the rules', () => {
  const game = createLanternGame();
  assert.equal(game.interact('lantern').reason, 'too-far');
  moveTo(game, 'temple-socket');
  assert.equal(game.interact('temple-socket').reason, 'lantern-required');
  moveTo(game, 'city-mirror');
  assert.equal(game.interact('city-mirror').reason, 'area-locked');
  const position = game.state.playerPosition;
  game.update(0, [NaN, 0, 0]);
  assert.deepEqual(game.state.playerPosition, position);
});

check('temple requires uninterrupted real simulation time', () => {
  const events = [], game = createLanternGame({ onEvent: event => events.push(event), now: () => 1000 });
  use(game, 'lantern'); use(game, 'temple-socket');
  assert.equal(game.getBeamPaths()[0].terminalLit, true);
  assert.equal(game.getBeamPaths()[0].segments[0].hitId, 'temple-terminal');
  assert.equal(game.getObjective().text, '保持光照，等待遗迹苏醒。');
  assert.equal(game.getInteractables().find(item => item.id === 'temple-socket').label, '取回并中断');
  tick(game, 1);
  assert.equal(game.state.gates['temple-gate'], 'closed');
  use(game, 'temple-socket');
  assert.equal(game.state.chargeSeconds.temple, 0);
  assert.ok(events.some(e => e.type === 'charge-interrupted'));
  use(game, 'temple-socket');
  tick(game, 1.95);
  assert.deepEqual(game.state.completed, []);
  tick(game, 0.05);
  assert.equal(game.state.gates['temple-gate'], 'open');
  assert.equal(game.getInteractables().find(item => item.id === 'temple-socket').label, '取回提灯', 'completed light must not warn about cancelling saved progress');
  tick(game, 5);
  assert.equal(events.filter(e => e.type === 'area-completed').length, 1);
  assert.ok(events.every((e, index) => e.sequence === index + 1 && e.at === 1000));
  assert.equal(game.getObjective().kind, 'retrieve');
  use(game, 'temple-socket');
  assert.equal(game.state.gates['temple-gate'], 'open', 'removing the lantern must not close a completed gate');
  assert.equal(game.getObjective().text, '沿神庙外的石板路，前往巨碑下的旧城。');
});

check('suspended-tab and invalid delta cannot instantly complete a puzzle', () => {
  const game = createLanternGame();
  use(game, 'lantern'); use(game, 'temple-socket');
  game.update(600);
  assert.equal(game.state.chargeSeconds.temple, 0.25);
  game.update(Infinity); game.update(NaN); game.update(-1);
  assert.equal(game.state.chargeSeconds.temple, 0.25);
  assert.deepEqual(game.state.completed, []);
});

check('city wrong pedestal and mirror turns yield visible physical endpoints', () => {
  const game = createLanternGame(); templeComplete(game); use(game, 'temple-socket');
  use(game, 'city-socket-low');
  let path = game.getBeamPaths()[0];
  assert.equal(path.terminalLit, false);
  assert.equal(path.segments[0].hitType, 'blocker');
  assert.equal(path.segments[0].hitId, 'city-fallen-column');
  assert.equal(game.getObjective().kind, 'blocked');
  assert.equal(game.getInteractables().find(item => item.id === 'city-socket-low').label, '取回提灯', 'a blocked beam is not charging');
  tick(game, 3);
  assert.equal(game.state.chargeSeconds.city, 0);
  use(game, 'city-socket-low'); use(game, 'city-socket-high');
  path = game.getBeamPaths()[0];
  assert.equal(path.segments[0].hitId, 'city-mirror');
  assert.equal(path.segments[1].hitId, 'city-left-wall');
  use(game, 'city-mirror');
  assert.equal(game.getBeamPaths()[0].terminalLit, true);
  tick(game, 1);
  use(game, 'city-mirror');
  assert.equal(game.state.chargeSeconds.city, 0);
  assert.equal(game.getBeamPaths()[0].segments.at(-1).hitId, 'city-right-wall');
  use(game, 'city-mirror');
  assert.equal(game.state.mirrorTurns['city-mirror'], 0, 'three turns should wrap');
});

check('full game: direct beam, one mirror, two mirrors, one completion event', () => {
  const events = [], game = createLanternGame({ onEvent: event => events.push(event) });
  templeComplete(game); use(game, 'temple-socket');
  use(game, 'city-socket-high'); use(game, 'city-mirror'); tick(game, 2);
  assert.deepEqual(game.state.completed, ['temple', 'city']);
  assert.equal(game.getObjective().text, '取回提灯，再沿台阶下行前往绿洲。');
  assert.equal(game.getInteractables().find(item => item.id === 'city-mirror').enabled, false);
  assert.equal(game.interact('city-mirror').reason, 'area-completed', 'a stale UI selection must not undo a completed light path');
  assert.equal(game.state.mirrorTurns['city-mirror'], 1);
  assert.equal(game.getBeamPaths()[0].terminalLit, true);
  use(game, 'city-socket-high');
  assert.equal(game.getObjective().text, '沿旧城台阶下行，向南前往峡谷绿洲。');
  game.update(0, game.data.areas[0].entry);
  assert.equal(game.getObjective().text, '沿沙路前往峡谷绿洲。', 'returning to the temple must not falsely instruct the player to descend city stairs');
  game.update(0, game.data.areas[2].entry);
  assert.equal(game.getObjective().text, '把提灯放进水边的聚光座。');
  use(game, 'oasis-socket');
  assert.equal(game.getBeamPaths()[0].segments.at(-1).hitId, 'oasis-west-rock');
  assert.equal(game.getObjective().targetId, 'oasis-mirror-west');
  use(game, 'oasis-mirror-west'); use(game, 'oasis-mirror-west');
  assert.equal(game.getBeamPaths()[0].segments[1].hitId, 'oasis-mirror-east');
  assert.equal(game.getBeamPaths()[0].segments.at(-1).hitId, 'oasis-canyon-wall');
  assert.equal(game.getObjective().targetId, 'oasis-mirror-east', 'a correct first mirror must not remain the objective');
  assert.equal(game.getObjective().text, '光已越过水面。沿岸走到另一面光镜旁。');
  moveTo(game, 'oasis-mirror-east');
  assert.equal(game.getObjective().text, '转动光镜，将光送向晶体。');
  use(game, 'oasis-mirror-east');
  const path = game.getBeamPaths()[0];
  assert.equal(path.segments.length, 3);
  assert.equal(path.terminalLit, true);
  tick(game, 2); tick(game, 2);
  assert.equal(game.state.complete, true);
  assert.equal(game.state.currentArea, null);
  assert.ok(Object.values(game.state.gates).every(state => state === 'open'));
  assert.equal(events.filter(e => e.type === 'game-completed').length, 1);
  assert.equal(game.getObjective().kind, 'complete');
  assert.equal(game.getInteractables().filter(item => item.kind === 'mirror' && item.enabled).length, 0, 'finished mirrors must leave the default E candidates');
  assert.equal(game.interact('oasis-mirror-east').reason, 'area-completed');
  assert.equal(game.state.mirrorTurns['oasis-mirror-east'], 1);
  assert.equal(game.getBeamPaths()[0].terminalLit, true);
  assert.equal(game.getInteractables().find(item => item.id === 'oasis-socket').label, '取回提灯');
  assert.equal(game.getInteractables().find(item => item.kind === 'npc').enabled, true, 'free exploration still allows dialogue');
  const restored = createLanternGame({ saved: game.snapshot() });
  assert.equal(restored.getInteractables().filter(item => item.kind === 'mirror' && item.enabled).length, 0, 'loading a completed journey must not re-enable puzzle prompts');
  use(game, 'oasis-socket');
  assert.equal(game.state.complete, true);
  assert.equal(game.state.lamp.location, 'player');
  assert.equal(game.getBeamPaths().length, 0);
  assert.equal(validateLanternSnapshot(game.snapshot()).valid, true);
});

check('same mirror angles do not bypass a blocker or displaced target', () => {
  const base = copy(DEFAULT_LANTERN_DATA.areas[0]);
  base.sockets[0].direction = [0, 6.5, -9];
  delete base.sockets[0].aimAt;
  base.blockers.push({ id: 'test-occluder', min: [-38, 2, 14], max: [-36, 9, 15] });
  const blocked = createLanternGame({ data: { areas: [base] } });
  use(blocked, 'lantern'); use(blocked, 'temple-socket');
  assert.equal(blocked.getBeamPaths()[0].segments[0].hitId, 'test-occluder');
  tick(blocked, 3);
  assert.equal(blocked.state.complete, false);
  base.blockers = [];
  base.terminal.position[0] += 7;
  const displaced = createLanternGame({ data: { areas: [base] } });
  use(displaced, 'lantern'); use(displaced, 'temple-socket');
  assert.equal(displaced.getBeamPaths()[0].terminalLit, false);
  assert.equal(displaced.getBeamPaths()[0].segments.at(-1).hitType, 'air');
});

check('aimAt follows configured height corrections before initialization', () => {
  const data = copy(DEFAULT_LANTERN_DATA);
  data.areas[0].sockets[0].position[1] = 5;
  data.areas[0].terminal.position = [-32, 12, 11];
  const game = createLanternGame({ data });
  use(game, 'lantern'); use(game, 'temple-socket');
  assert.equal(game.getBeamPaths()[0].terminalLit, true);
  assert.deepEqual(game.data.areas[0].sockets[0].direction, [5, 7, -8]);
});

check('mirror cycles terminate and never charge a terminal', () => {
  const area = {
    id: 'loop', name: 'Loop', entry: [0, 0, 0],
    sockets: [{ id: 'loop-seat', position: [0, 0, 0], direction: [1, 0, 0] }],
    mirrors: [
      { id: 'loop-a', position: [4, 0, 0], directions: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
      { id: 'loop-b', position: [8, 0, 0], directions: [[-1, 0, 0], [0, 1, 0], [0, 0, 1]] },
    ],
    terminal: { id: 'loop-end', position: [4, 0, 8] }, blockers: [],
  };
  const game = createLanternGame({ data: { areas: [area] } });
  use(game, 'lantern'); use(game, 'loop-seat');
  const path = game.getBeamPaths()[0];
  assert.equal(path.cycle, true);
  assert.equal(path.segments.length, 3);
  assert.equal(path.terminalLit, false);
});

check('save/load preserves permanent state and resets incomplete charging', () => {
  const game = createLanternGame(); templeComplete(game); use(game, 'temple-socket');
  use(game, 'city-socket-high'); use(game, 'city-mirror'); tick(game, 1);
  const serialized = JSON.stringify(game.snapshot());
  const restored = createLanternGame({ saved: JSON.parse(serialized) });
  assert.equal(restored.state.restoreStatus, 'restored');
  assert.equal(restored.state.gates['temple-gate'], 'open');
  assert.equal(restored.state.gates['city-gate'], 'closed');
  assert.equal(restored.state.mirrorTurns['city-mirror'], 1);
  assert.equal(restored.state.lamp.socketId, 'city-socket-high');
  assert.equal(restored.state.chargeSeconds.city, 0);
  tick(restored, 1.95);
  assert.deepEqual(restored.state.completed, ['temple']);
  tick(restored, 0.05);
  assert.deepEqual(restored.state.completed, ['temple', 'city']);
});

check('inconsistent and malformed saves return to a playable initial state', () => {
  const initial = createLanternGame().snapshot();
  const badSaves = [null, 7, [], {},
    { ...initial, version: 100 },
    { ...initial, dataId: 'other-game' },
    { ...initial, playerPosition: [0, Infinity, 0] },
    { ...initial, completed: ['oasis'] },
    { ...initial, completed: ['temple', 'temple'] },
    { ...initial, gates: { ...initial.gates, 'temple-gate': 'open' } },
    { ...initial, mirrorTurns: { ...initial.mirrorTurns, 'city-mirror': 3 } },
    { ...initial, lamp: { location: 'socket', socketId: 'unknown' } },
    { ...initial, hasPickedUp: true, lamp: { location: 'socket', socketId: 'oasis-socket' } },
    { ...initial, hasPickedUp: true },
    { ...initial, lamp: { location: 'player', socketId: 'temple-socket' } },
  ];
  for (const saved of badSaves) {
    assert.equal(validateLanternSnapshot(saved).valid, false);
    const events = [], game = createLanternGame({ saved, onEvent: event => events.push(event) });
    game.update(0);
    assert.equal(game.state.lamp.location, 'ground');
    assert.deepEqual(game.state.completed, []);
    if (saved !== null) {
      assert.equal(game.state.restoreStatus, 'rejected');
      assert.equal(events.filter(e => e.type === 'save-rejected').length, 1);
    }
    use(game, 'lantern');
    assert.equal(game.state.lamp.location, 'player');
  }
});

check('recovery brings the unique lamp back, preserves progress, reset clears it', () => {
  const game = createLanternGame();
  game.recover();
  assert.equal(game.state.lamp.location, 'ground');
  templeComplete(game); use(game, 'temple-socket');
  use(game, 'city-socket-high'); use(game, 'city-mirror'); tick(game, 0.5);
  const recovered = game.recover();
  assert.deepEqual(recovered.playerPosition, DEFAULT_LANTERN_DATA.areas[1].entry);
  assert.equal(recovered.lamp.location, 'player');
  assert.equal(recovered.lamp.socketId, null);
  assert.equal(recovered.chargeSeconds.city, 0);
  assert.equal(recovered.gates['temple-gate'], 'open');
  assert.equal(recovered.mirrorTurns['city-mirror'], 1);
  assert.equal(validateLanternSnapshot(game.snapshot()).valid, true);
  const reset = game.reset();
  assert.deepEqual(reset.completed, []);
  assert.equal(reset.lamp.location, 'ground');
  assert.equal(reset.mirrorTurns['city-mirror'], 0);
  assert.ok(Object.values(reset.gates).every(state => state === 'closed'));
});

check('invalid configurations fail early instead of making an unsolvable scene', () => {
  assert.throws(() => createLanternGame({ data: { chargeSeconds: 0 } }), /chargeSeconds/);
  const data = copy(DEFAULT_LANTERN_DATA);
  data.areas[0].sockets[0].aimAt = 'missing';
  assert.throws(() => createLanternGame({ data }), /aimAt target/);
  data.areas[0].sockets[0].id = '__proto__';
  assert.throws(() => createLanternGame({ data }), /invalid id/);
});

console.log(`Lantern rules: ${checks} behavioural checks passed.`);
