// Combat dressing, all pooled: tracers, muzzle glows, spark bursts, explosions
// and smoke clouds are allocated once and recycled, so a firefight never makes
// the garbage collector part of the frame budget. Smoke is more than a picture:
// active clouds are listed in `smokes`, and bot sight checks test against them.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_PARTICLES = 320;

export function createEffects(scene) {
  // Tracers: thin additive boxes stretched between muzzle and impact.
  const tracerMat = new THREE.MeshBasicMaterial({ color: PALETTE.tracer, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracers = [];
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(tracerGeo, tracerMat);
    m.visible = false;
    scene.add(m);
    tracers.push({ mesh: m, life: 0 });
  }
  let tracerIdx = 0;
  const mid = new THREE.Vector3();
  const dirV = new THREE.Vector3();

  // Muzzle glows for bots (the player's own flash lives in the viewmodel).
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffc873, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const glows = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), glowMat);
    m.visible = false;
    scene.add(m);
    glows.push({ mesh: m, life: 0 });
  }
  let glowIdx = 0;

  // Sparks: one Points cloud, per-particle colour, velocity and life.
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pCol = new Float32Array(MAX_PARTICLES * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.085, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  points.frustumCulled = false;
  scene.add(points);
  const particles = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particles.push({ alive: false, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, grav: 6 });
    pPos[i * 3 + 1] = -50;
  }
  let particleIdx = 0;
  const colTmp = new THREE.Color();

  function burst(x, y, z, hex, count, speed, life, grav = 6) {
    colTmp.setHex(hex);
    for (let n = 0; n < count; n++) {
      const idx = particleIdx;
      const p = particles[idx];
      particleIdx = (particleIdx + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.1;
      const sp = speed * (0.35 + Math.random() * 0.65);
      p.alive = true;
      p.x = x; p.y = y; p.z = z;
      p.vx = Math.cos(a) * sp * (1 - up * 0.4);
      p.vy = up * sp;
      p.vz = Math.sin(a) * sp * (1 - up * 0.4);
      p.max = life * (0.6 + Math.random() * 0.7);
      p.life = p.max;
      p.grav = grav;
      const i3 = idx * 3;
      pCol[i3] = colTmp.r; pCol[i3 + 1] = colTmp.g; pCol[i3 + 2] = colTmp.b;
    }
    pGeo.attributes.color.needsUpdate = true;
  }

  // Explosions: an expanding shell plus a light, two pooled.
  const booms = [];
  for (let i = 0; i < 2; i++) {
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    shell.visible = false;
    scene.add(shell);
    const light = new THREE.PointLight(0xff8c2e, 0, 22, 1.6);
    scene.add(light);
    booms.push({ shell, light, life: 0 });
  }
  let boomIdx = 0;

  // Smoke clouds: clusters of soft spheres that linger and block bot sight.
  const smokes = [];
  const smokeMat = new THREE.MeshStandardMaterial({ color: PALETTE.smoke, transparent: true, opacity: 0, roughness: 1, depthWrite: false });
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    for (let j = 0; j < 6; j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1.15 + (j % 3) * 0.4, 12, 10), smokeMat.clone());
      s.position.set((j % 3 - 1) * 1.1, 0.8 + (j % 2) * 0.7, ((j / 3) | 0) * 1.2 - 0.6);
      g.add(s);
    }
    g.visible = false;
    scene.add(g);
    smokes.push({ group: g, x: 0, y: 0, z: 0, r: 2.6, left: 0, total: 1 });
  }
  let smokeIdx = 0;

  return {
    smokes,
    tracer(ax, ay, az, bx, by, bz) {
      const t = tracers[tracerIdx];
      tracerIdx = (tracerIdx + 1) % tracers.length;
      mid.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      dirV.set(bx - ax, by - ay, bz - az);
      const len = dirV.length();
      if (len < 0.5) return;
      t.mesh.position.copy(mid);
      t.mesh.scale.set(1, 1, len);
      t.mesh.lookAt(bx, by, bz);
      t.mesh.visible = true;
      t.life = 0.05;
    },
    muzzle(x, y, z) {
      const g = glows[glowIdx];
      glowIdx = (glowIdx + 1) % glows.length;
      g.mesh.position.set(x, y, z);
      g.mesh.rotation.z = Math.random() * 3;
      g.mesh.visible = true;
      g.life = 0.045;
    },
    impact(x, y, z, hex = 0xd8c9a8) { burst(x, y, z, hex, 7, 2.6, 0.32); },
    hitPuff(x, y, z, team) { burst(x, y, z, team === 'atk' ? 0xffa050 : 0x7fe8dc, 9, 2.2, 0.4); },
    explosion(x, y, z, big = false) {
      const b = booms[boomIdx];
      boomIdx = (boomIdx + 1) % booms.length;
      b.shell.position.set(x, y + 0.4, z);
      b.shell.visible = true;
      b.life = big ? 0.85 : 0.5;
      b.shell.userData.max = b.life;
      b.shell.userData.size = big ? 7 : 3.4;
      b.light.position.set(x, y + 1, z);
      burst(x, y + 0.5, z, 0xff9a3c, big ? 46 : 22, big ? 7 : 4.5, 0.7, 4);
      burst(x, y + 0.5, z, 0x554a3a, big ? 20 : 8, 2.4, 1.1, -0.5);
    },
    smoke(x, y, z, dur = 16) {
      const s = smokes[smokeIdx];
      smokeIdx = (smokeIdx + 1) % smokes.length;
      s.group.position.set(x, y, z);
      s.group.visible = true;
      s.x = x; s.y = y + 1.1; s.z = z;
      s.left = dur;
      s.total = dur;
    },
    update(dt, camera) {
      for (const t of tracers) {
        if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.mesh.visible = false; }
      }
      for (const g of glows) {
        if (g.life > 0) {
          g.life -= dt;
          g.mesh.quaternion.copy(camera.quaternion);
          if (g.life <= 0) g.mesh.visible = false;
        }
      }
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = particles[i];
        if (!p.alive) continue;
        p.life -= dt;
        if (p.life <= 0) { p.alive = false; pPos[i * 3 + 1] = -50; continue; }
        p.vy -= p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0.03) { p.y = 0.03; p.vy *= -0.35; p.vx *= 0.7; p.vz *= 0.7; }
        pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
      }
      pGeo.attributes.position.needsUpdate = true;
      for (const b of booms) {
        if (b.life > 0) {
          b.life -= dt;
          const f = 1 - Math.max(0, b.life) / b.shell.userData.max;
          const size = 0.4 + f * b.shell.userData.size;
          b.shell.scale.set(size, size, size);
          b.shell.material.opacity = 0.75 * (1 - f);
          b.light.intensity = 130 * (1 - f);
          if (b.life <= 0) { b.shell.visible = false; b.light.intensity = 0; }
        }
      }
      for (const s of smokes) {
        if (s.left > 0) {
          s.left -= dt;
          const fadeIn = Math.min(1, (s.total - s.left) / 1.2);
          const fadeOut = Math.min(1, s.left / 2.5);
          const o = 0.52 * Math.min(fadeIn, fadeOut);
          for (const child of s.group.children) child.material.opacity = o;
          if (s.left <= 0) s.group.visible = false;
        }
      }
    },
  };
}
