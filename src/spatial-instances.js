import * as T from 'three';

/**
 * Static spatial banks for expensive instance meshes. Geometry, material and
 * Float32 instance records are shared/copied unchanged. Three performs normal
 * frustum culling separately for the main, reflected and shadow cameras; never
 * set individual cell visibility from the main camera.
 *
 * Sources are {type,mesh,positions?}; positions are placement origins in the
 * same coordinates as the instance matrices. Keep small material banks whole
 * to avoid paying an extra draw for every window, trim or piece of cloth.
 */
export function createSpatialInstances(scene, sources, {cellSize = 32, enabled = true} = {}) {
  if (!(cellSize > 0) || !Number.isFinite(cellSize)) throw new RangeError('cellSize must be positive.');
  const root = new T.Group(); root.name = 'house-spatial-clusters'; scene.add(root);
  const entries = [], matrix = new T.Matrix4(), center = new T.Vector3();
  let disposed = false;

  for (const {type, mesh, positions} of sources) {
    if (!mesh?.isInstancedMesh || mesh.morphTexture || (mesh.parent && mesh.parent !== scene)) {
      throw new TypeError('Spatial banks require static, non-morphed scene-level instance meshes.');
    }
    if (positions && positions.length !== mesh.count) throw new RangeError('One origin is required per instance.');
    if (!mesh.parent) scene.add(mesh);
    const cells = new Map();
    for (let i = 0; i < mesh.count; i++) {
      const origin = positions?.[i];
      if (origin) center.set(origin.x, origin.y, origin.z);
      else { mesh.getMatrixAt(i, matrix); center.setFromMatrixPosition(matrix); }
      const key = `${Math.floor(center.x / cellSize)},${Math.floor(center.z / cellSize)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(i);
    }
    const banks = [];
    for (const [cell, indices] of cells) {
      const bank = new T.InstancedMesh(mesh.geometry, mesh.material, indices.length);
      bank.name = `${mesh.name}:cell:${cell}`;
      bank.position.copy(mesh.position); bank.quaternion.copy(mesh.quaternion); bank.scale.copy(mesh.scale);
      bank.matrix.copy(mesh.matrix); bank.matrixAutoUpdate = mesh.matrixAutoUpdate;
      bank.castShadow = mesh.castShadow; bank.receiveShadow = mesh.receiveShadow;
      bank.frustumCulled = mesh.frustumCulled; bank.layers.mask = mesh.layers.mask;
      bank.renderOrder = mesh.renderOrder;
      bank.customDepthMaterial = mesh.customDepthMaterial; bank.customDistanceMaterial = mesh.customDistanceMaterial;
      bank.onBeforeRender = mesh.onBeforeRender; bank.onAfterRender = mesh.onAfterRender;
      bank.onBeforeShadow = mesh.onBeforeShadow; bank.onAfterShadow = mesh.onAfterShadow;
      bank.instanceMatrix.setUsage(mesh.instanceMatrix.usage);
      if (mesh.instanceColor) {
        bank.instanceColor = new T.InstancedBufferAttribute(
          new mesh.instanceColor.array.constructor(indices.length * 3), 3, mesh.instanceColor.normalized);
        bank.instanceColor.setUsage(mesh.instanceColor.usage);
      }
      indices.forEach((sourceIndex, index) => {
        bank.instanceMatrix.array.set(mesh.instanceMatrix.array.subarray(sourceIndex * 16, sourceIndex * 16 + 16), index * 16);
        if (bank.instanceColor) bank.instanceColor.array.set(mesh.instanceColor.array.subarray(sourceIndex * 3, sourceIndex * 3 + 3), index * 3);
      });
      bank.userData = {...mesh.userData, spatialSource: mesh.name, spatialCell: cell, spatialSourceIndices: indices};
      bank.instanceMatrix.needsUpdate = true;
      if (bank.instanceColor) bank.instanceColor.needsUpdate = true;
      bank.computeBoundingBox(); bank.computeBoundingSphere(); root.add(bank); banks.push(bank);
    }
    entries.push({type, mesh, banks, visible: mesh.visible,
      triangles: (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3});
  }

  function setEnabled(value) {
    if (disposed) return enabled;
    enabled = !!value;
    for (const entry of entries) {
      entry.mesh.visible = entry.visible && !enabled;
      for (const bank of entry.banks) bank.visible = entry.visible && enabled;
    }
    return enabled;
  }

  // Optional camera diagnostics use Three's same conservative bounding spheres.
  // This reports submitted geometry, not GPU time or pixel-level visibility.
  function snapshot(camera) {
    let frustum = null;
    if (camera?.isCamera) {
      camera.updateWorldMatrix(true, false); root.updateWorldMatrix(true, true);
      frustum = new T.Frustum().setFromProjectionMatrix(
        new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    }
    let batches = 0, submittedInstances = 0, submittedTriangles = 0;
    let originalVisibleBatches = 0, originalVisibleTriangles = 0;
    const types = entries.map(entry => {
      if (frustum) entry.mesh.updateWorldMatrix(true, false);
      const inView = mesh => !frustum || !mesh.frustumCulled || frustum.intersectsObject(mesh);
      if (entry.visible && inView(entry.mesh)) {
        originalVisibleBatches++; originalVisibleTriangles += entry.mesh.count * entry.triangles;
      }
      for (const bank of enabled ? entry.banks : [entry.mesh]) {
        if (!bank.visible || !inView(bank)) continue;
        batches++; submittedInstances += bank.count; submittedTriangles += bank.count * entry.triangles;
      }
      return {type: entry.type, source: entry.mesh.name, instances: entry.mesh.count,
        cells: entry.banks.length, trianglesPerInstance: entry.triangles};
    });
    return {enabled, cellSize, instances: entries.reduce((n, entry) => n + entry.mesh.count, 0),
      originalBatches: entries.length, clusterBatches: entries.reduce((n, entry) => n + entry.banks.length, 0),
      batches, submittedInstances, submittedTriangles, originalVisibleBatches, originalVisibleTriangles, types};
  }

  setEnabled(enabled);
  return {root, setEnabled, snapshot,
    dispose() {
      if (disposed) return;
      setEnabled(false); disposed = true;
      for (const entry of entries) for (const bank of entry.banks) bank.dispose();
      root.removeFromParent();
    },
  };
}
