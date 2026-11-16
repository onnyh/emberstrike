// The armoury: five original guns and three grenades, as data, plus the
// first-person viewmodels built from them. Accuracy is the house rule — spread
// is small standing still, blooms hard on the move and in the air, and tightens
// when crouched — so the numbers here are the game's core feel. Damage falls
// off with range; headshots multiply it, by a factor per gun.
export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P9 Sparrow', kind: 'pistol', slot: 'sidearm', price: 0, damage: 33, headMult: 3, rpm: 380, auto: false, mag: 12, reserveStart: 48, reload: 1.4, spread: 0.011, moveSpread: 0.03, recoil: 0.012, kick: 0.035, moveSpeed: 1, pellets: 1, zoom: 0 },
  smg: { id: 'smg', name: 'Vex-9', kind: 'smg', slot: 'primary', price: 1250, damage: 26, headMult: 2.6, rpm: 760, auto: true, mag: 30, reserveStart: 90, reload: 1.9, spread: 0.017, moveSpread: 0.036, recoil: 0.008, kick: 0.02, moveSpeed: 1, pellets: 1, zoom: 0 },
  shotgun: { id: 'shotgun', name: 'Mule-12', kind: 'shotgun', slot: 'primary', price: 1100, damage: 11, headMult: 2, rpm: 68, auto: false, mag: 6, reserveStart: 24, reload: 2.6, spread: 0.048, moveSpread: 0.055, recoil: 0.05, kick: 0.12, moveSpeed: 0.97, pellets: 8, zoom: 0 },
  rifle: { id: 'rifle', name: 'Kestrel RK', kind: 'rifle', slot: 'primary', price: 2700, damage: 36, headMult: 4, rpm: 600, auto: true, mag: 30, reserveStart: 90, reload: 2.3, spread: 0.009, moveSpread: 0.034, recoil: 0.013, kick: 0.038, moveSpeed: 0.95, pellets: 1, zoom: 0 },
  sniper: { id: 'sniper', name: 'Longshot L-50', kind: 'sniper', slot: 'primary', price: 4750, damage: 112, headMult: 4, rpm: 42, auto: false, mag: 5, reserveStart: 20, reload: 2.9, spread: 0.0016, moveSpread: 0.06, recoil: 0.06, kick: 0.17, moveSpeed: 0.92, pellets: 1, zoom: 2.6 },
};
export const PRIMARY_ORDER = ['smg', 'shotgun', 'rifle', 'sniper'];
export const GRENADES = {
  frag: { id: 'frag', name: 'Frag charge', price: 300 },
  flash: { id: 'flash', name: 'Flash charge', price: 200 },
  smoke: { id: 'smoke', name: 'Smoke charge', price: 300 },
};

// Full damage out to 16 m, easing to 55% at 55 m.
export function damageAt(def, dist) {
  if (dist <= 16) return def.damage;
  if (dist >= 55) return def.damage * 0.55;
  return def.damage * (1 - 0.45 * ((dist - 16) / 39));
}

// --- First-person viewmodels ---------------------------------------------------
// One gun per weapon kind, boxes and cylinders in dark metal with an ember
// accent stripe. The group hangs off the camera; update() plays the recoil
// kick, the reload dip and the draw raise, and flashes the muzzle on a shot.
import * as THREE from 'three';

