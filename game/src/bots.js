// Bot brains: perception, navigation and intent. A brain never touches the
// world directly — each tick it reads the match through the game's api (line
// of sight, sounds, the roster) and writes the same control fields a human
// writes for the player: a desired move direction, a yaw and pitch to turn
// toward, and whether it wants the trigger held. The game moves and shoots
// for it, so a bot's bullets obey the same spread and damage as the player's.
//
// Bots see through a field of view with a reaction delay, hear gunfire and
// blasts, remember where an enemy was last seen, follow the nav graph down
// the lanes, hold the Crucible as Wardens, push and plant as Kindled, rotate
// when the Charge goes down, and fight in bursts — stopping to shoot, because
// the spread model punishes firing on the move for them too.
import { findPath, nearestNode } from './nav.js';
import { forwardOf, eyePos } from './game.js';

const FOV_COS = Math.cos(1.12); // ~64 degrees either side of the nose

export function createBrain(rng, skill) {
  return {
    skill,
    rng,
    blind: 0,
    plan: [],
    goalNode: -1,
    path: [],
    pathI: 0,
    holdNode: -1,
    preferHold: -1,
    baseYaw: 0,
    targetId: 0,
    seenT: 99,
    seenPos: { x: 0, y: 0, z: 0 },
    reactionT: 0,
    aimHead: false,
    aimErr: 0.05,
    burstLeft: 0,
    burstWait: 0,
    lastMag: 0,
    strafeT: 0,
    strafeDir: 1,
    heardPos: null,
    heardAge: 99,
    percT: rng.next() * 0.12,
    stuckT: 0,
    grenadeStep: 0,
    grenadeCd: rng.range(6, 14),
    scanPhase: rng.range(0, 6),

    resetRound(c, world) {
      this.plan = [];
      this.path = [];
      this.pathI = 0;
      this.targetId = 0;
      this.seenT = 99;
      this.heardPos = null;
      this.heardAge = 99;
      this.burstLeft = 0;
      this.burstWait = 0;
      this.grenadeStep = 0;
      const rngPick = (list) => list[Math.floor(this.rng.next() * list.length)];
      if (c.team === 'def') {
        this.holdNode = this.preferHold >= 0 ? this.preferHold : rngPick(world.holdDef);
        this.plan = [this.holdNode];
        const n = world.nav.nodes[this.holdNode];
        this.baseYaw = Math.atan2(-(0 - n.x), -(0 - n.z)); // face the yard's centre
      } else if (c.carrier) {
        this.plan = [rngPick([5, 11, 15]), 23];
      } else {
        this.plan = [rngPick([5, 11, 15, 9]), rngPick([24, 25, 22, 21, 20])];
      }
      this.goalNode = this.plan[0];
    },
    onHurt(attacker) {
      if (!attacker || !attacker.alive) return;
      this.seenPos.x = attacker.body.pos.x;
      this.seenPos.y = attacker.body.pos.y + 1.2;
      this.seenPos.z = attacker.body.pos.z;
      if (!this.targetId) { this.targetId = attacker.id; this.reactionT = Math.min(this.reactionT, 0.16); }
      this.seenT = 0;
    },
    onPlanted() {
      this.plan = [];
      this.goalNode = -1;
    },
  };
}

// The buy menu, as a bot works it: a gun first, then armour, then a grenade
// with what's left. Buys through the game's own buyItem, so prices and the
// $16,000 cap apply to bots exactly as to the player.
export function botBuy(c, rng, buyItem) {
  const hasPrimary = !!c.weapons.primary;
  if (!hasPrimary) {
    if (c.money >= 4750 && c.team === 'def' && rng.chance(0.3)) buyItem(c, 'sniper');
    else if (c.money >= 2700) buyItem(c, 'rifle');
    else if (c.money >= 1250) buyItem(c, rng.chance(0.62) ? 'smg' : 'shotgun');
  }
  if (c.armor < 100) {
    if (c.money >= 1000 && (c.weapons.primary || c.money >= 2100)) buyItem(c, 'fullkit');
    else if (c.money >= 650 && c.weapons.primary) buyItem(c, 'armor');
  }
  if (c.money >= 700) {
    if (rng.chance(0.55)) buyItem(c, 'frag');
    if (c.money >= 500 && rng.chance(0.4)) buyItem(c, 'flash');
    if (c.money >= 500 && rng.chance(0.3)) buyItem(c, 'smoke');
  }
}

