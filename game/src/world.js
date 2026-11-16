// The Foundry Yard: an original dusk smelting yard built from boxes and canvas
// textures. The Kindled attack from the west yard; the Wardens hold the Crucible
// — a furnace platform in the east — where the Charge is planted. Three lanes
// join them: the open Casting Hall in the north, the container yard in the
// middle, and the Slag Run corridor in the south. Every solid is an AABB in
// `colliders` (the same list physics, bullets and bot sight all test against),
// and the nav graph's links are verified against those boxes before use.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeBox } from './physics.js';
import { createNav } from './nav.js';

function canvasTexture(size, draw, repeat) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

function asphaltTexture() {
  return canvasTexture(1024, (g, s) => {
    g.fillStyle = '#33363d';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 5200; i++) {
      g.fillStyle = `rgba(${20 + Math.random() * 40},${22 + Math.random() * 40},${26 + Math.random() * 44},0.25)`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo((s / 4) * i, 0); g.lineTo((s / 4) * i, s); g.stroke();
      g.beginPath(); g.moveTo(0, (s / 4) * i); g.lineTo(s, (s / 4) * i); g.stroke();
    }
    g.strokeStyle = 'rgba(216,160,34,0.5)';
    g.lineWidth = 5;
    g.setLineDash([26, 18]);
    g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  }, [6, 5]);
}

function ribbedTexture(base, rib) {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    g.fillStyle = rib;
    for (let x = 12; x < s; x += 32) g.fillRect(x, 0, 9, s);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, 0, s, 10);
    g.fillRect(0, s - 10, s, 10);
  });
}

function woodTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#6e5133';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(40,26,12,0.55)';
    g.lineWidth = 4;
    for (let y = 30; y < s; y += 44) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y + 8); g.stroke(); }
    g.strokeStyle = 'rgba(30,20,10,0.8)';
    g.lineWidth = 10;
    g.strokeRect(0, 0, s, s);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s); g.stroke();
  });
}

function wallTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#4a4f57';
    g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < s; y += 64) g.fillRect(0, y, s, 4);
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.16})`;
      g.fillRect(Math.random() * s, Math.random() * s, 3, 3);
    }
    g.fillStyle = 'rgba(255,122,38,0.75)';
    g.fillRect(0, s - 26, s, 8);
  }, [4, 1]);
}

export function createWorld(scene) {
  const colliders = [];
  const group = new THREE.Group();
  scene.add(group);

  const texAsphalt = asphaltTexture();
  const texWall = wallTexture();
  const texWood = woodTexture();
  const matGround = new THREE.MeshStandardMaterial({ map: texAsphalt, roughness: 0.96 });
  const matWall = new THREE.MeshStandardMaterial({ map: texWall, roughness: 0.9 });
  const matConcrete = new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.95 });
  const matConcreteDark = new THREE.MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.95 });
  const matMetal = new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.6, metalness: 0.55 });
  const matMetalLight = new THREE.MeshStandardMaterial({ color: PALETTE.metalLight, roughness: 0.5, metalness: 0.6 });
  const matWood = new THREE.MeshStandardMaterial({ map: texWood, roughness: 0.9 });
  const matRust = new THREE.MeshStandardMaterial({ map: ribbedTexture('#7c4526', 'rgba(0,0,0,0.3)'), roughness: 0.8, metalness: 0.3 });
  const matTealBox = new THREE.MeshStandardMaterial({ map: ribbedTexture('#20555a', 'rgba(0,0,0,0.3)'), roughness: 0.8, metalness: 0.3 });
  const matGreyBox = new THREE.MeshStandardMaterial({ map: ribbedTexture('#565d66', 'rgba(0,0,0,0.32)'), roughness: 0.8, metalness: 0.3 });
  function solid(mat, x0, y0, z0, x1, y1, z1, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(makeBox(x0, y0, z0, x1, y1, z1));
    return mesh;
  }
  const wall = (x, z, w, d, h = 4.4) => solid(matWall, x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2);
  const crate = (x, z, s = 1.2, levels = 1) => { for (let i = 0; i < levels; i++) solid(matWood, x - s / 2, i * s, z - s / 2, x + s / 2, (i + 1) * s, z + s / 2); };
  const barrier = (x, z, alongX = true) => (alongX
    ? solid(matConcrete, x - 1.1, 0, z - 0.3, x + 1.1, 1.05, z + 0.3)
    : solid(matConcrete, x - 0.3, 0, z - 1.1, x + 0.3, 1.05, z + 1.1));
  const container = (mat, x, z, alongX = true) => {
    if (alongX) solid(mat, x - 3, 0, z - 1.2, x + 3, 2.6, z + 1.2);
    else solid(mat, x - 1.2, 0, z - 3, x + 1.2, 2.6, z + 3);
  };
  function barrel(x, z, glow = false) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.95, 12),
      glow ? new THREE.MeshStandardMaterial({ color: 0x5a2c10, emissive: PALETTE.ember, emissiveIntensity: 0.35, roughness: 0.7 })
        : matMetalLight,
    );
    m.position.set(x, 0.48, z);
    m.castShadow = true;
    group.add(m);
    colliders.push(makeBox(x - 0.36, 0, z - 0.36, x + 0.36, 0.95, z + 0.36));
  }

  // --- Ground and sky dressing -------------------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(76, 56), matGround);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, PALETTE.fogNear, PALETTE.fogFar);
  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, PALETTE.hemiIntensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, PALETTE.sunIntensity);
  sun.position.set(-28, 34, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -42; sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  // Distant factory silhouettes beyond the walls (no colliders; pure skyline).
  const matFar = new THREE.MeshBasicMaterial({ color: 0x1a1f2a });
  for (const [x, z, w, h, d] of [[-46, -20, 14, 17, 10], [-44, 14, 10, 12, 12], [46, -18, 16, 21, 10], [44, 16, 12, 14, 10], [0, -38, 30, 13, 8], [-20, 36, 22, 10, 8], [24, 37, 18, 15, 8]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matFar);
    m.position.set(x, h / 2, z);
    group.add(m);
  }

  // --- Perimeter ---------------------------------------------------------------
  wall(0, -26.5, 76, 1, 5.4);
  wall(0, 26.5, 76, 1, 5.4);
  wall(-36.5, 0, 1, 54, 5.4);
  wall(36.5, 0, 1, 54, 5.4);

  // --- Casting Hall (north lane): shell with three doorways --------------------
  wall(-2, -24.4, 28, 0.8, 4.6); // north side
  wall(-15.4, -19, 0.8, 4.4, 4.6); // west upper segment
  wall(-15.4, -15.6, 0.8, 2.4, 4.6); // west lower segment (doorway between)
  wall(11.4, -21.4, 0.8, 5.2, 4.6); // east upper segment
  wall(11.4, -15.2, 0.8, 1.6, 4.6); // east lower segment (doorway between)
  wall(-10.5, -13.6, 9.2, 0.8, 4.6); // south-west segment
  wall(6, -13.6, 10, 0.8, 4.6); // south-east segment (doorway at x -5.6..1)
  // Roof beams and a partial slab: silhouette without darkening the hall.
  for (const bx of [-12, -4, 4]) solid(matMetal, bx - 0.3, 4.4, -24, bx + 0.3, 4.75, -14, false);
  solid(matMetal, -14, 4.6, -24, 0, 4.85, -14, false);
  // Inside the hall: casting moulds and pillars as cover.
  solid(matConcreteDark, -9, 0, -20.5, -5, 1.5, -17.5);
  solid(matConcreteDark, 2, 0, -21, 6, 1.5, -18);
  crate(6.5, -16, 1.2, 2);
  crate(-11, -16.5, 1.2, 1);
  barrier(-2, -20, false);
  barrel(-13, -22.5);
  barrel(9, -15.5, true);

  // --- Mid yard: containers and crate stacks ------------------------------------
  container(matRust, -6, -8.5);
  container(matTealBox, 3, 9, false);
  container(matGreyBox, 8, -9.5, false);
  container(matRust, -13, 7.5);
  solid(matGreyBox, -6.2, 2.6, -9.7, -0.2, 5.2, -7.3); // stacked container over the rust one, offset
  crate(-1, -3, 1.2, 2);
  crate(0.4, -3.1, 1.2, 1);
  crate(-8, 2, 1.2, 1);
  crate(5, -2, 1.2, 2);
  crate(12, 2.5, 1.2, 1);
  barrier(-3, 5.5);
  barrier(7, 6.5, false);
  barrel(-11, -4);
  barrel(13.5, -5.5);
  barrel(1.5, 13.5, true);

  // --- Slag Run (south lane) ------------------------------------------------------
  // North wall of the run, in segments so two real gaps open into mid.
  wall(-14, 15.2, 12, 0.8, 4.2);
  wall(0.5, 15.2, 11, 0.8, 4.2);
  wall(13.5, 15.2, 9, 0.8, 4.2);
  wall(-19, 20, 0.8, 10.4, 4.2); // west cap
  // Glowing slag channels: bright strips with low rails (cover you can shoot over).
  const matSlag = new THREE.MeshStandardMaterial({ color: 0x301a08, emissive: PALETTE.ember, emissiveIntensity: 1.6, roughness: 0.8 });
  for (const sx of [-11, 3]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 1.1), matSlag);
    strip.position.set(sx, 0.06, 20);
    group.add(strip);
    solid(matMetal, sx - 3.5, 0, 18.6, sx + 3.5, 0.5, 19.15);
    solid(matMetal, sx - 3.5, 0, 21.15, sx + 3.5, 0.5, 21.4);
  }
  crate(-16, 23, 1.2, 1);
  crate(10, 23.5, 1.2, 2);
  barrel(16.5, 18);

  // --- The Crucible (bomb site, east) ---------------------------------------------
  const site = { x0: 17.5, z0: -8, x1: 31.5, z1: 8, plantX: 23.5, plantZ: 3.4 };
  // Furnace: a riveted cylinder body, a glowing throat band and a tall chimney.
  const furnace = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2f3339, roughness: 0.55, metalness: 0.7 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.6, 5.2, 20), bodyMat);
  body.position.y = 2.6;
  body.castShadow = true;
  furnace.add(body);
  const throat = new THREE.Mesh(
    new THREE.CylinderGeometry(2.34, 2.34, 0.7, 20),
    new THREE.MeshStandardMaterial({ color: 0x401f06, emissive: PALETTE.furnace, emissiveIntensity: 2.2 }),
  );
  throat.position.y = 1.5;
  furnace.add(throat);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 6.5, 14), bodyMat);
  chimney.position.y = 8.4;
  chimney.castShadow = true;
  furnace.add(chimney);
  furnace.position.set(27.5, 0, -1.5);
  group.add(furnace);
  colliders.push(makeBox(25.2, 0, -3.8, 29.8, 5.2, 0.8));
  const furnaceLight = new THREE.PointLight(PALETTE.furnace, 60, 26, 1.8);
  furnaceLight.position.set(27.5, 2.2, -1.5);
  scene.add(furnaceLight);
  // Site cover: crates, a barrier line and barrels.
  crate(20, -5.5, 1.2, 2);
  crate(21.4, -5.4, 1.2, 1);
  crate(20.5, 5.8, 1.2, 1);
  barrier(23, -3.4, false);
  barrier(19.5, 1.5);
  barrel(30.5, 5.5);
  barrel(30.8, -6.5, true);
  barrel(18.6, -6.8);
  // Site corner posts with ember tips mark the plant zone.
  const matPost = matMetal;
  const matTip = new THREE.MeshStandardMaterial({ color: 0x1a0d04, emissive: PALETTE.ember, emissiveIntensity: 2.4 });
  for (const [px, pz] of [[site.x0, site.z0], [site.x0, site.z1], [site.x1, site.z0], [site.x1, site.z1]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.2, 0.22), matPost);
    post.position.set(px, 1.1, pz);
    group.add(post);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), matTip);
    tip.position.set(px, 2.3, pz);
    group.add(tip);
  }
  // Painted site outline on the ground.
  const outline = new THREE.Mesh(
    new THREE.PlaneGeometry(site.x1 - site.x0, site.z1 - site.z0),
    new THREE.MeshBasicMaterial({ color: PALETTE.ember, transparent: true, opacity: 0.07 }),
  );
  outline.rotation.x = -Math.PI / 2;
  outline.position.set((site.x0 + site.x1) / 2, 0.02, 0);
  group.add(outline);

  // Lamp posts at the lanes (emissive heads; the furnace light does the work).
  const matLamp = new THREE.MeshStandardMaterial({ color: 0xd8e2ee, emissive: 0xbfd4ee, emissiveIntensity: 1.4 });
  for (const [lx, lz] of [[-20, -12], [0, 12.5], [14, -13], [-26, 14]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 8), matMetal);
    pole.position.set(lx, 2.3, lz);
    group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), matLamp);
    head.position.set(lx, 4.7, lz);
    group.add(head);
    colliders.push(makeBox(lx - 0.12, 0, lz - 0.12, lx + 0.12, 4.6, lz + 0.12));
  }

  // --- Spawns ----------------------------------------------------------------------
  const spawns = {
    atk: [{ x: -31, z: -4 }, { x: -31, z: 0 }, { x: -31, z: 4 }, { x: -29, z: -2 }, { x: -29, z: 2 }],
    def: [{ x: 33, z: 6.5 }, { x: 31.5, z: 7.5 }, { x: 33.5, z: -6 }, { x: 30, z: -7 }, { x: 34, z: 1 }],
  };

  // --- Nav graph ---------------------------------------------------------------------
  // Index: see the lane layout — west yard, hall, mid, slag run, site.
  const nodes = [
    { x: -31, z: 0 }, // 0 atk spawn
    { x: -24, z: -11 }, // 1 west-north
    { x: -24, z: 11 }, // 2 west-south
    { x: -19, z: 0 }, // 3 west-mid
    { x: -16.5, z: -19 }, // 4 hall west door
    { x: -8, z: -19 }, // 5 hall west inside
    { x: 3, z: -19.5 }, // 6 hall east inside
    { x: 12.8, z: -18 }, // 7 hall east door
    { x: -2, z: -11.5 }, // 8 hall south door
    { x: -13, z: -5 }, // 9 mid-west north
    { x: -13, z: 4 }, // 10 mid-west south
    { x: -3, z: -1 }, // 11 mid centre
    { x: 4, z: 5 }, // 12 mid south-east
    { x: 9, z: -5 }, // 13 mid north-east
    { x: -17, z: 20 }, // 14 slag west
    { x: -7.5, z: 20 }, // 15 slag mid-west
    { x: 4, z: 20 }, // 16 slag mid-east
    { x: 13, z: 20 }, // 17 slag east
    { x: -7.5, z: 12.5 }, // 18 slag north gap west
    { x: 7.5, z: 12.5 }, // 19 slag north gap east
    { x: 13, z: 9 }, // 20 site south-west approach
    { x: 13, z: -9 }, // 21 site north-west approach
    { x: 18.5, z: 0 }, // 22 site west edge
    { x: 23.5, z: 3.4 }, // 23 plant spot
    { x: 20.5, z: -5 }, // 24 site north cover
    { x: 21, z: 6 }, // 25 site south cover
    { x: 30.5, z: 6.5 }, // 26 def spawn south
    { x: 30.5, z: -6.5 }, // 27 def spawn north
    { x: 33, z: 0.5 }, // 28 def spawn centre (behind furnace)
  ];
  let links = [
    [0, 1], [0, 2], [0, 3], [1, 4], [1, 9], [2, 10], [2, 14], [3, 9], [3, 10],
    [4, 5], [5, 6], [6, 7], [5, 8], [8, 9], [8, 11], [7, 13], [7, 21],
    [9, 11], [10, 11], [10, 18], [11, 12], [11, 13], [12, 19], [12, 20],
    [13, 21], [13, 22], [14, 15], [15, 16], [15, 18], [16, 17], [16, 19], [17, 20],
    [18, 10], [19, 12], [20, 22], [20, 25], [21, 22], [21, 24], [22, 23],
    [23, 24], [23, 25], [24, 27], [25, 26], [26, 28], [27, 28], [23, 28],
  ];
  // Keep only links whose straight walk clears every solid (2D segment vs AABB).
  function segmentClear(a, b) {
    for (const c of colliders) {
      if (c.y1 < 0.6) continue;
      // Sample the segment; cheap and the graph is small.
      for (let t = 0; t <= 1.0001; t += 0.04) {
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        if (x > c.x0 - 0.3 && x < c.x1 + 0.3 && z > c.z0 - 0.3 && z < c.z1 + 0.3) return false;
      }
    }
    return true;
  }
  links = links.filter(([a, b]) => segmentClear(nodes[a], nodes[b]));
  const nav = createNav(nodes, links);

  return {
    group,
    colliders,
    nav,
    spawns,
    site,
    holdDef: [24, 25, 21, 20, 13, 12], // nodes Wardens like to hold
    holdAtk: [22, 9, 10, 18, 19], // nodes Kindled stage at
    updateFx(time) {
      furnaceLight.intensity = 55 + Math.sin(time * 7.3) * 7 + Math.sin(time * 13.7) * 5;
    },
  };
}
