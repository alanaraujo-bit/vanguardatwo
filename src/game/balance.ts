/** Central tuning table — every gameplay number lives here or in a def table. */
export const BAL = {
  player: {
    hp: 100,
    speed: 178,
    damage: 10,
    fireInterval: 0.52,
    projSpeed: 560,
    projLife: 1.05,
    radius: 13,
    magnet: 72,
    critChance: 0.05,
    critMult: 2,
    aimRange: 500,
    iframes: 0.8,
    // Movement response rates (damp): braking and reversing are much faster
    // than accelerating so the ship stops where the thumb stops and dodges
    // bite immediately, while keeping a smooth ramp-up.
    move: { accel: 24, brake: 40, flip: 42 },
  },
  xpNeed(level: number): number {
    return Math.round(6 + (level - 1) * 4 + Math.pow(level - 1, 1.85));
  },
  wave: {
    duration: 20,
    bossEvery: 5,
    spawnInterval(wave: number): number {
      return Math.max(0.24, 0.85 - wave * 0.05);
    },
    maxAlive(wave: number): number {
      return Math.min(210, 24 + wave * 8);
    },
    hpMul(wave: number): number {
      return 1 + (wave - 1) * 0.22 + Math.pow(Math.max(0, wave - 9), 1.5) * 0.035;
    },
    dmgMul(wave: number): number {
      return 1 + (wave - 1) * 0.07;
    },
    bossHp(wave: number): number {
      return 520 * (1 + (wave / 5 - 1) * 1.15);
    },
  },
  combo: {
    window: 2.2,
    xpPerStack: 0.01,
    maxStack: 50,
    showFrom: 5,
  },
  drops: {
    coinChance: 0.11,
    heartChanceTank: 0.18,
    bossCoins: [14, 22] as const,
  },
  score: {
    perKill: 25,
    perWave: 150,
    perSecond: 4,
    coinsPerWave: 3,
  },
} as const;
