import * as T from 'three';

/** Static terrain culling only. Every triangle and attribute value is copied
 * exactly; normals/UVs are never recomputed. Enable only after a real GPU A/B.
 * Each render camera culls its own cells, including oblique reflection views.
 */
export function createTerrainClusters(source, {cellSize = 128, enabled = false} = {}) {
  if (!source?.isMesh || source.isInstancedMesh || source.isSkinnedMesh || !source.parent || Array.isArray(source.material))
    throw new TypeError('Terrain clusters require a parented static mesh with one material.');
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('Terrain cell size must be positive.');
  const geometry = source.geometry, position = geometry.attributes.position, index = geometry.index;
  if (!index || !position || Object.keys(geometry.morphAttributes).length
      || Object.values(geometry.attributes).some(attribute => attribute.isInterleavedBufferAttribute || attribute.count !== position.count))
    throw new TypeError('Terrain clusters require indexed, non-morphed, non-interleaved triangle attributes.');
  const start = Math.max(0, geometry.drawRange.start), end = Math.min(index.count, start + geometry.drawRange.count);
  if (start % 3 || end % 3) throw new RangeError('Terrain draw range must contain complete triangles.');
  const bounds = new T.Box3().setFromBufferAttribute(position), cells = new Map();
  if (bounds.isEmpty() || ![...bounds.min, ...bounds.max].every(Number.isFinite)) throw new RangeError('Terrain positions must be finite.');
  for (let offset = start; offset < end; offset += 3) {
    const a = index.getX(offset), b = index.getX(offset + 1), c = index.getX(offset + 2);
    const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const z = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    const key = `${Math.floor((x - bounds.min.x) / cellSize)},${Math.floor((z - bounds.min.z) / cellSize)}`;
    if (!cells.has(key)) cells.set(key, []);
    // Iterate the source index only once and retain its order inside each cell.
    cells.get(key).push(a, b, c);
  }
  const root = new T.Group(); root.name = 'terrain-spatial-clusters'; source.parent.add(root);
  const originallyVisible = source.visible, banks = [];
  let disposed = false;
  for (const [cell, indices] of cells) {
    const remap = new Map(), sourceVertices = [], localIndices = new Array(indices.length);
    indices.forEach((sourceIndex, offset) => {
      if (!remap.has(sourceIndex)) { remap.set(sourceIndex, sourceVertices.length); sourceVertices.push(sourceIndex); }
      localIndices[offset] = remap.get(sourceIndex);
    });
    const local = new T.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const array = new attribute.array.constructor(sourceVertices.length * attribute.itemSize);
      sourceVertices.forEach((sourceIndex, localIndex) => array.set(
        attribute.array.subarray(sourceIndex * attribute.itemSize, (sourceIndex + 1) * attribute.itemSize), localIndex * attribute.itemSize));
      const copied = new T.BufferAttribute(array, attribute.itemSize, attribute.normalized);
      copied.name = attribute.name; copied.gpuType = attribute.gpuType; copied.setUsage(attribute.usage);
      local.setAttribute(name, copied);
    }
    local.setIndex(localIndices);
    local.computeBoundingBox(); local.computeBoundingSphere();
    const bank = new T.Mesh(local, source.material); bank.name = `terrain:cell:${cell}`;
    bank.position.copy(source.position); bank.quaternion.copy(source.quaternion); bank.scale.copy(source.scale);
    bank.matrix.copy(source.matrix); bank.matrixAutoUpdate = source.matrixAutoUpdate;
    bank.castShadow = source.castShadow; bank.receiveShadow = source.receiveShadow;
    bank.frustumCulled = source.frustumCulled; bank.layers.mask = source.layers.mask; bank.renderOrder = source.renderOrder;
    bank.customDepthMaterial = source.customDepthMaterial; bank.customDistanceMaterial = source.customDistanceMaterial;
    bank.onBeforeRender = source.onBeforeRender; bank.onAfterRender = source.onAfterRender;
    bank.onBeforeShadow = source.onBeforeShadow; bank.onAfterShadow = source.onAfterShadow;
    bank.userData = {...source.userData, terrainCell: cell, terrainSourceVertexIndices: Uint32Array.from(sourceVertices)};
    root.add(bank); banks.push(bank);
  }

  function setEnabled(value) {
    if (disposed) return enabled;
    enabled = !!value; source.visible = originallyVisible && !enabled; root.visible = originallyVisible && enabled;
    return enabled;
  }
  function snapshot(camera) {
    let frustum = null;
    if (camera?.isCamera) {
      camera.updateWorldMatrix(true, false); root.updateWorldMatrix(true, true); source.updateWorldMatrix(true, false);
      frustum = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    }
    const inView = mesh => !frustum || !mesh.frustumCulled || frustum.intersectsObject(mesh);
    const visibleBanks = originallyVisible ? (enabled ? banks : [source]).filter(inView) : [];
    const triangleCount = mesh => Math.max(0, Math.min(mesh.geometry.index.count, mesh.geometry.drawRange.start + mesh.geometry.drawRange.count) - mesh.geometry.drawRange.start) / 3;
    return {enabled, cellSize, cells: banks.length, batches: visibleBanks.length,
      submittedTriangles: visibleBanks.reduce((n, bank) => n + triangleCount(bank), 0),
      originalTriangles: (end - start) / 3,
      originalVisibleTriangles: originallyVisible && inView(source) ? (end - start) / 3 : 0};
  }
  function dispose() {
    if (disposed) return;
    setEnabled(false); disposed = true;
    root.removeFromParent();
    // Each cell owns its copied buffers; disposing cannot invalidate the source
    // vertex buffers. The original material and geometry remain owned by world.
    for (const bank of banks) bank.geometry.dispose();
  }
  setEnabled(enabled);
  return {root, setEnabled, snapshot, dispose};
}
