import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Headless smoke test: bundles CoopSim for Node and runs a bot match for a
 * few simulated minutes. Proves the whole gameplay core (waves, enemies,
 * shots, pickups, XP, level-ups, death) runs without a DOM and that the
 * numbers move in the right direction. Used by F2+ as a fast regression.
 */

const dir = mkdtempSync(join(tmpdir(), 'vg-sim-'));
const entry = join(dir, 'entry.mjs');

await build({
  stdin: {
    contents: `export * from './src/game/sim.ts'; export { SIM_RATE } from './src/net/realtime.ts';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent',
});

const { CoopSim, statsForMeta, SIM_RATE } = await import(pathToFileURL(entry).href);
rmSync(dir, { recursive: true, force: true });

const statsFor = statsForMeta({});
const sim = new CoopSim({ playerCount: 2, statsFor: (s, lv) => statsFor(s, lv) });

const MINUTES = 3;
let offers = 0;
let events = 0;
let maxEnemies = 0;
const t0 = Date.now();

for (let t = 0; t < SIM_RATE * 60 * MINUTES && !sim.over; t++) {
  // Bots: circle in opposite phases so they spread out and sweep loot.
  const a = (t / SIM_RATE) * 0.9;
  sim.setIntent(0, Math.cos(a), Math.sin(a));
  sim.setIntent(1, Math.cos(a + Math.PI), Math.sin(a + Math.PI));
  sim.tick();
  maxEnemies = Math.max(maxEnemies, sim.enemies.list.length);

  for (const offer of sim.drainOffers()) {
    offers++;
    sim.applyPick(offer.slot, offer.offerId, offer.choices[0]);
  }
  events += sim.drainEvents().length;
}

const wallMs = Date.now() - t0;
const p0 = sim.players[0];
const p1 = sim.players[1];
const stat0 = sim.statFor(0);
const stat1 = sim.statFor(1);

console.log(`ticks: ${sim.tickNo} (${(sim.runTime / 60).toFixed(1)} min simulados em ${wallMs}ms)`);
console.log(`onda: ${sim.wave} | inimigos max vivos: ${maxEnemies} | eventos: ${events} | ofertas de upgrade: ${offers}`);
console.log(`p0: lv ${p0.level} xp ${p0.xp.toFixed(1)} hp ${p0.hp.toFixed(0)} dead ${p0.dead} | kills ${stat0.kills} score ${stat0.score} coins ${stat0.coins}`);
console.log(`p1: lv ${p1.level} xp ${p1.xp.toFixed(1)} hp ${p1.hp.toFixed(0)} dead ${p1.dead} | kills ${stat1.kills} score ${stat1.score} coins ${stat1.coins}`);
console.log('results:', JSON.stringify(sim.results()));

const fail = (msg) => {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
};
if (sim.tickNo < SIM_RATE * 30) fail('sim terminou cedo demais');
if (sim.wave < 2) fail('nenhuma onda avançou');
if (stat0.kills + stat1.kills < 20) fail('quase nenhum abate — combate quebrado');
if (p0.level + p1.level < 4) fail('XP/gemas não fluem — coleta quebrada');
if (offers < 2) fail('nenhuma oferta de level-up');
console.log('SMOKE OK');
