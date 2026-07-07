import type { CoopSim } from '../src/game/sim';
import { ENEMY_KINDS, PICKUP_KINDS, q100, q1, type PlayerSnap, type Snap } from '../src/net/realtime';

/**
 * CoopSim → wire snapshot. Positions round to whole pixels and angles to
 * 1/100 rad — far below perceptible error, and it keeps the JSON short
 * (deflate does the rest). `ack` is per-connection, so this returns a base
 * the room personalizes with a spread per client.
 */
export function encodeSnap(sim: CoopSim): Omit<Snap, 'ack'> {
  const players: PlayerSnap[] = sim.players.map((p) => {
    const s = sim.statFor(p.slot);
    return {
      slot: p.slot,
      x: q1(p.x), y: q1(p.y),
      vx: q1(p.vx), vy: q1(p.vy),
      hp: Math.ceil(p.hp), maxHp: p.stats.maxHp,
      level: p.level, xp: Math.round(p.xp * 10) / 10, xpNeed: p.xpNeed,
      coins: s.coins,
      score: s.score,
      kills: s.kills,
      dead: p.dead,
      ifr: Math.max(0, Math.round(p.iframes * 100) / 100),
      facing100: q100(p.facing),
      choosing: sim.isChoosing(p.slot),
    };
  });

  const enemies: number[] = [];
  for (const e of sim.enemies.list) {
    if (e.dead) continue;
    enemies.push(e.id, ENEMY_KINDS.indexOf(e.kind), q1(e.x), q1(e.y), q100(e.rot), e.flash > 0 ? 1 : 0);
  }

  const eshots: number[] = [];
  for (const o of sim.enemyShots.active) {
    eshots.push(o.id, q1(o.x), q1(o.y), q1(o.vx), q1(o.vy));
  }

  const pshots: number[] = [];
  for (const s of sim.playerShots.active) {
    pshots.push(s.id, q1(s.x), q1(s.y), q100(s.angle), s.crit ? 1 : 0, s.owner);
  }

  const pickups: number[] = [];
  for (const p of sim.pickups.active) {
    pickups.push(p.id, PICKUP_KINDS.indexOf(p.kind), q1(p.x), q1(p.y));
  }

  const boss = sim.enemies.boss;
  return {
    tick: sim.tickNo,
    wave: sim.wave,
    players,
    enemies,
    eshots,
    pshots,
    pickups,
    boss: boss ? [Math.ceil(boss.hp), Math.ceil(boss.maxHp)] : null,
    ev: sim.drainEvents(),
  };
}
