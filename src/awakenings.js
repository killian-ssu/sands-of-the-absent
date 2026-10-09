import * as T from 'three';

/** Small environmental rewards driven only by completed areas.
 * Three draws: instanced copper inlays, ground caustics, local floating dust.
 * No collision, lights, shadow maps, bloom, external images or gameplay state.
 */
export function createAwakenings(scene, game, { groundHeight = () => 0 } = {}) {
  const data = game.data, root = new T.Group(); root.name = 'quiet-awakenings'; scene.add(root);
  const resources = [], remember = value => { resources.push(value); return value; };
  const levels = new T.Vector3(), ages = new T.Vector3(), times = data.areas.map(() => 0), active = data.areas.map(() => false);
  const uniforms = { uLevels: { value: levels }, uAges: { value: ages }, uTime: { value: 0 } };
  const areaIndex = id => Math.max(0, data.areas.findIndex(area => area.id === id));
  const bars = [];
  const line = (from, to, area, order = 0, width = 0.025) => bars.push({ from, to, area, order, width });
  const localPoint = (gate, x, y, z) => {
    const yaw = gate.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw);
    return [gate.position[0] + x * c + z * s, gate.position[1] + y, gate.position[2] - x * s + z * c];
  };
  const jitter = index => {
    const a = Math.sin(index * 127.1 + 73.91) * 43758.5453;
    return a - Math.floor(a);
  };

  // These narrow lines lie on the actual stationary posts and header, outside
  // the sliding slab and below the terminal. They cannot obscure its light path.
  for (let index = 0; index < data.areas.length; index++) {
    const area = data.areas[index], gate = area.gate;
    if (!gate || gate.kind === 'channels' || area.id === 'oasis') continue;
    const w = gate.width || 10.6, h = gate.height || 6.9, d = gate.depth || 0.44;
    const front = (d + 0.3) / 2 + 0.009;
    for (const side of [-1, 1]) {
      const x = side * (w / 2 + 0.15);
      for (let j = 0; j < 6; j++) {
        const low = 0.3 + j * (h - 0.48) / 6, high = low + (h - 0.48) / 6 - 0.065;
        line(localPoint(gate, x, low, front), localPoint(gate, x, high, front), index, j * 0.1);
        if (j % 2 === 0) line(localPoint(gate, x - 0.058, high, front), localPoint(gate, x + 0.058, high, front), index, j * 0.1, 0.018);
      }
    }
    const headerFront = (d + 0.32) / 2 + 0.01;
    for (const side of [-1, 1]) {
      line(localPoint(gate, side * (w / 2 + 0.12), h + 0.17, headerFront),
        localPoint(gate, side * 0.4, h + 0.17, headerFront), index, 0.66, 0.022);
    }
  }
  // Match the existing tapered obelisk groove (Blender-local coordinates,
  // converted to the placed model's [2.4,1.2,2.4] scale). This is a surface seam,
  // never a detached pillar of light in the sky.
  const finalIndex = areaIndex('oasis');
  for (const [low, high] of [[8, 13.3], [14, 19.8], [20.5, 23.7], [28.5, 33]]) {
    const seamPoint = height => {
      const halfWidth = 3.5 - (height - 3.5) / 2.95 * 0.047;
      return [30, 25 + height * 1.2, -118 + (halfWidth - 0.26) * 2.4 + 0.055];
    };
    line(seamPoint(low), seamPoint(high), finalIndex, 0.56 + low * 0.009, 0.11);
  }
  line([22.4, 25.54, -104.782], [29.55, 25.54, -104.782], finalIndex, 0.14, 0.035);
  line([30.45, 25.54, -104.782], [37.6, 25.54, -104.782], finalIndex, 0.14, 0.035);

  const barGeometry = remember(new T.BoxGeometry(1, 1, 1));
  barGeometry.setAttribute('aArea', new T.InstancedBufferAttribute(new Float32Array(bars.map(bar => bar.area)), 1));
  barGeometry.setAttribute('aOrder', new T.InstancedBufferAttribute(new Float32Array(bars.map(bar => bar.order)), 1));
  const barMaterial = remember(new T.ShaderMaterial({
    uniforms,
    vertexShader: `attribute float aArea;attribute float aOrder;uniform vec3 uLevels;varying float vLight;
      void main(){float level=uLevels[int(aArea)];vLight=smoothstep(aOrder,aOrder+.13,level);
      gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `varying float vLight;void main(){if(vLight<.005)discard;
      gl_FragColor=vec4(vec3(.97,.60,.24)*(1.+vLight*.16),vLight*.78);}`,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
  }));
  const inlays = new T.InstancedMesh(barGeometry, barMaterial, bars.length); inlays.name = 'awakened-copper-inlays';
  const dummy = new T.Object3D(), from = new T.Vector3(), to = new T.Vector3(), direction = new T.Vector3(), forward = new T.Vector3(0, 0, 1);
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]; from.fromArray(bar.from); to.fromArray(bar.to); direction.subVectors(to, from);
    dummy.position.copy(from).addScaledVector(direction, 0.5);
    dummy.quaternion.setFromUnitVectors(forward, direction.clone().normalize());
    dummy.scale.set(bar.width, bar.width, direction.length()); dummy.updateMatrix(); inlays.setMatrixAt(i, dummy.matrix);
  }
  inlays.computeBoundingSphere(); root.add(inlays);

  const floorPositions = [], floorUvs = [], floorAreas = [], floorIndices = [];
  for (let index = 0; index < data.areas.length; index++) {
    const area = data.areas[index], gate = area.gate;
    const isOasis = area.id === 'oasis';
    const center = isOasis ? area.entry : gate ? localPoint(gate, 0, 0, -2.5) : area.entry;
    const width = isOasis ? 4.4 : Math.min(7, (gate?.width || 10.6) * 0.65), depth = isOasis ? 5.5 : 4.4;
    const yaw = gate?.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw), start = floorPositions.length / 3, segments = 8;
    for (let z = 0; z <= segments; z++) for (let x = 0; x <= segments; x++) {
      const u = x / segments, v = z / segments, lx = (u - 0.5) * width, lz = (v - 0.5) * depth;
      const wx = center[0] + lx * c + lz * s, wz = center[2] - lx * s + lz * c;
      floorPositions.push(wx, groundHeight(wx, wz) + 0.026, wz); floorUvs.push(u, v); floorAreas.push(index);
      if (x < segments && z < segments) { const a = start + z * (segments + 1) + x; floorIndices.push(a, a + segments + 1, a + 1, a + 1, a + segments + 1, a + segments + 2); }
    }
  }
  const floorGeometry = remember(new T.BufferGeometry());
  floorGeometry.setAttribute('position', new T.Float32BufferAttribute(floorPositions, 3));
  floorGeometry.setAttribute('uv', new T.Float32BufferAttribute(floorUvs, 2));
  floorGeometry.setAttribute('aArea', new T.Float32BufferAttribute(floorAreas, 1)); floorGeometry.setIndex(floorIndices);
  const floorMaterial = remember(new T.ShaderMaterial({
    uniforms,
    vertexShader: `attribute float aArea;varying vec2 vUv;varying float vArea;void main(){vUv=uv;vArea=aArea;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform vec3 uLevels;uniform vec3 uAges;uniform float uTime;varying vec2 vUv;varying float vArea;
      void main(){int index=int(vArea+.1);float level=uLevels[index];vec2 p=(vUv-.5)*2.;
      float edge=max(0.,1.-dot(p,p));float sweep=smoothstep(p.y-.35,p.y+.35,level*2.-1.);
      float firstPulse=exp(-pow((uAges[index]-1.9)*1.25,2.));
      float pattern=pow(.5+.5*sin(vUv.x*39.+sin(vUv.y*22.+uTime*.16)),9.);
      float alpha=edge*edge*sweep*level*(.025+.026*pattern+.065*firstPulse);
      if(alpha<.001)discard;gl_FragColor=vec4(vec3(.86,.62,.29),alpha);}`,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false,
  }));
  const floorGlow = new T.Mesh(floorGeometry, floorMaterial); floorGlow.name = 'awakening-ground-reflections'; root.add(floorGlow);

  const positions = [], particlesArea = [], phases = [], sizes = [], rises = [];
  for (let index = 0; index < data.areas.length; index++) {
    const area = data.areas[index], count = area.id === 'oasis' ? 125 : 68;
    const center = area.id === 'oasis' ? [25, groundHeight(25, 27), 27]
      : area.gate ? localPoint(area.gate, 0, 0, -1.4) : area.entry;
    for (let i = 0; i < count; i++) {
      const seed = index * 1000 + i, spread = area.id === 'oasis' ? 7 : 4.4;
      const x = center[0] + (jitter(seed + 1) - 0.5) * spread, z = center[2] + (jitter(seed + 2) - 0.5) * spread;
      positions.push(x, groundHeight(x, z) + 0.3, z); particlesArea.push(index);
      phases.push(jitter(seed + 3)); sizes.push(0.22 + jitter(seed + 4) * 0.18); rises.push(area.id === 'oasis' ? 6.5 : 3.2);
    }
  }
  const particleGeometry = remember(new T.BufferGeometry());
  particleGeometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  particleGeometry.setAttribute('aArea', new T.Float32BufferAttribute(particlesArea, 1));
  particleGeometry.setAttribute('aPhase', new T.Float32BufferAttribute(phases, 1));
  particleGeometry.setAttribute('aSize', new T.Float32BufferAttribute(sizes, 1));
  particleGeometry.setAttribute('aRise', new T.Float32BufferAttribute(rises, 1));
  const particleMaterial = remember(new T.ShaderMaterial({
    uniforms,
    vertexShader: `attribute float aArea;attribute float aPhase;attribute float aSize;attribute float aRise;
      uniform vec3 uLevels;uniform float uTime;varying float vAlpha;
      void main(){float level=uLevels[int(aArea)];float life=fract(uTime*.032+aPhase);vec3 p=position;
      p.y+=life*aRise;p.x+=sin(uTime*.12+aPhase*20.)*.15;p.z+=cos(uTime*.09+aPhase*14.)*.12;
      vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
      gl_PointSize=clamp(120.*aSize/max(2.,-mv.z),1.,3.3);
      vAlpha=level*smoothstep(0.,.18,life)*(1.-smoothstep(.7,1.,life))*.42;}`,
    fragmentShader: `varying float vAlpha;void main(){vec2 p=gl_PointCoord-.5;float glow=exp(-dot(p,p)*17.);
      if(vAlpha*glow<.005)discard;gl_FragColor=vec4(vec3(.92,.73,.40),vAlpha*glow);}`,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
  }));
  const dust = new T.Points(particleGeometry, particleMaterial); dust.name = 'awakened-gold-dust';
  // Vertex motion adds up to 6.5 m to authored Y; retain its full animated bound.
  particleGeometry.computeBoundingSphere(); particleGeometry.boundingSphere.radius += 7; root.add(dust);

  let initialized = false, disposed = false;
  const update = (dt = 0, elapsed = 0) => {
    if (disposed) return;
    const completed = game.state.completed, step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    for (let i = 0; i < data.areas.length; i++) {
      const awake = completed.includes(data.areas[i].id);
      if (!awake) { active[i] = false; times[i] = 0; }
      else if (!active[i]) { active[i] = true; times[i] = initialized ? 0 : 8; }
      else times[i] += step;
      const value = awake ? T.MathUtils.smoothstep(Math.min(1, times[i] / 3.6), 0, 1) : 0;
      if (i < 3) { levels.setComponent(i, value); ages.setComponent(i, times[i]); }
    }
    uniforms.uTime.value = Number.isFinite(elapsed) ? elapsed : 0;
    root.visible = completed.length > 0; initialized = true;
  };
  const dispose = () => { if (disposed) return; disposed = true; root.removeFromParent(); for (const resource of resources) resource.dispose(); };
  update(0, 0);
  return { root, update, dispose, drawCalls: 3 };
}
