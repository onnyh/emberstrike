// The soldiers and the Charge, built from boxes in team colours. A character is
// a small hierarchy — legs that swing as it walks, a torso in its team's colour,
// a visored head, arms and a gun held toward wherever it aims — so a bot reads
// at a glance across the yard. The Charge is a slab with a keypad and a light
// that blinks faster the closer it gets to firing.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const matDark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 });
const matSkin = new THREE.MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.8 });
const teamMats = {};

function teamMat(team) {
  if (!teamMats[team]) {
    const main = team === 'atk' ? PALETTE.ember : PALETTE.warden;
    const dark = team === 'atk' ? PALETTE.emberDark : PALETTE.wardenDark;
    teamMats[team] = {
      main: new THREE.MeshStandardMaterial({ color: main, roughness: 0.65 }),
      dark: new THREE.MeshStandardMaterial({ color: dark, roughness: 0.75 }),
      visor: new THREE.MeshStandardMaterial({ color: 0x0c0e12, emissive: main, emissiveIntensity: 1.1, roughness: 0.4 }),
    };
  }
  return teamMats[team];
}

function part(geo, mat, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function createCharacter(team) {
  const mats = teamMat(team);
  const group = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.98;
  group.add(hips);

  const legGeo = new THREE.BoxGeometry(0.17, 0.95, 0.2);
  legGeo.translate(0, -0.475, 0); // origin at the hip, so the swing pivots there
  const legL = part(legGeo, matDark, -0.12, 0, 0, hips);
  const legR = part(legGeo, matDark, 0.12, 0, 0, hips);

  part(new THREE.BoxGeometry(0.54, 0.62, 0.3), mats.main, 0, 0.32, 0, hips);
  part(new THREE.BoxGeometry(0.46, 0.4, 0.1), mats.dark, 0, 0.34, 0.18, hips); // chest rig
  part(new THREE.BoxGeometry(0.4, 0.44, 0.14), mats.dark, 0, 0.32, -0.2, hips); // pack

  const headG = new THREE.Group();
  headG.position.y = 0.78;
  hips.add(headG);
  part(new THREE.BoxGeometry(0.27, 0.28, 0.27), matSkin, 0, 0.05, 0, headG);
  part(new THREE.BoxGeometry(0.3, 0.12, 0.3), mats.dark, 0, 0.18, 0, headG); // helmet
  part(new THREE.BoxGeometry(0.24, 0.06, 0.02), mats.visor, 0, 0.06, 0.14, headG); // visor

  const armGeo = new THREE.BoxGeometry(0.13, 0.13, 0.52);
  const armR = part(armGeo, mats.main, 0.3, 0.42, 0.22, hips);
  const armL = part(armGeo, mats.dark, -0.28, 0.36, 0.24, hips);
  armR.rotation.x = -0.25;
  armL.rotation.x = -0.35;
  const gun = part(new THREE.BoxGeometry(0.07, 0.12, 0.72), matDark, 0.16, 0.44, 0.42, hips);
  gun.rotation.x = 0.02;

  let walkPhase = 0;
  let deathT = 0;
  let dead = false;

  return {
    group,
    setDead() { dead = true; },
    reset() {
      dead = false;
      deathT = 0;
      group.rotation.set(0, 0, 0);
      group.position.y = 0;
      group.visible = true;
    },
    // speed: horizontal m/s; aimPitch: where the gun points, radians.
    update(dt, speed, aimPitch) {
      if (dead) {
        deathT = Math.min(1, deathT + dt * 2.6);
        group.rotation.x = -Math.PI / 2 * deathT;
        group.position.y = 0.12 * deathT;
        return;
      }
      walkPhase += dt * (2.2 + speed * 1.55);
      const swing = Math.min(1, speed / 3) * 0.55;
      legL.rotation.x = Math.sin(walkPhase) * swing;
      legR.rotation.x = -Math.sin(walkPhase) * swing;
      hips.position.y = 0.98 + Math.abs(Math.sin(walkPhase)) * 0.035 * Math.min(1, speed / 3);
      gun.rotation.x = -aimPitch;
      armR.rotation.x = -0.25 - aimPitch * 0.7;
      headG.rotation.x = -aimPitch * 0.55;
    },
  };
}

// The Charge: what the Kindled plant at the Crucible. Blinks amber, then red,
// faster as its fuse burns down.
export function createCharge() {
  const group = new THREE.Group();
  const body = part(new THREE.BoxGeometry(0.52, 0.24, 0.36),
    new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.6 }), 0, 0.12, 0, group);
  body.castShadow = true;
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x1a0d04, emissive: 0xffb347, emissiveIntensity: 2.5 });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.1), lampMat);
  lamp.position.set(0.14, 0.26, 0);
  group.add(lamp);
  part(new THREE.BoxGeometry(0.2, 0.03, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x101216, emissive: 0xff7a26, emissiveIntensity: 0.7 }), -0.1, 0.245, 0, group);
  const light = new THREE.PointLight(0xffb347, 0, 7, 2);
  light.position.y = 0.5;
  group.add(light);
  return {
    group,
    update(time, armed, urgency) {
      const rate = armed ? 2 + urgency * 10 : 1.2;
      const on = Math.sin(time * rate * Math.PI) > 0;
      lampMat.emissive.setHex(armed && urgency > 0.6 ? 0xff2a1a : 0xffb347);
      lampMat.emissiveIntensity = on ? 3 : 0.25;
      light.intensity = on ? 5 : 0;
    },
  };
}

// A thrown charge (grenade): a small dark canister.
export function createGrenadeMesh() {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.5, metalness: 0.5 }),
  );
  m.castShadow = true;
  return m;
}
