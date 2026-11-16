// The match director and the one place match state lives: the roster, the
// money, the round clock, the Charge, and every rule that ends a round. It
// also resolves all gunfire — the player's and the bots' through the same
// code path — so a headshot is a headshot whoever pulled the trigger.
// Movement is shared too: every combatant is a physics body driven by a
// desired velocity, the player's written by input, the bots' by their brains.
import { createBody, moveBody, rayVsWorld, rayVsCharacter } from './physics.js';
import { WEAPONS, GRENADES, damageAt } from './weapons.js';
import { createCharacter, createCharge, createGrenadeMesh } from './models.js';
import { createBrain, botBuy, thinkBot } from './bots.js';

export const TEAM_NAMES = { atk: 'Kindled', def: 'Wardens' };
export const ROUND_WINS_NEEDED = 7;
export const MAX_ROUNDS = 12;
const ROUND_TIME = 100;
const BOMB_TIME = 35;
const BUY_TIME = 12;
const END_TIME = 4.6;

const ATK_NAMES = ['Flint', 'Cinder', 'Ash', 'Pyre'];
const DEF_NAMES = ['Bastion', 'Halo', 'Verdict', 'Sentry', 'Aegis'];
export const BUY_ITEMS = [
  { id: 'smg', key: '1' }, { id: 'shotgun', key: '2' }, { id: 'rifle', key: '3' },
  { id: 'sniper', key: '4' }, { id: 'armor', key: '5' }, { id: 'fullkit', key: '6' },
  { id: 'frag', key: '7' }, { id: 'flash', key: '8' }, { id: 'smoke', key: '9' },
];

let nextId = 1;

function makeWeaponState(def) {
  return { def, mag: def.mag, reserve: def.reserveStart };
}

function makeCombatant(team, isPlayer, name) {
  return {
    id: nextId++,
    team,
    isPlayer,
    name,
    alive: true,
    hp: 100,
    armor: 0,
    helmet: false,
    money: 800,
    kills: 0,
    deaths: 0,
    body: createBody(0, 0),
    yaw: 0,
    pitch: 0,
    desired: { x: 0, z: 0, run: false, crouch: false, jump: false },
    speedNow: 0,
    weapons: { primary: null, sidearm: makeWeaponState(WEAPONS.pistol) },
    slot: 'sidearm',
    grenades: { frag: 0, flash: 0, smoke: 0 },
    grenadeSel: 'frag',
    fireCd: 0,
    reloadT: 0,
    drawT: 0,
    heat: 0,
    scopedIn: false,
    prevTrigger: false,
    wantFire: false,
    wantReload: false,
    channel: null,
    flashedT: 0,
    carrier: false,
    model: null,
    brain: null,
    lastHurtDir: null,
    walkCycle: 0,
  };
}

export function currentWeapon(c) {
  if (c.slot === 'grenade') return null;
  return c.weapons[c.slot];
}

export function eyePos(c, out) {
  out.x = c.body.pos.x;
  out.y = c.body.pos.y + c.body.height - 0.16;
  out.z = c.body.pos.z;
  return out;
}

export function forwardOf(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.x = -cp * Math.sin(yaw);
  out.y = Math.sin(pitch);
  out.z = -cp * Math.cos(yaw);
  return out;
}

