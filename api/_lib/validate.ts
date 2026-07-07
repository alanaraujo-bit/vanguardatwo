import type { RunSubmission } from '../../src/net/protocol';

/**
 * Server-side plausibility rules for run submissions. Formulas derive from
 * the game's actual pacing (src/game/balance.ts + waves.ts): non-boss waves
 * last exactly 20 s, boss waves add a 1.7 s warning and only end on the kill,
 * scoring is killScore + wave*150 + time*4, per-enemy score caps at 50
 * (bosses 500), and coin drops cap at 3/kill (bosses 22) times greed ×1.5.
 * These are anti-absurdity bounds, not exact replays — legit runs pass with
 * a wide margin; hand-crafted "wave 40 in 90 s" submissions do not.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

export function parseRun(body: unknown): RunSubmission | null {
  if (typeof body !== 'object' || body === null) return null;
  const r = body as Record<string, unknown>;
  if (typeof r.runId !== 'string' || !UUID_RE.test(r.runId)) return null;
  if (!isInt(r.wave, 1, 500)) return null;
  if (!isInt(r.score, 0, 10_000_000)) return null;
  if (!isInt(r.kills, 0, 500_000)) return null;
  if (!isInt(r.coins, 0, 100_000)) return null;
  if (typeof r.time !== 'number' || !Number.isFinite(r.time)) return null;
  return {
    runId: r.runId.toLowerCase(),
    wave: r.wave,
    score: r.score,
    kills: r.kills,
    coins: r.coins,
    time: r.time,
  };
}

export function runPlausible(run: RunSubmission): boolean {
  const { wave, score, kills, coins, time } = run;
  if (time < 5 || time > 4 * 3600) return false;

  // Bosses defeated to have advanced past waves 5, 10, 15…
  const bosses = Math.floor((wave - 1) / 5);
  const timedWaves = wave - 1 - bosses;

  // Completed timed waves take exactly 20 s each; boss waves at least the
  // 1.7 s warning. 2 s tolerance for clamped death-frame deltas.
  if (time < 20 * timedWaves + 1.7 * bosses - 2) return false;

  // Spawn-rate ceiling (batch size / interval, incl. splitter births).
  if (kills > 20 + 80 * time) return false;

  // Each boss killed is a kill.
  if (kills < bosses) return false;

  // Score: per-kill ≤ 50 (+450 extra per boss) + wave & time bonuses.
  if (score > 50 * kills + 450 * bosses + wave * 150 + Math.ceil(time * 4) + 1000) return false;
  if (score < wave * 150) return false;

  // Coins: worst case every kill drops 3 (tank), bosses 22, greed ×1.5,
  // plus the per-wave end bonus.
  if (coins > Math.ceil(1.5 * (3 * kills + 22 * bosses)) + wave * 3 + 50) return false;

  return true;
}
