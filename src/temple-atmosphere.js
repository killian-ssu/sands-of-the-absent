import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A quiet, non-interactive reward on the existing sanctuary altar.
 * Coordinates come from build_assets.py: Blender (0,5,5), placed at
 * [-37,0,-2] with scale 1.15, becomes [-37,5.75,-7.75]. The bronze
 * altar cap has radius 2.4725 m; every added solid sits inside that cap.
 * Four draws. No lights, reflectors, collisions, or additional game rules.
 */
export function createTempleAtmosphere(scene, game, { groundHeight = () => 2.3, materials = {} } = {}) {
  const root = new T.Group(); root.name = 'temple-altar-atmosphere'; scene.add(root);
  const resources = [], keep = value => { resources.push(value); return value; };
  const center = new T.Vector3(-37, 5.75, -7.75);
  const uniforms = { uAwake: { value: 0 }, uTime: { value: 0 } };
  const merge = parts => {
    const normalized = parts.map(part => {
      const flat = part.index ? part.toNonIndexed() : part;
      if (flat !== part) part.dispose();
      return flat;
    });
    const result = mergeGeometries(normalized);
    normalized.forEach(part => part.dispose());
    return keep(result);
  };
  const addMesh = (name, geometry, material) => {
    const mesh = new T.Mesh(geometry, material); mesh.name = name;
    mesh.receiveShadow = true; root.add(mesh); return mesh;
  };

  // The shallow tray rests on the old bronze cap; the disk rests on the tray.
  // Its rim and six clasps are actual supported copper, not floating glyphs.
  const trayParts = [];
  const tray = new T.CylinderGeometry(1.79, 1.79, 0.04, 64);
  tray.translate(center.x, center.y + 0.02, center.z); trayParts.push(tray);
  const profile = [
    [1.68, 0.04], [1.70, 0.09], [1.765, 0.095], [1.83, 0.047],
    [1.83, 0.0], [1.77, 0.0], [1.68, 0.04],
  ].map(([radius, height]) => new T.Vector2(radius, height));
  const rim = new T.LatheGeometry(profile, 64);
  rim.translate(center.x, center.y, center.z); trayParts.push(rim);
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3 + Math.PI / 6;
    const clasp = new T.BoxGeometry(0.055, 0.023, 0.205);
    clasp.translate(0, center.y + 0.083, 1.655);
    clasp.rotateY(angle); clasp.translate(center.x, 0, center.z); trayParts.push(clasp);
  }
  const copper = keep(materials.bronze?.isMaterial ? materials.bronze.clone()
    : new T.MeshStandardMaterial({ color: 0x95703d, metalness: 0.82, roughness: 0.42 }));
  copper.color.setHex(0x8d7149); copper.roughness = 0.43;
  addMesh('supported-bronze-mirror-tray', merge(trayParts), copper);

  const glassMaterial = keep(new T.MeshPhysicalMaterial({
    color: 0x14272d, metalness: 0.36, roughness: 0.18,
    clearcoat: 1, clearcoatRoughness: 0.12,
    envMapIntensity: 0.72, reflectivity: 0.65,
    // Opaque obsidian gives a glasslike surface without a transmission render.
    transmission: 0,
  }));
  const glassGeometry = keep(new T.CylinderGeometry(1.68, 1.68, 0.038, 96));
  glassGeometry.translate(center.x, center.y + 0.059, center.z);
  addMesh('dark-obsidian-mirror', glassGeometry, glassMaterial);

  // Fine embedded circles and machining marks are visible as copper while
  // dormant. Their narrow warm seams awaken from the center outwards.
  const inlayParts = [], diskTop = center.y + 0.078;
  const revealAttribute = (geometry, phase) => {
    geometry.setAttribute('aReveal', new T.Float32BufferAttribute(
      new Float32Array(geometry.attributes.position.count).fill(phase), 1));
    inlayParts.push(geometry);
  };
  for (const [radius, width, phase] of [[0.54, 0.009, 0.05], [1.13, 0.008, 0.28], [1.515, 0.012, 0.52]]) {
    const ring = new T.RingGeometry(radius - width / 2, radius + width / 2, 128);
    ring.rotateX(-Math.PI / 2); ring.translate(center.x, diskTop + 0.0012, center.z);
    revealAttribute(ring, phase);
  }
  for (let i = 0; i < 36; i++) {
    const angle = i * Math.PI / 18, major = i % 3 === 0;
    const mark = new T.PlaneGeometry(major ? 0.014 : 0.008, major ? 0.092 : 0.039);
    mark.rotateX(-Math.PI / 2); mark.translate(0, diskTop + 0.0015, 1.405);
    mark.rotateY(angle); mark.translate(center.x, 0, center.z);
    revealAttribute(mark, 0.57 + (i % 3) * 0.035);
  }
  const inlayMaterial = keep(new T.MeshStandardMaterial({
    color: 0xb29158, metalness: 0.82, roughness: 0.32,
    emissive: 0xe9b969, emissiveIntensity: 0.31,
  }));
  inlayMaterial.onBeforeCompile = shader => {
    shader.uniforms.uAwake = uniforms.uAwake;
    shader.vertexShader = 'attribute float aReveal;varying float vReveal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvReveal=aReveal;');
    shader.fragmentShader = 'uniform float uAwake;varying float vReveal;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance*=smoothstep(vReveal,vReveal+.22,uAwake);');
  };
  inlayMaterial.customProgramCacheKey = () => 'temple-copper-seams-v1';
  addMesh('altar-inlaid-copper-circles', merge(inlayParts), inlayMaterial);

  // A few tiny motes stay in the empty central sanctuary, above the altar and
  // below the lowest roof slab. They never mark a puzzle target or a route.
  const random = i => { const n = Math.sin(i * 71.17 + 91.3) * 43758.54; return n - Math.floor(n); };
  const positions = [], phases = [], sizes = [];
  for (let i = 0; i < 52; i++) {
    const x = center.x + (random(i * 5) - 0.5) * 9.2;
    const z = center.z + (random(i * 5 + 1) - 0.5) * 5.8;
    const floor = Math.max(6.1, groundHeight(x, z) + 3.7);
    positions.push(x, floor, z); phases.push(random(i * 5 + 2));
    sizes.push(0.021 + random(i * 5 + 3) * 0.017);
  }
  const dustGeometry = keep(new T.BufferGeometry());
  dustGeometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  dustGeometry.setAttribute('aPhase', new T.Float32BufferAttribute(phases, 1));
  dustGeometry.setAttribute('aSize', new T.Float32BufferAttribute(sizes, 1));
  dustGeometry.computeBoundingSphere(); dustGeometry.boundingSphere.radius += 6.5;
  const dustMaterial = keep(new T.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: `attribute float aPhase;attribute float aSize;
      uniform float uAwake;uniform float uTime;varying float vAlpha;
      void main(){float life=fract(aPhase+uTime*.008);vec3 p=position;
      p.y+=life*6.2;p.x+=sin(uTime*.09+aPhase*34.)*.16;
      p.z+=cos(uTime*.07+aPhase*21.)*.12;
      vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
      gl_PointSize=clamp(440.*aSize/max(2.,-mv.z),.7,2.0);
      vAlpha=(.075+uAwake*.16)*smoothstep(0.,.13,life)*(1.-smoothstep(.82,1.,life));}`,
    fragmentShader: `varying float vAlpha;
      void main(){float d=length(gl_PointCoord-.5);float alpha=vAlpha*(1.-smoothstep(.05,.5,d));
      if(alpha<.003)discard;gl_FragColor=vec4(vec3(.69,.57,.36),alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  }));
  const dust = new T.Points(dustGeometry, dustMaterial); dust.name = 'sanctuary-fine-dust'; root.add(dust);

  // Do not invent a shaft through the upper tower. The real opening is
  // x[-41.6,-32.4], z[-6.6,2.6], roof y[17.45,19.29]. With the proposed low
  // back-left sun (-150,65,-130)->(-20,0,-40), GLB triangle ray tests found
  // no clear 0.25 m radius bundle through the upper masonry. Dust is enough.
  root.userData.altarSurface = { center: center.toArray(), radius: 2.4725, addedRadius: 1.83 };
  root.userData.roofLightShaft = false;
  let age = 0, wasAwake = false, initialized = false, disposed = false;
  const update = (dt = 0, elapsed = 0) => {
    if (disposed) return;
    const awake = game.state.completed.includes('temple');
    const step = Number.isFinite(dt) ? T.MathUtils.clamp(dt, 0, 0.1) : 0;
    if (!awake) age = 0;
    else if (!wasAwake) age = initialized ? 0 : 6;
    else age += step;
    const amount = awake ? T.MathUtils.smoothstep(Math.min(age / 3.8, 1), 0, 1) : 0;
    uniforms.uAwake.value = amount;
    uniforms.uTime.value = Number.isFinite(elapsed) ? elapsed : 0;
    glassMaterial.roughness = 0.18 - amount * 0.07;
    glassMaterial.clearcoatRoughness = 0.12 - amount * 0.055;
    glassMaterial.envMapIntensity = 0.72 + amount * 0.35;
    wasAwake = awake; initialized = true;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; root.removeFromParent(); resources.forEach(resource => resource.dispose());
  };
  update(0, 0);
  return { root, update, dispose, drawCalls: 4 };
}