export function createGame({ scene, world, effects, audio, rng, hud, hooks }) {
  const colliders = world.colliders;
  const combatants = [];
  const player = makeCombatant('atk', true, 'You');
  combatants.push(player);
  for (let i = 0; i < 4; i++) {
    const c = makeCombatant('atk', false, ATK_NAMES[i]);
    c.brain = createBrain(rng, 0.92 + rng.next() * 0.14);
    combatants.push(c);
  }
  for (let i = 0; i < 5; i++) {
    const c = makeCombatant('def', false, DEF_NAMES[i]);
    c.brain = createBrain(rng, 0.9 + rng.next() * 0.16);
    combatants.push(c);
  }
  for (const c of combatants) {
    if (c.isPlayer) continue;
    c.model = createCharacter(c.team);
    scene.add(c.model.group);
  }
  const charge = createCharge();
  charge.group.visible = false;
  scene.add(charge.group);

  const state = {
    phase: 'idle',
    phaseT: 0,
    roundTime: ROUND_TIME,
    bombT: 0,
    round: 0,
    score: { atk: 0, def: 0 },
    lossStreak: { atk: 0, def: 0 },
    bomb: { state: 'none', x: 0, z: 0, carrierId: 0 },
    projectiles: [],
    hear: [],
    winner: null,
    lastReason: '',
    time: 0,
  };

  const tmpEye = { x: 0, y: 0, z: 0 };
  const tmpDir = { x: 0, y: 0, z: 0 };
  const tmpTgt = { x: 0, y: 0, z: 0 };

  function aliveOf(team) { return combatants.filter((c) => c.team === team && c.alive); }

  function smokeBlocks(ax, ay, az, bx, by, bz) {
    for (const s of effects.smokes) {
      if (s.left <= 0.5) continue;
      // Distance from the smoke centre to the sight segment.
      const abx = bx - ax; const aby = by - ay; const abz = bz - az;
      const len2 = abx * abx + aby * aby + abz * abz;
      let t = len2 > 0 ? ((s.x - ax) * abx + (s.y - ay) * aby + (s.z - az) * abz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const dx = ax + abx * t - s.x; const dy = ay + aby * t - s.y; const dz = az + abz * t - s.z;
      if (dx * dx + dy * dy + dz * dz < s.r * s.r) return true;
    }
    return false;
  }

  function losClear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax; const dy = by - ay; const dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.01) return true;
    const hit = rayVsWorld(ax, ay, az, dx / dist, dy / dist, dz / dist, dist - 0.3, colliders);
    if (hit < dist - 0.3) return false;
    return !smokeBlocks(ax, ay, az, bx, by, bz);
  }

  function hearEvent(x, z, radius, kind) {
    state.hear.push({ x, z, radius, kind });
  }

  function damage(target, amount, { head = false, attacker = null, cause = 'shot' } = {}) {
    if (!target.alive || (state.phase !== 'live' && state.phase !== 'planted')) return;
    let dealt = amount;
    if (head && target.helmet) dealt *= 0.55;
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, dealt * 0.5);
      target.armor -= absorbed;
      dealt -= absorbed;
    }
    target.hp -= dealt;
    if (target.isPlayer) {
      audio.hurt();
      let dirAngle = null;
      if (attacker) {
        const dx = attacker.body.pos.x - target.body.pos.x;
        const dz = attacker.body.pos.z - target.body.pos.z;
        dirAngle = Math.atan2(dx, dz) + target.yaw + Math.PI;
      }
      hud.hurt(dirAngle);
    } else if (attacker && attacker.isPlayer) {
      audio.hit();
    }
    if (target.brain) target.brain.onHurt(attacker);
    if (target.hp <= 0) kill(target, attacker, head, cause);
  }

  function kill(target, attacker, head, cause) {
    target.alive = false;
    target.hp = 0;
    target.deaths++;
    target.channel = null;
    if (target.model) target.model.setDead();
    if (target.carrier) dropBomb(target);
    if (attacker && attacker !== target) {
      attacker.kills++;
      attacker.money = Math.min(16000, attacker.money + 300);
    }
    const aName = attacker ? (attacker.isPlayer ? 'You' : attacker.name) : 'The Yard';
    const causeTxt = cause === 'blast' ? '💥' : head ? '⌖ headshot' : cause === 'fall' ? 'fell' : '';
    hud.addFeed(`${aName} ▸ ${target.isPlayer ? 'You' : target.name} ${causeTxt}`, attacker && attacker.team === 'atk' ? 'feed-atk' : 'feed-def');
    if (target.isPlayer) hooks.onPlayerDeath && hooks.onPlayerDeath();
    if (attacker && attacker.isPlayer) audio.kill();
    checkRoundEnd();
  }

  function dropBomb(from) {
    from.carrier = false;
    state.bomb.state = 'dropped';
    state.bomb.x = from.body.pos.x;
    state.bomb.z = from.body.pos.z;
    state.bomb.carrierId = 0;
    charge.group.visible = true;
    charge.group.position.set(state.bomb.x, 0, state.bomb.z);
  }

  // --- Firing ------------------------------------------------------------------
  function spreadOf(c, def) {
    const speedF = Math.min(1, c.speedNow / 5.2);
    let s = def.spread + def.moveSpread * speedF * speedF + c.heat * 0.012;
    if (!c.body.onGround) s += 0.045;
    if (c.desired.crouch) s *= 0.72;
    if (c.slot === 'primary' && def.id === 'sniper' && !c.scopedIn) s = Math.max(s, 0.028);
    return s;
  }

  function tryFire(c) {
    const w = currentWeapon(c);
    if (!w || c.reloadT > 0 || c.drawT > 0 || c.channel) return;
    if (state.phase !== 'live' && state.phase !== 'planted') return;
    const def = w.def;
    const interval = 60 / def.rpm;
    if (c.fireCd > 0) return;
    if (!def.auto && c.prevTrigger) return;
    if (w.mag <= 0) {
      audio.dry();
      c.fireCd = 0.3;
      startReload(c);
      return;
    }
    w.mag--;
    c.fireCd = interval;
    c.heat = Math.min(1, c.heat + 0.24);
    const eye = eyePos(c, tmpEye);
    const spread = spreadOf(c, def);
    const distToPlayer = Math.hypot(player.body.pos.x - c.body.pos.x, player.body.pos.z - c.body.pos.z);
    const vol = c.isPlayer ? 1 : Math.max(0.08, 1.15 - distToPlayer / 42);
    audio.shot(def.kind, vol);
    hearEvent(c.body.pos.x, c.body.pos.z, 30, 'shot');
    // Muzzle origin: a little ahead of the eyes, at gun height.
    forwardOf(c.yaw, c.pitch, tmpDir);
    const mx = eye.x + tmpDir.x * 0.55;
    const my = eye.y - 0.14 + tmpDir.y * 0.55;
    const mz = eye.z + tmpDir.z * 0.55;
    if (!c.isPlayer) effects.muzzle(mx, my, mz);
    if (c.isPlayer && hooks.onPlayerFire) hooks.onPlayerFire(def);

    for (let p = 0; p < def.pellets; p++) {
      forwardOf(c.yaw, c.pitch, tmpDir);
      const gx = (rng.range(-1, 1) + rng.range(-1, 1)) * 0.5 * spread;
      const gy = (rng.range(-1, 1) + rng.range(-1, 1)) * 0.5 * spread;
      // Perturb the aim direction inside a cone: right and up vectors spanning
      // the plane across the line of fire (right = dir × world-up, in XZ).
      const rNx = -tmpDir.z;
      const rNz = tmpDir.x;
      const rl = Math.hypot(rNx, rNz) || 1;
      const upX = tmpDir.y * (rNz / rl);
      const upY = tmpDir.z * (rNx / rl) - tmpDir.x * (rNz / rl);
      const upZ = -tmpDir.y * (rNx / rl);
      const ddx = tmpDir.x + (rNx / rl) * gx + upX * gy;
      const ddy = tmpDir.y + upY * gy;
      const ddz = tmpDir.z + (rNz / rl) * gx + upZ * gy;
      const dl = Math.hypot(ddx, ddy, ddz);
      const fx = ddx / dl; const fy = ddy / dl; const fz = ddz / dl;
      const maxD = 120;
      const worldT = rayVsWorld(eye.x, eye.y, eye.z, fx, fy, fz, maxD, colliders);
      let bestT = worldT;
      let bestTarget = null;
      let bestHead = false;
      for (const t of combatants) {
        if (!t.alive || t === c || t.team === c.team) continue;
        const hit = rayVsCharacter(eye.x, eye.y, eye.z, fx, fy, fz, t.body.pos, t.body.height, bestT);
        if (hit && hit.t < bestT) { bestT = hit.t; bestTarget = t; bestHead = hit.head; }
      }
      const hx = eye.x + fx * bestT; const hy = eye.y + fy * bestT; const hz = eye.z + fz * bestT;
      effects.tracer(mx, my, mz, hx, hy, hz);
      if (bestTarget) {
        let dmg = damageAt(def, bestT);
        if (bestHead) dmg *= def.headMult;
        // Legs (low hits) take 75%: judge by hit height relative to the body.
        const relY = hy - bestTarget.body.pos.y;
        if (!bestHead && relY < 0.55) dmg *= 0.75;
        effects.hitPuff(hx, hy, hz, bestTarget.team);
        damage(bestTarget, dmg, { head: bestHead, attacker: c });
      } else if (bestT < maxD) {
        effects.impact(hx, hy, hz);
      }
    }
    if (w.mag === 0) startReload(c);
  }

  function startReload(c) {
    const w = currentWeapon(c);
    if (!w || c.reloadT > 0 || w.mag >= w.def.mag || w.reserve <= 0) return;
    c.reloadT = w.def.reload;
    if (c.isPlayer) { audio.reload(); hooks.onPlayerReload && hooks.onPlayerReload(w.def.reload); }
  }

  function finishReload(c) {
    const w = currentWeapon(c);
    if (!w) return;
    const take = Math.min(w.def.mag - w.mag, w.reserve);
    w.mag += take;
    w.reserve -= take;
  }

  function switchSlot(c, slot) {
    if (c.slot === slot || c.channel) return;
    if (slot !== 'grenade' && !c.weapons[slot]) return;
    if (slot === 'grenade' && c.grenades[c.grenadeSel] <= 0) {
      const any = ['frag', 'flash', 'smoke'].find((g) => c.grenades[g] > 0);
      if (!any) return;
      c.grenadeSel = any;
    }
    c.slot = slot;
    c.drawT = 0.42;
    c.reloadT = 0;
    if (c.isPlayer) { audio.draw(); hooks.onPlayerWeapon && hooks.onPlayerWeapon(currentWeapon(c), slot); }
  }

  // --- Grenades ------------------------------------------------------------------
  function throwGrenade(c) {
    const kind = c.grenadeSel;
    if (c.grenades[kind] <= 0 || c.drawT > 0) return;
    c.grenades[kind]--;
    const eye = eyePos(c, tmpEye);
    forwardOf(c.yaw, c.pitch + 0.12, tmpDir);
    const mesh = createGrenadeMesh();
    mesh.position.set(eye.x + tmpDir.x * 0.4, eye.y, eye.z + tmpDir.z * 0.4);
    scene.add(mesh);
    state.projectiles.push({
      kind, mesh, owner: c,
      vx: tmpDir.x * 15, vy: tmpDir.y * 15 + 2.2, vz: tmpDir.z * 15,
      fuse: kind === 'frag' ? 1.6 : 1.35, settled: false,
    });
    audio.throwIt();
    switchSlot(c, c.weapons.primary ? 'primary' : 'sidearm');
  }

  function explodeFrag(x, y, z, owner) {
    effects.explosion(x, y, z, false);
    audio.grenade();
    hearEvent(x, z, 42, 'blast');
    for (const t of combatants) {
      if (!t.alive) continue;
      const dx = t.body.pos.x - x; const dz = t.body.pos.z - z;
      const d = Math.hypot(dx, dz, (t.body.pos.y + 0.9) - y);
      if (d > 5.6) continue;
      let dmg = 118 * (1 - d / 6.4);
      const cx = t.body.pos.x; const cy = t.body.pos.y + 0.9; const cz = t.body.pos.z;
      if (!losClear(x, y + 0.3, z, cx, cy, cz)) dmg *= 0.45;
      if (dmg > 2) damage(t, dmg, { attacker: owner, cause: 'blast' });
    }
  }

  function popFlash(x, y, z) {
    effects.explosion(x, y, z, false);
    audio.flashPop();
    hearEvent(x, z, 20, 'flash');
    for (const t of combatants) {
      if (!t.alive) continue;
      const eye = eyePos(t, tmpTgt);
      const dx = x - eye.x; const dy = y - eye.y; const dz = z - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 24) continue;
      if (!losClear(x, y, z, eye.x, eye.y, eye.z)) continue;
      forwardOf(t.yaw, t.pitch, tmpDir);
      const dot = (tmpDir.x * dx + tmpDir.y * dy + tmpDir.z * dz) / (dist || 1);
      const facing = dot > 0.5 ? 1 : dot > 0 ? 0.6 : dot > -0.5 ? 0.3 : 0.08;
      const dur = 3.4 * facing * Math.max(0.15, 1.25 - dist / 22);
      t.flashedT = Math.max(t.flashedT, dur);
      if (t.isPlayer) hud.flash(Math.min(1, facing * 1.15 * Math.max(0.2, 1.15 - dist / 26)));
      if (t.brain) t.brain.blind = Math.max(t.brain.blind, dur);
    }
  }

  function stepProjectiles(dt) {
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const p = state.projectiles[i];
      p.fuse -= dt;
      if (!p.settled) {
        p.vy -= 13 * dt;
        let nx = p.mesh.position.x + p.vx * dt;
        let ny = p.mesh.position.y + p.vy * dt;
        let nz = p.mesh.position.z + p.vz * dt;
        // Bounce off the ground and the map boxes (point test per axis).
        if (ny < 0.09) { ny = 0.09; p.vy *= -0.38; p.vx *= 0.72; p.vz *= 0.72; if (Math.abs(p.vy) < 0.7) { p.settled = p.kind === 'smoke'; if (p.kind === 'smoke') p.fuse = Math.min(p.fuse, 0.15); } if (p.kind !== 'smoke') audio.bounce(); }
        for (const b of colliders) {
          if (nx > b.x0 && nx < b.x1 && ny > b.y0 && ny < b.y1 && nz > b.z0 && nz < b.z1) {
            // Push back along the smallest penetration axis.
            const pens = [nx - b.x0, b.x1 - nx, ny - b.y0, b.y1 - ny, nz - b.z0, b.z1 - nz];
            const m = Math.min(...pens);
            if (m === pens[0]) { nx = b.x0 - 0.09; p.vx *= -0.38; }
            else if (m === pens[1]) { nx = b.x1 + 0.09; p.vx *= -0.38; }
            else if (m === pens[2]) { ny = b.y0 - 0.09; p.vy *= -0.38; }
            else if (m === pens[3]) { ny = b.y1 + 0.09; p.vy = Math.abs(p.vy) * 0.3; if (p.kind === 'smoke') { p.settled = true; p.fuse = Math.min(p.fuse, 0.15); } }
            else if (m === pens[4]) { nz = b.z0 - 0.09; p.vz *= -0.38; }
            else { nz = b.z1 + 0.09; p.vz *= -0.38; }
          }
        }
        p.mesh.position.set(nx, ny, nz);
      }
      if (p.fuse <= 0) {
        const { x, y, z } = p.mesh.position;
        scene.remove(p.mesh);
        state.projectiles.splice(i, 1);
        if (p.kind === 'frag') explodeFrag(x, y, z, p.owner);
        else if (p.kind === 'flash') popFlash(x, y, z);
        else effects.smoke(x, 0, z, 16);
      }
    }
  }

  // --- Buying ---------------------------------------------------------------------
  function buyItem(c, id) {
    const fail = () => { if (c.isPlayer) audio.denied(); return false; };
    if (id === 'armor' || id === 'fullkit') {
      const price = id === 'armor' ? 650 : 1000;
      if (c.money < price || (id === 'armor' && c.armor >= 100) || (id === 'fullkit' && c.helmet && c.armor >= 100)) return fail();
      c.money -= price;
      c.armor = 100;
      if (id === 'fullkit') c.helmet = true;
    } else if (GRENADES[id]) {
      const price = GRENADES[id].price;
      if (c.money < price || c.grenades[id] >= 1) return fail();
      c.money -= price;
      c.grenades[id]++;
    } else if (WEAPONS[id]) {
      const def = WEAPONS[id];
      if (c.money < def.price) return fail();
      if (c.weapons.primary && c.weapons.primary.def.id === id) return fail();
      c.money -= def.price;
      c.weapons.primary = makeWeaponState(def);
      if (c.slot !== 'grenade') c.slot = 'primary';
    } else return fail();
    if (c.isPlayer) { audio.buy(); hooks.onPlayerWeapon && hooks.onPlayerWeapon(currentWeapon(c), c.slot); }
    return true;
  }

  // --- Round flow -------------------------------------------------------------------
  function startMatch() {
    state.score.atk = 0;
    state.score.def = 0;
    state.lossStreak.atk = 0;
    state.lossStreak.def = 0;
    state.round = 0;
    for (const c of combatants) { c.money = 800; c.kills = 0; c.deaths = 0; }
    startRound();
  }

  function startRound() {
    state.round++;
    state.phase = 'buy';
    state.phaseT = BUY_TIME;
    state.roundTime = ROUND_TIME;
    state.bomb = { state: 'carried', x: 0, z: 0, carrierId: 0 };
    charge.group.visible = false;
    for (const p of state.projectiles) scene.remove(p.mesh);
    state.projectiles.length = 0;
    const atkSpawns = world.spawns.atk;
    const defSpawns = world.spawns.def;
    let ai = 0; let di = 0;
    for (const c of combatants) {
      const s = c.team === 'atk' ? atkSpawns[ai++ % atkSpawns.length] : defSpawns[di++ % defSpawns.length];
      c.alive = true;
      c.hp = 100;
      c.body.pos.x = s.x; c.body.pos.z = s.z; c.body.pos.y = 0;
      c.body.vel.x = 0; c.body.vel.y = 0; c.body.vel.z = 0;
      c.body.height = c.body.standHeight;
      c.yaw = c.team === 'atk' ? -Math.PI / 2 : Math.PI / 2; // atk faces east (+x), def west
      c.pitch = 0;
      c.channel = null;
      c.flashedT = 0;
      c.carrier = false;
      c.heat = 0;
      c.fireCd = 0;
      c.reloadT = 0;
      // Weapons: a survivor keeps theirs; the dead come back with a sidearm.
      if (!c.survived) {
        c.weapons = { primary: null, sidearm: makeWeaponState(WEAPONS.pistol) };
        c.grenades = { frag: 0, flash: 0, smoke: 0 };
        c.armor = 0;
        c.helmet = false;
      } else {
        for (const slot of ['primary', 'sidearm']) {
          const w = c.weapons[slot];
          if (w) { w.mag = w.def.mag; w.reserve = Math.max(w.reserve, Math.floor(w.def.reserveStart / 2)); }
        }
      }
      c.slot = c.weapons.primary ? 'primary' : 'sidearm';
      if (c.model) c.model.reset();
      if (c.brain) {
        if (c.team === 'def') c.brain.preferHold = world.holdDef[(di - 1) % world.holdDef.length];
        c.brain.resetRound(c, world);
      }
    }
    // The Charge goes to a random Kindled; its brain then re-plans around
    // carrying it (the reset above ran before the carrier was known).
    const atk = aliveOf('atk');
    const carrier = atk[Math.floor(rng.next() * atk.length)];
    carrier.carrier = true;
    state.bomb.carrierId = carrier.id;
    if (carrier.brain) carrier.brain.resetRound(carrier, world);
    for (const c of combatants) if (!c.isPlayer) botBuy(c, rng, buyItem);
    hooks.onRoundStart && hooks.onRoundStart(state);
    hooks.onPlayerWeapon && hooks.onPlayerWeapon(currentWeapon(player), player.slot);
  }

  function endRound(winnerTeam, reason) {
    if (state.phase === 'over' || state.phase === 'matchover') return;
    state.phase = 'over';
    state.phaseT = END_TIME;
    state.lastReason = reason;
    state.score[winnerTeam]++;
    const loser = winnerTeam === 'atk' ? 'def' : 'atk';
    state.lossStreak[loser]++;
    state.lossStreak[winnerTeam] = 0;
    const objectiveWin = reason === 'detonation' || reason === 'defused';
    for (const c of combatants) {
      c.survived = c.alive;
      if (c.team === winnerTeam) c.money = Math.min(16000, c.money + (objectiveWin ? 3500 : 3250));
      else c.money = Math.min(16000, c.money + 1400 + Math.min(750, (state.lossStreak[loser] - 1) * 250));
      c.channel = null;
    }
    const playerWon = winnerTeam === 'atk';
    if (playerWon) audio.roundWin(); else audio.roundLose();
    hooks.onRoundEnd && hooks.onRoundEnd(state, winnerTeam, reason);
    if (state.score.atk >= ROUND_WINS_NEEDED || state.score.def >= ROUND_WINS_NEEDED || state.round >= MAX_ROUNDS) {
      state.winner = state.score.atk === state.score.def ? 'draw' : state.score.atk > state.score.def ? 'atk' : 'def';
    }
  }

  function checkRoundEnd() {
    if (state.phase !== 'live' && state.phase !== 'planted') return;
    const atkAlive = aliveOf('atk').length;
    const defAlive = aliveOf('def').length;
    if (defAlive === 0) return endRound('atk', 'elimination');
    if (atkAlive === 0 && state.phase !== 'planted') return endRound('def', 'elimination');
  }

  // --- Per-tick steps ------------------------------------------------------------------
  function stepCombatant(c, dt) {
    // Timers.
    c.fireCd = Math.max(0, c.fireCd - dt);
    c.drawT = Math.max(0, c.drawT - dt);
    c.heat = Math.max(0, c.heat - dt * 1.6);
    c.flashedT = Math.max(0, c.flashedT - dt);
    if (c.reloadT > 0) { c.reloadT -= dt; if (c.reloadT <= 0) finishReload(c); }

    // Desired velocity with acceleration and friction (the CS feel: quick
    // stops, so stopping to shoot is a real decision).
    const def = currentWeapon(c) ? currentWeapon(c).def : WEAPONS.pistol;
    const maxSpeed = 5.3 * def.moveSpeed * (c.desired.crouch ? 0.45 : 1) * (c.scopedIn ? 0.45 : 1);
    const accel = c.body.onGround ? 42 : 6;
    const vx = c.body.vel.x;
    const vz = c.body.vel.z;
    const wantX = c.desired.x * maxSpeed;
    const wantZ = c.desired.z * maxSpeed;
    const step = accel * dt;
    c.body.vel.x = Math.abs(wantX - vx) < step ? wantX : vx + Math.sign(wantX - vx) * step;
    c.body.vel.z = Math.abs(wantZ - vz) < step ? wantZ : vz + Math.sign(wantZ - vz) * step;
    if (c.desired.jump && c.body.onGround) { c.body.vel.y = 7.4; c.body.onGround = false; }
    c.desired.jump = false;
    // Crouch eases the body height down (and the eye with it).
    const targetH = c.desired.crouch ? 1.28 : c.body.standHeight;
    c.body.height += (targetH - c.body.height) * Math.min(1, dt * 11);
    moveBody(c.body, colliders, dt);
    c.speedNow = Math.hypot(c.body.vel.x, c.body.vel.z);
    c.walkCycle += c.speedNow * dt;

    // Sync the visible model (models are built facing +z; the sim's forward is
    // the camera convention, half a turn away).
    if (c.model) {
      c.model.group.position.set(c.body.pos.x, c.body.pos.y, c.body.pos.z);
      c.model.group.rotation.y = c.yaw + Math.PI;
      c.model.update(dt, c.alive ? c.speedNow : 0, c.pitch);
    }
  }

  function stepChannels(c, dt) {
    if (!c.channel) return;
    const ch = c.channel;
    ch.t += dt;
    if (c.isPlayer) hud.progress(Math.min(1, ch.t / ch.dur), ch.kind === 'plant' ? 'Planting the Charge…' : 'Defusing…');
    if (ch.t >= ch.dur) {
      c.channel = null;
      if (c.isPlayer) hud.progress(null);
      if (ch.kind === 'plant') doPlant(c);
      else doDefuse(c);
    }
  }

  function doPlant(c) {
    state.bomb.state = 'planted';
    state.bomb.x = world.site.plantX;
    state.bomb.z = world.site.plantZ;
    state.phase = 'planted';
    state.bombT = BOMB_TIME;
    c.carrier = false;
    c.money = Math.min(16000, c.money + 300);
    charge.group.visible = true;
    charge.group.position.set(state.bomb.x, 0, state.bomb.z);
    audio.plantDone();
    hud.banner('CHARGE PLANTED', 'The Wardens have 35 seconds to defuse it', 'banner-atk', 2.4);
    hooks.onPlanted && hooks.onPlanted(state);
    for (const b of combatants) if (b.brain) b.brain.onPlanted();
  }

  function doDefuse(c) {
    state.bomb.state = 'defused';
    c.money = Math.min(16000, c.money + 300);
    audio.plantDone();
    endRound('def', 'defused');
  }

  function tryInteract(c) {
    // Plant: the carrier, standing in the site during a live round.
    if (c.team === 'atk' && c.carrier && state.phase === 'live') {
      const s = world.site;
      if (c.body.pos.x > s.x0 && c.body.pos.x < s.x1 && c.body.pos.z > s.z0 && c.body.pos.z < s.z1) {
        c.channel = { kind: 'plant', t: 0, dur: 3.2 };
        return;
      }
    }
    // Defuse: a Warden beside the planted Charge.
    if (c.team === 'def' && state.phase === 'planted') {
      const d = Math.hypot(c.body.pos.x - state.bomb.x, c.body.pos.z - state.bomb.z);
      if (d < 1.7) c.channel = { kind: 'defuse', t: 0, dur: 5 };
    }
  }

  function update(dt) {
    state.time += dt;
    if (state.phase === 'buy') {
      state.phaseT -= dt;
      for (const c of combatants) {
        if (!c.isPlayer) { c.desired.x = 0; c.desired.z = 0; }
        stepCombatant(c, dt);
      }
      if (state.phaseT <= 0) {
        state.phase = 'live';
        hooks.onLive && hooks.onLive(state);
      }
      return;
    }
    if (state.phase === 'over') {
      state.phaseT -= dt;
      for (const c of combatants) if (c.alive) stepCombatant(c, dt);
      charge.update(state.time, false, 0);
      if (state.phaseT <= 0) {
        if (state.winner) { state.phase = 'matchover'; hooks.onMatchEnd && hooks.onMatchEnd(state); }
        else startRound();
      }
      return;
    }
    if (state.phase !== 'live' && state.phase !== 'planted') return;

    if (state.phase === 'live') {
      state.roundTime -= dt;
      charge.update(state.time, false, 0); // a dropped Charge blinks, waiting
      if (state.roundTime <= 0) { endRound('def', 'time'); return; }
    } else {
      state.bombT -= dt;
      charge.update(state.time, true, 1 - state.bombT / BOMB_TIME);
      if (state.bombT <= 4 && Math.ceil(state.bombT) !== Math.ceil(state.bombT + dt)) audio.beep(state.bombT <= 1.2);
      if (state.bombT <= 0) {
        // Detonation: the fireball first, lethal near the Crucible, then the
        // round is the Kindled's (unless the blast already settled it).
        const bx = state.bomb.x; const bz = state.bomb.z;
        effects.explosion(bx, 1, bz, true);
        audio.explosion();
        for (const t of [...combatants]) {
          if (!t.alive) continue;
          const d = Math.hypot(t.body.pos.x - bx, t.body.pos.z - bz);
          if (d < 13) damage(t, 260 * (1 - d / 15), { cause: 'blast' });
        }
        state.bomb.state = 'detonated';
        if (state.phase === 'planted') endRound('atk', 'detonation');
        return;
      }
    }

    // Brains first (they write desired movement, aim and trigger wishes)…
    for (const c of combatants) {
      if (!c.alive || c.isPlayer) continue;
      thinkBot(c, api, dt);
    }
    // The brains have now heard last tick's sounds; this tick's gunfire (in the
    // loop below) fills the slate for the next tick's thinking.
    state.hear.length = 0;
    // …then bodies, channels, triggers.
    for (const c of combatants) {
      if (!c.alive) continue;
      if (c.channel) {
        if (c.speedNow > 0.6) { c.channel = null; if (c.isPlayer) hud.progress(null); }
        else stepChannels(c, dt);
      }
      stepCombatant(c, dt);
      if (c.wantReload) { startReload(c); c.wantReload = false; }
      if (c.slot === 'grenade') { if (c.wantFire && !c.prevTrigger) throwGrenade(c); }
      else if (c.wantFire) tryFire(c);
      c.prevTrigger = c.wantFire;
      // Bomb pickup: any Kindled walking over a dropped Charge takes it.
      if (state.bomb.state === 'dropped' && c.team === 'atk' && !c.carrier) {
        if (Math.hypot(c.body.pos.x - state.bomb.x, c.body.pos.z - state.bomb.z) < 1.3) {
          c.carrier = true;
          state.bomb.state = 'carried';
          state.bomb.carrierId = c.id;
          charge.group.visible = false;
          if (c.isPlayer) hud.prompt('You have the Charge — plant it at the Crucible');
        }
      }
    }
    stepProjectiles(dt);
    // Separation: bots do not stand inside each other.
    for (let i = 0; i < combatants.length; i++) {
      const a = combatants[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < combatants.length; j++) {
        const b = combatants[j];
        if (!b.alive) continue;
        const dx = b.body.pos.x - a.body.pos.x;
        const dz = b.body.pos.z - a.body.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.001 && d2 < 0.64) {
          const d = Math.sqrt(d2);
          const push = (0.8 - d) * 0.5;
          const nx = dx / d; const nz = dz / d;
          if (!a.isPlayer) { a.body.pos.x -= nx * push; a.body.pos.z -= nz * push; }
          if (!b.isPlayer) { b.body.pos.x += nx * push; b.body.pos.z += nz * push; }
        }
      }
    }
  }

  const api = {
    state,
    player,
    combatants,
    world,
    colliders,
    effects,
    audio,
    rng,
    hud,
    losClear,
    smokeBlocks,
    spreadOf,
    startMatch,
    buyItem,
    switchSlot,
    startReload,
    tryInteract,
    update,
    aliveOf,
  };
  return api;
}
