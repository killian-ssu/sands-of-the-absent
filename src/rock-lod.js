import * as T from 'three';

/**
 * Three geometry banks per legacy rock type. All placements remain present and
 * all banks share the original PBR material, instance colors and shadow flags.
 * LOD is selected once from the main camera; reflection/AO/shadow passes cannot
 * independently change it. Height is in CSS pixels, matching window.innerHeight.
 */
export function createRockLOD(scene, sources, {enabled = true, highPixels = 80,
  mediumPixels = 32, hysteresis = 0.12, interval = 0.2} = {}) {
  const root = new T.Group(); root.name = 'legacy-rock-lods'; scene.add(root);
  const cameraPosition = new T.Vector3(), cameraQuaternion = new T.Quaternion();
  const previousPosition = new T.Vector3(Infinity, Infinity, Infinity), previousQuaternion = new T.Quaternion();
  let previousHeight = 0, previousProjection = 0, previousTime = -Infinity;
  let force = true, disposed = false, updates = 0, rebuilds = 0;
  const entries = [];

  function oneMesh(model) {
    model.updateMatrixWorld(true);
    const meshes = []; model.traverse(node => { if (node.isMesh) meshes.push(node); });
    if (meshes.length !== 1 || Array.isArray(meshes[0].material)) {
      throw new Error('Legacy rock LOD assets must contain one material and mesh.');
    }
    return meshes[0];
  }

  for (const {type, mesh, sourceNodeMatrix, models} of sources) {
    if (!mesh.isInstancedMesh || Array.isArray(mesh.material) || models.length !== 2) {
      throw new Error('Legacy rock LOD needs an original instance bank and two simpler models.');
    }
    const count = mesh.count, matrices = mesh.instanceMatrix.array.slice(0, count * 16);
    const colors = mesh.instanceColor?.array.slice(0, count * 3) || null;
    const states = new Int8Array(count).fill(-1), spheres = [];
    const originalMatrix = sourceNodeMatrix || new T.Matrix4(), undoOriginal = originalMatrix.clone().invert();
    const banks = [mesh];
    for (let i = 0; i < models.length; i++) {
      const node = oneMesh(models[i]);
      // Bring exported LOD coordinates into the original mesh's local frame so
      // the original, bit-for-bit instance matrices can be reused in every bank.
      const transform = new T.Matrix4().multiplyMatrices(undoOriginal, node.matrixWorld);
      const geometry = node.geometry.clone().applyMatrix4(transform);
      const low = new T.InstancedMesh(geometry, mesh.material, count);
      low.name = `${type}-lod${i + 1}`;
      low.castShadow = mesh.castShadow; low.receiveShadow = mesh.receiveShadow;
      if (colors) low.instanceColor = new T.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      low.count = 0; low.visible = false; banks.push(low);
      node.geometry.dispose(); node.material.dispose();
    }
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const matrix = new T.Matrix4();
    for (let i = 0; i < count; i++) {
      matrix.fromArray(matrices, i * 16);
      spheres.push(mesh.geometry.boundingSphere.clone().applyMatrix4(matrix));
    }
    for (const bank of banks) {
      bank.instanceMatrix.setUsage(T.DynamicDrawUsage);
      bank.instanceColor?.setUsage(T.DynamicDrawUsage);
      root.add(bank);
    }
    entries.push({type, banks, count, matrices, colors, states, spheres,
      triangles: banks.map(bank => (bank.geometry.index?.count || bank.geometry.attributes.position.count) / 3)});
  }

  function targetLevel(pixels, previous) {
    if (previous < 0) return pixels >= highPixels ? 0 : pixels >= mediumPixels ? 1 : 2;
    if (previous === 0) return pixels >= highPixels * (1 - hysteresis) ? 0
      : pixels >= mediumPixels * (1 - hysteresis) ? 1 : 2;
    if (previous === 1) return pixels > highPixels * (1 + hysteresis) ? 0
      : pixels < mediumPixels * (1 - hysteresis) ? 2 : 1;
    return pixels > highPixels * (1 + hysteresis) ? 0
      : pixels > mediumPixels * (1 + hysteresis) ? 1 : 2;
  }

  function rebuild(entry) {
    const counts = [0, 0, 0];
    for (let i = 0; i < entry.count; i++) {
      const tier = Math.max(0, entry.states[i]), bank = entry.banks[tier], slot = counts[tier]++;
      bank.instanceMatrix.array.set(entry.matrices.subarray(i * 16, i * 16 + 16), slot * 16);
      if (entry.colors) bank.instanceColor.array.set(entry.colors.subarray(i * 3, i * 3 + 3), slot * 3);
    }
    entry.banks.forEach((bank, tier) => {
      bank.count = counts[tier]; bank.visible = bank.count > 0;
      if (bank.count) { bank.computeBoundingSphere(); bank.computeBoundingBox(); }
      bank.instanceMatrix.needsUpdate = true;
      if (bank.instanceColor) bank.instanceColor.needsUpdate = true;
    });
    rebuilds++;
  }

  function update(camera, viewportHeight, time = 0) {
    if (disposed || !camera?.isCamera || !(viewportHeight > 0)) return;
    camera.updateMatrixWorld();
    camera.getWorldPosition(cameraPosition); camera.getWorldQuaternion(cameraQuaternion);
    const projection = Math.abs(camera.projectionMatrix.elements[5]);
    const elapsed = time - previousTime;
    if (!force && elapsed >= 0 && elapsed < interval && previousHeight === viewportHeight && previousProjection === projection
      && cameraPosition.distanceToSquared(previousPosition) < 0.1225
      && 1 - Math.abs(cameraQuaternion.dot(previousQuaternion)) < 0.000078) return;
    previousPosition.copy(cameraPosition); previousQuaternion.copy(cameraQuaternion);
    previousHeight = viewportHeight; previousProjection = projection; previousTime = time; updates++;
    const view = camera.matrixWorldInverse.elements, pixelScale = viewportHeight * projection * 0.5;
    for (const entry of entries) {
      let changed = false;
      for (let i = 0; i < entry.count; i++) {
        const sphere = entry.spheres[i], c = sphere.center;
        const viewDepth = -(view[2] * c.x + view[6] * c.y + view[10] * c.z + view[14]);
        const distance = cameraPosition.distanceTo(c);
        const denominator = camera.isOrthographicCamera ? 1 : Math.max(sphere.radius, 0.001,
          viewDepth > sphere.radius ? viewDepth : distance);
        const diameter = 2 * sphere.radius * pixelScale / denominator;
        const next = enabled ? targetLevel(diameter, force ? -1 : entry.states[i]) : 0;
        if (entry.states[i] !== next) { entry.states[i] = next; changed = true; }
      }
      if (changed) rebuild(entry);
    }
    force = false;
  }

  function snapshot() {
    const tiers = [0, 0, 0]; let triangles = 0, originalTriangles = 0, batches = 0;
    const types = entries.map(entry => {
      const counts = entry.banks.map(bank => bank.count);
      counts.forEach((count, i) => { tiers[i] += count; triangles += count * entry.triangles[i]; if (count) batches++; });
      originalTriangles += entry.count * entry.triangles[0];
      return {type: entry.type, counts, trianglesPerInstance: entry.triangles};
    });
    return {enabled, instances: tiers.reduce((a, b) => a + b, 0), tiers, triangleBudget: triangles,
      originalTriangles, batches, updates, rebuilds, highPixels, mediumPixels, hysteresis, types};
  }

  function setEnabled(value) {
    enabled = !!value; force = true;
    if (!enabled) for (const entry of entries) { entry.states.fill(0); rebuild(entry); }
  }

  return {root, update, setEnabled, snapshot,
    dispose() {
      if (disposed) return;
      setEnabled(false); disposed = true;
      for (const entry of entries) {
        scene.add(entry.banks[0]);
        for (const low of entry.banks.slice(1)) { low.geometry.dispose(); low.dispose(); }
      }
      root.removeFromParent();
    },
  };
}
