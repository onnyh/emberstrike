// Boot, the fixed-step loop, and everything that belongs to the person at the
// keyboard: mouse look with recoil, movement, the buy menu, the camera (alive,
// scoped, spectating the team after a death, or orbiting the Crucible behind
// the title screen). The simulation itself lives in game.js and ticks at a
// fixed 60 Hz; this file renders at the display's rate and feeds it input.
//
// Three extra modes ride on the same code, for honest testing and pictures:
//   ?demo=1            an autopilot brain drives the player, bots and all
//   ?test=1            demo plus a result dump into the page when the run ends
//   ?shot=<name>       a staged, seeded scene for screenshots (see shots.json)
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createRng } from './rng.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createWorld } from './world.js';
import { createEffects } from './effects.js';
import { WEAPONS, GRENADES, createViewmodel } from './weapons.js';
import { createGame, currentWeapon, eyePos, BUY_ITEMS, MAX_ROUNDS } from './game.js';
import { createBrain, thinkBot, botBuy } from './bots.js';
import { createHud } from './hud.js';

const STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const demo = params.has('demo') || params.has('test') || !!shotName;
const testMode = params.has('test');
const seed = Number.parseInt(params.get('seed') ?? (demo ? '7' : String(Date.now() % 99991)), 10) || 7;
const rng = createRng(seed);

const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message || e.error || 'unknown')));
window.__ember = { errors };

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// &lowfx=1 is for headless test runs on software rendering: same simulation,
// cheaper pixels (no shadow pass, no retina scaling).
renderer.shadowMap.enabled = !params.has('lowfx');
if (params.has('lowfx')) renderer.setPixelRatio(1);
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
if (demo) for (const k of Object.keys(audio)) audio[k] = () => {}; // staged runs stay silent
const viewmodel = createViewmodel(camera);

let game = null;
let buyOpenUI = false;
let started = false;
let frozen = false;
let recoil = 0;
let recoilYaw = 0;
let scopedNow = false;
let deathT = 0;
let shotsFired = 0;
let demoBoughtRound = 0;
let stage = null; // shot staging state machine

const hud = createHud({
  onPlay: () => {
    audio.unlock();
    hud.hideScreen();
    if (!started) { started = true; game.startMatch(); }
    if (!demo) input.requestLock();
  },
  onRestart: () => {
    audio.unlock();
    hud.hideScreen();
    game.startMatch();
    if (!demo) input.requestLock();
  },
  onBuy: (id) => {
    if (game.buyItem(game.player, id)) refreshBuy();
  },
});
document.getElementById('buy-close').addEventListener('click', () => closeBuy());

const input = createInput(renderer.domElement, (locked) => {
  if (!locked && started && !demo && !buyOpenUI && hud.screenMode() === null) {
    const ph = game.state.phase;
    if (ph === 'buy' || ph === 'live' || ph === 'planted') {
      hud.showScreen('pause', { kicker: 'EMBERSTRIKE', title: 'Paused', copy: 'The round goes on without you — jump back in.', button: 'Back in' });
    }
  }
});

const REASON_TEXT = {
  elimination: ['Enemy team eliminated', 'Your team was eliminated'],
  detonation: ['The Charge detonated at the Crucible', 'The Charge detonated'],
  defused: ['The Charge was defused', 'The Wardens defused the Charge'],
  time: ['Time expired — no plant', 'Time expired — the Charge never went down'],
};

