import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {createMirrorAppearance} from './mirror-appearance.js';

/**
 * Renderer-only companion to lantern-game.js. Configuration positions are light
 * centres, not pedestal feet. game.data must already use the final ground Y.
 * handAnchor is an Object3D or a world-space vector; it is never reparented.
 * Call update after game.update. Returned colliders are live, mutable references.
 */
export function createLanternVisuals(scene, game, {
  groundHeight = () => 0, materials = {}, onPlatformMove = () => {}, renderBlockers = true,
} = {}) {
  const data = game.data, root = new T.Group(); root.name = 'lantern-adventure'; scene.add(root);
  const geometries = new Set(), ownedMaterials = new Set(), colliders = [], platforms = [], highlightRings = new Map();
  const owns = object => { (object.isMaterial ? ownedMaterials : geometries).add(object); return object; };
  const mat = options => owns(new T.MeshStandardMaterial(options));
  const copper = mat({ color: 0x785331, metalness: 0.8, roughness: 0.38 });
  const gold = mat({ color: 0xc4a56b, metalness: 0.75, roughness: 0.25 });
  const oxidized = mat({ color: 0x29463f, metalness: 0.62, roughness: 0.65 });
  const dark = mat({ color: 0x211e18, metalness: 0.32, roughness: 0.72 });
  const stone = materials.stone ? owns(materials.stone.clone()) : mat({ color: 0x9d8968, roughness: 0.93 });
  const darkStone = materials.darkstone ? owns(materials.darkstone.clone()) : mat({ color: 0x554a3c, roughness: 0.94 });
  const glass = owns(new T.MeshPhysicalMaterial({ color: 0xf5dda7, metalness: 0.08, roughness: 0.12,
    transparent: true, opacity: 0.23, depthWrite: false, side: T.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.08 }));
  const mirrorMaterial = owns(new T.MeshPhysicalMaterial({ color: 0xd8caa2, metalness: 0.94, roughness: 0.17,
    emissive: 0x927d43, emissiveIntensity: 0.085, clearcoat: 1 }));
  const flameMaterial = mat({ color: 0xffd698, emissive: 0xffb94f, emissiveIntensity: 4.5, roughness: 0.25 });
  const glowMaterial = owns(new T.MeshBasicMaterial({ color: 0xffcb79, transparent: true, opacity: 0.15,
    blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const unitY = new T.Vector3(0, 1, 0), unitZ = new T.Vector3(0, 0, 1), temp = new T.Vector3(), temp2 = new T.Vector3();
  const geo = geometry => owns(geometry);
  const box = (w, h, d, bevel = 0.015) => geo(new RoundedBoxGeometry(w, h, d, 2, Math.min(bevel, w / 4, h / 4, d / 4)));
  const cylinder = (top, bottom, height, sides = 12) => geo(new T.CylinderGeometry(top, bottom, height, sides));
  const ring = (radius, tube = 0.018) => geo(new T.TorusGeometry(radius, tube, 6, 32));
  const add = (parent, geometry, material, position = [0, 0, 0], rotation) => {
    if ((material === stone || material === darkStone) && !geometry.userData.metreUV) {
      const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
      if (uv) for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
        uv.setXY(i, (ax > ay && ax > az ? p.getZ(i) : p.getX(i)) * 0.5,
          (ay > ax && ay > az ? p.getZ(i) : p.getY(i)) * 0.5);
      }
      geometry.userData.metreUV = true;
    }
    const mesh = new T.Mesh(geometry, material); mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = !material.transparent; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const at = (parent, position) => { const group = new T.Group(); group.position.set(...position); parent.add(group); return group; };
  const flatRing = (parent, radius, material, position, tube) => add(parent, ring(radius, tube), material, position, [Math.PI / 2, 0, 0]);
  const collider = (id, x, y, z, w, h, d, yaw = 0) => {
    const value = { id, x, y, z, w, h, d, yaw, camera: true }; colliders.push(value); return value;
  };
  // Combining static metal/stone pieces avoids turning tiny details into draw calls.
  const batch = group => {
    const buckets = new Map(); group.updateMatrixWorld(true);
    for (const child of [...group.children]) {
      if (!child.isMesh || Array.isArray(child.material)) continue;
      const geometry = child.geometry.clone().applyMatrix4(child.matrix);
      const list = buckets.get(child.material) || []; list.push(geometry); buckets.set(child.material, list);
      group.remove(child);
    }
    for (const [material, list] of buckets) {
      const expanded = list.map(g => g.index ? g.toNonIndexed() : g);
      const merged = mergeGeometries(expanded, false);
      if (merged) add(group, geo(merged), material);
      for (const geometry of list) geometry.dispose();
      for (const geometry of expanded) if (!list.includes(geometry)) geometry.dispose();
    }
  };
  const highlight = (id, position, radius = 0.8) => {
    const material = owns(new T.MeshBasicMaterial({ color: 0xffdba2, transparent: true, opacity: 0,
      depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
    const mesh = add(root, geo(new T.RingGeometry(radius - 0.025, radius, 48)), material,
      [position[0], groundHeight(position[0], position[2]) + 0.045, position[2]], [-Math.PI / 2, 0, 0]);
    mesh.castShadow = false; mesh.name = `focus-${id}`; highlightRings.set(id, mesh);
  };

  const lampScale = Number.isFinite(data.lamp.scale) && data.lamp.scale > 0 ? data.lamp.scale : 1;
  const lantern = at(root, data.lamp.position); lantern.name = 'unique-copper-lantern'; lantern.scale.setScalar(lampScale);
  const cage = at(lantern, [0, 0, 0]);
  add(cage, cylinder(0.205, 0.22, 0.065, 8), copper, [0, -0.205, 0]);
  add(cage, cylinder(0.18, 0.19, 0.035, 8), gold, [0, -0.245, 0]);
  add(cage, cylinder(0.125, 0.23, 0.105, 8), copper, [0, 0.225, 0]);
  add(cage, cylinder(0.07, 0.11, 0.07, 8), dark, [0, 0.31, 0]);
  flatRing(cage, 0.175, gold, [0, 0.168, 0], 0.013);
  flatRing(cage, 0.175, gold, [0, -0.155, 0], 0.013);
  for (const x of [-0.14, 0.14]) for (const z of [-0.14, 0.14]) {
    add(cage, box(0.022, 0.35, 0.022, 0.005), gold, [x, 0.005, z]);
    add(cage, geo(new T.SphereGeometry(0.022, 8, 6)), copper, [x, -0.185, z]);
  }
  add(cage, ring(0.1, 0.013), gold, [0, 0.415, 0]);
  // Three small feet put the authored light centre 0.35 m above the ground.
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    add(cage, box(0.035, 0.1, 0.045, 0.008), copper, [Math.cos(a) * 0.16, -0.3, Math.sin(a) * 0.16], [0, -a, 0]);
  }
  add(cage, box(0.285, 0.315, 0.285, 0.025), glass);
  batch(cage);
  const flame = add(lantern, geo(new T.IcosahedronGeometry(0.072, 1)), flameMaterial, [0, -0.02, 0]); flame.scale.set(0.7, 1.7, 0.7);
  const aura = add(lantern, geo(new T.SphereGeometry(0.115, 12, 10)), glowMaterial); aura.castShadow = false;
  const lanternLight = new T.PointLight(0xffbd68, 7.5 * lampScale * lampScale, 11 * lampScale, 2); lanternLight.position.set(0, 0.025, 0); lantern.add(lanternLight);
  highlight(data.lamp.id, data.lamp.position, 0.55);

  const pedestalNodes = new Map(), mirrorNodes = new Map(), terminalNodes = new Map(), gateNodes = new Map();
  for (const area of data.areas) {
    for (const blocker of area.blockers) {
      const size = blocker.max.map((v, i) => v - blocker.min[i]), center = blocker.min.map((v, i) => v + size[i] / 2);
      if (renderBlockers && blocker.visual !== false) {
        if (blocker.id === 'city-fallen-column') {
          const obstruction = at(root, center); obstruction.name = blocker.id;
          // A fallen octagonal stone beam is partly buried in the stair flight.
          // All detail stays inside the existing 3 x 5 x 3 m rule/collision box.
          add(obstruction, box(2.85, 3.05, 2.8, 0.16), stone, [0, -0.975, 0]);
          const profile = [[-1.25,-1.18],[-1,-1.5],[0.76,-1.5],[1,-1.17],
            [1,1.12],[0.73,1.5],[-0.98,1.5],[-1.25,1.18]];
          const sections = [[-1.5,0.96],[-1.3,1],[-1.2,1],[-1.12,0.94],
            [-1.02,0.94],[-0.92,1],[0.84,1],[0.94,0.94],[1.04,0.94],[1.14,1],[1.5,0.97]];
          const fracture = [0,-0.14,-0.36,-0.2,0,-0.25,-0.1,-0.3];
          const leftChips = [0.15,0,0.12,0,0.05,0.2,0.09,0];
          const point = (section, i) => {
            const [x, scale] = sections[section], [y, z] = profile[i];
            return [x + (section === 0 ? leftChips[i] : section === sections.length - 1 ? fracture[i] : 0),
              1.5 + y * scale, z * scale];
          };
          const faces = [], cuts = [], triangle = (target, a, b, c) => target.push(...a, ...b, ...c);
          for (let s = 0; s < sections.length - 1; s++) for (let i = 0; i < profile.length; i++) {
            const next = (i + 1) % profile.length, a = point(s, i), b = point(s, next), c = point(s + 1, next), d = point(s + 1, i);
            const target = s === 3 || s === 7 ? cuts : faces;
            triangle(target, a, b, c); triangle(target, a, c, d);
          }
          for (let i = 0; i < profile.length; i++) {
            const next = (i + 1) % profile.length;
            triangle(faces, [-1.43,1.35,-0.08], point(0,next), point(0,i));
            // Uneven cap triangles give the broken end real faceted relief.
            triangle(faces, [1.25,1.39,-0.12], point(sections.length-1,i), point(sections.length-1,next));
          }
          for (const [positions, material] of [[faces,stone],[cuts,darkStone]]) {
            const geometry = geo(new T.BufferGeometry());
            geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
            geometry.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(positions.length/3*2),2));
            geometry.computeVertexNormals(); add(obstruction,geometry,material);
          }
          batch(obstruction);
        } else if (['oasis-west-rock','oasis-north-rock','oasis-canyon-wall'].includes(blocker.id)) {
          const obstruction = at(root, center); obstruction.name = blocker.id;
          const west = blocker.id === 'oasis-west-rock', canyon = blocker.id === 'oasis-canyon-wall';
          const ridge = west ? [.4,.52,.67,.61,.76,.82,1,.91,.67,.77,.54,.48,.38]
            : canyon ? [.58,.68,.62,.73,.82,.78,1,.94,.81,.71,.69,.87,.78,.59,.53,.64,.48,.4,.31]
              : [.5,.63,.75,1,.94,.58,.45];
          const levels = [0,.12,.24,.28,.31,.46,.5,.53,.69,.77,.8,1];
          const source = new T.BoxGeometry(...size,4,levels.length-1,ridge.length-1);
          const sourcePosition = source.attributes.position, vertices = [], strata = [];
          // Erode into the authored footprint, never outside it. The original
          // base perimeter and one crown peak retain all six exact AABB limits.
          for (let i = 0; i < sourcePosition.count; i++) {
            const u = sourcePosition.getX(i)/size[0]+.5, q = sourcePosition.getZ(i)/size[2]+.5;
            const row = Math.round((sourcePosition.getY(i)/size[1]+.5)*(levels.length-1));
            const v = levels[row], crest = ridge[Math.round(q*(ridge.length-1))];
            const crown = crest*(1-.3*Math.abs(u-.5)), y = v*size[1]*crown;
            const groove = row === 3 || row === 6 ? .025 : 0;
            const erosion = Math.pow(v,.85)*(.07+.045*Math.sin(q*11+v*5)**2+.12*v)+groove;
            let x = (u-.5)*size[0]*(1-2*erosion)+size[0]*.035*Math.sin(q*8+v*5)*v;
            const z = (q-.5)*size[2]*(1-2*(.025*v+.022*v*Math.sin(u*9+v*6)**2));
            // Actual wrong-turn rays terminate at these intact low cliff faces:
            // west mirror -> x=19, east mirror -> x=78. Keep the full hit panel
            // coplanar while the taller, distant silhouette breaks into spurs.
            if (west && u === 1 && v <= .46) x = size[0]/2;
            if (canyon && u === 0 && q >= .7 && v <= .46) x = -size[0]/2;
            vertices.push([x,y-size[1]/2,z]); strata.push(v);
          }
          const faces = [], seams = [], index = source.index;
          for (let i = 0; i < index.count; i += 3) {
            const ids = [index.getX(i),index.getX(i+1),index.getX(i+2)];
            const low = Math.min(...ids.map(j=>strata[j])), high = Math.max(...ids.map(j=>strata[j]));
            // Two narrow recessed sediment seams share the existing dark stone
            // material. Geometry supplies depth; there are no dark decal planes.
            const target = low >= .24 && high <= .28 || low >= .46 && high <= .5 ? seams : faces;
            for (const id of ids) target.push(...vertices[id]);
          }
          source.dispose();
          for (const [positions, material] of [[faces,stone],[seams,darkStone]]) {
            const geometry = geo(new T.BufferGeometry());
            geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
            geometry.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(positions.length/3*2),2));
            geometry.computeVertexNormals(); add(obstruction,geometry,material);
          }
        } else {
          const obstruction = add(root, box(...size, 0.07), darkStone, center); obstruction.name = blocker.id;
        }
      }
      collider(blocker.id, center[0], blocker.min[1], center[2], size[0], size[1], size[2]);
    }
    for (const socket of area.sockets) {
      const baseY = groundHeight(socket.position[0], socket.position[2]), core = socket.beamOrigin || socket.position;
      const pedestal = at(root, [socket.position[0], baseY, socket.position[2]]); pedestal.name = socket.id;
      const height = Math.max(0.3, core[1] - baseY - 0.35 * lampScale - 0.0425);
      add(pedestal, cylinder(0.55, 0.67, 0.19, 8), darkStone, [0, 0.095, 0]);
      add(pedestal, cylinder(0.37, 0.49, Math.max(0.1, height - 0.22), 8), stone, [0, (height + 0.18) / 2, 0]);
      add(pedestal, cylinder(0.47, 0.4, 0.085, 8), copper, [0, height, 0]);
      flatRing(pedestal, 0.37, gold, [0, height + 0.055, 0], 0.021);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        add(pedestal, box(0.027, Math.max(0.1, height - 0.3), 0.024, 0.006), oxidized,
          [Math.cos(angle) * 0.397, height / 2 + 0.05, Math.sin(angle) * 0.397], [0, -angle, 0]);
      }
      const optics = at(root, core); optics.quaternion.setFromUnitVectors(unitZ, temp.set(...socket.direction).normalize());
      add(optics, ring(0.24, 0.025), copper, [0, 0, 0.4]);
      add(optics, ring(0.214, 0.008), gold, [0, 0, 0.414]);
      add(optics, geo(new T.CircleGeometry(0.205, 32)), glass, [0, 0, 0.408]);
      // A pair of bronze stays gives the tilted glass lens a physical support.
      for (const side of [-1,1]) {
        const a=new T.Vector3(side*.34,height,0);
        const b=new T.Vector3(side*.24,0,.4).applyQuaternion(optics.quaternion).add(new T.Vector3(0,core[1]-baseY,0));
        const delta=b.clone().sub(a),mid=a.clone().add(b).multiplyScalar(.5);
        const stay=add(pedestal,cylinder(.018,.022,delta.length(),8),copper,mid.toArray());
        stay.quaternion.setFromUnitVectors(unitY,delta.normalize());
      }
      batch(pedestal);batch(optics);
      collider(socket.id, socket.position[0], baseY, socket.position[2], 1.03, height + 0.08, 1.03);
      highlight(socket.id, socket.position);
      pedestalNodes.set(socket.id, { group: pedestal, optics });
    }
    for (const mirror of area.mirrors) {
      const baseY = groundHeight(mirror.position[0], mirror.position[2]), height = mirror.position[1] - baseY;
      const pedestal = at(root, [mirror.position[0], baseY, mirror.position[2]]); pedestal.name = `${mirror.id}-base`;
      add(pedestal, cylinder(0.62, 0.78, 0.2, 8), darkStone, [0, 0.1, 0]);
      add(pedestal, cylinder(0.22, 0.3, Math.max(0.18, height - 0.65), 8), stone, [0, Math.max(0.22, (height - 0.4) / 2), 0]);
      for (const side of [-1, 1]) add(pedestal, box(0.075, 0.75, 0.11), copper, [side * 0.68, height - 0.18, 0], [0, 0, -side * 0.11]);
      flatRing(pedestal, 0.56, gold, [0, 0.225, 0], 0.012);
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3;
        add(pedestal, box(0.07, 0.023, 0.2, 0.006), gold, [Math.sin(a) * 0.57, 0.23, Math.cos(a) * 0.57], [0, a, 0]);
      }
      batch(pedestal);
      const disc = at(root, mirror.position); disc.name = mirror.id;
      add(disc, ring(0.59, 0.05), copper);
      add(disc, ring(0.535, 0.008), gold, [0, 0, 0.015]);
      add(disc, geo(new T.CircleGeometry(0.53, 48)), mirrorMaterial, [0, 0, 0.018]);
      add(disc, geo(new T.CircleGeometry(0.54, 32)), oxidized, [0, 0, -0.027], [0, Math.PI, 0]);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; add(disc, geo(new T.SphereGeometry(0.026, 8, 6)), gold, [Math.cos(a) * 0.59, Math.sin(a) * 0.59, 0.043]); }
      batch(disc);
      collider(mirror.id, mirror.position[0], baseY, mirror.position[2], 1.15, Math.max(1, height - 0.7), 1.15);
      highlight(mirror.id, mirror.position, 0.95);
      mirrorNodes.set(mirror.id, { disc, mirror, area, target: new T.Quaternion(), turn: -1 });
    }
    const target = area.terminal, crystalRoot = at(root, target.position); crystalRoot.name = target.id;
    const cradle = at(crystalRoot, [0, 0, 0]);
    add(cradle, ring(0.85, 0.055), copper);
    add(cradle, ring(1.02, 0.018), gold);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; add(cradle, box(0.1, 0.42, 0.16), copper, [Math.sin(a) * 0.73, Math.cos(a) * 0.73, 0], [0, 0, -a]); }
    batch(cradle);
    const crystalMat = owns(new T.MeshPhysicalMaterial({ color: 0x98bbba, metalness: 0.18, roughness: 0.15,
      emissive: 0xf8bd69, emissiveIntensity: 0.025, clearcoat: 1 }));
    const crystal = add(crystalRoot, geo(new T.OctahedronGeometry(0.54, 0)), crystalMat); crystal.scale.set(0.62, 1.45, 0.65);
    const crystalGlow = add(crystalRoot, geo(new T.SphereGeometry(0.7, 16, 10)), owns(glowMaterial.clone())); crystalGlow.material.opacity = 0;
    const light = new T.PointLight(0xffc681, 0, 14, 2); crystalRoot.add(light);
    const spokes = [];
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, m = owns(new T.MeshBasicMaterial({ color: 0xffdda4, transparent: true, opacity: 0.03, toneMapped: false }));
      spokes.push(add(crystalRoot, box(0.045, 0.21, 0.035, 0.008), m, [Math.sin(a) * 0.98, Math.cos(a) * 0.98, 0.065], [0, 0, -a]));
    }
    terminalNodes.set(area.id, { root: crystalRoot, crystal, crystalMat, crystalGlow, light, spokes, fill: 0 });
    if (!area.gate) continue;
    const gate = area.gate, kind = gate.kind || (area.id === 'oasis' ? 'channels' : 'door');
    if (kind === 'door') {
      const width = gate.width || 10.6, height = gate.height || 6.9, depth = gate.depth || 0.44;
      const frame = at(root, gate.position); frame.rotation.y = gate.yaw || 0; frame.name = `${gate.id}-frame`;
      for (const side of [-1, 1]) {
        const offset = side * (width / 2 + 0.15), yaw = gate.yaw || 0;
        add(frame, box(0.3, height + 0.25, depth + 0.3), darkStone, [offset, height / 2, 0]);
        collider(`${gate.id}-post-${side < 0 ? 'left' : 'right'}`, gate.position[0] + offset * Math.cos(yaw), gate.position[1] - 0.125,
          gate.position[2] - offset * Math.sin(yaw), 0.3, height + 0.25, depth + 0.3, yaw);
      }
      add(frame, box(width + 0.62, 0.38, depth + 0.32), darkStone, [0, height + 0.18, 0]);
      collider(`${gate.id}-lintel`, gate.position[0], gate.position[1] + height - 0.01, gate.position[2], width + 0.62, 0.38, depth + 0.32, gate.yaw || 0);
      batch(frame);
      const leaf = at(frame, [0, 0, 0]); leaf.name = gate.id;
      add(leaf, box(width, height, depth, 0.07), darkStone, [0, height / 2, 0]);
      for (const x of [-width * 0.44, 0, width * 0.44]) add(leaf, box(0.085, height - 0.24, 0.055), copper, [x, height / 2, depth / 2 + 0.016]);
      for (const y of [0.3, height - 0.3]) add(leaf, box(width - 0.24, 0.085, 0.055), gold, [0, y, depth / 2 + 0.016]);
      add(leaf, ring(0.65, 0.026), copper, [0, height * 0.58, depth / 2 + 0.05]);
      add(leaf, ring(0.46, 0.013), gold, [0, height * 0.58, depth / 2 + 0.075]);
      for (const x of [-width * 0.25, width * 0.25]) for (let i = 0; i < 5; i++) {
        add(leaf, box(0.31, 0.027, 0.025, 0.004), copper, [x, 1.1 + i * 0.62, depth / 2 + 0.029], [0, 0, (i % 2 ? -1 : 1) * 0.5]);
      }
      batch(leaf);
      // The rising slab enters the lintel gradually. Clip only this leaf's
      // cloned materials (including its shadow), so opening the door cannot
      // draw a second wall above the frame and then pop it out in one frame.
      const lintelPlane = new T.Plane(new T.Vector3(0, -1, 0), gate.position[1] + height + 0.01);
      const leafMaterials = new Map();
      leaf.traverse(mesh => {
        if (!mesh.isMesh) return;
        const clipped = material => {
          if (!leafMaterials.has(material)) {
            const copy = owns(material.clone()); copy.clippingPlanes = [lintelPlane]; copy.clipShadows = true;
            leafMaterials.set(material, copy);
          }
          return leafMaterials.get(material);
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clipped) : clipped(mesh.material);
      });
      const c = collider(gate.id, gate.position[0], gate.position[1], gate.position[2], width, height, depth, gate.yaw || 0);
      gateNodes.set(gate.id, { kind, leaf, progress: 0, height, rise: gate.openingHeight || height + 0.3, baseY: gate.position[1], collider: c });
    } else if (kind === 'lift') {
      const width = gate.width || 4.5, depth = gate.depth || 4.5, rise = gate.rise || 13;
      const lift = at(root, gate.position); lift.name = gate.id;
      add(lift, box(width, 0.28, depth, 0.06), darkStone, [0, -0.14, 0]);
      for (const side of [-1, 1]) add(lift, box(0.07, 0.045, depth - 0.18), gold, [side * (width / 2 - 0.15), 0.02, 0]);
      add(lift, geo(new T.RingGeometry(0.72, 0.76, 36)), gold, [0, 0.025, 0], [-Math.PI / 2, 0, 0]);
      batch(lift);
      for (const side of [-1, 1]) {
        add(root, cylinder(0.1, 0.13, rise + 2, 8), copper,
          [gate.position[0] + side * (width / 2 + 0.24), gate.position[1] + rise / 2, gate.position[2]]);
      }
      const platform = { id: gate.id, x: gate.position[0], z: gate.position[2], w: width, d: depth, y: gate.position[1], baseY: gate.position[1], rise, progress: 0 };
      platforms.push(platform);
      gateNodes.set(gate.id, { kind, lift, platform, progress: 0 });
    } else {
      const channels = [], channelMaterial = owns(new T.MeshBasicMaterial({ color: 0xffcf7c, transparent: true,
        opacity: 0, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
      for (let i = 0; i < 22; i++) {
        const angle = -0.8 + i / 21 * 1.75, x = 45 - Math.cos(angle) * 25.5, z = 5 + Math.sin(angle) * 36;
        const mesh = add(root, box(0.075, 0.025, 1.65, 0.007), channelMaterial,
          [x, Math.max(-0.42, groundHeight(x, z) + 0.045), z], [0, -angle, 0]);
        channels.push(mesh);
      }
      gateNodes.set(gate.id, { kind, channels, material: channelMaterial, progress: 0 });
    }
  }

  const beamHaloMaterial = owns(new T.ShaderMaterial({
    uniforms: { tint: { value: new T.Color(0xffc880) }, opacity: { value: 0.12 } },
    vertexShader: 'varying vec3 vN;varying vec3 vV;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=-mv.xyz;gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'uniform vec3 tint;uniform float opacity;varying vec3 vN;varying vec3 vV;void main(){float edge=pow(abs(dot(normalize(vN),normalize(vV))),2.);gl_FragColor=vec4(tint,opacity*edge);}',
    transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false,
  }));
  const beamCoreMaterial = owns(new T.MeshBasicMaterial({ color: 0xffe0ae, transparent: true,
    opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const beamGeometry = cylinder(1, 1, 1, 12), beams = [], maxSegments = Math.max(...data.areas.map(a => a.mirrors.length)) + 2;
  for (let i = 0; i < maxSegments; i++) {
    const group = at(root, [0, 0, 0]); group.visible = false;
    const core = add(group, beamGeometry, beamCoreMaterial); core.castShadow = false;
    const halo = add(group, beamGeometry, beamHaloMaterial); halo.castShadow = false;
    const impact = add(root, geo(new T.SphereGeometry(0.095, 12, 8)), glowMaterial); impact.visible = false; impact.castShadow = false;
    beams.push({ group, core, halo, impact });
  }
  let beamKey = '', initialized = false, disposed = false;
  const handGrip = new T.Vector3(0, 0.515 * lampScale, 0), gripWorldOffset = new T.Vector3(), lanternTarget = new T.Vector3(), transferStart = new T.Vector3();
  let lastLampKey = null, transferTime = 1, transferDuration = 0.3;
  const placeBeams = paths => {
    const segments = paths.flatMap(path => path.segments), key = JSON.stringify(segments);
    if (key === beamKey) return;
    beamKey = key;
    for (let i = 0; i < beams.length; i++) {
      const beam = beams[i], segment = segments[i]; beam.group.visible = !!segment; beam.impact.visible = !!segment && segment.hitType !== 'air';
      if (!segment) continue;
      temp.set(...segment.to).sub(temp2.set(...segment.from)); const length = temp.length();
      beam.group.position.copy(temp2).addScaledVector(temp, 0.5);
      beam.group.quaternion.setFromUnitVectors(unitY, temp.normalize());
      beam.core.scale.set(0.012, length, 0.012); beam.halo.scale.set(0.11, length, 0.11);
      beam.impact.position.set(...segment.to); beam.impact.scale.setScalar(segment.hitType === 'blocker' ? 1.5 : 0.9);
    }
  };
  const readHand = (anchor, fallback) => {
    if (anchor?.getWorldPosition) { anchor.updateWorldMatrix(true, false); return anchor.getWorldPosition(temp); }
    if (Array.isArray(anchor)) return temp.set(...anchor);
    if (anchor && Number.isFinite(anchor.x)) return temp.copy(anchor);
    return temp.set(fallback[0] + 0.4, fallback[1] + 1.5, fallback[2] + 0.1);
  };
  const update = (dt = 0, elapsed = 0, { player, handAnchor, highlightId = null } = {}) => {
    if (disposed) return;
    const state = game.state, paths = game.getBeamPaths(), step = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1));
    const motion = Number.isFinite(player?.speed) ? player.speed : 0;
    if (state.lamp.location === 'player') {
      lantern.rotation.set(Math.sin(elapsed * 6) * Math.min(0.09, motion * 0.014), player?.heading || 0,
        Math.sin(elapsed * 3.7) * Math.min(0.07, motion * 0.012));
      // Subtract the rotated grip point, keeping the top of the handle exactly
      // in the hand while the body hangs/sways beneath it in world metres.
      lanternTarget.copy(readHand(handAnchor, state.playerPosition));
      lanternTarget.sub(gripWorldOffset.copy(handGrip).applyQuaternion(lantern.quaternion));
    } else {
      lanternTarget.set(...state.lamp.position);
      if (state.lamp.location === 'ground') lanternTarget.y = Math.max(data.lamp.position[1], groundHeight(data.lamp.position[0], data.lamp.position[2]) + 0.35 * lampScale);
      else { const socket = data.areas.flatMap(a => a.sockets).find(s => s.id === state.lamp.socketId); if (socket?.beamOrigin) lanternTarget.set(...socket.beamOrigin); }
      lantern.rotation.set(0, 0.18, 0);
    }
    const lampKey = `${state.lamp.location}:${state.lamp.socketId || ''}`;
    if (lampKey !== lastLampKey) {
      transferStart.copy(lantern.position);
      transferTime = initialized && transferStart.distanceTo(lanternTarget) < 8 ? 0 : 1;
      transferDuration = state.lamp.location === 'socket' ? 0.34 : 0.28;
      lastLampKey = lampKey;
    }
    transferTime = Math.min(1, transferTime + step / transferDuration);
    if (transferTime >= 1) lantern.position.copy(lanternTarget);
    else {
      lantern.position.lerpVectors(transferStart, lanternTarget, T.MathUtils.smoothstep(transferTime, 0, 1));
      lantern.position.y += Math.sin(transferTime * Math.PI) * 0.09;
    }
    flame.scale.y = 1.7 + Math.sin(elapsed * 8.3) * 0.13 + Math.sin(elapsed * 14.7) * 0.04;
    lanternLight.intensity = (7.1 + Math.sin(elapsed * 8.3) * 0.35) * lampScale * lampScale;
    for (const [id, ringMesh] of highlightRings) {
      const goal = id === highlightId ? 0.8 : 0;
      ringMesh.material.opacity += (goal - ringMesh.material.opacity) * (1 - Math.exp(-step * 16));
      ringMesh.visible = ringMesh.material.opacity > 0.005;
    }
    for (const [id, node] of mirrorNodes) {
      const turn = state.mirrorTurns[id];
      const incomingSegment = paths.flatMap(path => path.segments).find(segment => segment.hitId === id);
      const source = incomingSegment?.from || node.area.sockets[0].beamOrigin || node.area.sockets[0].position;
      const incoming = temp.set(...node.mirror.position).sub(temp2.set(...source)).normalize();
      const outgoing = temp2.set(...node.mirror.directions[turn]).normalize();
      // The polished face points toward the arriving ray, not toward its back.
      const normal = outgoing.sub(incoming).normalize();
      if (normal.lengthSq() < 0.001) normal.set(0, 0, 1);
      node.target.setFromUnitVectors(unitZ, normal);
      if (!initialized) node.disc.quaternion.copy(node.target);
      else node.disc.quaternion.slerp(node.target, 1 - Math.exp(-step * 13));
      node.turn = turn;
    }
    for (const [id, node] of terminalNodes) {
      const completed = state.completed.includes(id), desired = completed ? 1 : state.chargeProgress[id];
      node.fill += (desired - node.fill) * (initialized ? 1 - Math.exp(-step * 10) : 1);
      node.crystalMat.emissiveIntensity = 0.025 + node.fill * 2.9;
      node.crystalGlow.material.opacity = node.fill * 0.15;
      node.light.intensity = node.fill * 4.2;
      node.light.visible = node.fill > .01;
      node.crystal.rotation.y = elapsed * (completed ? 0.17 : 0.025);
      for (let i = 0; i < node.spokes.length; i++) node.spokes[i].material.opacity = node.fill >= (i + 1) / 8 ? 0.95 : 0.035;
    }
    for (const [id, node] of gateNodes) {
      const open = state.gates[id] === 'open';
      const previous = node.progress;
      node.progress = initialized ? T.MathUtils.clamp(node.progress + (open ? 1 : -1) * step / (node.kind === 'lift' ? 7 : 3.2), 0, 1) : (open ? 1 : 0);
      const eased = T.MathUtils.smoothstep(node.progress, 0, 1);
      if (node.kind === 'door') {
        node.leaf.position.y = eased * node.rise;
        node.collider.y = node.baseY + node.leaf.position.y;
        node.collider.h = eased < 0.9999 ? node.height : 0;
        node.collider.camera = eased < 0.99;
        // At the end of the travel the slab has entered its lintel cavity;
        // it must not remain as a free-floating second wall above the opening.
        node.leaf.visible = eased < 0.9999;
      } else if (node.kind === 'lift') {
        const oldY = node.platform.y;
        node.platform.y = node.platform.baseY + eased * node.platform.rise; node.platform.progress = node.progress;
        node.lift.position.y = node.platform.y;
        if (initialized && Math.abs(oldY - node.platform.y) > 1e-6) onPlatformMove({ ...node.platform, deltaY: node.platform.y - oldY, previousY: oldY });
      } else node.material.opacity = eased * (0.68 + Math.sin(elapsed * 1.2) * 0.05);
      if (previous === node.progress) continue;
    }
    placeBeams(paths); initialized = true;
  };
  const getSurfaceHeight = (x, z, baseHeight) => {
    let height = baseHeight;
    for (const platform of platforms) if (Math.abs(x - platform.x) < platform.w / 2 && Math.abs(z - platform.z) < platform.d / 2) height = Math.max(height, platform.y);
    return height;
  };
  const mirrorAppearance=createMirrorAppearance(scene,{mirrors:[...mirrorNodes.values()].map(node=>node.disc),frontMaterial:mirrorMaterial,backMaterial:oxidized});
  const dispose = () => {
    if (disposed) return; disposed = true; scene.remove(root);
    mirrorAppearance.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of ownedMaterials) material.dispose();
  };
  update(0, 0);
  return { root, lantern, colliders, platforms, update, getSurfaceHeight, mirrorAppearance, dispose };
}
