// EMBERSTRIKE — the program that hands the game in (Node 22, standard library only).
//
// The game itself is the game/ folder beside this file: plain static files a browser
// loads as ES modules, with three.js 0.187.0 vendored behind an import map. This
// program copies game/ and screenshots/ into the output directory and writes
// dossier.json there with buildDossier from the vendored make.fun library — the
// same library the scorer runs, so the dossier it writes here is the dossier the
// scorer rebuilds and compares byte for byte.
//
// In the grader the output directory is /output; anywhere else MAKEFUN_OUTPUT_DIR
// names it instead:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play the game locally with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(repoDir, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoDir, 'screenshots'))) {
  cpSync(join(repoDir, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// The caps are the scorer's own (see the competition's gate): the dossier text is
// capped at 160 KiB, screenshots at 4 files of 256 KiB, game/ at 993 entries and
// 48 MiB. buildDossier refuses anything beyond them, exactly as the scorer would.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