game = createGame({
  scene, world, effects, audio, rng, hud,
  hooks: {
    onPlayerFire(def) {
      viewmodel.fire();
      recoil += def.kick * 0.55;
      recoilYaw += (rng.next() - 0.5) * def.recoil * 0.5;
      shotsFired++;
    },
    onPlayerReload(dur) { viewmodel.startReload(dur); },
    onPlayerWeapon(w, slot) {
      viewmodel.setHeld(slot !== 'grenade');
      if (w) viewmodel.setWeapon(w.def);
    },
    onPlayerDeath() { deathT = 0; },
    onRoundStart(state) {
      deathT = 0;
      hud.banner(`ROUND ${state.round}`, `Kindled ${state.score.atk} — ${state.score.def} Wardens · first to 7`, '', 1.6);
      if (demo) { demoBoughtRound = 0; }
      else if (!shotName) openBuy();
    },
    onLive() { closeBuy(); },
    onRoundEnd(state, winner, reason) {
      closeBuy();
      const won = winner === 'atk';
      const [atkText, defText] = REASON_TEXT[reason] || ['', ''];
      hud.banner(won ? 'ROUND WON' : 'ROUND LOST', winner === 'atk' ? atkText : defText, won ? 'banner-atk' : 'banner-def', 3.4);
    },
    onMatchEnd(state) {
      closeBuy();
      if (demo) return;
      const won = state.winner === 'atk';
      hud.showScreen('end', {
        kicker: 'FULL TIME',
        title: state.winner === 'draw' ? 'Dead heat' : won ? 'The Yard is yours' : 'The Wardens hold',
        copy: `Final score — Kindled ${state.score.atk}, Wardens ${state.score.def}. ${won ? 'The Crucible burns a little brighter tonight.' : 'Regroup, re-buy, and take it back.'}`,
        button: 'Play again',
      });
      document.exitPointerLock && document.exitPointerLock();
    },
    onPlanted() { hud.prompt(''); },
  },
});
window.__ember.game = game;
const player = game.player;
if (demo) player.brain = createBrain(rng, 1.0);

// --- Buy menu -------------------------------------------------------------------
const BUY_DEFS = {
  armor: { name: 'Kevlar Vest', price: 650, detail: 'Armour 100 · halves bullet damage' },
  fullkit: { name: 'Vest + Helmet', price: 1000, detail: 'Armour 100 · blunts headshots' },
  frag: { name: 'Frag Charge', price: GRENADES.frag.price, detail: 'Explosive · clears corners' },
  flash: { name: 'Flash Charge', price: GRENADES.flash.price, detail: 'Blinds whoever looks at it' },
  smoke: { name: 'Smoke Charge', price: GRENADES.smoke.price, detail: 'A wall of grey for 16 seconds' },
  smg: { name: WEAPONS.smg.name, price: WEAPONS.smg.price, detail: 'Fast automatic · 30 rounds' },
  shotgun: { name: WEAPONS.shotgun.name, price: WEAPONS.shotgun.price, detail: '8 pellets · owns close range' },
  rifle: { name: WEAPONS.rifle.name, price: WEAPONS.rifle.price, detail: 'Accurate automatic · the default buy' },
  sniper: { name: WEAPONS.sniper.name, price: WEAPONS.sniper.price, detail: 'One-shot power · right-click scopes' },
};

function buildBuyItems() {
  return BUY_ITEMS.map(({ id, key }) => {
    const def = BUY_DEFS[id];
    let owned = false;
    if (WEAPONS[id]) owned = !!(player.weapons.primary && player.weapons.primary.def.id === id);
    else if (id === 'armor') owned = player.armor >= 100;
    else if (id === 'fullkit') owned = player.armor >= 100 && player.helmet;
    else owned = player.grenades[id] > 0;
    return {
      id, key, name: def.name, price: def.price, detail: def.detail,
      state: owned ? 'owned' : player.money < def.price ? 'cant' : 'buy',
    };
  });
}
function openBuy() { buyOpenUI = true; hud.buyOpen(buildBuyItems(), player.money); }
function refreshBuy() { hud.buyRefresh(buildBuyItems(), player.money); }
function closeBuy() { buyOpenUI = false; hud.buyClose(); }

