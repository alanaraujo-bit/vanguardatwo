import esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const serve = process.argv.includes('--serve');
const outdir = 'dist';

// Load .env (if present) into process.env without adding a dependency.
// Vercel provides these as real env vars in CI, so the file is dev-only.
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // no .env — fine
}

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
cpSync('public', outdir, { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  outfile: `${outdir}/main.js`,
  sourcemap: serve ? 'inline' : false,
  minify: !serve,
  target: ['es2020', 'safari14'],
  logLevel: 'info',
  define: {
    // Public identifier (not a secret): the Google OAuth client id the login
    // button uses. Injected at build time; empty string disables the button.
    __GOOGLE_CLIENT_ID__: JSON.stringify(process.env.GOOGLE_CLIENT_ID ?? ''),
    // Realtime game-server endpoint (co-op). Dev default is the local server
    // from `npm run dev:server`; production passes WS_URL (Railway).
    __WS_URL__: JSON.stringify(process.env.WS_URL ?? 'ws://127.0.0.1:8138'),
  },
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  // `vercel dev` provides PORT and proxies /api to the serverless functions.
  const { port } = await ctx.serve({
    servedir: outdir,
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? 8137),
  });
  console.log(`\n  BALUARTE rodando em  http://127.0.0.1:${port}\n`);
} else {
  await esbuild.build(options);
  console.log('Build finalizado em dist/');
}
