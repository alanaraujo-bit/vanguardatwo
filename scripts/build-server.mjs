import esbuild from 'esbuild';

/**
 * Bundles the realtime game server (server/ + the shared sim from src/game)
 * into a single Node file. Bundling is what lets server code import the
 * extensionless TS modules of src/ — the same trick the client build uses.
 */
await esbuild.build({
  entryPoints: ['server/index.ts'],
  outfile: 'server/dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  // Native optional dep of pg; never present, never needed.
  external: ['pg-native'],
  banner: {
    // ws (CJS) is bundled into ESM output — give it the require it expects.
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