// --- Player control ---------------------------------------------------------------
function playerTick(dt) {
  const st = game.state;
  player.wantFire = false;
  if (demo) {
    if (st.phase === 'buy') {
      if (shotName !== 'buy' && demoBoughtRound !== st.round) { demoBoughtRound = st.round; botBuy(player, rng, game.buyItem); }
      player.desired.x = 0; player.desired.z = 0;
      return;
    }
    // In the buy and plant stills the staging drives the player, not the brain.
    const stageDrives = shotName === 'buy' || shotName === 'plant';
    if (!stageDrives && player.alive && (st.phase === 'live' || st.phase === 'planted')) thinkBot(player, game, dt);
    return;
  }
  if (!started || hud.screenMode() !== null) { player.desired.x = 0; player.desired.z = 0; input.clearPressed(); return; }
  const look = input.takeLook();
  const sens = scopedNow ? 0.0008 : 0.0021;
  player.yaw -= look.x * sens;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - look.y * sens));
  if (!player.alive) { player.desired.x = 0; player.desired.z = 0; input.clearPressed(); return; }

  const k = input.keys;
  const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
  const r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
  const sy = Math.sin(player.yaw);
  const cy = Math.cos(player.yaw);
  let mx = (-sy) * f + cy * r;
  let mz = (-cy) * f + (-sy) * r;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  if (k.has('ShiftLeft') || k.has('ShiftRight')) { mx *= 0.52; mz *= 0.52; }
  player.desired.x = mx;
  player.desired.z = mz;
  player.desired.crouch = k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC');
  if (input.wasPressed('Space')) player.desired.jump = true;

  const w = currentWeapon(player);
  scopedNow = !!(w && w.def.zoom && input.aiming && player.slot === 'primary' && player.alive);
  player.scopedIn = scopedNow;

  if (buyOpenUI) {
    for (let n = 1; n <= 9; n++) {
      if (input.wasPressed(`Digit${n}`)) {
        const item = hud.buyItems()[n - 1];
        if (item && game.buyItem(player, item.id)) refreshBuy();
      }
    }
    if (input.wasPressed('KeyB')) closeBuy();
    input.clearPressed();
    return;
  }
  player.wantFire = input.firing;
  if (input.wasPressed('KeyR')) player.wantReload = true;
  if (input.wasPressed('KeyE')) game.tryInteract(player);
  if (input.wasPressed('Digit1')) game.switchSlot(player, 'primary');
  if (input.wasPressed('Digit2')) game.switchSlot(player, 'sidearm');
  if (input.wasPressed('Digit3')) {
    if (player.slot === 'grenade') {
      const order = ['frag', 'flash', 'smoke'];
      const next = order[(order.indexOf(player.grenadeSel) + 1) % 3];
      if (player.grenades[next] > 0) player.grenadeSel = next;
    } else game.switchSlot(player, 'grenade');
  }
  if (input.wasPressed('KeyB') && st.phase === 'buy') openBuy();
  input.clearPressed();
}

// --- Camera and HUD sync ------------------------------------------------------------
const eyeTmp = { x: 0, y: 0, z: 0 };
function syncCamera(dt, now) {
  recoil *= Math.exp(-dt * 8.5);
  recoilYaw *= Math.exp(-dt * 8.5);
  const st = game.state;
  if (!started && !demo) {
    // Behind the title: a slow orbit of the Crucible.
    const t = now * 0.00005;
    camera.position.set(24.5 + Math.cos(t) * 13, 6.5, Math.sin(t) * 13);
    camera.lookAt(26, 1.6, -1);
    camera.fov += (60 - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
    return;
  }
  let subject = player;
  let spectating = false;
  if (!player.alive && (st.phase === 'live' || st.phase === 'planted' || st.phase === 'over')) {
    deathT += dt;
    const mate = game.combatants.find((c) => c.team === 'atk' && c.alive && !c.isPlayer);
    if (mate && deathT > 0.9) { subject = mate; spectating = true; }
    hud.note(mate ? (spectating ? `You are down — spectating ${mate.name}` : 'You are down') : 'Your team is wiped — the round is lost');
  } else hud.note(player.alive ? '' : hudNoteForPhase(st));

  eyePos(subject, eyeTmp);
  const bob = subject.body.onGround ? Math.sin(subject.walkCycle * 2.1) * 0.026 * Math.min(1, subject.speedNow / 4) : 0;
  camera.position.set(eyeTmp.x, eyeTmp.y + bob, eyeTmp.z);
  camera.rotation.set(
    subject.pitch + (subject === player ? recoil : 0),
    subject.yaw + (subject === player ? recoilYaw : 0),
    0,
  );
  const w = currentWeapon(player);
  const targetFov = scopedNow && player.alive ? 75 / w.def.zoom : 75;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 11);
    camera.updateProjectionMatrix();
  }
  viewmodel.update(dt, player.alive && player.speedNow > 0.4, scopedNow);
  hud.scoped(scopedNow && player.alive);
}
function hudNoteForPhase() { return ''; }