const matGun = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.45, metalness: 0.7 });
const matGunSoft = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.5 });
const matAccent = new THREE.MeshStandardMaterial({ color: 0x1c0f06, emissive: 0xff7a26, emissiveIntensity: 0.9, roughness: 0.6 });

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function buildGun(kind) {
  const g = new THREE.Group();
  if (kind === 'pistol') {
    g.add(box(0.05, 0.09, 0.24, matGun, 0, 0, -0.08));
    g.add(box(0.045, 0.13, 0.07, matGunSoft, 0, -0.09, 0.03));
    g.add(box(0.052, 0.02, 0.1, matAccent, 0, 0.03, -0.1));
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.22);
  } else if (kind === 'smg') {
    g.add(box(0.055, 0.1, 0.42, matGun, 0, 0, -0.14));
    g.add(box(0.04, 0.16, 0.06, matGunSoft, 0, -0.11, -0.05));
    g.add(box(0.045, 0.1, 0.08, matGunSoft, 0, -0.05, 0.1));
    g.add(box(0.057, 0.02, 0.16, matAccent, 0, 0.045, -0.16));
    g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.38);
  } else if (kind === 'shotgun') {
    g.add(box(0.06, 0.09, 0.62, matGun, 0, 0, -0.22));
    g.add(box(0.05, 0.06, 0.2, matGunSoft, 0, -0.055, -0.24));
    g.add(box(0.055, 0.11, 0.12, matGunSoft, 0, -0.06, 0.14));
    g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.56);
  } else if (kind === 'sniper') {
    g.add(box(0.05, 0.09, 0.78, matGun, 0, 0, -0.3));
    g.add(box(0.04, 0.15, 0.06, matGunSoft, 0, -0.1, -0.02));
    g.add(box(0.05, 0.11, 0.1, matGunSoft, 0, -0.05, 0.16));
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.16, 10), matGunSoft);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.085, -0.12);
    g.add(scope);
    g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.72);
  } else { // rifle
    g.add(box(0.055, 0.1, 0.52, matGun, 0, 0, -0.18));
    g.add(box(0.042, 0.17, 0.07, matGunSoft, 0, -0.12, -0.08));
    g.add(box(0.048, 0.11, 0.09, matGunSoft, 0, -0.05, 0.13));
    g.add(box(0.02, 0.05, 0.02, matGunSoft, 0, 0.075, -0.3));
    g.add(box(0.057, 0.02, 0.2, matAccent, 0, 0.045, -0.2));
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.47);
  }
  return g;
}

export function createViewmodel(camera) {
  const root = new THREE.Group();
  root.position.set(0.23, -0.21, -0.42);
  camera.add(root);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffc873, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flash.position.set(0, 0.01, -0.5);
  root.add(flash);
  const light = new THREE.PointLight(0xffb35c, 0, 9, 2);
  camera.add(light);
  light.position.set(0.2, -0.1, -0.8);

  let current = null;
  let held = true;
  let kick = 0;
  let flashT = 0;
  let reloadT = 0;
  let reloadDur = 1;
  let drawT = 1;
  const muzzleWorld = new THREE.Vector3();

  return {
    setWeapon(def) {
      if (current) { root.remove(current); }
      current = buildGun(def.kind);
      root.add(current);
      flash.position.copy(current.userData.muzzle).z -= 0.06;
      drawT = 0;
      kick = 0;
    },
    setHeld(v) { held = v; },
    fire() { kick = Math.min(kick + 0.6, 1); flashT = 0.045; },
    startReload(dur) { reloadT = dur; reloadDur = dur; },
    getMuzzle(out) {
      if (!current) return out.set(0, 0, 0);
      out.copy(current.userData.muzzle);
      return root.localToWorld(out);
    },
    update(dt, moving, scoped) {
      kick = Math.max(0, kick - dt * 7);
      flashT = Math.max(0, flashT - dt);
      drawT = Math.min(1, drawT + dt * 5);
      flash.material.opacity = flashT > 0 ? 0.9 : 0;
      flash.rotation.z += dt * 21;
      light.intensity = flashT > 0 ? 14 : 0;
      const dip = reloadT > 0 ? Math.sin((1 - reloadT / reloadDur) * Math.PI) : 0;
      reloadT = Math.max(0, reloadT - dt);
      const bob = moving ? Math.sin(performance.now() * 0.011) * 0.008 : 0;
      root.position.set(0.23, -0.21 + bob - dip * 0.13 - (1 - drawT) * 0.2, -0.42 + kick * 0.07);
      root.rotation.x = kick * 0.06 + dip * 0.7 + (1 - drawT) * -0.5;
      root.visible = held && !scoped;
      return muzzleWorld;
    },
  };
}
