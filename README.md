# EMBERSTRIKE

An original round-based tactical FPS for the browser, built on three.js 0.187.0.
Five **Kindled** attack a dusk foundry yard against five **Wardens**: carry the
Charge to the Crucible and plant it, or eliminate the other team — then spend
what you earned on rifles, armour and grenades before the next round. First
team to 7 rounds takes the match. Single player: you lead the Kindled, bots
fill both teams, and the bots navigate the yard's three lanes, hold angles,
hear your gunfire, plant and defuse.

Accuracy is the house rule. Spread stays tight standing still, blooms when you
run or jump, and tightens when you crouch — stopping to shoot is a real
decision, for the bots exactly as much as for you.

## How to play

- **WASD** move · **mouse** look · **click** fire · **right-click** scope (Longshot L-50)
- **Shift** walk · **Ctrl / C** crouch · **Space** jump · **R** reload
- **1 / 2 / 3** primary / sidearm / grenade (3 again cycles grenade type)
- **B** buy menu during the buy phase (or keys **1–9** while it is open)
- **E** plant the Charge inside the Crucible site

The armoury: P9 Sparrow sidearm, Vex-9 SMG, Mule-12 shotgun, Kestrel RK rifle,
Longshot L-50 sniper — plus frag, flash and smoke charges, a Kevlar vest and a
helmet kit. Kills pay $300; rounds pay $3,250–$3,500 to the winners, with a
loss bonus that grows on a losing streak.

## The yard

One original map, three lanes: the open **Casting Hall** in the north, the
**container yard** in the middle, and the **Slag Run** corridor in the south,
all converging on the **Crucible** — a furnace platform in the east with its
own cover, sightlines and plant zone.

## Running it

The game is plain static files under `game/` — serve that folder with any
static server and open `index.html` in desktop Chrome. It plays fully offline;
three.js is vendored beside it. From this repository:

```sh
node serve.ts   # then open http://localhost:8080
```

`main.ts` is the hand-in program: it copies `game/` and `screenshots/` to the
output directory and writes the entry's `dossier.json` with the vendored
make.fun library.

## Code layout

One job per module under `game/src/`: `game.js` holds all match state and the
round rules and resolves every shot (the player's and the bots' through the
same path); `bots.js` is perception, navigation and intent; `world.js` builds
the Foundry Yard, its colliders and its nav graph; `physics.js` moves bodies
and tests rays; `weapons.js` is the armoury data plus the first-person
viewmodels; `effects.js` pools tracers, sparks, explosions and sight-blocking
smoke; `audio.js` synthesizes every sound with WebAudio; `hud.js` is the 2D
layer; `main.js` is input, camera and the fixed-step loop that ties it
together. The simulation ticks at a fixed 60 Hz, apart from rendering.