function syncHud() {
  const st = game.state;
  hud.setHealth(player.hp, player.armor);
  hud.setMoney(player.money);
  hud.setScore(st.score.atk, st.score.def, Math.max(1, st.round), MAX_ROUNDS);
  if (st.phase === 'buy') hud.setTimer(st.phaseT);
  else if (st.phase === 'live') hud.setTimer(st.roundTime, st.roundTime < 11);
  else if (st.phase === 'planted') hud.setTimer(st.bombT, true);
  else hud.setTimer(0);
  hud.chargeBar(st.phase === 'planted' ? 1 - st.bombT / 35 : null);
  const w = currentWeapon(player);
  if (player.slot === 'grenade') hud.setAmmo(player.grenades[player.grenadeSel], 0, GRENADES[player.grenadeSel].name.toUpperCase());
  else if (w) hud.setAmmo(w.mag, w.reserve, w.def.name.toUpperCase());
  hud.setSpread(w && player.alive ? game.spreadOf(player, w.def) * 470 * (75 / camera.fov) : 8);
  // Contextual prompt, highest priority first.
  let prompt = '';
  if (player.alive && st.phase === 'live') {
    if (player.carrier) {
      const s = world.site;
      const inside = player.body.pos.x > s.x0 && player.body.pos.x < s.x1 && player.body.pos.z > s.z0 && player.body.pos.z < s.z1;
      prompt = inside ? 'Hold still and press E to plant the Charge' : 'You carry the Charge — plant it at the Crucible, east';
    } else if (st.bomb.state === 'dropped') prompt = 'The Charge is down — recover it';
  } else if (player.alive && st.phase === 'planted') {
    prompt = player.team === 'atk' ? 'Defend the Charge until it fires' : '';
  } else if (player.alive && st.phase === 'buy') {
    prompt = buyOpenUI ? '' : 'Buy phase — press B for equipment';
  }
  if (!player.channel) hud.prompt(prompt);
}

// --- Shot staging ---------------------------------------------------------------------
function teleport(c, x, z, yaw) {
  c.body.pos.x = x; c.body.pos.z = z; c.body.pos.y = 0;
  c.body.vel.x = 0; c.body.vel.z = 0;
  c.yaw = yaw;
}
function defBots() { return game.combatants.filter((c) => c.team === 'def'); }
function setupShot(name) {
  started = true;
  hud.hideScreen();
  game.startMatch();
  const st = game.state;
  if (name === 'buy') {
    st.phaseT = 999;
    openBuy();
    // Turn the player to face the rest of the Kindled line at spawn.
    player.yaw = Math.atan2(-(1), -(4.5));
    stage = { name, at: 0.4 };
  } else if (name === 'fight') {
    st.phase = 'live';
    st.roundTime = 92;
    // A mid-match still: everyone is on rifles and armour by now.
    for (const c of game.combatants) { c.money = 6000; game.buyItem(c, 'rifle'); game.buyItem(c, 'armor'); }
    teleport(player, 1.5, -1, -Math.PI / 2);
    const defs = defBots();
    teleport(defs[0], 11, -3.5, Math.PI / 2);
    teleport(defs[1], 13.5, 2.5, Math.PI / 2);
    teleport(defs[2], 16, -6, Math.PI / 2);
    for (const d of defs) {
      d.brain.targetId = player.id;
      d.brain.targetRef = player;
      d.brain.reactionT = 0.1;
      d.brain.seenT = 0;
    }
    const mate = game.combatants.find((c) => c.team === 'atk' && !c.isPlayer);
    teleport(mate, -2.5, 3.5, -Math.PI / 2);
    stage = { name, t: 0, contact: false };
  } else if (name === 'plant') {
    st.phase = 'live';
    st.roundTime = 80;
    for (const c of game.combatants) { c.money = 6000; game.buyItem(c, 'rifle'); }
    const carrier = game.combatants.find((c) => c.carrier);
    if (carrier && carrier !== player) { carrier.carrier = false; player.carrier = true; st.bomb.carrierId = player.id; }
    teleport(player, world.site.plantX - 1.2, world.site.plantZ - 0.6, -Math.PI / 2);
    game.tryInteract(player);
    stage = { name, planted: false, t: 0 };
  } else if (name === 'win') {
    stage = { name };
  } else {
    stage = { name: 'fight', t: 0, contact: false };
    st.phase = 'live';
  }
}

