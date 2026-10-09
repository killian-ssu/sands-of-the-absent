import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// A few deliberate rock groups frame the temple approach. The authored opening,
// lantern puzzle, NPC and the road to the other regions remain clear.
const CLEAR_RECTS = [
  {minX: -44, maxX: -30, minZ: 12, maxZ: 45},
  {minX: -2, maxX: 10, minZ: -1, maxZ: 55},
];
const CLEAR_CIRCLES = [
  {x: -37, z: 35, r: 6},
  {x: -37, z: 29, r: 4},
  {x: -37, z: 19, r: 4},
  {x: -31, z: 31, r: 4.5},
];
const ASSET_NAMES = ['namaqualand_cliff_01', 'namaqualand_boulders_01'];

function randomGenerator(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function clearFootprint(x, z, radius) {
  for (const rect of CLEAR_RECTS) {
    const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
    const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
    if (Math.hypot(dx, dz) < radius) return false;
  }
  return CLEAR_CIRCLES.every(c => Math.hypot(x - c.x, z - c.z) > c.r + radius);
}

/**
 * Add local scanned rock detail without changing the base world or its navigation.
 * Colliders use the existing {x,z,w,d,y,h,yaw} navigation format.
 * groundHeight must return the rendered terrain height at world (x,z).
 */
export async function createEnvironmentDetails(scene, {groundHeight, seed = 734019} = {}) {
  if (!scene?.isObject3D || typeof groundHeight !== 'function') {
    throw new TypeError('Environment details need a scene and a groundHeight function.');
  }
  const random = randomGenerator(seed);
  const root = new T.Group();
  root.name = 'temple-scanned-rock-details';
  const colliders = [];
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const materialLibrary = new Map();
  let disposed = false;

  function ownMaterial(material) {
    materials.add(material);
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    root.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    const images = new Set();
    for (const texture of textures) {
      if (texture.source?.data) images.add(texture.source.data);
      texture.dispose();
    }
    for (const image of images) image.close?.();
  }

  function readTemplate(model, assetName, associations) {
    model.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(model);
    const size = bounds.getSize(new T.Vector3());
    const center = bounds.getCenter(new T.Vector3());
    const origin = new T.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z);
    const parts = [];
    model.traverse(node => {
      if (!node.isMesh) return;
      geometries.add(node.geometry);
      const original = Array.isArray(node.material) ? node.material : [node.material];
      const chosen = original.map(material => {
        ownMaterial(material);
        const materialIndex = associations?.get(material)?.materials ?? material.name;
        const key = assetName + ':' + materialIndex;
        if (!materialLibrary.has(key)) {
          // Preserve the scanned normal / roughness / AO maps and their GLTF color spaces.
          material.color?.multiply(new T.Color(1, 0.978, 0.95));
          if (material.map) material.map.anisotropy = 4;
          if (material.normalMap) material.normalMap.anisotropy = 4;
          materialLibrary.set(key, material);
        }
        return materialLibrary.get(key);
      });
      parts.push({
        geometry: node.geometry,
        material: Array.isArray(node.material) ? chosen : chosen[0],
        matrix: new T.Matrix4().multiplyMatrices(origin, node.matrixWorld),
      });
    });
    return {size, parts};
  }

  try {
    const loader = new GLTFLoader();
    const requested = ASSET_NAMES.flatMap(name => [0, 1].map(lod => ({name, lod})));
    const results = await Promise.allSettled(requested.map(({name, lod}) =>
      loader.loadAsync(new URL(`../assets/vendor/polyhaven/${name}/${name}_lod${lod}.glb`, import.meta.url).href)));
    const templates = new Map();
    // Record fulfilled resources even on partial failure so they can be released.
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        const {name, lod} = requested[i];
        templates.set(`${name}:${lod}`, readTemplate(result.value.scene, name, result.value.parser?.associations));
      }
    });
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw new Error('A scanned environment asset did not load.', {cause: failed.reason});

    function ground(x, z) {
      const value = groundHeight(x, z);
      if (!Number.isFinite(value)) throw new Error('Environment terrain height must be finite.');
      return value;
    }

    function placement(assetName, x, z, scale, yaw, burial = 0.18, tilt = 0) {
      const size = templates.get(`${assetName}:0`).size;
      const radius = Math.hypot(size.x * scale[0], size.z * scale[2]) * 0.5;
      if (!clearFootprint(x, z, radius + 0.45)) return null;
      // Seat each asset into the lower surrounding ground rather than perching on a slope.
      const footprint = Math.min(radius * 0.55, 2.5);
      const bed = Math.min(ground(x, z), ground(x - footprint, z), ground(x + footprint, z),
        ground(x, z - footprint), ground(x, z + footprint));
      return {x, z, y: bed - size.y * scale[1] * burial, scale, yaw, tilt, size, burial};
    }

    function addRockGroup(assetName, instances, name, shadow, nearDistance) {
      if (!instances.length) return;
      const anchor = new T.Vector3(
        instances.reduce((sum, p) => sum + p.x, 0) / instances.length,
        instances.reduce((sum, p) => sum + p.y, 0) / instances.length,
        instances.reduce((sum, p) => sum + p.z, 0) / instances.length,
      );
      const lodObject = new T.LOD();
      lodObject.name = name;
      lodObject.position.copy(anchor);
      const object = new T.Object3D(), combined = new T.Matrix4();
      for (let lod = 0; lod < 2; lod++) {
        const level = new T.Group();
        level.name = `${name}-lod${lod}`;
        for (const part of templates.get(`${assetName}:${lod}`).parts) {
          const mesh = new T.InstancedMesh(part.geometry, part.material, instances.length);
          mesh.name = `${name}-stone`;
          mesh.castShadow = shadow && lod === 0;
          mesh.receiveShadow = true;
          for (let i = 0; i < instances.length; i++) {
            const p = instances[i];
            object.position.set(p.x - anchor.x, p.y - anchor.y, p.z - anchor.z);
            object.rotation.set(p.tilt, p.yaw, -p.tilt * 0.65);
            object.scale.set(...p.scale);
            object.updateMatrix();
            combined.multiplyMatrices(object.matrix, part.matrix);
            mesh.setMatrixAt(i, combined);
          }
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
          mesh.computeBoundingBox();
          level.add(mesh);
        }
        lodObject.addLevel(level, lod === 0 ? 0 : nearDistance, 0.12);
      }
      root.add(lodObject);
    }

    function addCollider(p, name, widthRatio = 0.83, depthRatio = 0.73) {
      colliders.push({
        x: p.x, z: p.z, w: p.size.x * p.scale[0] * widthRatio,
        d: p.size.z * p.scale[2] * depthRatio, y: p.y,
        h: p.size.y * p.scale[1], yaw: p.yaw,
        source: 'environment-detail', name,
      });
    }

    const cliffName = ASSET_NAMES[0], boulderName = ASSET_NAMES[1];
    const cliffPositions = [
      [-69, 36, [1.28, 1.1, 0.92], 0.58, 0.15],
      [-70, 5, [1.1, 1.46, 0.94], -0.34, 0.21],
      [-10, 28, [0.96, 0.88, 0.74], 2.36, 0.22],
    ];
    let cliffCount = 0;
    for (const [x, z, scale, yaw, burial] of cliffPositions) {
      const p = placement(cliffName, x, z, scale, yaw, burial);
      if (!p) continue;
      addRockGroup(cliffName, [p], `approach-cliff-${cliffCount}`, true, 58);
      addCollider(p, `approach-cliff-${cliffCount}`);
      cliffCount++;
    }

    // Eight larger stones provide a foreground silhouette and solid contact shadows.
    const foreground = [
      [-61, 43, [3.9, 4.15, 3.2], 0.6],
      [-50, 26, [2.8, 3.7, 2.4], -0.42],
      [-19, 40, [3.4, 3.8, 2.9], 1.8],
      [-11, 21, [3.1, 3.9, 2.6], -0.8],
    ].map(([x, z, scale, yaw]) => placement(boulderName, x, z, scale, yaw, 0.2)).filter(Boolean);
    addRockGroup(boulderName, foreground, 'approach-foreground-stones', true, 38);
    for (let i = 0; i < foreground.length; i++) addCollider(foreground[i], `foreground-stone-${i}`, 0.81, 0.8);

    const pockets = [
      {x: -62, z: 34, rx: 4.0, rz: 3.0, n: 7},
      {x: -53, z: 26, rx: 3.8, rz: 1.4, n: 6},
      {x: -22, z: 25, rx: 2.6, rz: 1.8, n: 5},
      {x: -9, z: 29, rx: 2.3, rz: 4.2, n: 6},
      {x: -68, z: 10, rx: 3.4, rz: 2.8, n: 6},
    ];
    let smallBundleCount = 0;
    for (let index = 0; index < pockets.length; index++) {
      const pocket = pockets[index], instances = [];
      for (let attempt = 0; instances.length < pocket.n && attempt < pocket.n * 10; attempt++) {
        const x = pocket.x + (random() - random()) * pocket.rx;
        const z = pocket.z + (random() - random()) * pocket.rz;
        const scale = 0.58 + random() ** 2 * 1.5;
        const p = placement(boulderName, x, z, [scale, scale * (0.72 + random() * 0.34), scale],
          random() * Math.PI * 2, 0.24 + random() * 0.2, (random() - 0.5) * 0.11);
        if (p) instances.push(p);
      }
      smallBundleCount += instances.length;
      addRockGroup(boulderName, instances, `ruin-base-stone-pocket-${index}`, false, 29);
    }

    root.userData = {
      cliffCount, stoneCount: (smallBundleCount + foreground.length) * 2,
      colliderCount: colliders.length, lodDistances: {cliffs: 58, foreground: 38, pockets: 29},
      retainedPBR: true,
    };
    scene.add(root);
    return {colliders, dispose};
  } catch (error) {
    dispose();
    throw error;
  }
}