const tmpEye = { x: 0, y: 0, z: 0 };
const tmpDir = { x: 0, y: 0, z: 0 };

function yawToward(c, tx, tz) {
  return Math.atan2(-(tx - c.body.pos.x), -(tz - c.body.pos.z));
}

function turnToward(c, wantYaw, wantPitch, dt, rate = 3.6) {
  let dy = wantYaw - c.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  const maxTurn = rate * dt;
  c.yaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
  const dp = wantPitch - c.pitch;
  c.pitch += Math.max(-maxTurn, Math.min(maxTurn, dp));
  return Math.abs(dy);
}

function setMove(c, tx, tz, speed = 1) {
  const dx = tx - c.body.pos.x;
  const dz = tz - c.body.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.35) { c.desired.x = 0; c.desired.z = 0; return d; }
  c.desired.x = (dx / d) * speed;
  c.desired.z = (dz / d) * speed;
  return d;
}

function followPath(c, api, dt) {
  const brain = c.brain;
  if (brain.goalNode < 0) return true;
  const nav = api.world.nav;
  if (brain.pathGoal !== brain.goalNode || brain.path.length === 0 || brain.pathI >= brain.path.length) {
    const from = nearestNode(nav, c.body.pos.x, c.body.pos.z);
    brain.path = findPath(nav, from, brain.goalNode);
    brain.pathI = 0;
    brain.pathGoal = brain.goalNode;
  }
  const node = nav.nodes[brain.path[brain.pathI]];
  if (!node) return true;
  const d = setMove(c, node.x, node.z);
  const last = brain.pathI >= brain.path.length - 1;
  if (d < (last ? 1.35 : 1.05)) {
    brain.pathI++;
    if (brain.pathI >= brain.path.length) {
      brain.path = [];
      return true; // arrived at the goal node
    }
  }
  // Stuck? Hop and replan.
  if (c.speedNow < 0.35 && d > 1.4) {
    brain.stuckT += dt;
    if (brain.stuckT > 1.1) { c.desired.jump = true; brain.path = []; brain.stuckT = 0; }
  } else brain.stuckT = 0;
  return false;
}

function perceive(c, api, dt) {
  const brain = c.brain;
  brain.percT -= dt;
  brain.seenT += dt;
  brain.heardAge += dt;
  // Sounds arrive whether or not this is a perception tick.
  for (const ev of api.state.hear) {
    const d = Math.hypot(ev.x - c.body.pos.x, ev.z - c.body.pos.z);
    if (d < ev.radius) { brain.heardPos = { x: ev.x, z: ev.z }; brain.heardAge = 0; }
  }
  if (brain.percT > 0) return;
  brain.percT = 0.12;
  const eye = eyePos(c, tmpEye);
  forwardOf(c.yaw, 0, tmpDir);
  let best = null;
  let bestD = Infinity;
  for (const t of api.combatants) {
    if (!t.alive || t.team === c.team) continue;
    const dx = t.body.pos.x - c.body.pos.x;
    const dz = t.body.pos.z - c.body.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 70) continue;
    const dot = dist > 0.01 ? (tmpDir.x * dx + tmpDir.z * dz) / dist : 1;
    if (dot < FOV_COS && dist > 7) continue; // outside the field of view
    const ty = t.body.pos.y + t.body.height * 0.62;
    if (!api.losClear(eye.x, eye.y, eye.z, t.body.pos.x, ty, t.body.pos.z)) continue;
    if (dist < bestD) { bestD = dist; best = t; }
  }
  if (best) {
    if (brain.targetId !== best.id) {
      brain.targetId = best.id;
      brain.reactionT = 0.55 - brain.skill * 0.27;
      brain.aimHead = api.rng.next() < brain.skill * 0.34;
      brain.aimErr = 0.055;
    }
    brain.seenT = 0;
    brain.seenPos.x = best.body.pos.x;
    brain.seenPos.y = best.body.pos.y + best.body.height * (brain.aimHead ? 0.88 : 0.62);
    brain.seenPos.z = best.body.pos.z;
    brain.targetRef = best;
  }
}