function stageTick(dt) {
  if (!stage || frozen) return;
  const st = game.state;
  if (stage.name === 'buy') {
    st.phaseT = 999;
    stage.at -= dt;
    if (stage.at <= 0) freeze();
  } else if (stage.name === 'fight') {
    stage.t += dt;
    const anyContact = defBots().some((d) => d.alive && d.brain.targetId === player.id && d.brain.seenT < 0.4);
    if (anyContact) stage.contact = true;
    const playerContact = player.brain && player.brain.targetId && player.brain.seenT < 0.4;
    if ((stage.contact && playerContact && stage.t > 1.2) || stage.t > 22) {
      // Two more ticks so a tracer and the muzzle flash are in the air, then hold.
      stage.endIn = (stage.endIn ?? 2) - 1;
      if (stage.endIn <= 0) freeze();
    }
  } else if (stage.name === 'plant') {
    stage.t += dt;
    if (!stage.planted) {
      player.desired.x = 0; player.desired.z = 0;
      if (st.phase === 'planted') {
        stage.planted = true;
        stage.t = 0;
        teleport(player, 20.2, -4.2, Math.PI); // hold the north angle over the site
        player.desired.crouch = true;
      }
    } else {
      player.desired.x = 0; player.desired.z = 0;
      player.desired.crouch = true;
      player.yaw = Math.PI + Math.sin(stage.t * 0.5) * 0.14;
      if (stage.t > 1.7) freeze();
    }
  } else if (stage.name === 'win') {
    if (st.phase === 'over' || st.phase === 'matchover') freeze();
  }
}

function freeze() {
  frozen = true;
  window.__shotReady = true;
}

// --- The loop ---------------------------------------------------------------------------
let accumulator = 0;
let lastTime = performance.now();
let testDumped = false;
let frameCount = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  // A human's tab never legitimately lags a quarter second; a headless test
  // run on software rendering may, and there the sim is allowed to catch up.
  const dtCap = demo ? 1.0 : 0.25;
  if (dt > dtCap) dt = dtCap;
  if (!frozen) {
    accumulator += dt;
    while (accumulator >= STEP) {
      playerTick(STEP);
      game.update(STEP);
      stageTick(STEP);
      accumulator -= STEP;
      if (frozen) break;
    }
    world.updateFx(now / 1000);
    effects.update(dt, camera);
    syncCamera(dt, now);
    syncHud();
    hud.update(dt);
    if (testMode && !testDumped && ((game.state.round >= 4 && game.state.phase === 'over') || game.state.time > 300 || game.state.phase === 'matchover')) {
      testDumped = true;
      const totalKills = game.combatants.reduce((s, c) => s + c.kills, 0);
      const pre = document.createElement('pre');
      pre.id = 'testlog';
      pre.textContent = JSON.stringify({
        phase: game.state.phase, round: game.state.round, score: game.state.score,
        winner: game.state.winner, shotsFired, totalKills, errors,
        playerHp: player.hp, simTime: Math.round(game.state.time),
      });
      document.body.appendChild(pre);
      document.title = 'TESTDONE';
      window.__shotReady = true;
    }
  }
  // In lowfx test runs the software renderer is the bottleneck, not the sim:
  // draw one frame in six and let the simulation spend the savings.
  frameCount++;
  if (!params.has('lowfx') || frozen || frameCount % 6 === 0) renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.showScreen('title', {
  kicker: 'A THREE.JS TACTICAL FPS',
  title: 'EMBERSTRIKE',
  copy: 'Five Kindled against five Wardens in a dusk foundry yard. Carry the Charge to the Crucible and plant it, or wipe the other team — money between rounds buys rifles, armour and grenades. Accuracy pays: stop moving to shoot straight.',
  button: 'Deploy',
});
if (shotName) setupShot(shotName);
else if (demo) { started = true; hud.hideScreen(); game.startMatch(); }
requestAnimationFrame(frame);
