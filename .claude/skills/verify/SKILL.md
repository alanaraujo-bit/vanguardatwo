---
name: verify
description: Build, launch and drive VANGUARDA (canvas arena roguelite) to verify gameplay changes end-to-end in a headless browser.
---

# Verifying VANGUARDA

## Launch

- Dev server: `npm run dev` → esbuild watch + serve at `http://127.0.0.1:8137`.
  It is often ALREADY running (port bind error = someone's watching copy is live;
  use it, don't kill it). Watch mode rebuilds on save — confirm freshness by
  fetching `http://127.0.0.1:8137/main.js` and grepping for a symbol from your
  change (serve builds are unminified).
- Typecheck: `npm run typecheck`. Gotcha: `BAL` in `src/game/balance.ts` is
  `as const`, so locals initialized from it infer literal types — annotate
  (`let x: number = BAL...`) when reassigning.

## Drive (headless browser)

No test framework. Use `playwright-core` from the project's own
`node_modules` (`createRequire('c:/.../vangaudatwo/package.json')`) with an
installed channel: `chromium.launch({ channel: 'msedge' })` (fallback
`'chrome'`). No browsers are downloaded.

Flow to reach gameplay:
1. `goto`, wait for `#game`, ~1.2s for the boot splash to fade.
2. Click `button` with text `JOGAR` → run starts (~0.7s).
3. Keyboard: WASD/arrows via `page.keyboard.down/up('KeyD')`.
   Virtual joystick: `page.mouse.down()` anywhere on canvas + drag.
4. A level-up overlay (`.screen button.card`) can appear mid-test once kills
   accumulate — it pauses gameplay; click the first card to resume.

## Observe

The game exposes no globals; observe via the canvas itself in
`page.evaluate` (`getContext('2d').getImageData` — returns the live context):
- **Motion metric**: sample pixels twice ~130ms apart, count changed ones.
  Idle scene ≈ 0.015; scrolling at full speed ≈ 0.024. Small margins — prefer
  the ship centroid for movement assertions.
- **Ship centroid**: scan ±90px around canvas centre for cyan pixels
  (r<130, g>170, b>190) — the ship is `#35f0ff` and the camera keeps it near
  centre with lag `speed/camRate` (~20px) in the travel direction. Offset
  direction/settling reveals acceleration, braking and direction flips.
- Collect `pageerror` + console errors for the whole session; expect zero.

A known-good driver covering boot → run → accel/brake/flip → opposing-keys →
joystick drag+reversal: see `scripts/` or rewrite from this recipe (~120
lines). Full run takes ~15s of game time, before difficulty ramps.