function engage(c, api, dt) {
  const brain = c.brain;
  const t = brain.targetRef;
  const rng = api.rng;
  if (!t || !t.alive) { brain.targetId = 0; return false; }
  const dx = t.body.pos.x - c.body.pos.x;
  const dz = t.body.pos.z - c.body.pos.z;
  const dist = Math.hypot(dx, dz);
  const aimY = t.body.pos.y + t.body.height * (brain.aimHead ? 0.88 : 0.6);
  const wantYaw = yawToward(c, t.body.pos.x, t.body.pos.z);
  const wantPitch = Math.atan2(aimY - (c.body.pos.y + c.body.height - 0.16), dist);
  const aimOff = turnToward(c, wantYaw, wantPitch, dt, 3.8);
  brain.reactionT -= dt;
  brain.aimErr = Math.max(0.034 - brain.skill * 0.012, brain.aimErr - dt * 0.02);

  // Footwork: close in from far, strafe in the middle band, hold close up.
  brain.strafeT -= dt;
  if (brain.strafeT <= 0) { brain.strafeT = rng.range(0.6, 1.3); brain.strafeDir = rng.sign(); }
  c.desired.crouch = false;
  if (dist > 26) setMove(c, t.body.pos.x, t.body.pos.z);
  else if (dist > 7) {
    const px = (-dz / dist) * brain.strafeDir;
    const pz = (dx / dist) * brain.strafeDir;
    if (rng.chance(0.35)) { c.desired.x = 0; c.desired.z = 0; c.desired.crouch = rng.chance(0.4); }
    else { c.desired.x = px; c.desired.z = pz; }
  } else { c.desired.x = 0; c.desired.z = 0; }

  // A frag for a mid-range target, now and then, before the shooting starts.
  brain.grenadeCd -= dt;
  if (brain.grenadeStep === 0 && c.grenades.frag > 0 && brain.grenadeCd <= 0 && dist > 9 && dist < 24 && brain.reactionT <= 0) {
    api.switchSlot(c, 'grenade');
    brain.grenadeStep = 1;
    return true;
  }
  if (brain.grenadeStep === 1) {
    if (c.drawT > 0) return true; // still raising the grenade; the throw waits
    c.wantFire = true; // the game reads a fresh press on the grenade slot as a throw
    brain.grenadeStep = 2;
    brain.grenadeCd = rng.range(9, 16);
    return true;
  }
  if (brain.grenadeStep === 2) {
    api.switchSlot(c, c.weapons.primary ? 'primary' : 'sidearm');
    brain.grenadeStep = 0;
    return true;
  }

  // Burst discipline: fire in short bursts once the aim has settled.
  const w = c.weapons[c.slot];
  if (w) {
    if (brain.lastMag > w.mag) brain.burstLeft -= brain.lastMag - w.mag;
    brain.lastMag = w.mag;
  }
  brain.burstWait -= dt;
  if (brain.burstLeft <= 0 && brain.burstWait <= 0) {
    brain.burstLeft = rng.int(2, 4);
    brain.burstWait = rng.range(0.5, 0.95) + dist * 0.008;
  }
  const canShoot = brain.reactionT <= 0 && brain.seenT < 0.25 && aimOff < 0.09 + brain.aimErr;
  c.wantFire = canShoot && brain.burstLeft > 0;
  if (w && w.mag === 0) c.wantReload = true;
  else if (w && w.mag < w.def.mag * 0.25 && brain.seenT > 0.8) c.wantReload = true;
  return true;
}

export function thinkBot(c, api, dt) {
  const brain = c.brain;
  const state = api.state;
  c.wantFire = false;
  c.desired.crouch = false;
  brain.blind = Math.max(0, brain.blind - dt);
  if (brain.blind > 0.3) {
    c.desired.x = 0; c.desired.z = 0;
    return;
  }
  if (c.channel) { c.desired.x = 0; c.desired.z = 0; return; }
  perceive(c, api, dt);

  const fighting = brain.targetId && brain.seenT < 2.4 && brain.targetRef && brain.targetRef.alive;
  if (fighting) { engage(c, api, dt); return; }
  brain.targetId = 0;
  c.desired.x = 0; c.desired.z = 0;

  // Recently seen but lost: push the last known position.
  if (brain.seenT < 2.4) {
    turnToward(c, yawToward(c, brain.seenPos.x, brain.seenPos.z), 0, dt);
    setMove(c, brain.seenPos.x, brain.seenPos.z, 0.85);
    return;
  }

  const nav = api.world.nav;
  if (state.phase === 'planted') {
    if (c.team === 'def') {
      const dBomb = Math.hypot(c.body.pos.x - state.bomb.x, c.body.pos.z - state.bomb.z);
      // The nearest living Warden defuses; the rest take cover at the site.
      let nearest = true;
      for (const t of api.combatants) {
        if (t.team === 'def' && t.alive && t !== c) {
          if (Math.hypot(t.body.pos.x - state.bomb.x, t.body.pos.z - state.bomb.z) < dBomb) nearest = false;
        }
      }
      if (nearest) {
        if (dBomb > 1.5) {
          brain.goalNode = nearestNode(nav, state.bomb.x, state.bomb.z);
          if (followPath(c, api, dt)) setMove(c, state.bomb.x, state.bomb.z);
          turnToward(c, yawToward(c, state.bomb.x, state.bomb.z), 0, dt);
        } else {
          turnToward(c, yawToward(c, state.bomb.x, state.bomb.z), 0, dt);
          api.tryInteract(c);
        }
        return;
      }
      brain.goalNode = [24, 25, 22][c.id % 3];
      if (!followPath(c, api, dt)) { turnToward(c, yawToward(c, state.bomb.x, state.bomb.z), 0, dt); return; }
      turnToward(c, brain.baseYaw + Math.PI / 2, 0, dt, 1.4);
      return;
    }
    // Kindled after the plant: hold angles around the Crucible.
    brain.goalNode = [24, 25, 21, 20][c.id % 4];
    if (!followPath(c, api, dt)) return;
    const watch = yawToward(c, state.bomb.x, state.bomb.z);
    turnToward(c, watch + Math.sin(api.state.time * 0.4 + brain.scanPhase) * 0.5, 0, dt, 1.4);
    c.desired.crouch = c.id % 2 === 0;
    return;
  }

  // Live round, no contact: work the plan.
  if (c.team === 'atk' && c.carrier) {
    if (brain.plan.length === 0) brain.plan = [23];
    brain.goalNode = brain.plan[0];
    if (followPath(c, api, dt)) {
      brain.plan.shift();
      if (brain.plan.length === 0) {
        // At the plant spot: plant when the site looks quiet.
        const d = Math.hypot(c.body.pos.x - api.world.site.plantX, c.body.pos.z - api.world.site.plantZ);
        if (d > 2.4) { setMove(c, api.world.site.plantX, api.world.site.plantZ); return; }
        turnToward(c, Math.PI / 2, 0, dt);
        if (brain.seenT > 1.1) api.tryInteract(c);
      }
    }
    return;
  }
  if (brain.plan.length > 0) {
    brain.goalNode = brain.plan[0];
    if (followPath(c, api, dt)) brain.plan.shift();
    return;
  }
  // Plan done: hold the final node and scan.
  const node = brain.goalNode >= 0 ? nav.nodes[brain.goalNode] : null;
  if (node) {
    const d = Math.hypot(c.body.pos.x - node.x, c.body.pos.z - node.z);
    if (d > 1.2) { setMove(c, node.x, node.z); return; }
  }
  if (c.team === 'def') {
    const sweep = Math.sin(api.state.time * 0.33 + brain.scanPhase) * 0.7;
    turnToward(c, brain.baseYaw + sweep, 0, dt, 1.2);
    c.desired.crouch = c.id % 3 === 0;
  } else {
    // Kindled staging: watch the site from the final node.
    const watch = yawToward(c, api.world.site.plantX, api.world.site.plantZ);
    turnToward(c, watch + Math.sin(api.state.time * 0.3 + brain.scanPhase) * 0.45, 0, dt, 1.2);
  }
  // A sound worth investigating pulls a holder off its spot toward the site side.
  if (brain.heardAge < 3.5 && brain.heardPos && c.team === 'def') {
    const hx = brain.heardPos.x;
    if (hx > c.body.pos.x - 4) { // the noise is toward the site: lean that way
      brain.goalNode = nearestNode(nav, hx, brain.heardPos.z);
      brain.plan = [brain.goalNode];
    }
  }
}
